const { test, expect } = require('@playwright/test');
const OWNER = '00000000-0000-4000-8000-000000000041';
const ID = '00000000-0000-4000-8000-000000000042';
const KEY = 'preditor_fcu_local_perceptions_v4:' + OWNER;
const row = {
  id: ID, user_id: OWNER, title: 'Desenho antigo do aparelho', status: 'submitted',
  created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z',
  geometry: { type: 'Polygon', coordinates: [[[-48.5,-1.45],[-48.49,-1.45],[-48.49,-1.44],[-48.5,-1.45]]] },
  _sync_status: 'synced'
};

// Real page, real map and perception engine; the synthetic account never reaches
// Auth or the live database. Any unexpected external database request fails.
for (const cache of ['legacy', 'synced-v4']) {
  test(`real mobile engine separates ${cache} after remote cleanup and mounts safe refresh`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/track**', route => route.fulfill({ status: 200, body: '{}' }));
    await page.route('**/api/collect**', route => route.fulfill({ status: 200, body: '{}' }));
    await page.route('**/*.supabase.co/**', route => { unexpected.push(route.request().method()); return route.abort(); });
    await page.route('**/auth.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.__cacheWrites = [];
      const owner = ${JSON.stringify(OWNER)};
      window.PreditorAuth = {
        user: { id: owner, email: 'fixture@example.test', user_metadata: { full_name: 'Conta de teste isolada', institution: 'Teste local' } },
        verifyAccount: async () => true, track: async () => {}, trackEvent: async () => {},
        client: {
          auth: { onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) },
          from(table) {
            const query = { op: 'select', single: false };
            for (const method of ['select','eq','order','range','limit','in','gte','lte']) query[method] = () => query;
            query.maybeSingle = query.singleResult = () => { query.single = true; return query; };
            for (const method of ['insert','update','delete','upsert']) query[method] = payload => {
              query.op = method; window.__cacheWrites.push({table, method}); return query;
            };
            query.then = (resolve, reject) => Promise.resolve({ data: query.single ? null : [], error: query.op === 'select' ? null : {message:'No fixture writes allowed'} }).then(resolve,reject);
            return query;
          }
        }
      };
    ` }));
    await page.addInitScript(({ cache, row, key }) => {
      if (cache === 'legacy') localStorage.setItem('preditor_fcu_local_perceptions_v3', JSON.stringify([row]));
      else localStorage.setItem(key, JSON.stringify({ schema: 4, items: [{ ...row, _server_updated_at: row.updated_at }] }));
      localStorage.setItem('cache-test-other-owner', 'preserve');
    }, { cache, row, key: KEY });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PreditorPerception?.getSyncStatus().lastLoadedAt, null, { timeout: 60000 });
    expect(await page.evaluate(() => window.PreditorPerception.getSyncStatus().quarantined)).toBe(1);
    await page.evaluate(() => window.PreditorPerception.open());
    await expect(page.locator('#fcu-perception-list')).not.toContainText(row.title);
    await page.evaluate(() => window.PreditorPerception.openProfile());
    await expect(page.locator('#fcu-device-data-card')).toBeVisible();
    await page.locator('[data-device-refresh]').click();
    await expect(page.locator('[data-device-status]')).toContainText('Dados atualizados');
    await page.locator('[data-device-old-items] summary').click();
    await expect(page.locator('[data-device-old-list]')).toContainText(row.title);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items[0]._sync_status, KEY)).toBe('quarantined');
    expect(await page.evaluate(() => localStorage.getItem('cache-test-other-owner'))).toBe('preserve');
    expect(await page.evaluate(() => window.PreditorAuth.user.id)).toBe(OWNER);
    expect(await page.evaluate(() => window.__cacheWrites)).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
