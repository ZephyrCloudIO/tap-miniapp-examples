import { compareAsc, isWithinInterval } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { TimelineItem, Trip } from "./domain";

const PURPOSE_LABELS: Readonly<Record<Trip["purpose"], string>> = {
  conference: "Conference",
  meetup: "Meetup",
  podcast: "Podcast",
  work: "Work trip",
  personal: "Personal",
  other: "Other",
};

const ENGAGEMENT_LABELS: Readonly<Record<NonNullable<TimelineItem["engagementType"]>, string>> = {
  talk: "Talk",
  panel: "Panel discussion",
  workshop: "Workshop",
  podcast: "Podcast",
  interview: "Interview",
  keynote: "Keynote",
  livestream: "Livestream",
};

export function tripShareText(trip: Trip): string {
  const items = trip.timeline
    .toSorted((left, right) => compareAsc(left.start, right.start))
    .map(
      (item) =>
        `• ${item.title} — ${formatInTimeZone(
          item.start,
          item.timeZone,
          "d MMM yyyy, HH:mm 'local'",
        )}`,
    );
  return [
    `Roadie trip: ${trip.title}`,
    trip.location ? `Location: ${trip.location}` : null,
    ...items,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export type ImpactShareOptions = {
  includeAttendance: boolean;
  includeAudience: boolean;
  includeFollowUps: boolean;
  includeHighlights: boolean;
  includeOutcomes: boolean;
  includeSponsorValue: boolean;
};

export const DEFAULT_IMPACT_SHARE_OPTIONS: ImpactShareOptions = {
  includeAttendance: true,
  includeAudience: true,
  includeFollowUps: true,
  includeHighlights: true,
  includeOutcomes: true,
  includeSponsorValue: false,
};

export function upcomingEngagementsShareText(trips: readonly Trip[], from: Date): string {
  const summaries = trips.flatMap((trip) => {
    const engagements = trip.timeline
      .filter(
        (item) =>
          new Date(item.start) >= from &&
          item.engagementType !== null &&
          (item.engagementType !== undefined || item.kind === "talk"),
      )
      .toSorted((left, right) => compareAsc(left.start, right.start));
    if (engagements.length === 0) return [];
    return [
      [
        `${PURPOSE_LABELS[trip.purpose]}: ${trip.title}`,
        trip.location ? `Location: ${trip.location}` : null,
        ...engagements.map((item) => {
          const type = item.engagementType ? ENGAGEMENT_LABELS[item.engagementType] : "Talk";
          return [
            `• ${type}: ${item.title} — ${formatInTimeZone(
              item.start,
              item.timeZone,
              "d MMM yyyy, HH:mm",
            )}`,
          ]
            .filter((line): line is string => line !== null)
            .join("\n");
        }),
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    ];
  });
  return ["Upcoming public engagements", ...summaries].join("\n\n");
}

export function tripImpactShareText(trip: Trip, options: ImpactShareOptions): string {
  const engagements = trip.timeline.filter((item) => item.engagementType);
  const report = trip.impactReport;
  return [
    `Roadie impact report: ${trip.title}`,
    trip.location ? `Location: ${trip.location}` : null,
    !options.includeAttendance || report?.eventAttendance === undefined
      ? null
      : `Estimated event attendance: ${report.eventAttendance.toLocaleString("en")}`,
    `Public engagements: ${engagements.length}`,
    ...engagements.map((item) =>
      [
        `• ${item.engagementType ? ENGAGEMENT_LABELS[item.engagementType] : "Talk"}: ${item.title}`,
        !options.includeAudience || item.outcome?.audienceCount === undefined
          ? null
          : `  Direct audience: ${item.outcome.audienceCount.toLocaleString("en")}`,
        options.includeHighlights && item.outcome?.highlight
          ? `  Highlight: ${item.outcome.highlight}`
          : null,
        options.includeOutcomes && item.outcome?.outcome
          ? `  Outcome: ${item.outcome.outcome}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    ),
    options.includeHighlights && report?.highlights ? `Highlights: ${report.highlights}` : null,
    options.includeOutcomes && report?.outcomes ? `Outcomes: ${report.outcomes}` : null,
    options.includeSponsorValue && report?.sponsorValue
      ? `Sponsor value: ${report.sponsorValue}`
      : null,
    !options.includeFollowUps || report?.followUpCount === undefined
      ? null
      : `Follow-ups: ${report.followUpCount}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function impactDigestShareText(
  trips: readonly Trip[],
  period: { end: Date; label: string; start: Date },
  options: ImpactShareOptions,
): string {
  const periodTrips = trips
    .map((trip) => ({
      ...trip,
      timeline: trip.timeline.filter((item) =>
        isWithinInterval(new Date(item.start), {
          start: period.start,
          end: period.end,
        }),
      ),
    }))
    .filter((trip) => trip.timeline.some((item) => item.engagementType));
  const engagements = periodTrips.flatMap((trip) =>
    trip.timeline.filter((item) => item.engagementType),
  );
  const eventReach = periodTrips.reduce(
    (total, trip) => total + (trip.impactReport?.eventAttendance ?? 0),
    0,
  );
  const directAudience = engagements.reduce(
    (total, item) => total + (item.outcome?.audienceCount ?? 0),
    0,
  );
  const followUps =
    periodTrips.reduce((total, trip) => total + (trip.impactReport?.followUpCount ?? 0), 0) +
    engagements.reduce((total, item) => total + (item.outcome?.followUpCount ?? 0), 0);

  return [
    `Roadie impact digest · ${period.label}`,
    `Trips: ${periodTrips.length}`,
    `Public engagements: ${engagements.length}`,
    options.includeAttendance && eventReach > 0
      ? `Estimated event reach: ${eventReach.toLocaleString("en")}`
      : null,
    options.includeAudience && directAudience > 0
      ? `Direct audience: ${directAudience.toLocaleString("en")}`
      : null,
    options.includeFollowUps && followUps > 0 ? `Follow-ups: ${followUps}` : null,
    ...periodTrips.map((trip) =>
      [
        `${PURPOSE_LABELS[trip.purpose]}: ${trip.title}`,
        trip.location ? `Location: ${trip.location}` : null,
        ...trip.timeline
          .filter((item) => item.engagementType)
          .map(
            (item) =>
              `• ${item.engagementType ? ENGAGEMENT_LABELS[item.engagementType] : "Talk"}: ${item.title}`,
          ),
        options.includeHighlights && trip.impactReport?.highlights
          ? `Highlights: ${trip.impactReport.highlights}`
          : null,
        options.includeOutcomes && trip.impactReport?.outcomes
          ? `Outcomes: ${trip.impactReport.outcomes}`
          : null,
        options.includeSponsorValue && trip.impactReport?.sponsorValue
          ? `Programme value: ${trip.impactReport.sponsorValue}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    ),
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}
