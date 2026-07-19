# Unofficial Suno Player

An independent TAP example for privacy-reviewed conversation-to-song briefs and playback of user-owned audio. It is not endorsed, sponsored, or operated by Suno.

Direct Suno connectivity is deliberately absent pending provider authorization. The executable fallback is real and human-mediated: approve an exact prompt, copy it to an authorized account, generate under that account's terms, then import the owned result with provenance and a rights attestation. The application never calls Suno's private endpoints, replays browser credentials, scrapes the service, or reports an external generation as successful.

## Implemented workflow

- Empty, role-gated channel onboarding with no seeded records.
- Opt-in channel context, real channel notice and timeline reads, bounded source selection, manual summaries, optional real TAP specialist drafts, and mandatory privacy review.
- Versioned exact song briefs, duplicate-prompt protection, participant voting and title/mood/genre suggestions, manual-only candidate batches, and audited prompt export.
- User-selected audio import with local decoding, SHA-256 digest, rights/provenance metadata, brief/batch linkage, scoped visibility review, reactions, personal hides, retirement, and undo.
- A complete local player with persisted personal controls and seven audio-reactive visualizers. Raw audio and derived analysis never leave the device.
- Existing TAP workflow list/invoke support plus a content-addressed package workflow with a pure manual-brief checkpoint node.
- Host-managed HTTP and credential-vault capability discovery; only credential display metadata reaches the surface, and no provider request is attempted.
- Marketplace discovery categories, opt-in listening presence, revisioned storage, replay protection, lifecycle checkpoints, and visible failure/conflict states.

## Storage and identity boundaries

Packaged execution uses revisioned `sdk.storage`, scoped by TAP to the workspace/package, with channel state and per-user/device preferences in separate keys. Channel data is schema-versioned and currently migrates versions 1 and 2 to version 3. The UI rechecks channel access before loading protected state. Packaged execution never falls back to browser storage.

Browser preview uses records prefixed `tap-example-unofficial-suno-player-preview` in `localStorage` and a separately named IndexedDB media store. This separation is intentional and visible in the UI.

SDK 0.2.0 exposes JSON storage and write-only VFS, but no readable access-controlled binary artifact API. Packaged imported audio therefore remains playable only for the current surface session; retained metadata shows a truthful re-import requirement after reload. The package can now declare an ad hoc workflow, Marketplace categories, and host-mediated HTTP/credential readiness. The SDK still lacks recurring-schedule creation, global host playback/docking/current-channel subscription, durable shared listening sessions, message ineligibility/retention contracts, and Zephyr publication. Direct Suno connectivity additionally remains blocked by the missing provider authorization and supported connector. See [REQUIREMENTS.md](./REQUIREMENTS.md) for the verified checklist and exact blockers.

## Commands

From this directory:

```sh
pnpm install --filter @tap-examples/unofficial-suno-player... --frozen-lockfile
pnpm typecheck
pnpm test
pnpm validate:manifest
pnpm build
pnpm verify:package
pnpm dev
```

`pnpm build` produces the browser preview in `dist/` and a portable federated TAP package in `tap-package/` with desktop and workflow-host targets.
