# ADR 0002: Host-governed Email Activity source for Chloe status

## Status

Proposed; the package-side ledger, MCP aggregate, and dormant source runtime
are implemented, while automatic Chloe inclusion is blocked on a host/SDK
contribution contract

## Date

2026-09-14

## Context

TAP Email now records terminal, authoritative command receipts in an
idempotent private-profile SQLite ledger. It publishes a bounded,
content-free `activity/v1` projection and exposes
`get_email_activity_summary` through the package MCP. A user-selected
specialist, including Chloe when explicitly granted access, can call that tool
for an exact half-open time range.

Automatic inclusion in Chloe's universal status is a different trust path.
The package must not self-enroll in status collection, impersonate active-time
telemetry, or cause Chloe to discover arbitrary MCP tools. The host must choose
eligible sources, supply the signed-in principal and workspace, impose the
time range, and preserve failures and incomplete coverage in the composed
answer.

Platform implementation is tracked in
[ze-agency-tauri#10771](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/10771).

Miniapp SDK 0.15 does not expose that path:

- `config-schema.json` has a closed contribution union containing
  `ui.surface`, `context.provider`, `agent.skill`, MCP contributions, and other
  existing kinds, but no `activity.source` kind.
- `sdk.d.ts` exposes no `sdk.activity` API.
- `sdk.home` is documented as a reserved, currently uninstalled attention
  projection. Its `publishAttention` method supplies UI attention items, not
  query-time status aggregates, and is therefore not a substitute.

Registering an invented contribution in `manifest.tap.json` would fail schema
validation and would not create a governed host consumer. The active manifest
therefore registers only the privacy-bounded MCP tool.

The package includes a dormant `activity-source.ts` runtime for the future host
contract. It requires frozen, exact user/workspace/source context; accepts only
the exact half-open range request below; and can receive only a read-only,
host-scoped storage reader. It is not reachable from the active manifest.

## Decision

Add an SDK and host contribution named `activity.source`. TAP Email will opt
in only after the host implements the following contract.

### Proposed descriptor

The precise field names may follow platform naming conventions, but the
semantics are required:

```json
{
  "kind": "activity.source",
  "id": "tap-email-committed-actions",
  "apiVersion": 1,
  "targets": {
    "quickjs": {
      "expose": "./activity/tap-email-committed-actions",
      "runtime": "quickjs"
    }
  },
  "authorization": {
    "allOf": ["tap-email.view"],
    "effects": [{ "kind": "storage", "resources": ["tap-email"] }]
  },
  "lifecycleScope": "contribution",
  "options": {
    "summaryKind": "committed-domain-actions",
    "privacyClass": "content-free-aggregate",
    "storageReads": [
      { "namespace": "tap-email", "keyTemplate": "activity/v1" }
    ]
  }
}
```

The package runtime accepts only:

```ts
type ActivitySourceRequest = Readonly<{
  startAt: string;          // inclusive RFC3339 instant
  endAtExclusive: string;   // exclusive RFC3339 instant
  timeZone: string;         // host-validated IANA zone
}>;
```

`userId`, `workspaceId`, package identity, and caller identity are supplied in
an immutable host execution context. They are never request parameters. The
package rejects missing trusted user/workspace scope and undeclared input
properties.

The result is the existing `EmailActivitySummary` contract plus host-owned
provenance:

```ts
type GovernedActivitySourceResult = Readonly<{
  sourceId: "tap-email-committed-actions";
  sourceRevision: string; // revision of activity/v1 read by the host
  summary: EmailActivitySummary;
}>;
```

`EmailActivitySummary` contains only action/outcome counts, the exact requested
range, failures, and coverage. It never contains message subjects or bodies,
correspondents, recipients, account IDs, thread/message IDs, idempotency keys,
or per-thread timelines. Sync, import, indexing, remote-image fetching, and
other background work are excluded. Applied actions use the provider
acknowledgement timestamp. When today's receipt shape has no terminal timestamp
for a non-applied outcome, the summary uses the coordinator acceptance time and
emits an explicit coverage warning rather than pretending it is completion
time.

### Host governance

The host:

1. Maintains the allowlist of source contribution IDs eligible for Chloe's
   built-in status. Installing TAP Email does not automatically grant that
   access.
2. Supplies the trusted user/workspace principal and query range from Chloe's
   status request; a package cannot select another principal or widen the
   range.
3. Invokes sources read-only with a deadline, bounds result size, validates the
   declared output contract, and records source provenance.
4. Joins the aggregate into `self_status_get` alongside existing authoritative
   sources. A failed or partial source is reported as unavailable or partial;
   it is never silently treated as zero activity.
5. Does not write these counts into `RecordActivityPulse` or the trusted-device
   active-time ledger. Email actions and active minutes remain distinct facts.

### Multi-installation coverage

The current local ledger proves only receipts observed by this TAP Email
installation. Its coverage fields make that limitation visible. A universal,
cross-device Chloe result requires the host to either:

- invoke every authorized installation and merge aggregates after deduplicating
  at a trusted boundary with the authoritative command idempotency key; or
- read a coordinator-owned, profile-scoped committed-receipt aggregate that
  already performs that deduplication.

The package must not publish idempotency keys to shared JSON merely to enable
cross-device merging. Until a trusted aggregation path exists, Chloe must label
the result as installation-scoped rather than account-complete.

## Activation gate

TAP Email may add the descriptor to its active manifest only when all of these
conditions are true:

- the installed SDK schema recognizes `activity.source`;
- the runtime supplies trusted user and workspace context;
- the host has an explicit source allowlist and per-source authorization;
- `self_status_get` preserves source coverage, warnings, failures, and
  provenance;
- tests prove principal substitution, range widening, raw event return, and
  active-time writes are rejected;
- multi-installation behavior is either deduplicated or explicitly reported as
  installation-scoped.

## Consequences

- Chloe can use the implemented MCP summary now when the user explicitly
  selects/grants her as a consumer.
- Automatic universal status remains honestly unavailable in SDK 0.15 rather
  than being simulated through an unrelated API.
- The package-side data and output contract can be reused by the future host
  contribution without changing the privacy boundary.
- Conversation handoffs, Tasks, and non-command workflow events are not counted
  until each has an authoritative, idempotent receipt with equivalent actor and
  timestamp semantics.
