import {
  applyPublicBookingProfilePublicationReceipt,
  deriveBookingProfilePublicationState,
  markPublicBookingProfilePublicationPending,
  type BookingProfile,
  type BookingProfileServerPublicationReceipt,
  type CalendarState,
  type PendingBookingProfilePublication,
} from "./domain";
import {
  CalendarGatewayError,
  PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION,
  type CalendarGatewayClient,
  type CalendarGatewayPublishedBookingProfile,
  type CalendarGatewayUnpublishedBookingProfile,
} from "./gateway";
import {
  buildPublicBookingProfilePublication,
  publicBookingProfilePublicationFingerprint,
} from "./public-booking-publication";

export type PublicBookingProfileStateMutation = (
  current: CalendarState,
) => CalendarState;

export interface PublicBookingProfileSyncAdapter {
  readonly gateway: Pick<
    CalendarGatewayClient,
    "publishPublicBookingProfile" | "unpublishPublicBookingProfile"
  >;
  readonly readState: () => CalendarState | null;
  readonly persist: (
    mutation: PublicBookingProfileStateMutation,
    successMessage?: string,
  ) => Promise<boolean>;
  readonly now: () => string;
}

export interface PublicBookingProfileSyncOperation {
  readonly requestKey: string;
  readonly operation: Promise<boolean>;
}

const publishedProfileReceipt = (
  receipt: CalendarGatewayPublishedBookingProfile,
): BookingProfileServerPublicationReceipt => ({
  sourceProfileId: receipt.sourceProfileId,
  generation: receipt.generation,
  status: "published",
  reservedSlug: receipt.profileSlug,
  updatedAt: receipt.publishedAt,
  eventTypes: receipt.pages.map(page => ({
    sourceEventTypeId: page.sourceEventTypeId,
    revisionId: page.revisionId,
    reservedSlug: page.eventTypeSlug,
  })),
});

const unpublishedProfileReceipt = (
  profile: BookingProfile,
  receipt: CalendarGatewayUnpublishedBookingProfile,
): BookingProfileServerPublicationReceipt => ({
  sourceProfileId: receipt.sourceProfileId,
  generation: receipt.generation,
  status: "unpublished",
  reservedSlug: profile.publication?.reservedSlug ?? profile.slug,
  updatedAt: receipt.unpublishedAt,
  eventTypes: [],
});

const removePendingPublication = (
  state: CalendarState,
  profileId: string,
): CalendarState => ({
  ...state,
  bookingProfiles: state.bookingProfiles.map(profile => {
    if (profile.id !== profileId) return profile;
    const withoutPending = { ...profile };
    delete (withoutPending as { pendingPublication?: PendingBookingProfilePublication })
      .pendingPublication;
    return withoutPending;
  }),
});

/**
 * Reconciles one immutable snapshot of a pending organizer intent. A receipt
 * can safely land after the organizer changes their desired state because the
 * domain receipt applier retains that newer pending intent and rebases it to
 * the confirmed server generation.
 */
export async function reconcilePublicBookingProfilePublication(
  profileId: string,
  adapter: PublicBookingProfileSyncAdapter,
): Promise<boolean> {
  let current = adapter.readState();
  let profile = current?.bookingProfiles.find(candidate => candidate.id === profileId);
  if (!current || !profile) return false;

  let acknowledgedPending = profile.pendingPublication;
  if (!acknowledgedPending) {
    const publicationState = deriveBookingProfilePublicationState(profile);
    if (!publicationState.pending) return true;
    const requestedAt = adapter.now();
    const marked = await adapter.persist(state =>
      markPublicBookingProfilePublicationPending(state, profileId, requestedAt));
    if (!marked) return false;
    current = adapter.readState();
    profile = current?.bookingProfiles.find(candidate => candidate.id === profileId);
    acknowledgedPending = profile?.pendingPublication;
    if (!current || !profile || !acknowledgedPending) return false;
  }

  const requestFingerprint = publicBookingProfilePublicationFingerprint(current, profile);
  const requestPending = acknowledgedPending;
  const send = async (
    expectedGeneration: number,
  ): Promise<BookingProfileServerPublicationReceipt> => {
    if (profile!.published) {
      const built = buildPublicBookingProfilePublication(
        current!,
        profile!,
        expectedGeneration,
      );
      if (!built.ok) throw new Error(built.message);
      return publishedProfileReceipt(
        await adapter.gateway.publishPublicBookingProfile(built.publication),
      );
    }
    const receipt = await adapter.gateway.unpublishPublicBookingProfile({
      schemaVersion: PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION,
      sourceProfileId: profile!.id,
      expectedGeneration,
    });
    return unpublishedProfileReceipt(profile!, receipt);
  };

  let receipt: BookingProfileServerPublicationReceipt;
  try {
    receipt = await send(requestPending.expectedGeneration);
  } catch (cause: unknown) {
    if (
      !profile.published &&
      !profile.publication &&
      cause instanceof CalendarGatewayError &&
      cause.code === "publication_not_found"
    ) {
      return adapter.persist(
        state => removePendingPublication(state, profileId),
        "Draft Booking Profile saved.",
      );
    }
    if (
      !(cause instanceof CalendarGatewayError) ||
      cause.code !== "publication_conflict" ||
      cause.currentGeneration === undefined
    ) throw cause;
    const latest = adapter.readState();
    const latestProfile = latest?.bookingProfiles.find(candidate => candidate.id === profileId);
    if (
      !latest ||
      !latestProfile ||
      publicBookingProfilePublicationFingerprint(latest, latestProfile) !== requestFingerprint
    ) {
      return false;
    }
    current = latest;
    profile = latestProfile;
    receipt = await send(cause.currentGeneration);
  }

  return adapter.persist(
    state => applyPublicBookingProfilePublicationReceipt(
      state,
      receipt,
      requestPending,
    ),
    receipt.status === "published"
      ? "Booking Profile is live on cal.with-tap.ai."
      : "Booking Profile unpublished.",
  );
}

/** A stable key for the exact pending intent currently stored for a profile. */
export function publicBookingProfileSyncRequestKey(
  state: CalendarState | null,
  profileId: string,
): string {
  const profile = state?.bookingProfiles.find(candidate => candidate.id === profileId);
  if (!state || !profile) return "missing";
  const publicationState = deriveBookingProfilePublicationState(profile);
  if (profile.pendingPublication) {
    return [
      profile.pendingPublication.desiredStatus,
      profile.pendingPublication.expectedGeneration,
      profile.pendingPublication.requestedAt,
    ].join("\u0000");
  }
  if (publicationState.pending) {
    return [
      "implicit",
      publicationState.desiredStatus,
      publicationState.expectedGeneration,
      publicBookingProfilePublicationFingerprint(state, profile),
    ].join("\u0000");
  }
  return "settled";
}

/**
 * Serializes per-profile requests while retaining every distinct desired
 * state. A newer unpublish therefore runs after an in-flight publish even if
 * the publish fails ambiguously after committing remotely.
 */
export function enqueuePublicBookingProfileSync(
  operations: Map<string, PublicBookingProfileSyncOperation>,
  state: CalendarState | null,
  profileId: string,
  execute: (profileId: string) => Promise<boolean>,
): Promise<boolean> {
  const requestKey = publicBookingProfileSyncRequestKey(state, profileId);
  const running = operations.get(profileId);
  if (running?.requestKey === requestKey) return running.operation;

  let operation: Promise<boolean>;
  const run = () => execute(profileId);
  operation = (running
    ? running.operation.then(run, run)
    : run())
    .finally(() => {
      if (operations.get(profileId)?.operation === operation) {
        operations.delete(profileId);
      }
    });
  operations.set(profileId, { requestKey, operation });
  return operation;
}
