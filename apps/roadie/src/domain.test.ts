import { describe, expect, it } from "@rstest/core";

import {
  acceptProposal,
  createTrip,
  deleteTimelineItem,
  deleteTrip,
  emptyRoadieDocument,
  extractImpactReportFromText,
  extractProposalFromText,
  proposalSchema,
  updateTimelineItem,
  updateTripImpactReport,
} from "./domain";

const NOW = "2026-07-28T12:00:00.000Z";

describe("Roadie domain", () => {
  it("creates a typed trip container", () => {
    const trip = createTrip({
      id: "trip-1",
      location: "Amsterdam",
      now: NOW,
      purpose: "conference",
      title: "React Summit 2026 · Amsterdam",
    });

    expect(trip.purpose).toBe("conference");
    expect(trip.location).toBe("Amsterdam");
  });

  it("accepts a sourced proposal into the canonical timeline", () => {
    const document = {
      ...emptyRoadieDocument(NOW),
      trips: [
        createTrip({
          id: "trip-1",
          now: NOW,
          purpose: "conference",
          title: "React Summit 2026 · Amsterdam",
        }),
      ],
    };
    const proposal = proposalSchema.parse({
      id: "proposal-1",
      title: "Shipping AI interfaces that users can trust",
      start: "2026-06-12T14:30:00+02:00",
      timeZone: "Europe/Amsterdam",
      kind: "talk",
      evidence: [
        {
          sourceKind: "pasted-text",
          sourceLabel: "Pasted speaker information",
          excerpt: "on 12 June 2026 at 14:30 CEST",
          capturedAt: NOW,
          confidence: "high",
        },
      ],
    });

    const updated = acceptProposal({
      document,
      now: NOW,
      proposal,
      tripId: "trip-1",
    });

    expect(updated.trips[0]?.timeline).toHaveLength(1);
    expect(updated.trips[0]?.timeline[0]?.evidence[0]?.excerpt).toContain("14:30 CEST");
  });

  it("extracts a deterministic proposal from pasted confirmation text", () => {
    const proposal = extractProposalFromText({
      capturedAt: NOW,
      id: "proposal-1",
      text: `You are confirmed to speak at React Summit in Amsterdam.
Your talk "Shipping AI interfaces that users can trust" is on 12 June 2026 at 14:30 CEST.`,
    });

    expect(proposal.start).toBe("2026-06-12T12:30:00.000Z");
    expect(proposal.timeZone).toBe("Europe/Amsterdam");
    expect(proposal.title).toBe("Shipping AI interfaces that users can trust");
    expect(proposal.kind).toBe("talk");
  });

  it("recognizes dinners and meetings as itinerary categories", () => {
    const dinner = extractProposalFromText({
      capturedAt: NOW,
      id: "dinner-1",
      text: "Speaker dinner on 12 June 2026 at 19:30 CEST.",
    });
    const meeting = extractProposalFromText({
      capturedAt: NOW,
      id: "meeting-1",
      text: "Customer meeting on 13 June 2026 at 10:00 CEST.",
    });

    expect(dinner.kind).toBe("social");
    expect(meeting.kind).toBe("meeting");
  });

  it("honors the user category when automatic detection is not enough", () => {
    const proposal = extractProposalFromText({
      capturedAt: NOW,
      id: "proposal-1",
      kind: "other",
      text: "Important appointment on 14 June 2026 at 09:00 CEST.",
    });

    expect(proposal.kind).toBe("other");
  });

  it("extracts public participation types independently from itinerary categories", () => {
    const panel = extractProposalFromText({
      capturedAt: NOW,
      id: "panel-1",
      text: "Panel discussion about AI on 14 June 2026 at 09:00 CEST.",
    });
    const podcast = extractProposalFromText({
      capturedAt: NOW,
      id: "podcast-1",
      text: "Podcast interview on 15 June 2026 at 11:00 CEST.",
    });

    expect(panel.engagementType).toBe("panel");
    expect(podcast.engagementType).toBe("podcast");
  });

  it("explains when pasted text has no usable date and time", () => {
    expect(() =>
      extractProposalFromText({
        capturedAt: NOW,
        id: "proposal-1",
        text: "Your speaker slot is confirmed. More details coming soon.",
      }),
    ).toThrow("needs a date and time");
  });

  it("extracts estimated attendance and follow-ups from a trip report", () => {
    const report = extractImpactReportFromText({
      now: NOW,
      text: "Around 450 attendees. Three companies asked for follow-up conversations.",
    });

    expect(report.eventAttendance).toBe(450);
    expect(report.attendanceConfidence).toBe("estimated");
    expect(report.followUpCount).toBe(3);
  });

  it("stores an impact report on its trip", () => {
    const trip = createTrip({
      id: "trip-1",
      now: NOW,
      purpose: "conference",
      title: "React Summit",
    });
    const report = extractImpactReportFromText({
      now: NOW,
      text: "Approximately 900 attendees joined the event.",
    });
    const document = updateTripImpactReport({
      document: { ...emptyRoadieDocument(NOW), trips: [trip] },
      now: NOW,
      report,
      tripId: trip.id,
    });

    expect(document.trips[0]?.impactReport?.eventAttendance).toBe(900);
  });

  it("rejects ambiguous timestamps before they enter a proposal", () => {
    const result = proposalSchema.safeParse({
      id: "proposal-1",
      title: "Speaker dinner",
      start: "2026-06-12 19:00",
      timeZone: "Europe/Amsterdam",
      kind: "social",
      evidence: [
        {
          sourceKind: "pasted-text",
          sourceLabel: "Pasted speaker information",
          capturedAt: NOW,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("removes a trip from the canonical document", () => {
    const document = {
      ...emptyRoadieDocument(NOW),
      trips: [
        createTrip({
          id: "trip-1",
          now: NOW,
          purpose: "conference",
          title: "React Summit 2026 · Amsterdam",
        }),
      ],
    };

    expect(deleteTrip(document, "trip-1", NOW).trips).toEqual([]);
  });

  it("updates and deletes an accepted timeline item", () => {
    const trip = createTrip({
      id: "trip-1",
      now: NOW,
      purpose: "conference",
      title: "React Summit 2026 · Amsterdam",
    });
    const accepted = acceptProposal({
      document: { ...emptyRoadieDocument(NOW), trips: [trip] },
      now: NOW,
      proposal: proposalSchema.parse({
        id: "proposal-1",
        title: "Original title",
        start: "2026-06-12T12:30:00.000Z",
        timeZone: "Europe/Amsterdam",
        kind: "talk",
        evidence: [
          {
            sourceKind: "pasted-text",
            sourceLabel: "Email",
            capturedAt: NOW,
          },
        ],
      }),
      tripId: trip.id,
    });
    const item = accepted.trips[0]?.timeline[0];
    expect(item).toBeDefined();
    if (!item) return;

    const updated = updateTimelineItem({
      document: accepted,
      item: { ...item, title: "Updated title" },
      now: "2026-07-28T13:00:00.000Z",
      tripId: trip.id,
    });
    expect(updated.trips[0]?.timeline[0]?.title).toBe("Updated title");

    const deleted = deleteTimelineItem({
      document: updated,
      itemId: item.id,
      now: "2026-07-28T14:00:00.000Z",
      tripId: trip.id,
    });
    expect(deleted.trips[0]?.timeline).toEqual([]);
  });
});
