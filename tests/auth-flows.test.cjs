const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');

// Exercise the real form handlers without creating accounts or sending messages.
function fixture({ responses = [], login = { data: {}, error: { message: 'offline' } } } = {}) {
  const elements = new Map();
  const requests = [];
  const authCalls = [];
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
      signUp: async () => { throw new Error('Direct signUp fallback must not run'); },
      resetPasswordForEmail: async () => { throw new Error('SMTP recovery must not run'); }
    },
    from() { throw new Error('Anonymous direct database writes must not run'); }
  };
  const window = {
    supabase: { createClient: () => client },
    setTimeout: () => 1, clearTimeout() {},
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
    element, requests, authCalls, window,
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
});
