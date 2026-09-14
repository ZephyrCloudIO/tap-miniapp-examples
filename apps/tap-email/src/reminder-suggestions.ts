import { resolveReminderInput } from './domain';

export interface ReminderSuggestion {
  readonly dueAt: Date;
  readonly label: string;
  readonly value: string;
}

const defaultReminderInputs = [
  'tomorrow',
  'next week',
  'next weekend',
  'in 3 days',
] as const;

const relativeUnits = [
  { aliases: ['m', 'min', 'mins', 'minute', 'minutes'], unit: 'minute' },
  { aliases: ['h', 'hr', 'hrs', 'hour', 'hours'], unit: 'hour' },
  { aliases: ['d', 'day', 'days'], unit: 'day' },
  { aliases: ['w', 'wk', 'wks', 'week', 'weeks'], unit: 'week' },
] as const;

function titleCaseReminder(value: string): string {
  return value.replace(/^\p{L}/u, character => character.toUpperCase());
}

function relativeReminderInputs(query: string): readonly string[] {
  const startsWithIn = query === 'in' || query.startsWith('in ');
  const relativeQuery = startsWithIn ? query.slice(2).trim() : query;
  if (!startsWithIn && !/^(?:\d{1,3}|a|an|one)(?:\s|$)/u.test(relativeQuery)) {
    return [];
  }

  let quantity = 1;
  let unitQuery = '';
  if (relativeQuery) {
    const match = /^(\d{1,3}|a|an|one)(?:\s+(.*))?$/u.exec(relativeQuery);
    if (match) {
      quantity = /^\d+$/u.test(match[1]!) ? Number(match[1]) : 1;
      unitQuery = match[2]?.trim() ?? '';
    } else if (
      startsWithIn &&
      !relativeQuery.includes(' ') &&
      ['a', 'an', 'one'].some(quantityWord => quantityWord.startsWith(relativeQuery))
    ) {
      quantity = 1;
    } else if (startsWithIn) {
      unitQuery = relativeQuery;
    } else {
      return [];
    }
  }
  if (quantity < 1 || quantity > 999) return [];

  return relativeUnits
    .filter(({ aliases }) =>
      !unitQuery || aliases.some(alias => alias.startsWith(unitQuery)),
    )
    .map(({ unit }) => `in ${quantity} ${unit}${quantity === 1 ? '' : 's'}`);
}

function matchingPresetInputs(query: string): readonly string[] {
  if (!query) return defaultReminderInputs;
  return defaultReminderInputs.filter(value =>
    value.includes(query) || titleCaseReminder(value).toLowerCase().includes(query),
  );
}

export function reminderSuggestions(
  input: string,
  now: Date,
  limit = 4,
): readonly ReminderSuggestion[] {
  const query = input.trim().toLowerCase().replace(/\s+/gu, ' ');
  const relativeInputs = relativeReminderInputs(query);
  const values = [
    ...relativeInputs,
    ...matchingPresetInputs(query),
  ];
  if (query && relativeInputs.length === 0 && resolveReminderInput(query, now)) {
    values.unshift(query);
  }

  const seen = new Set<string>();
  const suggestions: ReminderSuggestion[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    const dueAt = resolveReminderInput(value, now);
    if (!dueAt) continue;
    suggestions.push({ dueAt, label: titleCaseReminder(value), value });
    if (suggestions.length === limit) break;
  }
  return suggestions;
}
