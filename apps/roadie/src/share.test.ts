import { describe, expect, it } from "@rstest/core";

import {
  acceptProposal,
  createTrip,
  emptyRoadieDocument,
  proposalSchema,
  tripImpactReportSchema,
} from "./domain";
import {
  DEFAULT_IMPACT_SHARE_OPTIONS,
  impactDigestShareText,
  tripImpactShareText,
  tripShareText,
  upcomingEngagementsShareText,
} from "./share";

const NOW = "2026-07-28T12:00:00.000Z";

function tripWithItems() {
  const trip = createTrip({
    id: "trip-1",
    location: "Berlin",
    now: NOW,
    purpose: "conference",
    title: "Vue Berlin",
  });
  const proposals = [
    proposalSchema.parse({
      id: "talk-1",
      title: "Vue and AI",
      start: "2026-08-28T12:30:00.000Z",
      timeZone: "Europe/Berlin",
      kind: "talk",
      engagementType: "panel",
      evidence: [{ sourceKind: "user", sourceLabel: "Test", capturedAt: NOW }],
    }),
    proposalSchema.parse({
      id: "hotel-1",
      title: "Private hotel booking",
      start: "2026-08-27T14:00:00.000Z",
      timeZone: "Europe/Berlin",
      kind: "hotel",
      evidence: [{ sourceKind: "user", sourceLabel: "Test", capturedAt: NOW }],
    }),
    proposalSchema.parse({
      id: "dinner-1",
      title: "Speaker dinner",
      start: "2026-08-28T17:00:00.000Z",
      timeZone: "Europe/Berlin",
      kind: "social",
      evidence: [{ sourceKind: "user", sourceLabel: "Test", capturedAt: NOW }],
    }),
    proposalSchema.parse({
      id: "private-talk-1",
      title: "Internal rehearsal",
      start: "2026-08-28T10:00:00.000Z",
      timeZone: "Europe/Berlin",
      kind: "talk",
      engagementType: null,
      evidence: [{ sourceKind: "user", sourceLabel: "Test", capturedAt: NOW }],
    }),
  ];
  const document = proposals.reduce(
    (document, proposal) => acceptProposal({ document, now: NOW, proposal, tripId: trip.id }),
    { ...emptyRoadieDocument(NOW), trips: [trip] },
  );
  const savedTrip = document.trips[0];
  if (!savedTrip) throw new Error("Expected the test trip.");
  return savedTrip;
}

describe("Roadie sharing", () => {
  it("keeps the complete itinerary in a trip update", () => {
    const text = tripShareText(tripWithItems());
    expect(text).toContain("Vue and AI");
    expect(text).toContain("Private hotel booking");
    expect(text).toContain("Speaker dinner");
    expect(text).toContain("Internal rehearsal");
  });

  it("excludes private logistics from upcoming engagements", () => {
    const text = upcomingEngagementsShareText([tripWithItems()], new Date(NOW));
    expect(text).toContain("Panel discussion: Vue and AI");
    expect(text).not.toContain("Private hotel booking");
    expect(text).not.toContain("Speaker dinner");
    expect(text).not.toContain("Internal rehearsal");
  });

  it("keeps private reflections out of trip impact reports", () => {
    const trip = {
      ...tripWithItems(),
      impactReport: tripImpactReportSchema.parse({
        sourceText: "Strong event with around 500 attendees.",
        summary: "Strong event with around 500 attendees.",
        eventAttendance: 500,
        attendanceConfidence: "estimated",
        sponsorValue: "Worth supporting again.",
        privateReflection: "Personal note that must stay private.",
        links: [],
        createdAt: NOW,
        updatedAt: NOW,
      }),
    };

    const text = tripImpactShareText(trip, {
      ...DEFAULT_IMPACT_SHARE_OPTIONS,
      includeSponsorValue: true,
    });
    const defaultText = tripImpactShareText(trip, DEFAULT_IMPACT_SHARE_OPTIONS);

    expect(text).toContain("Worth supporting again");
    expect(text).not.toContain("Personal note");
    expect(defaultText).not.toContain("Worth supporting again");
  });

  it("builds an impact digest for a selected reporting period", () => {
    const text = impactDigestShareText(
      [tripWithItems()],
      {
        start: new Date("2026-08-01T00:00:00.000Z"),
        end: new Date("2026-08-31T23:59:59.999Z"),
        label: "August 2026",
      },
      DEFAULT_IMPACT_SHARE_OPTIONS,
    );

    expect(text).toContain("Roadie impact digest · August 2026");
    expect(text).toContain("Public engagements: 1");
    expect(text).not.toContain("Private hotel booking");
  });
});
