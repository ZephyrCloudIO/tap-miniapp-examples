# Vanta Companion

**Status:** Approved
**Audience:** Enterprise
**Data approach:** Vanta API and MCP combined with TAP knowledge and orchestration
**Primary framework:** SOC 2

## Product idea

Vanta Companion is an agentic compliance workspace for running an organization's SOC 2 program from TAP. It brings Vanta status and evidence together with the organization's code knowledge graph, public and private knowledge plots, specialists, humans, tasks, channels, workflows, and reminders.

The companion does not replace Vanta as the compliance system of record. Vanta owns its controls, tests, evidence, policies, people, risks, vendors, and audit state. TAP adds reasoning, organizational context, coordinated execution, and durable collaboration around that state.

## Outcomes

The miniapp should help a compliance lead:

- Understand current SOC 2 readiness and the reasons behind gaps.
- Triage failing tests, issues, overdue evidence, and expiring documents.
- Connect Vanta findings to relevant systems, repositories, owners, and internal knowledge.
- Delegate remediation to humans or qualified agents.
- Create an issue-specific channel with the right people, specialist, evidence, and context attached.
- Turn recurring compliance work into reusable workflows.
- Schedule reminders and escalation paths.
- Track remediation without losing the Vanta source record or TAP audit trail.
- Prepare for an audit and answer auditor information requests with traceable evidence.

## Example interactions

- “Give me our SOC 2 readiness briefing for this week.”
- “Which failing tests are new, and which ones are getting worse?”
- “Show me every open issue related to access control.”
- “Who owns the systems affected by this test?”
- “Use the CKG to find where this authentication control is implemented.”
- “Create a remediation plan for this failed test.”
- “Delegate the code investigation to an agent and assign evidence review to Morgan.”
- “Create a channel for the encryption-at-rest issue and invite the service owners.”
- “Remind the control owner in three days and escalate to me after seven.”
- “Create a monthly user-access review workflow.”
- “What evidence do we already have for this auditor request?”
- “Draft an auditor-ready response, but do not submit anything.”

## Vanta integration

Use Vanta's supported API and official MCP capabilities rather than browser automation. The initial integration should discover the connected organization's available scopes and enable only supported operations.

Priority read capabilities include:

- Frameworks and SOC 2 controls
- Tests, tested entities, and failure details
- Issues and issue metadata
- Policies and documents
- Audit information requests, evidence, comments, and activity
- People and control owners
- Risk scenarios and mapped controls
- Vendors, findings, assessments, and security reviews
- Vulnerabilities and remediation status
- Connected integrations and monitored resources
- Security tasks
- Trust Knowledge Base and Answer Library resources
- Trust Center controls, documents, resources, and access requests

Priority write capabilities include supported Vanta operations such as assigning control owners, managing control metadata and mappings, managing documents and links, updating risk scenarios, creating comments or information requests where authorized, and verifying knowledge resources. Every write must be gated by the current Vanta scopes and TAP authorization policy.

The companion must never imply that a Vanta object was changed when the installed API or authorization scope is read-only. Unsupported actions become TAP tasks with a deep link and explicit human owner.

Webhook-driven updates should refresh affected views and trigger narrowly scoped workflows for events such as evidence status changes, information-request activity, comments, or questionnaire status changes. Polling is a fallback, not the default event model.

## Compliance workspace

The main surface should provide:

- Readiness summary by SOC 2 trust services criteria and control family
- New, failing, overdue, and regressing items
- Ownership and workload view across people and agents
- Evidence freshness and upcoming expiration view
- Audit request queue
- Risk and vendor review queue
- Active remediation channels and workflows
- Reminder and escalation calendar
- Recent agent actions and approvals

Every summary must be traceable to Vanta objects and cited organizational sources. The UI should clearly distinguish observed facts, specialist analysis, recommendations, and completed actions.

## CKG access

The SOC 2 specialist should use the Code Knowledge Graph when a compliance finding depends on implementation details. Appropriate uses include:

- Locate authentication, authorization, encryption, logging, backup, and change-management code.
- Identify owners and affected services from repository structure and history.
- Trace callers, dependencies, and blast radius before proposing remediation.
- Find tests, infrastructure definitions, and operational controls that may serve as evidence.
- Compare a control statement with its actual implementation.
- Create a code-focused remediation task with precise repository context.

CKG findings are supporting technical context, not automatic proof of control effectiveness. The specialist must identify index coverage and confirm important conclusions with source reads or tests before presenting them as evidence.

CKG access must be project-scoped. A compliance channel or task receives only the project context needed for that control; broad repository access is not granted by default.

## Knowledge plots

The companion and SOC 2 specialist need access to explicitly attached public and private knowledge plots.

Useful plots include:

- Security policies and procedures
- System descriptions and architecture diagrams
- Prior audit reports and auditor guidance
- Control narratives and evidence standards
- Incident response and business continuity material
- Vendor assessments
- Employee security and onboarding procedures
- Public trust-center content and approved customer answers

Visibility rules are mandatory:

- Public plots may support public-facing Trust Center content and approved external answers.
- Private plots may contain internal controls, audit evidence, vulnerabilities, personnel data, or confidential architecture.
- Source visibility is inherited by every synthesis, task, channel attachment, and generated artifact.
- Private content must never be copied into a public plot, public channel, Trust Center update, or external response without an explicit review and declassification action.
- Retrieval results carry plot ID, source ID, visibility, and access decision so provenance can be audited.
- Attaching a plot to a specialist does not expand who can access that plot.

## SOC 2 compliance specialist

The miniapp packages a dedicated SOC 2 specialist with a narrow tool allowlist and task-specific prompt routes. It should act like a disciplined compliance program operator: evidence-driven, control-aware, conservative about writes, and explicit about uncertainty.

The specialist must:

- Treat Vanta as the source of truth for Vanta-managed state.
- Retrieve current data before giving status answers.
- Separate facts, inferences, recommendations, and actions.
- Cite the Vanta object and knowledge or code source behind material claims.
- Map work to the relevant SOC 2 criterion and organizational control.
- Prefer existing evidence over generating duplicative artifacts.
- Identify the evidence period, owner, freshness, and collection method.
- Never claim that code alone proves a control operated throughout an audit period.
- Never mark work complete solely because an agent produced a document or code change.
- Require human approval for evidence submission, auditor communication, control changes, exceptions, risk acceptance, and external publication.
- Minimize access to confidential evidence and personally identifiable information.

### Task-specific prompt: readiness briefing

1. Retrieve current SOC 2 controls, tests, issues, owners, evidence status, and active audit requests.
2. Compare with the prior briefing period when data is available.
3. Rank gaps by audit impact, urgency, dependency, and remediation effort.
4. Separate newly failing, persistently failing, overdue, and soon-to-expire items.
5. Produce an executive summary, prioritized worklist, ownership gaps, and decisions required.
6. Link every item to its Vanta record; do not invent readiness percentages.

### Task-specific prompt: failed-test triage

1. Retrieve the test, its entities, affected integration resources, related control mappings, and issue history.
2. Determine whether the failure is a real control gap, stale data, integration problem, accepted exception, or scope question.
3. Use attached private knowledge and CKG only when relevant to the affected system.
4. State evidence for the classification and identify unknowns.
5. Recommend the smallest safe next step and the correct human or agent owner.
6. Do not deactivate a test entity, accept risk, or modify scope without explicit approval.

### Task-specific prompt: evidence preparation

1. Read the request, control intent, evidence period, and existing submissions.
2. Search attached plots and authorized systems for existing evidence.
3. Validate source, date range, completeness, and confidentiality.
4. Explain why each candidate supports the control and identify any gap.
5. Prepare an evidence packet with provenance and redaction notes.
6. Require human review before uploading, linking, accepting, or sending evidence.

### Task-specific prompt: remediation planning

1. Establish the failed requirement and affected scope from current Vanta data.
2. Use CKG and private knowledge to locate the relevant implementation, owner, and dependencies.
3. Define verifiable remediation tasks, acceptance criteria, evidence required, and rollback considerations.
4. Recommend whether each task belongs to a human or an agent.
5. Propose a channel, workflow, reminders, and escalation only when coordination warrants them.
6. Completion requires verification in the source system and refreshed Vanta state.

### Task-specific prompt: auditor response

1. Use only authorized Vanta records and approved knowledge sources.
2. Answer the exact request without expanding scope.
3. Distinguish the control design from evidence of operating effectiveness.
4. Include dates, systems, owners, and evidence references when available.
5. Flag ambiguity or missing evidence instead of guessing.
6. Produce a draft only; a human must approve external communication or evidence submission.

### Task-specific prompt: recurring compliance workflow

1. Identify the control objective, cadence, trigger, owner, approver, evidence source, and completion condition.
2. Reuse existing TAP or Vanta work before creating duplication.
3. Define idempotent workflow steps and safe retry behavior.
4. Add reminders before due dates and escalation after missed deadlines.
5. Include a human decision gate for exceptions and consequential Vanta writes.
6. Record the Vanta IDs and evidence provenance on every run.

## Delegation

The specialist can create and assign TAP tasks to humans or agents.

Each delegated task should include:

- Vanta object IDs and deep links
- SOC 2 criterion and control context
- Problem statement and current observed state
- Required source access
- Clear acceptance criteria
- Expected evidence and audit period
- Due date, reminder policy, and escalation owner
- Actions the assignee may take autonomously
- Actions requiring approval

Agent tasks should be used for bounded research, code investigation, evidence collection, drafting, and verification. Humans retain decisions involving control ownership, risk acceptance, exceptions, employee actions, auditor communication, and external publication.

## Issue channels

The companion can create a dedicated channel for a compliance issue when discussion or cross-functional coordination is needed.

The channel should be seeded with:

- A concise issue summary and Vanta link
- Relevant control and test state
- Assigned humans and agents
- Attached private knowledge plots and project-scoped CKG context
- Remediation tasks and due dates
- A proposed workflow and approval gates
- Reminder and escalation schedule
- A live status card that refreshes from Vanta

Closing a channel does not close a Vanta issue. The specialist verifies the source state and records the final evidence before recommending archival.

## Compliance workflows

Initial reusable workflows should include:

- Weekly SOC 2 readiness review
- Failed-test intake and triage
- Evidence collection and human approval
- Monthly or quarterly user-access review
- Policy review and renewal
- New vendor security review
- Vulnerability remediation and SLA escalation
- Employee onboarding and offboarding evidence check
- Audit information-request response
- Control-owner reminder and escalation

Workflow steps must be idempotent, checkpointable, traceable, and safe to resume. A workflow should not repeat an external write merely because a run was retried.

## Reminders and escalation

Reminders are tied to a concrete task, Vanta object, owner, and due date. They should support:

- One-time and recurring schedules
- Relative reminders before or after a deadline
- Channel notifications and direct owner reminders
- Escalation after configurable grace periods
- Suppression after the source item is resolved
- Time-zone-aware delivery
- A full reminder and acknowledgement history

The specialist should avoid notification spam by grouping related items and respecting workspace policies.

## Authorization and auditability

- Use least-privilege Vanta OAuth scopes and TAP permissions.
- Read-only analysis is the default.
- Vanta writes, external messages, evidence submissions, risk decisions, and public publication require fresh human approval.
- Secrets remain in the host credential system and are never exposed to prompts or knowledge plots.
- Every agent retrieval, recommendation, delegation, workflow run, approval, and external mutation records actor, timestamp, source, target, and outcome.
- Private knowledge and sensitive Vanta data are redacted from channel summaries when participants lack access.

## TAP capabilities demonstrated

- Authenticated third-party API and MCP integration
- Dedicated specialist with task-specific prompt routing
- CKG-assisted technical compliance analysis
- Public and private knowledge plots with provenance
- Human and agent task delegation
- Channel creation and contextual collaboration
- Workflow authoring and execution
- Automations, reminders, and escalations
- Permissioned consequential actions
- Webhook-driven updates
- Durable audit trails and lifecycle checkpoints

## Implementation phases

### Phase 1: read and explain

- Connect Vanta with read-only scopes.
- Build readiness, failing-test, issue, evidence, and owner views.
- Package the SOC 2 specialist and task-specific prompts.
- Add CKG and explicitly attached knowledge-plot retrieval.

### Phase 2: coordinate

- Create human and agent tasks.
- Create issue channels with scoped context.
- Add reminders, escalations, and reusable compliance workflows.
- Ingest relevant Vanta webhooks.

### Phase 3: act with approval

- Enable supported Vanta writes one capability at a time.
- Add fresh approval gates, idempotency keys, receipts, and reconciliation.
- Support evidence preparation and submission workflows with mandatory human review.

## Public example value

Vanta Companion demonstrates how TAP can turn a third-party system of record into an agentic operating environment without weakening governance. It combines live SaaS data, internal knowledge, code intelligence, specialists, people, workflows, and approvals in a use case where provenance and permission boundaries genuinely matter.

## References

- [Vanta Developer Hub](https://developer.vanta.com/)
- [Vanta API reference](https://developer.vanta.com/api-reference)
- [Vanta MCP remediation quickstart](https://developer.vanta.com/docs/quickstart/remediate-with-mcp)
- [Manage Vanta API quickstart](https://developer.vanta.com/docs/quickstart/manage-vanta)
