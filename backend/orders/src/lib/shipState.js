// "Where is this order at the shipping service?" in five plain answers, shown on every Order packed card. Pure: no database, no network.
//   awb_ready  the service has made the AWB: press DONE
//   waiting    the order is there but the shipment has not been created yet (the AWB does not exist)
//   cancelled  the order is cancelled at the service: it will never get an AWB
//   not_found  the service does not have this order at all
//   error      we could not ask (login, network)
const STATES = ['awb_ready', 'waiting', 'cancelled', 'not_found', 'error'];
const STALE_MS = 30 * 60 * 1000;

// found: the service has the order. status: its own status text (Shiprocket "NEW", "CANCELED", ...). group: Shipway-style group when known.
// Cancelled wins over an AWB: a shipment cancelled after booking still has an AWB, but it is dead.
function classify({ found, status, hasAwb, group }) {
  if (!found) return 'not_found';
  if (/cancel/i.test(String(status || '')) || group === 'cancelled') return 'cancelled';
  return hasAwb ? 'awb_ready' : 'waiting';
}

// rows: [{ provider, state }] -> { total, all: {state: n}, shipway: {state: n}, shiprocket: {state: n} }
function summarise(rows) {
  const zero = () => Object.fromEntries(STATES.map((s) => [s, 0]));
  const out = { total: rows.length, all: zero(), shipway: zero(), shiprocket: zero() };
  for (const r of rows) { if (!STATES.includes(r.state)) continue; out.all[r.state]++; (out[r.provider] || out.shipway)[r.state]++; }
  return out;
}

const isStale = (check, now = Date.now(), ms = STALE_MS) => !check || !check.at || now - new Date(check.at).getTime() > ms;

module.exports = { STATES, STALE_MS, classify, summarise, isStale };
