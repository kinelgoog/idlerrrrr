module.exports = (db) => {
  const router = require('express').Router();
  router.get('/', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error:'unauth' });
    const accounts = await db.getSteamAccountsByUser(req.session.userId);
    res.json({ accounts });
  });
  return router;
};
