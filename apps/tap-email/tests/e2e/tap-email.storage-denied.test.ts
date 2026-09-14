import {
  expect,
  test,
} from '@theaiplatform/miniapp-sdk/testing/rstest';

test('fails visibly when mailbox transport and TAP storage are revoked', async ({
  surface,
  tap,
}) => {
  expect(tap.matrixEntryId).toBe('tap-email-desktop-storage-denied');
  await expect(surface.getByRole('alert')).toContainText(
    'Mailbox unavailable',
  );
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some(entry => entry.operation === 'storage.set'),
  ).toBe(false);
});
