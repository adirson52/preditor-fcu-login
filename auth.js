(function () {
  'use strict';

  const PROJECT_URL = 'https://rreagceersvnbmmvstzf.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf';
  const TERMS_VERSION = 'pilot-2026-09-11';
  const DEMO_CELL_KEY = 'preditor_fcu_demo_cell_v1';
  const SESSION_KEY = 'preditor_fcu_auth_session_v1';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase client não foi carregado.');
    return;
  }

  const client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.PreditorAuth = { client: client, user: null };

  let currentUser = null;
  let pendingPoint = null;
  let pendingOpen = null;

  function safeStorageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char];
    });
  }

  function buildUi() {
    const button = document.createElement('button');
    button.id = 'fcu-auth-button';
    button.className = 'fcu-auth-button';
    button.type = 'button';
    button.textContent = 'Entrar';
    button.setAttribute('aria-haspopup', 'dialog');

    const backdrop = document.createElement('div');
    backdrop.id = 'fcu-auth-backdrop';
    backdrop.className = 'fcu-auth-backdrop';
    backdrop.innerHTML = `
      <section class="fcu-auth-modal" role="dialog" aria-modal="true" aria-labelledby="fcu-auth-title">
        <button class="fcu-auth-close" type="button" aria-label="Fechar">&times;</button>
        <h2 id="fcu-auth-title">Acesse o Preditor FCU</h2>
        <p class="fcu-auth-lead" id="fcu-auth-lead">Entre ou crie sua conta para continuar explorando células do mapa.</p>
        <div class="fcu-auth-tabs" role="tablist">
          <button class="fcu-auth-tab is-active" type="button" data-auth-view="login">Entrar</button>
          <button class="fcu-auth-tab" type="button" data-auth-view="register">Criar conta</button>
        </div>

        <form class="fcu-auth-view" id="fcu-login-form" data-view="login">
          <label class="fcu-auth-field">E-mail
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label class="fcu-auth-field fcu-auth-password">Senha
            <input name="password" type="password" autocomplete="current-password" minlength="8" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <button class="fcu-auth-submit" type="submit">Entrar</button>
          <button class="fcu-auth-link" type="button" data-auth-view="reset">Esqueci minha senha</button>
        </form>

        <form class="fcu-auth-view" id="fcu-register-form" data-view="register" hidden>
          <label class="fcu-auth-field">Nome completo
            <input name="full_name" type="text" autocomplete="name" minlength="2" maxlength="150" required>
          </label>
          <label class="fcu-auth-field">E-mail válido
            <input name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required>
            <small>Você receberá neste endereço o link para confirmar seu cadastro.</small>
          </label>
          <label class="fcu-auth-field">Instituição
            <input name="institution" type="text" autocomplete="organization" minlength="2" maxlength="200" placeholder="Ou Independente / sem vínculo" required>
          </label>
          <label class="fcu-auth-field fcu-auth-password">Crie sua senha
            <input name="password" type="password" autocomplete="new-password" minlength="8" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <label class="fcu-auth-check">
            <input name="terms" type="checkbox" required>
            <span>Li e aceito os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>, incluindo a utilização não comercial da plataforma.</span>
          </label>
          <label class="fcu-auth-check">
            <input name="privacy" type="checkbox" required>
            <span>Estou ciente da <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e do uso de dados de acesso em estudos e relatórios acadêmicos.</span>
          </label>
          <button class="fcu-auth-submit" type="submit">Criar conta</button>
        </form>

        <form class="fcu-auth-view" id="fcu-reset-form" data-view="reset" hidden>
          <label class="fcu-auth-field">E-mail
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <button class="fcu-auth-submit" type="submit">Enviar link de recuperação</button>
          <button class="fcu-auth-link" type="button" data-auth-view="login">Voltar para entrar</button>
        </form>

        <form class="fcu-auth-view" id="fcu-new-password-form" data-view="new-password" hidden>
          <label class="fcu-auth-field fcu-auth-password">Nova senha
            <input name="password" type="password" autocomplete="new-password" minlength="8" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <button class="fcu-auth-submit" type="submit">Salvar nova senha</button>
        </form>

        <div class="fcu-auth-view" id="fcu-account-view" data-view="account" hidden>
          <p>Você está conectado como <strong id="fcu-account-email"></strong>.</p>
          <button class="fcu-auth-submit" id="fcu-logout-button" type="button">Sair</button>
        </div>
        <p class="fcu-auth-message" id="fcu-auth-message" aria-live="polite"></p>
      </section>`;

    document.body.appendChild(button);
    document.body.appendChild(backdrop);
    return { button: button, backdrop: backdrop };
  }

  const ui = buildUi();
  const message = document.getElementById('fcu-auth-message');

  function setMessage(text, isError) {
    message.textContent = text || '';
    message.classList.toggle('is-error', !!isError);
  }

  function setBusy(form, busy) {
    const submit = form && form.querySelector('[type="submit"]');
    if (submit) submit.disabled = !!busy;
  }

  function setView(name) {
    document.querySelectorAll('.fcu-auth-view').forEach(function (view) {
      view.hidden = view.dataset.view !== name;
    });
    document.querySelectorAll('.fcu-auth-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.dataset.authView === name);
    });
    document.querySelector('.fcu-auth-tabs').hidden = name === 'account' || name === 'new-password';
    setMessage('');
    const visible = document.querySelector(`.fcu-auth-view[data-view="${name}"] input`);
    if (visible) window.setTimeout(function () { visible.focus(); }, 30);
  }

  function openModal(view, lead) {
    if (lead) document.getElementById('fcu-auth-lead').textContent = lead;
    setView(view || (currentUser ? 'account' : 'login'));
    ui.backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    ui.backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
    setMessage('');
  }

  function updateUserUi(user) {
    currentUser = user || null;
    window.PreditorAuth.user = currentUser;
    ui.button.textContent = currentUser ? 'Minha conta' : 'Entrar';
    document.getElementById('fcu-account-email').textContent = currentUser ? currentUser.email : '';
  }

  async function validatedUser() {
    try {
      const result = await client.auth.getUser();
      return result.data && result.data.user ? result.data.user : null;
    } catch (_) { return null; }
  }

  async function trackEvent(eventName, point) {
    if (!currentUser) return;
    const areaId = point && (point.a || point.scope) ? String(point.a || point.scope) : null;
    const cellId = point && point.id ? String(point.id) : null;
    let sessionId = safeStorageGet(SESSION_KEY);
    if (!sessionId && window.crypto && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
      safeStorageSet(SESSION_KEY, sessionId);
    }
    try {
      await client.from('fcu_authenticated_events').insert({
        user_id: currentUser.id,
        event_name: eventName,
        session_id: sessionId || null,
        area_id: areaId,
        cell_id: cellId,
        event_data: { page: location.pathname || '/' }
      });
    } catch (_) {}
  }

  function showDemoNotice() {
    if (document.getElementById('fcu-auth-demo-note')) return;
    const note = document.createElement('div');
    note.id = 'fcu-auth-demo-note';
    note.className = 'fcu-auth-demo-note';
    note.innerHTML = '<button type="button" aria-label="Fechar">&times;</button>Esta é sua célula de demonstração. Para consultar outra célula, entre ou crie uma conta gratuita.';
    note.querySelector('button').addEventListener('click', function () { note.remove(); });
    document.body.appendChild(note);
    window.setTimeout(function () { if (note.isConnected) note.remove(); }, 9000);
  }

  function guardCellOpen(point, openCell) {
    if (typeof openCell !== 'function') return false;
    const cellId = point && point.id ? String(point.id) : '';
    if (currentUser) {
      openCell();
      trackEvent('cell_view', point);
      return true;
    }
    const demoCell = safeStorageGet(DEMO_CELL_KEY);
    if (!demoCell || demoCell === cellId) {
      if (!demoCell && cellId) {
        safeStorageSet(DEMO_CELL_KEY, cellId);
        showDemoNotice();
      }
      openCell();
      return true;
    }
    pendingPoint = point;
    pendingOpen = openCell;
    openModal('login', 'Você já consultou sua célula de demonstração. Entre ou crie uma conta gratuita para abrir outras células.');
    return false;
  }

  async function resumePendingPoint() {
    if (!currentUser || !pendingPoint || !pendingOpen) return;
    const point = pendingPoint;
    const openCell = pendingOpen;
    pendingPoint = null;
    pendingOpen = null;
    closeModal();
    openCell();
    await trackEvent('cell_view', point);
  }

  ui.button.addEventListener('click', function () { openModal(currentUser ? 'account' : 'login'); });
  ui.backdrop.querySelector('.fcu-auth-close').addEventListener('click', closeModal);
  ui.backdrop.addEventListener('click', function (event) { if (event.target === ui.backdrop) closeModal(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && ui.backdrop.classList.contains('is-open')) closeModal(); });
  document.querySelectorAll('[data-auth-view]').forEach(function (button) {
    button.addEventListener('click', function () { setView(button.dataset.authView); });
  });
  document.querySelectorAll('[data-toggle-password]').forEach(function (button) {
    button.addEventListener('click', function () {
      const input = button.parentElement.querySelector('input');
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.textContent = reveal ? 'Ocultar' : 'Ver';
    });
  });

  document.getElementById('fcu-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    setMessage('Entrando...');
    const values = new FormData(form);
    const result = await client.auth.signInWithPassword({
      email: String(values.get('email') || '').trim(),
      password: String(values.get('password') || '')
    });
    setBusy(form, false);
    if (result.error) return setMessage('Não foi possível entrar. Confira o e-mail, a senha e a confirmação do cadastro.', true);
    updateUserUi(result.data.user);
    setMessage('Acesso confirmado.');
    await trackEvent('login');
    await resumePendingPoint();
  });

  document.getElementById('fcu-register-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(form, true);
    setMessage('Criando sua conta...');
    const result = await client.auth.signUp({
      email: String(values.get('email') || '').trim(),
      password: String(values.get('password') || ''),
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: {
          registration_context: 'fcu_pilot',
          full_name: String(values.get('full_name') || '').trim(),
          institution: String(values.get('institution') || '').trim(),
          terms_version: TERMS_VERSION,
          terms_accepted: values.get('terms') === 'on',
          privacy_acknowledged: values.get('privacy') === 'on'
        }
      }
    });
    setBusy(form, false);
    if (result.error) return setMessage('Não foi possível concluir o cadastro: ' + result.error.message, true);
    if (result.data.session) {
      updateUserUi(result.data.user);
      setMessage('Conta criada e acesso confirmado.');
      await resumePendingPoint();
    } else {
      form.reset();
      setMessage('Cadastro recebido. Abra o e-mail enviado e clique no link para confirmar sua conta.');
    }
  });

  document.getElementById('fcu-reset-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email') || '').trim();
    setBusy(form, true);
    const result = await client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname + '?recovery=1'
    });
    setBusy(form, false);
    if (result.error) return setMessage('Não foi possível enviar o link agora. Tente novamente em alguns minutos.', true);
    setMessage('Se houver uma conta cadastrada, você receberá um link para criar uma nova senha.');
  });

  document.getElementById('fcu-new-password-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') || '');
    setBusy(form, true);
    const result = await client.auth.updateUser({ password: password });
    setBusy(form, false);
    if (result.error) return setMessage('Não foi possível salvar a nova senha: ' + result.error.message, true);
    setMessage('Senha alterada. Você já está conectado.');
    window.history.replaceState({}, document.title, location.pathname);
    window.setTimeout(function () { closeModal(); }, 1200);
  });

  document.getElementById('fcu-logout-button').addEventListener('click', async function () {
    await trackEvent('logout');
    await client.auth.signOut();
    updateUserUi(null);
    setView('login');
    setMessage('Sessão encerrada.');
  });

  client.auth.onAuthStateChange(function (event, session) {
    window.setTimeout(async function () {
      const user = session && session.user ? session.user : await validatedUser();
      updateUserUi(user);
      if (event === 'PASSWORD_RECOVERY' || new URLSearchParams(location.search).get('recovery') === '1') {
        openModal('new-password', 'Crie uma nova senha para sua conta.');
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && user) {
        await resumePendingPoint();
      }
    }, 0);
  });

  validatedUser().then(updateUserUi);
  window.PreditorAuth.guardCellOpen = guardCellOpen;
  const requestedView = new URLSearchParams(location.search).get('auth');
  if (requestedView === 'login' || requestedView === 'register' || requestedView === 'reset') {
    openModal(requestedView);
  }
})();
