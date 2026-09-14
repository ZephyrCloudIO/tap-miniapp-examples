import React, { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@theaiplatform/miniapp-sdk/ui';

interface SendLaterChoice {
  readonly label: string;
  readonly at: Date;
}

export interface SendLaterDialogProps {
  readonly cancelIfReplyDefault: boolean;
  readonly now?: Date;
  readonly onClose: () => void;
  readonly onConfirm: (scheduledFor: string, cancelIfReply: boolean) => void;
}

function atLocalHour(date: Date, days: number, hour: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(hour, 0, 0, 0);
  return result;
}

export function sendLaterChoices(now: Date): readonly SendLaterChoice[] {
  const tonight = atLocalHour(now, 0, 18);
  if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1);
  const tomorrow = atLocalHour(now, 1, 8);
  const nextWeekday = atLocalHour(now, 1, 8);
  while (nextWeekday.getDay() === 0 || nextWeekday.getDay() === 6) {
    nextWeekday.setDate(nextWeekday.getDate() + 1);
  }
  return [
    { label: 'Tonight', at: tonight },
    { label: 'Tomorrow morning', at: tomorrow },
    { label: 'Next weekday', at: nextWeekday },
  ];
}

function dateTimeLocalValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function SendLaterDialog({
  cancelIfReplyDefault,
  now = new Date(),
  onClose,
  onConfirm,
}: SendLaterDialogProps) {
  const choices = useMemo(() => sendLaterChoices(now), [now]);
  const [scheduledFor, setScheduledFor] = useState(choices[1]?.at ?? choices[0]!.at);
  const [customValue, setCustomValue] = useState(dateTimeLocalValue(scheduledFor));
  const [cancelIfReply, setCancelIfReply] = useState(cancelIfReplyDefault);
  const valid = scheduledFor.getTime() > now.getTime();

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="send-later-dialog" hideCloseButton>
        <header>
          <div>
            <span className="eyebrow">Recoverable outbox</span>
            <DialogTitle>Send later</DialogTitle>
            <DialogDescription>
              The message remains a provider-visible draft until its delivery time.
            </DialogDescription>
          </div>
          <Button aria-label="Close send later" onClick={onClose} size="icon-sm" type="button" variant="ghost">×</Button>
        </header>
        <div className="send-later-choices">
          {choices.map(choice => (
            <button
              aria-pressed={scheduledFor.getTime() === choice.at.getTime()}
              key={choice.label}
              onClick={() => {
                setScheduledFor(choice.at);
                setCustomValue(dateTimeLocalValue(choice.at));
              }}
              type="button"
            >
              <strong>{choice.label}</strong>
              <time dateTime={choice.at.toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(choice.at)}
              </time>
            </button>
          ))}
        </div>
        <label className="send-later-custom">
          <span>Custom time</span>
          <Input
            min={dateTimeLocalValue(new Date(now.getTime() + 60_000))}
            onChange={event => {
              setCustomValue(event.target.value);
              const parsed = new Date(event.target.value);
              if (Number.isFinite(parsed.getTime())) setScheduledFor(parsed);
            }}
            type="datetime-local"
            value={customValue}
          />
        </label>
        {cancelIfReplyDefault ? (
          <label className="send-later-cancel-reply">
            <span>
              <strong>Cancel if they reply first</strong>
              <small>The draft stays saved; TAP Email will not send over a newer reply.</small>
            </span>
            <Checkbox
              checked={cancelIfReply}
              onCheckedChange={checked => setCancelIfReply(checked === true)}
            />
          </label>
        ) : null}
        <footer>
          <Button onClick={onClose} type="button" variant="ghost">Cancel</Button>
          <Button
            className="primary-button"
            disabled={!valid}
            onClick={() => onConfirm(scheduledFor.toISOString(), cancelIfReply)}
            type="button"
          >
            Schedule send
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
