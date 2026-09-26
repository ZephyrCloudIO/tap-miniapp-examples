# Calendar committed activity

Calendar 0.3.2 registers `tap-calendar-committed-actions` as a storage-only QuickJS
`activity.source` for Chloe. It requires SDK 0.19.0 and TAP >=2.20.0. The source
accepts trusted `self` scope and returns counts for the requesting user and
workspace over a half-open time range of at least 15 minutes.

| Activity ID | Outcomes | Commit boundary |
| --- | --- | --- |
| `meeting-scheduled` | `confirmed` | Provider-confirmed Calendar, channel, or specialist meeting; also approved ad hoc holds |
| `meeting-rescheduled` | `completed` | Successful public booking date/time change |
| `meeting-cancelled` | `completed` | Successful public booking cancellation |
| `work-block-created` | `confirmed` | Provider-confirmed personal work block |
| `booking-received` | `confirmed`, `pending` | Guest submission committed, preserving its initial approval state |
| `booking-decision` | `approved`, `declined` | Organizer approval/decline committed after provider confirmation |
| `booking-page` | `published`, `updated`, `unpublished` | Actual public page status/content change; attributed to the acting manager for shared profiles |
| `availability-updated` | `saved` | Successful personal schedule/event-policy save or shared host policy change |

Public guest bookings count as `booking-received`, rather than also incrementing
`meeting-scheduled`. An approval is a separate decision; it does not rewrite the
original booking's outcome. Previews, drafts, rejected operations, expired holds,
unchanged times, cosmetic schedule names, and identical publications do not
produce activity. Provider retries/recovery use the original durable identity.

Migration 0022 records gateway activity with D1 triggers in the same transaction
as the canonical state transition. Personal availability receipts are saved inside
the Calendar state revision using the existing optimistic concurrency check, then
uploaded idempotently through `/v1/activity/availability`. The gateway derives the
user and workspace from organizer authentication. No caller-supplied activity
type, owner, or outcome is accepted. Availability receipt times preserve offline
save dates; gateway activities use the database transition time.

The desktop refreshes its activity snapshot on open, state changes, focus, network
reconnection, and every 30 seconds while visible. Successfully uploaded receipt
IDs are remembered for the current session to avoid repeated uploads. Gateway
tracking continues while the desktop is closed; the source reads only the last
synchronized snapshot and reports `partial` beyond that snapshot's timestamp.
An unavailable/malformed snapshot is an error, never a fabricated zero result.

Storage is host-scoped to the workspace/package and additionally keyed by user:
`tap-calendar` / `users/{userId}/activity/v1`. The snapshot explicitly verifies
both identities. It contains only activity IDs, outcomes, and timestamps—no
meeting titles, guests, email addresses, tokens, or booking links.

History is retained for 90 days. A snapshot includes at most 2,048 events; the
availability journal holds at most 512 receipts. Tracking begins at migration
and local journal initialization, with no historical backfill. Queries outside
these boundaries report partial coverage, including a truncated timestamp's
entire millisecond. There are no duration or productivity-score claims.

## Rollout

For an existing deployment with migrations through 0021, deploy the updated
gateway before applying 0022: the older shared-host handler assumes one D1
changed row and would reject successful saves once activity triggers are active.
Apply 0022 before publishing/installing Calendar 0.3.2. New database deployments
must first apply the earlier migrations. Older Calendar releases continue to
work; personal availability tracking begins when 0.3.2 is opened.

Run miniapp/gateway tests and typechecks, `pnpm verify:tap`, manifest validation,
and production builds. The gateway tests exercise D1 transitions, transaction
rollback, provider retries, public publication routes, shared-manager attribution,
and authenticated isolation. Source tests cover counts, time boundaries, partial
coverage, malformed snapshots, storage conflicts, and synchronization failures.
