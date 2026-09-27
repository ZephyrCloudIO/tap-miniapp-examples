import { expect, test } from '@theaiplatform/miniapp-sdk/testing/rstest';

test('inserts a published link with only the Email surface mounted', async ({ surface, tap }) => {
  await tap.control.reset();
  await expect(surface.getByRole('heading', { level: 1, name: 'Inbox', exact: true })).toBeVisible();
  // No mail account or private messages are required to share a Calendar URL.
  await surface.locator('body').press('c');
  const body = surface.getByRole('textbox', { name: 'Message body', exact: true });
  await body.fill('Choose a time: ');
  await surface.getByRole('button', { name: 'Share availability', exact: true }).click();
  await surface.getByRole('button', { name: /Office hours · 30 min/u }).click();
  await expect(body).toHaveValue('Choose a time: https://cal.with-tap.ai/fixture/office-hours');
  const capture = await tap.fixture.http.requests();
  const calendarRequests = capture.requests.filter(entry => entry.request.url.startsWith('https://calendar-api.theaiplatform.app/'));
  expect(calendarRequests).toHaveLength(2);
  expect(calendarRequests.every(entry => entry.matched && entry.request.method === 'GET' && entry.credentialRef === 'platform-session')).toBe(true);
});
