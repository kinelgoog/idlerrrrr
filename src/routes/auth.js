const express = require('express');
const bcrypt = require('bcryptjs');

module.exports = (db) => {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error:'missing' });
    const existing = await db.findUserByUsername(username);
    if (existing) return res.status(400).json({ error:'user_exists' });
    const user = await db.createUser(username, password);
    req.session.userId = user.id;
    res.json({ success:true, user:{ id:user.id, username:user.username } });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error:'missing' });
    const user = await db.findUserByUsername(username);
    if (!user) return res.status(400).json({ error:'invalid' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error:'invalid' });
    req.session.userId = user.id;
    res.json({ success:true, user:{ id:user.id, username:user.username } });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(()=>res.json({ success:true }));
  });

  router.get('/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error:'unauth' });
    const user = await db.getUserById(req.session.userId);
    res.json({ user });
  });

  return router;
};
