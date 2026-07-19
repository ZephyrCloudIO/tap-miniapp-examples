export type Role = 'viewer' | 'operator' | 'lead';
export type VantaRegion = 'us' | 'eu' | 'aus';
export type CaseStatus =
  | 'open'
  | 'planning'
  | 'in-progress'
  | 'awaiting-verification'
  | 'verified';
export type VantaObjectType =
  | 'test'
  | 'issue'
  | 'control'
  | 'audit-request'
  | 'vendor'
  | 'risk'
  | 'vulnerability';
export type AnalysisKind =
  | 'readiness'
  | 'failed-tests'
  | 'evidence'
  | 'auditor-response'
  | 'remediation'
  | 'controls-monitoring'
  | 'documents-evidence'
  | 'people-devices'
  | 'vendor-risk'
  | 'vulnerability-management'
  | 'trust-customer'
  | 'integrations-resources'
  | 'recurring-workflow'
  | 'custom';

export interface Settings {
  readonly schemaVersion: 3;
  readonly role: Role;
  readonly workspaceId: string;
  readonly channelId: string | null;
  readonly projectId: string | null;
  readonly specialistId: string | null;
  readonly region: VantaRegion;
  readonly timezone: string;
  readonly webhookApiUrl: string | null;
  readonly webhookCursor: string | null;
  readonly webhookLastSyncedAt: string | null;
  readonly updatedAt: string;
}

export interface WebhookEvent {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly receivedAt: string;
}

export interface RemediationCase {
  readonly id: string;
  readonly title: string;
  readonly objectType: VantaObjectType;
  readonly vantaObjectId: string;
  readonly vantaUrl: string;
  readonly criterion: string;
  readonly owner: string;
  readonly dueAt: string | null;
  readonly status: CaseStatus;
  readonly notes: string;
  readonly channelId: string | null;
  readonly workflowRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisRun {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly title: string;
  readonly content: string;
  readonly modelUsed: string | null;
  readonly sourceChannelId: string;
  readonly createdAt: string;
}

export interface ActionReceipt {
  readonly id: string;
  readonly kind:
    | 'channel'
    | 'workflow'
    | 'specialist'
    | 'analysis'
    | 'case'
    | 'case-transition'
    | 'vanta-api'
    | 'webhook-config'
    | 'webhook-sync';
  readonly sourceId: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly actor: string;
  readonly outcome: 'completed';
}

export interface CompanionState {
  readonly schemaVersion: 3;
  readonly settings: Settings | null;
  readonly cases: readonly RemediationCase[];
  readonly analyses: readonly AnalysisRun[];
  readonly receipts: readonly ActionReceipt[];
  readonly webhookEvents: readonly WebhookEvent[];
  readonly processedKeys: readonly string[];
}

export const emptyState = (): CompanionState => ({
  schemaVersion: 3,
  settings: null,
  cases: [],
  analyses: [],
  receipts: [],
  webhookEvents: [],
  processedKeys: [],
});

const clean = (value: string): string => value.trim();
const nowIso = (): string => new Date().toISOString();
interface RuntimeCrypto {
  readonly randomUUID?: () => string;
  readonly getRandomValues: Crypto['getRandomValues'];
}
export const runtimeUuid = (
  source: RuntimeCrypto = globalThis.crypto,
): string => {
  if (typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
};
const uuid = (): string => runtimeUuid();

export function createSettings(
  input: {
    role: Role;
    workspaceId: string;
    channelId?: string | null;
    projectId?: string | null;
    specialistId?: string | null;
    region: VantaRegion;
    timezone: string;
    webhookApiUrl?: string | null;
    webhookCursor?: string | null;
    webhookLastSyncedAt?: string | null;
  },
  now: () => string = nowIso,
): Settings {
  if (!clean(input.workspaceId)) throw new Error('Workspace ID is required.');
  if (!clean(input.timezone)) throw new Error('Time zone is required.');
  return {
    schemaVersion: 3,
    role: input.role,
    workspaceId: clean(input.workspaceId),
    channelId: clean(input.channelId ?? '') || null,
    projectId: clean(input.projectId ?? '') || null,
    specialistId: clean(input.specialistId ?? '') || null,
    region: input.region,
    timezone: clean(input.timezone),
    webhookApiUrl: clean(input.webhookApiUrl ?? '') || null,
    webhookCursor: clean(input.webhookCursor ?? '') || null,
    webhookLastSyncedAt: clean(input.webhookLastSyncedAt ?? '') || null,
    updatedAt: now(),
  };
}

export const canCoordinate = (role: Role): boolean =>
  role === 'operator' || role === 'lead';
export const canVerify = (role: Role): boolean => role === 'lead';

export function configureWebhookApi(
  state: CompanionState,
  apiUrl: string,
  role: Role,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  if (!canCoordinate(role))
    throw new Error('Your role cannot configure the webhook API.');
  if (!state.settings) throw new Error('Workspace settings are required.');
  const normalized = clean(apiUrl);
  if (!normalized) throw new Error('Webhook API URL is required.');
  if (state.settings.webhookApiUrl === normalized) return state;
  const changed = Boolean(state.settings.webhookApiUrl);
  const settings: Settings = {
    ...state.settings,
    webhookApiUrl: normalized,
    webhookCursor: null,
    webhookLastSyncedAt: null,
    updatedAt: now(),
  };
  return withReceipt(
    {
      ...state,
      settings,
      webhookEvents: changed ? [] : state.webhookEvents,
    },
    {
      kind: 'webhook-config',
      sourceId: normalized,
      summary: changed
        ? 'Replaced the webhook API connection and cleared prior event metadata'
        : 'Configured the webhook API connection',
      actor: role,
    },
    id,
    now,
  );
}

export function mergeWebhookEvents(
  state: CompanionState,
  input: {
    readonly events: readonly WebhookEvent[];
    readonly cursor: string | null;
  },
  role: Role,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  if (!state.settings?.webhookApiUrl)
    throw new Error('Configure the webhook API before syncing events.');
  const known = new Set(state.webhookEvents.map(event => event.id));
  const added: WebhookEvent[] = [];
  for (const event of input.events) {
    if (
      !clean(event.id) ||
      !clean(event.eventType) ||
      !Number.isFinite(Date.parse(event.receivedAt)) ||
      (event.occurredAt !== null &&
        !Number.isFinite(Date.parse(event.occurredAt)))
    ) {
      throw new Error('Webhook API returned an invalid event.');
    }
    if (!known.has(event.id)) {
      known.add(event.id);
      added.push(event);
    }
  }
  const timestamp = now();
  let next: CompanionState = {
    ...state,
    settings: {
      ...state.settings,
      webhookCursor: clean(input.cursor ?? '') || state.settings.webhookCursor,
      webhookLastSyncedAt: timestamp,
      updatedAt: timestamp,
    },
    webhookEvents: [...added, ...state.webhookEvents]
      .sort((left: WebhookEvent, right: WebhookEvent) =>
        right.receivedAt.localeCompare(left.receivedAt),
      )
      .slice(0, 500),
    processedKeys: [
      ...state.processedKeys,
      ...added.map(event => `webhook:${event.id}`),
    ].slice(-500),
  };
  if (added.length > 0) {
    next = withReceipt(
      next,
      {
        kind: 'webhook-sync',
        sourceId: added.at(-1)!.id,
        summary: `Imported ${added.length} verified Vanta webhook ${added.length === 1 ? 'event' : 'events'}`,
        actor: role,
      },
      id,
      now,
    );
  }
  return next;
}

export function createCase(
  state: CompanionState,
  input: {
    title: string;
    objectType: VantaObjectType;
    vantaObjectId: string;
    vantaUrl: string;
    criterion: string;
    owner: string;
    dueAt?: string | null;
    notes?: string;
  },
  role: Role,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  if (!canCoordinate(role))
    throw new Error('Your role cannot create remediation cases.');
  const title = clean(input.title);
  const vantaObjectId = clean(input.vantaObjectId);
  const vantaUrl = clean(input.vantaUrl);
  const criterion = clean(input.criterion);
  const owner = clean(input.owner);
  if (!title) throw new Error('Case title is required.');
  if (!vantaObjectId) throw new Error('Vanta object ID is required.');
  if (!/^https:\/\/([a-z0-9-]+\.)*vanta\.com\//iu.test(vantaUrl)) {
    throw new Error('Enter a valid HTTPS Vanta URL.');
  }
  if (!criterion) throw new Error('SOC 2 criterion is required.');
  if (!owner) throw new Error('A human owner is required.');
  if (
    state.cases.some(
      item =>
        item.objectType === input.objectType &&
        item.vantaObjectId === vantaObjectId &&
        item.status !== 'verified',
    )
  ) {
    throw new Error('An active case already references this Vanta object.');
  }
  const timestamp = now();
  const remediation: RemediationCase = {
    id: id(),
    title,
    objectType: input.objectType,
    vantaObjectId,
    vantaUrl,
    criterion,
    owner,
    dueAt: clean(input.dueAt ?? '') || null,
    status: 'open',
    notes: clean(input.notes ?? ''),
    channelId: null,
    workflowRunId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return withReceipt(
    { ...state, cases: [remediation, ...state.cases] },
    {
      kind: 'case',
      sourceId: remediation.id,
      summary: `Created case for ${input.objectType} ${vantaObjectId}`,
      actor: role,
    },
    id,
    now,
  );
}

const transitions: Record<CaseStatus, readonly CaseStatus[]> = {
  open: ['planning'],
  planning: ['in-progress', 'open'],
  'in-progress': ['awaiting-verification', 'planning'],
  'awaiting-verification': ['verified', 'in-progress'],
  verified: [],
};

export function transitionCase(
  state: CompanionState,
  caseId: string,
  nextStatus: CaseStatus,
  role: Role,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  if (!canCoordinate(role))
    throw new Error('Your role cannot update remediation cases.');
  if (nextStatus === 'verified' && !canVerify(role))
    throw new Error('Only a compliance lead can verify source completion.');
  const current = state.cases.find(item => item.id === caseId);
  if (!current) throw new Error('Remediation case not found.');
  if (!transitions[current.status].includes(nextStatus))
    throw new Error(
      `Cannot move a case from ${current.status} to ${nextStatus}.`,
    );
  const next = { ...current, status: nextStatus, updatedAt: now() };
  return withReceipt(
    {
      ...state,
      cases: state.cases.map(item => (item.id === caseId ? next : item)),
    },
    {
      kind: 'case-transition',
      sourceId: caseId,
      summary: `Moved case from ${current.status} to ${nextStatus}`,
      actor: role,
    },
    id,
    now,
  );
}

export function attachCaseChannel(
  state: CompanionState,
  caseId: string,
  channelId: string,
): CompanionState {
  return {
    ...state,
    cases: state.cases.map(item =>
      item.id === caseId ? { ...item, channelId, updatedAt: nowIso() } : item,
    ),
  };
}

export function attachWorkflowRun(
  state: CompanionState,
  caseId: string,
  runId: string,
): CompanionState {
  return {
    ...state,
    cases: state.cases.map(item =>
      item.id === caseId
        ? { ...item, workflowRunId: runId, updatedAt: nowIso() }
        : item,
    ),
  };
}

export function addAnalysis(
  state: CompanionState,
  analysis: Omit<AnalysisRun, 'id' | 'createdAt'>,
  actor: string,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  const content = clean(analysis.content);
  if (!content)
    throw new Error('The specialist returned no readable analysis.');
  const run: AnalysisRun = { ...analysis, content, id: id(), createdAt: now() };
  return withReceipt(
    { ...state, analyses: [run, ...state.analyses].slice(0, 50) },
    {
      kind: 'analysis',
      sourceId: run.id,
      summary: `Completed ${analysis.kind} analysis`,
      actor,
    },
    id,
    now,
  );
}

export function withReceipt(
  state: CompanionState,
  input: Omit<ActionReceipt, 'id' | 'createdAt' | 'outcome'>,
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  return {
    ...state,
    receipts: [
      { ...input, id: id(), createdAt: now(), outcome: 'completed' as const },
      ...state.receipts,
    ].slice(0, 200),
  };
}

export function recordIdempotentReceipt(
  state: CompanionState,
  input: Omit<ActionReceipt, 'id' | 'createdAt' | 'outcome'> & {
    idempotencyKey: string;
  },
  id: () => string = uuid,
  now: () => string = nowIso,
): CompanionState {
  if (state.processedKeys.includes(input.idempotencyKey)) return state;
  const { idempotencyKey, ...receipt } = input;
  return withReceipt(
    {
      ...state,
      processedKeys: [...state.processedKeys, idempotencyKey].slice(-500),
    },
    receipt,
    id,
    now,
  );
}

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 3 &&
    typeof item.workspaceId === 'string' &&
    typeof item.timezone === 'string' &&
    (item.webhookApiUrl === null || typeof item.webhookApiUrl === 'string') &&
    (item.webhookCursor === null || typeof item.webhookCursor === 'string') &&
    (item.webhookLastSyncedAt === null ||
      typeof item.webhookLastSyncedAt === 'string') &&
    ['viewer', 'operator', 'lead'].includes(String(item.role))
  );
}

function migrateVersion2(value: Readonly<Record<string, unknown>>): CompanionState | null {
  if (
    !Array.isArray(value.cases) ||
    !Array.isArray(value.analyses) ||
    !Array.isArray(value.receipts) ||
    !Array.isArray(value.processedKeys)
  )
    return null;
  const legacySettings = value.settings;
  if (legacySettings !== null) {
    if (!legacySettings || typeof legacySettings !== 'object') return null;
    const item = legacySettings as Readonly<Record<string, unknown>>;
    if (
      item.schemaVersion !== 2 ||
      typeof item.workspaceId !== 'string' ||
      typeof item.timezone !== 'string' ||
      !['viewer', 'operator', 'lead'].includes(String(item.role))
    )
      return null;
  }
  const settings = legacySettings
    ? ({
        ...(legacySettings as Omit<Settings, 'schemaVersion' | 'webhookApiUrl' | 'webhookCursor' | 'webhookLastSyncedAt'>),
        schemaVersion: 3,
        webhookApiUrl: null,
        webhookCursor: null,
        webhookLastSyncedAt: null,
      } satisfies Settings)
    : null;
  return {
    schemaVersion: 3,
    settings,
    cases: value.cases as readonly RemediationCase[],
    analyses: value.analyses as readonly AnalysisRun[],
    receipts: value.receipts as readonly ActionReceipt[],
    webhookEvents: [],
    processedKeys: value.processedKeys as readonly string[],
  };
}

export function parseState(value: unknown): CompanionState | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion === 2) return migrateVersion2(item);
  if (
    item.schemaVersion !== 3 ||
    !Array.isArray(item.cases) ||
    !Array.isArray(item.analyses) ||
    !Array.isArray(item.receipts) ||
    !Array.isArray(item.webhookEvents) ||
    !Array.isArray(item.processedKeys)
  )
    return null;
  if (item.settings !== null && !isSettings(item.settings)) return null;
  return value as CompanionState;
}
