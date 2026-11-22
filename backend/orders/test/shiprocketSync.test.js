// Shiprocket client + provider-aware sync, against a fake Shiprocket API and an in-memory stand-in for the database.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.SHIPROCKET_EMAIL = 'api@example.com';
process.env.SHIPROCKET_PASSWORD = 'secret';
process.env.SHIPWAY_USERNAME = ''; process.env.SHIPWAY_LICENSE_KEY = '';
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'dotenv' ? { config() {} } : orig.call(this, req, ...r); };

const rocket = require('../src/services/shiprocketClient');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let calls = [];
const fake = (handler) => { calls = []; global.fetch = async (url, opts = {}) => { const u = new URL(url); calls.push({ method: opts.method || 'GET', path: u.pathname.replace('/v1/external/', ''), search: u.search, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers && opts.headers.Authorization }); return handler(u, opts); }; };

const ORDER = { id: 9001, channel_order_id: '2919', status: 'PICKUP SCHEDULED', shipments: [{ id: 55, awb: 'SR123456', courier: 'Delhivery Surface' }] };
const TRACK = { tracking_data: { shipment_status: 18, shipment_track: [{ current_status: 'In Transit', courier_name: 'Delhivery', awb_code: 'SR123456', destination: 'Jalandhar' }], shipment_track_activities: [{ date: '2026-10-20 09:00:00', 'sr-status-label': 'IN TRANSIT' }] } };
const api = (u) => {
  if (u.pathname.endsWith('/auth/login')) return json({ token: 'TOKEN-1' });
  if (u.pathname.endsWith('/orders')) return json({ data: [{ id: 1, channel_order_id: '29190' }, ORDER] }); // the search also returns a near-miss
  if (u.pathname.includes('/courier/track/awb/')) return json(TRACK);
  if (u.pathname.endsWith('/manifests/generate')) return json({ status: 1, manifest_url: 'https://x/manifests/5732701.pdf' });
  return json({ message: 'not found' }, 404);
};

test('shiprocket client: logs in once, sends the token, accepts only the exact channel order id', async () => {
  rocket._reset(); fake(api);
  const r = await rocket.getOrderShipment(2919);
  assert.equal(r.found, true);
  assert.equal(r.response.order.id, 9001); // not the near-miss 29190
  assert.equal(r.response.track.shipment_track[0].current_status, 'In Transit');
  await rocket.getOrderShipment('#2919');
  assert.equal(calls.filter((c) => c.path === 'auth/login').length, 1, 'one login serves every later call');
  assert.ok(calls.filter((c) => c.path !== 'auth/login').every((c) => c.auth === 'Bearer TOKEN-1'));
  assert.deepEqual(calls.find((c) => c.path === 'auth/login').body, { email: 'api@example.com', password: 'secret' });
});

test('shiprocket client: an order that is not in Shiprocket is "not found", not an error', async () => {
  rocket._reset(); fake((u) => (u.pathname.endsWith('/auth/login') ? json({ token: 'T' }) : json({ data: [] })));
  assert.equal((await rocket.getOrderShipment(1)).found, false);
});

test('shiprocket client: a bad login says to use an API user', async () => {
  rocket._reset(); fake(() => json({ message: 'Invalid email or password' }, 403));
  await assert.rejects(rocket.getOrderShipment(1), (e) => e.code === 'auth' && /API user/.test(e.message));
});

test('shiprocket client: the manifest call sends shipment ids as numbers and is never retried', async () => {
  rocket._reset(); fake((u) => (u.pathname.endsWith('/auth/login') ? json({ token: 'T' }) : json({}, 503)));
  await assert.rejects(rocket.createManifest({ shipmentIds: ['55', '56'] }), /busy/);
  assert.equal(calls.filter((c) => c.path === 'manifests/generate').length, 1);
  rocket._reset(); fake(api);
  const r = await rocket.createManifest({ shipmentIds: ['55', '56'] });
  assert.deepEqual(calls.find((c) => c.path === 'manifests/generate').body, { shipment_id: [55, 56] });
  assert.equal(r.data.manifest_url, 'https://x/manifests/5732701.pdf');
});

// ---- the sync: the order's own provider decides where it is looked up ----
function loadSync(desk) {
  const store = new Map();
  const model = {
    findOne: (q) => ({ lean: async () => (store.has(q.orderId) ? JSON.parse(JSON.stringify(store.get(q.orderId)), (k, v) => (k === 'at' || k === 'checkedAt' || k === 'statusAt' ? new Date(v) : v)) : null) }),
    updateOne: async (q, u) => { const cur = store.get(q.orderId) || { ...(u.$setOnInsert || {}) }; store.set(q.orderId, { ...cur, ...(u.$set || {}) }); },
  };
  const prev = Module._load;
  Module._load = function (req, ...r) { return /\/models$/.test(req) ? { ShipwayShipment: model, Order: {}, Setting: {}, DeskOrder: { findOne: () => ({ select: () => ({ lean: async () => desk }) }) } } : prev.call(this, req, ...r); };
  delete require.cache[require.resolve('../src/services/shipwaySync')];
  const sync = require('../src/services/shipwaySync');
  Module._load = prev;
  return { sync, store };
}

test('sync: an order marked Shiprocket is tracked in Shiprocket and saved with its provider and shipment id', async () => {
  rocket._reset(); fake(api);
  const { sync, store } = loadSync({ dq: { provider: { name: 'shiprocket' } } });
  const r = await sync.refreshOne(2919);
  assert.equal(r.found, true); assert.equal(r.changed, true);
  const d = store.get(2919);
  assert.equal(d.provider, 'shiprocket');
  assert.equal(d.shipmentId, '55');
  assert.equal(d.awb, 'SR123456');
  assert.equal(d.group, 'transit');
  assert.equal(d.final, false);
  assert.equal(d.history.length, 1);
  assert.ok(calls.every((c) => !/shipway/.test(c.path)), 'Shipway is never asked about a Shiprocket order');
});

test('sync: a status change is recorded; a later empty answer never wipes it', async () => {
  rocket._reset();
  let track = TRACK;
  fake((u) => (u.pathname.includes('/courier/track/awb/') ? json(track) : api(u)));
  const { sync, store } = loadSync({ dq: { provider: { name: 'shiprocket' } } });
  await sync.refreshOne(2919);
  track = { tracking_data: { shipment_status: 7, shipment_track: [{ current_status: 'Delivered', courier_name: 'Delhivery', awb_code: 'SR123456' }], shipment_track_activities: [{ date: '2026-10-21 12:00:00', 'sr-status-label': 'DELIVERED' }] } };
  const r = await sync.refreshOne(2919);
  assert.equal(r.changed, true);
  assert.deepEqual(store.get(2919).history.map((h) => h.code), ['INT', 'DEL']);
  assert.equal(store.get(2919).final, true);
  fake((u) => (u.pathname.endsWith('/auth/login') ? json({ token: 'T' }) : json({ data: [] })));
  rocket._reset();
  const k = await sync.refreshOne(2919);
  assert.equal(k.kept, true); assert.equal(store.get(2919).status, 'Delivered');
});

test('sync: Shiprocket in the shipping order but no AWB yet is "not found" with provider kept', async () => {
  rocket._reset();
  fake((u) => (u.pathname.endsWith('/orders') ? json({ data: [{ id: 5, channel_order_id: '3000', status: 'NEW', shipments: [] }] }) : api(u)));
  const { sync, store } = loadSync({ dq: { provider: { name: 'shiprocket' } } });
  const r = await sync.refreshOne(3000);
  assert.equal(r.found, false);
  assert.equal(store.get(3000).provider, 'shiprocket');
});

test('sync: a Shiprocket login problem is thrown so the run can stop that provider only', async () => {
  rocket._reset(); fake(() => json({ message: 'Invalid' }, 403));
  const { sync } = loadSync({ dq: { provider: { name: 'shiprocket' } } });
  await assert.rejects(sync.refreshOne(1), (e) => e.code === 'auth' && e.provider === 'shiprocket');
});

test('sync: a record left by the other service is not kept when this order is looked up in Shiprocket and is not there', async () => {
  rocket._reset();
  fake((u) => (u.pathname.endsWith('/auth/login') ? json({ token: 'T' }) : json({ data: [] })));
  const { sync, store } = loadSync({ dq: { provider: { name: 'shiprocket' } } });
  store.set(4000, { orderId: 4000, found: true, provider: 'shipway', status: 'Delivered', statusCode: 'DEL', awb: 'OLD-SHIPWAY-AWB' });
  const r = await sync.refreshOne(4000);
  assert.equal(r.found, false);
  assert.equal(store.get(4000).found, false);
  assert.equal(store.get(4000).provider, 'shiprocket');
});
