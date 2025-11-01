const SteamFarmBot = require('./bot');
const logger = require('./utils/logger');

class BotManager {
  constructor(db){
    this.db = db;
    this.bots = new Map();
  }

  async startForAccount(accountId){
    const acc = await this.db.getSteamAccount(accountId);
    if (!acc) return { success:false, error:'Account not found' };
    let bot = this.bots.get(accountId);
    if (!bot) { bot = new SteamFarmBot(acc, this.db); this.bots.set(accountId, bot); }
    bot.start();
    await this.db.upsertSteamAccountStatus(accountId,{farmStatus:'starting',botStatus:'connecting',error:null,needsGuardCode:false});
    return { success:true };
  }

  async stopForAccount(accountId){
    const bot = this.bots.get(accountId);
    if (bot){ bot.stop(); this.bots.delete(accountId); await this.db.upsertSteamAccountStatus(accountId,{farmStatus:'stopped',botStatus:'offline',error:null,needsGuardCode:false}); }
    else await this.db.upsertSteamAccountStatus(accountId,{farmStatus:'stopped',botStatus:'offline',error:null,needsGuardCode:false});
    return { success:true };
  }

  async submitSteamGuard(accountId, code){
    const bot = this.bots.get(accountId);
    if (!bot) return { success:false, error:'Bot not running or no callback' };
    return bot.submitSteamGuardCode(code) ? { success:true } : { success:false, error:'submit failed' };
  }

  async shutdownAll(){ for (const [id, bot] of this.bots) try{ bot.stop(); }catch(e){} this.bots.clear(); }
}

module.exports = BotManager;
