# TAP Calendar: four-pass implementation review

Reviewed 2026-09-24 (America/Nassau), commit `d19f8aa`.

This records the baseline before the follow-up MCP implementation. The live
specialist connection, direct creation, and analytics added afterward are described
and validated in [Live Calendar access for specialists](../calendar-live-mcp.md).
The unrelated workflow-trigger and notification findings below remain open.

Scope: the supplied Automations & tools screen, its workflow/MCP implementations, and the adjacent calendar, notification, host, and gateway paths that determine whether those promises work. Packages: `tap-calendar`, `tap-calendar-gateway`, and `tap-calendar-public`. This is a targeted implementation review, not an exhaustive security audit of every gateway route or proof of the deployed production configuration.

**Assessment:** the repository contains a substantial Google-backed booking implementation. The automation and notification experience is unfinished. Several working libraries and host adapters have no product integration, while the UI presents them as usable features. Passing the current tests does not establish the missing end-to-end paths.

## Pass 1 — Trace UI promises to executable behavior

Read the screenshot's screen, state defaults, package contributions, workflow schemas, and exported functions. Matched each displayed tool/node to its implementation. Confirmed the screen is a catalog, with no workflow creation, invocation, drag behavior, or runtime readiness checks.

## Pass 2 — Trace data, writes, and recovery

Followed scheduling through `submitScheduledMeeting`, the provider booking outbox, gateway commits, and local reconciliation. Reviewed MCP storage loading, freshness checks, event redaction, aggregate summaries, and draft output. Traced reminder preferences and notification channel configuration to their consumers.

## Pass 3 — Check host and durable-service connections

Inspected the manifest/runtime exports, channel participant adapter, authorization boundaries, storage principal isolation, gateway authentication, scheduled jobs, and TAP channel posting adapter. Compared UI cache refresh with MCP's storage-only runtime. Checked that library existence was not being mistaken for an application caller or a durable event subscription.

## Pass 4 — Execute checks and inspect the running UI

Installed the three packages' locked dependencies; ran tests, typechecks, builds, package verification, and host-test discovery. Opened a fresh local preview in the browser and inspected Automations, Notifications, and the shared-channel dialog. Attempted the TAP host suite to establish its actual execution prerequisite.

## Findings, ordered by impact

### 1. [P1] Personal reminder controls do not schedule or deliver reminders

**Evidence:** `apps/tap-calendar/src/app.tsx:4998` through the quiet-hours controls persist `notificationPreferences`. `apps/tap-calendar/src/domain.ts:2014` only merges those preferences. `reminderAt` at line 2021 is a timestamp calculator, with no production caller. The app's only immediate notification call is the test button at `app.tsx:4967`. Gateway scheduled jobs at `apps/tap-calendar-gateway/src/index.ts:10446` handle approval expiry, public booking emails, and cache repair; they do not consume these preferences.

**Impact:** selecting “10 minutes before,” enabling TAP/email/SMS/WhatsApp/Telegram, or setting quiet hours creates an expectation of delivery that this code does not implement. The fresh browser preview exposes all of these controls as editable.

**Required correction:** either deliver reminders through a durable service with destinations, consent, quiet-hours enforcement, cancellation, retry, and deduplication, or clearly mark the settings unavailable until that exists. A successful test notification must not be used as evidence that scheduled reminders work.

**Acceptance:** close the miniapp before a due reminder; verify one delivery, preference enforcement, cancellation behavior, and no duplicate after a retry. Public booking transactional emails are a separate implemented path and are not evidence for this reminder feature.

### 2. [P1] Notification channels are disconnected from actual TAP message delivery

**Evidence:** `app.tsx:5013` saves a shared channel as a generated local ID, name, scope, and empty entries. The dialog does not select an actual TAP channel, team, calendar, or Event Type despite presenting those scopes (`app.tsx:5036`). The real `postChannelSummary` adapter at `apps/tap-calendar/src/platform.ts:381` has no application callers. `appendChannelEntry` at `apps/tap-calendar/src/domain.ts:1696` changes only the locally stored private-channel feed, ignores shared destinations, and does not check the channel's enabled flag.

**Impact:** “Shared Calendar notification channel added” does not establish a delivery destination. Even a private channel created in TAP does not receive booking messages from this application path. The displayed recipient-permission assurances describe behavior that has not been connected.

**Required correction:** bind configuration to real destination IDs and specific scope resources, invoke a governed delivery path after booking transitions, enforce enabled/preferences and audience permissions, and persist delivery receipts/retries. Treat the local feed separately from delivered messages.

**Acceptance:** create a booking, approval, and cancellation; verify each intended TAP message exactly once, no delivery to disabled destinations, and redaction for restricted recipients.

### 3. [P1] Specialist availability depends on recently viewing the right calendars

**Evidence:** the package MCP runtime only reads host storage (`apps/tap-calendar/src/mcp/calendar-tools.ts:208`, `:217`, `:348`). It cannot refresh the gateway cache or storage mirror. Its five-minute/missing-coverage checks return no slots at line 1241. The normal UI cache refresh requests only visible calendars (`app.tsx:2356`, `:2383`); the separate conflict-calendar cache is active only for a public-page preview (`app.tsx:2372`, `:2391`). Refresh itself requires a mounted, visible, online surface (`apps/tap-calendar/src/use-calendar-event-cache.ts:53`).

**Reproduction:** keep a calendar selected for conflicts but hide it, without opening the public preview; after existing coverage ages out, invoke `find_available_slots`. Alternatively close the miniapp for more than five minutes, then invoke the tool. It returns stale/incomplete coverage and no slots even if the gateway's D1 cache is fresh. Aggregate daily summaries have the same underlying storage-mirror dependency. This failure is deliberately safe, but it undermines unattended specialist use.

**Required correction:** supply an authenticated, governed refresh/read path independent of mounting the UI. Cover all required conflict calendars and the requested date range without making sidebar visibility control scheduling eligibility. Preserve the existing fail-closed checks.

**Acceptance:** get valid slots and daily aggregates with the calendar window closed, and with a hidden calendar still enabled for conflicts. Test missing permission and unavailable provider separately.

### 4. [P2] The workflow page advertises interactions and triggers that are absent

**Evidence:** the builder button is unconditionally disabled at `app.tsx:5078`; cards at line 5079 have no drag handlers or draggable attributes. `defaultWorkflowNodes` labels the first two nodes as triggers (`apps/tap-calendar/src/domain.ts:512`), but all four manifest nodes declare `effect: "pure"` (`apps/tap-calendar/manifest.tap.json:329`). Their exported functions transform supplied input. No booking-event-to-workflow bridge, subscription, or invocation was found in the calendar gateway. `listSavedWorkflows` exists at `platform.ts:546` but is not used by the app.

**Impact:** a user cannot build an automation from this page or arrange for booking creation/cancellation to start one. The hero's warning acknowledges the bridge gap but does not make the “TRIGGER” labels or “Drag these” instruction functional.

**Required correction:** present the current exports as transform nodes with accurate host instructions; remove unsupported interactions. A complete automation feature also needs durable booking events, subscriptions, invocation, retries, idempotency, and run status.

**Acceptance:** create/cancel a booking while the miniapp is closed and observe the subscribed host workflow run. Verify duplicates and failures are recoverable.

### 5. [P2] MCP meeting drafts have no handoff into the review dialog

**Evidence:** `draft_meeting` returns a `meeting-draft` JSON object at `apps/tap-calendar/src/mcp/calendar-tools.ts:1556`, explicitly without writes. No draft inbox, draft ID lookup, deep-link receiver, host event consumer, or equivalent importer was found in the surface. `ScheduleDialog` constructs its own draft from form state. The card nonetheless says the result can be reviewed “in TAP Calendar” (`app.tsx:5080`).

**Impact:** a specialist can produce useful structured suggestions, but a human must manually transfer them to the scheduler. There is no implemented one-step review-and-confirm journey. Some draft provider choices also exceed the actual Google booking path's supported locations (`app.tsx:1182`).

**Required correction:** add a host-approved draft handoff with validated inputs and explicit human confirmation, or describe the tool as returning a structured proposal for manual entry. Share scheduling capability validation between drafts and the form.

**Acceptance:** invoke the tool, open the exact proposed meeting in Calendar, edit it, and confirm through the existing live provider commit. Opening or dismissing a draft must never book anything.

### 6. [P2] “Available” is a hard-coded label, not an observed capability state

**Evidence:** `ToolCard` has no readiness input and always displays “Available” (`app.tsx:7490`). Channel scheduling has another unconditional badge at line 5081. `AutomationsScreen` receives only calendar state, not host grants, provider readiness, or MCP registration status. The fresh standalone browser preview displayed all four MCP tools and channel scheduling as available with no connected calendars and no TAP host.

**Impact:** users cannot distinguish shipped exports from tools they can currently use. Missing permissions, execution context, calendars, and cache coverage are concealed until a later failure.

**Required correction:** separate “Included in package” from “Ready for this user,” and explain specific missing prerequisites. Do not invent a live readiness claim when the host exposes no corresponding status API.

**Acceptance:** inspect a standalone preview, first run, permission-denied host, stale cache, and connected host. Each must display an accurate state and an actionable explanation where needed.

### 7. [P2] Smaller controls and descriptions also overstate implementation

- “Suggest another time” is an enabled button without an `onClick` handler (`app.tsx:4990`).
- “Offline read-only” is an uncontrolled `defaultChecked` checkbox with no persistence or behavior connection (`app.tsx:5244`). This finding concerns the toggle, not the existence of event caching.
- The Work Block node claims task, channel, and message sources, but requires `taskId` and always emits `source.kind: "task"` (`apps/tap-calendar/src/workflow-host/catalog.ts:270`, `:314`; `workflow-schemas/work-block-request.schema.json:4`).
- The automation rail says three specialist tools while the screen shows four (`app.tsx:3330`).

**Required correction:** wire each interaction to supported behavior or remove/accurately label it. Expand the Work Block contract only when the downstream consumer supports each source kind.

## What the repository actually contains

“Implemented” below means code and local verification exist; production credentials, deployment state, and real provider deliveries were not exercised in this review.

| Capability | Observed implementation | Remaining boundary |
| --- | --- | --- |
| Calendar UI and local persistence | Real views, schedules, date overrides, conflict flags, principal-scoped storage and cache | Live host storage/access still requires Test Lab verification |
| Google scheduling | Provider commit, live conflict checks, idempotency, recovery outbox, approval holds and resolutions | Real-account round trip was not performed |
| Public booking | Publication routes, availability, protected booking, management/rescheduling/cancellation, analytics | Deployment/secrets and real-provider execution were not checked |
| Shared booking | Multi-host Google availability/reservations and workspace authorization code plus tests | This was inspected at integration boundaries, not an exhaustive independent review of all collective-booking logic |
| Meeting locations | Google Meet and connected Zoom on the Google booking path | Other locations are rejected by the app's provider validation |
| Microsoft | OAuth and calendar discovery adapter | No equivalent Microsoft booking commit path established here |
| Public transactional email | Durable outbox, delivery worker, reconciliation and tests | Requires configured sender/secrets; unrelated to personal reminders |
| `list_events` | Implemented bounded read with principal scoping and redaction | Uses the host-storage mirror; can be stale |
| `summarize_day` | Separate aggregate-only MCP server and freshness checks | Same UI-maintained mirror dependency |
| `find_available_slots` | Schedule/override/buffer/notice/horizon logic and freshness checks | Cannot refresh itself; see finding 3 |
| `draft_meeting` | Validated JSON proposal with conflict warnings and no writes | No Calendar review handoff; see finding 5 |
| Workflow nodes | Four pure transforms, schemas, package exports and tests | No durable trigger source or automatic execution |
| Channel scheduler | Real contributed surface, participant adapter/fallback, provider-backed submit path | Requires usable host capability/grants and writable Google destination |
| Immediate system notification | Real SDK adapter and test button | No scheduled reminder consumer |
| TAP channel messages | Real guarded posting adapter | No application delivery callers |

The gateway also contains a separate `/mcp` implementation with a different argument contract and direct cache access. The shipped package declares package-runtime MCP; it does not wire that remote endpoint into the tools shown on this screen. The endpoint's stale “local-only” comment should not be taken as an access-control description: it currently routes through `principalScope` and `resolveOrganizerScope`.

## Verification results

| Check | Result |
| --- | --- |
| Miniapp unit tests | 260 passed, 26 files |
| Gateway tests in the Workers test environment | 187 passed, 18 files |
| Public-site unit tests | 40 passed, 7 files |
| Total automated tests that executed successfully | **487 passed** |
| Typecheck, all three packages | Passed |
| Miniapp host-test typecheck | Passed |
| Miniapp build | Passed, including desktop, QuickJS and workflow-host packaging |
| Gateway build | Passed, Wrangler dry run only |
| Public-site build | Passed |
| `tap-miniapp check` | Passed; package and single React runtime verified |
| TAP host-test discovery | 24 tests discovered |
| TAP host-test execution | **Blocked:** all 24 stopped at fixture setup because `TAP_MINIAPP_TEST_SESSION_FILE` was absent |
| Local browser inspection | Confirmed hard-coded availability, disabled builder, enabled reminder preferences, and incomplete shared-channel form |

The host suite's missing-session failure is an environment prerequisite failure, not 24 demonstrated application regressions. Conversely, typechecking or discovering those tests does not mean they passed. The checked-in host tests do not exercise a booking-to-workflow trigger or MCP-draft-to-Calendar handoff. Provider HTTP behavior is tested with fixtures/mocks, not real Google/Zoom accounts.

Local commands used: filtered `pnpm ... test` and `typecheck` for the three packages; Calendar `typecheck:tap`, `test:tap:list`, `test:tap`, `build`, and `validate:manifest`; gateway `build`; public-site `build`. Dependency installation used the frozen lockfile. Worker review also consulted the current [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and retrieved current published Workers types.

## Completion order

1. Correct the user-facing claims and remove inert controls; make unsupported reminders and channel delivery unmistakable.
2. Make specialist reads independent of the mounted UI and cover hidden conflict calendars.
3. Implement a governed draft handoff and actual channel bindings/delivery.
4. Add durable reminder and booking-event workflow execution, with retries and delivery/run history.
5. Run the 24 host tests in TAP Test Lab and add end-to-end acceptance cases for these disconnected paths before presenting them as complete.

This review adds only this report. The identified implementation gaps remain open.
