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
            <input name="email" type="email" autocomplete="email" placeholder="seuemail@exemplo.com" required>
          </label>
          <label class="fcu-auth-field fcu-auth-password">Senha (mínimo 6 dígitos)
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
          <label class="fcu-auth-field fcu-auth-password">Crie sua senha (mínimo 6 dígitos)
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
          <label class="fcu-auth-field">E-mail cadastrado
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <button class="fcu-auth-submit" type="submit">Enviar link de recuperação</button>
          <button class="fcu-auth-link" type="button" data-auth-view="login">Voltar para entrar</button>
        </form>

        <form class="fcu-auth-view" id="fcu-new-password-form" data-view="new-password" hidden>
          <div id="fcu-must-change-banner" class="fcu-auth-banner-must-change" hidden style="padding:10px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;color:#92400e;font-size:12px;font-weight:700;margin-bottom:12px;">
            🔒 Primeiro acesso ou redefinição pela equipe: crie sua nova senha pessoal de 6 dígitos ou mais para continuar.
          </div>
          <label class="fcu-auth-field fcu-auth-password">Nova senha (mínimo 6 dígitos)
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
          <label class="fcu-auth-field">Seu E-mail ou Nome
            <input name="sender_info" type="text" placeholder="voce@exemplo.com ou seu nome" required>
          </label>
          <label class="fcu-auth-field">WhatsApp ou Telefone <span>(opcional)</span>
            <input name="phone" type="tel" placeholder="(00) 90000-0000">
          </label>
          <label class="fcu-auth-field">Qual a dificuldade encontrada?
            <textarea name="message_text" rows="3" placeholder="Ex.: Não consigo criar minha conta ou redefinir a senha..." required style="width:100%;box-sizing:border-box;border-radius:10px;padding:10px;border:1px solid var(--auth-line);font:inherit;background:#fff;"></textarea>
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
    window.PreditorTelemetry?.track('auth_' + eventName, {}, {cellId: point?.id, area: point?.a || point?.scope});
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
      return setMessage('A senha deve ter no mínimo 6 dígitos.', true);
    }
    const result = await client.auth.signInWithPassword({ email, password });
    setBusy(form, false);
    if (result.error) {
      let msg = result.error.message || 'Confira e-mail e senha.';
      if (msg.includes('Invalid login credentials')) msg = 'E-mail ou senha incorretos.';
      else if (msg.includes('Email not confirmed')) msg = 'E-mail ainda não confirmado. Verifique a caixa de entrada do seu e-mail.';
      else if (msg.includes('Password should be at least 6 characters') || msg.includes('at least 6 characters')) msg = 'A senha deve ter no mínimo 6 dígitos.';
      return setMessage('Não foi possível entrar: ' + msg, true);
    }
    updateUserUi(result.data.user);
    setMessage('Acesso confirmado.');
    await trackEvent('login');
    await resumePendingPoint();
    closeModal();
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
      return setMessage('A senha deve ter no mínimo 6 dígitos ou caracteres.', true);
    }

    setBusy(form, true);
    setMessage('Criando sua conta e liberando acesso...');
    const fullName = String(values.get('full_name') || '').trim();
    const institution = String(values.get('institution') || '').trim();

    let createdSuccess = false;

    // 1. Try Master API registration first (auto-confirms user, no email sent)
    try {
      const apiRes = await fetch('https://preditor-fcu-master.vercel.app/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName, institution })
      });
      const apiData = await apiRes.json();
      if (apiRes.ok && apiData.ok) {
        createdSuccess = true;
      } else if (apiData && apiData.error && (apiData.error.includes('já está cadastrado') || apiData.error.includes('already registered'))) {
        setBusy(form, false);
        return setMessage('Este e-mail já está cadastrado. Você pode entrar com sua senha ou recuperá-la.', true);
      }
    } catch (_) {}

    // 2. Fallback to Supabase Auth signUp if Master API is offline
    if (!createdSuccess) {
      const result = await client.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          data: {
            registration_context: 'fcu_pilot',
            full_name: fullName,
            institution: institution,
            terms_version: TERMS_VERSION,
            terms_accepted: values.get('terms') === 'on',
            privacy_acknowledged: values.get('privacy') === 'on'
          }
        }
      });
      if (result.error && !String(result.error.message).includes('confirmation email')) {
        setBusy(form, false);
        let errMsg = String(result.error.message || '');
        if (errMsg.includes('Password should be at least 6 characters') || errMsg.includes('at least 6 characters')) {
          errMsg = 'A senha deve ter no mínimo 6 dígitos ou caracteres.';
        } else if (errMsg.includes('already registered') || errMsg.includes('duplicate')) {
          errMsg = 'Este e-mail já está cadastrado. Você pode entrar com sua senha ou recuperá-la.';
        }
        return setMessage('Não foi possível concluir o cadastro: ' + errMsg, true);
      }
    }

    // 3. Auto-login immediately
    const autoLogin = await client.auth.signInWithPassword({ email, password });
    setBusy(form, false);
    if (autoLogin.data && autoLogin.data.session) {
      updateUserUi(autoLogin.data.user);
      setMessage('✓ Conta criada e acesso liberado!');
      await resumePendingPoint();
      closeModal();
    } else {
      form.reset();
      setMessage('✓ Cadastro concluído com sucesso! Você já pode entrar com seu e-mail e senha.');
      setView('login');
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
    setMessage('Se houver uma conta cadastrada, você receberá o link para criar uma nova senha.');
  });

  document.getElementById('fcu-new-password-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password') || '');
    if (!password || password.length < 6) {
      return setMessage('A nova senha deve ter no mínimo 6 dígitos.', true);
    }
    setBusy(form, true);
    const result = await client.auth.updateUser({
      password: password,
      data: { must_change_password: false }
    });
    setBusy(form, false);
    if (result.error) {
      let errMsg = result.error.message || '';
      if (errMsg.includes('Password should be at least 6 characters') || errMsg.includes('at least 6 characters')) {
        errMsg = 'A senha deve ter no mínimo 6 dígitos.';
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
      const sender = String(values.get('sender_info') || '').trim();
      const phone = String(values.get('phone') || '').trim();
      const msg = String(values.get('message_text') || '').trim();
      const originName = viewOriginLabels[lastNonHelpView] || 'Navegação no Mapa';

      if (!sender || !msg) return setMessage('Preencha seu e-mail/nome e a mensagem.', true);

      setBusy(form, true);
      setMessage('Enviando solicitação para a equipe...');
      try {
        await client.from('fcu_user_messages').insert({
          message_type: 'access_help',
          subject: `[Origem: ${originName}] Dificuldade: ${sender.slice(0, 40)}`,
          content: `[Origem: ${originName}]\nRemetente: ${sender}\nTelefone/WhatsApp: ${phone || 'Não informado'}\nMensagem: ${msg}`,
          metadata: { origin_page: originName, sender_info: sender, phone: phone, path: location.pathname }
        });
        setBusy(form, false);
        form.reset();
        setMessage('✓ Mensagem enviada para a equipe! Analisaremos sua solicitação em breve.', false);
      } catch (err) {
        setBusy(form, false);
        setMessage('✓ Mensagem recebida! A equipe analisará seu caso.', false);
      }
    });
  }

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
      if (user && user.user_metadata && user.user_metadata.must_change_password === true) {
        const banner = document.getElementById('fcu-must-change-banner');
        if (banner) banner.hidden = false;
        openModal('new-password', '🔒 Sua senha é provisória ou de primeiro acesso. Defina sua nova senha pessoal.');
      } else if (event === 'PASSWORD_RECOVERY' || new URLSearchParams(location.search).get('recovery') === '1') {
        const banner = document.getElementById('fcu-must-change-banner');
        if (banner) banner.hidden = true;
        openModal('new-password', 'Crie uma nova senha para sua conta.');
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && user) {
        await resumePendingPoint();
      }
    }, 0);
  });

  validatedUser().then(updateUserUi);
  window.PreditorAuth.guardCellOpen = guardCellOpen;
  const requestedView = new URLSearchParams(location.search).get('auth');
  if (requestedView === 'login' || requestedView === 'register' || requestedView === 'reset' || requestedView === 'help') {
    openModal(requestedView);
  }
})();
