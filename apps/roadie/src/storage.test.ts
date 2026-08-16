import type {
  MiniAppJsonValue,
  MiniAppStorageApi,
  MiniAppStorageEntry,
} from "@theaiplatform/miniapp-sdk/sdk";
import { describe, expect, it } from "@rstest/core";

import { createTrip, emptyRoadieDocument } from "./domain";
import { deleteAllRoadieData, loadRoadieDocument, saveRoadieDocument } from "./storage";

const NOW = "2026-07-28T12:00:00.000Z";

type FixtureEntry = {
  value: unknown;
  revision: number | null;
};

function jsonValue(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function storageFixture(initial?: FixtureEntry): {
  api: MiniAppStorageApi;
  read(): MiniAppStorageEntry;
} {
  let entry: MiniAppStorageEntry = initial
    ? { value: jsonValue(initial.value), revision: initial.revision }
    : { value: null, revision: null };
  return {
    api: {
      get: () => entry,
      set: (options) => {
        if (options.expectedRevision !== entry.revision) {
          throw new Error("Storage revision conflict.");
        }
        const revision = (entry.revision ?? 0) + 1;
        entry = {
          value: options.value,
          revision,
        };
        return { revision };
      },
      delete: (options) => {
        if (options.expectedRevision !== entry.revision) {
          throw new Error("Storage revision conflict.");
        }
        entry = { value: null, revision: null };
      },
    },
    read: () => entry,
  };
}

describe("Roadie storage", () => {
  it("starts from an empty validated document", async () => {
    const fixture = storageFixture();

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document.schemaVersion).toBe(6);
    expect(stored.revision).toBeNull();
  });

  it("migrates the retired channel-backed document into the canonical model", async () => {
    const fixture = storageFixture({
      value: {
        schemaVersion: 1,
        trips: [],
        roadieChannelId: "retired-channel-1",
        updatedAt: NOW,
      },
      revision: 4,
    });

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document).toEqual({
      schemaVersion: 6,
      shareSettings: {},
      trips: [],
      updatedAt: NOW,
    });
    expect(stored.revision).toBe(4);
  });

  it("migrates v3 trips into the impact-ready document", async () => {
    const fixture = storageFixture({
      value: {
        schemaVersion: 3,
        trips: [
          createTrip({
            id: "trip-1",
            now: NOW,
            purpose: "meetup",
            title: "Local meetup",
          }),
        ],
        updatedAt: NOW,
      },
      revision: 6,
    });

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document.schemaVersion).toBe(6);
    expect(stored.document.shareSettings).toEqual({});
    expect(stored.document.trips[0]?.title).toBe("Local meetup");
  });

  it("migrates audience-named destinations to update types", async () => {
    const destination = {
      channelId: "channel-1",
      channelTitle: "Comms",
    };
    const fixture = storageFixture({
      value: {
        schemaVersion: 4,
        trips: [],
        shareSettings: {
          marketing: destination,
          sponsor: destination,
        },
        updatedAt: NOW,
      },
      revision: 7,
    });

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document.shareSettings).toEqual({
      upcomingEngagements: destination,
      tripImpact: destination,
    });
  });

  it("classifies obvious public engagements stored before engagement types", async () => {
    const trip = createTrip({
      id: "trip-1",
      now: NOW,
      purpose: "conference",
      title: "Vue Berlin",
    });
    const fixture = storageFixture({
      value: {
        ...emptyRoadieDocument(NOW),
        schemaVersion: 5,
        trips: [
          {
            ...trip,
            timeline: [
              {
                id: "talk-1",
                title: "Speaking for 15 minutes on Vue and AI",
                start: "2026-08-28T12:30:00.000Z",
                timeZone: "Europe/Berlin",
                kind: "personal",
                evidence: [
                  {
                    sourceKind: "pasted-text",
                    sourceLabel: "Text pasted into Roadie",
                    excerpt: "Conference confirmation: speaking for 15 minutes on Vue and AI.",
                    capturedAt: NOW,
                  },
                ],
                createdAt: NOW,
                updatedAt: NOW,
              },
              {
                id: "dinner-1",
                title: "Speaker dinner",
                start: "2026-08-28T18:00:00.000Z",
                timeZone: "Europe/Berlin",
                kind: "social",
                evidence: [
                  {
                    sourceKind: "user",
                    sourceLabel: "Test",
                    capturedAt: NOW,
                  },
                ],
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          },
        ],
      },
      revision: 8,
    });

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document.trips[0]?.timeline[0]?.engagementType).toBe("talk");
    expect(stored.document.trips[0]?.timeline[1]?.engagementType).toBeUndefined();
  });

  it("migrates existing conference trips without losing itinerary items", async () => {
    const fixture = storageFixture({
      value: {
        schemaVersion: 2,
        trips: [
          {
            id: "trip-1",
            title: "React Summit",
            timeline: [],
            sharingEnabled: true,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        updatedAt: NOW,
      },
      revision: 5,
    });

    const stored = await loadRoadieDocument(fixture.api, NOW);

    expect(stored.document.trips[0]).toMatchObject({
      id: "trip-1",
      purpose: "conference",
      title: "React Summit",
    });
    expect(stored.revision).toBe(5);
  });

  it("writes with the observed revision", async () => {
    const fixture = storageFixture();
    const stored = await loadRoadieDocument(fixture.api, NOW);
    const document = {
      ...stored.document,
      trips: [
        createTrip({
          id: "trip-1",
          now: NOW,
          purpose: "conference",
          title: "React Summit 2026 · Amsterdam",
        }),
      ],
    };

    const saved = await saveRoadieDocument(fixture.api, stored, document);

    expect(saved.revision).toBe(1);
    expect(fixture.read().value).toEqual(document);
  });

  it("does not overwrite a newer revision", async () => {
    const existing = emptyRoadieDocument(NOW);
    const fixture = storageFixture({
      value: existing,
      revision: 2,
    });
    const stale = { document: existing, revision: 1 };

    await expect(saveRoadieDocument(fixture.api, stale, existing)).rejects.toThrow(
      "Storage revision conflict",
    );
  });

  it("deletes the canonical key at its observed revision", async () => {
    const fixture = storageFixture({
      value: emptyRoadieDocument(NOW),
      revision: 3,
    });

    await deleteAllRoadieData(fixture.api, 3);

    expect(fixture.read()).toEqual({ value: null, revision: null });
  });
});
