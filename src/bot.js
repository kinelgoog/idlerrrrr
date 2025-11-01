const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

class SteamFarmBot {
  constructor(account) {
    this.account = account;
    this.client = new SteamUser();
    this.steamGuardCallback = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.client.on('loggedOn', () => {
      console.log(`✅ ${this.account.display_name} logged in`);
      this.client.setPersona(1);
      this.client.gamesPlayed([730]); // CS2
      this.account.bot_status = 'online';
      this.account.farm_status = 'running';
    });

    this.client.on('steamGuard', (domain, callback) => {
      console.log(`🔐 ${this.account.display_name} requires Steam Guard`);
      this.steamGuardCallback = callback;
      this.account.bot_status = 'steam_guard';
    });

    this.client.on('disconnected', () => {
      console.log(`🔌 ${this.account.display_name} disconnected`);
      this.isRunning = false;
      this.account.bot_status = 'offline';
      this.account.farm_status = 'stopped';
    });

    this.client.on('error', (err) => {
      console.log(`❌ ${this.account.display_name} error:`, err.message);
      this.account.error = err.message;
      this.account.bot_status = 'error';
      this.isRunning = false;
    });

    let logOnOptions = {
      accountName: this.account.username,
      password: this.account.password
    };

    if (this.account.shared_secret) {
      logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(this.account.shared_secret);
    }

    this.client.logOn(logOnOptions);
  }

  stop() {
    if (this.isRunning) this.client.logOff();
    this.isRunning = false;
    this.account.bot_status = 'offline';
    this.account.farm_status = 'stopped';
  }

  submitSteamGuardCode(code) {
    if (this.steamGuardCallback) {
      this.steamGuardCallback(code);
      this.steamGuardCallback = null;
      this.account.bot_status = 'online';
    }
  }
}

module.exports = SteamFarmBot;
