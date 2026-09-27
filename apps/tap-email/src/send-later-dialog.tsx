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
  const eveningIsTomorrow = tonight.getTime() <= now.getTime();
  if (eveningIsTomorrow) tonight.setDate(tonight.getDate() + 1);
  const tomorrow = atLocalHour(now, 1, 8);
  const nextWeekday = atLocalHour(now, 1, 8);
  while (nextWeekday.getDay() === 0 || nextWeekday.getDay() === 6) {
    nextWeekday.setDate(nextWeekday.getDate() + 1);
  }
  return [
    { label: eveningIsTomorrow ? 'Tomorrow evening' : 'Tonight', at: tonight },
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
  now,
  onClose,
  onConfirm,
}: SendLaterDialogProps) {
  const [referenceNow] = useState(() => now ?? new Date());
  const choices = useMemo(() => sendLaterChoices(referenceNow), [referenceNow]);
  const [customValue, setCustomValue] = useState(dateTimeLocalValue(choices[1]?.at ?? choices[0]!.at));
  const scheduledFor = new Date(customValue);
  const [error, setError] = useState('');
  const [cancelIfReply, setCancelIfReply] = useState(cancelIfReplyDefault);
  const valid = Boolean(customValue) && Number.isFinite(scheduledFor.getTime()) && scheduledFor.getTime() > (now?.getTime() ?? Date.now());

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="send-later-dialog composer-tool-dialog" data-composer-tool hideCloseButton>
        <header>
          <div>
            
            <DialogTitle>Send later</DialogTitle>
            <DialogDescription>
              Your message stays saved as a draft until it is time to send.
            </DialogDescription>
          </div>
          <Button aria-label="Close send later" onClick={onClose} size="icon-sm" type="button" variant="ghost">×</Button>
        </header>
        <div className="send-later-choices">
          {choices.map(choice => (
            <Button variant="outline"
              aria-pressed={scheduledFor.getTime() === choice.at.getTime()}
              key={choice.label}
              onClick={() => {
                setError('');
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
            </Button>
          ))}
        </div>
        <label className="send-later-custom">
          <span>Custom time</span>
          <Input
            min={dateTimeLocalValue(new Date((now?.getTime() ?? Date.now()) + 60_000))}
            onChange={event => {
              setCustomValue(event.target.value);
              setError('');
            }}
            name="send-later-time"
            aria-invalid={!valid}
            aria-describedby="send-later-time-help"
            type="datetime-local"
            value={customValue}
          />
        </label>
        <p id="send-later-time-help">{error || (!valid ? 'Choose a future date and time. ' : '')}{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
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
            onClick={() => {
              if (!valid || scheduledFor.getTime() <= (now?.getTime() ?? Date.now())) { setError('Choose a future date and time. '); return; }
              onConfirm(scheduledFor.toISOString(), cancelIfReply);
            }}
            type="button"
          >
            Schedule send
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
