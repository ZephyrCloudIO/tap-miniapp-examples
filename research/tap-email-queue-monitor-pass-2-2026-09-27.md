# TAP Email queue monitoring — research pass 2

Date: 2026-09-27. Independent contract review of the proposed fix against Cloudflare documentation and repository source at `d26c3b2543e70a6def2c30c2c8a0c2a00c32604c`. No production writes, message-content queries, or secret inspection. This is the second and final research pass; [pass 1](tap-email-queue-monitor-pass-1-2026-09-27.md) records the production chronology.

## Finding

**Approve the narrow sync-only warning fallback, with explicit limits.** Cloudflare describes the Queue metrics endpoint as approximate, best effort, and specifies that oldest timestamp `0` means unknown. Thus positive backlog plus zero timestamp is missing age information, not evidence that the oldest message exceeded a deadline. The live aggregate capture at 21:36:18 UTC reproduced backlog **1**, bytes **303**, oldest timestamp **0**, no durable anomalies, empty DLQs and healthy HTTP checks. This disproves a proposed zero-byte-only exemption. It does not establish why Cloudflare omitted the timestamp. [API contract][metrics-api] [Aggregate capture](/tmp/tap-email-monitor-before.json)

The D1 fallback has a concrete basis: application sync events are inserted durably before Queue dispatch, and the consumer records leases and terminal outcomes. A delivery outage should therefore leave overdue durable work even when Queue age is unknown. However, this is an inference from the application's producer/consumer contract, not a Cloudflare guarantee or proof that every physical queue copy has been accounted for. [Producer][producer] [Consumer][consumer]

## Recommended monitor contract

| Observation | Result |
| --- | --- |
| Sync backlog positive; timestamp exactly `0`; independent D1 check succeeds with no anomalies | Pass actionable checks, retain a structured **warning** that sync age is unknown and durable checks found no overdue work. |
| Same unknown sync age with a D1 anomaly, API failure, or malformed D1 result | Fail; absence of corroborating evidence must never become fallback success. |
| Command backlog positive; age unknown | Keep failure: this monitor has no equivalent durable command-state checks. |
| Known backlog exceeds existing 5-minute command / 20-minute sync threshold | Keep failure, even if D1 reports no anomalies. |
| Paused delivery, wrong topology, physical DLQ messages, health/readiness failure, malformed API response | Keep independent failures; warning classification cannot suppress them. |
| Empty queue and timestamp `0` | No age warning; this provides no evidence of pending work. |

These rules are application policy informed by the [Queue API contract][metrics-api], existing [thresholds/checks][monitor], and [durable SQL][durable-sql]. Keep the fallback decision explicit and apply it only after the durable query finishes successfully. Never synthesize age zero, claim the queue drained, or drop the raw count/bytes/age observation.

Validate all metric fields as finite, nonnegative numbers. **Only exact `0` is the documented unknown timestamp**; negative values must not receive the warning exemption. Reject implausibly future timestamps as invalid telemetry. When bounding future time, account for clock skew and elapsed API request time: the current monitor captures `now` before sequential network requests, so strict `timestamp > initialNow` rejection would falsely reject newly enqueued work. Use acquisition-time comparison or an explicit bounded tolerance, and test it. The API types are `number`; do not invent an integer-only requirement for approximate metrics without evidence. [API field definitions][metrics-api] [Existing parsing and clock][monitor]

## Close the durable failure gap

Add aggregate detection of `provider_events.state = 'dead_letter'` joined to active accounts, excluding failures superseded by `last_full_sync_completed_at` under the existing coverage contract, or independently proven recovery of the exact continuation page as described below. Cloudflare's DLQ contains deliveries that exhaust platform retries; the application separately records terminal failures and then calls `ack()`, so an empty platform DLQ cannot detect these logical failures. Explicit acknowledgements stop redelivery. [Cloudflare acknowledgement/retry semantics][retries] [Terminal application failure][terminal] [Existing supersession predicate][coverage]

The full-sync clause is `last_full_sync_completed_at IS NULL OR event.updated_at > last_full_sync_completed_at`, matching the current application rule. Execute the SQL in tests against fixtures for current, superseded, inactive-account and cross-account failures; a mocked list of anomaly rows cannot validate this predicate. A newer metadata sync does **not** prove historical body downloads recovered: body backfill stores handled errors separately and deliberately returns without provider dead letters. Keep the report limited to the monitored operational conditions; historical-body completeness requires its own signals. [Coverage rule][coverage] [Body error handling][body-errors]

Implementation follow-up within this pass found a necessary refinement. The parent task's read-only aggregate production probes identified a `continue` / `google_request_rejected` terminal event at **17:49:16.581 UTC**, followed by an applied event matching the same profile, account, page token and generation, with the current checkpoint advanced and 40 later applied continuations. This evidence was supplied by the parent, not independently re-queried in this pass. Waiting for an entire historical traversal to finish before recognizing that page's recovery would produce a new stale alert.

The draft therefore excludes a continuation failure only when a later applied event matches its profile/account, `continue` mode, nonempty page token and nonempty generation; the generation is still current; and the account cursor differs from the failed page. This is a defensible operational recovery predicate: `newestPage` persists the page's threads before advancing the cursor, fences both page and generation, and ignores stale deliveries. `recoverOrphanedBackfills` redispatches the exact saved page/generation. An applied stale-copy no-op alone would not be proof; the separately advanced same-generation checkpoint supplies corroboration. This changes alert interpretation only, preserving failure/audit records and UI coverage semantics. [Page fencing and checkpoint][page-fencing] [Orphan recovery][orphan-recovery]

The review found one edge: the recipient-history migration path can reset traversal while passing an existing `message.syncGeneration`, so generation equality alone is not universal proof of the same traversal. The final reviewed draft adds `sync_generation_started_at <= event.received_at`, which also rejects null starts under SQL comparison semantics, proving the traversal existed before the failed delivery was created. Later same-generation resets and missing legacy starts remain failures until a full sync supplies separate recovery evidence. The fixture matrix covers both cases alongside positive recovery and profile/account/page/generation/mode/time/checkpoint mismatches. This refines the initial full-sync-only recommendation using the actual continuation recovery evidence, without rewriting failure/history counters. [Reset routing][reset-routing]

## Alternatives and reporting

Repeated samples or a grace period can reduce transient noise, but cannot turn a permanently unknown timestamp into known age. The unchanged-code failures and successes in pass 1 make merely waiting for another green sample insufficient. A new persistence store or longer detection delay is unnecessary for this narrow correction.

GraphQL is useful for trends, not a replacement for the missing timestamp: documented queue backlog metrics are interval averages, and lag measures elapsed time for consumed-message operations. Those do not prove the maximum age of a message still waiting. The queue analytics datasets use adaptive naming, and Cloudflare documents adaptive sampling for such datasets. Adding another API and permission requirement is not the smallest reliable fix. [Queue metrics datasets][metrics-guide] [Sampling][sampling]

Render warning-only results as **“no actionable sync failure detected; telemetry warning”**, not fully healthy. Replace the automatic closure claim “Production sync recovered” with language indicating that the latest checks found no actionable failure, linking the run/report and retaining warning details. A classification correction must not be described as a repaired backlog. [Current issue lifecycle][workflow]

Minimum tests: healthy baseline; sync unknown with zero and nonzero bytes; command unknown; unknown sync plus D1 failure/malformed result/anomaly; known stale age despite healthy D1; negative/missing/nonfinite and implausibly future metrics; tolerated request-time skew; preserved topology/DLQ/HTTP failures; actual SQL fixtures for unsuperseded logical dead letters; and warning visibility in both machine output and human report.

## Draft review

Reviewed the parent task's in-progress monitor, workflow, README and real-D1 test fixtures during this pass. Explicit D1 success gating, sync-only downgrade, logical-dead-letter SQL, retained independent failures, warning codes and conservative issue-closure wording implement the recommended contract. The parent corrected both initial adversarial findings: metrics now use finite nonnegative validation, and the acquisition clock includes elapsed monotonic time before applying the 60-second future tolerance. Splitting event/account anomaly CTEs also addresses the compound-SELECT limit encountered by the parent's D1 integration tests. The parent owns test execution and final implementation; this report does not claim deployment or independent execution of those tests.

[metrics-api]: https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/
[metrics-guide]: https://developers.cloudflare.com/queues/observability/metrics/
[retries]: https://developers.cloudflare.com/queues/configuration/batching-retries/
[sampling]: https://developers.cloudflare.com/analytics/graphql-api/sampling/
[producer]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/sync-events.ts#L118-L134
[consumer]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L1983-L2080
[terminal]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L2081-L2138
[coverage]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L1939-L1980
[body-errors]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/body-backfill.ts#L113-L121
[page-fencing]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/mailbox.ts#L1046-L1134
[orphan-recovery]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/mailbox.ts#L1418-L1438
[reset-routing]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/mailbox.ts#L1293-L1312
[monitor]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs
[durable-sql]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L26-L81
[workflow]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/.github/workflows/monitor-tap-email-coordinator.yml#L80-L98

## Implementation verification by the parent task

The final candidate was run read-only against the production Queue API, D1 and HTTP endpoints at **21:48:52 UTC** on September 27. It returned `ok: true`, no issues or warnings: command backlog/DLQ 0, sync backlog 2 / 303 bytes with a known recent timestamp, sync DLQ 0, durable anomaly groups 0, and healthy `/health` and `/ready`. The earlier candidate at 21:47:20 also passed with sync backlog 4 / 709 bytes. These are live point-in-time checks of the candidate, not proof that the scheduled GitHub workflow has adopted the change. The original 21:36:18 capture reproduced the unknown-age failure with backlog 1 / 303 bytes / timestamp 0; regression fixtures cover that exact telemetry combination.

Validation: all 48 Node/static unit tests passed, and TAP static verification passed for 11 apps / 143 cases. The final coordinator suite passed all 238 tests, including 23 monitor D1 cases. Coordinator TypeScript validation passed. No production state, credentials, queue messages, failure audit records, or coverage counters were changed during validation.
