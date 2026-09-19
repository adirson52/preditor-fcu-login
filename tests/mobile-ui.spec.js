const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.beforeEach(async ({ page }) => {
  // These UI tests do not create telemetry events or accounts in production.
  await page.route('**/api/track**', route => route.fulfill({ status: 200, body: '{}' }));
});

async function ready(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PreditorMobile && window.PreditorPerception, null, { timeout: 60000 });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`mapa simplificado automático e sheet em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await expect(page.locator('body')).toHaveClass(/fcu-mobile-simple/);
    const map = await page.locator('#map').boundingBox();
    expect(map.height).toBeGreaterThan(viewport.height * .65);
    expect(map.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator('#fcu-mobile-area-label')).toContainText('Belém');
    await expect(page.locator('.fcu-mobile-nav')).toBeVisible();
    await expect(page.locator('.rf-minimap-control')).not.toBeVisible();
    await page.locator('.fcu-perception-button').click();
    await expect(page.locator('#fcu-perception-panel')).toHaveClass(/is-open/);
    const sheet = await page.locator('#fcu-perception-panel').boundingBox();
    expect(sheet.height).toBeLessThan(viewport.height * .5);
    expect(sheet.y).toBeGreaterThan(viewport.height * .35);
    await expect(page.locator('#fcu-perception-shade')).not.toBeVisible();
    await page.locator('.fcu-sheet-handle').click();
    await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet', 'expanded');
    await page.locator('[data-fcu-screen="map"]').click();
    await expect(page.locator('#fcu-perception-panel')).not.toHaveClass(/is-open/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('escolha completo é persistida sem mudar o mapa ou a conta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const before = await page.evaluate(() => window.PreditorApp.map.getCenter());
  await page.locator('.fcu-mobile-topbar [data-fcu-mode="complete"]').click();
  await expect(page.locator('body')).not.toHaveClass(/fcu-mobile-simple/);
  await expect(page.locator('.fcu-mobile-bottom')).not.toBeVisible();
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => window.PreditorApp.map.getCenter());
  // Leaflet rounds resized pixel origins; the geographic center must stay within two map pixels.
  expect(await page.evaluate(({ before, after }) => {
    const map = window.PreditorApp.map;
    return map.project(before).distanceTo(map.project(after));
  }, { before, after })).toBeLessThan(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PreditorMobile);
  expect(await page.evaluate(() => window.PreditorMobile.getMode())).toBe('complete');
  await page.locator('.fcu-mobile-quick-mode').click();
  await expect(page.locator('body')).toHaveClass(/fcu-mobile-simple/);
});

test('desktop mantém dashboard completo por padrão', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await expect(page.locator('body')).not.toHaveClass(/fcu-mobile-simple/);
  await expect(page.locator('#global-chart')).toBeVisible();
  await expect(page.locator('.fcu-mobile-bottom')).not.toBeVisible();
  await expect(page.locator('.fcu-sidebar-view')).toBeVisible();
  await expect(page.locator('.fcu-mobile-quick-mode')).not.toBeVisible();
});

test('percepções pedem login e autenticação não fica atrás da navegação mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator('[data-fcu-screen="perception"]').click();
  await expect(page.locator('#fcu-auth-backdrop')).toHaveClass(/is-open/);
  expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector('#fcu-auth-backdrop')).zIndex) > Number(getComputedStyle(document.querySelector('.fcu-mobile-bottom')).zIndex))).toBe(true);
  await expect(page.locator('#fcu-login-form')).toBeVisible();
  await page.locator('.fcu-auth-close').click();
  await page.locator('#fcu-mobile-area').click();
  await expect(page.locator('body')).toHaveClass(/fcu-mobile-areas-open/);
  await page.locator('#nav-container button').filter({ hasText: 'Belém - RGInt' }).click();
  await expect(page.locator('body')).not.toHaveClass(/fcu-mobile-areas-open/);
  await page.locator('#fcu-mobile-area').click();
  await page.locator('.fcu-mobile-area-shade').click({ position: { x: 370, y: 200 } });
  await expect(page.locator('body')).not.toHaveClass(/fcu-mobile-areas-open/);
});

test('status mobile não confunde cópia local com confirmação online', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  async function emit(detail) {
    await page.evaluate(detail => {
      window.PreditorPerception.getSyncStatus = () => detail;
      window.dispatchEvent(new CustomEvent('preditor:perception-sync-state', { detail }));
    }, detail);
  }
  await emit({ ownerId: 'qa', pending: 1, online: false });
  await expect(page.locator('#fcu-mobile-sync-label')).toHaveText('Neste aparelho');
  await emit({ ownerId: 'qa', syncing: true });
  await expect(page.locator('#fcu-mobile-sync-label')).toHaveText('Enviando…');
  await emit({ ownerId: 'qa', synced: 1, lastLoadedAt: Date.now(), online: true });
  await expect(page.locator('#fcu-mobile-sync-label')).toHaveText('Salvo online');
  await emit({ ownerId: 'qa', conflicts: 1, online: true });
  await expect(page.locator('#fcu-mobile-sync-label')).toHaveText('Revisar versões');
  await emit({ ownerId: 'qa', synced: 1, lastLoadedAt: Date.now(), online: true, cloudAvailable: false });
  await expect(page.locator('#fcu-mobile-sync-label')).toHaveText('Conexão não confirmada');
});

test('conta QA em mobile permite abrir desenho e cancelar sem gravar', async ({ page }) => {
  test.skip(!process.env.PREDITOR_QA_CREDENTIALS, 'Conta QA isolada opcional, nunca conta real.');
  test.setTimeout(90000);
  const credentials = JSON.parse(fs.readFileSync(process.env.PREDITOR_QA_CREDENTIALS, 'utf8'));
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const result = await page.evaluate(async credentials => {
    const result = await window.PreditorAuth.client.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
    return { error: !!result.error };
  }, credentials);
  expect(result.error).toBe(false);
  await page.waitForFunction(() => window.PreditorAuth.user && window.PreditorPerception.getSyncStatus().ownerId);
  await page.locator('[data-fcu-screen="perception"]').click();
  await page.locator('#fcu-start-drawing').click();
  await expect(page.locator('.fcu-perception-drawnote')).toBeVisible();
  const map = await page.locator('#map').boundingBox();
  for (const [x, y] of [[.3,.25],[.65,.3],[.55,.48]]) {
    await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  }
  await expect(page.locator('.fcu-gis-count')).toContainText('3');
  await page.locator('#fcu-cancel').click();
  await expect(page.locator('.fcu-perception-drawnote')).toHaveCount(0);
  await page.locator('[data-fcu-screen="account"]').click();
  await expect(page.locator('#fcu-account-page')).toHaveClass(/is-open/);
  await page.screenshot({ path: 'test-results/mobile-qa-account.png' });
  const wideElements = await page.evaluate(() => [...document.querySelectorAll('#fcu-account-page *')].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })).slice(0, 15));
  expect(wideElements).toEqual([]);
  expect(await page.evaluate(() => document.querySelector('#fcu-account-page').scrollWidth <= innerWidth)).toBe(true);
});
