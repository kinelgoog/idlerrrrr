const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const logger = require('./utils/logger');

class SteamFarmBot {
  constructor(accountRecord, db) {
    this.account = accountRecord; // snapshot
    this.db = db;
    this.client = null;
    this.isRunning = false;
    this.loginAttempts = 0;
    this.maxAttempts = 6;
    this.backoffBaseMs = 5000;
    this.loggedOn = false;
    this.steamGuardCallback = null;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    await this._ensureClient();
    this._attemptLogonWithBackoff();
  }

  async _ensureClient() {
    if (this.client) return;
    this.client = new SteamUser({ enablePicsCache: true });
    this._attachHandlers();
  }

  _attachHandlers() {
    this.client.on('loggedOn', async () => {
      logger.info(`[${this.account.id}] loggedOn`);
      this.loginAttempts = 0;
      this.loggedOn = true;
      this.isRunning = true;
      try {
        this.client.setPersona(1);
        if (this.account.games && this.account.games.length) this.client.gamesPlayed(this.account.games.map(g=>Number(g)));
        await this.db.upsertSteamAccountStatus(this.account.id, { farmStatus:'running', botStatus:'online', error:null, needsGuardCode:false });
      } catch(e){ logger.warn(e); }
    });

    this.client.on('steamGuard', async (domain, callback) => {
      logger.info(`[${this.account.id}] steamGuard requested`);
      if (this.account.shared_secret) {
        const code = SteamTotp.generateAuthCode(this.account.shared_secret);
        try { callback(code); await this.db.setSteamGuardNeedsCode(this.account.id, false); await this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'starting',botStatus:'connecting',error:null,needsGuardCode:false}); }
        catch(e){ logger.error(e); }
      } else {
        this.steamGuardCallback = callback;
        await this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'stopped',botStatus:'steam_guard',error:null,needsGuardCode:true});
      }
    });

    this.client.on('error', async (err) => {
      logger.error(`[${this.account.id}] error: ${err.message}`);
      await this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'stopped',botStatus:'error',error:err.message,needsGuardCode:false});
      this.loggedOn=false; this.isRunning=false;
      if (err.message && err.message.includes('RateLimitExceeded')) this._scheduleRetry(true); else this._scheduleRetry(false);
    });

    this.client.on('disconnected', async () => {
      logger.info(`[${this.account.id}] disconnected`);
      this.loggedOn=false; this.isRunning=false;
      await this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'stopped',botStatus:'offline',error:null,needsGuardCode:false});
      this._scheduleRetry(false);
    });
  }

  submitSteamGuardCode(code) {
    if (this.steamGuardCallback) {
      try {
        this.steamGuardCallback(code);
        this.steamGuardCallback = null;
        this.db.setSteamGuardNeedsCode(this.account.id, false);
        this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'starting',botStatus:'connecting',error:null,needsGuardCode:false});
        return true;
      } catch(e){ logger.error(e); return false; }
    }
    return false;
  }

  async _attemptLogonWithBackoff() {
    if (this.loginAttempts >= this.maxAttempts) {
      await this.db.upsertSteamAccountStatus(this.account.id,{farmStatus:'stopped',botStatus:'error',error:'Max login attempts',needsGuardCode:false});
      this.isRunning=false; return;
    }
    this.loginAttempts++;
    const wait = this.backoffBaseMs * Math.pow(2,this.loginAttempts-1);
    if (this.loginAttempts>1) await new Promise(r=>setTimeout(r, wait));
    const twoFactorCode = this.account.shared_secret ? SteamTotp.generateAuthCode(this.account.shared_secret) : undefined;
    try { await this._logOn({ accountName:this.account.steam_login, password:this.account.steam_password, twoFactorCode }); }
    catch(e){ logger.error(`[${this.account.id}] logon failed: ${e.message}`); if (e.message && e.message.includes('RateLimitExceeded')) this._scheduleRetry(true); else this._scheduleRetry(false); }
  }

  _logOn(details){ return new Promise((resolve,reject)=>{
    const onError = (err)=>{ cleanup(); reject(err); };
    const onLoggedOn = ()=>{ cleanup(); resolve(); };
    const cleanup = ()=>{ this.client.removeListener('error', onError); this.client.removeListener('loggedOn', onLoggedOn); };
    this.client.once('error', onError);
    this.client.once('loggedOn', onLoggedOn);
    this.client.logOn(details);
  }); }

  _scheduleRetry(isRateLimit){
    const attempts = this.loginAttempts;
    const ms = isRateLimit ? Math.min(30*60*1000, this.backoffBaseMs * Math.pow(2, attempts)) : this.backoffBaseMs * Math.pow(2, attempts);
    setTimeout(()=>{ if (!this.isRunning) { this.isRunning=true; this._attemptLogonWithBackoff(); } }, ms);
  }

  stop(){ try{ if (this.client && this.loggedOn) this.client.logOff(); }catch(e){} this.isRunning=false; this.loggedOn=false; this.steamGuardCallback=null; }
}

module.exports = SteamFarmBot;
