import { describe, expect, it } from "@rstest/core";

import {
  acceptProposal,
  createTrip,
  emptyRoadieDocument,
  proposalSchema,
  updateEngagementOutcome,
  updateTripImpactReport,
  extractImpactReportFromText,
} from "./domain";
import { summarizeImpact } from "./impact";

const NOW = "2026-07-28T12:00:00.000Z";

describe("Roadie impact analytics", () => {
  it("derives annual totals without double-counting private itinerary items", () => {
    const trip = createTrip({
      id: "trip-1",
      location: "Amsterdam",
      now: NOW,
      purpose: "conference",
      title: "React Summit",
    });
    const proposal = proposalSchema.parse({
      id: "talk-1",
      title: "Trustworthy AI",
      start: "2026-06-12T12:30:00.000Z",
      timeZone: "Europe/Amsterdam",
      kind: "talk",
      engagementType: "talk",
      evidence: [{ sourceKind: "user", sourceLabel: "Test", capturedAt: NOW }],
    });
    const accepted = acceptProposal({
      document: { ...emptyRoadieDocument(NOW), trips: [trip] },
      now: NOW,
      proposal,
      tripId: trip.id,
    });
    const withOutcome = updateEngagementOutcome({
      document: accepted,
      itemId: proposal.id,
      now: NOW,
      outcome: {
        audienceCount: 180,
        audienceConfidence: "estimated",
        followUpCount: 3,
        links: [],
        updatedAt: NOW,
      },
      tripId: trip.id,
    });
    const report = extractImpactReportFromText({
      now: NOW,
      text: "Around 450 attendees joined the conference.",
    });
    const complete = updateTripImpactReport({
      document: withOutcome,
      now: NOW,
      report,
      tripId: trip.id,
    });

    expect(summarizeImpact(complete.trips, 2026)).toMatchObject({
      directAudience: 180,
      estimatedEventReach: 450,
      followUps: 3,
      publicEngagements: 1,
      reportedTrips: 1,
      trips: 1,
    });
  });
});
