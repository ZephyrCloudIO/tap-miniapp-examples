import type { PublicBookingPublicationInput } from "./public-booking-publication";

/** Server-owned policy snapshot. Never accepted from an anonymous caller. */
export interface CollectiveHost {
  readonly principalId: string;
  readonly version: number;
  readonly displayName: string;
  readonly email: string;
  readonly destinationCalendarId: string;
  readonly conflictCalendarIds: readonly string[];
  readonly sourceAvailabilityScheduleId: string;
  readonly schedule: PublicBookingPublicationInput["schedule"];
}

export interface WorkspaceEventType {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly hostIds: readonly string[];
  readonly organizerId: string;
  readonly location: "google-meet" | "zoom";
  readonly approvalRequired: boolean;
}

export interface WorkspaceBookingDefinition {
  readonly version: number;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly published: boolean;
  readonly events: readonly WorkspaceEventType[];
}
