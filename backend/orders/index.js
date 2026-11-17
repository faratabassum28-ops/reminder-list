// Order Analytics, running INSIDE the Reminder List backend (one server, one deploy).
// Mounted by ../server.js:
//   app.use('/api/orders', orders.publicRouter)                                    // webhooks, cron, Shopify callback: their own secrets
//   app.use('/api/orders', requireAuth, requireApp('orders'), orders.router)       // everything people use: the hub's own login
// Background jobs (sheet / Shopify / Shipway sync, desk follow-ups) start with orders.start() once the database is connected.
const express = require('express');
const crypto = require('crypto');
const cfg = require('./src/config');
const api = require('./src/routes/api');
const teamRoutes = require('./src/routes/flow');
const sync = require('./src/services/sync');
const { StaffUser } = require('./src/models');
const H = require('./src/lib/hubUsers');
const A = require('./src/lib/staffAuth');

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cronAuth = (req, res) => {
  if (!cfg.cronSecret) { res.status(503).json({ error: 'CRON_SECRET is not set on the server' }); return false; }
  const key = req.get('x-cron-key') || req.query.key || '';
  if (!safeEq(key, cfg.cronSecret)) { res.status(401).json({ error: 'Bad key' }); return false; }
  return true;
};
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const resultPage = (ok, text) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopify</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1a1d21">
<h1 style="font-size:22px">${ok ? 'Shopify is connected' : 'Shopify could not be connected'}</h1><p>${escHtml(text)}</p>
<p><a href="${escHtml(cfg.dashboardUrl ? `${cfg.dashboardUrl}/orders/settings` : '/')}">${ok ? 'Back to the dashboard' : 'Back to the dashboard and try again'}</a></p></body>`;

// JSON errors in the shape the screens expect ({ error }).
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) console.error('[orders]', err);
  res.status(status).json({ error: err.message || 'Server error' });
};

// ---------- public: no hub login (each has its own secret or signature) ----------
const publicRouter = express.Router();
// Instant sync: called by the Google Sheet (Apps Script, see apps-script/) whenever a row is added or changed.
publicRouter.all('/webhook/sheet', (req, res) => {
  if (!cronAuth(req, res)) return;
  sync.requestSync('webhook');
  res.status(202).json({ queued: true });
});
// New order in Shopify: Shopify calls this (subscribe orders/create and orders/updated to <server>/api/orders/webhook/shopify).
publicRouter.post('/webhook/shopify', (req, res) => {
  const { verifyShopifyHmac } = require('./src/lib/shopifyHmac');
  if (!verifyShopifyHmac(req.rawBody, req.get('x-shopify-hmac-sha256'), cfg.shopify.clientSecret)) return res.status(401).json({ error: 'Bad signature' });
  res.status(200).json({ ok: true });
  const shopifySync = require('./src/services/shopifySync');
  shopifySync.kick();
  setTimeout(() => shopifySync.kick(), 8000); // a second pull in case the first ran before Shopify finished saving the order
});
// External trigger for the sheet sync (cron-job.org / UptimeRobot / GitHub Actions). Also keeps a sleeping host awake.
publicRouter.all('/cron/sync', (req, res) => {
  if (!cronAuth(req, res)) return;
  const job = sync.syncIfDue('cron');
  if (req.query.wait !== '1') {
    job.then((r) => console.log('[orders cron] sync', r.skipped ? `skipped (${r.reason})` : r.changed === false ? 'ok, no changes' : 'ok, updated'))
      .catch((e) => console.warn('[orders cron] sync failed:', e.message));
    return res.status(202).json({ started: true });
  }
  job.then((r) => res.json({ ok: true, ...r, summary: undefined }))
    .catch((e) => res.status(e.status === 409 ? 202 : 500).json({ ok: false, error: e.message }));
});
// Shopify sends the store owner's browser back here after approving the app: protected by Shopify's signature, a single-use state value
// and a check that the store is ours.
publicRouter.get('/shopify/callback', async (req, res) => {
  try {
    const r = await require('./src/services/shopifyAuth').handleCallback(req.query);
    require('./src/services/shopifySync').kickFull();
    res.type('html').send(resultPage(true, `The store ${r.shop} is linked. Customer details and items are loading now; this can take a few minutes. You can close this tab.`));
  } catch (e) {
    res.status(e.status && e.status < 600 ? e.status : 500).type('html').send(resultPage(false, e.message));
  }
});
publicRouter.use(['/webhook', '/cron', '/shopify/callback'], errorHandler);

// ---------- signed-in: the hub's login has already been checked ----------
const router = express.Router();
router.use('/staff', teamRoutes.staff);
router.use('/flow', teamRoutes.flow);
router.use('/desk/stale-queue', require('./src/routes/staleQueue'));
router.use('/desk', require('./src/routes/desk'));
// Everything else (the analytics dashboard) is for admins.
router.use(async (req, res, next) => {
  try {
    const u = await teamRoutes.staffFromReq(req);
    if (u && A.isAdmin(u)) return next();
  } catch (e) { /* fall through to 403 */ }
  res.status(403).json({ error: 'Admins only' });
});
router.use('/', api);
router.use(errorHandler);

// ---------- jobs + team mirror ----------
let started = false;
function start() {
  if (started) return;
  started = true;
  sync.startAutoSync();
  require('./src/services/shopifySync').start();
  require('./src/services/shipwaySync').start();
  require('./src/services/deskService').start();
  require('./src/services/caseService').start();
}
// Called by the hub whenever accounts change, with every hub user.
const syncTeam = (hubUsers) => H.syncTeam(StaffUser, hubUsers);

module.exports = { publicRouter, router, start, syncTeam };
