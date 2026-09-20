# Collective booking links: implementation review

Reviewed: 2026-09-19 (America/New_York).
User-confirmed scope: **every selected host attends**.
Updated: 2026-09-20 to include the requested workspace-owned organization booking profile, such as Zephyr.

Implementation follow-up (2026-09-20): the workspace-owned, Google-hosted
collective-link slice is implemented on `codex/collective-workspace-bookings`.
See the [user setup](../../../apps/tap-calendar/README.md#shared-booking-links)
and [gateway implementation/deployment notes](../../../apps/tap-calendar-gateway/README.md#workspace-bookings).
The research below records the pre-implementation audit and broader proposal.
Personal-profile collective types, round robin, capacity sessions, and arbitrary
multi-person in-app scheduling are not included in this slice. No production
namespace or host was claimed/enrolled during implementation.

The following is the original implementation proposal, not a shipped-feature claim. The current task checkout predates TAP Calendar, so this review uses local `main` at `7fd0e9e376a022f99a4c22d5e6d502850bba3baa` and cross-checks the relevant contracts on `codex/calendar-booking-sync` at `a5dfa79f0a41ac98105ce578340f1232ecc99f5a`. The latter adds other calendar capabilities but retains the single-host scheduling boundary. No deployment was inspected or changed.

## Recommended product behavior

Add **Collective** as an Event Type scheduling mode: one guest books a meeting with a fixed set of required hosts. Offer a slot only if every host is available for the full duration under their own scheduling policy. Use that same engine for the in-app “find a time” experience.

Keep the existing public URL structure, `https://cal.with-tap.ai/{profileNamespace}/{eventTypeSlug}`. A personally owned Booking Profile can contain a collective Event Type. Ownership determines who manages the page; the host list determines who must attend. The user's follow-up adds workspace-owned organization profiles to the desired design, with Zephyr as the example; implement their management authorization alongside collective scheduling.

Example only, not a created link: `https://cal.with-tap.ai/zack/product-review` could list Zack and Alex and offer only their common free times. Adding names to a title or passing attendee emails in a URL does not configure that behavior today.

Proposed organizer journey:

1. Open Booking Profiles → New Event Type → “Collective — everyone attends.”
2. Choose hosts from verified TAP identities, including the organizer if they will attend.
3. Each host authorizes participation and chooses their Availability Schedule and Conflict Calendars. Show connection/grant readiness; a channel roster alone is not authorization.
4. Choose one meeting organizer and writable Destination Calendar, duration, conference provider, and confirmation policy.
5. Preview common availability and publish once all required hosts are ready.
6. Copy the existing style of booking link. The guest sees the approved host names, times in their own time zone, and one booking form.
7. Create one organized meeting containing all required cohosts and the guest, with one conference link and one cancellation/rescheduling lifecycle.

The initial supported host set should be connected TAP users with Google calendars, matching the implemented provider path. Arbitrary external invitees can receive invitations, but their availability is unknown without a supported connection or sharing grant. Google and Microsoft provider details are recorded in [the provider research](multiperson-provider-capabilities.md).

## Workspace-owned organization profiles

Recommended experience: a Zephyr workspace administrator opens Calendar → Workspace booking, claims an available Profile Namespace such as `zephyr`, and creates shared Event Types such as `product-review` or `onboarding`. Example routes would be `/zephyr/product-review` and `/zephyr/onboarding`; these names have not been checked for availability or claimed. Each collective Event Type has its own explicit host set. Workspace membership does not automatically make every member a host.

Bind the profile to the immutable, server-authorized TAP workspace ID. Keep its creator and each mutation's actor separately for audit. The display name and public namespace are editable identifiers, not the ownership key. A workspace rename should not silently change public URLs, and the profile must survive departure of its creator.

Proposed owner model: `individual(userId, workspaceId)` or `workspace(workspaceId)`. The public UI can call the latter an organization profile. This does not assume that TAP workspaces, legal organizations, and verified domains are interchangeable, or that a separate organization registry is necessary for this first version.

The gateway already verifies the organizer's JWT, resolves a canonical TAP user, and checks workspace access via AUTHZ. However, it currently requests only `workspace:read`, returning membership/access booleans rather than a Calendar management decision. Extend that server-side authorization contract with appropriate administrative or delegated Calendar permissions. Do not trust a client-provided role, workspace display name, or the presence of the `organization` enum in miniapp state. [Organizer authentication](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/organizer-auth.ts#L189).

Proposed responsibilities:

| Role | Authority |
| --- | --- |
| Workspace owner/admin | Claim/manage the workspace profile, delegate booking managers, control namespace and publication. |
| Delegated booking manager | Manage authorized Event Types, host invitations, bookings, and lifecycle actions; namespace/ownership changes need an explicit grant. |
| Participating host | Accept/revoke participation and manage their own availability/calendar grants. |
| Ordinary workspace member | No organization-claim authority merely from membership; booking visibility follows explicit policy. |

Reuse the global slug registry's atomic uniqueness and retired-name reservations. A workspace named Zephyr does not itself establish entitlement to an already-reserved `zephyr` namespace. Claim an available name without adding a new domain-verification requirement; if TAP has an authoritative organization/domain association, it can support a separate verified-identity policy. Existing personal claims must not be silently reassigned. Any supported conversion needs an explicit, audited transfer and management-link compatibility.

Move the shared profile's editable definition and published state into gateway-owned workspace records, with revision checks, rather than the creator's per-user miniapp JSON. Keep provider connections scoped to their real authorizing principals. The workspace owns the booking page; a designated authorized calendar connection supplies the organizer event, and individual host grants supply availability. Organization ownership alone gives no access to coworkers' private calendars or provider tokens.

The current registry requires `principal_id`, keys source profiles and quotas by `(workspace_id, principal_id)`, and restricts `owner_type` to `individual`. Extend owner identity, quotas, profile reads/writes, audit actor fields, and publication receipts together. Merely dropping the owner-type check would retain the wrong ownership and access boundaries. [Registry migration](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/migrations/0012_public_booking_publications.sql#L8).

On a manager's removal, revoke management access while retaining the workspace profile. On a required host's departure or connection revocation, stop new affected bookings until an authorized manager resolves the host set; retain existing booking records and recovery/cancellation paths. Never silently substitute another host or treat an absent host as free. Workspace deletion should unpublish its pages while preserving namespace ownership fences and the applicable retention/recovery policy.

Additional acceptance gates: an ordinary member cannot claim/publish; a removed manager cannot mutate; two workspace admins share the same profile and revision conflict protection; another workspace cannot reuse its ownership; duplicate claims serialize; creator departure preserves the page; workspace rename preserves URLs; host departure blocks affected new bookings; personal links and collective workspace links still compete for the same host reservations.

## What exists and what must change

Source links below are pinned to the reviewed `main` commit.

| Area | Existing implementation | Required change |
| --- | --- | --- |
| Event Type | One destination and one Availability Schedule; no host set. [domain.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar/src/domain.ts#L188) | Add individual/collective mode, ordered required host memberships, organizer selection, and revisions. |
| Authorization | Calendar reads and publication validation require the current principal's connections. [scope query](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/index.ts#L3183), [publication validation](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-publication.ts#L528) | Add revocable host grants and server-resolved availability access across those authorized principals. Preserve existing ownership checks. |
| Always-on availability | A private page snapshot contains one principal, schedule, and conflict-calendar list. [snapshot](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-read.ts#L62) | Persist host-owned scheduling policies in the gateway and bind all required hosts to the page. Do not depend on another host's miniapp being open. |
| Candidate slots | Slot generation applies one host's local windows, travel overrides, notice, horizon, and buffers. [generator](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-read.ts#L935) | Intersect every host's allowed intervals and apply each host's own constraints. |
| Booking concurrency | Public coordination keys identify the owner; provider locks identify owner plus calendar. [owner key](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-create.ts#L368), [calendar lock](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/index.ts#L4926) | Serialize and reserve every required host across all booking entry points, including links owned by different people. |
| Durable busy time | Public availability loads bookings under one principal and selected destination calendars. [busy projection](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-busy.ts#L36) | Store per-host reservations so a meeting organized elsewhere immediately blocks a participating host's other links. |
| Provider invitations | Public booking passes only the public guest as an attendee. [Google adapter](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-google-provider.ts#L56) | Resolve invite emails from authorized host memberships; invite required cohosts and guest, deduplicate organizer/self identities. |
| Management | Booking management stores one provider event and organizer identity. [management record](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/public-booking-management.ts#L76) | Keep an immutable booked host set, all reservations, host-visible status, and lifecycle recovery. |
| In-app scheduling and MCP | The scheduler assembles attendees; MCP availability reads the caller's own stored schedule/cache. [scheduler](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar/src/app.tsx#L5276), [MCP availability](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar/src/mcp/calendar-tools.ts#L1015) | Route authorized collective requests through the gateway engine. Adding attendee fields to the existing private-cache tool is insufficient. |

The existing slug registry, immutable publication revisions, signed slot proofs, provider recovery/idempotency, live Google validation, public protection, and management/email infrastructure are useful foundations. This is a substantive gateway and lifecycle extension, not just a new picker.

Audit provider grants during host onboarding. The current Google configuration requests `calendar.freebusy`; Google distinguishes that own-calendar scope from `calendar.events.freebusy` for calendars the user can access. Hosts using shared Conflict Calendars may need an additional granted scope and reauthorization. Microsoft connection discovery exists, but the current live query path rejects non-Google adapters; Microsoft collective support also needs event/free-busy normalization and lifecycle integration. [Current OAuth configuration](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/7fd0e9e376a022f99a4c22d5e6d502850bba3baa/apps/tap-calendar-gateway/src/index.ts#L1724), [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [provider research](multiperson-provider-capabilities.md).

## Proposed domain and storage additions

These are proposed responsibilities, not final SQL names:

- **Event Type hosts:** scheduling mode; required host identities; organizer host; stable host-set revision. All hosts are required in the confirmed scope.
- **Host scheduling policy:** owner identity, connected-calendar references, schedule/time zone/overrides, buffers, notice/horizon, and version. Hosts control their policy; a page owner cannot silently loosen a cohost's availability.
- **Host grant:** the host's authorization for a specific Event Type or defined scheduling scope; grant state, version, and revocation. Distinguish permission to read availability, book, and manage a booking.
- **Booking hosts:** the fixed host identities, invitation addresses, policy/grant versions, and public display details captured for an actual Booking.
- **Host reservations:** canonical host identity, booking ID, buffered occupied interval, lifecycle state, and recovery metadata. Provider calendar/resource identity is separate from the connection used to access it.
- **Provider operations:** preserve stable operation IDs and receipts, linked to the canonical Booking. One organizer event should remain the normal invitation mechanism.

Publish a versioned schema and migrate existing Event Types to individual mode with their original organizer and selected schedule. Preserve existing URLs, receipts, and management links. New host details in public responses must be explicitly guest-safe; do not expose tokens, calendar IDs, private events, or internal authorization scopes.

Host additions/removals affect future booking pages; they must not silently rewrite the participants of existing bookings. Host-grant revocation must immediately stop new bookings while retaining controlled cancellation/recovery access for existing records.

## Availability algorithm

For a proposed interval `[start, end)`, every required host must pass:

1. Their connection and scheduling grant are valid.
2. Their own local Availability Schedule, including travel overrides and DST behavior, permits the interval.
3. Their minimum notice and local-date booking horizon permit it.
4. Their buffer-expanded interval does not overlap any busy Conflict Calendar or active TAP host reservation.
5. Every required availability source was checked conclusively for the needed range.

Compute candidate times in UTC after evaluating each host's local policy, then display in the guest's zone. Intersect valid time intervals; do not compare local clock strings or independently generated slot lists whose grids may differ. Apply each host's buffers separately. Treat preferred windows as ranking preferences after hard constraints pass.

A disconnected host, denied calendar, partial result, truncation, or provider failure is **unknown availability**, not a free slot. The public response should say availability cannot be checked without naming private events or explaining which host is busy. Hosts may see their own actionable connection errors.

Cache by host-policy/grant revisions and coverage. A host-policy edit must invalidate collective results and outstanding proofs; commit must re-resolve current permissions and policies. Keep public proofs opaque or use revision digests rather than embedding private host/calendar identifiers in readable signed tokens.

## Booking and lifecycle correctness

The essential contention scenario is two pages with host sets **A+B** and **B+C**. Concurrent requests for the same interval must not both reserve B. The current owner-based keys do not enforce that invariant across page owners.

Recommended commit sequence:

1. Resolve the published Event Type and authorized host set on the server; never trust guest-supplied host IDs, calendars, or organizer identity.
2. Claim one idempotent Booking operation.
3. Acquire the complete canonical host/resource set in a deterministic order with fencing; revalidate grants, policies, provider availability, and durable reservations under that boundary.
4. Atomically create or confirm all host reservations. Every path that can book a participating host must use this same reservation service: personal links, collective links, workspace/channel scheduling, approvals, and reschedules.
5. Create/recover one provider meeting from the designated organizer calendar, including required cohosts and the guest. Provision the conference once.
6. Persist the provider receipt and canonical booking outcome; project it to each host and queue deduplicated lifecycle notices.

Use the existing durable gateway store and recovery model as the starting point. An atomic database operation does not include the provider request: provider I/O remains a recoverable external step. A lease expiring or an HTTP timeout must not release a host reservation while event creation remains uncertain.

Shared calendars discovered through different connections need a canonical resource identity if they are treated as exclusive resources. Do not key exclusivity only by page owner or connection-specific row ID. Define the supported coordination domain explicitly; do not imply a workspace-local reservation prevents every external or cross-workspace write.

For approval-required bookings, hold **all hosts**, expire/release all holds together, and live-recheck every host when approved, excluding the booking's own holds. The approver should be explicitly designated; collective availability does not inherently mean every host must approve each request.

For rescheduling, acquire the old/new host and interval set, reserve the new interval and reconcile the provider update before releasing the old reservation. On cancellation, release all reservations only when the provider outcome is known. Retries must not create extra invitations, conferences, or notices.

A revoked/disconnected host or externally changed provider event after confirmation needs a visible conflict/recovery state and alternative common-time suggestions. Do not silently move a confirmed meeting. Provider invitation delivery and RSVP acceptance are separate from TAP's reservation/confirmation state.

The service can prevent competing **TAP** bookings and perform a fresh provider check. It cannot make availability reads plus writes across independent calendar providers one atomic transaction. Provider-side edits after a check still need detection and reconciliation; do not promise an absolute cross-provider lock.

Keep confirmed host reservations even after the organizer event is created: Google's invitation settings can delay an event's appearance on an invitee's calendar until they respond. Reading provider free/busy alone immediately after sending an invitation can therefore reopen a cohost's time incorrectly. [Google event insertion and attendee response behavior](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## Delivery order and acceptance gates

1. Add workspace-owned profile identity and authoritative management permissions, plus host identities, grants, gateway policies, and schema migration. Retain individual behavior.
2. Implement and test the shared availability engine for authorized Google hosts.
3. Build shared host reservation and recovery semantics; route existing individual/internal booking paths through it.
4. Extend provider invitations, holds, approvals, rescheduling, cancellation, and host projections.
5. Add Collective Event Type configuration and public host display; publish using the existing namespace/slug flow.
6. Add the same “find common times” experience to the workspace/channel scheduler and its authorized tools.

Required acceptance cases:

| Scenario | Expected outcome |
| --- | --- |
| A free, B busy | Slot absent; final commit also rejects it. |
| A+B and B+C book concurrently | Only one overlapping booking reserves B, regardless of page ownership. |
| A+B collective link and B's individual link race | Same protection, including the internal scheduler. |
| One host's free/busy read fails or is incomplete | No confirmed availability or booking. |
| Host policy/grant changes after slot selection | Old proof cannot authorize a booking under outdated rules. |
| Different time zones, midnight, travel, spring/fall DST, unequal buffers | Correct common interval and preserved elapsed duration. |
| Host identity repeats or a calendar is connected twice | No duplicate invitations or bypass of reservations. |
| Provider creates event but response times out | Retry recovers the same event and keeps all host reservations. |
| Approval hold expires or is declined | Every host becomes available again; no late approval succeeds. |
| Reschedule fails or cancellation is ambiguous | Existing protection remains until recovery determines provider state. |
| Event Type's hosts change after a booking | Existing booking and management link retain the booked host set. |
| Public page/slot/confirmation inspected | No private event details or internal calendar/grant identifiers leak. |

Verification for this review is code/contract inspection and primary-source provider research. The preceding capability audit ran 83 existing tests successfully on the calendar branch; those tests do not establish collective-booking correctness. This review adds documentation only and does not implement or publish the proposed feature.
