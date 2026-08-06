# Kart Royale

**Status:** Approved concept; Phase 1 (miniapp conversion) implemented
**Audience:** Consumer
**Data approach:** TAP storage for player preferences; Cloudflare Durable Object session server for multiplayer races; channel presence for lobbies
**Implementation:** TypeScript + Three.js WebGL, vendored from [zackarychapple/kart-royale](https://github.com/zackarychapple/kart-royale) @ `036c0efb025f5ecf8fc31c405e9d818c61e03e21`

## Product idea

Kart Royale is a Mario-Kart-style circuit racer in which every mesh, texture,
and sound is generated in code at load time — there are no art assets. The
miniapp brings it into TAP channels: race solo against the AI field today, and
race other channel members in real time once the session server lands.

The miniapp demonstrates that TAP surfaces can host a full 3D game loop —
WebGL rendering, post-processing, synthesized audio, gamepad/keyboard/touch
input — alongside the platform's permission, persistence, and lifecycle model,
and that a channel can be a multiplayer game lobby.

## Current state (Phase 1)

- Vendored game converted from a full-page Vite app to a mountable,
  disposable component: `startKartRoyale(host)` boots into a scoped host
  element (`#app`/`#ui`/`#boot`), and `dispose()` unwinds the frame loop,
  listeners, renderer, and debug globals.
- Desktop federated surface (`./ui/desktop`) and lifecycle expose
  (`./tap/lifecycle`), packaged with the SDK `tapLib` rslib target and
  verified by the repo package policy.
- Channel-scoped surface (`chat-right`, `per-channel`) gated by the declared
  `kart-royale.play` permission; denial renders a truthful blocking notice
  and never boots the game.
- Player control preferences persist in TAP storage
  (`kart-royale:users/{userId}/control-prefs`), hydrated before boot so the
  game's synchronous `load()` contract survives; the browser preview keeps
  its wrapped localStorage backend.
- TAP pause/resume lifecycle maps onto the game loop's suspended flag and
  the audio context.
- Preview build deploys to Zephyr Cloud via `withZephyr()`; the vendored
  puppeteer harnesses run against `rsbuild dev`.
- Solo play (vs. the eight-slot AI field) works offline with no server.

## Current state (Phase 2)

- The circuit's pure mathematics are extracted into
  `src/world/TrackMath.ts` (no three.js): centreline sampling, cross-section
  profile, station lookup, surface probing, wall collision, heightfield,
  checkpoints, grid, and bounds. `Track.ts` is now the THREE-facing adapter,
  and a deleted-parity-harness run proved **bit-exact** equivalence with the
  upstream implementation across 400 samples, 1,680 probes, 720 wall
  collisions, the start grid, terrain heights, and bounds; a permanent
  adapter-consistency test (`src/world/TrackMath.test.ts`) guards the glue.
- `apps/kart-royale-server` (Worker + `RaceRoom` Durable Object) implements
  the multiplayer session server: room creation and join tickets
  (HMAC-SHA256, identity stamped server-side), roster and eight grid slots,
  host-only countdown start, kart-state relay, checkpoint claims validated
  against the shared TrackMath, finish placement and results, disconnect
  grace with slot reclaim, and host migration — all over hibernatable
  WebSockets, deployable with `wrangler deploy`.
- Identity seam: production resolves TAP platform sessions via
  `TAP_INTROSPECTION_URL` (Phase 0 open item; fails closed), while local dev
  and tests use an explicit dev identity compiled out by configuration.
- The vitest-pool-workers suite runs a real two-player race end to end —
  tickets, roster, countdown alarm, state relay, geometrically validated
  checkpoint accept/reject, finish placement, and disconnect/host migration.

## Current state (Phase 3)

- The miniapp now plays real multiplayer races in the browser preview:
  `src/net/` adds the client transport (`RaceClient` — REST + ticketed
  WebSocket), the `NetAdapter` implementing the `RaceNetHooks` seam in
  `Race.ts`, interpolation buffers (`RemoteKartBuffer`, 150 ms render delay
  with bounded extrapolation), the lobby overlay (`LobbyUI`), and the
  `MultiplayerSession` orchestrator. `Kart.stepRemote` poses network-owned
  karts (visuals only, no physics); remote karts are excluded from local
  progress validation, watchdogs, item boxes and projectile hits.
- The roster maps server slots to the grid one-to-one; humans at their
  slots, AI backfill elsewhere, simulated by the lobby host and streamed as
  `ai:<slot>` keys. Spectators get every kart as remote.
- The `RaceRoom` relays `kartKey` states; a new `ChannelRegistry` Durable
  Object lists open rooms per channel for lobby discovery
  (`GET /channels/:id/rooms`, kept current by the room itself).
- The packaged surface wires the same session with host-mediated REST
  (`tap.http` + `platform-session` credential) and declares the
  `external-network` effect; solo play never depends on the server.
- `tools/mp-smoke.mjs` proves the whole path live: two separate browser
  instances host/join through the lobby, ready-gate, start, and race —
  asserting both clients reach Racing, both see each other's kart move, the
  non-host sees host-simulated AI karts move, and zero page errors. (It also
  pinned down that a background tab suspends the loop by design, so the two
  clients must be separate browser instances.)
- Solo regression held: the vendored `autoplay.mjs` gate (full 3-lap race,
  all items, anti-cut, pause/restart) passes unchanged.

## Current state (Phase 4)

- **Server-arbitrated items.** Box pickups and spends by local karts are room
  requests (`item_draw`/`item_use`); the Durable Object rolls from the shared
  `ItemTables` curve with per-room seeded entropy, owns inventory and box
  state, and broadcasts `item_granted` / `item_used` / `box_down` / `box_up` /
  `box_sync`. Projectile hits against network-owned karts are detected on the
  shooter's client and relayed (`hit_claim` → `hit`) to the victim's client,
  which applies the effect to its own kart. Remote projectiles render as
  visual-only spawns. The bolt's hit-all is distributed: every client applies
  it to the karts it simulates. Wire state now carries spin/star/boost timers
  so remote hits render.
- **Reconnect polish.** A dropped socket re-tickets and rejoins with bounded
  backoff (1s/2s/4s); the room holds the slot for the grace period either way.
- **TAP integration.** Presence announces lobby state per channel;
  `race.started` / `race.finished` publish as durable channel events; the MCP
  `get_race_state` tool (QuickJS package-runtime target, Chloe's read-only
  window) reads a bounded, validated surface-written projection from TAP
  storage. The packaged build now assembles two targets (desktop webview +
  QuickJS) and passes the repo package policy.
- **Deployed.** The session server runs at
  `https://tap-kart-royale-server-production.zephyr-cloud-app-dev.workers.dev`
  (`wrangler deploy`, `TICKET_SECRET` set; `ALLOW_DEV_IDENTITY=false`, so
  production identity requires the Phase 0 platform-session introspection
  endpoint). The manifest's network effect names the exact origin, and the
  packaged client defaults to it (`KART_ROYALE_SERVER_URL` overrides at build).
- **Proof.** `tools/mp-smoke.mjs` now also drives a server-rolled item end to
  end: draw → grant → roulette arm → spend → the other client observes the
  remote projectile. The server suite covers draw/spend/hit arbitration,
  possession denial, and host-only AI draws.

### Phase 0 spikes (unchanged, still the production gate)

- WebGL in the packaged TAP webview; `wss:` CSP to the Worker origin.
- `TAP_INTROSPECTION_URL` — the platform endpoint the Worker introspects
  `platform-session` credentials against. Until it lands, production
  multiplayer fails closed and solo play is unaffected.

## Multiplayer plan (hybrid authority)

Channel members race together through a Cloudflare Worker + Durable Object
session server (one DO per race room), reached over a ticket-authenticated
WebSocket:

1. **Networking model — hybrid.** Each client simulates its own kart and
   streams compact state; remote players are `NetKart` implementations of the
   existing `IKart` contract (the renderer, HUD, and minimap already draw
   karts the local player does not control). The DO owns the *race rules*:
   roster, countdown clock, checkpoint/lap validation (the track's probe
   math is pure and shared with the server), placement, item draws, hit
   arbitration, and slot leases. Deterministic lockstep was ruled out — the
   game is variable-timestep with unseeded cosmetic randomness.
2. **Identity.** The surface calls the Worker through host-mediated
   `tap.http.request` with `credentialRef: "platform-session"`; the Worker
   validates the TAP session server-to-server and mints a short-lived ticket
   binding user + channel + race. This closes the "client-authored identity"
   gap documented by the brainrot example.
3. **Grid.** Eight slots; humans take roster slots in join order and the
   lobby-host client simulates AI backfill with the existing `AIField`.
4. **Solo mode stays.** Offline solo-vs-AI is both a feature and the
   degraded mode when the socket is unreachable.
5. **TAP keeps the durable record.** Presence carries lobby roster and
   ready state; durable package events post race milestones
   (created/started/finished) to the channel; TAP storage keeps preferences
   and (later) best laps and the channel's open-race index.

### Open verifications (Phase 0 spikes)

- WebGL in the packaged TAP webview (nothing in this repo has proven it yet;
  the game ships a context-loss recovery harness).
- Packaged-webview CSP allowing `wss:` to the Worker origin.
- A TAP platform session-introspection endpoint the Worker can verify.

## SDK version

This example pins `@theaiplatform/miniapp-sdk` `0.5.2` ahead of the
repo-wide bump; the root gate's `expectedSdkVersion` updates with that PR.

## Testing

- Unit tests cover the control-prefs backend contract, the TAP storage
  bridge (CAS conflicts, error classification), and the write-through
  persistence adapter.
- Schema-v2 Surface Test Lab coverage declares one desktop cell with
  positive (provenance, storage hydration) and all-denied (play-permission
  revocation fails closed) rows.
- The vendored harness suite in `tools/` (fps-bench, drift-bench, autoplay,
  context-loss, steer-test, …) runs against `rsbuild dev`; `tools/boot-smoke.mjs`
  proves a clean headless boot of the production preview build.
