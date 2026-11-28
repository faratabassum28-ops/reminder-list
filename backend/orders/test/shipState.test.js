// "Check shipping status": the plain-language answer on each Order packed card.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const SS = require('../src/lib/shipState');

process.env.SHIPROCKET_EMAIL = 'api@example.com'; process.env.SHIPROCKET_PASSWORD = 'secret';
process.env.SHIPWAY_USERNAME = ''; process.env.SHIPWAY_LICENSE_KEY = '';
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'dotenv' ? { config() {} } : orig.call(this, req, ...r); };
const rocket = require('../src/services/shiprocketClient');

// ------------------------------------------------------------ pure rules
test('classify: five plain answers', () => {
  assert.equal(SS.classify({ found: false }), 'not_found');
  assert.equal(SS.classify({ found: true, status: 'NEW', hasAwb: false }), 'waiting');
  assert.equal(SS.classify({ found: true, status: 'PICKUP SCHEDULED', hasAwb: true }), 'awb_ready');
  assert.equal(SS.classify({ found: true, status: 'CANCELED', hasAwb: false }), 'cancelled');
  assert.equal(SS.classify({ found: true, status: 'Cancelled', hasAwb: false, group: 'cancelled' }), 'cancelled');
});

test('classify: a shipment cancelled after booking still has an AWB, but it is cancelled', () => {
  assert.equal(SS.classify({ found: true, status: 'CANCELED', hasAwb: true }), 'cancelled');
  assert.equal(SS.classify({ found: true, status: 'x', hasAwb: true, group: 'cancelled' }), 'cancelled');
});

test('summarise counts per state and per service, ignoring unknown states', () => {
  const s = SS.summarise([{ provider: 'shiprocket', state: 'waiting' }, { provider: 'shiprocket', state: 'cancelled' }, { provider: 'shipway', state: 'awb_ready' }, { provider: 'shipway', state: 'bogus' }]);
  assert.equal(s.total, 4);
  assert.deepEqual([s.all.waiting, s.all.cancelled, s.all.awb_ready], [1, 1, 1]);
  assert.equal(s.shiprocket.waiting, 1); assert.equal(s.shipway.awb_ready, 1);
});

test('isStale: never checked or older than 30 minutes', () => {
  const now = Date.parse('2026-11-23T10:00:00Z');
  assert.equal(SS.isStale(null, now), true);
  assert.equal(SS.isStale({ at: '2026-11-23T09:45:00Z' }, now), false);
  assert.equal(SS.isStale({ at: '2026-11-23T09:20:00Z' }, now), true);
});

// ------------------------------------------------------------ the check, against a fake Shiprocket and in-memory orders
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ORDERS = {
  '2509': { id: 1, channel_order_id: '2509', status: 'CANCELED', shipments: [] },
  '2828': { id: 2, channel_order_id: '2828', status: 'NEW', shipments: [] },
  '2900': { id: 3, channel_order_id: '2900', status: 'PICKUP SCHEDULED', shipments: [{ id: 33, awb: 'SR900', courier: 'Delhivery' }] },
};
function fakeApi({ loginOk = true } = {}) {
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/auth/login')) return loginOk ? json({ token: 'T' }) : json({ message: 'bad' }, 403);
    if (u.pathname.endsWith('/orders')) { const q = u.searchParams.get('search'); return json({ data: q && ORDERS[q] ? [ORDERS[q]] : [] }); }
    if (u.pathname.includes('/courier/track/awb/')) return json({ tracking_data: { shipment_status: 18, shipment_track: [{ current_status: 'In Transit', courier_name: 'Delhivery', awb_code: 'SR900' }], shipment_track_activities: [] } });
    return json({}, 404);
  };
}
function load(docs) {
  const writes = []; const prev = Module._load;
  const DeskOrder = {
    find: () => ({ select: () => ({ lean: async () => docs }) }),
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    updateOne: async (filter, update) => { writes.push({ filter, set: update.$set }); },
  };
  Module._load = function (req, ...r) { return /\/models$/.test(req) ? { ShipwayShipment: {}, Order: {}, Setting: {}, DeskOrder } : prev.call(this, req, ...r); };
  delete require.cache[require.resolve('../src/services/shipwaySync')];
  const sync = require('../src/services/shipwaySync');
  Module._load = prev;
  return { sync, writes };
}
const packed = (orderId, provider, shipCheck) => ({ orderId, stage: 'dispatch', dq: { step: 'manifest', ...(provider ? { provider: { name: provider } } : {}), ...(shipCheck ? { shipCheck } : {}) } });

test('check: cancelled, waiting and AWB-ready orders each get the right answer, saved on the order', async () => {
  rocket._reset(); fakeApi();
  const { sync, writes } = load([packed(2509, 'shiprocket'), packed(2828, 'shiprocket'), packed(2900, 'shiprocket'), packed(3000, 'shiprocket')]);
  const r = await sync.checkPacked({});
  assert.equal(r.checked, 4);
  const by = Object.fromEntries(writes.map((w) => [w.filter.orderId, w.set['dq.shipCheck']]));
  assert.equal(by[2509].state, 'cancelled');
  assert.equal(by[2828].state, 'waiting');
  assert.equal(by[2828].status, 'NEW');
  assert.equal(by[2900].state, 'awb_ready');
  assert.equal(by[2900].awb, 'SR900');
  assert.equal(by[2900].courier, 'Delhivery');
  const awbSaved = writes.find((w) => w.filter.orderId === 2900).set['dq.awb']; // the fetched AWB is kept on the order for Create manifest
  assert.equal(awbSaved.awb, 'SR900'); assert.equal(awbSaved.courier, 'Delhivery'); assert.equal(awbSaved.source, 'provider');
  assert.equal(writes.find((w) => w.filter.orderId === 2828).set['dq.awb'], undefined);
  assert.equal(by[3000].state, 'not_found');
  assert.deepEqual([r.summary.all.cancelled, r.summary.all.waiting, r.summary.all.awb_ready, r.summary.all.not_found], [1, 1, 1, 1]);
  assert.ok(by[2509].at instanceof Date);
});

test('check: a card that was switched or moved on meanwhile is not overwritten (the save is guarded)', async () => {
  rocket._reset(); fakeApi();
  const { sync, writes } = load([packed(2828, 'shiprocket')]);
  await sync.checkPacked({});
  assert.equal(writes[0].filter.stage, 'dispatch');
  assert.equal(writes[0].filter['dq.step'], 'manifest');
  assert.equal(writes[0].filter['dq.provider.name'], 'shiprocket');
});

test('check: the background run skips orders checked in the last 30 minutes', async () => {
  rocket._reset(); fakeApi();
  const fresh = { state: 'waiting', at: new Date() };
  const old = { state: 'waiting', at: new Date(Date.now() - 3 * 3600 * 1000) };
  const { sync, writes } = load([packed(2828, 'shiprocket', fresh), packed(2509, 'shiprocket', old), packed(2900, 'shiprocket')]);
  const r = await sync.checkPacked({ onlyStale: true });
  assert.deepEqual(writes.map((w) => w.filter.orderId).sort(), [2509, 2900]);
  assert.equal(r.checked, 2);
});

test('check: a Shiprocket login problem stops with a clear message; nothing is saved', async () => {
  rocket._reset(); fakeApi({ loginOk: false });
  const { sync, writes } = load([packed(2828, 'shiprocket')]);
  await assert.rejects(sync.checkPacked({}), (e) => e.code === 'auth' && /API user/.test(e.message));
  assert.equal(writes.length, 0);
});

test('check: orders of a service that is not connected are skipped and named, not failed', async () => {
  rocket._reset(); fakeApi();
  const { sync, writes } = load([packed(2828, 'shiprocket'), packed(1, 'shipway')]); // Shipway has no login in this test
  const r = await sync.checkPacked({});
  assert.equal(r.checked, 1); assert.equal(r.skipped, 1);
  assert.deepEqual(r.notConnected, ['Shipway']);
  assert.equal(writes.length, 1);
});
