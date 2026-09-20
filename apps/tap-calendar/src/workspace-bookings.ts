import type { PublicBookingPublicationInput } from "./public-booking-publication";

export interface SharedHost {
  readonly principalId: string;
  readonly version: number;
  readonly displayName: string;
  readonly email: string;
  readonly destinationCalendarId: string;
  readonly conflictCalendarIds: readonly string[];
  readonly sourceAvailabilityScheduleId: string;
  readonly schedule: PublicBookingPublicationInput["schedule"];
}

export interface SharedEventType {
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

export interface WorkspaceBookingProfile {
  readonly version: number;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly published: boolean;
  readonly events: readonly SharedEventType[];
}

export interface WorkspaceBookings {
  readonly canManage: boolean;
  readonly pendingApprovals: readonly { readonly operationId: string; readonly title: string; readonly guestName: string; readonly guestEmail: string; readonly startsAt: string; readonly conflictCalendarIds: readonly string[]; readonly conferenceProvider: "google-meet" | "zoom" }[];
  readonly self: { readonly enabled: boolean; readonly host: SharedHost } | null;
  readonly definition: WorkspaceBookingProfile | null;
  readonly publication: { readonly current_slug: string; readonly display_name: string; readonly status: string; readonly publication_generation: number; readonly definition_version: number | null; readonly hosts_current: boolean } | null;
  readonly publicBaseUrl: string;
  readonly hosts: readonly Pick<SharedHost, "principalId" | "version" | "displayName" | "email">[];
}

export type SharedHostInput = { readonly expectedVersion: number; readonly enabled: false } | (
  Omit<SharedHost, "principalId" | "version" | "email"> & { readonly expectedVersion: number; readonly enabled: true }
);
export type WorkspaceBookingProfileInput = Omit<WorkspaceBookingProfile, "version"> & { readonly expectedVersion: number };
