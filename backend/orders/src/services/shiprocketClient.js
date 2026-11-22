// Shiprocket API client (https://apidocs.shiprocket.in). No database in here, so it can be tested with a fake fetch.
// Login: POST /v1/external/auth/login {email, password} -> token (valid about 10 days). The email and password are those of a Shiprocket API USER
// (Shiprocket > Settings > API > Add New API User), which must differ from the main Shiprocket login. Every other call sends "Authorization: Bearer <token>".
const cfg = require('../config');

const TIMEOUT_MS = 30000;
const TOKEN_LIFE_MS = 9 * 24 * 3600 * 1000; // Shiprocket tokens last 10 days: renew a day early
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const bare = (v) => clean(v).replace(/^#/, '');

class ShiprocketError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'ShiprocketError'; this.status = status; this.code = code; }
}

const isMock = () => process.env.SHIPROCKET_MOCK === '1';
const isConfigured = () => isMock() || !!(cfg.shiprocket.email && cfg.shiprocket.password);

let token = null; let tokenAt = 0; let loginInFlight = null;
const forgetToken = () => { token = null; tokenAt = 0; };

async function rawFetch(method, path, { query, body, auth = true, once = false } = {}) {
  const { apiBase } = cfg.shiprocket;
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const url = `${apiBase}/v1/external/${path}${qs}`;
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await login()}`;
  const opts = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let lastErr;
  for (let attempt = 0; attempt < (once ? 1 : 3); attempt++) {
    let res;
    try { res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { lastErr = new ShiprocketError(`Could not reach Shiprocket: ${e.message}${once ? '. Shiprocket may have created the manifest anyway: check Shiprocket before trying again.' : ''}`); if (once) throw lastErr; await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { lastErr = new ShiprocketError(`Shiprocket is busy (HTTP ${res.status})${once ? '. Shiprocket may have created the manifest anyway: check Shiprocket before trying again.' : ''}`, { status: res.status }); if (once) throw lastErr; await sleep(2000 * (attempt + 1)); continue; }
    let raw = ''; let data = null;
    if (typeof res.text === 'function') { raw = await res.text().catch(() => ''); try { data = JSON.parse(raw); } catch { data = null; } }
    else data = await res.json().catch(() => null);
    if (res.status === 401 && auth) { forgetToken(); throw new ShiprocketError('Shiprocket rejected the saved login token. Try again; if it keeps happening, check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.', { status: 401, code: 'auth' }); }
    return { status: res.status, data, raw };
  }
  throw lastErr || new ShiprocketError('Shiprocket request failed');
}

const detailOf = (d, raw) => {
  const m = d && (d.message || d.msg || d.error);
  if (typeof m === 'string' && m) return m;
  if (d && d.errors && typeof d.errors === 'object') return Object.entries(d.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('; ');
  return clean(raw).replace(/\s+/g, ' ').slice(0, 160);
};

async function login() {
  if (!isConfigured()) throw new ShiprocketError('Shiprocket is not set up yet. Add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD on the server.', { status: 400, code: 'not_configured' });
  if (isMock()) return 'mock-token';
  if (token && Date.now() - tokenAt < TOKEN_LIFE_MS) return token;
  if (loginInFlight) return loginInFlight; // several lookups starting together share one login
  loginInFlight = (async () => {
    const { email, password } = cfg.shiprocket;
    const r = await rawFetch('POST', 'auth/login', { body: { email, password }, auth: false });
    if (r.status === 403 || r.status === 401 || !r.data || !r.data.token) {
      throw new ShiprocketError(`Shiprocket rejected the login (HTTP ${r.status}). Shiprocket said: ${detailOf(r.data, r.raw) || 'nothing'}. Use the email and password of a Shiprocket API user (Settings > API > Add New API User), not your main login.`, { status: r.status === 403 ? 401 : r.status, code: 'auth' });
    }
    token = r.data.token; tokenAt = Date.now();
    return token;
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

const call = (method, path, opts = {}) => rawFetch(method, path, opts);

async function authenticate() {
  if (isMock()) return { ok: true, mock: true };
  forgetToken();
  await login();
  return { ok: true };
}

// ---------------------------------------------------------------------------- mock (local testing without an account)
// Orders whose number ends in 4 or 9 have no shipment yet; the rest get an AWB. Manifests are accepted except for orders ending in 7.
const mockOrder = (id) => {
  const n = Number(bare(id));
  if (!Number.isFinite(n) || /[49]$/.test(String(n))) return null;
  return { id: 700000 + n, channel_order_id: String(n), status: 'PICKUP SCHEDULED', shipments: [{ id: 800000 + n, awb: `SRMOCK${n}`, courier: 'Delhivery Surface' }] };
};

// -> { found: true, id, response: { order, track } } | { found: false, message }. Throws ShiprocketError for login, network and server problems.
async function getOrderShipment(orderId) {
  if (isMock()) { const o = mockOrder(orderId); return o ? { found: true, id: String(orderId), response: { order: o, track: null } } : { found: false, message: 'In Shiprocket, but no AWB yet (demo)' }; }
  const want = bare(orderId);
  const r = await call('GET', 'orders', { query: { search: want, per_page: '25' } });
  if (r.status === 401) throw new ShiprocketError('Shiprocket rejected the login', { status: 401, code: 'auth' });
  if (!r.data) throw new ShiprocketError(`Shiprocket sent an unreadable reply (HTTP ${r.status}): ${detailOf(r.data, r.raw) || 'empty'}`, { status: r.status });
  const list = Array.isArray(r.data.data) ? r.data.data : [];
  let hit = list.find((x) => bare(x.channel_order_id) === want); // never trust the search: accept only the exact channel order id
  if (!hit) { try { hit = (await recentOrders(100)).find((x) => bare(x.channel_order_id) === want); } catch (e) { if (e.code === 'auth') throw e; } } // search missed it: look in the newest orders
  if (!hit) return { found: false, message: detailOf(r.data, r.raw) && !list.length && r.status >= 400 ? detailOf(r.data, r.raw) : 'Order not found in Shiprocket' };
  // The track call is richer (status text, scans, weights). If it fails we still have the list status.
  let track = null;
  const sh = Array.isArray(hit.shipments) ? hit.shipments.filter((s) => s && (s.awb || s.awb_code)).pop() : hit.shipments && (hit.shipments.awb || hit.shipments.awb_code) ? hit.shipments : null;
  const awb = clean(sh && (sh.awb || sh.awb_code));
  if (awb) {
    try { const t = await call('GET', `courier/track/awb/${encodeURIComponent(awb)}`); if (t.status < 400 && t.data && t.data.tracking_data) track = t.data.tracking_data; }
    catch (e) { if (e.code === 'auth') throw e; }
  }
  return { found: true, id: bare(hit.channel_order_id), response: { order: hit, track } };
}


// The newest orders Shiprocket holds, as a plain list. Used by the Settings test (to show what Shiprocket really has) and as a fallback when the
// search call does not find an order: one list is fetched and kept for 2 minutes, so many "not found" lookups do not each cost a call.
const mockRecent = () => [3001, 3000, 2999].map((n) => ({ id: 700000 + n, channel_order_id: String(n), status: 'PICKUP SCHEDULED', shipments: [{ id: 800000 + n, awb: `SRMOCK${n}`, courier: 'Delhivery Surface' }] }));
let recentCache = { at: 0, list: [] };
async function recentOrders(limit = 100, { fresh = false } = {}) {
  if (isMock()) return mockRecent();
  if (!fresh && recentCache.list.length && Date.now() - recentCache.at < 2 * 60000) return recentCache.list;
  const r = await call('GET', 'orders', { query: { per_page: String(Math.min(limit, 100)), sort: 'DESC', sort_by: 'created_at' } });
  if (r.status === 401) throw new ShiprocketError('Shiprocket rejected the login', { status: 401, code: 'auth' });
  const list = r.data && Array.isArray(r.data.data) ? r.data.data : [];
  recentCache = { at: Date.now(), list };
  return list;
}
const simple = (o) => { const sh = Array.isArray(o.shipments) ? o.shipments.filter((x) => x && (x.awb || x.awb_code)).pop() : o.shipments && (o.shipments.awb || o.shipments.awb_code) ? o.shipments : null; return { channelOrderId: clean(o.channel_order_id), shiprocketId: clean(o.id), status: clean(o.status), awb: clean(sh && (sh.awb || sh.awb_code)), courier: clean(sh && sh.courier) }; };

// Create ONE manifest for these shipments (Shiprocket shipment ids). Shiprocket answers with a PDF link and no manifest id,
// lib/shiprocketManifest.js reads the reply. Never retried automatically: creating a manifest is not safe to repeat.
async function createManifest({ shipmentIds }) {
  if (isMock()) {
    const bad = shipmentIds.filter((s) => /7$/.test(String(s)));
    return { status: 200, data: { status: 1, manifest_url: `https://mock.shiprocket.local/manifest/MOCK${Date.now().toString(36).toUpperCase()}.pdf`, ...(bad.length ? { errors: Object.fromEntries(bad.map((b) => [b, ['Pickup address is not serviceable for this courier (demo)']])) } : {}) } };
  }
  const r = await call('POST', 'manifests/generate', { body: { shipment_id: shipmentIds.map(Number) }, once: true });
  return { status: r.status, data: r.data, raw: r.raw };
}

module.exports = { ShiprocketError, isConfigured, isMock, authenticate, getOrderShipment, createManifest, recentOrders, simple, _reset: () => { forgetToken(); recentCache = { at: 0, list: [] }; } };
