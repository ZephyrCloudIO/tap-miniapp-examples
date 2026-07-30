import * as chrono from "chrono-node";
import { z } from "zod";

const idSchema = z.string().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });

export const itineraryItemKindSchema = z.enum([
  "talk",
  "social",
  "meeting",
  "travel",
  "hotel",
  "personal",
  "other",
]);

export const engagementTypeSchema = z.enum([
  "talk",
  "panel",
  "workshop",
  "podcast",
  "interview",
  "keynote",
  "livestream",
]);

export const metricConfidenceSchema = z.enum(["confirmed", "estimated", "derived"]);

export const impactLinkSchema = z
  .object({
    label: z.string().min(1).max(100),
    url: z.url().max(2_000),
  })
  .strict();

export const engagementOutcomeSchema = z
  .object({
    audienceCount: z.number().int().min(0).max(10_000_000).optional(),
    audienceConfidence: metricConfidenceSchema.optional(),
    highlight: z.string().min(1).max(2_000).optional(),
    outcome: z.string().min(1).max(2_000).optional(),
    followUpCount: z.number().int().min(0).max(100_000).optional(),
    links: z.array(impactLinkSchema).max(20).default([]),
    updatedAt: timestampSchema,
  })
  .strict();

export const tripImpactReportSchema = z
  .object({
    sourceText: z.string().min(1).max(20_000),
    eventAttendance: z.number().int().min(0).max(10_000_000).optional(),
    attendanceConfidence: metricConfidenceSchema.optional(),
    summary: z.string().min(1).max(4_000),
    highlights: z.string().min(1).max(4_000).optional(),
    outcomes: z.string().min(1).max(4_000).optional(),
    sponsorValue: z.string().min(1).max(4_000).optional(),
    privateReflection: z.string().min(1).max(4_000).optional(),
    followUpCount: z.number().int().min(0).max(100_000).optional(),
    links: z.array(impactLinkSchema).max(20).default([]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const shareDestinationSchema = z
  .object({
    channelId: idSchema,
    channelTitle: z.string().min(1).max(200),
  })
  .strict();

export const roadieShareSettingsSchema = z
  .object({
    upcomingEngagements: shareDestinationSchema.optional(),
    tripImpact: shareDestinationSchema.optional(),
    impactDigest: shareDestinationSchema.optional(),
  })
  .strict();

export const evidenceSchema = z
  .object({
    sourceKind: z.enum(["pasted-text", "official-site", "user", "demo-fixture"]),
    sourceLabel: z.string().min(1).max(200),
    excerpt: z.string().min(1).max(500).optional(),
    capturedAt: timestampSchema,
    confidence: z.enum(["high", "medium", "low"]).optional(),
  })
  .strict();

export const proposalSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    start: timestampSchema,
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, "Expected an IANA time zone."),
    kind: itineraryItemKindSchema,
    engagementType: engagementTypeSchema.nullable().optional(),
    evidence: z.array(evidenceSchema).min(1).max(20),
  })
  .strict();

export const timelineItemSchema = proposalSchema.extend({
  outcome: engagementOutcomeSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const tripPurposeSchema = z.enum([
  "conference",
  "meetup",
  "podcast",
  "work",
  "personal",
  "other",
]);

export const tripSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    purpose: tripPurposeSchema,
    location: z.string().min(1).max(200).optional(),
    timeline: z.array(timelineItemSchema).max(500),
    impactReport: tripImpactReportSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const roadieDocumentSchema = z
  .object({
    schemaVersion: z.literal(6),
    trips: z.array(tripSchema).max(100),
    shareSettings: roadieShareSettingsSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type Proposal = z.infer<typeof proposalSchema>;
export type RoadieDocument = z.infer<typeof roadieDocumentSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type TripImpactReport = z.infer<typeof tripImpactReportSchema>;
export type EngagementOutcome = z.infer<typeof engagementOutcomeSchema>;
export type MetricConfidence = z.infer<typeof metricConfidenceSchema>;
export type RoadieShareSettings = z.infer<typeof roadieShareSettingsSchema>;

export function emptyRoadieDocument(now: string): RoadieDocument {
  return roadieDocumentSchema.parse({
    schemaVersion: 6,
    trips: [],
    shareSettings: {},
    updatedAt: now,
  });
}

const TIME_ZONE_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:CEST|CET)\b|Amsterdam/iu, "Europe/Amsterdam"],
  [/\b(?:BST)\b|London/iu, "Europe/London"],
  [/\b(?:PDT|PST)\b|Los Angeles|San Francisco/iu, "America/Los_Angeles"],
  [/\b(?:EDT|EST)\b|New York/iu, "America/New_York"],
  [/\b(?:GMT|UTC)\b/iu, "Etc/UTC"],
];

function inferTimeZone(text: string): string {
  return (
    TIME_ZONE_HINTS.find(([pattern]) => pattern.test(text))?.[1] ??
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

function inferTitle(text: string): string {
  const quotedTitle = text.match(
    /(?:talk|session|workshop|presentation)\s+["“]([^"”]+)["”]/iu,
  )?.[1];
  if (quotedTitle) return quotedTitle.trim();

  const subject = text.match(/^subject:\s*(.+)$/imu)?.[1];
  if (subject) return subject.trim();

  const firstContentLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^(?:from|to|date|sent|dear|hello|hi)\s*:/iu.test(line));
  return firstContentLine?.slice(0, 200) ?? "Schedule item";
}

function inferKind(text: string): Proposal["kind"] {
  if (/\b(?:flight|train|airport|departure|arrival)\b/iu.test(text)) {
    return "travel";
  }
  if (/\b(?:hotel|check-in|checkout|accommodation)\b/iu.test(text)) {
    return "hotel";
  }
  if (/\b(?:dinner|party|social|drinks|reception)\b/iu.test(text)) {
    return "social";
  }
  if (/\b(?:meeting|coffee|lunch|appointment|catch-up|customer|client)\b/iu.test(text)) {
    return "meeting";
  }
  if (
    /\b(?:talk|session|workshop|speaker|presentation|panel|podcast|interview|keynote|livestream|webinar)\b/iu.test(
      text,
    )
  ) {
    return "talk";
  }
  return "personal";
}

export function inferEngagementType(text: string): Proposal["engagementType"] | undefined {
  if (/\b(?:speaker dinner|speaker drinks|speaker reception|speaker lounge)\b/iu.test(text)) {
    return undefined;
  }
  if (/\bpodcast\b/iu.test(text)) return "podcast";
  if (/\bpanel(?: discussion)?\b/iu.test(text)) return "panel";
  if (/\bworkshop\b/iu.test(text)) return "workshop";
  if (/\bkeynote\b/iu.test(text)) return "keynote";
  if (/\binterview\b/iu.test(text)) return "interview";
  if (/\b(?:livestream|live stream|webinar)\b/iu.test(text)) {
    return "livestream";
  }
  if (/\b(?:talk|session|speaking|speaker|presentation|presenting)\b/iu.test(text)) {
    return "talk";
  }
  return undefined;
}

export function extractProposalFromText(options: {
  capturedAt: string;
  engagementType?: Proposal["engagementType"];
  id: string;
  kind?: Proposal["kind"];
  text: string;
}): Proposal {
  const text = z.string().trim().min(1).max(20_000).parse(options.text);
  const result = chrono.parse(text, new Date(options.capturedAt), {
    forwardDate: true,
  })[0];
  if (!result || !result.start.isCertain("hour")) {
    throw new Error("Roadie needs a date and time. Include both in the pasted text and try again.");
  }
  const timeZone = inferTimeZone(text);
  const engagementType = options.engagementType ?? inferEngagementType(text);

  return proposalSchema.parse({
    id: options.id,
    title: inferTitle(text),
    start: result.start.date().toISOString(),
    timeZone,
    kind: options.kind ?? inferKind(text),
    ...(engagementType ? { engagementType } : {}),
    evidence: [
      {
        sourceKind: "pasted-text",
        sourceLabel: "Text pasted into Roadie",
        excerpt: text.slice(0, 500),
        capturedAt: options.capturedAt,
        confidence: result.start.isCertain("year") ? "high" : "medium",
      },
    ],
  });
}

export function createTrip(options: {
  id: string;
  location?: string;
  now: string;
  purpose: Trip["purpose"];
  title: string;
}): Trip {
  return tripSchema.parse({
    id: options.id,
    title: options.title,
    purpose: options.purpose,
    ...(options.location?.trim() ? { location: options.location.trim() } : {}),
    timeline: [],
    createdAt: options.now,
    updatedAt: options.now,
  });
}

export function extractImpactReportFromText(options: {
  existing?: TripImpactReport;
  now: string;
  text: string;
}): TripImpactReport {
  const sourceText = z.string().trim().min(1).max(20_000).parse(options.text);
  const attendanceMatch = sourceText.match(
    /\b(?:around|about|approximately|roughly)?\s*([\d,.]+)\s+(?:event\s+)?attendees?\b/iu,
  );
  const eventAttendance = attendanceMatch?.[1]
    ? Number.parseInt(attendanceMatch[1].replaceAll(/[,.]/gu, ""), 10)
    : undefined;
  const followUpMatch = sourceText.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:companies|people|leads?|follow[- ]?ups?|opportunities)\b/iu,
  );
  const followUpCounts: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const followUpValue = followUpMatch?.[1]?.toLowerCase();
  const followUpCount = followUpValue
    ? (followUpCounts[followUpValue] ?? Number.parseInt(followUpValue, 10))
    : undefined;

  return tripImpactReportSchema.parse({
    sourceText,
    summary: sourceText.slice(0, 4_000),
    ...(eventAttendance === undefined
      ? {}
      : { eventAttendance, attendanceConfidence: "estimated" }),
    ...(followUpCount === undefined ? {} : { followUpCount }),
    links: options.existing?.links ?? [],
    createdAt: options.existing?.createdAt ?? options.now,
    updatedAt: options.now,
  });
}

export function updateTripImpactReport(options: {
  document: RoadieDocument;
  now: string;
  report: TripImpactReport;
  tripId: string;
}): RoadieDocument {
  const report = tripImpactReportSchema.parse({
    ...options.report,
    updatedAt: options.now,
  });
  return roadieDocumentSchema.parse({
    ...options.document,
    trips: options.document.trips.map((trip) =>
      trip.id === options.tripId ? { ...trip, impactReport: report, updatedAt: options.now } : trip,
    ),
    updatedAt: options.now,
  });
}

export function updateEngagementOutcome(options: {
  document: RoadieDocument;
  itemId: string;
  now: string;
  outcome: EngagementOutcome;
  tripId: string;
}): RoadieDocument {
  const outcome = engagementOutcomeSchema.parse({
    ...options.outcome,
    updatedAt: options.now,
  });
  return roadieDocumentSchema.parse({
    ...options.document,
    trips: options.document.trips.map((trip) =>
      trip.id === options.tripId
        ? {
            ...trip,
            timeline: trip.timeline.map((item) =>
              item.id === options.itemId ? { ...item, outcome, updatedAt: options.now } : item,
            ),
            updatedAt: options.now,
          }
        : trip,
    ),
    updatedAt: options.now,
  });
}

export function updateShareSettings(
  document: RoadieDocument,
  shareSettings: RoadieShareSettings,
  now: string,
): RoadieDocument {
  return roadieDocumentSchema.parse({
    ...document,
    shareSettings,
    updatedAt: now,
  });
}

export function acceptProposal(options: {
  document: RoadieDocument;
  now: string;
  proposal: Proposal;
  tripId: string;
}): RoadieDocument {
  return roadieDocumentSchema.parse({
    ...options.document,
    trips: options.document.trips.map((trip) =>
      trip.id === options.tripId
        ? {
            ...trip,
            timeline: [
              ...trip.timeline,
              {
                ...options.proposal,
                createdAt: options.now,
                updatedAt: options.now,
              },
            ],
            updatedAt: options.now,
          }
        : trip,
    ),
    updatedAt: options.now,
  });
}

export function updateTimelineItem(options: {
  document: RoadieDocument;
  item: TimelineItem;
  now: string;
  tripId: string;
}): RoadieDocument {
  const item = timelineItemSchema.parse({
    ...options.item,
    updatedAt: options.now,
  });
  return roadieDocumentSchema.parse({
    ...options.document,
    trips: options.document.trips.map((trip) =>
      trip.id === options.tripId
        ? {
            ...trip,
            timeline: trip.timeline.map((candidate) =>
              candidate.id === item.id ? item : candidate,
            ),
            updatedAt: options.now,
          }
        : trip,
    ),
    updatedAt: options.now,
  });
}

export function deleteTimelineItem(options: {
  document: RoadieDocument;
  itemId: string;
  now: string;
  tripId: string;
}): RoadieDocument {
  return roadieDocumentSchema.parse({
    ...options.document,
    trips: options.document.trips.map((trip) =>
      trip.id === options.tripId
        ? {
            ...trip,
            timeline: trip.timeline.filter((candidate) => candidate.id !== options.itemId),
            updatedAt: options.now,
          }
        : trip,
    ),
    updatedAt: options.now,
  });
}

export function deleteTrip(document: RoadieDocument, tripId: string, now: string): RoadieDocument {
  return roadieDocumentSchema.parse({
    ...document,
    trips: document.trips.filter((trip) => trip.id !== tripId),
    updatedAt: now,
  });
}
