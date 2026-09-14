const { test, expect } = require('@playwright/test');
const snapshot = require('../selection/results.json');

const selectionPath = process.env.SELECTION_PATH || '/selecaovariaveis.html';

test('selection snapshot, filters and public downloads', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(selectionPath);
  await expect(page.locator('#aba-resultados')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#selection-table tbody tr')).toHaveCount(26);
  await expect(page.locator('#selection-table .selected-k')).toHaveCount(snapshot.completed);
  for (const row of snapshot.rows) {
    const rendered = page.locator(`[data-area="${row.id}"]`);
    await expect(rendered.locator('th')).toHaveText(row.name);
    for (const value of row.values) {
      await expect(rendered.locator(`[data-scenario="${value.scenario}"]`)).toHaveText(
        value.k !== null ? String(value.k) : value.status === 'running' ? 'Calc.' : '\u2013'
      );
    }
  }
  await page.locator('#selection-search').fill('belem');
  await expect(page.locator('#selection-table tbody tr:visible')).toHaveCount(1);
  await expect(page.locator('#selection-count')).toHaveText('1 \u00e1rea');
  await page.locator('#selection-search').fill('sem-correspondencia');
  await expect(page.locator('#selection-empty')).toBeVisible();
  await page.locator('#selection-search').fill('');
  for (const status of ['completed', 'running', 'pending']) {
    await page.locator('#selection-status').selectOption(status);
    await expect(page.locator('#selection-table tbody tr:visible')).toHaveCount(snapshot.rows.filter(row => row.status === status).length);
  }
  await page.locator('#selection-status').selectOption('all');
  for (const path of ['/selection/results.csv', '/selection/aracaju_25_divisoes.csv', '/selection/auditoria_aracaju.json']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(100);
  }
  const csv = await (await request.get('/selection/results.csv')).text();
  expect(csv.trim().split('\n')).toHaveLength(27);
  expect(csv).toContain(snapshot.updatedAt);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`three tabs, lesson and real map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(selectionPath);
    await page.locator('#aba-passos').click();
    await page.locator('#sp-next').click();
    await page.locator('#sp-next').click();
    await expect(page.locator('#sp-territory > .sp-block')).toHaveCount(25);
    await expect(page.locator('#sp-territory .sp-cell')).toHaveCount(400);
    await expect(page.locator('#sp-block-count .sp-count-cell')).toHaveCount(16);
    for (let step = 3; step < 12; step++) await page.locator('#sp-next').click();
    await expect(page.locator('#sp-next')).toBeDisabled();
    await expect(page.locator('#sp-counter')).toContainText('12 de 12');
    await page.locator('#aba-aracaju').click();
    await page.waitForFunction(() => window.SpatialSplit && window.SpatialSplit.data.cells.length === 84323);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => ({
      error: window.__mapError || null,
      blocks: window.SpatialSplit.data.groups.length,
      online: Boolean(document.getElementById('online')),
      tiles: Object.values(window.SpatialSplit.map._layers).some(layer => layer instanceof L.TileLayer)
    }))).toEqual({ error: null, blocks: 7404, online: false, tiles: false });
    await page.locator('#repeat').selectOption('2');
    await page.locator('#fold').selectOption('4');
    await page.evaluate(() => SpatialSplit.selectCell(SpatialSplit.data.examples[1]));
    const selected = await page.evaluate(() => ({ selected: SpatialSplit.state.selected, zoom: SpatialSplit.map.getZoom(), rep: SpatialSplit.state.rep, fold: SpatialSplit.state.fold }));
    for (const tab of ['resultados', 'passos', 'aracaju']) {
      await page.locator('#aba-' + tab).click();
      await page.waitForTimeout(180);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page.locator('.site-panel:visible')).toHaveCount(1);
    }
    expect(await page.evaluate(() => ({ selected: SpatialSplit.state.selected, zoom: SpatialSplit.map.getZoom(), rep: SpatialSplit.state.rep, fold: SpatialSplit.state.fold }))).toEqual(selected);
    const painted = await page.evaluate(() => Array.from(document.querySelectorAll('#map canvas')).some(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
      return count > 1000;
    }));
    expect(painted).toBe(true);
    await page.locator('#aba-resultados').click();
    await expect(page.locator('#metodologia-reserva')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('dashboard keeps the selection link after navigation is initialized', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-nav-links a[href="/selecaovariaveis"]')).toHaveCount(1);
});
