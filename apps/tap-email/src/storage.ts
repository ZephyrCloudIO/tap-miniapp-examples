import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppStorageApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  ActiveEmailContext,
  MailboxSummary,
} from '@tap-examples/tap-email-protocol';
import {
  defaultPreferences,
  isMailPreferences,
  normalizeMailPreferences,
  type MailPreferences,
} from './domain';
import {
  isEmailActivityProjection,
  isNoOpEmailActivityProjection,
  type EmailActivityProjection,
} from './activity';

const preferencesAddress = {
  namespace: 'tap-email',
  key: 'preferences/v1',
} as const;
export const operationalAddress = {
  namespace: 'tap-email',
  key: 'operational/v1',
} as const;
export const activityAddress = {
  namespace: 'tap-email',
  key: 'activity/v1',
} as const;

export interface OperationalProjection {
  readonly schemaVersion: 1;
  readonly summary: MailboxSummary;
  readonly activeContext: ActiveEmailContext;
}

export async function loadPreferences(
  preview: boolean,
): Promise<MailPreferences> {
  if (preview) return defaultPreferences;
  const entry = await sdk.storage.get(preferencesAddress);
  return isMailPreferences(entry.value)
    ? normalizeMailPreferences(entry.value)
    : defaultPreferences;
}

export async function savePreferences(
  preferences: MailPreferences,
): Promise<void> {
  const current = await sdk.storage.get(preferencesAddress);
  const value = JSON.parse(JSON.stringify(preferences)) as MiniAppJsonValue;
  await sdk.storage.set({
    ...preferencesAddress,
    expectedRevision: current.revision,
    value,
  });
}

export async function publishOperationalProjection(
  projection: OperationalProjection,
): Promise<void> {
  const current = await sdk.storage.get(operationalAddress);
  await sdk.storage.set({
    ...operationalAddress,
    expectedRevision: current.revision,
    value: JSON.parse(JSON.stringify(projection)),
  });
}

export async function publishEmailActivityProjection(
  projection: EmailActivityProjection,
  storage: Pick<MiniAppStorageApi, 'get' | 'set'> = sdk.storage,
): Promise<void> {
  if (isNoOpEmailActivityProjection(projection)) return;
  if (!isEmailActivityProjection(projection)) {
    throw new Error('TAP Email refused to publish a malformed activity projection.');
  }
  const value = JSON.parse(JSON.stringify(projection)) as MiniAppJsonValue;
  let latestFailure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await storage.get(activityAddress);
    if (
      isEmailActivityProjection(current.value) &&
      (
        Date.parse(current.value.generatedAt) > Date.parse(projection.generatedAt) ||
        (
          current.value.generatedAt === projection.generatedAt &&
          JSON.stringify(current.value) === JSON.stringify(projection)
        )
      )
    ) {
      // Another mounted surface already published this ledger state or a newer
      // one. Equal timestamps are not enough to prove equality: two receipts
      // can settle within the same millisecond and carry different entries.
      return;
    }
    try {
      await storage.set({
        ...activityAddress,
        expectedRevision: current.revision,
        value,
      });
      return;
    } catch (error) {
      latestFailure = error;
    }
  }
  throw latestFailure;
}
