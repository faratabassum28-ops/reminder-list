// Runs the real deskService (assignment, call boards, packing with Shipway AWB and several photos) against a tiny in-memory stand-in for the models.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let seq = 0;
const newId = () => (++seq).toString(16).padStart(24, '0');
const nil = (v) => v === undefined || v === null;
const isOps = (c) => c && typeof c === 'object' && !(c instanceof Date) && !Buffer.isBuffer(c) && !Array.isArray(c) && Object.keys(c).some((k) => k.startsWith('$'));
const get = (d, path) => path.split('.').reduce((o, k) => (nil(o) ? undefined : o[k]), d);
const setPath = (d, path, v) => { const ks = path.split('.'); let o = d; ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; }); o[ks.at(-1)] = v; };
const eq = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : nil(a) && nil(b) ? true : a === b);
function cond(v, c) {
  if (c instanceof RegExp) return typeof v === 'string' && c.test(v);
  if (!isOps(c)) return eq(v, c);
  return Object.entries(c).every(([op, x]) => {
    if (op === '$in') return x.some((y) => eq(v, y));
    if (op === '$nin') return !x.some((y) => eq(v, y));
    if (op === '$ne') return !eq(v, x);
    if (op === '$gt') return !nil(v) && v > x;
    if (op === '$gte') return !nil(v) && v >= x;
    if (op === '$lte') return !nil(v) && v <= x;
    if (op === '$lt') return !nil(v) && v < x;
    if (op === '$exists') return x ? v !== undefined : v === undefined;
    throw new Error(`fake: operator ${op} not supported`);
  });
}
const match = (d, f) => Object.entries(f).every(([k, c]) => (k === '$or' ? c.some((x) => match(d, x)) : cond(get(d, k), c)));
const clone = (d) => (d ? structuredClone(d) : d);

class Coll {
  constructor() { this.docs = []; }
  _q(fn) {
    let sortBy = null; let lim = Infinity; let fields = null;
    const q = {
      select(f) { fields = typeof f === 'string' ? f.split(/\s+/).filter(Boolean) : null; return q; },
      sort(s) { sortBy = s; return q; }, limit(n) { lim = n; return q; }, skip() { return q; }, lean() { return q; },
      then(res, rej) {
        try {
          let out = fn();
          if (Array.isArray(out)) {
            if (sortBy) { const [[k, dir]] = Object.entries(sortBy); out = [...out].sort((a, b) => ((get(a, k) > get(b, k)) - (get(a, k) < get(b, k))) * dir); }
            out = out.slice(0, lim).map(clone);
          } else out = clone(out);
          return Promise.resolve(out).then(res, rej);
        } catch (e) { return Promise.reject(e).then(res, rej); }
      },
    };
    return q;
  }
  find(f = {}) { return this._q(() => this.docs.filter((d) => match(d, f))); }
  findOne(f = {}) { return this._q(() => this.docs.find((d) => match(d, f)) || null); }
  findById(id) { return this.findOne({ _id: id }); }
  exists(f) { return this._q(() => (this.docs.find((d) => match(d, f)) ? { _id: 1 } : null)); }
  countDocuments(f = {}) { return Promise.resolve(this.docs.filter((d) => match(d, f)).length); }
  _apply(d, u) {
    if (!Object.keys(u).some((k) => k.startsWith('$'))) u = { $set: u };
    for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, v);
    for (const k of Object.keys(u.$unset || {})) delete d[k];
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
    for (const [k, v] of Object.entries(u.$push || {})) { d[k] = d[k] || []; if (v && v.$each) d[k].push(...v.$each); else d[k].push(v); }
  }
  findOneAndUpdate(f, u, opts = {}) {
    return this._q(() => {
      let d = this.docs.find((x) => match(x, f));
      if (!d && opts.upsert) { d = { _id: newId(), ...Object.fromEntries(Object.entries(f).filter(([, c]) => !isOps(c))) }; this.docs.push(d); }
      if (!d) return null;
      this._apply(d, u); return d;
    });
  }
  updateOne(f, u) { const d = this.docs.find((x) => match(x, f)); if (d) this._apply(d, u); return Promise.resolve({ matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 }); }
  updateMany(f, u) { const ds = this.docs.filter((x) => match(x, f)); ds.forEach((d) => this._apply(d, u)); return Promise.resolve({ matchedCount: ds.length }); }
  bulkWrite(ops) { for (const { updateOne: o } of ops) { const d = this.docs.find((x) => match(x, o.filter)); if (d) this._apply(d, o.update); } return Promise.resolve(); }
  aggregate(pipe) { // just what counts() needs: $match, then $group by some fields counting with $sum
    let rows = this.docs;
    for (const st of pipe) {
      if (st.$match) rows = rows.filter((d) => match(d, st.$match));
      if (st.$group) {
        const m = new Map();
        for (const d of rows) { const id = Object.fromEntries(Object.entries(st.$group._id).map(([k, v]) => [k, get(d, String(v).slice(1))])); const key = JSON.stringify(id); const e = m.get(key) || { _id: id, n: 0 }; e.n++; m.set(key, e); }
        rows = [...m.values()];
      }
    }
    return Promise.resolve(rows);
  }
  insertMany(arr) { arr.forEach((a) => this.docs.push({ _id: newId(), rev: 0, ...a })); return Promise.resolve(); }
  deleteOne(f) { const i = this.docs.findIndex((x) => match(x, f)); if (i >= 0) this.docs.splice(i, 1); return Promise.resolve(); }
  deleteMany(f) { this.docs = this.docs.filter((x) => !match(x, f)); return Promise.resolve(); }
  async create(doc) { const d = { _id: newId(), at: new Date(), ...doc }; this.docs.push(d); return clone(d); }
}
const models = Object.fromEntries(['DeskOrder', 'DeskShot', 'DispatchProof', 'ShopifyOrder', 'ShipwayShipment', 'Setting', 'StaffUser'].map((k) => [k, new Coll()]));
const origLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'dotenv') return { config() {} }; return origLoad.call(this, req, ...rest); };
require.cache[require.resolve('../src/models')] = { id: 'models', filename: require.resolve('../src/models'), loaded: true, exports: models };
const svc = require('../src/services/deskService');

const T0 = new Date('2026-10-19T04:00:00Z');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const photo = { buffer: JPG };
const reset = () => { Object.values(models).forEach((c) => { c.docs = []; }); };
const staff = (name, role, extra = {}) => { const d = { _id: newId(), name, role, active: true, ...extra }; models.StaffUser.docs.push(d); return { id: String(d._id), name, role }; };
const desk = (orderId, extra = {}) => { models.DeskOrder.docs.push({ _id: newId(), orderId, orderAt: T0, stage: 'confirm', fuNo: 1, dueAt: new Date(T0.getTime() + orderId * 1000), rev: 0, log: [], ...extra }); };
const get1 = (id) => models.DeskOrder.docs.find((d) => d.orderId === id);
const setAssign = (body) => svc.saveAssignConfig(body);
const rejects = (p, status, re) => assert.rejects(p, (e) => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });

test('with every column Off nothing is assigned and everyone sees everything', async () => {
  reset(); staff('Asha', 'confirmation'); desk(1); desk(2);
  await svc.autoAssign();
  assert.ok(models.DeskOrder.docs.every((d) => !d.assignee));
});

test('auto-assign shares FU1 orders 2 : 1 between two people, and logs who got what', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  for (let i = 1; i <= 9; i++) desk(i);
  await setAssign({ slots: { confirm1: { mode: 'auto', members: [{ id: a.id, weight: 2 }, { id: b.id, weight: 1 }] } } });
  const count = (id) => models.DeskOrder.docs.filter((d) => d.assignee && d.assignee.id === id).length;
  assert.equal(count(a.id), 6); assert.equal(count(b.id), 3);
  assert.match(get1(1).log.at(-1).label, /Assigned to (Asha|Bala) \(auto\)/);
  assert.equal(get1(1).assignee.slot, 'confirm1'); assert.equal(get1(1).assignee.auto, true);
});

test('a person added later catches up, and "share out again" evens out the work already given', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  for (let i = 1; i <= 8; i++) desk(i);
  await setAssign({ slots: { confirm1: { mode: 'auto', members: [{ id: a.id, weight: 1 }] } } });
  assert.equal(models.DeskOrder.docs.filter((d) => d.assignee.id === a.id).length, 8);
  await setAssign({ slots: { confirm1: { members: [{ id: a.id, weight: 1 }, { id: b.id, weight: 1 }] } } });
  desk(9); desk(10); await svc.autoAssign();
  assert.equal(get1(9).assignee.id, b.id); assert.equal(get1(10).assignee.id, b.id); // the new person gets the next ones first
  const r = await svc.rebalance({ id: 'admin', name: 'Boss', role: 'admin' }, 'confirm1');
  assert.ok(r.moved > 0);
  const n = (id) => models.DeskOrder.docs.filter((d) => d.assignee && d.assignee.id === id).length;
  assert.equal(n(a.id), 5); assert.equal(n(b.id), 5);
});

test('a person switched off for the day has their open orders handed to the others', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  for (let i = 1; i <= 4; i++) desk(i);
  await setAssign({ slots: { confirm1: { mode: 'auto', members: [{ id: a.id, weight: 1 }, { id: b.id, weight: 1 }] } } });
  await setAssign({ slots: { confirm1: { members: [{ id: a.id, weight: 1, on: false }, { id: b.id, weight: 1 }] } } });
  assert.ok(models.DeskOrder.docs.every((d) => d.assignee.id === b.id));
});

test('when an order moves to the next follow-up it is shared out again; a finished order is not', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  desk(1);
  await setAssign({ slots: { confirm1: { mode: 'auto', members: [{ id: a.id, weight: 1 }] }, confirm2: { mode: 'auto', members: [{ id: b.id, weight: 1 }] } } });
  assert.equal(get1(1).assignee.id, a.id);
  Object.assign(get1(1), { fuNo: 2, dueAt: T0 }); get1(1).rev++;
  await svc.autoAssign({ orderIds: [1] });
  assert.equal(get1(1).assignee.id, b.id); assert.equal(get1(1).assignee.slot, 'confirm2');
});

test('manual: an admin gives an order to a person; a team member can only take an unassigned one', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation'); const p = staff('Ravi', 'packing');
  const admin = { id: 'adm', name: 'Boss', role: 'admin' };
  desk(1); desk(2);
  await rejects(svc.assignManual(admin, 1, a.id), 409, /switched off/);
  await svc.saveAssignConfig({ slots: { confirm1: { mode: 'manual' } } });
  const r = await svc.assignManual(admin, 1, a.id);
  assert.equal(r.assignee.name, 'Asha'); assert.match(get1(1).log.at(-1).label, /Assigned to Asha by Boss/);
  await rejects(svc.assignManual(a, 2, b.id), 403, /Only an admin/);
  await rejects(svc.assignManual(b, 1, 'me'), 409, /just taken by Asha/);
  await rejects(svc.assignManual(admin, 1, p.id), 400, /different team/);
  const took = await svc.assignManual(b, 2, 'me');
  assert.equal(took.assignee.id, b.id);
  await svc.assignManual(admin, 1, null);
  assert.equal(get1(1).assignee, undefined);
});

test('"own orders only": someone else\'s order cannot be worked, unassigned ones can; admins always can', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  desk(1, { assignee: { id: a.id, name: 'Asha', slot: 'confirm1' } }); desk(2);
  await svc.saveAssignConfig({ visibility: 'own', slots: { confirm1: { mode: 'manual' } } });
  await rejects(svc.act(b, 1, 'confirm', {}), 403, /assigned to Asha/);
  const ok = await svc.act(a, 1, 'confirm', {});
  assert.equal(ok.stage, 'dispatch');
  await svc.act(b, 2, 'confirm', {}); // nobody holds it
  await svc.saveAssignConfig({ visibility: 'all' });
});

test('boards: one column per follow-up, filtered by person; "own only" hides the others\' orders', async () => {
  reset(); const a = staff('Asha', 'confirmation'); const b = staff('Bala', 'confirmation');
  desk(1, { assignee: { id: a.id, name: 'Asha', slot: 'confirm1' } }); desk(2, { assignee: { id: b.id, name: 'Bala', slot: 'confirm1' } }); desk(3, { fuNo: 2 }); desk(4, { stage: 'pending' });
  await svc.saveAssignConfig({ slots: { confirm1: { mode: 'manual' }, confirm2: { mode: 'manual' } } }); // a column that is Off clears its people, so the columns are Manual here
  const all = await svc.callBoard('confirm', { viewer: { id: 'adm', role: 'admin' } });
  assert.deepEqual([all.columns[1].length, all.columns[2].length, all.columns[3].length], [2, 1, 0]);
  assert.equal(all.columns[1][0].assignee.name, 'Asha');
  assert.equal((await svc.callBoard('confirm', { assignee: String(b.id), viewer: { id: 'adm', role: 'admin' } })).shown, 1);
  assert.equal((await svc.callBoard('confirm', { assignee: 'none', viewer: { id: 'adm', role: 'admin' } })).shown, 1);
  await svc.saveAssignConfig({ visibility: 'own' });
  const mine = await svc.callBoard('confirm', { viewer: a });
  assert.deepEqual(mine.columns[1].map((c) => c.orderId), [1]); assert.equal(mine.columns[2].length, 1); // her own + the unassigned FU2 order
  await rejects(svc.callBoard('dispatch'), 404);
  assert.equal((await svc.callBoard('pending', {})).columns[1].length, 1);
});

test('names an admin set show up on the cards, while the stored follow-up name stays fixed', async () => {
  reset(); desk(1);
  await svc.saveConfig({ labels: { fu1: 'Call 1' } });
  const c = (await svc.callBoard('confirm', {})).columns[1][0];
  assert.equal(c.fu, 'FU1'); assert.equal(c.fuShown, 'Call 1'); assert.equal(c.status, 'Confirm queue · Call 1');
});

// ---------------------------------------------------------------- the four steps: slip (AWB) -> manifest -> packed -> handover
const slipped = (orderId, extra = {}) => desk(orderId, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'manifest', stepAt: T0, slip: { at: T0 } }, ...extra });
const manifested = (orderId, extra = {}) => desk(orderId, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'packed', stepAt: T0, slip: { at: T0 }, awb: { awb: `AWB${orderId}2345`, courier: 'Delhivery' }, manifest: { id: 'MF-1', courier: 'Delhivery' } }, ...extra });
const packer = { id: 'pk', name: 'Ravi', role: 'packing' };

test('Order packed needs only a tap: the AWB and manifest are already known, photos are optional and all kept', async () => {
  reset(); manifested(1);
  await svc.dispatchPacked(packer, 1, { files: [photo, photo, photo] });
  const p = get1(1).dq.packed;
  assert.equal(p.awb, 'AWB12345'); assert.equal(p.courier, 'Delhivery');
  assert.equal(p.photoIds.length, 3); assert.equal(p.photoId, p.photoIds[0]);
  assert.equal(models.DispatchProof.docs.length, 3);
  assert.equal(get1(1).dq.step, 'handover');
  manifested(2);
  await svc.dispatchPacked(packer, 2, { files: [] }); // no photo needed by default
  assert.equal(get1(2).dq.step, 'handover');
});

test('packing refuses non-photos and more than ten, and stores nothing when it refuses', async () => {
  reset(); manifested(1);
  await rejects(svc.dispatchPacked(packer, 1, { files: [photo, { buffer: Buffer.from('not a photo at all') }] }), 400, /must be a photo/);
  await rejects(svc.dispatchPacked(packer, 1, { files: Array.from({ length: 11 }, () => photo) }), 400, /at most 10/);
  assert.equal(models.DispatchProof.docs.length, 0); assert.equal(get1(1).dq.step, 'packed');
  await svc.saveDispatchConfig({ stages: { packed: { requirePhoto: true } } });
  await rejects(svc.dispatchPacked(packer, 1, { files: [] }), 400, /at least one photo/);
});

test('no AWB from the service yet: the packing team types the AWB and courier for that order, and the manifest step can use it', async () => {
  reset(); slipped(1);
  await rejects(svc.dispatchAwb(packer, 1, { awb: 'AB', courier: 'Xpress' }), 400, /5 to 40/);
  await rejects(svc.dispatchAwb(packer, 1, { awb: 'MANUAL12345', courier: '' }), 400, /courier/i);
  await svc.dispatchAwb(packer, 1, { awb: 'manual 12345', courier: 'Xpress' });
  const a = get1(1).dq.awb;
  assert.equal(a.awb, 'MANUAL12345'); assert.equal(a.courier, 'Xpress'); assert.equal(a.source, 'manual');
  assert.equal(get1(1).dq.step, 'manifest'); // typing the AWB does not skip the manifest
  const b = await svc.dispatchBoard({ viewer: { id: 'adm', role: 'admin' } });
  assert.deepEqual(b.handover.shipway.couriers.map((c) => [c.courier, c.count]), [['Xpress', 1]]);
});

test('the AWB can be typed in the same request that marks the slip done', async () => {
  reset(); desk(1, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'slip', stepAt: T0 } });
  await svc.dispatchSlip(packer, 1, { provider: 'shiprocket', awb: 'SR1234567', courier: 'Bluedart' });
  const d = get1(1);
  assert.equal(d.dq.step, 'manifest'); assert.equal(d.dq.provider.name, 'shiprocket'); assert.equal(d.dq.awb.awb, 'SR1234567'); assert.equal(d.dq.awb.courier, 'Bluedart');
  desk(2, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'slip', stepAt: T0 } });
  await rejects(svc.dispatchSlip(packer, 2, { provider: 'shipway', awb: 'SR1234567', courier: 'Bluedart' }), 409, /already on order #1/);
  assert.equal(get1(2).dq.step, 'slip');
});

test('an AWB that is already on another order is refused', async () => {
  reset(); slipped(1); slipped(2);
  await svc.dispatchAwb(packer, 1, { awb: 'SAME12345', courier: 'D' });
  await rejects(svc.dispatchAwb(packer, 2, { awb: 'same12345', courier: 'D' }), 409, /already on order #1/);
  assert.equal(get1(2).dq.awb, undefined);
});

test('an AWB the service already gave is saved on the order by the board, so the manifest can be made without typing', async () => {
  reset(); slipped(1);
  models.ShipwayShipment.docs.push({ orderId: 1, found: true, awb: 'SHIP12345', carrier: 'Bluedart' });
  const b = await svc.dispatchBoard({ viewer: { id: 'adm', role: 'admin' } });
  assert.equal(b.columns.manifest.length, 1);
  assert.equal(b.columns.manifest[0].dq.suggestedAwb, 'SHIP12345'); assert.equal(b.columns.manifest[0].dq.awb.awb, 'SHIP12345');
  assert.equal(get1(1).dq.awb.awb, 'SHIP12345'); assert.equal(get1(1).dq.awb.source, 'provider');
  assert.deepEqual(b.handover.shipway.couriers.map((c) => [c.courier, c.count]), [['Bluedart', 1]]);
});

test('orders left at Packed / Handover by the old three-step queue go back to Create manifest, keeping their AWB', async () => {
  reset();
  desk(1, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'packed', stepAt: T0, slip: { at: T0 } } });
  desk(2, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'handover', stepAt: T0, packed: { awb: 'OLD123456', courier: 'Delhivery' } } });
  desk(3, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'handover', stepAt: T0, packed: { awb: 'OLD777777', courier: 'Delhivery' }, manifest: { id: 'M9', courier: 'Delhivery' } } });
  const b = await svc.dispatchBoard({ viewer: { id: 'adm', role: 'admin' } });
  assert.deepEqual(b.columns.manifest.map((c) => c.orderId).sort(), [1, 2]);
  assert.equal(get1(2).dq.awb.awb, 'OLD123456');
  assert.deepEqual(b.columns.handover.map((c) => c.orderId), [3]); // already on a manifest: left alone
});

test('handover keeps every manifest photo for every order on the manifest', async () => {
  reset();
  for (const id of [1, 2]) desk(id, { stage: 'dispatch', fuNo: 0, dueAt: null, confirmedAt: T0, dq: { step: 'handover', stepAt: T0, packed: { awb: `AWB${id}2345`, courier: 'D', photoIds: ['x'] } } });
  const r = await svc.dispatchHandover(packer, [1, 2], { files: [photo, photo] });
  assert.equal(r.done.length, 2);
  assert.equal(get1(1).dq.handover.manifestIds.length, 2); assert.deepEqual(get1(1).dq.handover.manifestIds, get1(2).dq.handover.manifestIds);
  assert.equal(get1(1).stage, 'dispatched');
  await rejects(svc.dispatchHandover(packer, [1], { files: [photo] }), 409, /Nothing was saved/);
});
