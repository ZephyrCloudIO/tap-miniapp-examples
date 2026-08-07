# Engineering Change implementation checklist

This checklist is derived from `miniapps/07-engineering-change.md`. Evidence is updated during verification.

- [x] Engineering Change intake with title and summary; sequential `EC-YYYY-NNNN` identity allocation per year
- [x] Explicit lifecycle: draft, shaping, review, ready-for-work, implementing, implemented, closed; illegal transitions rejected; entry at implementing permitted when implementation already exists
- [x] Single Change Proposal per change; authors never choose "brief" or "RFC" — Assurance Policies assign the level
- [x] Assurance classification over objective dimensions (reach, reversibility, novelty, user impact, operational impact, coordination) with the default hard RFC triggers (security, privacy, authn/authz, persistent-data migration, public contracts, cross-boundary architecture, destructive behavior, standards exceptions)
- [x] Scoped policy evaluation: every applicable policy evaluates independently; locked workspace requirements cannot be weakened; adjustable values bounded; highest produced level wins; Effective Policy Snapshot frozen with contributing scopes and revisions
- [x] Low-confidence classification escalates one step instead of silently choosing the lowest level
- [x] Work readiness is observable, not enforced: `readyForWorkAt`, `workStartedAt`, and work-start source recorded; earliest observable start wins; Started Before Ready reported without blocking
- [x] Ready for Work requires every policy-required review capability; missing coverage is reported as Needs Assignment, never silently skipped
- [x] Impact Hypothesis (pre-implementation) with related symbols, predicted blast radius, confidence, and unresolved questions
- [x] Impact Evidence (post-implementation) captured through governed, host-mediated reads against the declared `https://api.github.com` origin only, with HTTP status, digest, and captured-at receipt; source commit recorded when supplied
- [x] Review contributions per abstract capability (security, architecture, test-sufficiency, operability, domain ownership) with skill and version recorded
- [x] Versioned, lifecycle-specific code review skills shipped as signed `agent.skill` contributions: `security-impact-hypothesis` (shaping phase, gated on `changes.propose`), `security-implementation-review` (post-implementation, gated on `changes.review`), `architecture-review` (both phases, gated on `changes.review`), and `review-coordinator` (synthesis, gated on `changes.review`) — each with contract inputs, evidence requirements, and output expectations in SKILL.md
- [x] Coordinator behavior: candidate findings can be verified or rejected; the coordinator never waives a finding and never makes the final human disposition
- [x] Findings cite standard/rule, severity, confidence, and provenance; human dispositions: accepted, waived, false-positive, deferred, duplicate, each with rationale and action (create TAP task / repository issue / both / link existing / none). TAP-task actions use SDK 0.5.3's host-backed `sdk.tasks.create` and persist the returned task identity.
- [x] Append-only actor/timestamp audit trail on every mutation
- [x] Roles and permission enforcement through the permission catalog (change-author, change-reviewer, change-admin) with positive and denial e2e coverage for every action
- [x] Read-only package-runtime MCP tools (`get_change`, `list_changes`, `get_impact_hypothesis`, `get_review_synthesis`) in an isolated QuickJS target, preloading only the exact `engineering-change:changes/v1` key
- [x] Loading, empty, saving, success, conflict, failure, and authority-denied states with stable `data-testid` anchors
- [x] Tests: domain invariants, assurance evaluation, readiness, dispositions, storage conflicts/malformed data, authority denials, governed origin boundary, deterministic MCP storage reads, MCP declarations
- [x] Preview build, federated package build, typecheck, tests, manifest validation
- [x] Reference repositories unchanged

## Capability exclusions to document if host APIs remain unavailable

- The app-defined plot ledger (`plot.definition` + `sdk.plots`), repository-scoped CKG capability, Home attention projections, context actions with immutable artifact references, and idempotent task/integration actions with durable receipts are specified in the brief and tracked by [ZephyrCloudIO/ze-agency-tauri#7989](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/7989). SDK 0.5.3 exposes ordinary workspace task CRUD but not those remaining stable capabilities, so this package persists its ledger through `sdk.storage` with optimistic-concurrency revisions and omits the unavailable executable controls rather than simulating them.
- Drift detection currently compares recorded hypothesis and evidence fields in package code; CKG-composed blast radius and specialist affinity arrive with the repository-scoped Code Knowledge capability in #7989.
- Repository issue creation and receipt-backed replay from finding dispositions await stable connected-integration and action-receipt APIs from #7989; SDK 0.5.3 creates canonical TAP tasks and the disposition records the returned task identity durably in the interim.
