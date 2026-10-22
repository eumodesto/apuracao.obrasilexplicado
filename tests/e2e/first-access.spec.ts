import { test, expect } from '@playwright/test';
test.setTimeout(45000);
test('cached national data survive unavailable first refresh without a blank shell', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/election/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Controlled test outage' } }),
  );
  await page.goto('/');
  await expect(page.locator('.first-access-controller .cockpit-header')).toBeVisible();
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.cockpit-top-two .cockpit-candidate')).toHaveCount(2);
  const score = await page.locator('.cockpit-top-two .cockpit-candidate>b').allTextContents();
  await page.waitForTimeout(1000);
  expect(await page.locator('.cockpit-top-two .cockpit-candidate>b').allTextContents()).toEqual(
    score,
  );
  await expect(page.locator('.cockpit-status')).toContainText('Dado oficial:');
  await expect(page.locator('.cockpit-status')).toContainText('AGUARDANDO TSE');
  expect(errors).toEqual([]);
});
test('neutral entry decoration never blocks map controls or territory deep links', async ({
  page,
}) => {
  await page.goto('/?state=PB&municipality=20516');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page).toHaveURL(/state=PB/);
  await expect(page).toHaveURL(/municipality=20516/);
  await expect(page.getByRole('button', { name: 'Ampliar mapa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ampliar mapa', exact: true }).click();
  expect(
    await page.locator('.boot-map-cover').evaluate((node) => getComputedStyle(node).pointerEvents),
  ).toBe('none');
});
