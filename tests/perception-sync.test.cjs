// Focused local regression tests; never contact or mutate a live database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = '11111111-1111-4111-8111-111111111111';
const OLD_KEY = 'preditor_fcu_local_perceptions_v3';
const copy = value => JSON.parse(JSON.stringify(value));
const perception = (extra = {}) => ({
  id: ID, user_id: USER_A, title: 'Minha área', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] },
  created_at: '2026-09-19T10:00:00.000Z', target_kind: 'polygon', action_type: 'free',
  perceived_class: 'atencao', perception_types: ['atencao'], status: 'submitted',
  intensity: 4, confidence: 'alta', time_reference: 'recente', knowledge_sources: ['visita_campo'],
  field_validation: true, field_visit_date: '2026-09-18', description: 'Anotação de campo',
  model_probability: 0, ...extra
});

function harness({ rows = [], legacy, versions = [] } = {}) {
  const storage = new Map(), server = new Map(rows.map(x => [x.id, copy(x)])), calls = [], writes = [];
  if (legacy) storage.set(OLD_KEY, JSON.stringify(legacy));
  let seq = 0, interceptor = null;
  const state = { quota: false };
  const storageAPI = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => { if (state.quota) throw new Error('QuotaExceeded'); storage.set(k, v); },
    removeItem: k => storage.delete(k)
  };
  const mockClient = {
    from(table) {
      const q = { table, operation: 'select', filters: [], payload: null, single: false, range: null };
      const builder = {
        select() { return builder; },
        eq(k, v) { q.filters.push([k, v]); return builder; },
        order() { return builder; },
        range(start, end) { q.range = [start, end]; return builder; },
        maybeSingle() { q.single = true; return builder; },
        update(payload) { q.operation = 'update'; q.payload = copy(payload); return builder; },
        insert(payload) { q.operation = 'insert'; q.payload = copy(payload); return builder; },
        then(resolve, reject) {
          const execute = () => {
            let matching = (table === 'fcu_perception_versions' ? versions : [...server.values()]).filter(row => q.filters.every(([k, v]) => row[k] === v));
            if (q.operation === 'select') {
              if (q.range) matching = matching.slice(q.range[0], q.range[1] + 1);
              return { data: copy(q.single ? matching[0] || null : matching), error: null };
            }
            if (q.operation === 'insert' && server.has(q.payload.id)) return { data: null, error: { code: '23505' } };
            if (q.operation === 'update' && !matching.length) return { data: [], error: null };
            const row = { ...(server.get(q.payload.id) || {}), ...q.payload, updated_at: `2026-09-19T12:00:${String(++seq).padStart(2, '0')}.000Z` };
            server.set(row.id, copy(row)); writes.push(copy(row));
            return { data: [copy(row)], error: null };
          };
          calls.push(copy(q));
          return Promise.resolve().then(() => interceptor ? interceptor(q, execute) : execute()).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  const window = { PreditorAuth: { user: { id: USER_A, user_metadata: {} }, client: mockClient }, crypto: webcrypto };
  const list = { innerHTML: '', appendChild() {} };
  const context = vm.createContext({ window, localStorage: storageAPI, console, Uint8Array, Map, Set, Date, URL,
    setInterval() {}, clearInterval() {}, setTimeout, CSS: { escape: x => x },
    L: { layerGroup: () => ({ clearLayers() {} }) },
    document: { querySelector: s => /#fcu-perception-(list|history)$/.test(s) ? list : null },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'perception.js'), 'utf8');
  const start = source.lastIndexOf('  let tries=0;');
  assert.ok(start > 0);
  vm.runInContext(source.slice(0, start) + `
    renderLayers = () => {}; renderItemsUI = () => {}; closeProfilePanel = () => {}; status = () => {};
    globalThis.api = { getLocalItems, setLocalItems, saveLocalItem, markPending, syncSingleItemToSupabase,
      syncPendingItems, mergeHistory, load, preserveConflictCopy, perceptionPayload, resetForAccount,
      readAllOwned, ownerId, generateUUID, getSyncStatus, getQuarantinedItems, recoverQuarantinedCopy, refreshDeviceCache, stageDraft,
      visible: () => items, queue: (item, previous) => { markPending(item, previous); saveLocalItem(item); return item; },
      setOwner: id => { authOwner = id; window.PreditorAuth.user = id ? { id, user_metadata: {} } : null; resetForAccount(id); }
    };
  })();`, context);
  const api = context.api;
  api.resetForAccount(USER_A);
  return { api, storage, server, calls, writes, state, intercept: fn => { interceptor = fn; }, verifyWith: fn => { window.PreditorAuth.verifyAccount = fn; } };
}

test('legacy caches migrate only explicit owner records and remain untouched', () => {
  const legacy = [perception(), perception({ id: '22222222-2222-4222-8222-222222222222', user_id: USER_B }), perception({ id: 'unknown', user_id: null })];
  const h = harness({ legacy });
  const original = h.storage.get(OLD_KEY);
  assert.equal(h.api.getLocalItems().length, 1);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'quarantined');
  h.api.setOwner(USER_B);
  assert.equal(h.api.getLocalItems().length, 1);
  assert.equal(h.api.getLocalItems()[0].user_id, USER_B);
  h.api.setOwner(null);
  assert.equal(h.api.getLocalItems().length, 0);
  assert.equal(h.storage.get(OLD_KEY), original);
});

test('invalid legacy local IDs receive valid UUIDs with old IDs retained', () => {
  const h = harness({ legacy: [perception({ id: 'p-old-drawing' })] });
  const r = h.api.getLocalItems()[0];
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.equal(r._legacy_id, 'p-old-drawing');
  assert.equal(h.api.getLocalItems()[0].id, r.id);
});

test('storage failure is reported and never replaces a saved draft', () => {
  const h = harness();
  h.api.saveLocalItem(perception()); h.state.quota = true;
  assert.throws(() => h.api.saveLocalItem(perception({ title: 'Changed' })), /QuotaExceeded/);
  assert.equal(h.api.getLocalItems()[0].title, 'Minha área');
});

test('foreign owner cannot persist or synchronize a record', async () => {
  const h = harness();
  const other = perception({ user_id: USER_B });
  assert.throws(() => h.api.saveLocalItem(other), /owner mismatch/);
  assert.equal(await h.api.syncSingleItemToSupabase(other), false);
  assert.equal(h.calls.length, 0);
});

test('successful insert sends all survey fields and requires the returned row', async () => {
  const h = harness(), row = h.api.queue(perception());
  assert.equal(await h.api.syncSingleItemToSupabase(row), true);
  const saved = h.server.get(ID);
  assert.deepEqual(saved.knowledge_sources, ['visita_campo']);
  assert.equal(saved.model_probability, 0);
  assert.equal(saved.field_visit_date, '2026-09-18');
  assert.equal(h.api.getLocalItems()[0]._server_updated_at, saved.updated_at);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'synced');
});

test('zero-row update is conflict and never marked synchronized', async () => {
  const original = perception({ updated_at: 'version-1', _sync_status: 'synced', _server_updated_at: 'version-1' });
  const h = harness({ rows: [original] }), changed = h.api.queue(perception({ title: 'Alterada' }), original);
  h.intercept((q, execute) => q.operation === 'update' ? { data: [], error: null } : execute());
  assert.equal(await h.api.syncSingleItemToSupabase(changed), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'conflict');
  assert.equal(h.server.get(ID).title, original.title);
});

test('lost acknowledgement retries idempotently without another version', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.intercept((q, execute) => { const result = execute(); return q.operation === 'insert' ? { data: null, error: { code: 'NETWORK' } } : result; });
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'pending');
  h.intercept(null);
  assert.equal(await h.api.syncSingleItemToSupabase(h.api.getLocalItems()[0]), true);
  assert.equal(h.writes.length, 1);
});

test('duplicate ID is not acknowledged when the stored content differs', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.intercept((q, execute) => {
    if (q.operation === 'insert') h.server.set(ID, perception({ title: 'Outro dispositivo', updated_at: 'version-2' }));
    return execute();
  });
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'conflict');
  assert.equal(h.writes.length, 0);
});

test('each offline saved revision is replayed so server triggers capture history', async () => {
  const h = harness(), first = h.api.queue(perception());
  const second = h.api.queue(perception({ title: 'Segunda versão', _history: [{ title: 'Minha área' }] }), first);
  assert.equal(await h.api.syncSingleItemToSupabase(second), true);
  assert.deepEqual(h.writes.map(x => x.title), ['Minha área', 'Segunda versão']);
  assert.equal(h.api.getLocalItems()[0]._history.length, 1);
});

test('account switch during request aborts subsequent writes and UI changes', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.intercept((q, execute) => { const result = execute(); h.api.setOwner(USER_B); return result; });
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.api.visible().length, 0);
  assert.equal(h.api.getLocalItems(USER_A)[0]._sync_status, 'pending');
  assert.equal(h.api.getLocalItems(USER_B).length, 0);
});

test('new local edit while request is in flight remains pending', async () => {
  const h = harness(), first = h.api.queue(perception());
  let once = false;
  h.intercept((q, execute) => {
    if (q.operation === 'insert' && !once) {
      once = true;
      const prior = h.api.getLocalItems()[0];
      h.api.queue(perception({ title: 'Editada durante envio' }), prior);
    }
    return execute();
  });
  assert.equal(await h.api.syncSingleItemToSupabase(first), false);
  assert.equal(h.api.getLocalItems()[0].title, 'Editada durante envio');
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'pending');
  h.intercept(null);
  assert.equal(await h.api.syncSingleItemToSupabase(h.api.getLocalItems()[0]), true);
  assert.equal(h.server.get(ID).title, 'Editada durante envio');
});

test('concurrent server edit is preserved; explicit copy preserves both versions', async () => {
  const original = perception({ updated_at: 'version-1', _sync_status: 'synced', _server_updated_at: 'version-1' });
  const h = harness({ rows: [perception({ title: 'Versão remota', updated_at: 'version-2' })] });
  const local = h.api.queue(perception({ title: 'Minha edição offline' }), original);
  assert.equal(await h.api.syncSingleItemToSupabase(local), false);
  assert.equal(h.writes.length, 0);
  await h.api.preserveConflictCopy(ID);
  assert.equal(h.server.size, 2);
  assert.equal(h.server.get(ID).title, 'Versão remota');
  assert.ok([...h.server.values()].some(x => x.title === 'Minha edição offline (cópia preservada)'));
});

test('full cloud history merges with local history without dropping snapshots', async () => {
  const current = perception({ updated_at: 'version-2', _sync_status: 'synced', _server_updated_at: 'version-2' });
  const versions = [perception({ id: 1, perception_id: ID, version: 1, title: 'Anterior', recorded_at: '2026-09-18T10:00:00Z' }), perception({ id: 2, perception_id: ID, version: 2 })];
  const h = harness({ rows: [current], versions });
  h.api.saveLocalItem({ ...current, _history: [{ title: 'Rascunho offline', geometry: current.geometry }] });
  await h.api.load();
  const saved = h.api.getLocalItems()[0];
  assert.equal(saved._history.length, 1);
  assert.ok(saved._history.some(x => x.title === 'Anterior' && x.geometry));
  assert.ok(saved._retired_history.some(x => x.title === 'Rascunho offline'));
  assert.ok(h.api.getQuarantinedItems().some(x => x.title === 'Rascunho offline'));
  assert.ok(h.calls.every(q => q.filters.some(([k,v]) => k === 'user_id' && v === USER_A)));
});

test('pending draft created during cloud load is not overwritten by stale response', async () => {
  const current = perception({ updated_at: 'version-1', _sync_status: 'synced', _server_updated_at: 'version-1' });
  const h = harness({ rows: [current] });
  h.api.saveLocalItem(current);
  let changed = false;
  h.intercept((q, execute) => {
    if (q.table === 'fcu_perception_versions' && !changed) {
      changed = true;
      h.api.queue(perception({ title: 'Criada durante carregamento' }), current);
    }
    return execute();
  });
  await h.api.load();
  assert.equal(h.api.getLocalItems()[0].title, 'Criada durante carregamento');
});

test('server fetch paginates beyond the first page and filters by owner', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => perception({ id: String(i), updated_at: 'version-1' }));
  const h = harness({ rows });
  await h.api.load();
  assert.equal(h.api.getLocalItems().length, 501);
  assert.equal(h.calls.filter(q => q.table === 'fcu_perceptions').length, 2);
});

test('stale cloud load does not overwrite a write acknowledged during history fetch', async () => {
  const before = perception({ updated_at: '2026-09-19T10:00:00.000Z', _sync_status: 'synced', _server_updated_at: '2026-09-19T10:00:00.000Z' });
  const h = harness({ rows: [before] }); h.api.saveLocalItem(before);
  h.intercept((q, execute) => {
    if (q.table === 'fcu_perception_versions') {
      h.api.saveLocalItem(perception({ title: 'Confirmação mais recente', updated_at: '2026-09-19T11:00:00.000Z', _sync_status: 'synced', _server_updated_at: '2026-09-19T11:00:00.000Z' }));
    }
    return execute();
  });
  await h.api.load();
  assert.equal(h.api.getLocalItems()[0].title, 'Confirmação mais recente');
});

test('row created during load is not mistaken for a remotely deleted record', async () => {
  const h = harness(); h.api.queue(perception());
  h.intercept((q, execute) => {
    if (q.table === 'fcu_perception_versions') {
      h.api.saveLocalItem(perception({ _sync_status: 'synced', _server_updated_at: '2026-09-19T11:00:00.000Z' }));
    }
    return execute();
  });
  await h.api.load();
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'synced');
});

test('same content committed concurrently is acknowledged only after rereading it', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.intercept((q, execute) => {
    if (q.operation === 'insert') {
      h.server.set(ID, { ...q.payload, updated_at: '2026-09-19T12:00:00.000Z' });
      return { data: null, error: { code: '23505' } };
    }
    return execute();
  });
  assert.equal(await h.api.syncSingleItemToSupabase(row), true);
  assert.equal(h.calls.filter(x => x.operation === 'select').length, 2);
  assert.equal(h.writes.length, 0);
});

test('stale editor appends to latest cached queue without losing another tab revision', async () => {
  const h = harness(), openedEditor = copy(h.api.queue(perception({ title: 'Versão A' })));
  h.api.queue(perception({ title: 'Versão B de outra aba' }), openedEditor);
  const last = h.api.queue(perception({ title: 'Versão C do editor original' }), openedEditor);
  assert.equal(last._pending_versions.length, 3);
  assert.equal(await h.api.syncSingleItemToSupabase(last), true);
  assert.deepEqual(h.writes.map(x => x.title), ['Versão A', 'Versão B de outra aba', 'Versão C do editor original']);
});

test('stale editor does not adopt a newer remote concurrency baseline', async () => {
  const a = perception({ title: 'Versão A', updated_at: 'version-1', _sync_status: 'synced', _server_updated_at: 'version-1', _local_revision: 'rev-a' });
  const b = perception({ title: 'Versão B', updated_at: 'version-2', _sync_status: 'synced', _server_updated_at: 'version-2', _local_revision: 'rev-b' });
  const h = harness({ rows: [b] }); h.api.saveLocalItem(b);
  const c = h.api.queue(perception({ title: 'Versão C do editor antigo' }), a);
  assert.equal(c._server_updated_at, 'version-1');
  assert.equal(await h.api.syncSingleItemToSupabase(c), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'conflict');
  assert.equal(h.server.get(ID).title, 'Versão B');
});

test('equivalent local and cloud versions merge once and count follows server', async () => {
  const old = { version: 1, title: 'Antes', perceived_class: 'atencao', geometry: perception().geometry, description: 'Texto anterior', updated_at: '2026-09-18T10:00:00Z' };
  const current = perception({ _sync_status: 'synced', _server_updated_at: 'version-2', updated_at: 'version-2', version_count: 3, _history: [old] });
  const versions = [perception({ ...old, id: 1, perception_id: ID, recorded_at: old.updated_at }), perception({ id: 2, perception_id: ID, version: 2 })];
  const h = harness({ rows: [current], versions }); h.api.saveLocalItem(current);
  await h.api.load();
  const r = h.api.getLocalItems()[0];
  assert.equal(r._history.length, 1);
  assert.equal(r._history[0]._source, 'server');
  assert.equal(r.version_count, 2);
  assert.equal(r._server_version_count, 2);
});

test('different offline geometry or survey snapshots at same version remain preserved', () => {
  const h = harness();
  const first = perception({ version: 1, _source: 'server' });
  const alteredSurvey = perception({ version: 1, knowledge_sources: ['relato_moradores'] });
  const alteredGeometry = perception({ version: 1, geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,0]]] } });
  const merged = h.api.mergeHistory([first, alteredSurvey, alteredGeometry]);
  assert.equal(merged.length, 3);
});

test('acknowledging an already-counted cloud version does not increment it again', async () => {
  const saved = perception({ updated_at: '2026-09-19T12:00:00.000Z' });
  const h = harness({ rows: [saved] });
  const pending = h.api.queue(perception());
  pending._server_version_count = 1;
  pending._server_count_updated_at = saved.updated_at;
  pending.version_count = 2;
  h.api.saveLocalItem(pending);
  assert.equal(await h.api.syncSingleItemToSupabase(pending), true);
  assert.equal(h.api.getLocalItems()[0].version_count, 1);
  assert.equal(h.writes.length, 0);
});

test('read-only mobile status does not migrate cache or claim an initial cloud load', () => {
  const h = harness({ legacy: [perception()] });
  const keys = h.storage.size;
  const state = h.api.getSyncStatus();
  assert.equal(state.lastLoadedAt, null);
  assert.equal(state.cloudAvailable, null);
  assert.equal(state.total, 0);
  assert.equal(h.storage.size, keys);
  assert.equal(Object.hasOwn(state, 'geometry'), false);
});

test('unavailable account verification preserves synced cache without treating empty RLS as deletion', async () => {
  const h = harness();
  h.api.saveLocalItem(perception({ _sync_status: 'synced', _server_updated_at: '2026-09-19T10:00:00Z' }));
  h.verifyWith(async () => null);
  await h.api.load();
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'synced');
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.getSyncStatus().cloudAvailable, false);
  assert.equal(h.api.getSyncStatus().lastLoadedAt, null);
});

test('denied or unavailable account verification does not drain pending revisions', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.verifyWith(async () => false);
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'pending');
  assert.equal(h.api.getLocalItems()[0]._pending_versions.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.length, 0);
});

const baselineRow = extra => perception({ updated_at: '2026-09-19T10:00:00.000Z', _server_updated_at: '2026-09-19T10:00:00.000Z', _sync_status: 'synced', ...extra });

test('cloud deletion quarantines old synced cache without showing or re-inserting it', async () => {
  const h = harness(); h.api.saveLocalItem(baselineRow());
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, true);
  assert.equal(h.api.visible().length, 0);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'quarantined');
  assert.equal(h.api.getSyncStatus().quarantined, 1);
  await h.api.syncPendingItems();
  assert.equal(h.writes.length, 0);
});

test('legacy synced and pending records never auto-insert after remote cleanup', async () => {
  for (const state of ['synced', 'pending']) {
    const legacy = perception({ _sync_status: state, updated_at: '2026-09-14T10:00:00Z' });
    const h = harness({ legacy: [legacy] });
    const old = h.storage.get(OLD_KEY);
    await h.api.load();
    await h.api.syncPendingItems();
    assert.equal(h.writes.length, 0);
    assert.equal(h.api.visible().length, 0);
    assert.equal(h.api.getQuarantinedItems().length, 1);
    assert.equal(h.storage.get(OLD_KEY), old);
  }
});

test('legacy cache exactly acknowledged by cloud reconciles with no write', async () => {
  const h = harness({ legacy: [perception({ _sync_status: 'synced' })], rows: [perception({ updated_at: '2026-09-19T10:00:00Z' })] });
  await h.api.refreshDeviceCache();
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'synced');
  assert.equal(h.api.visible().length, 1);
  assert.equal(h.api.getQuarantinedItems().length, 0);
  assert.equal(h.writes.length, 0);
});

test('ambiguous v4 pending queue is retained in recovery instead of assuming new provenance', async () => {
  const h = harness();
  h.api.saveLocalItem(perception({ _sync_status: 'pending', _pending_versions: [{ revision: 'old-local-revision', payload: perception() }] }));
  await h.api.syncPendingItems();
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'quarantined');
  assert.equal(h.api.getLocalItems()[0]._pending_versions.length, 1);
  assert.equal(h.writes.length, 0);
});

test('new local provenance retains automatic retry after transient insert failure', async () => {
  const h = harness(), created = h.api.queue(perception());
  h.intercept(q => ({ data: q.operation === 'select' ? null : null, error: q.operation === 'select' ? null : { code: 'NETWORK' } }));
  assert.equal(await h.api.syncSingleItemToSupabase(created), false);
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'pending');
  h.intercept(null);
  assert.equal(await h.api.syncSingleItemToSupabase(h.api.getLocalItems()[0]), true);
  assert.equal(h.writes.length, 1);
});

test('only explicit tombstone rejection quarantines an otherwise new draft', async () => {
  const h = harness(), row = h.api.queue(perception());
  h.intercept((q, execute) => q.operation === 'insert' ? { data: null, error: { code: 'P0001', message: 'Esta área foi removida. Atualize os dados deste aparelho.' } } : execute());
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  assert.equal(h.api.getLocalItems()[0]._quarantine_reason, 'remote-removed');
  assert.equal(h.api.getLocalItems()[0]._pending_versions.length, 1);
  assert.equal(h.writes.length, 0);
  const other = harness(), otherRow = other.api.queue(perception());
  other.intercept((q, execute) => q.operation === 'insert' ? { data: null, error: { code: 'P0001', message: 'Temporary unrelated validation failure' } } : execute());
  await other.api.syncSingleItemToSupabase(otherRow);
  assert.equal(other.api.getLocalItems()[0]._sync_status, 'pending');
});

test('explicit recovery creates one new pending UUID, retains original and is idempotent', async () => {
  const h = harness({ legacy: [perception({ _sync_status: 'synced' })] });
  const entry = h.api.getQuarantinedItems()[0];
  const result = await h.api.recoverQuarantinedCopy(entry.id);
  assert.equal(result.ok, true);
  assert.notEqual(result.id, ID);
  assert.equal(h.writes.length, 0, 'Recovery itself must not send data.');
  assert.equal(h.api.getLocalItems().length, 2);
  const again = await h.api.recoverQuarantinedCopy(entry.id);
  assert.equal(again.alreadyRecovered, true);
  assert.equal(again.id, result.id);
  assert.equal(h.api.getQuarantinedItems()[0].recoveredId, result.id);
  assert.equal(h.api.getSyncStatus().quarantined, 0);
  await h.api.syncPendingItems();
  assert.equal(h.server.size, 1);
  assert.equal(h.server.has(ID), false);
  assert.equal(h.server.has(result.id), true);
});

test('remote archive is authoritative while offline revisions remain recoverable separately', async () => {
  const server = perception({ status: 'archived', updated_at: '2026-09-19T11:00:00Z' });
  const h = harness({ rows: [server] });
  const first = h.api.queue(perception({ title: 'Offline revision 1' }), baselineRow());
  h.api.queue(perception({ title: 'Offline revision 2' }), first);
  await h.api.refreshDeviceCache();
  const stored = h.api.getLocalItems()[0];
  assert.equal(stored.status, 'archived');
  assert.equal(stored._sync_status, 'synced');
  assert.equal(stored._quarantined_copies[0].snapshot._pending_versions.length, 2);
  assert.equal(h.api.getQuarantinedItems().length, 1);
  assert.equal(h.api.visible().filter(x => x.status !== 'archived').length, 0);
  assert.equal(h.writes.length, 0);
  const restored = await h.api.recoverQuarantinedCopy(h.api.getQuarantinedItems()[0].id);
  const copy = h.api.getLocalItems().find(row => row.id === restored.id);
  assert.equal(copy._pending_versions.length, 2);
  await h.api.syncPendingItems();
  assert.deepEqual(h.writes.map(row => row.title), ['Offline revision 1 (cópia recuperada)', 'Offline revision 2 (cópia recuperada)']);
  assert.equal(h.server.get(ID).status, 'archived');
});

test('confirmed history follows successful complete server snapshot, preserving retired backup', async () => {
  const current = baselineRow({ version_count: 3, _server_version_count: 3 });
  const old = { version: 1, title: 'Removed server history', _source: 'server', geometry: current.geometry };
  const h = harness({ rows: [current], versions: [] });
  h.api.saveLocalItem({ ...current, _history: [old] });
  await h.api.refreshDeviceCache();
  assert.equal(h.api.getLocalItems()[0]._history.length, 0);
  assert.equal(h.api.getLocalItems()[0]._retired_history.length, 1);
  assert.equal(h.api.getLocalItems()[0].version_count, 1);
  await h.api.refreshDeviceCache();
  assert.equal(h.api.getLocalItems()[0]._retired_history.length, 1);
});

test('history fetch failure preserves confirmed and local snapshots exactly', async () => {
  const current = baselineRow({ version_count: 2, _server_version_count: 2 });
  const old = { version: 1, title: 'Keep on error', _source: 'server', geometry: current.geometry };
  const h = harness({ rows: [current] }); h.api.saveLocalItem({ ...current, _history: [old] });
  h.intercept((q, execute) => q.table === 'fcu_perception_versions' ? { data: null, error: { code: 'NETWORK' } } : execute());
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'partial-history');
  assert.equal(h.api.getLocalItems()[0]._history.length, 1);
  assert.equal(h.api.getLocalItems()[0].version_count, 2);
  assert.equal(h.api.getQuarantinedItems().length, 0);
});

test('unrecognized legacy history is recoverable but is not confirmed history or duplicated on reload', async () => {
  const current = baselineRow();
  const h = harness({ rows: [current] });
  h.api.saveLocalItem({ ...current, _history: [{ version: 1, title: 'Unsure offline snapshot', geometry: current.geometry }] });
  await h.api.refreshDeviceCache(); await h.api.refreshDeviceCache();
  assert.equal(h.api.getLocalItems()[0]._history.length, 0);
  assert.equal(h.api.getQuarantinedItems().length, 1);
  const copy = await h.api.recoverQuarantinedCopy(h.api.getQuarantinedItems()[0].id);
  assert.equal(copy.ok, true);
  assert.equal(h.writes.length, 0);
});

test('first online refresh never exposes synced cache while awaiting server verification', async () => {
  const h = harness(); h.api.saveLocalItem(baselineRow());
  let release, started;
  const reached = new Promise(resolve => { started = resolve; });
  h.intercept((q, execute) => {
    if (q.table === 'fcu_perceptions') { started(); return new Promise(resolve => { release = () => resolve(execute()); }); }
    return execute();
  });
  const loading = h.api.refreshDeviceCache(); await reached;
  assert.equal(h.api.visible().length, 0);
  assert.equal(h.api.getSyncStatus().checking, true);
  release(); await loading;
  assert.equal(h.api.getSyncStatus().checking, false);
});

test('safe device refresh performs reads only and preserves new pending revisions and other owner/preferences/auth', async () => {
  const h = harness(); const row = h.api.queue(perception());
  h.storage.set('preditor_fcu_local_perceptions_v4:' + USER_B, 'other-owner-backup');
  h.storage.set('sb-auth-token', 'private-auth-placeholder');
  h.storage.set('map-preferences', '{"zoom":12}');
  h.intercept((q, execute) => { h.api.syncPendingItems(); return execute(); });
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, true);
  assert.equal(h.calls.every(q => q.operation === 'select'), true);
  assert.equal(h.writes.length, 0);
  assert.equal(h.api.getLocalItems()[0]._pending_versions[0].revision, row._pending_versions[0].revision);
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_B), 'other-owner-backup');
  assert.equal(h.storage.get('sb-auth-token'), 'private-auth-placeholder');
  assert.equal(h.storage.get('map-preferences'), '{"zoom":12}');
});

test('read failure leaves confirmed cache and pending queue intact without optimistic deletion', async () => {
  const h = harness(); h.api.saveLocalItem(baselineRow());
  const before = h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A);
  h.intercept(() => ({ data: null, error: { code: 'NETWORK' } }));
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, false);
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A), before);
  assert.equal(h.api.getQuarantinedItems().length, 0);
  assert.equal(h.api.visible().length, 1, 'Known offline cache remains available, explicitly not refreshed.');
});

test('storage quota prevents recovery atomically without losing original or recording false recovery', async () => {
  const h = harness({ legacy: [perception()] }); const entry = h.api.getQuarantinedItems()[0];
  const before = h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A);
  h.state.quota = true;
  const recovered = await h.api.recoverQuarantinedCopy(entry.id);
  assert.equal(recovered.ok, false);
  assert.equal(recovered.reason, 'storage-unavailable');
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A), before);
  assert.equal(h.api.getQuarantinedItems()[0].recoveredId, null);
  assert.equal(h.writes.length, 0);
});

test('quota during refresh never erases old cache or declares cloud reconciliation complete', async () => {
  const h = harness(); h.api.saveLocalItem(baselineRow());
  const before = h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A); h.state.quota = true;
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'storage-unavailable');
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A), before);
  assert.equal(h.api.getSyncStatus().lastLoadedAt, null);
  assert.equal(h.writes.length, 0);
});

test('account switch during refresh never merges or discloses previous owner recovery', async () => {
  const h = harness({ legacy: [perception()] }); h.api.getLocalItems();
  const before = h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A);
  h.intercept((q, execute) => { const result = execute(); h.api.setOwner(USER_B); return result; });
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'account-changed');
  assert.equal(h.api.getQuarantinedItems().length, 0);
  assert.equal((await h.api.recoverQuarantinedCopy(ID)).ok, false);
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A), before);
  assert.equal(h.writes.length, 0);
});

test('confirmed remote archive replaces unchanged local data without writes', async () => {
  const h = harness({ rows: [perception({ status: 'archived', updated_at: '2026-09-19T11:00:00Z' })] });
  h.api.saveLocalItem(baselineRow());
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, true);
  assert.equal(h.api.visible().filter(row => row.status !== 'archived').length, 0);
  assert.equal(h.api.getLocalItems()[0].status, 'archived');
  assert.equal(h.api.getQuarantinedItems().length, 0);
  assert.equal(h.writes.length, 0);
});

test('offline update to now deleted cloud row stays recoverable and never re-inserts old UUID', async () => {
  const h = harness();
  const queued = h.api.queue(perception({ title: 'Offline field edit' }), baselineRow());
  await h.api.syncSingleItemToSupabase(queued);
  const stored = h.api.getLocalItems()[0];
  assert.equal(stored._sync_status, 'quarantined');
  assert.equal(stored._pending_versions.length, 1);
  assert.equal(h.api.getQuarantinedItems().length, 1);
  assert.equal(h.api.visible().length, 0);
  assert.equal(h.writes.length, 0);
});

test('refresh while a write is running returns busy instead of racing the in-flight mutation', async () => {
  const h = harness(), draft = h.api.queue(perception());
  let release, started;
  const reached = new Promise(resolve => { started = resolve; });
  h.intercept((q, execute) => {
    if (q.operation === 'insert') { started(); return new Promise(resolve => { release = () => resolve(execute()); }); }
    return execute();
  });
  const saving = h.api.syncSingleItemToSupabase(draft); await reached;
  const result = await h.api.refreshDeviceCache();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'busy');
  release(); await saving;
  assert.equal(h.writes.length, 1);
});

test('editor opened before remote cleanup fails gracefully without overwriting the recovery snapshot', async () => {
  const h = harness(); const editor = baselineRow(); h.api.saveLocalItem(editor);
  await h.api.refreshDeviceCache();
  const before = h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A);
  assert.equal(h.api.stageDraft(perception({ title: 'Still open unsaved form' }), editor), false);
  assert.equal(h.storage.get('preditor_fcu_local_perceptions_v4:' + USER_A), before);
  assert.equal(h.api.getQuarantinedItems().length, 1);
});

test('stale acknowledgement cannot turn a concurrently archived snapshot into pending data', async () => {
  const online = perception({ title: 'Already committed local revision', updated_at: '2026-09-19T11:00:00Z' });
  const h = harness({ rows: [online] });
  const row = h.api.queue(perception({ title: online.title }), baselineRow());
  let once = false;
  h.intercept(async (q, execute) => {
    const response = execute();
    if (q.table === 'fcu_perceptions' && q.single && !once) {
      once = true;
      h.server.set(ID, { ...online, status: 'archived', updated_at: '2026-09-19T12:00:00Z' });
      await h.api.load({ sync: false });
    }
    return response;
  });
  assert.equal(await h.api.syncSingleItemToSupabase(row), false);
  const current = h.api.getLocalItems()[0];
  assert.equal(current.status, 'archived');
  assert.equal(current._sync_status, 'synced');
  assert.equal(current._pending_versions.length, 0);
  assert.equal(h.api.getQuarantinedItems().length, 1);
  assert.equal(h.writes.length, 0);
});
