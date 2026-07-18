# Brainrot Tower Defense requirements checklist

This checklist is derived from `miniapps/02-brainrot-tower-defense.md` and the
production acceptance requirements. `[x]` means implemented in executable code;
`[ ]` means blocked or awaiting final verification. Evidence paths are relative
to this miniapp.

## Architecture and packaging

- [x] Cargo workspace split into `game-core`, `game-content`, `game-protocol`,
  `game-renderer`, `game-web`, and `tap-bridge`.
- [x] Browser-independent deterministic simulation with typed IDs, enums,
  validation, serialization, fixed ticks, seeded variation, and replay guards.
- [x] Rust release build uses LTO, one codegen unit, aborting panics, and
  `wasm-opt`; WASM is built before Rsbuild/Rslib.
- [x] SDK dependency and `compatibility.tapSdk` are exactly `0.0.1`.
- [x] Desktop federated surface and lifecycle expose are packaged.
- [x] Hand-authored application/gameplay code is Rust/WASM; the small `.mjs`
  files are the unavoidable Rslib federation, asset, appearance, and authority
  adapters.
- [x] Browser preview storage is separate; packaged mode has no browser-storage
  fallback.
- [ ] SDK React UI components — blocked because SDK 0.0.1 has no Rust/custom
  element bindings and the brief forbids a handwritten JS/TS application layer.

## Empty start, data, and persistence

- [x] Empty onboarding state; no domain fixtures or seeded sessions.
- [x] Stable scoped IDs: packaged players use TAP identity, preview players use
  runtime-generated IDs, and user-created sessions, commands, placed towers
  (`DefenderState`), and spawned enemies receive runtime-generated IDs. Enemy
  IDs remain generic and do not embed mutable presentation names, preserving
  schema and migration safety.
- [x] Channel-scoped session index and per-session CAS documents.
- [x] Player-scoped versioned progression and audio settings.
- [x] Versioned command queues with acknowledgements, duplicate protection,
  conflict handling, timeout visibility, and explicit reload reconciliation.
  Every accepted command atomically persists a bounded receipt containing its
  ID, exact length-delimited payload fingerprint, and committed sequence. The
  fingerprint binds schema, actor, expected sequence, command variant, and all
  variant fields. Persisted acknowledgements count as synchronized only after a
  matching authoritative session receipt is loaded; substituted payloads,
  receipt/sequence mismatches, missing receipts, and legacy unbound
  acknowledgements stay visibly blocked instead of becoming simulated success.
- [x] Lifecycle checkpoint is a small validated pointer to authoritative TAP
  state and is restorable after pause/resume.
- [x] Durable post-commit event outbox is stored inside each authoritative
  session; stable event delivery IDs and idempotent channel message IDs support
  retry after ACK, publish, or host interruption.
- [x] Victory appends a bounded, validated completion receipt with a canonical
  session/attempt run ID, authored level/health/score facts, and participants
  proven against a durable participant-history boundary. Receipts and
  player-scoped high-water cursors use additive defaulted serialization,
  survive replay/advance/reload, merge monotonically, and let delayed co-op
  clients claim progression exactly once after missing the Victory frame.
- [x] Visible loading, saving, saved, pending, conflict, success, empty, and
  failure states.
- [x] Destructive leave/sell/reset operations require confirmation.

## Game loop and content

The featured enemy roster is authored static presentation metadata:
Tralalero Tralala, Cappuccino Assassino, Tung Tung Tung Sahur, Ballerina
Cappuccina, Boneca Ambalabu, and La Vaca Saturno Saturnita. Those names and
their card-faithful transparent four-pose sprite adaptations map onto the
existing stable enemy-kind IDs rather than becoming hardcoded records. Every
one of the four vertically stacked 3-by-2 atlas pages keeps the same validated
kind order and is rebuilt from reviewed 2-by-2 alpha animation sheets using one
shared scale and ground baseline per character. Connected-alpha isolation
preserves pose elements that cross a quadrant guide without importing a
neighboring pose or detached motion debris. Enemy instances and their state
are created by the authoritative runtime only when waves spawn them.

- [x] Create/discover/join/watch/leave/ready/start/pause/resume/restart flows,
  plus atomic host-only Replay and authored next-level continuation from
  Victory.
- [x] Canonical placement, target policy, upgrade, sell, and between-wave or
  in-wave move validation.
- [x] One to four player slots, shared objective/build area, per-player economy,
  ownership attribution, graceful-leave host migration, and abandoned-session
  index cleanup.
- [x] Five original handcrafted levels, five waves each, authored routes,
  build pads, modifiers, resources, base health, unlocks, and score thresholds.
- [x] Authored one/two/three/four-player variants change play-space parameters,
  routes/entrances, build slots, cadence/count, resources, pressure, and boss
  phases; deterministic native simulation covers every level, wave, and player
  count combination.
- [x] Six original tower definitions and six enemy families. Each placed tower
  is an explicit, serialized `DefenderState` structure rather than a decorative
  canvas marker.
- [x] Two mechanically distinct, branch-committed upgrade paths per tower,
  with four individually authored purchases per branch (levels 2–5), exact
  tier pricing/effects, persisted max-level state, renderer feedback through
  level 5, and in-canvas branch/progress/affordability controls. Any pending
  authoritative action disables upgrade purchases with an accessible reason;
  live authoritative resources and pending state are reconciled before the
  controls re-enable.
- [x] Low-base-damage Buffer Buddy tiers use whole-damage growth rather than
  rounded percentage no-ops: Long Pause produces 5→6→7→8→9 damage and Hard
  Refresh produces 5→6→7→8→10 across levels 1–5. Plot Armor guard strength is
  exactly 1→2→3→4 across levels 2–5; only the strongest deployed guard applies
  and at least one point of every leak remains. Max-level sell refunds use
  saturating arithmetic, including at the `u32` resource ceiling.
- [x] Every non-final wave clear grants exactly 40 resources once to each
  active player slot. Spectators receive no payout, the terminal Victory
  transition adds no wave-clear bonus, and the level panel and accessible
  status announcement expose the same authoritative amount.
- [x] Final Form's solo capstone is a deterministic economy choice rather than
  a passive unlock. Final Feed starting resources, all authored enemy rewards,
  and four non-final wave bonuses total 2,481; either max Final Form branch
  costs 2,905 including the base. The available, initially affordable Side
  Hustler generator supplies a real income path, alongside sell-and-reinvest.
- [x] Armor, slow, splash, pierce, disruption, income, boss phases, scoring,
  stars, best scores, defender unlocks, prior-level unlocks, cooperative
  completion, contribution, stable per-attempt run IDs, bounded high-water
  cursors, and replay protection. Immediate continuation is authorized by the
  completed authoritative run rather than a possibly stale progress save.
- [x] Original generated map/tower art, card-faithful four-pose featured-enemy
  sprite adaptations, animated Rust canvas renderer, target and status
  feedback, dark mode, and reduced motion.
- [x] Every enemy lane uses a dense, bounded, non-self-intersecting centerline
  aligned to its painted trail. Full segment validation rejects crossings,
  overlaps, non-adjacent touches, cross-lane intersections before the shared
  merge suffix, and build-pad incursions. Backyard Wi-Fi has one canonical
  mailbox-to-shed route at every player count, and its 54-point centerline
  was visually cross-checked against the single painted gravel path. School
  Hallway Rush keeps its two distinct left-side entrances, follows the upper
  and lower painted corridors, converges at the reviewed east-side T-junction,
  and shares a five-point final tail into the visible server-room threshold at
  logical `(1000, 250)`. The retired router cart is no longer presented as an
  interior objective. Normal
  play intentionally renders no route strokes, chevrons, or START/CORE debug
  labels. Cached deterministic 1/1024-pixel cumulative arc-length metrics make
  equal progress cover equal trail distance regardless of waypoint spacing;
  render-only stable-ID interpolation resamples intermediate route progress,
  rather than drawing straight coordinate chords across bends, and supplies
  smooth frames between fixed authoritative ticks without feeding presentation
  state back into gameplay. Lane changes, rewinds, stale jumps, and enemies
  first observed far from an entrance snap to authoritative positions instead
  of sweeping across off-trail terrain.
- [x] Backyard Wi-Fi's nine stone pedestal centers are an authored content/art
  contract confirmed against the final raster. Placement controls, selection
  hotspots, defender shadows, and per-defender atlas anchors register on the
  same logical coordinate; the build validates map/tower/enemy asset dimensions.
  It also validates exact reviewed digests for the authored Backyard and School
  PNGs, both runtime-packaged WebPs, all six enemy animation sheets, and the derived
  four-frame atlas; empty or duplicate source poses cannot pass validation.
  Legacy saves migrate old pad indices, the removed level-one second lane, and
  segment-index enemy progress before validation. A persisted movement-version
  marker makes that migration idempotent and preserves each active enemy's
  physical trail position. Movement schema v2 additionally retains both legacy
  School polylines, resolves v0 segment-index and v1 arc-length positions on the
  retired geometry, and projects live enemies onto the matching redrawn lane
  exactly once; terminal enemies remain terminal. The authoritative host
  re-persists the result,
  including after lifecycle checkpoint restoration.
- [x] Active-match controls are an in-canvas game HUD: stats, level, squad,
  tower shop, playfield selection hotspots, tower inspector/management, audio,
  match actions, and accessible build-pad buttons occupy reserved top/bottom
  rails inside the game frame. The map plane remains unobstructed at its mailbox
  entrance, shed objective, and every pedestal on desktop and compact layouts.
  Opening a compact HUD panel expands a temporary in-frame safe bay and moves
  the map below it; measured panel-to-map separation is 4 px with zero overlap,
  and every menu trigger remains topmost and directly clickable. The compact
  defender inspector uses a two-row safe bay: all controls are simultaneously
  visible, with zero map or internal horizontal overlap.
- [x] Victory renders two keyboard-accessible circular icon controls inside the
  map plane directly below “Every wave cleared”: Replay resets the same level
  and Next advances atomically. The former bottom-right Victory action is gone;
  both icons remain visible with truthful host/pending/authority disabled
  reasons, final-level Next is disabled, and 390 px compact targets remain at
  least 48 px without covering the result copy. Federated mounts upsert the
  embedded stylesheet, preventing an older document-level style node from
  leaving these controls in clipped normal flow after a TAP remount or upgrade.
- [x] Gesture-gated synthesized original cues and level ambience with persisted
  master/music/effects/mute controls and lifecycle suspension.

## Multiplayer and TAP capabilities

- [x] Multiple independent games per channel with conflict-safe index merge.
- [x] CAS-sequenced commands, canonical host simulation, acknowledgements,
  snapshots, polling, spectators, and host migration. Processed-command
  receipts bind accepted IDs to exact fingerprints and sequences, so a replay
  with a substituted payload is rejected and a persisted acknowledgement is
  reconciled only against matching authoritative state.
- [x] Bounded completion receipts and per-player cursors preserve exactly-once
  score/star/unlock/co-op awards when a polling client reconnects after the host
  has already replayed or advanced beyond the transient Victory snapshot.
- [x] Typed TAP presence join/update/subscribe/leave with host-stamped participant
  display names, hosting/view/ready/exact-placement state, recent activity, and
  live canvas cursors.
- [x] Required TAP events publish only after authoritative persistence and are
  retained in the session outbox until event and activity-card delivery succeed.
- [x] Compact idempotent channel milestone cards use real
  `channels.sendMessage`.
- [ ] Incremental spectator simulation event stream — the installed SDK can
  publish package events, but it provides no authoritative sender-bound game
  transport; the executable uses validated CAS snapshots and polling rather
  than pretending the event stream is authoritative.
- [ ] Literally unlimited spectators — validated storage/presence records are
  capped at 512 participants for bounded parsing and rendering; four active
  player slots remain enforced.
- [ ] Secure command-sender binding, authoritative reconnect, and timed slot
  expiry/disconnect-driven host migration — blocked because SDK 0.0.1 exposes
  no platform-owned session command or reconnect-lease primitive and storage
  records contain client-authored identity.
- [ ] Read-only Chloe game-state tool — omitted because SDK 0.0.1 exposes no
  public runtime tool-registration API.

## Quality and verification

- [x] Responsive desktop/compact layout, semantic landmarks/headings, labels,
  focus restoration, exclusive HUD panels, live core/wave announcements, skip
  link, wrap-safe alerts, 44 px compact touch targets, token-based dark mode,
  and reduced motion. Live 390 px and 320 px checks found no undersized visible
  controls, no toolbar/menu collision, and no horizontal page overflow.
- [x] Native tests cover empty/default state, creation/validation,
  serialization, progression, permissions, transitions, replay, conflicts,
  combat, targeting, upgrades, economy, scoring, scaling, host migration,
  spectators, multiple games, content invariants, atomic next-level reset,
  stale-progress continuation, final-level/role/state rejection, command
  replay and payload substitution, processed-command receipt validation,
  persisted-ack reconciliation, completion-receipt migration/serialization,
  delayed participant catch-up, cursor rotation, and bounded merge safety.
- [x] The final native suite contains 141 passing tests: 23 content, 51 core,
  4 protocol-contract, 27 renderer, 32 web lifecycle/UI helper, and 4 typed TAP
  bridge tests. Upgrade coverage includes all four authored costs,
  branch commitment, insufficient resources, duplicate/stale replay, reload at
  level 5, invalid level/path combinations, control recovery, strongest-only
  leak guard stacking, exact Buffer/Plot Armor tiers, saturating sell, the Final
  Form economy gate, pending-action disabled controls, and level-aware
  renderer/UI states. Protocol/web coverage proves exact command fingerprints,
  substituted-payload rejection, legacy-unbound safety, and persisted-ack
  reconciliation. Core coverage also proves the 40-resource non-final
  wave-clear payout is active-player-scoped, omitted for spectators and
  Victory, and applied exactly once.
- [x] Property tests cover arbitrary seeds/tick counts; deterministic simulation
  matrix covers every level × wave × player-count variant.
- [x] Presence bridge validation, durable outbox replay, concurrent progression
  merge, and channel-index merge tests.
- [x] Content validation is a mandatory browser/federated build step.
- [ ] Automated browser harness for input, renderer startup, audio, lifecycle,
  presence, and restoration — live browser interaction exists, but the brief's
  automated browser suite is not implemented.
- [x] The product owner explicitly waived byte and frame-time budgets in favor
  of game quality. Bundle-size measurements remain informational diagnostics;
  live consecutive-frame verification confirms the animation loop advances,
  but no performance threshold is claimed.
- [x] Final frozen dependency install, typecheck, full native test suite, strict
  Clippy, formatting check, browser build, Rslib federated package build,
  manifest validation, and informational bundle-size reporting pass.
- [x] Fresh live interaction against the final visual/gameplay build resumed a session
  originally created through the functioning onboarding UI, moved a tower to a
  far-right painted pedestal, reloaded, and restored the same health, score,
  resources, three towers, and moved-pad position. It then launched waves and
  captured canonical enemies spawning at the mailbox, traversing the painted
  gravel bends, and approaching the garden shed. A second fresh browser-preview
  origin captured the empty onboarding state without injecting records.
  Desktop, compact, opened-panel, placement, wave, inspector, and persistence
  captures are in `../../screenshots/brainrot-td-safe-*.png` plus
  `../../screenshots/brainrot-td-empty.png`. Live geometry checks show zero
  compact menu/map and inspector/map overlap, no undersized visible compact
  targets, no horizontal page overflow, no START/CORE labels, and an empty
  browser console log.
- [x] The subsequent TAP-only focus/authority hardening was compiled into the
  final package and re-opened live: compact Level/Sound panels, the complete
  two-row defender inspector, the 320 px layout, empty onboarding, and persisted
  defeat/reload state were reverified with clean browser logs. The route,
  renderer, content, and desktop layout did not change after the recorded
  mailbox/mid-route/shed frames.
- [x] The final movement pass replaced segment-count interpolation with cached
  deterministic arc-length sampling, added subpixel stable-ID rendering at the
  browser animation cadence, accumulated delayed fixed ticks with bounded
  catch-up, and reset visual/simulation clocks across lifecycle and authority
  pauses. Tests cover unequal segments, non-stalling precise samples, old-save
  migration, safe boss lane projection, interpolation endpoints/spawns/lane
  changes, route-aware bend sampling, stale gaps, late observations, delayed
  clocks, and pause resets. A fresh UI-created run placed no
  injected records, launched a full wave, showed all eight enemies following
  the gravel path, captured distinct consecutive in-between-tick frames, and
  restored Wave 1 / 12 core health after a full page reload. Evidence is
  `../../screenshots/brainrot-td-velocity-live.png`; browser warnings/errors
  were empty.
- [x] The final sprite-animation pass rebuilt all six featured enemies as four
  grounded poses, ties gait to physical route distance, de-synchronizes crowds
  by stable entity ID, and reserves the most dramatic Cappuccino, Tung, and La
  Vaca frames for real health-loss reactions. A fresh live restart placed four
  towers through the canvas, completed Waves 1 and 2, and exercised Tralalero,
  Cappuccino, and Tung pose changes plus real projectile, slow, hit-flash, and
  character-effect feedback in Wave 3. Consecutive evidence is in
  `../../screenshots/brainrot-td-animated-combat-final-*.png`,
  `../../screenshots/brainrot-td-hit-reaction-final-*.png`, and
  `../../screenshots/brainrot-td-wave3-*-animation-final-*.png`. Reload restored
  the UI-created paused Wave 3 state with 14 core health, score 2320, 177
  resources, and all four towers. The 390 px compact layout had no horizontal
  overflow, and final browser warning/error logs were empty.
- [x] The Victory-action pass was exercised entirely through the live UI. A
  user-created run completed all five waves, exposed centered Replay/Next icons,
  and was captured at 2048 px desktop and 390 px compact widths. Replay returned
  Backyard Wi-Fi to a fresh Lobby and persisted across reload; a second
  UI-played victory used Next to open School Hallway Rush as a fresh Lobby, and
  that selected level, health, resources, score, and empty field persisted
  across reload. Browser warning/error logs were empty. Evidence:
  `../../screenshots/brainrot-td-victory-actions-stage.png`,
  `../../screenshots/brainrot-td-victory-actions-compact.png`,
  `../../screenshots/brainrot-td-victory-next-level.png`, and
  `../../screenshots/brainrot-td-victory-next-level-reloaded.png`.
- [x] Release 0.1.1 hardens federated remounts against stale document-level CSS.
  A fresh UI-created School Hallway Rush run completed all five waves, then
  opened the Level panel at Victory. Replay and Next remained 60×60 px, inside
  the map, absolutely positioned, and directly hit-testable; clicking Next
  authoritatively opened Food Court Frenzy at Wave 0, and a full reload restored
  that Lobby. Browser warning/error logs were empty. Evidence:
  `../../screenshots/brainrot-td-next-visible-level-open.png`.
- [x] Release 0.1.2 metadata is exact in `package.json` and `manifest.tap.json`,
  and its 130-test native suite verifies the four-purchase level-5 upgrade tree,
  authored costs and high-tier mechanics, exact Buffer/Plot Armor tier effects,
  saturating refunds, the deterministic Final Form generator/economy gate,
  pending upgrade state, exact-payload replay substitution rejection,
  persisted-ack receipt reconciliation, persisted/replay-safe max-level towers,
  level-aware renderer/UI states, and the exactly-once 40-resource active-player
  bonus after non-final waves.
- [x] Release 0.1.2 browser production build, Rslib federated package build,
  manifest validation, and package-size report pass after the progression,
  economy, and replay-hardening changes (733,540-byte optimized WASM;
  9,007,842 packaged static-asset bytes). A fresh UI-created Backyard Wi-Fi run
  placed Zip Zapper and Caps Lock through the canvas, purchased Fast Cache,
  Fiber Link, Zero Latency, and Ludicrous Speed through the live inspector,
  observed a disabled purchase become enabled during an active wave, reached
  Level 5/5 and Victory, then restored that exact max-level tower, branch,
  health, score, and resources from the production build after a full reload.
  The 2048 px desktop and 390 px compact layouts had no page or inspector
  horizontal overflow, and browser warning/error logs were empty. Evidence:
  `../../screenshots/brainrot-td-upgrades-level5-reloaded.png` and
  `../../screenshots/brainrot-td-upgrades-level5-compact.png`.
- [x] Release 0.1.3 derives the HUD resource counter, defender-shop
  affordability, open-pad availability, active member role, TAP authority, and
  pending-action state from the same authoritative snapshot on every live
  tick. The 133-test native suite covers 89/90/109/110/139/140/171 resource
  boundaries, authoritative debits, pending synchronization, unavailable
  statuses, zero pads, and Host/Player versus Spectator/Disconnected roles. The
  optimized browser and Rslib federated-package builds pass (735,989-byte WASM;
  9,010,291 packaged static-asset bytes). In the production browser build, a
  UI-created run spent from 375 to 35 resources, reached exactly 139 with Caps
  Lock still unavailable, then crossed the 140 threshold during `Running`.
  Without Pause/Resume, the stable shop control changed from `unaffordable`
  with native/ARIA disabled attributes to `ready` with both removed. Selecting
  and placing it charged the authoritative 140 cost and re-disabled the offer
  at 119. A full reload restored Wave 2, 17 health, 119 resources, and all four
  placed towers; another running wave repeated the live enable transition.
  The 2048×1152 desktop and 390×844 compact captures are overflow-free, and
  browser warning/error logs are empty. Evidence:
  `../../screenshots/brainrot-td-live-shop-ready-running-0.1.3.jpg`,
  `../../screenshots/brainrot-td-live-shop-sync-reloaded-0.1.3.jpg`, and
  `../../screenshots/brainrot-td-shop-sync-compact-0.1.3.jpg`.
- [x] Release 0.1.4 replaces School Hallway Rush's misleading interior router
  objective with a reviewed two-entrance road contract and an illuminated
  server-room terminus at the far-right boundary. Both route tails stay on the
  painted upper/lower corridors, merge at `(910, 245)`, and share the final
  corridor to `(1000, 250)`. The original and packaged School assets are pinned
  by exact reviewed digests. Movement schema v2 migrates live v0/v1 School
  enemies by physical position and is idempotent. The 141-test native suite
  passes (23 content, 51 core, 4 protocol, 27 renderer, 32 web, 4 TAP bridge),
  including both-lane endpoint, monotonic approach, compact scaling, exact leak,
  legacy migration, and reload-validation coverage. The optimized browser and
  Rslib federated-package builds pass (737,706-byte WASM; 8,973,150 packaged
  static-asset bytes), along with manifest and authored-asset validation. A
  browser-only UI play-through completed Backyard, used the Victory Next control
  to create School, started its first wave, and captured enemies following the
  painted upper corridor into the visible server room. No records were injected.
  A full reload restored School Wave 1, health 4, and 415 resources; the 390×844
  compact layout had no horizontal overflow, and browser warning/error logs were
  empty. Evidence:
  `../../screenshots/brainrot-td-school-server-lobby-0.1.4.jpg`,
  `../../screenshots/brainrot-td-school-server-route-0.1.4.jpg`, and
  `../../screenshots/brainrot-td-school-server-compact-0.1.4.jpg`.
- [ ] Live multi-identity spectator/permission screenshot. The browser preview
  supplies one runtime identity per origin, so it cannot create a second
  authenticated actor against the same preview channel. Spectator mutation
  denial is covered by the native `spectator_cannot_mutate_gameplay` test; a
  live role capture requires a multi-client TAP test harness.
- [ ] Public distribution rights for the card-faithful featured-enemy sprite
  adaptations. The app records its visual provenance and makes no ownership or
  permissive-license claim, but written derivative/redistribution clearance or
  replacement original art is required before this can ship as a public
  production example.
- [x] Final prohibited-pattern scan contains only legitimate seeded-variation
  tests/copy and the functional input placeholder.
- [x] Reference repositories were inspected read-only. This application branch
  contains changes only in `tap-miniapp-examples`; it does not include or modify
  files from any reference checkout.
