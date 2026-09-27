import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';

test('keeps the draft unchanged when Calendar network access is denied', async ({ surface, tap }) => {
  await expect(surface.getByRole('heading', { level: 1, name: 'Inbox', exact: true })).toBeVisible();
  await surface.locator('body').press('c');
  const body = surface.getByRole('textbox', { name: 'Message body', exact: true });
  await body.fill('Unchanged draft');
  await surface.getByRole('button', { name: 'Share availability', exact: true }).click();
  await expect(surface.getByRole('dialog', { name: 'Share availability', exact: true }).getByRole('alert')).toContainText('Allow Calendar link access');
  await expect(body).toHaveValue('Unchanged draft');
  const capture = await tap.fixture.http.requests();
  expect(capture.requests.filter(entry => entry.request.url.startsWith('https://calendar-api.theaiplatform.app/'))).toEqual([]);
});
