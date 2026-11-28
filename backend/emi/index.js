// EMI Manager (fee + EMI tracking), running INSIDE the Reminder List backend (one server, one deploy, one login).
// Mounted by ../server.js:
//   app.use('/api/emi', requireAuth, requireApp('emi'), emi.router)
// Data lives on its OWN connection (EMI_MONGO_URI, or the EMI_DB_NAME database on the hub's cluster): see src/db.js.
const H = require('./src/lib/hubUsers');
const { makeRouter } = require('./src/router');
const { User, ...M } = require('./src/models');
const db = require('./src/db');
const backup = require('./src/services/backup');

// Hub account (set by the hub's requireAuth) -> EMI identity.
const router = makeRouter({ identify: (req) => H.staffFor(User, req.user) });

// Called by the hub whenever accounts change, with every hub user.
const syncTeam = (hubUsers) => H.syncTeam(User, hubUsers);

// Makes sure the indexes exist (never drops any: the database may be the old standalone one) and starts the Google Sheet backup scheduler.
let started = false;
async function start() {
  if (started) return;
  started = true;
  try {
    await db.emi().asPromise();
    for (const Model of [User, ...Object.values(M)]) {
      await Model.createIndexes().catch((e) => console.warn(`[emi] index on ${Model.collection.name}:`, e.message));
    }
    console.log(`[emi] connected to database "${db.emi().name}"`);
  } catch (e) {
    console.error('[emi] could not start:', e.message);
    return;
  }
  backup.startScheduler();
}

// Company-wide Team Performance (the hub's overview for the managers): the same calls-based report as EMI Manager > Team Performance,
// for every batch. key = today | this_week | last_week | this_month | last_month ...
async function teamPerformance(key = 'this_month') {
  const { todayIST } = require('./src/lib/dates');
  const { resolveWindow } = require('./src/lib/windows');
  const w = resolveWindow(key, todayIST());
  if (!w) throw new Error('Unknown window');
  return require('./src/routes/reports').performanceReport({ role: 'Admin', name: 'Team Performance' }, w);
}

module.exports = { router, start, syncTeam, teamPerformance, clearIdentityCache: H.clearCache };
