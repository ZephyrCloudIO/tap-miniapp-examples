import { describe, expect, it } from "@rstest/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicRoute, PublicProfileScreen } from "./app";
import {
  PUBLIC_PROFILE_SCHEMA_VERSION,
  type PublicBookingProfile,
} from "./contracts";

const emptyProfile = {
  schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
  canonicalUrl: "https://cal.with-tap.ai/alex-morgan",
  profile: { displayName: "Alex Morgan", initials: "AM" },
  eventTypes: [],
} satisfies PublicBookingProfile;

describe("public Calendar routes", () => {
  it("distinguishes profile, booking, and management routes", () => {
    expect(parsePublicRoute("/alex-morgan")).toEqual({
      kind: "profile",
      profileSlug: "alex-morgan",
    });
    expect(parsePublicRoute("/alex-morgan/30min")).toEqual({
      kind: "booking",
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
    });
    expect(parsePublicRoute("/manage")).toEqual({ kind: "management" });
    expect(parsePublicRoute("/manage/")).toEqual({ kind: "not-found" });
    expect(parsePublicRoute("/alex-morgan/30min/extra")).toEqual({ kind: "not-found" });
  });
});

describe("public booking profile screen", () => {
  it("renders organizer identity and a deliberate empty state", () => {
    const markup = renderToStaticMarkup(createElement(PublicProfileScreen, { profile: emptyProfile }));

    expect(markup).toContain("Alex Morgan");
    expect(markup).toContain("No booking options yet");
    expect(markup).toContain("Powered by");
    expect(markup).toContain("mailto:abuse@theaiplatform.app");
    expect(markup).not.toContain("Booking page not found");
  });

  it("renders an accessible link for every public event type", () => {
    const profile = {
      ...emptyProfile,
      eventTypes: [{
        eventTypeSlug: "30min",
        canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
        title: "30 minute meeting",
        description: "A quick conversation.",
        durationMinutes: 30,
        location: "google-meet",
        locationLabel: "Google Meet",
        approvalRequired: true,
      }],
    } satisfies PublicBookingProfile;
    const markup = renderToStaticMarkup(createElement(PublicProfileScreen, { profile }));

    expect(markup).toContain("30 minute meeting");
    expect(markup).toContain("Approval required");
    expect(markup).toContain('href="https://cal.with-tap.ai/alex-morgan/30min"');
    expect(markup).toContain('aria-label="View available times for 30 minute meeting"');
  });
});
