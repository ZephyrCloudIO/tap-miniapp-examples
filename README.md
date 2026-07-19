# TAP Miniapp Examples

Public-facing example applications that demonstrate what developers can build with the TAP miniapp SDK and platform.

## Workspace

This repository is a [Turborepo](https://turbo.build/repo) monorepo managed with pnpm. Miniapps live under `apps/` and can provide the standard `dev`, `build`, `typecheck`, `test`, and `clean` scripts consumed by the root task pipeline.

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```

Target a single example with pnpm's workspace filter, such as `pnpm --filter @tap-examples/family-task-board dev`.

## SDK baseline

All example apps created in this repository must exact-pin:

```json
"@theaiplatform/miniapp-sdk": "0.2.0-pr.6821.02b36a6"
```

Their TAP descriptors must likewise declare `compatibility.tapSdk` as `0.2.0-pr.6821.02b36a6`. Do not copy an older SDK pin from a reference repository.

Each example has its own product brief under [`miniapps`](./miniapps). The briefs are ordered for refinement; their status indicates whether the concept has been approved or remains proposed.

| # | Miniapp | Audience | Data approach | Status |
|---:|---|---|---|---|
| 1 | [Family Task Board](./miniapps/01-family-task-board.md) | Consumer | Application API plus platform capabilities | Approved |
| 2 | [Brainrot Tower Defense](./miniapps/02-brainrot-tower-defense.md) | Consumer | Rust/WASM multiplayer using channel presence | Approved |
| 3 | [Vanta Companion](./miniapps/03-vanta-companion.md) | Enterprise | Vanta API/MCP plus TAP knowledge and orchestration | Approved |
| 4 | [Pyre](./miniapps/04-pyre.md) | Enterprise | TAP knowledge, evidence, specialists, and workflows | Approved |
| 5 | [Unofficial Suno Player](./miniapps/05-unofficial-suno-player.md) | Consumer | Suno playback/generation plus channel workflows | Approved concept; provider-gated |
| 6 | [Personal Health Ledger](./miniapps/06-personal-health-ledger.md) | Consumer | Private health records plus research and safety APIs | Approved |

## Local references

Existing TAP and miniapp source repositories may be kept locally for implementation research, but are excluded from this repository. This includes `tap-miniapps`, `tap-miniapps-labs`, `kent-courses`, and `ze-agency-tauri`. The `reference-repos` directory is also ignored for future reference checkouts.
