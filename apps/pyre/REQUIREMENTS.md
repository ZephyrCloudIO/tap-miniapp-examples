# Pyre implementation checklist

This checklist is derived from `miniapps/04-pyre.md`. Evidence is updated during verification.

- [x] Empty start and incident intake with observable statement, severity/status, times, impact, scope, systems, regions, people, and validated source links
- [x] Explicit lifecycle: intake, evidence collection, analysis, action planning, review, published, follow-up; report revisions are immutable
- [x] Evidence catalog with provenance, visibility, stable source, digest, reliability, claim/timeline links, contradiction, and packaged VFS snapshots
- [x] Isolated VFS workspace and receipts when packaged VFS is available; failures remain visible and browser preview stays separate
- [x] Timestamped timeline with original/normalized time, type, confidence, evidence, confirmation/dispute/revision, conflicts, gaps, and duration cues
- [x] Branching evidence-driven Why chains with support/contradiction, assumptions, alternatives, questions, confidence, review, and continue/branch/revise/stop decisions
- [x] Quality guardrails and contributing-factor classification
- [x] Corrective actions with factor link, category, priority, owner, due date, acceptance, verification, evidence, status, and effectiveness follow-up
- [x] Roles and permission enforcement for lead, facilitator, investigator, SME, evidence owner, editor, reviewer/approver, stakeholder
- [x] Audit history for edits, corrections, decisions, approvals, and revisions
- [x] Internal report preview and Markdown/HTML rendering from reviewed structured data with unresolved questions and provenance
- [x] Approval gates, public-variant separation, visibility checks, and immutable report revision receipts
- [ ] Zephyr Cloud publication and host publication receipts (blocked: no SDK 0.2.0-pr.6821.02b36a6 publication API)
- [x] TAP specialist/channel/workflow/presence/VFS capabilities connected only when host APIs are available
- [x] Owner discovery never invents owners; missing ownership becomes an open question
- [x] Loading, empty, saving, success, conflict, failure, destructive confirmation, responsive/dark/reduced-motion/accessibility states
- [x] Tests: empty state, creation/validation, serialization/loading, permissions, transitions, replay protection, conflicts/failures, consequential operations (20 passing)
- [x] Preview build, federated package build, typecheck, tests, manifest validation, live interactions, reload, console audit, compact layout, prohibited-content scan
- [x] Reference repositories unchanged

## Capability exclusions to document if host APIs remain unavailable

- VFS has write/provision operations but no public read/list/immutable-bit API in SDK 0.2.0-pr.6821.02b36a6; Pyre can write evidence snapshots and receipts but cannot independently browse or enforce host filesystem immutability.
- CKG, knowledge-plot, Zephyr Cloud publication, reminder scheduling, credential provisioning/approval, repository clone, notification, and access-request APIs are not present in SDK 0.2.0-pr.6821.02b36a6. Their executable controls must be omitted rather than simulated.
