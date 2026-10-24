import { test, expect } from '@playwright/test';
test.setTimeout(60000);
test('free wheel exploration, municipal hover, animated selection and synchronized zones', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  const canvas = page.locator('canvas'),
    map = page.locator('.cockpit-map');
  await page.getByRole('button', { name: 'Municípios', exact: true }).click();
  const before = page.url();
  const geometry = await (await request.get('/maps/pb.json')).json();
  const jp = geometry.shapes.find((s: { code: string }) => s.code === '20516');
  const point = await canvas.evaluate((e, arg) => {
    const c = e as HTMLCanvasElement,
      ctx = c.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = new Path2D(arg.path);
    let xy = arg.label;
    outer: for (let y = arg.bounds[1]; y < arg.bounds[3]; y += (arg.bounds[3] - arg.bounds[1]) / 25)
      for (let x = arg.bounds[0]; x < arg.bounds[2]; x += (arg.bounds[2] - arg.bounds[0]) / 25)
        if (ctx.isPointInPath(p, x, y)) {
          xy = [x, y];
          break outer;
        }
    ctx.restore();
    return xy;
  }, jp);
  const screenPoint = async () =>
    page.locator('.cockpit-map').evaluate((e, xy) => {
      const r = e.getBoundingClientRect(),
        [x, y, w, h] = e.getAttribute('data-view')!.split(',').map(Number),
        s = Math.min(r.width / w, r.height / h);
      return {
        x: r.x + (r.width - w * s) / 2 + (xy[0] - x) * s,
        y: r.y + (r.height - h * s) / 2 + (xy[1] - y) * s,
      };
    }, point);
  let at = await screenPoint();
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 9; i++) await page.mouse.wheel(0, -120);
  await expect(map).toHaveAttribute('data-municipal', 'true');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-visible-shapes')))
    .toBeGreaterThan(0);
  expect(page.url()).toBe(before);
  await expect(page.locator('.region-sidebar')).toBeVisible();
  at = await screenPoint();
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.pointer-tooltip')).toHaveAttribute('data-territory', '20516');
  await expect(page.locator('.pointer-tooltip')).toContainText(/joão pessoa/i);
  await expect(page.locator('.pointer-tooltip')).toContainText('das seções', { timeout: 15000 });
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(/municipality=20516/);
  await expect(map).toHaveAttribute('data-animating', 'false');
  await expect(page.getByRole('navigation', { name: 'Navegação geográfica' })).toContainText(
    'Paraíba',
  );
  await expect(page.locator('.context-panel h2').first()).toContainText(/joão pessoa/i);
  await expect(page.locator('.cockpit-top-two button')).toHaveCount(2);
  await expect(page.locator('.cockpit-timeline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cor', exact: true })).toBeVisible();
  const row = page.locator('.zone-row[data-zone="0070"]');
  await expect(row).toContainText('46,75%', { timeout: 35000 });
  await row.hover();
  await expect(page.getByRole('button', { name: 'Zona 70 no mapa' })).toHaveClass(/is-highlighted/);
  await page.getByRole('button', { name: 'Zona 70 no mapa' }).click();
  await expect(page).toHaveURL(/zone=0070/);
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.zone-tooltip')).toContainText('45,20%');
  await expect(page.locator('.zone-tooltip')).toContainText('não disponíveis');
  await page.screenshot({ path: 'outputs/navigation-joao-pessoa-zona70.png' });
  const selectedView = await map.getAttribute('data-view');
  await page.getByRole('button', { name: 'Informações e transparência' }).click();
  expect(await map.getAttribute('data-view')).toBe(selectedView);
  await page
    .getByRole('navigation', { name: 'Navegação geográfica' })
    .getByRole('button', { name: 'Paraíba', exact: true })
    .click();
  await expect(page).not.toHaveURL(/municipality=/);
  await page
    .getByRole('navigation', { name: 'Navegação geográfica' })
    .getByRole('button', { name: 'Brasil', exact: true })
    .click();
  await expect(page).not.toHaveURL(/state=/);
  await expect(page.locator('.region-sidebar')).toBeVisible();
  expect(errors).toEqual([]);
});
test('reduced motion and restoration of a municipal zone deep link', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?state=PB&municipality=20516&zone=0070');
  await expect(page.locator('#conteudo')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.context-panel h2').first()).toContainText(/joão pessoa/i);
  await expect(page.locator('.zone-row[data-zone="0070"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cockpit-map')).toHaveAttribute('data-animating', 'false');
  await page.reload();
  await expect(page.locator('.zone-row[data-zone="0070"]')).toHaveAttribute('aria-pressed', 'true');
});
