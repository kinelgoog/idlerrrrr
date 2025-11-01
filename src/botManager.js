// src/botManager.js
const SteamFarmBot = require('./bot');
const logger = require('./utils/logger');

class BotManager {
  constructor(db) {
    this.db = db;
    this.bots = new Map();
    // preload accounts
    this._loadAccounts();
  }

  async _loadAccounts() {
    const accounts = await this.db.getAccounts();
    for (const acc of accounts) {
      // сохраняем краткий статус, но не запускаем
      await this.db.upsertAccountStatus(acc.id, { farmStatus: acc.farmStatus || 'stopped', botStatus: acc.botStatus || 'offline', error: acc.error || null, needsGuardCode: acc.needsGuardCode || false });
    }
  }

  async start(accountId) {
    const acc = await this.db.getAccount(accountId);
    if (!acc) return { success: false, error: 'Account not found' };
    let bot = this.bots.get(accountId);
    if (!bot) {
      bot = new SteamFarmBot(acc, this.db);
      this.bots.set(accountId, bot);
    }
    bot.start();
    await this.db.upsertAccountStatus(accountId, { farmStatus: 'starting', botStatus: 'connecting', error: null, needsGuardCode: false });
    return { success: true };
  }

  async stop(accountId) {
    const bot = this.bots.get(accountId);
    if (bot) {
      bot.stop();
      this.bots.delete(accountId);
      await this.db.upsertAccountStatus(accountId, { farmStatus: 'stopped', botStatus: 'offline', error: null, needsGuardCode: false });
      return { success: true };
    }
    // even if no bot, set db status
    await this.db.upsertAccountStatus(accountId, { farmStatus: 'stopped', botStatus: 'offline', error: null, needsGuardCode: false });
    return { success: true };
  }

  async submitSteamGuard(accountId, code) {
    const bot = this.bots.get(accountId);
    if (!bot) return { success: false, error: 'Bot not running or no steamGuard callback' };
    const ok = bot.submitSteamGuardCode(code);
    return ok ? { success: true } : { success: false, error: 'Failed to submit code' };
  }

  async shutdownAll() {
    for (const [id, bot] of this.bots) {
      try { bot.stop(); } catch (e) {}
    }
    this.bots.clear();
  }
}

module.exports = BotManager;
