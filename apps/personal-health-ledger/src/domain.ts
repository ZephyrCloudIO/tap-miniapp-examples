export type LedgerRole = 'owner' | 'viewer';
export type ItemStatus = 'active' | 'paused' | 'planned' | 'discontinued';
export type Category =
  | 'vitamin'
  | 'supplement'
  | 'approved-medication'
  | 'compounded-medication'
  | 'peptide'
  | 'other';
export type AdministrationStatus =
  | 'taken'
  | 'skipped'
  | 'delayed'
  | 'partial'
  | 'uncertain';
export type OrderStatus =
  | 'ordered'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'partially-received'
  | 'cancelled'
  | 'returned'
  | 'disputed';

export interface ScheduleVersion {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly cadence: string;
  readonly dose: number;
  readonly unit: string;
  readonly source: string;
}
export interface ItemStatusPeriod {
  readonly id: string;
  readonly status: ItemStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly source: string;
}
export interface RegimenItem {
  readonly id: string;
  readonly name: string;
  readonly canonicalName: string;
  readonly category: Category;
  readonly status: ItemStatus;
  readonly jurisdiction: string;
  readonly regulatoryStatus: string;
  readonly form: string;
  readonly route: string;
  readonly concentration: string;
  readonly purpose: string;
  readonly clinician: string;
  readonly sourceRecord: string;
  readonly startedOn: string;
  readonly notes: string;
  readonly clinicianQuestions: string;
  readonly schedules: readonly ScheduleVersion[];
  readonly statusHistory: readonly ItemStatusPeriod[];
}
export interface InventoryLot {
  readonly id: string;
  readonly itemId: string;
  readonly quantityReceived: number;
  readonly currentQuantity: number;
  readonly unit: string;
  readonly containerSize: string;
  readonly lotNumber: string;
  readonly expiresOn: string;
  readonly provenance: string;
  readonly orderReference: string;
  readonly storageInstructions: string;
  readonly openedOn: string;
  readonly condition: string;
}
export interface Administration {
  readonly id: string;
  readonly replayKey: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly plannedAt: string;
  readonly actualAt: string;
  readonly dose: number;
  readonly unit: string;
  readonly route: string;
  readonly site: string;
  readonly status: AdministrationStatus;
  readonly reason: string;
  readonly reaction: string;
  readonly instructionSource: string;
  readonly createdAt: string;
}
export interface Order {
  readonly id: string;
  readonly itemId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly orderedOn: string;
  readonly expectedOn: string;
  readonly receivedOn: string;
  readonly quantity: number;
  readonly unit: string;
  readonly provenance: string;
  readonly notes: string;
}
export interface Reconstitution {
  readonly id: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly occurredAt: string;
  readonly labeledAmount: number;
  readonly labeledUnit: string;
  readonly diluent: string;
  readonly diluentLot: string;
  readonly diluentVolumeMl: number;
  readonly resultingConcentration: number;
  readonly performedBy: string;
  readonly instructionSource: string;
  readonly storageRequirements: string;
  readonly discardOn: string;
  readonly inspectionNotes: string;
}
export type OutcomeKind =
  | 'symptom'
  | 'side-effect'
  | 'mood'
  | 'energy'
  | 'sleep'
  | 'appetite'
  | 'pain'
  | 'recovery'
  | 'weight'
  | 'blood-pressure'
  | 'heart-rate'
  | 'lab'
  | 'other';
export interface Outcome {
  readonly id: string;
  readonly kind: OutcomeKind;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly occurredAt: string;
  readonly referenceRange: string;
  readonly source: string;
  readonly notes: string;
}
export interface Confounder {
  readonly id: string;
  readonly kind: 'training' | 'diet' | 'illness' | 'travel' | 'sleep' | 'other';
  readonly occurredAt: string;
  readonly note: string;
}
export interface AdverseEvent {
  readonly id: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly severity: 'mild' | 'moderate' | 'serious';
  readonly occurredAt: string;
  readonly description: string;
  readonly actionTaken: string;
}
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly scope: 'approved-only' | 'include-unapproved';
  readonly evidenceTypes: readonly string[];
}
export type ResearchSource = 'pubmed' | 'clinical-trials' | 'openfda';
export type ResearchEvidenceType =
  | 'literature'
  | 'registered-trial'
  | 'regulatory';
export interface ResearchRecord {
  readonly id: string;
  readonly watchId: string;
  readonly itemId: string;
  readonly source: ResearchSource;
  readonly sourceRecordId: string;
  readonly evidenceType: ResearchEvidenceType;
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly fetchedAt: string;
}
export interface ResearchSourceCursor {
  readonly source: ResearchSource;
  readonly cursor: string;
  readonly success: boolean;
  readonly recordCount: number;
  readonly error: string;
  readonly reviewedAt: string;
}
export interface ResearchWatch {
  readonly id: string;
  readonly itemId: string;
  readonly viewId: string;
  readonly query: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sources: readonly ResearchSourceCursor[];
}
export type ResearchRecordInput = Omit<
  ResearchRecord,
  'id' | 'watchId' | 'itemId' | 'fetchedAt'
>;
export type ResearchSourceCursorInput = Omit<
  ResearchSourceCursor,
  'reviewedAt'
>;
export type SpecialistTask =
  | 'research-update'
  | 'anecdotal-pulse'
  | 'log-administration'
  | 'record-audit'
  | 'results-review'
  | 'appointment-summary';
export interface SpecialistBinding {
  readonly channelId: string;
  readonly specialistId: string;
  readonly connectedAt: string;
}
export interface SpecialistToolReceipt {
  readonly toolName: string;
  readonly success: boolean;
}
export interface SpecialistRun {
  readonly id: string;
  readonly replayKey: string;
  readonly task: SpecialistTask;
  readonly itemId: string;
  readonly question: string;
  readonly content: string;
  readonly modelUsed: string;
  readonly toolReceipts: readonly SpecialistToolReceipt[];
  readonly sourceChannelId: string;
  readonly createdAt: string;
}
export interface AuditEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
}
export interface LedgerState {
  readonly schemaVersion: 4;
  readonly ownerLabel: string;
  readonly jurisdiction: string;
  readonly role: LedgerRole;
  readonly items: readonly RegimenItem[];
  readonly lots: readonly InventoryLot[];
  readonly administrations: readonly Administration[];
  readonly orders: readonly Order[];
  readonly reconstitutions: readonly Reconstitution[];
  readonly outcomes: readonly Outcome[];
  readonly confounders: readonly Confounder[];
  readonly adverseEvents: readonly AdverseEvent[];
  readonly savedViews: readonly SavedView[];
  readonly researchWatches: readonly ResearchWatch[];
  readonly researchRecords: readonly ResearchRecord[];
  readonly specialistBinding: SpecialistBinding | null;
  readonly specialistRuns: readonly SpecialistRun[];
  readonly audit: readonly AuditEntry[];
}

export class LedgerValidationError extends Error {}
export class LedgerPermissionError extends Error {}
export class LedgerConflictError extends Error {}
const clean = (value: string): string => value.trim();
const required = (value: string, label: string): string => {
  const result = clean(value);
  if (!result) throw new LedgerValidationError(`${label} is required.`);
  return result;
};
const positive = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0)
    throw new LedgerValidationError(`${label} must be greater than zero.`);
  return value;
};
const id = (): string => globalThis.crypto.randomUUID();
const timestamp = (): string => new Date().toISOString();
const guard = (state: LedgerState): void => {
  if (state.role !== 'owner')
    throw new LedgerPermissionError('Viewer access is read-only.');
};
const audit = (
  state: LedgerState,
  action: string,
  entityType: string,
  entityId: string,
): readonly AuditEntry[] => [
  ...state.audit,
  { id: id(), occurredAt: timestamp(), action, entityType, entityId },
];

export const createLedger = (
  ownerLabel: string,
  jurisdiction: string,
): LedgerState => ({
  schemaVersion: 4,
  ownerLabel: required(ownerLabel, 'Ledger name'),
  jurisdiction: required(jurisdiction, 'Jurisdiction'),
  role: 'owner',
  items: [],
  lots: [],
  administrations: [],
  orders: [],
  reconstitutions: [],
  outcomes: [],
  confounders: [],
  adverseEvents: [],
  savedViews: [],
  researchWatches: [],
  researchRecords: [],
  specialistBinding: null,
  specialistRuns: [],
  audit: [],
});
export const withRole = (
  state: LedgerState,
  role: LedgerRole,
): LedgerState => ({ ...state, role });
export type ItemInput = Omit<
  RegimenItem,
  'id' | 'schedules' | 'statusHistory'
> & {
  readonly cadence: string;
  readonly dose: number;
  readonly unit: string;
  readonly instructionSource: string;
};
export const addItem = (state: LedgerState, input: ItemInput): LedgerState => {
  guard(state);
  const itemId = id();
  const item: RegimenItem = {
    ...input,
    id: itemId,
    name: required(input.name, 'Name'),
    canonicalName: clean(input.canonicalName) || clean(input.name),
    route: required(input.route, 'Route'),
    statusHistory: [
      {
        id: id(),
        status: input.status,
        effectiveFrom: required(input.startedOn, 'Start date'),
        effectiveTo: '',
        source: 'user entry',
      },
    ],
    schedules: [
      {
        id: id(),
        effectiveFrom: required(input.startedOn, 'Effective date'),
        effectiveTo: '',
        cadence: required(input.cadence, 'Schedule'),
        dose: positive(input.dose, 'Dose'),
        unit: required(input.unit, 'Dose unit'),
        source: required(input.instructionSource, 'Instruction source'),
      },
    ],
  };
  return {
    ...state,
    items: [...state.items, item],
    audit: audit(state, 'created', 'item', itemId),
  };
};
export const addScheduleVersion = (
  state: LedgerState,
  itemId: string,
  input: Omit<ScheduleVersion, 'id' | 'effectiveTo'>,
): LedgerState => {
  guard(state);
  const item = state.items.find(candidate => candidate.id === itemId);
  if (!item) throw new LedgerValidationError('Item was not found.');
  const effectiveFrom = required(input.effectiveFrom, 'Effective date');
  const schedules = item.schedules.map((schedule, index) =>
    index === item.schedules.length - 1 && !schedule.effectiveTo
      ? { ...schedule, effectiveTo: effectiveFrom }
      : schedule,
  );
  const next = {
    ...input,
    id: id(),
    effectiveFrom,
    effectiveTo: '',
    dose: positive(input.dose, 'Dose'),
    unit: required(input.unit, 'Dose unit'),
    cadence: required(input.cadence, 'Schedule'),
    source: required(input.source, 'Instruction source'),
  };
  return {
    ...state,
    items: state.items.map(candidate =>
      candidate.id === itemId
        ? { ...candidate, schedules: [...schedules, next] }
        : candidate,
    ),
    audit: audit(state, 'schedule-version-created', 'item', itemId),
  };
};
export const updateItemStatus = (
  state: LedgerState,
  itemId: string,
  status: ItemStatus,
): LedgerState => {
  guard(state);
  if (!state.items.some(item => item.id === itemId))
    throw new LedgerValidationError('Item was not found.');
  const effectiveFrom = timestamp().slice(0, 10);
  return {
    ...state,
    items: state.items.map(item =>
      item.id === itemId
        ? {
            ...item,
            status,
            statusHistory: [
              ...item.statusHistory.map((period, index) =>
                index === item.statusHistory.length - 1 && !period.effectiveTo
                  ? { ...period, effectiveTo: effectiveFrom }
                  : period,
              ),
              {
                id: id(),
                status,
                effectiveFrom,
                effectiveTo: '',
                source: 'user status update',
              },
            ],
          }
        : item,
    ),
    audit: audit(state, `status:${status}`, 'item', itemId),
  };
};
export type LotInput = Omit<InventoryLot, 'id' | 'currentQuantity'>;
export const addLot = (state: LedgerState, input: LotInput): LedgerState => {
  guard(state);
  if (!state.items.some(item => item.id === input.itemId))
    throw new LedgerValidationError('Choose a tracked item.');
  const lotId = id();
  const lot = {
    ...input,
    id: lotId,
    quantityReceived: positive(input.quantityReceived, 'Quantity'),
    currentQuantity: input.quantityReceived,
    unit: required(input.unit, 'Inventory unit'),
  };
  return {
    ...state,
    lots: [...state.lots, lot],
    audit: audit(state, 'created', 'lot', lotId),
  };
};
export type AdministrationInput = Omit<Administration, 'id' | 'createdAt'>;
export const recordAdministration = (
  state: LedgerState,
  input: AdministrationInput,
): LedgerState => {
  guard(state);
  if (state.administrations.some(entry => entry.replayKey === input.replayKey))
    throw new LedgerConflictError('This administration was already recorded.');
  const item = state.items.find(candidate => candidate.id === input.itemId);
  if (!item) throw new LedgerValidationError('Choose a tracked item.');
  const dose = positive(input.dose, 'Dose');
  const activeSchedule = item.schedules.at(-1);
  if (activeSchedule && activeSchedule.unit !== input.unit)
    throw new LedgerValidationError(
      `Unit mismatch: the active plan uses ${activeSchedule.unit}. Record or update the authoritative schedule first.`,
    );
  const lot = input.lotId
    ? state.lots.find(candidate => candidate.id === input.lotId)
    : undefined;
  if (input.lotId && !lot)
    throw new LedgerValidationError('Choose an inventory lot from this ledger.');
  if (lot && lot.itemId !== item.id)
    throw new LedgerValidationError(
      'The selected inventory lot belongs to a different tracked item.',
    );
  const consumes =
    input.status === 'taken' ||
    input.status === 'delayed' ||
    input.status === 'partial' ||
    input.status === 'uncertain';
  if (lot && consumes && lot.unit !== input.unit)
    throw new LedgerValidationError(
      `Inventory unit mismatch: this lot is tracked in ${lot.unit}.`,
    );
  if (lot && consumes && lot.currentQuantity < dose)
    throw new LedgerValidationError(
      'This entry would make inventory negative. Reconcile the lot quantity first.',
    );
  const entryId = id();
  const entry = {
    ...input,
    id: entryId,
    actualAt: required(input.actualAt, 'Actual date and time'),
    dose,
    route: required(input.route, 'Route'),
    instructionSource: required(input.instructionSource, 'Instruction source'),
    createdAt: timestamp(),
  };
  return {
    ...state,
    administrations: [...state.administrations, entry],
    lots:
      lot && consumes
        ? state.lots.map(candidate =>
            candidate.id === lot.id
              ? {
                  ...candidate,
                  currentQuantity: candidate.currentQuantity - dose,
                }
              : candidate,
          )
        : state.lots,
    audit: audit(state, 'recorded', 'administration', entryId),
  };
};
export const addOrder = (
  state: LedgerState,
  input: Omit<Order, 'id'>,
): LedgerState => {
  guard(state);
  const entityId = id();
  return {
    ...state,
    orders: [
      ...state.orders,
      {
        ...input,
        id: entityId,
        reference: required(input.reference, 'Order reference'),
        quantity: positive(input.quantity, 'Quantity'),
        unit: required(input.unit, 'Unit'),
      },
    ],
    audit: audit(state, 'created', 'order', entityId),
  };
};
export const updateOrderStatus = (
  state: LedgerState,
  orderId: string,
  status: OrderStatus,
): LedgerState => {
  guard(state);
  if (!state.orders.some(order => order.id === orderId))
    throw new LedgerValidationError('Order was not found.');
  return {
    ...state,
    orders: state.orders.map(order =>
      order.id === orderId
        ? {
            ...order,
            status,
            receivedOn:
              status === 'delivered'
                ? timestamp().slice(0, 10)
                : order.receivedOn,
          }
        : order,
    ),
    audit: audit(state, `status:${status}`, 'order', orderId),
  };
};
export const addReconstitution = (
  state: LedgerState,
  input: Omit<Reconstitution, 'id' | 'resultingConcentration'>,
): LedgerState => {
  guard(state);
  const amount = positive(input.labeledAmount, 'Labeled amount');
  const volume = positive(input.diluentVolumeMl, 'Diluent volume');
  if (
    !state.lots.some(
      lot => lot.id === input.lotId && lot.itemId === input.itemId,
    )
  )
    throw new LedgerValidationError('Choose a lot belonging to this item.');
  const entityId = id();
  return {
    ...state,
    reconstitutions: [
      ...state.reconstitutions,
      {
        ...input,
        id: entityId,
        labeledAmount: amount,
        diluentVolumeMl: volume,
        resultingConcentration: amount / volume,
        instructionSource: required(
          input.instructionSource,
          'Authoritative instruction source',
        ),
      },
    ],
    audit: audit(state, 'recorded', 'reconstitution', entityId),
  };
};
export const addOutcome = (
  state: LedgerState,
  input: Omit<Outcome, 'id'>,
): LedgerState => {
  guard(state);
  const entityId = id();
  if (!Number.isFinite(input.value))
    throw new LedgerValidationError('Value must be a number.');
  if (
    input.source === 'self-reported check-in' &&
    (input.unit !== 'score/10' || input.value < 0 || input.value > 10)
  )
    throw new LedgerValidationError(
      'A self-reported check-in must use a score from 0 to 10.',
    );
  return {
    ...state,
    outcomes: [
      ...state.outcomes,
      {
        ...input,
        id: entityId,
        name: required(input.name, 'Outcome name'),
        unit: required(input.unit, 'Unit'),
      },
    ],
    audit: audit(state, 'recorded', 'outcome', entityId),
  };
};
export const addConfounder = (
  state: LedgerState,
  input: Omit<Confounder, 'id'>,
): LedgerState => {
  guard(state);
  const entityId = id();
  return {
    ...state,
    confounders: [
      ...state.confounders,
      { ...input, id: entityId, note: required(input.note, 'Event note') },
    ],
    audit: audit(state, 'recorded', 'confounder', entityId),
  };
};
export const addAdverseEvent = (
  state: LedgerState,
  input: Omit<AdverseEvent, 'id'>,
): LedgerState => {
  guard(state);
  const entityId = id();
  return {
    ...state,
    adverseEvents: [
      ...state.adverseEvents,
      {
        ...input,
        id: entityId,
        description: required(input.description, 'Description'),
      },
    ],
    audit: audit(state, 'recorded', 'adverse-event', entityId),
  };
};
export const addSavedView = (
  state: LedgerState,
  input: Omit<SavedView, 'id'>,
): LedgerState => {
  guard(state);
  const entityId = id();
  const evidenceTypes = [
    ...new Set(input.evidenceTypes.map(clean).filter(Boolean)),
  ];
  if (!evidenceTypes.length)
    throw new LedgerValidationError('Choose at least one evidence type.');
  return {
    ...state,
    savedViews: [
      ...state.savedViews,
      {
        ...input,
        id: entityId,
        name: required(input.name, 'View name'),
        evidenceTypes,
      },
    ],
    audit: audit(state, 'created', 'saved-view', entityId),
  };
};
export const applyResearchRefresh = (
  state: LedgerState,
  input: {
    readonly itemId: string;
    readonly viewId: string;
    readonly query: string;
    readonly refreshedAt: string;
    readonly records: readonly ResearchRecordInput[];
    readonly sources: readonly ResearchSourceCursorInput[];
  },
): LedgerState => {
  guard(state);
  if (!state.items.some(item => item.id === input.itemId))
    throw new LedgerValidationError('Choose a tracked item to refresh.');
  if (!state.savedViews.some(view => view.id === input.viewId))
    throw new LedgerValidationError('Choose a saved research view to refresh.');
  const query = required(input.query, 'Research query').slice(0, 240);
  const refreshedAt = required(input.refreshedAt, 'Refresh time');
  const sourceNames = input.sources.map(source => source.source);
  if (
    !sourceNames.length ||
    sourceNames.length !== new Set(sourceNames).size ||
    input.sources.some(
      source =>
        !['pubmed', 'clinical-trials', 'openfda'].includes(source.source) ||
        !Number.isInteger(source.recordCount) ||
        source.recordCount < 0,
    )
  )
    throw new LedgerValidationError(
      'Research source receipts must be unique and well formed.',
    );
  const existingWatch = state.researchWatches.find(
    watch =>
      watch.itemId === input.itemId &&
      watch.viewId === input.viewId &&
      watch.query === query,
  );
  const watchId = existingWatch?.id ?? id();
  const watch: ResearchWatch = {
    id: watchId,
    itemId: input.itemId,
    viewId: input.viewId,
    query,
    createdAt: existingWatch?.createdAt ?? refreshedAt,
    updatedAt: refreshedAt,
    sources: input.sources.map(source => ({
      source: source.source,
      cursor: clean(source.cursor).slice(0, 500),
      success: source.success,
      recordCount: source.recordCount,
      error: clean(source.error).slice(0, 1000),
      reviewedAt: refreshedAt,
    })),
  };
  const recordsBySourceId = new Map(
    state.researchRecords.map(record => [
      `${record.itemId}:${record.source}:${record.sourceRecordId}`,
      record,
    ]),
  );
  for (const record of input.records) {
    if (
      !['pubmed', 'clinical-trials', 'openfda'].includes(record.source) ||
      !['literature', 'registered-trial', 'regulatory'].includes(
        record.evidenceType,
      )
    )
      throw new LedgerValidationError('Research record source is unsupported.');
    const sourceRecordId = required(
      record.sourceRecordId,
      'Source record ID',
    ).slice(0, 300);
    const title = required(record.title, 'Research record title').slice(0, 600);
    const url = required(record.url, 'Research record URL');
    if (!/^https:\/\//i.test(url))
      throw new LedgerValidationError('Research record URLs must use HTTPS.');
    const key = `${input.itemId}:${record.source}:${sourceRecordId}`;
    const existing = recordsBySourceId.get(key);
    recordsBySourceId.set(key, {
      id: existing?.id ?? id(),
      watchId,
      itemId: input.itemId,
      source: record.source,
      sourceRecordId,
      evidenceType: record.evidenceType,
      title,
      summary: clean(record.summary).slice(0, 4000),
      url: url.slice(0, 2000),
      publishedAt: clean(record.publishedAt).slice(0, 100),
      fetchedAt: refreshedAt,
    });
  }
  const researchWatches = [
    watch,
    ...state.researchWatches.filter(candidate => candidate.id !== watchId),
  ].slice(0, 50);
  const retainedWatchIds = new Set(
    researchWatches.map(candidate => candidate.id),
  );
  const researchRecords = [...recordsBySourceId.values()]
    .filter(record => retainedWatchIds.has(record.watchId))
    .toSorted((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))
    .slice(0, 300);
  return {
    ...state,
    researchWatches,
    researchRecords,
    audit: audit(state, 'refreshed', 'research-watch', watchId),
  };
};
export const connectSpecialist = (
  state: LedgerState,
  binding: SpecialistBinding,
): LedgerState => {
  guard(state);
  const specialistBinding = {
    specialistId: required(binding.specialistId, 'Specialist ID'),
    channelId: required(binding.channelId, 'Specialist channel ID'),
    connectedAt: required(binding.connectedAt, 'Connection time'),
  };
  return {
    ...state,
    specialistBinding,
    audit: audit(
      state,
      state.specialistBinding ? 'reconnected' : 'connected',
      'specialist',
      specialistBinding.specialistId,
    ),
  };
};
export const addSpecialistRun = (
  state: LedgerState,
  input: Omit<SpecialistRun, 'id' | 'createdAt'>,
): LedgerState => {
  guard(state);
  if (!state.specialistBinding)
    throw new LedgerValidationError('Connect the health specialist first.');
  if (
    state.specialistRuns.some(run => run.replayKey === clean(input.replayKey))
  )
    throw new LedgerConflictError('This specialist turn was already saved.');
  if (input.sourceChannelId !== state.specialistBinding.channelId)
    throw new LedgerValidationError(
      'The specialist response came from an unexpected channel.',
    );
  if (input.itemId && !state.items.some(item => item.id === input.itemId))
    throw new LedgerValidationError(
      'The referenced regimen item was not found.',
    );
  const entityId = id();
  const run: SpecialistRun = {
    ...input,
    id: entityId,
    replayKey: required(input.replayKey, 'Specialist replay key'),
    question: clean(input.question),
    content: required(input.content, 'Specialist response'),
    modelUsed: clean(input.modelUsed),
    toolReceipts: input.toolReceipts
      .map(receipt => ({
        toolName: clean(receipt.toolName),
        success: receipt.success,
      }))
      .filter(receipt => receipt.toolName)
      .filter(
        (receipt, index, receipts) =>
          receipts.findIndex(
            candidate =>
              candidate.toolName === receipt.toolName &&
              candidate.success === receipt.success,
          ) === index,
      ),
    sourceChannelId: required(input.sourceChannelId, 'Source channel'),
    createdAt: timestamp(),
  };
  return {
    ...state,
    specialistRuns: [run, ...state.specialistRuns].slice(0, 50),
    audit: audit(state, `completed:${input.task}`, 'specialist-run', entityId),
  };
};
export const deleteEntity = (
  state: LedgerState,
  type:
    | 'item'
    | 'lot'
    | 'administration'
    | 'order'
    | 'reconstitution'
    | 'outcome'
    | 'confounder'
    | 'adverse-event'
    | 'saved-view'
    | 'research-watch'
    | 'research-record'
    | 'specialist-run',
  entityId: string,
): LedgerState => {
  guard(state);
  if (
    type === 'item' &&
    (state.lots.some(x => x.itemId === entityId) ||
      state.administrations.some(x => x.itemId === entityId) ||
      state.orders.some(x => x.itemId === entityId) ||
      state.reconstitutions.some(x => x.itemId === entityId) ||
      state.adverseEvents.some(x => x.itemId === entityId) ||
      state.researchWatches.some(x => x.itemId === entityId) ||
      state.researchRecords.some(x => x.itemId === entityId))
  )
    throw new LedgerConflictError(
      'Items with linked history cannot be deleted; discontinue the item instead.',
    );
  if (
    type === 'lot' &&
    (state.administrations.some(x => x.lotId === entityId) ||
      state.reconstitutions.some(x => x.lotId === entityId) ||
      state.adverseEvents.some(x => x.lotId === entityId))
  )
    throw new LedgerConflictError(
      'Lots with linked history cannot be deleted. Remove the linked records first.',
    );
  if (
    type === 'saved-view' &&
    state.researchWatches.some(watch => watch.viewId === entityId)
  )
    throw new LedgerConflictError(
      'Research views with source-watch history cannot be deleted. Delete the linked watch records first.',
    );
  if (
    type === 'research-watch' &&
    state.researchRecords.some(record => record.watchId === entityId)
  )
    throw new LedgerConflictError(
      'Research watches with fetched records cannot be deleted. Delete the linked source records first.',
    );
  const administration =
    type === 'administration'
      ? state.administrations.find(entry => entry.id === entityId)
      : undefined;
  const restoresInventory =
    administration &&
    administration.lotId &&
    ['taken', 'delayed', 'partial', 'uncertain'].includes(
      administration.status,
    );
  const exists = {
    item: state.items.some(entry => entry.id === entityId),
    lot: state.lots.some(entry => entry.id === entityId),
    administration: Boolean(administration),
    order: state.orders.some(entry => entry.id === entityId),
    reconstitution: state.reconstitutions.some(entry => entry.id === entityId),
    outcome: state.outcomes.some(entry => entry.id === entityId),
    confounder: state.confounders.some(entry => entry.id === entityId),
    'adverse-event': state.adverseEvents.some(entry => entry.id === entityId),
    'saved-view': state.savedViews.some(entry => entry.id === entityId),
    'research-watch': state.researchWatches.some(
      entry => entry.id === entityId,
    ),
    'research-record': state.researchRecords.some(
      entry => entry.id === entityId,
    ),
    'specialist-run': state.specialistRuns.some(entry => entry.id === entityId),
  }[type];
  if (!exists) throw new LedgerValidationError('The record was not found.');
  return {
    ...state,
    items:
      type === 'item'
        ? state.items.filter(x => x.id !== entityId)
        : state.items,
    lots:
      type === 'lot'
        ? state.lots.filter(x => x.id !== entityId)
        : restoresInventory
          ? state.lots.map(lot =>
              lot.id === administration.lotId
                ? {
                    ...lot,
                    currentQuantity: lot.currentQuantity + administration.dose,
                  }
                : lot,
            )
          : state.lots,
    administrations:
      type === 'administration'
        ? state.administrations.filter(x => x.id !== entityId)
        : state.administrations,
    orders:
      type === 'order'
        ? state.orders.filter(x => x.id !== entityId)
        : state.orders,
    reconstitutions:
      type === 'reconstitution'
        ? state.reconstitutions.filter(x => x.id !== entityId)
        : state.reconstitutions,
    outcomes:
      type === 'outcome'
        ? state.outcomes.filter(x => x.id !== entityId)
        : state.outcomes,
    confounders:
      type === 'confounder'
        ? state.confounders.filter(x => x.id !== entityId)
        : state.confounders,
    adverseEvents:
      type === 'adverse-event'
        ? state.adverseEvents.filter(x => x.id !== entityId)
        : state.adverseEvents,
    savedViews:
      type === 'saved-view'
        ? state.savedViews.filter(x => x.id !== entityId)
        : state.savedViews,
    researchWatches:
      type === 'research-watch'
        ? state.researchWatches.filter(x => x.id !== entityId)
        : state.researchWatches,
    researchRecords:
      type === 'research-record'
        ? state.researchRecords.filter(x => x.id !== entityId)
        : state.researchRecords,
    specialistRuns:
      type === 'specialist-run'
        ? state.specialistRuns.filter(x => x.id !== entityId)
        : state.specialistRuns,
    audit: audit(state, 'deleted', type, entityId),
  };
};
export const estimateRunOut = (
  state: LedgerState,
  lot: InventoryLot,
): number | null => {
  const entries = state.administrations.filter(
    entry =>
      entry.lotId === lot.id &&
      ['taken', 'delayed', 'partial'].includes(entry.status),
  );
  if (!entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + entry.dose, 0);
  return total > 0
    ? Math.floor(lot.currentQuantity / (total / entries.length))
    : null;
};
export const estimateRunOutDate = (
  state: LedgerState,
  lot: InventoryLot,
  now: Date = new Date(),
): string | null => {
  const entries = state.administrations
    .filter(
      entry =>
        entry.lotId === lot.id &&
        ['taken', 'delayed', 'partial'].includes(entry.status),
    )
    .map(entry => ({ ...entry, at: new Date(entry.actualAt).getTime() }))
    .filter(entry => Number.isFinite(entry.at))
    .toSorted((left, right) => left.at - right.at);
  if (entries.length < 2 || lot.currentQuantity <= 0) return null;
  const elapsed = entries.at(-1)!.at - entries[0]!.at;
  if (elapsed <= 0) return null;
  const averageInterval = elapsed / (entries.length - 1);
  const averageDose =
    entries.reduce((sum, entry) => sum + entry.dose, 0) / entries.length;
  if (!Number.isFinite(averageDose) || averageDose <= 0) return null;
  const remainingEvents = lot.currentQuantity / averageDose;
  const projectionStart = Math.max(now.getTime(), entries.at(-1)!.at);
  return new Date(projectionStart + remainingEvents * averageInterval)
    .toISOString()
    .slice(0, 10);
};
export const serializeLedger = (state: LedgerState): string =>
  JSON.stringify(state);
export const parseLedger = (raw: string): LedgerState => {
  const value: unknown = JSON.parse(raw);
  return migrateLedger(value);
};
export const replaceLedger = (
  current: LedgerState,
  imported: LedgerState,
): LedgerState => {
  guard(current);
  if (!isLedgerState(imported))
    throw new LedgerValidationError(
      'The archive is not a supported Personal Health Ledger file.',
    );
  const next = { ...imported, role: current.role };
  return { ...next, audit: audit(next, 'imported', 'ledger', next.ownerLabel) };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasStrings = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => keys.every(key => typeof value[key] === 'string');
const hasNumbers = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  keys.every(
    key => typeof value[key] === 'number' && Number.isFinite(value[key]),
  );
const isArrayOf = (
  value: unknown,
  validator: (entry: unknown) => boolean,
): boolean => Array.isArray(value) && value.every(validator);
const itemStatuses = new Set<ItemStatus>([
  'active',
  'paused',
  'planned',
  'discontinued',
]);
const administrationStatuses = new Set<AdministrationStatus>([
  'taken',
  'skipped',
  'delayed',
  'partial',
  'uncertain',
]);
const orderStatuses = new Set<OrderStatus>([
  'ordered',
  'confirmed',
  'shipped',
  'delivered',
  'partially-received',
  'cancelled',
  'returned',
  'disputed',
]);
const outcomeKinds = new Set<OutcomeKind>([
  'symptom',
  'side-effect',
  'mood',
  'energy',
  'sleep',
  'appetite',
  'pain',
  'recovery',
  'weight',
  'blood-pressure',
  'heart-rate',
  'lab',
  'other',
]);
const specialistTasks = new Set<SpecialistTask>([
  'research-update',
  'anecdotal-pulse',
  'log-administration',
  'record-audit',
  'results-review',
  'appointment-summary',
]);
const researchEvidenceTypes = new Set([
  'human-clinical',
  'registered-trials',
  'animal',
  'mechanistic',
  'preprints',
  'regulatory',
  'expert-commentary',
  'web-x-forums',
]);
const researchSources = new Set<ResearchSource>([
  'pubmed',
  'clinical-trials',
  'openfda',
]);
const fetchedEvidenceTypes = new Set<ResearchEvidenceType>([
  'literature',
  'registered-trial',
  'regulatory',
]);
const validSchedule = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'effectiveFrom',
    'effectiveTo',
    'cadence',
    'unit',
    'source',
  ]) &&
  hasNumbers(value, ['dose']) &&
  (value.dose as number) > 0;
const validStatusPeriod = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'effectiveFrom', 'effectiveTo', 'source']) &&
  itemStatuses.has(value.status as ItemStatus);
const validItem = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'name',
    'canonicalName',
    'jurisdiction',
    'regulatoryStatus',
    'form',
    'route',
    'concentration',
    'purpose',
    'clinician',
    'sourceRecord',
    'startedOn',
    'notes',
    'clinicianQuestions',
  ]) &&
  [
    'vitamin',
    'supplement',
    'approved-medication',
    'compounded-medication',
    'peptide',
    'other',
  ].includes(String(value.category)) &&
  itemStatuses.has(value.status as ItemStatus) &&
  isArrayOf(value.schedules, validSchedule) &&
  (value.schedules as unknown[]).length > 0 &&
  isArrayOf(value.statusHistory, validStatusPeriod) &&
  (value.statusHistory as unknown[]).length > 0;
const validLot = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'itemId',
    'unit',
    'containerSize',
    'lotNumber',
    'expiresOn',
    'provenance',
    'orderReference',
    'storageInstructions',
    'openedOn',
    'condition',
  ]) &&
  hasNumbers(value, ['quantityReceived', 'currentQuantity']) &&
  (value.quantityReceived as number) > 0 &&
  (value.currentQuantity as number) >= 0;
const validAdministration = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'replayKey',
    'itemId',
    'lotId',
    'plannedAt',
    'actualAt',
    'unit',
    'route',
    'site',
    'reason',
    'reaction',
    'instructionSource',
    'createdAt',
  ]) &&
  hasNumbers(value, ['dose']) &&
  (value.dose as number) > 0 &&
  administrationStatuses.has(value.status as AdministrationStatus);
const validOrder = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'itemId',
    'reference',
    'orderedOn',
    'expectedOn',
    'receivedOn',
    'unit',
    'provenance',
    'notes',
  ]) &&
  hasNumbers(value, ['quantity']) &&
  (value.quantity as number) > 0 &&
  orderStatuses.has(value.status as OrderStatus);
const validReconstitution = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'itemId',
    'lotId',
    'occurredAt',
    'labeledUnit',
    'diluent',
    'diluentLot',
    'performedBy',
    'instructionSource',
    'storageRequirements',
    'discardOn',
    'inspectionNotes',
  ]) &&
  hasNumbers(value, [
    'labeledAmount',
    'diluentVolumeMl',
    'resultingConcentration',
  ]);
const validOutcome = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'kind',
    'name',
    'unit',
    'occurredAt',
    'referenceRange',
    'source',
    'notes',
  ]) &&
  outcomeKinds.has(value.kind as OutcomeKind) &&
  hasNumbers(value, ['value']) &&
  String(value.id).length > 0 &&
  String(value.name).trim().length > 0 &&
  String(value.unit).trim().length > 0 &&
  (value.source !== 'self-reported check-in' ||
    (value.unit === 'score/10' &&
      Number(value.value) >= 0 &&
      Number(value.value) <= 10));
const validConfounder = (value: unknown): boolean =>
  isRecord(value) && hasStrings(value, ['id', 'kind', 'occurredAt', 'note']);
const validAdverseEvent = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'itemId',
    'lotId',
    'severity',
    'occurredAt',
    'description',
    'actionTaken',
  ]) &&
  ['mild', 'moderate', 'serious'].includes(String(value.severity));
const validSavedView = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'name', 'scope']) &&
  ['approved-only', 'include-unapproved'].includes(String(value.scope)) &&
  isArrayOf(
    value.evidenceTypes,
    entry => typeof entry === 'string' && researchEvidenceTypes.has(entry),
  ) &&
  (value.evidenceTypes as unknown[]).length > 0;
const validResearchSourceCursor = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['source', 'cursor', 'error', 'reviewedAt']) &&
  researchSources.has(value.source as ResearchSource) &&
  typeof value.success === 'boolean' &&
  hasNumbers(value, ['recordCount']) &&
  Number.isInteger(Number(value.recordCount)) &&
  Number(value.recordCount) >= 0;
const validResearchWatch = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'itemId',
    'viewId',
    'query',
    'createdAt',
    'updatedAt',
  ]) &&
  String(value.query).trim().length > 0 &&
  isArrayOf(value.sources, validResearchSourceCursor) &&
  (value.sources as unknown[]).length > 0;
const validResearchRecord = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'watchId',
    'itemId',
    'source',
    'sourceRecordId',
    'evidenceType',
    'title',
    'summary',
    'url',
    'publishedAt',
    'fetchedAt',
  ]) &&
  researchSources.has(value.source as ResearchSource) &&
  fetchedEvidenceTypes.has(value.evidenceType as ResearchEvidenceType) &&
  String(value.sourceRecordId).trim().length > 0 &&
  String(value.title).trim().length > 0 &&
  /^https:\/\//i.test(String(value.url));
const validAudit = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'occurredAt', 'action', 'entityType', 'entityId']);
const validSpecialistBinding = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['channelId', 'specialistId', 'connectedAt']);
const validSpecialistRun = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, [
    'id',
    'replayKey',
    'itemId',
    'question',
    'content',
    'modelUsed',
    'sourceChannelId',
    'createdAt',
  ]) &&
  specialistTasks.has(value.task as SpecialistTask) &&
  isArrayOf(
    value.toolReceipts,
    receipt =>
      isRecord(receipt) &&
      typeof receipt.toolName === 'string' &&
      typeof receipt.success === 'boolean',
  );

export const isLedgerState = (value: unknown): value is LedgerState => {
  if (!isRecord(value)) return false;
  const shapesValid =
    value.schemaVersion === 4 &&
    hasStrings(value, ['ownerLabel', 'jurisdiction']) &&
    (value.role === 'owner' || value.role === 'viewer') &&
    isArrayOf(value.items, validItem) &&
    isArrayOf(value.lots, validLot) &&
    isArrayOf(value.administrations, validAdministration) &&
    isArrayOf(value.orders, validOrder) &&
    isArrayOf(value.reconstitutions, validReconstitution) &&
    isArrayOf(value.outcomes, validOutcome) &&
    isArrayOf(value.confounders, validConfounder) &&
    isArrayOf(value.adverseEvents, validAdverseEvent) &&
    isArrayOf(value.savedViews, validSavedView) &&
    isArrayOf(value.researchWatches, validResearchWatch) &&
    isArrayOf(value.researchRecords, validResearchRecord) &&
    isArrayOf(value.specialistRuns, validSpecialistRun) &&
    isArrayOf(value.audit, validAudit) &&
    (value.specialistBinding === null ||
      validSpecialistBinding(value.specialistBinding));
  if (!shapesValid) return false;
  const state = value as unknown as LedgerState;
  const unique = (values: readonly string[]): boolean =>
    values.length === new Set(values).size && values.every(Boolean);
  const itemIds = new Set(state.items.map(item => item.id));
  const viewIds = new Set(state.savedViews.map(view => view.id));
  const watchById = new Map(
    state.researchWatches.map(watch => [watch.id, watch]),
  );
  const lotById = new Map(state.lots.map(lot => [lot.id, lot]));
  const bindingChannel = state.specialistBinding?.channelId ?? null;
  return (
    unique(state.items.map(item => item.id)) &&
    unique(state.lots.map(lot => lot.id)) &&
    unique(state.administrations.map(entry => entry.id)) &&
    unique(state.administrations.map(entry => entry.replayKey)) &&
    unique(state.orders.map(order => order.id)) &&
    unique(state.reconstitutions.map(record => record.id)) &&
    unique(state.outcomes.map(outcome => outcome.id)) &&
    unique(state.confounders.map(confounder => confounder.id)) &&
    unique(state.adverseEvents.map(event => event.id)) &&
    unique(state.savedViews.map(view => view.id)) &&
    unique(state.researchWatches.map(watch => watch.id)) &&
    unique(
      state.researchWatches.map(
        watch => `${watch.itemId}:${watch.viewId}:${watch.query}`,
      ),
    ) &&
    unique(state.researchRecords.map(record => record.id)) &&
    unique(
      state.researchRecords.map(
        record =>
          `${record.itemId}:${record.source}:${record.sourceRecordId}`,
      ),
    ) &&
    unique(state.specialistRuns.map(run => run.id)) &&
    unique(state.specialistRuns.map(run => run.replayKey)) &&
    unique(state.audit.map(entry => entry.id)) &&
    state.items.every(
      item =>
        item.statusHistory.at(-1)?.status === item.status &&
        unique(item.schedules.map(schedule => schedule.id)) &&
        unique(item.statusHistory.map(period => period.id)),
    ) &&
    state.lots.every(
      lot =>
        itemIds.has(lot.itemId) && lot.currentQuantity <= lot.quantityReceived,
    ) &&
    state.administrations.every(entry => {
      const lot = entry.lotId ? lotById.get(entry.lotId) : undefined;
      return (
        itemIds.has(entry.itemId) &&
        (!entry.lotId ||
          (lot?.itemId === entry.itemId && lot.unit === entry.unit))
      );
    }) &&
    state.orders.every(order => itemIds.has(order.itemId)) &&
    state.reconstitutions.every(record => {
      const lot = lotById.get(record.lotId);
      return itemIds.has(record.itemId) && lot?.itemId === record.itemId;
    }) &&
    state.adverseEvents.every(event => {
      const lot = event.lotId ? lotById.get(event.lotId) : undefined;
      return (
        itemIds.has(event.itemId) &&
        (!event.lotId || lot?.itemId === event.itemId)
      );
    }) &&
    state.researchWatches.every(
      watch =>
        itemIds.has(watch.itemId) &&
        viewIds.has(watch.viewId) &&
        unique(watch.sources.map(source => source.source)),
    ) &&
    state.researchRecords.every(record => {
      const watch = watchById.get(record.watchId);
      return watch?.itemId === record.itemId;
    }) &&
    state.specialistRuns.every(
      run =>
        bindingChannel !== null &&
        run.sourceChannelId === bindingChannel &&
        (!run.itemId || itemIds.has(run.itemId)),
    )
  );
};
export const migrateLedger = (value: unknown): LedgerState => {
  if (isLedgerState(value)) return value;
  if (!value || typeof value !== 'object')
    throw new LedgerValidationError(
      'The archive is not a supported Personal Health Ledger file.',
    );
  const row = value as Record<string, unknown>;
  if (row.schemaVersion === 3) {
    const migrated = {
      ...value,
      schemaVersion: 4,
      researchWatches: [],
      researchRecords: [],
    };
    if (isLedgerState(migrated)) return migrated;
    throw new LedgerValidationError(
      'The archive is not a supported Personal Health Ledger file.',
    );
  }
  const legacyArrays = [
    'items',
    'lots',
    'administrations',
    'orders',
    'reconstitutions',
    'outcomes',
    'confounders',
    'adverseEvents',
    'savedViews',
    'audit',
  ].every(key => Array.isArray(row[key]));
  if (
    (row.schemaVersion !== 1 && row.schemaVersion !== 2) ||
    typeof row.ownerLabel !== 'string' ||
    typeof row.jurisdiction !== 'string' ||
    (row.role !== 'owner' && row.role !== 'viewer') ||
    !legacyArrays
  )
    throw new LedgerValidationError(
      'The archive is not a supported Personal Health Ledger file.',
    );
  const legacy = value as Record<string, unknown>;
  const legacyItems = legacy.items as Array<Record<string, unknown>>;
  const items = legacyItems.map(item => ({
    ...item,
    statusHistory: Array.isArray(item.statusHistory)
      ? item.statusHistory
      : [
          {
            id: `migrated-status-${String(item.id)}`,
            status: item.status as ItemStatus,
            effectiveFrom: String(item.startedOn ?? ''),
            effectiveTo: '',
            source: 'migrated ledger record',
          },
        ],
  })) as unknown as readonly RegimenItem[];
  const legacyRuns =
    row.schemaVersion === 2 && Array.isArray(legacy.specialistRuns)
      ? legacy.specialistRuns.map(run => {
          if (!isRecord(run)) return run;
          return {
            ...run,
            replayKey:
              typeof run.replayKey === 'string'
                ? run.replayKey
                : `migrated-specialist-run-${String(run.id)}`,
            task:
              run.task === 'appointment-questions'
                ? 'appointment-summary'
                : run.task,
          };
        })
      : [];
  const migrated: LedgerState = {
    ...(value as Omit<
      LedgerState,
      | 'schemaVersion'
      | 'items'
      | 'researchWatches'
      | 'researchRecords'
      | 'specialistBinding'
      | 'specialistRuns'
    >),
    schemaVersion: 4,
    items,
    researchWatches: [],
    researchRecords: [],
    specialistBinding:
      row.schemaVersion === 2
        ? ((legacy.specialistBinding as SpecialistBinding | null) ?? null)
        : null,
    specialistRuns: legacyRuns as readonly SpecialistRun[],
  };
  if (!isLedgerState(migrated))
    throw new LedgerValidationError(
      'The archive is not a supported Personal Health Ledger file.',
    );
  return migrated;
};
export const clinicianSummary = (state: LedgerState): string => {
  const active = state.items.filter(item => item.status === 'active');
  const itemName = (itemId: string): string =>
    state.items.find(item => item.id === itemId)?.name ?? 'Unknown item';
  const lotNumber = (lotId: string): string =>
    state.lots.find(lot => lot.id === lotId)?.lotNumber || 'No lot recorded';
  const recentAdministrations = state.administrations.slice(-20).toReversed();
  const recentOutcomes = state.outcomes.slice(-12).toReversed();
  const recentSafetyEvents = state.adverseEvents.slice(-12).toReversed();
  const recordedQuestions = active.flatMap(item =>
    item.clinicianQuestions
      ? [`- ${item.name}: ${item.clinicianQuestions}`]
      : [],
  );
  return [
    `Personal Health Ledger — ${state.ownerLabel}`,
    `Jurisdiction: ${state.jurisdiction}`,
    `Generated: ${timestamp()}`,
    '',
    'Current regimen',
    ...active.map(item => {
      const schedule = item.schedules.at(-1);
      return `- ${item.name} [${item.category}]: ${schedule ? `${schedule.dose} ${schedule.unit}, ${schedule.cadence}` : 'No active schedule'}; route ${item.route}; ${item.regulatoryStatus || 'regulatory status not recorded'}; instruction source ${schedule?.source || 'not recorded'}${item.clinician ? `; clinician ${item.clinician}` : ''}`;
    }),
    '',
    'Recent regimen status changes',
    ...state.items.flatMap(item =>
      item.statusHistory
        .slice(-3)
        .map(
          period =>
            `- ${item.name}: ${period.status} from ${period.effectiveFrom}${period.effectiveTo ? ` to ${period.effectiveTo}` : ' to present'}`,
        ),
    ),
    '',
    `Recent administrations (${recentAdministrations.length} of ${state.administrations.length})`,
    ...(recentAdministrations.length
      ? recentAdministrations.map(
          entry =>
            `- ${entry.actualAt}: ${itemName(entry.itemId)}; ${entry.status}; ${entry.dose} ${entry.unit}; ${entry.route}; ${lotNumber(entry.lotId)}; instruction source ${entry.instructionSource}${entry.reaction ? `; reaction/note: ${entry.reaction}` : ''}`,
        )
      : ['- None recorded']),
    '',
    'Current inventory and provenance',
    ...(state.lots.length
      ? state.lots.map(
          lot =>
            `- ${itemName(lot.itemId)}; lot ${lot.lotNumber || 'not recorded'}; ${lot.currentQuantity} of ${lot.quantityReceived} ${lot.unit} remaining; expires ${lot.expiresOn || 'not recorded'}; provenance ${lot.provenance || 'not recorded'}`,
        )
      : ['- None recorded']),
    '',
    `Safety events (${recentSafetyEvents.length} of ${state.adverseEvents.length})`,
    ...(recentSafetyEvents.length
      ? recentSafetyEvents.map(
          event =>
            `- ${event.occurredAt}: ${event.severity}; ${itemName(event.itemId)}; ${event.description}; action: ${event.actionTaken || 'not recorded'}`,
        )
      : ['- None recorded']),
    '',
    `Recent outcomes (${recentOutcomes.length} of ${state.outcomes.length})`,
    ...(recentOutcomes.length
      ? recentOutcomes.map(
          outcome =>
            `- ${outcome.occurredAt}: ${outcome.name}; ${outcome.value} ${outcome.unit}; source ${outcome.source || 'not recorded'}; reference ${outcome.referenceRange || 'not recorded'}`,
        )
      : ['- None recorded']),
    '',
    'Questions recorded for a clinician',
    ...(recordedQuestions.length ? recordedQuestions : ['- None recorded']),
    '',
    'This report organizes user-entered records. Timing and co-occurrence do not establish causation, and this report is not medical advice.',
  ].join('\n');
};
