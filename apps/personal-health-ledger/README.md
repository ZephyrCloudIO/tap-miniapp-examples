# Personal Health Ledger

A public TAP SDK 0.0.1 example organized around a private health journey: daily feeling check-ins, a unified longitudinal timeline, plans, observed administrations, supply, safety records, specialist research, and controlled sharing.

## Capability boundary

Packaged execution persists strictly validated schema-v3 JSON through host-scoped `sdk.storage` with optimistic revisions and v1/v2 migration write-back. Browser preview uses a separate localStorage key and never acts as a packaged fallback. VFS export is enabled only when the host supplies both VFS and an active conversation. Administration CSV supports a validated, confirmation-gated round trip.

SDK 0.0.1 exposes managed specialists and tool-backed turns. The packaged Research surface therefore installs a real Personal Health Researcher, creates a private TAP channel, prefers `xai/grok-latest`, invokes the workspace-approved model with `modelOverride: "auto"`, and persists the host-reported model and tool receipts. Every turn requires explicit approval of a visible, minimum-necessary private-context boundary. Browser preview cannot invoke host capabilities and never substitutes a simulated response.

The current host specialist registry exposes `web_search` and `web_fetch`, but not native `x_search`. Anecdotal-pulse prompts can use indexed `site:x.com` web discovery and must disclose that boundary. SDK 0.0.1 still has no source-specific NCBI, ClinicalTrials.gov, FDA/openFDA connector contract, general protected attachment read/list contract, or reminder/notification API, so those capabilities are not simulated.

Run `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm validate:manifest` from this directory.
