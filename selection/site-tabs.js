(function () {
  const tabs = Array.from(document.querySelectorAll('.site-tab'));
  const panels = {
    'exemplo-ilustrativo': document.getElementById('painel-passos'),
    'aracaju': document.getElementById('painel-aracaju'),
    'variaveis-exemplo': document.getElementById('painel-variaveis'),
    'resultados': document.getElementById('painel-resultados')
  };
  let active = null, savedView = null, frame = null;
  const canonical = value => value === 'passo-a-passo' ? 'exemplo-ilustrativo' : Object.hasOwn(panels, value) ? value : 'exemplo-ilustrativo';
  function show(value) {
    const name = canonical(value);
    if (name === active) return;
    if (active === 'aracaju' && window.SpatialSplit) {
      const map = SpatialSplit.map;
      savedView = { center: map.getCenter(), zoom: map.getZoom() };
    }
    cancelAnimationFrame(frame);
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
    tabs.forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', selected);
      tab.tabIndex = selected ? 0 : -1;
    });
    active = name;
    document.getElementById('metodologia-reserva').hidden = name === 'resultados' || name === 'variaveis-exemplo';
    document.title = tabs.find(tab => tab.dataset.tab === name).textContent.trim() + ' | Sele\u00e7\u00e3o de vari\u00e1veis';
    if (name === 'variaveis-exemplo') requestAnimationFrame(() => window.IbgeExample?.render());
    if (name === 'aracaju') frame = requestAnimationFrame(() => {
      if (active !== 'aracaju') return;
      window.iniciarMapaAracaju();
      const app = window.SpatialSplit;
      if (!app) return;
      app.map.invalidateSize({ pan: false });
      if (savedView) app.map.setView(savedView.center, savedView.zoom, { animate: false });
      if (!document.getElementById('mini-wrap').classList.contains('collapsed')) app.mini.invalidateSize({ pan: false });
      app.spatial.redraw();
    });
  }
  function navigate(name, focus = false) {
    name = canonical(name);
    if (location.hash !== '#' + name) history.pushState(null, '', '#' + name);
    show(name);
    if (focus) tabs.find(tab => tab.dataset.tab === name).focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => navigate(tab.dataset.tab));
    tab.addEventListener('keydown', event => {
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); navigate(tabs[next].dataset.tab, true); }
    });
  });
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  addEventListener('popstate', () => show(location.hash.slice(1)));
  document.querySelectorAll('[data-go-tab]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goTab, true)));
  show(location.hash.slice(1));
  lucide.createIcons();
  window.Validador = { navigate, get active() { return active; } };
})();
