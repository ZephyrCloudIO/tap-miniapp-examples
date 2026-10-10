// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BookingPagesScreen } from "./app";
import { CALENDAR_PUBLISH_ACTION } from "./authority";
import { isEventTypePublicationLive, setEventTypeActive, updateEventType, type CalendarState } from "./domain";
import { createInitialCalendarState } from "./test-fixtures";
import { markChangedPublicBookingProfilesPending } from "./publication-state";
import { reconcilePublicBookingProfilePublication, type PublicBookingProfileSyncAdapter } from "./publication-sync";
import type { PublicBookingProfilePublicationInput } from "./public-booking-publication";
import { emptyPublicBookingMetrics, PUBLIC_BOOKING_ANALYTICS_SCHEMA, type PublicBookingAnalytics } from "./public-booking-analytics";

const now = "2026-09-27T20:30:00.000Z";
let state: CalendarState;
let root: Root;
let container: HTMLDivElement;
let failSync: boolean;
let failSave: boolean;
let snapshot: PublicBookingAnalytics | null;
const publications: PublicBookingProfilePublicationInput[] = [];

const fixture = (): CalendarState => {
  const initial = createInitialCalendarState();
  const profile = initial.bookingProfiles[0]!;
  return { ...initial, bookingProfiles: [{ ...profile,
    publication: { generation: 1, status: "published", reservedSlug: profile.slug, updatedAt: now },
    eventTypes: profile.eventTypes.map(eventType => ({ ...eventType, destinationCalendarId: "cal-google-main", location: "google-meet",
      publication: { generation: 1, revisionId: `revision-${eventType.id}`, reservedSlug: eventType.slug },
    })),
  }] };
};

const gateway: PublicBookingProfileSyncAdapter["gateway"] = {
  async publishPublicBookingProfile(input) {
    if (failSync) throw new Error("Gateway unavailable");
    publications.push(input);
    return {
      profileId: "server-profile", sourceProfileId: input.sourceProfileId, profileSlug: input.profileSlug,
      generation: input.expectedGeneration + 1, publishedAt: now, idempotentReplay: false,
      pages: input.publications.map(page => ({
        profileId: "server-profile", profileSlug: page.profileSlug, publishedAt: now,
        pageId: `page-${page.sourceEventTypeId}`, revisionId: `revision-${input.expectedGeneration + 1}-${page.sourceEventTypeId}`,
        sourceEventTypeId: page.sourceEventTypeId, eventTypeSlug: page.eventTypeSlug,
        canonicalUrl: `https://cal.with-tap.ai/${page.profileSlug}/${page.eventTypeSlug}`,
      })),
    };
  },
  async unpublishPublicBookingProfile() { throw new Error("A page action must not unpublish its profile."); },
};

function Harness() {
  const [view, setView] = useState(state);
  const persist: PublicBookingProfileSyncAdapter["persist"] = async mutation => {
    if (failSave) return false;
    const next = mutation(state);
    if (next === state) return false;
    state = markChangedPublicBookingProfilesPending(state, next, now);
    setView(state);
    return true;
  };
  return <BookingPagesScreen state={view} analyticsState={view} snapshot={snapshot} analyticsAvailable={snapshot !== null} liveAnalytics
    commit={async (mutation, message, action) => { expect(action).toBe(CALENDAR_PUBLISH_ACTION); return persist(mutation, message); }}
    onSyncPublication={profileId => reconcilePublicBookingProfilePublication(profileId, {
      gateway, readState: () => state, persist, now: () => now,
    })}
    onNavigate={() => {}} onPreview={() => {}} announce={() => {}} zoomConnected />;
}

beforeEach(async () => {
  state = fixture();
  snapshot = null;
  failSync = failSave = false;
  publications.length = 0;
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); rs.unstubAllGlobals(); });
const card = () => container.querySelector<HTMLElement>(".event-type-card")!;
const click = async (label: string, parent: ParentNode = container) => {
  const button = [...parent.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  expect(button, `Missing ${label}`).toBeDefined();
  await act(async () => button!.click());
};
const input = async (name: string, value: string) => {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("booking page management", () => {
  it("edits an existing page with its URL, analytics, and bookings preserved", async () => {
    const existing = state.bookingProfiles[0]!.eventTypes[0]!;
    const events = state.events;
    await click("Edit", card());
    expect(container.querySelector<HTMLInputElement>('[name="event-type-name"]')!.value).toBe(existing.title);
    expect(container.querySelector<HTMLInputElement>('[name="event-type-slug"]')!.readOnly).toBe(true);
    await input("event-type-name", "Customer conversation");
    await click("Save changes");
    const updated = state.bookingProfiles[0]!.eventTypes[0]!;
    expect(updated).toMatchObject({ id: existing.id, slug: existing.slug, title: "Customer conversation", analytics: existing.analytics });
    expect(state.events).toBe(events);
    expect(state.bookingProfiles[0]!.eventTypes).toHaveLength(2);
    expect(publications[0]!.publications.find(page => page.sourceEventTypeId === existing.id)?.title).toBe("Customer conversation");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("takes only the selected page offline and republishes the same URL", async () => {
    const original = state.bookingProfiles[0]!;
    const events = state.events;
    await click("Take offline", card());
    let profile = state.bookingProfiles[0]!;
    expect(profile.published).toBe(true);
    expect(profile.eventTypes[0]!.active).toBe(false);
    expect(isEventTypePublicationLive(profile, profile.eventTypes[0]!)).toBe(false);
    expect(isEventTypePublicationLive(profile, profile.eventTypes[1]!)).toBe(true);
    expect(publications[0]!.publications.map(page => page.sourceEventTypeId)).toEqual([original.eventTypes[1]!.id]);
    expect(card().querySelector('.status-chip')?.textContent).toBe("Offline");
    await click("Publish", card());
    profile = state.bookingProfiles[0]!;
    expect(isEventTypePublicationLive(profile, profile.eventTypes[0]!)).toBe(true);
    expect(profile.eventTypes[0]!.slug).toBe(original.eventTypes[0]!.slug);
    expect(profile.eventTypes[0]!.analytics).toEqual(original.eventTypes[0]!.analytics);
    expect(state.events).toBe(events);
    expect(publications[1]!.publications).toHaveLength(2);
  });

  it("keeps a failed unpublish visibly pending and retries the saved intent", async () => {
    failSync = true;
    await click("Take offline", card());
    expect(card().querySelector('.status-chip')?.textContent).toBe("Offline pending");
    expect(card().textContent).toContain("public page hasn’t updated");
    expect(container.querySelectorAll(".event-type-card .status-chip")[1]?.textContent).toBe("Live");
    expect(card().querySelector('.public-url button[aria-label^="Copy URL"]')).not.toBeNull();
    expect(state.bookingProfiles[0]!.pendingPublication).toBeDefined();
    failSync = false;
    await click("Retry update", card());
    expect(card().querySelector('.status-chip')?.textContent).toBe("Offline");
    expect(card().querySelector('[role="alert"]')).toBeNull();
  });

  it("does not publish or change live status if local persistence fails", async () => {
    failSave = true;
    await click("Take offline", card());
    expect(publications).toHaveLength(0);
    expect(state.bookingProfiles[0]!.eventTypes[0]!.active).toBe(true);
    expect(card().querySelector('.status-chip')?.textContent).toBe("Live");
    expect(card().textContent).toContain("couldn’t be saved");
    expect(card().textContent).not.toContain("Retry update");
  });

  it("validates edits and activation while allowing an offline request after disconnection", () => {
    const profile = state.bookingProfiles[0]!;
    const existing = profile.eventTypes[0]!;
    const settings = { ...existing, availabilityScheduleId: existing.availabilityScheduleId! };
    expect(updateEventType(state, profile.id, existing.id, { ...settings, durationMinutes: 0 }).ok).toBe(false);
    expect(updateEventType(state, profile.id, existing.id, { ...settings, availabilityScheduleId: "missing" }).ok).toBe(false);
    const staleForm = { ...settings, slug: "different", analytics: { views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0 } };
    const saved = updateEventType(state, profile.id, existing.id, staleForm);
    expect(saved.state.bookingProfiles[0]!.eventTypes[0]).toMatchObject({ slug: existing.slug, analytics: existing.analytics, publication: existing.publication });
    const disconnected = { ...state, accounts: [] };
    expect(setEventTypeActive(disconnected, profile.id, existing.id, false).ok).toBe(true);
    expect(setEventTypeActive(disconnected, profile.id, existing.id, true).ok).toBe(false);
  });

  it("shows each page's visit cohort, not all-time bookings, in its row", async () => {
    const profile = state.bookingProfiles[0]!;
    const page = profile.eventTypes[0]!;
    // Historical bookings predate visit tracking, so they must not inflate the row.
    const analytics = { ...emptyPublicBookingMetrics, views: 4, conversionViews: 4, convertedVisits: 1, requests: 12, confirmed: 11, lifetimeConfirmed: 12 };
    snapshot = {
      schemaVersion: PUBLIC_BOOKING_ANALYTICS_SCHEMA, generatedAt: now,
      trafficSince: "2026-09-25T00:00:00.000Z", conversionSince: "2026-09-25T00:00:00.000Z",
      totals: analytics, pages: [{ sourceProfileId: profile.id, sourceEventTypeId: page.id, analytics }],
    };
    await act(async () => root.render(<Harness />));
    const stats = [...card().querySelectorAll(".booking-stats > span")].map(cell => cell.textContent);
    expect(stats).toEqual(["4", "1", "25.0%"]);
    expect(card().querySelector(".booking-stats")?.textContent).not.toContain("11");
  });
});
