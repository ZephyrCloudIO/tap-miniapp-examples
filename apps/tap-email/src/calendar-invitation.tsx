import React, { memo, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import {
  calendarWhenLabel,
  calendarEventKey,
  calendarSafeUrl,
  maximumCalendarBytes,
  parseCalendarInvitations,
  type CalendarInvitation,
  type CalendarResponse,
} from '@tap-examples/tap-email-protocol/calendar';
import {
  isCalendarRsvpPayload,
  type CalendarRsvpPayload,
} from '@tap-examples/tap-email-protocol';
import type { AttachmentMessageContext } from './coordinator-client';
import type {
  EmailAttachment,
  CalendarResponseRecord,
  MailState,
} from './domain';
import type { ConversationQueryCache } from './conversation-query-cache';
import type { LoadMessageAttachment } from './message-attachments';

export const isCalendarAttachment = (a: EmailAttachment) =>
  /^(text\/calendar|application\/(ics|icalendar))(;|$)/iu.test(a.mimeType) ||
  /\.ics$/iu.test(a.fileName);
export const calendarResponseKey = (
  accountId: string,
  messageId: string,
  resourceId: string,
  eventKey: string,
) => JSON.stringify([accountId, messageId, resourceId, eventKey]);
export interface CalendarReaderServices {
  readonly cache: ConversationQueryCache;
  readonly addresses: ReadonlyMap<string, string>;
  readonly responses: ReadonlyMap<string, CalendarResponseRecord | 'pending'>;
  readonly respond: (
    context: AttachmentMessageContext & { providerRevision: string },
    payload: Pick<
      CalendarRsvpPayload,
      'messageId' | 'resourceId' | 'eventKey' | 'response'
    >,
  ) => void;
}
export function calendarResponseStates(
  state: Pick<MailState, 'commands' | 'calendarResponses'>,
): CalendarReaderServices['responses'] {
  const map = new Map<string, CalendarResponseRecord | 'pending'>();
  for (const record of state.calendarResponses ?? []) {
    const p = record.command.payload;
    if (isCalendarRsvpPayload(p))
      map.set(
        calendarResponseKey(
          record.command.accountId,
          p.messageId,
          p.resourceId,
          p.eventKey,
        ),
        record,
      );
  }
  for (const command of state.commands) {
    const p = command.payload;
    if (command.kind === 'calendar_rsvp' && isCalendarRsvpPayload(p))
      map.set(
        calendarResponseKey(
          command.accountId,
          p.messageId,
          p.resourceId,
          p.eventKey,
        ),
        'pending',
      );
  }
  return map;
}
const responseLabels: Record<CalendarResponse, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
};
function statusLabel(event: CalendarInvitation): string {
  if (event.cancelled) return 'Event canceled';
  if (event.method === 'REPLY') {
    const person = event.attendees[0];
    const action =
      person?.status === 'ACCEPTED'
        ? 'accepted'
        : person?.status === 'DECLINED'
          ? 'declined'
          : person?.status === 'TENTATIVE'
            ? 'tentatively accepted'
            : 'responded';
    return `${person?.name || person?.address || 'An attendee'} has ${action}`;
  }
  return event.method === 'REQUEST'
    ? event.sequence > 0
      ? 'Updated invitation'
      : 'Calendar invitation'
    : 'Calendar event';
}
function InvitationCard({
  event,
  attachment,
  context,
  services,
}: {
  readonly event: CalendarInvitation;
  readonly attachment: EmailAttachment;
  readonly context: AttachmentMessageContext & { providerRevision: string };
  readonly services: CalendarReaderServices;
}) {
  const key = calendarEventKey(event);
  const address = services.addresses.get(context.accountId)?.toLowerCase();
  const attendee = event.attendees.find((person) => person.address === address);
  const record = services.responses.get(
    calendarResponseKey(
      context.accountId,
      context.messageId,
      attachment.resourceId,
      key,
    ),
  );
  const pending = record === 'pending';
  const receipt = typeof record === 'object' ? record.receipt : null;
  const confirmed =
    receipt?.state === 'applied' &&
    typeof record === 'object' &&
    isCalendarRsvpPayload(record.command.payload)
      ? record.command.payload.response
      : null;
  const uncertain = receipt?.state === 'uncertain';
  const canRespond =
    event.method === 'REQUEST' &&
    !event.cancelled &&
    attendee &&
    event.organizer &&
    attendee.address !== event.organizer.address &&
    !!context.providerRevision;
  const ownStatus = confirmed?.toUpperCase() || attendee?.status;
  const when = useMemo(() => calendarWhenLabel(event), [event]);
  const link = calendarSafeUrl(event.location) || calendarSafeUrl(event.url);
  return (
    <section
      className="calendar-invitation"
      aria-label={`Calendar event: ${event.title}`}
    >
      <header className="calendar-invitation-banner">
        <span className="calendar-invitation-status">{statusLabel(event)}</span>
        <CalendarDays aria-hidden="true" />
        <h3>{event.title}</h3>
      </header>
      <div className="calendar-invitation-content">
        {event.comment ? (
          <p className="calendar-response-note">{event.comment}</p>
        ) : null}
        <dl>
          <div>
            <dt>When</dt>
            <dd>{when}</dd>
          </div>
          {event.location || link ? (
            <div>
              <dt>Where</dt>
              <dd>
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    {event.location || link}
                  </a>
                ) : (
                  event.location
                )}
              </dd>
            </div>
          ) : null}
          {event.organizer ? (
            <div>
              <dt>Organizer</dt>
              <dd>{event.organizer.name || event.organizer.address}</dd>
            </div>
          ) : null}
          {event.attendees.length ? (
            <div>
              <dt>Who</dt>
              <dd>
                {event.attendees
                  .map((person) => person.name || person.address)
                  .join(', ')}
              </dd>
            </div>
          ) : null}
          {event.description ? (
            <div>
              <dt>About</dt>
              <dd className="calendar-description">{event.description}</dd>
            </div>
          ) : null}
        </dl>
        {canRespond ? (
          <div
            className="calendar-rsvp"
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
          >
            <p>
              {pending
                ? 'Sending your response…'
                : uncertain
                  ? 'Delivery could not be confirmed. Check with the organizer before responding again.'
                  : receipt?.state === 'failed'
                    ? 'Your response was not sent. Reload this conversation if the invitation changed, then try again.'
                    : confirmed
                      ? `You responded ${responseLabels[confirmed]}.`
                      : ownStatus && ownStatus !== 'NEEDS-ACTION'
                        ? `Your invitation response: ${ownStatus.toLowerCase()}. You can change it.`
                        : 'Will you attend?'}
            </p>
            <div role="group" aria-label="Respond to invitation">
              {(['accepted', 'declined', 'tentative'] as const).map(
                (response) => (
                  <button
                    key={response}
                    type="button"
                    disabled={pending || uncertain}
                    aria-pressed={ownStatus === response.toUpperCase()}
                    onClick={() =>
                      services.respond(context, {
                        messageId: context.messageId,
                        resourceId: attachment.resourceId,
                        eventKey: key,
                        response,
                      })
                    }
                  >
                    {responseLabels[response]}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : event.method === 'REQUEST' && !event.cancelled ? (
          <p className="calendar-response-unavailable">
            Respond from the calendar account this invitation was addressed to.
          </p>
        ) : null}
      </div>
    </section>
  );
}
export const CalendarMessage = memo(function CalendarMessage({
  attachments,
  context,
  services,
  loadAttachment,
}: {
  readonly attachments: readonly EmailAttachment[];
  readonly context: AttachmentMessageContext & { providerRevision: string };
  readonly services: CalendarReaderServices;
  readonly loadAttachment: LoadMessageAttachment;
}) {
  const calendars = useMemo(
    () => attachments.filter(isCalendarAttachment).slice(0, 5),
    [attachments],
  );
  const query = useQuery(
    {
      queryKey: [
        'email-reader',
        context.accountId,
        context.threadId,
        context.providerRevision,
        'calendar',
        context.messageId,
        calendars.map((a) => [a.resourceId, a.sizeBytes]),
      ],
      networkMode: 'always',
      enabled: calendars.length > 0,
      queryFn: async () => {
        const cards: {
          attachment: EmailAttachment;
          events: readonly CalendarInvitation[];
          error?: string;
        }[] = [];
        const seenEvents = new Set<string>();
        // Bounded sequential attachment reads avoid a new foreground download fan-out.
        for (const attachment of calendars) {
          try {
            if (attachment.sizeBytes > maximumCalendarBytes)
              throw new Error('Calendar attachment exceeds the preview limit.');
            const bytes = await loadAttachment(attachment, {
              cacheMode: 'read-write',
            });
            if (bytes.byteLength > maximumCalendarBytes)
              throw new Error('Calendar attachment exceeds the preview limit.');
            cards.push({
              attachment,
              events: parseCalendarInvitations(
                new TextDecoder('utf-8', { fatal: true }).decode(bytes),
              ).filter((event) => {
                // Gmail can include the same invite as both an inline MIME part
                // and a named attachment. Keep one card for identical events.
                const signature = JSON.stringify(event);
                if (seenEvents.has(signature)) return false;
                seenEvents.add(signature);
                return true;
              }),
            });
          } catch {
            cards.push({
              attachment,
              events: [],
              error:
                'Calendar details could not be loaded. You can save the original attachment or retry.',
            });
          }
        }
        return cards;
      },
    },
    services.cache.client,
  );
  useEffect(() => {
    services.cache.prune();
  }, [query.data, services.cache]);
  if (query.isPending)
    return (
      <p className="calendar-load-status" role="status">
        Loading calendar details…
      </p>
    );
  return (
    <>
      {query.data?.map((card) =>
        card.error ? (
          <div
            key={card.attachment.resourceId}
            className="calendar-load-status"
            role="alert"
          >
            <p>{card.error}</p>
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry calendar details
            </button>
          </div>
        ) : (
          card.events.map((event) => (
            <InvitationCard
              key={`${card.attachment.resourceId}:${calendarEventKey(event)}`}
              event={event}
              attachment={card.attachment}
              context={context}
              services={services}
            />
          ))
        ),
      )}
    </>
  );
});
