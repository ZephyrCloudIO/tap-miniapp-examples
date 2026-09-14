import type { PublicBookingCoordinationScope } from "./public-booking-create";
import type {
  PublicBookingManagementProvider,
  PublicBookingManagementProviderCommand,
  PublicBookingManagementProviderRecovery,
  PublicBookingManagementProviderResult,
} from "./public-booking-management";

export type PublicGoogleManagementBookingStatus = "confirmed" | "pending";

/**
 * Scope-first Google commands. They contain no Request and no identity headers;
 * the public boundary must resolve the owner before calling this service.
 */
export interface ScopeFirstGoogleCancellationInput {
  readonly scope: PublicBookingCoordinationScope;
  readonly destinationCalendarId: string;
  readonly providerEventId: string;
  readonly providerOperationId: string;
  readonly operationId: string;
  readonly originalCommitHash: string;
  readonly cancellationHash: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly bookingStatus: PublicGoogleManagementBookingStatus;
}

export interface ScopeFirstGoogleRescheduleInput {
  readonly scope: PublicBookingCoordinationScope;
  readonly destinationCalendarId: string;
  readonly providerEventId: string;
  readonly providerOperationId: string;
  readonly operationId: string;
  readonly originalCommitHash: string;
  readonly rescheduleHash: string;
  readonly originalTimeMin: string;
  readonly originalTimeMax: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly conflictCalendarIds: readonly string[];
  readonly conflictTimeMin: string;
  readonly conflictTimeMax: string;
  readonly bookingStatus: PublicGoogleManagementBookingStatus;
}

export interface ScopeFirstGoogleManagementService {
  cancel(input: ScopeFirstGoogleCancellationInput): Promise<PublicBookingManagementProviderResult>;
  recoverCancellation(
    input: ScopeFirstGoogleCancellationInput,
  ): Promise<PublicBookingManagementProviderRecovery>;
  reschedule(input: ScopeFirstGoogleRescheduleInput): Promise<PublicBookingManagementProviderResult>;
  recoverReschedule(
    input: ScopeFirstGoogleRescheduleInput,
  ): Promise<PublicBookingManagementProviderRecovery>;
}

const cancellationCommand = (
  input: PublicBookingManagementProviderCommand,
): ScopeFirstGoogleCancellationInput | null =>
  input.kind === "cancel" &&
      input.newStartsAt === null && input.newEndsAt === null &&
      input.conflictCalendarIds.length === 0 &&
      input.conflictStart === null && input.conflictEnd === null
    ? {
        scope: input.scope,
        destinationCalendarId: input.destinationCalendarId,
        providerEventId: input.providerBookingId,
        providerOperationId: input.providerOperationId,
        operationId: input.operationId,
        originalCommitHash: input.providerCommitProof,
        cancellationHash: input.mutationProof,
        timeMin: input.startsAt,
        timeMax: input.endsAt,
        bookingStatus: input.bookingStatus,
      }
    : null;

const rescheduleCommand = (
  input: PublicBookingManagementProviderCommand,
): ScopeFirstGoogleRescheduleInput | null =>
  input.kind === "reschedule" &&
      input.newStartsAt !== null && input.newEndsAt !== null &&
      input.conflictCalendarIds.length > 0 &&
      input.conflictStart !== null && input.conflictEnd !== null
    ? {
        scope: input.scope,
        destinationCalendarId: input.destinationCalendarId,
        providerEventId: input.providerBookingId,
        providerOperationId: input.providerOperationId,
        operationId: input.operationId,
        originalCommitHash: input.providerCommitProof,
        rescheduleHash: input.mutationProof,
        originalTimeMin: input.startsAt,
        originalTimeMax: input.endsAt,
        timeMin: input.newStartsAt,
        timeMax: input.newEndsAt,
        conflictCalendarIds: input.conflictCalendarIds,
        conflictTimeMin: input.conflictStart,
        conflictTimeMax: input.conflictEnd,
        bookingStatus: input.bookingStatus,
      }
    : null;

export const createPublicGoogleBookingManagementProvider = (
  service: ScopeFirstGoogleManagementService,
): PublicBookingManagementProvider => ({
  cancel(input) {
    const command = cancellationCommand(input);
    return command ? service.cancel(command) : Promise.resolve({ status: "uncertain" });
  },
  reschedule(input) {
    const command = rescheduleCommand(input);
    return command ? service.reschedule(command) : Promise.resolve({ status: "uncertain" });
  },
  recover(input) {
    if (input.kind === "cancel") {
      const command = cancellationCommand(input);
      return command
        ? service.recoverCancellation(command)
        : Promise.resolve({ status: "uncertain" });
    }
    const command = rescheduleCommand(input);
    return command
      ? service.recoverReschedule(command)
      : Promise.resolve({ status: "uncertain" });
  },
});
