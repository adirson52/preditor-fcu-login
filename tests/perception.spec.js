const { test, expect } = require('@playwright/test');

test('percepção contextual preserva o mapa e oferece filtros próprios', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PreditorPerception && document.querySelector('.fcu-perception-button'));

  await page.evaluate(() => {
    window.__PREDITOR_APP__.selectedSample = {
      id: 'CELULA_TESTE_PERCEPCAO', lat: -23.55, lng: -46.63, proba: 0.82,
      ranking_candidato: 1, scope: 'area_conc_urb_sao_paulo', res_m: 50
    };
    document.querySelector('.fcu-perception-button').click();
  });

  await expect(page.locator('#fcu-context-card')).toContainText('Célula selecionada');
  await expect(page.locator('#fcu-context-card')).toContainText('Preditor:');
  await expect(page.locator('#fcu-context-card')).toContainText('Concordo com o resultado');
  await expect(page.locator('#fcu-context-card')).toContainText('Vejo esta área diferente');
  await expect(page.locator('[data-class-filter]')).toHaveCount(4);
  await expect(page.locator('[data-action-filter]')).toHaveCount(3);
  await expect(page.locator('[name="knowledge_source"]')).toHaveCount(5);
  await expect(page.locator('[name="confirm_perception"]')).toHaveCount(0);
  await expect(page.locator('.fcu-extra-details')).toHaveCount(1);
  await expect(page.locator('[name="field_validation"]')).toHaveCount(1);
  await expect(page.locator('[name="consent"]')).toHaveCount(0);

  await page.locator('[data-layer-visible]').uncheck();
  await expect(page.locator('[data-layer-visible]')).not.toBeChecked();
  await expect(page.locator('#map')).toBeVisible();
});

test('ações de percepção exigem autenticação', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PreditorPerception && document.querySelector('.fcu-perception-button'));
  await page.evaluate(() => {
    window.__PREDITOR_APP__.selectedSample = {
      id: 'CELULA_TESTE_LOGIN', lat: -23.55, lng: -46.63, proba: 0.82,
      ranking_candidato: 1, scope: 'area_conc_urb_sao_paulo', res_m: 50
    };
    document.querySelector('.fcu-perception-button').click();
  });
  await page.locator('[data-confirm]').click();
  await expect(page.locator('#fcu-auth-backdrop')).toHaveClass(/is-open/);
});

test('rota experimental oferece seleção por grade e modos do mapa', async ({ page }) => {
  await page.goto('/?percepcao=grade');
  await page.waitForSelector('.fcu-perception-button');
  await page.locator('.fcu-perception-button').click({ force: true });
  await expect(page.locator('.fcu-grid-picker')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar', exact: false })).toBeVisible();
  await expect(page.locator('.fcu-map-mode-control')).toContainText('Satélite');
  await expect(page.locator('.fcu-map-mode-control')).toContainText('3D');
});
