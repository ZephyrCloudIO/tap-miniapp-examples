import { describe, expect, it } from '@rstest/core';
import {
  addItem,
  addLot,
  createLedger,
  LedgerConflictError,
  LedgerValidationError,
  recordAdministration,
} from './domain';
import { importAdministrationsCsv, serializeAdministrationsCsv } from './csv';

const createInventory = () => {
  let state = addItem(createLedger('Runtime ledger', 'US'), {
    name: 'Runtime item',
    canonicalName: 'Runtime canonical item',
    category: 'supplement',
    status: 'active',
    jurisdiction: 'US',
    regulatoryStatus: 'User entered',
    form: 'capsule',
    route: 'oral',
    concentration: '',
    purpose: '',
    clinician: '',
    sourceRecord: 'Runtime label',
    startedOn: '2026-01-01',
    notes: '',
    clinicianQuestions: '',
    cadence: 'Runtime schedule',
    dose: 1,
    unit: 'capsule',
    instructionSource: 'Runtime label',
  });
  state = addLot(state, {
    itemId: state.items[0]!.id,
    quantityReceived: 10,
    unit: 'capsule',
    containerSize: '10',
    lotNumber: 'runtime-lot',
    expiresOn: '',
    provenance: 'Runtime entry',
    orderReference: '',
    storageInstructions: '',
    openedOn: '',
    condition: '',
  });
  return state;
};

describe('administration CSV', () => {
  it('round-trips user-created rows and updates authoritative inventory', () => {
    let source = createInventory();
    source = recordAdministration(source, {
      replayKey: crypto.randomUUID(),
      itemId: source.items[0]!.id,
      lotId: source.lots[0]!.id,
      plannedAt: '2026-01-02T08:00',
      actualAt: '2026-01-02T08:05',
      dose: 1,
      unit: 'capsule',
      route: 'oral',
      site: '',
      status: 'taken',
      reason: '',
      reaction: '',
      instructionSource: 'Runtime label',
    });
    const imported = importAdministrationsCsv(
      createInventory(),
      serializeAdministrationsCsv(source),
    );
    expect(imported.administrations).toHaveLength(1);
    expect(imported.lots[0]?.currentQuantity).toBe(9);
    expect(imported.administrations[0]?.actualAt).toBe('2026-01-02T08:05');
  });

  it('rejects replayed rows and malformed headers', () => {
    let state = createInventory();
    state = recordAdministration(state, {
      replayKey: 'runtime-replay',
      itemId: state.items[0]!.id,
      lotId: '',
      plannedAt: '',
      actualAt: '2026-01-02T08:05',
      dose: 1,
      unit: 'capsule',
      route: 'oral',
      site: '',
      status: 'taken',
      reason: '',
      reaction: '',
      instructionSource: 'Runtime label',
    });
    expect(() =>
      importAdministrationsCsv(state, serializeAdministrationsCsv(state)),
    ).toThrow(LedgerConflictError);
    expect(() => importAdministrationsCsv(state, 'wrong,header\n1,2')).toThrow(
      LedgerValidationError,
    );
  });
});
