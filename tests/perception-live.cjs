/*
 * Explicitly gated integration scenario against a disposable QA account.
 * Not included in npm test. Never use an existing participant account.
 * Required environment:
 * PREDITOR_QA_ALLOW_MUTATIONS=1
 * PREDITOR_QA_CREDENTIALS_FILE=<JSON outside repository>
 * PREDITOR_PLAYWRIGHT_MODULE=<optional external playwright installation>
 * Credentials: { email,password,userId,baseURL,qaPrefix,masterURL?,masterPassword? }
 * The runner prints sanitized step summaries only; no sessions or credentials.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

if (process.env.PREDITOR_QA_ALLOW_MUTATIONS !== '1') {
  console.error('Live scenario disabled. Explicit disposable-account authorization is required.');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
const credentialFile = path.resolve(process.env.PREDITOR_QA_CREDENTIALS_FILE || '');
if (!process.env.PREDITOR_QA_CREDENTIALS_FILE || credentialFile.startsWith(root + path.sep)) {
  console.error('Provide credentials in a protected file outside the repository.');
  process.exit(2);
}
const credentials = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
if (!credentials.email || !credentials.password || !credentials.userId || !credentials.baseURL || !/^QA[-_]/i.test(credentials.qaPrefix || '')) {
  console.error('Missing explicit QA identity, base URL or QA prefix.');
  process.exit(2);
}
const { chromium } = require(process.env.PREDITOR_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = path.resolve(process.env.PREDITOR_QA_ARTIFACT_DIR || path.join(root, 'test-results', 'live-perception'));
fs.mkdirSync(artifacts, { recursive: true });
const report = { startedAt: new Date().toISOString(), steps: [], errors: [], createdIds: [] };
const prefix = credentials.qaPrefix + '-' + crypto.randomBytes(3).toString('hex');
const redact = text => {
  let safe = String(text);
  for (const secret of [credentials.password, credentials.email, credentials.masterPassword]) if (secret) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/eyJ[A-Za-z0-9_.-]+/g, '[TOKEN REDACTED]').slice(0, 1600);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let browser, contextA, contextB, otherOwnerContext, masterContext;

async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    report.steps.push({ name, status: 'passed', elapsedMs: Date.now() - started, ...(detail || {}) });
    console.log(JSON.stringify({ name, status: 'passed' }));
    return detail;
  } catch (error) {
    report.steps.push({ name, status: 'failed', elapsedMs: Date.now() - started, error: redact(error.message) });
    throw error;
  }
}

async function localRows(page) {
  return page.evaluate(id => {
    const parsed = JSON.parse(localStorage.getItem('preditor_fcu_local_perceptions_v4:' + id) || '{"items":[]}');
    return parsed.items.filter(row => row.user_id === id);
  }, credentials.userId);
}
async function waitRow(page, id, status, title) {
  await page.waitForFunction(({ userId, id, status, title }) => {
    const list = JSON.parse(localStorage.getItem('preditor_fcu_local_perceptions_v4:' + userId) || '{"items":[]}').items;
    return list.some(row => row.id === id && (!status || row._sync_status === status) && (!title || row.title === title));
  }, { userId: credentials.userId, id, status, title }, { timeout: 45000 });
}
async function refresh(page) {
  const before = await page.evaluate(() => window.PreditorPerception.getSyncStatus().lastLoadedAt);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(old => window.PreditorPerception.getSyncStatus().lastLoadedAt && window.PreditorPerception.getSyncStatus().lastLoadedAt !== old, before, { timeout: 45000 });
}
async function login(context, account = credentials) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(new URL('/?auth=login', account.baseURL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#fcu-login-form');
  await page.locator('#fcu-login-form [name=email]').fill(account.email);
  await page.locator('#fcu-login-form [name=password]').fill(account.password);
  await page.locator('#fcu-login-form [type=submit]').click();
  await page.waitForFunction(() => !!window.PreditorAuth?.user, null, { timeout: 30000 });
  const isQA = await page.evaluate(id => window.PreditorAuth.user.id === id, account.userId);
  assert(isQA, 'Authenticated identity does not match the disposable QA allowlist.');
  await page.waitForFunction(() => !!window.PreditorPerception?.getSyncStatus, null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.PreditorPerception.getSyncStatus().lastLoadedAt, null, { timeout: 60000 });
  try { await page.waitForFunction(() => !document.querySelector('#fcu-auth-backdrop')?.classList.contains('is-open')); }
  catch (_) {
    const info = await page.evaluate(() => ({
      visibleViews: Array.from(document.querySelectorAll('.fcu-auth-view')).filter(x => !x.hidden).map(x => x.dataset.view),
      mustChangePassword: window.PreditorAuth.user?.user_metadata?.must_change_password === true,
      message: document.querySelector('#fcu-auth-message')?.textContent || '',
      loaded: !!window.PreditorPerception.getSyncStatus().lastLoadedAt
    }));
    throw new Error('Login overlay remained open: ' + JSON.stringify(info));
  }
  return page;
}
async function openPanel(page) {
  await page.evaluate(() => window.PreditorPerception.open());
  await page.locator('#fcu-perception-panel').waitFor({ state: 'visible' });
}
async function formValues(page, title, description) {
  const form = page.locator('#fcu-perception-form');
  await form.waitFor({ state: 'visible' });
  await form.locator('input[name=classification][value=atencao]').check({ force: true });
  const details = form.locator('.fcu-extra-details');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=description]').fill(description);
  await form.locator('[type=submit]').click();
}
async function editData(page, id, title) {
  await openPanel(page);
  await page.locator(`article[data-id="${id}"] [data-edit]`).click();
  await formValues(page, title, 'Registro sintético de verificação; não representa observação territorial.');
}
async function dbRows(page, ids) {
  return page.evaluate(async ({ userId, ids }) => {
    if (window.PreditorAuth.user?.id !== userId) throw new Error('QA account changed');
    const result = await window.PreditorAuth.client.from('fcu_perceptions').select('id,user_id,title,geometry,status,updated_at').eq('user_id', userId).in('id', ids);
    if (result.error) throw new Error('QA perception read failed: ' + result.error.code);
    return result.data;
  }, { userId: credentials.userId, ids });
}
async function download(page, action, filename) {
  const waiting = page.waitForEvent('download', { timeout: 60000 });
  await action();
  const file = await waiting;
  const output = path.join(artifacts, filename);
  await file.saveAs(output);
  return output;
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PREDITOR_QA_BROWSER_EXECUTABLE ? { executablePath: process.env.PREDITOR_QA_BROWSER_EXECUTABLE } : {}) });
  contextA = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  contextB = await browser.newContext({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true });
  let a, b, originalId, copyId, geometryBefore;
  await step('independent_sessions_login', async () => {
    [a, b] = await Promise.all([login(contextA), login(contextB)]);
    const independent = await a.evaluate(() => { localStorage.setItem('qa_session_probe', 'session-a'); return true; });
    assert(independent && await b.evaluate(() => localStorage.getItem('qa_session_probe') === null), 'Browser sessions must not share storage.');
  });
  await step('draw_and_confirm_server_save', async () => {
    await openPanel(a);
    await a.locator('#fcu-start-drawing').click();
    const map = a.locator('#map');
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    assert(box && box.width > 300 && box.height > 200, 'Map area is not usable.');
    for (const [dx, dy] of [[-95,-60],[95,-60],[95,60],[-95,60]]) await a.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await a.locator('#fcu-finish').click();
    await formValues(a, prefix + '-initial', 'Registro QA sintético para sincronização em dois dispositivos.');
    await a.waitForFunction(({ userId, title }) => JSON.parse(localStorage.getItem('preditor_fcu_local_perceptions_v4:' + userId) || '{"items":[]}').items.some(x => x.title === title), { userId: credentials.userId, title: prefix + '-initial' });
    const saved = (await localRows(a)).find(row => row.title === prefix + '-initial');
    originalId = saved.id; report.createdIds.push(originalId);
    await waitRow(a, originalId, 'synced');
    const rows = await dbRows(a, [originalId]);
    assert(rows.length === 1 && rows[0].geometry.type === 'Polygon', 'Server did not confirm one polygon.');
    geometryBefore = rows[0].geometry;
    return { vertices: geometryBefore.coordinates[0].length };
  });
  await step('second_device_reads_identical_geometry', async () => {
    await refresh(b); await waitRow(b, originalId, 'synced', prefix + '-initial');
    const local = (await localRows(b)).find(x => x.id === originalId);
    assert(JSON.stringify(local.geometry) === JSON.stringify(geometryBefore), 'Second device geometry differs.');
  });
  if (process.env.PREDITOR_QA_OTHER_CREDENTIALS_FILE) await step('other_participant_cannot_read_or_edit_qa_polygon', async () => {
    const otherFile = path.resolve(process.env.PREDITOR_QA_OTHER_CREDENTIALS_FILE);
    assert(!otherFile.startsWith(root + path.sep), 'Other QA credentials must remain outside repository.');
    const other = JSON.parse(fs.readFileSync(otherFile, 'utf8'));
    assert(other.userId && other.userId !== credentials.userId && /^QA[-_]/i.test(other.qaPrefix || ''), 'Independent QA owner is required.');
    otherOwnerContext = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    const page = await login(otherOwnerContext, other);
    const result = await page.evaluate(async ({ originalId, userId, testTitle }) => {
      const c = window.PreditorAuth.client;
      if (window.PreditorAuth.user.id !== userId) throw new Error('Unexpected QA owner');
      const read = await c.from('fcu_perceptions').select('id').eq('id', originalId);
      const history = await c.from('fcu_perception_versions').select('id').eq('perception_id', originalId);
      const update = await c.from('fcu_perceptions').update({ title: testTitle }).eq('id', originalId).select('id');
      return { rows: read.data?.length || 0, versions: history.data?.length || 0, changed: update.data?.length || 0 };
    }, { originalId, userId: other.userId, testTitle: prefix + '-rls-probe' });
    assert(result.rows === 0 && result.versions === 0 && result.changed === 0, 'Row security allowed cross-account access.');
    assert((await dbRows(a, [originalId]))[0].title === prefix + '-initial', 'Cross-owner mutation changed the record.');
    await otherOwnerContext.close(); otherOwnerContext = null;
  });
  await step('offline_geometry_edit_replays_on_reconnect', async () => {
    await contextA.setOffline(true);
    await openPanel(a);
    await a.locator(`article[data-id="${originalId}"] [data-shape]`).click();
    await a.locator('.fcu-edit-marker.center').waitFor();
    const center = await a.locator('.fcu-edit-marker.center').boundingBox();
    await a.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
    await a.mouse.down();
    await a.mouse.move(center.x + center.width / 2 + 35, center.y + center.height / 2 + 20, { steps: 8 });
    await a.mouse.up();
    await a.locator('#fcu-editor-ok').click();
    await waitRow(a, originalId, 'pending');
    const offline = (await localRows(a)).find(x => x.id === originalId);
    assert(JSON.stringify(offline.geometry) !== JSON.stringify(geometryBefore), 'Geometry did not change during drag.');
    await contextA.setOffline(false);
    await a.evaluate(() => window.PreditorPerception.syncNow());
    await waitRow(a, originalId, 'synced');
    await refresh(b);
    const onB = (await localRows(b)).find(x => x.id === originalId);
    assert(JSON.stringify(onB.geometry) === JSON.stringify(offline.geometry), 'Offline edit did not reach other device.');
  });
  await step('concurrent_conflict_preserves_both_versions', async () => {
    await contextA.setOffline(true);
    await editData(a, originalId, prefix + '-offline-branch');
    await waitRow(a, originalId, 'pending');
    await editData(b, originalId, prefix + '-remote-branch');
    await waitRow(b, originalId, 'synced', prefix + '-remote-branch');
    await contextA.setOffline(false);
    await a.evaluate(() => window.PreditorPerception.syncNow());
    await waitRow(a, originalId, 'conflict');
    await a.locator(`article[data-id="${originalId}"] [data-conflict-copy]`).click();
    await a.waitForFunction(({ userId, origin }) => JSON.parse(localStorage.getItem('preditor_fcu_local_perceptions_v4:' + userId) || '{"items":[]}').items.some(x => x._conflict_origin_id === origin && x._sync_status === 'synced'), { userId: credentials.userId, origin: originalId });
    copyId = (await localRows(a)).find(x => x._conflict_origin_id === originalId).id;
    report.createdIds.push(copyId);
    const rows = await dbRows(a, [originalId, copyId]);
    assert(rows.length === 2, 'Conflict resolution must retain two server records.');
    assert(rows.find(x => x.id === originalId).title === prefix + '-remote-branch', 'Remote branch was overwritten.');
    assert(rows.find(x => x.id === copyId).title.startsWith(prefix + '-offline-branch'), 'Local branch was not preserved.');
  });
  await step('archive_restore_cross_device', async () => {
    await openPanel(a);
    await a.locator(`article[data-id="${copyId}"] [data-archive]`).click();
    await waitRow(a, copyId, 'synced');
    await refresh(b);
    assert((await localRows(b)).find(x => x.id === copyId).status === 'archived', 'Archive did not propagate.');
    await openPanel(b);
    await b.locator('#fcu-perception-panel [data-tab=history]').click();
    await b.locator(`article[data-id="${copyId}"] [data-restore]`).click();
    await waitRow(b, copyId, 'synced');
    await refresh(a);
    assert((await localRows(a)).find(x => x.id === copyId).status === 'submitted', 'Restore did not propagate.');
  });
  await step('server_history_contains_original_and_edited_geometries', async () => {
    const versions = await a.evaluate(async ({ userId, ids }) => {
      const result = await window.PreditorAuth.client.from('fcu_perception_versions').select('perception_id,version,geometry,status,change_kind').eq('user_id', userId).in('perception_id', ids).order('version');
      if (result.error) throw new Error('History read failed: ' + result.error.code);
      return result.data;
    }, { userId: credentials.userId, ids: [originalId, copyId] });
    const original = versions.filter(x => x.perception_id === originalId);
    const copied = versions.filter(x => x.perception_id === copyId);
    assert(original.length >= 3, 'Original history did not record geometry/data edits.');
    assert(original.some(x => JSON.stringify(x.geometry) === JSON.stringify(geometryBefore)), 'Original shape missing from history.');
    assert(copied.some(x => x.status === 'archived') && copied.some(x => x.status === 'submitted'), 'Archive/restore history missing.');
    return { originalVersions: original.length, copyVersions: copied.length };
  });
  await step('participant_geojson_export_geometry_matches_database', async () => {
    const file = await download(a, () => a.evaluate(() => window.PreditorPerception.exportQGIS({ format: 'geojson', status: 'all' })), 'participant-qa.geojson');
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = await dbRows(a, report.createdIds);
    for (const row of rows) {
      const feature = exported.features.find(f => f.id === row.id);
      assert(feature && JSON.stringify(feature.geometry) === JSON.stringify(row.geometry), 'GeoJSON differs from stored geometry.');
    }
    return { features: exported.features.length };
  });
  await step('participant_geopackage_export_sqlite_signature', async () => {
    const file = await download(a, () => a.evaluate(() => window.PreditorPerception.exportQGIS({ format: 'gpkg', status: 'all' })), 'participant-qa.gpkg');
    const data = fs.readFileSync(file);
    assert(data.subarray(0, 15).toString() === 'SQLite format 3', 'GeoPackage was not generated as SQLite.');
    return { bytes: data.length };
  });
  if (credentials.masterURL && credentials.masterPassword) await step('master_filtered_geojson_contains_qa_polygons', async () => {
    masterContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const master = await masterContext.newPage();
    await master.goto(credentials.masterURL, { waitUntil: 'domcontentloaded' });
    await master.locator('#password').fill(credentials.masterPassword);
    await master.locator('#loginForm button[type=submit]').click();
    await master.locator('[data-master-tab=login]').click();
    await master.waitForFunction(id => Array.from(document.querySelector('#logpercUserFilter')?.options || []).some(option => option.value === id), credentials.userId, { timeout: 45000 });
    await master.locator('#logpercUserFilter').selectOption(credentials.userId);
    const file = await download(master, () => master.locator('#exportLogpercGeoJSON').click(), 'master-qa.geojson');
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(exported.features.every(f => f.properties.user_id === credentials.userId), 'Master export contains another participant.');
    for (const id of report.createdIds) assert(exported.features.some(f => f.id === id), 'Master export missing QA record.');
    return { features: exported.features.length };
  });
  report.status = 'passed';
})().catch(error => {
  report.status = 'failed'; report.failure = redact(error.message);
  console.error(JSON.stringify({ status: 'failed', error: report.failure }));
  process.exitCode = 1;
}).finally(async () => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled([contextA?.close(), contextB?.close(), otherOwnerContext?.close(), masterContext?.close()]);
  await browser?.close();
  console.log(JSON.stringify({ status: report.status, passed: report.steps.filter(x => x.status === 'passed').length, failed: report.steps.filter(x => x.status === 'failed').length }));
});
