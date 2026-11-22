// Reading Shiprocket's reply to "generate manifest". Pure. Shiprocket answers { status: 1, manifest_url: "https://...pdf" } and does NOT send a manifest id,
// so we make our own reference (SR- plus digits from the PDF link, else the time) to group the orders in Order handover.
// A reply without a manifest_url, or with an error status, means no manifest was created: every order is rejected with Shiprocket's reason.
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

function refFrom(url, now) {
  const m = clean(url).match(/(\d{5,})/g);
  if (m && m.length) return `SR-${m[m.length - 1]}`;
  const d = new Date(now); const p = (n) => String(n).padStart(2, '0');
  return `SR-${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// reply: { status: httpStatus, data } from the client. sent: [{ orderId, shipmentId }]
// -> { manifestId, url, accepted: [orderId], rejected: [{ orderId, reason }], message }
function parseShiprocketManifest(reply, sent, now = new Date()) {
  const d = (reply && reply.data && typeof reply.data === 'object') ? reply.data : {};
  const http = reply && reply.status;
  const url = clean(d.manifest_url || (d.data && d.data.manifest_url));
  const ok = (d.status === 1 || d.status === true || String(d.status).toLowerCase() === 'success' || (http && http < 400 && d.status === undefined)) && !!url;
  let message = ['message', 'msg', 'error'].map((k) => d[k]).find((v) => typeof v === 'string' && v.trim()) || '';
  if (!message && d.errors && typeof d.errors === 'object') message = Object.entries(d.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('; ');
  message = clean(message);

  const why = new Map(); // per-shipment reasons, when Shiprocket names the shipment
  if (d.errors && typeof d.errors === 'object' && !Array.isArray(d.errors)) {
    for (const [k, v] of Object.entries(d.errors)) {
      const s = sent.find((x) => String(x.shipmentId) === String(k).replace(/\D/g, '') || String(x.orderId) === String(k).replace(/\D/g, ''));
      if (s) why.set(s.orderId, [].concat(v).join(', '));
    }
  }
  const accepted = []; const rejected = [];
  const manifestId = ok ? refFrom(url, now) : null;
  for (const s of sent) {
    if (!ok) rejected.push({ orderId: s.orderId, reason: why.get(s.orderId) || message || 'Shiprocket did not create a manifest' });
    else if (why.has(s.orderId)) rejected.push({ orderId: s.orderId, reason: why.get(s.orderId) });
    else accepted.push(s.orderId);
  }
  return { manifestId, url: ok ? url : '', accepted, rejected, message };
}

module.exports = { parseShiprocketManifest, refFrom };
