import {
  Button,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TimeZoneCombobox } from "../../tap-calendar/src/time-zone-combobox";
import { isSupportedTimeZone } from "../../tap-calendar/src/time-zone";
import {
  cancelPublicBookingManagement,
  loadPublicAvailability,
  loadPublicBookingManagement,
  PublicCalendarApiError,
  reschedulePublicBookingManagement,
} from "./api";
import { availabilityRefreshDelay, reconcileAvailabilitySelection } from "./availability";
import {
  PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION,
  PUBLIC_MANAGEMENT_RESCHEDULE_SCHEMA_VERSION,
  type PublicBookingAvailability,
  type PublicBookingManagement,
  type PublicBookingSlot,
} from "./contracts";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateInTimeZone,
  detectedTimeZone,
  monthStartForDate,
  parseCalendarDate,
  viewerBookingMonthBounds,
} from "./date";
import { TurnstileVerification } from "./turnstile";

const managementErrorMessage = (error: unknown): string =>
  error instanceof PublicCalendarApiError
    ? error.message
    : "TAP Calendar could not complete the request.";

function ManagementState({ title, message, loading = false, action }: {
  readonly title: string;
  readonly message: string;
  readonly loading?: boolean;
  readonly action?: React.ReactNode;
}) {
  return (
    <main className="public-state-page">
      <section className="public-state-card" aria-labelledby="management-state-title">
        <span className="public-state-icon" aria-hidden="true">
          {loading ? <RefreshCw className="is-spinning" /> : <CalendarClock />}
        </span>
        <h1 id="management-state-title">{title}</h1>
        <p>{message}</p>
        {action}
      </section>
    </main>
  );
}

const statusLabel = (status: PublicBookingManagement["status"]): string => ({
  confirmed: "Confirmed",
  pending: "Awaiting host approval",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Expired",
})[status];

function ManagementFooter() {
  return (
    <footer className="public-booking-footer">
      <a className="public-booking-powered" href="https://theaiplatform.app/" target="_blank" rel="noreferrer" aria-label="Powered by TAP — visit The AI Platform homepage (opens in a new tab)"><CalendarCheck2 aria-hidden="true" /> Powered by <strong>TAP</strong></a>
      <nav className="public-booking-footer-links" aria-label="Booking page links">
        <a href="https://theaiplatform.app/privacy" target="_blank" rel="noreferrer">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="mailto:abuse@theaiplatform.app">Report abuse</a>
      </nav>
    </footer>
  );
}

export function PublicBookingManagementApp({ token }: { readonly token: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [management, setManagement] = useState<PublicBookingManagement | null>(null);
  const [loading, setLoading] = useState(token !== null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"details" | "cancel" | "reschedule">("details");
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Keep the capability in memory, but remove it from the visible URL and the
    // current history entry as soon as React has captured it.
    if (globalThis.location.hash) {
      globalThis.history.replaceState(
        globalThis.history.state,
        "",
        `${globalThis.location.pathname}${globalThis.location.search}`,
      );
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void loadPublicBookingManagement(token, abort.signal)
      .then(value => {
        setManagement(value);
        globalThis.document.title = `Manage ${value.event.title} · TAP Calendar`;
      })
      .catch(reason => {
        if (!abort.signal.aborted) {
          setManagement(null);
          setError(managementErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [attempt, token]);

  const cancel = async () => {
    if (!token || !management || mutating) return;
    const requestId = cancelRequestIdRef.current ?? globalThis.crypto.randomUUID();
    cancelRequestIdRef.current = requestId;
    setMutating(true);
    setActionError(null);
    try {
      const next = await cancelPublicBookingManagement({
        token,
        request: {
          schemaVersion: PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION,
          requestId,
          expectedVersion: management.bookingVersion,
        },
      });
      cancelRequestIdRef.current = null;
      setManagement(next);
      setAction("details");
    } catch (reason) {
      const apiError = reason instanceof PublicCalendarApiError ? reason : null;
      if (apiError && !apiError.retryable) cancelRequestIdRef.current = null;
      if (apiError?.code === "booking_version_changed") setAttempt(value => value + 1);
      setActionError(managementErrorMessage(reason));
    } finally {
      setMutating(false);
    }
  };

  if (!token) {
    return <ManagementState title="Management link unavailable" message="Open the complete secure link from your booking confirmation." />;
  }
  if (loading) {
    return <ManagementState loading title="Loading your booking" message="Checking this secure management link…" />;
  }
  if (!management || error) {
    return <ManagementState
      title="Booking unavailable"
      message={error ?? "This management link is unavailable."}
      action={<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" /> Try again</Button>}
    />;
  }
  if (action === "reschedule" && management.reschedulePage) {
    return <ManagementReschedule
      token={token}
      management={management}
      page={management.reschedulePage}
      onBack={() => setAction("details")}
      onUpdated={next => {
        setManagement(next);
        setAction("details");
      }}
      onStale={() => setAttempt(value => value + 1)}
    />;
  }

  const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(management.event.startsAt));
  return (
    <main className="public-booking-page public-management-page">
      <div className="public-booking-shell">
        <section className="public-booking-card public-management-card" aria-labelledby="management-title">
          <div className="public-management-heading">
            <span className="public-management-icon" aria-hidden="true">
              {management.status === "cancelled" ? <X /> : <CalendarCheck2 />}
            </span>
            <span className="eyebrow">TAP Calendar</span>
            <h1 id="management-title">Manage your booking</h1>
            <span className="public-management-status" data-status={management.status}>
              {statusLabel(management.status)}
            </span>
          </div>

          <div className="public-management-details">
            <h2>{management.event.title}</h2>
            <p>with {management.host.displayName}</p>
            <dl>
              <div><dt><Clock3 aria-hidden="true" /> Date and time</dt><dd>{dateTime}</dd></div>
              <div><dt><Video aria-hidden="true" /> Location</dt><dd>{management.event.locationLabel}</dd></div>
              <div><dt>Guest</dt><dd>{management.guest.name} · {management.guest.email}</dd></div>
            </dl>
            {management.event.joinUrl && management.status === "confirmed"
              ? <Button asChild variant="outline"><a href={management.event.joinUrl} target="_blank" rel="noreferrer">Join meeting</a></Button>
              : null}
          </div>

          {action === "cancel" ? (
            <section className="public-management-confirm" aria-labelledby="cancel-booking-title">
              <AlertTriangle aria-hidden="true" />
              <div>
                <h2 id="cancel-booking-title">Cancel this booking?</h2>
                <p>The guest and host will be notified. This cannot be undone.</p>
                {actionError ? <p className="public-management-error" role="alert">{actionError}</p> : null}
                <div className="public-management-actions">
                  <Button type="button" variant="outline" disabled={mutating} onClick={() => setAction("details")}>Keep booking</Button>
                  <Button type="button" variant="destructive" disabled={mutating} onClick={() => void cancel()}>
                    {mutating ? "Cancelling…" : "Cancel booking"}
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <div className="public-management-actions">
              {management.actions.canReschedule
                ? <Button type="button" variant="outline" onClick={() => setAction("reschedule")}>Choose a new time</Button>
                : null}
              {management.actions.canCancel
                ? <Button type="button" variant="destructive" onClick={() => setAction("cancel")}>Cancel booking</Button>
                : null}
            </div>
          )}
        </section>
        <ManagementFooter />
      </div>
    </main>
  );
}

function ManagementReschedule({ token, management, page, onBack, onUpdated, onStale }: {
  readonly token: string;
  readonly management: PublicBookingManagement;
  readonly page: NonNullable<PublicBookingManagement["reschedulePage"]>;
  readonly onBack: () => void;
  readonly onUpdated: (value: PublicBookingManagement) => void;
  readonly onStale: () => void;
}) {
  const [viewerTimeZone, setViewerTimeZone] = useState(() => {
    const value = detectedTimeZone();
    return isSupportedTimeZone(value) ? value : "UTC";
  });
  const [visibleMonth, setVisibleMonth] = useState(() => monthStartForDate(
    calendarDateInTimeZone(new Date(), viewerTimeZone),
  ));
  const [availability, setAvailability] = useState<PublicBookingAvailability | null>(null);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicBookingSlot | null>(null);
  const selectedDateRef = useRef<string | null>(null);
  const selectedSlotRef = useRef<PublicBookingSlot | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void loadPublicAvailability({
      profileSlug: page.profileSlug,
      eventTypeSlug: page.eventTypeSlug,
      month: visibleMonth,
      viewerTimeZone,
      pageRevision: page.pageRevision,
      signal: abort.signal,
    }).then(next => {
      setAvailability(next);
      const reconciled = reconcileAvailabilitySelection(
        next,
        selectedDateRef.current,
        selectedSlotRef.current,
      );
      if (!reconciled.dateAvailable) {
        selectedDateRef.current = null;
        selectedSlotRef.current = null;
        setSelectedDate(null);
        setSelectedSlot(null);
      } else if (selectedSlotRef.current) {
        selectedSlotRef.current = reconciled.slot;
        setSelectedSlot(reconciled.slot);
      }
    }).catch(reason => {
      if (!abort.signal.aborted) setError(managementErrorMessage(reason));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return abort;
  }, [page, viewerTimeZone, visibleMonth]);

  useEffect(() => {
    const abort = load();
    return () => abort.abort();
  }, [availabilityAttempt, load]);
  useEffect(() => {
    if (!availability) return;
    const timeout = globalThis.setTimeout(
      () => setAvailabilityAttempt(value => value + 1),
      availabilityRefreshDelay(availability.expiresAt),
    );
    return () => globalThis.clearTimeout(timeout);
  }, [availability]);

  const datesWithSlots = useMemo(
    () => new Map((availability?.dates ?? []).map(date => [date.date, date.slots] as const)),
    [availability],
  );
  const monthDate = parseCalendarDate(visibleMonth);
  const monthEnd = addCalendarMonths(visibleMonth, 1);
  const gridStart = addCalendarDays(visibleMonth, -monthDate.getUTCDay());
  const dates = Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
  const { firstMonth, lastMonth } = viewerBookingMonthBounds(
    page.bookingWindow.firstDate,
    page.bookingWindow.lastDate,
  );
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const slotFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: viewerTimeZone, timeZoneName: "short" });
  const selectedSlots = selectedDate ? datesWithSlots.get(selectedDate) ?? [] : [];
  const changeMonth = (month: string) => {
    setVisibleMonth(month);
    selectedDateRef.current = null;
    selectedSlotRef.current = null;
    setSelectedDate(null);
    setSelectedSlot(null);
    setTurnstileToken(null);
    setTurnstileResetKey(value => value + 1);
    requestIdRef.current = null;
  };

  const submit = async () => {
    if (!selectedSlot || !turnstileToken || submitting) return;
    const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
    requestIdRef.current = requestId;
    setSubmitting(true);
    setError(null);
    try {
      const next = await reschedulePublicBookingManagement({
        token,
        request: {
          schemaVersion: PUBLIC_MANAGEMENT_RESCHEDULE_SCHEMA_VERSION,
          requestId,
          expectedVersion: management.bookingVersion,
          slotToken: selectedSlot.token,
          turnstileToken,
        },
      });
      requestIdRef.current = null;
      onUpdated(next);
    } catch (reason) {
      const apiError = reason instanceof PublicCalendarApiError ? reason : null;
      if (apiError && !apiError.retryable) requestIdRef.current = null;
      if (apiError?.code === "booking_version_changed") onStale();
      setError(managementErrorMessage(reason));
      setTurnstileToken(null);
      setTurnstileResetKey(value => value + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="public-booking-page public-management-page">
      <div className="public-booking-shell">
        <section className="public-booking-card public-management-reschedule" aria-labelledby="reschedule-title">
          <header>
            <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft data-icon="inline-start" /> Back</Button>
            <span className="eyebrow">Manage booking</span>
            <h1 id="reschedule-title">Choose a new time</h1>
            <p>{management.event.title} with {management.host.displayName}</p>
          </header>
          {error ? <p className="public-management-error" role="alert">{error}</p> : null}
          <nav className="public-booking-month-nav" aria-label="Reschedule month">
            <Button type="button" size="icon" variant="ghost" aria-label="Previous month" disabled={visibleMonth <= firstMonth} onClick={() => changeMonth(addCalendarMonths(visibleMonth, -1))}><ChevronLeft /></Button>
            <span className="public-booking-month-title">{monthFormatter.format(parseCalendarDate(visibleMonth))}</span>
            <Button type="button" size="icon" variant="ghost" aria-label="Next month" disabled={visibleMonth >= lastMonth} onClick={() => changeMonth(addCalendarMonths(visibleMonth, 1))}><ChevronRight /></Button>
          </nav>
          <div className="public-booking-calendar" aria-busy={loading}>
            <div className="public-booking-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day}>{day}</span>)}</div>
            <div className="public-booking-days">
              {dates.map(date => {
                const available = date >= visibleMonth && date < monthEnd && (datesWithSlots.get(date)?.length ?? 0) > 0;
                return <button
                  type="button"
                  className="public-booking-day"
                  key={date}
                  disabled={!available}
                  data-available={available}
                  data-outside-month={date < visibleMonth || date >= monthEnd}
                  aria-pressed={date === selectedDate}
                  onClick={() => {
                    selectedDateRef.current = date;
                    selectedSlotRef.current = null;
                    setSelectedDate(date);
                    setSelectedSlot(null);
                    setTurnstileToken(null);
                    setTurnstileResetKey(value => value + 1);
                    requestIdRef.current = null;
                  }}
                >{Number(date.slice(-2))}{available ? <i aria-hidden="true" /> : null}</button>;
              })}
            </div>
          </div>
          <div className="public-booking-timezone">
            <Globe2 aria-hidden="true" />
            <div className="public-booking-timezone-field">
              <TimeZoneCombobox label="Time zone" name="management-timezone" value={viewerTimeZone} onValueChange={value => {
                setViewerTimeZone(value);
                setVisibleMonth(monthStartForDate(calendarDateInTimeZone(new Date(), value)));
                selectedDateRef.current = null;
                selectedSlotRef.current = null;
                setSelectedDate(null);
                setSelectedSlot(null);
                setTurnstileToken(null);
                setTurnstileResetKey(current => current + 1);
                requestIdRef.current = null;
              }} />
            </div>
          </div>
          <section className="public-management-slot-panel" aria-label="Available times">
            {selectedDate ? selectedSlots.map(slot => <button
              type="button"
              className="public-booking-slot"
              data-selected={slot.start === selectedSlot?.start && slot.end === selectedSlot?.end}
              key={`${slot.start}\0${slot.end}`}
              onClick={() => {
                selectedSlotRef.current = slot;
                setSelectedSlot(slot);
                setTurnstileToken(null);
                setTurnstileResetKey(value => value + 1);
                requestIdRef.current = null;
              }}
            ><span>{slotFormatter.format(new Date(slot.start))}</span><CalendarCheck2 aria-hidden="true" /></button>) : <p>Select an available date.</p>}
          </section>
          {selectedSlot ? <TurnstileVerification siteKey={page.turnstileSiteKey} action="public_booking_reschedule" resetKey={turnstileResetKey} disabled={submitting} onTokenChange={setTurnstileToken} /> : null}
          <div className="public-management-actions">
            <Button type="button" size="lg" disabled={!selectedSlot || !turnstileToken || submitting} onClick={() => void submit()}>{submitting ? "Rescheduling…" : "Confirm new time"}</Button>
          </div>
        </section>
        <ManagementFooter />
      </div>
    </main>
  );
}
