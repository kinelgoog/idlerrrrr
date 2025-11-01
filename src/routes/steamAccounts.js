const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  router.get('/steam-accounts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error:'unauth' });
    const accounts = await db.getSteamAccountsByUser(req.session.userId);
    res.json({ accounts });
  });

  router.post('/steam-accounts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error:'unauth' });
    const { steam_login, steam_password, display_name, games, shared_secret } = req.body;
    if (!steam_login || !steam_password) return res.status(400).json({ error:'missing' });
    const id = await db.createSteamAccount(req.session.userId, { steam_login, steam_password, display_name, games: games?JSON.parse(games):[], shared_secret });
    res.json({ success:true, id });
  });

  router.delete('/steam-accounts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error:'unauth' });
    const id = req.params.id;
    // basic check: ensure belongs to user
    const acc = await db.getSteamAccount(id);
    if (!acc || acc.user_id !== req.session.userId) return res.status(403).json({ error:'forbidden' });
    await db.deleteSteamAccount(id);
    res.json({ success:true });
  });

  return router;
};
