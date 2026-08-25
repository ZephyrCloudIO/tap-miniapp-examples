import { useEffect, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  Slider,
  Textarea,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  ComparisonMode,
  SessionState,
  type ModelComparisonSession,
  type ModelOutput,
  type ModelParameters,
  type SelectedModel,
} from "../domain";
import {
  countPipelineRuns,
  expandPipelineRuns,
  mapSettledWithConcurrency,
  MAX_PIPELINE_CONCURRENCY,
  MAX_PIPELINE_OPTIONS_PER_ROLE,
  MAX_PIPELINE_ROLES,
  MAX_PIPELINE_RUNS,
  type PipelineRoleConfig,
  type PipelineRunStep,
} from "../pipeline";
import {
  buildReworkMessages,
  fetchModels,
  sendChatCompletion,
  sendCompletion,
} from "../inference";
import {
  isActionAllowed,
  runArenaSpecialistTurn,
  specialistTurnOutput,
} from "../host";
import { buildSessionTrrAuditEvents, computeTrrMetrics } from "../trr";
import { sessionDir, resultSlug, writeResultOutputs, writeSessionArtifacts } from "../vfs";
import { getCreatorIdentity, getWorkspaceId } from "../config";
import { saveSession } from "../storage";

interface SessionComposerProps {
  onSessionCreated: (session: ModelComparisonSession) => void;
  onRunningChange?: ((running: boolean) => void) | undefined;
  /** Pre-filled draft when forking an existing session. */
  initialDraft?: ModelComparisonSession | undefined;
  /** Host conversation the session's VFS artifacts are written to. */
  conversationId?: string | undefined;
  /** Host workspace ID stamped on local TRR audit artifacts. */
  workspaceId?: string | undefined;
  /** Host-canonical identity stamped as the session creator. */
  creatorId?: string | undefined;
}

const MAX_REWORK_ROUNDS = 5;
const MAX_SELECTED_MODELS = 8;
const MAX_OUTPUT_TOKENS = 16_384;
const HIGH_SPEND_CONFIRMATION_TURNS = 24;
const MAX_PAID_TURNS_PER_SESSION = MAX_PIPELINE_RUNS * MAX_PIPELINE_ROLES;

const DEFAULT_CRITIQUE_TEMPLATE =
  "Review your previous response critically. Identify any errors, omissions, or areas for improvement. Then provide a revised, improved version.\n\nYour previous response:\n{{output}}";

/** Editable pipeline option draft: model is a free-form ID resolved at run time. */
interface PipelineOptionDraft {
  id: string;
  modelId: string;
  arm: "model" | "specialist";
}

/** Editable pipeline role draft with one or more options. */
interface PipelineRoleDraft {
  id: string;
  label: string;
  instruction: string;
  options: PipelineOptionDraft[];
}

let draftCounter = 0;
function nextDraftId(prefix: string): string {
  draftCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${draftCounter}`;
}

function emptyOption(): PipelineOptionDraft {
  return { id: nextDraftId("opt"), modelId: "", arm: "model" };
}

const DEFAULT_PIPELINE_ROLES: PipelineRoleDraft[] = [
  {
    id: "plan",
    label: "Plan",
    instruction:
      "You are the planner. Produce a concise, step-by-step plan for the task below. Do not write the final deliverable.",
    options: [{ id: "plan-opt-1", modelId: "", arm: "model" }],
  },
  {
    id: "deliver",
    label: "Deliver",
    instruction:
      "You are the deliverer. Execute the plan and produce the complete final deliverable for the task below.",
    options: [{ id: "deliver-opt-1", modelId: "", arm: "model" }],
  },
  {
    id: "review",
    label: "Review",
    instruction:
      "You are the reviewer. Review the deliverable against the original task. Identify errors and omissions, then provide the corrected final version.",
    options: [{ id: "review-opt-1", modelId: "", arm: "model" }],
  },
];

function draftRolesFromSession(draft?: ModelComparisonSession): PipelineRoleDraft[] {
  if (!draft?.pipelineRoles?.length) return DEFAULT_PIPELINE_ROLES;
  return draft.pipelineRoles.slice(0, MAX_PIPELINE_ROLES).map((role) => ({
    id: role.id,
    label: role.label,
    instruction: role.instruction,
    options: role.options.slice(0, MAX_PIPELINE_OPTIONS_PER_ROLE).map((option) => ({
      id: nextDraftId("opt"),
      modelId: option.model.id,
      arm: option.arm,
    })),
  }));
}

interface ParameterState {
  limitTemperature: boolean;
  temperature: number;
  limitMaxTokens: boolean;
  maxTokens: number;
}

function defaultParameters(draft?: ModelComparisonSession): ParameterState {
  const p = draft?.parameters;
  return {
    limitTemperature: p?.temperature !== undefined ? true : false,
    temperature: p?.temperature ?? 0.7,
    limitMaxTokens: p?.maxTokens !== undefined,
    maxTokens: p?.maxTokens ?? 2048,
  };
}

function toModelParameters(state: ParameterState): ModelParameters {
  return {
    temperature: state.limitTemperature ? state.temperature : undefined,
    maxTokens:
      state.limitMaxTokens && Number.isFinite(state.maxTokens) && state.maxTokens > 0
        ? Math.min(MAX_OUTPUT_TOKENS, Math.floor(state.maxTokens))
        : undefined,
    topP: undefined,
    providerSort: undefined,
    zdr: undefined,
  };
}

function clampReworkRounds(value: number | undefined): number {
  const integer = Number.isFinite(value) ? Math.floor(value!) : 1;
  return Math.min(MAX_REWORK_ROUNDS, Math.max(1, integer));
}

interface PaidSetupSignatureInput {
  mode: ComparisonMode;
  prompt: string;
  systemPrompt: string;
  selectedModels: Set<string>;
  reworkRounds: number;
  critiquePrompt: string;
  parameters: ParameterState;
  pipelineCombination: "matrix" | "linear";
  pipelineRoles: PipelineRoleDraft[];
}

/** A deterministic snapshot of every field that can change the paid work. */
function paidSetupSignature(input: PaidSetupSignatureInput): string {
  const usesRework =
    input.mode === ComparisonMode.Rework || input.mode === ComparisonMode.Benchmark;
  const usesPipeline = input.mode === ComparisonMode.Pipeline;

  return JSON.stringify({
    mode: input.mode,
    prompt: input.prompt.trim(),
    systemPrompt: input.systemPrompt.trim(),
    models: usesPipeline ? [] : [...input.selectedModels].sort(),
    reworkRounds: usesRework ? clampReworkRounds(input.reworkRounds) : 0,
    critiquePrompt: usesRework ? input.critiquePrompt : "",
    parameters: toModelParameters(input.parameters),
    pipeline: usesPipeline
      ? {
          combination: input.pipelineCombination,
          roles: input.pipelineRoles.slice(0, MAX_PIPELINE_ROLES).map((role) => ({
            id: role.id,
            label: role.label.trim(),
            instruction: role.instruction,
            options: role.options.slice(0, MAX_PIPELINE_OPTIONS_PER_ROLE).map((option) => ({
              modelId: option.modelId.trim(),
              arm: option.arm,
            })),
          })),
        }
      : null,
  });
}

function errorOutput(stage: number, error: unknown): ModelOutput {
  return {
    stage,
    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    finishReason: "error",
    tokens: { prompt: 0, completion: 0, total: 0, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined },
    latencyMs: 0,
    ttftMs: undefined,
    costMicros: undefined,
    generationId: undefined,
    providerUsed: undefined,
    fallbackChain: undefined,
  };
}

export function SessionComposer({
  onSessionCreated,
  onRunningChange,
  initialDraft,
  conversationId,
  workspaceId,
  creatorId,
}: SessionComposerProps) {
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initialDraft?.systemPrompt ?? "");
  const [mode, setMode] = useState<ComparisonMode>(initialDraft?.mode ?? ComparisonMode.OneShot);
  const [reworkRounds, setReworkRounds] = useState(() =>
    clampReworkRounds(initialDraft?.reworkRounds),
  );
  const [critiquePrompt, setCritiquePrompt] = useState(
    initialDraft?.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE,
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(initialDraft?.models.slice(0, MAX_SELECTED_MODELS).map((m) => m.id) ?? []),
  );
  const [knownModels, setKnownModels] = useState<SelectedModel[]>(initialDraft?.models ?? []);
  const [availableModels, setAvailableModels] = useState<SelectedModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [confirmedPaidSetupSignature, setConfirmedPaidSetupSignature] = useState<string | null>(null);
  const [parameters, setParameters] = useState<ParameterState>(() => defaultParameters(initialDraft));
  const [access, setAccess] = useState<{
    checking: boolean;
    canManage: boolean;
    canListModels: boolean;
    canInvoke: boolean;
    canUseSpecialist: boolean;
    canWriteArtifacts: boolean;
  }>({
    checking: true,
    canManage: false,
    canListModels: false,
    canInvoke: false,
    canUseSpecialist: false,
    canWriteArtifacts: false,
  });
  const [pipelineRoles, setPipelineRoles] = useState<PipelineRoleDraft[]>(() => draftRolesFromSession(initialDraft));
  const [pipelineCombination, setPipelineCombination] = useState<"matrix" | "linear">(
    initialDraft?.pipelineCombination ?? "matrix",
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      isActionAllowed("model-arena.manage", "do"),
      isActionAllowed("inference.list", "listen"),
      isActionAllowed("inference.invoke", "do"),
      isActionAllowed("specialists.invoke", "do"),
      isActionAllowed("vfs.write", "do"),
    ]).then(([
      canManage,
      canListModels,
      canInvoke,
      canUseSpecialist,
      canWriteArtifacts,
    ]) => {
      if (!cancelled) {
        setAccess({
          checking: false,
          canManage,
          canListModels,
          canInvoke,
          canUseSpecialist,
          canWriteArtifacts,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadModels = async () => {
    setIsLoadingModels(true);
    setModelsError(null);
    try {
      if (!access.canListModels) throw new Error("Your current role cannot read the managed model catalog.");
      const models = await fetchModels();
      setAvailableModels(models);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingModels(false);
    }
  };

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else if (next.size < MAX_SELECTED_MODELS) next.add(modelId);
      return next;
    });
  };

  /** Run one full session for a single model: stage 1 plus all rework rounds. */
  const runModelPipeline = async (
    session: ModelComparisonSession,
    model: SelectedModel,
    params: ModelParameters,
  ): Promise<ModelComparisonSession["results"][number]> => {
    const outputs: ModelOutput[] = [];

    try {
      if (!conversationId) throw new Error("Select a TAP conversation before running inference.");
      const { output } = await sendCompletion(
        conversationId,
        model.id,
        session.prompt,
        session.systemPrompt,
        params,
        1,
      );
      outputs.push(output);
    } catch (error) {
      outputs.push(errorOutput(1, error));
      return {
        model,
        arm: "model" as const,
        outputs,
        trr: computeTrrMetrics({ outputs }),
        vcvFeedback: undefined,
      };
    }

    if (session.mode !== ComparisonMode.OneShot) {
      const template = session.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE;
      for (let round = 1; round <= clampReworkRounds(session.reworkRounds); round++) {
        const stage = round + 1;
        const previous = outputs[outputs.length - 1];
        if (!previous || previous.finishReason === "error") break;
        try {
          const messages = buildReworkMessages(
            session.prompt,
            session.systemPrompt,
            previous.text,
            template,
          );
          const { output } = await sendChatCompletion(
            conversationId,
            model.id,
            messages,
            params,
            stage,
          );
          outputs.push(output);
        } catch (error) {
          outputs.push(errorOutput(stage, error));
          break;
        }
      }
    }

    return { model, arm: "model" as const, outputs, trr: computeTrrMetrics({ outputs }), vcvFeedback: undefined };
  };

  /** Specialist arm: same prompt and critique protocol, but every turn runs
   *  through the arena-reviser specialist with the model as modelOverride.
   *  Token counts are estimated (specialist turns don't report usage). */
  const runSpecialistPipeline = async (
    session: ModelComparisonSession,
    model: SelectedModel,
  ): Promise<ModelComparisonSession["results"][number]> => {
    const outputs: ModelOutput[] = [];
    const stage1Content = session.systemPrompt
      ? `${session.systemPrompt}\n\n${session.prompt}`
      : session.prompt;

    try {
      const turn = await runArenaSpecialistTurn({
        content: stage1Content,
        workspaceId,
        modelOverride: model.id,
      });
      outputs.push(specialistTurnOutput(1, turn, stage1Content));
    } catch (error) {
      outputs.push({ ...errorOutput(1, error), estimated: true });
      return { model, arm: "specialist" as const, outputs, trr: computeTrrMetrics({ outputs }), vcvFeedback: undefined };
    }

    const template = session.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE;
    for (let round = 1; round <= clampReworkRounds(session.reworkRounds); round++) {
      const stage = round + 1;
      const previous = outputs[outputs.length - 1];
      if (!previous || previous.finishReason === "error") break;
      const content = template.includes("{{output}}")
        ? template.replaceAll("{{output}}", previous.text)
        : `${template}\n\nYour previous response:\n${previous.text}`;
      try {
        const turn = await runArenaSpecialistTurn({ content, workspaceId, modelOverride: model.id });
        outputs.push(specialistTurnOutput(stage, turn, content));
      } catch (error) {
        outputs.push({ ...errorOutput(stage, error), estimated: true });
        break;
      }
    }

    return { model, arm: "specialist" as const, outputs, trr: computeTrrMetrics({ outputs }), vcvFeedback: undefined };
  };

  const updateRole = (id: string, patch: Partial<Omit<PipelineRoleDraft, "options">>) => {
    setPipelineRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRole = () => {
    if (pipelineRoles.length >= MAX_PIPELINE_ROLES) return;
    setPipelineRoles((prev) => [
      ...prev,
      {
        id: nextDraftId("role"),
        label: `Step ${prev.length + 1}`,
        instruction: "",
        options: [emptyOption()],
      },
    ]);
  };

  const removeRole = (id: string) => {
    setPipelineRoles((prev) => prev.filter((r) => r.id !== id));
  };

  const addOption = (roleId: string) => {
    setPipelineRoles((prev) =>
      prev.map((r) =>
        r.id === roleId && r.options.length < MAX_PIPELINE_OPTIONS_PER_ROLE
          ? { ...r, options: [...r.options, emptyOption()] }
          : r,
      ),
    );
  };

  const updateOption = (roleId: string, optionId: string, patch: Partial<PipelineOptionDraft>) => {
    setPipelineRoles((prev) =>
      prev.map((r) =>
        r.id === roleId
          ? { ...r, options: r.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
          : r,
      ),
    );
  };

  const removeOption = (roleId: string, optionId: string) => {
    setPipelineRoles((prev) =>
      prev.map((r) =>
        r.id === roleId ? { ...r, options: r.options.filter((o) => o.id !== optionId) } : r,
      ),
    );
  };

  /** Resolve only host-listed or previously saved canonical models. */
  const resolveRoleModel = (modelId: string): SelectedModel | undefined => {
    const trimmed = modelId.trim();
    return [...availableModels, ...knownModels].find((m) => m.id === trimmed);
  };

  /** Valid role configs: roles with at least one filled option. */
  const pipelineConfigs = (): PipelineRoleConfig[] =>
    pipelineRoles
      .slice(0, MAX_PIPELINE_ROLES)
      .map((role) => ({
        id: role.id,
        label: role.label.trim() || role.id,
        instruction: role.instruction,
        options: role.options
          .slice(0, MAX_PIPELINE_OPTIONS_PER_ROLE)
          .filter((o) => o.modelId.trim() !== "")
          .flatMap((o) => {
            const model = resolveRoleModel(o.modelId);
            return model ? [{ model, arm: o.arm }] : [];
          }),
      }))
      .filter((role) => role.options.length > 0);

  /** Execute one pipeline run: steps sequential (each sees prior outputs),
   *  each step's output written to the VFS as it completes. */
  const executePipelineRun = async (
    session: ModelComparisonSession,
    params: ModelParameters,
    steps: PipelineRunStep[],
    runIndex: number,
  ): Promise<ModelComparisonSession["results"]> => {
    const results: ModelComparisonSession["results"] = [];
    let contextText = "";

    for (const [stepIndex, { role, option }] of steps.entries()) {
      const content = `${role.instruction}\n\nTask:\n${session.prompt}${contextText ? `\n\nContext from previous steps:${contextText}` : ""}`;

      let output: ModelOutput;
      try {
        if (option.arm === "specialist") {
          const turn = await runArenaSpecialistTurn({
            content,
            workspaceId,
            modelOverride: option.model.id,
          });
          output = specialistTurnOutput(1, turn, content);
        } else {
          if (!conversationId) throw new Error("Select a TAP conversation before running inference.");
          const result = await sendCompletion(
            conversationId,
            option.model.id,
            content,
            session.systemPrompt,
            params,
            1,
          );
          output = result.output;
        }
      } catch (error) {
        output = { ...errorOutput(1, error), estimated: option.arm === "specialist" };
      }

      const result = {
        model: option.model,
        arm: option.arm,
        role: role.label,
        roleId: role.id,
        stepIndex,
        runIndex,
        outputs: [output],
        trr: computeTrrMetrics({ outputs: [output] }),
        vcvFeedback: undefined,
      };
      results.push(result);

      // Persist the step's output to the VFS immediately — the artifact, not
      // in-memory state, is the durable handoff between steps.
      if (access.canWriteArtifacts) {
        await writeResultOutputs(session, result, conversationId).catch(() => undefined);
      }

      if (output.finishReason === "error") break; // later steps depend on this output
      const artifactPath = `${sessionDir(session)}/outputs/run-${String(runIndex).padStart(3, "0")}/${resultSlug(result)}/stage-1.json`;
      contextText += `\n\n[${role.label} — ${option.model.id}${option.arm === "specialist" ? " via specialist" : ""} — artifact: ${artifactPath}]:\n${output.text}`;
    }

    return results;
  };

  /** Pipeline mode: expand role options into runs (matrix or linear) and
   *  execute runs in parallel; steps within a run stay sequential. */
  const runPipeline = async (session: ModelComparisonSession, params: ModelParameters): Promise<void> => {
    const configs = pipelineConfigs();
    session.pipelineRoles = configs.map((c) => ({
      id: c.id,
      label: c.label,
      instruction: c.instruction,
      options: c.options,
    }));
    session.pipelineCombination = pipelineCombination;

    const runs = expandPipelineRuns(configs, pipelineCombination);
    const containsSpecialist = configs.some((role) =>
      role.options.some((option) => option.arm === "specialist"),
    );
    const settled = await mapSettledWithConcurrency(
      runs,
      (steps, runIndex) => executePipelineRun(session, params, steps, runIndex),
      containsSpecialist ? 1 : MAX_PIPELINE_CONCURRENCY,
    );
    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        session.results.push(...entry.value);
      }
    }
  };

  const runComparison = async () => {
    setRunError(null);
    const trimmedPrompt = prompt.trim();
    const isBenchmark = mode === ComparisonMode.Benchmark;
    const isPipeline = mode === ComparisonMode.Pipeline;
    const boundedReworkRounds = clampReworkRounds(reworkRounds);
    const configs = isPipeline ? pipelineConfigs() : [];
    const requiresSpecialist =
      isBenchmark || configs.some((role) => role.options.some((option) => option.arm === "specialist"));
    const pipelineRunCount = countPipelineRuns(
      configs.map((c) => c.options.length),
      pipelineCombination,
    );
    const estimatedPaidTurnCount = isPipeline
      ? pipelineRunCount * Math.min(configs.length, MAX_PIPELINE_ROLES)
      : selectedModels.size *
        (isBenchmark ? 2 : 1) *
        (mode === ComparisonMode.Rework || isBenchmark ? boundedReworkRounds + 1 : 1);
    const setupSignature = paidSetupSignature({
      mode,
      prompt,
      systemPrompt,
      selectedModels,
      reworkRounds: boundedReworkRounds,
      critiquePrompt,
      parameters,
      pipelineCombination,
      pipelineRoles,
    });

    if (estimatedPaidTurnCount > MAX_PAID_TURNS_PER_SESSION) {
      setRunError(
        `This setup requests ${estimatedPaidTurnCount} paid turns; the hard per-session limit is ${MAX_PAID_TURNS_PER_SESSION}.`,
      );
      return;
    }
    if (!access.canManage) {
      setRunError("Your current role cannot run paid comparisons.");
      return;
    }
    if (!access.canInvoke) {
      setRunError("Managed inference is not authorized for this package.");
      return;
    }
    if (requiresSpecialist && !access.canUseSpecialist) {
      setRunError("Specialist execution is not authorized for this package.");
      return;
    }
    if (!conversationId) {
      setRunError("Select a TAP conversation before running a comparison.");
      return;
    }
    if (
      estimatedPaidTurnCount > HIGH_SPEND_CONFIRMATION_TURNS &&
      confirmedPaidSetupSignature !== setupSignature
    ) {
      setRunError(`Confirm the ${estimatedPaidTurnCount}-turn paid run before starting.`);
      return;
    }
    if (!trimmedPrompt || (!isPipeline && selectedModels.size === 0) || (isPipeline && pipelineRunCount === 0)) return;

    setIsLoading(true);
    onRunningChange?.(true);
    try {
      const [canManageNow, canInvokeNow, canUseSpecialistNow] = await Promise.all([
        isActionAllowed("model-arena.manage", "do"),
        isActionAllowed("inference.invoke", "do"),
        requiresSpecialist
          ? isActionAllowed("specialists.invoke", "do")
          : Promise.resolve(true),
      ]);
      setAccess((current) => ({
        ...current,
        canManage: canManageNow,
        canInvoke: canInvokeNow,
        canUseSpecialist: requiresSpecialist
          ? canUseSpecialistNow
          : current.canUseSpecialist,
      }));
      if (!canManageNow) throw new Error("Your current role cannot run paid comparisons.");
      if (!canInvokeNow) throw new Error("Managed inference authorization was revoked.");
      if (requiresSpecialist && !canUseSpecialistNow) {
        throw new Error("Specialist execution authorization was revoked.");
      }

      const params = toModelParameters(parameters);
      const allKnown = [...availableModels, ...knownModels];
      const models = allKnown
        .filter(
          (model, index, candidates) =>
            selectedModels.has(model.id) &&
            candidates.findIndex((candidate) => candidate.id === model.id) === index,
        )
        .slice(0, MAX_SELECTED_MODELS);
      if (!isPipeline && models.length === 0) {
        throw new Error("None of the selected models are available in the managed model catalog.");
      }
      const pipelineModels = configs
        .flatMap((config) => config.options.map((option) => option.model))
        .filter(
          (model, index, candidates) =>
            candidates.findIndex((candidate) => candidate.id === model.id) === index,
        );
      const actualPaidTurnCount = isPipeline
        ? pipelineRunCount * Math.min(configs.length, MAX_PIPELINE_ROLES)
        : models.length *
          (isBenchmark ? 2 : 1) *
          (mode === ComparisonMode.Rework || isBenchmark ? boundedReworkRounds + 1 : 1);
      if (actualPaidTurnCount > MAX_PAID_TURNS_PER_SESSION) {
        throw new Error(
          `The resolved setup exceeds the ${MAX_PAID_TURNS_PER_SESSION}-turn per-session limit.`,
        );
      }

      const session: ModelComparisonSession = {
        id: `MA-${Date.now().toString(36).toUpperCase()}`,
        state:
          mode === ComparisonMode.OneShot || isPipeline
            ? SessionState.Running
            : SessionState.ReworkRunning,
        createdAt: new Date().toISOString(),
        creator: creatorId ?? getCreatorIdentity(),
        mode,
        prompt: trimmedPrompt,
        systemPrompt: systemPrompt.trim() || undefined,
        parameters: params,
        models: isPipeline ? pipelineModels : models,
        results: [],
        reworkRounds:
          mode === ComparisonMode.Rework || isBenchmark ? boundedReworkRounds : 0,
        critiquePrompt:
          mode === ComparisonMode.Rework || isBenchmark ? critiquePrompt : undefined,
        pipelineRoles: isPipeline ? [] : undefined,
        pipelineCombination: isPipeline ? pipelineCombination : undefined,
        linkedMessages: undefined,
        tags: undefined,
        parentSessionId: initialDraft?.id,
      };

      if (isPipeline) {
        // Specialist-containing pipelines serialize whole runs because the
        // specialist room is stateful; model-only pipelines retain bounded concurrency.
        setProgress(
          `Running ${pipelineRunCount} pipeline run${pipelineRunCount === 1 ? "" : "s"}...`,
        );
        await runPipeline(session, params);
      } else {
        setProgress(`Running ${models.length} model${models.length === 1 ? "" : "s"}...`);
        const modelSettled = await mapSettledWithConcurrency(models, (model) =>
          runModelPipeline(session, model, params),
        );
        // Every specialist arm completes before the next begins so two models'
        // turns cannot interleave in the same persistent room.
        const specialistSettled = isBenchmark
          ? await mapSettledWithConcurrency(
              models,
              (model) => runSpecialistPipeline(session, model),
              1,
            )
          : [];

        for (const [index, model] of models.entries()) {
          const modelEntry = modelSettled[index];
          if (modelEntry?.status === "fulfilled") {
            session.results.push(modelEntry.value);
          } else if (modelEntry) {
            const outputs = [errorOutput(1, modelEntry.reason)];
            session.results.push({
              model,
              arm: isBenchmark ? "model" : undefined,
              outputs,
              trr: computeTrrMetrics({ outputs }),
              vcvFeedback: undefined,
            });
          }

          const specialistEntry = specialistSettled[index];
          if (specialistEntry?.status === "fulfilled") {
            session.results.push(specialistEntry.value);
          } else if (specialistEntry) {
            const outputs = [{ ...errorOutput(1, specialistEntry.reason), estimated: true }];
            session.results.push({
              model,
              arm: "specialist",
              outputs,
              trr: computeTrrMetrics({ outputs }),
              vcvFeedback: undefined,
            });
          }
        }
      }

      session.state =
        mode === ComparisonMode.Rework || isBenchmark
          ? SessionState.ReworkCompleted
          : SessionState.Completed;

      // Build a content-free audit artifact. The managed inference host records
      // the canonical TRR turn telemetry; the SDK does not accept arbitrary emits.
      const trrAuditEvents = buildSessionTrrAuditEvents(
        session,
        workspaceId ?? getWorkspaceId(),
      );
      console.log("Local TRR audit records built:", trrAuditEvents.length);

      // Write the durable artifact set to the conversation VFS (no-op outside
      // the host). Pipeline runs already wrote per-role outputs as they ran.
      const canWriteArtifactsNow = await isActionAllowed("vfs.write", "do");
      setAccess((current) => ({ ...current, canWriteArtifacts: canWriteArtifactsNow }));
      let vfsResult: Awaited<ReturnType<typeof writeSessionArtifacts>> = null;
      if (canWriteArtifactsNow) {
        try {
          vfsResult = await writeSessionArtifacts(session, trrAuditEvents, conversationId);
          session.vfsArtifactStatus = vfsResult ? "written" : "failed";
        } catch {
          session.vfsArtifactStatus = "failed";
        }
      } else {
        session.vfsArtifactStatus = "not-authorized";
      }
      if (vfsResult) {
        session.vfsArtifactReceipt = {
          ...vfsResult,
          writtenAt: new Date().toISOString(),
        };
        session.vfsArtifactStatus = "written";
        console.log(
          `Model Arena artifacts written to VFS: ${vfsResult.root} (${vfsResult.written} files)`,
        );
      }

      const saveResult = saveSession(
        session,
        workspaceId ?? getWorkspaceId(),
        creatorId ?? getCreatorIdentity(),
      );
      if (!saveResult.persisted) {
        session.localPersistenceFailure = saveResult.failure;
      }

      onSessionCreated(session);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
      setProgress("");
      onRunningChange?.(false);
    }
  };

  const filteredModels = modelSearch.trim()
    ? availableModels.filter((m) => {
        const q = modelSearch.trim().toLowerCase();
        return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
      })
    : availableModels;
  const executablePipelineConfigs = pipelineConfigs();
  const executablePipelineRunCount = countPipelineRuns(
    executablePipelineConfigs.map((config) => config.options.length),
    pipelineCombination,
  );
  const pipelineRequiresSpecialist = executablePipelineConfigs.some((role) =>
    role.options.some((option) => option.arm === "specialist"),
  );
  const estimatedPaidTurnCount =
    mode === ComparisonMode.Pipeline
      ? executablePipelineRunCount *
        Math.min(executablePipelineConfigs.length, MAX_PIPELINE_ROLES)
      : selectedModels.size *
        (mode === ComparisonMode.Benchmark ? 2 : 1) *
        (mode === ComparisonMode.Rework || mode === ComparisonMode.Benchmark
          ? clampReworkRounds(reworkRounds) + 1
          : 1);
  const currentPaidSetupSignature = paidSetupSignature({
    mode,
    prompt,
    systemPrompt,
    selectedModels,
    reworkRounds,
    critiquePrompt,
    parameters,
    pipelineCombination,
    pipelineRoles,
  });
  const needsHighSpendConfirmation =
    estimatedPaidTurnCount > HIGH_SPEND_CONFIRMATION_TURNS;

  return (
    <div className="session-composer">
      <FieldGroup>
        <Field>
          <FieldLabel>Managed Inference</FieldLabel>
          {access.checking ? (
            <FieldDescription>Checking signed package authority…</FieldDescription>
          ) : !access.canManage ? (
            <Alert data-testid="model-arena-manage-denied">
              <AlertTitle>Comparison access is read-only</AlertTitle>
              <AlertDescription>
                Your current role can review saved sessions but cannot run paid comparisons.
              </AlertDescription>
            </Alert>
          ) : !access.canListModels || !access.canInvoke ? (
            <Alert variant="destructive">
              <AlertTitle>Managed inference is not authorized</AlertTitle>
              <AlertDescription>
                This signed package needs model-catalog and inference grants before it can run comparisons.
              </AlertDescription>
            </Alert>
          ) : !conversationId ? (
            <Alert>
              <AlertTitle>Select a conversation</AlertTitle>
              <AlertDescription>
                Model Arena attaches paid turns and durable artifacts to the active TAP conversation.
              </AlertDescription>
            </Alert>
          ) : (
            <FieldDescription>
              TAP owns provider credentials, routing, cost attribution, and content-free telemetry. No API key enters this miniapp.
            </FieldDescription>
          )}
        </Field>

        {!access.checking && !access.canWriteArtifacts && (
          <Alert>
            <AlertTitle>Conversation artifacts are unavailable</AlertTitle>
            <AlertDescription>
              Comparisons can still be kept in this browser, but this role cannot write durable VFS artifacts.
            </AlertDescription>
          </Alert>
        )}

        {initialDraft && (
          <Alert>
            <AlertTitle>Forked session</AlertTitle>
            <AlertDescription>
              Forked from {initialDraft.id} — edit anything before running.
            </AlertDescription>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="ma-prompt">Prompt</FieldLabel>
          <Textarea
            id="ma-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter the prompt to compare models against..."
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="ma-system-prompt">System Prompt (optional)</FieldLabel>
          <Textarea
            id="ma-system-prompt"
            rows={2}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Optional system instructions..."
          />
        </Field>

        <Field>
          <FieldLabel>Comparison Mode</FieldLabel>
          <div className="mode-toggle">
            <Button
              variant={mode === ComparisonMode.OneShot ? "default" : "outline"}
              onClick={() => setMode(ComparisonMode.OneShot)}
            >
              One-Shot
            </Button>
            <Button
              variant={mode === ComparisonMode.Rework ? "default" : "outline"}
              onClick={() => setMode(ComparisonMode.Rework)}
            >
              Rework Arena
            </Button>
            <Button
              variant={mode === ComparisonMode.Benchmark ? "default" : "outline"}
              onClick={() => setMode(ComparisonMode.Benchmark)}
            >
              Benchmark
            </Button>
            <Button
              variant={mode === ComparisonMode.Pipeline ? "default" : "outline"}
              onClick={() => setMode(ComparisonMode.Pipeline)}
            >
              Pipeline
            </Button>
          </div>
          {mode === ComparisonMode.Benchmark && (
            <Alert variant={!access.checking && !access.canUseSpecialist ? "destructive" : undefined}>
              <AlertTitle>
                {!access.checking && !access.canUseSpecialist
                  ? "Specialist benchmark is not authorized"
                  : "Contextual specialist benchmark"}
              </AlertTitle>
              <AlertDescription>
                {!access.checking && !access.canUseSpecialist
                  ? "Grant specialists.invoke or choose a direct-model mode."
                  : "Direct model arms are isolated. The specialist arm intentionally reuses TAP's private persistent room, so it carries prior context and is not a statistically isolated A/B arm. Specialist usage is estimated."}
              </AlertDescription>
            </Alert>
          )}
          {mode === ComparisonMode.Pipeline && (
            <FieldDescription>
              Chain roles like plan → deliver → review, each on its own model, each running as a direct
              call or through the specialist — in any combination. Every role sees all previous outputs.
            </FieldDescription>
          )}
        </Field>

        {mode === ComparisonMode.Pipeline && (
          <Field>
            <FieldLabel>Pipeline Roles</FieldLabel>
            {availableModels.length === 0 && (
              <div className="row">
                <Button
                  variant="secondary"
                  onClick={loadModels}
                  isLoading={isLoadingModels}
                  disabled={access.checking || !access.canListModels}
                >
                  {isLoadingModels ? "Loading Models..." : "Load Managed Models"}
                </Button>
                {modelsError && <FieldDescription>{modelsError}</FieldDescription>}
              </div>
            )}
            <datalist id="ma-role-models">
              {[...availableModels, ...knownModels]
                .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
                .map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
            </datalist>

            <div className="row" style={{ marginBottom: "0.75rem" }}>
              <NativeSelect
                value={pipelineCombination}
                onChange={(e) => setPipelineCombination(e.target.value as "matrix" | "linear")}
              >
                <option value="matrix">Matrix — every combination of options</option>
                <option value="linear">Linear — pair options by position</option>
              </NativeSelect>
              <span className="metric-neutral" style={{ fontSize: "0.8125rem" }}>
                {executablePipelineRunCount}{" "}
                run(s)
              </span>
              <span className="metric-neutral" style={{ fontSize: "0.75rem" }}>
                Maximum {MAX_PIPELINE_ROLES} roles, {MAX_PIPELINE_OPTIONS_PER_ROLE} options per role,
                and {MAX_PIPELINE_RUNS} runs; up to 4 runs execute concurrently.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {pipelineRoles.map((role, index) => (
                <div
                  key={role.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "0.5rem",
                    padding: "0.75rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div className="row">
                    <span className="metric-neutral" style={{ fontSize: "0.75rem", minWidth: "2ch" }}>
                      {index + 1}.
                    </span>
                    <Input
                      value={role.label}
                      onChange={(e) => updateRole(role.id, { label: e.target.value })}
                      placeholder="Role label (e.g. Plan)"
                      style={{ width: "10rem" }}
                    />
                    <span style={{ flex: 1 }} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRole(role.id)}
                      disabled={pipelineRoles.length <= 1}
                    >
                      Remove Role
                    </Button>
                  </div>
                  <Textarea
                    rows={2}
                    value={role.instruction}
                    onChange={(e) => updateRole(role.id, { instruction: e.target.value })}
                    placeholder="Role instruction prepended to the task and prior outputs..."
                  />
                  {role.options.map((option) => (
                    <div className="row" key={option.id}>
                      <Input
                        list="ma-role-models"
                        value={option.modelId}
                        onChange={(e) => updateOption(role.id, option.id, { modelId: e.target.value })}
                        placeholder="Choose a managed model from the catalog"
                        style={{ flex: 1 }}
                      />
                      <NativeSelect
                        value={option.arm}
                        onChange={(e) =>
                          updateOption(role.id, option.id, {
                            arm: e.target.value as PipelineOptionDraft["arm"],
                          })
                        }
                      >
                        <option value="model">Model only</option>
                        <option value="specialist" disabled={!access.canUseSpecialist}>
                          Model + Specialist
                        </option>
                      </NativeSelect>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeOption(role.id, option.id)}
                        disabled={role.options.length <= 1}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addOption(role.id)}
                      disabled={role.options.length >= MAX_PIPELINE_OPTIONS_PER_ROLE}
                    >
                      Add Option
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRole}
                  disabled={pipelineRoles.length >= MAX_PIPELINE_ROLES}
                >
                  Add Role
                </Button>
              </div>
            </div>
          </Field>
        )}

        {(mode === ComparisonMode.Rework || mode === ComparisonMode.Benchmark) && (
          <>
            <Field>
              <FieldLabel htmlFor="ma-rework-rounds">
                Rework Rounds — {reworkRounds} round{reworkRounds === 1 ? "" : "s"}
              </FieldLabel>
              <Slider
                id="ma-rework-rounds"
                min={1}
                max={MAX_REWORK_ROUNDS}
                step={1}
                value={[reworkRounds]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (typeof next === "number") setReworkRounds(next);
                }}
              />
              <FieldDescription>
                Each round feeds the model's own latest output back with the critique below and measures what survives.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="ma-critique">Critique Template</FieldLabel>
              <Textarea
                id="ma-critique"
                rows={3}
                value={critiquePrompt}
                onChange={(e) => setCritiquePrompt(e.target.value)}
                placeholder="Instructions sent with the model's previous output each round. Use {{output}} to place the previous response."
              />
              <FieldDescription>
                Use {"{{output}}"} where the previous response should be inserted; otherwise it is appended.
              </FieldDescription>
            </Field>
          </>
        )}

        {mode !== ComparisonMode.Pipeline && (
        <Field>
          <FieldLabel>Models{selectedModels.size > 0 ? ` — ${selectedModels.size} selected` : ""}</FieldLabel>
          <FieldDescription>Select up to {MAX_SELECTED_MODELS} models with eligible managed routes.</FieldDescription>
          {availableModels.length === 0 ? (
            <>
              <Button
                variant="secondary"
                onClick={loadModels}
                isLoading={isLoadingModels}
                disabled={access.checking || !access.canListModels}
              >
                {isLoadingModels ? "Loading Models..." : "Load Managed Models"}
              </Button>
              {modelsError && (
                <Alert variant="destructive">
                  <AlertTitle>Could not load models</AlertTitle>
                  <AlertDescription>{modelsError}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <Input
              type="search"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={`Search ${availableModels.length} models...`}
            />
          )}
          {(availableModels.length > 0 || knownModels.length > 0) && (
            <div className="model-selector">
              {filteredModels.map((model) => (
                <Button
                  key={model.id}
                  size="sm"
                  shape="pill"
                  variant={selectedModels.has(model.id) ? "default" : "outline"}
                  onClick={() => toggleModel(model.id)}
                  disabled={!selectedModels.has(model.id) && selectedModels.size >= MAX_SELECTED_MODELS}
                >
                  {model.name}
                </Button>
              ))}
              {knownModels
                .filter((m) => !availableModels.some((a) => a.id === m.id))
                .map((model) => (
                  <Button
                    key={model.id}
                    size="sm"
                    shape="pill"
                    variant={selectedModels.has(model.id) ? "default" : "outline"}
                    onClick={() => toggleModel(model.id)}
                    disabled={!selectedModels.has(model.id) && selectedModels.size >= MAX_SELECTED_MODELS}
                  >
                    {model.name}
                  </Button>
                ))}
            </div>
          )}
        </Field>
        )}

        <Field>
          <FieldLabel>Parameters</FieldLabel>
          <FieldDescription>
            TAP exposes portable temperature and output-token controls. Provider selection and effective ZDR policy remain host-managed.
          </FieldDescription>
          <div className="form-grid">
            <Field>
              <FieldLabel className="row">
                <Checkbox
                  checked={parameters.limitTemperature}
                  onCheckedChange={(checked) =>
                    setParameters((p) => ({ ...p, limitTemperature: checked === true }))
                  }
                />
                Set temperature
              </FieldLabel>
              {parameters.limitTemperature ? (
                <>
                  <Slider
                    min={0}
                    max={2}
                    step={0.1}
                    value={[parameters.temperature]}
                    onValueChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value;
                      if (typeof next === "number") {
                        setParameters((p) => ({ ...p, temperature: next }));
                      }
                    }}
                  />
                  <FieldDescription>{parameters.temperature.toFixed(1)}</FieldDescription>
                </>
              ) : (
                <FieldDescription>Model default</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel className="row">
                <Checkbox
                  checked={parameters.limitMaxTokens}
                  onCheckedChange={(checked) =>
                    setParameters((p) => ({ ...p, limitMaxTokens: checked === true }))
                  }
                />
                Cap max tokens
              </FieldLabel>
              {parameters.limitMaxTokens ? (
                <Input
                  type="number"
                  min={1}
                  max={MAX_OUTPUT_TOKENS}
                  value={parameters.maxTokens}
                  onChange={(e) =>
                    setParameters((p) => ({ ...p, maxTokens: parseInt(e.target.value, 10) }))
                  }
                />
              ) : (
                <FieldDescription>
                  Host default: 4,096 tokens (maximum {MAX_OUTPUT_TOKENS.toLocaleString()})
                </FieldDescription>
              )}
            </Field>
          </div>
        </Field>

        {estimatedPaidTurnCount > 0 && (
          <Alert variant={needsHighSpendConfirmation ? "destructive" : undefined}>
            <AlertTitle>
              Up to {estimatedPaidTurnCount} paid turn{estimatedPaidTurnCount === 1 ? "" : "s"}
            </AlertTitle>
            <AlertDescription>
              The estimate includes every model, rework round, benchmark arm, and pipeline role in this setup.
            </AlertDescription>
            {needsHighSpendConfirmation && (
              <FieldLabel className="row">
                <Checkbox
                  checked={confirmedPaidSetupSignature === currentPaidSetupSignature}
                  onCheckedChange={(checked) =>
                    setConfirmedPaidSetupSignature(
                      checked === true ? currentPaidSetupSignature : null,
                    )
                  }
                />
                Confirm this paid run
              </FieldLabel>
            )}
          </Alert>
        )}

        {runError && (
          <Alert variant="destructive">
            <AlertTitle>Comparison could not start</AlertTitle>
            <AlertDescription>{runError}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={runComparison}
          disabled={
            isLoading ||
            access.checking ||
            !access.canManage ||
            !access.canInvoke ||
            ((mode === ComparisonMode.Benchmark ||
              (mode === ComparisonMode.Pipeline && pipelineRequiresSpecialist)) &&
              !access.canUseSpecialist) ||
            !conversationId ||
            !prompt.trim() ||
            (needsHighSpendConfirmation &&
              confirmedPaidSetupSignature !== currentPaidSetupSignature) ||
            (mode === ComparisonMode.Pipeline
              ? executablePipelineRunCount === 0
              : selectedModels.size === 0)
          }
          isLoading={isLoading}
        >
          {isLoading
            ? progress || "Running Comparison..."
            : `Run ${mode === ComparisonMode.Benchmark ? "Benchmark" : mode === ComparisonMode.Pipeline ? "Pipeline" : mode === ComparisonMode.Rework ? "Rework Arena" : "Comparison"}`}
        </Button>
      </FieldGroup>
    </div>
  );
}
