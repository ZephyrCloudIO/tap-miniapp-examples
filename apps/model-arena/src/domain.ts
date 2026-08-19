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
  ttftMs: number;
  costMicros: number | undefined;
  generationId: string | undefined;
  providerUsed: string | undefined;
  fallbackChain: string[] | undefined;
  /** True when token counts were estimated locally (e.g. specialist turns,
   *  where the host returns text but not usage). */
  estimated?: boolean;
}

/** Token counts from OpenRouter. */
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
  /** Completion tokens produced in this round. */
  regeneratedTokens: number;
  /** Tokens from the previous stage that did not survive this round. */
  discardedTokens: number;
  /** Retention across this round only: 1 - discarded / previousTokens. */
  retentionRate: number | undefined;
  /** Turn pressure r_i for this round. */
  turnPressure: number | undefined;
  /** Cost of this round in micros. */
  costMicros: number | undefined;
  /** Latency of this round in ms. */
  latencyMs: number;
}

/** TRR metrics for a single model in a session. */
export interface TrrMetrics {
  /** Stage 1 tokens emitted. */
  stage1Tokens: number;
  /** Per-round rework metrics, one entry per stage >= 2. */
  rounds: ReworkRoundMetrics[];
  /** Total tokens discarded across all rework rounds. */
  discardedTokens: number | undefined;
  /** Overall retention: fraction of stage-1 tokens surviving the final stage. */
  retentionRate: number | undefined;
  /** Aggregate turn pressure r_i (max across rounds). */
  turnPressure: number | undefined;
  /** Effective cost per retained token in micros. */
  ecrtMicros: number | undefined;
  /** Total cost across all stages in micros. */
  totalCostMicros: number;
}

/** Per-model result in a comparison session. */
export interface ModelResult {
  model: SelectedModel;
  /** Benchmark arm this result belongs to; undefined outside benchmark mode. */
  arm?: BenchmarkArm | undefined;
  /** Pipeline role label this result fulfills; undefined outside pipeline mode. */
  role?: string | undefined;
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
}

/** Generation parameters. Fields left undefined are omitted from the
 *  request so the provider/model default applies (e.g. no max token cap). */
export interface ModelParameters {
  temperature: number | undefined;
  maxTokens: number | undefined;
  topP: number | undefined;
  providerSort: "price" | "throughput" | "latency" | undefined;
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

/** Union of all TRR events Model Arena can emit. */
export type TrrEvent =
  | { kind: "tokenBatchProduced"; data: TrrTokenBatchProduced }
  | { kind: "turnStamped"; data: TrrTurnStamped }
  | { kind: "turnPressureShadowed"; data: TrrTurnPressureShadowed }
  | { kind: "tokenEdited"; data: TrrTokenEdited };
