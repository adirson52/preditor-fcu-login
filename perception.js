(function () {
  'use strict';

  const COLOR = {
    atencao_prioritaria: '#d62828',
    atencao: '#d97706',
    demais_areas: '#15803d',
    outro: '#64748b'
  };

  const LABEL = {
    atencao_prioritaria: 'Atenção Prioritária',
    atencao: 'Atenção',
    demais_areas: 'Demais Áreas',
    outro: 'Outro'
  };

  const ACTION = {
    confirm: 'Confirmação',
    reclassify: 'Reclassificação',
    free: 'Desenho livre'
  };

  const CLASS_KEYS = ['atencao_prioritaria', 'atencao', 'demais_areas', 'outro'];
  const LAB_MODE = false;
  const LOCAL_STORAGE_KEY = 'preditor_fcu_local_perceptions_v4:';
  const LEGACY_STORAGE_KEYS = ['preditor_fcu_local_perceptions_v3', 'preditor_fcu_local_perceptions_v2', 'preditor_fcu_local_perceptions_v1', 'fcu_perceptions_v1'];
  // Keep old caches intact: only records with an explicit matching owner migrate.
  let accountEpoch = 0, loadedOwner = null, loadSequence = 0, authOwner;
  const syncingItems = new Map();
  const syncingOwners = new Set();

  let map = null, db = null, drawing = false, dragging = false, geometryEditing = false, gridMode = false;
  let points = [], originalPoints = [], selectedVertex = -1, draft = null, editingId = null, editingRecord = null;
  let drawingMode = 'vertices', drawingZoom = 13, ptrDownPos = null;
  let items = [], lastCell = '', explicitCellClick = false;

  const filters = { visible: true, classes: new Set(CLASS_KEYS), actions: new Set(Object.keys(ACTION)) };

  const layers = L.layerGroup();
  const editHandles = L.layerGroup();
  const gridCells = new Map();
  const gridLayer = L.layerGroup();
  const layerById = new Map();
  let draftLayer = null;

  function $(s){return document.querySelector(s);}
  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);}
  function user(){return window.PreditorAuth && window.PreditorAuth.user;}
  function app(){return window.PreditorApp || window.App || {};}
  function sample(){
    const a = app();
    return a.currentSample || a.selectedSample || a.activeSample || a.sample || a.currentCell || (window.App && (window.App.selectedSample || window.App.currentSample)) || null;
  }

  function client(){ return (window.PreditorAuth && window.PreditorAuth.client) || db || null; }

  function makeElementDraggable(el, handle) {
    if (!el) return;
    const dragTarget = handle || el;
    dragTarget.style.cursor = 'grab';

    let isDraggingBar = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    const onPointerDown = (e) => {
      if (e.target.closest('button, input, select, textarea, a')) return;
      isDraggingBar = true;
      startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      startY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      el.style.left = initialLeft + 'px';
      el.style.top = initialTop + 'px';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      dragTarget.style.cursor = 'grabbing';

      if (e.stopPropagation) e.stopPropagation();
    };

    const onPointerMove = (e) => {
      if (!isDraggingBar) return;
      const currentX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const currentY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      const dx = currentX - startX;
      const dy = currentY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const maxLeft = window.innerWidth - el.offsetWidth;
      const maxTop = window.innerHeight - el.offsetHeight;

      newLeft = Math.max(8, Math.min(maxLeft - 8, newLeft));
      newTop = Math.max(8, Math.min(maxTop - 8, newTop));

      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';

      if (e.preventDefault) e.preventDefault();
    };

    const onPointerUp = () => {
      if (isDraggingBar) {
        isDraggingBar = false;
        dragTarget.style.cursor = 'grab';
      }
    };

    dragTarget.addEventListener('mousedown', onPointerDown);
    dragTarget.addEventListener('touchstart', onPointerDown, { passive: false });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: false });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
  }

  // The database owns authorization and online history. This cache keeps each
  // participant's offline work until a returned server row acknowledges it.
  function ownerId() { return authOwner !== undefined ? authOwner : user() && user().id || null; }
  function owns(record, id = ownerId()) { return !!(id && record && record.user_id === id); }
  function sameAccount(id, epoch) { return ownerId() === id && accountEpoch === epoch; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function cacheKey(id) { return LOCAL_STORAGE_KEY + id; }
  function getLocalItems(id = ownerId()) {
    if (!id) return [];
    const raw = localStorage.getItem(cacheKey(id));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Invalid perception cache');
      return parsed.items.filter(x => owns(x, id));
    }
    const migrated = new Map();
    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      let list;
      try { list = JSON.parse(legacy); } catch (_) { continue; }
      if (!Array.isArray(list)) continue;
      list.filter(x => owns(x, id) && x.id).forEach(x => {
        if (migrated.has(x.id)) return;
        // Earlier versions could label a zero-row update as synced. Verify it.
        const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.id);
        migrated.set(x.id, { ...x, id: validId ? x.id : generateUUID(), ...(validId ? {} : { _legacy_id: x.id }), _sync_status: 'pending', _legacy_import: true });
      });
    }
    const list = Array.from(migrated.values());
    setLocalItems(list, id);
    return list;
  }
  function setLocalItems(list, id = ownerId()) {
    if (!id || list.some(x => !owns(x, id))) throw new Error('Perception owner mismatch');
    localStorage.setItem(cacheKey(id), JSON.stringify({ schema: 4, items: list }));
  }
  function saveLocalItem(item, id = ownerId()) {
    if (!owns(item, id)) throw new Error('Perception owner mismatch');
    const list = getLocalItems(id);
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.unshift(item);
    setLocalItems(list, id);
    return list;
  }
  function persistDraft(item) {
    try { saveLocalItem(item); return true; }
    catch (_) {
      status('Não foi possível salvar neste navegador. Libere espaço ou permita o armazenamento. O desenho continua aberto; não feche a página.', true, '#fcu-form-status');
      status('Armazenamento indisponível. O desenho ainda não foi salvo; não feche a página.', true);
      return false;
    }
  }
  function perceptionPayload(item) {
    return {
      id: item.id, user_id: item.user_id,
      title: item.title || `Percepção #${item.id.slice(0, 6)}`,
      target_kind: item.target_kind || 'polygon', action_type: item.action_type || 'free',
      perceived_class: item.perceived_class || 'atencao_prioritaria',
      perception_types: item.perception_types || [item.perceived_class || 'atencao_prioritaria'],
      area_id: item.area_id || null, cell_id: item.cell_id || null,
      model_class: item.model_class || null, model_probability: item.model_probability ?? null,
      model_snapshot: item.model_snapshot || {}, geometry_source: item.geometry_source || 'user_polygon',
      geometry: item.geometry, intensity: item.intensity ?? 3,
      confidence: item.confidence || 'media', time_reference: item.time_reference || 'atual',
      knowledge_sources: item.knowledge_sources || ['nao_informado'],
      field_validation: !!item.field_validation, field_visit_date: item.field_visit_date || null,
      description: item.description || '', status: item.status || 'submitted', created_at: item.created_at
    };
  }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
    return value;
  }
  function samePayload(a, b) {
    const left = perceptionPayload(a), right = perceptionPayload(b);
    // PostgreSQL may return the same timestamp with different timezone syntax.
    delete left.created_at; delete right.created_at;
    return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
  }
  function pendingOperations(item) {
    return item._pending_versions && item._pending_versions.length ? item._pending_versions :
      [{ revision: item._local_revision || 'legacy', payload: perceptionPayload(item) }];
  }
  function markPending(item, previous) {
    // The editor's snapshot supplies the optimistic concurrency baseline, but
    // the current persistent cache owns the queue (another tab may have saved).
    const cached = getLocalItems(item.user_id).find(x => x.id === item.id);
    const latest = cached || previous;
    const queued = latest && latest._sync_status !== 'synced' ? pendingOperations(latest) : [];
    const editorRevisionIsCurrent = latest && previous && latest._local_revision === previous._local_revision && samePayload(latest, previous);
    const editorRevisionStillQueued = previous && previous._local_revision && queued.some(op => op.revision === previous._local_revision);
    const baseline = editorRevisionIsCurrent || editorRevisionStillQueued ? latest : previous;
    item._local_revision = generateUUID();
    item._pending_versions = clone(queued).concat([{ revision: item._local_revision, payload: perceptionPayload(item) }]);
    item._server_updated_at = baseline && baseline._server_updated_at || null;
    item._server_version_count = latest && latest._server_version_count || 0;
    item.version_count = Math.max((latest && latest.version_count || 0) + 1, item._server_version_count + item._pending_versions.length);
    item._history = mergeHistory(latest && latest._history || [], item._history || []);
    item._sync_status = latest && latest._sync_status === 'conflict' || previous && previous._sync_status === 'conflict' ? 'conflict' : 'pending';
    if (latest && latest._conflict) item._conflict = latest._conflict;
    return item;
  }
  function mergeHistory(...lists) {
    const history = new Map();
    lists.flat().filter(Boolean).forEach(h => {
      // Equivalent numbered snapshots can be seen first locally and then in
      // the server history. Different geometries at the same version stay.
      const contentFields = ['title', 'perceived_class', 'perception_types', 'geometry', 'description', 'status', 'intensity', 'confidence',
        'time_reference', 'knowledge_sources', 'field_validation', 'field_visit_date', 'model_probability', 'model_snapshot', 'cell_id', 'action_type', 'geometry_source'];
      const matching = h.version == null ? null : Array.from(history.entries()).find(([, existing]) =>
        existing.version === h.version && contentFields.every(field => {
          if (existing[field] === undefined || h[field] === undefined) return true;
          const left = field === 'description' ? existing[field] || '' : existing[field];
          const right = field === 'description' ? h[field] || '' : h[field];
          return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
        }));
      const key = matching ? matching[0] : JSON.stringify(stable(h));
      const existing = history.get(key);
      if (!existing) history.set(key, h);
      else if (h._source === 'server') history.set(key, { ...existing, ...h });
      else history.set(key, { ...h, ...existing });
    });
    return Array.from(history.values()).sort((a, b) => new Date(a.updated_at || a.recorded_at || 0) - new Date(b.updated_at || b.recorded_at || 0));
  }
  function refreshCachedUI(id) {
    if (ownerId() !== id) return;
    items = getLocalItems(id);
    renderLayers();
    renderItemsUI();
  }
  function markConflict(item, server, id) {
    const current = getLocalItems(id).find(x => x.id === item.id);
    if (!current) return;
    saveLocalItem({ ...current, _sync_status: 'conflict', _conflict: server || null }, id);
    refreshCachedUI(id);
  }
  async function syncPendingItems() {
    const id = ownerId(), epoch = accountEpoch;
    if (!client() || !id || syncingOwners.has(id)) return;
    syncingOwners.add(id);
    try {
      for (const item of getLocalItems(id).filter(x => x._sync_status === 'pending')) {
        if (!sameAccount(id, epoch)) break;
        await syncSingleItemToSupabase(item);
      }
    } catch (_) { status('Não foi possível ler os desenhos locais. Eles não foram apagados.', true); }
    finally { syncingOwners.delete(id); }
  }
  async function syncSingleItemToSupabase(item) {
    const id = ownerId(), epoch = accountEpoch, c = client();
    if (!c || !owns(item, id) || item._sync_status === 'conflict') return false;
    const lock = id + ':' + item.id;
    if (syncingItems.has(lock)) return syncingItems.get(lock);
    const work = (async () => {
      try {
        let current = getLocalItems(id).find(x => x.id === item.id);
        if (!current) return false;
        // A fixed batch permits new local edits during an in-flight request.
        const operations = clone(pendingOperations(current));
        for (const op of operations) {
          if (!sameAccount(id, epoch)) return false;
          current = getLocalItems(id).find(x => x.id === item.id);
          if (!current || current._sync_status === 'conflict') return false;
          if (!pendingOperations(current).some(x => x.revision === op.revision)) continue;
          const read = await c.from('fcu_perceptions').select('*').eq('id', item.id).eq('user_id', id).maybeSingle();
          if (!sameAccount(id, epoch) || read.error) return false;
          let server = read.data;
          if (server && !owns(server, id)) return false;
          if (server && samePayload(server, op.payload)) {
            // Handles a response lost after a successful commit, without duplicates.
          } else {
            if ((server && (!current._server_updated_at || server.updated_at !== current._server_updated_at)) ||
                (!server && current._server_updated_at)) {
              markConflict(current, server, id);
              return false;
            }
            let write = server ? c.from('fcu_perceptions').update(op.payload).eq('id', item.id).eq('user_id', id).eq('updated_at', current._server_updated_at) :
              c.from('fcu_perceptions').insert(op.payload);
            const result = await write.select('*');
            if (!sameAccount(id, epoch)) return false;
            if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
              if (!result.error || result.error.code === '23505') {
                const latest = await c.from('fcu_perceptions').select('*').eq('id', item.id).eq('user_id', id).maybeSingle();
                if (!sameAccount(id, epoch) || latest.error) return false;
                if (latest.data && owns(latest.data, id) && samePayload(latest.data, op.payload)) server = latest.data;
                else { markConflict(current, latest.data, id); return false; }
              } else return false;
            } else server = result.data[0];
          }
          if (!server || server.id !== item.id || !owns(server, id) || !server.updated_at || !samePayload(server, op.payload)) return false;
          current = getLocalItems(id).find(x => x.id === item.id);
          if (!current) return false;
          const remaining = pendingOperations(current).filter(x => x.revision !== op.revision);
          const acknowledged = {
            ...(remaining.length ? current : { ...current, ...server }),
            _server_updated_at: server.updated_at, _pending_versions: remaining,
            _sync_status: remaining.length ? 'pending' : 'synced', _conflict: null,
            _server_version_count: (current._server_version_count || 0) + 1
          };
          saveLocalItem(acknowledged, id);
        }
        if (!sameAccount(id, epoch)) return false;
        refreshCachedUI(id);
        return getLocalItems(id).find(x => x.id === item.id)?._sync_status === 'synced';
      } catch (_) {
        // Never downgrade payloads or acknowledge failed / zero-row writes.
        return false;
      }
    })();
    syncingItems.set(lock, work);
    try { return await work; }
    finally { syncingItems.delete(lock); }
  }

  function updateListBadges() {
    items.filter(r => owns(r)).forEach(r => {
      const cardEl = document.querySelector(`article[data-id="${CSS.escape(r.id)}"]`);
      if (cardEl) {
        const badge = cardEl.querySelector('.fcu-sync-badge');
        if (badge) {
          if (r._sync_status === 'pending') {
            badge.className = 'fcu-sync-badge is-local fcu-sync-clickable';
            badge.title = 'Toque para sincronizar com o servidor agora';
            badge.innerHTML = '⚡ No dispositivo <small style="font-weight:700;">(Sincronizar 🔄)</small>';
            badge.onclick = async (e) => {
              e.stopPropagation();
              badge.textContent = '⏳ Sincronizando...';
              const ok = await syncSingleItemToSupabase(r);
              if (ok) {
                status('✓ Percepção sincronizada com o servidor!');
              } else {
                status('Tentando reconectar... Seus dados continuam salvos no dispositivo.', true);
                updateListBadges();
              }
            };
          } else if (r._sync_status === 'synced') {
            badge.className = 'fcu-sync-badge is-synced';
            badge.title = 'Sincronizado com o servidor';
            badge.textContent = '✓ Sincronizado';
            badge.onclick = null;
          } else {
            badge.className = 'fcu-sync-badge is-local';
            badge.textContent = r._sync_status === 'conflict' ? 'Versões diferentes · revisar' : 'No dispositivo';
            badge.onclick = null;
          }
        }
      }
    });
  }

  function status(t,e,target='#fcu-perception-status'){const n=$(target);if(n){n.textContent=t||'';n.classList.toggle('is-error',!!e);}}

  function bindCloseEvents() {
    document.querySelectorAll('.fcu-perception-close').forEach(b => {
      const handleClose = (e) => {
        if (e) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
        }
        close();
      };
      b.onclick = handleClose;
      b.ontouchstart = handleClose;
      b.onpointerdown = handleClose;
    });

    const shade = $('#fcu-perception-shade');
    if (shade) {
      const handleShade = (e) => {
        if (e) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
        }
        close();
      };
      shade.onclick = handleShade;
      shade.ontouchstart = handleShade;
    }
  }

  function notifyCellSelected(s) {
    if (s) explicitCellClick = true;
    else explicitCellClick = false;
  }

  function open(forCell = false){
    if (forCell) explicitCellClick = true;
    closeProfilePanel();
    document.body.classList.add('fcu-perception-open');
    $('#fcu-perception-panel').classList.add('is-open');
    $('#fcu-perception-shade').classList.add('is-open');
    bindCloseEvents();
    renderContext();
    syncPendingItems();
  }

  function close(){
    document.body.classList.remove('fcu-perception-open');
    $('#fcu-perception-panel').classList.remove('is-open');
    $('#fcu-perception-shade').classList.remove('is-open');
  }
  
  function openProfilePanel(){
    if (!requireLogin()) return;
    close();
    document.body.classList.add('fcu-account-open');
    $('#fcu-account-page').classList.add('is-open');
    renderUserProfileTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function closeProfilePanel(){
    document.body.classList.remove('fcu-account-open');
    $('#fcu-account-page').classList.remove('is-open');
  }

  function generateUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (_) {}
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function classOf(s){let k=null;try{const fn=window.PreditorModel&&window.PreditorModel.samplePriorityKey;if(typeof fn==='function')k=fn(s);}catch(_){ }return {priority:'atencao_prioritaria',attention:'atencao',other:'demais_areas'}[k]||null;}
  function cellGeometry(s){const lat=Number(s.lat),lng=Number(s.lng),half=Number(s.res_m||50)/2;if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;const dy=half/111320,dx=half/(111320*Math.max(.2,Math.cos(lat*Math.PI/180)));return {type:'Polygon',coordinates:[[[lng-dx,lat-dy],[lng+dx,lat-dy],[lng+dx,lat+dy],[lng-dx,lat+dy],[lng-dx,lat-dy]]]};}
  function snapshot(s){return {captured_at:new Date().toISOString(),cell_id:String(s.id||''),area_id:s.scope||s.a||null,model_class:classOf(s),probability:Number.isFinite(Number(s.proba))?Number(s.proba):null,ranking_candidato:Number.isFinite(Number(s.ranking_candidato))?Number(s.ranking_candidato):null,ranking_total:Number.isFinite(Number(s.ranking_total))?Number(s.ranking_total):null,target:Number.isFinite(Number(s.target))?Number(s.target):null,municipio:s.municipio||null,scenario:s.local_scenario||s.winner_scenario||null,resolution_m:Number(s.res_m||50)};}
  function toPoints(g){
    if (!g || !g.coordinates || !Array.isArray(g.coordinates[0])) return [];
    let ring = g.coordinates[0];
    if (ring.length > 3) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first && last && first[0] === last[0] && first[1] === last[1]) {
        ring = ring.slice(0, -1);
      }
    }
    return ring.map(p => [Number(p[1]), Number(p[0])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  function toGeometry(){const r=points.map(p=>[p[1],p[0]]);r.push(r[0].slice());return {type:'Polygon',coordinates:[r]};}
  function segmentsCross(a,b,c,d){const turn=(p,q,r)=>(q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1]);return turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0;}
  function selfIntersects(list){for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){if(j===i||j===(i+1)%list.length||i===(j+1)%list.length)continue;if(segmentsCross(list[i],list[(i+1)%list.length],list[j],list[(j+1)%list.length]))return true;}return false;}
  function convexHull(list){const sorted=list.map(p=>p.slice()).sort((a,b)=>a[1]-b[1]||a[0]-b[0]),cross=(o,a,b)=>(a[1]-o[1])*(b[0]-o[0])-(a[0]-o[0])*(b[1]-o[1]),lower=[],upper=[];sorted.forEach(p=>{while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);});sorted.slice().reverse().forEach(p=>{while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);});return lower.slice(0,-1).concat(upper.slice(0,-1));}
  function drawingDetail(zoom=drawingZoom){const z=Math.max(8,Math.min(19,Number(zoom)||13));return {samplePx:Math.round(34-(z-8)*1.5),simplifyPx:Math.round(28-(z-8)*1.35),maxPoints:Math.round(8+(z-8)*1.45)};}
  function normalizePoints(list,zoom=drawingZoom){const detail=drawingDetail(zoom),project=p=>map.project(L.latLng(p),zoom),unproject=p=>{const ll=map.unproject(p,zoom);return[ll.lat,ll.lng];};let clean=list.filter((p,i)=>i===0||project(p).distanceTo(project(list[i-1]))>=Math.max(8,detail.samplePx/2));if(clean.length>3)clean=L.LineUtil.simplify(clean.map(project),detail.simplifyPx).map(unproject);if(clean.length>detail.maxPoints){const step=clean.length/detail.maxPoints;clean=Array.from({length:detail.maxPoints},(_,i)=>clean[Math.floor(i*step)]);}if(selfIntersects(clean))clean=convexHull(clean);return clean;}
  function gridGeometry(){const corners=[];gridCells.forEach(v=>cellGeometry(v).coordinates[0].slice(0,-1).forEach(p=>corners.push([p[1],p[0]])));const hull=convexHull(corners),ring=hull.map(p=>[p[1],p[0]]);ring.push(ring[0].slice());return {type:'Polygon',coordinates:[ring]};}
  function renderGrid(){gridLayer.clearLayers();gridCells.forEach(s=>L.geoJSON(cellGeometry(s),{style:{color:'#087d99',weight:2,fillColor:'#00838f',fillOpacity:.38}}).addTo(gridLayer));if(!map.hasLayer(gridLayer))gridLayer.addTo(map);const count=$('#fcu-grid-count'),save=$('#fcu-grid-save');if(count)count.textContent=gridCells.size?`${gridCells.size} ${gridCells.size===1?'célula selecionada':'células selecionadas'}`:'Nenhuma célula selecionada';if(save)save.disabled=!gridCells.size;}
  function addGridCell(){if(!requireLogin())return;const s=sample(),g=cellGeometry(s);if(!s||!g)return status('Clique primeiro em uma célula do mapa.',true);gridCells.set(String(s.id),JSON.parse(JSON.stringify(s)));renderGrid();status('Célula adicionada. Selecione outra no mapa ou salve.');}
  function removeGridCell(){const s=sample();if(s)gridCells.delete(String(s.id));renderGrid();status(gridCells.size?'Célula removida.':'Seleção limpa.');}
  function clearGrid(){gridCells.clear();renderGrid();status('Seleção limpa.');}
  function finishGrid(){if(!gridCells.size)return;const cells=[...gridCells.values()],first=cells[0];draft={id:generateUUID(),target_kind:'polygon',action_type:'free',cell_id:cells.length===1?String(first.id):null,model_class:null,model_probability:null,model_snapshot:{captured_at:new Date().toISOString(),area_id:areaId(),selection_mode:'grid',grid_cell_ids:cells.map(s=>String(s.id)),grid_cells:cells.map(s=>({snapshot:snapshot(s),geometry:cellGeometry(s)}))},geometry_source:'user_polygon',geometry:gridGeometry()};points=toPoints(draft.geometry);gridMode=true;editingId=null;showForm(null);}
  function buildMapModeControls(){if($('.fcu-map-mode-control'))return;const box=document.createElement('div');box.className='fcu-map-mode-control';box.innerHTML='<div><button type="button" data-base="street" class="is-active">Ruas</button><button type="button" data-base="satellite">Satélite</button></div><div><button type="button" data-view="2d" class="is-active">2D</button><button type="button" data-view="3d">3D</button></div>';document.querySelector('.local-map-panel').appendChild(box);let street=null;map.eachLayer(l=>{if(l instanceof L.TileLayer&&l!==app().satelliteLayer&&!street)street=l;});box.querySelector('[data-base="street"]').onclick=()=>{if(app().satelliteLayer&&map.hasLayer(app().satelliteLayer))map.removeLayer(app().satelliteLayer);if(street&&!map.hasLayer(street))street.addTo(map);box.querySelectorAll('[data-base]').forEach(b=>b.classList.toggle('is-active',b.dataset.base==='street'));};box.querySelector('[data-base="satellite"]').onclick=()=>{if(street&&map.hasLayer(street))map.removeLayer(street);if(app().satelliteLayer&&!map.hasLayer(app().satelliteLayer))app().satelliteLayer.addTo(map);box.querySelectorAll('[data-base]').forEach(b=>b.classList.toggle('is-active',b.dataset.base==='satellite'));};box.querySelector('[data-view="3d"]').onclick=()=>{const s=sample(),c=map.getCenter(),lat=Number(s&&s.lat)||c.lat,lng=Number(s&&s.lng)||c.lng;window.open(`3d.html?lat=${lat}&lng=${lng}&zoom=${Math.max(15,map.getZoom())}${s&&s.id?'&cell='+encodeURIComponent(s.id):''}`,'_blank','noopener');};}
  function drawingId(id){if(!id)return '#NOVO';const str=String(id);const part=str.includes('-')?str.split('-')[0]:str.slice(0,6);return '#'+part.toUpperCase();}
  function areaId(){const s=sample();if(s&&(s.scope||s.a))return String(s.scope||s.a);const a=$('#area-select');return a&&a.value||null;}
  function requireLogin(){if(user() && ownerId() === user().id)return true;close();closeProfilePanel();const b=$('#fcu-auth-button');if(b)b.click();return false;}

  function build(){const host=document.querySelector('.local-map-panel');if(!host||$('.fcu-perception-button'))return false;if(getComputedStyle(host).position==='static')host.style.position='relative';
    host.insertAdjacentHTML('beforeend','<div class="fcu-perception-map-tools"><button class="fcu-perception-button" type="button">＋ Minha percepção</button></div>');
    
    // 1. Minhas Percepções Drawer Panel (Criação de Polígonos e Histórico)
    document.body.insertAdjacentHTML('beforeend',`<div class="fcu-perception-shade" id="fcu-perception-shade"></div><aside class="fcu-perception-panel" id="fcu-perception-panel" aria-label="Percepções territoriais">
    <div class="fcu-perception-head"><div><h2>Minha percepção</h2><p>Compare sua leitura do território com o resultado do Preditor.</p></div><button class="fcu-perception-close" type="button" aria-label="Fechar">×</button></div>
    <div id="fcu-perception-start"><section class="fcu-context-card" id="fcu-context-card"></section>${LAB_MODE?'<section class="fcu-grid-picker"><strong>Selecionar pela grade</strong><p>Clique em uma célula do mapa e use os botões abaixo. As células ficam reunidas em uma percepção.</p><div><button id="fcu-grid-add" type="button">＋ Adicionar</button><button id="fcu-grid-remove" type="button">− Remover</button><button id="fcu-grid-clear" type="button">Limpar</button><button id="fcu-grid-save" type="button" disabled>✓ Salvar</button></div><small id="fcu-grid-count">Nenhuma célula selecionada</small></section>':''}<button class="fcu-perception-secondary fcu-free-button" id="fcu-start-drawing" type="button">✎ Desenhar área livre</button><button class="fcu-perception-secondary" id="fcu-export-geojson" type="button" style="margin-top:8px;">⬇ Exportar GeoJSON</button><p class="fcu-help">Você também pode desenhar um contorno livre e ajustar seus pontos.</p><p class="fcu-perception-status" id="fcu-perception-status"></p>
    <details class="fcu-filter-box" open><summary>Filtrar camada de percepções</summary><label class="fcu-filter-master"><input data-layer-visible type="checkbox" checked> Exibir no mapa</label><div class="fcu-filter-grid">${CLASS_KEYS.map(v=>`<label><input data-class-filter="${v}" type="checkbox" checked><i style="--fcu-color:${COLOR[v]}"></i>${LABEL[v]}</label>`).join('')}</div><div class="fcu-filter-grid fcu-action-filters">${Object.entries(ACTION).map(([v,l])=>`<label><input data-action-filter="${v}" type="checkbox" checked>${l}</label>`).join('')}</div></details>
    <div class="fcu-perception-tabs"><button class="is-active" type="button" data-tab="active">Todas as percepções</button><button type="button" data-tab="history">Lixeira</button></div><div id="fcu-perception-list"></div><div id="fcu-perception-history" hidden></div></div>
    <form class="fcu-perception-form" id="fcu-perception-form" hidden><div class="fcu-perception-form-head"><button class="fcu-form-back" id="fcu-cancel-form" type="button">← Voltar</button><button class="fcu-perception-close" type="button" aria-label="Fechar">×</button></div><div class="fcu-form-summary" id="fcu-form-summary"></div><fieldset id="fcu-class-field"><legend>Como você classifica esta área?</legend>${CLASS_KEYS.map(v=>`<label class="fcu-choice fcu-choice-${v}"><input type="radio" name="classification" value="${v}" required><span class="fcu-choice-mark">✓</span><span>${LABEL[v]}</span></label>`).join('')}</fieldset>
    <label class="fcu-check fcu-field-check"><input type="checkbox" name="field_validation"> Houve validação prática ou visita em campo para esta percepção.</label><label class="fcu-field-date" hidden>Data da visita <span>(opcional)</span><input type="date" name="field_visit_date"></label>
    <label>Comentário breve <span>(opcional)</span></label><textarea name="description" maxlength="800" rows="3" placeholder="O que foi observado?"></textarea><details class="fcu-extra-details"><summary>＋ Mais detalhes (opcional)</summary><label>Título</label><input name="title" type="text" maxlength="120" placeholder="Ex.: visita de campo"><label>Força da percepção</label><select name="intensity"><option value="3">Média</option><option value="1">Muito baixa</option><option value="2">Baixa</option><option value="4">Alta</option><option value="5">Muito alta</option></select><label>Quando isso é percebido?</label><select name="time_reference"><option value="atual">Atualmente</option><option value="recente">Nos últimos anos</option><option value="historica">É histórico</option><option value="nao_sei">Não sei informar</option></select><label>Quanto conhece a área?</label><select name="confidence"><option value="media">Razoavelmente</option><option value="baixa">Pouco</option><option value="alta">Muito bem</option></select><fieldset class="fcu-knowledge"><legend>Como conhece esta área?</legend><label><input type="checkbox" name="knowledge_source" value="visita_campo"> Visita ou atividade em campo</label><label><input type="checkbox" name="knowledge_source" value="mora_trabalha"> Moro ou trabalho na área</label><label><input type="checkbox" name="knowledge_source" value="pesquisa_tecnica"> Pesquisa, dados ou trabalho técnico</label><label><input type="checkbox" name="knowledge_source" value="relatos"> Relatos de moradores ou parceiros</label><label><input type="checkbox" name="knowledge_source" value="outro"> Outra forma</label></fieldset></details><button class="fcu-perception-primary" type="submit">Salvar percepção</button><p class="fcu-perception-status" id="fcu-form-status"></p></form></aside>`);

    // 2. Dedicated "Minha Conta" Standalone Page View
    document.body.insertAdjacentHTML('beforeend', `
    <div class="fcu-account-page" id="fcu-account-page" aria-label="Minha conta - Preditor FCU">
      <header class="fcu-account-topbar">
        <div class="fcu-account-brand">
          <h1>Preditor FCU</h1>
          <span>Minha Conta</span>
        </div>
        <div class="fcu-account-top-actions">
          <button class="fcu-account-back-btn" id="fcu-account-back-btn" type="button">
            ← Voltar ao Mapa
          </button>
        </div>
      </header>
      <main class="fcu-account-main">
        <div class="fcu-account-header-section">
          <h2>👤 Minha Conta & Central SIG</h2>
          <p>Gerencie seu perfil de participante, exporte arquivos detalhados para o QGIS, altere sua senha e avalie a ferramenta.</p>
        </div>
        <div id="fcu-account-content" class="fcu-account-grid"></div>
      </main>
    </div>`);

    $('.fcu-perception-button').onclick=()=>{open(false);load();};
    if($('.fcu-profile-btn-shortcut')) $('.fcu-profile-btn-shortcut').onclick=openProfilePanel;
    document.querySelectorAll('.fcu-perception-close').forEach(b => b.onclick = close);
    $('#fcu-perception-shade').onclick=close;
    if($('#fcu-account-back-btn')) $('#fcu-account-back-btn').onclick=closeProfilePanel;

    $('#fcu-start-drawing').onclick=startDrawing;if($('#fcu-export-geojson'))$('#fcu-export-geojson').onclick=()=>exportGeoJSONWithFilters();$('#fcu-cancel-form').onclick=reset;$('#fcu-perception-form').onsubmit=save;if(LAB_MODE){$('#fcu-grid-add').onclick=addGridCell;$('#fcu-grid-remove').onclick=removeGridCell;$('#fcu-grid-clear').onclick=clearGrid;$('#fcu-grid-save').onclick=finishGrid;buildMapModeControls();}
    document.querySelectorAll('[data-layer-visible]').forEach(n=>n.onchange=e=>setVisible(e.target.checked));
    document.querySelectorAll('[data-class-filter]').forEach(n=>n.onchange=e=>{e.target.checked?filters.classes.add(e.target.dataset.classFilter):filters.classes.delete(e.target.dataset.classFilter);renderLayers();});
    document.querySelectorAll('[data-action-filter]').forEach(n=>n.onchange=e=>{e.target.checked?filters.actions.add(e.target.dataset.actionFilter):filters.actions.delete(e.target.dataset.actionFilter);renderLayers();});
    document.querySelectorAll('[data-tab]').forEach(n=>n.onclick=()=>showTab(n.dataset.tab));const field=fcuFieldCheckbox();field.onchange=()=>{$('.fcu-field-date').hidden=!field.checked;if(field.checked){const source=$('[name="knowledge_source"][value="visita_campo"]');source.checked=true;}};return true;}
  
  function fcuFieldCheckbox(){return $('#fcu-perception-form [name="field_validation"]');}
  function renderLegendControl(){const body=document.querySelector('.all-points-control .legend-body'),old=document.querySelector('.fcu-legend-perceptions');if(!body||!ownerId()){if(old)old.remove();return;}if(old){const button=old.querySelector('button');button.classList.toggle('is-off',!filters.visible);button.setAttribute('aria-checked',String(filters.visible));return;}const group=document.createElement('div');group.className='fcu-legend-perceptions';group.innerHTML=`<div class="fcu-legend-title">Camada de percepções</div><button type="button" role="switch" aria-checked="${filters.visible}"><span class="fcu-legend-swatch"></span><span>Minhas percepções</span><i></i></button>`;group.querySelector('button').onclick=e=>{e.preventDefault();e.stopPropagation();setVisible(!filters.visible);};body.appendChild(group);}
  function setVisible(v){filters.visible=v;const top=$('#fcu-layer-toggle');if(top)top.checked=v;document.querySelectorAll('[data-layer-visible]').forEach(n=>n.checked=v);if(v&&!map.hasLayer(layers))layers.addTo(map);if(!v&&map.hasLayer(layers))map.removeLayer(layers);renderLegendControl();}
  function renderContext(){
    const h=$('#fcu-context-card'),s=sample(),k=classOf(s);
    if(!h)return;
    if(!s||!k||!explicitCellClick){
      h.innerHTML=`
        <div style="padding:10px 12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:12px;">
          <h3 style="margin:0 0 4px;color:#07324d;font-size:14px;font-weight:800;">📐 Percepção Territorial e SIG</h3>
          <p style="margin:0;color:#475569;font-size:12px;line-height:1.4;">Desenhe polígonos no mapa (estilo QGIS) ou clique diretamente em uma célula no mapa para avaliar a análise da IA.</p>
        </div>
      `;
      lastCell='';
      return;
    }
    lastCell=String(s.id||'');
    const p=Number.isFinite(Number(s.proba))?(Number(s.proba)*100).toFixed(1)+'%':'—';
    h.innerHTML=`
      <span class="fcu-context-eyebrow">Célula Selecionada no Mapa</span>
      <h3 style="margin:3px 0 8px;font-size:17px;font-weight:800;color:#07324d;">${esc(s.id)}</h3>
      <div class="fcu-model-result" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f0f9fb;border-radius:10px;border:1px solid #bce3eb;margin-bottom:12px;">
        <i style="--fcu-color:${COLOR[k]};width:14px;height:14px;border-radius:50%;background:var(--fcu-color);display:inline-block;flex-shrink:0;"></i>
        <div style="display:flex;flex-direction:column;">
          <span style="font-size:13px;color:#07324d;">Resultado IA: <strong>${LABEL[k]}</strong></span>
          <small style="font-size:11px;color:#087d99;">Probabilidade ${p}</small>
        </div>
      </div>
      <div class="fcu-context-actions" style="display:flex;flex-direction:column;gap:8px;">
        <button type="button" data-confirm style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 14px;font-weight:700;font-size:13px;color:#ffffff;background:#15803d;border:none;border-radius:8px;cursor:pointer;">✓ Concordo com o resultado</button>
        <button type="button" data-different style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 14px;font-weight:700;font-size:13px;color:#991b1b;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;cursor:pointer;">✕ Discordo da análise</button>
      </div>
      <small class="fcu-help" style="display:block;margin-top:10px;color:#64748b;font-size:11px;line-height:1.4;">Sua avaliação gera uma camada de percepção exclusiva do participante sem alterar o modelo original.</small>
    `;
    h.querySelector('[data-confirm]').onclick=()=>beginCell('confirm');
    h.querySelector('[data-different]').onclick=()=>beginCell('reclassify');
  }
  function beginCell(action){if(!requireLogin())return;const s=sample(),k=classOf(s),g=cellGeometry(s);if(!s||!k||!g)return status('Selecione novamente uma célula válida.',true);draft={id:generateUUID(),target_kind:'cell',action_type:action,cell_id:String(s.id),model_class:k,model_probability:Number.isFinite(Number(s.proba))?Number(s.proba):null,model_snapshot:snapshot(s),geometry_source:'model_cell',geometry:g};points=toPoints(g);editingId=null;showForm(action==='confirm'?k:null);}
  function showForm(selected,record){const f=$('#fcu-perception-form');$('#fcu-perception-start').hidden=true;f.hidden=false;f.reset();const model=draft.model_class&&LABEL[draft.model_class],isGrid=draft.model_snapshot&&draft.model_snapshot.selection_mode==='grid';$('#fcu-form-summary').innerHTML=draft.action_type==='confirm'?`<strong>✓ Confirmar resultado da IA</strong><span>Preditor: ${model}</span>`:draft.action_type==='reclassify'?`<strong>✕ Discordo da análise (Vejo diferente)</strong><span>Preditor indicou: ${model}</span>`:isGrid?`<strong>Classificar seleção da grade</strong><span>${draft.model_snapshot.grid_cell_ids.length} célula(s)</span>`:'<strong>Classificar a área desenhada</strong><span>Desenho livre</span>';
    if(record){f.elements.title.value=record.title||'';f.elements.intensity.value=record.intensity||3;f.elements.time_reference.value=record.time_reference||'atual';f.elements.confidence.value=record.confidence||'media';f.elements.description.value=record.description||'';(record.knowledge_sources||[]).forEach(value=>{const n=f.querySelector(`[name="knowledge_source"][value="${value}"]`);if(n)n.checked=true;});f.elements.field_validation.checked=!!record.field_validation;f.elements.field_visit_date.value=record.field_visit_date||'';}else f.elements.title.value=draft.action_type==='confirm'?`Confirmo ${model}`:'';
    $('.fcu-field-date').hidden=!f.elements.field_validation.checked;
    $('#fcu-form-summary').insertAdjacentHTML('afterbegin',`<small class="fcu-drawing-id">Desenho ${drawingId(editingId||draft.id)}</small>`);    const choice=f.querySelector(`[name="classification"][value="${selected||(record&&record.perceived_class)||''}"]`);if(choice)choice.checked=true;const locked=draft.action_type==='confirm';f.querySelectorAll('[name="classification"]').forEach(n=>n.disabled=locked);$('#fcu-class-field').classList.toggle('is-locked',locked);
    f.querySelectorAll('.fcu-choice').forEach(label => {
      const radio = label.querySelector('input[type="radio"]');
      if (radio) {
        const handleChoiceClick = (e) => {
          if (radio.disabled) return;
          if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        label.onclick = handleChoiceClick;
      }
    });
    open();status('',false,'#fcu-form-status');}

  function updateQGISGuideText() {
    const badge = $('#fcu-gis-guide-text');
    if (!badge) return;
    if (points.length === 0) {
      badge.innerHTML = '📍 <strong>Passo 1 de 2:</strong> Clique no mapa para posicionar o <strong>1º VÉRTICE</strong> do polígono (o mapa fica fixo para desenho).';
    } else if (points.length === 1) {
      badge.innerHTML = '📍 <strong>1º Vértice definido!</strong> Clique em outro local para posicionar o <strong>2º VÉRTICE</strong>.';
    } else if (points.length === 2) {
      badge.innerHTML = '📐 <strong>2 Vértices definidos.</strong> Clique para colocar o <strong>3º VÉRTICE</strong> e fechar a área inicial.';
    } else {
      badge.innerHTML = `✅ <strong>Polígono em construção (${points.length} vértices).</strong> Continue clicando no mapa ou dê <strong>duplo clique</strong> ou aperte <strong>'✓ Concluir'</strong>.`;
    }
  }

  function updateCursorTooltip(e) {
    if (!drawing) {
      const tip = $('#fcu-cursor-tooltip');
      if (tip) tip.remove();
      return;
    }
    let tip = $('#fcu-cursor-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'fcu-cursor-tooltip';
      tip.className = 'fcu-cursor-tooltip';
      document.body.appendChild(tip);
    }
    if (e && e.clientX != null) {
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
    }
    
    if (points.length === 0) tip.textContent = '🎯 Clique no mapa para o 1º Vértice';
    else if (points.length === 1) tip.textContent = '📍 Clique para o 2º Vértice';
    else if (points.length === 2) tip.textContent = '📐 Clique para o 3º Vértice (área)';
    else tip.textContent = `✅ +1 Vértice (ou duplo clique / ✓ Concluir)`;
  }

  function startDrawing(){
    if(!requireLogin())return;
    close();
    closeProfilePanel();
    drawing=true;
    dragging=false;
    drawingMode='vertices';
    drawingZoom=map.getZoom();
    points=[];
    draft=null;
    editingId=null;
    if(draftLayer)map.removeLayer(draftLayer);
    draftLayer=null;
    const old=$('#fcu-perception-drawnote');
    if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend',`
      <div class="fcu-perception-drawnote fcu-gis-toolbar" id="fcu-perception-drawnote">
        <div class="fcu-gis-head" title="Clique e arraste para mover este menu para qualquer lugar na tela">
          <span class="fcu-gis-badge">📐 FERRAMENTA DE VÉRTICES (ESTILO QGIS)</span>
          <span id="fcu-point-count" class="fcu-gis-count">0 pontos</span>
          <span class="fcu-gis-drag-hint" style="margin-left:auto;font-size:11px;opacity:0.9;cursor:move;padding:2px 6px;background:rgba(255,255,255,0.18);border-radius:4px;">🖐️ Arraste para mover</span>
        </div>
        <div class="fcu-gis-guide-banner" id="fcu-gis-guide-text">
          📍 <strong>Passo 1 de 2:</strong> Clique no mapa para posicionar o <strong>1º VÉRTICE</strong> do polígono (o mapa fica fixo para desenho).
        </div>
        <div class="fcu-gis-tools">
          <div class="fcu-gis-group" role="radiogroup" aria-label="Modo de desenho">
            <button id="fcu-mode-vertices" class="fcu-gis-btn is-active" type="button" title="Modo Vértices (Tipo QGIS): clique ponto a ponto no mapa">
              <span class="fcu-gis-icon">📐</span>
              <span class="fcu-gis-label">Vértices (QGIS)</span>
            </button>
            <button id="fcu-mode-freehand" class="fcu-gis-btn" type="button" title="Modo Mão Livre: clique e arraste para desenhar continuamente">
              <span class="fcu-gis-icon">➰</span>
              <span class="fcu-gis-label">Mão livre</span>
            </button>
          </div>
          <div class="fcu-gis-group">
            <button id="fcu-undo" class="fcu-gis-btn" type="button" disabled title="Desfazer último ponto adicionado">
              <span class="fcu-gis-icon">↶</span>
              <span class="fcu-gis-label">Desfazer</span>
            </button>
            <button id="fcu-clear" class="fcu-gis-btn" type="button" disabled title="Limpar todo o desenho atual">
              <span class="fcu-gis-icon">🗑️</span>
              <span class="fcu-gis-label">Limpar</span>
            </button>
          </div>
          <div class="fcu-gis-group">
            <button id="fcu-cancel" class="fcu-gis-btn fcu-btn-cancel" type="button" title="Cancelar desenho">
              <span class="fcu-gis-icon">✕</span>
              <span class="fcu-gis-label">Cancelar</span>
            </button>
            <button id="fcu-finish" class="fcu-gis-btn fcu-btn-primary" type="button" disabled title="Concluir e fechar polígono">
              <span class="fcu-gis-icon">✓</span>
              <span class="fcu-gis-label">Concluir</span>
            </button>
          </div>
        </div>
      </div>
    `);

    const bar=$('#fcu-perception-drawnote');
    if(bar){
      if(window.L && L.DomEvent){
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.disableScrollPropagation(bar);
      }
      makeElementDraggable(bar, bar.querySelector('.fcu-gis-head') || bar);
    }

    const setMode = mode => {
      drawingMode = mode;
      const btnV = $('#fcu-mode-vertices');
      const btnF = $('#fcu-mode-freehand');
      if (btnV) btnV.classList.toggle('is-active', mode === 'vertices');
      if (btnF) btnF.classList.toggle('is-active', mode === 'freehand');
      map.getContainer().style.cursor = 'crosshair';
      if (mode === 'vertices') map.dragging.enable();
      window.PreditorTelemetry?.track('perception_mode_switch', { mode });
    };

    if($('#fcu-mode-vertices')) $('#fcu-mode-vertices').onclick = () => setMode('vertices');
    if($('#fcu-mode-freehand')) $('#fcu-mode-freehand').onclick = () => setMode('freehand');
    if($('#fcu-undo')) $('#fcu-undo').onclick = () => { points.pop(); redraw(); };
    if($('#fcu-clear')) $('#fcu-clear').onclick = () => { points = []; redraw(); };
    const handleFinish = (e) => { if(e){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();} finish(e); };
    if($('#fcu-finish')) { $('#fcu-finish').onclick = handleFinish; $('#fcu-finish').ontouchstart = handleFinish; }
    if($('#fcu-cancel')) $('#fcu-cancel').onclick = () => { reset(); open(); };
    setMode('vertices');
  }

  function redraw(){
    if(draftLayer)map.removeLayer(draftLayer);
    draftLayer=points.length>=3?L.polygon(points,{color:'#087d99',weight:3,fillColor:'#087d99',fillOpacity:.18,interactive:false}).addTo(map):points.length?L.polyline(points,{color:'#087d99',weight:3,interactive:false}).addTo(map):null;
    const c=$('#fcu-point-count');
    if(c)c.textContent=`${points.length} ${points.length===1?'ponto':'pontos'}`;
    if($('#fcu-undo'))$('#fcu-undo').disabled=!points.length;
    if($('#fcu-clear'))$('#fcu-clear').disabled=!points.length;
    if($('#fcu-finish'))$('#fcu-finish').disabled=points.length<3;
    updateQGISGuideText();
  }

  function add(latlng){
    const p=[latlng.lat,latlng.lng],prev=points[points.length-1],detail=drawingDetail();
    if(prev){
      const dist = map.project(L.latLng(prev),drawingZoom).distanceTo(map.project(latlng,drawingZoom));
      const minPx = (drawingMode === 'freehand') ? Math.max(8, detail.samplePx / 2) : 3;
      if(dist < minPx) return;
    }
    points.push(p);
    redraw();
  }

  function pointerDown(e){
    if(!drawing||e.button!==0||e.target.closest('.leaflet-control, .fcu-gis-toolbar, .fcu-geometry-toolbar'))return;
    ptrDownPos = { x: e.clientX, y: e.clientY };
    if(drawingMode==='freehand'){
      dragging=true;
      map.dragging.disable();
      add(map.mouseEventToLatLng(e));
    }
  }

  function pointerMove(e){
    if(drawing){
      updateCursorTooltip(e);
      if(drawingMode==='freehand'&&dragging){
        add(map.mouseEventToLatLng(e));
      }
    }
  }

  function pointerUp(e){
    if(!drawing||e.button!==0)return;
    if(drawingMode==='freehand'){
      if(dragging){
        add(map.mouseEventToLatLng(e));
        dragging=false;
        map.dragging.enable();
      }
    } else if(drawingMode==='vertices'&&ptrDownPos){
      const dx=Math.abs(e.clientX-ptrDownPos.x);
      const dy=Math.abs(e.clientY-ptrDownPos.y);
      ptrDownPos=null;
      if(dx<=8&&dy<=8){
        add(map.mouseEventToLatLng(e));
      }
    }
  }

  let isFinishingDrawing = false;
  function finish(e){
    if(e){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();}
    if(isFinishingDrawing) return;
    points=normalizePoints(points);
    if(points.length<3)return;

    isFinishingDrawing = true;
    const btnFinish = $('#fcu-finish');
    const guideText = $('#fcu-gis-guide-text');
    if (btnFinish) {
      btnFinish.disabled = true;
      btnFinish.style.opacity = '0.9';
      btnFinish.innerHTML = '<span class="fcu-gis-icon">⏳</span><span class="fcu-gis-label">Salvando área...</span>';
    }
    if (guideText) {
      guideText.innerHTML = '⏳ <strong>Polígono em processamento...</strong> Fechando área e abrindo formulário de classificação...';
    }
    document.querySelectorAll('#fcu-undo, #fcu-clear, #fcu-cancel').forEach(b => { if(b) b.disabled = true; });

    setTimeout(() => {
      isFinishingDrawing = false;
      drawing=false;
      dragging=false;
      if(map){map.dragging.enable();map.getContainer().style.cursor='';}
      const n=$('#fcu-perception-drawnote');
      if(n)n.remove();
      const tip=$('#fcu-cursor-tooltip');
      if(tip)tip.remove();
      draft={id:generateUUID(),target_kind:'polygon',action_type:'free',cell_id:null,model_class:null,model_probability:null,model_snapshot:{captured_at:new Date().toISOString(),area_id:areaId()},geometry_source:'user_polygon',geometry:toGeometry()};
      open();
      showForm(null);
    }, 1500);
  }
  function reset(){drawing=false;dragging=false;geometryEditing=false;gridMode=false;points=[];originalPoints=[];selectedVertex=-1;draft=null;editingId=null;editingRecord=null;gridCells.clear();gridLayer.clearLayers();if(map){map.dragging.enable();map.getContainer().style.cursor='';}editHandles.clearLayers();if(draftLayer){map.removeLayer(draftLayer);draftLayer=null;}const n=$('#fcu-perception-drawnote');if(n)n.remove();const tip=$('#fcu-cursor-tooltip');if(tip)tip.remove();const f=$('#fcu-perception-form');if(f){f.reset();f.hidden=true;}if($('#fcu-perception-start'))$('#fcu-perception-start').hidden=false;status('');renderGrid();renderContext();}

  function calculatePolygonAreaAndPerimeter(coords) {
    if (!coords || coords.length < 3) return { areaHa: 0, perimKm: 0, numVertices: 0 };
    let numVertices = coords.length - (coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1] ? 1 : 0);
    
    let totalAreaSqM = 0;
    let totalPerimM = 0;
    const R = 6371000;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const lat1 = p1[1] * Math.PI / 180;
      const lat2 = p2[1] * Math.PI / 180;
      const dLng = (p2[0] - p1[0]) * Math.PI / 180;
      const dLat = (p2[1] - p1[1]) * Math.PI / 180;

      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      totalPerimM += R * c;
      totalAreaSqM += (p2[0] - p1[0]) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    totalAreaSqM = Math.abs(totalAreaSqM * R * R * Math.PI / 360);
    
    return {
      areaHa: Number((totalAreaSqM / 10000).toFixed(2)),
      perimKm: Number((totalPerimM / 1000).toFixed(2)),
      numVertices: numVertices
    };
  }

  async function exportGeoJSONWithFilters(customFilters = {}) {
    if(!requireLogin())return;
    status('Gerando pacote SIG para QGIS...', false);
    const u = user();
    const epoch = accountEpoch;
    if (u.id !== ownerId()) return;
    let localList;
    try { localList = getLocalItems(); }
    catch (_) { return status('Não foi possível ler os desenhos locais. Eles não foram apagados.', true); }
    let activeData = (items.length ? items : localList).filter(x => owns(x, u.id));
    if (!activeData.length) {
      const c = client();
      if (c) {
        try { activeData = await readAllOwned(c, 'fcu_perceptions', '*', u.id, epoch, 'created_at'); }
        catch (_) { return status('Não foi possível consultar as percepções para exportar. Tente novamente.', true); }
      }
    }
    if (!sameAccount(u.id, epoch)) return;
    activeData = activeData.filter(x => owns(x, u.id));
    if (!activeData.length) return status('Nenhuma percepção encontrada.', true);

    const format = customFilters.format || $('#fcu-exp-format')?.value || 'geojson';
    const uf = customFilters.uf || $('#fcu-exp-uf')?.value || 'all';
    const area = customFilters.area || $('#fcu-exp-area')?.value || 'all';
    const cls = customFilters.perceived_class || $('#fcu-exp-class')?.value || 'all';
    const statusFilter = customFilters.status || $('#fcu-exp-status')?.value || 'active';
    const period = customFilters.period || $('#fcu-exp-period')?.value || 'all';

    if (statusFilter === 'active') activeData = activeData.filter(x => x.status !== 'archived');
    else if (statusFilter === 'archived') activeData = activeData.filter(x => x.status === 'archived');

    if (uf && uf !== 'all') {
      activeData = activeData.filter(x => String(x.area_id || '').toUpperCase().includes(uf) || String(x.description || '').toUpperCase().includes(uf));
    }
    if (area && area !== 'all') {
      activeData = activeData.filter(x => String(x.area_id || '').toLowerCase().includes(area) || String(x.cell_id || '').toLowerCase().includes(area));
    }
    if (cls && cls !== 'all') {
      activeData = activeData.filter(x => x.perceived_class === cls);
    }
    if (period && period !== 'all') {
      const now = new Date();
      const days = period === '30days' ? 30 : period === '7days' ? 7 : 3650;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      activeData = activeData.filter(x => new Date(x.created_at) >= cutoff);
    }

    if (!activeData.length) return status('Nenhuma percepção atende aos filtros selecionados.', true);

    const uMeta = u.user_metadata || {};
    const userName = uMeta.full_name || u.email || 'Participante';
    const userInst = uMeta.institution || 'Não informada';

    const features = activeData.map(item => {
      const coords = (item.geometry && item.geometry.coordinates && item.geometry.coordinates[0]) || [];
      const geomStats = calculatePolygonAreaAndPerimeter(coords);

      return {
        type: 'Feature',
        id: item.id,
        geometry: item.geometry,
        properties: {
          id: item.id,
          usuario_nome: userName,
          usuario_email: u.email,
          usuario_email_secundario: uMeta.secondary_email || '',
          usuario_whatsapp: uMeta.whatsapp || '',
          instituicao: uMeta.institution || userInst,
          usuario_municipio_residencia: uMeta.municipality || '',
          usuario_perfil_profissional: uMeta.profile_role || 'Não informado',
          usuario_experiencia_territorio: uMeta.territory_experience || 'Não informado',
          percepcao_titulo: item.title || `Percepção #${item.id.slice(0, 6)}`,
          classe_codigo: item.perceived_class,
          classe_rotulo: LABEL[item.perceived_class] || item.perceived_class,
          tipo_acao: item.action_type || 'free',
          area_estudo: item.area_id || 'Não informada',
          celula_id: item.cell_id || 'Desenho livre',
          area_hectares: geomStats.areaHa,
          perimetro_km: geomStats.perimKm,
          qtd_vertices: geomStats.numVertices,
          validacao_campo: item.field_validation ? 'Sim' : 'Não',
          data_visita_campo: item.field_visit_date || null,
          referencia_temporal: item.time_reference || 'atual',
          conhecimento_nivel: item.confidence || 'media',
          fontes_conhecimento: Array.isArray(item.knowledge_sources) ? item.knowledge_sources.join(', ') : '',
          observacoes: item.description || '',
          status_sincronizacao: item._sync_status || 'synced',
          status_registro: item.status || 'submitted',
          criado_em: item.created_at
        }
      };
    });

    function createGeoPackageBinaryGeometry(coords) {
      if (!coords || coords.length < 3) return null;
      const ring = [...coords];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const totalLen = 40 + 13 + ring.length * 16;
      const buf = new Uint8Array(totalLen);
      const view = new DataView(buf.buffer);

      let offset = 0;
      buf[offset++] = 0x47; // 'G'
      buf[offset++] = 0x50; // 'P'
      buf[offset++] = 0x00; // version 0
      buf[offset++] = 0x03; // flags: little endian + envelope 1 (32 bytes)
      view.setUint32(offset, 4326, true); offset += 4;

      view.setFloat64(offset, minX, true); offset += 8;
      view.setFloat64(offset, maxX, true); offset += 8;
      view.setFloat64(offset, minY, true); offset += 8;
      view.setFloat64(offset, maxY, true); offset += 8;

      buf[offset++] = 0x01; // little endian
      view.setUint32(offset, 3, true); offset += 4; // WKBPolygon
      view.setUint32(offset, 1, true); offset += 4; // 1 ring
      view.setUint32(offset, ring.length, true); offset += 4; // num points

      for (const [x, y] of ring) {
        view.setFloat64(offset, x, true); offset += 8;
        view.setFloat64(offset, y, true); offset += 8;
      }

      return { bytes: buf, minX, maxX, minY, maxY };
    }

    async function generateGeoPackageBlob(featuresList) {
      if (typeof window.initSqlJs !== 'function') {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const SQL = await window.initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/${file}`
      });

      const gpkgDb = new SQL.Database();
      gpkgDb.run('PRAGMA application_id = 1196444487;');
      gpkgDb.run('PRAGMA user_version = 10300;');

      gpkgDb.run(`
        CREATE TABLE gpkg_spatial_ref_sys (
          srs_name TEXT NOT NULL,
          srs_id INTEGER NOT NULL PRIMARY KEY,
          organization TEXT NOT NULL,
          organization_coordsys_id INTEGER NOT NULL,
          definition TEXT NOT NULL,
          description TEXT
        );
      `);

      gpkgDb.run(`
        INSERT INTO gpkg_spatial_ref_sys VALUES
        ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'),
        ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'),
        ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
      `);

      gpkgDb.run(`
        CREATE TABLE gpkg_contents (
          table_name TEXT NOT NULL PRIMARY KEY,
          data_type TEXT NOT NULL,
          identifier TEXT UNIQUE,
          description TEXT DEFAULT '',
          last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          min_x DOUBLE,
          min_y DOUBLE,
          max_x DOUBLE,
          max_y DOUBLE,
          srs_id INTEGER,
          CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
      `);

      gpkgDb.run(`
        CREATE TABLE gpkg_geometry_columns (
          table_name TEXT NOT NULL,
          column_name TEXT NOT NULL,
          geometry_type_name TEXT NOT NULL,
          srs_id INTEGER NOT NULL,
          z TINYINT NOT NULL,
          m TINYINT NOT NULL,
          CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
          CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
          CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );
      `);

      gpkgDb.run(`
        CREATE TABLE percepcoes_fcu (
          fid INTEGER PRIMARY KEY AUTOINCREMENT,
          geom BLOB,
          id TEXT,
          usuario_nome TEXT,
          usuario_email TEXT,
          instituicao TEXT,
          percepcao_titulo TEXT,
          classe_codigo TEXT,
          classe_rotulo TEXT,
          tipo_acao TEXT,
          area_estudo TEXT,
          celula_id TEXT,
          area_hectares REAL,
          perimetro_km REAL,
          qtd_vertices INTEGER,
          validacao_campo TEXT,
          conhecimento_nivel TEXT,
          fontes_conhecimento TEXT,
          observacoes TEXT,
          criado_em TEXT
        );
      `);

      let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;

      for (const f of featuresList) {
        const coords = (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]) || [];
        const geomData = createGeoPackageBinaryGeometry(coords);
        if (!geomData) continue;

        if (geomData.minX < gMinX) gMinX = geomData.minX;
        if (geomData.maxX > gMaxX) gMaxX = geomData.maxX;
        if (geomData.minY < gMinY) gMinY = geomData.minY;
        if (geomData.maxY > gMaxY) gMaxY = geomData.maxY;

        const p = f.properties || {};
        gpkgDb.run(`
          INSERT INTO percepcoes_fcu (
            geom, id, usuario_nome, usuario_email, instituicao, percepcao_titulo,
            classe_codigo, classe_rotulo, tipo_acao, area_estudo, celula_id,
            area_hectares, perimetro_km, qtd_vertices, validacao_campo,
            conhecimento_nivel, fontes_conhecimento, observacoes, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          geomData.bytes,
          String(p.id || ''),
          String(p.usuario_nome || ''),
          String(p.usuario_email || ''),
          String(p.instituicao || ''),
          String(p.percepcao_titulo || ''),
          String(p.classe_codigo || ''),
          String(p.classe_rotulo || ''),
          String(p.tipo_acao || ''),
          String(p.area_estudo || ''),
          String(p.celula_id || ''),
          Number(p.area_hectares || 0),
          Number(p.perimetro_km || 0),
          Number(p.qtd_vertices || 0),
          String(p.validacao_campo || ''),
          String(p.conhecimento_nivel || ''),
          String(p.fontes_conhecimento || ''),
          String(p.observacoes || ''),
          String(p.criado_em || '')
        ]);
      }

      if (gMinX === Infinity) {
        gMinX = -180; gMaxX = 180; gMinY = -90; gMaxY = 90;
      }

      gpkgDb.run(`
        INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id)
        VALUES ('percepcoes_fcu', 'features', 'percepcoes_fcu', 'Percepções territoriais do Preditor FCU', ?, ?, ?, ?, 4326)
      `, [gMinX, gMinY, gMaxX, gMaxY]);

      gpkgDb.run(`
        INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
        VALUES ('percepcoes_fcu', 'geom', 'POLYGON', 4326, 0, 0)
      `);

      const u8 = gpkgDb.export();
      return new Blob([u8], { type: 'application/geopackage+sqlite3' });
    }

    if (format === 'gpkg') {
      status('Compilando GeoPackage (.gpkg) nativo para QGIS...', false);
      try {
        const gpkgBlob = await generateGeoPackageBlob(features);
        if (!sameAccount(u.id, epoch)) return;
        const url = URL.createObjectURL(gpkgBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `percepcoes_fcu_qgis_${new Date().toISOString().slice(0, 10)}.gpkg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.PreditorTelemetry?.track('perception_export_gpkg', { area: area || 'all', count: features.length });
        status('✓ GeoPackage (.gpkg) gerado com sucesso para o QGIS!');
        return;
      } catch (err) {
        console.error('GeoPackage generation error:', err);
        status('Aviso: falha ao gerar GPKG local, gerando GeoJSON como alternativa.', true);
      }
    }

    const geojson = {
      type: 'FeatureCollection',
      name: 'percepcoes_fcu_qgis',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: features
    };

    window.PreditorTelemetry?.track('perception_export_geojson', { area: area || 'all', format: format });
    const ext = format === 'json' ? 'json' : 'geojson';
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (!sameAccount(u.id, epoch)) { URL.revokeObjectURL(url); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = `percepcoes_fcu_qgis_${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    status('✓ Arquivo baixado para uso no QGIS!');
  }

  async function save(e){
    e.preventDefault();
    if(!requireLogin()||!draft)return;
    const f=e.currentTarget,v=new FormData(f);
    const perceived=draft.action_type==='confirm'?draft.model_class:String(v.get('classification')||'');
    const sources=v.getAll('knowledge_source').map(String);
    const fieldValidation=v.get('field_validation')==='on';
    if(!perceived)return status('Escolha uma classificação.',true,'#fcu-form-status');
    if(!sources.length)sources.push(fieldValidation?'visita_campo':'nao_informado');
    if(draft.action_type==='reclassify'&&perceived===draft.model_class)return status('Escolha uma classe diferente do resultado do Preditor.',true,'#fcu-form-status');

    const nowObj = new Date();
    const dateStr = nowObj.toLocaleDateString('pt-BR');
    const timeStr = nowObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const autoTitle = `Percepção ${dateStr} às ${timeStr}`;
    const id=editingId||draft.id||generateUUID();
    const nowStr=new Date().toISOString();

    const existingItem = editingId ? items.find(x => x.id === editingId) : null;
    if (editingId && !owns(existingItem)) return status('Entre novamente na conta que criou este desenho.', true, '#fcu-form-status');
    const historyList = (existingItem && Array.isArray(existingItem._history)) ? [...existingItem._history] : [];
    if (existingItem) {
      const prevVer = existingItem.version_count || (historyList.length + 1);
      historyList.push({
        ...perceptionPayload(existingItem),
        version: prevVer,
        updated_at: existingItem.updated_at || existingItem.created_at || nowStr,
        title: existingItem.title,
        perceived_class: existingItem.perceived_class,
        geometry: existingItem.geometry,
        description: existingItem.description
      });
    }
    const currentVersion = existingItem ? (existingItem.version_count || 1) + 1 : 1;

    const payload={
      ...(existingItem || {}),
      id:id,
      user_id:user().id,
      title:String(v.get('title')||'').trim()||autoTitle,
      target_kind:draft.target_kind||'polygon',
      action_type:draft.action_type||'free',
      perceived_class:perceived,
      perception_types:[perceived],
      area_id:draft.model_snapshot&&draft.model_snapshot.area_id||areaId(),
      cell_id:draft.cell_id||null,
      model_class:draft.model_class||null,
      model_probability:draft.model_probability??null,
      model_snapshot:draft.model_snapshot||{},
      geometry_source:draft.geometry_source||'user_polygon',
      geometry:draft.geometry,
      intensity:Number(v.get('intensity')||3),
      time_reference:String(v.get('time_reference')||'atual'),
      confidence:String(v.get('confidence')||'media'),
      knowledge_sources:sources,
      field_validation:fieldValidation,
      field_visit_date:fieldValidation?String(v.get('field_visit_date')||''):null,
      description:String(v.get('description')||'').trim()||null,
      status:'submitted',
      created_at: existingItem ? (existingItem.created_at || nowStr) : nowStr,
      updated_at: nowStr,
      version_count: currentVersion,
      _history: historyList,
      _sync_status:'pending'
    };

    markPending(payload, editingRecord || existingItem);
    if (!persistDraft(payload)) return;

    if(editingId){const i=items.findIndex(x=>x.id===editingId);if(i>=0)items[i]=payload;else items.unshift(payload);}
    else items.unshift(payload);

    window.PreditorTelemetry?.track(editingId?'perception_update':'perception_create',{perception_id:id,action:payload.action_type},{cellId:payload.cell_id,area:payload.area_id});

    renderLayers();
    reset();
    open();
    renderItemsUI();
    status(`⏳ Sincronizando desenho ${drawingId(id)} com a nuvem...`);

    const synced = await syncSingleItemToSupabase(payload);
    if (!owns(payload)) return;
    if (synced) {
      status(`✓ Desenho ${drawingId(id)} salvo e sincronizado com a nuvem!`);
    } else if (getLocalItems().find(x => x.id === id)?._sync_status === 'conflict') {
      status('Há uma versão diferente na nuvem. As duas foram preservadas; revise o aviso na lista.', true);
    } else {
      status(`⚡ Desenho ${drawingId(id)} salvo no dispositivo! (Toque em Sincronizar na lista para tentar novamente)`);
    }
  }

  async function archive(id){
    if (!requireLogin()) return;
    if(!confirm('Remover esta percepção do mapa e enviá-la para a Lixeira?'))return;
    const targetItem = items.find(x => x.id === id);
    if (owns(targetItem)) {
      const previous = clone(targetItem);
      targetItem.status = 'archived';
      targetItem.updated_at = new Date().toISOString();
      markPending(targetItem, previous);
      if (!persistDraft(targetItem)) { Object.assign(targetItem, previous); return; }
      renderLayers();
      renderItemsUI();
      status('⚡ Percepção movida para a Lixeira no dispositivo. Sincronizando...');
      syncSingleItemToSupabase(targetItem);
    } else return;
    window.PreditorTelemetry?.track('perception_archive',{perception_id:id});
  }

  async function restore(id){
    if (!requireLogin()) return;
    const targetItem = items.find(x => x.id === id);
    if (owns(targetItem)) {
      const previous = clone(targetItem);
      targetItem.status = 'submitted';
      targetItem.updated_at = new Date().toISOString();
      markPending(targetItem, previous);
      if (!persistDraft(targetItem)) { Object.assign(targetItem, previous); return; }
      renderLayers();
      showTab('active');
      renderItemsUI();
      status('⚡ Percepção restaurada no dispositivo. Sincronizando...');
      syncSingleItemToSupabase(targetItem);
    } else return;
    window.PreditorTelemetry?.track('perception_restore',{perception_id:id});
  }

  function editorIcon(kind,selected=false){
    if (kind === 'midpoint') {
      return L.divIcon({
        className: 'fcu-edit-marker-wrap',
        html: `<span class="fcu-edit-marker midpoint" title="Clique ou arraste para criar novo vértice nesta aresta">＋</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
    }
    return L.divIcon({className:'fcu-edit-marker-wrap',html:`<span class="fcu-edit-marker ${kind}${selected?' is-selected':''}"></span>`,iconSize:[24,24],iconAnchor:[12,12]});
  }
  function polygonCenter(){const sum=points.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]);return [sum[0]/points.length,sum[1]/points.length];}

  function renderEditor(){
    editHandles.clearLayers();
    if(draftLayer)map.removeLayer(draftLayer);
    draftLayer=L.polygon(points,{color:'#087d99',weight:3.5,fillColor:'#087d99',fillOpacity:.25,interactive:false}).addTo(map);

    points.forEach((p,index)=>{
      const isSelected = selectedVertex === index;
      const marker=L.marker(p,{draggable:true,icon:editorIcon('vertex',isSelected),zIndexOffset:isSelected?1400:1200}).addTo(editHandles);
      marker.bindTooltip(isSelected ? '📍 Vértice selecionado (Amarelo): arraste para mover ou clique em "- Excluir"' : '📍 Clique para selecionar / Arraste para mover', {direction:'top'});
      marker.on('click',e=>{L.DomEvent.stopPropagation(e);selectedVertex=index;renderEditor();});
      marker.on('drag',e=>{points[index]=[e.latlng.lat,e.latlng.lng];draftLayer.setLatLngs(points);});
      marker.on('dragend',()=>renderEditor());
    });

    points.forEach((p, i) => {
      const nextP = points[(i + 1) % points.length];
      const mid = [(p[0] + nextP[0]) / 2, (p[1] + nextP[1]) / 2];

      const midMarker = L.marker(mid, {
        draggable: true,
        icon: editorIcon('midpoint'),
        zIndexOffset: 1100
      }).addTo(editHandles);

      midMarker.bindTooltip('＋ Clique ou arraste para criar um novo vértice nesta aresta', { direction: 'top' });

      let insertedIndex = -1;

      midMarker.on('dragstart', () => {
        insertedIndex = i + 1;
        points.splice(insertedIndex, 0, [mid[0], mid[1]]);
        selectedVertex = insertedIndex;
      });

      midMarker.on('drag', e => {
        if (insertedIndex >= 0) {
          points[insertedIndex] = [e.latlng.lat, e.latlng.lng];
          draftLayer.setLatLngs(points);
        }
      });

      midMarker.on('dragend', () => renderEditor());

      midMarker.on('click', e => {
        L.DomEvent.stopPropagation(e);
        points.splice(i + 1, 0, [mid[0], mid[1]]);
        selectedVertex = i + 1;
        renderEditor();
      });
    });

    const center=polygonCenter(),base=points.map(p=>p.slice());
    const mover=L.marker(center,{draggable:true,icon:editorIcon('center'),zIndexOffset:1300}).addTo(editHandles);
    mover.bindTooltip('🖐️ Arraste para mover todo o polígono',{direction:'top'});
    mover.on('drag',e=>{const ll=e.target.getLatLng(),dy=ll.lat-center[0],dx=ll.lng-center[1];points=base.map(p=>[p[0]+dy,p[1]+dx]);draftLayer.setLatLngs(points);editHandles.eachLayer(layer=>{if(layer!==mover&&layer.dragging)layer.setOpacity(0);});});
    mover.on('dragend',()=>renderEditor());

    const remove=$('#fcu-remove-vertex');
    if(remove)remove.disabled=selectedVertex<0||points.length<=3;
  }

  function closeEditor(){geometryEditing=false;selectedVertex=-1;editHandles.clearLayers();if(draftLayer){map.removeLayer(draftLayer);draftLayer=null;}const bar=$('#fcu-geometry-toolbar');if(bar)bar.remove();}

  function beginGeometryEdit(record,isNew=false){
    if(!requireLogin())return;
    if(record && !owns(record))return;
    close();
    closeProfilePanel();
    geometryEditing=true;
    editingRecord=record?clone(record):null;
    editingId=record?record.id:null;
    if(record){
      draft={id:record.id,target_kind:record.target_kind||'polygon',action_type:record.action_type||'free',cell_id:record.cell_id,model_class:record.model_class,model_probability:record.model_probability,model_snapshot:record.model_snapshot||{},geometry_source:record.geometry_source||'user_polygon',geometry:record.geometry};
      drawingZoom=map.getZoom();
      points=normalizePoints(toPoints(record.geometry),drawingZoom);
    }
    originalPoints=points.map(p=>p.slice());
    const oldBar=$('#fcu-geometry-toolbar');
    if(oldBar)oldBar.remove();
    document.body.insertAdjacentHTML('beforeend',`
      <div class="fcu-geometry-toolbar" id="fcu-geometry-toolbar">
        <div>
          <strong>Editar ${drawingId(record?record.id:draft.id)}</strong>
          <span>Arraste os vértices (amarelo/azul), as alças (＋) ou o centro verde (🖐️).</span>
        </div>
        <div>
          <button id="fcu-add-vertex" type="button" title="Adicionar um novo ponto na maior aresta">＋ Ponto</button>
          <button id="fcu-remove-vertex" type="button" disabled title="Excluir vértice selecionado">− Excluir</button>
          <button id="fcu-editor-cancel" type="button" title="Restaurar formato inicial">↶ Restaurar</button>
          ${record?'<button id="fcu-editor-delete" type="button" class="is-danger" title="Excluir este desenho">🗑️ Excluir</button>':''}
          <button id="fcu-editor-ok" type="button" class="is-primary" title="Salvar contorno">✓ OK</button>
        </div>
      </div>
    `);

    const geomBar = $('#fcu-geometry-toolbar');
    if (geomBar) {
      if (window.L && L.DomEvent) {
        L.DomEvent.disableClickPropagation(geomBar);
        L.DomEvent.disableScrollPropagation(geomBar);
      }
      makeElementDraggable(geomBar, geomBar.querySelector('div') || geomBar);
    }

    $('#fcu-add-vertex').onclick=()=>{
      let best=0,bestDistance=-1;
      points.forEach((p,i)=>{
        const n=points[(i+1)%points.length],d=map.distance(p,n);
        if(d>bestDistance){best=i;bestDistance=d;}
      });
      const a=points[best],b=points[(best+1)%points.length];
      points.splice(best+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);
      selectedVertex=best+1;
      renderEditor();
    };
    $('#fcu-remove-vertex').onclick=()=>{
      if(selectedVertex>=0&&points.length>3){
        points.splice(selectedVertex,1);
        selectedVertex=-1;
        renderEditor();
      }
    };
    $('#fcu-editor-cancel').onclick=()=>{
      points=originalPoints.map(p=>p.slice());
      closeEditor();
      reset();
      if(record){open();load();}
    };
    if(record)$('#fcu-editor-delete').onclick=async()=>{closeEditor();reset();open();await archive(record.id);};
    $('#fcu-editor-ok').onclick=async()=>{
      if (!requireLogin() || (record && !owns(record)) || !draft) return;
      points=normalizePoints(points,drawingZoom);
      draft.geometry=toGeometry();
      if(isNew){closeEditor();showForm(null);return;}
      
      const recId = record.id;
      const targetItem = items.find(x => x.id === recId) || record;
      if (!owns(targetItem)) return;
      const previous = clone(targetItem);
      const historyList = Array.isArray(targetItem._history) ? [...targetItem._history] : [];
      const prevVer = targetItem.version_count || (historyList.length + 1);
      historyList.push({
        ...perceptionPayload(targetItem),
        version: prevVer,
        updated_at: targetItem.updated_at || targetItem.created_at || new Date().toISOString(),
        title: targetItem.title,
        perceived_class: targetItem.perceived_class,
        geometry: targetItem.geometry,
        description: targetItem.description
      });
      targetItem._history = historyList;
      targetItem.version_count = (targetItem.version_count || 1) + 1;
      targetItem.geometry = draft.geometry;
      targetItem.updated_at = new Date().toISOString();
      markPending(targetItem, editingRecord || previous);
      if (!persistDraft(targetItem)) { Object.assign(targetItem, previous); return; }
      renderLayers();
      closeEditor();
      reset();
      open();
      renderItemsUI();
      status(`⚡ Desenho ${drawingId(recId)} atualizado no dispositivo! Sincronizando...`);

      window.PreditorTelemetry?.track('perception_geometry_update',{perception_id:recId},{area:areaId(),cellId:record.cell_id});
      syncSingleItemToSupabase(targetItem);
    };
    editHandles.addTo(map);
    renderEditor();
    map.fitBounds(draftLayer.getBounds(),{padding:[50,50]});
  }

  function renderUserProfileTab() {
    const container = $('#fcu-account-content');
    if (!container) return;
    const u = user();
    if (!u) {
      container.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px 24px;background:#ffffff;border:1px solid #cfdee5;border-radius:18px;box-shadow:0 8px 24px rgba(7,50,77,0.05);">
          <h3 style="margin:0 0 8px;color:#07324d;font-size:22px;font-weight:800;">Acesso à Conta Necessário</h3>
          <p style="margin:0 auto 24px;color:#617989;font-size:14px;max-width:520px;line-height:1.5;">Para visualizar seu perfil, alterar sua senha de acesso e baixar suas percepções formatadas para o QGIS, entre com sua conta ou faça um cadastro gratuito.</p>
          <button id="fcu-acc-login-btn-card" type="button" class="fcu-acc-submit-btn" style="max-width:260px;margin:0 auto;display:block;padding:12px 24px;font-size:14px;border-radius:99px;">
            🔑 Entrar / Criar Conta
          </button>
        </div>
      `;
      if ($('#fcu-acc-login-btn-card')) {
        $('#fcu-acc-login-btn-card').onclick = () => {
          closeProfilePanel();
          requireLogin();
        };
      }
      return;
    }
    const meta = u.user_metadata || {};
    const fullName = meta.full_name || u.email || 'Participante';
    const email = u.email || '';
    const institution = meta.institution || 'Não informada';
    const initials = (fullName.split(' ').map(n=>n[0]).slice(0,2).join('') || 'U').toUpperCase();
    const userActiveCount = items.filter(x => owns(x) && x.status !== 'archived').length;

    container.innerHTML = `
      <!-- CARD 1: PERFIL DO PARTICIPANTE -->
      <article class="fcu-account-card">
        <div>
          <div class="fcu-account-card-head">
            <h3 class="fcu-account-card-title">👤 Perfil do Participante</h3>
            <span class="fcu-sync-badge is-synced">✓ Conta Ativa</span>
          </div>
          <p class="fcu-account-card-desc">Informações de cadastro e estatísticas do participante no Preditor FCU.</p>
          <div class="fcu-acc-user-profile">
            <div class="fcu-acc-user-avatar">${initials}</div>
            <div class="fcu-acc-user-info">
              <h3>${esc(fullName)}</h3>
              <p>${esc(email)}</p>
              <small>Instituição: ${esc(institution)}</small>
            </div>
          </div>
          <div class="fcu-acc-user-stats">
            <div class="fcu-acc-stat-box">
              <span class="fcu-acc-stat-val">${userActiveCount}</span>
              <span class="fcu-acc-stat-lbl">Percepções Mapeadas</span>
            </div>
            <div class="fcu-acc-stat-box">
              <span class="fcu-acc-stat-val">Local-First</span>
              <span class="fcu-acc-stat-lbl">Modo de Sincronização</span>
            </div>
          </div>
        </div>
        <button id="fcu-profile-logout" type="button" class="fcu-acc-logout-btn" title="Encerrar sessão nesta máquina">
          🚪 Sair da conta (Logout)
        </button>
      </article>

      <!-- CARD 2: CADASTRO EXPANDIDO DO PARTICIPANTE (ESTUDOS FUTUROS) -->
      <article class="fcu-account-card">
        <div>
          <div class="fcu-account-card-head">
            <h3 class="fcu-account-card-title">📝 Dados de Contato & Pesquisa</h3>
            <span class="fcu-qgis-attr-tag">Para Estudos SIG</span>
          </div>
          <p class="fcu-account-card-desc">Complemente suas informações para vincular autorias e contatos aos pacotes exportados para o QGIS em futuras pesquisas acadêmicas ou projetos técnicos.</p>
          <form id="fcu-user-meta-form">
            <div class="fcu-qgis-filter-grid">
              <label class="fcu-qgis-field">Nome Completo
                <input name="full_name" type="text" value="${esc(meta.full_name || '')}" placeholder="Seu nome completo" required>
              </label>

              <label class="fcu-qgis-field">E-mail Principal (Acesso)
                <input type="email" value="${esc(email)}" disabled style="background:#f1f5f9;color:#64748b;">
              </label>

              <label class="fcu-qgis-field">Telefone / WhatsApp (com DDD)
                <input name="whatsapp" type="tel" value="${esc(meta.whatsapp || '')}" placeholder="(00) 90000-0000">
              </label>

              <label class="fcu-qgis-field">E-mail Secundário / Acadêmico
                <input name="secondary_email" type="email" value="${esc(meta.secondary_email || '')}" placeholder="voce@universidade.edu.br">
              </label>

              <label class="fcu-qgis-field">Instituição / Organização / Vínculo
                <input name="institution" type="text" value="${esc(meta.institution || '')}" placeholder="Ex.: UFABC, Prefeitura, Coletivo...">
              </label>

              <label class="fcu-qgis-field">Município de Residência / Atuação
                <input name="municipality" type="text" value="${esc(meta.municipality || '')}" placeholder="Ex.: Salvador / BA, Belém / PA">
              </label>

              <label class="fcu-qgis-field">Perfil / Atuação Profissional
                <select name="profile_role">
                  <option value="pesquisador" ${meta.profile_role==='pesquisador'?'selected':''}>Pesquisador / Acadêmico</option>
                  <option value="gestor_publico" ${meta.profile_role==='gestor_publico'?'selected':''}>Gestor Público / Planejador Urbano</option>
                  <option value="lideranca_comunitaria" ${meta.profile_role==='lideranca_comunitaria'?'selected':''}>Liderança Comunitária / Morador</option>
                  <option value="profissional_sig" ${meta.profile_role==='profissional_sig'?'selected':''}>Profissional de SIG / Geotecnologia</option>
                  <option value="estudante" ${meta.profile_role==='estudante'?'selected':''}>Estudante Universitário</option>
                  <option value="outro" ${meta.profile_role==='outro'?'selected':''}>Outra atuação</option>
                </select>
              </label>

              <label class="fcu-qgis-field">Tempo de Atuação no Território
                <select name="territory_experience">
                  <option value="menos_2_anos" ${meta.territory_experience==='menos_2_anos'?'selected':''}>Menos de 2 anos</option>
                  <option value="2_a_5_anos" ${meta.territory_experience==='2_a_5_anos'?'selected':''}>2 a 5 anos</option>
                  <option value="5_a_10_anos" ${meta.territory_experience==='5_a_10_anos'?'selected':''}>5 a 10 anos</option>
                  <option value="mais_10_anos" ${meta.territory_experience==='mais_10_anos'||!meta.territory_experience?'selected':''}>Mais de 10 anos / Nativo da região</option>
                </select>
              </label>
            </div>

            <button class="fcu-acc-submit-btn" type="submit" style="margin-top:10px;">💾 Salvar Dados do Participante</button>
            <p id="fcu-meta-status" class="fcu-perception-status" style="margin-top:8px;"></p>
          </form>
        </div>
      </article>

      <!-- CARD 2: CENTRAL DE EXPORTAÇÃO SIG/QGIS -->
      <article class="fcu-account-card">
        <div>
          <div class="fcu-account-card-head">
            <h3 class="fcu-account-card-title">🗺️ Central de Exportação QGIS / SIG</h3>
            <span class="fcu-qgis-attr-tag">GeoPackage (.gpkg) / GeoJSON</span>
          </div>
          <p class="fcu-account-card-desc">Baixe todas as suas percepções territoriais prontas para uso em SIG com atributos completos de área (ha), perímetro (km), vértices, validação e datas.</p>

          <div class="fcu-qgis-filter-grid">
            <label class="fcu-qgis-field">Formato do Arquivo
              <select id="fcu-exp-format">
                <option value="gpkg" selected>GeoPackage / QGIS (.gpkg)</option>
                <option value="geojson">GeoJSON / QGIS (.geojson)</option>
                <option value="json">GeoJSON (.json)</option>
              </select>
            </label>

            <label class="fcu-qgis-field">Filtrar por UF / Estado
              <select id="fcu-exp-uf">
                <option value="all">Todas as UFs</option>
                <option value="BA">Bahia (BA)</option>
                <option value="PE">Pernambuco (PE)</option>
                <option value="SP">São Paulo (SP)</option>
                <option value="PA">Pará (PA)</option>
                <option value="PR">Paraná (PR)</option>
                <option value="CE">Ceará (CE)</option>
                <option value="SE">Sergipe (SE)</option>
                <option value="AL">Alagoas (AL)</option>
              </select>
            </label>

            <label class="fcu-qgis-field">Área de Estudo / Município
              <select id="fcu-exp-area">
                <option value="all">Todas as áreas</option>
                <option value="belem">Belém / PA</option>
                <option value="sao_paulo">São Paulo / SP</option>
                <option value="campinas">Campinas / SP</option>
                <option value="curitiba">Curitiba / PR</option>
                <option value="salvador">Salvador / BA</option>
                <option value="fortaleza">Fortaleza / CE</option>
                <option value="aracaju">Aracaju / SE</option>
              </select>
            </label>

            <label class="fcu-qgis-field">Leitura / Classe
              <select id="fcu-exp-class">
                <option value="all">Todas as leituras</option>
                ${CLASS_KEYS.map(k => `<option value="${k}">${LABEL[k]}</option>`).join('')}
              </select>
            </label>

            <label class="fcu-qgis-field">Status dos Polígonos
              <select id="fcu-exp-status">
                <option value="active">Apenas Ativas (Mapa)</option>
                <option value="archived">Apenas Lixeira / Arquivadas</option>
                <option value="all">Todas (Ativas + Lixeira)</option>
              </select>
            </label>

            <label class="fcu-qgis-field">Período de Registro
              <select id="fcu-exp-period">
                <option value="all">Todo o histórico</option>
                <option value="30days">Últimos 30 dias</option>
                <option value="7days">Últimos 7 dias</option>
              </select>
            </label>
          </div>

          <div class="fcu-qgis-counter-banner">
            <span id="fcu-qgis-match-count">📦 ${userActiveCount} percepção(ões) pronta(s)</span>
            <span style="font-size:11px;font-weight:600;color:#0284c7;">Atributos geométricos calculados</span>
          </div>
        </div>
        <button class="fcu-qgis-dl-btn" id="fcu-do-export-qgis" type="button">
          ⬇️ Baixar Pacote QGIS (SIG)
        </button>
      </article>

      <!-- CARD 3: ALTERAR SENHA -->
      <article class="fcu-account-card">
        <div>
          <div class="fcu-account-card-head">
            <h3 class="fcu-account-card-title">🔒 Alterar Senha de Acesso</h3>
          </div>
          <p class="fcu-account-card-desc">Atualize sua senha de acesso a qualquer momento. A nova senha deve ter no mínimo 6 dígitos.</p>
          <form id="fcu-pwd-form">
            <div class="fcu-acc-field">
              <label for="fcu-new-pwd-input">Nova senha de acesso (mínimo 6 dígitos)</label>
              <input id="fcu-new-pwd-input" type="password" name="new_pwd" minlength="6" required placeholder="Preencha sua nova senha (mínimo 6 dígitos)">
            </div>
            <button class="fcu-acc-submit-btn" type="submit">Atualizar minha senha</button>
            <p id="fcu-pwd-status" class="fcu-perception-status" style="margin-top:10px;"></p>
          </form>
        </div>
      </article>

      <!-- CARD 4: AVALIAÇÃO DA PLATAFORMA -->
      <article class="fcu-account-card">
        <div>
          <div class="fcu-account-card-head">
            <h3 class="fcu-account-card-title">⭐ Avaliar o Preditor FCU</h3>
          </div>
          <p class="fcu-account-card-desc">Sua avaliação é importante para melhorarmos a facilidade de uso e as funcionalidades de GIS.</p>
          <div class="fcu-acc-stars" id="fcu-rating-stars">
            <span class="fcu-acc-star" data-val="1">★</span>
            <span class="fcu-acc-star" data-val="2">★</span>
            <span class="fcu-acc-star" data-val="3">★</span>
            <span class="fcu-acc-star" data-val="4">★</span>
            <span class="fcu-acc-star" data-val="5">★</span>
          </div>
          <textarea id="fcu-rating-text" class="fcu-acc-textarea" rows="3" placeholder="Deixe uma sugestão ou comentário sobre a ferramenta (opcional)..."></textarea>
          <button class="fcu-acc-submit-btn" id="fcu-send-rating" type="button">Enviar minha avaliação</button>
          <p id="fcu-rating-st" class="fcu-perception-status" style="margin-top:10px;"></p>
        </div>
      </article>
    `;

    if ($('#fcu-user-meta-form')) {
      $('#fcu-user-meta-form').onsubmit = async e => {
        e.preventDefault();
        const f = e.target, v = new FormData(f);
        status('Salvando dados do participante...', false, '#fcu-meta-status');
        const updatedData = {
          full_name: String(v.get('full_name') || '').trim(),
          whatsapp: String(v.get('whatsapp') || '').trim(),
          secondary_email: String(v.get('secondary_email') || '').trim(),
          institution: String(v.get('institution') || '').trim(),
          municipality: String(v.get('municipality') || '').trim(),
          profile_role: String(v.get('profile_role') || 'pesquisador'),
          territory_experience: String(v.get('territory_experience') || 'mais_10_anos')
        };
        const res = await db.auth.updateUser({ data: updatedData });
        if (res.error) return status('Não foi possível salvar o perfil: ' + res.error.message, true, '#fcu-meta-status');
        if (res.data && res.data.user) {
          window.PreditorAuth.user = res.data.user;
        }
        window.PreditorTelemetry?.track('profile_metadata_update');
        status('✓ Dados do participante salvos com sucesso! Serão vinculados às suas percepções no QGIS.', false, '#fcu-meta-status');
      };
    }

    if ($('#fcu-profile-logout')) {
      $('#fcu-profile-logout').onclick = async () => {
        if (confirm('Deseja realmente sair da sua conta?')) {
          status('Saindo da conta...', false);
          await db.auth.signOut();
          closeProfilePanel();
          window.location.reload();
        }
      };
    }

    $('#fcu-pwd-form').onsubmit = async e => {
      e.preventDefault();
      const p = e.target.elements.new_pwd.value.trim();
      if(!p || p.length < 6) return status('A senha precisa ter 6 dígitos ou mais.', true, '#fcu-pwd-status');
      status('Atualizando senha...', false, '#fcu-pwd-status');
      const res = await db.auth.updateUser({ password: p, data: { must_change_password: false } });
      if(res.error) {
        let errMsg = res.error.message || '';
        if (errMsg.includes('Password should be at least') || errMsg.includes('at least 6 characters')) {
          errMsg = 'A senha deve ter no mínimo 6 dígitos.';
        }
        return status('Não foi possível alterar a senha: ' + errMsg, true, '#fcu-pwd-status');
      }
      window.PreditorTelemetry?.track('profile_password_update');
      status('✓ Senha alterada com sucesso!', false, '#fcu-pwd-status');
      e.target.reset();
    };

    $('#fcu-do-export-qgis').onclick = () => {
      exportGeoJSONWithFilters({
        format: $('#fcu-exp-format')?.value || 'geojson',
        uf: $('#fcu-exp-uf')?.value || 'all',
        area: $('#fcu-exp-area')?.value || 'all',
        perceived_class: $('#fcu-exp-class')?.value || 'all',
        status: $('#fcu-exp-status')?.value || 'active',
        period: $('#fcu-exp-period')?.value || 'all'
      });
    };

    let ratingVal = 0;
    container.querySelectorAll('.fcu-acc-star').forEach(star => {
      star.onclick = () => {
        ratingVal = Number(star.dataset.val);
        container.querySelectorAll('.fcu-acc-star').forEach(s => s.classList.toggle('is-selected', Number(s.dataset.val) <= ratingVal));
      };
    });

    $('#fcu-send-rating').onclick = async () => {
      if(!ratingVal) return status('Selecione uma nota de 1 a 5 estrelas.', true, '#fcu-rating-st');
      const txt = $('#fcu-rating-text').value.trim();
      status('Enviando avaliação...', false, '#fcu-rating-st');
      try {
        await db.from('fcu_user_messages').insert({
          user_id: u.id,
          message_type: 'rating',
          subject: `Avaliação: ${ratingVal}/5 estrelas`,
          content: `Nota: ${ratingVal}/5 estrelas.\nComentário: ${txt || 'Sem comentário.'}`,
          metadata: { rating: ratingVal, comment: txt }
        });
      } catch (_) {}
      window.PreditorTelemetry?.track('platform_rating_submit', { rating: ratingVal });
      status('✓ Obrigado por avaliar o Preditor FCU!', false, '#fcu-rating-st');
    };
  }

  function edit(r){if(!requireLogin()||!owns(r))return;editingId=r.id;editingRecord=clone(r);draft={target_kind:r.target_kind||'polygon',action_type:r.action_type||'free',cell_id:r.cell_id,model_class:r.model_class,model_probability:r.model_probability,model_snapshot:r.model_snapshot||{},geometry_source:r.geometry_source||'user_polygon',geometry:r.geometry};points=toPoints(r.geometry);showForm(r.perceived_class||(r.perception_types||[])[0],r);}
  function showTab(tab){
    const list = $('#fcu-perception-list');
    const history = $('#fcu-perception-history');
    if (list) list.hidden = tab !== 'active';
    if (history) history.hidden = tab !== 'history';
    document.querySelectorAll('#fcu-perception-panel [data-tab]').forEach(n=>n.classList.toggle('is-active',n.dataset.tab===tab));
  }
  function style(r){const k=r.perceived_class||(r.perception_types||[])[0]||'outro';return {color:COLOR[k],weight:r.action_type==='reclassify'?3:2,dashArray:r.action_type==='reclassify'?'7 5':null,fillOpacity:.18};}
  function buildPolygonPopupHTML(r) {
    const u = user();
    const isMine = u && (r.user_id === u.id);
    const k = r.perceived_class || (r.perception_types || [])[0] || 'outro';
    const coords = (r.geometry && r.geometry.coordinates && r.geometry.coordinates[0]) || [];
    const geomStats = calculatePolygonAreaAndPerimeter(coords);
    const dateStr = new Date(r.created_at).toLocaleDateString('pt-BR');
    const authorText = isMine ? 'Sua percepção' : 'Participante / Master';
    const authorBg = isMine ? '#e0f2fe' : '#f1f5f9';
    const authorColor = isMine ? '#0369a1' : '#475569';

    return `
      <div class="fcu-polygon-popup-card" style="min-width:220px;font-family:sans-serif;padding:4px 2px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:800;color:#087d99;">Desenho ${drawingId(r.id)}</span>
          <span style="background:${authorBg};color:${authorColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${authorText}</span>
        </div>
        <h4 style="margin:0 0 4px;font-size:14px;font-weight:800;color:#07324d;">${esc(r.title)}</h4>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <i style="width:12px;height:12px;border-radius:50%;background:${COLOR[k]};display:inline-block;"></i>
          <span style="font-size:12px;font-weight:700;color:#334155;">${LABEL[k] || k}</span>
          <small style="font-size:11px;color:#64748b;margin-left:auto;">(${ACTION[r.action_type || 'free']})</small>
        </div>
        <div style="font-size:11px;color:#475569;line-height:1.4;margin-bottom:10px;background:#f8fafc;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0;">
          📅 Registrado em: ${dateStr}<br>
          📐 Área: <strong>${geomStats.areaHa} ha</strong> · Perímetro: <strong>${geomStats.perimKm} km</strong> (${geomStats.numVertices} vértices)
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button type="button" data-pop-shape="${esc(r.id)}" style="padding:7px 8px;font-weight:700;font-size:11px;color:#ffffff;background:#087d99;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">📐 Editar área</button>
          <button type="button" data-pop-edit="${esc(r.id)}" style="padding:7px 8px;font-weight:700;font-size:11px;color:#0f172a;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">✏️ Editar dados</button>
        </div>
      </div>
    `;
  }

  function renderLayers(){
    const currentMap = app().map || map;
    if (currentMap && !currentMap.hasLayer(layers) && filters.visible) {
      layers.addTo(currentMap);
    }
    layers.clearLayers();
    layerById.clear();
    items.filter(r=>owns(r)&&r.status!=='archived').forEach(r=>{
      const k=r.perceived_class||(r.perception_types||[])[0]||'outro';
      if(!filters.classes.has(k)||!filters.actions.has(r.action_type||'free'))return;
      const pts=toPoints(r.geometry);
      if(pts.length<3)return;
      const l=L.polygon(pts,style(r))
        .bindTooltip(`Desenho ${drawingId(r.id)} · ${LABEL[k]||k}`)
        .bindPopup(buildPolygonPopupHTML(r), { maxWidth: 300 })
        .addTo(layers);

      l.on('popupopen', (e) => {
        const popupNode = e.popup.getElement();
        if (!popupNode) return;
        const btnShape = popupNode.querySelector('[data-pop-shape]');
        const btnEdit = popupNode.querySelector('[data-pop-edit]');
        if (btnShape) {
          btnShape.onclick = (evt) => {
            if (evt) { evt.preventDefault(); evt.stopPropagation(); }
            currentMap.closePopup();
            beginGeometryEdit(r);
          };
        }
        if (btnEdit) {
          btnEdit.onclick = (evt) => {
            if (evt) { evt.preventDefault(); evt.stopPropagation(); }
            currentMap.closePopup();
            edit(r);
          };
        }
      });

      layerById.set(r.id,l);
    });
  }

  function card(r,count){
    const archived=r.status==='archived',k=r.perceived_class||(r.perception_types||[])[0]||'outro',c=document.createElement('article');
    c.className='fcu-perception-item'+(archived?' is-archived':'');
    c.setAttribute('data-id', r.id);
    const u = user();
    const isMine = u && (r.user_id === u.id);
    const authorBadge = isMine 
      ? '<span class="fcu-author-badge is-mine" style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-left:4px;">Sua percepção</span>'
      : '<span class="fcu-author-badge is-other" style="background:#f1f5f9;color:#475569;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-left:4px;">Participante / Master</span>';

    const syncBadge = r._sync_status === 'synced'
      ? '<span class="fcu-sync-badge is-synced" title="Gravação confirmada pelo servidor">✓ Sincronizado</span>'
      : `<span class="fcu-sync-badge is-local">${r._sync_status === 'conflict' ? 'Versões diferentes · revisar' : '⚡ No dispositivo'}</span>`;
    const conflictHtml = r._sync_status === 'conflict' ? '<p style="font-size:12px;color:#92400e;">Este desenho mudou em outro acesso ou sua gravação anterior não pôde ser confirmada. Sua versão está preservada aqui.</p><button type="button" data-conflict-copy>Preservar minha versão como cópia</button>' : '';

    const versionCount = Math.max(count || 1, r.version_count || 1);
    const versionText = `${versionCount} ${versionCount === 1 ? 'versão' : 'versões'}`;
    const dateStr = new Date(r.created_at).toLocaleDateString('pt-BR');

    let versionHistoryHtml = '';
    if (versionCount > 1 && Array.isArray(r._history) && r._history.length > 0) {
      versionHistoryHtml = `
        <details class="fcu-version-history-details" style="margin-top:6px;font-size:11px;color:#475569;background:#f8fafc;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0;">
          <summary style="cursor:pointer;font-weight:700;color:#087d99;">📜 Histórico de Edições (${versionCount} versões)</summary>
          <ul style="margin:6px 0 0;padding-left:14px;line-height:1.5;">
            <li style="font-weight:700;color:#0369a1;">v${versionCount} (Atual) · ${LABEL[k] || k} · ${new Date(r.updated_at || r.created_at).toLocaleDateString('pt-BR')}</li>
            ${r._history.slice().reverse().map(h => `
              <li>v${h.version} · ${LABEL[h.perceived_class] || h.perceived_class || 'Edição'} · ${new Date(h.updated_at || r.created_at).toLocaleDateString('pt-BR')}</li>
            `).join('')}
          </ul>
        </details>
      `;
    }

    c.innerHTML=`<span class="fcu-card-id">Desenho ${drawingId(r.id)} ${authorBadge} ${syncBadge}</span><div class="fcu-item-top"><i style="--fcu-color:${COLOR[k]}"></i><div><strong>${esc(r.title)}</strong><small>${ACTION[r.action_type||'free']} · ${LABEL[k]}</small></div></div><small>${dateStr} · <strong style="color:#07324d;">${versionText}</strong></small>${versionHistoryHtml}${conflictHtml}<div class="fcu-perception-item-actions"><button data-view>Ver no mapa</button>${archived?'<button data-restore>Restaurar</button>':'<button data-shape>Editar área</button><button data-edit>Editar dados</button><button data-archive>Excluir</button>'}</div>`;
    const conflictButton = c.querySelector('[data-conflict-copy]');
    if (conflictButton) conflictButton.onclick = () => preserveConflictCopy(r.id);
    const badgeEl = c.querySelector('.fcu-sync-badge');
    if (badgeEl && r._sync_status === 'pending') {
      badgeEl.className = 'fcu-sync-badge is-local fcu-sync-clickable';
      badgeEl.title = 'Toque para sincronizar com o servidor agora';
      badgeEl.innerHTML = '⚡ No dispositivo <small style="font-weight:700;">(Sincronizar 🔄)</small>';
      badgeEl.onclick = async (e) => {
        e.stopPropagation();
        badgeEl.textContent = '⏳ Sincronizando...';
        const ok = await syncSingleItemToSupabase(r);
        if (ok) status('✓ Percepção sincronizada com o servidor!');
        else {
          status('Tentando reconectar... Seus dados continuam salvos no dispositivo.', true);
          updateListBadges();
        }
      };
    }
    c.querySelector('[data-view]').onclick=()=>{if(!owns(r))return;const temp=L.polygon(toPoints(r.geometry),style(r));close();const l=layerById.get(r.id)||temp.addTo(map);map.fitBounds(l.getBounds(),{padding:[30,30]});if(!layerById.has(r.id))setTimeout(()=>map.hasLayer(temp)&&map.removeLayer(temp),8000);};
    if(archived)c.querySelector('[data-restore]').onclick=()=>restore(r.id);
    else{c.querySelector('[data-shape]').onclick=()=>beginGeometryEdit(r);c.querySelector('[data-edit]').onclick=()=>edit(r);c.querySelector('[data-archive]').onclick=()=>archive(r.id);}
    return c;
  }

  function renderItemsUI(counts = {}) {
    const list = $('#fcu-perception-list');
    const history = $('#fcu-perception-history');
    if (!list || !history) return;

    const active = items.filter(x => owns(x) && x.status !== 'archived');
    const trash = items.filter(x => owns(x) && x.status === 'archived');

    list.innerHTML = active.length ? '' : '<p>Nenhuma percepção registrada no momento.</p>';
    history.innerHTML = trash.length ? '' : '<p>A lixeira está vazia.</p>';

    active.forEach(x => list.appendChild(card(x, counts[x.id] || 1)));
    trash.forEach(x => history.appendChild(card(x, counts[x.id] || 1)));
  }

  async function preserveConflictCopy(recordId) {
    const id = ownerId(), epoch = accountEpoch, c = client();
    if (!id || !c) return;
    try {
      const row = await c.from('fcu_perceptions').select('*').eq('id', recordId).eq('user_id', id).maybeSingle();
      if (!sameAccount(id, epoch) || row.error) return status('Não foi possível consultar a versão online. Tente novamente; sua versão continua salva.', true);
      const list = getLocalItems(id), original = list.find(x => x.id === recordId);
      if (!original || original._sync_status !== 'conflict' || (row.data && !owns(row.data, id))) return;
      const copyTitle = value => String(value || 'Percepção').slice(0, 100) + ' (cópia preservada)';
      const copy = { ...clone(original), id: generateUUID(), title: copyTitle(original.title),
        _conflict: null, _sync_status: 'pending', _server_updated_at: null, _server_version_count: 0, _local_revision: generateUUID(),
        created_at: new Date().toISOString(), _conflict_origin_id: recordId };
      copy._pending_versions = pendingOperations(original).map(op => ({ revision: generateUUID(), payload: {
        ...op.payload, id: copy.id, title: copyTitle(op.payload.title), created_at: copy.created_at
      } }));
      copy.version_count = copy._pending_versions.length;
      const replacement = row.data ? { ...row.data, _server_updated_at: row.data.updated_at, _sync_status: 'synced', _history: original._history || [] } :
        { ...original, status: 'archived', _sync_status: 'local_only', _conflict: null };
      setLocalItems([copy, ...list.map(x => x.id === recordId ? replacement : x)], id);
      refreshCachedUI(id);
      status('As versões foram preservadas separadamente. Sincronizando a cópia...');
      await syncSingleItemToSupabase(copy);
    } catch (_) { status('Não foi possível preservar a cópia agora. O desenho original continua salvo neste dispositivo.', true); }
  }

  async function readAllOwned(c, table, fields, id, epoch, orderBy) {
    const rows = [], pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      if (!sameAccount(id, epoch)) throw new Error('Account changed');
      const result = await c.from(table).select(fields).eq('user_id', id).order(orderBy, { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
      if (result.error || !Array.isArray(result.data)) throw new Error('Read unavailable');
      if (!sameAccount(id, epoch)) throw new Error('Account changed');
      rows.push(...result.data.filter(x => owns(x, id)));
      if (result.data.length < pageSize) return rows;
    }
  }

  function resetForAccount(id) {
    if (loadedOwner === id) return;
    loadedOwner = id;
    accountEpoch++;
    items = [];
    layers.clearLayers();
    layerById.clear();
    // A saved draft remains in its owner's cache; unfinished forms must never
    // become another participant's new perception after switching accounts.
    if (map) { closeEditor(); reset(); }
    closeProfilePanel();
    const profile = $('#fcu-account-content');
    if (profile) profile.innerHTML = '';
    renderItemsUI();
  }

  async function load(){
    const list=$('#fcu-perception-list'),history=$('#fcu-perception-history');
    if(!list)return;
    const uId = ownerId();
    resetForAccount(uId);
    const epoch = accountEpoch, sequence = ++loadSequence;
    if(!uId){
      items=[];
      renderLayers();
      list.innerHTML='<p>Entre para consultar as percepções.</p>';
      history.innerHTML='<p>Entre para consultar a Lixeira.</p>';
      return;
    }

    try {
      items = getLocalItems(uId);
      const requestedLocal = new Map(items.map(x => [x.id, x]));
      renderLayers();
      renderItemsUI();
      const c = client();
      if (c) {
        const serverRows = await readAllOwned(c, 'fcu_perceptions', '*', uId, epoch, 'created_at');
        if (sameAccount(uId, epoch) && sequence === loadSequence) {
          let versions = [];
          try {
            versions = await readAllOwned(c, 'fcu_perception_versions', 'id,user_id,perception_id,version,title,perceived_class,perception_types,geometry,description,recorded_at,status,intensity,confidence,time_reference,knowledge_sources,field_validation,field_visit_date,model_snapshot,action_type,cell_id', uId, epoch, 'version');
          } catch (_) { /* Existing local history is kept if history fetch fails. */ }
          if (!sameAccount(uId, epoch) || sequence !== loadSequence) return;
          const counts = {};
          versions.forEach(v => counts[v.perception_id] = Math.max(counts[v.perception_id] || 0, v.version));
          const histories = new Map();
          versions.forEach(v => {
            if (v.version === counts[v.perception_id]) return;
            if (!histories.has(v.perception_id)) histories.set(v.perception_id, []);
            histories.get(v.perception_id).push({ ...v, _source: 'server', updated_at: v.recorded_at });
          });
          // Re-read after awaits: a local save may have happened during loading.
          const localMap = new Map(getLocalItems(uId).map(x => [x.id, x]));
          serverRows.forEach(serverItem => {
            const existing = localMap.get(serverItem.id);
            const serverCount = counts[serverItem.id] || existing?._server_version_count || 1;
            const queuedCount = existing && existing._sync_status !== 'synced' ? pendingOperations(existing).length : 0;
            const metadata = { _history: mergeHistory(existing?._history || [], histories.get(serverItem.id) || []),
              _server_version_count: serverCount, version_count: serverCount + queuedCount };
            const responseIsOlder = existing && Date.parse(existing._server_updated_at) > Date.parse(serverItem.updated_at);
            if (existing && (existing._sync_status !== 'synced' || responseIsOlder)) {
              localMap.set(serverItem.id, { ...existing, ...metadata });
            } else localMap.set(serverItem.id, { ...existing, ...serverItem, ...metadata, _server_updated_at: serverItem.updated_at, _sync_status: 'synced' });
          });
          const serverIds = new Set(serverRows.map(x => x.id));
          localMap.forEach((x, id) => {
            const beforeRead = requestedLocal.get(id);
            if (!serverIds.has(id) && x._sync_status === 'synced' && beforeRead?._sync_status === 'synced' && x._server_updated_at === beforeRead._server_updated_at) {
              localMap.set(id, { ...x, _sync_status: 'conflict', _conflict: null });
            }
          });
          const mergedList = Array.from(localMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          setLocalItems(mergedList, uId);
          items = mergedList;
          renderLayers();
          renderItemsUI(counts);
        }
      }
    } catch (_) { if (sameAccount(uId, epoch)) status('Não foi possível atualizar a nuvem agora. Os desenhos locais foram preservados.', true); }
    
    syncPendingItems();
  }

  function init(){
    map=app().map;
    db=client();
    if(!map||!build())return false;
    layers.addTo(map);
    const container=map.getContainer();
    container.addEventListener('pointerdown',pointerDown,true);
    container.addEventListener('pointermove',pointerMove,true);
    container.addEventListener('pointerup',pointerUp,true);
    map.on('dblclick', e => {
      if (drawing && drawingMode === 'vertices' && points.length >= 3) {
        L.DomEvent.stopPropagation(e);
        finish();
      }
    });
    const c = client();
    if (c && c.auth) {
      c.auth.onAuthStateChange((_event, session)=>{
        authOwner = session && session.user && session.user.id || null;
        resetForAccount(authOwner);
        setTimeout(()=>{load();renderLegendControl();syncPendingItems();},0);
      });
    }
    load();
    syncPendingItems();
    
    window.addEventListener('online', () => load());
    window.addEventListener('focus', () => load());
    window.addEventListener('storage', event => { if (ownerId() && event.key === cacheKey(ownerId())) load(); });
    setInterval(() => syncPendingItems(), 15000);
    setInterval(() => { if (!document.hidden && !drawing && !geometryEditing && ownerId()) load(); }, 60000);

    setInterval(()=>{
      const id=String((sample()||{}).id||'');
      if(id!==lastCell){
        lastCell = id;
        if($('#fcu-perception-panel').classList.contains('is-open')) renderContext();
      }
      renderLegendControl();
    },250);

    window.PreditorPerception = {
      open: () => open(false),
      openForCell: () => open(true),
      notifyCellSelected: notifyCellSelected,
      close: close,
      openProfile: openProfilePanel,
      closeProfile: closeProfilePanel,
      exportQGIS: exportGeoJSONWithFilters,
      syncNow: syncPendingItems,
      isDrawing: () => drawing || geometryEditing,
      isOpen: () => $('#fcu-perception-panel') && $('#fcu-perception-panel').classList.contains('is-open'),
      renderLegendControl: renderLegendControl
    };

    return true;
  }
  let tries=0;
  const timer=setInterval(()=>{tries++;if(init()||tries>120)clearInterval(timer);},250);
})();
