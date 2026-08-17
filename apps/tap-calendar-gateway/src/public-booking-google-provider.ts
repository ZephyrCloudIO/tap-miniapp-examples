import type {
  PublicBookingCoordinationScope,
  PublicBookingProvider,
  PublicProviderBookingCommit,
  PublicProviderBookingRecovery,
} from "./public-booking-create";

/**
 * Canonical command accepted by the Google booking engine after the public
 * boundary has resolved the page owner. There is deliberately no Request or
 * header input here: owner authority is carried only by the server-resolved
 * scope.
 */
export interface ScopeFirstGoogleBookingCommitInput {
  readonly scope: PublicBookingCoordinationScope;
  readonly idempotencyKey: string;
  readonly providerEventId: string;
  readonly requestHash: string;
  readonly destinationCalendarId: string;
  /** These are the unbuffered event times written to Google. */
  readonly timeMin: string;
  readonly timeMax: string;
  /** This complete buffer-expanded range is checked while provider locks are held. */
  readonly conflictTimeMin: string;
  readonly conflictTimeMax: string;
  readonly conflictCalendarIds: readonly string[];
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly bookingKind: "meeting" | "approval-hold";
  readonly attendeeEmails: readonly string[];
  readonly conferenceProvider: "none" | "google-meet";
  readonly expiresAt: string | null;
}

export interface ScopeFirstGoogleBookingRecoveryInput {
  readonly scope: PublicBookingCoordinationScope;
  readonly destinationCalendarId: string;
  readonly providerEventId: string;
  readonly requestHash: string;
  readonly timeMin: string;
  readonly timeMax: string;
}

export interface ScopeFirstGoogleBookingService {
  commit(input: ScopeFirstGoogleBookingCommitInput): Promise<PublicProviderBookingCommit>;
  recover(input: ScopeFirstGoogleBookingRecoveryInput): Promise<PublicProviderBookingRecovery>;
}

/**
 * Adapts the public-booking port to the existing Google provider engine. The
 * operation ID is also the private provider-commit idempotency key: it is
 * deterministic for the public request and never comes from an organizer
 * authentication header.
 */
export const createPublicGoogleBookingProvider = (
  service: ScopeFirstGoogleBookingService,
): PublicBookingProvider => ({
  recover(input) {
    return service.recover({
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.operationId,
      requestHash: input.commitProof,
      timeMin: input.startsAt,
      timeMax: input.endsAt,
    });
  },
  commit(input) {
    return service.commit({
      scope: input.scope,
      idempotencyKey: input.operationId,
      providerEventId: input.operationId,
      requestHash: input.commitProof,
      destinationCalendarId: input.destinationCalendarId,
      timeMin: input.startsAt,
      timeMax: input.endsAt,
      conflictTimeMin: input.conflictStart,
      conflictTimeMax: input.conflictEnd,
      conflictCalendarIds: input.conflictCalendarIds,
      title: input.title,
      description: input.description || null,
      location: input.location || null,
      bookingKind: input.bookingKind,
      attendeeEmails: [input.guest.email],
      conferenceProvider: input.conferenceProvider,
      expiresAt: input.expiresAt,
    });
  },
});
