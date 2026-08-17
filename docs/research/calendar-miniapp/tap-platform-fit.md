# Tap platform fit for a calendar miniapp

**Research pass:** 4 of 4  
**Researched:** 2026-08-14  
**Question:** Which parts of the proposed calendar product can be built with Tap Miniapp SDK 0.7.0, and which require new platform primitives?

## Evidence boundary

This pass inspected three first-party source sets:

- This example repo pins `@theaiplatform/miniapp-sdk` **0.7.0** and describes it as the verified version for every current example ([root README](../../../README.md), [root package.json](../../../package.json)).
- The published 0.7.0 SDK tarball is the authoritative public package contract: [`@theaiplatform/miniapp-sdk@0.7.0`](https://registry.npmjs.org/@theaiplatform/miniapp-sdk/-/miniapp-sdk-0.7.0.tgz). Its `dist/sdk.d.ts`, `config-schema.json`, and `README.md` were inspected directly.
- The local Tap host checkout at `/Users/zackarychapple/code/ze-miniapp/ze-agency-tauri` is useful implementation evidence but is **older**: commit `80317ab4ef182cdc0fc44ef4eebb6629bc21f466` from 2026-07-30, with SDK package version 0.4.5. The local `tap-miniapps` checkout is likewise on SDK 0.4.5 at commit `c8ad7dbd9e631a862575d7d7c0468b57b9b98d0a`. Absence in those checkouts cannot disprove a 0.7.0 feature.

The findings below distinguish an SDK contract from a host guarantee. A declared type or contribution means the package can request the capability; end-to-end acceptance still requires a 0.7.0-compatible desktop/mobile host and Test Lab coverage.

## What SDK 0.7.0 already provides

### UI, data, and host actions

- `ui.surface` contributions can target desktop/mobile webviews and be scoped to a user, workspace, or channel by descriptor options. Existing examples demonstrate settings and channel placements (for example [Kart Royale's manifest](../../../apps/kart-royale/manifest.tap.json)).
- Durable package-scoped JSON storage uses optimistic revisions, and secure session storage is backed by the OS credential store. These are sufficient for user preferences and cached calendar configuration, but not by themselves for a multi-tenant scheduling system of record. See `MiniAppStorageApi` and `MiniAppSessionApi` in the published 0.7.0 `dist/sdk.d.ts`.
- SDK 0.7.0 exposes workspace task CRUD (`MiniAppTasksApi`), channel listing/messaging/timeline/access, workflows, authorization checks, host-mediated HTTP, and local services. Task fields include title, description, status, priority, assignees, channels, and due date.
- `chat.block` contributions support host-rendered primitives or an approved renderer protocol. The logical authoring CLI supports table, report, and notice; the descriptor also recognizes federated and isolated renderer protocols. See `ChatBlockOptions` and `ChatBlockProtocol` in the published `config-schema.json` and the chat-block section of the published `README.md`.
- `action.command` is a first-class contribution with a label, optional JSON input schema, target runtime, and a list of host placement strings. Context-bound commands can receive host-minted references for channel messages, tasks, pull requests, and repository issues through `MiniAppArtifactReference`/`MiniAppArtifactsApi`.

### Notifications

- `sdk.notifications?.show({ message })` is an optional desktop/mobile host-mediated **OS notification** API. The host owns attribution, permissions, preference enforcement, and rate limiting; the package receives `shown` or a suppression reason. The manifest must declare the OS-notification effect and a permission action. See the published 0.7.0 `README.md` “OS notifications” section and `MiniAppNotificationsApi` in `dist/sdk.d.ts`.
- The API is presentation-only: it accepts a message at call time. The published SDK does not expose a timer, alarm, scheduled local notification, or durable wake API. A webview timer is therefore not a correctness mechanism for “notify ten minutes before” after unmount, app exit, sleep, offline operation, or event edits.

### Channels, presence, and tasks

- `channels.list`, `getAccess`, `getTimeline`, and `sendMessage` are available in 0.7.0. `MiniAppChannel` contains room metadata but **not its participant roster**.
- `MiniAppPresenceApi` returns only participants who joined the miniapp's package-scoped ephemeral presence room. It is not the durable Tap channel membership list and cannot safely populate “everyone in this channel.”
- The Tap chat v2 backend does have a canonical participant API (`GetRoomParticipants`) in `/Users/zackarychapple/code/ze-miniapp/ze-agency-tauri/protos/proto/tap/chat/v2/chat_api.proto`, but the 0.7.0 miniapp API does not expose it.
- Tasks can be created, read, and updated, but their SDK shape has no extension field or typed relation to an external calendar event. A link can be stored in text or in the calendar app's own storage, but that would not make the relation native or independently discoverable from the task.

### External accounts and provider calls

- Host-mediated HTTP supports selected stored bearer/basic/header/API-key credentials without exposing secret values to miniapp JavaScript. `mcp.oauth` can declare host-custodied OAuth for an HTTPS MCP server.
- The generic UI SDK exposes only Tap user-profile auth. It does not expose a calendar-provider OAuth connection manager, provider account/calendar enumeration, refresh/revocation health, or Google/Microsoft domain delegation contract.
- An existing Google Workspace miniapp in the older local `tap-miniapps` checkout proves that a host-specific Google control plane can be built, but it covers Drive/Docs/Sheets/Slides/Forms and an older SDK; it is not a Calendar API contract (`/Users/zackarychapple/code/ze-miniapp/tap-miniapps/apps/google-workspace/manifest.tap.json`).

## Seven requested minimums: fit matrix

| Requirement | Current fit | Evidence and missing work |
| --- | --- | --- |
| 1. Add multiple calendars the user owns | **Partial** | The miniapp can render and persist selections and call a backend/provider through permissioned HTTP. Tap lacks a first-class Google/Microsoft calendar connection and token lifecycle contract. Provider integration plus a durable calendar backend are required. |
| 2. Add multiple calendars the user can access | **Partial** | Same integration path; the provider can enumerate shared/delegated calendars if granted. The product must distinguish read-free/busy, read-details, and write permissions, and destination-calendar eligibility. Tap has no built-in owned/delegated calendar model. |
| 3. Configurable 10-minute system notification | **Partial** | OS presentation exists. Reliable scheduling while unmounted/closed does not. This requires a durable server schedule plus a Tap push/wake or scheduled-notification primitive, with deduplication, cancellation/edit handling, device policy, and desktop/mobile delivery semantics. |
| 4. Calendar blocks for chat and tasks | **Partial** | Chat blocks and task CRUD exist. A calendar chat block can be contributed; a context action can start from a message/task. A durable typed relation between a booking/block and a Tap task/chat artifact is not standardized, and task records have no extension relation field. |
| 5. Configure availability | **Supported at the UI/storage layer; backend required** | A surface can edit schedules and storage can retain preferences. Correct free/busy intersection, time zones/DST, recurrence, buffers, holds, and concurrency require the calendar service, not a new UI primitive. |
| 6. Schedule meetings with multiple people | **Partial** | UI, external API calls, workflows, and provider calendar writes are possible. Tap does not supply a multi-calendar availability engine, guest identity model, booking hold/commit service, routing algorithms, or lifecycle notification service. |
| 7. Slash command for selected channel participants | **Partial, with two platform gaps** | `action.command` can represent a schedule action and a miniapp surface can render the participant dialog. The SDK does not standardize a slash/composer placement, and it does not expose the channel participant roster. Tap must add both, or the product must use an existing context-action/command placement and ask users to search invitees instead. |

## Recommended architecture boundary

The calendar should be a miniapp **plus a durable scheduling service**, not a surface-only package:

1. The miniapp owns calendar UI, availability/event-type configuration, booking flows, Tap-native chat blocks, task actions, and permission-aware previews.
2. A server-side calendar service owns provider OAuth/tokens, account and calendar inventory, incremental sync/webhooks, normalized free/busy, recurrence/DST evaluation, booking holds, idempotent writes, reconciliation, public booking pages, external guests, and notification schedules.
3. Tap platform primitives bridge host context: channel roster reads, composer/slash-command registration and invocation, typed artifact relations, and reliable push/wake delivery to the correct user's clients.

Keeping provider tokens only in package session storage would couple correctness to one device and mounted UI. Keeping canonical bookings only in generic miniapp JSON storage would make provider webhook processing, public booking, concurrent slot reservation, and cross-device recovery impractical.

## Platform dependencies to ticket during Wayfinding

1. **Expose authorized channel rosters to miniapps.** Return durable participants, roles, invitation/removal state, and identity references under channel permissions; do not substitute ephemeral presence.
2. **Define a composer/slash-command placement.** Specify naming, discovery, collisions, arguments, keyboard/mobile behavior, channel launch context, and how a command opens a modal/surface without losing the draft.
3. **Provide a scheduled notification delivery contract.** Choose server push, device-local scheduled notifications, or both; define offline behavior, edits/cancellation, exact-once expectations, DND, multiple devices, and deep links.
4. **Define calendar-provider connection primitives or bless an app-owned backend.** Include Google and Microsoft OAuth, refresh/revocation, scopes, shared/delegated calendars, admin delegation, connection health, and mobile setup.
5. **Define typed calendar-to-artifact relations.** Decide whether relations live in a generic host artifact graph, task extensions, chat block payloads, or app-owned projections with host deep links.
6. **Verify 0.7.0 host parity.** Add Test Lab positive/denial cases for `action.command`, `chat.block`, tasks, notifications, desktop/mobile targets, and any newly added roster/scheduled-delivery APIs.

## Wayfinder implications

- The seven minimums are feasible as a product direction, but not as a single front-end-only miniapp.
- The first Wayfinder decision should set the replacement/launch boundary. That decision controls whether the map targets a Tap-native personal/team scheduler first or simultaneously includes public booking, routing, payments, enterprise administration, regulated markets, and a developer platform.
- After the destination is fixed, the platform-dependency tickets above can be separated from scheduling-domain tickets such as event models, availability semantics, guest identity, provider matrix, notifications, migration, and reliability.
