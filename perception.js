(function () {
  'use strict';

  const TYPE_LABELS = {
    expansao_urbana: 'Expansão urbana', consolidacao: 'Consolidação urbana',
    vulnerabilidade: 'Vulnerabilidade ou risco', infraestrutura: 'Carência de infraestrutura',
    pressao_ambiental: 'Pressão ambiental', outro: 'Outro'
  };
  let map, client, drawing = false, vertices = [], draftLayer = null;
  let savedLayers = L.layerGroup();

  window.PreditorPerception = { isDrawing: function () { return drawing; } };

  function el(selector) { return document.querySelector(selector); }
  function currentUser() { return window.PreditorAuth && window.PreditorAuth.user; }
  function setStatus(text, error) {
    const node = el('#fcu-perception-status');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-error', Boolean(error));
  }
  function openPanel() { el('#fcu-perception-panel').classList.add('is-open'); el('#fcu-perception-shade').classList.add('is-open'); }
  function closePanel() { el('#fcu-perception-panel').classList.remove('is-open'); el('#fcu-perception-shade').classList.remove('is-open'); }

  function buildUi() {
    const mapPanel = document.querySelector('.local-map-panel');
    if (!mapPanel || document.querySelector('.fcu-perception-button')) return false;
    if (getComputedStyle(mapPanel).position === 'static') mapPanel.style.position = 'relative';
    mapPanel.insertAdjacentHTML('beforeend', '<button class="fcu-perception-button" type="button">＋ Criar percepção</button>');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="fcu-perception-shade" id="fcu-perception-shade"></div>
      <aside class="fcu-perception-panel" id="fcu-perception-panel" aria-label="Percepções territoriais">
        <div class="fcu-perception-head"><div><h2>Percepções territoriais</h2><p>Desenhe uma área e registre brevemente o que você percebe.</p></div><button class="fcu-perception-close" type="button" aria-label="Fechar">×</button></div>
        <div id="fcu-perception-start">
          <button class="fcu-perception-primary" id="fcu-start-drawing" type="button">Iniciar novo polígono</button>
          <p class="fcu-perception-status" id="fcu-perception-status"></p>
          <h3>Meus polígonos</h3><div id="fcu-perception-list"><p>Entre para consultar seus desenhos.</p></div>
        </div>
        <form class="fcu-perception-form" id="fcu-perception-form" hidden>
          <h3>Conte brevemente sobre a área</h3>
          <label for="fcu-perception-title">Título</label><input id="fcu-perception-title" name="title" type="text" maxlength="120" required placeholder="Ex.: ocupação recente">
          <fieldset><legend>O que você percebe?</legend>
            ${Object.entries(TYPE_LABELS).map(([value, label]) => `<label class="fcu-check"><input type="checkbox" name="types" value="${value}"> ${label}</label>`).join('')}
          </fieldset>
          <label for="fcu-perception-intensity">Intensidade</label><select id="fcu-perception-intensity" name="intensity" required><option value="">Selecione</option><option value="1">1 · Muito baixa</option><option value="2">2 · Baixa</option><option value="3">3 · Média</option><option value="4">4 · Alta</option><option value="5">5 · Muito alta</option></select>
          <label for="fcu-perception-time">Referência temporal</label><select id="fcu-perception-time" name="time_reference" required><option value="atual">Atualmente</option><option value="recente">Nos últimos anos</option><option value="historica">É histórica</option><option value="nao_sei">Não sei informar</option></select>
          <label for="fcu-perception-confidence">Grau de confiança</label><select id="fcu-perception-confidence" name="confidence" required><option value="media">Médio</option><option value="baixa">Baixo</option><option value="alta">Alto</option></select>
          <label for="fcu-perception-description">Descrição breve</label><textarea id="fcu-perception-description" name="description" maxlength="800" rows="4"></textarea>
          <label class="fcu-check"><input type="checkbox" name="consent" required> Autorizo o uso desta percepção em análises e relatórios acadêmicos.</label>
          <div class="fcu-perception-actions"><button class="fcu-perception-secondary" id="fcu-cancel-form" type="button">Cancelar</button><button class="fcu-perception-primary" type="submit">Salvar percepção</button></div>
          <p class="fcu-perception-status" id="fcu-form-status"></p>
        </form>
      </aside>`);
    el('.fcu-perception-button').addEventListener('click', function () { openPanel(); loadPerceptions(); });
    el('.fcu-perception-close').addEventListener('click', closePanel);
    el('#fcu-perception-shade').addEventListener('click', closePanel);
    el('#fcu-start-drawing').addEventListener('click', startDrawing);
    el('#fcu-cancel-form').addEventListener('click', resetDraft);
    el('#fcu-perception-form').addEventListener('submit', savePerception);
    return true;
  }

  function requireLogin() {
    if (currentUser()) return true;
    closePanel();
    const authButton = document.getElementById('fcu-auth-button');
    if (authButton) authButton.click();
    return false;
  }

  function startDrawing() {
    if (!requireLogin()) return;
    closePanel(); drawing = true; vertices = [];
    if (draftLayer) map.removeLayer(draftLayer);
    document.body.insertAdjacentHTML('beforeend', '<div class="fcu-perception-drawnote" id="fcu-perception-drawnote">Clique no mapa para marcar a área · mínimo 3 pontos</div>');
    map.getContainer().style.cursor = 'crosshair';
    setStatus('');
  }

  function onMapClick(event) {
    if (!drawing) return;
    vertices.push([event.latlng.lat, event.latlng.lng]);
    if (draftLayer) map.removeLayer(draftLayer);
    draftLayer = vertices.length >= 3
      ? L.polygon(vertices, { color: '#7c3aed', weight: 3, fillOpacity: .2 }).addTo(map)
      : L.polyline(vertices, { color: '#7c3aed', weight: 3 }).addTo(map);
    const note = el('#fcu-perception-drawnote');
    if (note) note.innerHTML = vertices.length >= 3
      ? `${vertices.length} pontos marcados · <button type="button" id="fcu-finish-drawing">Concluir polígono</button>`
      : `${vertices.length} de 3 pontos mínimos`;
    const finish = el('#fcu-finish-drawing');
    if (finish) finish.onclick = finishDrawing;
  }

  function finishDrawing(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (vertices.length < 3) return;
    drawing = false; map.getContainer().style.cursor = '';
    const note = el('#fcu-perception-drawnote'); if (note) note.remove();
    el('#fcu-perception-start').hidden = true;
    el('#fcu-perception-form').hidden = false;
    openPanel();
  }

  function resetDraft() {
    drawing = false; vertices = [];
    if (draftLayer) { map.removeLayer(draftLayer); draftLayer = null; }
    const note = el('#fcu-perception-drawnote'); if (note) note.remove();
    map.getContainer().style.cursor = '';
    el('#fcu-perception-form').reset(); el('#fcu-perception-form').hidden = true;
    el('#fcu-perception-start').hidden = false; setStatus('');
  }

  function geoJSON() {
    const ring = vertices.map(function (point) { return [point[1], point[0]]; });
    ring.push(ring[0].slice());
    return { type: 'Polygon', coordinates: [ring] };
  }

  function areaId() {
    const sample = window.__PREDITOR_APP__ && window.__PREDITOR_APP__.selectedSample;
    if (sample && (sample.a || sample.scope)) return String(sample.a || sample.scope);
    const area = document.getElementById('area-select');
    return area && area.value ? area.value : null;
  }

  async function savePerception(event) {
    event.preventDefault();
    if (!requireLogin() || vertices.length < 3) return;
    const form = event.currentTarget, values = new FormData(form), types = values.getAll('types');
    const status = el('#fcu-form-status');
    if (!types.length) { status.textContent = 'Marque pelo menos uma percepção.'; status.classList.add('is-error'); return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; status.textContent = 'Salvando...'; status.classList.remove('is-error');
    const result = await client.from('fcu_perceptions').insert({
      user_id: currentUser().id, title: String(values.get('title') || '').trim(),
      perception_types: types, intensity: Number(values.get('intensity')),
      time_reference: String(values.get('time_reference')), confidence: String(values.get('confidence')),
      description: String(values.get('description') || '').trim(), area_id: areaId(),
      geometry: geoJSON(), status: 'submitted'
    });
    submit.disabled = false;
    if (result.error) { status.textContent = 'Não foi possível salvar: ' + result.error.message; status.classList.add('is-error'); return; }
    resetDraft(); openPanel(); setStatus('Percepção salva. Ela estará disponível quando você voltar.'); await loadPerceptions();
  }

  async function archive(id) {
    if (!confirm('Arquivar este polígono? O histórico será preservado.')) return;
    const result = await client.from('fcu_perceptions').update({ status: 'archived' }).eq('id', id);
    if (result.error) return setStatus('Não foi possível arquivar.', true);
    setStatus('Polígono arquivado e preservado no histórico.'); loadPerceptions();
  }

  async function loadPerceptions() {
    const list = el('#fcu-perception-list'); if (!list) return;
    savedLayers.clearLayers();
    if (!currentUser()) { list.innerHTML = '<p>Entre para consultar seus desenhos.</p>'; return; }
    list.innerHTML = '<p>Carregando...</p>';
    const result = await client.from('fcu_perceptions').select('id,title,perception_types,intensity,geometry,created_at').neq('status', 'archived').order('created_at', { ascending: false });
    if (result.error) { list.innerHTML = '<p>Não foi possível carregar os polígonos.</p>'; return; }
    if (!result.data.length) { list.innerHTML = '<p>Você ainda não salvou percepções.</p>'; return; }
    list.innerHTML = '';
    result.data.forEach(function (item) {
      const latlngs = item.geometry.coordinates[0].map(function (p) { return [p[1], p[0]]; });
      const layer = L.polygon(latlngs, { color: '#7c3aed', weight: 2, fillOpacity: .16 }).addTo(savedLayers);
      const card = document.createElement('div'); card.className = 'fcu-perception-item';
      const labels = (item.perception_types || []).map(function (t) { return TYPE_LABELS[t] || t; }).join(' · ');
      card.innerHTML = `<strong></strong><small>${labels} · intensidade ${item.intensity}/5</small><div class="fcu-perception-item-actions"><button type="button" data-view>Ver no mapa</button><button type="button" data-archive>Arquivar</button></div>`;
      card.querySelector('strong').textContent = item.title;
      card.querySelector('[data-view]').onclick = function () { closePanel(); map.fitBounds(layer.getBounds(), { padding: [30, 30] }); };
      card.querySelector('[data-archive]').onclick = function () { archive(item.id); };
      list.appendChild(card);
    });
  }

  function init() {
    map = window.__PREDITOR_APP__ && window.__PREDITOR_APP__.map;
    client = window.PreditorAuth && window.PreditorAuth.client;
    if (!map || !client || !buildUi()) return false;
    savedLayers.addTo(map); map.on('click', onMapClick);
    client.auth.onAuthStateChange(function () { setTimeout(loadPerceptions, 0); });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(function () { attempts += 1; if (init() || attempts > 120) clearInterval(timer); }, 250);
})();
