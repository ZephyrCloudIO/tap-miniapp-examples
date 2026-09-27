# TAP Email SDK delta audit — 2026-09-27

## Decision

**Keep SDK 0.19.0: it is already the latest published version. Raise Email's minimum host to at least 2.24.1.** Email now has real inline inference, live remote MCP tools, a registered activity source and safer queued HTTP attribution. The September 20 statement that all AI merely stages a Chat prompt is obsolete. The workflow observation permission defect remains. A newly verified host limitation also rules out direct SQLite FTS5 through the current private-storage API.

This report distinguishes published SDK contracts, concrete host code, Email wiring and actual live verification. No live model, MCP credential, production install or send was exercised here.

## Exact evidence examined

| Component | Version/source checked |
| --- | --- |
| Email | `0.3.5`, checkout `f3fa6b493ecd757e48ff69eb4015352e7b1d142b`, 2026-09-27; [package](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/package.json), [manifest](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/manifest.tap.json). |
| SDK baseline | Published `0.16.0`, 2026-09-13 22:05:54.484Z. |
| Intermediate SDK | Published `0.17.0`, 2026-09-24 13:22:45.378Z. The registry contains no `0.18.0` release. |
| Current/pinned SDK | Published `0.19.0`, 2026-09-25 02:11:13.824Z; registry `latest=0.19.0`, canary `0.0.0-feat-miniapp-websocket-runtime.1`. |
| Host source | Read-only adjacent host checkout, commit `6204a7ef30b2eff63d7d47eefe0ec93588d592ef`, 2026-09-26. Inspected files were clean; no fetch/reset/modification performed. Its changelog includes host 2.24.1. |

Versions came from the [npm registry](https://registry.npmjs.org/@theaiplatform%2fminiapp-sdk). Compared the actual [0.16.0](https://registry.npmjs.org/@theaiplatform/miniapp-sdk/-/miniapp-sdk-0.16.0.tgz), [0.17.0](https://registry.npmjs.org/@theaiplatform/miniapp-sdk/-/miniapp-sdk-0.17.0.tgz), and [0.19.0](https://registry.npmjs.org/@theaiplatform/miniapp-sdk/-/miniapp-sdk-0.19.0.tgz) tarballs under `/tmp/tap-email-sdk-audit-2026-09-27/`. Distribution citations below refer to those immutable packages, with links to the versioned published SDK artifacts.

Also checked [official SDK docs](https://docs.theaiplatform.app/miniapps/reference/sdk.html), [upgrade guide](https://docs.theaiplatform.app/miniapps/upgrading.html) and [September 25 public host release notes](https://theaiplatform.app/changelog/2026-09-25). The public SDK page fetched by the web tool still showed older task vocabulary; published artifacts and current host implementation are the authoritative basis for the task delta below. Release notes are not proof that a user's installed host or production Email has upgraded.

## What changed in the SDK

### 0.16 → 0.17

- New `/activity` entrypoint with `defineActivitySource`, stable `activitySource` export, host-stamped user/workspace/source/consumer identity, exact time windows and bounded count/seconds aggregates. The published README and validator require **SDK >=0.17.0, host >=2.20.0** for `activity.source`. Actual host activity-source registration work is listed in the 2.22.0 changelog, so the validator's floor is not by itself live deployment evidence.
- Published Git, specialist-turn snapshot and optional VFS read APIs. These may matter to other miniapps; Email's core email/search needs do not require them.
- Inference, specialist-turn, private SQLite, embeddings and zvec public contracts remain substantively unchanged for this review. Their existence should not be presented as new 0.19 AI capabilities.

### 0.17 → 0.19

- `MiniAppHttpRequestOptions.expectedContext = { userId, workspaceId }` is new. For `platform-session`, native desktop rejects a request whose captured canonical context no longer equals the current session. It is an equality fence, not an identity selector, token getter or backend authorization replacement. See published [README](https://unpkg.com/@theaiplatform/miniapp-sdk@0.19.0/README.md), “Queued HTTP operations”; [type](https://unpkg.com/@theaiplatform/miniapp-sdk@0.19.0/dist/sdk.d.ts), lines 979–1031; and host [SDK documentation source](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/apps/documentation/docs/miniapps/reference/sdk.md#L578).
- Tasks changed materially: `status` became `phase`; `dueDate` became `dueAt`; creation uses `initialPhase`; task snapshots include `currentPhaseVisitId`, miniapp ownership and extensions. New explicit intents include `transitionPhase`, `archive`, `appendComment`, `recordImpact`, `setExtension`, `removeExtension`; old `delete` is gone. `createWithReceipt` now accepts **priority and dueAt in the initial receipt-backed mutation**. See [SDK types](https://unpkg.com/@theaiplatform/miniapp-sdk@0.19.0/dist/sdk.d.ts), lines 2157–2222 and 2979–3020.
- Inference still accepts text messages and returns unary text; no public response schema, tool definition or attachment argument. Specialist helpers still validate output after generation. The published `dist/sdk.js` file is byte-identical between 0.16.0 and 0.19.0 in the downloaded tarballs.
- Workflow namespace still has list/invokeSaved/getRun/subscribeRun, with optional inline `invoke` only in the type. The generated runtime does not install inline invoke, workflow creation or recurring scheduling. Home/plots remain reserved/uninstalled. Private SQLite/zvec API shapes do not add a corpus ingestion service, FTS5 admission, sparse vectors or collection enumeration/drop.

## Findings and implementation implications

### P1 — host floor admits a version that rejects this package's live MCP declaration

Email currently declares `tapHost: >=2.24.0` ([manifest](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/manifest.tap.json), line 31). Its live server declares `authentication: header-credentials` and the slot `tap-email-access-token`, injected as `X-TAP-Email-MCP-Token` (lines 1490–1548).

Host commit **`ff6fc5c1db34d909ca82b4ee49b21437e524cac6`**, PR [#11101](https://github.com/ZephyrCloudIO/ze-agency-tauri/pull/11101), explicitly fixes **2.24.0 rejecting Email 0.3.0** because it cannot bind those header credentials. It shipped in host **2.24.1**, per [host changelog](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/CHANGELOG.md#L3) and [ADR-0113](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/docs/adr/2026-09-25-package-mcp-header-credentials.md#L24). This is a host update requirement; another SDK bump is not the fix.

The commit's manual verification installed/rendered Email in a development host but explicitly did **not** create/bind an Email MCP credential or verify live authentication. Do not promote that evidence into a claim that production tools work.

**Implement:** raise minimum host to 2.24.1; validate the signed built artifact on that host. **Acceptance:** 2.24.0 is rejected before installation; 2.24.1 installs; token binding succeeds against the correct backend environment; an authorized read tool returns a real account/coverage response; replacement/revocation immediately prevents the old credential from authenticating.

### P1 — workflow observation permission bug survives the SDK bump

Email still declares **`workflows.runs.read`** in the surface, catalog and owner level ([manifest](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/manifest.tap.json), lines 613, 1362, 1470). Current host [action authorization](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/apps/desktop/src/lib/workspace-miniapp-host-actions.ts#L800) requires **`workflows.read`** for `tap.workflows.get-run`; the official docs agree.

Published 0.19 runtime `dist/rspack/index.js:5260` routes both getRun/subscribeRun to that host action. Its polling implementation at line 2822 still catches all rejected ticks silently and retries every two seconds. [Email](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-workflows.ts#L486) catches subscription setup errors, but polling denial happens after setup returned successfully. A real run can remain Accepted/Running without an observation failure. SDK bump did not fix the permission or behavior.

**Implement:** correct the action everywhere; preflight getRun or track observation health; render validated results; persist run identity for reopen. **Acceptance:** actual host grants allow terminal result retrieval; denial is visible; transient errors recover; revocation does not leave a forever-running UI; close/reopen resumes the existing run instead of duplicating it. Saved-workflow implementation/provisioning and recurring scheduling remain separate work.

### Inline AI writing is now implemented, with limited source grounding

[composer-services.ts:65](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/composer-services.ts#L65) calls `inference.send` with permission checks, a selected canonical model, conversation ID, bounded instructions/body, max tokens and timeout. [AiWriter](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/ai-writer.tsx) discovers models, shows a proposal, requires “Use draft” and rejects an answer cut short by the token limit. Body/subject edits make the proposal stale. This is substantive new product wiring, not just a Chat handoff.

Its scope is narrower than general email intelligence: the request contains **instructions, subject and current draft body**. It does not fetch original thread evidence, commitments, attachments or external facts. It returns only body text, so provenance and inference usage/cost metadata are discarded by the helper. Summarize/importance/commitment actions in `chloe-email.ts` still stage Chat prompts.

`useComposerServices` observes host owner changes, and both [compose-dialog.tsx:248](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/compose-dialog.tsx#L248) and [reply-composer.tsx:220](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/reply-composer.tsx#L220) key AiWriter by conversation ID. A conversation switch therefore remounts the writer and clears request/proposal state. An initial concern from inspecting AiWriter alone is mitigated by these call sites and is **not a confirmed product defect**. Keep regression coverage at the composed parent boundary so this protection is not accidentally lost.

**Implement:** preserve inference metadata for diagnostics/evaluation and hydrate explicit evidence plus the intended sender/recipient context for reply assistance. **Acceptance:** exercise the parent composer while switching conversations midflight and after completion; old output cannot apply and new generation remains possible; no auto-send occurs; unavailable/denied/model failure/length exhaustion have distinct outcomes. Existing writer tests cover body edits, while owner tracking has a separate hook test.

### Specialist execution is available, but still not invoked from Email's surface

No current production Email call uses `runSpecialist`, `useSpecialist`, `runTurnWithTools` or `streamTurnWithTools`. `specialists.invoke` remains in the catalog/owner level but absent from the Email surface's `onDemand` list. That is a missing contribution binding if an inline specialist turn is added; it does not prevent separately granted host Chat consumers from using MCP tools.

The declared specialist is now `tap-email-specialist@0.3.5`, with prompts supporting actual search/read/draft/send tools. The old “this specialist is content-free/read-only” conclusion is obsolete. The separately retained QuickJS tools still expose only projections.

**Implement:** choose whether a user action should use isolated inference or an actual declared specialist. For tool-based inline work bind `specialists.invoke`, use the versioned package specialist and render a validated evidence-bearing result. Channel-less turns still reuse a persistent room keyed by workspace/package/specialist, so they are not per-email isolation. **Acceptance:** missing grant/declaration/MCP readiness fail distinctly; prior thread context cannot silently override current evidence; model output cannot directly bypass normal reviewed action/receipt paths.

### Hosted MCP is a real new boundary, not local zvec access

Current package declares a Streamable HTTP endpoint and seven live tools: account listing, thread search, thread metadata, message reads, command receipts, draft saving and sending. [Coordinator MCP](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp.ts) implements them. [Credential code](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-auth.ts) issues a random 30-day token, stores its hash, scopes metadata/content reads and optional writes, and captures verified sender context for write authority. Replacement overwrites the one credential per profile; revocation deletes it. `/mcp` authenticates that scoped token separately from ordinary platform sessions ([router](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/index.ts#L2176)).

The host's 2.24.1 boundary stores user-entered header values in its OS keychain, bound to installation/server/member/workspace and signed security fingerprint; it injects them at the exact signed endpoint. Email's settings screen currently makes the user create a token and manually save it in installed MCP settings. There is no automatic renewal or public SDK secret-binding method in this contract. This is a legitimate supported path with onboarding work, not seamless automatic activation.

The backend's token knows the issuing profile and scopes, not independently verified per-invocation host user intent. Host consumer/tool grants and backend scoped credentials must both be tested. One token per profile also means replacing it for another workspace invalidates earlier bindings. The UI should expose enough status to explain that relationship. Live search operates over the coordinator read model; it does not magically search the local zvec collection.

**Acceptance:** missing/expired/revoked token, wrong profile/account, read-only token attempting write, sender-workspace mismatch, duplicate command/retry, uncertain send receipt, tool grant revocation, signed-endpoint change and reconnect after replacement. Verify at least one real authenticated read on a production-compatible host before calling setup complete.

### Activity sources now integrate with the host registry

The [manifest source](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/manifest.tap.json#L77) uses `/activity`, supports `self`, names Chloe/Email specialist consumers and declares `users/{userId}/activity/v1`. [Runtime](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/activity-source-runtime.ts) requires trusted user/workspace/self scope, rejects windows below 15 minutes, reads the user-scoped projection and returns counts by action/outcome with complete/partial coverage. That is actual integration beyond the older MCP-only aggregate tool.

It reports committed actions/views known to the installation; it is not an obligation graph, timer, background mailbox reader or evidence of active minutes. Registration doesn't guarantee freshness if the projection producer has not synchronized the latest receipts.

**Acceptance:** real host registry discovery/consumer authorization, user/workspace isolation, no content identifiers in results, unavailable projection remains unavailable, incomplete history is partial, duplicate receipt ingestion doesn't double count, and close/reopen behavior preserves accurate coverage.

### Private SQLite FTS5 is prohibited by the current host, not merely unverified

This corrects the September 20 research's weaker “verify FTS5 availability” statement. The current private-storage host [SQL authorizer](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/crates/zephyr-package-manager-tauri/src/profile_storage.rs#L1847) explicitly denies **CreateVtable and DropVtable**. Its SQL function allowlist omits `bm25`. Therefore an app cannot simply run `CREATE VIRTUAL TABLE ... USING fts5` or rely on FTS5 BM25 through this API, even if the embedded SQLite build contains FTS5.

The host also caps bind parameters at 999, query rows at 10,000, query bytes at 16 MiB and transaction leases at 120 seconds. Email's bounded batching/durable-replica work is aligned with those real constraints. SDK 0.19 does not remove them.

zvec still supports dense vectors, scalar inverted/FTS indexes, typed filters and a query FTS clause. The public query still requires a dense vector and there is no sparse-vector type or standalone lexical/BM25 method. RRF still fuses caller-provided ranks. No automatic chunking, complete-body indexing, deletion orchestration, account migration or corpus evaluation is supplied.

**Implement:** choose an app-owned lexical index over a canonical bounded corpus, or request a new host-owned bounded FTS capability. Do not base a delivery plan on unrestricted private SQLite FTS5. Preserve full-message/chunk provenance, independent corpus/index cursors and deletion propagation. **Acceptance:** measured lexical/semantic recall on complete-body fixtures, restrictive filters applied before top-k, deletion/rebuild tests, model-binding migration, large-mailbox resource budgets and honest partial coverage.

### New Tasks API can remove a current partial-write path and support follow-through

Email [task creation](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-task.ts#L277) adopted `initialPhase: 'inbox'` and `dueAt`, but still performs receipt-backed creation followed by a separate priority/due-date update. The 0.19 createWithReceipt contract now accepts both fields at creation, so this split is avoidable. Retrying the old two-step flow can also overwrite a task priority/date that someone changed after the first successful create.

**First change:** include priority/dueAt in the initial receipt-backed call. Preserve recovery for legacy receipts without replaying unrelated edits. **Acceptance:** lost response reuses the same receipt and task; initial priority/date are atomic; replay does not overwrite later human changes.

**Next product capability:** a reviewed email obligation can attach package-owned structured metadata, transition through canonical phases with `expectedCurrentPhaseVisitId`, receive comments and record outcome evidence. These require deliberate manifest additions: `task.read`, `task.comments.write`, `task.impact-observations.write`, `task.extensions.write`, and declared `task.type`/`task.attribute` schemas for extensions. Current Email only binds `task.write`; none of the richer coordination should be claimed yet. See [host permission mapping](https://github.com/ZephyrCloudIO/ze-agency-tauri/blob/6204a7ef30b2eff63d7d47eefe0ec93588d592ef/apps/desktop/src/lib/workspace-miniapp-host-actions.ts#L978).

## Recommended order

1. Correct host floor and workflow authority; prove a real MCP read on the intended host/backend combination. These are release credibility gates.
2. Ground AI replies in explicit thread/sender/recipient evidence; protect context transitions with integration tests; move task priority/date into atomic receipt creation; keep existing inference and SDK version.
3. Build retrieval/evidence coverage and a measured corpus; use the supported lexical strategy instead of assuming FTS5.
4. Add cited obligation extraction and explicit source revisions, then connect reviewed obligations to the richer Tasks lifecycle and outcome evidence.
5. Supply actual saved workflow definitions/results and a durable scheduler when recurring automation is intended. Activity sources and SDK polling are not schedulers.

There is no reason to chase an unpublished SDK upgrade for these changes. The current SDK has enough primitives to deliver meaningful email-to-work follow-through; remaining work is correct integration, an adequate corpus, supported host versions and end-to-end proof.
