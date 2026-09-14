export interface ReceivedAtItem {
  readonly receivedAt: string;
}

export interface ThreadDayGroup<T extends ReceivedAtItem> {
  readonly dateKey: string;
  readonly label: string;
  readonly items: readonly T[];
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const dayWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function localDayKey(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - 1,
  );
}

export function threadDayLabel(
  receivedAt: string,
  now: Date = new Date(),
  locales?: Intl.LocalesArgument,
): string {
  const received = new Date(receivedAt);
  const receivedKey = localDayKey(received);
  if (receivedKey === null) return 'Unknown date';
  if (receivedKey === localDayKey(now)) return 'Today';
  if (receivedKey === localDayKey(previousLocalDay(now))) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(received.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  };
  const formatter = locales === undefined
    ? received.getFullYear() === now.getFullYear()
      ? dayFormatter
      : dayWithYearFormatter
    : new Intl.DateTimeFormat(locales, options);
  return formatter.format(received);
}

export function threadListTimestamp(
  receivedAt: string,
  now: Date = new Date(),
  locales?: Intl.LocalesArgument,
): string {
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) return receivedAt;
  const isToday = localDayKey(received) === localDayKey(now);
  const options: Intl.DateTimeFormatOptions = {
    ...(isToday
      ? {}
      : {
          month: 'short',
          day: 'numeric',
          ...(received.getFullYear() === now.getFullYear()
            ? {}
            : { year: 'numeric' }),
        }),
    hour: 'numeric',
    minute: '2-digit',
  };
  const formatter = locales === undefined
    ? isToday
      ? timeFormatter
      : received.getFullYear() === now.getFullYear()
        ? dateTimeFormatter
        : dateTimeWithYearFormatter
    : new Intl.DateTimeFormat(locales, options);
  return formatter.format(received);
}

export function groupThreadsByDay<T extends ReceivedAtItem>(
  items: readonly T[],
  now: Date = new Date(),
  locales?: Intl.LocalesArgument,
): readonly ThreadDayGroup<T>[] {
  const groups: Array<{ dateKey: string; label: string; items: T[] }> = [];

  for (const item of items) {
    const dateKey = localDayKey(new Date(item.receivedAt)) ?? 'unknown';
    const previous = groups.at(-1);
    if (previous?.dateKey === dateKey) {
      previous.items.push(item);
      continue;
    }
    groups.push({
      dateKey,
      label: threadDayLabel(item.receivedAt, now, locales),
      items: [item],
    });
  }

  return groups;
}
