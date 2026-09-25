import { describe, expect, it } from "@rstest/core";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarBoard } from "./calendar-board";
import { AttendeeResponseBadge, EventResponseBadge, eventResponseClassName } from "./attendee-response-badge";
import { eventViewerResponse, isAttendeeResponse, type CalendarResponseStatus } from "./attendee-response";
import { createEmptyCalendarState, isCalendarState, type CalendarEvent, type CalendarView } from "./domain";
import { mergeProviderEvent } from "./provider-event-merge";

const event = (responseStatus: CalendarResponseStatus): CalendarEvent => ({
  id: "recurring-instance", calendarId: "primary", title: "Account review",
  start: "2026-09-25T15:00:00", end: "2026-09-25T16:00:00",
  kind: "meeting", status: "confirmed", location: null,
  attendees: [
    { id: "host", name: "Host", email: "host@example.com", kind: "external", required: true, responseStatus: "accepted" },
    { id: "viewer", name: "Viewer", email: "viewer@example.com", kind: "external", required: true, isCurrentUser: true, responseStatus },
  ],
});

const state = (events: CalendarEvent[], activeView: CalendarView = "day") => ({
  ...createEmptyCalendarState(), activeView, events,
  accounts: [{
    id: "account", provider: "google" as const, label: "Renamed account", status: "connected" as const,
    calendars: [{ id: "primary", accountId: "account", name: "Calendar", color: "#458cca", role: "owner" as const, visible: true, conflicts: true, writable: true, destination: true, freshness: "live" as const }],
  }],
});

describe("calendar RSVP presentation", () => {
  it("uses the viewer RSVP independently of event confirmation and organizer acceptance", () => {
    expect(eventViewerResponse(event("needsAction"))).toBe("needsAction");
    expect(eventViewerResponse(event("tentative"))).toBe("tentative");
    expect(eventViewerResponse(event("declined"))).toBe("declined");
    const legacy = { ...event("accepted"), attendees: event("accepted").attendees.map(({ responseStatus, isCurrentUser, ...attendee }) => attendee) };
    expect(eventViewerResponse(legacy)).toBe("unknown");
    expect(renderToStaticMarkup(<EventResponseBadge event={legacy} />)).toContain("Response unknown");
  });

  it.each(["needsAction", "accepted", "tentative", "declined", "unknown"] as const)("renders accurate attendee labels and icons for %s", response => {
    const html = renderToStaticMarkup(<AttendeeResponseBadge response={response} />);
    expect(html.includes("lucide-circle-check")).toBe(response === "accepted");
    expect(html).toContain(`rsvp-badge-${response}`);
    expect(html).toContain('aria-hidden="true"');
  });

  it.each(["day", "week", "work-week", "month", "agenda"] as const)("keeps unanswered and declined events distinct and accessible in %s", view => {
    const events = ["needsAction", "accepted", "tentative", "declined", "unknown"].map((response, index) => ({
      ...event(response as CalendarResponseStatus), id: `event-${index}`,
      // Different dates avoid the month view's three-event display limit.
      start: `2026-09-${21 + index}T15:00:00`, end: `2026-09-${21 + index}T16:00:00`,
    }));
    for (const current of events) {
      const html = renderToStaticMarkup(<CalendarBoard state={state([current], view)} anchorDate={current.start.slice(0, 10)} onSelectEvent={() => {}} onSelectSlot={() => {}} />);
      expect(html).toContain(eventResponseClassName(current));
      expect(html).toContain("Account review");
      expect(html).toContain("rsvp-label");
    }
  });

  it("styles all-day invitations and prioritizes cancellation over accepted RSVP", () => {
    const allDay = { ...event("declined"), allDay: true, start: "2026-09-25T00:00:00.000Z", end: "2026-09-26T00:00:00.000Z" };
    const html = renderToStaticMarkup(<CalendarBoard state={state([allDay])} anchorDate="2026-09-25" onSelectEvent={() => {}} onSelectSlot={() => {}} />);
    expect(html).toContain("Account review, All day, Declined");
    expect(html).toContain("rsvp-declined");
    expect(eventResponseClassName({ ...event("accepted"), status: "cancelled" })).toContain("rsvp-cancelled");
  });

  it("accepts legacy state but rejects corrupt RSVP metadata", () => {
    expect(isCalendarState(state([event("needsAction")]))).toBe(true);
    expect(isAttendeeResponse({})).toBe(true);
    expect(isAttendeeResponse({ responseStatus: "confirmed" })).toBe(false);
    expect(isAttendeeResponse({ isCurrentUser: "true" })).toBe(false);
  });

  it("lets provider declines replace confirmed local events while retaining TAP identity", () => {
    const local = { ...event("accepted"), source: { kind: "task" as const, id: "task", label: "Review" } };
    const provider = { ...event("declined"), status: "declined" as const, busy: false };
    const merged = mergeProviderEvent(local, provider);
    expect(merged.status).toBe("declined");
    expect(merged.busy).toBe(false);
    expect(eventViewerResponse(merged)).toBe("declined");
    expect(merged.source).toEqual(local.source);
    const hold = { ...local, kind: "hold" as const, status: "pending" as const };
    expect(mergeProviderEvent(hold, provider)).toBe(hold);
    const rejected = { ...local, status: "declined" as const };
    expect(mergeProviderEvent(rejected, event("accepted"))).toBe(rejected);
  });
});
