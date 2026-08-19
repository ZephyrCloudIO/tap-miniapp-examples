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
  type PipelineRoleConfig,
  type PipelineRunStep,
} from "../pipeline";
import {
  buildReworkMessages,
  fetchModels,
  reconcileOutputCost,
  sendChatCompletion,
  sendCompletion,
} from "../openrouter";
import { inspectHostConnection, isOpenRouterCredential, runArenaSpecialistTurn, specialistTurnOutput, type HostConnection } from "../host";
import { computeTrrMetrics, emitSessionTrrEvents } from "../trr";
import { sessionDir, resultSlug, writeResultOutputs, writeSessionArtifacts } from "../vfs";
import { getCreatorIdentity, getWorkspaceId, hasApiKey, setApiKey } from "../config";
import { saveSession } from "../storage";

interface SessionComposerProps {
  onSessionCreated: (session: ModelComparisonSession) => void;
  /** Pre-filled draft when forking an existing session. */
  initialDraft?: ModelComparisonSession | undefined;
  /** Host conversation the session's VFS artifacts are written to. */
  conversationId?: string | undefined;
  /** Host workspace ID stamped on TRR events. */
  workspaceId?: string | undefined;
}

const MAX_REWORK_ROUNDS = 5;

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
  return draft.pipelineRoles.map((role) => ({
    id: role.id,
    label: role.label,
    instruction: role.instruction,
    options: role.options.map((option) => ({
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
  topP: string;
  providerSort: "price" | "throughput" | "latency" | "";
  zdr: boolean;
}

function defaultParameters(draft?: ModelComparisonSession): ParameterState {
  const p = draft?.parameters;
  return {
    limitTemperature: p?.temperature !== undefined ? true : false,
    temperature: p?.temperature ?? 0.7,
    limitMaxTokens: p?.maxTokens !== undefined,
    maxTokens: p?.maxTokens ?? 2048,
    topP: p?.topP !== undefined ? String(p.topP) : "",
    providerSort: p?.providerSort ?? "",
    zdr: p?.zdr ?? false,
  };
}

function toModelParameters(state: ParameterState): ModelParameters {
  return {
    temperature: state.limitTemperature ? state.temperature : undefined,
    maxTokens:
      state.limitMaxTokens && Number.isFinite(state.maxTokens) && state.maxTokens > 0
        ? state.maxTokens
        : undefined,
    topP: state.topP.trim() !== "" ? parseFloat(state.topP) : undefined,
    providerSort: state.providerSort === "" ? undefined : state.providerSort,
    zdr: state.zdr ? true : undefined,
  };
}

function errorOutput(stage: number, error: unknown): ModelOutput {
  return {
    stage,
    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    finishReason: "error",
    tokens: { prompt: 0, completion: 0, total: 0, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined },
    latencyMs: 0,
    ttftMs: 0,
    costMicros: undefined,
    generationId: undefined,
    providerUsed: undefined,
    fallbackChain: undefined,
  };
}

export function SessionComposer({ onSessionCreated, initialDraft, conversationId, workspaceId }: SessionComposerProps) {
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initialDraft?.systemPrompt ?? "");
  const [mode, setMode] = useState<ComparisonMode>(initialDraft?.mode ?? ComparisonMode.OneShot);
  const [reworkRounds, setReworkRounds] = useState(initialDraft?.reworkRounds ?? 1);
  const [critiquePrompt, setCritiquePrompt] = useState(
    initialDraft?.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE,
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(initialDraft?.models.map((m) => m.id) ?? []),
  );
  const [knownModels, setKnownModels] = useState<SelectedModel[]>(initialDraft?.models ?? []);
  const [availableModels, setAvailableModels] = useState<SelectedModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [parameters, setParameters] = useState<ParameterState>(() => defaultParameters(initialDraft));
  const [connection, setConnection] = useState<HostConnection | null>(null);
  const [credentialRef, setCredentialRef] = useState<string | undefined>(undefined);
  const [pipelineRoles, setPipelineRoles] = useState<PipelineRoleDraft[]>(() => draftRolesFromSession(initialDraft));
  const [pipelineCombination, setPipelineCombination] = useState<"matrix" | "linear">(
    initialDraft?.pipelineCombination ?? "matrix",
  );
  const [apiKeyConfigured, setApiKeyConfigured] = useState(() => hasApiKey());
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeyEditor, setShowApiKeyEditor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void inspectHostConnection().then((report) => {
      if (cancelled) return;
      setConnection(report);
      const openRouterCredentials = report.credentials.filter(isOpenRouterCredential);
      // Auto-select when exactly one OpenRouter credential is stored.
      if (openRouterCredentials.length === 1) {
        setCredentialRef(openRouterCredentials[0]?.id);
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
      const models = await fetchModels(credentialRef);
      setAvailableModels(models);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingModels(false);
    }
  };

  const addManualModel = () => {
    const id = manualModelId.trim();
    if (!id) return;
    const model: SelectedModel = {
      id,
      name: id.split("/")[1] ?? id,
      provider: id.split("/")[0] ?? "unknown",
    };
    if (!knownModels.some((m) => m.id === id)) {
      setKnownModels((prev) => [...prev, model]);
    }
    setSelectedModels((prev) => new Set(prev).add(id));
    setManualModelId("");
  };

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
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
      const { output } = await sendCompletion(model.id, session.prompt, session.systemPrompt, params, 1, credentialRef);
      outputs.push(output);
    } catch (error) {
      outputs.push(errorOutput(1, error));
      return { model, outputs, trr: computeTrrMetrics({ outputs }), vcvFeedback: undefined };
    }

    if (session.mode !== ComparisonMode.OneShot) {
      const template = session.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE;
      for (let round = 1; round <= session.reworkRounds; round++) {
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
          const { output } = await sendChatCompletion(model.id, messages, params, stage, credentialRef);
          outputs.push(output);
        } catch (error) {
          outputs.push(errorOutput(stage, error));
          break;
        }
      }
    }

    // Reconcile exact cost post-hoc (best effort)
    await Promise.allSettled(outputs.map((o) => reconcileOutputCost(o, credentialRef)));

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
      const turn = await runArenaSpecialistTurn({ content: stage1Content, modelOverride: model.id });
      outputs.push(specialistTurnOutput(1, turn, stage1Content));
    } catch (error) {
      outputs.push({ ...errorOutput(1, error), estimated: true });
      return { model, arm: "specialist" as const, outputs, trr: computeTrrMetrics({ outputs }), vcvFeedback: undefined };
    }

    const template = session.critiquePrompt ?? DEFAULT_CRITIQUE_TEMPLATE;
    for (let round = 1; round <= session.reworkRounds; round++) {
      const stage = round + 1;
      const previous = outputs[outputs.length - 1];
      if (!previous || previous.finishReason === "error") break;
      const content = template.includes("{{output}}")
        ? template.replaceAll("{{output}}", previous.text)
        : `${template}\n\nYour previous response:\n${previous.text}`;
      try {
        const turn = await runArenaSpecialistTurn({ content, modelOverride: model.id });
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
      prev.map((r) => (r.id === roleId ? { ...r, options: [...r.options, emptyOption()] } : r)),
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

  /** Resolve a model ID against loaded/known models, or synthesize it. */
  const resolveRoleModel = (modelId: string): SelectedModel => {
    const trimmed = modelId.trim();
    const known = [...availableModels, ...knownModels].find((m) => m.id === trimmed);
    return (
      known ?? {
        id: trimmed,
        name: trimmed.split("/")[1] ?? trimmed,
        provider: trimmed.split("/")[0] ?? "unknown",
      }
    );
  };

  /** Valid role configs: roles with at least one filled option. */
  const pipelineConfigs = (): PipelineRoleConfig[] =>
    pipelineRoles
      .map((role) => ({
        id: role.id,
        label: role.label.trim() || role.id,
        instruction: role.instruction,
        options: role.options
          .filter((o) => o.modelId.trim() !== "")
          .map((o) => ({ model: resolveRoleModel(o.modelId), arm: o.arm })),
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

    for (const { role, option } of steps) {
      const content = `${role.instruction}\n\nTask:\n${session.prompt}${contextText ? `\n\nContext from previous steps:${contextText}` : ""}`;

      let output: ModelOutput;
      try {
        if (option.arm === "specialist") {
          const turn = await runArenaSpecialistTurn({ content, modelOverride: option.model.id });
          output = specialistTurnOutput(1, turn, content);
        } else {
          const result = await sendCompletion(option.model.id, content, session.systemPrompt, params, 1, credentialRef);
          output = result.output;
          await reconcileOutputCost(output, credentialRef).catch(() => undefined);
        }
      } catch (error) {
        output = { ...errorOutput(1, error), estimated: option.arm === "specialist" };
      }

      const result = {
        model: option.model,
        arm: option.arm,
        role: role.label,
        runIndex,
        outputs: [output],
        trr: computeTrrMetrics({ outputs: [output] }),
        vcvFeedback: undefined,
      };
      results.push(result);

      // Persist the step's output to the VFS immediately — the artifact, not
      // in-memory state, is the durable handoff between steps.
      await writeResultOutputs(session, result, conversationId).catch(() => undefined);

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
    const settled = await Promise.allSettled(
      runs.map((steps, runIndex) => executePipelineRun(session, params, steps, runIndex)),
    );
    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        session.results.push(...entry.value);
      }
    }
  };

  const runComparison = async () => {
    const trimmedPrompt = prompt.trim();
    const isBenchmark = mode === ComparisonMode.Benchmark;
    const isPipeline = mode === ComparisonMode.Pipeline;
    const configs = isPipeline ? pipelineConfigs() : [];
    const pipelineRunCount = countPipelineRuns(
      configs.map((c) => c.options.length),
      pipelineCombination,
    );
    if (!trimmedPrompt || (!isPipeline && selectedModels.size === 0) || (isPipeline && pipelineRunCount === 0)) return;

    setIsLoading(true);
    const params = toModelParameters(parameters);
    const allKnown = [...availableModels, ...knownModels];
    const models = allKnown.filter(
      (m, index, arr) => selectedModels.has(m.id) && arr.findIndex((x) => x.id === m.id) === index,
    );
    const pipelineModels = configs
      .flatMap((c) => c.options.map((o) => o.model))
      .filter((m, index, arr) => arr.findIndex((x) => x.id === m.id) === index);

    const session: ModelComparisonSession = {
      id: `MA-${Date.now().toString(36).toUpperCase()}`,
      state: mode === ComparisonMode.OneShot || isPipeline ? SessionState.Running : SessionState.ReworkRunning,
      createdAt: new Date().toISOString(),
      creator: getCreatorIdentity(),
      mode,
      prompt: trimmedPrompt,
      systemPrompt: systemPrompt.trim() || undefined,
      parameters: params,
      models: isPipeline ? pipelineModels : models,
      results: [],
      reworkRounds: mode === ComparisonMode.Rework || isBenchmark ? reworkRounds : 0,
      critiquePrompt: mode === ComparisonMode.Rework || isBenchmark ? critiquePrompt : undefined,
      pipelineRoles: isPipeline ? [] : undefined,
      pipelineCombination: isPipeline ? pipelineCombination : undefined,
      linkedMessages: undefined,
      tags: undefined,
      parentSessionId: initialDraft?.id,
    };

    if (isPipeline) {
      // Runs execute in parallel; steps within a run stay sequential.
      setProgress(`Running ${pipelineRunCount} pipeline run${pipelineRunCount === 1 ? "" : "s"}...`);
      await runPipeline(session, params);
    } else {
      // Dispatch all pipelines in parallel; each model runs its own stage
      // pipeline per arm (benchmark mode adds the specialist arm).
      setProgress(`Running ${models.length} model${models.length === 1 ? "" : "s"}...`);
      const pipelines = models.flatMap((model) =>
        isBenchmark
          ? [runModelPipeline(session, model, params), runSpecialistPipeline(session, model)]
          : [runModelPipeline(session, model, params)],
      );
      const settled = await Promise.allSettled(pipelines);
      settled.forEach((entry, i) => {
        if (entry.status === "fulfilled") {
          session.results.push(entry.value);
          return;
        }
        const armCount = isBenchmark ? 2 : 1;
        const model = models[Math.floor(i / armCount)];
        if (!model) return;
        const outputs = [errorOutput(1, entry.reason)];
        session.results.push({
          model,
          arm: isBenchmark ? (i % armCount === 0 ? "model" : "specialist") : undefined,
          outputs,
          trr: computeTrrMetrics({ outputs }),
          vcvFeedback: undefined,
        });
      });
    }

    session.state =
      mode === ComparisonMode.Rework || isBenchmark ? SessionState.ReworkCompleted : SessionState.Completed;

    // Emit TRR events against the host workspace when mounted in TAP.
    const trrEvents = emitSessionTrrEvents(session, workspaceId ?? getWorkspaceId());
    console.log("TRR events emitted:", trrEvents);

    saveSession(session);

    // Write the durable artifact set to the conversation VFS (no-op outside
    // the host). Pipeline runs already wrote per-role outputs as they ran.
    const vfsResult = await writeSessionArtifacts(session, trrEvents, conversationId).catch(() => null);
    if (vfsResult) {
      console.log(`Model Arena artifacts written to VFS: ${vfsResult.root} (${vfsResult.written} files)`);
    }

    setIsLoading(false);
    setProgress("");
    onSessionCreated(session);
  };

  const filteredModels = modelSearch.trim()
    ? availableModels.filter((m) => {
        const q = modelSearch.trim().toLowerCase();
        return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
      })
    : availableModels;

  return (
    <div className="session-composer">
      <FieldGroup>
        <Field>
          <FieldLabel>OpenRouter Connection</FieldLabel>
          {connection === null ? (
            <FieldDescription>Checking host connection…</FieldDescription>
          ) : connection.hostHttp ? (
            <HostCredentialPicker
              connection={connection}
              credentialRef={credentialRef}
              onSelect={setCredentialRef}
            />
          ) : (
            <>
              <FieldDescription>
                No host HTTP transport detected (standalone preview). Using a local developer key instead.
              </FieldDescription>
              {apiKeyConfigured && !showApiKeyEditor ? (
                <div className="row">
                  <FieldDescription>Local key configured</FieldDescription>
                  <Button variant="outline" size="sm" onClick={() => setShowApiKeyEditor(true)}>
                    Change
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setApiKey("");
                      setApiKeyConfigured(false);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              ) : (
                <div className="row">
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-or-..."
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="secondary"
                    disabled={!apiKeyInput.trim()}
                    onClick={() => {
                      setApiKey(apiKeyInput);
                      setApiKeyConfigured(hasApiKey());
                      setApiKeyInput("");
                      setShowApiKeyEditor(false);
                    }}
                  >
                    Save Key
                  </Button>
                </div>
              )}
            </>
          )}
        </Field>

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
            <FieldDescription>
              Runs each model twice: direct calls (model arm) and through the Arena Reviser specialist
              (specialist arm), with identical prompts and rework rounds. Specialist-arm token counts are
              estimated — the host reports text, not usage.
            </FieldDescription>
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
                {countPipelineRuns(
                  pipelineRoles.map((r) => r.options.filter((o) => o.modelId.trim() !== "").length),
                  pipelineCombination,
                )}{" "}
                run(s)
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
                        placeholder="model id, e.g. openai/gpt-4o"
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
                        <option value="specialist">Model + Specialist</option>
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
                    <Button variant="outline" size="sm" onClick={() => addOption(role.id)}>
                      Add Option
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button variant="outline" size="sm" onClick={addRole}>
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
          {availableModels.length === 0 ? (
            <>
              <Button variant="secondary" onClick={loadModels} isLoading={isLoadingModels}>
                {isLoadingModels ? "Loading Models..." : "Load Models from OpenRouter"}
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
                  >
                    {model.name}
                  </Button>
                ))}
            </div>
          )}
          <div className="row">
            <Input
              type="text"
              value={manualModelId}
              onChange={(e) => setManualModelId(e.target.value)}
              placeholder="Or add a model by ID, e.g. openai/gpt-4o"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManualModel();
                }
              }}
            />
            <Button variant="secondary" onClick={addManualModel} disabled={!manualModelId.trim()}>
              Add
            </Button>
          </div>
        </Field>
        )}

        <Field>
          <FieldLabel>Parameters</FieldLabel>
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
                  value={parameters.maxTokens}
                  onChange={(e) =>
                    setParameters((p) => ({ ...p, maxTokens: parseInt(e.target.value, 10) }))
                  }
                />
              ) : (
                <FieldDescription>No cap — model decides when to stop</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="ma-top-p">Top P (optional)</FieldLabel>
              <Input
                id="ma-top-p"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={parameters.topP}
                onChange={(e) => setParameters((p) => ({ ...p, topP: e.target.value }))}
                placeholder="Model default"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ma-provider-sort">Provider sort (optional)</FieldLabel>
              <NativeSelect
                id="ma-provider-sort"
                value={parameters.providerSort}
                onChange={(e) =>
                  setParameters((p) => ({
                    ...p,
                    providerSort: e.target.value as ParameterState["providerSort"],
                  }))
                }
              >
                <option value="">No preference</option>
                <option value="price">Price</option>
                <option value="throughput">Throughput</option>
                <option value="latency">Latency</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel className="row">
                <Checkbox
                  checked={parameters.zdr}
                  onCheckedChange={(checked) =>
                    setParameters((p) => ({ ...p, zdr: checked === true }))
                  }
                />
                Zero data retention only
              </FieldLabel>
            </Field>
          </div>
        </Field>

        <Button
          onClick={runComparison}
          disabled={
            isLoading ||
            !prompt.trim() ||
            (mode === ComparisonMode.Pipeline
              ? countPipelineRuns(
                  pipelineRoles.map((r) => r.options.filter((o) => o.modelId.trim() !== "").length),
                  pipelineCombination,
                ) === 0
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

/** Credential picker for host mode: metadata only, secrets never enter JS. */
function HostCredentialPicker({
  connection,
  credentialRef,
  onSelect,
}: {
  connection: HostConnection;
  credentialRef: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const matches = connection.credentials.filter(isOpenRouterCredential);
  const options = matches.length > 0 ? matches : connection.credentials;

  if (!connection.credentialDiscovery || connection.credentials.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No OpenRouter credential found</AlertTitle>
        <AlertDescription>
          Add an OpenRouter HTTP credential (bearer token) in TAP Settings, then reload this app.
          Requests are made by the host and the secret never enters the miniapp.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {matches.length === 1 ? (
        <FieldDescription>
          Using workspace credential: {matches[0]?.displayName} ({matches[0]?.credentialType})
        </FieldDescription>
      ) : (
        <NativeSelect
          value={credentialRef ?? ""}
          onChange={(e) => onSelect(e.target.value || undefined)}
        >
          <option value="">Select a credential…</option>
          {options.map((credential) => (
            <option key={credential.id} value={credential.id}>
              {credential.displayName} ({credential.credentialType})
            </option>
          ))}
        </NativeSelect>
      )}
      {matches.length === 0 && (
        <FieldDescription>
          No stored credential mentions OpenRouter — showing all {connection.credentials.length} stored credential
          {connection.credentials.length === 1 ? "" : "s"} above.
        </FieldDescription>
      )}
    </>
  );
}
