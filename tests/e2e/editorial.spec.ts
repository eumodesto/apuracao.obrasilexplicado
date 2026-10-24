import { test, expect } from '@playwright/test';
import type { ElectionResponse } from '../../src/lib/tse/types';
import { validVoteAnalysis } from '../../src/lib/tse/analysis';
test.setTimeout(45000);
test.describe('Brasília live clock', () => {
  test.use({ timezoneId: 'UTC' });
  test('shows current Brasília time independently of browser timezone and official timestamp', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'));
    await page.goto('/');
    await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
    const clock = page.getByLabel('Horário atual de Brasília');
    await expect(clock).toHaveText('13:00:00');
    await page.clock.setFixedTime(new Date('2026-10-05T16:00:01Z'));
    await expect(clock).toHaveText('13:00:01');
    await expect(page.locator('.cockpit-status')).toContainText('Dado oficial:');
  });
});
test('cockpit visual hierarchy at all widths, exact desktop heights, search and deep links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.region-sidebar details')).toHaveCount(5, { timeout: 20000 });
  for (const [width, height] of [
    [375, 844],
    [390, 844],
    [430, 844],
    [768, 900],
    [1024, 900],
    [1280, 900],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width >= 1280) {
      const header = await page.locator('.cockpit-header').boundingBox(),
        map = await page.locator('.cockpit-map').boundingBox(),
        controls = await page.locator('.map-mode-switcher').boundingBox();
      expect(header!.height).toBeLessThanOrEqual(54);
      expect(map!.height).toBeGreaterThan(height * 0.8);
      expect(controls!.y).toBeGreaterThanOrEqual(map!.y);
      expect(controls!.y + controls!.height).toBeLessThan(map!.y + map!.height);
      await expect(page.getByLabel('Selecionar estado no mapa')).not.toBeVisible();
      const chart = await page.locator('.compact-chart').boundingBox(),
        race = await page.locator('.race-panel').boundingBox();
      expect(chart!.y + chart!.height).toBeLessThanOrEqual(race!.y + race!.height);
      const timeline = await page.locator('.cockpit-timeline').boundingBox();
      expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(height);
    }
    await page.screenshot({ path: `outputs/verified-cockpit-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Buscar estado ou município').fill('Joao Pessoa');
  await page.getByRole('button', { name: 'MUNICÍPIOS JOÃO PESSOA PB', exact: true }).click();
  await expect(page).toHaveURL(/municipality=20516/);
  await expect(page.locator('.context-panel h2').first()).toContainText('João Pessoa');
  await page.reload();
  await expect(page.getByLabel('Selecionar município no mapa')).toHaveValue('20516');
  expect(errors).toEqual([]);
});
test('valid majority, truthful historical replay, 304 clocks and outage retention', async ({
  page,
  request,
}) => {
  const payload: ElectionResponse = await (await request.get('/api/election/president')).json();
  const s = payload.snapshot!;
  s.status = 'counting';
  s.progress.validVotes = 10000;
  s.progress.percentageCounted = 40;
  s.progress.totaledAt = '2026-10-04T18:00:00-03:00';
  s.candidates = s.candidates
    .slice(0, 2)
    .map((c, i) => ({
      ...c,
      votes: i ? 4926 : 5074,
      percentage: i ? 49.26 : 50.74,
      destination: 'Válido',
    }));
  payload.analysis = validVoteAnalysis(s);
  payload.stale = false;
  payload.checkedAt = '2026-10-04T18:00:03-03:00';
  let mode = 'data';
  await page.route('**/api/election/president?scope=br', (route) => {
    if (mode === '304')
      return route.fulfill({
        status: 304,
        headers: { 'X-TSE-Checked-At': '2026-10-04T18:01:00-03:00' },
      });
    if (mode === 'error')
      return route.fulfill({ status: 503, json: { error: 'test-only outage' } });
    return route.fulfill({ json: payload, headers: { ETag: '"majority"' } });
  });
  const official = await (await request.get('/api/election/president/cockpit')).json();
  const old = structuredClone(official.frame);
  old.id = '11111111111111111111';
  old.national = structuredClone(payload);
  old.national.snapshot.candidates[0].percentage = 52.1;
  old.national.snapshot.candidates[0].votes = 5210;
  old.national.snapshot.candidates[1].percentage = 47.9;
  old.national.snapshot.candidates[1].votes = 4790;
  old.national.analysis = validVoteAnalysis(old.national.snapshot);
  old.municipalities = [];
  const timeline = [
    {
      id: old.id,
      observedAt: '2026-10-04T17:30:00-03:00',
      officialAt: '2026-10-04T17:30:00-03:00',
      counted: 30,
      sections: 30,
      candidates: old.national.analysis.candidates,
    },
    {
      id: official.frame.id,
      observedAt: '2026-10-04T18:00:00-03:00',
      officialAt: s.progress.totaledAt,
      counted: 40,
      sections: 40,
      candidates: payload.analysis!.candidates,
    },
  ];
  await page.route('**/api/election/president/cockpit*', (route) =>
    route.fulfill({
      json: {
        ...official,
        timeline,
        frame: route.request().url().includes('frame=') ? old : official.frame,
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.cockpit-majority')).toContainText('0,74 p.p. acima');
  await page.locator('.cockpit-timeline input').press('Home');
  await expect(page.locator('.cockpit-status b')).toContainText('HISTÓRICO');
  await expect(page.locator('.cockpit-top-two')).toContainText('52,10%');
  await page.getByRole('button', { name: 'Voltar ao vivo' }).click();
  await expect(page.locator('.cockpit-majority')).toContainText('0,74 p.p. acima');
  await page.getByRole('button', { name: 'Informações e transparência' }).click();
  mode = '304';
  await expect(page.locator('.cockpit-info')).toContainText('18:01:00', { timeout: 10000 });
  await expect(page.locator('.cockpit-status')).toContainText('18:00:00');
  mode = 'error';
  await expect(page.locator('.cockpit-status b')).toContainText('AGUARDANDO TSE', {
    timeout: 10000,
  });
  await expect(page.locator('.cockpit-top-two button')).toHaveCount(2);
  await expect(page.locator('.cockpit-majority')).toContainText('0,74 p.p. acima');
});
