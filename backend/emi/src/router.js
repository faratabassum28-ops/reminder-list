// The EMI Manager API as one Express router. The hub mounts it at /api/emi (after its own login + the "emi" app check, see
// ../index.js); the tests mount it on a bare app with a stand-in `identify`.
const express = require('express');
const cache = require('./services/cache');
const backup = require('./services/backup');
const { errorHandler, HttpError } = require('./middleware');

// Read-only POSTs (the live payment preview, a backup test) are not writes.
const READ_ONLY_POST = /^\/(payments\/preview|backup\/(run|test|audit))/;

// identify(req) -> the EMI identity { _id, name, email, role, can_verify, batches, active } for this request, or null.
function makeRouter({ identify }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const me = await identify(req);
      if (!me) return next(new HttpError(403, 'Your account does not have access to EMI Manager'));
      req.hubUser = req.user;
      req.user = me;
      next();
    } catch (e) { next(e); }
  });

  // Every successful write throws away the computed-screens cache and tells the backup scheduler there is something new to save.
  router.use((req, res, next) => {
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !READ_ONLY_POST.test(req.path);
    if (isWrite) {
      cache.bump(); // drop stale results before the write starts too, so nothing computed mid-write survives it
      res.on('finish', () => { if (res.statusCode < 400) { cache.bump(); backup.markDirty(); } });
    }
    next();
  });

  router.use('/', require('./routes/admin'));
  router.use('/', require('./routes/ops'));
  router.use('/', require('./routes/reports'));
  router.use('/', require('./routes/history'));
  router.use('/', require('./routes/importer'));
  router.use('/', require('./routes/backup'));
  router.use((req, res) => res.status(404).json({ error: 'Not found' }));
  router.use(errorHandler);
  return router;
}

module.exports = { makeRouter };
