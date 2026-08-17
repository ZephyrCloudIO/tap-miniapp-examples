import { describe, expect, it } from "@rstest/core";
import { markPublicBookingProfilePublicationPending, type CalendarState } from "./domain";
import { CalendarGatewayError } from "./gateway";
import { markChangedPublicBookingProfilesPending } from "./publication-state";
import {
  enqueuePublicBookingProfileSync,
  reconcilePublicBookingProfilePublication,
  type PublicBookingProfileSyncAdapter,
  type PublicBookingProfileSyncOperation,
} from "./publication-sync";
import { createInitialCalendarState } from "./test-fixtures";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("public Booking Profile sync orchestration", () => {
  it("queues and rebases an unpublish after a remotely committed ambiguous publish", async () => {
    const profileId = "profile-zack";
    let state: CalendarState = markPublicBookingProfilePublicationPending(
      createInitialCalendarState(),
      profileId,
      "2026-08-16T20:00:00.000Z",
    );
    const publishCommitted = deferred<void>();
    const releaseAmbiguousResponse = deferred<void>();
    const calls: string[] = [];
    const remote: {
      generation: number;
      status: "published" | "unpublished" | null;
    } = { generation: 0, status: null };

    const gateway: PublicBookingProfileSyncAdapter["gateway"] = {
      async publishPublicBookingProfile(input) {
        calls.push(`publish:${input.expectedGeneration}`);
        if (input.expectedGeneration !== remote.generation) {
          throw new CalendarGatewayError(
            409,
            "publication_conflict",
            "The publication generation changed.",
            remote.generation,
          );
        }
        remote.generation += 1;
        remote.status = "published";
        publishCommitted.resolve();
        await releaseAmbiguousResponse.promise;
        throw new Error("The publish response was lost after the server committed it.");
      },
      async unpublishPublicBookingProfile(input) {
        calls.push(`unpublish:${input.expectedGeneration}`);
        if (input.expectedGeneration !== remote.generation) {
          throw new CalendarGatewayError(
            409,
            "publication_conflict",
            "The publication generation changed.",
            remote.generation,
          );
        }
        remote.generation += 1;
        remote.status = "unpublished";
        return {
          profileId: "public-profile-zack",
          sourceProfileId: input.sourceProfileId,
          generation: remote.generation,
          unpublishedAt: "2026-08-16T20:00:03.000Z",
          idempotentReplay: false,
        };
      },
    };
    const adapter: PublicBookingProfileSyncAdapter = {
      gateway,
      readState: () => state,
      persist: async mutation => {
        state = mutation(state);
        return true;
      },
      now: () => "2026-08-16T20:00:00.000Z",
    };
    const operations = new Map<string, PublicBookingProfileSyncOperation>();
    const execute = async (candidateProfileId: string): Promise<boolean> => {
      try {
        return await reconcilePublicBookingProfilePublication(candidateProfileId, adapter);
      } catch {
        return false;
      }
    };

    const ambiguousPublish = enqueuePublicBookingProfileSync(
      operations,
      state,
      profileId,
      execute,
    );
    await publishCommitted.promise;

    const desiredUnpublished = {
      ...state,
      bookingProfiles: state.bookingProfiles.map(profile => profile.id === profileId
        ? { ...profile, published: false }
        : profile),
    };
    state = markChangedPublicBookingProfilesPending(
      state,
      desiredUnpublished,
      "2026-08-16T20:00:01.000Z",
    );
    expect(state.bookingProfiles.find(profile => profile.id === profileId)?.pendingPublication)
      .toEqual({
        desiredStatus: "unpublished",
        expectedGeneration: 0,
        requestedAt: "2026-08-16T20:00:01.000Z",
      });

    const queuedUnpublish = enqueuePublicBookingProfileSync(
      operations,
      state,
      profileId,
      execute,
    );
    releaseAmbiguousResponse.resolve();

    await expect(ambiguousPublish).resolves.toBe(false);
    await expect(queuedUnpublish).resolves.toBe(true);

    const profile = state.bookingProfiles.find(candidate => candidate.id === profileId)!;
    expect(calls).toEqual(["publish:0", "unpublish:0", "unpublish:1"]);
    expect(remote).toEqual({ generation: 2, status: "unpublished" });
    expect(profile.published).toBe(false);
    expect(profile.publication).toMatchObject({
      generation: 2,
      status: "unpublished",
    });
    expect(profile.pendingPublication).toBeUndefined();
    expect(operations.size).toBe(0);
  });
});
