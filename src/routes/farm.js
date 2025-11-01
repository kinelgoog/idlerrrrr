const express = require('express');
module.exports = (manager) => {
  const router = express.Router();

  router.post('/start/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const result = await manager.startForAccount(accountId);
    res.json(result);
  });

  router.post('/stop/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const result = await manager.stopForAccount(accountId);
    res.json(result);
  });

  return router;
};
