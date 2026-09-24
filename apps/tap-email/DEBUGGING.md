# Debugging Email failures

Run `pnpm --filter @tap-examples/tap-email debug:local` from the repository root, then open the printed localhost URL. This builds a minified copy of the real Email UI with a synthetic mailbox and a local diagnostic storage fixture. It does not connect Gmail or use production mailbox data.

Email currently builds with published SDK 0.17.0, matching TAP 2.23.0. Updating the desktop app does not rebuild or replace a pinned Marketplace Email release. Check the installed package's SDK compatibility in **Miniapps → Installed → TAP Email**.

For native UI debugging, build the desktop-only package and load `apps/tap-email/dist-local-dev` through **Miniapps → Develop**. TAP 2.23.0 can refresh linked webview-only packages; it rejects refreshes of packages that include QuickJS. The local build omits the specialist and MCP tools and appears as **TAP Email (Local Dev)**. By default it connects to a local coordinator on port 8787. To reproduce against the production mailbox in the active TAP workspace, use:

```sh
TAP_EMAIL_COORDINATOR_ORIGIN=https://tap-email-coordinator.theaiplatform.app pnpm --filter @tap-examples/tap-email build:miniapp:local
```

This installs a separate local package with access granted through TAP. The full release package still builds to `.tap-package` with both desktop and QuickJS targets.

After the mailbox renders, use **Inject render failure** or **Inject rejected promise**. The recovery screen offers **Copy diagnostics**, **View diagnostic report**, and **Reload Email**. The parent page keeps saved reports visible outside the iframe. **Deny diagnostic storage** exercises the copyable fallback when persistence is unavailable. Failure controls are built only by `rsbuild.diagnostics.config.ts`; they are absent from production builds.

In TAP, Email stores the last five reports through the governed storage API at namespace `tap-email`, key `diagnostics/v1`. Reports contain the build revision, package/release/installation/instance identifiers, sanitized error and component stacks, and the last 40 lifecycle events. They do not capture mailbox snapshots, HTTP bodies, or credential objects. Error text is bounded and redacts URLs, email addresses, common credential patterns, and quoted values.

The recovery screen preserves the first fatal report even if teardown produces additional errors. A production reproduction on TAP 2.23.0 found `SecurityError: Cannot access an iframe before its host bootstrap commits.` when an HTML message loaded. Scriptless message frames cannot complete the host's script-based handshake. Email now treats denied document access as an opaque frame, uses native scrolling, and replaces the frame when its document changes. Scripts and direct network access inside messages remain disabled. Automatic sizing and forwarded keyboard shortcuts are available only when the host permits reading the message document.

Production builds extract hidden source maps into `.tap-diagnostics/desktop` and `.tap-diagnostics/quickjs` before TAP locks its public assets. `verify:package` checks that maps are absent from the runtime package and that each map's recorded SHA-256 matches the packaged JavaScript. CI retains the maps and package manifest as ordinary Actions artifacts for 30 days. The source repository is public, so the artifacts do not require encryption; keeping maps separate avoids increasing the installed package size.

To resolve a copied report to source lines, use maps from its exact build:

```sh
pnpm --filter @tap-examples/tap-email diagnostics:symbolicate /absolute/path/report.json /absolute/path/.tap-diagnostics/desktop
```

The local fixture writes `.tap-diagnostics/harness/reports.json`; pass that file and `.tap-diagnostics/harness` to the same command. Chunk filenames and build metadata identify the matching archive. Missing maps are reported explicitly.

The companion desktop/SDK change adds a host-owned diagnostic panel outside the iframe and captures global errors from the SDK bootstrap before package modules load. This requires a desktop build containing that change and an Email package built with the updated SDK. Email's own recovery and governed-storage reports also work on SDK 0.16.0. The local browser fixture verifies Email rendering/recovery; it does not substitute for a native TAP package/authority smoke test.
