// src/routes/auth.js
const bcrypt = require('bcryptjs');
const uuid = require('uuid');

module.exports = (db) => {
  const router = require('express').Router();

  // Simple admin login using ADMIN_PASS (env) - hashed in memory
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || null; // обязательно задать в env

  if (!ADMIN_PASS) {
    console.warn('ADMIN_PASS not set — web login disabled');
  }

  router.post('/login', async (req, res) => {
    if (!ADMIN_PASS) return res.status(403).json({ error: 'Admin login disabled' });
    const { user, pass } = req.body;
    if (user !== ADMIN_USER) return res.status(403).json({ error: 'Invalid' });
    const ok = pass === ADMIN_PASS;
    if (!ok) return res.status(403).json({ error: 'Invalid' });
    // set session
    req.session.loggedIn = true;
    req.session.user = ADMIN_USER;
    res.json({ success: true });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  return router;
};
