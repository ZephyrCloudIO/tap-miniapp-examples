# Unofficial Suno Player requirements checklist

This checklist is derived from `miniapps/05-unofficial-suno-player.md`. A checked item must have executable evidence. `BLOCKED` means the installed TAP SDK or provider contract cannot support the requirement without inventing a capability.

## Package and platform contract

- [x] SDK dependency and `compatibility.tapSdk` are exact-pinned to `0.2.0`.
- [x] Desktop surface and deterministic workflow host are valid ESM Module Federation targets; the surface has an idempotent mount/unmount adapter.
- [x] Surface waits for and reacts to `hostAuthority`; protected work stops when authority is absent.
- [x] Appearance synchronization applies platform theme and UI scale and is cleaned up on unmount.
- [x] Manifest permissions, effects, published events, scopes, and contribution bindings match every connected SDK operation.
- [x] Desktop and workflow-host builds are assembled into one immutable TAP package and both source and emitted manifests validate against the installed schema.
- [x] Packaged artifacts pass portability checks and contain no source maps or machine-local paths.
- [x] Marketplace discovery categories use the SDK's closed taxonomy and are included in the signed package descriptor.

## Empty state, identity, scope, and persistence

- [x] First launch contains no domain records and provides a real channel selection/onboarding flow.
- [x] Channel access is checked before state or timeline data is read; denied/revoked access fails closed.
- [x] Channel records and per-user/device playback preferences use separate storage keys and scopes.
- [x] Domain records receive runtime-generated stable IDs and timestamps.
- [x] Stored JSON is validated on load, supports explicit schema migration, and rejects corrupt or future data visibly.
- [x] Revision conflicts are visible and recoverable; writes never silently overwrite another surface.
- [x] Mutations use stable operation IDs with duplicate/replay protection.
- [x] Browser preview metadata and media storage are explicitly separate from packaged TAP storage.
- [x] Packaged execution never falls back to `localStorage`, IndexedDB, or another browser store.
- [x] Loading, saving, success, conflict, empty, and failure states are visible and actionable.

## Channel consent and conversation context

- [x] Conversation-derived music is opt-in per channel and enabling it sends a real channel notice before state changes.
- [x] Visible channel timeline rows can be loaded through `sdk.channels.getTimeline` and are narrowed at the API boundary.
- [x] A user explicitly selects the source messages/window; unselected text is not copied into a summary request.
- [x] A user can create a manual summary from selected context without a specialist.
- [x] When supported, a user can select a real TAP specialist and explicitly approve the exact bounded excerpts before invocation.
- [x] Specialist output is visibly marked as a draft and cannot become approved without human privacy review.
- [x] Summary artifacts record source references/digests, themes, emotional arc, exclusions, sensitive details removed, candidate concepts, provenance, and approval state.
- [x] Direct quotations require an explicit participant-approval confirmation; privacy/secrets/customer/conflict checks fail closed.
- [x] Rejected summaries remain auditable and cannot seed a brief.
- [ ] `BLOCKED` Platform-wide message/thread ineligibility and retention/deletion requests: SDK `0.2.0` exposes timeline reads but no channel-message eligibility metadata, artifact deletion, or retention-request contract. A local flag would not govern other TAP readers.

## Reviewable song briefs and human-mediated generation

- [x] Brief editor covers title, concept/original lyric themes, genre, mood/arc, instrumentation, tempo, vocal style, structure, lyric/instrumental direction, explicit preference, duration, source period, summary, and exclusions.
- [x] The exact outbound prompt is displayed before approval and can be edited, approved, cancelled, and copied.
- [x] Approved brief versions are immutable; revisions create retained version history.
- [x] Substantially duplicate approved prompts are rejected with an actionable explanation.
- [x] A bounded candidate batch records target count, manual-only approval policy, state, and imported results.
- [x] Participants can vote support/needs-revision and suggest title, mood, or genre; one durable vote per actor/brief is updateable and replay-safe.
- [x] Generation never calls private Suno endpoints, replays browser credentials, scrapes Suno, or simulates provider success.
- [x] Import can link an owned result to the approved brief/batch and records the real human-mediated state.
- [x] Existing saved TAP workflows can be listed and invoked with explicit payload/status handling; failure never appears successful.
- [x] The package contributes a content-addressed ad hoc manual-brief workflow and a schema-bound, pure checkpoint node through the canonical workflow-host ABI.
- [ ] `BLOCKED` Creating recurring schedules: SDK `0.2.0` supports package-declared workflows but exposes no schedule creation or recurring-trigger API.
- [x] The surface feature-detects bounded host HTTP and lists metadata-only host credential references without receiving secret fields.
- [ ] `BLOCKED` Direct Suno account, song, playlist, playback, generation, status, credits, and playlist mutation: no written provider authorization or supported connector is available.

## Track import, provenance, album, and visibility

- [x] Audio import validates a decodable user-selected file and requires rights attestation before any authoritative state change.
- [x] Track provenance includes contributor, provider/source, source URL when supplied, creation/source period, license basis, brief/batch, digest, visibility, explicit flag, warning, filename, media type, size, and duration.
- [x] Imported audio is hashed locally and audio/FFT/derived signal data are not sent to a specialist or remote model.
- [x] Private draft and channel-only visibility are selectable at import; broader visibility requires a separate review and confirmation.
- [x] Channel album exposes provenance, rights scope, source period, approved themes, brief/batch linkage, reactions, and retained revision/history state.
- [x] Likes toggle per actor, skips are recorded, hide/unhide affects that actor's queue, and retirement is manager-only with confirmation and undo.
- [ ] `BLOCKED` Reloadable packaged binary audio/artwork artifacts: SDK `0.2.0` storage is JSON-only and VFS is write-only; no readable channel-artifact API exists.
- [ ] `BLOCKED` Zephyr Cloud publication: Marketplace categories are now declared, but SDK `0.2.0` exposes no publication API or receipt contract.

## Player, queue, programming, and visualizers

- [x] User-owned session audio supports play, pause, seek, previous/restart, next, volume, mute, repeat, shuffle, progress, and keyboard controls.
- [x] Playback position, queue selection, volume, visualization, palette, motion, power, repeat, shuffle, and recent-play state persist in the correct user/device scope.
- [x] The queue excludes retired and personally hidden tracks, respects repetition limits, and can prefer instrumental tracks during configured quiet hours.
- [x] Queue-low status, manual replenishment pause, batch size, repetition, quiet-hour, weekly-generation, and credit-budget policies are real stored controls; no setting triggers autonomous spending.
- [x] Frequency EQ, waveform, stereo spectrum, particle tunnel, kaleidoscope, pixel landscape, and color field use only locally decoded signal data.
- [x] Idle visualizers do not simulate active music; palette, frame rate, sensitivity, reduced motion, and low-power settings affect rendering.
- [x] Audio nodes, object URLs, timers, listeners, and analysis buffers are cleaned up when playback or the surface ends.
- [x] Manual channel switches fade out around a discrete source change and never overlap tracks; the destination remains stopped until the user explicitly plays it.
- [ ] `BLOCKED` Host-wide playback continuity, dock/side/popup/minimized representations, and automatic current-channel following: SDK `0.2.0` has no global playback-session, docking, popup, or current-channel subscription API.

## Presence and roles

- [x] Personal listening is the default; broadcasting presence is explicit opt-in.
- [x] Presence subscribes before join, uses host-stamped identity, renders listeners/paused state, updates playback state, and leaves on teardown.
- [x] Listener, contributor, and channel-DJ operations fail closed in both UI and domain transitions.
- [x] Authorization failures from the operation itself remain visible even after an earlier access check.
- [ ] `BLOCKED` Canonical synchronized channel-session queue/position/control authority: presence is ephemeral and SDK `0.2.0` exposes no durable shared-session primitive.

## UI, accessibility, and verification

- [x] SDK UI components are the primary design system for toolbar/status, headings, cards/items, forms, buttons, tabs, badges, progress, dialogs, confirmations, and empty/error/loading states.
- [x] Desktop and compact layouts have no horizontal overflow or clipped primary controls and remain usable in light/dark themes.
- [x] Semantic landmarks/headings, visible labels, accessible names, keyboard focus, hover states, and reduced-motion behavior are verified.
- [x] Every visible executable control changes an authoritative source or local playback state; unavailable capabilities are explanatory text with no fake controls.
- [x] Tests cover empty state, creation/validation, serialization/load/migration, permissions, transitions, voting, replay, conflicts, failure handling, queue selection, reactions, visibility review, retirement/undo, rejected-summary boundaries, prompt duplication, credential-metadata narrowing, and workflow content integrity.
- [x] Live browser verification covers empty/onboarding, primary populated flow, secondary brief/context/voting flow, role-specific state, compact layout, error state, and reload persistence.
- [x] Browser console is clean for development and production bundles, and the repository scan finds no prohibited executable mocks, seeds, stubs, TODO behavior, or hardcoded domain records.
- [x] The dedicated PR branch was created from `origin/main` in an isolated worktree; its diff contains no reference repositories or reference-repository changes.
