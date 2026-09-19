/* Presentation only. Authentication, ownership and synchronization remain in their modules. */
(function () {
  'use strict';
  const KEY = 'preditor_fcu_view_mode_v1';
  const compactViewport = window.matchMedia('(max-width: 1024px)');
  const $ = selector => document.querySelector(selector);
  const icons = {
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg>',
    perception: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 13-3 4 13-13 5L4 6Zm6 7h6m-3-3v6"/><circle cx="4" cy="6" r="2"/><circle cx="17" cy="3" r="2"/><circle cx="21" cy="16" r="2"/><circle cx="8" cy="21" r="2"/></svg>',
    account: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>'
  };
  let preference = readPreference();
  let simple = false;
  let sheet = null;
  let sheetState = 'half';
  let previousFormVisible = false;
  let syncError = '';

  function readPreference() {
    try {
      const value = (window.rfSafeStorage || window.localStorage).getItem(KEY);
      return value === 'simple' || value === 'complete' ? value : null;
    } catch (_) { return null; }
  }

  function resizeMap() {
    const app = window.PreditorApp || window.App;
    if (app && app.map) app.map.invalidateSize({ pan: true, animate: false, debounceMoveend: true });
  }

  function chooseMode(mode, persist) {
    if (persist && window.PreditorPerception?.isDrawing()) return;
    const currentMap = (window.PreditorApp || window.App)?.map;
    const view = currentMap ? { center: currentMap.getCenter(), zoom: currentMap.getZoom() } : null;
    if (persist) {
      preference = mode;
      try { (window.rfSafeStorage || window.localStorage).setItem(KEY, mode); } catch (_) {}
    }
    simple = mode === 'simple';
    document.body.classList.toggle('fcu-mobile-simple', simple);
    document.querySelectorAll('[data-fcu-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.fcuMode === mode));
    });
    if (simple) {
      // Leaving expanded-map mode must not conceal the bottom navigation.
      document.body.classList.remove('map-expanded');
      closeAreas();
    }
    syncChrome();
    requestAnimationFrame(() => {
      resizeMap();
      if (view) currentMap.setView(view.center, view.zoom, { animate: false });
    });
    window.setTimeout(resizeMap, 250);
  }

  function closeAreas() {
    document.body.classList.remove('fcu-mobile-areas-open');
    $('#fcu-mobile-area')?.setAttribute('aria-expanded', 'false');
    if (typeof window.closeSidebar === 'function') window.closeSidebar();
  }

  function setSheetState(state) {
    sheetState = state;
    if (!sheet) return;
    sheet.dataset.mobileSheet = state;
    const handle = sheet.querySelector('.fcu-sheet-handle');
    handle.setAttribute('aria-expanded', String(state !== 'peek'));
    handle.setAttribute('aria-label', state === 'expanded' ? 'Recolher percepções' : 'Expandir percepções');
    handle.querySelector('.fcu-sheet-action').textContent = state === 'expanded' ? 'Recolher' : 'Expandir';
  }

  function connectSheet() {
    const panel = $('#fcu-perception-panel');
    if (!panel || panel === sheet) return;
    sheet = panel;
    sheet.insertAdjacentHTML('afterbegin', '<div class="fcu-sheet-controls"><button type="button" class="fcu-sheet-handle" aria-controls="fcu-perception-start fcu-perception-form"><i aria-hidden="true"></i><span>Minhas percepções</span><small class="fcu-sheet-action">Expandir</small></button><button type="button" class="fcu-sheet-close" aria-label="Fechar percepções">×</button></div>');
    const handle = sheet.querySelector('.fcu-sheet-handle');
    let dragStart = null;
    let dragged = false;
    handle.addEventListener('pointerdown', event => {
      dragStart = event.clientY;
      dragged = false;
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointerup', event => {
      if (dragStart === null) return;
      const distance = event.clientY - dragStart;
      dragged = Math.abs(distance) > 24;
      if (dragged) setSheetState(distance < 0 ? 'expanded' : 'peek');
      dragStart = null;
    });
    handle.addEventListener('pointercancel', () => { dragStart = null; dragged = false; });
    handle.addEventListener('click', () => {
      if (dragged) { dragged = false; return; }
      setSheetState(sheetState === 'expanded' ? 'half' : 'expanded');
    });
    sheet.querySelector('.fcu-sheet-close').onclick = () => window.PreditorPerception?.close();
    const filters = sheet.querySelector('.fcu-filter-box');
    if (simple && filters) filters.open = false;
    setSheetState('half');
    new MutationObserver(syncChrome).observe(panel, { attributes: true, attributeFilter: ['class'] });
    const form = $('#fcu-perception-form');
    if (form) new MutationObserver(() => {
      const visible = !form.hidden;
      if (visible && !previousFormVisible && simple) { setSheetState('expanded'); sheet.scrollTop = 0; }
      previousFormVisible = visible;
    }).observe(form, { attributes: true, attributeFilter: ['hidden'] });
  }

  function syncChrome() {
    const perceptionOpen = !!window.PreditorPerception?.isOpen();
    const accountOpen = document.body.classList.contains('fcu-account-open');
    if (sheet) sheet.inert = !perceptionOpen;
    const sidebar = $('#site-sidebar');
    if (sidebar) sidebar.inert = simple && !document.body.classList.contains('fcu-mobile-areas-open');
    const current = accountOpen ? 'account' : perceptionOpen ? 'perception' : 'map';
    document.querySelectorAll('[data-fcu-screen]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.fcuScreen === current));
    });
    const app = window.PreditorApp || window.App;
    const title = app?.currentPoloName || $('#polo-title')?.textContent.trim();
    const label = $('#fcu-mobile-area-label');
    if (label && title) label.textContent = title.replace(/\s*[-–—]\s*Preditor FCU.*$/i, '');
    const accountLabel = $('#fcu-mobile-account-label');
    if (accountLabel) accountLabel.textContent = window.PreditorAuth?.user ? 'Conta' : 'Entrar';
    const isDrawing = !!window.PreditorPerception?.isDrawing();
    if (document.body.classList.contains('fcu-mobile-drawing') !== isDrawing) document.body.classList.toggle('fcu-mobile-drawing', isDrawing);
    document.querySelectorAll('[data-fcu-mode], #fcu-mobile-area, [data-fcu-screen="perception"], [data-fcu-screen="account"]').forEach(button => {
      button.disabled = simple && isDrawing;
      button.title = simple && isDrawing ? 'Conclua ou cancele o desenho antes de mudar de tela.' : '';
    });
    const context = $('#fcu-context-card');
    const hasCell = !!context?.querySelector('.fcu-context-actions');
    if (context && context.classList.contains('fcu-mobile-has-cell') !== hasCell) context.classList.toggle('fcu-mobile-has-cell', hasCell);
    if (simple && !isDrawing) {
      const gate = $('.local-map-panel.is-interaction-locked > .interaction-gate');
      if (gate) gate.click();
    }
  }

  function refreshSync(event) {
    const state = event?.detail || window.PreditorPerception?.getSyncStatus?.();
    const label = $('#fcu-mobile-sync-label');
    const button = $('#fcu-mobile-sync-button');
    if (!label || !button) return;
    let message = 'Entre para sincronizar';
    let tone = 'neutral';
    let detail = 'Entre na sua conta para salvar percepções e acessá-las em outros aparelhos.';
    if (state?.ownerId) {
      if (state.syncing) { message = 'Enviando…'; detail = 'Aguardando a confirmação do servidor.'; }
      else if (state.conflicts) { message = 'Revisar versões'; tone = 'pending'; detail = 'Há versões diferentes. Abra Percepções para escolher sem perder seu trabalho.'; }
      else if (state.pending || state.localOnly) { message = 'Neste aparelho'; tone = 'pending'; detail = 'Há alterações ainda não confirmadas online. Não limpe os dados do navegador nem saia da conta antes de sincronizar.'; }
      else if (state.online === false) { message = 'Sem conexão'; tone = 'pending'; detail = 'Os mapas podem precisar de internet. Alterações locais serão enviadas quando a conexão voltar.'; }
      else if (state.cloudAvailable === false) { message = 'Conexão não confirmada'; tone = 'pending'; detail = 'Não foi possível confirmar a conexão com sua conta. As cópias locais continuam disponíveis; tente sincronizar novamente.'; }
        else if (state.checking || !state.lastLoadedAt) { message = 'Verificando…'; detail = 'Consultando suas percepções online.'; }
        else if (state.quarantined) { message = 'Registros antigos'; tone = 'pending'; detail = 'Há cópias antigas separadas das percepções atuais. Consulte Minha conta → Dados deste aparelho.'; }
      else if (state.synced) { message = 'Salvo online'; tone = 'success'; detail = 'Gravações confirmadas no servidor; podem ser consultadas com a mesma conta em outro aparelho.'; }
      else { message = 'Online'; tone = 'success'; detail = 'Conectado. Você ainda não tem percepções neste aparelho.'; }
    }
    if (state?.ownerId && state.storageAvailable === false) { message = 'Armazenamento indisponível'; tone = 'pending'; detail = 'Este navegador não permite guardar alterações com segurança. Não feche a página; habilite o armazenamento ou use outro navegador antes de desenhar.'; }
    if (syncError && !state?.syncing) { message = 'Tente sincronizar'; tone = 'pending'; detail = syncError; }
    if (label.textContent !== message) label.textContent = message;
    $('#fcu-mobile-sync').dataset.tone = tone;
    button.title = detail;
    button.setAttribute('aria-label', message + '. ' + detail + ' Sincronizar agora');
    button.disabled = !!state?.syncing;
  }

  function bind() {
    const mapCard = $('.local-map-panel')?.closest('.card');
    if (mapCard) mapCard.classList.add('fcu-mobile-map-card');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="fcu-mobile-topbar">
        <button type="button" id="fcu-mobile-area" aria-controls="site-sidebar" aria-expanded="false"><span aria-hidden="true">☰</span><span><small>Área de estudo</small><strong id="fcu-mobile-area-label">Preditor FCU</strong></span></button>
        <div class="fcu-view-options" role="group" aria-label="Visualização"><button type="button" data-fcu-mode="simple" aria-pressed="false">Simplificado</button><button type="button" data-fcu-mode="complete" aria-pressed="false">Completo</button></div>
      </div>
      <button type="button" class="fcu-mobile-area-shade" aria-label="Fechar áreas de estudo"></button>
      <div class="fcu-mobile-bottom">
        <div id="fcu-mobile-sync" class="fcu-mobile-sync" data-tone="neutral"><span id="fcu-mobile-sync-label" role="status" aria-live="polite">Entre para sincronizar</span><button type="button" id="fcu-mobile-sync-button" aria-label="Sincronizar agora">↻ <span>Sincronizar</span></button></div>
        <nav class="fcu-mobile-nav" aria-label="Navegação simplificada"><button type="button" data-fcu-screen="map" aria-pressed="true">${icons.map}<span>Mapa</span></button><button type="button" data-fcu-screen="perception" aria-pressed="false">${icons.perception}<span>Percepções</span></button><button type="button" data-fcu-screen="account" aria-pressed="false">${icons.account}<span id="fcu-mobile-account-label">Entrar</span></button></nav>
      </div>`);
    $('.sidebar .brand')?.insertAdjacentHTML('afterend', '<div class="fcu-sidebar-view"><small>Visualização</small><div class="fcu-view-options" role="group" aria-label="Visualização"><button type="button" data-fcu-mode="simple">Simplificado</button><button type="button" data-fcu-mode="complete">Completo</button></div></div>');
    $('.mobile-toolbar')?.insertAdjacentHTML('beforeend', '<button type="button" class="fcu-mobile-quick-mode" data-fcu-mode="simple">Simplificar</button>');
    document.querySelectorAll('[data-fcu-mode]').forEach(button => button.onclick = () => chooseMode(button.dataset.fcuMode, true));
    $('#fcu-mobile-area').onclick = () => {
      if (window.PreditorPerception?.isDrawing()) return;
      const open = !document.body.classList.contains('fcu-mobile-areas-open');
      document.body.classList.toggle('fcu-mobile-areas-open', open);
      $('#fcu-mobile-area').setAttribute('aria-expanded', String(open));
    };
    $('.fcu-mobile-area-shade').onclick = closeAreas;
    $('#nav-container')?.addEventListener('click', event => { if (event.target.closest('button')) closeAreas(); });
    document.querySelectorAll('[data-fcu-screen]').forEach(button => button.onclick = () => {
      if (button.dataset.fcuScreen !== 'map' && window.PreditorPerception?.isDrawing()) return;
      closeAreas();
      const perception = window.PreditorPerception;
      if (button.dataset.fcuScreen === 'map') { perception?.close(); perception?.closeProfile(); resizeMap(); }
      if (button.dataset.fcuScreen === 'perception') {
        if (!window.PreditorAuth?.user) $('#fcu-auth-button')?.click();
        else { setSheetState('half'); perception?.open(); }
      }
      if (button.dataset.fcuScreen === 'account') { perception?.close(); $('#fcu-auth-button')?.click(); }
      syncChrome();
    });
    $('#fcu-mobile-sync-button').onclick = async () => {
      if (!window.PreditorAuth?.user) { $('#fcu-auth-button')?.click(); return; }
      syncError = '';
      try { await window.PreditorPerception?.syncNow(); }
      catch (_) { syncError = 'Não foi possível confirmar o envio. Suas alterações locais continuam preservadas; verifique sua conexão e tente novamente.'; }
      refreshSync();
    };
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAreas(); });
    window.addEventListener('preditor:perception-sync-state', refreshSync);
    window.addEventListener('online', refreshSync);
    window.addEventListener('offline', refreshSync);
    compactViewport.addEventListener('change', () => { if (!preference) chooseMode(compactViewport.matches ? 'simple' : 'complete', false); });
    new MutationObserver(syncChrome).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    chooseMode(preference || (compactViewport.matches ? 'simple' : 'complete'), false);
    connectSheet();
    refreshSync();
    window.setInterval(() => { connectSheet(); syncChrome(); refreshSync(); }, 1500);
    window.PreditorMobile = { setMode: mode => { if (mode === 'simple' || mode === 'complete') chooseMode(mode, true); }, getMode: () => simple ? 'simple' : 'complete' };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
