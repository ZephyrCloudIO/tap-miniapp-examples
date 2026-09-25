import { EventResponseBadge, eventResponseClassName, eventResponseLabel } from "./attendee-response-badge";
import {
  CalendarDays,
  Link2,
  Users,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  allCalendars,
  visibleEvents,
  type CalendarEvent,
  type CalendarState,
  type CalendarView,
} from "./domain";
import {
  CALENDAR_HOUR_HEIGHT_PX,
  DEFAULT_CALENDAR_SCROLL_HOUR,
  calendarGridHourLabel,
  calendarLocalDate,
  timeGridEventLayout,
  timeGridNowPercentage,
} from "./calendar-time-grid";

interface WeekDay {
  readonly key: string;
  readonly weekday: string;
  readonly day: string;
  readonly today?: boolean;
}

const hours = Array.from({ length: 24 }, (_, index) => index);
const slotMinutes = Array.from({ length: 48 }, (_, index) => index * 30);

const slotStart = (day: string, minute: number): string =>
  `${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const eventDate = (event: CalendarEvent): string =>
  event.allDay ? event.start.slice(0, 10) : calendarLocalDate(event.start);

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

const parseDateKey = (value: string): Date =>
  new Date(`${value}T12:00:00.000Z`);

const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const startOfMondayWeek = (date: Date): Date => {
  const weekday = date.getUTCDay();
  return addDays(date, -(weekday === 0 ? 6 : weekday - 1));
};

const weekDays = (
  anchorDate: string,
  count: number,
  startAtAnchor = false,
): readonly WeekDay[] => {
  const anchor = parseDateKey(anchorDate);
  const start = startAtAnchor ? anchor : startOfMondayWeek(anchor);
  const today = dateKey(new Date());
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(start, index);
    return {
      key: dateKey(date),
      weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date),
      day: String(date.getUTCDate()),
      ...(dateKey(date) === today ? { today: true } : {}),
    };
  });
};

const formatTime = (iso: string): string => timeFormatter.format(new Date(iso));

const eventTime = (event: CalendarEvent): string =>
  event.allDay ? "All day" : `${formatTime(event.start)}–${formatTime(event.end)}`;

interface CalendarBoardProps {
  readonly state: CalendarState;
  readonly anchorDate: string;
  readonly onSelectEvent: (eventId: string) => void;
  readonly onSelectSlot: (start: string) => void;
}

export function CalendarBoard({ state, anchorDate, onSelectEvent, onSelectSlot }: CalendarBoardProps) {
  const events = useMemo(() => visibleEvents(state), [state]);
  const colors = useMemo(
    () => new Map(allCalendars(state).map(calendar => [calendar.id, calendar.color])),
    [state],
  );

  if (state.activeView === "month") {
    return (
      <MonthView anchorDate={anchorDate} events={events} colors={colors} onSelectEvent={onSelectEvent} onSelectSlot={onSelectSlot} />
    );
  }
  if (state.activeView === "agenda") {
    return (
      <AgendaView anchorDate={anchorDate} events={events} colors={colors} onSelectEvent={onSelectEvent} />
    );
  }
  if (state.activeView === "team") {
    return <TeamView anchorDate={anchorDate} events={events} colors={colors} />;
  }
  return (
    <TimeGrid
      view={state.activeView}
      anchorDate={anchorDate}
      events={events}
      colors={colors}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
    />
  );
}

function TimeGrid({
  view,
  anchorDate,
  events,
  colors,
  onSelectEvent,
  onSelectSlot,
}: {
  readonly view: Extract<CalendarView, "day" | "work-week" | "week">;
  readonly anchorDate: string;
  readonly events: readonly CalendarEvent[];
  readonly colors: ReadonlyMap<string, string>;
  readonly onSelectEvent: (eventId: string) => void;
  readonly onSelectSlot: (start: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focusedMinute, setFocusedMinute] = useState(9 * 60);
  const days: readonly WeekDay[] =
    view === "day"
      ? weekDays(anchorDate, 1, true)
      : view === "week"
        ? weekDays(anchorDate, 7)
        : weekDays(anchorDate, 5);
  const nowTop = timeGridNowPercentage(new Date());
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.scrollTop = DEFAULT_CALENDAR_SCROLL_HOUR * CALENDAR_HOUR_HEIGHT_PX;
  }, []);
  return (
    <div className="time-grid-wrap" aria-label={`${view} calendar`} ref={wrapRef}>
      <div
        className="time-grid"
        role="grid"
        style={{ "--calendar-columns": days.length } as React.CSSProperties}
      >
        <div className="time-grid-corner" aria-hidden="true" />
        <div className="day-headings" role="row">
          {days.map(day => (
            <div
              className={`day-heading${day.today ? " is-today" : ""}`}
              role="columnheader"
              key={day.key}
            >
              <span>{day.weekday}</span>
              <strong>{day.day}</strong>
            </div>
          ))}
        </div>
        <div className="all-day-label" aria-hidden="true">All day</div>
        <div className="all-day-columns" aria-label="All-day events">
          {days.map(day => (
            <div className="all-day-column" key={day.key}>
              {events
                .filter(event => event.allDay === true && event.start.slice(0, 10) <= day.key && event.end.slice(0, 10) > day.key)
                .slice(0, 3)
                .map(event => (
                  <button
                    type="button"
                    key={event.id}
                    style={{ "--event-color": colors.get(event.calendarId) ?? "#6d5dfc" } as React.CSSProperties}
                    onClick={() => onSelectEvent(event.id)}
                    title={`${event.title}, ${eventResponseLabel(event)}`}
                    className={eventResponseClassName(event)}
                    aria-label={`${event.title}, All day, ${eventResponseLabel(event)}`}
                  >
                    <span className="rsvp-event-title">{event.title}</span> <EventResponseBadge event={event} compact />
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="time-labels" aria-hidden="true">
          {hours.map(hour => (
            <span key={hour}>{calendarGridHourLabel(hour)}</span>
          ))}
        </div>
        <div className="day-columns" role="row">
          {days.map(day => (
            <div className="day-column" role="gridcell" key={day.key}>
              {slotMinutes.map(minute => {
                const start = slotStart(day.key, minute);
                const label = `Schedule on ${fullDateFormatter.format(new Date(start))} at ${formatTime(start)}`;
                return (
                  <button
                    className="calendar-time-slot"
                    type="button"
                    key={minute}
                    aria-label={label}
                    title={label}
                    tabIndex={minute === focusedMinute ? 0 : -1}
                    onFocus={() => setFocusedMinute(minute)}
                    onClick={() => onSelectSlot(start)}
                    onKeyDown={event => {
                      const nextMinute = event.key === "ArrowDown" ? Math.min(1410, minute + 30)
                        : event.key === "ArrowUp" ? Math.max(0, minute - 30)
                          : event.key === "Home" ? 0
                            : event.key === "End" ? 1410 : null;
                      if (nextMinute === null) return;
                      event.preventDefault();
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>(".calendar-time-slot")[nextMinute / 30]?.focus();
                    }}
                  />
                );
              })}
              {events
                .filter(event => event.allDay !== true && eventDate(event) === day.key)
                .map(event => {
                  const layout = timeGridEventLayout(event);
                  const color = colors.get(event.calendarId) ?? "#6d5dfc";
                  return (
                    <button
                      className={`calendar-event event-${event.kind} ${eventResponseClassName(event)}`}
                      key={event.id}
                      style={{
                        top: `${layout.topPercentage}%`,
                        height: `${layout.heightPercentage}%`,
                        "--event-color": color,
                      } as React.CSSProperties}
                      type="button"
                      onClick={() => onSelectEvent(event.id)}
                      aria-label={`${event.title}, ${eventTime(event)}, ${eventResponseLabel(event)}`}
                    >
                      <strong className="rsvp-event-title">{event.title}</strong>
                      <span>{eventTime(event)} <EventResponseBadge event={event} compact /></span>
                      {event.source ? <small><Link2 size={10} /> {event.source.label}</small> : null}
                    </button>
                  );
                })}
              {day.today ? <div className="now-line" aria-label="Current time" style={{ top: `${nowTop}%` }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgendaView({
  anchorDate,
  events,
  colors,
  onSelectEvent,
}: {
  readonly anchorDate: string;
  readonly events: readonly CalendarEvent[];
  readonly colors: ReadonlyMap<string, string>;
  readonly onSelectEvent: (eventId: string) => void;
}) {
  const rangeStart = parseDateKey(anchorDate).getTime();
  const rangeEnd = addDays(parseDateKey(anchorDate), 30).getTime();
  const ordered = [...events]
    .filter(event => {
      const startsAt = parseDateKey(eventDate(event)).getTime();
      return startsAt >= rangeStart && startsAt < rangeEnd;
    })
    .sort((left, right) => left.start.localeCompare(right.start));
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of ordered) {
    const day = eventDate(event);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  return (
    <div className="agenda-view">
      {groups.size === 0 ? <EmptyCalendarState /> : null}
      {[...groups.entries()].map(([day, dayEvents]) => (
        <section className="agenda-day" key={day}>
          <header>
            <span>{fullDateFormatter.format(new Date(`${day}T12:00:00`))}</span>
            <strong>{dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}</strong>
          </header>
          <div>
            {dayEvents.map(event => (
              <button type="button" key={event.id} className={eventResponseClassName(event)} style={{ "--event-color": colors.get(event.calendarId) ?? "#6d5dfc" } as React.CSSProperties} onClick={() => onSelectEvent(event.id)} aria-label={`${event.title}, ${eventTime(event)}, ${eventResponseLabel(event)}`}>
                <span
                  className="event-dot"
                  style={{ background: colors.get(event.calendarId) ?? "#6d5dfc" }}
                  aria-hidden="true"
                />
                <time>{event.allDay ? "All day" : formatTime(event.start)}</time>
                <span className="agenda-copy">
                  <strong className="rsvp-event-title">{event.title}</strong>
                  <small>{eventTime(event)} · {event.kind.replace("-", " ")}</small>
                </span>
                <EventResponseBadge event={event} showBookingStatus />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MonthView({
  anchorDate,
  events,
  colors,
  onSelectEvent,
  onSelectSlot,
}: {
  readonly anchorDate: string;
  readonly events: readonly CalendarEvent[];
  readonly colors: ReadonlyMap<string, string>;
  readonly onSelectEvent: (eventId: string) => void;
  readonly onSelectSlot: (start: string) => void;
}) {
  const anchor = parseDateKey(anchorDate);
  const firstOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getUTCDay());
  const currentMonth = anchor.getUTCMonth();
  const today = dateKey(new Date());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === currentMonth,
      today: key === today,
    };
  });
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(anchor);
  return (
    <div className="month-view" role="grid" aria-label={monthLabel}>
      <div className="month-weekdays" role="row">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
          <span role="columnheader" key={day}>{day}</span>
        ))}
      </div>
      <div className="month-cells">
        {cells.map(cell => (
          <div
            className={`month-cell${cell.currentMonth ? "" : " outside"}${cell.today ? " today" : ""}`}
            role="gridcell"
            key={cell.key}
          >
            <button
              className="month-create-event"
              type="button"
              aria-label={`Schedule on ${fullDateFormatter.format(new Date(`${cell.key}T09:00`))}`}
              onClick={() => onSelectSlot(slotStart(cell.key, 9 * 60))}
            />
            <span className="month-number">{cell.day}</span>
            {events
              .filter(event => eventDate(event) === cell.key)
              .slice(0, 3)
              .map(event => (
                <button
                  type="button"
                  key={event.id}
                  onClick={() => onSelectEvent(event.id)}
                  className={eventResponseClassName(event)}
                  aria-label={`${event.title}, ${eventTime(event)}, ${eventResponseLabel(event)}`}
                  style={{ "--event-color": colors.get(event.calendarId) ?? "#6d5dfc" } as React.CSSProperties}
                >
                  <span>{event.allDay ? "All day" : formatTime(event.start)}</span> <span className="rsvp-event-title">{event.title}</span> <EventResponseBadge event={event} compact />
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamView({
  anchorDate: _anchorDate,
  events: _events,
  colors: _colors,
}: {
  readonly anchorDate: string;
  readonly events: readonly CalendarEvent[];
  readonly colors: ReadonlyMap<string, string>;
}) {
  return (
    <div className="team-view">
      <div className="team-roster-empty">
        <Users size={28} />
        <strong>Choose a TAP channel to compare availability</strong>
        <span>The current host SDK does not expose a channel participant roster yet, so TAP Calendar will not invent one.</span>
      </div>
    </div>
  );
}

export function EmptyCalendarState({
  title = "No events in this range",
  description = "Events will appear after a visible calendar syncs.",
}: {
  readonly title?: string;
  readonly description?: string;
} = {}) {
  return (
    <div className="empty-calendar">
      <CalendarDays size={28} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
