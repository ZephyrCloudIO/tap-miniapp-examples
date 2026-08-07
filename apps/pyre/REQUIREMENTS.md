# Pyre implementation checklist

This checklist is derived from `miniapps/04-pyre.md`. Evidence is updated during verification.

- [x] Empty start and incident intake with observable statement, severity/status, times, impact, scope, systems, regions, people, and validated source links
- [x] Explicit lifecycle: intake, evidence collection, analysis, action planning, review, published, follow-up; report revisions are immutable
- [x] Evidence catalog with provenance, visibility, stable source, digest, reliability, claim/timeline links, contradiction, and packaged VFS snapshots
- [x] Governed read-only GitHub API evidence collection with an exact signed origin grant, optional opaque host credential reference, redirect/truncation safeguards, content digest, VFS snapshot, and sidecar receipt
- [x] Isolated VFS workspace and receipts when packaged VFS is available; failures remain visible and browser preview stays separate
- [x] Timestamped timeline with original/normalized time, type, confidence, evidence, confirmation/dispute/revision, conflicts, gaps, and duration cues
- [x] Branching evidence-driven Why chains with support/contradiction, assumptions, alternatives, questions, confidence, review, and continue/branch/revise/stop decisions
- [x] Quality guardrails and contributing-factor classification
- [x] Corrective actions with factor link, category, priority, owner, due date, acceptance, verification, evidence, status, and effectiveness follow-up
- [x] Roles and permission enforcement for lead, facilitator, investigator, SME, evidence owner, editor, reviewer/approver, stakeholder
- [x] Audit history for edits, corrections, decisions, approvals, and revisions
- [x] Internal report preview and Markdown/HTML rendering from reviewed structured data with unresolved questions and provenance
- [x] Approval gates, public-variant separation, visibility checks, and immutable report revision receipts
- [ ] Zephyr Cloud publication and host publication receipts (blocked: no SDK 0.5.3 publication API)
- [x] TAP specialist/channel/workflow/presence/VFS/HTTP capabilities connected only when host APIs are available
- [x] Read-only package-runtime MCP tools run in an isolated QuickJS target, accept a workspace-scoped nullable execution-context channel, and preload only the exact `pyre:investigations/v2` and migration fallback `pyre:investigations/v1` keys; unrelated rows cannot exhaust the call snapshot. The signed policy permits the host's human-reviewed `pyre-investigation-specialist` slug grant while retaining same-package contribution provenance for hosts that support it
- [x] Owner discovery never invents owners; missing ownership becomes an open question
- [x] Loading, empty, saving, success, conflict, failure, destructive confirmation, responsive/dark/reduced-motion/accessibility states
- [x] Tests: empty state, creation/validation, serialization/loading, permissions, transitions, replay protection, conflicts/failures, governed network policy, deterministic MCP v2/v1/null-channel storage reads, MCP declarations, and consequential operations
- [x] Preview build, federated package build, typecheck, tests, manifest validation, live interactions, reload, console audit, compact layout, prohibited-content scan
- [x] Reference repositories unchanged

## Capability exclusions to document if host APIs remain unavailable

- VFS has write/provision operations but no public read/list/immutable-bit API in SDK 0.5.3; Pyre can write evidence snapshots and receipts but cannot independently browse or enforce host filesystem immutability.
- The SDK can list existing HTTP credential metadata and use opaque credential references, but it does not expose credential provisioning, approval-state inspection, rotation, or revocation.
- Surface Test Lab binds a metadata-only HTTP bearer fixture to the run-selected alias. The `credentials.use` denial profile selects that visible reference, attempts the exact governed request, and verifies denial before native HTTP, VFS, or durable-state side effects.
- CKG, knowledge-plot, Zephyr Cloud publication, reminder scheduling, repository clone, and access-request APIs are not present in SDK 0.5.3. Immediate host-mediated OS notifications are available, but they do not provide Pyre's required due-date scheduling. Package workflow declarations also remain limited to one attempt without checkpointing or scheduling. Unsupported executable controls must be omitted rather than simulated.
- Remaining host and SDK gaps are tracked in [ZephyrCloudIO/ze-agency-tauri#6794](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/6794).
