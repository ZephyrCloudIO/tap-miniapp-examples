export type Role = "listener" | "contributor" | "channel-dj";
export type DomainAction = "listen" | "contribute" | "manage";
export type Visibility = "private-draft" | "channel-only" | "workspace-visible";
export type BriefStatus = "draft" | "approved" | "exported" | "superseded" | "rejected";
export type SummaryStatus = "draft" | "approved" | "rejected";
export type RepeatMode = "off" | "all" | "one";
export type VisualizationMode =
  | "frequency"
  | "waveform"
  | "stereo"
  | "particles"
  | "kaleidoscope"
  | "pixel"
  | "color";
export type VisualizationPalette = "neon" | "ocean" | "monochrome";

export interface SourceMessageReference {
  id: string;
  digest: string;
  sequence: number | null;
}

export interface SourceWindow {
  kind: "manual" | "channel-timeline";
  label: string;
  timelineSequence: number | null;
  messages: SourceMessageReference[];
}

export interface PrivacyReview {
  personalDataRemoved: boolean;
  secretsRemoved: boolean;
  sensitiveMomentsExcluded: boolean;
  quotationsApproved: boolean;
  reviewedAt: string;
}

export interface ConversationSummary {
  id: string;
  status: SummaryStatus;
  sourceWindow: SourceWindow;
  safeSummary: string;
  themes: string;
  emotionalArc: string;
  privateDetailsRemoved: string;
  candidateConcepts: string;
  exclusions: string;
  provenance: "manual" | "tap-specialist";
  specialistId: string | null;
  specialistName: string | null;
  privacyReview: PrivacyReview | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
}

export interface SongBrief {
  id: string;
  seriesId: string;
  version: number;
  supersedesId: string | null;
  summaryId: string | null;
  title: string;
  concept: string;
  genre: string;
  mood: string;
  instrumentation: string;
  tempo: string;
  vocalStyle: string;
  structure: string;
  lyricDirection: "lyrics" | "instrumental";
  explicitAllowed: boolean;
  desiredDuration: string;
  sourcePeriod: string;
  channelSummary: string;
  exclusions: string;
  outboundPrompt: string;
  promptFingerprint: string;
  candidateCount: number;
  status: BriefStatus;
  createdAt: string;
  approvedAt: string | null;
  exportedAt: string | null;
}

export interface GenerationBatch {
  id: string;
  briefId: string;
  targetCount: number;
  approvalPolicy: "manual-only";
  status: "awaiting-external-generation" | "partially-imported" | "complete" | "paused";
  importedTrackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BriefVote {
  id: string;
  briefId: string;
  actorKey: string;
  disposition: "support" | "needs-revision";
  suggestedTitle: string;
  suggestedMood: string;
  suggestedGenre: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackFeedback {
  actorKey: string;
  liked: boolean;
  skipCount: number;
  hidden: boolean;
  updatedAt: string;
}

export interface VisibilityReview {
  from: "private-draft" | "channel-only";
  to: "channel-only" | "workspace-visible";
  rightsConfirmed: boolean;
  privacyConfirmed: boolean;
  reviewedAt: string;
}

export interface Track {
  id: string;
  title: string;
  contributor: string;
  provider: string;
  sourceUrl: string | null;
  sourcePeriod: string;
  createdAt: string;
  importedAt: string;
  rightsBasis: string;
  rightsAttested: true;
  briefId: string | null;
  batchId: string | null;
  audioDigest: string;
  fileName: string;
  mimeType: string;
  size: number;
  duration: number;
  mediaPersistence: "browser-preview" | "session-only";
  visibility: Visibility;
  visibilityReviews: VisibilityReview[];
  explicit: boolean;
  instrumental: boolean;
  contentWarning: string;
  feedback: TrackFeedback[];
  retired: boolean;
  retiredAt: string | null;
}

export interface PlaylistPolicy {
  approvalMode: "manual-only";
  replenishmentPaused: boolean;
  lowWatermark: number;
  songsPerBatch: number;
  repetitionLimit: number;
  maxGenerationsPerWeek: number;
  creditBudget: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  instrumentalOnlyDuringQuietHours: boolean;
}

export interface ChannelConsent {
  conversationContextEnabled: boolean;
  notifiedAt: string | null;
}

export interface ChannelState {
  schemaVersion: 3;
  channelId: string;
  enabled: boolean;
  consent: ChannelConsent;
  summaries: ConversationSummary[];
  briefs: SongBrief[];
  briefVotes: BriefVote[];
  batches: GenerationBatch[];
  tracks: Track[];
  queue: string[];
  policy: PlaylistPolicy;
  appliedOperationIds: string[];
  updatedAt: string;
}

export interface PlayerPreferences {
  schemaVersion: 2;
  userKey: string;
  channelId: string;
  currentTrackId: string | null;
  position: number;
  volume: number;
  muted: boolean;
  visualization: VisualizationMode;
  visualizationPalette: VisualizationPalette;
  sensitivity: number;
  fps: 30 | 60;
  reducedMotion: boolean;
  lowPower: boolean;
  broadcastPresence: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  recentlyPlayedIds: string[];
  appliedOperationIds: string[];
  updatedAt: string;
}

export interface SongBriefDraft extends Omit<SongBrief, "status" | "approvedAt" | "exportedAt" | "promptFingerprint"> {
  status?: BriefStatus;
}

export interface TrackImportInput extends Omit<Track, "feedback" | "retired" | "retiredAt" | "visibilityReviews"> {}

export class DomainValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

export class PermissionDeniedError extends Error {
  constructor(action: DomainAction) {
    super(`Your current channel role cannot ${action === "listen" ? "use this control" : action === "contribute" ? "change channel content" : "manage this soundtrack"}.`);
    this.name = "PermissionDeniedError";
  }
}

export class DuplicatePromptError extends Error {
  constructor() {
    super("This outbound prompt substantially duplicates an approved brief. Revise its concept, style, perspective, or exclusions before approval.");
    this.name = "DuplicatePromptError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/u;
const HTTPS_URL = /^https:\/\//iu;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const clean = (value: string): string => value.trim().replace(/\s+/gu, " ");
const nonEmpty = (value: unknown, minimum = 1): value is string => typeof value === "string" && clean(value).length >= minimum;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);
const unique = (values: string[]): boolean => new Set(values).size === values.length;
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export const can = (role: Role, action: DomainAction): boolean =>
  action === "listen" || role === "channel-dj" || (role === "contributor" && action === "contribute");

export const requireRole = (role: Role, action: DomainAction): void => {
  if (!can(role, action)) throw new PermissionDeniedError(action);
};

export const deriveRole = (capabilities: readonly string[]): Role => {
  const normalized = capabilities.map((capability) => capability.toLowerCase());
  if (normalized.some((capability) => /(?:^|[:._-])(manage|admin|owner)(?:$|[:._-])/u.test(capability))) return "channel-dj";
  if (normalized.some((capability) => /message:create|(?:^|[:._-])(write|send|contribute)(?:$|[:._-])/u.test(capability))) return "contributor";
  return "listener";
};

export const createDefaultPolicy = (): PlaylistPolicy => ({
  approvalMode: "manual-only",
  replenishmentPaused: false,
  lowWatermark: 3,
  songsPerBatch: 2,
  repetitionLimit: 3,
  maxGenerationsPerWeek: 6,
  creditBudget: 0,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  instrumentalOnlyDuringQuietHours: false,
});

export const createEmptyChannelState = (channelId: string, at = new Date().toISOString()): ChannelState => ({
  schemaVersion: 3,
  channelId,
  enabled: false,
  consent: { conversationContextEnabled: false, notifiedAt: null },
  summaries: [],
  briefs: [],
  briefVotes: [],
  batches: [],
  tracks: [],
  queue: [],
  policy: createDefaultPolicy(),
  appliedOperationIds: [],
  updatedAt: at,
});

/** Backward-compatible alias retained for consumers of the first example revision. */
export const createEmptyState = createEmptyChannelState;

export const createDefaultPreferences = (userKey: string, channelId: string, at = new Date().toISOString()): PlayerPreferences => ({
  schemaVersion: 2,
  userKey,
  channelId,
  currentTrackId: null,
  position: 0,
  volume: 0.75,
  muted: false,
  visualization: "frequency",
  visualizationPalette: "neon",
  sensitivity: 1,
  fps: 60,
  reducedMotion: false,
  lowPower: false,
  broadcastPresence: false,
  repeatMode: "off",
  shuffle: false,
  recentlyPlayedIds: [],
  appliedOperationIds: [],
  updatedAt: at,
});

export const buildPrompt = (input: Pick<SongBrief, "title" | "concept" | "genre" | "mood" | "instrumentation" | "tempo" | "vocalStyle" | "structure" | "lyricDirection" | "explicitAllowed" | "desiredDuration" | "sourcePeriod" | "channelSummary" | "exclusions" | "candidateCount">): string =>
  [
    `Title: ${clean(input.title)}`,
    `Concept: ${clean(input.concept)}`,
    `Style: ${clean(input.genre)}; ${clean(input.mood)}`,
    `Instrumentation: ${clean(input.instrumentation)}`,
    `Tempo: ${clean(input.tempo) || "Provider-supported range"}`,
    `Vocals: ${input.lyricDirection === "instrumental" ? "Instrumental only" : clean(input.vocalStyle)}`,
    `Structure: ${clean(input.structure) || "Provider-supported song structure"}`,
    `Desired duration or form: ${clean(input.desiredDuration) || "Provider-supported duration"}`,
    `Approved source period: ${clean(input.sourcePeriod)}`,
    `Approved context summary: ${clean(input.channelSummary)}`,
    `Exclude: ${clean(input.exclusions) || "personal data, secrets, customer names, project codenames, and unapproved direct quotations"}`,
    `Explicit content: ${input.explicitAllowed ? "permitted" : "not permitted"}`,
    `Requested candidates: ${clamp(Math.round(input.candidateCount), 1, 4)}`,
  ].join("\n");

export const normalizePrompt = (prompt: string): string =>
  clean(prompt).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");

export const promptFingerprint = (prompt: string): string => {
  const normalized = normalizePrompt(prompt);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const validateBrief = (brief: Partial<SongBriefDraft>): string[] => {
  const required: Array<[keyof SongBriefDraft, string, number]> = [
    ["title", "Title", 2],
    ["concept", "Concept", 8],
    ["genre", "Genre", 2],
    ["mood", "Mood and emotional arc", 2],
    ["instrumentation", "Instrumentation", 2],
    ["sourcePeriod", "Source period", 2],
    ["channelSummary", "Approved summary", 8],
    ["exclusions", "Exclusions", 4],
    ["outboundPrompt", "Exact outbound prompt", 20],
  ];
  const issues = required.flatMap(([key, label, minimum]) =>
    !nonEmpty(brief[key], minimum) ? [`${label} is required.`] : [],
  );
  if (!Number.isInteger(brief.candidateCount) || (brief.candidateCount ?? 0) < 1 || (brief.candidateCount ?? 0) > 4) {
    issues.push("Candidate count must be between 1 and 4.");
  }
  if (brief.lyricDirection === "lyrics" && !nonEmpty(brief.vocalStyle, 2)) issues.push("Vocal direction is required for a lyrical brief.");
  return issues;
};

export const validateSummary = (summary: Partial<ConversationSummary>, approving: boolean): string[] => {
  const issues: string[] = [];
  if (!nonEmpty(summary.safeSummary, 8)) issues.push("A grounded summary is required.");
  if (!nonEmpty(summary.themes, 2)) issues.push("At least one safe theme is required.");
  if (!nonEmpty(summary.emotionalArc, 2)) issues.push("An emotional arc is required.");
  if (!nonEmpty(summary.candidateConcepts, 2)) issues.push("At least one candidate song concept is required.");
  if (!nonEmpty(summary.exclusions, 4)) issues.push("Privacy exclusions are required.");
  if (!summary.sourceWindow || !nonEmpty(summary.sourceWindow.label, 2)) issues.push("A source window is required.");
  if (approving) {
    const review = summary.privacyReview;
    if (!review?.personalDataRemoved || !review.secretsRemoved || !review.sensitiveMomentsExcluded || !review.quotationsApproved) {
      issues.push("Complete every privacy and quotation approval check before approving this summary.");
    }
  }
  return issues;
};

export const validateTrackImport = (track: Partial<TrackImportInput>): string[] => {
  const issues: string[] = [];
  for (const [value, label, minimum] of [
    [track.title, "Track title", 2],
    [track.contributor, "Contributor", 2],
    [track.provider, "Source or provider", 2],
    [track.sourcePeriod, "Creation or source period", 2],
    [track.rightsBasis, "Subscription or license basis", 4],
    [track.audioDigest, "Audio digest", 16],
    [track.fileName, "File name", 1],
    [track.mimeType, "Media type", 3],
  ] as const) {
    if (!nonEmpty(value, minimum)) issues.push(`${label} is required.`);
  }
  if (track.rightsAttested !== true) issues.push("Rights attestation is required.");
  if (!finite(track.size) || (track.size ?? 0) <= 0) issues.push("The audio file must not be empty.");
  if (!finite(track.duration) || (track.duration ?? 0) <= 0) issues.push("The selected file must expose a positive audio duration.");
  if (track.sourceUrl !== null && track.sourceUrl !== undefined && track.sourceUrl !== "" && !HTTPS_URL.test(track.sourceUrl)) {
    issues.push("Source link must use HTTPS.");
  }
  if (track.visibility === "workspace-visible") issues.push("Workspace visibility requires a separate album review after import.");
  return issues;
};

const rememberOperation = <T extends { appliedOperationIds: string[]; updatedAt: string }>(value: T, operationId: string, at: string): T => ({
  ...value,
  appliedOperationIds: [...value.appliedOperationIds.slice(-199), operationId],
  updatedAt: at,
});

export const applyChannelOperation = (
  state: ChannelState,
  operationId: string,
  change: (value: ChannelState) => ChannelState,
  at = new Date().toISOString(),
): ChannelState => {
  if (state.appliedOperationIds.includes(operationId)) return state;
  return rememberOperation(change(state), operationId, at);
};

export const applyPreferenceOperation = (
  state: PlayerPreferences,
  operationId: string,
  change: (value: PlayerPreferences) => PlayerPreferences,
  at = new Date().toISOString(),
): PlayerPreferences => {
  if (state.appliedOperationIds.includes(operationId)) return state;
  return rememberOperation(change(state), operationId, at);
};

/** Backward-compatible helper for the first public example revision. */
export const applyOnce = applyChannelOperation;

export interface SaveBriefOptions {
  role: Role;
  operationId: string;
  approve: boolean;
  batchId: string;
  at?: string;
}

export const saveBriefVersion = (state: ChannelState, draft: SongBriefDraft, options: SaveBriefOptions): ChannelState => {
  requireRole(options.role, "contribute");
  const at = options.at ?? new Date().toISOString();
  const exactPrompt = clean(draft.outboundPrompt).length >= 20 ? draft.outboundPrompt.trim() : buildPrompt(draft);
  const candidate: SongBrief = {
    ...draft,
    outboundPrompt: exactPrompt,
    promptFingerprint: promptFingerprint(exactPrompt),
    status: options.approve ? "approved" : "draft",
    approvedAt: options.approve ? at : null,
    exportedAt: null,
  };
  const issues = validateBrief(candidate);
  if (issues.length > 0) throw new DomainValidationError(issues);
  if (candidate.summaryId && !state.summaries.some((summary) => summary.id === candidate.summaryId && summary.status === "approved")) {
    throw new DomainValidationError(["A linked conversation summary must be approved before it can seed a song brief."]);
  }
  if (options.approve && state.briefs.some((brief) => brief.id !== candidate.id && ["approved", "exported"].includes(brief.status) && brief.promptFingerprint === candidate.promptFingerprint)) {
    throw new DuplicatePromptError();
  }
  return applyChannelOperation(state, options.operationId, (current) => {
    const previous = candidate.supersedesId ? current.briefs.find((brief) => brief.id === candidate.supersedesId) : undefined;
    if (previous && !["approved", "exported"].includes(previous.status)) {
      throw new DomainValidationError(["Only an approved or exported brief can be superseded."]);
    }
    const retained = current.briefs
      .filter((brief) => brief.id !== candidate.id)
      .map((brief) => previous?.id === brief.id ? { ...brief, status: "superseded" as const } : brief);
    const batches = options.approve
      ? [...current.batches, {
          id: options.batchId,
          briefId: candidate.id,
          targetCount: candidate.candidateCount,
          approvalPolicy: "manual-only" as const,
          status: "awaiting-external-generation" as const,
          importedTrackIds: [],
          createdAt: at,
          updatedAt: at,
        }]
      : current.batches;
    return { ...current, briefs: [...retained, candidate], batches };
  }, at);
};

export const recordBriefVote = (
  state: ChannelState,
  vote: BriefVote,
  role: Role,
  operationId: string,
  at = new Date().toISOString(),
): ChannelState => {
  requireRole(role, "listen");
  const brief = state.briefs.find((candidate) => candidate.id === vote.briefId);
  if (!brief || brief.status === "superseded" || brief.status === "rejected") throw new DomainValidationError(["That brief is not open for participant feedback."]);
  if (!nonEmpty(vote.id) || !nonEmpty(vote.actorKey) || !oneOf(vote.disposition, ["support", "needs-revision"] as const)) {
    throw new DomainValidationError(["A valid participant brief vote is required."]);
  }
  const suggestions = [vote.suggestedTitle, vote.suggestedMood, vote.suggestedGenre];
  if (suggestions.some((value) => typeof value !== "string" || value.length > 160)) throw new DomainValidationError(["Brief suggestions must be 160 characters or fewer."]);
  return applyChannelOperation(state, operationId, (current) => {
    const existing = current.briefVotes.find((candidate) => candidate.briefId === vote.briefId && candidate.actorKey === vote.actorKey);
    const normalized: BriefVote = {
      ...vote,
      id: existing?.id ?? vote.id,
      suggestedTitle: clean(vote.suggestedTitle),
      suggestedMood: clean(vote.suggestedMood),
      suggestedGenre: clean(vote.suggestedGenre),
      createdAt: existing?.createdAt ?? vote.createdAt,
      updatedAt: at,
    };
    return {
      ...current,
      briefVotes: [...current.briefVotes.filter((candidate) => candidate.id !== normalized.id), normalized],
    };
  }, at);
};

export const markBriefExported = (state: ChannelState, briefId: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "contribute");
  const brief = state.briefs.find((item) => item.id === briefId);
  if (!brief || !["approved", "exported"].includes(brief.status)) throw new DomainValidationError(["Only an approved brief can be exported."]);
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    briefs: current.briefs.map((item) => item.id === briefId ? { ...item, status: "exported", exportedAt: at } : item),
  }), at);
};

export const saveSummary = (state: ChannelState, summary: ConversationSummary, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "contribute");
  const issues = validateSummary(summary, summary.status === "approved");
  if (issues.length > 0) throw new DomainValidationError(issues);
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    summaries: [...current.summaries.filter((item) => item.id !== summary.id), summary],
  }), at);
};

export const importTrack = (state: ChannelState, input: TrackImportInput, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "contribute");
  const issues = validateTrackImport(input);
  if (issues.length > 0) throw new DomainValidationError(issues);
  if (state.tracks.some((track) => track.audioDigest === input.audioDigest && !track.retired)) {
    throw new DomainValidationError(["This audio file is already present in the active channel album."]);
  }
  const track: Track = { ...input, feedback: [], visibilityReviews: [], retired: false, retiredAt: null };
  return applyChannelOperation(state, operationId, (current) => {
    const batches = current.batches.map((batch) => {
      if (batch.id !== track.batchId) return batch;
      const importedTrackIds = [...new Set([...batch.importedTrackIds, track.id])];
      return {
        ...batch,
        importedTrackIds,
        status: importedTrackIds.length >= batch.targetCount ? "complete" as const : "partially-imported" as const,
        updatedAt: at,
      };
    });
    return { ...current, tracks: [...current.tracks, track], queue: [...current.queue, track.id], batches };
  }, at);
};

const updateFeedback = (track: Track, actorKey: string, at: string, updater: (feedback: TrackFeedback) => TrackFeedback): Track => {
  const existing = track.feedback.find((entry) => entry.actorKey === actorKey) ?? { actorKey, liked: false, skipCount: 0, hidden: false, updatedAt: at };
  const next = updater(existing);
  return { ...track, feedback: [...track.feedback.filter((entry) => entry.actorKey !== actorKey), next] };
};

export const toggleTrackLike = (state: ChannelState, trackId: string, actorKey: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "listen");
  if (!state.tracks.some((track) => track.id === trackId)) throw new DomainValidationError(["Track no longer exists."]);
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((track) => track.id === trackId ? updateFeedback(track, actorKey, at, (feedback) => ({ ...feedback, liked: !feedback.liked, updatedAt: at })) : track),
  }), at);
};

export const recordTrackSkip = (state: ChannelState, trackId: string, actorKey: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "listen");
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((track) => track.id === trackId ? updateFeedback(track, actorKey, at, (feedback) => ({ ...feedback, skipCount: feedback.skipCount + 1, updatedAt: at })) : track),
  }), at);
};

export const toggleTrackHidden = (state: ChannelState, trackId: string, actorKey: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "listen");
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((track) => track.id === trackId ? updateFeedback(track, actorKey, at, (feedback) => ({ ...feedback, hidden: !feedback.hidden, updatedAt: at })) : track),
  }), at);
};

export const retireTrack = (state: ChannelState, trackId: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "manage");
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((track) => track.id === trackId ? { ...track, retired: true, retiredAt: at } : track),
    queue: current.queue.filter((id) => id !== trackId),
  }), at);
};

export const restoreRetiredTrack = (state: ChannelState, trackId: string, role: Role, operationId: string, at = new Date().toISOString()): ChannelState => {
  requireRole(role, "manage");
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  if (!track?.retired) throw new DomainValidationError(["Only a retired track can be restored."]);
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((candidate) => candidate.id === trackId ? { ...candidate, retired: false, retiredAt: null } : candidate),
    queue: current.queue.includes(trackId) ? current.queue : [...current.queue, trackId],
  }), at);
};

export const reviewTrackVisibility = (
  state: ChannelState,
  trackId: string,
  target: "channel-only" | "workspace-visible",
  role: Role,
  operationId: string,
  at = new Date().toISOString(),
): ChannelState => {
  requireRole(role, "manage");
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new DomainValidationError(["Track no longer exists."]);
  if (track.visibility === target) return state;
  if (track.visibility === "workspace-visible" && target !== "workspace-visible") throw new DomainValidationError(["Narrowing a workspace-visible track requires a retention review outside this example."]);
  const review: VisibilityReview = {
    from: track.visibility === "workspace-visible" ? "channel-only" : track.visibility,
    to: target,
    rightsConfirmed: true,
    privacyConfirmed: true,
    reviewedAt: at,
  };
  return applyChannelOperation(state, operationId, (current) => ({
    ...current,
    tracks: current.tracks.map((candidate) => candidate.id === trackId ? { ...candidate, visibility: target, visibilityReviews: [...candidate.visibilityReviews, review] } : candidate),
  }), at);
};

export const trackLikeCount = (track: Track): number => track.feedback.filter((entry) => entry.liked).length;
export const actorFeedback = (track: Track, actorKey: string): TrackFeedback | undefined => track.feedback.find((entry) => entry.actorKey === actorKey);

const minutes = (value: string): number => {
  const [hours = "0", mins = "0"] = value.split(":");
  return Number(hours) * 60 + Number(mins);
};

export const isQuietHours = (policy: PlaylistPolicy, date = new Date()): boolean => {
  if (!policy.quietHoursEnabled || !TIME.test(policy.quietHoursStart) || !TIME.test(policy.quietHoursEnd)) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  const start = minutes(policy.quietHoursStart);
  const end = minutes(policy.quietHoursEnd);
  return start <= end ? current >= start && current < end : current >= start || current < end;
};

export const eligibleTrackIds = (state: ChannelState, preferences: PlayerPreferences, actorKey: string, date = new Date()): string[] => {
  const instrumentalOnly = state.policy.instrumentalOnlyDuringQuietHours && isQuietHours(state.policy, date);
  return state.queue.filter((id) => {
    const track = state.tracks.find((candidate) => candidate.id === id);
    if (!track || track.retired || actorFeedback(track, actorKey)?.hidden) return false;
    return !instrumentalOnly || track.instrumental;
  });
};

export const selectNextTrackId = (
  state: ChannelState,
  preferences: PlayerPreferences,
  actorKey: string,
  direction: 1 | -1 = 1,
  random: () => number = Math.random,
  date = new Date(),
): string | null => {
  const eligible = eligibleTrackIds(state, preferences, actorKey, date);
  if (eligible.length === 0) return null;
  const current = preferences.currentTrackId;
  if (preferences.repeatMode === "one" && current && eligible.includes(current)) return current;
  if (preferences.shuffle) {
    const recent = new Set(preferences.recentlyPlayedIds.slice(-state.policy.repetitionLimit));
    const fresh = eligible.filter((id) => id !== current && !recent.has(id));
    const pool = fresh.length > 0 ? fresh : eligible.filter((id) => id !== current);
    if (pool.length === 0) return preferences.repeatMode === "all" ? eligible[0] ?? null : null;
    return pool[Math.min(pool.length - 1, Math.floor(clamp(random(), 0, 0.999999) * pool.length))] ?? null;
  }
  const index = current ? eligible.indexOf(current) : -1;
  const nextIndex = index + direction;
  if (nextIndex >= 0 && nextIndex < eligible.length) return eligible[nextIndex] ?? null;
  if (preferences.repeatMode === "all") return direction === 1 ? eligible[0] ?? null : eligible.at(-1) ?? null;
  return current === null ? eligible[0] ?? null : null;
};

export const isQueueLow = (state: ChannelState, preferences: PlayerPreferences, actorKey: string): boolean =>
  !state.policy.replenishmentPaused && eligibleTrackIds(state, preferences, actorKey).length < state.policy.lowWatermark;

export const validatePolicy = (policy: PlaylistPolicy): string[] => {
  const issues: string[] = [];
  if (!Number.isInteger(policy.lowWatermark) || policy.lowWatermark < 1 || policy.lowWatermark > 25) issues.push("Queue low watermark must be between 1 and 25.");
  if (!Number.isInteger(policy.songsPerBatch) || policy.songsPerBatch < 1 || policy.songsPerBatch > 4) issues.push("Songs per batch must be between 1 and 4.");
  if (!Number.isInteger(policy.repetitionLimit) || policy.repetitionLimit < 0 || policy.repetitionLimit > 25) issues.push("Repetition limit must be between 0 and 25.");
  if (!Number.isInteger(policy.maxGenerationsPerWeek) || policy.maxGenerationsPerWeek < 0 || policy.maxGenerationsPerWeek > 100) issues.push("Weekly generation limit must be between 0 and 100.");
  if (!finite(policy.creditBudget) || policy.creditBudget < 0) issues.push("Credit budget cannot be negative.");
  if (!TIME.test(policy.quietHoursStart) || !TIME.test(policy.quietHoursEnd)) issues.push("Quiet hours must use 24-hour HH:MM values.");
  return issues;
};

const validSourceReference = (value: unknown): value is SourceMessageReference => record(value) && nonEmpty(value.id) && nonEmpty(value.digest) && (value.sequence === null || finite(value.sequence));
const validSourceWindow = (value: unknown): value is SourceWindow => record(value) && oneOf(value.kind, ["manual", "channel-timeline"] as const) && nonEmpty(value.label) && (value.timelineSequence === null || finite(value.timelineSequence)) && Array.isArray(value.messages) && value.messages.every(validSourceReference);
const validPrivacyReview = (value: unknown): value is PrivacyReview => record(value) && value.personalDataRemoved === true && value.secretsRemoved === true && value.sensitiveMomentsExcluded === true && value.quotationsApproved === true && nonEmpty(value.reviewedAt) && ISO_DATE.test(value.reviewedAt);
const validSummary = (value: unknown): value is ConversationSummary => record(value)
  && nonEmpty(value.id)
  && oneOf(value.status, ["draft", "approved", "rejected"] as const)
  && validSourceWindow(value.sourceWindow)
  && nonEmpty(value.safeSummary)
  && nonEmpty(value.themes)
  && nonEmpty(value.emotionalArc)
  && typeof value.privateDetailsRemoved === "string"
  && nonEmpty(value.candidateConcepts)
  && nonEmpty(value.exclusions)
  && oneOf(value.provenance, ["manual", "tap-specialist"] as const)
  && (value.specialistId === null || nonEmpty(value.specialistId))
  && (value.specialistName === null || nonEmpty(value.specialistName))
  && (value.privacyReview === null || validPrivacyReview(value.privacyReview))
  && nonEmpty(value.createdAt)
  && (value.approvedAt === null || nonEmpty(value.approvedAt))
  && (value.rejectedAt === null || nonEmpty(value.rejectedAt));

const validBrief = (value: unknown): value is SongBrief => record(value)
  && nonEmpty(value.id)
  && nonEmpty(value.seriesId)
  && Number.isInteger(value.version)
  && Number(value.version) >= 1
  && (value.supersedesId === null || nonEmpty(value.supersedesId))
  && (value.summaryId === null || nonEmpty(value.summaryId))
  && nonEmpty(value.title)
  && nonEmpty(value.concept)
  && nonEmpty(value.genre)
  && nonEmpty(value.mood)
  && nonEmpty(value.instrumentation)
  && typeof value.tempo === "string"
  && typeof value.vocalStyle === "string"
  && typeof value.structure === "string"
  && oneOf(value.lyricDirection, ["lyrics", "instrumental"] as const)
  && typeof value.explicitAllowed === "boolean"
  && typeof value.desiredDuration === "string"
  && nonEmpty(value.sourcePeriod)
  && nonEmpty(value.channelSummary)
  && nonEmpty(value.exclusions)
  && nonEmpty(value.outboundPrompt)
  && nonEmpty(value.promptFingerprint)
  && Number.isInteger(value.candidateCount)
  && oneOf(value.status, ["draft", "approved", "exported", "superseded", "rejected"] as const)
  && nonEmpty(value.createdAt)
  && (value.approvedAt === null || nonEmpty(value.approvedAt))
  && (value.exportedAt === null || nonEmpty(value.exportedAt));

const validBatch = (value: unknown): value is GenerationBatch => record(value)
  && nonEmpty(value.id)
  && nonEmpty(value.briefId)
  && Number.isInteger(value.targetCount)
  && value.approvalPolicy === "manual-only"
  && oneOf(value.status, ["awaiting-external-generation", "partially-imported", "complete", "paused"] as const)
  && Array.isArray(value.importedTrackIds)
  && value.importedTrackIds.every(nonEmpty)
  && nonEmpty(value.createdAt)
  && nonEmpty(value.updatedAt);

const validBriefVote = (value: unknown): value is BriefVote => record(value)
  && nonEmpty(value.id)
  && nonEmpty(value.briefId)
  && nonEmpty(value.actorKey)
  && oneOf(value.disposition, ["support", "needs-revision"] as const)
  && typeof value.suggestedTitle === "string"
  && value.suggestedTitle.length <= 160
  && typeof value.suggestedMood === "string"
  && value.suggestedMood.length <= 160
  && typeof value.suggestedGenre === "string"
  && value.suggestedGenre.length <= 160
  && nonEmpty(value.createdAt)
  && ISO_DATE.test(value.createdAt)
  && nonEmpty(value.updatedAt)
  && ISO_DATE.test(value.updatedAt);

const validFeedback = (value: unknown): value is TrackFeedback => record(value) && nonEmpty(value.actorKey) && typeof value.liked === "boolean" && Number.isInteger(value.skipCount) && Number(value.skipCount) >= 0 && typeof value.hidden === "boolean" && nonEmpty(value.updatedAt);
const validVisibilityReview = (value: unknown): value is VisibilityReview => record(value) && oneOf(value.from, ["private-draft", "channel-only"] as const) && oneOf(value.to, ["channel-only", "workspace-visible"] as const) && value.rightsConfirmed === true && value.privacyConfirmed === true && nonEmpty(value.reviewedAt);
const validTrack = (value: unknown): value is Track => record(value)
  && nonEmpty(value.id)
  && nonEmpty(value.title)
  && nonEmpty(value.contributor)
  && nonEmpty(value.provider)
  && (value.sourceUrl === null || (nonEmpty(value.sourceUrl) && HTTPS_URL.test(value.sourceUrl)))
  && nonEmpty(value.sourcePeriod)
  && nonEmpty(value.createdAt)
  && nonEmpty(value.importedAt)
  && nonEmpty(value.rightsBasis)
  && value.rightsAttested === true
  && (value.briefId === null || nonEmpty(value.briefId))
  && (value.batchId === null || nonEmpty(value.batchId))
  && nonEmpty(value.audioDigest)
  && nonEmpty(value.fileName)
  && nonEmpty(value.mimeType)
  && finite(value.size)
  && value.size > 0
  && finite(value.duration)
  && value.duration > 0
  && oneOf(value.mediaPersistence, ["browser-preview", "session-only"] as const)
  && oneOf(value.visibility, ["private-draft", "channel-only", "workspace-visible"] as const)
  && Array.isArray(value.visibilityReviews)
  && value.visibilityReviews.every(validVisibilityReview)
  && typeof value.explicit === "boolean"
  && typeof value.instrumental === "boolean"
  && typeof value.contentWarning === "string"
  && Array.isArray(value.feedback)
  && value.feedback.every(validFeedback)
  && typeof value.retired === "boolean"
  && (value.retiredAt === null || nonEmpty(value.retiredAt));

const validPolicy = (value: unknown): value is PlaylistPolicy => record(value)
  && value.approvalMode === "manual-only"
  && typeof value.replenishmentPaused === "boolean"
  && Number.isInteger(value.lowWatermark)
  && Number.isInteger(value.songsPerBatch)
  && Number.isInteger(value.repetitionLimit)
  && Number.isInteger(value.maxGenerationsPerWeek)
  && finite(value.creditBudget)
  && typeof value.quietHoursEnabled === "boolean"
  && typeof value.quietHoursStart === "string"
  && typeof value.quietHoursEnd === "string"
  && typeof value.instrumentalOnlyDuringQuietHours === "boolean"
  && validatePolicy(value as unknown as PlaylistPolicy).length === 0;

const migrateVersionOne = (value: Record<string, unknown>): ChannelState | null => {
  if (value.schemaVersion !== 1 || !nonEmpty(value.channelId)) return null;
  const at = nonEmpty(value.updatedAt) ? value.updatedAt : new Date().toISOString();
  const base = createEmptyChannelState(value.channelId, at);
  const legacyTracks = Array.isArray(value.tracks) ? value.tracks : [];
  const tracks: Track[] = legacyTracks.flatMap((candidate) => {
    if (!record(candidate) || !nonEmpty(candidate.id) || !nonEmpty(candidate.title) || !nonEmpty(candidate.audioDigest)) return [];
    const visibility = oneOf(candidate.visibility, ["private-draft", "channel-only", "workspace-visible"] as const) ? candidate.visibility : "channel-only";
    const duration = finite(candidate.duration) && candidate.duration > 0 ? candidate.duration : 0.001;
    const size = finite(candidate.size) && candidate.size > 0 ? candidate.size : 1;
    return [{
      id: candidate.id,
      title: candidate.title,
      contributor: nonEmpty(candidate.contributor) ? candidate.contributor : "Unknown contributor",
      provider: nonEmpty(candidate.provider) ? candidate.provider : "Imported audio",
      sourceUrl: null,
      sourcePeriod: nonEmpty(candidate.sourcePeriod) ? candidate.sourcePeriod : "Unknown source period",
      createdAt: nonEmpty(candidate.createdAt) ? candidate.createdAt : at,
      importedAt: nonEmpty(candidate.importedAt) ? candidate.importedAt : at,
      rightsBasis: nonEmpty(candidate.rightsBasis) ? candidate.rightsBasis : "Legacy rights attestation",
      rightsAttested: true as const,
      briefId: nonEmpty(candidate.briefId) ? candidate.briefId : null,
      batchId: null,
      audioDigest: candidate.audioDigest,
      fileName: nonEmpty(candidate.fileName) ? candidate.fileName : "legacy-audio",
      mimeType: nonEmpty(candidate.mimeType) ? candidate.mimeType : "audio/unknown",
      size,
      duration,
      mediaPersistence: "session-only" as const,
      visibility,
      visibilityReviews: [],
      explicit: candidate.explicit === true,
      instrumental: false,
      contentWarning: typeof candidate.contentWarning === "string" ? candidate.contentWarning : "",
      feedback: [],
      retired: candidate.retired === true,
      retiredAt: candidate.retired === true ? at : null,
    }];
  });
  return {
    ...base,
    enabled: value.enabled === true,
    tracks,
    queue: Array.isArray(value.queue) ? value.queue.filter((id): id is string => nonEmpty(id) && tracks.some((track) => track.id === id && !track.retired)) : [],
    appliedOperationIds: Array.isArray(value.appliedOperationIds) ? value.appliedOperationIds.filter(nonEmpty) : [],
  };
};

const migrateVersionTwo = (value: Record<string, unknown>): Record<string, unknown> => ({
  ...structuredClone(value),
  schemaVersion: 3,
  briefVotes: [],
});

export const parseChannelState = (value: unknown): ChannelState | null => {
  if (!record(value)) return null;
  if (value.schemaVersion === 1) return migrateVersionOne(value);
  const candidate = value.schemaVersion === 2 ? migrateVersionTwo(value) : value;
  if (candidate.schemaVersion !== 3
    || !nonEmpty(candidate.channelId)
    || typeof candidate.enabled !== "boolean"
    || !record(candidate.consent)
    || typeof candidate.consent.conversationContextEnabled !== "boolean"
    || (candidate.consent.notifiedAt !== null && !nonEmpty(candidate.consent.notifiedAt))
    || !Array.isArray(candidate.summaries)
    || !candidate.summaries.every(validSummary)
    || !Array.isArray(candidate.briefs)
    || !candidate.briefs.every(validBrief)
    || !Array.isArray(candidate.briefVotes)
    || !candidate.briefVotes.every(validBriefVote)
    || !Array.isArray(candidate.batches)
    || !candidate.batches.every(validBatch)
    || !Array.isArray(candidate.tracks)
    || !candidate.tracks.every(validTrack)
    || !Array.isArray(candidate.queue)
    || !candidate.queue.every(nonEmpty)
    || !unique(candidate.queue)
    || !validPolicy(candidate.policy)
    || !Array.isArray(candidate.appliedOperationIds)
    || !candidate.appliedOperationIds.every(nonEmpty)
    || !nonEmpty(candidate.updatedAt)) return null;
  const state = candidate as unknown as ChannelState;
  const trackIds = new Set(state.tracks.map((track) => track.id));
  const briefIds = new Set(state.briefs.map((brief) => brief.id));
  if (!unique([...trackIds]) || !unique([...briefIds]) || state.queue.some((id) => !trackIds.has(id))) return null;
  if (state.batches.some((batch) => !briefIds.has(batch.briefId) || batch.importedTrackIds.some((id) => !trackIds.has(id)))) return null;
  if (state.briefVotes.some((vote) => !briefIds.has(vote.briefId))) return null;
  if (!unique(state.briefVotes.map((vote) => `${vote.briefId}:${vote.actorKey}`))) return null;
  return structuredClone(state);
};

export const isChannelState = (value: unknown): value is ChannelState => parseChannelState(value) !== null;

export const parsePlayerPreferences = (value: unknown): PlayerPreferences | null => {
  if (!record(value)
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    || !nonEmpty(value.userKey)
    || !nonEmpty(value.channelId)
    || (value.currentTrackId !== null && !nonEmpty(value.currentTrackId))
    || !finite(value.position)
    || value.position < 0
    || !finite(value.volume)
    || value.volume < 0
    || value.volume > 1
    || typeof value.muted !== "boolean"
    || !oneOf(value.visualization, ["frequency", "waveform", "stereo", "particles", "kaleidoscope", "pixel", "color"] as const)
    || (value.schemaVersion === 2 && !oneOf(value.visualizationPalette, ["neon", "ocean", "monochrome"] as const))
    || !finite(value.sensitivity)
    || value.sensitivity < 0.5
    || value.sensitivity > 1.5
    || (value.fps !== 30 && value.fps !== 60)
    || typeof value.reducedMotion !== "boolean"
    || typeof value.lowPower !== "boolean"
    || typeof value.broadcastPresence !== "boolean"
    || !oneOf(value.repeatMode, ["off", "all", "one"] as const)
    || typeof value.shuffle !== "boolean"
    || !Array.isArray(value.recentlyPlayedIds)
    || !value.recentlyPlayedIds.every(nonEmpty)
    || !Array.isArray(value.appliedOperationIds)
    || !value.appliedOperationIds.every(nonEmpty)
    || !nonEmpty(value.updatedAt)) return null;
  return {
    ...structuredClone(value),
    schemaVersion: 2,
    visualizationPalette: value.schemaVersion === 2 ? value.visualizationPalette as PlayerPreferences["visualizationPalette"] : "neon",
  } as PlayerPreferences;
};

export const serializeChannelState = (state: ChannelState): string => JSON.stringify(state);
export const serializePlayerPreferences = (preferences: PlayerPreferences): string => JSON.stringify(preferences);

export const digestFile = async (file: Blob): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const digestText = async (text: string): Promise<string> =>
  digestFile(new Blob([text], { type: "text/plain" }));
