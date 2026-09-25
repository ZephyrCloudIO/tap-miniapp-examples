import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProductionAnalytics } from './verify-production-analytics.mjs';
const ready = { ready: true, schemaVersion: 'tap.calendar.public-booking-analytics.v2',
  trafficSince: '2026-09-25T00:00:00.000Z', conversionSince: '2026-09-25T00:00:00.000Z' };
const request = async url => url.includes('/health/') ? Response.json(ready)
  : new Response(url.endsWith('.js') ? 'visitId; /analytics' : '<script src="/static/index.js"></script>');
test('verifies deployed gateway and tracker without writing traffic', async () => {
  assert.deepEqual(await verifyProductionAnalytics({ request }), ready);
});
test('rejects a missing or outdated gateway migration', async () => {
  await assert.rejects(verifyProductionAnalytics({ request: async () => Response.json({ ok: true }) }), /migrations/);
});
test('rejects a public deployment without tracking calls', async () => {
  await assert.rejects(verifyProductionAnalytics({ request: async url => url.endsWith('.js') ? new Response('old code') : request(url) }), /public booking tracker/);
});
