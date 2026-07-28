# Brainrot Tower Defense

A Rust/WASM cooperative tower-defense TAP miniapp. `wasm-pack --target bundler`
compiles the Rust workspace before Rsbuild creates the browser preview and Rslib
packages the desktop federated surface and lifecycle expose. Gameplay, DOM
input, the in-canvas HUD, rendering, audio, persistence, presence, lifecycle,
and host calls are authored in Rust/WASM. The small `.mjs` files are the required
federation, asset, host-authority, and MCP package-runtime adapters.

The app starts empty. Browser-preview records come only from user interaction
and use the distinct `tap-example.brainrot-td.preview.v1` local-storage key.
Packaged execution exclusively uses revision-checked TAP storage and never
falls back to browser storage. Channel sessions, player progression, audio
settings, command queues, presence, and durable game milestones use real TAP
capabilities declared in `manifest.tap.json`.
Session records carry a post-commit event outbox, so a host interruption between
state, acknowledgement, and package-event publication remains visibly
retryable instead of silently reporting success.
Every accepted gameplay command also appends a bounded authoritative
processed-command receipt containing its command ID, exact payload fingerprint,
and committed sequence. The fingerprint binds the schema, actor, expected
sequence, command variant, and every command field. A persisted queue
acknowledgement is not reported as synchronized until the stored session has a
receipt with the same fingerprint and sequence; command-ID reuse with a
substituted payload, a mismatched receipt, or a legacy unbound acknowledgement
remains visibly blocked rather than being treated as success.
Authoritative victories also append bounded, validated completion receipts with
stable run IDs and the active participant identities. Those receipts survive a
replay or next-level transition, while player-scoped high-water cursors consume
them exactly once; a delayed or reconnecting co-op client therefore cannot lose
progress merely because the host moved past the transient Victory frame.

## Content and state model

The featured enemy roster—Tralalero Tralala, Cappuccino Assassino, Tung Tung
Tung Sahur, Ballerina Cappuccina, Boneca Ambalabu, and La Vaca Saturno
Saturnita—is authored presentation metadata with card-faithful transparent
four-pose sprite adaptations. Those names are not seeded enemy records, storage
keys, or schema discriminators. Four vertically stacked 3-by-2 atlas pages map
those six presentations onto the generic `basic`, `fast`, `armored`, `swarm`,
`disruption`, and `boss` kinds without changing the stable gameplay schema.
Enemy state is created only at runtime when an authored wave spawns an enemy;
each instance receives a generic, stable entity ID and persists its validated
kind, lane, progress, health, and combat state. Presentation names can therefore
change without invalidating stored sessions or future schema migrations.
Normalized progress is sampled against cached deterministic cumulative route
lengths, so waypoint spacing cannot accelerate or stall an enemy. A versioned
movement metric migrates older active sessions without moving enemies to a
different physical point, while the canvas uses presentation-only subpixel
interpolation between authoritative fixed ticks. Intermediate frames resample
normalized route progress so sprites remain on authored bends; stale jumps,
lane changes, rewinds, and enemies first observed far along a route snap to the
authoritative point instead of cutting across the terrain.

Each presentation has four grounded poses. Physical route distance drives the
locomotion cadence, stable enemy IDs de-synchronize crowds, and real health
deltas trigger the reserved blade, bat, or stomp reaction poses. Per-character
wakes, streaks, stomps, sparkles, signal ripples, and orbit trails respect the
platform reduced-motion preference.

The animation-sheet source, deterministic atlas contract, and rights boundary
are recorded in `assets/sprites/featured-enemies/README.md`. The external card
files themselves are not stored in this repository.

Placed towers are explicit gameplay structures. The serialized schema names
that structure `DefenderState`; every tower has a runtime-generated stable ID,
owner, tower kind, map coordinates, targeting policy, upgrade path, and combat
state. Tower placement, selection, inspection, targeting, upgrade, move, and
sell controls live in the canvas HUD and playfield overlays rather than in a
detached management sidebar.

Every tower has two permanent upgrade branches with four authored purchases
per branch, progressing from level 1 through level 5. Each purchase has its own
name, effect, cost, and cumulative combat or economy behavior; the canvas
inspector shows both branches, the exact next tier, affordability, locked-path
state, and four-step progress. Level 4 and 5 stats also drive the renderer's
range, firing feedback, scale, and visible tier badge. Hard Refresh knockback
persists a recovery window on each enemy so multiple max-level towers cannot
pin even the slowest mob. Buffer Buddy tiers use deterministic whole-damage
increments so each low-base-damage purchase changes combat: Long Pause reaches
6/7/8/9 damage and Hard Refresh reaches 6/7/8/10 at levels 2–5. Plot Armor's
leak guard strengthens exactly 1→2→3→4, uses only the strongest deployed guard,
and always preserves at least one point of leak damage. Sell refunds saturate at
the resource ceiling instead of overflowing. While any authoritative action is
pending, upgrade purchases stay disabled with a visible synchronization reason
and are reevaluated against live authoritative resources before re-enabling.

Clearing a non-final wave grants exactly 40 resources to every active player
slot. The authoritative transition applies that payout once, excludes
spectators, and does not add it after the final wave; the in-canvas level panel
and wave-clear announcement expose the same authored amount.

The deterministic solo Final Feed economy deliberately does not make a
max-level Final Form passive: starting resources, all enemy rewards, and all
four wave-clear bonuses total 2,481, while either complete Final Form branch
costs 2,905 including the base tower. Side Hustler is available and affordable
at that level, making generator income or an explicit sell-and-reinvest choice
the authored route to the most expensive capstone.

Victory keeps the real-time game frame visible and places two accessible icon
controls directly beneath “Every wave cleared.” Replay atomically resets the
current level; Next atomically opens the next authored level without depending
on a possibly stale personal-progress save. Both are host-authoritative, expose
pending/authority/role failures, and the final-level Next icon remains visibly
disabled with an explanatory accessible name. Every federated mount also
refreshes the embedded game stylesheet, so a TAP remount cannot retain an older
style node that clips newly added canvas controls below the map.

## Build and verification

```sh
pnpm install --frozen-lockfile
python3 -m pip install -r scripts/requirements-assets.txt
python3 scripts/build-enemy-atlas.py
pnpm test
pnpm typecheck
pnpm typecheck:tap
pnpm test:tap:list
pnpm lint
pnpm format:check
pnpm validate:manifest
pnpm build
```

The build runs the Rust-to-WASM step before both browser and federated package
builds, then reports WASM and packaged-asset sizes. Those measurements are
informational diagnostics, not a quality budget or acceptance threshold: game
quality, route readability, art, and audio are not constrained by a byte cap.

Release `0.1.4` is declared in both `package.json` and `manifest.tap.json`. Its
native evidence is 144 passing tests: 23 content, 51 core, 5 protocol, 27
renderer, 34 web, and 4 TAP bridge tests. In addition to the complete economy,
upgrade, replay, and permission suite, this release locks School Hallway Rush to
its reviewed two-entrance map contract: both painted lanes converge on a shared
east corridor and terminate inside the visible server room. Renderer and core
tests cover both lane endpoints, compact scaling, monotonic final movement, and
leaks at the authored destination. Movement schema v2 migrates live v0/v1 School
enemies by physical position and is validated for direct upgrade and idempotent
reload. The broader suite also covers live defender-shop
affordability at every authored cost boundary, reverse transitions after an
authoritative debit, pending-action availability, active player-role checks,
the four-purchase level-5 upgrade tree, exact tier charges, flat-damage and
leak-guard tier semantics, saturating refunds, the deterministic Final Form
economy gate, exact-payload replay rejection, persisted-ack receipt
reconciliation, bounded high-tier mechanics, renderer/UI tier states, and the
active-player-only 40-resource non-final wave-clear payout. The optimized
browser and federated-package builds, manifest validation, UI-created
level-1-to-5 purchase run, production reload, 2048 px desktop layout, 390 px
compact layout, and clean browser warning/error log are recorded separately in
the requirements checklist so the native and live evidence remain explicit.

## SDK integration

The app now mounts its portable toolbar, runtime badge, TAP save status, and
browser-preview reset confirmation through
`@theaiplatform/miniapp-sdk/ui/wasm`. Rust owns the complete serializable UI
model and action reducer, rejects stale revisions and replayed event IDs, and
uses JSON-compatible WASM serialization at the SDK boundary. The legacy
hand-authored toolbar/reset DOM is removed; the gameplay canvas and domain UI
remain Rust-owned.

The requested read-only specialist game-state capability is now packaged as the
`brainrot-td-state-server` MCP server with the `get_game_state` tool. Its handler
executes in a dedicated QuickJS target, obtains the trusted canonical user and
nullable channel identities from `sdk.mcp.getExecutionContext()`, and reads only
the exact
`brainrot-td:mcp/users/{userId}/channels/{channelId}/current` address
preauthorized by the tool's `storageReads` contract. The webview uses the
host-canonical `context.userId` for both that projection key and the gameplay
player identifier. Until the host provides a display-name primitive supported
in channel panels, the gameplay session uses the bounded fallback `TAP player`;
host-stamped presence still identifies participants. It maintains the record as
a versioned, 256 KiB-capped projection without changing the primary
multi-session game storage. Entity lists use deterministic count and byte caps,
and the tool returns explicit truncation flags and full totals.
Missing user/channel context, stale-schema, cross-user, cross-channel,
malformed, or extra-field state fails closed. The QuickJS graph does not import
the browser/WASM runtime. The manifest, server-specific federation expose,
input/output schemas, exact storage selector, storage effects, and assembled
runtime closure are validated together during the build.
Surface Test Lab cannot yet invoke a package-runtime MCP expose as a
selected-specialist consumer. Because the descriptor matrix is scoped to UI
surface authority, it does not claim or waive `brainrot-td.read-state`;
deterministic storage-boundary tests and package-closure verification remain
explicitly non-end-to-end MCP evidence.

Only `brainrot-td.play` is required to project the game surface. The mounted
context's validated canonical `userId` is both the stable gameplay `PlayerId`
and the projection identity, so mount does not depend on a profile host action.
Milestones use the surface's declared durable package events. Channel-panel
surfaces do not expose `channels.sendMessage`, so the descriptor and runtime do
not request it. The Test Lab all-denied case is a synthetic post-projection
authority revocation: denying the required play action before projection would
prevent a production surface from mounting.

## Remaining platform and distribution blockers

The six featured-enemy pose sheets are image-generated adaptations guided by
third-party character cards. Their provenance and reviewed asset contract are
documented, but this repository has no written derivative or redistribution
grant for that source artwork. Public distribution therefore requires rights
clearance or replacement original art; the example does not claim ownership or
a permissive license for the referenced card graphics or character designs.

Finally, the webview mount and package-runtime MCP bridge now expose the same
host-canonical user identity alongside the host-stamped channel identity, but
TAP storage still cannot securely bind a cross-client game command to its
purported sender. Presence identity is host-stamped but presence state is
explicitly informative, not authoritative. The example uses CAS queues and
canonical simulation validation, but cannot securely implement command-sender
binding or disconnect-slot expiry without a platform-owned session/command
primitive. These boundaries are tracked in `docs/requirements-checklist.md`.
