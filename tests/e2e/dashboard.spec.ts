import { test, expect } from '@playwright/test';
import type { ElectionResponse } from '../../src/lib/tse/types';
test.setTimeout(60000);
test('live official contracts, filters, exterior, refresh and keyboard', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await request.get('/api/election/president');
  expect(response.ok()).toBeTruthy();
  const data: ElectionResponse = await response.json();
  expect(data.snapshot?.source).toBe('TSE');
  expect(
    (
      await request.get('/api/election/president', {
        headers: { 'If-None-Match': response.headers().etag },
      })
    ).status(),
  ).toBe(304);
  expect((await request.get('/api/election/president?state=PB&municipality=01120')).status()).toBe(
    400,
  );
  expect((await request.get('/api/election/president?url=https://example.com')).status()).toBe(400);
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.cockpit-top-two button')).toHaveCount(2);
  await page.locator('.territory-navigation').evaluate((e) => {
    (e as HTMLDetailsElement).open = true;
  });
  await page.getByLabel('Selecionar estado no mapa').selectOption('pb');
  await expect(page.locator('.context-panel h2').first()).toContainText('Paraíba');
  await page.getByLabel('Selecionar município no mapa').selectOption('20516');
  await expect(page.locator('.context-panel h2').first()).toContainText('João Pessoa');
  await expect(page.locator('.context-candidate')).toHaveCount(data.snapshot!.candidates.length);
  await page.getByRole('button', { name: 'Exterior', exact: true }).click();
  await expect(page.locator('.context-panel h2').first()).toContainText('Exterior');
  await page.getByLabel('País ou localidade').selectOption('29254');
  await expect(page.locator('.context-panel h2').first()).toContainText('Abidjã');
  await page.getByRole('button', { name: 'Voltar ao Brasil' }).click();
  const counted = await page.locator('.race-progress strong').innerText();
  await page.reload();
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.race-progress strong')).toHaveText(counted);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  expect(errors).toEqual([]);
});
test('counting, loading, outage, stale and official completion retain results', async ({
  page,
  request,
}) => {
  const original: ElectionResponse = await (await request.get('/api/election/president')).json();
  let mode = 'counting';
  await page.route('**/api/election/president?**', async (route) => {
    if (mode === 'failure')
      return route.fulfill({ status: 503, json: { error: 'test-only outage' } });
    const payload = structuredClone(original);
    payload.stale = mode === 'stale';
    payload.issue = null;
    payload.status = mode === 'final' ? 'finished' : 'counting';
    payload.snapshot!.status = mode === 'final' ? 'finished' : 'counting';
    payload.snapshot!.progress.totaledAt = new Date().toISOString();
    payload.snapshot!.progress.percentageCounted = mode === 'final' ? 100 : 50;
    payload.snapshot!.candidates.forEach((c) => {
      c.status = null;
      c.elected = false;
    });
    if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 1000));
    return route.fulfill({ json: payload, headers: { 'X-Poll-After': '3000' } });
  });
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.race-progress strong')).toContainText('50,00');
  await expect(page.locator('.cockpit-status b')).toContainText('AO VIVO');
  mode = 'failure';
  await expect(page.locator('.cockpit-status b')).toContainText('AGUARDANDO TSE', {
    timeout: 10000,
  });
  await expect(page.locator('.cockpit-top-two button')).toHaveCount(2);
  await expect(page.locator('.race-progress strong')).toContainText('50,00');
  mode = 'stale';
  await expect(page.locator('.preserved-status')).toContainText('Último dado válido');
  mode = 'final';
  await expect(page.locator('.panel-heading')).toContainText('APURAÇÃO ENCERRADA', {
    timeout: 25000,
  });
  mode = 'loading';
  await page.locator('.territory-navigation').evaluate((e) => {
    (e as HTMLDetailsElement).open = true;
  });
  await page.getByLabel('Selecionar estado no mapa').selectOption('pb');
  await expect(page.locator('.context-panel h2').first()).toContainText('Paraíba');
});
