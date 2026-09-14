import { describe, expect, it } from '@rstest/core';
import { resolveReminderInput } from './domain';
import { reminderSuggestions } from './reminder-suggestions';

const now = new Date(2026, 8, 13, 16, 40, 37, 123);

describe('reminderSuggestions', () => {
  it('offers useful defaults without requiring a pre-filled query', () => {
    expect(reminderSuggestions('', now).map(suggestion => suggestion.value)).toEqual([
      'tomorrow',
      'next week',
      'next weekend',
      'in 3 days',
    ]);
  });

  it('changes its suggestions as a relative phrase is typed', () => {
    expect(reminderSuggestions('in', now).map(suggestion => suggestion.value)).toEqual([
      'in 1 minute',
      'in 1 hour',
      'in 1 day',
      'in 1 week',
    ]);
    expect(reminderSuggestions('in o', now).map(suggestion => suggestion.value)).toEqual([
      'in 1 minute',
      'in 1 hour',
      'in 1 day',
      'in 1 week',
    ]);
    expect(reminderSuggestions('in one h', now).map(suggestion => suggestion.value)).toEqual([
      'in 1 hour',
    ]);
    expect(reminderSuggestions('in 12 d', now).map(suggestion => suggestion.value)).toEqual([
      'in 12 days',
    ]);
  });

  it('filters named presets as their text is typed', () => {
    expect(reminderSuggestions('next', now).map(suggestion => suggestion.value)).toEqual([
      'next week',
      'next weekend',
    ]);
    expect(reminderSuggestions('weekend', now).map(suggestion => suggestion.value)).toEqual([
      'next weekend',
    ]);
  });

  it('canonicalizes word quantities instead of showing duplicate due times', () => {
    expect(reminderSuggestions('in one minute', now).map(suggestion => suggestion.value)).toEqual([
      'in 1 minute',
    ]);
    expect(reminderSuggestions('one week', now).map(suggestion => suggestion.value)).toEqual([
      'in 1 week',
    ]);
  });

  it('only emits values that round-trip through the reminder parser', () => {
    for (const input of ['', 'in', 'in one h', 'in 12 d', 'next', 'October 4, 2026 3pm']) {
      for (const suggestion of reminderSuggestions(input, now)) {
        expect(resolveReminderInput(suggestion.value, now)?.getTime())
          .toBe(suggestion.dueAt.getTime());
      }
    }
  });
});
