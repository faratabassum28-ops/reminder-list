const express = require('express');
const multer = require('multer');
const cfg = require('../config');
const { StaffUser } = require('../models');
const A = require('../lib/staffAuth');
const H = require('../lib/hubUsers');
const svc = require('../services/flowService');
const { resolveWindow } = require('../lib/windows');
const { fmtDate } = require('../lib/istTime');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpErr = svc.httpErr;

const publicUser = (u) => ({ id: String(u._id), username: u.username, name: u.name, role: u.role, roles: A.rolesOf(u), active: u.active, mustChangePassword: !!u.mustChangePassword, lastLoginAt: u.lastLoginAt });

// Who is calling? The hub's own sign-in (requireAuth + the Order Analytics app check, applied where this router is mounted) has already
// identified the person; here they become their desk identity: name, desk team(s) and the stable id every action is stamped with.
async function staffFromReq(req) {
  return H.staffFor(StaffUser, req.user);
}

// Every caller must be a signed-in team member. There is no shared key any more.
const auth = wrap(async (req, res, next) => {
  req.staff = await staffFromReq(req);
  if (req.staff) return next();
  res.status(403).json({ error: 'Your account has no access to Order Analytics. Ask an admin to switch it on in Users.' });
});
const need = (...roles) => (req, res, next) => {
  if (!req.staff) return res.status(403).json({ error: 'Sign in with your own team login to act on orders.' });
  if (A.isAdmin(req.staff) || A.hasRole(req.staff, ...roles)) return next();
  res.status(403).json({ error: 'Your role cannot do this.' });
};
const dashboardOnly = (req, res, next) => (req.staff && A.isAdmin(req.staff) ? next() : res.status(403).json({ error: 'Admins only' }));

const orderIdOf = (req) => { const n = Number(req.params.orderId); if (!Number.isInteger(n) || n <= 0) throw httpErr(400, 'Bad order number'); return n; };

// =====================================================================================================
// /staff : who am I, and (admin) who is on the order desks. People and roles are managed in the hub (Users page).
// =====================================================================================================
const staff = express.Router();
staff.get('/me', auth, (req, res) => res.json({ user: req.staff }));
staff.get('/users', auth, wrap(async (req, res) => {
  if (!A.isAdmin(req.staff)) throw httpErr(403, 'Admins only');
  res.json({ users: (await StaffUser.find().sort({ role: 1, name: 1 }).lean()).map(publicUser), roles: A.rolesOf ? A.ROLES : [] });
}));

const flow = express.Router();
flow.use(auth);
const MAX_MEDIA = cfg.flow.videoEnabled ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MEDIA, files: 1 } });
const takeFile = (field) => (req, res, next) => upload.single(field)(req, res, (e) => {
  if (!e) return next();
  next(httpErr(400, e.code === 'LIMIT_FILE_SIZE' ? `The file is too large (max ${Math.round(MAX_MEDIA / 1048576)} MB). Take the photo again at normal size.` : 'The upload failed. Try again.'));
});

flow.get('/confirm-queue', wrap(async (req, res) => res.json(await svc.confirmQueue())));
flow.post('/orders/:orderId/confirm-action', need('confirmation'), wrap(async (req, res) => {
  res.json(await svc.confirmAction(req.staff, orderIdOf(req), String(req.body.action || ''), req.body));
}));
flow.post('/orders/:orderId/contact', need('confirmation'), wrap(async (req, res) => {
  res.json(await svc.contact(req.staff, orderIdOf(req), String(req.body.channel || ''), req.body));
}));

flow.get('/dispatch', wrap(async (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 3));
  res.json(await svc.dispatchDesk(String(req.query.section || 'print_slip'), { days }));
}));
flow.post('/orders/:orderId/slip', need('packing'), wrap(async (req, res) => res.json(await svc.markSlipPrinted(req.staff, orderIdOf(req)))));
flow.post('/orders/:orderId/pack', need('packing'), takeFile('photo'), wrap(async (req, res) => {
  const b = req.body || {};
  res.json(await svc.pack(req.staff, orderIdOf(req), { awb: b.awb, weight: b.weight, unit: b.unit, file: req.file }));
}));
flow.post('/orders/:orderId/dispatch', need('packing'), wrap(async (req, res) => res.json(await svc.markDispatched(req.staff, orderIdOf(req)))));
flow.post('/orders/:orderId/delay-reason', need('packing'), wrap(async (req, res) => res.json(await svc.setDelayReason(req.staff, orderIdOf(req), String(req.body.reason || '')))));
flow.post('/orders/:orderId/proofs', need('packing'), takeFile('file'), wrap(async (req, res) => res.json(await svc.addProof(req.staff, orderIdOf(req), req.file))));

flow.get('/orders/:orderId/timeline', wrap(async (req, res) => res.json(await svc.timeline(orderIdOf(req)))));
flow.get('/proofs/:id', wrap(async (req, res) => {
  const p = await svc.proofFile(req.params.id);
  res.set({ 'Content-Type': p.mime, 'Content-Length': p.data.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  res.send(p.data);
}));

// Overview feed
flow.get('/overview', dashboardOnly, wrap(async (req, res) => {
  const w = resolveWindow(req.query.window || 'this_month', new Date(), { from: req.query.from, to: req.query.to });
  const out = await svc.overview(w);
  res.json({ ...out, range: { key: w.key, label: w.label, start: w.start ? fmtDate(w.start) : null, end: w.end ? fmtDate(new Date(w.end - 1)) : null } });
}));

flow.get('/config', dashboardOnly, wrap(async (req, res) => res.json(await svc.getConfig())));
flow.put('/config', dashboardOnly, wrap(async (req, res) => res.json(await svc.saveConfig(req.body || {}))));

module.exports = { staff, flow, staffFromReq };
