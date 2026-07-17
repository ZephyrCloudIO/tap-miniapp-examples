# Pyre

**Status:** Approved
**Audience:** Enterprise
**Data approach:** TAP knowledge, evidence, specialists, channels, and workflows
**Primary method:** Evidence-driven 5 Whys root cause analysis

## Product idea

Pyre helps teams investigate an incident, perform a rigorous 5 Whys analysis, assemble supporting evidence, identify contributing factors, and prepare a reviewable incident report.

It turns a loosely structured incident conversation into a durable investigation. Pyre should challenge unsupported conclusions, preserve competing explanations, and keep every important claim connected to evidence.

The goal is learning and prevention, not blame. The method should never assume that the fifth answer is automatically the root cause or that every incident has one linear cause.

## Outcomes

Pyre should help a team:

- Establish a shared, factual incident statement.
- Build a timestamped incident timeline.
- Collect logs, alerts, screenshots, metrics, tickets, code changes, chat excerpts, and human observations.
- Conduct one or more 5 Whys chains.
- Separate facts, hypotheses, assumptions, and unresolved questions.
- Identify technical, process, organizational, and detection-related contributing factors.
- Define corrective and preventive actions with owners and verification criteria.
- Produce an incident report for review and publication.
- Retain the investigation as organizational knowledge.
- Let participants build the investigation naturally by talking in its channel.
- Publish approved HTML and Markdown incident reports through Zephyr Cloud.

## Example interactions

- “Start a Pyre analysis for yesterday's production outage.”
- “Build a timeline from this channel and the attached logs.”
- “What do we know versus what are we assuming?”
- “Start the first Why from the customer impact.”
- “This answer has no evidence—what would verify it?”
- “Branch the analysis because there may be separate deployment and monitoring causes.”
- “Use the CKG to trace the configuration path involved in the failure.”
- “Which code changes occurred during the incident window?”
- “Draft corrective actions for the contributing factors we confirmed.”
- “Prepare the incident report, but leave unresolved questions visible.”
- “Tag Pyre to take notes while we talk this through.”
- “Pull the production logs for the incident window into the investigation.”
- “Clone the service repository so we can inspect the deployment change.”
- “Who owns the affected service?”
- “Give Priya a summary when she joins the channel.”

## Conversation-native investigation

The investigation channel is the primary working interface. Participants should be able to discuss the incident naturally while Pyre incrementally builds the structured investigation alongside the conversation.

When the Pyre specialist is tagged as the note taker, it should listen for and propose:

- Facts and observations
- Timeline events
- Impact and scope changes
- Evidence references
- Hypotheses and alternative explanations
- Why questions and proposed causal answers
- Contradictions and unresolved questions
- Decisions and their rationale
- Corrective actions, owners, and due dates
- Systems, repositories, teams, and people mentioned

Pyre should post compact checkpoint summaries at useful boundaries rather than interrupting every message. Material interpretations are proposed for confirmation; the specialist does not silently convert speculation into fact.

The structured investigation and channel remain linked in both directions. Every extracted item records the source message or message range, and the channel can render live cards for the timeline, Why chains, evidence queue, open questions, and action items.

Participants can correct the notes conversationally:

- “That was a hypothesis, not a confirmed cause.”
- “The alert fired at 14:07 UTC, not 14:17.”
- “Split that into two separate contributing factors.”
- “Attach the dashboard snapshot as evidence for this timeline event.”

Corrections create an audit entry and preserve the prior value rather than rewriting history invisibly.

## Joining and handoff summaries

When someone is tagged into or joins the investigation channel, they can ask Pyre for a current briefing. The response should be tailored to the participant's role and access, and include:

- What happened and current incident status
- Customer and business impact
- Confirmed timeline highlights
- Current hypotheses and confidence
- Evidence collected and important gaps
- Decisions already made
- Open questions relevant to the participant
- Assigned and unassigned actions
- Links to the relevant investigation views and source evidence

The summary must respect source permissions. A participant without access to private evidence receives an appropriately redacted explanation and may request access through the normal approval path.

After reading the summary, the new participant can add their context in the channel. Pyre should connect it to existing claims, ask for evidence when appropriate, and flag contradictions for review instead of overwriting earlier accounts.

## Investigation lifecycle

An investigation moves through explicit states:

`intake → evidence collection → analysis → action planning → review → published → follow-up`

Reopening a published report creates a revision rather than silently rewriting the historical record.

### Intake

Capture:

- Incident title and concise problem statement
- Start, detection, mitigation, recovery, and end times
- Customer and business impact
- Affected services, systems, and regions
- Incident severity and status
- Incident lead, investigators, reviewers, and stakeholders
- Links to the source channel, incident system, and related work

The initial statement is provisional. Pyre should help the team rewrite vague or solution-biased statements into observable outcomes.

### Evidence collection

Evidence items should support files, URLs, structured API results, channel messages, code references, knowledge sources, and human testimony.

Each item records:

- Source and stable reference
- Collector and collection time
- Relevant incident time range
- Visibility and access policy
- Content digest or immutable snapshot when possible
- Short description and affected systems
- Reliability or confidence notes
- Claims and timeline events it supports or contradicts

Pyre must preserve source material separately from specialist summaries. A generated summary is an interpretation, not primary evidence.

## VFS evidence workspace

Each investigation receives an isolated VFS workspace containing immutable or versioned copies of collected technical evidence. This lets investigators and agents work from stable source material even when external logs, dashboards, branches, or tickets later change.

A suggested layout is:

```text
/pyre/<incident-id>/
  incident.json
  evidence/
    logs/
    metrics/
    traces/
    screenshots/
    tickets/
    messages/
    deployments/
  repositories/
  analysis/
  knowledge/
  reports/
  receipts/
```

Every imported item should have a sidecar receipt with its source system, query or locator, collection time, incident time range, collector, content digest, MIME type, visibility, and access decision. Raw evidence is read-only after capture; transformations and redactions create derived artifacts.

Secrets, access tokens, and unrestricted environment dumps must never be stored in the evidence workspace. Collection tools should redact configured secret patterns and quarantine suspected sensitive material for human review.

## Evidence collection workflows

Pyre can create or invoke workflows to pull data from authorized systems when the necessary evidence is not already available. Examples include:

- Export logs for a service and bounded time window.
- Capture relevant metrics and dashboard data.
- Retrieve traces associated with affected requests.
- Fetch deployment events and configuration changes.
- Snapshot incident-management and ticket state.
- Export selected channel messages.
- Collect source-control commits, diffs, reviews, and CI results.
- Re-run an approved diagnostic query and retain its output.

Collection workflows must declare the source, exact scope, time window, expected output, credentials required, redaction policy, destination path, timeout, and retry behavior. The workflow should preview broad or expensive queries before execution and require approval for sensitive systems.

Runs are checkpointable and idempotent. Re-running the same collection either returns the existing receipt or creates a clearly identified new snapshot; it must not silently replace prior evidence.

If a required connector does not exist, Pyre creates a bounded evidence-request task for a human rather than claiming the data was collected.

## Evidence-driven 5 Whys

The analysis begins with a clearly observed problem. Each answer becomes a causal claim that must be supported, contradicted, or marked unverified before the next Why is treated as established.

For each step, capture:

- The Why question
- Proposed answer
- Supporting and contradicting evidence
- Confidence level
- Assumptions
- Open questions
- Author and reviewers
- Alternative explanations
- Decision to continue, branch, revise, or stop

Five is a prompt for depth, not a mandatory stopping point. The team may stop earlier when it reaches an actionable, well-supported factor or continue beyond five when the explanation remains superficial.

The analysis may branch when multiple conditions were independently necessary. Pyre should visualize these related chains without flattening them into one convenient narrative.

## Analysis quality guardrails

Pyre should challenge common failure modes:

- **Blame:** Reframe “an engineer made a mistake” toward the conditions that allowed one action to cause harm.
- **Single-cause bias:** Ask whether multiple technical or organizational conditions were required.
- **Hindsight bias:** Preserve what responders reasonably knew at each point in the timeline.
- **Evidence gaps:** Mark unsupported causal claims as hypotheses.
- **Stopping too early:** Challenge labels such as “human error,” “bad deploy,” or “process failure.”
- **Stopping too late:** Avoid abstract conclusions such as “the company did not care enough.”
- **Solution-shaped causes:** Do not infer a cause merely because a preferred fix exists.
- **Counterfactual weakness:** Ask whether removing the proposed factor would likely have prevented or reduced the incident.

The app should distinguish:

- Trigger
- Proximate cause
- Contributing factors
- Latent conditions
- Detection and response gaps
- Impact amplifiers
- Confirmed non-causes

## Timeline

The investigation timeline combines automatically collected and manually entered events. Each event includes timestamp, source, actor or system, description, evidence links, and confidence.

Pyre should:

- Normalize time zones while preserving original timestamps.
- Identify gaps and conflicting timestamps.
- Separate incident events from later investigative actions.
- Allow reviewers to confirm, revise, or dispute an event.
- Highlight detection, escalation, mitigation, and recovery intervals.
- Generate useful duration metrics without presenting uncertain timestamps as exact.

## Collaboration and channels

Pyre can begin inside an existing incident channel or create a dedicated investigation channel. The channel should attach the investigation, relevant private knowledge plots, project-scoped CKG access, evidence queue, open questions, and action items.

Suggested roles include:

- Incident lead
- Facilitator
- Investigator
- Subject-matter expert
- Evidence owner
- Report editor
- Reviewer or approver

Specialists may collect, organize, summarize, and challenge evidence. Humans approve causal conclusions, corrective actions, and the final report.

### Owner discovery and routing

Pyre should resolve code and system owners from explicitly configured sources such as project metadata, repository ownership files, service catalogs, CKG ownership signals, and workspace team mappings.

When a credible owner is found, Pyre may propose tagging that person or team into the channel and explain why their context is needed. Tagging or inviting a person is a visible communication action and should follow workspace notification policy.

When ownership is missing or ambiguous, Pyre should ask participants rather than invent an owner:

> The affected checkout worker has no confirmed system owner. Who should own technical context for this investigation?

Confirmed ownership can be recorded on the incident and, with approval, written back to the relevant project or service metadata so future investigations benefit.

### Repository investigation

Pyre can clone an authorized source repository into the incident's VFS workspace to investigate a deployment or code change.

- Clone only the repository and revision relevant to the incident.
- Prefer a shallow or partial clone unless history is required.
- Record remote identity, resolved commit, collection time, and credential scope.
- Keep credentials in the host credential system rather than embedding them in Git configuration or evidence.
- Treat the cloned repository as read-only evidence by default.
- Use a separate worktree or branch for any proposed remediation.
- Preserve the original incident revision even if investigators later fetch newer history.
- Run untrusted repository code only in an approved sandbox with network and secret access disabled by default.

The Pyre specialist can use CKG, Git history, diffs, ownership files, tests, and targeted source reads to investigate the change. It must distinguish what the repository proves from what requires runtime logs or deployment evidence.

## Pyre investigation specialist

The packaged specialist acts as a neutral facilitator and evidence analyst. It must:

- Use blameless, precise language.
- Ask one focused causal question at a time during facilitated analysis.
- Retrieve current investigation state before answering status questions.
- Label facts, hypotheses, inferences, and recommendations.
- Cite evidence for material claims.
- Surface contradictions rather than resolving them silently.
- Preserve alternative hypotheses until evidence rules them out.
- Avoid inventing timestamps, impact, causes, or owners.
- Avoid declaring “root cause” without reviewer approval.
- Never publish a report or notify external audiences without approval.
- Link extracted notes to their channel messages and request confirmation for material interpretations.
- Keep raw VFS evidence distinct from derived summaries and report prose.

### Task-specific prompt: incident intake

1. Extract only facts supplied by the user or connected sources.
2. Draft an observable problem statement without assigning cause or blame.
3. Identify missing time, impact, scope, ownership, and source information.
4. Propose severity only when a supplied rubric supports it.
5. Create the investigation in draft state and request confirmation before notifying others.

### Task-specific prompt: timeline construction

1. Gather authorized source events for the incident window.
2. Normalize timestamps and retain original values.
3. Deduplicate events without losing source references.
4. Mark conflicts, inferred ordering, and gaps.
5. Separate observed incident events from retrospective commentary.
6. Ask humans to confirm events that materially affect causal analysis.

### Task-specific prompt: facilitate a Why

1. Restate the current supported claim and its evidence.
2. Ask why that condition occurred, avoiding a solution-biased question.
3. Record the proposed answer as a hypothesis until supported.
4. Search attached evidence and authorized knowledge for support or contradiction.
5. Ask what evidence would falsify the answer.
6. Recommend continue, branch, revise, or stop; leave the decision to the investigators.

### Task-specific prompt: evidence assessment

1. Identify the exact claim being evaluated.
2. Describe the source, time range, completeness, and access restrictions.
3. Explain whether the evidence supports, contradicts, or is merely consistent with the claim.
4. Identify alternate interpretations and missing evidence.
5. Assign a transparent confidence label rather than a false numeric precision.
6. Never transform an agent summary into primary evidence.

### Task-specific prompt: corrective actions

1. Link each action to a confirmed contributing factor or learning objective.
2. Prefer systemic risk reduction over reminders to “be more careful.”
3. Define owner, due date, acceptance criteria, verification method, and expected evidence.
4. Distinguish containment, correction, prevention, detection, and resilience work.
5. Identify possible side effects and rollback needs.
6. Do not mark an action complete until its acceptance criteria are verified.

### Task-specific prompt: incident report

1. Use only reviewed investigation state and cited evidence.
2. Preserve uncertainty, dissent, and unresolved questions.
3. Distinguish timeline facts from causal analysis.
4. Use blameless language and avoid overstating conclusions.
5. Include every corrective action with owner and verification criteria.
6. Produce a draft and require designated reviewer approval before publication.

### Task-specific prompt: channel note taking

1. Observe the conversation without interrupting normal collaboration.
2. Extract candidate facts, events, evidence, hypotheses, decisions, questions, and actions.
3. Preserve message provenance and participant attribution.
4. Label uncertain material correctly; never promote repetition into confirmation.
5. Merge duplicates while retaining every supporting source.
6. Post a compact checkpoint when the topic changes, a decision is made, or participants request one.
7. Ask for confirmation only when an interpretation materially changes the investigation.

### Task-specific prompt: new-participant briefing

1. Resolve the requesting participant and their source permissions.
2. Read the latest reviewed investigation state and changes since the requested point.
3. Summarize status, impact, timeline, hypotheses, evidence, decisions, open questions, and actions.
4. Prioritize information relevant to the participant's role or reason for joining.
5. Redact inaccessible evidence without revealing sensitive filenames or conclusions.
6. Invite the participant to add or correct context and connect their response to the investigation.

### Task-specific prompt: data collection

1. Define the claim or timeline gap the data should address.
2. Identify the authorized source, bounded time range, systems, and query.
3. Estimate breadth, sensitivity, cost, and expected artifact size.
4. Reuse an existing evidence snapshot when it answers the same question.
5. Invoke an approved collection workflow and store results plus a receipt in the VFS.
6. Verify completeness and report collection failures or redactions explicitly.

### Task-specific prompt: code-change investigation

1. Identify the repository, deployed revision, preceding known-good revision, and incident window.
2. Confirm repository authorization before cloning into the incident VFS.
3. Preserve the relevant revisions and collection receipt.
4. Use diffs, CKG, ownership data, CI results, and source reads to identify plausible effects.
5. Correlate code findings with runtime and deployment evidence.
6. State what is proven, inferred, contradicted, or still unknown; do not equate temporal proximity with causation.

## CKG and knowledge plots

Project-scoped Code Knowledge Graph access can help locate affected components, dependencies, owners, callers, configuration, infrastructure, tests, and relevant changes. CKG analysis supports investigation but does not independently prove runtime behavior during the incident.

Private knowledge plots may contain runbooks, architecture, prior incidents, internal policies, operational procedures, or sensitive evidence. Public plots may contain externally approved service documentation or published reports. Source visibility must propagate to summaries and reports; private material cannot enter a public report without explicit review and redaction.

### Incident Knowledge Garden plot

Pyre creates or attaches a private Knowledge Garden plot for each investigation. As participants talk, the note-taking specialist incrementally cultivates it with reviewed knowledge:

- Incident brief and current status
- Confirmed timeline
- System and service context
- Reviewed 5 Whys chains and contributing factors
- Evidence catalog entries that link back to VFS artifacts
- Decisions and rationale
- Open questions
- Corrective actions and effectiveness results
- Final reports and lessons learned

Raw logs, repository working trees, traces, and large data exports stay in the VFS. The plot stores curated explanations, metadata, and stable evidence references so specialists can retrieve useful context without ingesting an unrestricted evidence dump.

Candidate knowledge extracted from channel conversation remains marked as proposed until reviewed. Confirmed items retain their source-message and evidence provenance. Sensitive source visibility propagates to plot entries.

After the incident, reviewers can promote selected lessons, runbook improvements, and approved report content into longer-lived team or public plots. Promotion is a copy-with-provenance action requiring an explicit visibility review; it never changes the private incident plot in place.

## Corrective actions and workflows

Actions can be delegated to humans or agents and converted into reusable workflows. Each action includes:

- Linked contributing factor
- Category and priority
- Human or agent owner
- Due date and escalation policy
- Acceptance criteria
- Verification method
- Required evidence
- Status and completion receipt

Recurring patterns may produce workflows for evidence collection, review meetings, rollout verification, or follow-up effectiveness checks. Workflows must be checkpointable and idempotent.

## Incident report

The report should be generated from structured investigation data and support both internal and approved external variants.

Recommended sections:

1. Executive summary
2. Incident overview
3. Customer and business impact
4. Detection and response
5. Timeline
6. Evidence considered
7. 5 Whys chains and contributing factors
8. Root-cause conclusion, if approved
9. What went well
10. What made response harder
11. Corrective and preventive actions
12. Unresolved questions and dissenting views
13. Reviewers, approvals, and revision history

The public variant must be separately reviewed for confidentiality, security exposure, customer commitments, and legal concerns. It is never created by simply removing a “private” label.

### Report templates and formats

Pyre should ship with versioned report templates for internal review, executive summary, engineering post-incident review, and approved public postmortem. Organizations can add branded templates without changing investigation data.

The structured investigation is rendered into:

- Semantic HTML for hosted reading
- Markdown for portability, review, and repository storage
- A machine-readable report manifest containing incident ID, template version, evidence references, visibility, approvals, and content digest

Templates control presentation, not truth. They cannot suppress required unresolved questions, approval state, or provenance fields without an explicit policy decision.

Before publication, Pyre generates a preview and runs checks for missing approvals, unresolved sensitive-data findings, private-source leakage, broken evidence links, absent action owners, and stale investigation state.

### Zephyr Cloud publication

Approved reports are packaged and published with Zephyr Cloud. A publication records:

- Incident and report revision
- Template and renderer versions
- Visibility and target environment
- Content and asset digests
- Reviewer approvals
- Build and publication receipt
- Resulting URL and publication time

Internal and public reports use separate publication targets and access policies. Publishing a new revision does not erase prior receipts. Public publication requires a fresh approval even when an internal version was already approved.

The source Markdown, rendered HTML, assets, manifest, and publication receipts are retained under the incident's VFS `reports/` and `receipts/` paths.

## Reminders and follow-up

Pyre should remind owners about evidence requests, review deadlines, overdue corrective actions, and scheduled effectiveness checks. Reminders stop when the source item is resolved and retain an acknowledgement history.

A follow-up review should ask whether completed actions actually reduced risk. Pyre retains this result with the incident rather than treating task completion as proof of effectiveness.

## Integrations

The first version can rely primarily on TAP capabilities and user-provided evidence. Later connectors may collect read-only data from incident management, observability, source control, deployment, issue tracking, and communication systems.

Connector data must be snapshotted or stably referenced so the report remains reproducible after external systems change.

## Authorization and auditability

- Investigation membership does not automatically grant access to every evidence source.
- Evidence retrieval follows source permissions and least privilege.
- Repository clone and data-pull credentials remain host-managed and scoped to the requested source.
- Sensitive evidence is redacted from participants who lack access.
- Agent-generated causal claims require human review.
- Final conclusions, corrective-action acceptance, report approval, and publication are human decisions.
- Every edit, evidence attachment, causal decision, approval, and publication records actor and timestamp.
- Published reports are versioned and immutable; amendments create new revisions.
- Tagging people, starting broad data collection, cloning private repositories, and publishing reports are auditable actions with explicit policy gates.

## TAP capabilities demonstrated

- Structured collaborative investigation
- Conversation-to-structured-state extraction with message provenance
- Dedicated specialist with task-specific prompts
- Channels and participant roles
- Evidence artifacts with provenance
- VFS evidence workspace and repository snapshots
- CKG-assisted technical analysis
- Public and private knowledge plots
- Per-incident Knowledge Garden cultivation and reviewed knowledge promotion
- Human and agent delegation
- Owner discovery and participant routing
- Branching analysis visualization
- Data-collection workflows, reminders, and follow-up automation
- Approval gates and revision history
- Template-based HTML and Markdown reports
- Zephyr Cloud publication and receipts
- Lifecycle checkpoints and resumable investigations

## Implementation phases

### Phase 1: investigate

- Incident intake and structured problem statement
- Conversation-native note taking
- Evidence collection and provenance
- Isolated VFS evidence workspace
- Timeline editor
- Branching 5 Whys analysis
- Pyre investigation specialist

### Phase 2: coordinate

- Investigation channels and roles
- New-participant summaries and contextual handoff
- Human and agent delegation
- Owner discovery, repository cloning, CKG, and knowledge-plot access
- Data-pull workflows for logs, metrics, traces, and deployment history
- Corrective actions, reminders, and escalations

### Phase 3: report and learn

- Template-rendered HTML and Markdown incident reports
- Separately approved public report variant
- Zephyr Cloud publication with immutable receipts
- Report revision history
- Follow-up effectiveness reviews
- Search and comparison across prior incidents

## Public example value

Pyre demonstrates how TAP can turn conversation, evidence, code context, specialists, and human judgment into a governed enterprise investigation. It showcases agentic assistance in a domain where epistemic discipline, provenance, collaboration, and approval are more important than generating a quick answer.
