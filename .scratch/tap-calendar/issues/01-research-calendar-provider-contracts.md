# Research the calendar-provider integration contracts

Type: research
Status: resolved

## Question

What current first-party authentication, account/calendar discovery, permission, free/busy, event-write, recurrence, webhook/incremental-sync, delegation, quota, and compatibility constraints must the specification respect for Google Calendar/Workspace, Microsoft 365/Outlook.com/Exchange Online, Apple iCloud, generic CalDAV, on-premises Exchange, and ICS?

## Answer

TAP must maintain a capability and freshness profile per connected calendar rather than treating an account as generically connected. Google and Microsoft provide renewable change-notification plus cursor/delta models; CalDAV requires server capability negotiation; supported on-premises Exchange requires an enterprise connector and adaptive EWS synchronization; ICS is a read-only polled feed. Provider notifications are reconciliation hints, never booking truth.

iCloud remains a release-blocking contract risk: Apple documents authorization for supported third-party calendar apps and app-specific passwords, but its public material does not establish the calendar-specific cloud API, authorization, change-stream, quota, or delegation contract needed for a production promise.

The implementation must retain provider-specific identities, permissions, revisions, cursors, freshness, recurrence fidelity, invitation authority, and quota state while projecting normalized Calendar Visibility, Conflict Calendar, and Destination Calendar controls. Stale or indeterminate Conflict Calendars fail closed.

Research artifact: `research/tap-calendar-provider-contracts` at `77b99cb291b6856e5785ae4e50b2a15de6865ce4`, file `docs/research/calendar-miniapp/provider-integration-contracts.md`.

Remaining decisions are owned by downstream tickets: the Apple integration contract, Microsoft shared-calendar watch and delta behavior, named CalDAV compatibility set, Exchange Server SE certification, canonical recurrence subset, freshness thresholds, and provider-versus-TAP invitation ownership.
