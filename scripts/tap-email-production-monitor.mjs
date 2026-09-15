import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const apiOrigin = 'https://api.cloudflare.com';
const queueBacklogMaximumAgeMilliseconds = {
  command: 5 * 60_000,
  sync: 20 * 60_000,
};
const neverLeasedMaximumAgeMilliseconds = 5 * 60_000;
const expiredLeaseGraceMilliseconds = 2 * 60_000;
const accountProgressMaximumAgeMilliseconds = 25 * 60_000;

const expectedQueues = [
  {
    role: 'command',
    name: 'tap-email-commands-production',
    deadLetterQueue: 'tap-email-commands-dead-letter-production',
  },
  {
    role: 'sync',
    name: 'tap-email-sync-production',
    deadLetterQueue: 'tap-email-sync-dead-letter-production',
  },
];

const syncHealthSql = `WITH anomalies(signal, observed_at) AS (
  SELECT 'received_event_not_leased', received_at
    FROM provider_events
   WHERE state = 'received'
     AND attempts = 0
     AND received_at <= ?1

  UNION ALL

  SELECT 'retryable_event_overdue', COALESCE(next_attempt_at, updated_at)
    FROM provider_events
   WHERE state = 'retryable'
     AND (
       (next_attempt_at IS NULL AND updated_at <= ?1)
       OR next_attempt_at <= ?1
     )

  UNION ALL

  SELECT 'processing_lease_expired', COALESCE(lease_expires_at, updated_at)
    FROM provider_events
   WHERE state = 'processing'
     AND (lease_expires_at IS NULL OR lease_expires_at <= ?2)

  UNION ALL

  SELECT 'active_account_not_advanced', account.updated_at
    FROM google_accounts account
   WHERE account.connection_state = 'active'
     AND account.coverage_state != 'blocked'
     AND account.updated_at <= ?3
     AND NOT EXISTS (
       SELECT 1
         FROM provider_events event
        WHERE event.profile_id = account.profile_id
          AND event.account_id = account.account_id
          AND event.state IN ('received', 'processing', 'retryable')
     )
)
SELECT signal,
       COUNT(*) AS affected_count,
       MIN(observed_at) AS oldest_observed_at
  FROM anomalies
 GROUP BY signal
 ORDER BY signal`;

function required(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required monitor configuration: ${name}.`);
  }
  return value;
}

function issue(issues, code, summary) {
  issues.push({ code, summary });
}

async function defaultSleep(milliseconds) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestJson(fetchImpl, url, init = {}, sleep = defaultSleep) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        // Keep the complete failure path inside the five-minute workflow
        // budget so the alerting steps still get a chance to run.
        signal: AbortSignal.timeout(10_000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleep(1_000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`request returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(1_000 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('request failed');
}

async function cloudflareJson(fetchImpl, apiToken, url, init, sleep) {
  const payload = await requestJson(fetchImpl, url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }, sleep);
  if (!payload || payload.success !== true) {
    throw new Error('Cloudflare returned an unsuccessful response');
  }
  return payload;
}

async function listQueues(fetchImpl, accountId, apiToken, sleep) {
  const queues = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(`/client/v4/accounts/${encodeURIComponent(accountId)}/queues`, apiOrigin);
    url.searchParams.set('page', String(page));
    const payload = await cloudflareJson(fetchImpl, apiToken, url, undefined, sleep);
    if (!Array.isArray(payload.result)) throw new Error('Queue inventory was malformed');
    queues.push(...payload.result);
    const reportedPages = Number(payload.result_info?.total_pages);
    if (!Number.isInteger(reportedPages) || reportedPages < 0 || reportedPages > 10_000) {
      throw new Error('Queue pagination metadata was malformed');
    }
    totalPages = Math.max(1, reportedPages);
    page += 1;
  } while (page <= totalPages);
  return queues;
}

function exactQueue(queues, name) {
  const matches = queues.filter(queue => queue?.queue_name === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} queue`);
  }
  return matches[0];
}

async function queueMetrics(fetchImpl, accountId, apiToken, queue, sleep) {
  if (typeof queue?.queue_id !== 'string' || queue.queue_id.length === 0) {
    throw new Error('Queue identifier was missing');
  }
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queue.queue_id)}/metrics`,
    apiOrigin,
  );
  const payload = await cloudflareJson(fetchImpl, apiToken, url, undefined, sleep);
  const metrics = payload.result;
  if (
    !Number.isFinite(metrics?.backlog_count) ||
    !Number.isFinite(metrics?.backlog_bytes) ||
    !Number.isFinite(metrics?.oldest_message_timestamp_ms)
  ) {
    throw new Error('Queue metrics were malformed');
  }
  return metrics;
}

function consumerScript(candidate) {
  return candidate?.script_name ?? candidate?.script ?? candidate?.service;
}

async function inspectQueues(options, issues, observations) {
  const queues = await listQueues(
    options.fetchImpl,
    options.accountId,
    options.apiToken,
    options.sleep,
  );
  for (const expected of expectedQueues) {
    const queue = exactQueue(queues, expected.name);
    const deadLetterQueue = exactQueue(queues, expected.deadLetterQueue);
    const metrics = await queueMetrics(
      options.fetchImpl,
      options.accountId,
      options.apiToken,
      queue,
      options.sleep,
    );
    const deadLetterMetrics = await queueMetrics(
      options.fetchImpl,
      options.accountId,
      options.apiToken,
      deadLetterQueue,
      options.sleep,
    );
    observations.push(
      `${expected.role} queue backlog: ${metrics.backlog_count}; dead letters: ${deadLetterMetrics.backlog_count}`,
    );

    if (queue.settings?.delivery_paused !== false) {
      issue(issues, `${expected.role}_queue_delivery_inactive`, `${expected.role} queue delivery is not active`);
    }
    if (!queue.producers?.some(candidate =>
      candidate?.type === 'worker' && candidate.script === options.workerName
    )) {
      issue(issues, `${expected.role}_queue_producer_missing`, `${expected.role} queue producer is missing`);
    }
    if (!queue.consumers?.some(candidate =>
      candidate?.type === 'worker' &&
      consumerScript(candidate) === options.workerName &&
      candidate.dead_letter_queue === expected.deadLetterQueue
    )) {
      issue(issues, `${expected.role}_queue_consumer_missing`, `${expected.role} queue consumer or dead-letter route is missing`);
    }
    if (deadLetterMetrics.backlog_count > 0) {
      issue(issues, `${expected.role}_dead_letters_present`, `${expected.role} dead-letter queue is not empty`);
    }
    if (metrics.backlog_count > 0) {
      const oldest = metrics.oldest_message_timestamp_ms;
      if (oldest <= 0) {
        issue(issues, `${expected.role}_queue_backlog_age_unknown`, `${expected.role} queue backlog age is unavailable`);
      } else if (options.now.getTime() - oldest > queueBacklogMaximumAgeMilliseconds[expected.role]) {
        issue(issues, `${expected.role}_queue_backlog_stalled`, `${expected.role} queue backlog exceeded its age threshold`);
      }
    }
  }
}

async function inspectDurableProgress(options, issues, observations) {
  const receivedCutoff = new Date(
    options.now.getTime() - neverLeasedMaximumAgeMilliseconds,
  ).toISOString();
  const leaseCutoff = new Date(
    options.now.getTime() - expiredLeaseGraceMilliseconds,
  ).toISOString();
  const accountCutoff = new Date(
    options.now.getTime() - accountProgressMaximumAgeMilliseconds,
  ).toISOString();
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`,
    apiOrigin,
  );
  const payload = await cloudflareJson(options.fetchImpl, options.apiToken, url, {
    method: 'POST',
    body: JSON.stringify({
      sql: syncHealthSql,
      params: [receivedCutoff, leaseCutoff, accountCutoff],
    }),
  }, options.sleep);
  const query = Array.isArray(payload.result) ? payload.result[0] : null;
  if (query?.success !== true || !Array.isArray(query.results)) {
    throw new Error('D1 monitor query was malformed');
  }
  if (query.results.length === 0) {
    observations.push('durable sync anomalies: 0');
    return;
  }
  for (const row of query.results) {
    const signal = typeof row?.signal === 'string' ? row.signal : 'unknown_sync_anomaly';
    const count = Number(row?.affected_count);
    if (!Number.isFinite(count) || count < 1) throw new Error('D1 monitor row was malformed');
    const oldest = typeof row.oldest_observed_at === 'string'
      ? `; oldest ${row.oldest_observed_at}`
      : '';
    issue(issues, signal, `${signal}: ${count} affected${oldest}`);
  }
  observations.push(`durable sync anomaly groups: ${query.results.length}`);
}

async function inspectService(options, issues, observations) {
  for (const endpoint of ['health', 'ready']) {
    const url = new URL(endpoint, `${options.serviceOrigin.replace(/\/$/u, '')}/`);
    try {
      const payload = await requestJson(options.fetchImpl, url, undefined, options.sleep);
      if (payload?.ok !== true || payload?.service !== 'tap-email-coordinator') {
        throw new Error('unexpected response');
      }
      observations.push(`/${endpoint}: healthy`);
    } catch {
      issue(issues, `${endpoint}_check_failed`, `/${endpoint} did not report healthy`);
    }
  }
}

export async function runTapEmailProductionMonitor({
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = new Date(),
  accountId,
  apiToken,
  databaseId,
  workerName = 'tap-email-coordinator-production',
  serviceOrigin = 'https://tap-email-coordinator.theaiplatform.app',
}) {
  const options = {
    fetchImpl,
    sleep,
    now,
    accountId: required(accountId, 'CLOUDFLARE_ACCOUNT_ID'),
    apiToken: required(apiToken, 'CLOUDFLARE_API_TOKEN'),
    databaseId: required(databaseId, 'TAP_EMAIL_D1_DATABASE_ID'),
    workerName,
    serviceOrigin,
  };
  const issues = [];
  const observations = [];
  for (const [scope, inspect] of [
    ['queues', inspectQueues],
    ['durable_progress', inspectDurableProgress],
    ['service', inspectService],
  ]) {
    try {
      await inspect(options, issues, observations);
    } catch (error) {
      issue(
        issues,
        `${scope}_monitor_unavailable`,
        `${scope} monitor failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
  return {
    ok: issues.length === 0,
    observedAt: now.toISOString(),
    issues,
    observations,
  };
}

export function monitorReport(result, runUrl) {
  const lines = [
    '# TAP Email production sync monitor',
    '',
    `Status: **${result.ok ? 'healthy' : 'unhealthy'}**`,
    `Observed: ${result.observedAt}`,
    ...(runUrl ? [`Run: ${runUrl}`] : []),
    '',
    '## Checks',
    '',
    ...result.observations.map(value => `- ${value}`),
  ];
  if (result.issues.length > 0) {
    lines.push('', '## Issues', '', ...result.issues.map(value => `- \`${value.code}\`: ${value.summary}`));
  }
  lines.push('', 'The monitor is read-only and reports aggregate operational state only.', '');
  return lines.join('\n');
}

async function main() {
  let result;
  try {
    result = await runTapEmailProductionMonitor({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      databaseId: process.env.TAP_EMAIL_D1_DATABASE_ID,
      workerName: process.env.TAP_EMAIL_COORDINATOR_WORKER,
      serviceOrigin: process.env.TAP_EMAIL_COORDINATOR_PRODUCTION_URL,
    });
  } catch (error) {
    result = {
      ok: false,
      observedAt: new Date().toISOString(),
      issues: [{
        code: 'monitor_configuration_invalid',
        summary: error instanceof Error ? error.message : 'Monitor configuration was invalid',
      }],
      observations: [],
    };
  }
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const report = monitorReport(result, runUrl);
  const reportPath = process.env.TAP_EMAIL_MONITOR_REPORT_PATH;
  if (reportPath) await writeFile(reportPath, report, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report, 'utf8');
  }
  console.log(JSON.stringify({
    ok: result.ok,
    observedAt: result.observedAt,
    issueCodes: result.issues.map(value => value.code),
  }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
