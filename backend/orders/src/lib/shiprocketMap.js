// Shiprocket reply -> the same flat shipment document Shipway uses (lib/shipwayMap.js normalizeShipment), so NDR, RTO, weight cases,
// the Overview and the In-transit list work for Shiprocket orders without knowing which provider booked them. Pure: no network, no database.
//
// Shiprocket reports a numeric shipment status and a text status. We translate both onto the Shipway-style codes the rest of the app reads
// (DEL, RTO, RTD, UND, PKP, INT, OOD, SCH, CAN, LOST ...). Anything unknown keeps Shiprocket's own wording and falls in "Other".
const { CODES, FINAL, parseWhen } = require('./shipwayMap');
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Shiprocket numeric status -> Shipway-style code. (From Shiprocket's status list.)
const BY_NUMBER = {
  1: 'SCH', 2: 'SCH', 3: 'SCH', 4: 'SCH', 5: 'SCH', 52: 'SCH', 59: 'SCH', // AWB assigned .. manifest generated .. booked
  6: 'INT', 18: 'INT', 22: 'SMD', 38: 'INT', 39: 'INT', 48: 'INT', 50: 'INT', 51: 'PKP', 55: 'INT', // shipped, in transit, delayed, hubs
  42: 'PKP', 19: 'SCH', 15: 'SCH',
  17: 'OOD',
  7: 'DEL', 23: 'DEL', 26: 'DEL', 43: 'DEL',
  21: 'UND', 40: 'RTO',
  9: 'RTO', 14: 'RTO', 41: 'RTO', 46: 'RTO',
  10: 'RTD',
  8: 'CAN', 45: 'CAN', 16: 'CAN',
  12: 'LOST', 24: 'LOST', 25: 'LOST', 44: 'LOST',
  13: 'PKF', 20: 'PKF',
};

// Text fallback, checked in order. The first match wins, so RTO and undelivered come before the general "delivered" test.
const BY_TEXT = [
  [/pickup (error|exception|failed)/i, 'PKF'],
  [/rto.*(deliver|received)|return(ed)? to origin|rto delivered/i, 'RTD'],
  [/rto/i, 'RTO'],
  [/undeliver|ndr|not delivered|delivery attempt|customer refused|consignee unavailable/i, 'UND'],
  [/out for delivery/i, 'OOD'],
  [/deliver/i, 'DEL'],
  [/cancel/i, 'CAN'],
  [/lost|destroyed|damaged/i, 'LOST'],
  [/delay/i, 'SMD'],
  [/picked up|pickup done|shipped/i, 'PKP'],
  [/transit|reached|dispatch|hub|handover/i, 'INT'],
  [/pickup|awb|manifest|label|new|ready to ship|booked|schedul/i, 'SCH'],
];

function codeFor(statusNumber, statusText) {
  const n = Number(statusNumber);
  if (Number.isInteger(n) && BY_NUMBER[n]) return BY_NUMBER[n];
  const t = clean(statusText);
  for (const [rx, code] of BY_TEXT) if (rx.test(t)) return code;
  return '';
}

const pretty = (t) => clean(t).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

// Pull the shipment object out of a list/detail order: Shiprocket sends `shipments` as an array (list) or one object (detail).
function shipmentOf(order) {
  const s = order && order.shipments;
  const list = Array.isArray(s) ? s : s && typeof s === 'object' ? [s] : [];
  const withAwb = list.filter((x) => x && clean(x.awb || x.awb_code));
  return withAwb[withAwb.length - 1] || list[list.length - 1] || null;
}

// order: one entry of GET /orders (or /orders/show). track: the "tracking_data" of GET /courier/track/awb/{awb} (optional, richer).
// -> null when Shiprocket has the order but no AWB yet (not dispatched).
function fromShiprocket(order, track) {
  const o = order || {};
  const sh = shipmentOf(o) || {};
  const awb = clean(sh.awb || sh.awb_code || o.awb_code || (track && track.shipment_track && track.shipment_track[0] && track.shipment_track[0].awb_code));
  if (!awb) return null;
  const t = (track && Array.isArray(track.shipment_track) && track.shipment_track[0]) || {};
  const acts = (track && Array.isArray(track.shipment_track_activities) ? track.shipment_track_activities : []).filter((a) => a && a.date);
  const last = acts[0]; // Shiprocket lists the newest scan first
  const text = clean(t.current_status) || clean(track && track.shipment_status_text) || clean(last && (last['sr-status-label'] || last.status)) || clean(sh.status) || clean(o.status);
  const number = (track && track.shipment_status) != null && track.shipment_status !== '' ? track.shipment_status : (last && last['sr-status']) != null ? last['sr-status'] : sh.status_code;
  const code = codeFor(number, text);
  const weight_fields = {};
  for (const src of [o, sh, t]) for (const [k, v] of Object.entries(src)) if (/weight|charge|discrepan/i.test(k) && (typeof v === 'number' || typeof v === 'string')) weight_fields[k] = v;
  return {
    weight_fields,
    current_status_code: code, current_status: text ? pretty(text) : '',
    carrier: clean(sh.courier || sh.courier_name || t.courier_name || o.courier_name), awbno: awb,
    from: clean(t.origin || o.pickup_location), to: clean(t.destination || o.customer_city || o.billing_city),
    pickup_date: clean(t.pickup_date || sh.pickup_scheduled_date || ''), time: clean(last && last.date),
    shipment_id: clean(sh.id || sh.shipment_id || t.shipment_id), shiprocket_order_id: clean(o.id),
  };
}

// The stored document for a Shiprocket order. Same fields as normalizeShipment, plus provider and shipmentId.
function normalizeShiprocket(r, shiprocketOrderId = '') {
  const x = r || {};
  const code = clean(x.current_status_code).toUpperCase();
  const known = CODES[code];
  const text = clean(x.current_status);
  const { weightFromShipment } = require('./cases');
  return {
    found: true, provider: 'shiprocket',
    shipwayOrderId: clean(shiprocketOrderId), // kept under the same field name: it is "the order id as the provider holds it"
    shipmentId: clean(x.shipment_id),
    statusCode: code, status: text || (known && known[0]) || code || 'Unknown',
    group: known ? known[1] : 'other', final: FINAL.has(code),
    carrier: clean(x.carrier), awb: clean(x.awbno), from: clean(x.from), to: clean(x.to),
    pickupDate: clean(x.pickup_date), statusTime: clean(x.time), statusAt: parseWhen(x.time),
    weightKeys: x.weight_fields ? Object.keys(x.weight_fields) : [],
    weightInfo: weightFromShipment(x.weight_fields, { unit: process.env.SHIPROCKET_WEIGHT_UNIT === 'g' ? 'g' : 'kg' }), // Shiprocket weights are in kg
  };
}

module.exports = { fromShiprocket, normalizeShiprocket, codeFor, shipmentOf, BY_NUMBER };
