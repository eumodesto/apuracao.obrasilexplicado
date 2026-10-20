import { expect, test } from '@playwright/test';
test.use({ storageState: { cookies: [], origins: [] } });
test('visitors without a session go to the login page and get no election data', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Acompanhe a apuração ao vivo' })).toBeVisible();
  expect((await request.get('/api/election/president?scope=br')).status()).toBe(401);
  expect((await request.post('/api/billing/pix')).status()).toBe(401);
});
