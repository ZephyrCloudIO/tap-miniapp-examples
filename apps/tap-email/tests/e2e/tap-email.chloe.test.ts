import { expect, test, type TapRstestFixtures } from '@theaiplatform/miniapp-sdk/testing/rstest';

async function assertChloeHandoff({ surface, tap }: TapRstestFixtures, action: string) {
  await tap.control.reset();
  await surface.getByText('Synthetic launch checklist', { exact: true }).first().click();
  await surface.getByRole('button', { name: 'Ask Chloe', exact: true }).click();
  await surface.getByRole('menuitem', { name: new RegExp(action.replace('?', '\\?')) }).click();
  await expect(surface.getByText('Chloe accepted the request.', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return ledger.entries.filter(
        (entry) => entry.kind === 'host-action' && entry.operation === 'chat.ask-chloe',
      ).length;
    })
    .toBe(1);
  const capture = await tap.fixture.http.requests();
  expect(
    capture.requests.some(
      (entry) => entry.request.method === 'POST' && /send|draft/u.test(entry.request.url),
    ),
  ).toBe(false);
  // Fixture dispatch is simulated. Live panel and turn proof remain separate checks.
}

test('Ask Chloe summarizes synthetic email through the host handoff', async (fixtures) => {
  await assertChloeHandoff(fixtures, 'Summarize');
});

test('Ask Chloe explains importance through the host handoff', async (fixtures) => {
  await assertChloeHandoff(fixtures, 'Why important?');
});

test('Ask Chloe extracts commitments through the host handoff', async (fixtures) => {
  await assertChloeHandoff(fixtures, 'Extract commitments');
});

test('Ask Chloe requests a reviewable draft without sending email', async (fixtures) => {
  await assertChloeHandoff(fixtures, 'Draft reply');
});
