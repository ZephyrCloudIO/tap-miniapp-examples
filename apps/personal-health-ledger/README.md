# Personal Health Ledger

A public TAP SDK 0.2.0 example organized around a private health journey: daily feeling check-ins, a unified longitudinal timeline, plans, observed administrations, supply, safety records, specialist research, and controlled sharing.

## Capability boundary

Packaged execution persists strictly validated schema-v4 JSON through host-scoped `sdk.storage` with optimistic revisions and v1/v2/v3 migration write-back. Browser preview uses a separate localStorage key and never acts as a packaged fallback. VFS export is enabled only when the host supplies both VFS and an active conversation. Administration CSV supports a validated, confirmation-gated round trip.

SDK 0.2.0 exposes managed specialists, tool-backed turns, package-runtime MCP servers, and host-governed HTTP. The assembled package now has independent desktop and QuickJS targets. The packaged Research surface installs a real Personal Health Researcher, creates a private TAP channel, prefers `xai/grok-latest`, invokes the workspace-approved model with `modelOverride: "auto"`, and persists the host-reported model and tool receipts. Its `draft_administration` MCP tool can prepare structured data but cannot access storage or commit a record; the desktop surface revalidates the result and requires confirmation before changing the ledger or inventory. Hosts using selected-specialist MCP grants require an operator to enable the tool for this package under Settings → Miniapps → Installed.

Manual official-source refreshes use host HTTP with an exact, approved canonical-name query against PubMed, ClinicalTrials.gov, and openFDA. Results are normalized, deduplicated, and stored with watchlist cursors and success/failure receipts. The current host specialist registry still lacks native `x_search`; direct voice input, protected attachment read/list, reviewed Knowledge Garden writes, recurring scheduling/inbound events, and revocable sharing also remain SDK/host gaps tracked in [ze-agency-tauri#6822](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/6822).

Run `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm validate:manifest` from this directory.
