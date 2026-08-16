import { getYear } from "date-fns";

import type { TimelineItem, Trip } from "./domain";

export type RoadieImpactSummary = {
  directAudience: number;
  engagementCounts: Readonly<Partial<Record<NonNullable<TimelineItem["engagementType"]>, number>>>;
  estimatedEventReach: number;
  followUps: number;
  locations: number;
  publicEngagements: number;
  reportedTrips: number;
  trips: number;
};

export function impactYears(trips: readonly Trip[]): number[] {
  return [
    ...new Set(trips.flatMap((trip) => trip.timeline.map((item) => getYear(new Date(item.start))))),
  ].toSorted((left, right) => right - left);
}

export function summarizeImpact(trips: readonly Trip[], year: number): RoadieImpactSummary {
  const engagementCounts: Partial<Record<NonNullable<TimelineItem["engagementType"]>, number>> = {};
  let directAudience = 0;
  let estimatedEventReach = 0;
  let followUps = 0;
  let publicEngagements = 0;
  let reportedTrips = 0;
  const locations = new Set<string>();
  const matchingTrips = trips.filter((trip) =>
    trip.timeline.some((item) => getYear(new Date(item.start)) === year),
  );

  for (const trip of matchingTrips) {
    if (trip.location) locations.add(trip.location);
    if (trip.impactReport) {
      reportedTrips += 1;
      estimatedEventReach += trip.impactReport.eventAttendance ?? 0;
      followUps += trip.impactReport.followUpCount ?? 0;
    }
    for (const item of trip.timeline) {
      if (getYear(new Date(item.start)) !== year || !item.engagementType) {
        continue;
      }
      publicEngagements += 1;
      engagementCounts[item.engagementType] = (engagementCounts[item.engagementType] ?? 0) + 1;
      directAudience += item.outcome?.audienceCount ?? 0;
      followUps += item.outcome?.followUpCount ?? 0;
    }
  }

  return {
    directAudience,
    engagementCounts,
    estimatedEventReach,
    followUps,
    locations: locations.size,
    publicEngagements,
    reportedTrips,
    trips: matchingTrips.length,
  };
}
