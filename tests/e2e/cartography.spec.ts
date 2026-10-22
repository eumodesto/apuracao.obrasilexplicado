import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const national = JSON.parse(readFileSync('src/features/election/map/geometry.json', 'utf8')) as {
  states: { uf: string; label: number[] }[];
};
test.setTimeout(45000);
test('municipal polling advances through UFs after 304 and unavailable results', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('**/api/election/president/municipalities?state=*', async (route) => {
    const uf = new URL(route.request().url()).searchParams.get('state')!;
    if (uf === 'br') {
      await route.fulfill({ json: { results: [], available: 0, total: 5571 } });
      return;
    }
    requested.push(uf);
    if (requested.length === 1) await route.fulfill({ status: 304 });
    else if (requested.length === 2)
      await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    else await route.fulfill({ json: { results: [], available: 0, total: 1 } });
  });
  await page.goto('/?view=municipalities');
  // Geometry discovery may restart the first request; failures must still allow new UFs.
  await expect.poll(() => new Set(requested).size, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
});
test('national municipal layer, mode separation, free camera and clipped tooltips', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.region-sidebar details')).toHaveCount(5, { timeout: 15000 });
  const map = page.locator('.cockpit-map'),
    canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-visible-shapes', '27');
  const ba = national.states.find((s) => s.uf === 'ba')!;
  const point = () =>
    map.evaluate((e, shape) => {
      const r = e.getBoundingClientRect(),
        [x, y, w, h] = e.getAttribute('data-view')!.split(',').map(Number),
        scale = Math.min(r.width / w, r.height / h);
      return {
        x: r.x + (r.width - w * scale) / 2 + (shape.label[0] - x) * scale,
        y: r.y + (r.height - h * scale) / 2 + (shape.label[1] - y) * scale,
      };
    }, ba);
  const bounds = (await map.boundingBox())!,
    url = page.url();
  for (const [x, y] of [
    [50, 120],
    [bounds.width - 35, 120],
    [50, bounds.height - 90],
    [bounds.width - 35, bounds.height - 90],
  ]) {
    const start = await point();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + x, bounds.y + y, { steps: 4 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const moved = await point();
    await page.mouse.move(moved.x + 1, moved.y + 1);
    const tooltip = page.locator('.electoral-tooltip[data-territory="ba"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.tooltip-candidate')).toHaveCount(2);
    await expect
      .poll(async () => {
        const box = (await tooltip.boundingBox())!;
        return (
          box.x >= bounds.x &&
          box.y >= bounds.y &&
          box.x + box.width <= bounds.x + bounds.width &&
          box.y + box.height <= bounds.y + bounds.height
        );
      })
      .toBe(true);
  }
  expect(page.url()).toBe(url);
  await expect(page.locator('.region-sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Enquadrar território' }).click();
  await expect(map).toHaveAttribute('data-animating', 'false');
  await page.getByRole('button', { name: 'Municípios', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-visible-shapes', '5571', { timeout: 20000 });
  await expect(map).toHaveAttribute('data-zoom', '1.000');
  for (const mode of ['Apurado', 'Vantagem']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(map).toHaveAttribute('data-municipal', 'true');
    await expect(canvas).toHaveAttribute('data-visible-shapes', '5571');
  }
  await page.getByRole('button', { name: 'Estados', exact: true }).click();
  await expect(map).toHaveAttribute('data-municipal', 'false');
  await expect(canvas).toHaveAttribute('data-visible-shapes', '27');
});
test('candidate-only deep links select intensity and keep 5,571 municipal boundaries', async ({
  page,
}) => {
  for (const candidate of ['13', '22']) {
    await page.goto('/?candidate=' + candidate);
    await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
    await expect(page).toHaveURL(/view=candidate/);
    await expect(page.locator('.map-candidate-legend')).toContainText('intensidade do voto');
    await expect(page.locator('canvas')).toHaveAttribute('data-visible-shapes', '5571', {
      timeout: 20000,
    });
  }
});
