import {
  LedgerValidationError,
  recordAdministration,
  type AdministrationStatus,
  type LedgerState,
} from './domain';

const columns = [
  'replay_key',
  'actual_at',
  'planned_at',
  'item_name',
  'lot_number',
  'status',
  'dose',
  'unit',
  'route',
  'site',
  'reason',
  'reaction',
  'instruction_source',
] as const;

const statuses = new Set<AdministrationStatus>([
  'taken',
  'skipped',
  'delayed',
  'partial',
  'uncertain',
]);

const quote = (value: unknown): string =>
  `"${String(value ?? '').replaceAll('"', '""')}"`;

export function serializeAdministrationsCsv(state: LedgerState): string {
  return [
    columns.join(','),
    ...state.administrations.map(entry => {
      const item = state.items.find(candidate => candidate.id === entry.itemId);
      const lot = state.lots.find(candidate => candidate.id === entry.lotId);
      return [
        entry.replayKey,
        entry.actualAt,
        entry.plannedAt,
        item?.name ?? '',
        lot?.lotNumber ?? '',
        entry.status,
        entry.dose,
        entry.unit,
        entry.route,
        entry.site,
        entry.reason,
        entry.reaction,
        entry.instructionSource,
      ]
        .map(quote)
        .join(',');
    }),
  ].join('\n');
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted)
    throw new LedgerValidationError('The CSV contains an unclosed quote.');
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter(candidate => candidate.some(cell => cell.trim()));
}

export function importAdministrationsCsv(
  state: LedgerState,
  csv: string,
): LedgerState {
  const rows = parseRows(csv);
  if (rows.length < 2)
    throw new LedgerValidationError('The administration CSV has no data rows.');
  const header = rows[0]!.map(cell => cell.trim());
  if (
    columns.some((column, index) => header[index] !== column) ||
    header.length !== columns.length
  )
    throw new LedgerValidationError(
      `The administration CSV header must be: ${columns.join(',')}`,
    );
  return rows.slice(1).reduce((current, cells, rowIndex) => {
    if (cells.length !== columns.length)
      throw new LedgerValidationError(
        `CSV row ${rowIndex + 2} has ${cells.length} fields; expected ${columns.length}.`,
      );
    const record = Object.fromEntries(
      columns.map((column, index) => [column, cells[index]?.trim() ?? '']),
    ) as Record<(typeof columns)[number], string>;
    const itemMatches = current.items.filter(item => {
      const itemName = record.item_name.toLocaleLowerCase();
      return (
        item.name.toLocaleLowerCase() === itemName ||
        item.canonicalName.toLocaleLowerCase() === itemName
      );
    });
    if (itemMatches.length !== 1)
      throw new LedgerValidationError(
        `CSV row ${rowIndex + 2} must match exactly one tracked item by name.`,
      );
    const item = itemMatches[0]!;
    const lot = record.lot_number
      ? current.lots.find(
          candidate =>
            candidate.itemId === item.id &&
            candidate.lotNumber === record.lot_number,
        )
      : undefined;
    if (record.lot_number && !lot)
      throw new LedgerValidationError(
        `CSV row ${rowIndex + 2} references an unknown lot for ${item.name}.`,
      );
    if (!statuses.has(record.status as AdministrationStatus))
      throw new LedgerValidationError(
        `CSV row ${rowIndex + 2} has an unsupported administration status.`,
      );
    return recordAdministration(current, {
      replayKey: record.replay_key || crypto.randomUUID(),
      itemId: item.id,
      lotId: lot?.id ?? '',
      plannedAt: record.planned_at,
      actualAt: record.actual_at,
      dose: Number(record.dose),
      unit: record.unit,
      route: record.route,
      site: record.site,
      status: record.status as AdministrationStatus,
      reason: record.reason,
      reaction: record.reaction,
      instructionSource: record.instruction_source,
    });
  }, state);
}
