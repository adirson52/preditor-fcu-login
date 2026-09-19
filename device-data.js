/* Account presentation only: all persistence and ownership checks live in perception.js. */
(function () {
  'use strict';
  const cardId = 'fcu-device-data-card';
  let state = { owner: null, busy: false, message: '', error: false, recovered: new Set() };
  const userId = () => window.PreditorAuth?.user?.id || null;
  const api = () => window.PreditorPerception;

  function failureMessage(reason) {
    if (reason === 'partial-history') return 'Percepções atualizadas, mas o histórico não pôde ser conferido. Tente novamente.';
    if (reason === 'offline' || reason === 'network' || reason === 'unavailable') return 'Sem conexão com sua conta. Seus dados neste aparelho foram mantidos. Tente novamente quando a conexão voltar.';
    if (reason === 'storage-unavailable' || reason === 'storage_unavailable' || reason === 'storage') return 'O navegador não conseguiu guardar os dados. Não feche a página; suas alterações precisam ser preservadas antes de continuar.';
    if (reason === 'busy' || reason === 'drawing') return 'Conclua ou cancele o desenho antes de atualizar os dados.';
    if (reason === 'auth' || reason === 'unauthenticated' || reason === 'account-changed' || reason === 'account_changed' || reason === 'blocked') return 'Não foi possível confirmar sua conta. Entre novamente ou fale com a equipe.';
    if (reason === 'superseded') return 'Outra atualização foi iniciada. Aguarde a conclusão e confira seus dados.';
    if (reason === 'invalid-geometry') return 'Não foi possível recuperar este contorno. O registro antigo foi mantido.';
    if (reason === 'not-found') return 'Este registro antigo não está disponível nesta conta. Nenhuma percepção foi criada.';
    return 'Não foi possível concluir. Seus dados neste aparelho foram mantidos; tente novamente.';
  }

  function ensureOwner() {
    const owner = userId();
    if (owner !== state.owner) state = { owner, busy: false, message: '', error: false, recovered: new Set() };
    return owner;
  }

  function writeStatus() {
    const card = document.getElementById(cardId);
    if (!card) return;
    const status = card.querySelector('[data-device-status]');
    status.textContent = state.message;
    status.classList.toggle('is-error', state.error);
    card.querySelector('[data-device-refresh]').disabled = state.busy;
    card.querySelector('[data-device-refresh]').textContent = state.busy ? 'Atualizando…' : 'Atualizar dados deste aparelho';
    card.querySelectorAll('[data-device-recover]').forEach(button => {
      const recovered = state.recovered.has(button.dataset.deviceRecover);
      button.disabled = state.busy || recovered;
      button.textContent = recovered ? 'Cópia recuperada' : 'Recuperar cópia';
    });
  }

  async function refresh() {
    const owner = ensureOwner();
    if (!owner || state.busy || typeof api()?.refreshDeviceCache !== 'function') return;
    state.busy = true;
    state.error = false;
    state.message = 'Buscando os dados mais recentes. Suas alterações locais serão mantidas.';
    writeStatus();
    try {
      const result = await api().refreshDeviceCache();
      if (userId() !== owner) return;
      if (!result?.ok) { state.error = true; state.message = failureMessage(result?.reason); }
      else {
        const pending = Number(result.pending) || 0;
        state.message = pending
          ? `Dados atualizados. ${pending} ${pending === 1 ? 'alteração local preservada' : 'alterações locais preservadas'}.`
          : 'Dados atualizados. Você continua conectado.';
      }
    } catch (_) {
      if (userId() !== owner) return;
      state.error = true;
      state.message = failureMessage('unavailable');
    } finally {
      if (userId() === owner) { state.busy = false; renderOldItems(); writeStatus(); }
    }
  }

  async function recover(id) {
    const owner = ensureOwner();
    if (!owner || state.busy || state.recovered.has(id) || typeof api()?.recoverQuarantinedCopy !== 'function') return;
    if (!window.confirm('Recuperar como uma nova percepção? A cópia será incluída na sua conta e poderá ser sincronizada quando houver conexão. O registro antigo neste aparelho será preservado.')) return;
    state.busy = true;
    state.error = false;
    state.message = 'Recuperando a cópia…';
    writeStatus();
    try {
      const result = await api().recoverQuarantinedCopy(id);
      if (userId() !== owner) return;
      if (!result?.ok) { state.error = true; state.message = failureMessage(result?.reason); }
      else {
        state.recovered.add(id);
        state.message = result.alreadyRecovered
          ? 'Esta cópia já está em Minhas percepções.'
          : 'Cópia recuperada em Minhas percepções. Acompanhe o envio pelo indicador de sincronização.';
      }
    } catch (_) {
      if (userId() !== owner) return;
      state.error = true;
      state.message = 'Não foi possível recuperar a cópia. O registro antigo foi mantido.';
    } finally {
      if (userId() === owner) { state.busy = false; renderOldItems(); writeStatus(); }
    }
  }

  function renderOldItems() {
    const card = document.getElementById(cardId);
    if (!card || !userId()) return;
    const details = card.querySelector('[data-device-old-items]');
    const list = card.querySelector('[data-device-old-list]');
    const sameOwner = api()?.getSyncStatus?.().ownerId === userId();
    const records = sameOwner ? api()?.getQuarantinedItems?.() : [];
    if (!Array.isArray(records) || !records.length) { details.hidden = true; list.replaceChildren(); return; }
    details.hidden = false;
    card.querySelector('[data-device-old-count]').textContent = String(records.length);
    list.replaceChildren();
    for (const record of records) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 0;border-top:1px solid #e2e8f0;display:flex;gap:10px;align-items:center;justify-content:space-between;';
      const title = document.createElement('span');
      title.style.cssText = 'font-size:13px;overflow-wrap:anywhere;min-width:0;';
      title.textContent = record.title || 'Percepção sem título';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fcu-perception-secondary';
      button.style.cssText = 'width:auto;flex-shrink:0;padding:10px;min-height:44px;font-size:12px;';
      button.dataset.deviceRecover = String(record.id);
      button.textContent = 'Recuperar cópia';
      if (record.recoveredId || record.recovered_id) state.recovered.add(String(record.id));
      button.onclick = () => recover(String(record.id));
      row.append(title, button);
      list.append(row);
    }
    writeStatus();
  }

  function mount() {
    const owner = ensureOwner();
    if (!owner) { document.getElementById(cardId)?.remove(); return; }
    const container = document.getElementById('fcu-account-content');
    if (!container || !owner || typeof api()?.refreshDeviceCache !== 'function') return;
    let card = document.getElementById(cardId);
    if (!card) {
      card = document.createElement('article');
      card.id = cardId;
      card.className = 'fcu-account-card';
      card.innerHTML = '<div><div class="fcu-account-card-head"><h3 class="fcu-account-card-title">Dados deste aparelho</h3></div><p class="fcu-account-card-desc">Busque a versão mais recente da sua conta. Rascunhos e alterações ainda não enviados são mantidos, sem desconectar sua conta.</p><button type="button" class="fcu-acc-submit-btn" style="min-height:44px;" data-device-refresh>Atualizar dados deste aparelho</button><p class="fcu-perception-status" role="status" aria-live="polite" data-device-status></p><details data-device-old-items hidden><summary style="cursor:pointer;min-height:44px;padding:10px 0;font-size:13px;font-weight:700;">Registros antigos separados (<span data-device-old-count>0</span>)</summary><p class="fcu-account-card-desc">Estes itens antigos ficaram separados das percepções atuais. Recupere uma cópia apenas se reconhecer o desenho.</p><div data-device-old-list style="max-height:280px;overflow-y:auto;"></div></details></div>';
      card.querySelector('[data-device-refresh]').onclick = refresh;
      if (container.firstElementChild) container.firstElementChild.after(card);
      else container.append(card);
    }
    renderOldItems();
    writeStatus();
  }

  window.addEventListener('preditor:account-rendered', mount);
  window.addEventListener('preditor:perception-sync-state', () => {
    if (!document.getElementById(cardId)) return;
    if (!ensureOwner()) { document.getElementById(cardId)?.remove(); return; }
    renderOldItems();
    writeStatus();
  });
  window.PreditorDeviceData = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
