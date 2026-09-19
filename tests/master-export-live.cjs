/* Read-only QA export smoke. Login audit events are expected, no data mutations.
 * Gate: PREDITOR_QA_ALLOW_EXPORT_READS=1; credentials/artifacts must live outside Git.
 * Uses a participant's RLS-restricted connection as the independent DB reference.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = process.env.PREDITOR_QA_CREDENTIALS_FILE;
if (process.env.PREDITOR_QA_ALLOW_EXPORT_READS !== '1' || !file || path.resolve(file).startsWith(root + path.sep)) {
  console.error('Explicit QA export-read authorization and external credentials are required.');
  process.exit(2);
}
const account = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!account.userId || !account.email || !account.password || !account.masterPassword || !account.masterURL || !/^QA[-_]/i.test(account.qaPrefix || '')) throw new Error('Invalid disposable QA configuration.');
const { chromium } = require(process.env.PREDITOR_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = path.resolve(process.env.PREDITOR_QA_ARTIFACT_DIR || '');
if (!process.env.PREDITOR_QA_ARTIFACT_DIR || artifacts.startsWith(root + path.sep)) throw new Error('An external QA artifact directory is required.');
fs.mkdirSync(artifacts, { recursive: true });
const report = { startedAt: new Date().toISOString(), mode: 'read-only-export', steps: [], consoleErrors: [] };
const redact = value => {
  let safe = String(value);
  for (const secret of [account.email, account.password, account.masterPassword]) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/eyJ[A-Za-z0-9_.-]+/g, '[TOKEN REDACTED]').slice(0, 1200);
};
async function step(name, run) {
  try {
    const info = await run();
    report.steps.push({ name, status: 'passed', ...info });
    console.log(JSON.stringify({ name, status: 'passed', ...info }));
  } catch (error) {
    report.steps.push({ name, status: 'failed', message: redact(error.message) });
    throw error;
  }
}
const commonFields = ['user_id','title','perception_types','intensity','time_reference','confidence','description','area_id','status','geometry','target_kind','action_type','cell_id','model_class','perceived_class','model_probability','model_snapshot','geometry_source','deleted_at','knowledge_sources','field_validation','field_visit_date'];
const fields = {
  perceptions: ['id','created_at','updated_at',...commonFields],
  versions: ['id::text','perception_id','version','change_kind','recorded_at',...commonFields]
};
let browser, participant, master, reference;
async function ownDatabaseRows(kind) {
  return participant.evaluate(async ({ userId, kind, fields }) => {
    if (window.PreditorAuth.user?.id !== userId) throw new Error('Disposable participant identity changed.');
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const result = await window.PreditorAuth.client.from(kind === 'versions' ? 'fcu_perception_versions' : 'fcu_perceptions')
        .select(fields.join(',')).eq('user_id', userId).order('id', { ascending: true }).range(offset, offset + 199);
      if (result.error) throw new Error('Own QA DB read failed: ' + result.error.code);
      rows.push(...result.data);
      if (result.data.length < 200) return rows;
    }
  }, { userId: account.userId, kind, fields: fields[kind] });
}
async function exportApi(kind, cursor = '') {
  return master.evaluate(async ({ kind, userId, cursor }) => {
    const query = new URLSearchParams({ mode: 'perception-export', kind, user_id: userId });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch('/api/login-report?' + query);
    if (!response.ok) throw new Error('QA export endpoint HTTP ' + response.status);
    return response.json();
  }, { kind, userId: account.userId, cursor });
}
function equivalentRows(actual, expected) {
  assert.equal(actual.length, expected.length, 'QA row count mismatch.');
  const lookup = new Map(expected.map(row => [String(row.id), row]));
  assert.equal(lookup.size, expected.length, 'Expected duplicate row identifier.');
  const seen = new Set();
  for (const row of actual) {
    assert.equal(row.user_id, account.userId, 'Unexpected participant in filtered export.');
    assert(!seen.has(String(row.id)), 'Duplicate exported snapshot identifier.');
    seen.add(String(row.id));
    const wanted = lookup.get(String(row.id));
    assert(wanted, 'Unexpected QA snapshot identifier.');
    for (const [key, value] of Object.entries(wanted)) {
      // Compare each selected snapshot field without printing actual participant data.
      try { assert.deepEqual(row[key], value); } catch (_) { throw new Error('QA snapshot field mismatch: ' + key); }
    }
  }
}
async function download(button, filename) {
  const waiting = master.waitForEvent('download', { timeout: 90000 });
  await master.locator(button).click();
  const item = await waiting;
  const destination = path.join(artifacts, filename);
  await item.saveAs(destination);
  return destination;
}
(async () => {
  browser = await chromium.launch({ headless: true });
  const participantContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const masterContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  participant = await participantContext.newPage();
  master = await masterContext.newPage();
  for (const page of [participant, master]) {
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.consoleErrors.push(redact(error.message)));
  }
  await step('participant_own_database_reference', async () => {
    await participant.goto(new URL('/?auth=login', account.baseURL).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await participant.locator('#fcu-login-form [name=email]').fill(account.email);
    await participant.locator('#fcu-login-form [name=password]').fill(account.password);
    await participant.locator('#fcu-login-form [type=submit]').click();
    await participant.waitForFunction(id => window.PreditorAuth?.user?.id === id, account.userId);
    reference = { perceptions: await ownDatabaseRows('perceptions'), versions: await ownDatabaseRows('versions') };
    assert(reference.perceptions.length > 0 && reference.versions.length > reference.perceptions.length, 'Expected existing QA geometry and revision fixtures.');
    assert(reference.perceptions.every(row => row.title.startsWith(account.qaPrefix)), 'Refusing export comparison outside synthetic QA fixture titles.');
    return { perceptions: reference.perceptions.length, revisions: reference.versions.length };
  });
  await step('production_master_login_and_qa_filter', async () => {
    await master.goto(account.masterURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await master.locator('#password').fill(account.masterPassword);
    await master.locator('#loginForm button[type=submit]').click();
    await master.locator('[data-master-tab="login"]').click();
    await master.waitForFunction(id => !!document.querySelector('#logpercUserFilter option[value="' + id + '"]'), account.userId);
    await master.locator('#logpercUserFilter').selectOption(account.userId);
    await master.locator('#logpercInstitutionFilter').selectOption('');
    await master.locator('#logpercExportScope').selectOption('all');
    return { allProjectPeriod: true, filteredOwnerOnly: true };
  });
  for (const kind of ['perceptions', 'versions']) {
    await step(kind + '_api_first_page_and_safe_cursor', async () => {
      const first = await exportApi(kind);
      assert(Array.isArray(first.items), 'Missing export page items.');
      // Fixtures are intentionally smaller than a production page: no synthetic load writes.
      assert.equal(first.next_cursor, null, 'QA fixtures now exceed one page; extend harness before comparing.');
      equivalentRows(first.items, reference[kind]);
      const cursor = String(first.items[0].id);
      const continuation = await exportApi(kind, cursor);
      equivalentRows(continuation.items, reference[kind].slice(1));
      assert.equal(continuation.next_cursor, null, 'Unexpected trailing QA cursor.');
      return { rows: first.items.length, cursorContinuationRows: continuation.items.length, pageCapacity: 200 };
    });
    let geojsonPath;
    await step(kind + '_geojson_all_geometry_and_snapshot_fields', async () => {
      await master.locator('#logpercExportKind').selectOption(kind);
      geojsonPath = await download('#exportLogpercGeoJSON', 'master-qa-' + kind + '.geojson');
      const payload = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
      assert.equal(payload.type, 'FeatureCollection');
      assert.equal(payload.export_metadata.scope, 'all');
      assert.equal(payload.export_metadata.kind, kind);
      assert.equal(payload.export_metadata.count, reference[kind].length);
      assert.equal(payload.export_metadata.since, '');
      equivalentRows(payload.features.map(feature => ({ ...feature.properties, geometry: feature.geometry })), reference[kind]);
      for (const feature of payload.features) {
        const props = feature.properties;
        assert.equal(feature.id, kind === 'versions' ? props.perception_id + ':' + props.version : props.id);
        assert.equal(typeof props.full_name, 'string');
        assert.equal(typeof props.email, 'string');
        assert.equal(typeof props.institution, 'string');
      }
      return { features: payload.features.length, allSnapshotFieldsMatch: true, geometryMatchesDatabase: true };
    });
    await step(kind + '_geopackage_integrity_all_geometry_and_metadata', async () => {
      const gpkgPath = await download('#exportLogpercGeoPackage', 'master-qa-' + kind + '.gpkg');
      const validation = spawnSync(process.env.PREDITOR_PYTHON || 'python', [path.join(__dirname, 'validate-geopackage.py'), gpkgPath, geojsonPath], { encoding: 'utf8' });
      if (validation.status !== 0) throw new Error('GeoPackage validation failed: ' + validation.stderr);
      const result = JSON.parse(validation.stdout.trim());
      assert.equal(result.allSnapshotMetadataMatchesGeoJSON, true);
      return result;
    });
  }
  await step('database_unchanged_during_read_only_exports', async () => {
    equivalentRows(await ownDatabaseRows('perceptions'), reference.perceptions);
    equivalentRows(await ownDatabaseRows('versions'), reference.versions);
    return { noPerceptionOrHistoryMutations: true };
  });
  report.status = 'passed';
})().catch(error => { report.status = 'failed'; report.error = redact(error.message); process.exitCode = 1; console.error(JSON.stringify({ status: 'failed', message: report.error })); })
  .finally(async () => {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  });
