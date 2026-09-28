# Shared Calendar and Email state

Calendar connections and events come from the authenticated Calendar gateway. Calendar choices, availability, booking-page drafts, requests, notification configuration and workflow nodes now use a revisioned D1 document owned by the verified workspace/principal. Email mailbox/provider data already comes from the coordinator; Email preferences and TAP triage corrections now use a revisioned D1 document owned by the verified mailbox profile.

The SDK store and SQLite remain device caches and durable pending-write journals. Startup imports existing local settings once, retaining a migration backup. Existing server choices win; missing fields migrate. A fresh phone does not publish empty defaults over desktop settings. Independent edits merge against server revisions without relying on device clocks. Offline edits are saved before upload and retry on launch, focus, reconnect and every 30 seconds. Email also refreshes settings during pull-to-sync. Failed sync remains visible.

## Rollout

1. Apply Calendar gateway migration `0025_shared_state.sql` and Email coordinator migration `0021_shared_state.sql` to their production D1 databases using each service's migration command.
2. Deploy both services before releasing their clients. The migrations are additive; existing clients remain compatible. Settings endpoints use existing authentication and expose no provider credentials.
3. Publish Calendar 0.3.7 and Email 0.3.9 to the workspace and release the matching rebuilt mobile bundles. Open the updated desktop miniapps once to import settings that previously existed only on the Mac. Existing Google/Microsoft connections need no additional OAuth consent.
4. Validate in the same account/workspace on independent devices: calendar visibility/availability and Email preferences/corrections, including offline edits followed by restart. A failed settings read must display an error, not infer that the user has no calendar.

Mobile currently embeds its miniapp bundles. This change updates those bundles but does not replace the mobile package loader with workspace release resolution. Consequently, desktop and mobile must receive the matching release during rollout.

## Validation

Tests cover independent journals, simultaneous writes, deletion merging, first-device migration order, lost acknowledgements, offline restart, account isolation, schema rejection, and Email corrections beyond the first 100 cached messages. The provider refresh and delayed cache-write paths preserve the acknowledged server correction even when a device clock is ahead.
