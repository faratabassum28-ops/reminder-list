// The hub (Reminder List) is the ONLY place people, passwords and roles are managed. EMI Manager keeps a mirror of them
// (emi_users) so every payment, call and edit can point at a person.
//  - A hub account is linked to the EMI user that already carries its e-mail (an old standalone EMI Manager user), so all
//    that person ever recorded stays under their name; otherwise a new mirror row is created the first time it is seen.
//  - The mirror follows the hub: name, role, "can verify payments", on / off. Nobody has a separate EMI password any more.
//  - Which batches a restricted CRM may see is EMI-specific and is edited in EMI Manager > Settings (never overwritten here).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ROLES = ['Admin', 'Manager', 'CRM', 'Viewer'];
const norm = (s) => String(s || '').trim().toLowerCase();

// Hub role -> EMI role. Hub admins are EMI admins; everyone else uses the role picked on the hub's Users page
// (least privilege - read-only Viewer - when none was picked).
function roleFromHub(hub = {}) {
  if (hub.role === 'admin') return 'Admin';
  return ROLES.includes(hub.emiRole) ? hub.emiRole : 'Viewer';
}
const hasEmiApp = (hub = {}) => hub.active !== false && (hub.role === 'admin' || (Array.isArray(hub.apps) && hub.apps.includes('emi')));

const plain = (u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, can_verify: !!u.can_verify, batches: u.batches || [], active: u.active !== false });

async function upsertFromHub(User, hub) {
  const externalId = `rl:${hub._id}`;
  const email = norm(hub.email);
  const role = roleFromHub(hub);
  const want = { name: String(hub.name || '').trim() || email.split('@')[0], role, can_verify: role === 'Admin' || role === 'Manager' ? true : !!hub.emiCanVerify, active: hub.active !== false, externalId };
  let u = await User.findOne({ externalId });
  if (!u) u = await User.findOne({ email });
  if (!u) {
    return User.create({ ...want, email, password_hash: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4) });
  }
  Object.assign(u, want);
  if (u.email !== email && !(await User.exists({ email, _id: { $ne: u._id } }))) u.email = email;
  await u.save();
  return u;
}

// Identity cache so a request does not hit the database for the mirror every time (the hub already checked the account).
const cache = new Map(); // hub id -> { emi, exp }
const TTL_MS = 30 * 1000;
const clearCache = () => cache.clear();

// The hub account on this request -> the EMI identity, or null when the account has no access to EMI Manager.
async function staffFor(User, hubUser) {
  if (!hubUser || !hasEmiApp(hubUser)) return null;
  const hit = cache.get(String(hubUser._id));
  if (hit && hit.exp > Date.now()) return hit.emi;
  const u = await upsertFromHub(User, hubUser);
  const emi = u && u.active !== false ? plain(u) : null;
  if (cache.size > 500) cache.clear();
  cache.set(String(hubUser._id), { emi, exp: Date.now() + TTL_MS });
  return emi;
}

// Brings the mirror in line with the hub's whole user list: everyone who may use EMI Manager is switched on and up to date,
// every hub-linked mirror row that no longer may is switched off. Users that only ever existed in the old standalone app are not touched.
async function syncTeam(User, hubUsers) {
  let upserted = 0;
  const seen = new Set();
  for (const hub of hubUsers) {
    if (!hasEmiApp(hub)) continue;
    seen.add(`rl:${hub._id}`);
    if (await upsertFromHub(User, hub)) upserted += 1;
  }
  let switchedOff = 0;
  for (const u of await User.find({ externalId: { $regex: /^rl:/ }, active: true }).select('_id externalId').lean()) {
    if (seen.has(u.externalId)) continue;
    await User.updateOne({ _id: u._id }, { $set: { active: false } });
    switchedOff += 1;
  }
  clearCache();
  return { upserted, switchedOff };
}

module.exports = { ROLES, roleFromHub, hasEmiApp, upsertFromHub, staffFor, syncTeam, clearCache };
