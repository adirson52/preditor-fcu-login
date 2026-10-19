/* Account-owned analytics outbox. No passwords or access tokens are persisted. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createPreditorDelivery = factory;
})(typeof window === 'object' ? window : globalThis, function (options) {
  'use strict';
  const prefix = 'preditor_usage_outbox_v2:', ttl = 7 * 86400000, limit = 500;
  const memory = new Map(), clock = options.now || Date.now;
  let owner = '', verifiedAt = 0, checking = false, flushing = false, blockedUntil = 0, failures = 0, boundClient;
  function drop(key) { memory.delete(key); try { options.storage?.removeItem(key); } catch (_) {} }
  function entries() {
    const rows = new Map(memory);
    try {
      for (let i = 0; i < options.storage.length; i++) {
        const key = options.storage.key(i);
        if (key?.startsWith(prefix)) rows.set(key, JSON.parse(options.storage.getItem(key)));
      }
    } catch (_) {}
    const valid = [];
    for (const [key, event] of rows) {
      if (!event || !event.user_id || key !== prefix + event.user_id + ':' + event.event_id
          || !Number.isFinite(Date.parse(event.occurred_at)) || clock() - Date.parse(event.occurred_at) > ttl) { drop(key); continue; }
      valid.push([key, event]);
    }
    valid.sort((a,b) => Date.parse(a[1].occurred_at) - Date.parse(b[1].occurred_at));
    while (valid.length > limit) drop(valid.shift()[0]);
    return valid;
  }
  function clear() { entries().forEach(([key]) => drop(key)); }
  function setOwner(next) {
    if (owner === next) return;
    owner = next; verifiedAt = 0;
    options.onIdentity?.(next);
  }
  async function check() {
    if (checking) return;
    const client = options.getClient();
    if (!client) return;
    if (boundClient !== client) {
      boundClient = client;
      client.auth.onAuthStateChange?.(() => {
        // Never call an awaited Supabase API from inside its auth callback.
        setTimeout(() => { verifiedAt = 0; check(); }, 0);
      });
    }
    checking = true;
    try {
      const session = (await client.auth.getSession()).data?.session;
      if (!session?.user?.id) { setOwner(''); return; }
      if (owner && owner !== session.user.id) setOwner('');
      if (owner && clock() - verifiedAt < 45000) return;
      const result = await client.rpc('fcu_my_products');
      const status = result.data;
      const current = (await client.auth.getSession()).data?.session;
      if (current?.user?.id !== session.user.id) { setOwner(''); return; }
      if (result.error) return; // A network error is not a logout.
      if (!status || status.user_id !== session.user.id || !status.session_valid || status.account_status !== 'active'
          || status.access_ready === false || status.password_change_required || status.terms_required
          || !status.products?.some(p => p.id === 'login' && p.allowed === true)) { setOwner(''); return; }
      setOwner(session.user.id);
      verifiedAt = clock();
    } catch (_) {} finally { checking = false; }
  }
  async function flush() {
    if (flushing) return;
    if (!options.enabled()) { clear(); return; }
    if (options.online && !options.online() || clock() < blockedUntil) return;
    flushing = true;
    try {
      await check();
      if (!owner) return;
      for (const [key,event] of entries().filter(([,e]) => e.user_id === owner).slice(0,25)) {
        if (!options.enabled()) { clear(); break; }
        const session = (await options.getClient().auth.getSession()).data?.session;
        if (!session?.access_token || session.user?.id !== owner || event.user_id !== owner) { setOwner(''); break; }
        const response = await options.fetch(options.endpoint, {
          method:'POST', mode:'cors', credentials:'omit', keepalive:true,
          headers:{'Content-Type':'application/json',Authorization:'Bearer ' + session.access_token},
          body:JSON.stringify(event), signal:AbortSignal.timeout(12000)
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && (data.accepted === true || data.privacy === true)) {
          drop(key); failures = 0; blockedUntil = 0;
        } else if ([400,413].includes(response.status)) drop(key);
        else {
          if ([401,403].includes(response.status)) setOwner('');
          throw new Error('Activity not acknowledged');
        }
      }
    } catch (_) {
      failures++; blockedUntil = clock() + Math.min(60000,1000 * Math.pow(2,Math.min(failures,6)));
    } finally { flushing = false; }
  }
  function enqueue(event) {
    if (!owner || !options.enabled() || event.user_id !== owner) return false;
    // Only the analytics payload is stored. Credentials are read anew for each send.
    const safe = JSON.parse(JSON.stringify(event));
    for (const key of ['access_token','refresh_token','password','test_token','user_email','user_name','institution']) delete safe[key];
    const key = prefix + owner + ':' + safe.event_id;
    memory.set(key,safe);
    try { options.storage?.setItem(key,JSON.stringify(safe)); } catch (_) {}
    entries(); flush();
    return true;
  }
  return Object.freeze({enqueue,flush,check,clear,userId:() => owner,pending:() => entries().filter(([,e]) => e.user_id === owner).length});
});
