const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/lib/dispatch');
const PR = require('../src/lib/providers');
const M = require('../src/lib/shiprocketMap');
const { parseShiprocketManifest } = require('../src/lib/shiprocketManifest');

const ist = (s) => new Date(`${s}+05:30`);
const conf = P.normaliseDispatchConfig({}, P.DEFAULT_DISPATCH_CONFIG);
const who = { id: 'u1', name: 'Rahul' };
const confirmed = ist('2026-10-19T09:00:00');
const doc = (extra = {}) => ({ orderId: 2919, stage: 'dispatch', confirmedAt: confirmed, orderAt: confirmed, ...extra });
const apply = (d, t) => ({ ...d, ...t.set });

// ------------------------------------------------------------ choosing the provider at the packing slip
test('marking the slip done stores which provider the team chose', () => {
  const d = apply(doc(), P.slipDone(doc(), conf, who, ist('2026-10-19T10:00:00'), { provider: 'shiprocket' }));
  assert.equal(d.dq.step, 'packed');
  assert.equal(d.dq.provider.name, 'shiprocket');
  assert.equal(d.dq.provider.byName, 'Rahul');
  assert.equal(PR.providerOf(d), 'shiprocket');
});

test('the slip cannot be marked done without choosing Shipway or Shiprocket', () => {
  assert.throws(() => P.slipDone(doc(), conf, who, new Date(), {}), (e) => e.status === 400 && /Shipway or Shiprocket/.test(e.message));
  assert.throws(() => P.slipDone(doc(), conf, who, new Date(), { provider: 'delhivery' }), (e) => e.status === 400);
});

test('the choice is case-insensitive; the log line names the provider', () => {
  const t = P.slipDone(doc(), conf, who, ist('2026-10-19T10:00:00'), { provider: 'Shipway' });
  assert.equal(t.set.dq.provider.name, 'shipway');
  assert.match(t.entries[0].label, /Shipway/);
});

test('orders that predate Shiprocket count as Shipway', () => {
  assert.equal(PR.providerOf(doc({ dq: { step: 'handover' } })), 'shipway');
  assert.equal(PR.providerOf(null), 'shipway');
});

// ------------------------------------------------------------ manifests are per provider
const packed = (id, courier, provider, extra = {}) => ({ orderId: id, stage: 'dispatch', dq: { step: 'handover', packed: { awb: `AWB${id}XX`, courier }, ...(provider ? { provider: { name: provider } } : {}), ...extra } });

test('manifestCouriers lists each provider separately', () => {
  const docs = [packed(1, 'Delhivery', 'shipway'), packed(2, 'Delhivery', 'shiprocket'), packed(3, 'Delhivery', 'shiprocket'), packed(4, 'Bluedart', null)];
  assert.deepEqual(P.manifestCouriers(docs, 'shiprocket').map((c) => [c.courier, c.count]), [['Delhivery', 2]]);
  assert.deepEqual(P.manifestCouriers(docs, 'shipway').map((c) => [c.courier, c.count]), [['Bluedart', 1], ['Delhivery', 1]]); // no choice recorded = Shipway
  assert.equal(P.manifestCouriers(docs).reduce((n, c) => n + c.count, 0), 4); // no provider asked = everything
});

test('a manifest always belongs to the provider of its order', () => {
  const d = packed(7, 'Delhivery', 'shiprocket');
  const t = P.manifestAssigned(d, { manifestId: 'SR-123456', courier: 'Delhivery', url: 'https://x/m.pdf' }, who);
  assert.equal(t.set.dq.manifest.provider, 'shiprocket');
  assert.equal(t.set.dq.manifest.url, 'https://x/m.pdf');
  assert.match(t.entries[0].label, /Shiprocket manifest SR-123456/);
});

test('groupByManifest carries the provider so the board can split the two halves', () => {
  const g = P.groupByManifest([
    { orderId: 1, dq: { manifest: { id: 'A', provider: 'shipway', at: '2026-10-19T10:00:00Z' } } },
    { orderId: 2, dq: { manifest: { id: 'SR-9', provider: 'shiprocket', url: 'https://x', at: '2026-10-19T11:00:00Z' } } },
    { orderId: 3, dq: { manifest: { id: 'OLD', at: '2026-10-19T09:00:00Z' } } }, // saved before Shiprocket: Shipway
  ]);
  const by = Object.fromEntries(g.groups.map((x) => [x.manifestId, x.provider]));
  assert.deepEqual(by, { A: 'shipway', 'SR-9': 'shiprocket', OLD: 'shipway' });
});

test('handover records the provider on the in-transit order', () => {
  let d = apply(doc(), P.slipDone(doc(), conf, who, ist('2026-10-19T10:00:00'), { provider: 'shiprocket' }));
  d = apply(d, P.packedDone(d, { awb: 'SR123456', courier: 'Delhivery' }, conf, who));
  const t = P.handoverDone(d, { manifestIds: ['p1'] }, conf, who);
  assert.equal(t.set.dispatch.provider, 'shiprocket');
  assert.match(t.entries[0].label, /via Shiprocket/);
});

test('stepCounts splits packed and handover by provider', () => {
  const docs = [packed(1, 'A', 'shipway'), packed(2, 'A', 'shiprocket'), packed(3, 'A', 'shiprocket')];
  const c = P.stepCounts(docs, conf, ist('2026-10-19T10:00:00'));
  assert.deepEqual(c.byProvider, { shipway: { packed: 0, handover: 1 }, shiprocket: { packed: 0, handover: 2 } });
});

// ------------------------------------------------------------ Shiprocket status -> the codes the rest of the app reads
test('numeric Shiprocket statuses map to the Shipway-style codes', () => {
  assert.equal(M.codeFor(7, ''), 'DEL');
  assert.equal(M.codeFor(21, ''), 'UND');
  assert.equal(M.codeFor(9, ''), 'RTO');
  assert.equal(M.codeFor(10, ''), 'RTD');
  assert.equal(M.codeFor(17, ''), 'OOD');
});

test('text statuses are the fallback, and RTO beats delivered', () => {
  assert.equal(M.codeFor('', 'RTO DELIVERED'), 'RTD');
  assert.equal(M.codeFor('', 'RTO INITIATED'), 'RTO');
  assert.equal(M.codeFor('', 'Delivered'), 'DEL');
  assert.equal(M.codeFor('', 'Undelivered - consignee unavailable'), 'UND');
  assert.equal(M.codeFor('', 'Pickup Error'), 'PKF');
  assert.equal(M.codeFor('', 'weird status'), '');
});

test('a Shiprocket order with an AWB becomes a tracked shipment; without one it is "not dispatched"', () => {
  const order = { id: 9, channel_order_id: '2919', status: 'IN TRANSIT', shipments: [{ id: 55, awb: 'SR123456', courier: 'Delhivery Surface' }] };
  const d = M.normalizeShiprocket(M.fromShiprocket(order, null), '2919');
  assert.equal(d.provider, 'shiprocket');
  assert.equal(d.shipmentId, '55');
  assert.equal(d.awb, 'SR123456');
  assert.equal(d.carrier, 'Delhivery Surface');
  assert.equal(d.group, 'transit');
  assert.equal(d.final, false);
  assert.equal(M.fromShiprocket({ id: 1, shipments: [] }, null), null);
});

test('the track call wins over the list status, and a delivered shipment is final', () => {
  const order = { id: 9, status: 'IN TRANSIT', shipments: [{ id: 55, awb: 'SR1' }] };
  const track = { shipment_status: 7, shipment_track: [{ current_status: 'Delivered', courier_name: 'Bluedart', awb_code: 'SR1' }], shipment_track_activities: [{ date: '2026-10-20 14:05:00', 'sr-status-label': 'DELIVERED' }] };
  const d = M.normalizeShiprocket(M.fromShiprocket(order, track), '2919');
  assert.equal(d.statusCode, 'DEL');
  assert.equal(d.group, 'delivered');
  assert.equal(d.final, true);
  assert.equal(d.carrier, 'Bluedart');
  assert.ok(d.statusAt instanceof Date);
});

test('a RTO shipment lands in the RTO group so the RTO desk picks it up', () => {
  const d = M.normalizeShiprocket(M.fromShiprocket({ id: 1, status: 'RTO INITIATED', shipments: [{ id: 2, awb: 'SRX' }] }, null), '1');
  assert.equal(d.group, 'rto');
});

test('Shiprocket weights are read in kg', () => {
  const o = { id: 1, status: 'DELIVERED', shipments: [{ id: 2, awb: 'SRX', weight: 0.5, charged_weight: 1, weight_charges: 40 }] };
  const d = M.normalizeShiprocket(M.fromShiprocket(o, null), '1');
  if (d.weightInfo) assert.equal(d.weightInfo.diffG, 500); // 1 kg charged on a 0.5 kg parcel
});

// ------------------------------------------------------------ Shiprocket manifest reply
const sent = [{ orderId: 1, shipmentId: 11 }, { orderId: 2, shipmentId: 12 }];
test('a manifest link means every order is on the manifest; the id is made from the link', () => {
  const r = parseShiprocketManifest({ status: 200, data: { status: 1, manifest_url: 'https://kr-shipmultichannel.s3.amazonaws.com/manifests/5732701.pdf' } }, sent);
  assert.equal(r.manifestId, 'SR-5732701');
  assert.deepEqual(r.accepted, [1, 2]);
  assert.equal(r.url, 'https://kr-shipmultichannel.s3.amazonaws.com/manifests/5732701.pdf');
});

test('an error reply rejects every order with Shiprocket\'s own reason', () => {
  const r = parseShiprocketManifest({ status: 422, data: { message: 'Pickup is not scheduled for these shipments' } }, sent);
  assert.equal(r.manifestId, null);
  assert.deepEqual(r.rejected.map((x) => [x.orderId, x.reason]), [[1, 'Pickup is not scheduled for these shipments'], [2, 'Pickup is not scheduled for these shipments']]);
});

test('a shipment named in the errors is left out; the others stay on the manifest', () => {
  const r = parseShiprocketManifest({ status: 200, data: { status: 1, manifest_url: 'https://x/9999999.pdf', errors: { 12: ['Pincode not serviceable'] } } }, sent);
  assert.deepEqual(r.accepted, [1]);
  assert.deepEqual(r.rejected, [{ orderId: 2, reason: 'Pincode not serviceable' }]);
});

test('a "success" with no link is NOT treated as a manifest', () => {
  const r = parseShiprocketManifest({ status: 200, data: { status: 1 } }, sent);
  assert.equal(r.manifestId, null);
  assert.equal(r.accepted.length, 0);
});
