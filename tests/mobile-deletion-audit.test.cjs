// Read-only diagnostic audit: fake database and Leaflet only, no browser/network.
// Assertions document current behavior (including residual UI limitations).
// Reuses the existing reviewed DB/cache harness; production source is not edited.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));

function fakeMap() {
  return {
    children: new Set(),
    addLayer(layer) { this.children.add(layer); return this; },
    removeLayer(layer) { this.children.delete(layer); return this; },
    hasLayer(layer) { return this.children.has(layer); },
    fitBounds() {}, closePopup() {},
    getContainer() { return { style: {} }; },
    dragging: { enable() {}, disable() {} }
  };
}
function fakeLeaflet() {
  function layer(kind, coords) {
    return {
      kind, coords, children: new Set(),
      addLayer(item) { this.children.add(item); return this; },
      removeLayer(item) { this.children.delete(item); return this; },
      clearLayers() { this.children.clear(); },
      addTo(target) { target.addLayer(this); return this; },
      bindTooltip() { return this; }, bindPopup() { return this; }, on() { return this; },
      getBounds() { return {}; }, eachLayer(callback) { this.children.forEach(callback); },
      setLatLngs(value) { this.coords = value; return this; }
    };
  }
  return { layerGroup: () => layer('group'), polygon: coords => layer('polygon', coords) };
}
function fakeDocument() {
  function element() {
    const selectors = new Map();
    return { innerHTML: '', className: '', hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, remove() {}, reset() {},
      querySelector(selector) {
        if (!selectors.has(selector)) selectors.set(selector, element());
        return selectors.get(selector);
      }, querySelectorAll() { return []; }
    };
  }
  const nodes = new Map();
  return { body: element(), createElement: element, querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector === '#fcu-geometry-toolbar') return null;
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
  };
}
function polygonCount(map) {
  const count = layers => Array.from(layers).reduce((total, layer) => total + (layer.kind === 'polygon' ? 1 : count(layer.children || [])), 0);
  return count(map.children);
}

const fullSuite = fs.readFileSync(path.join(__dirname, 'perception-sync.test.cjs'), 'utf8');
let fixtureCode = fullSuite.slice(0, fullSuite.indexOf('\ntest('));
function instrument(find, replacement) {
  assert(fixtureCode.includes(find), 'Shared audit harness contract changed: ' + find.slice(0, 48));
  fixtureCode = fixtureCode.replace(find, replacement);
}
instrument('  const storage = new Map()', '  const audit = { map: fakeMap(), messages: [], timeouts: [] }; const leaflet = fakeLeaflet(); const doc = fakeDocument();\n  const storage = new Map()');
instrument('client: mockClient }, crypto: webcrypto }', 'client: mockClient }, PreditorApp: { map: audit.map }, crypto: webcrypto }');
instrument('vm.createContext({ window,', 'vm.createContext({ window, audit, confirm: () => true,');
instrument('setInterval() {}, clearInterval() {}, setTimeout,', 'setInterval() {}, clearInterval() {}, setTimeout: (fn, ms) => { audit.timeouts.push({ fn, ms }); },');
instrument('L: { layerGroup: () => ({ clearLayers() {} }) },', 'L: leaflet,');
instrument("document: { querySelector: s => /#fcu-perception-(list|history)$/.test(s) ? list : null },", 'document: doc,');
instrument('renderLayers = () => {}; renderItemsUI = () => {}; closeProfilePanel = () => {}; status = () => {};', 'renderItemsUI = () => {}; closeProfilePanel = () => {}; renderContext = () => {}; renderGrid = () => {}; status = message => audit.messages.push(message); requireLogin = () => !!ownerId();');
instrument('readAllOwned, ownerId,', 'archive, restore, card, closeEditor, renderLayers, readAllOwned, ownerId,');
instrument('visible: () => items,', `auditAttachMap: () => { map = window.PreditorApp.map; },
      auditFilterOutClass: key => { filters.classes.delete(key); renderLayers(); },
      auditStartEditingOverlay: record => { geometryEditing = true; editingId = record.id; editingRecord = clone(record); draftLayer = L.polygon(toPoints(record.geometry)).addTo(map); return draftLayer; },
      visible: () => items,`);
instrument('api.resetForAccount(USER_A);', 'api.resetForAccount(USER_A); api.auditAttachMap();');
instrument('return { api, storage, server, calls, writes, state,', 'return { api, audit, storage, server, calls, writes, state,');
const fixture = { exports: {} };
vm.runInNewContext(fixtureCode + '\nmodule.exports = { harness, perception, USER_A, ID };', {
  require, module: fixture, __dirname, console, setTimeout, URL, fakeMap, fakeLeaflet, fakeDocument
});
const { harness, perception, USER_A, ID } = fixture.exports;
const ID2 = '22222222-2222-4222-8222-222222222222';
const currentRow = extra => perception({ updated_at: '2026-09-19T10:00:00.000Z', ...extra });
const finishSync = async h => { await h.api.syncPendingItems(); await new Promise(resolve => setImmediate(resolve)); };
const copyRemoteState = (from, to) => { to.server.clear(); from.server.forEach((row, id) => to.server.set(id, copy(row))); };

test('audit: ordinary Excluir archives once online and removes the normal saved map layer', async () => {
  const h = harness({ rows: [currentRow()] }); await h.api.load({ sync: false });
  assert.equal(polygonCount(h.audit.map), 1);
  await h.api.archive(ID); await finishSync(h);
  assert.equal(h.server.get(ID).status, 'archived');
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'synced');
  assert.equal(polygonCount(h.audit.map), 0);
  assert.equal(h.writes.length, 1);
  assert(h.audit.messages.some(message => message.includes('Lixeira no dispositivo')));
});

test('audit: network failure removes only local layer; cloud and another device stay active until retry', async () => {
  const a = harness({ rows: [currentRow()] }); await a.api.load({ sync: false });
  a.intercept((query, execute) => query.operation === 'update' ? { data: null, error: { code: 'NETWORK' } } : execute());
  await a.api.archive(ID); await finishSync(a);
  assert.equal(a.api.getLocalItems()[0].status, 'archived');
  assert.equal(a.api.getLocalItems()[0]._sync_status, 'pending');
  assert.equal(polygonCount(a.audit.map), 0);
  assert.equal(a.server.get(ID).status, 'submitted');
  const b = harness({ rows: Array.from(a.server.values()) }); await b.api.load({ sync: false });
  assert.equal(polygonCount(b.audit.map), 1);
  a.intercept(null); await finishSync(a);
  assert.equal(a.server.get(ID).status, 'archived');
});

test('regression: syncNow pulls another device archive before resolving and removes its saved layer', async () => {
  const a = harness({ rows: [currentRow()] }), b = harness({ rows: [currentRow()] });
  await a.api.load({ sync: false }); await b.api.load({ sync: false });
  await a.api.archive(ID); await finishSync(a); copyRemoteState(a, b);
  const readsBefore = b.calls.length;
  const result = await b.api.syncNow();
  assert.equal(result.ok, true);
  assert(b.calls.length > readsBefore, 'The manual sync must read cloud state even without pending writes.');
  assert.equal(polygonCount(b.audit.map), 0);
  assert.equal(b.writes.length, 0);
});

test('audit: same-owner storage event followed by load removes the archived drawing in another tab', async () => {
  const a = harness({ rows: [currentRow()] }), b = harness({ rows: [currentRow()] });
  await a.api.load({ sync: false }); await b.api.load({ sync: false });
  await a.api.archive(ID); await finishSync(a); copyRemoteState(a, b);
  const key = 'preditor_fcu_local_perceptions_v4:' + USER_A;
  b.storage.set(key, a.storage.get(key));
  await b.api.load({ sync: false }); // Actual storage listener delegates here.
  assert.equal(polygonCount(b.audit.map), 0);
  assert.equal(b.api.getLocalItems()[0].status, 'archived');
  assert.equal(b.writes.length, 0);
});

test('audit: deleting one ID does not delete an overlapping drawing with another ID', async () => {
  const h = harness({ rows: [currentRow(), currentRow({ id: ID2, title: 'Overlapping distinct record' })] });
  await h.api.load({ sync: false });
  assert.equal(polygonCount(h.audit.map), 2);
  await h.api.archive(ID); await finishSync(h);
  assert.equal(h.server.get(ID).status, 'archived');
  assert.equal(h.server.get(ID2).status, 'submitted');
  assert.equal(polygonCount(h.audit.map), 1);
});

test('audit: remote archive clears saved group but preserves an in-progress editing overlay', async () => {
  const h = harness({ rows: [currentRow()] }); await h.api.load({ sync: false });
  const overlay = h.api.auditStartEditingOverlay(h.api.getLocalItems()[0]);
  assert.equal(polygonCount(h.audit.map), 2);
  h.server.set(ID, currentRow({ status: 'archived', updated_at: '2026-09-19T11:00:00Z' }));
  await h.api.load({ sync: false }); // focus/storage can call load during edit.
  assert.equal(h.api.visible().filter(row => row.status !== 'archived').length, 0);
  assert.equal(h.audit.map.hasLayer(overlay), true);
  assert.equal(polygonCount(h.audit.map), 1);
  assert.equal(h.writes.length, 0);
  h.api.closeEditor();
  assert.equal(polygonCount(h.audit.map), 0);
});

test('audit: editor toolbar closes its overlay before normal archive, leaving no visual remnant', async () => {
  const h = harness({ rows: [currentRow()] }); await h.api.load({ sync: false });
  h.api.auditStartEditingOverlay(h.api.getLocalItems()[0]);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'perception.js'), 'utf8');
  assert(appSource.includes("$('#fcu-editor-delete').onclick=async()=>{closeEditor();reset();open();await archive(record.id);}"));
  h.api.closeEditor(); await h.api.archive(ID); await finishSync(h);
  assert.equal(polygonCount(h.audit.map), 0);
  assert.equal(h.server.get(ID).status, 'archived');
});

test('audit: Ver no mapa on archived entry intentionally creates an untracked eight-second preview', async () => {
  const h = harness({ rows: [currentRow({ status: 'archived' })] }); await h.api.load({ sync: false });
  const card = h.api.card(h.api.getLocalItems()[0]);
  card.querySelector('[data-view]').onclick();
  assert.equal(polygonCount(h.audit.map), 1);
  assert.equal(h.audit.timeouts.length, 1);
  assert.equal(h.audit.timeouts[0].ms, 8000);
  await h.api.load({ sync: false });
  assert.equal(polygonCount(h.audit.map), 1, 'Normal layer refresh does not clear this temporary preview.');
  h.audit.timeouts[0].fn();
  assert.equal(polygonCount(h.audit.map), 0);
});

test('audit: filtered map preview can remain visible for eight seconds after successful Excluir', async () => {
  const h = harness({ rows: [currentRow()] }); await h.api.load({ sync: false });
  h.api.auditFilterOutClass('atencao');
  assert.equal(polygonCount(h.audit.map), 0);
  h.api.card(h.api.getLocalItems()[0]).querySelector('[data-view]').onclick();
  await h.api.archive(ID); await finishSync(h);
  assert.equal(h.server.get(ID).status, 'archived');
  assert.equal(polygonCount(h.audit.map), 1, 'Temporary layer sits outside perception group.');
  h.audit.timeouts[0].fn();
  assert.equal(polygonCount(h.audit.map), 0);
});

test('audit: temporary map preview remains until its timeout even after signing out', async () => {
  const h = harness({ rows: [currentRow({ status: 'archived' })] }); await h.api.load({ sync: false });
  h.api.card(h.api.getLocalItems()[0]).querySelector('[data-view]').onclick();
  assert.equal(polygonCount(h.audit.map), 1);
  h.api.setOwner(null);
  assert.equal(h.api.visible().length, 0);
  assert.equal(h.api.getLocalItems().length, 0);
  assert.equal(polygonCount(h.audit.map), 1, 'Preview is not owned by the cleared normal layer group.');
  h.audit.timeouts[0].fn();
  assert.equal(polygonCount(h.audit.map), 0);
});

test('audit: RLS/zero-row archive rejection is not acknowledged as cloud synchronization', async () => {
  const h = harness({ rows: [currentRow()] }); await h.api.load({ sync: false });
  h.intercept((query, execute) => query.operation === 'update' ? { data: [], error: null } : execute());
  await h.api.archive(ID); await finishSync(h);
  assert.equal(h.server.get(ID).status, 'submitted');
  assert.equal(h.api.getLocalItems()[0].status, 'archived');
  assert.equal(h.api.getLocalItems()[0]._sync_status, 'conflict');
  assert.equal(h.writes.length, 0);
  assert.equal(h.audit.messages.filter(message => /confirmad|sincronizada com|sucesso/.test(message)).length, 0);
});

test('audit: restore is explicit and only restores the selected archived record', async () => {
  const h = harness({ rows: [currentRow({ status: 'archived' }), currentRow({ id: ID2, status: 'archived' })] });
  await h.api.load({ sync: false });
  assert.equal(polygonCount(h.audit.map), 0);
  await h.api.restore(ID); await finishSync(h);
  assert.equal(h.server.get(ID).status, 'submitted');
  assert.equal(h.server.get(ID2).status, 'archived');
  assert.equal(polygonCount(h.audit.map), 1);
  assert.equal(h.writes.length, 1);
});
