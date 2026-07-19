import { describe, expect, it } from '@rstest/core';
import {
  applyResearchRefresh,
  addItem,
  addLot,
  addOutcome,
  addScheduleVersion,
  addSavedView,
  addSpecialistRun,
  connectSpecialist,
  createLedger,
  deleteEntity,
  estimateRunOutDate,
  isLedgerState,
  LedgerConflictError,
  LedgerPermissionError,
  LedgerValidationError,
  migrateLedger,
  parseLedger,
  recordAdministration,
  replaceLedger,
  serializeLedger,
  updateItemStatus,
  updateOrderStatus,
  withRole,
} from './domain';
const itemInput = () => ({
  name: 'Runtime item',
  canonicalName: '',
  category: 'supplement' as const,
  status: 'active' as const,
  jurisdiction: 'US',
  regulatoryStatus: 'entered by user',
  form: 'capsule',
  route: 'oral',
  concentration: '',
  purpose: 'user entered',
  clinician: '',
  sourceRecord: 'label',
  startedOn: '2026-01-01',
  notes: '',
  clinicianQuestions: '',
  cadence: 'once daily',
  dose: 1,
  unit: 'capsule',
  instructionSource: 'manufacturer',
});
describe('ledger domain', () => {
  it('starts empty', () => {
    const state = createLedger('Runtime ledger', 'US');
    expect(state.items).toHaveLength(0);
    expect(state.administrations).toHaveLength(0);
    expect(state.lots).toHaveLength(0);
  });
  it('validates entity creation', () => {
    expect(() => createLedger('', 'US')).toThrow(LedgerValidationError);
    expect(() =>
      addItem(createLedger('Runtime', 'US'), { ...itemInput(), dose: 0 }),
    ).toThrow('greater than zero');
  });
  it('validates and persists a self-reported check-in score', () => {
    const input = {
      kind: 'energy' as const,
      name: 'Runtime energy',
      value: 7,
      unit: 'score/10',
      occurredAt: '2026-01-02T08:00',
      referenceRange: '',
      source: 'self-reported check-in',
      notes: 'Runtime note',
    };
    const state = addOutcome(createLedger('Runtime', 'US'), input);
    expect(state.outcomes[0]?.value).toBe(7);
    expect(parseLedger(serializeLedger(state)).outcomes).toHaveLength(1);
    expect(() =>
      addOutcome(createLedger('Runtime', 'US'), { ...input, value: 11 }),
    ).toThrow('score from 0 to 10');
  });
  it('creates stable ids and versioned records', () => {
    const state = addItem(createLedger('Runtime', 'US'), itemInput());
    expect(state.items[0]?.id).toBeTruthy();
    expect(state.items[0]?.schedules[0]?.id).toBeTruthy();
    expect(state.audit).toHaveLength(1);
  });
  it('preserves schedule history and tracks regimen state transitions', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    const itemId = state.items[0]!.id;
    state = addScheduleVersion(state, itemId, {
      effectiveFrom: '2026-02-01',
      cadence: 'updated schedule',
      dose: 2,
      unit: 'capsule',
      source: 'manufacturer',
    });
    expect(state.items[0]?.schedules).toHaveLength(2);
    expect(state.items[0]?.schedules[0]?.effectiveTo).toBe('2026-02-01');
    state = updateItemStatus(state, itemId, 'paused');
    expect(state.items[0]?.status).toBe('paused');
    expect(state.items[0]?.statusHistory).toHaveLength(2);
    expect(state.items[0]?.statusHistory[0]?.effectiveTo).toBeTruthy();
    expect(state.audit.at(-1)?.action).toBe('status:paused');
  });
  it('serializes and reloads schema-valid state', () => {
    const state = addItem(createLedger('Runtime', 'US'), itemInput());
    const loaded = parseLedger(serializeLedger(state));
    expect(isLedgerState(loaded)).toBe(true);
    expect(loaded.items[0]?.name).toBe('Runtime item');
    expect(() => parseLedger('{}')).toThrow(LedgerValidationError);
    const corrupted = JSON.parse(serializeLedger(state));
    corrupted.items[0].schedules[0].dose = 'not-a-number';
    expect(() => parseLedger(JSON.stringify(corrupted))).toThrow(
      LedgerValidationError,
    );
  });
  it('requires an explicit evidence selection for saved research views', () => {
    expect(() =>
      addSavedView(createLedger('Runtime', 'US'), {
        name: 'Runtime scope',
        scope: 'approved-only',
        evidenceTypes: [],
      }),
    ).toThrow('Choose at least one evidence type');
  });
  it('migrates a persisted schema-v1 ledger without inventing domain data', () => {
    const current = addItem(createLedger('Runtime', 'US'), itemInput());
    const legacy: Record<string, unknown> = {
      ...current,
      items: current.items.map(({ statusHistory: _history, ...item }) => item),
      schemaVersion: 1,
    };
    delete legacy.specialistBinding;
    delete legacy.specialistRuns;
    const migrated = migrateLedger(legacy);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.specialistBinding).toBeNull();
    expect(migrated.specialistRuns).toHaveLength(0);
    expect(migrated.researchWatches).toHaveLength(0);
    expect(migrated.researchRecords).toHaveLength(0);
    expect(migrated.ownerLabel).toBe('Runtime');
    expect(migrated.items[0]?.statusHistory).toHaveLength(1);
  });
  it('migrates schema-v3 ledgers to empty research collections', () => {
    const legacy = {
      ...createLedger('Runtime', 'US'),
      schemaVersion: 3,
    } as unknown as Record<string, unknown>;
    delete legacy.researchWatches;
    delete legacy.researchRecords;
    const migrated = migrateLedger(legacy);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.researchWatches).toEqual([]);
    expect(migrated.researchRecords).toEqual([]);
  });
  it('deduplicates official-source records and advances review receipts', () => {
    let state = addSavedView(
      addItem(createLedger('Runtime', 'US'), itemInput()),
      {
        name: 'Runtime scope',
        scope: 'approved-only',
        evidenceTypes: ['human-clinical'],
      },
    );
    const itemId = state.items[0]!.id;
    const viewId = state.savedViews[0]!.id;
    const refresh = (title: string, refreshedAt: string) =>
      applyResearchRefresh(state, {
        itemId,
        viewId,
        query: 'Runtime item',
        refreshedAt,
        records: [
          {
            source: 'pubmed',
            sourceRecordId: '12345',
            evidenceType: 'literature',
            title,
            summary: 'Runtime summary',
            url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
            publishedAt: '2026',
          },
        ],
        sources: [
          {
            source: 'pubmed',
            cursor: '12345',
            success: true,
            recordCount: 1,
            error: '',
          },
        ],
      });
    state = refresh('First title', '2026-07-18T12:00:00Z');
    const recordId = state.researchRecords[0]!.id;
    state = applyResearchRefresh(state, {
      itemId,
      viewId,
      query: 'Runtime item',
      refreshedAt: '2026-07-19T12:00:00Z',
      records: [
        {
          source: 'pubmed',
          sourceRecordId: '12345',
          evidenceType: 'literature',
          title: 'Updated title',
          summary: 'Updated summary',
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
          publishedAt: '2026',
        },
      ],
      sources: [
        {
          source: 'pubmed',
          cursor: '12345',
          success: true,
          recordCount: 1,
          error: '',
        },
      ],
    });
    expect(state.researchRecords).toHaveLength(1);
    expect(state.researchRecords[0]).toMatchObject({
      id: recordId,
      title: 'Updated title',
    });
    expect(state.researchWatches).toHaveLength(1);
    expect(state.researchWatches[0]?.updatedAt).toBe(
      '2026-07-19T12:00:00Z',
    );
  });
  it('replaces a validated archive without adopting its embedded role', () => {
    const current = createLedger('Current', 'US');
    const imported = withRole(
      addItem(createLedger('Imported', 'US'), itemInput()),
      'viewer',
    );
    const next = replaceLedger(current, imported);
    expect(next.ownerLabel).toBe('Imported');
    expect(next.role).toBe('owner');
    expect(next.audit.at(-1)?.action).toBe('imported');
  });
  it('blocks writes and archive replacement for viewer role', () => {
    const state = withRole(createLedger('Runtime', 'US'), 'viewer');
    expect(() => addItem(state, itemInput())).toThrow(LedgerPermissionError);
    expect(() =>
      updateOrderStatus(state, crypto.randomUUID(), 'delivered'),
    ).toThrow(LedgerPermissionError);
    expect(() => replaceLedger(state, createLedger('Imported', 'US'))).toThrow(
      LedgerPermissionError,
    );
  });
  it('persists specialist bindings and host-reported execution receipts', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    state = connectSpecialist(state, {
      specialistId: crypto.randomUUID(),
      channelId: crypto.randomUUID(),
      connectedAt: new Date().toISOString(),
    });
    const runInput = {
      replayKey: crypto.randomUUID(),
      task: 'research-update',
      itemId: state.items[0]!.id,
      question: 'What changed?',
      content: 'Runtime tool-backed result',
      modelUsed: 'runtime-model',
      toolReceipts: [
        { toolName: 'web_search', success: true },
        { toolName: 'web_search', success: true },
      ],
      sourceChannelId: state.specialistBinding!.channelId,
    } as const;
    state = addSpecialistRun(state, runInput);
    expect(state.specialistRuns).toHaveLength(1);
    expect(state.specialistRuns[0]?.toolReceipts).toEqual([
      { toolName: 'web_search', success: true },
    ]);
    expect(parseLedger(serializeLedger(state)).specialistRuns).toHaveLength(1);
    expect(() => addSpecialistRun(state, runInput)).toThrow(
      LedgerConflictError,
    );
  });
  it('enforces specialist write permissions and channel provenance', () => {
    const owner = connectSpecialist(createLedger('Runtime', 'US'), {
      specialistId: crypto.randomUUID(),
      channelId: crypto.randomUUID(),
      connectedAt: new Date().toISOString(),
    });
    const result = {
      replayKey: crypto.randomUUID(),
      task: 'record-audit' as const,
      itemId: '',
      question: '',
      content: 'Runtime review',
      modelUsed: '',
      toolReceipts: [],
      sourceChannelId: crypto.randomUUID(),
    };
    expect(() => addSpecialistRun(owner, result)).toThrow('unexpected channel');
    expect(() =>
      connectSpecialist(withRole(owner, 'viewer'), owner.specialistBinding!),
    ).toThrow(LedgerPermissionError);
    expect(() =>
      addSpecialistRun(withRole(owner, 'viewer'), {
        ...result,
        sourceChannelId: owner.specialistBinding!.channelId,
      }),
    ).toThrow(LedgerPermissionError);
  });
  it('updates authoritative inventory from a confirmed observed event', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    const itemId = state.items[0]!.id;
    state = addLot(state, {
      itemId,
      quantityReceived: 10,
      unit: 'capsule',
      containerSize: '10',
      lotNumber: 'runtime-lot',
      expiresOn: '',
      provenance: 'user entry',
      orderReference: '',
      storageInstructions: '',
      openedOn: '',
      condition: '',
    });
    const lotId = state.lots[0]!.id;
    state = recordAdministration(state, {
      replayKey: 'runtime-key',
      itemId,
      lotId,
      plannedAt: '',
      actualAt: '2026-01-02T08:00',
      dose: 1,
      unit: 'capsule',
      route: 'oral',
      site: '',
      status: 'taken',
      reason: '',
      reaction: '',
      instructionSource: 'manufacturer',
    });
    expect(state.lots[0]?.currentQuantity).toBe(9);
    expect(state.administrations).toHaveLength(1);
  });
  it('rejects duplicate replay keys and impossible arithmetic', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    const itemId = state.items[0]!.id;
    state = addLot(state, {
      itemId,
      quantityReceived: 1,
      unit: 'capsule',
      containerSize: '1',
      lotNumber: 'runtime',
      expiresOn: '',
      provenance: '',
      orderReference: '',
      storageInstructions: '',
      openedOn: '',
      condition: '',
    });
    const input = {
      replayKey: 'same',
      itemId,
      lotId: state.lots[0]!.id,
      plannedAt: '',
      actualAt: '2026-01-02T08:00',
      dose: 1,
      unit: 'capsule',
      route: 'oral',
      site: '',
      status: 'taken' as const,
      reason: '',
      reaction: '',
      instructionSource: 'manufacturer',
    };
    const once = recordAdministration(state, input);
    expect(() => recordAdministration(once, input)).toThrow(
      LedgerConflictError,
    );
    expect(() =>
      recordAdministration(state, { ...input, replayKey: 'other', dose: 2 }),
    ).toThrow('inventory negative');
    expect(() =>
      recordAdministration(state, {
        ...input,
        replayKey: 'missing-lot',
        lotId: crypto.randomUUID(),
      }),
    ).toThrow('inventory lot from this ledger');
  });
  it('projects a run-out date only from repeated confirmed administrations', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    state = addLot(state, {
      itemId: state.items[0]!.id,
      quantityReceived: 10,
      unit: 'capsule',
      containerSize: '10',
      lotNumber: 'runtime',
      expiresOn: '',
      provenance: '',
      orderReference: '',
      storageInstructions: '',
      openedOn: '',
      condition: '',
    });
    const lotId = state.lots[0]!.id;
    expect(estimateRunOutDate(state, state.lots[0]!)).toBeNull();
    for (const [index, actualAt] of [
      '2026-01-01T08:00:00Z',
      '2026-01-02T08:00:00Z',
    ].entries()) {
      state = recordAdministration(state, {
        replayKey: `runtime-${index}`,
        itemId: state.items[0]!.id,
        lotId,
        plannedAt: '',
        actualAt,
        dose: 1,
        unit: 'capsule',
        route: 'oral',
        site: '',
        status: 'taken',
        reason: '',
        reaction: '',
        instructionSource: 'manufacturer',
      });
    }
    expect(
      estimateRunOutDate(
        state,
        state.lots[0]!,
        new Date('2026-01-02T08:00:00Z'),
      ),
    ).toBe('2026-01-10');
  });
  it('deletes an administration only after confirmation-layer intent and restores its inventory arithmetic', () => {
    let state = addItem(createLedger('Runtime', 'US'), itemInput());
    state = addLot(state, {
      itemId: state.items[0]!.id,
      quantityReceived: 5,
      unit: 'capsule',
      containerSize: '5',
      lotNumber: 'runtime',
      expiresOn: '',
      provenance: '',
      orderReference: '',
      storageInstructions: '',
      openedOn: '',
      condition: '',
    });
    state = recordAdministration(state, {
      replayKey: crypto.randomUUID(),
      itemId: state.items[0]!.id,
      lotId: state.lots[0]!.id,
      plannedAt: '',
      actualAt: '2026-01-02T08:00:00Z',
      dose: 1,
      unit: 'capsule',
      route: 'oral',
      site: '',
      status: 'taken',
      reason: '',
      reaction: '',
      instructionSource: 'manufacturer',
    });
    state = deleteEntity(state, 'administration', state.administrations[0]!.id);
    expect(state.administrations).toHaveLength(0);
    expect(state.lots[0]?.currentQuantity).toBe(5);
    expect(state.audit.at(-1)?.action).toBe('deleted');
  });
  it('rejects plan and inventory unit mismatches', () => {
    const state = addItem(createLedger('Runtime', 'US'), itemInput());
    expect(() =>
      recordAdministration(state, {
        replayKey: 'runtime',
        itemId: state.items[0]!.id,
        lotId: '',
        plannedAt: '',
        actualAt: '2026-01-02T08:00',
        dose: 1,
        unit: 'mg',
        route: 'oral',
        site: '',
        status: 'taken',
        reason: '',
        reaction: '',
        instructionSource: 'manufacturer',
      }),
    ).toThrow('Unit mismatch');
  });
});
