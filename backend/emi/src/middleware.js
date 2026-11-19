const { ActivityLog } = require('./models');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Sign-in itself is the hub's (Reminder List) job. By the time a request reaches an EMI route, router.js has already
// swapped the hub account for the EMI identity { _id, name, email, role, can_verify, batches, active } in req.user.
const auth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in')));

const role = (...allowed) => (req, res, next) =>
  allowed.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to do this'));

const canVerify = (user) => ['Admin', 'Manager'].includes(user.role) || user.can_verify;

// Rule 11: a restricted CRM only sees assigned batches. Returns null (= all) or an array of batch ids.
const batchScope = (user) => (user.role === 'CRM' && user.batches && user.batches.length ? user.batches.map(String) : null);

function assertBatchAccess(user, batchId) {
  const scope = batchScope(user);
  if (scope && !scope.includes(String(batchId))) throw new HttpError(403, 'This batch is not assigned to you');
}

// Rule 12: every create/edit/delete is written to the activity log.
async function logActivity(user, entity, entity_id, action, changes, reason) {
  try {
    await ActivityLog.create({ user: user && user._id, user_name: user ? user.name : 'system', entity, entity_id: String(entity_id), action, changes, reason });
  } catch (e) {
    console.error('activity log failed', e.message);
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join('; ') });
  if (err.name === 'CastError') return res.status(400).json({ error: `Invalid ${err.path}` });
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `Duplicate ${field.replace('_', ' ')}: this already exists` });
  }
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is larger than 5 MB' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}

module.exports = { HttpError, h, auth, role, canVerify, batchScope, assertBatchAccess, logActivity, errorHandler };
