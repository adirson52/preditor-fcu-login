const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');

// Exercise the real form handlers without creating accounts or sending messages.
function fixture({ responses = [], account = { account_status: 'active', session_valid: true }, login = { data: {}, error: { message: 'offline' } }, eventError = null, telemetryThrows = false, eventHook, signOutResponse = {} } = {}) {
  const elements = new Map();
  const requests = [];
  const authCalls = [];
  const signouts = [];
  const events = [];
  const timers = [];
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {
      id, dataset: {}, handlers: {}, style: {}, values: {}, textContent: '',
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle: (value, on) => on ? classes.add(value) : classes.delete(value)
      },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      querySelector(selector) { return element(id + ' ' + selector); },
      setAttribute() {}, appendChild() {}, scrollIntoView() {}, focus() {},
      reset() { this.resetCalled = true; }
    };
    elements.set(id, el);
    return el;
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange() {},
      signInWithPassword: async payload => { authCalls.push(payload); return login; },
      signOut: async options => { signouts.push(options); if (signOutResponse instanceof Error) throw signOutResponse; return typeof signOutResponse === 'function' ? signOutResponse() : signOutResponse; },
      signUp: async () => { throw new Error('Direct signUp fallback must not run'); },
      resetPasswordForEmail: async () => { throw new Error('SMTP recovery must not run'); }
    },
    from(table) {
      assert.ok(window.PreditorAuth.user, 'Anonymous direct database writes must not run');
      assert.equal(table, 'fcu_authenticated_events');
      return { insert: async event => { events.push(event); return eventHook ? eventHook(event) : { error: eventError }; } };
    },
    rpc: async name => { assert.equal(name, 'fcu_my_account_status'); return account instanceof Error ? { error: account } : { data: account }; }
  };
  const window = {
    supabase: { createClient: () => client },
    PreditorTelemetry: { track() { if (telemetryThrows) throw new Error('Optional analytics unavailable'); } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, active: true }); return timers.length - 1; }, clearTimeout: id => { if (timers[id]) timers[id].active = false; },
    setInterval: () => 1, addEventListener() {}, navigator: { onLine: true },
    history: { replaceState() {} }
  };
  const context = vm.createContext({
    window, console, AbortController, URLSearchParams,
    location: { origin: 'https://preditor-fcu-login.vercel.app', pathname: '/', search: '' },
    localStorage: { getItem: () => '', setItem() {} },
    crypto: { randomUUID: () => '75d39b2b-9407-488f-b8fd-111111111111' },
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key]; } },
    document: {
      body: element('body'), createElement: tag => element('created-' + tag),
      getElementById: element, querySelector: element, querySelectorAll: () => [], addEventListener() {}
    },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { ok: response?.ok ?? true, json: async () => response?.body ?? { accepted: true } };
    }
  });
  vm.runInContext(code, context);
  return {
    element, requests, authCalls, signouts, events, timers, window,
    async submit(id, values) {
      const form = element(id);
      form.values = values;
      await form.handlers.submit({ preventDefault() {}, currentTarget: form });
      return { form, text: element('fcu-auth-message').textContent, error: element('fcu-auth-message').classList.contains('is-error') };
    }
  };
}

const contact = { full_name: 'Pessoa Teste', email: 'pessoa@example.org', phone: '(11) 00000-0000' };
const signup = { ...contact, institution: 'Instituição', password: '123456', terms: 'on', privacy: 'on' };

test('forgot password creates only a manual recovery request, with no password or SMTP', async () => {
  const app = fixture();
  const result = await app.submit('fcu-reset-form', contact);
  assert.equal(result.error, false);
  assert.match(result.text, /recuperação é manual/);
  assert.equal(app.requests.length, 1);
  assert.match(app.requests[0].url, /\/api\/feedback$/);
  assert.equal(app.requests[0].body.source, 'password_recovery');
  assert.equal(app.requests[0].body.email, contact.email);
  assert.equal(Object.hasOwn(app.requests[0].body, 'password'), false);
  assert.equal(app.authCalls.length, 0);
  assert.equal(result.form.resetCalled, true);
});

test('failed request retains details and retries with the same submission ID', async () => {
  const app = fixture({ responses: [{ ok: false, body: { error: 'unavailable' } }, { body: { accepted: true } }] });
  const first = await app.submit('fcu-reset-form', contact);
  assert.equal(first.error, true);
  assert.equal(first.form.resetCalled, undefined);
  assert.match(first.text, /Não foi possível enviar/);
  const second = await app.submit('fcu-reset-form', contact);
  assert.equal(second.error, false);
  assert.equal(app.requests[0].body.submission_id, app.requests[1].body.submission_id);
});

test('HTTP 200 without accepted true is not shown as successful receipt', async () => {
  const app = fixture({ responses: [{ body: { accepted: false } }] });
  const result = await app.submit('fcu-reset-form', contact);
  assert.equal(result.error, true);
  assert.equal(result.form.resetCalled, undefined);
});

test('general access help uses the protected receipt API and reports failures', async () => {
  const app = fixture({ responses: [{ ok: false, body: { error: 'Too many requests' } }] });
  const result = await app.submit('fcu-help-form', { ...contact, message_text: 'Preciso de ajuda' });
  assert.equal(app.requests[0].body.source, 'access_help');
  assert.equal(result.error, true);
  assert.equal(result.form.resetCalled, undefined);
});

test('registration requires explicit consents before contacting the API', async () => {
  const app = fixture();
  const result = await app.submit('fcu-register-form', { ...signup, terms: undefined });
  assert.equal(result.error, true);
  assert.equal(app.requests.length, 0);
});

test('registration API failure does not bypass the server or report success', async () => {
  const app = fixture({ responses: [{ ok: false, body: { error: 'Cadastro fechado.' } }] });
  const result = await app.submit('fcu-register-form', signup);
  assert.equal(result.error, true);
  assert.match(result.text, /Cadastro fechado/);
  assert.equal(app.authCalls.length, 0);
  assert.equal(app.requests[0].body.terms_accepted, true);
  assert.equal(app.requests[0].body.privacy_acknowledged, true);
  assert.equal(app.requests[0].body.terms_version, 'pilot-2026-09-11');
});

test('confirmed account creation with failed auto-login gives accurate next step', async () => {
  const app = fixture({ responses: [{ body: { ok: true } }] });
  const result = await app.submit('fcu-register-form', signup);
  assert.match(result.text, /conta foi criada.*não conseguimos entrar automaticamente/);
  assert.equal(result.error, true);
  assert.equal(app.authCalls.length, 1);
});

test('confirmed account and session close the modal and clear the password form', async () => {
  const app = fixture({ responses: [{ body: { ok: true } }], login: { data: { session: {}, user: { id: 'user-id', email: contact.email } } } });
  const result = await app.submit('fcu-register-form', signup);
  assert.equal(app.window.PreditorAuth.user.email, contact.email);
  assert.equal(result.form.resetCalled, true);
  assert.equal(result.text, '');
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].user_id, 'user-id');
  assert.equal(app.events[0].event_name, 'login');
});

test('signup first access records authenticated login even when optional analytics fails', async () => {
  const app = fixture({ responses: [{ body: { ok: true } }], telemetryThrows: true,
    login: { data: { session: {}, user: { id: 'new-user', email: contact.email } } } });
  const result = await app.submit('fcu-register-form', signup);
  assert.equal(result.error, false);
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].user_id, 'new-user');
  assert.equal(app.events[0].event_name, 'login');
  assert.equal(result.form.resetCalled, true);
});

test('failed activity recording does not lock a successfully created account in the form', async () => {
  const app = fixture({ responses: [{ body: { ok: true } }], eventError: { message: 'unavailable' },
    login: { data: { session: {}, user: { id: 'new-user', email: contact.email } } } });
  const result = await app.submit('fcu-register-form', signup);
  assert.equal(app.window.PreditorAuth.user.id, 'new-user');
  assert.equal(result.form.resetCalled, true);
  assert.equal(result.error, false);
});

test('suspended or deleted accounts close only the local session and preserve drafts', async () => {
  for (const account_status of ['suspended', 'deleted']) {
    const app = fixture({ account: { account_status, session_valid: false }, login: { data: { user: { id: 'qa', email: contact.email } } } });
    const result = await app.submit('fcu-login-form', signup);
    assert.equal(app.window.PreditorAuth.user, null);
    assert.equal(app.signouts.length, 1);
    assert.equal(app.signouts[0].scope, 'local');
    assert.equal(result.error, true);
    assert.match(result.text, /preservad/);
    assert.equal(app.events.length, 0);
  }
});

test('unavailable account-status service does not report login success or erase session', async () => {
  const app = fixture({ account: new Error('network'), login: { data: { user: { id: 'qa', email: contact.email } } } });
  const result = await app.submit('fcu-login-form', signup);
  assert.equal(app.signouts.length, 0);
  assert.equal(app.window.PreditorAuth.user.id, 'qa');
  assert.equal(result.error, true);
  assert.match(result.text, /não foi possível confirmar o acesso/);
  assert.equal(app.events.length, 0);
});

test('revoked session asks for new login without using metadata as authorization', async () => {
  const app = fixture({ account: { account_status: 'active', session_valid: false }, login: { data: { user: { id: 'qa', email: contact.email, user_metadata: { account_status: 'active' } } } } });
  const result = await app.submit('fcu-login-form', signup);
  assert.equal(app.window.PreditorAuth.user, null);
  assert.match(result.text, /Entre novamente/);
});

const loggedIn = (extra = {}) => fixture({ login: { data: { session: {}, user: { id: 'owner-a', email: contact.email } } }, ...extra });

test('both logout paths share a local-session helper and record the activity before closing the session', async () => {
  const app = loggedIn({ signOutResponse: () => {
    assert.equal(app.events.at(-1).event_name, 'logout');
    assert.equal(app.events.at(-1).user_id, 'owner-a');
    return { error: null };
  } });
  await app.submit('fcu-login-form', signup);
  assert.equal(typeof app.window.PreditorAuth.signOutLocal, 'function');
  await app.element('fcu-logout-button').handlers.click();
  assert.equal(app.signouts.length, 1);
  assert.equal(app.signouts[0].scope, 'local');
  assert.equal(app.window.PreditorAuth.user, null);
  assert.match(app.element('fcu-auth-message').textContent, /neste dispositivo/);
  assert.equal(app.element('fcu-logout-button').disabled, false);
  const perception = fs.readFileSync(path.join(__dirname, '..', 'perception.js'), 'utf8');
  assert(perception.includes("$('#fcu-profile-logout').onclick = logoutProfile;"));
  assert(perception.includes('await auth.signOutLocal()'));
  assert(!/\.auth\.signOut\(\s*\)/.test(perception), 'No default/global sign-out remains in the profile.');
});

test('failed optional analytics and authenticated-event recording do not block local logout', async () => {
  const app = loggedIn({ telemetryThrows: true, eventError: { message: 'Unavailable' } });
  await app.submit('fcu-login-form', signup);
  assert.equal((await app.window.PreditorAuth.signOutLocal()).ok, true);
  assert.equal(app.signouts[0].scope, 'local');
  assert.equal(app.events.at(-1).event_name, 'logout');
  assert.equal(app.window.PreditorAuth.user, null);
});

test('stalled analytics is bounded and its eventual failure cannot block logout', async () => {
  const app = loggedIn({ eventHook: event => event.event_name === 'logout' ? new Promise(() => {}) : { error: null } });
  await app.submit('fcu-login-form', signup);
  const pending = app.window.PreditorAuth.signOutLocal();
  assert.equal(app.signouts.length, 0);
  const timeout = app.timers.find(timer => timer.ms === 3000 && timer.active);
  assert(timeout); timeout.fn();
  assert.equal((await pending).ok, true);
  assert.equal(app.signouts.length, 1);
  assert.equal(timeout.active, false);
});

test('returned or thrown logout error leaves the authenticated user and visible error intact', async () => {
  for (const signOutResponse of [{ error: { message: 'network' } }, new Error('network')]) {
    const app = loggedIn({ signOutResponse }); await app.submit('fcu-login-form', signup);
    await app.element('fcu-logout-button').handlers.click();
    assert.equal(app.window.PreditorAuth.user.id, 'owner-a');
    assert.match(app.element('fcu-auth-message').textContent, /Não foi possível sair/);
    assert.equal(app.element('fcu-auth-message').classList.contains('is-error'), true);
    assert.equal(app.element('fcu-logout-button').disabled, false);
    assert.equal(app.signouts[0].scope, 'local');
  }
});

test('owner change while recording logout never signs out the new account', async () => {
  let release;
  const login = { data: { session: {}, user: { id: 'owner-a', email: contact.email } } };
  const app = loggedIn({ login, eventHook: event => event.event_name === 'logout' ? new Promise(resolve => { release = () => resolve({ error: null }); }) : { error: null } });
  await app.submit('fcu-login-form', signup);
  const pending = app.window.PreditorAuth.signOutLocal();
  login.data.user = { id: 'owner-b', email: 'other@example.test' };
  await app.submit('fcu-login-form', { ...signup, email: 'other@example.test' });
  release();
  assert.equal((await pending).reason, 'account-changed');
  assert.equal(app.signouts.length, 0);
  assert.equal(app.window.PreditorAuth.user.id, 'owner-b');
  assert.equal(app.events.filter(event => event.event_name === 'logout')[0].user_id, 'owner-a');
  assert(!/Sessão encerrada/.test(app.element('fcu-auth-message').textContent));
});

function profileLogoutFixture({ helper, sdkResponse = {}, confirmResult = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'perception.js'), 'utf8');
  const start = source.indexOf('  async function logoutProfile()');
  const end = source.indexOf('  function renderUserProfileTab()', start);
  assert(start >= 0 && end > start);
  const messages = [], calls = [], state = { owner: 'owner-a', epoch: 1, closed: 0 }, button = {};
  const context = vm.createContext({
    window: { PreditorAuth: helper ? { signOutLocal: helper } : {} },
    confirm: () => confirmResult, ownerId: () => state.owner, accountEpoch: 1,
    sameAccount: (id, epoch) => state.owner === id && state.epoch === epoch,
    $: () => button, status: (text, error, target) => messages.push({ text, error, target }),
    closeProfilePanel: () => { state.closed++; },
    client: () => ({ auth: { signOut: async options => { calls.push(options); if (sdkResponse instanceof Error) throw sdkResponse; return sdkResponse; } } })
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.run = logoutProfile;', context);
  return { run: context.run, messages, calls, state, button };
}

test('profile logout uses the shared helper and keeps errors visible on its own card', async () => {
  let count = 0;
  const failed = profileLogoutFixture({ helper: async () => { count++; return { ok: false, reason: 'signout-failed', message: 'Não foi possível sair.' }; } });
  assert.equal((await failed.run()).ok, false);
  assert.equal(count, 1);
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.state.closed, 0);
  assert.equal(failed.messages.at(-1).target, '#fcu-profile-logout-status');
  assert.equal(failed.messages.at(-1).error, true);
  assert.equal(failed.button.disabled, false);
  const success = profileLogoutFixture({ helper: async () => ({ ok: true, reason: 'signed-out' }) });
  assert.equal((await success.run()).ok, true);
  assert.equal(success.calls.length, 0);
  assert.equal(success.state.closed, 1);
});

test('profile fallback always scopes logout locally and does not hide returned or thrown errors', async () => {
  for (const sdkResponse of [{ error: null }, { error: { message: 'network' } }, new Error('network')]) {
    const app = profileLogoutFixture({ sdkResponse });
    const result = await app.run();
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].scope, 'local');
    assert.equal(result.ok, !(sdkResponse instanceof Error || sdkResponse.error));
    assert.equal(app.state.closed, result.ok ? 1 : 0);
    if (!result.ok) assert.equal(app.messages.at(-1).error, true);
  }
});

test('profile logout cancellation or account change cannot close another account panel', async () => {
  const cancelled = profileLogoutFixture({ confirmResult: false });
  assert.equal((await cancelled.run()).reason, 'cancelled');
  assert.equal(cancelled.calls.length, 0);
  let release;
  const changed = profileLogoutFixture({ helper: () => new Promise(resolve => { release = resolve; }) });
  const pending = changed.run(); changed.state.owner = 'owner-b'; changed.state.epoch++;
  release({ ok: false, reason: 'account-changed' });
  assert.equal((await pending).reason, 'account-changed');
  assert.equal(changed.state.closed, 0);
  assert.equal(changed.messages.some(message => message.error), false);
});
