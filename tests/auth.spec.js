const { test, expect } = require('@playwright/test');

test('exibe cadastro com os aceites obrigatórios', async ({ page }) => {
  await page.goto('/?auth=register', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#fcu-auth-backdrop')).toHaveClass(/is-open/);
  await expect(page.locator('#fcu-register-form input[name="full_name"]')).toBeVisible();
  await expect(page.locator('#fcu-register-form input[name="email"]')).toBeVisible();
  await expect(page.locator('#fcu-register-form')).toContainText('E-mail de acesso');
  await expect(page.locator('#fcu-register-form input[name="password"]')).toHaveAttribute('minlength', '6');
  await expect(page.locator('#fcu-register-form input[name="institution"]')).toBeVisible();
  await expect(page.locator('#fcu-register-form input[name="terms"]')).not.toBeChecked();
  await expect(page.locator('#fcu-register-form input[name="privacy"]')).not.toBeChecked();
  await expect(page.locator('#fcu-register-form a[href="termos.html"]')).toBeVisible();
  await expect(page.locator('#fcu-register-form a[href="privacidade.html"]')).toBeVisible();
});

test('pede login ao tentar consultar uma segunda célula', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fcu-auth-button')).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem('preditor_fcu_demo_cell_v1', 'CELULA_DEMONSTRACAO');
  });
  await page.waitForFunction(() => window.PreditorAuth && typeof window.PreditorAuth.guardCellOpen === 'function');
  await page.evaluate(() => {
    window.PreditorAuth.guardCellOpen(
      { id: 'SEGUNDA_CELULA', a: 'area_teste', lat: -1.45, lng: -48.5 },
      () => { window.__testCellOpened = true; }
    );
  });

  await expect(page.locator('#fcu-auth-backdrop')).toHaveClass(/is-open/);
  await expect(page.locator('#fcu-auth-lead')).toContainText('célula de demonstração');
  await expect(page.locator('#fcu-login-form')).toBeVisible();
  expect(await page.evaluate(() => window.__testCellOpened)).not.toBe(true);
});
