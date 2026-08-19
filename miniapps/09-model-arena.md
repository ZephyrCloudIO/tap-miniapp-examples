# Model Arena

**Status:** Proposed
**Audience:** Developer teams using OpenRouter
**Data approach:** VFS-backed session artifacts with TRR content-free event emission and plot-ledger session history
**Primary method:** Side-by-side model comparison with TRR-informed quality scoring, including two-stage rework validation

## Product idea

Model Arena is a public TAP miniapp that lets teams compare AI models empirically through the lens of **Token Retention Rate (TRR)** — not just raw cost. Send the same prompt to multiple OpenRouter models simultaneously, inspect outputs side-by-side with cost, latency, *and rework survival* overlaid, and save the results as durable artifacts. It ships as a package in [ZephyrCloudIO/tap-miniapp-examples](https://github.com/ZephyrCloudIO/tap-miniapp-examples), not as a first-party TAP domain.

The design solves a concrete problem: OpenRouter exposes 400+ models across dozens of providers, but choosing the right one is guesswork. Worse, one-shot benchmarks hide the real cost: a cheap model that produces output requiring heavy rework is often more expensive *and* slower than a pricier model that nails it the first time. Model Arena measures **what actually survives** — using TRR's content-free survival analytics — so teams optimize for retained value, not just low sticker price.

Teams should be able to start a comparison from a channel message, a miniapp UI, or a prompt shared by a teammate. Every comparison produces VFS artifacts and emits TRR-compatible content-free events. A plot ledger keeps a searchable history so teams build institutional knowledge about which models produce durable output for which tasks.

The product boundary matters. The package provides the complete capability: comparison session schema, TRR event emission, VFS artifact layout, channel rendering, the specialist that suggests models and interprets results, and the miniapp UI. TAP provides only generic SDK and manifest primitives; it must not gain a model-comparison-specific silo, database, or conditional path.

## Outcomes

The miniapp should help a team:

- Compare any OpenRouter model against any other with identical prompts and parameters.
- See cost, latency, token usage, throughput, **turn pressure**, and **effective cost per retained token (ECRT)** per model overlaid on the same view.
- Run **two-stage rework comparisons**: generate, critique, and measure how well each model revises its own output.
- Emit **TRR-compatible content-free events** (`TokenBatchProduced`, `TokenEdited`, `TurnStamped`, `TurnPressureShadowed`) for every comparison run, feeding workspace survival analytics.
- Save comparison sessions as durable VFS artifacts that can be shared, re-opened, and forked.
- Trigger comparisons directly from a channel message or prompt artifact.
- Render live comparison results in a channel as a rich card with expandable model outputs and TRR quality signals.
- Build a plot-ledger history of comparisons searchable by model, prompt topic, cost range, **survival rate**, and outcome.
- Receive model suggestions from a specialist that knows the team's past comparison outcomes **and TRR survival patterns**.
- Detect when a model's price or availability changes and flag affected saved comparisons.
- Export a comparison as Markdown, HTML, or TRR aggregate JSON for documentation and analytics.

## Example interactions

- "Compare Claude Sonnet 4, GPT-4o, and DeepSeek V3 on this prompt."
- "Run a **rework arena** on this prompt — I want to see who survives critique best."
- "What did we learn last time about code-generation models' **retention rates**?"
- "Which model had the lowest **ECRT** for JSON extraction last quarter?"
- "Share this comparison to the channel so the team can vote on **survival quality**."
- "Fork this session and make the prompt more adversarial."
- "Which model was cheapest **per retained token** and was the output acceptable?"
- "Suggest three models to compare for long-context summarization under $0.005 per 1K *retained* tokens."
- "Show me every comparison where GPT-4o lost on **survival rate** to a cheaper alternative."
- "Flag any saved comparison where a model's price has increased since we ran it."
- "Export this comparison as TRR aggregate for the study pipeline."
- "Start an arena from this channel message."
- "What models should I compare for structured JSON extraction with **low rework pressure**?"

## Session lifecycle

A comparison session moves through explicit states:

`draft → running → completed → (rework_running → rework_completed) → shared → archived`

### draft

The user selects models, enters a prompt, configures parameters, and chooses comparison mode:
- **One-shot mode** — single generation per model (default).
- **Rework mode** — two-stage: generate then critique+revise (see Two-Stage Rework Flow below).

The session is saved as a VFS artifact in draft state. Drafts can be edited, discarded, or promoted to running.

### running

The miniapp dispatches parallel `chat.send` requests to OpenRouter for each selected model. Streams are collected and stored per model. The UI shows live progress: which models have started, which are streaming, which have completed, and any errors or fallbacks.

On completion, the miniapp:
1. Queries the OpenRouter generation endpoint for exact cost.
2. Emits a `TokenBatchProduced` TRR event (content-free: token counts, graphemes, shingles, cost micros).
3. Emits a `TurnStamped` TRR event with runtime model, provider, latency, and iteration count.

### completed

All models have returned. The session artifact is updated with outputs, cost, latency, token usage, generation IDs, and TRR event receipts. The user can inspect results, retry failed models, add new models, or promote to **rework mode**.

### rework_running / rework_completed

If rework mode is enabled, the miniapp sends each model's own output back as context with a critique prompt. Each model revises its previous answer. TRR events are emitted for the revision:
- `TokenEdited` — content-free edit metrics (graphemes/tokens added/removed, death mode, severity classification).
- Updated `TurnStamped` with `iteration_count`, `discarded_completion_tokens`, and `regenerated_token_count`.
- `TurnPressureShadowed` — retry pressure score (`r_i`) measuring rework burden.

### shared

The session is linked to a channel message or shared with teammates. The channel renders a compact comparison card with expandable outputs, metrics table, and **TRR survival summary**.

### archived

Old or irrelevant sessions are archived. They remain in the plot ledger and are searchable but do not appear in default views.

## VFS artifact layout

Each comparison session receives a VFS directory with immutable artifacts:

```text
/model-arena/
  sessions/
    MA-2026-0042/
      session.json
      prompt.md
      outputs/
        openai--gpt-4o/
          stage-1.json
          stage-2.json          # present only in rework mode
        anthropic--claude-sonnet-4/
          stage-1.json
          stage-2.json
        deepseek--deepseek-v3/
          stage-1.json
          stage-2.json
      metrics.json
      receipt.json
      trr-events/               # content-free TRR events emitted by this session
        token-batch-produced/
        token-edited/           # present only in rework mode
        turn-stamped/
        turn-pressure-shadowed/ # present only in rework mode
```

- `session.json` — session metadata: id, state, created_at, creator, models selected, parameters, comparison mode, links to channel messages or tasks.
- `prompt.md` — the exact user prompt and system prompt, versioned so forks reference the prompt they started from.
- `outputs/<model-slug>/stage-N.json` — per-model, per-stage output: full response text, finish_reason, role, timestamp, streaming chunks if captured, and raw API response envelope.
- `metrics.json` — normalized metrics across all models and stages: cost, latency, tokens, throughput, fallback events, **turn pressure**, **retention rate**, and **ECRT**.
- `receipt.json` — OpenRouter generation IDs, provider actually used, query timestamps, and TRR event emission receipts for audit.
- `trr-events/` — content-free TRR events emitted by this session. Each subdirectory contains JSON files matching the `ContentFreeTrrEvent` schema. These are **not** the canonical TRR ledger (which lives in the workspace TRR store), but they are a recoverable record of what was emitted.

Every file is written once and treated as immutable after the session transitions out of `running` or `rework_running`. Forks create new session directories; they do not mutate the original.

## Two-stage rework flow

The rework flow tests how well each model handles **self-revision** when given critique. This maps directly to TRR's core insight: the cost of a turn is not the cost of generation, but the cost of generation *plus* the cost of everything that gets discarded in rework.

### Stage 1 — Generate

All models produce their initial output from the user prompt. Standard one-shot comparison. TRR events emitted:
- `TokenBatchProduced` — tokens emitted at stage 1.
- `TurnStamped` — turn metadata with `iteration_count: 0`.

### Stage 2 — Critique & Revise

The miniapp constructs a critique prompt for each model. The critique prompt includes:
- The model's own stage-1 output.
- A critique instruction (either a fixed template, a human-provided critique, or a separate "judge" model's critique).
- A request to revise the output addressing the critique.

Each model receives its own output + critique and produces a revised output. TRR events emitted:
- `TokenEdited` — content-free edit event capturing:
  - `graphemes_added`, `graphemes_removed`, `tokens_added`, `tokens_removed`
  - `death_mode`: `Edit` (in-place revision) or `Regenerate` (full rewrite)
  - `edit_actor_relation`: `AgentSelfEdit` (the model editing its own prior output)
  - `severity_tier`: classified by rule (NoOp, Minor, Moderate, Major, Critical)
- Updated `TurnStamped` with:
  - `iteration_count: 1`
  - `discarded_completion_tokens`: stage-1 tokens that were replaced
  - `regenerated_token_count`: stage-2 completion tokens
- `TurnPressureShadowed` — retry pressure score:
  - `p_i`: probability of revision given the critique
  - `g_of_p`: pressure transformation
  - `r_i`: composite retry pressure

### Rework metrics

| Metric | Definition | TRR mapping |
|--------|-----------|-------------|
| **Improvement delta** | Did quality score go up, down, or stay flat? | `TokenSurvived` at immediate horizon |
| **Rework cost** | Additional tokens + latency for stage 2 | `TurnStamped` stage-2 cost micros |
| **Discarded token rate** | `discarded_completion_tokens / stage_1_tokens` | Direct from `TurnStamped` |
| **Retention rate** | `(stage_1_tokens - discarded) / stage_1_tokens` | `TokenSurvived` surviving fraction |
| **Total ECRT** | `(stage_1_cost + stage_2_cost) / retained_token_weight` | TRR `effective_cost_per_retained_unit_micros` |
| **Turn pressure (r_i)** | Composite rework burden score | `TurnPressureShadowed` |

A model with low stage-1 cost but high `discarded_completion_tokens` and high `r_i` is worse value than a model with higher stage-1 cost but near-zero rework.

## TRR integration

Model Arena is a **TRR event producer**. Every comparison run emits content-free events into the workspace's TRR recorder. The miniapp does not own the TRR ledger or aggregation pipeline; it produces events that feed into the existing `zephyr-analytics` TRR system.

### Event emission per session

| Event | When emitted | Content-free payload |
|-------|-------------|---------------------|
| `TokenBatchProduced` | After each stage completes | Token counts, graphemes, shingles, cost micros, model ID, provider ID |
| `TurnStamped` | After each stage completes | Runtime model, provider, latency, iteration count, tool calls, fallback chain |
| `TokenEdited` | After stage 2 (rework mode) | Graphemes/tokens added/removed, death mode, severity tier, edit actor relation |
| `TurnPressureShadowed` | After stage 2 (rework mode) | `p_i`, `g_of_p`, `r_i`, iteration count, stream retry count |
| `TokenSurvived` | After human review or time-based horizon | Surviving token count, surviving weight, horizon, death mode |

### Content-free constraints

Following TRR's design, Model Arena **never** emits raw prompt text, completion text, or diff summaries into TRR events. The events carry:
- Token counts, grapheme counts, shingle hashes (not text)
- Model/provider identifiers
- Cost in USD micros
- Latency in milliseconds
- Edit geometry (added/removed counts, not content)
- Death modes and severity classifications

Raw outputs live only in the VFS `outputs/` directory, which is subject to workspace data-retention policy, not the TRR ledger.

### VCV feedback bridge

After a comparison completes, users can submit **VCV feedback** on each model's output:
- **Routing feedback**: Was the model choice appropriate for this prompt?
- **Response feedback**: Was the output quality acceptable?

This feedback is recorded via the existing `VcvFeedbackAuthority` and associated with the comparison session's turn IDs. It feeds into the workspace's TRR study pipeline alongside automated survival metrics.

## Channel-native comparison

The channel is a first-class surface, not an afterthought.

### Starting from a channel

A participant can tag the Model Arena specialist with a prompt:

> @model-arena compare Claude Sonnet 4, GPT-4o, and Gemini 2.5 Pro on: "Summarize this API changelog in two sentences."
>
> @model-arena **rework-arena** Claude Sonnet 4, GPT-4o on: "Write a Python function to validate email addresses."

The specialist:
1. Parses the prompt, model list, and mode (one-shot vs rework).
2. Validates that all models are available on OpenRouter.
3. Creates a draft session in the VFS.
4. Posts a draft card to the channel for confirmation.
5. On confirmation, transitions to `running` (or `rework_running`) and streams progress.
6. On completion, replaces the draft with a results card including TRR metrics.

### Results card

The channel results card shows:
- A compact table: model, cost, latency, tokens, **discarded tokens**, **retention rate**, **ECRT**.
- Expandable sections for each model's full output (both stages in rework mode).
- A **TRR survival summary**: survival rate at immediate horizon, turn pressure, death mode distribution.
- A deep link to the full miniapp view.
- Actions: "Fork", "Add model", "Run rework", "Submit VCV feedback", "Export", "Save to ledger".

### Conversation continuation

Participants can reply to the results card conversationally:

- "Add DeepSeek V3 to this comparison." — The specialist appends the model and re-runs.
- "Was there a fallback?" — The specialist checks `receipt.json` and reports.
- "Which had the lowest ECRT?" — The specialist interprets TRR metrics.
- "Run rework on all models." — Promotes to `rework_running` with a default critique prompt.
- "Rate GPT-4o's output as acceptable." — Submits VCV response feedback.
- "Turn this into a task to update our model recommendation." — Creates a linked TAP task.

### Intake context action

The miniapp contributes a context action on channel messages and prompt artifacts. The action receives a host-minted immutable Artifact Reference and offers:
1. Start a new **one-shot** comparison using this message as the prompt.
2. Start a **rework arena** using this message as the prompt.
3. Attach this message as context to an existing draft session.
4. Compare the model used to reply against two alternatives.

## Model selection and specialist suggestions

### Manual selection

Users pick models from a searchable, filterable list sourced from `models.list`. Filters: provider, price range, context length, capabilities (vision, JSON mode, tool use), and sort (price, throughput, rating, **TRR survival rate**).

### Specialist suggestions

The Model Arena specialist suggests models based on:
- The prompt's inferred task type (code, creative, reasoning, summarization, JSON extraction).
- The team's past comparison outcomes (which models won for similar tasks).
- The team's **TRR survival patterns** (which models have highest retention rates for this task type).
- Explicit constraints from the user (max cost, latency budget, context length, **max acceptable ECRT**).
- Current OpenRouter availability and pricing.

Suggestions are proposed, not imposed. The specialist explains why each model was recommended:

> "For structured JSON extraction under tight latency, I suggest:
> 1. **GPT-4o-mini** — lowest ECRT in this workspace for JSON tasks (92% retention, $0.12 per 1K retained).
> 2. **Claude 3.5 Haiku** — slightly higher ECRT but better nested schema handling (88% retention).
> 3. **Gemini 2.0 Flash** — best throughput, moderate retention (85%), good for batch workloads."

## Metrics and cost transparency

After a session completes, the miniapp queries the OpenRouter generation endpoint for each model's exact cost and native token counts. The metrics layer normalizes across models:

| Metric | Source | Normalization |
|--------|--------|---------------|
| Cost | `/api/v1/generation?id=` | USD micros, per-request |
| Latency (TTFB) | Client-measured | Milliseconds from request to first stream chunk |
| Latency (total) | Client-measured | Milliseconds from request to final chunk |
| Tokens (prompt) | `usage.prompt_tokens` or generation query | Model-agnostic normalized count |
| Tokens (completion) | `usage.completion_tokens` or generation query | Model-agnostic normalized count |
| Throughput | `completion_tokens / total_latency` | Tokens per second |
| Fallback | `receipt.json` provider field | Flag if actual provider differed from requested |
| **Discarded completion tokens** | `TurnStamped.discarded_completion_tokens` | Tokens from prior stage that were replaced |
| **Regenerated token count** | `TurnStamped.regenerated_token_count` | Tokens produced in revision stage |
| **Iteration count** | `TurnStamped.iteration_count` | Number of rework cycles |
| **Turn pressure (r_i)** | `TurnPressureShadowed.r_i` | Composite rework burden score |
| **Retention rate** | `(1 - discarded / emitted)` at immediate horizon | Fraction of tokens surviving rework |
| **ECRT** | `total_cost_micros / retained_token_weight` | Effective cost per retained token |

If a generation query fails, the miniapp falls back to `usage` fields from the streaming response and flags the cost estimate as approximate.

## Plot ledger

The plot-ledger stores a searchable index of all comparison sessions. Each session commits a lightweight ledger entry:

```yaml
session_id: MA-2026-0042
created_at: "2026-08-17T12:00:00Z"
creator: "zackarychapple"
state: completed
comparison_mode: rework
prompt_summary: "Validate email addresses in Python"
models:
  - openai/gpt-4o
  - anthropic/claude-sonnet-4
cost_range:
  stage_1_min: 0.00012
  stage_1_max: 0.00045
  total_min: 0.00018
  total_max: 0.00092
trr_summary:
  gpt-4o:
    retention_rate: 0.94
    discarded_tokens: 12
    regenerated_tokens: 180
    turn_pressure: 0.08
    ecrt_micros: 0.67
  claude-sonnet-4:
    retention_rate: 0.89
    discarded_tokens: 45
    regenerated_tokens: 210
    turn_pressure: 0.22
    ecrt_micros: 1.14
winner: # user-marked or specialist-suggested
  model: openai/gpt-4o
  reason: "lowest ECRT, highest retention, acceptable output quality"
vcv_feedback:
  - model: openai/gpt-4o
    response_acceptable: true
    routing_appropriate: true
linked_messages:
  - "msg_abc123"
tags:
  - code-generation
  - python
  - validation
```

The ledger enables queries like:
- "Show all rework arena comparisons from the last 30 days."
- "Which model has the highest retention rate for code generation in this workspace?"
- "Find comparisons where the cheapest model had the worst ECRT."
- "Show me models where VCV feedback disagreed with TRR survival rates."

## Forking and versioning

Any completed session can be forked. A fork:
1. Copies the original prompt and parameters to a new session directory.
2. Links back to the parent session in `session.json`.
3. Allows editing the prompt, adding/removing models, changing parameters, or **switching comparison mode**.
4. Runs as an independent session with its own artifacts and TRR events.

Fork chains are visible in the miniapp UI and the plot ledger. This supports iterative prompt engineering: "make it more adversarial," "add a system prompt," "try with temperature 0," "run as rework arena instead of one-shot."

## Export and documentation

Completed sessions can be exported:
- **Markdown** — table of metrics (including TRR) plus collapsible code blocks for each output. Good for RFCs and documentation.
- **HTML** — styled report with syntax highlighting and TRR visualizations. Good for sharing externally.
- **JSON** — full session artifact for programmatic consumption.
- **TRR Aggregate JSON** — content-free aggregate cells compatible with the TRR study pipeline. Good for feeding into workspace analytics.
- **Channel card** — re-post the results card to any channel.

## Product surfaces

### Miniapp UI

The miniapp provides:
- A searchable ledger of all workspace comparison sessions with TRR filtering.
- A session composer: prompt editor, model picker, parameter configuration, **comparison mode toggle** (one-shot / rework).
- A results viewer: side-by-side outputs with synchronized scrolling, metrics overlay, **TRR survival chart**, and expandable detail panes.
- A **rework inspector**: stage-1 vs stage-2 diff view with edit severity classification.
- A fork/branch UI showing the session family tree.
- A settings page for default models, cost alerting, specialist preferences, and **TRR event emission toggles**.

### Channel attention

Running sessions and completed results publish normalized Attention Contributions to Home. A session that stalls on an error, a model that returns a surprising fallback, or a **rework stage with high turn pressure** is visible alongside other workspace obligations.

### Intake context action

As described above, available on messages and prompt artifacts with both one-shot and rework arena options.

## Authorization and auditability

- TAP checks permissions when a session is created, viewed, or modified; the miniapp does not maintain a parallel standing-grant model.
- Every session records creator, timestamp, and model-usage provenance in `session.json` and `receipt.json`.
- TRR events are content-free by design; no raw prompt or completion text enters the TRR ledger.
- Cost data is queried using the workspace's OpenRouter API key; the miniapp does not store keys in VFS artifacts.
- VCV feedback requires workspace permission checks via the existing `VcvFeedbackAuthority`; Model Arena does not bypass authorization.
- Forks preserve parent provenance; the full chain is reconstructible.
- Channel-rendered results respect the channel's visibility rules; private sessions are not rendered in public channels.
- Generation IDs and receipts make every cost claim auditable against OpenRouter's own records.
- TRR event emission receipts in `trr-events/` make every analytics claim auditable against the workspace TRR ledger.

## TAP capabilities demonstrated

- VFS-backed immutable artifacts with structured session layout and TRR event receipts
- **TRR content-free event emission** (`TokenBatchProduced`, `TokenEdited`, `TurnStamped`, `TurnPressureShadowed`)
- Channel-native comparison triggering and results rendering with TRR metrics
- Context actions with host-minted immutable artifact references (one-shot and rework modes)
- Plot-ledger session history with searchable TRR metadata
- Specialist model suggestions based on task inference, historical outcomes, **and TRR survival patterns**
- Parallel multi-model dispatch via `chat.send`
- Post-hoc cost and token reconciliation via generation query
- **Two-stage rework flow with critique and self-revision**
- **Content-free edit classification** (severity tier, death mode, edit actor relation)
- Turn pressure scoring (`r_i`) for rework burden quantification
- VCV feedback integration for human quality validation
- Fork versioning with parent-provenance chains
- Export to Markdown, HTML, and TRR aggregate JSON
- Home attention contributions for long-running or high-pressure comparisons

## Implementation phases

### Phase 1: vertical slice

The acceptance journey, end to end, for one real comparison in a channel:

- VFS session artifact layout with `session.json`, `prompt.md`, `outputs/`, `metrics.json`, `receipt.json`, and `trr-events/`
- Channel-triggered **one-shot** comparison with draft confirmation and progress streaming
- Results card rendering in channel with expandable outputs and metrics table
- Side-by-side miniapp UI for inspecting completed sessions
- Plot-ledger entry creation and basic search
- Manual model selection from `models.list`
- Post-completion generation query for exact cost
- Fork operation creating a new VFS session from a parent
- Export to Markdown
- **TRR event emission** (`TokenBatchProduced`, `TurnStamped`) for one-shot sessions

### Phase 2: rework and intelligence

- **Two-stage rework flow**: stage-1 generate, stage-2 critique+revise with TRR edit events
- `TokenEdited`, `TurnPressureShadowed` event emission for rework sessions
- Rework inspector UI: stage-1 vs stage-2 diff with edit severity overlay
- Model Arena specialist with task-type inference, historical outcomes, and **TRR survival patterns**
- TRR-based model suggestions ("highest retention for this task type")
- VCV feedback bridge for human quality validation
- Price-change detection flagging affected saved comparisons
- Advanced filters in model picker (capability tags, EU routing, BYOK eligibility, **TRR survival rate**)
- Batch comparison: queue multiple prompts against the same model set
- Team-wide default model sets and shared comparison templates
- Export to HTML, JSON, and **TRR aggregate JSON**

### Phase 3: integration and polish

- Integration with Engineering Change: attach comparison evidence (with TRR metrics) to RFCs
- Integration with Pyre: compare model outputs during incident analysis
- Public comparison sharing with anonymized prompts and TRR aggregates
- Workspace analytics: model preference trends, **TRR survival rate trends**, cost savings from comparisons
- Cross-referencing TRR survival rates with VCV feedback for model recommendation refinement
- Final package naming, documentation, and release path

## Non-goals for the initial vertical slice

- Real-time benchmark polling or leaderboard maintenance
- Automatic model selection without user confirmation
- Cost prediction before running (use advertised pricing only)
- BYOK credential management (defer to Key Command or manual setup)
- Observability destination configuration
- Cryptographic attestations of comparison fairness
- **TRR aggregation or survival analysis** (the miniapp produces events; `zephyr-analytics` owns aggregation)
- **LLM judge for edit classification** (rule-based classification only in initial slice)

## Open decisions

- Exact VFS schema and migration strategy
- Whether to cache `models.list` and how often to refresh
- Ledger granularity when teams need separate VFS backings
- Specialist confidence thresholds for suggestions
- Channel card interaction design (expand in place vs. deep link)
- Fork depth limits and garbage collection policy
- **TRR event emission rate limiting and backpressure handling**
- **Default critique prompt templates for rework mode**
- **Whether to support external judge models for critique generation**
- Desktop-only dogfood versus cross-platform acceptance
- Package naming, licensing, documentation, and release path

## Public example value

Model Arena demonstrates that a public package can own a complete developer tooling domain on generic TAP primitives: VFS artifacts, channel rendering, plot-ledgers, specialist suggestions, **and TRR event emission** — all without TAP gaining any model-comparison-specific machinery. It turns OpenRouter's biggest user challenge (model choice) into an empirical, collaborative, and auditable workflow grounded in **Token Retention Rate analytics**. It gives developers a concrete blueprint for building interactive agent-assisted tools that produce durable, shareable artifacts while feeding into a workspace's broader understanding of model quality and cost efficiency.
