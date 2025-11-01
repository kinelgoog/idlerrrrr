// src/routes/status.js
module.exports = (db, manager) => {
  const router = require('express').Router();

  router.get('/', async (req, res) => {
    const accounts = await db.getAccounts();
    res.json({ accounts });
  });

  return router;
};
