import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
  MiniAppStorageApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import { z } from "zod";

import {
  emptyRoadieDocument,
  inferEngagementType,
  roadieDocumentSchema,
  tripSchema,
  type RoadieDocument,
  type Trip,
} from "./domain";

const STORAGE_ADDRESS: MiniAppStorageAddress = {
  namespace: "roadie",
  key: "document",
};

// The SDK storage boundary accepts JSON values, while the domain model uses
// optional properties. Serialization removes absent properties exactly as the
// host storage transport does.
function toStorageValue(document: RoadieDocument): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(document)) as MiniAppJsonValue;
}

const legacyTripSchema = tripSchema
  .omit({ purpose: true, location: true })
  .extend({ sharingEnabled: z.boolean() })
  .strict();

const legacyRoadieDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    trips: z.array(legacyTripSchema).max(100),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const legacyRoadieDocumentV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    trips: z.array(tripSchema).max(100),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const legacyShareDestinationSchema = z
  .object({
    channelId: z.string().min(1).max(200),
    channelTitle: z.string().min(1).max(200),
  })
  .strict();

const legacyRoadieDocumentV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    trips: z.array(tripSchema).max(100),
    shareSettings: z
      .object({
        marketing: legacyShareDestinationSchema.optional(),
        sponsor: legacyShareDestinationSchema.optional(),
      })
      .strict(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const legacyRoadieDocumentV5Schema = roadieDocumentSchema
  .omit({ schemaVersion: true })
  .extend({ schemaVersion: z.literal(5) })
  .strict();

function classifyLegacyEngagements(trips: readonly Trip[]): Trip[] {
  return trips.map((trip) => ({
    ...trip,
    timeline: trip.timeline.map((item) => {
      if (item.engagementType !== undefined) return item;
      const inferred = inferEngagementType(
        [item.title, ...item.evidence.map((evidence) => evidence.excerpt ?? "")].join("\n"),
      );
      return inferred ? { ...item, engagementType: inferred } : item;
    }),
  }));
}

// Stored v1-v5 documents are an external persistence boundary. Migrate them
// here so the canonical model stays focused on trips and itinerary items.
const legacyRoadieDocumentV1Schema = legacyRoadieDocumentV2Schema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(1),
    roadieChannelId: z.string().min(1).max(200).optional(),
  })
  .strict();

function parseStoredRoadieDocument(value: unknown): RoadieDocument {
  const current = roadieDocumentSchema.safeParse(value);
  if (current.success) return current.data;

  const v5 = legacyRoadieDocumentV5Schema.safeParse(value);
  if (v5.success) {
    return roadieDocumentSchema.parse({
      ...v5.data,
      schemaVersion: 6,
      trips: classifyLegacyEngagements(v5.data.trips),
    });
  }

  const v4 = legacyRoadieDocumentV4Schema.safeParse(value);
  if (v4.success) {
    return roadieDocumentSchema.parse({
      schemaVersion: 6,
      trips: classifyLegacyEngagements(v4.data.trips),
      shareSettings: {
        ...(v4.data.shareSettings.marketing
          ? { upcomingEngagements: v4.data.shareSettings.marketing }
          : {}),
        ...(v4.data.shareSettings.sponsor ? { tripImpact: v4.data.shareSettings.sponsor } : {}),
      },
      updatedAt: v4.data.updatedAt,
    });
  }

  const v3 = legacyRoadieDocumentV3Schema.safeParse(value);
  if (v3.success) {
    return roadieDocumentSchema.parse({
      schemaVersion: 6,
      trips: classifyLegacyEngagements(v3.data.trips),
      shareSettings: {},
      updatedAt: v3.data.updatedAt,
    });
  }

  const v2 = legacyRoadieDocumentV2Schema.safeParse(value);
  const legacy = v2.success ? v2.data : legacyRoadieDocumentV1Schema.parse(value);
  return roadieDocumentSchema.parse({
    schemaVersion: 6,
    trips: classifyLegacyEngagements(
      legacy.trips.map(({ sharingEnabled: _sharingEnabled, ...trip }) => ({
        ...trip,
        purpose: "conference",
      })),
    ),
    shareSettings: {},
    updatedAt: legacy.updatedAt,
  });
}

export type StoredRoadieDocument = {
  document: RoadieDocument;
  revision: number | null;
};

export async function loadRoadieDocument(
  storage: MiniAppStorageApi,
  now: string,
): Promise<StoredRoadieDocument> {
  const entry = await storage.get(STORAGE_ADDRESS);
  if (entry.value === null) {
    return {
      document: emptyRoadieDocument(now),
      revision: entry.revision,
    };
  }

  return {
    document: parseStoredRoadieDocument(entry.value),
    revision: entry.revision,
  };
}

export async function saveRoadieDocument(
  storage: MiniAppStorageApi,
  stored: StoredRoadieDocument,
  document: RoadieDocument,
): Promise<StoredRoadieDocument> {
  const result = await storage.set({
    ...STORAGE_ADDRESS,
    value: toStorageValue(document),
    expectedRevision: stored.revision,
  });
  return { document, revision: result.revision };
}

export async function deleteAllRoadieData(
  storage: MiniAppStorageApi,
  revision: number | null,
): Promise<void> {
  if (revision === null) return;
  await storage.delete({
    ...STORAGE_ADDRESS,
    expectedRevision: revision,
  });
}
