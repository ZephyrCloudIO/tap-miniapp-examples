# Remote Browser example

This TAP miniapp launches durable `ze-workflows` browser snapshots and uses host-mediated, package-declared MCP tools for live Kitesurf sessions without receiving gateway, CDP, OAuth, or Browser Run secrets. Every runtime path is real-only: missing host capabilities, workflow output, gateway configuration, or evidence fail closed.

The package contributes two deliberately narrow surfaces from the same desktop expose:

- **Remote Browser Evidence** is a workspace-left, workspace-scoped surface. It only offers durable Capture controls and declares the saved-workflow and workflow-run actions/effects.
- **Remote Browser** is a chat-right, conversation-scoped surface. It opens a real Kitesurf session at a selected Desktop, Laptop, or Mobile resolution, refreshes its viewport through the signed screenshot tool, supports wheel scrolling, and selects remote elements as a selector, sanitized HTML, or an element-only PNG.

The shared React entry selects the experience from `context.contributionId`, so a surface cannot present a control for authority it did not declare. Each experience also shows feature-detected readiness for `workflows.runs.v1` and `mcpTools.v1`, including capabilities that belong on the other surface.

Three visual variants live on the preview route and are switchable with `?variant=A`, `?variant=B`, or `?variant=C` during development:

- **A — Mission control:** viewport-first, with a compact run timeline and evidence rail.
- **B — Evidence desk:** workflow outputs are the primary artifact and can be compared side-by-side.
- **C — Live browser:** a viewport-first surface for Kitesurf inspection and remote element selection.

The development preview can call a real Remote Browser gateway. Set the gateway origin and a valid preview token in the UI; the token is kept only until that browser tab closes. Without both values, capture fails visibly. Live sessions remain unavailable outside a TAP host because only the host may hold an opaque browser lease.

```bash
pnpm --filter @tap-examples/agent-browser-prototype dev
```

Package and governed-test verification:

```bash
pnpm --filter @tap-examples/agent-browser-prototype typecheck
pnpm --filter @tap-examples/agent-browser-prototype test
pnpm --filter @tap-examples/agent-browser-prototype verify:real-only
pnpm --filter @tap-examples/agent-browser-prototype build
pnpm --filter @tap-examples/agent-browser-prototype test:tap:list
pnpm verify:tap
```

## Integration paths

Packaged snapshots do not call the browser gateway. The operator loads and selects a saved workflow containing `universal.browser.snapshot`; Capture calls `sdk.workflows.invokeSaved` with only the allowlisted node inputs (`url`, the hard-coded `kitesurf` engine, `formats`, `waitUntil`, and `timeoutMs`). The miniapp then uses feature-detected `sdk.workflows.runs.v1.wait` and `output` to read the durable final result. The returned engine must be Kitesurf; there is no engine selector or silent substitution.

Screenshot bytes stay workflow-owned. When the host exposes `runs.v1.openArtifact`, the miniapp streams a bounded PNG, verifies its SHA-256 digest against the content-addressed descriptor before display, creates a temporary object URL, and revokes it on replacement or unmount. Inline PNG evidence is also signature-checked and limited to 10 MiB. Older hosts show the opaque durable artifact reference instead. An active run can be cancelled through the call-bound `runs.v1.cancel` action. Its once-consent declaration makes the action discoverable to the exact surface, while the host still requires a fresh decision for each call and never reuses that grant.

Evidence presentation is derived from the normalized response rather than a fixed channel list. Before a successful capture there are no format tabs or artifact cards. After capture, a channel appears only when its format was declared and its corresponding Kitesurf or workflow field was actually returned. Normal captures request screenshot, Markdown, accessibility-tree, and HTML content evidence. The UI preserves explicitly empty titles and text, uses returned format metadata, distinguishes Cloudflare browser time from workflow run duration, labels its timestamp as local receipt time, and keeps the previous capture intact if a replacement attempt fails.

Interactive sessions use `sdk.mcpTools.v1.callDeclaredTool`. The miniapp supplies only a signed tool-contribution ID and bounded JSON input. The host stamps the exact mounted package, release, surface, workspace, and human identity; resolves the server URL and upstream tool name from the active verified descriptor; rechecks the signed consumer policy and persisted grants; and keeps OAuth credentials outside the frame. If a call reports that OAuth is required, the UI offers **Connect Kitesurf** through `sdk.mcpTools.v1.authorizeDeclaredTool`; the host derives and opens the exact OAuth target without returning endpoint or credential coordinates to the frame. The selected resolution is validated by the gateway and applied with CDP device metrics before the first navigation, so responsive layout is stable for the session. The live viewport is a non-overlapping sequence of real `remote_browser_screenshot` calls against the same opaque session handle, not a locally manufactured stream. Wheel input is normalized, coalesced, fenced by control epoch and document revision, and followed by a fresh viewport capture.

The element picker follows the useful part of React Grab's interaction model without claiming page-owned source maps: choose Selector, HTML, or PNG, activate **Select element**, and click the rendered remote page. Object-fit letterboxing is excluded from hit testing. The click is sent as normalized visible-viewport coordinates to `remote_browser_select_element`, guarded by the current control epoch and document revision. The gateway resolves the real CDP node and returns a safe structural selector, sanitized bounded outer HTML, or a native MCP PNG image block. Navigation invalidates stale selections.

The mounted Remote Browser surface, specialists, and workflows receive a host-custodied MCP path to the same gateway. The packaged descriptor declares the local Streamable HTTP endpoint with OAuth and promotes exactly seventeen tools: start, share, join, room state, claim control, release control, leave, navigate, accessibility snapshot, viewport PNG screenshot, selected-element selector/HTML/PNG, redacted network calls, normalized diagnostics, click, fill, scroll, and close. The exact versioned `RB1…` value shown by the miniapp is also the canonical `remote_browser_join_session` input for Chloe, any other selected specialist, and workflows; the legacy structured handle/token form is a strict non-overlapping compatibility branch. One Durable Object owns one upstream Kitesurf browser; one agent and two human application sessions—even two sessions signed in as the same account—can join that room and observe the same browser and document revision. Only the exact current controller may navigate or send input. A bounded invitation admits a new participant, while a host-attested participant may resume its own prior room identity after its frame reloads without consuming another invitation or human slot. The signed consumer policy admits only this package's exact mounted Remote Browser and workflow contributions plus explicitly selected specialists (including Chloe) and workflows; the host rechecks that identity and remains deny-by-default. Observe permission covers room state, snapshot, screenshots, selected-element representations, network, and diagnostics; control permission covers starting, sharing, joining, controller handoff, navigating, clicking, filling, scrolling, leaving, and closing. A caller selects an element either through an opaque, document-bound handle or through bounded viewport coordinates for the visual picker; both paths are fenced to the expected control epoch and document revision. The gateway may return a selector for an explicitly selected element, but never accepts caller-authored selectors. Gateway credentials, Browser Run identifiers, raw CDP access, request headers, and request bodies remain host/gateway-owned.

The UI does not call generic `sdk.authorization.check` as a coarse preflight. Workflow and browser-session methods are the authoritative, call-bound policy boundary, and their failures are surfaced directly. This avoids applying a workspace grant to an unrelated conversation scope or presenting a stale preflight decision as authorization for a later consequential call.

Preview is deliberately different only in transport: it may call a configured gateway directly with a token kept only in the current tab. It does not generate screenshots, evidence, browser time, sessions, control state, or successful results. The packaged miniapp frame has no direct gateway access, HTTP credentials, or generic network authority; the declared MCP endpoint is connected and authenticated by the host.

Test recordings under `tests/fixtures` are available only to the governed TAP test runner and are not copied into `dist` or `.tap-build`. `verify:real-only` scans both authored runtime source trees and rejects simulation branches, locally manufactured sessions, generated screenshot data, and manufactured successful evidence. The build then scans the completed `.tap-build/desktop` package so unreachable or dependency-carried simulation code cannot ship unnoticed.

## Host and workflow prerequisites

- A saved workflow must route its manual input into `universal.browser.snapshot` and expose that node's output as the run's final output.
- The workflow host, not the miniapp, owns the Remote Browser gateway credential and artifact CAS.
- The installed Miniapp SDK/host must provide `workflows.runs.v1`; older hosts fail with an explicit capability message rather than falling back to direct HTTP.
- Rendering a screenshot requires `runs.v1.openArtifact`. Markdown, content, accessibility output, and the durable artifact reference remain usable without it.
- Live mode additionally requires the host-owned `mcpTools.v1.callDeclaredTool` bridge. A host without that exact-package bridge fails closed.
- Specialist/workflow browser tools additionally require the local Remote Browser gateway at `http://127.0.0.1:8787/mcp`, successful OAuth authorization, and an explicit host grant for the selected consumer. Plain HTTP is accepted only for an exact loopback endpoint; non-loopback MCP servers still require HTTPS.

Neither packaged UI surface has direct network authority. The live surface declares only the browser observe/control effects required by its signed tools; the host-owned MCP connection and gateway enforce the actual target policy. A runtime URL never creates authority by itself.
