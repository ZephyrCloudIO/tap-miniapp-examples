import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@theaiplatform/miniapp-sdk/ui';
import { Clock3 } from 'lucide-react';
import React, {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { EmailThread } from './domain';
import { reminderSuggestions, type ReminderSuggestion } from './reminder-suggestions';

const sameDayFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const nearbyFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const laterFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export interface ReminderDialogProps {
  readonly thread: EmailThread;
  readonly onClose: () => void;
  readonly onConfirm: (input: string) => void;
}

function calendarDayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

export function formatReminderSuggestionTime(dueAt: Date, now: Date): string {
  if (calendarDayKey(dueAt) === calendarDayKey(now)) {
    return sameDayFormatter.format(dueAt);
  }
  return dueAt.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1_000
    ? nearbyFormatter.format(dueAt)
    : laterFormatter.format(dueAt);
}

export function ReminderDialog({ thread, onClose, onConfirm }: ReminderDialogProps) {
  const [input, setInput] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [referenceNow] = useState(() => new Date());
  const listboxId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suggestions = useMemo(
    () => reminderSuggestions(input, referenceNow),
    [input, referenceNow],
  );
  const resolvedActiveIndex = activeIndex >= 0 && activeIndex < suggestions.length
    ? activeIndex
    : -1;
  const visuallyHighlightedIndex = resolvedActiveIndex >= 0 ? resolvedActiveIndex : 0;

  const chooseSuggestion = (suggestion: ReminderSuggestion | undefined) => {
    if (suggestion) onConfirm(suggestion.value);
  };
  const moveActive = (direction: -1 | 1) => {
    if (suggestions.length === 0) return;
    const nextIndex = resolvedActiveIndex < 0
      ? direction === 1 ? 0 : suggestions.length - 1
      : (resolvedActiveIndex + direction + suggestions.length) % suggestions.length;
    setActiveIndex(nextIndex);
    window.requestAnimationFrame(() => {
      optionRefs.current[nextIndex]?.scrollIntoView({ block: 'nearest' });
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    chooseSuggestion(suggestions[resolvedActiveIndex >= 0 ? resolvedActiveIndex : 0]);
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseSuggestion(suggestions[resolvedActiveIndex >= 0 ? resolvedActiveIndex : 0]);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="reminder-dialog" hideCloseButton>
        <form onSubmit={submit}>
          <div className="dialog-title-row">
            <span className="clock-glyph" aria-hidden="true"><Clock3 /></span>
            <div>
              <DialogTitle>Remind me</DialogTitle>
              <DialogDescription>{thread.subject}</DialogDescription>
            </div>
          </div>
          <Input
            aria-activedescendant={resolvedActiveIndex >= 0
              ? `${listboxId}-option-${resolvedActiveIndex}`
              : undefined}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={suggestions.length > 0}
            aria-label="Reminder date and time"
            autoComplete="off"
            autoFocus
            className="reminder-input"
            name="reminder-time"
            onChange={event => {
              setInput(event.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Try: tomorrow, in 3 days, next week…"
            role="combobox"
            value={input}
          />
          <div
            aria-label="Reminder suggestions"
            className="reminder-presets"
            id={listboxId}
            role="listbox"
          >
            {suggestions.map((suggestion, index) => {
              const active = index === visuallyHighlightedIndex;
              return (
                <Button
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  id={`${listboxId}-option-${index}`}
                  key={suggestion.value}
                  onClick={() => chooseSuggestion(suggestion)}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  ref={element => { optionRefs.current[index] = element; }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  variant="ghost"
                >
                  <span>{suggestion.label}</span>
                  <span>{formatReminderSuggestionTime(suggestion.dueAt, referenceNow)}</span>
                </Button>
              );
            })}
            {suggestions.length === 0 ? (
              <p className="reminder-empty" role="status">Keep typing a future time.</p>
            ) : null}
          </div>
          <span className="sr-only" aria-live="polite">
            {suggestions.length === 1
              ? '1 reminder suggestion'
              : `${suggestions.length} reminder suggestions`}
          </span>
        </form>
      </DialogContent>
    </Dialog>
  );
}
