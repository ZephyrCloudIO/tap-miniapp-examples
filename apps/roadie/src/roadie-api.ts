import type { MiniAppHttpApi } from "@theaiplatform/miniapp-sdk";
import {
  deleteTripResponseSchema,
  getWorkspaceContextResponseSchema,
  listTripsResponseSchema,
  putTripResponseSchema,
} from "@tap-examples/roadie-contract/zod";
import type {
  DeleteTripResponse,
  GetWorkspaceContextResponse,
  ListTripsResponse,
  PutTripResponse,
  RoadieEngagementOutcome,
  RoadieEvidence,
  RoadieTimelineItem,
  RoadieTrip,
  RoadieTripImpactReport,
} from "@tap-examples/roadie-contract";
import type { z } from "zod";

import { tripSchema, type TimelineItem, type Trip } from "./domain";

export const ROADIE_API_ORIGIN = "https://tap-roadie-api-dev.zephyrwmf.workers.dev";

const PURPOSE_TO_SERVICE = {
  conference: "ROADIE_TRIP_PURPOSE_CONFERENCE",
  meetup: "ROADIE_TRIP_PURPOSE_MEETUP",
  podcast: "ROADIE_TRIP_PURPOSE_PODCAST",
  work: "ROADIE_TRIP_PURPOSE_WORK",
  personal: "ROADIE_TRIP_PURPOSE_PERSONAL",
  other: "ROADIE_TRIP_PURPOSE_OTHER",
} as const satisfies Readonly<Record<Trip["purpose"], RoadieTrip["purpose"]>>;

const PURPOSE_FROM_SERVICE = {
  ROADIE_TRIP_PURPOSE_CONFERENCE: "conference",
  ROADIE_TRIP_PURPOSE_MEETUP: "meetup",
  ROADIE_TRIP_PURPOSE_PODCAST: "podcast",
  ROADIE_TRIP_PURPOSE_WORK: "work",
  ROADIE_TRIP_PURPOSE_PERSONAL: "personal",
  ROADIE_TRIP_PURPOSE_OTHER: "other",
} as const satisfies Readonly<Record<RoadieTrip["purpose"], Trip["purpose"]>>;

const ITEM_KIND_TO_SERVICE = {
  talk: "ROADIE_ITINERARY_ITEM_KIND_TALK",
  social: "ROADIE_ITINERARY_ITEM_KIND_SOCIAL",
  meeting: "ROADIE_ITINERARY_ITEM_KIND_MEETING",
  travel: "ROADIE_ITINERARY_ITEM_KIND_TRAVEL",
  hotel: "ROADIE_ITINERARY_ITEM_KIND_HOTEL",
  personal: "ROADIE_ITINERARY_ITEM_KIND_PERSONAL",
  other: "ROADIE_ITINERARY_ITEM_KIND_OTHER",
} as const satisfies Readonly<Record<TimelineItem["kind"], RoadieTimelineItem["kind"]>>;

const ITEM_KIND_FROM_SERVICE = {
  ROADIE_ITINERARY_ITEM_KIND_TALK: "talk",
  ROADIE_ITINERARY_ITEM_KIND_SOCIAL: "social",
  ROADIE_ITINERARY_ITEM_KIND_MEETING: "meeting",
  ROADIE_ITINERARY_ITEM_KIND_TRAVEL: "travel",
  ROADIE_ITINERARY_ITEM_KIND_HOTEL: "hotel",
  ROADIE_ITINERARY_ITEM_KIND_PERSONAL: "personal",
  ROADIE_ITINERARY_ITEM_KIND_OTHER: "other",
} as const satisfies Readonly<Record<RoadieTimelineItem["kind"], TimelineItem["kind"]>>;

const ENGAGEMENT_TO_SERVICE = {
  talk: "ROADIE_ENGAGEMENT_TYPE_TALK",
  panel: "ROADIE_ENGAGEMENT_TYPE_PANEL",
  workshop: "ROADIE_ENGAGEMENT_TYPE_WORKSHOP",
  podcast: "ROADIE_ENGAGEMENT_TYPE_PODCAST",
  interview: "ROADIE_ENGAGEMENT_TYPE_INTERVIEW",
  keynote: "ROADIE_ENGAGEMENT_TYPE_KEYNOTE",
  livestream: "ROADIE_ENGAGEMENT_TYPE_LIVESTREAM",
} as const satisfies Readonly<
  Record<NonNullable<TimelineItem["engagementType"]>, NonNullable<RoadieTimelineItem["engagementType"]>>
>;

const ENGAGEMENT_FROM_SERVICE = {
  ROADIE_ENGAGEMENT_TYPE_TALK: "talk",
  ROADIE_ENGAGEMENT_TYPE_PANEL: "panel",
  ROADIE_ENGAGEMENT_TYPE_WORKSHOP: "workshop",
  ROADIE_ENGAGEMENT_TYPE_PODCAST: "podcast",
  ROADIE_ENGAGEMENT_TYPE_INTERVIEW: "interview",
  ROADIE_ENGAGEMENT_TYPE_KEYNOTE: "keynote",
  ROADIE_ENGAGEMENT_TYPE_LIVESTREAM: "livestream",
} as const satisfies Readonly<
  Record<NonNullable<RoadieTimelineItem["engagementType"]>, NonNullable<TimelineItem["engagementType"]>>
>;

const METRIC_TO_SERVICE = {
  confirmed: "ROADIE_METRIC_CONFIDENCE_CONFIRMED",
  estimated: "ROADIE_METRIC_CONFIDENCE_ESTIMATED",
  derived: "ROADIE_METRIC_CONFIDENCE_DERIVED",
} as const;

const METRIC_FROM_SERVICE = {
  ROADIE_METRIC_CONFIDENCE_CONFIRMED: "confirmed",
  ROADIE_METRIC_CONFIDENCE_ESTIMATED: "estimated",
  ROADIE_METRIC_CONFIDENCE_DERIVED: "derived",
} as const;

const EVIDENCE_SOURCE_TO_SERVICE = {
  "pasted-text": "ROADIE_EVIDENCE_SOURCE_KIND_PASTED_TEXT",
  "official-site": "ROADIE_EVIDENCE_SOURCE_KIND_OFFICIAL_SITE",
  user: "ROADIE_EVIDENCE_SOURCE_KIND_USER",
  "demo-fixture": "ROADIE_EVIDENCE_SOURCE_KIND_DEMO_FIXTURE",
} as const;

const EVIDENCE_SOURCE_FROM_SERVICE = {
  ROADIE_EVIDENCE_SOURCE_KIND_PASTED_TEXT: "pasted-text",
  ROADIE_EVIDENCE_SOURCE_KIND_OFFICIAL_SITE: "official-site",
  ROADIE_EVIDENCE_SOURCE_KIND_USER: "user",
  ROADIE_EVIDENCE_SOURCE_KIND_DEMO_FIXTURE: "demo-fixture",
} as const;

const EVIDENCE_CONFIDENCE_TO_SERVICE = {
  high: "ROADIE_EVIDENCE_CONFIDENCE_HIGH",
  medium: "ROADIE_EVIDENCE_CONFIDENCE_MEDIUM",
  low: "ROADIE_EVIDENCE_CONFIDENCE_LOW",
} as const;

const EVIDENCE_CONFIDENCE_FROM_SERVICE = {
  ROADIE_EVIDENCE_CONFIDENCE_HIGH: "high",
  ROADIE_EVIDENCE_CONFIDENCE_MEDIUM: "medium",
  ROADIE_EVIDENCE_CONFIDENCE_LOW: "low",
} as const;

function toServiceEvidence(evidence: TimelineItem["evidence"][number]): RoadieEvidence {
  return {
    sourceKind: EVIDENCE_SOURCE_TO_SERVICE[evidence.sourceKind],
    sourceLabel: evidence.sourceLabel,
    ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
    capturedAtMs: new Date(evidence.capturedAt).getTime(),
    ...(evidence.confidence
      ? { confidence: EVIDENCE_CONFIDENCE_TO_SERVICE[evidence.confidence] }
      : {}),
  };
}

function toServiceOutcome(outcome: NonNullable<TimelineItem["outcome"]>): RoadieEngagementOutcome {
  return {
    ...(outcome.audienceCount === undefined ? {} : { audienceCount: outcome.audienceCount }),
    ...(outcome.audienceConfidence
      ? { audienceConfidence: METRIC_TO_SERVICE[outcome.audienceConfidence] }
      : {}),
    ...(outcome.highlight ? { highlight: outcome.highlight } : {}),
    ...(outcome.outcome ? { outcome: outcome.outcome } : {}),
    ...(outcome.followUpCount === undefined ? {} : { followUpCount: outcome.followUpCount }),
    links: outcome.links,
    updatedAtMs: new Date(outcome.updatedAt).getTime(),
  };
}

function toServiceImpactReport(report: NonNullable<Trip["impactReport"]>): RoadieTripImpactReport {
  return {
    sourceText: report.sourceText,
    ...(report.eventAttendance === undefined ? {} : { eventAttendance: report.eventAttendance }),
    ...(report.attendanceConfidence
      ? { attendanceConfidence: METRIC_TO_SERVICE[report.attendanceConfidence] }
      : {}),
    summary: report.summary,
    ...(report.highlights ? { highlights: report.highlights } : {}),
    ...(report.outcomes ? { outcomes: report.outcomes } : {}),
    ...(report.sponsorValue ? { sponsorValue: report.sponsorValue } : {}),
    ...(report.privateReflection ? { privateReflection: report.privateReflection } : {}),
    ...(report.followUpCount === undefined ? {} : { followUpCount: report.followUpCount }),
    links: report.links,
    createdAtMs: new Date(report.createdAt).getTime(),
    updatedAtMs: new Date(report.updatedAt).getTime(),
  };
}

// This is the true external service boundary: the UI uses readable ISO strings while
// protobuf JSON uses millisecond timestamps and stable enum literals.
export function toServiceTrip(trip: Trip, workspaceId: string, ownerUserId: string): RoadieTrip {
  return {
    tripId: trip.id,
    workspaceId,
    ownerUserId,
    title: trip.title,
    purpose: PURPOSE_TO_SERVICE[trip.purpose],
    ...(trip.location ? { location: trip.location } : {}),
    createdAtMs: new Date(trip.createdAt).getTime(),
    updatedAtMs: new Date(trip.updatedAt).getTime(),
    timeline: trip.timeline.map((item) => ({
      itemId: item.id,
      title: item.title,
      startAtMs: new Date(item.start).getTime(),
      timeZone: item.timeZone,
      kind: ITEM_KIND_TO_SERVICE[item.kind],
      ...(item.engagementType
        ? { engagementType: ENGAGEMENT_TO_SERVICE[item.engagementType] }
        : {}),
      evidence: item.evidence.map(toServiceEvidence),
      ...(item.outcome ? { outcome: toServiceOutcome(item.outcome) } : {}),
      createdAtMs: new Date(item.createdAt).getTime(),
      updatedAtMs: new Date(item.updatedAt).getTime(),
    })),
    ...(trip.impactReport ? { impactReport: toServiceImpactReport(trip.impactReport) } : {}),
  };
}

function fromServiceTrip(trip: RoadieTrip): Trip {
  return tripSchema.parse({
    id: trip.tripId,
    title: trip.title,
    purpose: PURPOSE_FROM_SERVICE[trip.purpose],
    ...(trip.location ? { location: trip.location } : {}),
    createdAt: new Date(trip.createdAtMs).toISOString(),
    updatedAt: new Date(trip.updatedAtMs).toISOString(),
    timeline: trip.timeline.map((item) => ({
      id: item.itemId,
      title: item.title,
      start: new Date(item.startAtMs).toISOString(),
      timeZone: item.timeZone,
      kind: ITEM_KIND_FROM_SERVICE[item.kind],
      ...(item.engagementType
        ? { engagementType: ENGAGEMENT_FROM_SERVICE[item.engagementType] }
        : {}),
      evidence: item.evidence.map((evidence) => ({
        sourceKind: EVIDENCE_SOURCE_FROM_SERVICE[evidence.sourceKind],
        sourceLabel: evidence.sourceLabel,
        ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
        capturedAt: new Date(evidence.capturedAtMs).toISOString(),
        ...(evidence.confidence
          ? { confidence: EVIDENCE_CONFIDENCE_FROM_SERVICE[evidence.confidence] }
          : {}),
      })),
      ...(item.outcome
        ? {
            outcome: {
              ...(item.outcome.audienceCount === undefined
                ? {}
                : { audienceCount: item.outcome.audienceCount }),
              ...(item.outcome.audienceConfidence
                ? {
                    audienceConfidence:
                      METRIC_FROM_SERVICE[item.outcome.audienceConfidence],
                  }
                : {}),
              ...(item.outcome.highlight ? { highlight: item.outcome.highlight } : {}),
              ...(item.outcome.outcome ? { outcome: item.outcome.outcome } : {}),
              ...(item.outcome.followUpCount === undefined
                ? {}
                : { followUpCount: item.outcome.followUpCount }),
              links: item.outcome.links,
              updatedAt: new Date(item.outcome.updatedAtMs).toISOString(),
            },
          }
        : {}),
      createdAt: new Date(item.createdAtMs).toISOString(),
      updatedAt: new Date(item.updatedAtMs).toISOString(),
    })),
    ...(trip.impactReport
      ? {
          impactReport: {
            sourceText: trip.impactReport.sourceText,
            ...(trip.impactReport.eventAttendance === undefined
              ? {}
              : { eventAttendance: trip.impactReport.eventAttendance }),
            ...(trip.impactReport.attendanceConfidence
              ? {
                  attendanceConfidence:
                    METRIC_FROM_SERVICE[trip.impactReport.attendanceConfidence],
                }
              : {}),
            summary: trip.impactReport.summary,
            ...(trip.impactReport.highlights
              ? { highlights: trip.impactReport.highlights }
              : {}),
            ...(trip.impactReport.outcomes ? { outcomes: trip.impactReport.outcomes } : {}),
            ...(trip.impactReport.sponsorValue
              ? { sponsorValue: trip.impactReport.sponsorValue }
              : {}),
            ...(trip.impactReport.privateReflection
              ? { privateReflection: trip.impactReport.privateReflection }
              : {}),
            ...(trip.impactReport.followUpCount === undefined
              ? {}
              : { followUpCount: trip.impactReport.followUpCount }),
            links: trip.impactReport.links,
            createdAt: new Date(trip.impactReport.createdAtMs).toISOString(),
            updatedAt: new Date(trip.impactReport.updatedAtMs).toISOString(),
          },
        }
      : {}),
  });
}

async function callRoadie<TSchema extends z.ZodType>(
  http: MiniAppHttpApi | undefined,
  method: string,
  input: unknown,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  if (!http) {
    throw new Error("This TAP host does not provide authenticated HTTP.");
  }
  const response = await http.request(
    {
      method: "POST",
      url: `${ROADIE_API_ORIGIN}/rpc/tap.roadie.v1.RoadieService/${method}`,
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Connect-Protocol-Version", value: "1" },
      ],
      body: JSON.stringify(input),
      timeoutMs: 20_000,
      responseBodyLimitBytes: 1_048_576,
    },
    { credentialRef: "platform-session" },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      response.bodyText?.trim() ||
        `Roadie service returned ${response.status} ${response.statusText}.`,
    );
  }
  if (!response.bodyText) {
    throw new Error("Roadie service returned an empty response.");
  }
  const value: unknown = await new Response(response.bodyText, {
    headers: { "Content-Type": "application/json" },
  }).json();
  return schema.parse(value);
}

export function getWorkspaceContext(
  http: MiniAppHttpApi | undefined,
  workspaceId: string,
): Promise<GetWorkspaceContextResponse> {
  return callRoadie(
    http,
    "GetWorkspaceContext",
    { workspaceId },
    getWorkspaceContextResponseSchema,
  );
}

export function listSharedTrips(
  http: MiniAppHttpApi | undefined,
  workspaceId: string,
): Promise<ListTripsResponse> {
  return callRoadie(http, "ListTrips", { workspaceId }, listTripsResponseSchema);
}

export async function listWorkspaceTrips(
  http: MiniAppHttpApi | undefined,
  workspaceId: string,
): Promise<Trip[]> {
  const response = await listSharedTrips(http, workspaceId);
  return response.trips.map(fromServiceTrip);
}

export async function putWorkspaceTrip(
  http: MiniAppHttpApi | undefined,
  options: {
    ownerUserId: string;
    requestId: string;
    trip: Trip;
    workspaceId: string;
  },
): Promise<Trip> {
  const response = await callRoadie(
    http,
    "PutTrip",
    {
      workspaceId: options.workspaceId,
      requestId: options.requestId,
      trip: toServiceTrip(options.trip, options.workspaceId, options.ownerUserId),
    },
    putTripResponseSchema,
  );
  if (!response.trip) throw new Error("Roadie service did not return the saved trip.");
  return fromServiceTrip(response.trip);
}

export async function deleteWorkspaceTrip(
  http: MiniAppHttpApi | undefined,
  options: { requestId: string; tripId: string; workspaceId: string },
): Promise<DeleteTripResponse> {
  return await callRoadie(
    http,
    "DeleteTrip",
    options,
    deleteTripResponseSchema,
  );
}
