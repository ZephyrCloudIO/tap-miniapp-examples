import assert from 'node:assert/strict';
import test from 'node:test';
import { runTapEmailProductionMonitor } from './tap-email-production-monitor.mjs';

const now = new Date('2026-09-15T04:00:00.000Z');

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function queue(role, overrides = {}) {
  const name = `tap-email-${role}-production`;
  return {
    queue_id: `${role}_id`,
    queue_name: name,
    settings: { delivery_paused: false },
    producers: [{ type: 'worker', script: 'tap-email-coordinator-production' }],
    consumers: [{
      type: 'worker',
      script_name: 'tap-email-coordinator-production',
      dead_letter_queue: `tap-email-${role}-dead-letter-production`,
    }],
    ...overrides,
  };
}

function deadLetter(role) {
  return {
    queue_id: `${role}_dlq_id`,
    queue_name: `tap-email-${role}-dead-letter-production`,
  };
}

function createFetch({
  commandQueue = queue('commands'),
  syncQueue = queue('sync'),
  metrics = {},
  anomalyRows = [],
} = {}) {
  const calls = [];
  const inventory = [commandQueue, deadLetter('commands'), syncQueue, deadLetter('sync')];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.toString(), method: init.method ?? 'GET', body: init.body });
    if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/queues')) {
      const page = Number(url.searchParams.get('page'));
      return json({
        success: true,
        result: page === 1 ? inventory.slice(0, 2) : inventory.slice(2),
        result_info: { page, total_pages: 2 },
      });
    }
    const metricMatch = url.pathname.match(/\/queues\/([^/]+)\/metrics$/u);
    if (metricMatch) {
      const queueId = decodeURIComponent(metricMatch[1]);
      return json({
        success: true,
        result: {
          backlog_count: 0,
          backlog_bytes: 0,
          oldest_message_timestamp_ms: 0,
          ...metrics[queueId],
        },
      });
    }
    if (url.pathname.endsWith('/d1/database/database_id/query')) {
      return json({ success: true, result: [{ success: true, results: anomalyRows }] });
    }
    if (url.hostname === 'tap-email-coordinator.theaiplatform.app') {
      return json({ ok: true, service: 'tap-email-coordinator' });
    }
    return json({ success: false }, 404);
  };
  return { fetchImpl, calls };
}

async function run(fake) {
  return runTapEmailProductionMonitor({
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
    now,
    accountId: 'account_id',
    apiToken: 'api_token',
    databaseId: 'database_id',
  });
}

test('healthy monitor paginates queues and uses the official consumer field', async () => {
  const fake = createFetch();
  const result = await run(fake);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(fake.calls.some(call => call.url.includes('page=2')), true);
  assert.equal(fake.calls.every(call =>
    call.method === 'GET' ||
    (call.method === 'POST' && call.url.endsWith('/d1/database/database_id/query'))
  ), true);
  const query = fake.calls.find(call => call.method === 'POST');
  const body = JSON.parse(query.body);
  assert.match(body.sql, /^WITH anomalies/u);
  assert.doesNotMatch(body.sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/iu);
  assert.equal(body.params.length, 3);
});

test('paused delivery, stale backlog, dead letters, and D1 anomalies are unhealthy', async () => {
  const fake = createFetch({
    commandQueue: queue('commands', { settings: { delivery_paused: true } }),
    metrics: {
      sync_id: {
        backlog_count: 2,
        backlog_bytes: 200,
        oldest_message_timestamp_ms: now.getTime() - 21 * 60_000,
      },
      sync_dlq_id: {
        backlog_count: 1,
        backlog_bytes: 100,
        oldest_message_timestamp_ms: now.getTime() - 60_000,
      },
    },
    anomalyRows: [{
      signal: 'received_event_not_leased',
      affected_count: 1,
      oldest_observed_at: '2026-09-15T03:50:00.000Z',
    }],
  });
  const result = await run(fake);

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(value => value.code), [
    'command_queue_delivery_inactive',
    'sync_dead_letters_present',
    'sync_queue_backlog_stalled',
    'received_event_not_leased',
  ]);
  assert.equal(result.issues.some(value => /profile|account_id|message/iu.test(value.summary)), false);
});

test('API failures fail closed without preventing independent service checks', async () => {
  const fake = createFetch();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/queues')) return json({ success: false }, 503);
    return original(input, init);
  };
  const result = await run(fake);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some(value => value.code === 'queues_monitor_unavailable'), true);
  assert.equal(result.observations.includes('/health: healthy'), true);
  assert.equal(result.observations.includes('/ready: healthy'), true);
});
