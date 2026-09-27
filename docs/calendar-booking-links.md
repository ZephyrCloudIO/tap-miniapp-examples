# Published Calendar booking links

Email's **Share availability** picker uses Calendar's authenticated, read-only
publication API through the TAP host HTTP bridge. It works with the Calendar
panel closed. Calendar continues to own availability, conflicts, time zones and
booking; neither listing nor selecting a link creates an event or booking.

## SDK and authorization contract

The implementation uses the supported SDK 0.19 `sdk.http.request` API, not
cross-surface MCP calls, private storage reads, or lifecycle event request/reply.
The consuming surface must declare the on-demand `network.request` and
`credentials.use` actions, plus `external-network` for the exact
`https://calendar-api.theaiplatform.app` origin and `credentials` for `http`.
Email declares these only on its UI surface; its MCP tools gain no Calendar access.
The picker checks both actions before each request.

Send `credentialRef: 'platform-session'` with an `expectedContext` containing the
mount's canonical `userId` and `workspaceId`. The host attaches the credential
and refuses a changed user/workspace. Send `X-TAP-Workspace-Id` for that workspace;
do not send a principal ID or a caller-selected owner. The gateway verifies the
session JWT, resolves its canonical user through Authz, and requires workspace
membership and `workspace:read`. Production ignores principal headers.

## List and selection validation

`GET /v1/booking-links` returns:

```json
{
  "schemaVersion": "tap.calendar.booking-links.v1",
  "userId": "canonical-tap-user",
  "workspaceId": "active-workspace",
  "links": [{
    "profileId": "calendar-source-profile-id",
    "eventTypeId": "calendar-source-event-type-id",
    "title": "Office hours",
    "durationMinutes": 30,
    "url": "https://cal.with-tap.ai/alex/office-hours",
    "revisionId": "public-revision-id",
    "generation": 4
  }]
}
```

The profile and event IDs are the original Calendar IDs, not the registry IDs.
Results contain only the caller's individual publications in the selected
workspace. Shared workspace profiles and private event/provider data are excluded.
The list is bounded by the publication quotas (20 profiles × 50 pages), sorted by
title and IDs, and served with `Cache-Control: no-store` from a primary D1 read.

Immediately before inserting, repeat the GET with all four query parameters:
`profileId`, `eventTypeId`, `revisionId`, and `generation`. Success returns the same
identity envelope with `link` instead of `links`. Unknown, partial, duplicated or
invalid parameters return `400 invalid_booking_link_selection`. A page that has
changed, been paused/unpublished, belongs to another scope, or disappeared returns
`409 booking_link_stale`. Refresh and ask the user to choose again; never insert
a cached selection. Generation checks also reject unpublish/republish cycles that
reuse an immutable revision. Validation confirms the state at query time; a later
unpublish can still invalidate an already shared link.

`200` with an empty `links` array means no eligible pages. Authentication or
authorization failures use `401`/`403`; an unavailable service or an older gateway
without this route is an unavailable feature, not an empty list. Email also fails
closed on truncated/malformed responses, unexpected response origins, unsafe URLs
and response identity mismatches. It discards pending results on cancellation,
unmount or a user/workspace change, preserves the saved cursor/selection, and
refuses to overwrite a draft edited during selection validation.

## Publication semantics and rollout

The query requires both profile and page to be published, active slug routes,
publication timestamps, a matching committed revision, and a stored canonical URL.
Pausing an Event Type in Calendar omits it from the next whole-profile publication.
Drafts, paused/unpublished pages and incomplete registry entries are excluded.
Failed or pending edits cannot leak new titles, durations or URLs: the previous
confirmed server publication remains authoritative until an update commits.

Migration `0023_published_booking_links.sql` adds `canonical_url` to the publication
record. The publisher writes it in the same atomic batch as the revision and
generation, and idempotent replays return the stored URL. The list never constructs
URLs from slugs or current deployment configuration.

Apply migration 0023 before deploying this gateway, then publish the updated Email
package. Existing public pages remain usable, but pages created before this
migration are excluded from the picker until the owner republishes them (unpublish
and publish in Calendar). There is deliberately no guessed URL backfill. The old
gateway ignores the additive column, so applying the migration first is compatible.

## Verification

Gateway publication-route tests cover isolation, the public-only projection,
draft/pause/unpublish/republish transitions, invalid routes, failed edits, legacy
records and stale selections. Organizer auth tests cover canonical identity and
workspace authorization. Email transport and component tests cover permission
denials, identity mismatches, stale/unavailable/empty results, cursor insertion in
compose and reply, cancellation and scope changes. Test Lab fixtures include a
Calendar-closed selection case and an HTTP-denied case without real mail or bookings.
