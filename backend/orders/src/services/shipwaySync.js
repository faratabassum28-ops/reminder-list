// Keeps the ShipwayShipment collection fresh: one lookup per order, newest first, only where something can still change.
// The collection holds BOTH providers' shipments (field `provider`): an order is looked up in the service the packing team chose for it
// (DeskOrder.dq.provider, Shipway when nothing was chosen), so NDR, RTO, weight cases and the Overview need no change.
const cfg = require('../config');
const { Order, ShipwayShipment, DeskOrder, Setting } = require('../models');
const { normalizeShipment, pickCandidates } = require('../lib/shipwayMap');
const { fromShiprocket, normalizeShiprocket } = require('../lib/shiprocketMap');
const P = require('../lib/providers');
const SS = require('../lib/shipState');
const client = require('./shipwayClient');
const rocket = require('./shiprocketClient');

const LAST_KEY = 'shipway.last';
const STALE_MS = 30 * 60 * 1000;
const state = { runningSince: 0, progress: 0, total: 0 };
const isRunning = () => !!state.runningSince && Date.now() - state.runningSince < STALE_MS;
const getSetting = async (k) => { const s = await Setting.findOne({ key: k }).lean(); return s ? s.value : null; };
const putSetting = (k, value) => Setting.findOneAndUpdate({ key: k }, { key: k, value }, { upsert: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const configured = (provider) => (provider === 'shiprocket' ? rocket.isConfigured() : client.isConfigured());
const anyConfigured = () => client.isConfigured() || rocket.isConfigured();
const NOT_SET = { shipway: 'Shipway is not set up yet.', shiprocket: 'Shiprocket is not set up yet.' };

// Which provider holds this order? Only orders the packing team put through the slip step can be Shiprocket.
async function providerFor(orderId) {
  const d = await DeskOrder.findOne({ orderId }).select('dq.provider').lean();
  return P.providerOf(d);
}
async function shiprocketIds(orderIds) {
  const docs = await DeskOrder.find({ orderId: { $in: orderIds }, 'dq.provider.name': 'shiprocket' }).select('orderId').lean();
  return new Set(docs.map((d) => d.orderId));
}

// Ask the right provider about one order -> { found, id, doc } | { found: false, message }
// hint.awb: the AWB we already follow for this order. For Shiprocket it is tracked directly (no order search), which keeps old in-transit orders moving.
async function lookup(orderId, provider, hint = {}) {
  if (provider === 'shiprocket') {
    if (hint.awb) {
      let td = null;
      try { td = await rocket.trackByAwb(hint.awb); } catch (e) { if (e.code === 'auth' || e.code === 'not_configured') throw e; }
      const shaped = td && fromShiprocket({ channel_order_id: String(orderId), shipments: [{ awb: hint.awb, courier: hint.courier }] }, td);
      if (shaped) return { found: true, id: String(orderId), viaAwb: true, doc: normalizeShiprocket(shaped, String(orderId)) };
    }
    const r = await rocket.getOrderShipment(orderId);
    if (!r.found) return r;
    const shaped = fromShiprocket(r.response.order, r.response.track);
    if (!shaped) return { found: false, message: 'In Shiprocket, but not dispatched yet (no AWB)' };
    return { found: true, id: r.id, doc: normalizeShiprocket(shaped, r.id) };
  }
  const r = await client.getOrderShipmentDetails(orderId);
  if (!r.found) return r;
  return { found: true, id: r.id, doc: { ...normalizeShipment(r.response, r.id), provider: 'shipway' } };
}

// Ask the provider about one order and save the answer (keeps the list of status changes it has seen).
async function refreshOne(orderId, provider) {
  provider = provider || (await providerFor(orderId));
  const prev = await ShipwayShipment.findOne({ orderId }).lean();
  const now = new Date();
  let r;
  const follow = provider === 'shiprocket' && prev && prev.found && !prev.final && (prev.provider || 'shipway') === 'shiprocket' && prev.awb ? { awb: prev.awb, courier: prev.carrier } : {};
  try { r = await lookup(orderId, provider, follow); } catch (e) {
    if (e.code === 'auth' || e.code === 'not_configured') { e.provider = provider; throw e; } // nothing else will work for this provider either
    await ShipwayShipment.updateOne({ orderId }, { $set: { checkedAt: now, error: e.message }, $setOnInsert: { orderId, found: false } }, { upsert: true });
    return { orderId, error: e.message };
  }
  if (!r.found) {
    // Never wipe a status we already have because of a lookup that came back empty.
    // (only a status from the SAME provider: a record left by the other service must not stand in for this one)
    if (prev && prev.found && (prev.provider || 'shipway') === provider) { await ShipwayShipment.updateOne({ orderId }, { $set: { checkedAt: now, error: '' } }); return { orderId, kept: true }; }
    await ShipwayShipment.updateOne({ orderId }, { $set: { found: false, provider, checkedAt: now, error: '' }, $setOnInsert: { orderId } }, { upsert: true });
    return { orderId, found: false };
  }
  const d = r.doc;
  if (r.viaAwb) { delete d.shipmentId; delete d.weightKeys; delete d.weightInfo; if (!d.carrier) delete d.carrier; if (!d.from) delete d.from; if (!d.to) delete d.to; } // the tracking call carries no order details: keep what the order lookup saved
  const changed = !prev || prev.statusCode !== d.statusCode || prev.status !== d.status || prev.provider !== d.provider;
  const history = changed ? [...((prev && prev.history) || []), { code: d.statusCode, status: d.status, at: d.statusAt || now }].slice(-30) : prev.history;
  await ShipwayShipment.updateOne({ orderId }, { $set: { ...d, history, checkedAt: now, error: '', ...(changed ? { changedAt: now } : {}) } , $setOnInsert: { orderId } }, { upsert: true });
  return { orderId, found: true, changed };
}

// limit: how many orders to look up in this run (the timer uses a small batch, the button a big one).
async function run({ limit = 300, all = false } = {}) {
  if (!anyConfigured()) throw Object.assign(new Error('Neither Shipway nor Shiprocket is set up yet.'), { status: 400 });
  if (isRunning()) throw Object.assign(new Error('A Shipway / Shiprocket sync is already running'), { status: 409 });
  state.runningSince = Date.now(); state.progress = 0; state.total = 0;
  let checked = 0; let found = 0; let changed = 0; let missing = 0; let failed = 0;
  try {
    const [orders, docs] = await Promise.all([
      Order.find({ excluded: null, orderId: { $ne: null } }).select('orderId orderDate').sort({ orderDate: -1, orderId: -1 }).lean(),
      ShipwayShipment.find().select('orderId found final error checkedAt').lean(),
    ]);
    const picked = pickCandidates(orders, new Map(docs.map((d) => [d.orderId, d])), new Date(), { limit: all ? 100000 : limit });
    const rocketSet = await shiprocketIds(picked);
    const work = picked.map((id) => ({ id, provider: rocketSet.has(id) ? 'shiprocket' : 'shipway' })).filter((w) => configured(w.provider));
    state.total = work.length;
    const queue = [...work];
    const dead = new Map(); // provider -> its login error: that provider stops, the other keeps going
    const worker = async () => {
      while (queue.length) {
        const w = queue.shift();
        if (dead.has(w.provider)) continue;
        try {
          const r = await refreshOne(w.id, w.provider);
          checked++; if (r.error) failed++; else if (r.found) { found++; if (r.changed) changed++; } else if (!r.kept) missing++;
        } catch (e) { dead.set(w.provider, e); }
        state.progress = checked;
        await sleep(120); // be gentle with the providers
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (dead.size && !checked) throw [...dead.values()][0];
    const loginProblems = [...dead.entries()].map(([p, e]) => `${P.labelOf(p)}: ${e.message}`);
    await putSetting(LAST_KEY, { at: new Date(), ok: !dead.size, checked, found, changed, missing, failed, ...(loginProblems.length ? { error: loginProblems.join(' | ') } : {}) });
    return { checked, found, changed, missing, failed, loginProblems };
  } catch (e) {
    await putSetting(LAST_KEY, { at: new Date(), ok: false, checked, error: e.message }).catch(() => {});
    throw e;
  } finally { state.runningSince = 0; }
}

// For the order drawer: a fresh look at one order if the saved answer is old (moving shipments) or missing.
const tried = new Map();
async function ensureFresh(orderId, maxAgeMin = 10) {
  const provider = Number.isFinite(orderId) ? await providerFor(orderId) : 'shipway';
  if (!configured(provider) || !Number.isFinite(orderId)) return ShipwayShipment.findOne({ orderId }).lean();
  const have = await ShipwayShipment.findOne({ orderId }).lean();
  const stale = !have || (!have.final && Date.now() - new Date(have.checkedAt) > maxAgeMin * 60000);
  if (stale && Date.now() - (tried.get(orderId) || 0) > 2 * 60000) {
    tried.set(orderId, Date.now());
    try { await refreshOne(orderId, provider); } catch (e) { return have || null; }
    return ShipwayShipment.findOne({ orderId }).lean();
  }
  return have;
}


// ---------------------------------------------------------------------------- shipping status of the orders at "Order packed"
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const checkState = { runningSince: 0 };
const checkRunning = () => !!checkState.runningSince && Date.now() - checkState.runningSince < STALE_MS;

// One order, one service -> { state, status, awb, courier } (see lib/shipState.js). Login and setup problems are thrown; anything else becomes state "error".
async function shipState(orderId, provider) {
  try {
    if (provider === 'shiprocket') {
      const r = await rocket.getOrderShipment(orderId);
      if (!r.found) return { state: 'not_found', status: '' };
      const o = r.response.order;
      const shaped = fromShiprocket(o, r.response.track);
      const status = clean(shaped && shaped.current_status) || clean(o.status);
      const state = SS.classify({ found: true, status: `${clean(o.status)} ${status}`, hasAwb: !!(shaped && shaped.awbno) });
      return { state, status: clean(o.status) || status, awb: (shaped && shaped.awbno) || '', courier: (shaped && shaped.carrier) || '' };
    }
    const r = await client.getOrderShipmentDetails(orderId);
    if (!r.found) return { state: 'not_found', status: '' };
    const d = normalizeShipment(r.response, r.id);
    return { state: SS.classify({ found: true, status: d.status, hasAwb: !!d.awb, group: d.group }), status: d.status, awb: d.awb || '', courier: d.carrier || '' };
  } catch (e) {
    if (e.code === 'auth' || e.code === 'not_configured') { e.provider = provider; throw e; }
    return { state: 'error', status: e.message };
  }
}

// Ask the right service about every order at "Order packed" and save the answer on the order (dq.shipCheck), so the card shows it.
// onlyStale: skip orders checked in the last 30 minutes (the background run). A login problem stops that service only; the other carries on.
async function checkPacked({ onlyStale = false, limit = 300, provider = null } = {}) {
  if (!anyConfigured()) throw Object.assign(new Error('Neither Shipway nor Shiprocket is set up yet. Add a login on the server.'), { status: 400 });
  if (checkRunning()) throw Object.assign(new Error('A shipping status check is already running. Try again in a moment.'), { status: 409 });
  checkState.runningSince = Date.now();
  try {
    let docs = await DeskOrder.find({ stage: 'dispatch', 'dq.step': 'packed' }).select('orderId dq.provider dq.shipCheck').lean();
    if (provider) docs = docs.filter((d) => P.providerOf(d) === provider);
    if (onlyStale) docs = docs.filter((d) => SS.isStale(d.dq && d.dq.shipCheck));
    const all = docs.map((d) => ({ orderId: d.orderId, provider: P.providerOf(d) }));
    const skipped = all.filter((w) => !configured(w.provider));
    const work = all.filter((w) => configured(w.provider)).slice(0, limit);
    const rows = []; const dead = new Map(); const queue = [...work];
    const worker = async () => {
      while (queue.length) {
        const w = queue.shift();
        if (dead.has(w.provider)) continue;
        try {
          const r = await shipState(w.orderId, w.provider);
          const at = new Date();
          // only write if the card is still at Order packed with the same service: it may have been switched or moved on meanwhile
          const filter = { orderId: w.orderId, stage: 'dispatch', 'dq.step': 'packed', ...(w.provider === 'shiprocket' ? { 'dq.provider.name': 'shiprocket' } : { 'dq.provider.name': { $ne: 'shiprocket' } }) };
          await DeskOrder.updateOne(filter, { $set: { 'dq.shipCheck': { state: r.state, status: r.status || '', awb: r.awb || '', courier: r.courier || '', at } } });
          rows.push({ orderId: w.orderId, provider: w.provider, state: r.state });
        } catch (e) { dead.set(w.provider, e); }
        await sleep(100);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (dead.size && !rows.length) throw [...dead.values()][0];
    return {
      checked: rows.length, skipped: skipped.length, at: new Date(), summary: SS.summarise(rows),
      problems: [...dead.entries()].map(([p, e]) => `${P.labelOf(p)}: ${e.message}`),
      notConnected: [...new Set(skipped.map((w) => P.labelOf(w.provider)))],
    };
  } finally { checkState.runningSince = 0; }
}

async function status() {
  const [last, count, byGroup, byProvider] = await Promise.all([
    getSetting(LAST_KEY),
    ShipwayShipment.countDocuments({ found: true }),
    ShipwayShipment.aggregate([{ $match: { found: true } }, { $group: { _id: '$group', n: { $sum: 1 } } }]),
    ShipwayShipment.aggregate([{ $match: { found: true } }, { $group: { _id: '$provider', n: { $sum: 1 } } }]),
  ]);
  const per = Object.fromEntries(byProvider.map((g) => [g._id || 'shipway', g.n]));
  return {
    configured: client.isConfigured(), username: cfg.shipway.username, intervalMin: cfg.shipway.syncIntervalMin, idFormat: cfg.shipway.orderIdFormat,
    running: isRunning(), progress: state.progress, total: state.total, last, tracked: count, byGroup: Object.fromEntries(byGroup.map((g) => [g._id || 'other', g.n])),
    shipway: { configured: client.isConfigured(), tracked: per.shipway || 0 },
    shiprocket: { configured: rocket.isConfigured(), email: cfg.shiprocket.email, mock: rocket.isMock(), tracked: per.shiprocket || 0, intervalMin: cfg.shiprocket.syncIntervalMin },
  };
}

// Login check plus one real lookup (newest order), so a wrong order-id format shows up here and not as an empty column.
async function test() {
  const problems = [];
  await client.authenticate();
  const recent = await Order.find({ excluded: null, orderId: { $ne: null } }).select('orderId').sort({ orderDate: -1, orderId: -1 }).limit(8).lean();
  let sample = null;
  for (const o of recent) {
    const r = await client.getOrderShipmentDetails(o.orderId);
    if (r.found) { const d = normalizeShipment(r.response, r.id); sample = { orderId: o.orderId, shipwayOrderId: r.id, status: d.status, code: d.statusCode, carrier: d.carrier, awb: d.awb, weightKeys: d.weightKeys }; break; }
  }
  if (!sample) { // the newest orders may simply not be dispatched yet: try orders Shipway already knows
    const known = await ShipwayShipment.find({ found: true, provider: { $ne: 'shiprocket' } }).select('orderId').sort({ checkedAt: -1 }).limit(8).lean();
    for (const k of known) {
      const r = await client.getOrderShipmentDetails(k.orderId);
      if (r.found) { const d = normalizeShipment(r.response, r.id); sample = { orderId: k.orderId, shipwayOrderId: r.id, status: d.status, code: d.statusCode, carrier: d.carrier, awb: d.awb, weightKeys: d.weightKeys }; break; }
    }
  }
  if (!sample && recent.length) problems.push(`Login works, but Shipway has no shipment for the ${recent.length} newest orders (${recent.map((o) => o.orderId).join(', ')}). Either they are not dispatched yet, or Shipway holds them under a different order number. If dispatched orders appear in Shipway as something other than 1874 or #1874, tell the developer the exact format.`);
  return { ok: problems.length === 0, sample, problems };
}

// Same check for Shiprocket: the API-user login, then one real lookup among orders the team put through Shiprocket (else the newest orders).
async function testShiprocket() {
  const problems = [];
  await rocket.authenticate();
  const mine = await DeskOrder.find({ 'dq.provider.name': 'shiprocket' }).select('orderId').sort({ updatedAt: -1 }).limit(8).lean();
  const recent = mine.length ? mine : await Order.find({ excluded: null, orderId: { $ne: null } }).select('orderId').sort({ orderDate: -1, orderId: -1 }).limit(8).lean();
  let sample = null;
  for (const o of recent) {
    const r = await lookup(o.orderId, 'shiprocket');
    if (r.found) { const d = r.doc; sample = { orderId: o.orderId, shipwayOrderId: r.id, status: d.status, code: d.statusCode, carrier: d.carrier, awb: d.awb, weightKeys: d.weightKeys }; break; }
  }
  let held = [];
  try { held = (await rocket.recentOrders(10, { fresh: true })).map(rocket.simple); } catch (e) { if (e.code === 'auth') throw e; }
  if (!sample && recent.length) {
    problems.push(`Login works, but Shiprocket has no shipment with an AWB for ${mine.length ? 'the orders marked Shiprocket' : 'the newest orders'} (${recent.map((o) => o.orderId).join(', ')}).`);
    if (!held.length) problems.push('Shiprocket returned no orders at all. Check that this API user has the Orders module ticked, and that Shiprocket has orders for this account.');
    else {
      const shows = held.slice(0, 5).map((h) => `${h.channelOrderId || '(no channel order id)'} → ${h.status || 'no status'}${h.awb ? `, AWB ${h.awb}` : ', no AWB'}`).join(' | ');
      const same = held.some((h) => String(h.channelOrderId).replace(/^#/, '') === String(recent[0].orderId));
      problems.push(`Newest orders in Shiprocket: ${shows}.`);
      problems.push(same ? 'The newest Shopify order is in Shiprocket but has no AWB yet. Create the shipment in Shiprocket, then test again.' : 'The newest Shopify orders are not in that list. If the numbers above look different from your Shopify numbers (for example a long Shopify id), tell the developer the exact format. If they look the same, those orders just have not reached Shiprocket yet.');
    }
  }
  return { ok: problems.length === 0, sample, problems };
}

function start() {
  if (!anyConfigured()) { console.log('[shipway/shiprocket] neither is configured (SHIPWAY_USERNAME / SHIPWAY_LICENSE_KEY, SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD): skipped'); return; }
  const every = Math.min(...[cfg.shipway.syncIntervalMin, cfg.shiprocket.syncIntervalMin].filter((n) => n > 0), Infinity);
  const tick = () => run({ limit: 300 }).catch((e) => { if (e.status !== 409) console.warn('[shipway/shiprocket] sync failed:', e.message); })
    .then(() => checkPacked({ onlyStale: true, limit: 40 })).catch((e) => { if (e.status !== 409) console.warn('[shipping check] failed:', e.message); }); // keeps the Order packed cards current
  setTimeout(tick, 20000);
  if (Number.isFinite(every)) setInterval(tick, every * 60 * 1000);
  console.log(`[tracking] ${client.isConfigured() ? `Shipway as ${cfg.shipway.username}` : 'Shipway off'}, ${rocket.isConfigured() ? `Shiprocket as ${cfg.shiprocket.email || 'mock'}` : 'Shiprocket off'}${Number.isFinite(every) ? `, refreshing every ${every} min` : ''}`);
}

module.exports = { run, refreshOne, shipState, checkPacked, ensureFresh, status, test, testShiprocket, start, providerFor, lookup };
