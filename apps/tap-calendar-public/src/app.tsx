import { useFunnelTracking } from "./use-funnel-tracking";
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  RefreshCw,
  ShieldCheck,
  Video,
} from "lucide-react";
import * as React from "react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { TimeZoneCombobox } from "../../tap-calendar/src/time-zone-combobox";
import { isSupportedTimeZone } from "../../tap-calendar/src/time-zone";
import {
  createPublicBooking,
  loadPublicAvailability,
  loadPublicBookingPage,
  loadPublicBookingProfile,
  PublicCalendarApiError,
} from "./api";
import {
  availabilityRefreshDelay,
  reconcileAvailabilitySelection,
} from "./availability";
import type {
  PublicBookingAvailability,
  PublicBookingPage,
  PublicBookingProfile,
  PublicBookingResult,
  PublicBookingSlot,
} from "./contracts";
import { PUBLIC_BOOKING_SCHEMA_VERSION } from "./contracts";
import { publicManagementTokenFromHash } from "./contracts";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateInTimeZone,
  detectedTimeZone,
  monthStartForDate,
  parseCalendarDate,
  viewerBookingMonthBounds,
} from "./date";
import { normalizePublicBookingDetails } from "../../tap-calendar/src/public-booking-details";
import { PublicBookingExtraFields, PublicBookingPrivacyNotice } from "../../tap-calendar/src/public-booking-fields";
import { TurnstileVerification } from "./turnstile";
import { PublicBookingManagementApp } from "./management";

export interface PublicPageRoute {
  readonly profileSlug: string;
  readonly eventTypeSlug: string;
}

export type PublicAppRoute =
  | { readonly kind: "management" }
  | { readonly kind: "profile"; readonly profileSlug: string }
  | ({ readonly kind: "booking" } & PublicPageRoute)
  | { readonly kind: "not-found" };

export function parsePublicRoute(pathname: string): PublicAppRoute {
  if (pathname === "/manage") return { kind: "management" };
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 1 && parts.length !== 2) return { kind: "not-found" };
  try {
    const profileSlug = decodeURIComponent(parts[0] ?? "");
    if (!profileSlug || (parts.length === 1 && profileSlug === "manage")) {
      return { kind: "not-found" };
    }
    if (parts.length === 1) return { kind: "profile", profileSlug };
    const eventTypeSlug = decodeURIComponent(parts[1] ?? "");
    return eventTypeSlug
      ? { kind: "booking", profileSlug, eventTypeSlug }
      : { kind: "not-found" };
  } catch {
    return { kind: "not-found" };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof PublicCalendarApiError) return error.message;
  return "TAP Calendar could not complete the request.";
}

function setCanonicalUrl(url: string): () => void {
  const previousTitle = globalThis.document.title;
  const existing = globalThis.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const link = existing ?? globalThis.document.createElement("link");
  const previousHref = existing?.href ?? null;
  link.rel = "canonical";
  link.href = url;
  if (!existing) globalThis.document.head.append(link);
  return () => {
    globalThis.document.title = previousTitle;
    if (existing && previousHref) existing.href = previousHref;
    else link.remove();
  };
}

export function PublicBookingApp() {
  const route = useMemo(() => parsePublicRoute(globalThis.location.pathname), []);

  if (route.kind === "management") {
    return <PublicBookingManagementApp token={publicManagementTokenFromHash(globalThis.location.hash)} />;
  }
  if (route.kind === "profile") {
    return <PublicProfileRoute profileSlug={route.profileSlug} />;
  }
  if (route.kind === "not-found") {
    return <PublicPageState title="Booking page not found" message="Check the booking link and try again." />;
  }
  return <PublicBookingRoute route={route} />;
}

function PublicBookingRoute({ route }: { readonly route: PublicPageRoute }) {
  const [visitId] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadPublishedPage = useCallback(() => {
    setLoading(true);
    setError(null);
    setPage(null);
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void loadPublicBookingPage(route.profileSlug, route.eventTypeSlug, abort.signal, visitId)
      .then(next => {
        setPage(next);
        globalThis.document.title = `${next.eventType.title} with ${next.profile.displayName} · TAP Calendar`;
      })
      .catch(reason => {
        if (abort.signal.aborted) return;
        setPage(null);
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [attempt, route, visitId]);

  useEffect(() => page ? setCanonicalUrl(page.canonicalUrl) : undefined, [page]);

  if (loading) {
    return <PublicPageState loading title="Loading booking page" message="Checking this TAP booking link…" />;
  }
  if (!page || error) {
    return <PublicPageState
      title="Booking page unavailable"
      message={error ?? "This booking page is unavailable."}
      action={<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" /> Try again</Button>}
    />;
  }
  return (
    <BookingExperience
      visitId={visitId}
      route={route}
      page={page}
      onPublishedPageChanged={reloadPublishedPage}
    />
  );
}

function PublicProfileRoute({ profileSlug }: { readonly profileSlug: string }) {
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<PublicBookingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void loadPublicBookingProfile(profileSlug, abort.signal)
      .then(next => {
        setProfile(next);
        globalThis.document.title = `${next.profile.displayName} · TAP Calendar`;
      })
      .catch(reason => {
        if (abort.signal.aborted) return;
        setProfile(null);
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [attempt, profileSlug]);

  useEffect(() => profile ? setCanonicalUrl(profile.canonicalUrl) : undefined, [profile]);

  if (loading) {
    return <PublicPageState loading title="Loading booking profile" message="Checking this TAP booking link…" />;
  }
  if (!profile || error) {
    return <PublicPageState
      title="Booking profile unavailable"
      message={error ?? "This booking profile is unavailable."}
      action={<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" /> Try again</Button>}
    />;
  }
  return <PublicProfileScreen profile={profile} />;
}

export function PublicProfileScreen({ profile }: { readonly profile: PublicBookingProfile }) {
  const hasEventTypes = profile.eventTypes.length > 0;
  return (
    <main className="public-booking-page public-profile-page">
      <div className="public-booking-shell public-profile-shell">
        <section className="public-profile-card" aria-labelledby="public-profile-title">
          <header className="public-profile-header">
            <span className="public-profile-avatar" aria-hidden="true">{profile.profile.initials}</span>
            <span className="eyebrow">TAP Calendar</span>
            <h1 id="public-profile-title">{profile.profile.displayName}</h1>
            <p>{hasEventTypes
              ? "Choose a booking option to find a time that works for you."
              : "This is their official TAP Calendar booking page."}</p>
          </header>

          {hasEventTypes ? (
            <section className="public-profile-options" aria-labelledby="public-profile-options-title">
              <div className="public-profile-options-heading">
                <h2 id="public-profile-options-title">Book a meeting</h2>
                <span>{profile.eventTypes.length} {profile.eventTypes.length === 1 ? "option" : "options"}</span>
              </div>
              <ul className="public-profile-list">
                {profile.eventTypes.map(eventType => (
                  <li key={eventType.eventTypeSlug}>
                    <article className="public-profile-option">
                      <div className="public-profile-option-copy">
                        <h3>{eventType.title}</h3>
                        {eventType.description ? <p>{eventType.description}</p> : null}
                        <ul className="public-profile-option-meta" aria-label={`${eventType.title} details`}>
                          <li><Clock3 aria-hidden="true" /> {eventType.durationMinutes} minutes</li>
                          <li><Globe2 aria-hidden="true" /> {eventType.locationLabel}</li>
                          {eventType.approvalRequired ? <li><ShieldCheck aria-hidden="true" /> Approval required</li> : null}
                        </ul>
                      </div>
                      <Button asChild variant="outline">
                        <a href={eventType.canonicalUrl} aria-label={`View available times for ${eventType.title}`}>
                          View times <ArrowRight data-icon="inline-end" aria-hidden="true" />
                        </a>
                      </Button>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="public-profile-empty" aria-labelledby="public-profile-empty-title">
              <span aria-hidden="true"><CalendarClock /></span>
              <div>
                <h2 id="public-profile-empty-title">No booking options yet</h2>
                <p>{profile.profile.displayName} hasn’t added any public meeting types. Check back later.</p>
              </div>
            </section>
          )}
        </section>
        <PublicFooter />
      </div>
    </main>
  );
}

function PublicPageState({ title, message, loading = false, action }: {
  readonly title: string;
  readonly message: string;
  readonly loading?: boolean;
  readonly action?: React.ReactNode;
}) {
  return (
    <main className="public-state-page">
      <section className="public-state-card" aria-labelledby="public-state-title">
        <span className="public-state-icon" aria-hidden="true">
          {loading ? <RefreshCw className="is-spinning" /> : <CalendarClock />}
        </span>
        <h1 id="public-state-title">{title}</h1>
        <p>{message}</p>
        {action}
        <PoweredByTap />
      </section>
    </main>
  );
}

function BookingExperience({ route, page, visitId, onPublishedPageChanged }: {
  readonly visitId: string;
  readonly route: PublicPageRoute;
  readonly page: PublicBookingPage;
  readonly onPublishedPageChanged: () => void;
}) {
  const [policyNow] = useState(() => Date.now());
  const [viewerTimeZone, setViewerTimeZone] = useState(() => {
    const detected = detectedTimeZone();
    return isSupportedTimeZone(detected) ? detected : "UTC";
  });
  const viewerToday = calendarDateInTimeZone(new Date(policyNow), viewerTimeZone);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStartForDate(viewerToday));
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [availability, setAvailability] = useState<PublicBookingAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [step, setStep] = useState<"date" | "slot" | "details" | "success">("date");
  useFunnelTracking(route.profileSlug, route.eventTypeSlug, visitId, step);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicBookingSlot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [additionalGuests, setAdditionalGuests] = useState<{ id: string; email: string }[]>([]);
  const [retryRequired, setRetryRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicBookingResult | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const selectedDateRef = useRef(selectedDate);
  const selectedSlotRef = useRef(selectedSlot);
  selectedDateRef.current = selectedDate;
  selectedSlotRef.current = selectedSlot;

  const handlePublishedPageChanged = useCallback(() => {
    selectedDateRef.current = null;
    selectedSlotRef.current = null;
    requestIdRef.current = null;
    setAvailability(null);
    setAvailabilityError(null);
    setSelectedDate(null);
    setSelectedSlot(null);
    setTurnstileToken(null);
    setBookingError(null);
    setResult(null);
    setStep("date");
    onPublishedPageChanged();
  }, [onPublishedPageChanged]);

  useEffect(() => {
    const abort = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    void loadPublicAvailability({
      profileSlug: route.profileSlug,
      eventTypeSlug: route.eventTypeSlug,
      month: visibleMonth,
      viewerTimeZone,
      pageRevision: page.pageRevision,
      signal: abort.signal,
    }).then(next => {
      if (next.pageRevision !== page.pageRevision) {
        handlePublishedPageChanged();
        return;
      }
      setAvailability(next);
      const currentDate = selectedDateRef.current;
      const currentSlot = selectedSlotRef.current;
      const reconciliation = reconcileAvailabilitySelection(next, currentDate, currentSlot);
      // Keep an unresolved booking on its original time, while accepting a fresh
      // proof for that same time if it is still available.
      if (requestIdRef.current) {
        if (currentSlot && reconciliation.slot) {
          selectedSlotRef.current = reconciliation.slot;
          setSelectedSlot(reconciliation.slot);
        }
        return;
      }
      if (currentDate && !reconciliation.dateAvailable) {
        selectedDateRef.current = null;
        selectedSlotRef.current = null;
        requestIdRef.current = null;
        setSelectedDate(null);
        setSelectedSlot(null);
        setTurnstileToken(null);
        setStep("date");
      } else if (currentSlot && !reconciliation.slot) {
        selectedSlotRef.current = null;
        requestIdRef.current = null;
        setSelectedSlot(null);
        setTurnstileToken(null);
        setBookingError("That time is no longer available. Choose another time.");
        setStep(currentDate ? "slot" : "date");
      } else if (currentSlot && reconciliation.slot?.token !== currentSlot.token) {
        selectedSlotRef.current = reconciliation.slot;
        setSelectedSlot(reconciliation.slot);
      }
    }).catch(reason => {
      if (abort.signal.aborted) return;
      if (reason instanceof PublicCalendarApiError && reason.code === "public_page_changed") {
        handlePublishedPageChanged();
        return;
      }
      setAvailability(null);
      setAvailabilityError(errorMessage(reason));
    }).finally(() => {
      if (!abort.signal.aborted) setAvailabilityLoading(false);
    });
    return () => abort.abort();
  }, [
    availabilityAttempt,
    handlePublishedPageChanged,
    page.pageRevision,
    route.eventTypeSlug,
    route.profileSlug,
    viewerTimeZone,
    visibleMonth,
  ]);

  useEffect(() => {
    if (!availability || step === "success") return;
    const timeout = globalThis.setTimeout(
      () => setAvailabilityAttempt(value => value + 1),
      availabilityRefreshDelay(availability.expiresAt),
    );
    return () => globalThis.clearTimeout(timeout);
  }, [availability?.expiresAt, availability?.pageRevision, step]);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = globalThis.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => globalThis.cancelAnimationFrame(frame);
  }, [step]);

  const visibleMonthDate = parseCalendarDate(visibleMonth);
  const monthEnd = addCalendarMonths(visibleMonth, 1);
  const gridStart = addCalendarDays(visibleMonth, -visibleMonthDate.getUTCDay());
  const dates = Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
  const datesWithSlots = useMemo(
    () => new Map((availability?.dates ?? []).map(date => [date.date, date.slots] as const)),
    [availability],
  );
  const slots = selectedDate ? datesWithSlots.get(selectedDate) ?? [] : [];
  const { firstMonth, lastMonth } = viewerBookingMonthBounds(
    page.bookingWindow.firstDate,
    page.bookingWindow.lastDate,
  );
  const canPageBackward = visibleMonth > firstMonth;
  const canPageForward = visibleMonth < lastMonth;
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }), []);
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }), []);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: viewerTimeZone,
    timeZoneName: "short",
  }), [viewerTimeZone]);

  const changeViewerTimeZone = (next: string) => {
    const nextToday = calendarDateInTimeZone(new Date(policyNow), next);
    setViewerTimeZone(next);
    setVisibleMonth(monthStartForDate(nextToday));
    setSelectedDate(null);
    setSelectedSlot(null);
    setBookingError(null);
    requestIdRef.current = null;
    setStep("date");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSlot || !turnstileToken || submitting) return;
    let details;
    try {
      details = normalizePublicBookingDetails({
        notes,
        additionalGuests: additionalGuests.map(guest => guest.email.trim()).filter(Boolean),
      }, email);
    } catch (reason) {
      setBookingError((reason as Error).message);
      return;
    }
    const requestId = requestIdRef.current ?? globalThis.crypto.randomUUID();
    requestIdRef.current = requestId;
    setSubmitting(true);
    setBookingError(null);
    try {
      const next = await createPublicBooking({
        profileSlug: route.profileSlug,
        eventTypeSlug: route.eventTypeSlug,
        request: {
          schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
          requestId,
          visitId,
          slotToken: selectedSlot.token,
          guest: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
          },
          ...details,
          turnstileToken,
        },
      });
      setResult(next);
      setStep("success");
    } catch (reason) {
      const apiError = reason instanceof PublicCalendarApiError ? reason : null;
      if (apiError?.code === "public_page_changed") {
        handlePublishedPageChanged();
        return;
      }
      // Network loss and malformed/truncated success responses are ambiguous:
      // the server may already have committed the booking. Retain the same
      // request ID so a guest retry remains idempotent. Only a definitive
      // application rejection can safely rotate it.
      if (apiError && !apiError.retryable) {
        requestIdRef.current = null;
        setRetryRequired(false);
      } else {
        setRetryRequired(true);
      }
      setBookingError(errorMessage(reason));
      setTurnstileToken(null);
      setTurnstileResetKey(value => value + 1);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "success" && result) {
    return (
      <main className="public-booking-page">
        <div className="public-booking-shell">
          <div className="public-booking-card public-booking-card-success" data-step="success">
            <section className="booking-success public-booking-success" aria-labelledby="public-booking-success-title">
              <span aria-hidden="true"><Check /></span>
              <h1 ref={stepHeadingRef} tabIndex={-1} id="public-booking-success-title">
                {result.status === "pending" ? "Your request is pending" : "You’re booked"}
              </h1>
              <p>{result.status === "pending"
                ? `${page.profile.displayName} will review your request. Keep the secure management link below.`
                : "Your meeting is confirmed. Keep the secure management link below in case plans change."}</p>
              <div className="public-booking-confirmation">
                <strong>{page.eventType.title}</strong>
                <span>{dateTimeFormatter.format(new Date(result.startsAt))}</span>
                <span>{page.eventType.locationLabel}</span>
              </div>
              <div className="public-booking-success-actions">
                <Button asChild size="lg"><a href={result.managementUrl}>Manage booking</a></Button>
                <Button type="button" variant="outline" size="lg" onClick={onPublishedPageChanged}>
                  Book another meeting
                </Button>
              </div>
            </section>
          </div>
          <PublicFooter />
        </div>
      </main>
    );
  }

  return (
    <main className="public-booking-page">
      <div className="public-booking-shell">
        <div className="public-booking-card" data-step={step} aria-labelledby="public-booking-title">
          <aside className="public-booking-info">
            <div className="public-booking-host">
              <span className="public-booking-avatar" aria-hidden="true">{page.profile.initials}</span>
              <strong>{page.profile.displayName}</strong>
            </div>
            <h1 id="public-booking-title" className="public-booking-title">{page.eventType.title}</h1>
            {page.eventType.hosts ? <p className="public-booking-description">With {page.eventType.hosts.map(host => host.displayName).join(" and ")}. Every host attends.</p> : null}
            {page.eventType.description ? <p className="public-booking-description">{page.eventType.description}</p> : null}
            <ul className="public-booking-meta">
              <li><Clock3 aria-hidden="true" /><span>{page.eventType.durationMinutes} minutes</span></li>
              <li><Video aria-hidden="true" /><span>{page.eventType.locationLabel}</span></li>
              {page.eventType.approvalRequired ? <li><ShieldCheck aria-hidden="true" /><span>Host approval required</span></li> : null}
            </ul>
          </aside>

          <section className="public-booking-main">
            {step === "date" ? (
              <section className="public-booking-date-step" aria-labelledby="public-booking-date-heading">
                <header className="public-booking-step-header">
                  <h2 ref={stepHeadingRef} tabIndex={-1} id="public-booking-date-heading">Select a Date &amp; Time</h2>
                </header>
                {availabilityError ? <InlineError message={availabilityError} /> : null}
                <nav className="public-booking-month-nav" aria-label="Booking month">
                  <button type="button" className="public-booking-month-button" aria-label="Previous month" disabled={!canPageBackward} onClick={() => {
                    setVisibleMonth(addCalendarMonths(visibleMonth, -1));
                    setSelectedDate(null);
                    setSelectedSlot(null);
                  }}><ChevronLeft aria-hidden="true" /></button>
                  <strong className="public-booking-month-title">{monthFormatter.format(visibleMonthDate)}</strong>
                  <button type="button" className="public-booking-month-button" aria-label="Next month" disabled={!canPageForward} onClick={() => {
                    setVisibleMonth(addCalendarMonths(visibleMonth, 1));
                    setSelectedDate(null);
                    setSelectedSlot(null);
                  }}><ChevronRight aria-hidden="true" /></button>
                </nav>
                <div className="public-booking-calendar" aria-label={monthFormatter.format(visibleMonthDate)} aria-busy={availabilityLoading}>
                  <div className="public-booking-weekdays" aria-hidden="true">
                    {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map(day => <span key={day}>{day}</span>)}
                  </div>
                  <div className="public-booking-days">
                    {dates.map(date => {
                      const parsed = parseCalendarDate(date);
                      const inVisibleMonth = date >= visibleMonth && date < monthEnd;
                      const selectable = !availabilityLoading && inVisibleMonth && (datesWithSlots.get(date)?.length ?? 0) > 0;
                      const label = dateFormatter.format(parsed);
                      return (
                        <button
                          type="button"
                          className="public-booking-day"
                          key={date}
                          aria-label={selectable ? `${label}, view available times` : `${label}, unavailable`}
                          aria-current={date === viewerToday ? "date" : undefined}
                          data-today={date === viewerToday}
                          data-outside-month={!inVisibleMonth}
                          data-available={selectable}
                          disabled={!selectable}
                          onClick={() => {
                            setSelectedDate(date);
                            setSelectedSlot(null);
                            setBookingError(null);
                            requestIdRef.current = null;
                            setStep("slot");
                          }}
                        ><span>{parsed.getUTCDate()}</span>{selectable ? <i aria-hidden="true" /> : null}</button>
                      );
                    })}
                  </div>
                </div>
                {availabilityLoading ? (
                  <div className="public-booking-calendar-status" role="status"><RefreshCw className="is-spinning" aria-hidden="true" /><span>Checking calendar availability…</span></div>
                ) : availabilityError ? (
                  <div className="public-booking-calendar-status"><Button type="button" variant="ghost" size="sm" onClick={() => setAvailabilityAttempt(value => value + 1)}><RefreshCw data-icon="inline-start" /> Try again</Button></div>
                ) : datesWithSlots.size === 0 ? (
                  <div className="public-booking-calendar-status" role="status"><CalendarClock aria-hidden="true" /><span>No dates are available this month.</span></div>
                ) : null}
                <div className="public-booking-timezone">
                  <Globe2 aria-hidden="true" />
                  <TimeZoneCombobox
                    className="public-booking-timezone-field"
                    label="Viewer time zone"
                    name="public-booking-timezone"
                    value={viewerTimeZone}
                    onValueChange={changeViewerTimeZone}
                    referenceInstant={Date.parse(`${visibleMonth}T12:00:00.000Z`)}
                    description="All dates and times are shown in this time zone."
                    required
                  />
                </div>
              </section>
            ) : step === "slot" && selectedDate ? (
              <section className="public-booking-slots-pane" aria-labelledby="public-booking-slots-heading">
                <button type="button" className="public-booking-back" onClick={() => setStep("date")}><ArrowLeft aria-hidden="true" /> Back to calendar</button>
                <header className="public-booking-step-header">
                  <span className="eyebrow">Available times</span>
                  <h2 ref={stepHeadingRef} tabIndex={-1} id="public-booking-slots-heading">{dateFormatter.format(parseCalendarDate(selectedDate))}</h2>
                  <p>Times are shown in {viewerTimeZone}.</p>
                </header>
                {bookingError ? <InlineError message={bookingError} /> : null}
                <div className="public-booking-slots-list">
                  {slots.map(slot => (
                    <button type="button" key={slot.token} className="public-booking-slot" data-selected={selectedSlot?.token === slot.token} aria-pressed={selectedSlot?.token === slot.token} onClick={() => {
                      setSelectedSlot(slot);
                      setBookingError(null);
                      requestIdRef.current = null;
                    }}><span>{dateTimeFormatter.format(new Date(slot.start))}</span>{selectedSlot?.token === slot.token ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button>
                  ))}
                  {slots.length === 0 ? <div className="public-booking-empty" role="status"><CalendarClock /><strong>No times on this date</strong><span>Choose another available date.</span></div> : null}
                </div>
                <div className="public-booking-actions"><Button type="button" size="lg" disabled={!selectedSlot} onClick={() => setStep("details")}>Continue</Button></div>
              </section>
            ) : (
              <form className="public-booking-details" onSubmit={submit}>
                <button type="button" className="public-booking-back" disabled={submitting || retryRequired} onClick={() => setStep("slot")}><ArrowLeft aria-hidden="true" /> Choose another time</button>
                <header className="public-booking-step-header">
                  <span className="eyebrow">Your details</span>
                  <h2 ref={stepHeadingRef} tabIndex={-1}>Almost there</h2>
                  <p>Your details are shared with the host to arrange this meeting.</p>
                </header>
                {selectedSlot ? <div className="public-booking-selected-time"><CalendarCheck2 aria-hidden="true" /><span><strong>{dateTimeFormatter.format(new Date(selectedSlot.start))}</strong><small>{page.eventType.durationMinutes} minutes · {page.eventType.locationLabel}</small></span></div> : null}
                {bookingError ? <InlineError message={bookingError} /> : null}
                {retryRequired ? <p className="public-booking-retry-notice" role="status">Your booking may already be reserved. Please retry with the same details to confirm its status.</p> : null}
                <FieldGroup className="public-booking-fields">
                  <Field>
                    <FieldLabel htmlFor="public-booking-name">Name</FieldLabel>
                    <Input id="public-booking-name" name="name" autoComplete="name" value={name} maxLength={160} required disabled={submitting || retryRequired} onChange={event => setName(event.currentTarget.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="public-booking-email">Email</FieldLabel>
                    <Input id="public-booking-email" name="email" type="email" autoComplete="email" spellCheck={false} value={email} maxLength={320} required disabled={submitting || retryRequired} onChange={event => setEmail(event.currentTarget.value)} />
                    <FieldDescription>We send booking updates and the secure management link here.</FieldDescription>
                  </Field>
                  <PublicBookingExtraFields notes={notes} additionalGuests={additionalGuests} disabled={submitting || retryRequired} onNotesChange={setNotes} onGuestsChange={setAdditionalGuests} />
                </FieldGroup>
                <TurnstileVerification siteKey={page.turnstile.siteKey} action="public_booking" resetKey={turnstileResetKey} disabled={submitting} onTokenChange={setTurnstileToken} />
                <PublicBookingPrivacyNotice />
                <div className="public-booking-actions"><Button type="submit" size="lg" disabled={submitting || !selectedSlot || !turnstileToken}>{submitting ? "Reserving…" : page.eventType.approvalRequired ? "Request meeting" : "Confirm booking"}</Button></div>
              </form>
            )}
          </section>
        </div>
        <PublicFooter />
      </div>
    </main>
  );
}

function InlineError({ message }: { readonly message: string }) {
  return <div className="public-inline-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{message}</span></div>;
}

function PoweredByTap() {
  return <a className="public-booking-powered" href="https://theaiplatform.app/" target="_blank" rel="noreferrer" aria-label="Powered by The AI Platform (opens in a new tab)"><CalendarCheck2 aria-hidden="true" /> Powered by <strong>The AI Platform</strong></a>;
}

function PublicFooter() {
  return (
    <footer className="public-booking-footer">
      <PoweredByTap />
      <nav className="public-booking-footer-links" aria-label="Booking page links">
        <a href="https://theaiplatform.app/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
        <span aria-hidden="true">·</span>
        <a href="mailto:abuse@theaiplatform.app">Report abuse</a>
      </nav>
    </footer>
  );
}
