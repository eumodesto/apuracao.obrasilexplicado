import { test, expect } from '@playwright/test';
import type { ElectionMapResponse } from '../../src/lib/tse/map-types';
test.setTimeout(40000);
test('touch selects a small state without overflowing the viewport', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 375, height: 812 },
  });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3000/');
    await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.map-callouts button')).toHaveCount(8);
    await page.getByRole('button', { name: /^PB / }).tap();
    await expect(page.getByLabel('Selecionar estado no mapa')).toHaveValue('pb');
    await expect(page.locator('.context-panel h2').first()).toContainText('Paraíba');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
test('27 official states, regions, candidate colors, municipal geometry and map modes', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/election/president/map');
  const data: ElectionMapResponse = await response.json();
  expect(data.snapshot.states).toHaveLength(27);
  expect(data.snapshot.regions).toHaveLength(5);
  expect(
    (
      await request.get('/api/election/president/map', {
        headers: { 'If-None-Match': response.headers().etag },
      })
    ).status(),
  ).toBe(304);
  expect((await request.get('/api/election/president/map?state=pb')).status()).toBe(400);
  const geometry = await (await request.get('/maps/pb.json')).json();
  expect(geometry.shapes).toHaveLength(223);
  expect(geometry.shapes.find((s: { code: string }) => s.code === '20516').ibge).toBe('2507507');
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas')).toHaveCount(1);
  const bars = page.locator('.comparison-bar span');
  await expect(bars.nth(0)).toHaveCSS(
    'background-color',
    data.snapshot.legend.find((c) => c.number === '22')?.color === '\u0023005CAA'
      ? 'rgb(0, 92, 170)'
      : 'rgb(227, 24, 55)',
  );
  for (const name of ['Vantagem', 'Apurado', 'Municípios', 'Estados']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByLabel('Mapa de candidato').selectOption('13');
  await expect(page.locator('.candidate-context h2')).toContainText('Lula');
  await page.locator('.territory-navigation').evaluate((e) => {
    (e as HTMLDetailsElement).open = true;
  });
  await page.getByLabel('Selecionar estado no mapa').selectOption('pb');
  await page.getByLabel('Selecionar município no mapa').selectOption('20516');
  await expect(page.locator('.context-panel h2').first()).toContainText('João Pessoa');
  await page.getByRole('button', { name: 'Brasil', exact: true }).click();
  await expect(page.getByLabel('Selecionar estado no mapa')).toHaveValue('');
});
test('map 304 and outage preserve the canvas, selection and zoom', async ({ page, request }) => {
  const data = await (await request.get('/api/election/president/cockpit')).json();
  let mode = 'data',
    calls = 0;
  await page.route('**/api/election/president/cockpit', (route) => {
    calls++;
    if (mode === '304') return route.fulfill({ status: 304 });
    if (mode === 'failure') return route.fulfill({ status: 503, json: { error: 'test-only' } });
    return route.fulfill({ json: data, headers: { ETag: '"controlled-map"' } });
  });
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.region-sidebar details')).toHaveCount(5);
  await page.getByRole('button', { name: 'Ampliar mapa' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await page.locator('canvas').evaluate((e) => (e as HTMLCanvasElement).toDataURL());
  mode = '304';
  const call = calls;
  await expect.poll(() => calls, { timeout: 15000 }).toBeGreaterThan(call);
  expect(await page.locator('canvas').evaluate((e) => (e as HTMLCanvasElement).toDataURL())).toBe(
    before,
  );
  mode = 'failure';
  await expect(page.locator('.cockpit-notice')).toContainText('preservado', { timeout: 15000 });
  expect(await page.locator('canvas').evaluate((e) => (e as HTMLCanvasElement).toDataURL())).toBe(
    before,
  );
});
