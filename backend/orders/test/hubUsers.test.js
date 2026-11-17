// Hub accounts -> Order Analytics desk identities: role mapping, linking existing logins, team sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/lib/staffAuth');
const H = require('../src/lib/hubUsers');

test('rolesFromHub: admin stands alone, members need a team, junk is dropped', () => {
  assert.deepEqual(H.rolesFromHub({ role: 'admin', ordersRoles: ['packing'] }), ['admin']);
  assert.deepEqual(H.rolesFromHub({ role: 'member', ordersRoles: ['packing', 'confirmation'] }), ['confirmation', 'packing']);
  assert.deepEqual(H.rolesFromHub({ role: 'member', ordersRoles: ['packing', 'bogus'] }), ['packing']);
  assert.equal(H.rolesFromHub({ role: 'member', ordersRoles: [] }), null);
  assert.equal(H.rolesFromHub({ role: 'member' }), null);
  assert.equal(H.rolesFromHub(), null);
});

test('usernameFromEmail follows the team username rule', () => {
  assert.match(H.usernameFromEmail('Fara.K+x@mysoulschool.com'), A.USERNAME_RE);
  assert.equal(H.usernameFromEmail('fara@x.com'), 'fara');
  assert.match(H.usernameFromEmail('ab@x.com'), A.USERNAME_RE);
  assert.match(H.usernameFromEmail('a'.repeat(60) + '@x.com'), A.USERNAME_RE);
});

// A tiny in-memory stand-in for the StaffUser model (only what hubUsers uses).
function fakeModel(rows = []) {
  const match = (r, q) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$exists' in v) return (r[k] !== undefined) === v.$exists;
    if (v && typeof v === 'object' && '$regex' in v) return v.$regex.test(r[k] || '');
    if (v instanceof RegExp) return v.test(r[k] || '');
    return r[k] === v;
  });
  const wrap = (r) => Object.assign(r, { save: async () => r });
  return {
    rows,
    findOne: async (q) => { const r = rows.find((x) => match(x, q)); return r ? wrap(r) : null; },
    find: (q) => ({ lean: async () => rows.filter((x) => match(x, q)).map((x) => ({ ...x })) }),
    exists: async (q) => !!rows.find((x) => match(x, q)),
    create: async (d) => { const r = wrap({ _id: `id${rows.length + 1}`, ...d }); rows.push(r); return r; },
    updateOne: async ({ _id }, u) => { const r = rows.find((x) => x._id === _id); Object.assign(r, u.$set || {}); if (u.$inc) for (const k of Object.keys(u.$inc)) r[k] = (r[k] || 0) + u.$inc[k]; },
  };
}
const hub = (o) => ({ _id: 'h1', email: 'meena@mysoulschool.com', name: 'Meena', role: 'member', active: true, apps: ['reminder', 'orders'], ordersRoles: ['confirmation', 'packing'], ...o });

test('staffFor: creates the desk identity from a hub account, with roles from the hub and no password to forget', async () => {
  H.clearStaffCache();
  const M = fakeModel();
  const s = await H.staffFor(M, hub());
  assert.equal(s.name, 'Meena');
  assert.deepEqual(s.roles, ['confirmation', 'packing']);
  assert.equal(s.mustChangePassword, false);
  assert.equal(A.verifyPassword('', M.rows[0].passwordHash), false);
});

test('staffFor: no access -> null and nothing created', async () => {
  H.clearStaffCache();
  const M = fakeModel();
  assert.equal(await H.staffFor(M, hub({ _id: 'h2', ordersRoles: [] })), null);
  assert.equal(await H.staffFor(M, null), null);
  assert.equal(M.rows.length, 0);
});

test('upsertFromHub: links an existing login with the same username instead of duplicating it', async () => {
  const M = fakeModel([{ _id: 'old', username: 'fara', name: 'Fara K', role: 'admin', roles: ['admin'], active: true }]);
  const u = await H.upsertFromHub(M, { rlId: 'u1', email: 'fara@mysoulschool.com', name: 'Fara', role: 'admin' });
  assert.equal(M.rows.length, 1);
  assert.equal(u._id, 'old');
  assert.equal(u.externalId, 'rl:u1');
});

test('upsertFromHub: changed roles bump the session version; unchanged do not; switching off does', async () => {
  const M = fakeModel();
  const p = { rlId: 'u3', email: 'ravi@mysoulschool.com', name: 'Ravi', role: 'member', ordersRoles: ['packing'] };
  let u = await H.upsertFromHub(M, p);
  u = await H.upsertFromHub(M, p);
  assert.equal(u.tokenVersion || 0, 0);
  u = await H.upsertFromHub(M, { ...p, ordersRoles: ['confirmation'] });
  assert.equal(u.tokenVersion, 1);
  u = await H.upsertFromHub(M, p, false);
  assert.equal(u.active, false);
});

test('syncTeam: switches on people with the app and a team, switches off hub people who lost it, never touches local-only logins', async () => {
  H.clearStaffCache();
  const M = fakeModel([{ _id: 'legacy', username: 'oldtimer', name: 'Old Timer', role: 'packing', roles: ['packing'], active: true }]);
  let r = await H.syncTeam(M, [hub(), hub({ _id: 'h2', email: 'noapp@x.com', name: 'No App', apps: ['reminder'] }), hub({ _id: 'h3', email: 'boss@x.com', name: 'Boss', role: 'admin', apps: undefined, ordersRoles: [] })]);
  assert.equal(r.upserted, 2);
  assert.equal(M.rows.filter((x) => x.externalId).length, 2);
  r = await H.syncTeam(M, [hub({ apps: ['reminder'] }), hub({ _id: 'h3', email: 'boss@x.com', name: 'Boss', role: 'admin' })]);
  assert.equal(r.switchedOff, 1);
  assert.equal(M.rows.find((x) => x.externalId === 'rl:h1').active, false);
  assert.equal(M.rows.find((x) => x._id === 'legacy').active, true);
});
