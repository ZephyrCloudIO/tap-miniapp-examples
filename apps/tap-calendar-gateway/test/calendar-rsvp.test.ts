import { describe, expect, it } from "vitest";
import { normalizeGoogleCalendarEvent } from "../src/index";

const googleEvent = (responseStatus: unknown, extra: Record<string, unknown> = {}) => ({
  id: "series_20260925T190000Z",
  recurringEventId: "series",
  status: "confirmed",
  summary: "Account review",
  start: { dateTime: "2026-09-25T15:00:00-04:00" },
  end: { dateTime: "2026-09-25T16:00:00-04:00" },
  attendees: [
    { email: "host@example.com", responseStatus: "accepted" },
    { email: "viewer@example.com", self: true, responseStatus },
  ],
  ...extra,
});

describe("Google attendee RSVP projection", () => {
  it.each(["zoom", "google-meet"])("retains the physical address and plain description beside %s", provider => {
    const joinUrl = provider === "zoom" ? "https://zoom.us/j/123456789" : "https://meet.google.com/abc-defg-hij";
    expect(normalizeGoogleCalendarEvent(googleEvent("accepted", {
      description: "Agenda &lt;draft&gt; &amp; notes<br>Bring a laptop.",
      location: "Room 3, 123 Main Street",
      conferenceData: {
        conferenceSolution: { key: { type: provider === "zoom" ? "addOn" : "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: joinUrl }],
      },
    }), "primary", "viewer@example.com")).toMatchObject({
      description: "Agenda <draft> & notes\nBring a laptop.", physicalLocation: "Room 3, 123 Main Street",
      location: provider, providerJoinUrl: joinUrl,
    });
  });

  it("preserves legacy Zoom links without presenting them as physical addresses", () => {
    const event = normalizeGoogleCalendarEvent(googleEvent("accepted", { location: "https://zoom.us/j/123456789" }), "primary");
    expect(event).toMatchObject({ location: "zoom", providerJoinUrl: "https://zoom.us/j/123456789" });
    expect(event).not.toHaveProperty("physicalLocation");
  });

  it("projects an address without inventing a video call and strips provider HTML safely", () => {
    const event = normalizeGoogleCalendarEvent(googleEvent("accepted", {
      location: "Room 3", description: '<p>Bring <strong>notes</strong>.</p><script>alert("bad")</script>',
    }), "primary");
    expect(event).toMatchObject({ location: "physical", physicalLocation: "Room 3", description: "Bring notes." });
    expect(event).not.toHaveProperty("providerJoinUrl");
  });

  it.each([
    ["needsAction", "pending", true],
    ["tentative", "pending", true],
    ["accepted", "confirmed", true],
    ["declined", "declined", false],
  ])("preserves %s for the viewer and retains the organizer's acceptance", (response, status, busy) => {
    const result = normalizeGoogleCalendarEvent(googleEvent(response), "primary", "VIEWER@example.com");
    expect(result).toMatchObject({
      status, busy,
      attendees: [
        { email: "host@example.com", responseStatus: "accepted", isCurrentUser: false },
        { email: "viewer@example.com", responseStatus: response, isCurrentUser: true },
      ],
    });
  });

  it.each([undefined, null, "unexpected", true])("treats absent or invalid RSVP %s as unknown", response => {
    const result = normalizeGoogleCalendarEvent(googleEvent(response), "primary", "viewer@example.com");
    expect(result?.attendees[1]).toMatchObject({ responseStatus: "unknown", isCurrentUser: true });
  });

  it("matches the connected account instead of the shared calendar owner", () => {
    const result = normalizeGoogleCalendarEvent(googleEvent("declined", {
      attendees: [
        { email: "host@example.com", self: true, responseStatus: "accepted" },
        { email: "viewer@example.com", responseStatus: "needsAction" },
      ],
    }), "shared", "viewer@example.com");
    expect(result?.attendees).toMatchObject([
      { isCurrentUser: false, responseStatus: "accepted" },
      { isCurrentUser: true, responseStatus: "needsAction" },
    ]);
  });

  it("does not infer viewer identity when only other attendees are returned", () => {
    const result = normalizeGoogleCalendarEvent(googleEvent("accepted"), "shared", "other@example.com");
    expect(result?.attendees.every(attendee => !attendee.isCurrentUser)).toBe(true);
  });

  it("keeps cancelled and transparent events free even with accepted attendees", () => {
    expect(normalizeGoogleCalendarEvent(googleEvent("accepted", { status: "cancelled" }), "primary", "viewer@example.com"))
      .toMatchObject({ status: "cancelled", busy: false });
    expect(normalizeGoogleCalendarEvent(googleEvent("accepted", { transparency: "transparent" }), "primary", "viewer@example.com"))
      .toMatchObject({ busy: false });
  });
});
