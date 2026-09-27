# TAP Email queue monitoring — research pass 1

Date: 2026-09-27. Source baseline: `d26c3b2543e70a6def2c30c2c8a0c2a00c32604c` (merged Email 0.3.7). Scope: production GitHub Actions logs and aggregate alert reports, plus implementation and tests. This pass made no production changes, retrieved no email content, and did not read secret values. Cloudflare API semantics are reserved for research pass 2.

## Finding

The alert is real **missing-age telemetry**, but the evidence does not establish a stalled mailbox. The monitor treats any positive sync queue count with a nonpositive oldest timestamp as an immediate outage. The inspected failures report only `sync_queue_backlog_age_unknown`; the durable anomaly check and both HTTP checks pass. A deployment observation also records **one sync message with zero backlog bytes**, active delivery and an empty dead-letter queue. These observations support investigating an approximate/inconsistent metrics sample; they do not identify an actual queued message or prove the platform's cause. [Alert logic][age-logic] [Issue 121][issue121] [Production deployment][deploy]

**Issue 121 is already closed**, automatically, at 21:29:44 UTC after monitor run `36351916653` passed. Issue 115 was similarly closed at 19:55:08 UTC, and an age-unknown failure recurred six minutes later. A green point-in-time sample is therefore not proof that the recurring monitoring defect is fixed. [Issue 121 recovery][recover121] [Issue 115 recovery][recover115] [Subsequent failure][run2001]

## Production evidence

| Observed UTC | Source | Result | What it proves |
| --- | --- | --- | --- |
| 19:49:12.796 | [Run 36345738388][run1949], final body of [issue 115][issue115] | Only `sync_queue_backlog_age_unknown`; command backlog 0, sync backlog 1, both DLQs 0, durable anomalies 0, HTTP checks healthy | The monitor had a positive sync count but no usable oldest timestamp. |
| 19:55:00.915 | [Run 36346080632][run1955] | `ok:true`, issue codes empty; issue 115 closed | One complete monitor run passed. The log does not include raw metrics or explain what changed. |
| 20:01:04.086 | [Run 36346441870][run2001] | Only `sync_queue_backlog_age_unknown` | Recovery did not persist, on the same main commit `30be00e`. |
| 20:39:49.331 | [Run 36348852615][run2039] | `ok:true`, issue codes empty | Another healthy point-in-time sample on `30be00e`. |
| 20:45:57.219 | [Run 36349190121][run2045] | Only `sync_queue_backlog_age_unknown`; issue 121 opened | Another recurrence without a monitor implementation change. |
| 21:20:41.093 | [Run 36351369632][run2120], final body of [issue 121][issue121] | Only `sync_queue_backlog_age_unknown`; command backlog 0, sync backlog 1, both DLQs 0, durable anomalies 0, HTTP checks healthy | Same alert after the 0.3.7 merge but **before** its coordinator deployment. |
| 21:24:48.781 | [Coordinator deployment 36351524254][deploy] | Sync delivery active, backlog 1 message / **0 bytes**, DLQ 0; command backlog / DLQ 0 | A queue count is observed, but its contents, exact age and cause remain unknown. Deployment did not resume an explicitly paused queue. |
| 21:29:40.987 | [Run 36351916653][run2129] | `ok:true`, issue codes empty; issue 121 closed | The post-deployment sample passed; it does not establish causal recovery from the deployment. |
| 21:36:18.961 | [Local aggregate production capture](/tmp/tap-email-monitor-before.json), produced by the parent task and read during this pass | Sync backlog 1, **303 bytes**, oldest timestamp **0**; both DLQs 0, commands 0, durable anomalies 0, HTTP checks healthy | The problem reproduced again after recovery and occurs with nonzero payload bytes. A zero-byte-only workaround would miss the current symptom. |

The production monitor and workflow have no diff between `30be00e11d90f1dca0cf7d9921eb557aab216e31` and `d26c3b2543e70a6def2c30c2c8a0c2a00c32604c`. The age-unknown branch originated in [mailbox recovery change 7fd0e9e][initial-monitor]; later [f1ca953][recent-monitor] added recent-sync scheduling detection. Thus the 0.3.7 release did not change this alert's interpretation. The inspected workflow run logs warn that the dedicated read-only monitor token is not configured and the deployment credential is used as fallback; this is an operational follow-up, not evidence explaining the age sample. [Monitor credential configuration][monitor-workflow]

## What the current monitor actually measures

1. Lists queues, checks active delivery, the expected producer/consumer and dead-letter route, and reads primary/DLQ metrics. Every check is independent of actual mailbox content. [Queue checks][queue-checks]
2. Immediately fails positive backlog with oldest timestamp `<= 0`; a known positive timestamp fails only after 5 minutes for commands or 20 minutes for sync. There is no re-sampling or persistence threshold for an unknown age. [Thresholds][thresholds] [Age interpretation][age-logic]
3. Checks five aggregate D1 conditions: never-leased received events older than 5 minutes, retryable events overdue by 5 minutes, processing leases expired by 2 minutes, active nonblocked accounts with no pending event and no update in 25 minutes, and active accounts with no recent sync request in 25 minutes. [SQL][health-sql] [Cutoffs][health-cutoffs]
4. Opens/refreshes one issue for any failure and closes the currently open issue on any successful run. The workflow currently describes every such transition as “Production sync recovered,” which overstates what a telemetry-only transition establishes. [Alert lifecycle][alert-lifecycle]

Only three monitor unit tests existed at this baseline. They passed in this pass. They cover queue pagination/consumer fields, a combined paused/stale/DLQ/D1-anomaly case, and API failure isolation. **There is no unknown-age test**, no SQL execution test, and no command-versus-sync fallback test. The fake D1 endpoint returns preselected anomaly rows, so it cannot catch mistakes in the actual SQL predicate. [Tests][monitor-tests]

## Producer/consumer facts relevant to a safe fix

- All application-created sync work has a D1 `provider_events` record **before** `SYNC_QUEUE.sendBatch`. A successful Queue send clears `dispatch_pending`, but does not count as a lease or completed work. [Producer][producer]
- A per-minute scheduled handler redispatches old/unleased events and creates due recent-mail, history-recovery and body-download work. Redispatch uses a 2-minute delivery allowance and due-at/lease fences. [Redispatch][redispatch] [Scheduled handler][scheduled]
- Normal history traversal intentionally sends continuations with 15-second or 30-second delays; body traversal uses delayed continuation too. Sync batch timeout is 2 seconds and batch size is 1. Positive depth at an arbitrary instant is expected during useful work. This alone does **not** prove why a timestamp is unknown. [History continuation][history-continuation] [Body continuation][body-continuation] [Queue config][queue-config]
- A sync consumer claims a **16-minute** durable lease. Duplicate copies that lose the claim are acknowledged; cron owns recovery. Already-applied, already-dead-lettered, and missing durable events are acknowledged without further mailbox work. [Lease constant][lease-constant] [Claim/duplicate behavior][consumer-claim]
- Successful sync marks the durable event applied before acknowledging the Queue delivery. Retriable provider failures receive bounded retries; after five attempts or on a permanent error, the application marks the event `dead_letter` and **acknowledges** the delivery. Therefore the Cloudflare DLQ and application dead-letter states are not equivalent. [Success and failure state machine][consumer-complete]

## Gaps that constrain a “D1 says healthy” fallback

**Zero anomaly rows is useful corroboration, not exhaustive mailbox-health proof.** Do not replace the missing timestamp with a claim that every message drained or every mailbox advanced.

1. The SQL does not inspect application `dead_letter` events or `google_accounts.unresolved_failures`. A permanent/exhausted application failure can be absent from the Cloudflare DLQ because the consumer acknowledges it. Fresh account updates suppress the 25-minute account check. A local, in-memory SQLite reproduction using the exact baseline SQL returned **zero anomaly rows** for an application `dead_letter` event with five attempts and an active/stale account updated recently. This demonstrates a monitor coverage gap, not a production incident. [SQL][health-sql] [Terminal ACK][consumer-complete]
2. `google_accounts.updated_at` is updated when coverage is refreshed after **both** success and failure. It is not a dedicated last-success timestamp. The account-progress signal is therefore narrower than its name suggests. [Coverage refresh][coverage-refresh] [Failure refresh][consumer-complete]
3. Body-download content errors are recorded in `mail_body_backfills.last_error_code` / `retry_after` and handled locally; the outer provider event can still become `applied`. The current monitor never queries these tables. It monitors sync transport/durable scheduling, not complete historical-body coverage. [Body retry handling][body-continuation] [Dispatch by mode][consumer-complete]
4. A D1 provider event can show a legitimate recent lease/retry while a queue copy is old, and completed/missing-event duplicates can exist briefly. Counts across the two services need not match. Never require `D1 pending_count === Queue backlog_count` or infer a lost message solely from a mismatch. This follows from the producer and duplicate-acknowledgment implementation; API consistency guarantees still need validation in pass 2. [Producer][producer] [Claim/duplicate behavior][consumer-claim]
5. The existing query has no timestamp-malformation or invalid-state checks and no durable command-health query. Extending sync evidence to justify unknown **command** age would be unsupported.

## Safe candidate fix and acceptance boundaries

Recommended direction for pass 2 to challenge:

1. Preserve the distinction between **operational failure** and **unavailable queue-age telemetry**. Keep unknown sync age visible in the report with count, bytes and the unavailable-age fact. Permit a nonfatal warning only when the sync durable-progress query completed successfully and its required health predicates passed. Do not describe that as measured queue drain or proven completion.
2. Fail closed if the corroborating D1 query is unavailable/malformed. Preserve failures for inactive delivery, missing producer/consumer/DLQ route, any DLQ backlog, known excessive queue age, durable stale work and unavailable queue APIs. Retain unknown command age as a failure until command-specific durable checks exist.
3. Strengthen the durable fallback rather than simply accepting `anomalies:0`: include unresolved application dead letters within the currently relevant sync generation/history boundary, and test real SQL fixtures. Avoid alerting forever on historical failures that a later authoritative full sync superseded. Decide explicitly whether body-download failure reporting is this monitor's scope or separate coverage monitoring.
4. Keep persistent telemetry degradation observable, even if not a mailbox-outage issue. A warning count/section and accurate recovery wording are the minimum. If persistent unknown age needs its own alert threshold, use an explicit retained observation history; a single stateless run cannot know its duration. Merely raising the age threshold cannot repair a missing timestamp.
5. Test at least: sync unknown + valid healthy durable evidence; sync unknown + D1 anomaly; sync unknown + D1 unavailable; unknown command age; nonzero DLQ; known stale age; invalid/nonfinite metrics; missing route; and unchanged independent HTTP health checks. Add actual SQLite fixtures for received/retry/lease deadlines and the application-dead-letter gap.

Do **not** purge queues, resume paused delivery, replay mail, change consumer retry rules, or ignore all `oldest=0` cases to remove this alert. The available evidence does not justify those interventions. A bounded repeat of approximate metrics may improve evidence, but cannot by itself prove historical progress or fix permanently missing age data.

## Reproduction and limits

- Read-only commands: `gh issue view 115/121`, `gh run list`, filtered `gh run view --log`, source/history reads, and `node --test scripts/tap-email-production-monitor.test.mjs` (3 passed).
- Local-only SQL experiment: extracted the existing `syncHealthSql` into in-memory SQLite; inserted one application-dead-letter event and one recently updated active account; result was `[]`.
- No raw live Queue message, token, subject, body, recipient or provider payload was retrieved. Alert issue bodies overwrite prior observations, and successful logs print only issue codes, so exact metrics from every historical successful sample cannot be reconstructed from these sources.
- The 21:36 live aggregate capture was produced by the parent task through authenticated, read-only API requests and then inspected as a local evidence artifact in this pass. The `/tmp` link is session-local, so the exact aggregate values are also recorded in the table above. Its production Queue IDs are not necessary to reproduce the conclusion.
- Current production symptom cause remains unproven. Candidate explanations include approximate/inconsistent metrics and normal pending/in-flight work; neither is elevated to fact without platform documentation and stronger evidence in pass 2.

[issue115]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/issues/115
[issue121]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/issues/121
[recover115]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/issues/115#issuecomment-5859302095
[recover121]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/issues/121#issuecomment-5859993221
[run1949]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36345738388
[run1955]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36346080632
[run2001]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36346441870
[run2039]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36348852615
[run2045]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36349190121
[run2120]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36351369632
[run2129]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36351916653
[deploy]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36351524254
[initial-monitor]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/commit/7fd0e9e376a022f99a4c22d5e6d502850bba3baa
[recent-monitor]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/commit/f1ca953704a57410f3ca5d3c66e60b46c836b478
[thresholds]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L5-L11
[age-logic]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L239-L245
[queue-checks]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L193-L247
[health-sql]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L26-L81
[health-cutoffs]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.mjs#L250-L289
[monitor-tests]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/scripts/tap-email-production-monitor.test.mjs#L37-L158
[monitor-workflow]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/.github/workflows/monitor-tap-email-coordinator.yml#L35-L47
[alert-lifecycle]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/.github/workflows/monitor-tap-email-coordinator.yml#L49-L98
[producer]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/sync-events.ts#L72-L135
[redispatch]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/sync-events.ts#L150-L223
[scheduled]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L2609-L2630
[history-continuation]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/mailbox.ts#L1192-L1199
[body-continuation]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/body-backfill.ts#L108-L120
[queue-config]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/wrangler.jsonc#L105-L126
[lease-constant]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L167
[consumer-claim]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L1983-L2037
[consumer-complete]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L2040-L2138
[coverage-refresh]: https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/d26c3b2543e70a6def2c30c2c8a0c2a00c32604c/apps/tap-email-coordinator/src/index.ts#L1939-L1980
