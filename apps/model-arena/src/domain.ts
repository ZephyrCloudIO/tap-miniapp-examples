/* ==========================================================================
   Model Arena — Domain Types
   ========================================================================== */

/** Comparison mode: one-shot, rework validation, model/specialist benchmark,
 *  or a role-chained pipeline (plan → deliver → review). */
export enum ComparisonMode {
  OneShot = "one-shot",
  Rework = "rework",
  Benchmark = "benchmark",
  Pipeline = "pipeline",
}

/** Benchmark arm: direct model calls vs specialist-orchestrated turns. */
export type BenchmarkArm = "model" | "specialist";

/** One option a pipeline role can run with: a model plus its arm. */
export interface PipelineRoleOption {
  model: SelectedModel;
  arm: BenchmarkArm;
}

/** One role in a pipeline chain. Each role offers one or more options; the
 *  options across roles expand into full runs (see pipeline.ts). */
export interface PipelineRole {
  id: string;
  label: string;
  /** Role instruction prepended to the task context. */
  instruction: string;
  options: PipelineRoleOption[];
}

/** A model selected for comparison. */
export interface SelectedModel {
  id: string; // e.g. "openai/gpt-4o"
  name: string;
  provider: string;
}

/** A single model's output at a given stage. Stage 1 is the initial
 *  generation; stages 2..N are rework rounds (stage = iteration + 1). */
export interface ModelOutput {
  stage: number;
  text: string;
  finishReason: string;
  tokens: TokenCount;
  latencyMs: number;
  /** Null in TAP's current unary inference transport. */
  ttftMs: number | undefined;
  costMicros: number | undefined;
  /** Canonical host turn used to correlate content-free telemetry. */
  turnId?: string | undefined;
  generationId: string | undefined;
  /** Effective model after host routing/alias resolution. */
  modelUsed?: string | undefined;
  providerUsed: string | undefined;
  fallbackChain: string[] | undefined;
  /** True when TAP used a host-managed provider route. */
  managed?: boolean;
  /** Whether the effective managed route applied zero-data-retention policy. */
  zdrApplied?: boolean;
  /** True when token counts were estimated locally (e.g. specialist turns,
   *  where the host returns text but not usage). */
  estimated?: boolean;
}

/** Token counts reported by the effective managed provider route. */
export interface TokenCount {
  prompt: number;
  completion: number;
  total: number;
  reasoning: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
}

/** Metrics for one rework round (stage k vs stage k-1). */
export interface ReworkRoundMetrics {
  /** Stage number of this round's revised output (2 = first rework). */
  stage: number;
  /** Provider-reported (or locally estimated) completion tokens produced in this round. */
  regeneratedTokens: number;
  /** Normalized lexical tokens from the previous text that did not survive this round. */
  discardedTokens: number;
  /** Multiset lexical-token overlap with the previous text (moved tokens still survive). */
  retentionRate: number | undefined;
  /** Turn pressure r_i for this round. */
  turnPressure: number | undefined;
  /** Cost of this round in micros. */
  costMicros: number | undefined;
  /** Latency of this round in ms. */
  latencyMs: number;
}

/** Local lexical rework metrics for a single model in a session. */
export interface TrrMetrics {
  /** Provider-reported (or locally estimated) completion tokens emitted at stage 1. */
  stage1Tokens: number;
  /** Per-round rework metrics, one entry per stage >= 2. */
  rounds: ReworkRoundMetrics[];
  /** Stage-1 normalized lexical tokens absent from the final text. */
  discardedTokens: number | undefined;
  /** Multiset lexical-token overlap between stage 1 and the final text. */
  retentionRate: number | undefined;
  /** Aggregate turn pressure r_i (max across rounds). */
  turnPressure: number | undefined;
  /** Effective cost per retained normalized lexical token in micros. */
  ecrtMicros: number | undefined;
  /** Total cost across all stages in micros; unknown if any stage lacks cost. */
  totalCostMicros: number | undefined;
}

/** Per-model result in a comparison session. */
export interface ModelResult {
  model: SelectedModel;
  /** Benchmark arm this result belongs to; undefined outside benchmark mode. */
  arm?: BenchmarkArm | undefined;
  /** Pipeline role label this result fulfills; undefined outside pipeline mode. */
  role?: string | undefined;
  /** Stable pipeline role ID; unlike the display label, this must not be localized or renamed. */
  roleId?: string | undefined;
  /** Zero-based position of this result within its pipeline run. */
  stepIndex?: number | undefined;
  /** Pipeline run index this result belongs to (matrix/linear expansion). */
  runIndex?: number | undefined;
  outputs: ModelOutput[];
  trr: TrrMetrics;
  /** Human VCV feedback (optional). */
  vcvFeedback:
    | {
        responseAcceptable: boolean | undefined;
        routingAppropriate: boolean | undefined;
      }
    | undefined;
}

/** Session state lifecycle. */
export enum SessionState {
  Draft = "draft",
  Running = "running",
  Completed = "completed",
  ReworkRunning = "rework_running",
  ReworkCompleted = "rework_completed",
  Shared = "shared",
  Archived = "archived",
}

/** A complete comparison session. */
export interface ModelComparisonSession {
  id: string;
  state: SessionState;
  createdAt: string;
  creator: string;
  mode: ComparisonMode;
  prompt: string;
  systemPrompt: string | undefined;
  parameters: ModelParameters;
  models: SelectedModel[];
  results: ModelResult[];
  /** Number of rework rounds to run when mode is Rework (1 = single critique+revise). */
  reworkRounds: number;
  /** Critique template fed back to each model each rework round. Use {{output}} as placeholder. */
  critiquePrompt: string | undefined;
  /** Ordered role chain when mode is Pipeline. */
  pipelineRoles: PipelineRole[] | undefined;
  /** How pipeline role options expand into runs. */
  pipelineCombination: "matrix" | "linear" | undefined;
  linkedMessages: string[] | undefined;
  tags: string[] | undefined;
  parentSessionId: string | undefined;
  /** Present only after the complete artifact set was written successfully. */
  vfsArtifactReceipt?: {
    root: string;
    written: number;
    writtenAt: string;
  } | undefined;
  /** Durable artifact outcome for transparent denied/failed-write reporting. */
  vfsArtifactStatus?: "written" | "not-authorized" | "failed" | undefined;
  /** Present only when the bounded browser ledger could not retain this run. */
  localPersistenceFailure?:
    | "storage-unavailable"
    | "session-too-large"
    | "quota"
    | undefined;
}

/** Generation parameters. Fields left undefined are omitted so the managed
 *  inference API default applies (`maxTokens` defaults to 4,096). */
export interface ModelParameters {
  temperature: number | undefined;
  maxTokens: number | undefined;
  /** Legacy session field. Managed inference does not accept this control. */
  topP: number | undefined;
  /** Legacy session field. TAP owns provider routing for managed inference. */
  providerSort: "price" | "throughput" | "latency" | undefined;
  /** Legacy requested setting. Read the effective `ModelOutput.zdrApplied` instead. */
  zdr: boolean | undefined;
}

/** Content-free TRR event: TokenBatchProduced. */
export interface TrrTokenBatchProduced {
  revisionId: string;
  workspaceId: string;
  messageId: string;
  modelId: string;
  providerId: string | undefined;
  graphemesAtEmit: number;
  tokensAtEmit: number;
  costMicros: number | undefined;
  emittedAt: number;
}

/** Content-free TRR event: TurnStamped (subset relevant to Model Arena). */
export interface TrrTurnStamped {
  turnId: string;
  workspaceId: string;
  modelId: string | undefined;
  providerId: string | undefined;
  promptTokens: number;
  outputTokens: number;
  iterationCount: number;
  discardedCompletionTokens: number;
  regeneratedTokenCount: number;
  ttftMs: number | undefined;
  totalLatencyMs: number;
  costMicros: number | undefined;
  fallbackChain: string[];
  startedAt: number;
  completedAt: number;
}

/** Content-free TRR event: TurnPressureShadowed. */
export interface TrrTurnPressureShadowed {
  turnId: string;
  workspaceId: string;
  iterationCount: number;
  streamRetryCount: number;
  p_i: number;
  g_of_p: number;
  r_i: number;
  evaluatedAt: number;
}

/** Content-free TRR event: TokenEdited. */
export interface TrrTokenEdited {
  revisionId: string;
  workspaceId: string;
  messageId: string;
  producerKind: "specialist" | "user" | "system";
  graphemesAdded: number;
  graphemesRemoved: number;
  tokensAdded: number;
  tokensRemoved: number;
  deathMode: "edit" | "regenerate" | "delete" | "abandon" | "censored";
  severityTier: "no_op" | "minor" | "moderate" | "major" | "critical" | "ambiguous";
  createdAt: number;
}

/** Union of TRR-shaped records Model Arena can model in local audit artifacts. */
export type TrrEvent =
  | { kind: "tokenBatchProduced"; data: TrrTokenBatchProduced }
  | { kind: "turnStamped"; data: TrrTurnStamped }
  | { kind: "turnPressureShadowed"; data: TrrTurnPressureShadowed }
  | { kind: "tokenEdited"; data: TrrTokenEdited };
