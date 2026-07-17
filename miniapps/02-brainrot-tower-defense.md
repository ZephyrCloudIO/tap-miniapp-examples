# Brainrot Tower Defense

**Status:** Approved
**Audience:** Consumer
**Data approach:** Channel presence, synchronized game sessions, and TAP persistence
**Implementation:** Rust compiled to WebAssembly

## Product idea

Brainrot Tower Defense is a fast, funny, replayable multiplayer tower-defense game with several increasingly difficult levels. One to four players join a game through a TAP channel, place absurd internet-culture-inspired defenders, combine their abilities, and stop waves of enemies before they reach the end of the map.

The miniapp demonstrates that TAP can host a real-time multiplayer game—not only forms, dashboards, and conversational interfaces. It should be a flagship example of channel presence, live shared state, spectatorship, and multiple concurrent activities inside one conversation.

All authored application code, gameplay systems, rendering, input handling, level loading, persistence, and TAP integration must be written in Rust and compiled to WebAssembly. The project should contain no hand-authored JavaScript or TypeScript application layer. Tool-generated WebAssembly loader or binding glue is acceptable only when required by the browser or TAP host.

## Core game loop

1. Create or join a game lobby in a channel.
2. Claim one of the four player slots or enter as a spectator.
3. Select an unlocked level and wait for the active players to become ready.
4. Inspect the scaled map, enemy paths, available defenders, and level modifiers.
5. Place defenders using shared or player-specific resources, depending on the game mode.
6. Start a wave and collaborate by placing, upgrading, selling, or repositioning units.
7. Earn resources by defeating enemies.
8. Survive every wave without losing all base health.
9. Earn a rating, unlock the next level, and retain progress.

## Channel lobbies and presence

A channel may contain multiple independent game sessions at the same time. Each session has its own lobby, players, spectators, selected level, simulation state, chat-linked activity, and lifecycle.

- Any channel member can create a new game, including someone currently spectating another game.
- A game supports one to four active player slots.
- Channel members beyond those four slots can watch as spectators without affecting the simulation.
- Spectators can leave one game, join an available player slot, or create another game in the same channel.
- The channel surface lists every open lobby and active game with its player count, level, wave, status, and spectator count.
- Presence updates show who is in the channel, which game they are viewing, and whether they are a player, spectator, disconnected player, or lobby host.
- A player slot is held briefly during a transient disconnect, after which the session may allow another channel member to claim it.
- Joining a running game as an active player is controlled by the lobby policy; the default allows it between waves when a slot is available.
- Spectators receive a current snapshot when joining and then follow the live event stream.

Presence is informative rather than authoritative. The synchronized game session owns the canonical roster and game state so temporary presence loss cannot duplicate slots or corrupt a match.

## Multiplayer coordination

Players cooperate on the same defense rather than controlling isolated boards. Each defender records its owner for attribution, while the team shares the objective and base health.

The initial mode should use a shared build area with per-player resources. Players can see one another's cursor or placement preview, defender selections, ready state, and recent actions. Placement and upgrades are validated against the canonical simulation to resolve simultaneous actions consistently.

The multiplayer protocol should support:

- Lobby creation, discovery, join, leave, ready, and start
- Player-slot assignment and reconnection
- Spectator join, leave, and snapshot synchronization
- Sequenced player commands with acknowledgement or rejection
- Canonical simulation snapshots and incremental events
- Host migration or a platform-owned authoritative session
- Pause, resume, completion, and abandoned-session cleanup
- More than one independent session per channel

Players may communicate through the existing channel while the game is active. Game events should post compact activity cards rather than flooding the channel with every simulation tick.

## Player-count scaling

Levels must scale intentionally for one, two, three, or four players. Scaling should change the play space and strategic workload, not merely multiply enemy health.

Depending on player count, a level may adjust:

- Map width and usable build area
- Number and arrangement of paths
- Simultaneous enemy entrances
- Wave composition and enemy count
- Objective or base layout
- Starting and earned resources per player
- Build-zone ownership or cooperative zones
- Boss phases and ability frequency

Every level provides authored variants or scaling parameters for all four player counts. The lobby previews the resulting map size and difficulty before the players ready up. Balance tests must cover every level and supported player count.

## Levels

The first public version should include at least five handcrafted levels:

1. **Backyard Wi-Fi** — a short introductory path that teaches placement, range, and upgrades.
2. **School Hallway Rush** — two lanes introduce target-priority decisions and faster enemies.
3. **Food Court Frenzy** — branching paths and armored enemies require complementary defenders.
4. **Suburban Doomscroll** — environmental modifiers and intermittent signal outages alter defender behavior.
5. **Final Feed** — a multi-phase boss level that combines the previous mechanics.

Each level should define its map, paths, build zones, waves, starting resources, base health, available defenders, unlock requirements, modifiers, and scoring thresholds as structured Rust-deserializable data.

## Defenders

The initial roster should have distinct, readable roles:

- A rapid single-target defender
- An area-of-effect defender
- A slowing or stunning support defender
- A long-range defender
- A resource-generating defender
- A high-cost late-game defender

Each defender can have multiple upgrade paths so the player makes strategic choices instead of following a single linear progression.

Names, dialogue, art, and audio should be original rather than copied from existing memes, characters, creators, or commercial games. The tone can evoke chaotic internet culture without depending on third-party intellectual property.

## Enemies and waves

Enemy types should include basic, fast, armored, swarm, disruption, and boss units. Waves are deterministic for testing but may include seeded variation for replayability.

The game should make status effects, damage, path progress, and target selection understandable through animation and compact visual feedback.

## Sound and music

The game should include original sound effects for placement, upgrades, selling, attacks, impacts, enemy defeat, resource gain, wave start, base damage, victory, and defeat. Important multiplayer actions such as another player joining, becoming ready, or triggering a major upgrade should also have restrained audio cues.

Include background music or ambient loops appropriate to each level, with separate controls for master, music, and sound-effect volume. Audio settings persist locally. The game must respect muted state, avoid autoplay before user interaction, pause or attenuate audio when the surface is inactive, and provide visual equivalents for gameplay-critical audio cues.

## Progression

- Unlock levels by completing the prior level.
- Award one to three stars based on base health, completion time, or resource efficiency.
- Retain best scores and level ratings.
- Unlock defenders or upgrade options through play.
- Support restarting a level without clearing overall progression.
- Allow a paused run to resume from a lifecycle checkpoint.
- Track cooperative completions and per-player contribution statistics without turning them into a competitive requirement.

These game stars are local progression awards and are unrelated to the household stars in Family Task Board.

## Chloe interactions

Chloe should complement the game without playing it automatically. Players can ask:

- “What does this defender do?”
- “Why did I lose the last wave?”
- “Which enemy is getting through my defense?”
- “Explain the level modifier.”
- “Give me a hint without solving the level for me.”
- “Which game in this channel can I join?”
- “How many people are watching our game?”

The game can expose a read-only snapshot tool containing the current level, wave, defenders, enemies, resources, base health, and recent combat events. Chloe uses that structured state to give contextual explanations.

## Rust and WebAssembly architecture

Use a Cargo workspace organized by responsibility:

- `game-core` — deterministic simulation, entities, combat, pathing, waves, economy, player-count scaling, progression, and serialization
- `game-content` — typed level, defender, enemy, and balance definitions
- `game-protocol` — typed lobby, player-command, snapshot, event, reconnection, and spectator messages
- `game-renderer` — rendering, animation, sound, music, presence indicators, and input mapping
- `game-web` — browser lifecycle and WebAssembly entry point
- `tap-bridge` — typed TAP channel, presence, host operations, events, tool snapshots, and checkpoint translation

The simulation should be independent of browser APIs so it can run in native Rust unit tests and in an authoritative session runtime if needed. Use newtypes for channel, session, player, entity, and command identifiers; enums for game and connection states; explicit `Result` errors at data and platform boundaries; and deterministic seeded randomness.

Prefer a fixed-timestep simulation separated from rendering. Avoid per-frame allocation in hot paths, reuse collections, and keep entity data cache-friendly. Optimize the release WebAssembly build for size and runtime performance with LTO, a single codegen unit, aborting panics, and post-build WebAssembly optimization where supported.

## TAP integration

The miniapp should provide:

- A desktop game surface, with mobile support considered after the desktop controls are complete
- Lifecycle hooks for pause, resume, and checkpoint persistence
- A read-only game-state tool for Chloe
- Channel-scoped lobby discovery and presence
- Synchronized player and spectator sessions
- Events for lobby creation, player join, spectator join, level start, wave start, level completion, defeat, unlock, and checkpoint creation
- Player-scoped progression plus session-scoped active game state
- Packaged presentation assets and level content

The current SDK and host references must be reviewed before implementation to determine whether a Rust/WASM contribution can be mounted directly. If the SDK currently assumes JavaScript module exposes, the preferred platform change is first-class WebAssembly target or adapter support. The example must not hide a handwritten JavaScript application behind a nominal Rust core.

## Testing

- Unit-test combat, targeting, upgrades, pathing, economy, and scoring in native Rust.
- Use deterministic simulation tests for every wave, level, and player-count variant.
- Test simultaneous and out-of-order commands, rejected placements, reconnects, host migration, and spectator snapshot catch-up.
- Test multiple isolated games running in the same channel.
- Validate all content files during the build.
- Add property tests for invariants such as nonnegative resources and valid path progress.
- Test serialization compatibility for saved progress and active-run checkpoints.
- Run browser-level tests for input, rendering startup, audio controls, TAP lifecycle, presence changes, and save restoration.
- Track WebAssembly bundle size and representative frame-time budgets.

## Public example value

This example proves that TAP miniapps can include high-frequency input, real-time rendering, channel presence, cooperative multiplayer, unlimited spectators, concurrent sessions, synchronized state, audio, persistent progress, contextual agent assistance, and WebAssembly workloads. Its all-Rust implementation also provides a demanding SDK portability test and a reference for developers who do not want a JavaScript application stack.
