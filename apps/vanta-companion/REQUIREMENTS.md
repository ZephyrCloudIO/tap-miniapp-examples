# Vanta Companion requirements checklist

This checklist distinguishes executable implementation from documented platform boundaries. A checked item has code and test or live-browser evidence. An unchecked item is not simulated.

## Application foundation

- [x] Empty initial state with real onboarding and no seeded domain records
- [x] Runtime UUIDs, storage-boundary validation, schema versioning, and optimistic revision conflicts
- [x] Separate preview `localStorage` and packaged `sdk.storage` implementations
- [x] Visible loading, saving, success, conflict, empty, permission, and failure states
- [x] Responsive SDK-component UI with keyboard focus, dark tokens, compact layout, and reduced motion
- [x] Desktop federated surface, lifecycle, exact `@theaiplatform/miniapp-sdk@0.2.0-pr.6821.02b36a6` pin, and matching `compatibility.tapSdk`

## Vanta SDK, API, and MCP

- [x] Official US, EU, and AUS remote MCP endpoints with TAP-hosted OAuth
- [x] Managed SOC 2 specialist installed with `sdk.specialist.upsertManaged` and executed with `runTurnWithTools`
- [x] Exact 45-tool MCP allowlist from `@vantasdk/vanta-mcp-server@1.2.0`; no wildcard tool exposure
- [x] Task-specific prompts for readiness, failing tests, evidence, remediation, recurring workflows, controls, people/devices, vendors/risk, vulnerabilities, Trust Center, integrations/resources, and custom analysis
- [x] All 43 current top-level Vanta API reference families mapped exactly once in the coverage workspace
- [x] All 52 public methods from `vanta-auditor-api-sdk@0.9.10` inventoried, including reads and consequential writes
- [x] Auditor SDK surfaced as API-only with no executable action because no Vanta bearer credential or per-method execution adapter is configured
- [x] Vanta webhook Worker verifies raw-body Svix signatures, acknowledges within the request, and durably rejects replays by `svix-id`
- [x] Access-protected workspace event feed, schema-validated client sync, durable cursor, conflict handling, and visible failure states
- [x] MCP/API capability boundaries visible per domain; unavailable data is labeled instead of inferred
- [ ] Direct Auditor API execution — TAP SDK `0.2.0-pr.6821.02b36a6` exposes host-mediated HTTP and credential metadata, but the companion does not yet configure a Vanta bearer credential or execution adapter
- [ ] Direct Manage Vanta API execution and Vanta writes — blocked by the same missing credential and execution adapter; Vanta does not publish an official Manage API SDK
- [ ] Direct Build Integrations API execution — blocked by the same missing credential and execution adapter; Vanta does not publish an official Build Integrations SDK
- [x] Webhook ingestion through the companion Cloudflare Worker and D1; the miniapp consumes only verified metadata

## Real TAP coordination

- [x] Private issue-channel creation, source message, and specialist join with host-confirmed receipts
- [x] Saved workflow discovery/invocation with provenance payload, failure handling, and replay protection
- [x] User-created remediation cases linked to real Vanta IDs/deep links
- [x] Validated case state transitions and lead-only source verification confirmation
- [x] Durable analysis output and audit receipts retained across reload
- [ ] TAP task delegation — blocked because TAP miniapp SDK `0.2.0-pr.6821.02b36a6` exposes no task API
- [ ] Reminder/escalation authoring and history — blocked because TAP miniapp SDK `0.2.0-pr.6821.02b36a6` exposes no automation/reminder API
- [ ] Automatic Vanta webhook-triggered TAP workflow invocation — the Worker receives events, but the TAP SDK exposes no authenticated server-side workflow/event bridge; the real UI feed is refreshed on user request

## Knowledge and code context

- [x] Specialist definition restricts CKG and knowledge access to declared `ckg_*`, `knowledge_*`, and `kg_*` tools and prompts for project scope, provenance, and visibility
- [ ] Explicit plot attachment/retrieval UI — blocked because TAP miniapp SDK `0.2.0-pr.6821.02b36a6` exposes no knowledge-plot query or attachment API
- [ ] Verified CKG source results in browser preview — requires a packaged TAP host, an indexed scoped project, and authorized source content

## Verification coverage

- [x] Empty state, validation, permission-sensitive operations, state transitions, duplicate protection, replay protection, conflict behavior, and persistence parsing tests
- [x] API-family and MCP-tool inventory completeness tests
- [x] Specialist regional endpoint, exact tool allowlist, read-only policy, and unavailable-audit prompt tests
- [x] Worker integration tests cover signature verification, durable replay handling, stale and invalid deliveries, Access denial/CORS, retention, and oversized IDs
- [x] Browser screenshots regenerated after the document-scroll, compact-control, status-bar, and webhook-feed UI changes
- [x] Browser reload preserved the created case, planning transition, endpoint configuration, and receipts
- [x] Browser warning/error console re-verified clean after desktop, viewer, compact, failure, and reload passes
- [ ] Live Vanta OAuth and source-data retrieval — requires a packaged TAP host and an authorized Vanta Admin account
