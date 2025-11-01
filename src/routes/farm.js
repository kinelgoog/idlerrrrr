// src/routes/farm.js
module.exports = (manager) => {
  const router = require('express').Router();

  router.post('/start/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const result = await manager.start(accountId);
    res.json(result);
  });

  router.post('/stop/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const result = await manager.stop(accountId);
    res.json(result);
  });

  return router;
};
