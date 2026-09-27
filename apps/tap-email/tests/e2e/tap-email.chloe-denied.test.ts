import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';

test('Ask Chloe reports denied authority without persisting a request', async ({
  surface,
  tap,
}) => {
  await surface.getByText('Synthetic launch checklist', { exact: true }).first().click();
  await surface.getByRole('button', { name: 'Ask Chloe', exact: true }).click();
  await surface.getByRole('menuitem', { name: /Summarize/ }).click();
  await expect(surface.getByRole('status')).toContainText('authorization-denied');
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.entries.filter((entry) => entry.operation === 'chat.ask-chloe')).toEqual([]);
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.channels.some((channel) => channel.roomId.startsWith('tap-fixture-chloe-'))).toBe(
    false,
  );
});
