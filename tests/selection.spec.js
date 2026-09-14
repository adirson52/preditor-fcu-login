const { test, expect } = require('@playwright/test');
const snapshot = require('../selection/results.json');

const selectionPath = process.env.SELECTION_PATH || '/selecaovariaveis.html';

test('selection snapshot, filters and public downloads', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(selectionPath);
  await expect(page.locator('#aba-passos')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#aba-resultados').click();
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
  test(`four tabs, lesson and real map at ${viewport.width}px`, async ({ page }) => {
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
    for (const tab of ['resultados', 'passos', 'variaveis', 'aracaju']) {
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

test('full candidate catalogue uses the actual sources and temporal pairs', async ({ page }) => {
  const catalog = require('../selection/catalog.json');
  await page.goto(selectionPath + '#resultados');
  await expect(page.locator('[data-variable]')).toHaveCount(114);
  for (const family of catalog) {
    const disclosure = page.locator(`[data-family="${family.code}"]`);
    await disclosure.locator(':scope > summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
    for (let i = 0; i < family.blocks.length; i++) {
      const block = disclosure.locator('.catalog-group').nth(i);
      await block.locator('summary').click();
      for (const variable of family.blocks[i].variables) {
        const row = block.locator(`[data-variable="${variable.id}"]`);
        await expect(row).toBeVisible();
        await expect(row.locator('td').first()).toContainText(variable.source);
        await expect(row.locator('td').last()).toContainText(variable.static ? 'Mesma coluna' : variable.inference);
      }
    }
  }
});

for (const width of [1366, 390, 320]) {
  test(`detailed lessons and live equation at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(selectionPath);
    await expect(page.locator('.site-tab')).toHaveText(['Exemplo ilustrativo', 'Caso real: Aracaju', 'Vari\u00e1veis: exemplo', 'Resultados']);
    for (let i = 0; i < 9; i++) await page.locator('#sp-next').click();
    await expect(page.locator('.sp-round-table tbody tr')).toHaveCount(5);
    await page.locator('.sp-round-table button').nth(2).click();
    await expect(page.locator('.sp-reading')).toContainText('grupo C');
    await page.locator('#sp-next').click();
    await expect(page.locator('.sp-mini-blocks')).toHaveCount(2);
    await expect(page.locator('.sp-mini-blocks span')).toHaveCount(50);
    await page.locator('#sp-next').click();
    await expect(page.locator('.sp-evaluations button')).toHaveCount(25);
    await page.locator('.sp-evaluations button').last().click();
    await expect(page.locator('.sp-reading')).toContainText('divis\u00e3o 5, rodada 5');
    await page.locator('#aba-variaveis').click();
    for (let step = 0; step < 15; step++) {
      await page.locator('#ibge-step').selectOption(String(step));
      await expect(page.locator('#ibge-phase')).toContainText(`${step + 1} de 15`);
      expect(await page.locator('#ibge-visual').evaluate(element => element.childElementCount)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if ([4, 6, 10, 14].includes(step)) await expect(page.locator('#ibge-visual svg').first()).toBeVisible();
      if (step === 12) {
        const result = await page.evaluate(() => {
          const app = IbgeExample;
          const original = app.prediction().p;
          const input = document.querySelector('[data-term]');
          input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
          return { original, changed: app.prediction().p, text: document.getElementById('equation-probability').textContent };
        });
        expect(Math.abs(result.original - result.changed)).toBeGreaterThan(.001);
        expect(result.text).toContain('%');
        const maxError = await page.evaluate(() => {
          const { final } = IbgeExample.data;
          return Math.max(...final.referencePredictions.map(row => {
            const z = final.intercept + final.terms.reduce((sum, term) => sum + IbgeExample.contribution(term, row.x[term.id]), 0);
            return Math.abs(1 / (1 + Math.exp(-z)) - row.p);
          }));
        });
        expect(maxError).toBeLessThan(1e-12);
      }
    }
    await expect(page.locator('#ibge-next')).toBeDisabled();
    await expect(page.locator('#ibge-visual-source')).toContainText('DADOS REAIS');
    await expect(page.locator('#ibge-story')).toContainText('0,8372');
    await page.locator('#aba-resultados').click();
    await page.locator('[data-go-tab]').click();
    await expect(page.locator('#aba-variaveis')).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
}
