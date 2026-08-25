import {
  sdk,
  type MiniAppJsonValue,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  ActiveEmailContext,
  MailboxSummary,
} from '@tap-examples/tap-email-protocol';
import {
  defaultPreferences,
  isMailPreferences,
  type MailPreferences,
} from './domain';

const preferencesAddress = {
  namespace: 'tap-email',
  key: 'preferences/v1',
} as const;
export const operationalAddress = {
  namespace: 'tap-email',
  key: 'operational/v1',
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
  return isMailPreferences(entry.value) ? entry.value : defaultPreferences;
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
