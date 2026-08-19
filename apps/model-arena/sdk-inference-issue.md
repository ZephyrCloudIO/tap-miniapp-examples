# Miniapp SDK: direct inference API with specialist-first guidance, plus TRR benchmark (model vs model + specialist)

## Background

While building **Model Arena** ([tap-miniapp-examples](https://github.com/ZephyrCloudIO/tap-miniapp-examples), `apps/model-arena`) — a miniapp that compares OpenRouter models side-by-side with TRR-informed quality metrics — we hit a structural gap in `@theaiplatform/miniapp-sdk` (verified against 0.8.0):

**The SDK has no direct inference API.** The surface area today:

- `sdk.http.request(...)` + `credentialRef` — host-mediated bounded HTTP to an external provider (what Model Arena currently uses for `/models` and `/chat/completions` against `https://openrouter.ai`)
- `runSpecialist(...)` (new in 0.8.0) — typed specialist turns with `SpecialistOutcome`, optional `modelOverride`, channel-less private rooms
- `sdk.trr.*` (new in 0.8.0) — read-side workspace TRR aggregates (`getEcrt`, `getMdTrr`, `getSurvivalCounts`, `getDeathCauses`, throttled `sweep`)

Routing inference through generic host HTTP works, but it bypasses everything the host is good at: model routing policy, usage accounting, authorization granularity, and — most importantly for us — **TRR event emission**. Turns dispatched via raw HTTP never become `TokenBatchProduced` / `TurnStamped` / `TokenEdited` events, so comparison sessions are invisible to the workspace's retention analytics even though they are exactly the kind of workload TRR is meant to measure.

## Proposal

Add a direct inference surface to the miniapp SDK, roughly:

```ts
type MiniAppInferenceApi = {
  /** Models available through the workspace's configured providers. */
  listModels(options?: { provider?: string }): MiniAppMaybePromise<{
    models: { id: string; provider: string; displayName: string; contextLength?: number }[];
  }>;

  /** Host-mediated chat completion. Secrets never enter miniapp JS; the host
   *  resolves the provider credential from the workspace integration or an
   *  opaque credentialRef. Every turn emits TRR content-free events. */
  send(options: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    parameters?: {
      temperature?: number;   // omit = provider default
      maxTokens?: number;     // omit = uncapped / model default
      topP?: number;
      providerSort?: "price" | "throughput" | "latency";
      zdr?: boolean;
    };
    /** Optional explicit credential; defaults to the workspace's provider integration. */
    credentialRef?: string;
    timeoutMs?: number;
  }): MiniAppMaybePromise<{
    text: string;
    finishReason: string;
    usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
    generationId?: string;   // for post-hoc cost reconciliation
    providerUsed?: string;   // actual provider after routing/fallback
    latencyMs: number;
    ttftMs?: number;
    costMicros?: number;
    /** Receipt of the TRR events the host emitted for this turn. */
    trrReceipt?: { turnId: string; emitted: string[] };
  }>;
};
```

Key properties:

1. **Host-mediated and credential-free.** Same trust model as `sdk.http`: the workspace's OpenRouter (or other) provider integration is the default auth path; `credentialRef` is the escape hatch. No key input in miniapp UI.
2. **TRR-native.** Every turn produces content-free TRR events (`TokenBatchProduced`, `TurnStamped`; rework flows need `TokenEdited`, `TurnPressureShadowed`) and returns an emission receipt, making eval tooling a first-class analytics producer instead of a blind spot.
3. **Optional parameters stay optional.** Unset fields (e.g. `maxTokens`) are omitted so provider/model defaults apply.
4. **Authorization.** A dedicated on-demand permission (e.g. `inference.invoke`) with cost-bearing risk classification, separate from `network.request` and from `specialists.invoke`.

## Specialist-first guidance

`runSpecialist` should remain **the recommended default** for ordinary turns: it carries prompt contracts, tool grants, failure taxonomy (`SpecialistFailureReason`), channel-less persistent rooms, and workspace model choice (`modelOverride` omitted). Direct inference exists for the cases specialists structurally can't serve:

- **Multi-model fan-out with identical prompts** (comparison/eval harnesses)
- **Raw parameter sweeps** (temperature/top-p/provider-sort grids)
- **N-round self-rework loops** where the app — not a specialist — owns the critique protocol and measures per-round survival
- **Provider-routing introspection** (fallback chains, provider_used) for cost/latency audits

SDK docs and the `runSpecialist` / inference doc comments should steer users accordingly: "if you are not comparing models or measuring rework, use `runSpecialist`."

## Acceptance sketch

- [ ] `MiniAppInferenceApi` (or equivalent) available on `sdk` with host-mediated transport and TRR event emission per turn
- [ ] Permission catalog entry for inference invocation with explicit cost-bearing risk
- [ ] Model Arena migrated from `sdk.http` + `credentialRef` to the inference API as the reference consumer
- [ ] Docs: specialist-first decision guidance (when to use `runSpecialist` vs direct inference)
