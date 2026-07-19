import { describe, expect, it } from '@rstest/core';
import {
  addAnalysis,
  canCoordinate,
  configureWebhookApi,
  createCase,
  createSettings,
  emptyState,
  parseState,
  mergeWebhookEvents,
  recordIdempotentReceipt,
  runtimeUuid,
  transitionCase,
  type CompanionState,
} from './domain';

const idSequence = () => {
  let value = 0;
  return () => `id-${++value}`;
};
const fixedNow = () => '2026-07-17T12:00:00.000Z';
const leadState = (): CompanionState => ({
  ...emptyState(),
  settings: createSettings({ role: 'lead', workspaceId: 'workspace-1', region: 'us', timezone: 'America/New_York' }, fixedNow),
});
const validCase = {
  title: 'Review access control gap',
  objectType: 'test' as const,
  vantaObjectId: 'test-123',
  vantaUrl: 'https://app.vanta.com/tests/test-123',
  criterion: 'CC6.1',
  owner: 'Security team',
  dueAt: '2026-08-01',
  notes: 'Confirm branch protection and refresh the Vanta test.',
};

describe('Vanta Companion domain', () => {
  it('starts empty without seeded business records', () => {
    expect(emptyState()).toEqual({ schemaVersion: 3, settings: null, cases: [], analyses: [], receipts: [], webhookEvents: [], processedKeys: [] });
  });

  it('validates and normalizes workspace settings', () => {
    expect(() => createSettings({ role: 'lead', workspaceId: ' ', region: 'us', timezone: 'UTC' })).toThrow('Workspace ID');
    const settings = createSettings({ role: 'operator', workspaceId: ' ws-1 ', channelId: ' room-1 ', region: 'eu', timezone: 'UTC' }, fixedNow);
    expect(settings.workspaceId).toBe('ws-1');
    expect(settings.channelId).toBe('room-1');
    expect(settings.region).toBe('eu');
  });

  it('enforces permission-sensitive case creation', () => {
    expect(canCoordinate('viewer')).toBe(false);
    expect(() => createCase(emptyState(), validCase, 'viewer')).toThrow('cannot create');
  });

  it('validates source boundaries and creates stable case IDs', () => {
    expect(() => createCase(leadState(), { ...validCase, vantaUrl: 'https://example.com/test-123' }, 'lead')).toThrow('valid HTTPS Vanta URL');
    const created = createCase(leadState(), validCase, 'lead', idSequence(), fixedNow);
    expect(created.cases[0]).toMatchObject({ id: 'id-1', status: 'open', vantaObjectId: 'test-123' });
    expect(created.receipts[0]).toMatchObject({ id: 'id-2', kind: 'case', outcome: 'completed' });
  });

  it('generates an RFC 4122 UUID when randomUUID is unavailable', () => {
    const generated = runtimeUuid({
      getRandomValues(bytes) {
        new Uint8Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).fill(0xab);
        return bytes;
      },
    });
    expect(generated).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('rejects duplicate active Vanta objects', () => {
    const created = createCase(leadState(), validCase, 'lead', idSequence(), fixedNow);
    expect(() => createCase(created, validCase, 'lead')).toThrow('already references');
  });

  it('enforces valid state transitions and lead-only verification', () => {
    const ids = idSequence();
    let state = createCase(leadState(), validCase, 'lead', ids, fixedNow);
    const caseId = state.cases[0]!.id;
    expect(() => transitionCase(state, caseId, 'in-progress', 'lead')).toThrow('Cannot move');
    state = transitionCase(state, caseId, 'planning', 'operator', ids, fixedNow);
    state = transitionCase(state, caseId, 'in-progress', 'operator', ids, fixedNow);
    state = transitionCase(state, caseId, 'awaiting-verification', 'operator', ids, fixedNow);
    expect(() => transitionCase(state, caseId, 'verified', 'operator')).toThrow('Only a compliance lead');
    expect(transitionCase(state, caseId, 'verified', 'lead', ids, fixedNow).cases[0]!.status).toBe('verified');
  });

  it('retains only real specialist output', () => {
    expect(() => addAnalysis(leadState(), { kind: 'readiness', title: 'Briefing', content: ' ', modelUsed: null, sourceChannelId: 'room-1' }, 'lead')).toThrow('no readable analysis');
    const state = addAnalysis(leadState(), { kind: 'readiness', title: 'Briefing', content: 'Observed facts from Vanta.', modelUsed: 'model', sourceChannelId: 'room-1' }, 'lead', idSequence(), fixedNow);
    expect(state.analyses[0]!.content).toBe('Observed facts from Vanta.');
  });

  it('protects confirmed operation receipts from replay', () => {
    const input = { kind: 'workflow' as const, sourceId: 'run-1', summary: 'Started workflow', actor: 'lead', idempotencyKey: 'workflow:run-1' };
    const once = recordIdempotentReceipt(emptyState(), input, idSequence(), fixedNow);
    expect(recordIdempotentReceipt(once, input)).toBe(once);
  });

  it('loads the current shape and migrates version 2 without inventing records', () => {
    expect(parseState(emptyState())).not.toBeNull();
    expect(parseState({ ...emptyState(), schemaVersion: 1 })).toBeNull();
    expect(parseState({ schemaVersion: 2, settings: null })).toBeNull();
    const migrated = parseState({
      schemaVersion: 2,
      settings: { ...leadState().settings, schemaVersion: 2 },
      cases: [],
      analyses: [],
      receipts: [],
      processedKeys: [],
    });
    expect(migrated).toMatchObject({ schemaVersion: 3, webhookEvents: [] });
    expect(migrated?.settings?.webhookApiUrl).toBeNull();
  });

  it('guards webhook configuration by role and resets an replaced feed', () => {
    expect(() => configureWebhookApi(leadState(), 'https://api.example.com', 'viewer')).toThrow('cannot configure');
    const configured = configureWebhookApi(leadState(), 'https://api.example.com', 'lead', idSequence(), fixedNow);
    expect(configured.settings?.webhookApiUrl).toBe('https://api.example.com');
    expect(configured.receipts[0]).toMatchObject({ kind: 'webhook-config' });
  });

  it('merges verified webhook metadata once and advances the cursor', () => {
    const ids = idSequence();
    const configured = configureWebhookApi(leadState(), 'https://api.example.com', 'lead', ids, fixedNow);
    const input = {
      events: [{ id: 'msg-1', eventType: 'control.updated', occurredAt: null, receivedAt: fixedNow() }],
      cursor: 'cursor-1',
    };
    const once = mergeWebhookEvents(configured, input, 'lead', ids, fixedNow);
    const replay = mergeWebhookEvents(once, input, 'lead', ids, fixedNow);
    expect(once.webhookEvents).toHaveLength(1);
    expect(replay.webhookEvents).toHaveLength(1);
    expect(replay.settings?.webhookCursor).toBe('cursor-1');
    expect(replay.receipts.filter(item => item.kind === 'webhook-sync')).toHaveLength(1);
  });
});
