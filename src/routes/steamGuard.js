// src/routes/steamGuard.js
module.exports = (manager) => {
  const router = require('express').Router();

  router.post('/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Enter code' });
    const result = await manager.submitSteamGuard(accountId, code);
    res.json(result);
  });

  return router;
};
