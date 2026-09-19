const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setContent('<div class="fcu-account-page is-open" id="fcu-account-page"><main class="fcu-account-main"><div class="fcu-account-grid" id="fcu-account-content"><article class="fcu-account-card"><h3>Perfil</h3></article></div></main></div>');
  await page.addStyleTag({ path: path.join(__dirname, '..', 'perception.css') });
  await page.addStyleTag({ path: path.join(__dirname, '..', 'mobile.css') });
  await page.evaluate(() => {
    window.__calls = { refresh: 0, recover: 0 };
    window.PreditorAuth = { user: { id: 'ui-owner-a' } };
    window.PreditorPerception = {
      getSyncStatus: () => ({ ownerId: 'ui-owner-a' }),
      getQuarantinedItems: () => [],
      refreshDeviceCache: async () => { window.__calls.refresh++; return { ok: true, pending: 2 }; },
      recoverQuarantinedCopy: async () => { window.__calls.recover++; return { ok: true }; }
    };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'device-data.js') });
});

test('refresh is explicit, keeps login and explains preserved changes', async ({ page }) => {
  expect(await page.evaluate(() => window.__calls)).toEqual({ refresh: 0, recover: 0 });
  await page.getByRole('button', { name: 'Atualizar dados deste aparelho' }).click();
  await expect(page.locator('[data-device-status]')).toContainText('2 alterações locais preservadas');
  expect(await page.evaluate(() => window.PreditorAuth.user.id)).toBe('ui-owner-a');
  expect(await page.evaluate(() => window.__calls.refresh)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('preditor:account-rendered')));
  await expect(page.locator('#fcu-device-data-card')).toHaveCount(1);
});

test('failed refresh never claims data was updated or clears local work', async ({ page }) => {
  await page.evaluate(() => { window.PreditorPerception.refreshDeviceCache = async () => ({ ok: false, reason: 'offline' }); });
  await page.getByRole('button', { name: 'Atualizar dados deste aparelho' }).click();
  await expect(page.locator('[data-device-status]')).toContainText('Seus dados neste aparelho foram mantidos');
  await expect(page.locator('[data-device-status]')).toHaveClass(/is-error/);
});

test('partial history refresh clearly distinguishes perceptions from unavailable history', async ({ page }) => {
  await page.evaluate(() => { window.PreditorPerception.refreshDeviceCache = async () => ({ ok: false, reason: 'partial-history', historyComplete: false }); });
  await page.getByRole('button', { name: 'Atualizar dados deste aparelho' }).click();
  await expect(page.locator('[data-device-status]')).toHaveText('Percepções atualizadas, mas o histórico não pôde ser conferido. Tente novamente.');
  await expect(page.locator('[data-device-status]')).toHaveClass(/is-error/);
  await expect(page.getByRole('button', { name: 'Atualizar dados deste aparelho' })).toBeEnabled();
});

test('old records are plain text and recovering a new copy needs confirmation', async ({ page }) => {
  await page.evaluate(() => {
    window.PreditorPerception.getQuarantinedItems = () => [{ id: 'old-1', title: '<img src=x onerror=alert(1)>' }];
    window.dispatchEvent(new Event('preditor:account-rendered'));
  });
  await page.locator('[data-device-old-items] summary').click();
  await expect(page.locator('[data-device-old-list]')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('[data-device-old-list] img')).toHaveCount(0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Recuperar cópia' }).click();
  expect(await page.evaluate(() => window.__calls.recover)).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recuperar cópia' }).click();
  await expect(page.getByRole('button', { name: 'Cópia recuperada' })).toBeDisabled();
  expect(await page.evaluate(() => window.__calls.recover)).toBe(1);
});

test('account change cannot expose another user old records or completion', async ({ page }) => {
  await page.evaluate(() => {
    window.PreditorPerception.refreshDeviceCache = () => new Promise(resolve => { window.__finishRefresh = resolve; });
    window.PreditorPerception.getQuarantinedItems = () => [{ id: 'old-1', title: 'Owner A private title' }];
  });
  await page.getByRole('button', { name: 'Atualizar dados deste aparelho' }).click();
  await page.evaluate(() => {
    window.PreditorAuth.user = { id: 'ui-owner-b' };
    window.dispatchEvent(new Event('preditor:account-rendered'));
    window.__finishRefresh({ ok: true, pending: 2 });
  });
  await expect(page.locator('[data-device-old-items]')).toBeHidden();
  await expect(page.locator('[data-device-status]')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Atualizar dados deste aparelho' })).toBeEnabled();
});

for (const width of [390, 768]) {
  test(`account data card remains usable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.body.classList.add('fcu-mobile-simple'));
    await page.getByRole('button', { name: 'Atualizar dados deste aparelho' }).click();
    await expect(page.locator('[data-device-status]')).toContainText('alterações locais preservadas');
    expect(await page.evaluate(() => document.querySelector('#fcu-account-page').scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`device-data-${width}.png`) });
  });
}

test('sign-out removes the account data card and stale record titles', async ({ page }) => {
  await page.evaluate(() => {
    window.PreditorPerception.getQuarantinedItems = () => [{ id: 'old-1', title: 'Private record' }];
    window.dispatchEvent(new Event('preditor:account-rendered'));
  });
  await expect(page.locator('[data-device-old-list]')).toContainText('Private record');
  await page.evaluate(() => {
    window.PreditorAuth.user = null;
    window.dispatchEvent(new Event('preditor:perception-sync-state'));
  });
  await expect(page.locator('#fcu-device-data-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.__calls)).toEqual({ refresh: 0, recover: 0 });
});
