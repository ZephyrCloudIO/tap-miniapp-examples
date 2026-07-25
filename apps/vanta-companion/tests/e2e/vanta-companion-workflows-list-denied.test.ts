import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';
import {
  expectExactProvenance,
  hasAnyHostAuthorizationDecision,
  hasHostAuthorizationDecision,
  openRemediation,
  storedState,
} from './vanta-companion-test-support';

test('does not invoke a workflow when saved-workflow discovery is denied', async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    profileId: 'vanta-companion-desktop-workflows-list-denied',
    matrixEntryId: 'vanta-companion-desktop-workflows-list-denied',
    permissionScenario: 'deny:workflows.list',
    seed: 6940,
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
      actionId: 'vanta-companion.coordinate',
      autonomy: 'do',
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, {
      actionId: 'workflows.list',
      autonomy: 'listen',
      allowed: false,
    }),
  ).toBe(true);
  expect(hasAnyHostAuthorizationDecision(entries, 'workflows.invoke')).toBe(
    false,
  );
  expect(Reflect.get(storedState(await tap.fixture.snapshot()), 'cases')).toEqual([
    expect.objectContaining({ workflowRunId: null }),
  ]);
});
