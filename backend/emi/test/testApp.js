// Test harness: the EMI router on a bare Express app under /api (the hub mounts it at /api/emi behind its own login).
// A JWT stands in for the hub's login: signToken({ _id }) -> the EMI user with that id (the tests' fake models) becomes req.user.
const express = require('express');
const jwt = require('jsonwebtoken');
const compression = require('compression');
const { makeRouter } = require('../src/router');
const { HttpError } = require('../src/middleware');

const SECRET = 'emi-test-secret';
const signToken = (user) => jwt.sign({ sub: String(user._id) }, SECRET, { expiresIn: '1h' });

function createApp() {
  const { User } = require('../src/models'); // resolved late so a test can swap the models first
  const app = express();
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  const identify = async (req) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in');
    let payload;
    try { payload = jwt.verify(header.slice(7), SECRET); } catch { throw new HttpError(401, 'Session expired, please sign in again'); }
    const user = await User.findById(payload.sub);
    if (!user || !user.active) throw new HttpError(401, 'This account is disabled');
    return user;
  };
  app.use('/api', makeRouter({ identify }));
  return app;
}

module.exports = { createApp, signToken };
