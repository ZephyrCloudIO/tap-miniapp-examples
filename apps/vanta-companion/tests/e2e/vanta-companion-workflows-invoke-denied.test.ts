import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  openRemediation,
  storedState,
} from './vanta-companion-test-support';

test('lists workflows but persists no run when invocation is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-workflows-invoke-denied',
    matrixEntryId: 'vanta-companion-desktop-workflows-invoke-denied',
    permissionScenario: 'deny:workflows.invoke',
    seed: 6935,
    theme: 'dark',
  });
  await openRemediation(surface);
  await surface
    .getByRole('button', {
      name: 'Invoke workflow for Review branch protection',
      exact: true,
    })
    .click();
  await expect(surface.getByRole('alert')).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'workflows.list',
      autonomy: 'listen',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'workflows.invoke',
      autonomy: 'do',
      allowed: false,
    }),
  ).toBe(true);
  const snapshot = await tap.fixture.snapshot();
  expect(Reflect.get(storedState(snapshot), 'cases')).toEqual([
    expect.objectContaining({ workflowRunId: null }),
  ]);
  expect(snapshot.state.storage[0]?.revision).toBe(1);
});
