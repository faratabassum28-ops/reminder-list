// The hub (Reminder List) is the ONLY place people and roles are managed. Order Analytics keeps a mirror of them (StaffUser) so every
// action, assignment and report can point at a person. A hub account becomes (or links to) a mirror row the first time it is seen,
// and the mirror follows the hub: name, desk team(s), on/off. Nobody has a separate password here any more.
const crypto = require('crypto');
const A = require('./staffAuth');

const TEAM_ROLES = ['confirmation', 'packing'];
// The hub's role -> the roles this site uses. Admin (hub admin, or the Order Analytics "Admin" role) stands alone; everyone else needs at least one team.
// Returns null when the person has no access to Order Analytics.
function rolesFromHub({ role, ordersRoles } = {}) {
  if (role === 'admin' || (Array.isArray(ordersRoles) && ordersRoles.includes('admin'))) return ['admin'];
  const picked = TEAM_ROLES.filter((r) => Array.isArray(ordersRoles) && ordersRoles.includes(r));
  return picked.length ? picked : null;
}

// Only letters, digits, dot, dash, underscore; 3 to 32 characters (the same rule team usernames follow).
function usernameFromEmail(email) {
  let u = A.normaliseUsername(String(email || '').split('@')[0]).replace(/[^a-z0-9._-]/g, '');
  if (u.length < 3) u = (u + 'user').slice(0, 8);
  return u.slice(0, 32);
}

const norm = (s) => String(s || '').trim().toLowerCase();
const cleanName = (p) => String(p.name || '').trim() || String(p.email).split('@')[0];

// Finds or creates the team login for a hub account and brings its name, roles and active flag up to date.
// A login the team already had (same username as the e-mail's first part, or the same full name) is linked, not duplicated,
// so everything that person did before stays under their name. Changing roles signs their old sessions out (they get a new one at once).
async function upsertFromHub(StaffUser, p, active = true) {
  const roles = rolesFromHub(p);
  const externalId = `rl:${p.rlId}`;
  const email = norm(p.email);
  const name = cleanName(p);
  let u = await StaffUser.findOne({ externalId });
  if (!u) {
    const uname = usernameFromEmail(email);
    u = await StaffUser.findOne({ externalId: { $exists: false }, username: uname })
      || await StaffUser.findOne({ externalId: { $exists: false }, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  }
  const want = { externalId, email, name, active: !!(active && roles) };
  if (roles) { want.roles = roles; want.role = A.primaryRole(roles); }
  if (!u) {
    if (!roles) return null;
    let username = usernameFromEmail(email); let n = 1;
    while (await StaffUser.exists({ username })) username = `${usernameFromEmail(email).slice(0, 28)}${++n}`;
    return StaffUser.create({ ...want, username, passwordHash: A.hashPassword(crypto.randomBytes(24).toString('hex')), mustChangePassword: false, createdBy: 'hub' });
  }
  const rolesChanged = roles ? JSON.stringify(A.rolesOf(u)) !== JSON.stringify(roles) : false;
  const switchedOff = u.active && !want.active;
  Object.assign(u, want);
  if (rolesChanged || switchedOff) u.tokenVersion = (u.tokenVersion || 0) + 1;
  await u.save();
  return u;
}

// Cache so a request does not hit the database for the mirror every time (the hub already checked the account itself).
const cache = new Map(); // hub id -> { staff, exp }
const TTL_MS = 30 * 1000;
const clearStaffCache = () => cache.clear();

// The hub account on this request -> the staff identity the desks use, or null when the account has no access to Order Analytics.
async function staffFor(StaffUser, hubUser) {
  if (!hubUser) return null;
  const hit = cache.get(String(hubUser._id));
  if (hit && hit.exp > Date.now()) return hit.staff;
  const p = { rlId: String(hubUser._id), email: hubUser.email, name: hubUser.name, role: hubUser.role === 'admin' ? 'admin' : 'member', ordersRoles: hubUser.ordersRoles };
  if (!rolesFromHub(p)) return null;
  const u = await upsertFromHub(StaffUser, p, hubUser.active !== false);
  if (!u || !u.active) return null;
  const staff = { id: String(u._id), name: u.name, role: u.role, roles: A.rolesOf(u), username: u.username, mustChangePassword: false };
  if (cache.size > 500) cache.clear();
  cache.set(p.rlId, { staff, exp: Date.now() + TTL_MS });
  return staff;
}

// Brings the mirror in line with the hub's whole user list (every account that may use Order Analytics is switched on, everyone else
// that came from the hub is switched off). Logins that only ever existed here are never touched.
async function syncTeam(StaffUser, hubUsers) {
  let upserted = 0; const seen = new Set();
  for (const h of hubUsers) {
    const p = { rlId: String(h._id), email: h.email, name: h.name, role: h.role === 'admin' ? 'admin' : 'member', ordersRoles: h.ordersRoles };
    const hasApp = h.active !== false && (h.role === 'admin' || (Array.isArray(h.apps) && h.apps.includes('orders')));
    if (hasApp && rolesFromHub(p)) { seen.add(`rl:${p.rlId}`); if (await upsertFromHub(StaffUser, p, true)) upserted += 1; }
  }
  let switchedOff = 0;
  for (const u of await StaffUser.find({ externalId: { $regex: /^rl:/ }, active: true }).lean()) {
    if (seen.has(u.externalId)) continue;
    await StaffUser.updateOne({ _id: u._id }, { $set: { active: false }, $inc: { tokenVersion: 1 } });
    switchedOff += 1;
  }
  clearStaffCache();
  return { upserted, switchedOff };
}

module.exports = { TEAM_ROLES, rolesFromHub, usernameFromEmail, upsertFromHub, staffFor, syncTeam, clearStaffCache };
