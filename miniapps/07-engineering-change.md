# Engineering Change

**Status:** Proposed
**Audience:** Enterprise
**Data approach:** App-defined plot ledger, repository-scoped CKG evidence, specialists, and workflows
**Primary method:** Assurance-policy-gated change lifecycle with CKG impact hypothesis and evidence

## Product idea

Engineering Change is a public TAP miniapp that owns an engineering change from its initial idea through proposal shaping, implementation review, finding disposition, and closure. It ships as a package in [ZephyrCloudIO/tap-miniapp-examples](https://github.com/ZephyrCloudIO/tap-miniapp-examples), not as a first-party TAP domain.

The design is directly inspired by two Cloudflare engineering posts, which this example explicitly credits:

1. [How Cloudflare enforces engineering standards using AI](https://blog.cloudflare.com/engineering-standards-enforcement/) — a governed RFC-based standards body that agents consume across code review, technical-design review, and incident review.
2. [Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/) — risk-tiered specialist routing, structured findings, shared context, a coordinator that deduplicates and verifies findings, and incremental re-review.

The miniapp adapts those ideas and extends them earlier in the lifecycle: the same system helps define the RFC before work begins, then compares the implementation with that approved intent. Shaping and review become one continuous, auditable process instead of disconnected gates.

Today, engineering standards are discovered too late. Ideas begin without the people and standards that should shape them. Design is reviewed separately from implementation, so reviewers lack the original intent. Findings are hard to route, disposition, and learn from. Teams cannot explain why a change required a full RFC, or show when work started before it was ready.

The product boundary matters as much as the feature set. The package provides the complete capability: plot schema and migrations, the Engineering Change lifecycle, Assurance Policy evaluation, skills, specialists and workflows, CKG evidence composition, review synthesis and findings, the human disposition UI, and public documentation with an example configuration. TAP provides only generic SDK and manifest primitives; it must not gain an Engineering Change-specific silo, database, or conditional path. This depends on [ZephyrCloudIO/ze-agency-tauri#7989](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/7989), which exposes generic plot and orchestration primitives in the public SDK.

The working vertical slice is accepted when one real change in `ze-agency-tauri` completes the full lifecycle using the public miniapp and published TAP primitives.

## Outcomes

The miniapp should help a team:

- Capture an idea from a channel message, pull request, task, or repository issue as a durable Engineering Change.
- Shape one Change Proposal for every change instead of choosing between a “brief” and an “RFC.”
- Classify each change with scoped, versioned Assurance Policies and an explainable Assurance Level.
- Compose a CKG Impact Hypothesis before work begins: predicted blast radius, likely owners, applicable standards, and similar historical changes.
- Coordinate required specialist feedback into a single deduplicated review.
- Record when a change became Ready for Work and when work actually started, with provenance.
- Generate exact, revision-bound CKG Impact Evidence after implementation and detect proposal-to-implementation drift.
- Disposition findings into TAP tasks, repository issues, or linked existing work, with recoverable receipts.
- Close the change with a complete, auditable record of intent, evidence, review, and resolution.
- Remain a public package built only on published miniapp SDK and manifest primitives.

## Example interactions

- “Forward this message into a new Engineering Change.”
- “What assurance level does this change need, and why?”
- “Which policies contributed to this classification?”
- “This touches authentication—does it require a full RFC?”
- “Draft the Impact Hypothesis for the billing worker change.”
- “Which review capabilities are required, and who is eligible to cover them?”
- “Show me the Effective Policy Snapshot for EC-2026-0042.”
- “Did work start before this change was ready?”
- “Compare the linked PR with the approved proposal.”
- “What drifted between the proposal and the implementation?”
- “Run the coordinated review on the linked PR.”
- “Why did the coordinator reject this candidate finding?”
- “Accept this finding and create a TAP task for it.”
- “Waive this finding with a reason, and file repository issues for the other two.”
- “What is waiting on me across open changes?”
- “Close the change and show the final record.”

## Change lifecycle and Change Proposal

An Engineering Change is the durable record connecting an idea through shaping, implementation, review, and resolution. A change may also begin at a later phase when implementation already exists—for example, when a pull request is forwarded into the miniapp after the fact.

The lifecycle moves through explicit, plot-resident states:

`idea → shaping → ready for work → implementation → review → disposition → closed`

Every transition is executed by a revision-aware workflow and committed to the plot, so the change's history is reconstructable at any point.

Every change has exactly one Change Proposal. Authors do not choose between writing a “brief” or an “RFC.” Instead, Assurance Policies assign an Assurance Level that controls how much depth the proposal requires and what review the change needs. A small copy edit and a cross-cutting authentication redesign travel the same path; the policy evaluation, not the author's optimism, decides how heavy the process is.

The proposal captures intent in a form that later evidence can be checked against: the problem, the proposed approach, the target scope, alternatives considered, and the questions still open. Because the proposal is the baseline for drift detection, it must be specific about what the change intends to touch and why.

## Assurance Levels and Assurance Policies

An Assurance Level is system-assigned, never self-selected:

- **Lightweight proposal** for low-risk, reversible, well-understood changes.
- **Full RFC** for changes that cross hard triggers or risk thresholds.
- **Full RFC plus required specialist reviews** when policies demand named Review Capabilities such as security or architecture.

When the classifier's confidence is low, the evaluation escalates rather than silently choosing the lowest level. A wrong lightweight classification is far more expensive than an unnecessary RFC.

An Assurance Policy is a persisted, versioned document containing hard triggers, risk dimensions, thresholds, required Review Capabilities, and approval requirements. Policies are scoped to a workspace, a team, or a project, and several policies can apply to the same change.

Evaluation follows five rules:

1. Evaluate every applicable policy independently.
2. Locked workspace requirements cannot be weakened by team or project policies.
3. Adjustable values may be overridden within workspace-defined bounds.
4. The highest Assurance Level from any applicable policy wins.
5. Freeze an Effective Policy Snapshot onto the change, recording the contributing scopes and policy revisions used.

The initial classifier considers objective dimensions: reach, reversibility, novelty, user impact, operational impact, and coordination.

Hard RFC triggers by default:

- Security
- Privacy
- Authentication or authorization
- Persistent-data migration
- Public contracts
- Cross-boundary architecture
- Destructive behavior
- Standards exceptions

Because the Effective Policy Snapshot is frozen at classification time, a team can always answer “why did this change require a full RFC?” with the exact policy revisions that demanded it—even after the policies themselves have moved on.

## Work readiness observability

Ready for Work is observable, not enforced, in the initial slice. The change records `ready_for_work_at`, `work_started_at`, and the source and provenance of the work-start signal.

The earliest observable implementation event wins:

- A linked task entering In Progress
- An implementation workflow or specialist beginning
- The linked pull request's first non-base commit
- An explicit Start Work action

The UI reports Started Before Ready when work preceded readiness, but it does not block the change. The goal for the slice is honest timing data a team can learn from, not a gate.

## Plot and persistence model

The package contributes an app-defined Engineering Change Plot Definition, including its schema and migrations. Git-like plot state is canonical: every durable artifact of the lifecycle lives in the plot, and every mutation is a revisioned commit.

New plots use Cloudflare artifact-backed managed storage by default, so a clean workspace can adopt the miniapp without configuring Git. A workspace may explicitly connect its own Git provider and repository and migrate the plot to that single authoritative backing. There is no permanent dual-write; migration moves the canonical state.

The miniapp owns the human-readable file layout:

```text
engineering-change-ledger/
├── policies/
│   ├── workspace.yaml
│   ├── teams/
│   └── projects/
└── changes/
    └── EC-2026-0042/
        ├── change.yaml
        ├── proposal.md
        ├── evidence/
        ├── reviews/
        └── findings/
```

- `policies/` holds the versioned Assurance Policies at workspace, team, and project scope.
- `change.yaml` is the durable Engineering Change record: lifecycle state, Assurance Level, Effective Policy Snapshot, readiness and work-start timestamps, and links to tasks, pull requests, and conversations.
- `proposal.md` is the Change Proposal.
- `evidence/` holds the Impact Hypothesis, Impact Evidence, and attached supporting material.
- `reviews/` holds the immutable Review Contributions and the Review Synthesis.
- `findings/` holds findings, their human dispositions, and the Action Receipts for follow-up work.

## CKG Impact Hypothesis and Impact Evidence

The Code Knowledge Graph remains a generic Code Knowledge capability. It does not learn Engineering Change semantics; the miniapp composes CKG output into two lifecycle-specific artifacts.

### Impact Hypothesis: before implementation

During shaping, the miniapp derives an Impact Hypothesis from the proposal's intent and target scope:

- Related symbols, communities, and processes in the graph
- Likely owners and the policies that apply to the affected scope
- Relevant standards the change must satisfy
- Similar historical changes and what happened to them
- Predicted blast radius
- Confidence and the unresolved questions reviewers should probe

The hypothesis gives reviewers the context that is otherwise discovered too late: who should shape the idea, which standards bear on it, and what the change is likely to disturb. It also seeds the baseline that implementation evidence will later be compared against.

### Impact Evidence: after implementation

Once a pull request is linked, the miniapp generates Impact Evidence from the exact repository revision and branch diff:

- Actual changed symbols and their callers
- Affected processes and files
- Coverage, fragility, and change-history signals for the touched area
- Actual ownership and policy scope of the change
- Proposal-to-implementation drift
- The graph build and repository revisions the evidence was derived from

Because the evidence is bound to a specific graph build and repository revision, every review claim can be traced to an exact code state rather than a moving target.

Material drift between the approved proposal and the observed implementation creates a Needs Reassessment human action. It does not block the change in the initial slice; it makes the drift visible to the people who approved the original intent.

## Review capabilities, skills, and transition workflows

### Review Capabilities

Policies require abstract Review Capabilities—security, architecture, test sufficiency, operability, domain ownership—not concrete specialist IDs. The workflow resolves each capability to the best eligible workspace specialist or a qualified human using declared capabilities, availability, policy scope, code ownership, and CKG specialist affinity.

Missing coverage becomes a Needs Assignment human action rather than being silently skipped. A required security review that no specialist or human can cover is a visible gap, not a quiet omission.

### Skills

A skill is a versioned, lifecycle-specific procedure with contract-checked inputs, required tools, evidence requirements, and output schemas. The same capability uses different skills at different phases: the security capability has one skill for the security impact hypothesis during shaping and a separate skill for security implementation review after a pull request is linked.

Every execution records the skill version and specialist version, so a finding can always be traced to the exact procedure that produced it.

### Transition workflows

The plot owns long-lived lifecycle state. Workflows are short-lived, idempotent, revision-aware transition executors:

1. Read the expected plot revision.
2. Run the required skills and specialists.
3. Produce evidence and proposed state changes.
4. Commit atomically against the expected revision.
5. End.

Pending human actions live in the plot, not inside a running workflow. When a human completes an action, the change resumes by starting the next transition workflow. A failed or superseded transition never leaves half-applied state, and observing a workflow run starting is itself one of the work-start signals the readiness model records.

## Coordinated review

Each required specialist writes an immutable Review Contribution containing structured candidate findings and their supporting evidence. Contributions are never edited in place; corrections arrive as new revisions.

A separately versioned Coordinator Skill then produces one Review Synthesis per review round. The coordinator:

- Deduplicates overlapping findings from different specialists.
- Re-categorizes findings against the applicable standards.
- Verifies uncertain claims against the Impact Evidence.
- Rejects candidate findings the evidence does not support.
- Reconciles severity across contributions.
- Preserves unresolved disagreement instead of forcing consensus.

The coordinator cannot waive findings and cannot make the final disposition. Its job is to hand humans one clean, verified set of findings—not to decide what happens to them.

## Findings and human disposition

Every finding cites:

- The applicable standard or rule it violates
- Repository, revision, file, and line
- Stable CKG symbol references
- The impact evidence behind the claim
- Confidence and specialist provenance

A human dispositions each finding as accepted, waived, false positive, deferred, or duplicate. For actionable findings, the human then chooses the follow-up:

- Create a TAP task
- Create a repository issue
- Create both
- Link existing work
- Record no external action

Task and repository actions use host-owned credentials and stable idempotency keys, so a retried action cannot create duplicate work. Each completed action produces a recoverable Action Receipt that is committed back to the plot, keeping the change record self-contained even if the external system is later unavailable.

## Product surfaces

### Intake context action

The miniapp contributes a context action that appears on channel messages, pull requests, tasks, and repository issues. The action receives a host-minted immutable Artifact Reference and offers three paths:

1. Open the already-linked Engineering Change.
2. Attach the artifact to a suggested existing change.
3. Create a new change.

Because the Artifact Reference is immutable and host-minted, intake never depends on copying content that could later change underneath the change record.

### Home attention

Pending approvals, Needs Assignment gaps, Needs Reassessment drift, and failed transitions publish normalized Attention Contributions to Home. The plot remains canonical; Home owns native rendering and deep-links back into the miniapp's detail views. A change that stalls waiting on a human is visible from the same place as every other obligation in the workspace.

### Miniapp UI

The miniapp provides:

- The Engineering Change ledger across the workspace
- A change lifecycle and detail workspace
- Proposal shaping with policy explanation—why this level, which policies contributed
- Impact Hypothesis and Impact Evidence views
- The coordinated review and finding disposition interface
- Scoped Assurance Policy settings for workspace, teams, and projects

The exact interaction model should be validated with a prototype before implementation.

## Authorization and auditability

- TAP checks permissions when an action occurs; the miniapp does not maintain a parallel standing-grant model.
- Actor, timestamp, and revision metadata, combined with Git history, provide the audit trail. Cryptographic attestations are out of scope for the initial slice.
- Low-confidence assurance classification escalates; it never silently selects the lowest level.
- The Effective Policy Snapshot freezes the contributing scopes and policy revisions onto the change at classification time; later policy edits do not retroactively rewrite it.
- Specialists and the coordinator propose; humans disposition. The Coordinator Skill cannot waive findings or make the final decision.
- Task and repository actions use host-owned credentials, stable idempotency keys, and recoverable Action Receipts committed back to the plot.
- Ready for Work and Started Before Ready are reported, not enforced; no transition blocks on readiness in the initial slice.
- Transition workflows commit atomically against an expected plot revision, so concurrent transitions cannot silently interleave.
- Review Contributions are immutable; synthesis, dispositions, and reassessments are new revisions rather than edits to history.

## TAP capabilities demonstrated

- App-defined plot definitions with package-owned schema and migrations
- `sdk.plots`: canonical Git-like plot state over Cloudflare artifact-backed managed storage, with explicit migration to a workspace Git backing
- Context actions with host-minted immutable artifact references
- Home attention contributions with native rendering and deep links
- Repository-scoped CKG composition into lifecycle artifacts
- Workflow-run observation as a work-start provenance signal
- Workspace scope discovery across workspace, team, and project boundaries
- Idempotent task and integration actions with recoverable receipts
- Versioned, lifecycle-specific skills with contract-checked inputs and output schemas
- Specialist resolution by abstract capability with qualified-human fallback
- Short-lived, revision-aware transition workflows over long-lived plot state
- Coordinated multi-specialist review with a separately versioned coordinator skill
- Structured findings with stable CKG symbol citations and revision-bound evidence
- Human disposition and approval decisions as first-class plot state
- Miniapp UI surfaces for ledger, change workspace, and scoped policy settings
- Public documentation and example configuration

## Implementation phases

### Phase 1: CKG-powered vertical slice

The acceptance journey, end to end, against one real `ze-agency-tauri` change:

- Engineering Change plot definition with Cloudflare artifact-backed managed storage
- Intake context action on channel messages, pull requests, tasks, and repository issues
- Change Proposal shaping with scoped Assurance Policy evaluation, hard triggers, and a frozen Effective Policy Snapshot
- CKG Impact Hypothesis with predicted blast radius, owners, standards, and similar historical changes
- Review Capability resolution and transition workflows producing specialist feedback
- Ready for Work recording and work-start observation
- Pull request linking, exact revision-bound CKG Impact Evidence, drift detection, and Needs Reassessment
- Coordinated review producing one Review Synthesis
- Finding disposition into TAP tasks and repository issues with Action Receipts
- Home attention contributions and the ledger and change-detail UI
- Closure of the change with all durable artifacts attached to the same Engineering Change

### Phase 2: policy depth and storage choice

- Explicit migration of a plot to a workspace-connected Git repository as the single authoritative backing
- Policy authoring and explanation refinements validated by the interaction prototype
- Risk-weight and threshold calibration informed by dogfooding
- Broader capability, skill, and specialist bundle with specialist-affinity tuning
- Started Before Ready trend reporting across changes

### Phase 3: learn and publish

- Learning from finding dispositions to improve classification and review routing
- Cross-platform acceptance beyond the initial desktop dogfood
- Final package naming, licensing, documentation, and release path
- Expanded example configurations for public adoption

## Non-goals for the initial vertical slice

- Merge blocking or mandatory Ready-for-Work enforcement
- A first-party TAP Engineering Change domain
- Cryptographic decision attestations
- Permanent managed-storage/Git dual writes
- Reproducing Cloudflare's internal systems exactly

## Open decisions

- Exact public plot schema and migration strategy
- Ledger granularity when teams need separate storage backings
- Initial risk weights and threshold calibration
- Initial capability, skill, and specialist bundle
- Main miniapp interaction design
- Desktop-only dogfood versus cross-platform acceptance
- The real `ze-agency-tauri` change used for acceptance
- Package naming, licensing, documentation, and release path

## Public example value

Engineering Change demonstrates that a public package can own a complete, governed engineering domain on generic TAP primitives: an app-defined plot, repository-scoped CKG evidence, policy-driven classification, coordinated specialist review, and auditable human disposition—all without TAP gaining any domain-specific machinery. It adapts published Cloudflare engineering practice into a reusable reference for building serious, standards-aware agentic workflows, and gives developers a concrete blueprint for lifecycle products that begin before code exists and end with a defensible record.
