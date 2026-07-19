import type { AdministrationStatus } from './domain';

export interface AdministrationDraft {
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
}

export interface AdministrationDraftToolResult {
  readonly kind: 'administration-draft';
  readonly schemaVersion: 1;
  readonly valid: boolean;
  readonly draft: AdministrationDraft | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const statuses = new Set<AdministrationStatus>([
  'taken',
  'skipped',
  'delayed',
  'partial',
  'uncertain',
]);

const asRow = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const string = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === 'string' ? row[key].trim() : '';

export function createAdministrationDraft(
  value: unknown,
): AdministrationDraftToolResult {
  const row = asRow(value);
  if (!row)
    return {
      kind: 'administration-draft',
      schemaVersion: 1,
      valid: false,
      draft: null,
      errors: ['Administration arguments must be a JSON object.'],
      warnings: [],
    };
  const dose = typeof row.dose === 'number' ? row.dose : Number.NaN;
  const status = string(row, 'status') as AdministrationStatus;
  const draft: AdministrationDraft = {
    itemId: string(row, 'itemId'),
    lotId: string(row, 'lotId'),
    plannedAt: string(row, 'plannedAt'),
    actualAt: string(row, 'actualAt'),
    dose,
    unit: string(row, 'unit'),
    route: string(row, 'route'),
    site: string(row, 'site'),
    status,
    reason: string(row, 'reason'),
    reaction: string(row, 'reaction'),
    instructionSource: string(row, 'instructionSource'),
  };
  const errors = [
    ...(!draft.itemId ? ['A tracked item ID is required.'] : []),
    ...(!draft.actualAt ? ['The actual date and time are required.'] : []),
    ...(draft.actualAt && Number.isNaN(Date.parse(draft.actualAt))
      ? ['The actual date and time must be a valid timestamp.']
      : []),
    ...(draft.plannedAt && Number.isNaN(Date.parse(draft.plannedAt))
      ? ['The planned date and time must be a valid timestamp.']
      : []),
    ...(!Number.isFinite(draft.dose) || draft.dose <= 0
      ? ['Dose must be a finite number greater than zero.']
      : []),
    ...(!draft.unit ? ['Dose unit is required.'] : []),
    ...(!draft.route ? ['Route is required.'] : []),
    ...(!statuses.has(draft.status)
      ? ['Status must be taken, skipped, delayed, partial, or uncertain.']
      : []),
    ...(!draft.instructionSource
      ? ['Instruction source is required.']
      : []),
  ];
  return {
    kind: 'administration-draft',
    schemaVersion: 1,
    valid: errors.length === 0,
    draft: errors.length === 0 ? draft : null,
    errors,
    warnings: [
      ...(!draft.lotId
        ? ['No inventory lot was selected; inventory will not be decremented.']
        : []),
      ...(!draft.plannedAt
        ? ['No planned timestamp was supplied for comparison.']
        : []),
    ],
  };
}

export function parseAdministrationDraftToolResult(
  value: unknown,
): AdministrationDraft | null {
  const row = asRow(value);
  if (
    !row ||
    row.kind !== 'administration-draft' ||
    row.schemaVersion !== 1 ||
    row.valid !== true
  )
    return null;
  const parsed = createAdministrationDraft(row.draft);
  return parsed.valid ? parsed.draft : null;
}
