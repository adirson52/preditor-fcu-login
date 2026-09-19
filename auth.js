(function () {
  'use strict';

  const PROJECT_URL = 'https://rreagceersvnbmmvstzf.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf';
  const TERMS_VERSION = 'pilot-2026-09-11';
  const DEMO_CELL_KEY = 'preditor_fcu_demo_cell_v1';
  const SESSION_KEY = 'preditor_fcu_auth_session_v1';
  const MASTER_API = 'https://preditor-fcu-master.vercel.app/api';

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
  let accountCheck = null;
  let invalidatingAccount = false;
  let userUiRevision = 0;
  let accountIdentityRevision = 0;

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
            <input name="email" type="email" autocomplete="email" placeholder="seuemail@exemplo.com" required>
          </label>
          <label class="fcu-auth-field fcu-auth-password">Senha (mínimo 6 caracteres)
            <input name="password" type="password" autocomplete="current-password" minlength="6" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <button class="fcu-auth-submit" type="submit">Entrar</button>
          <button class="fcu-auth-link" type="button" data-auth-view="reset">Esqueci minha senha</button>
        </form>

        <form class="fcu-auth-view" id="fcu-register-form" data-view="register" hidden>
          <label class="fcu-auth-field">Nome completo
            <input name="full_name" type="text" autocomplete="name" minlength="2" maxlength="150" required>
          </label>
          <label class="fcu-auth-field">E-mail de acesso
            <input name="email" type="email" autocomplete="email" placeholder="seuemail@exemplo.com" required>
          </label>
          <label class="fcu-auth-field">Instituição / Organização
            <input name="institution" type="text" autocomplete="organization" minlength="2" maxlength="200" placeholder="Ex.: IBGE, Prefeitura, Universidade, Autônomo..." required>
          </label>
          <label class="fcu-auth-field fcu-auth-password">Crie sua senha (mínimo 6 caracteres)
            <input name="password" type="password" autocomplete="new-password" minlength="6" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <label class="fcu-auth-check">
            <input name="terms" type="checkbox" required>
            <span>Li e aceito os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>, incluindo a utilização não comercial da plataforma.</span>
          </label>
          <label class="fcu-auth-check">
            <input name="privacy" type="checkbox" required>
            <span>Estou ciente da <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e do uso de dados em estudos técnicos.</span>
          </label>
          <button class="fcu-auth-submit" type="submit">Criar conta e acessar agora</button>
        </form>

        <form class="fcu-auth-view" id="fcu-reset-form" data-view="reset" hidden>
          <p class="fcu-auth-lead">Envie um pedido à equipe para recuperar seu acesso. A redefinição será feita manualmente, após confirmar sua identidade. Não há envio automático de e-mail.</p>
          <label class="fcu-auth-field">Seu nome
            <input name="full_name" type="text" autocomplete="name" minlength="2" maxlength="120" required>
          </label>
          <label class="fcu-auth-field">E-mail cadastrado
            <input name="email" type="email" autocomplete="email" maxlength="254" required>
          </label>
          <label class="fcu-auth-field">Telefone ou outro contato <span>(opcional)</span>
            <input name="phone" type="text" autocomplete="tel" maxlength="120" placeholder="Um contato para a equipe falar com você">
          </label>
          <p class="fcu-auth-lead">Não informe sua senha. Se você já conhece a equipe, também pode procurá-la pelo canal habitual.</p>
          <button class="fcu-auth-submit" type="submit">Pedir ajuda para recuperar acesso</button>
          <button class="fcu-auth-link" type="button" data-auth-view="login">Voltar para entrar</button>
        </form>

        <form class="fcu-auth-view" id="fcu-new-password-form" data-view="new-password" hidden>
          <div id="fcu-must-change-banner" class="fcu-auth-banner-must-change" hidden style="padding:10px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;color:#92400e;font-size:12px;font-weight:700;margin-bottom:12px;">
            🔒 Primeiro acesso ou redefinição pela equipe: crie sua nova senha pessoal de 6 caracteres ou mais para continuar.
          </div>
          <label class="fcu-auth-field fcu-auth-password">Nova senha (mínimo 6 caracteres)
            <input name="password" type="password" autocomplete="new-password" minlength="6" required>
            <button type="button" data-toggle-password>Ver</button>
          </label>
          <button class="fcu-auth-submit" type="submit">Salvar nova senha</button>
        </form>

        <form class="fcu-auth-view" id="fcu-help-form" data-view="help" hidden>
          <h3 style="margin:0 0 6px;font-size:16px;color:var(--auth-ink);font-weight:800;">💬 Falar com a Equipe</h3>
          <p style="margin:0 0 10px;font-size:12px;color:var(--auth-muted);line-height:1.4;">
            Está com dificuldades para entrar, esqueceu a senha ou precisa de auxílio no cadastro? Envie uma mensagem direta para a nossa equipe.
          </p>
          <div id="fcu-help-origin-badge" style="margin-bottom:12px;padding:6px 12px;background:#e0f2fe;border:1px solid #bae6fd;border-radius:8px;color:#0369a1;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;">
            📍 Origem: <span id="fcu-help-origin-text">Criar conta</span>
          </div>
          <label class="fcu-auth-field">Seu nome
            <input name="full_name" type="text" autocomplete="name" minlength="2" maxlength="120" required>
          </label>
          <label class="fcu-auth-field">E-mail para contato
            <input name="email" type="email" autocomplete="email" maxlength="254" placeholder="voce@exemplo.com" required>
          </label>
          <label class="fcu-auth-field">WhatsApp ou Telefone <span>(opcional)</span>
            <input name="phone" type="tel" maxlength="120" placeholder="(00) 90000-0000">
          </label>
          <label class="fcu-auth-field">Qual a dificuldade encontrada?
            <textarea name="message_text" rows="3" minlength="3" maxlength="1500" placeholder="Conte o que aconteceu. Não informe sua senha." required style="width:100%;box-sizing:border-box;border-radius:10px;padding:10px;border:1px solid var(--auth-line);font:inherit;background:#fff;"></textarea>
          </label>
          <button class="fcu-auth-submit" type="submit">Enviar mensagem para a equipe</button>
          <button class="fcu-auth-link" type="button" data-auth-view="login" style="margin-top:8px;">Voltar para o login</button>
        </form>

        <div class="fcu-auth-view" id="fcu-account-view" data-view="account" hidden>
          <p>Você está conectado como <strong id="fcu-account-email"></strong>.</p>
          <button class="fcu-auth-submit" id="fcu-logout-button" type="button">Sair</button>
        </div>

        <div class="fcu-auth-help-footer" style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;">
          <button type="button" class="fcu-auth-link" data-auth-view="help" style="margin:0 auto;color:#087d99;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:4px;">
            💬 Falar com a equipe
          </button>
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
    if (text) {
      try {
        message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {}
    }
  }

  function setBusy(form, busy) {
    const submit = form && form.querySelector('[type="submit"]');
    if (submit) submit.disabled = !!busy;
  }

  async function postMaster(path, payload) {
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 20000);
    try {
      const response = await fetch(MASTER_API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'O serviço está indisponível. Tente novamente em alguns minutos.');
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function sendAccessRequest(form, payload) {
    // Keep the identifier across a retry: a lost response must not create two requests.
    const signature = JSON.stringify(payload);
    if (form.dataset.requestSignature !== signature) {
      form.dataset.requestSignature = signature;
      form.dataset.submissionId = crypto.randomUUID();
    }
    const result = await postMaster('/feedback', {
      ...payload,
      submission_id: form.dataset.submissionId,
      path: location.pathname,
      page_type: 'authentication'
    });
    if (result.accepted !== true) throw new Error('A equipe ainda não recebeu o pedido. Tente novamente em alguns minutos.');
    delete form.dataset.submissionId;
    delete form.dataset.requestSignature;
  }

  let lastNonHelpView = 'register';
  const viewOriginLabels = {
    'login': 'Tela de Entrar',
    'register': 'Criar conta',
    'reset': 'Esqueci minha senha',
    'new-password': 'Redefinição de senha',
    'account': 'Minha conta'
  };

  function setView(name) {
    if (name !== 'help') {
      lastNonHelpView = name;
    } else {
      const originName = viewOriginLabels[lastNonHelpView] || 'Navegação no Mapa';
      const badgeText = document.getElementById('fcu-help-origin-text');
      if (badgeText) badgeText.textContent = originName;
    }
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
    if ((currentUser && currentUser.id || null) !== (user && user.id || null)) accountIdentityRevision++;
    userUiRevision++;
    currentUser = user || null;
    window.PreditorAuth.user = currentUser;
    ui.button.textContent = currentUser ? 'Minha conta' : 'Entrar';
    document.getElementById('fcu-account-email').textContent = currentUser ? currentUser.email : '';
  }

  // The database enforces this check independently through restrictive RLS.
  // A network failure is NOT a logout and must never discard local drafts.
  async function verifyAccount(user) {
    const candidate = user || currentUser;
    if (!candidate || invalidatingAccount) return false;
    if (window.navigator && window.navigator.onLine === false) return null;
    if (accountCheck && accountCheck.userId === candidate.id) return accountCheck.promise;
    const task = (async function () {
      try {
        const result = await client.rpc('fcu_my_account_status');
        if (result.error || !result.data || typeof result.data.session_valid !== 'boolean') return null;
        // An old response cannot sign out a different account opened in the meantime.
        if (currentUser && currentUser.id !== candidate.id) return false;
        if (result.data.session_valid === true) return true;
        invalidatingAccount = true;
        const reason = result.data.account_status === 'deleted'
          ? 'Sua conta está na lixeira. A equipe pode restaurá-la; suas percepções foram preservadas.'
          : result.data.account_status === 'suspended'
            ? 'Seu acesso foi suspenso pela equipe. Seus desenhos e histórico foram preservados.'
            : 'Esta sessão foi encerrada. Entre novamente para continuar; os rascunhos locais foram preservados.';
        updateUserUi(null);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        openModal('login');
        setMessage(reason, true);
        return false;
      } catch (_) { return null; }
      finally { invalidatingAccount = false; }
    })();
    accountCheck = { userId: candidate.id, promise: task };
    try { return await task; }
    finally { if (accountCheck && accountCheck.promise === task) accountCheck = null; }
  }
  window.PreditorAuth.verifyAccount = verifyAccount;

  async function validatedUser() {
    try {
      const result = await client.auth.getUser();
      return result.data && result.data.user ? result.data.user : null;
    } catch (_) { return null; }
  }

  async function trackEvent(eventName, point) {
    if (!currentUser) return false;
    const owner = currentUser.id;
    // Optional page analytics must not prevent the authenticated activity record.
    try { window.PreditorTelemetry?.track('auth_' + eventName, {}, {cellId: point?.id, area: point?.a || point?.scope}); } catch (_) {}
    const areaId = point && (point.a || point.scope) ? String(point.a || point.scope) : null;
    const cellId = point && point.id ? String(point.id) : null;
    let sessionId = safeStorageGet(SESSION_KEY);
    if (!sessionId && window.crypto && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
      safeStorageSet(SESSION_KEY, sessionId);
    }
    try {
      const result = await client.from('fcu_authenticated_events').insert({
        user_id: owner,
        event_name: eventName,
        session_id: sessionId || null,
        area_id: areaId,
        cell_id: cellId,
        event_data: { page: location.pathname || '/' }
      });
      return !result.error;
    } catch (_) { return false; }
  }

  async function signOutLocal() {
    const owner = currentUser && currentUser.id, revision = accountIdentityRevision;
    if (!owner) return { ok: true, reason: 'already-signed-out' };
    let timer;
    try {
      // Give the authenticated logout record a chance to arrive before its
      // session ends. Unavailable analytics must never trap someone logged in.
      await Promise.race([
        trackEvent('logout').catch(function () { return false; }),
        new Promise(resolve => { timer = window.setTimeout(() => resolve(false), 3000); })
      ]);
    } finally { window.clearTimeout(timer); }
    if (!currentUser || currentUser.id !== owner || accountIdentityRevision !== revision) {
      return { ok: false, reason: 'account-changed' };
    }
    let result;
    try { result = await client.auth.signOut({ scope: 'local' }); }
    catch (_) { result = { error: true }; }
    // SIGNED_OUT may already have cleared the UI. Never clear a new login
    // that appeared while the old session was being closed.
    if (currentUser && (currentUser.id !== owner || accountIdentityRevision !== revision)) {
      return { ok: false, reason: 'account-changed' };
    }
    if (result && result.error) return { ok: false, reason: 'signout-failed', message: 'Não foi possível sair agora. Sua sessão foi mantida; tente novamente.' };
    updateUserUi(null);
    setView('login');
    setMessage('Sessão encerrada neste dispositivo.');
    return { ok: true, reason: 'signed-out' };
  }
  window.PreditorAuth.signOutLocal = signOutLocal;

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

  ui.button.addEventListener('click', function () {
    if (currentUser) {
      if (window.PreditorPerception && typeof window.PreditorPerception.openProfile === 'function') {
        window.PreditorPerception.openProfile();
      } else {
        const panel = document.getElementById('fcu-perception-panel');
        if (panel) {
          panel.classList.add('is-open');
          const shade = document.getElementById('fcu-perception-shade');
          if (shade) shade.classList.add('is-open');
          const tabBtn = document.querySelector('[data-tab="profile"]');
          if (tabBtn) tabBtn.click();
        } else {
          openModal('account');
        }
      }
    } else {
      openModal('login');
    }
  });
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

  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const str = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
    const match = str.match(emailRegex);
    if (!match) return false;

    const domain = match[1];
    const parts = domain.split('.');
    const tld = parts[parts.length - 1];

    const invalidTlds = ['hahah', 'haha', 'test', 'fake', 'invalid', 'local', 'example'];
    if (invalidTlds.includes(tld)) return false;
    if (parts.length < 2 || tld.length < 2) return false;

    return true;
  }

  document.getElementById('fcu-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    setMessage('Entrando...');
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    if (!password || password.length < 6) {
      setBusy(form, false);
      return setMessage('A senha deve ter no mínimo 6 caracteres.', true);
    }
    const result = await client.auth.signInWithPassword({ email, password });
    setBusy(form, false);
    if (result.error) {
      let msg = result.error.message || 'Confira e-mail e senha.';
      if (msg.includes('Invalid login credentials')) msg = 'E-mail ou senha incorretos.';
      else if (msg.includes('Email not confirmed')) msg = 'O acesso desta conta ainda não foi liberado. Use “Falar com a equipe” para pedir ajuda.';
      else if (msg.includes('Password should be at least') || msg.includes('at least 6 characters')) msg = 'A senha deve ter no mínimo 6 caracteres.';
      return setMessage('Não foi possível entrar: ' + msg, true);
    }
    updateUserUi(result.data.user);
    const access = await verifyAccount(result.data.user);
    if (access === false) return;
    if (access !== true) return setMessage('Sua senha foi aceita, mas não foi possível confirmar o acesso agora. Confira a conexão e tente novamente; seus dados locais foram preservados.', true);
    if (result.data.user.user_metadata?.must_change_password === true) {
      return openModal('new-password', 'Defina sua nova senha pessoal para continuar.');
    }
    setMessage('Acesso confirmado.');
    closeModal();
    // Telemetry must not leave a successful login trapped behind the modal.
    trackEvent('login').catch(function () {});
    await resumePendingPoint();
  });

  document.getElementById('fcu-register-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');

    if (!isValidEmail(email)) {
      return setMessage('Informe um e-mail válido (ex.: nome@gmail.com, @hotmail.com, @ibge.gov.br, @universidade.edu.br). Domínios inválidos não são aceitos.', true);
    }
    if (!password || password.length < 6) {
      return setMessage('A senha deve ter no mínimo 6 caracteres.', true);
    }

    const termsAccepted = values.get('terms') === 'on';
    const privacyAcknowledged = values.get('privacy') === 'on';
    if (!termsAccepted || !privacyAcknowledged) {
      return setMessage('Confirme os Termos de Uso e a Política de Privacidade para criar sua conta.', true);
    }

    setBusy(form, true);
    setMessage('Criando sua conta e liberando acesso...');
    const fullName = String(values.get('full_name') || '').trim();
    const institution = String(values.get('institution') || '').trim();

    let createdSuccess = false;
    try {
      const apiData = await postMaster('/register', {
        email, password, full_name: fullName, institution,
        terms_accepted: termsAccepted,
        privacy_acknowledged: privacyAcknowledged,
        terms_version: TERMS_VERSION
      });
      if (apiData.ok !== true) {
        throw new Error('Não recebemos a confirmação do cadastro. Tente entrar ou fale com a equipe.');
      }
      createdSuccess = true;

      const autoLogin = await client.auth.signInWithPassword({ email, password });
      if (!autoLogin.error && autoLogin.data && autoLogin.data.session) {
        updateUserUi(autoLogin.data.user);
        const access = await verifyAccount(autoLogin.data.user);
        if (access === false) return;
        if (access !== true) throw new Error('Acesso ainda não confirmado.');
        form.reset();
        closeModal();
        // First access after signup is a real login, just like the login form.
        trackEvent('login').catch(function () {});
        await resumePendingPoint();
      } else {
        form.reset();
        setView('login');
        document.getElementById('fcu-login-form').querySelector('[name="email"]').value = email;
        setMessage('Sua conta foi criada, mas não conseguimos entrar automaticamente. Tente entrar com sua senha; se precisar, fale com a equipe.', true);
      }
    } catch (error) {
      const detail = error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError
        ? 'Não recebemos uma resposta do serviço. Tente entrar ou fale com a equipe antes de cadastrar novamente.'
        : error.message;
      setMessage(createdSuccess
        ? 'Sua conta foi criada, mas o acesso automático falhou. Entre com sua senha ou fale com a equipe.'
        : 'Não foi possível confirmar o cadastro: ' + detail, true);
    } finally {
      setBusy(form, false);
    }
  });

  document.getElementById('fcu-reset-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const name = String(values.get('full_name') || '').trim();
    const phone = String(values.get('phone') || '').trim();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setMessage('Informe seu nome e o e-mail usado no cadastro.', true);
    }
    setBusy(form, true);
    setMessage('Enviando pedido para a equipe...');
    try {
      await sendAccessRequest(form, { source: 'password_recovery', name, email, phone });
      form.reset();
      setMessage('Pedido recebido pela equipe. A recuperação é manual e exige confirmar sua identidade. Aguarde contato ou procure a equipe pelo canal habitual. Sua senha ainda não foi alterada.');
    } catch (_) {
      setMessage('Não foi possível enviar seu pedido. Os dados foram mantidos; tente novamente em alguns minutos ou procure a equipe pelo canal habitual.', true);
    } finally {
      setBusy(form, false);
    }
  });

  document.getElementById('fcu-new-password-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') || '');
    if (!password || password.length < 6) {
      return setMessage('A nova senha deve ter no mínimo 6 caracteres.', true);
    }
    setBusy(form, true);
    const result = await client.auth.updateUser({
      password: password,
      data: { must_change_password: false }
    });
    setBusy(form, false);
    if (result.error) {
      let errMsg = result.error.message || '';
      if (errMsg.includes('Password should be at least') || errMsg.includes('at least 6 characters')) {
        errMsg = 'A senha deve ter no mínimo 6 caracteres.';
      }
      return setMessage('Não foi possível salvar a nova senha: ' + errMsg, true);
    }
    setMessage('✓ Nova senha alterada e salva com sucesso! Você já está conectado.');
    window.history.replaceState({}, document.title, location.pathname);
    window.setTimeout(function () { closeModal(); }, 1200);
  });

  const helpForm = document.getElementById('fcu-help-form');
  if (helpForm) {
    helpForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const name = String(values.get('full_name') || '').trim();
      const email = String(values.get('email') || '').trim();
      const phone = String(values.get('phone') || '').trim();
      const msg = String(values.get('message_text') || '').trim();
      const originName = viewOriginLabels[lastNonHelpView] || 'Navegação no Mapa';

      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || msg.length < 3) {
        return setMessage('Preencha seu nome, e-mail e a mensagem.', true);
      }

      setBusy(form, true);
      setMessage('Enviando solicitação para a equipe...');
      try {
        await sendAccessRequest(form, {
          source: 'access_help', name, email, phone,
          message: msg, origin_page: originName
        });
        form.reset();
        setMessage('Mensagem recebida pela equipe. Aguarde contato ou procure a equipe pelo canal habitual.', false);
      } catch (_) {
        setMessage('Não foi possível enviar sua mensagem. Os dados foram mantidos; tente novamente em alguns minutos.', true);
      } finally {
        setBusy(form, false);
      }
    });
  }

  document.getElementById('fcu-logout-button').addEventListener('click', async function () {
    const button = document.getElementById('fcu-logout-button');
    button.disabled = true;
    try {
      const result = await signOutLocal();
      if (!result.ok && result.reason !== 'account-changed') setMessage(result.message, true);
    } finally { button.disabled = false; }
  });

  client.auth.onAuthStateChange(function (event, session) {
    window.setTimeout(async function () {
      const user = event === 'SIGNED_OUT' ? null : session && session.user ? session.user : await validatedUser();
      updateUserUi(user);
      if (user && await verifyAccount(user) !== true) return;
      if (user && user.user_metadata && user.user_metadata.must_change_password === true) {
        const banner = document.getElementById('fcu-must-change-banner');
        if (banner) banner.hidden = false;
        openModal('new-password', '🔒 Sua senha é provisória ou de primeiro acesso. Defina sua nova senha pessoal.');
      } else if (user && (event === 'PASSWORD_RECOVERY' || new URLSearchParams(location.search).get('recovery') === '1')) {
        const banner = document.getElementById('fcu-must-change-banner');
        if (banner) banner.hidden = true;
        openModal('new-password', 'Crie uma nova senha para sua conta.');
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && user) {
        await resumePendingPoint();
      }
    }, 0);
  });

  const initialUiRevision = userUiRevision;
  validatedUser().then(async function (user) {
    if (userUiRevision !== initialUiRevision) return;
    updateUserUi(user);
    if (user) await verifyAccount(user);
  });
  window.addEventListener('online', function () { if (currentUser) verifyAccount(); });
  window.addEventListener('focus', function () { if (currentUser) verifyAccount(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && currentUser) verifyAccount(); });
  window.setInterval(function () { if (!document.hidden && currentUser) verifyAccount(); }, 45000);
  window.PreditorAuth.guardCellOpen = guardCellOpen;
  const requestedView = new URLSearchParams(location.search).get('auth');
  if (requestedView === 'login' || requestedView === 'register' || requestedView === 'reset' || requestedView === 'help') {
    openModal(requestedView);
  }
})();
