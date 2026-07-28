import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  openRemediation,
  storedState,
} from './vanta-companion-test-support';

test('does not attach a case after its channel seed message is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-channels-send-denied',
    matrixEntryId: 'vanta-companion-desktop-channels-send-denied',
    permissionScenario: 'deny:channels.send-message',
    seed: 6934,
    theme: 'dark',
  });
  await openRemediation(surface);
  await surface
    .getByRole('button', {
      name: 'Create channel for Review branch protection',
      exact: true,
    })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'vanta-companion.coordinate',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'channels.create',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'channels.send-message',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.channels.filter(
      channel => channel.title === 'SOC 2 · Review branch protection',
    ),
  ).toEqual([
    expect.objectContaining({
      title: 'SOC 2 · Review branch protection',
      messages: [],
    }),
  ]);
  expect(Reflect.get(storedState(snapshot), 'cases')).toEqual([
    expect.objectContaining({ channelId: null }),
  ]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
