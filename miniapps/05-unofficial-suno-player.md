# Unofficial Suno Player

**Status:** Approved concept; Suno integration requires provider authorization
**Audience:** Consumer
**Data approach:** Suno music, channel conversation, scheduled workflows, and user-owned audio
**Working title:** Unofficial Suno Player

## Product idea

Unofficial Suno Player is an old-school desktop music player with modern conversation-aware programming. It plays authorized Suno songs and playlists, turns the ongoing story of a TAP channel into prompts for original songs, and renders playful music-reactive visualizations during playback.

A scheduled workflow summarizes the conversation, identifies themes and memorable moments, and prepares a song brief. A user can select a genre, edit the prompt, and request multiple new songs through an authorized Suno integration. The player evaluates or presents those candidates, adds approved results to the channel's continuously replenished playlist, and renders local EQ, spectrum, waveform, and generative visual effects when the integration provides an authorized analyzable audio source.

The result should feel like a channel gradually developing its own soundtrack.

“Unofficial” means that the product is independently built and is not endorsed, sponsored, or operated by Suno. It does not mean that the implementation may use private APIs, scrape the service, bypass access controls, or automate unsupported interfaces.

## Provider approval package

This brief should double as the product proposal shared with Suno. Before enabling direct connectivity, request written confirmation or an official partner agreement covering:

- Authentication and paid-account verification
- Song and playlist lookup
- Playback and streaming inside a third-party application
- Album art, titles, prompts, lyrics, and other metadata display
- Audio analysis for local visualizations
- Playlist creation and modification
- Song generation from user and channel-derived prompts
- Generation-status polling and result retrieval
- Download, caching, and local artifact retention
- Use of generated Output alongside a separate conversational specialist
- Public versus private playback and channel sharing
- Required attribution, branding, rate limits, and commercial restrictions

Until those permissions exist, the implementation uses the human-mediated generation and owned-file import path described below.

## Three primary modes

### Play a Suno playlist

The user connects a paid Suno account, selects one of their playlists or an authorized public playlist, and plays it through the retro interface.

The intended authorized connector should support:

- List accessible playlists
- Retrieve playlist title, artwork, owner, visibility, and tracks
- Start, pause, seek, skip, repeat, and shuffle
- Show the currently playing track and queue
- Add an owned generated track to a selected playlist
- Refresh playlist state without retaining stale provider data indefinitely

If Suno does not authorize third-party streaming, this mode may instead open the playlist in Suno while the miniapp retains only permitted links and user-authored channel metadata.

### Play an existing Suno song

The user can paste or select an authorized Suno song link. The player resolves the song through a supported connector, displays permitted attribution and metadata, and plays it when third-party playback is authorized.

Public availability alone does not establish permission to restream or analyze a song. The connector must respect the song owner's visibility, download, remix, and playback permissions.

### Generate from genre, prompt, and channel context

The user chooses:

- Genre or musical family
- Mood and emotional arc
- Instrumentation and vocal direction
- Optional original prompt
- Channel conversation window
- Lyric or instrumental preference
- Explicit-content preference
- Desired duration or structure where supported

The workflow combines those choices with an approved summary of the selected channel conversation. Before generation, the user sees the exact outbound prompt and can edit, approve, or cancel it.

With an authorized integration, the provider flow is:

`approve prompt and batch → submit generation → track status → preview results → select or auto-accept eligible results → add to channel playlist → replenish before queue runs low`

Generation requires the user's connected paid account. The UI should show expected credit usage or cost before submission when Suno makes that information available.

### Neverending channel playlists

Each opted-in channel can maintain a continuously replenished playlist derived from its approved conversation history, current themes, and configured musical identity.

The playlist manager should:

- Generate multiple candidate songs per approved batch.
- Keep enough approved or pending tracks to avoid reaching an empty queue.
- Vary genre, energy, tempo, instrumentation, and lyrical perspective within channel-defined boundaries.
- Avoid regenerating substantially identical prompts or songs.
- Remember recently played tracks and apply configurable repetition limits.
- Support instrumental-only periods and quiet hours.
- Let participants like, skip, hide, or retire a track.
- Feed explicit participant preferences into future user-authored briefs without sending imported audio to another model.
- Pause replenishment when its generation budget, credit allowance, privacy approval, or provider quota is exhausted.

“Neverending” describes the listening experience, not unbounded autonomous spending. Every channel has limits for songs per batch, maximum generations per day or week, credit budget, approval policy, and who may change those settings.

Generation approval can operate at different policy levels:

- **Every batch:** a person approves the exact prompt and number of requested songs.
- **Approved recipe:** a person approves a bounded recurring recipe, schedule, exclusions, and budget; each run records its prompt and receipt.
- **Manual only:** the workflow prepares briefs but never submits generation automatically.

The channel must be able to stop generation immediately without stopping playback of already approved tracks.

## Global player and channel following

The player is a global, single-instance TAP surface rather than a component owned by one channel view. Playback continues while the user navigates through the application.

The user can display it as:

- A compact app-wide player bar
- A panel docked to either side of the application
- An expanded visualizer surface
- A pop-out window that remains connected to the same playback session
- A minimized now-playing control

Docking, pop-out state, size, visualization, volume, and follow behavior persist per user. Opening another representation attaches to the existing session instead of starting duplicate playback.

### Follow current channel

With **Follow current channel** enabled, the player subscribes to TAP's current-channel context and changes programming as the user navigates:

1. Detect the authenticated user's active channel.
2. Verify that the user can access its playlist and artifacts.
3. Fade down the outgoing channel track.
4. Select an eligible track from the destination channel's queue.
5. Switch channel context without mixing the two audio sources.
6. Fade the destination track up and update the player identity, visuals, and now-playing state.

The transition should be a volume fade around a discrete source change—not overlapping, remixing, or blending provider tracks unless the provider expressly permits that behavior.

Users can configure whether a channel switch resumes the destination's shared queue position, resumes their personal position, or starts the next track. A pinned-channel mode keeps the current soundtrack playing while the user browses elsewhere.

Channels without an enabled soundtrack should follow a user preference: keep playing the prior pinned channel, pause, or use a personal fallback playlist. Private channel identity and track information must not appear after the user loses access.

Rapid navigation should be debounced so moving through several channels does not repeatedly restart playback or produce a series of generation requests.

### Current-channel API requirements

The miniapp needs a scoped current-channel subscription that exposes:

- Channel ID and workspace ID
- Channel display identity permitted for the current user
- Navigation enter and leave events
- Membership and effective access state
- Attached soundtrack or channel-album reference
- Whether conversation-derived generation is enabled
- Current channel-specific playback policy

The host should send context changes to the singleton player surface regardless of whether it is docked, expanded, or popped out.

## Presence-aware listening

The player can use TAP presence APIs to show who is actively listening in a channel and support a shared listening mode.

Presence may include:

- Listening, paused, or present-but-not-listening state
- Shared-session host and participants
- Current channel and soundtrack participation
- Track reactions and generation votes
- Temporary disconnect and reconnection

Presence is ephemeral and must not become permanent listening-history surveillance. Users can opt out of broadcasting listening state while still using personal playback.

Two playback modes should be supported:

- **Personal:** navigation follows the user's current channel, but playback position and controls affect only that user.
- **Channel session:** authorized participants follow a shared queue and approximate position, with explicit rules for who may play, pause, skip, or change the queue.

New participants can join the current channel session at the live position. Presence loss does not transfer control or expose a private soundtrack to another channel. Canonical session membership and queue state remain separate from transient presence signals.

## Core experience

Channel participants can:

- Open a compact retro player inside the channel.
- Keep one global player running while navigating between channels.
- Dock the player, expand its visualizer, or move it into a pop-out window.
- Play authorized Suno songs and playlists or tracks that channel members own and import.
- Watch visualizations react to the locally decoded audio.
- View the conversation period and approved themes that inspired a track.
- Request a new song about a particular discussion or event.
- Request a batch of songs and continuously replenish the channel playlist.
- Vote on a song brief, title, mood, or genre before generation.
- Choose a conversational companion mood independently from the audio source.
- View the channel's growing album and Suno playlist of prior songs.

Example interactions:

- “Make a song about what happened in this channel today.”
- “Summarize the week as an upbeat synth-pop track.”
- “Leave customer names and project codenames out of the lyrics.”
- “Turn the launch discussion into a dramatic power ballad.”
- “Prepare a Suno prompt, but let us review it first.”
- “Add the finished track to this channel's Suno playlist.”
- “Play last month's channel recap.”
- “Play my Road Trip playlist.”
- “Play this Suno song.”
- “Use dream pop and make a song from today's channel conversation.”
- “Keep this channel's playlist filled with at least ten unplayed songs.”
- “Pin this soundtrack while I browse other channels.”
- “Join the channel listening session.”

## Conversation-to-song workflow

The recurring workflow should be explicit and reviewable:

`select window → summarize → identify safe themes → draft song brief → privacy review → participant approval → generate externally → import owned track → visualize and play`

### Select the conversation window

The workflow runs on a configured cadence—such as daily, weekly, or after a channel milestone—and selects only messages the workflow is authorized to read. Participants may also start an ad hoc run for an explicit message range.

### Prepare a grounded summary

The summarizer identifies:

- Major events and decisions
- Recurring themes
- Memorable phrases that participants have approved for reuse
- Emotional arc and overall mood
- People, customers, projects, or details that must remain private
- Disagreements or sensitive moments that should not become entertainment
- Candidate song concepts

The summary remains a TAP artifact. It should not be sent to a music provider automatically.

### Draft a song brief

The workflow produces structured, editable fields:

- Proposed title
- Song concept
- Mood and emotional arc
- Genre and instrumentation
- Tempo range
- Vocal style
- Song structure
- Original lyric themes or a complete lyric draft
- Required exclusions and redactions
- Attribution and source period

The brief should describe musical characteristics rather than imitate a named living artist. Participants can edit or reject it before anything leaves TAP.

### Review and approval

At least one authorized channel member must approve the outbound brief. A channel may require approval from every quoted participant or from a designated content owner.

The approval preview clearly shows the exact text that will be copied or sent to the external music service. Private message text, hidden context, and participant identities are excluded unless explicitly approved.

### Generate the song

The fallback Suno flow is human-mediated:

1. The Unofficial Suno Player creates a Suno-ready brief.
2. An authorized person copies it into their Suno account.
3. They generate the track under a subscription and terms that permit the intended use.
4. They download the selected result.
5. They import the owned audio and associated provenance into the Unofficial Suno Player.

Direct playback and automated Suno generation are provider integration gates. They may be enabled only if Suno provides or contractually approves an API for these uses. The app must not scrape Suno, reverse-engineer internal endpoints, replay captured private requests, or automate unsupported website flows.

## Track import and provenance

Every imported track records:

- Track title and optional cover art
- Contributor
- Source and generation provider
- Creation date
- Rights attestation
- Subscription or license basis
- Original song brief version
- Approved conversation window
- Audio content digest
- Visibility and permitted channels
- Explicit-content and content-warning metadata

The importer requires the contributor to confirm that they have the rights necessary to store, play, and share the track with the selected audience. Provider branding or attribution is shown when required by the applicable license.

The original generation prompt and audio are not automatically provided to another AI model.

## Retro player

The visual design can evoke late-1990s and early-2000s desktop players while remaining original. It must not copy Winamp's name, logo, icons, skins, layouts, or proprietary assets.

The player should include:

- Transport controls
- Seek and progress display
- Volume and mute
- Playlist and channel-album views
- Track title, duration, contributor, and source period
- Compact and expanded layouts
- Global docked, pop-out, detachable, and rearrangeable layouts where the TAP surface permits them
- Keyboard controls and accessible labels
- Reduced-motion and low-power modes

## Music-reactive visualizations

When the player uses user-owned imported audio or another source that Suno explicitly permits for analysis, the application can locally analyze the decoded signal for deterministic visual rendering.

Initial visualization modes should include:

- Frequency-bar EQ
- Oscilloscope waveform
- Stereo spectrum
- Particle tunnel
- Geometric kaleidoscope
- Pixel-art city or landscape
- Album-art color field

Audio analysis remains on the user's device and feeds only the renderer. Raw audio, FFT bins, beat events, and derived audio features are not sent to a specialist or remote AI service.

The visualizer should support sensitivity, color palette, frame-rate, and motion controls. Gameplay-critical information is not conveyed through audio or animation alone.

## Conversation companion

The Unofficial Suno Player may include a lightweight host or DJ specialist, but its personality must be selected by users or derived from the approved conversation brief—not from Suno Output or provider metadata unless Suno explicitly authorizes that use.

Available user-selected styles might include:

- Calm late-night host
- Chaotic hype host
- Warm community radio host
- Dry deadpan announcer
- Dreamy ambient guide
- Intense arena host

The specialist can introduce a track, explain the channel period that inspired it, invite reactions, or help draft the next song brief. It must not receive the imported Suno audio, lyrics, generation output, or locally derived audio-analysis data unless a future provider agreement expressly permits that use.

## Privacy and participant consent

Turning a conversation into music can expose context in a memorable and easily shared form. The default workflow therefore favors privacy:

- The feature is opt-in per channel.
- Participants are notified when recurring summaries are enabled.
- The source window and outbound brief are visible before approval.
- Direct quotations require explicit approval from the quoted participant.
- Personal data, customer information, secrets, credentials, and sensitive project details are excluded by default.
- Participants may mark a message or thread as ineligible for song generation.
- Private-channel songs inherit the channel's visibility and cannot be published publicly without a separate review.
- Removing source access does not silently delete an already approved song, but retention and deletion requests must be supported.

The workflow should avoid turning conflict, grief, personnel matters, confidential incidents, or harassment into entertainment without specific informed consent.

## Channel album and publishing

Each channel gets an album containing approved tracks, permitted Suno playlist links and metadata, cover art, song briefs, source periods, credits, reactions, and revision history.

Possible visibility states are:

- Private draft
- Channel-only
- Workspace-visible
- Publicly publishable

Moving to a broader visibility requires a new review. A public track package may be published through Zephyr Cloud only after rights, privacy, attribution, and content checks pass. Publication records the audio digest, artwork digest, rights attestation, approvers, build receipt, and resulting URL.

## Workflows

Useful workflows include:

- Daily channel jingle
- Weekly conversation recap song
- Project milestone anthem
- Release-day track
- Event or trip soundtrack
- Community-voted song challenge
- Channel album compilation
- Queue-low watermark replenishment
- Approved multi-song generation batches

Recurring workflows stop at the approval-ready song brief unless an authorized provider integration is available. Even with an integration, they must not repeatedly send similar prompts or generate paid content without a human-controlled budget, batch size, rate limit, and approval policy.

## Storage and architecture

- Store imported audio and artwork as access-controlled channel artifacts.
- Keep conversation summaries and song briefs versioned separately from tracks.
- Decode and analyze audio locally for visualization.
- Keep provider credentials in the host credential system.
- Use lifecycle checkpoints to restore the queue, playback position, selected visualization, and pending workflow state.
- Keep global playback authority in a single host-managed session shared by docked and pop-out surfaces.
- Subscribe to current-channel and presence context through scoped host APIs.
- Delete cached audio-analysis buffers when playback ends.
- Avoid retaining provider metadata that is unnecessary to operate the app.

## TAP capabilities demonstrated

- Channel-scoped UI and artifacts
- Scheduled and ad hoc workflows
- Global singleton surfaces, docking, pop-out, and channel-aware navigation
- Current-channel and presence APIs
- Personal and synchronized channel listening modes
- Multi-song batches and continuously replenished playlists
- Conversation summarization with approval boundaries
- Authorized provider integration with a human-mediated fallback
- User-owned audio import and provenance
- Local real-time audio analysis and visualization
- Specialist personality configuration
- Participant consent and private/public visibility
- Rich media storage and playback
- Zephyr Cloud publication
- Lifecycle checkpoints and retained state

## Implementation phases

### Phase 1: player and visualizer

- Import user-owned audio with rights attestation.
- Build the original retro player.
- Add local EQ, waveform, and generative visualization modes.
- Create the channel album and retained playback state.
- Add the global docked and pop-out player shell.
- Add current-channel following with safe fade transitions.

### Phase 2: conversation soundtrack

- Add opt-in conversation windows and summaries.
- Create editable song briefs and privacy checks.
- Add multi-song batches, queue management, and bounded replenishment policies.
- Package the Unofficial Suno Player specialist.
- Add the human-mediated Suno generation and import flow.

### Phase 3: recurring radio

- Add scheduled recap workflows.
- Add voting, approvals, and playlist programming.
- Add presence-aware shared listening sessions.
- Support approved Zephyr Cloud publication.
- Evaluate an automated provider integration only after contractual authorization.

## Provider constraints

Suno's public Live Radio page is not treated as an API or reuse license. The Unofficial Suno Player does not extract its streams or call undocumented endpoints.

Suno's current terms distinguish between free-tier and paid-tier Output and restrict using the service or Output to power, enable, or train other AI technologies. The implementation must be reviewed against the terms in effect when it ships, and automated integration requires written authorization or an official API whose terms permit the complete workflow.

## Public example value

The Unofficial Suno Player combines conversation, scheduled agents, human creative review, original music, local signal processing, rich visualization, and publication in a playful product. It demonstrates how TAP can transform a channel's ongoing history into a governed creative artifact without treating private conversation or third-party music services as unrestricted input.

## References

- [Suno Terms of Service](https://about.suno.com/terms)
- [Suno guidance on ownership](https://help.suno.com/en/articles/2416769)
