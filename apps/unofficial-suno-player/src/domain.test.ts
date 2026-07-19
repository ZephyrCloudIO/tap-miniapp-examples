import { describe, expect, it } from "@rstest/core";
import {
  DuplicatePromptError,
  DomainValidationError,
  PermissionDeniedError,
  actorFeedback,
  applyChannelOperation,
  buildPrompt,
  can,
  createDefaultPreferences,
  createEmptyChannelState,
  deriveRole,
  eligibleTrackIds,
  importTrack,
  isQueueLow,
  parseChannelState,
  parsePlayerPreferences,
  recordBriefVote,
  recordTrackSkip,
  restoreRetiredTrack,
  retireTrack,
  reviewTrackVisibility,
  saveBriefVersion,
  saveSummary,
  selectNextTrackId,
  serializeChannelState,
  toggleTrackHidden,
  toggleTrackLike,
  trackLikeCount,
  validateBrief,
  validatePolicy,
  type ChannelState,
  type ConversationSummary,
  type SongBriefDraft,
  type TrackImportInput,
} from "./domain";

const instant = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const briefDraft = (state: ChannelState, overrides: Partial<SongBriefDraft> = {}): SongBriefDraft => {
  const briefId = id();
  const base: SongBriefDraft = {
    id: briefId,
    seriesId: briefId,
    version: 1,
    supersedesId: null,
    summaryId: null,
    title: "Runtime title",
    concept: "A privacy-safe recap of a completed milestone",
    genre: "Synth pop",
    mood: "Reflective to hopeful",
    instrumentation: "Analog synths and acoustic drums",
    tempo: "108–112 BPM",
    vocalStyle: "Warm ensemble vocal",
    structure: "Verse, chorus, verse, chorus, bridge, outro",
    lyricDirection: "lyrics",
    explicitAllowed: false,
    desiredDuration: "About three minutes",
    sourcePeriod: "Selected runtime period",
    channelSummary: "Participants completed a milestone and reflected on the work.",
    exclusions: "Names, secrets, customer details, and direct quotations",
    outboundPrompt: "",
    candidateCount: state.policy.songsPerBatch,
    createdAt: instant(),
  };
  base.outboundPrompt = buildPrompt(base as never);
  return { ...base, ...overrides };
};

const trackInput = (state: ChannelState, overrides: Partial<TrackImportInput> = {}): TrackImportInput => ({
  id: id(),
  title: "Runtime audio",
  contributor: "Runtime contributor",
  provider: "Participant supplied source",
  sourceUrl: "https://suno.com/song/runtime-link",
  sourcePeriod: "Selected runtime period",
  createdAt: instant(),
  importedAt: instant(),
  rightsBasis: "Contributor attested paid-account output rights",
  rightsAttested: true,
  briefId: state.briefs.at(-1)?.id ?? null,
  batchId: state.batches.at(-1)?.id ?? null,
  audioDigest: id().replaceAll("-", "").repeat(2),
  fileName: "runtime.wav",
  mimeType: "audio/wav",
  size: 4_096,
  duration: 12.5,
  mediaPersistence: "session-only",
  visibility: "channel-only",
  explicit: false,
  instrumental: false,
  contentWarning: "",
  ...overrides,
});

describe("player domain", () => {
  it("starts with no domain records", () => {
    const state = createEmptyChannelState(id());
    expect(state.enabled).toBe(false);
    expect(state.tracks).toEqual([]);
    expect(state.briefs).toEqual([]);
    expect(state.briefVotes).toEqual([]);
    expect(state.summaries).toEqual([]);
    expect(state.batches).toEqual([]);
    expect(state.queue).toEqual([]);
  });

  it("validates brief creation and builds the exact prompt", () => {
    const state = createEmptyChannelState(id());
    expect(validateBrief({ title: "" })).toContain("Title is required.");
    const draft = briefDraft(state);
    expect(draft.outboundPrompt).toContain(draft.channelSummary);
    expect(draft.outboundPrompt).toContain("Explicit content: not permitted");
    expect(validateBrief(draft)).toEqual([]);
  });

  it("enforces role-sensitive operations and derives roles fail-closed", () => {
    expect(can("listener", "contribute")).toBe(false);
    expect(can("contributor", "manage")).toBe(false);
    expect(can("channel-dj", "manage")).toBe(true);
    expect(deriveRole(["timeline:read"])).toBe("listener");
    expect(deriveRole(["message:create"])).toBe("contributor");
    expect(deriveRole(["channel:manage"])).toBe("channel-dj");
    const state = createEmptyChannelState(id());
    expect(() => saveBriefVersion(state, briefDraft(state), { role: "listener", operationId: id(), approve: false, batchId: id() })).toThrow(PermissionDeniedError);
  });

  it("protects replayed mutations", () => {
    const operation = id();
    const state = createEmptyChannelState(id());
    const once = applyChannelOperation(state, operation, (current) => ({ ...current, enabled: true }));
    const replay = applyChannelOperation(once, operation, (current) => ({ ...current, enabled: false }));
    expect(replay).toBe(once);
    expect(replay.enabled).toBe(true);
  });

  it("retains approved brief versions, creates a bounded batch, and rejects duplicate prompts", () => {
    const state = createEmptyChannelState(id());
    const draft = briefDraft(state);
    const approved = saveBriefVersion(state, draft, { role: "contributor", operationId: id(), approve: true, batchId: id() });
    expect(approved.briefs).toHaveLength(1);
    expect(approved.briefs[0]?.status).toBe("approved");
    expect(approved.batches[0]?.targetCount).toBe(draft.candidateCount);
    const duplicate = briefDraft(approved, { outboundPrompt: draft.outboundPrompt });
    expect(() => saveBriefVersion(approved, duplicate, { role: "contributor", operationId: id(), approve: true, batchId: id() })).toThrow(DuplicatePromptError);
  });

  it("accepts replay-safe participant brief feedback from listeners", () => {
    const empty = createEmptyChannelState(id());
    const withBrief = saveBriefVersion(empty, briefDraft(empty), { role: "contributor", operationId: id(), approve: false, batchId: id() });
    const actorKey = id();
    const createdAt = instant();
    const vote = {
      id: id(),
      briefId: withBrief.briefs[0]!.id,
      actorKey,
      disposition: "support" as const,
      suggestedTitle: "A runtime title suggestion",
      suggestedMood: "",
      suggestedGenre: "",
      createdAt,
      updatedAt: createdAt,
    };
    const operation = id();
    const voted = recordBriefVote(withBrief, vote, "listener", operation, createdAt);
    expect(voted.briefVotes).toHaveLength(1);
    expect(voted.briefVotes[0]?.suggestedTitle).toBe("A runtime title suggestion");
    expect(recordBriefVote(voted, { ...vote, disposition: "needs-revision" }, "listener", operation, instant())).toBe(voted);
    const changed = recordBriefVote(voted, { ...vote, id: id(), disposition: "needs-revision", suggestedMood: "More hopeful" }, "listener", id(), instant());
    expect(changed.briefVotes).toHaveLength(1);
    expect(changed.briefVotes[0]?.id).toBe(vote.id);
    expect(changed.briefVotes[0]?.disposition).toBe("needs-revision");
    expect(parseChannelState(JSON.parse(serializeChannelState(changed)))).toEqual(changed);
  });

  it("does not allow a rejected summary to seed a brief", () => {
    const empty = createEmptyChannelState(id());
    const timestamp = instant();
    const rejected: ConversationSummary = {
      id: id(),
      status: "rejected",
      sourceWindow: { kind: "manual", label: "Runtime review window", timelineSequence: null, messages: [] },
      safeSummary: "A runtime summary that was explicitly rejected.",
      themes: "Review",
      emotionalArc: "Reflective",
      privateDetailsRemoved: "",
      candidateConcepts: "A review concept",
      exclusions: "Names and private details",
      provenance: "manual",
      specialistId: null,
      specialistName: null,
      privacyReview: null,
      createdAt: timestamp,
      approvedAt: null,
      rejectedAt: timestamp,
    };
    const withRejected = saveSummary(empty, rejected, "contributor", id(), timestamp);
    expect(() => saveBriefVersion(withRejected, briefDraft(withRejected, { summaryId: rejected.id }), { role: "contributor", operationId: id(), approve: false, batchId: id() })).toThrow(DomainValidationError);
  });

  it("imports validated provenance and advances the linked batch", () => {
    const empty = createEmptyChannelState(id());
    const withBrief = saveBriefVersion(empty, briefDraft(empty, { candidateCount: 2 }), { role: "contributor", operationId: id(), approve: true, batchId: id() });
    const firstInput = trackInput(withBrief);
    const first = importTrack(withBrief, firstInput, "contributor", id());
    expect(first.queue).toEqual([firstInput.id]);
    expect(first.batches[0]?.status).toBe("partially-imported");
    const secondInput = trackInput(first, { audioDigest: id().replaceAll("-", "").repeat(2) });
    const second = importTrack(first, secondInput, "contributor", id());
    expect(second.batches[0]?.status).toBe("complete");
    expect(() => importTrack(second, trackInput(second, { title: "" }), "contributor", id())).toThrow(DomainValidationError);
    expect(() => importTrack(second, trackInput(second, { visibility: "workspace-visible" }), "contributor", id())).toThrow(DomainValidationError);
  });

  it("toggles likes, records skips, and applies personal hides", () => {
    const empty = createEmptyChannelState(id());
    const input = trackInput(empty);
    const imported = importTrack(empty, input, "contributor", id());
    const actor = id();
    const liked = toggleTrackLike(imported, input.id, actor, "listener", id());
    expect(trackLikeCount(liked.tracks[0]!)).toBe(1);
    const unliked = toggleTrackLike(liked, input.id, actor, "listener", id());
    expect(trackLikeCount(unliked.tracks[0]!)).toBe(0);
    const skipped = recordTrackSkip(unliked, input.id, actor, "listener", id());
    expect(actorFeedback(skipped.tracks[0]!, actor)?.skipCount).toBe(1);
    const hidden = toggleTrackHidden(skipped, input.id, actor, "listener", id());
    expect(actorFeedback(hidden.tracks[0]!, actor)?.hidden).toBe(true);
  });

  it("requires a manager for retirement and visibility, with a real undo transition", () => {
    const empty = createEmptyChannelState(id());
    const input = trackInput(empty, { visibility: "private-draft" });
    const imported = importTrack(empty, input, "contributor", id());
    expect(() => retireTrack(imported, input.id, "contributor", id())).toThrow(PermissionDeniedError);
    const retired = retireTrack(imported, input.id, "channel-dj", id());
    expect(retired.tracks[0]?.retired).toBe(true);
    expect(retired.queue).toEqual([]);
    const restored = restoreRetiredTrack(retired, input.id, "channel-dj", id());
    expect(restored.tracks[0]?.retired).toBe(false);
    const channelVisible = reviewTrackVisibility(restored, input.id, "channel-only", "channel-dj", id());
    const workspaceVisible = reviewTrackVisibility(channelVisible, input.id, "workspace-visible", "channel-dj", id());
    expect(workspaceVisible.tracks[0]?.visibilityReviews).toHaveLength(2);
  });

  it("selects queue transitions with repeat, shuffle, hides, and quiet-hour rules", () => {
    const channelId = id();
    let state = createEmptyChannelState(channelId);
    const first = trackInput(state, { instrumental: false });
    state = importTrack(state, first, "contributor", id());
    const second = trackInput(state, { instrumental: true, audioDigest: id().replaceAll("-", "").repeat(2) });
    state = importTrack(state, second, "contributor", id());
    const actor = id();
    let preferences = createDefaultPreferences(id(), channelId);
    expect(selectNextTrackId(state, preferences, actor)).toBe(first.id);
    preferences = { ...preferences, currentTrackId: first.id, repeatMode: "all" };
    expect(selectNextTrackId(state, preferences, actor)).toBe(second.id);
    preferences = { ...preferences, currentTrackId: second.id };
    expect(selectNextTrackId(state, preferences, actor)).toBe(first.id);
    state = toggleTrackHidden(state, first.id, actor, "listener", id());
    expect(eligibleTrackIds(state, preferences, actor)).toEqual([second.id]);
    state = { ...state, policy: { ...state.policy, quietHoursEnabled: true, quietHoursStart: "00:00", quietHoursEnd: "23:59", instrumentalOnlyDuringQuietHours: true } };
    expect(eligibleTrackIds(state, preferences, actor, new Date("2026-07-17T12:00:00"))).toEqual([second.id]);
    expect(isQueueLow(state, preferences, actor)).toBe(true);
  });

  it("validates policy limits", () => {
    const state = createEmptyChannelState(id());
    expect(validatePolicy(state.policy)).toEqual([]);
    expect(validatePolicy({ ...state.policy, songsPerBatch: 9 })).toContain("Songs per batch must be between 1 and 4.");
  });

  it("serializes, reloads, migrates version one, and rejects future or malformed state", () => {
    const state = createEmptyChannelState(id());
    expect(parseChannelState(JSON.parse(serializeChannelState(state)))).toEqual(state);
    const legacy = { schemaVersion: 1, channelId: state.channelId, enabled: true, briefs: [], tracks: [], queue: [], appliedOperationIds: [], updatedAt: instant() };
    expect(parseChannelState(legacy)?.schemaVersion).toBe(3);
    const { briefVotes: _votes, schemaVersion: _schemaVersion, ...versionTwo } = state;
    expect(parseChannelState({ ...versionTwo, schemaVersion: 2 })?.briefVotes).toEqual([]);
    expect(parseChannelState({ ...state, schemaVersion: 99 })).toBeNull();
    expect(parseChannelState({ ...state, queue: [id()] })).toBeNull();
    const preferences = createDefaultPreferences(id(), state.channelId);
    expect(parsePlayerPreferences(JSON.parse(JSON.stringify(preferences)))).toEqual(preferences);
    const { visualizationPalette: _palette, ...legacyPreferences } = preferences;
    expect(parsePlayerPreferences({ ...legacyPreferences, schemaVersion: 1 })?.visualizationPalette).toBe("neon");
    expect(parsePlayerPreferences({ ...preferences, volume: 4 })).toBeNull();
  });
});
