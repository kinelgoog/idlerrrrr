
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

class SteamFarmBot {
    constructor({ id, username, password, displayName, sharedSecret, games = [730] }) {
        this.config = { id, username, password, displayName, sharedSecret, games };
        this.client = new SteamUser();
        this.isRunning = false;
        this.steamGuardCallback = null;
        this.status = 'offline';
        this.logMessages = [];
        this.hoursPlayed = {};
        games.forEach(game => this.hoursPlayed[game] = 0);
        this.setupEventHandlers();
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const formatted = `[${timestamp}] ${msg}`;
        this.logMessages.push({ msg: formatted, type });
        if (this.logMessages.length > 50) this.logMessages.shift();
        console.log(`[${this.config.displayName}] ${msg}`);
        return formatted;
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            this.log('✅ Успешный вход!', 'success');
            this.client.setPersona(SteamUser.EPersonaState.Online);
            this.client.gamesPlayed(this.config.games);
            this.isRunning = true;
            this.status = 'online';
            this.startTrackingHours();
        });

        this.client.on('steamGuard', (domain, callback) => {
            if (this.config.sharedSecret) {
                const code = SteamTotp.generateAuthCode(this.config.sharedSecret);
                this.log(`🔐 Отправка Mobile Steam Guard: ${code}`, 'info');
                callback(code);
            } else {
                this.log('🔐 Требуется код Steam Guard (Email)', 'warning');
                this.steamGuardCallback = callback;
                this.status = 'steam_guard';
            }
        });

        this.client.on('error', err => {
            this.log(`❌ Ошибка: ${err.message}`, 'error');
            this.status = 'error';
            this.errorMessage = err.message;
            this.stopTrackingHours();
        });

        this.client.on('disconnected', () => {
            this.log('🔌 Отключен', 'info');
            this.isRunning = false;
            this.stopTrackingHours();
            if (this.status !== 'error') this.status = 'offline';
        });
    }

    startTrackingHours() {
        if (this.hoursInterval) return;
        this.hoursInterval = setInterval(() => {
            for (let gameId of this.config.games) {
                this.hoursPlayed[gameId] += 1 / 60;
            }
        }, 60 * 1000);
    }

    stopTrackingHours() {
        if (this.hoursInterval) clearInterval(this.hoursInterval);
        this.hoursInterval = null;
    }

    start() {
        if (this.isRunning) return;
        this.status = 'connecting';
        this.log('🚀 Запуск...', 'info');
        this.client.logOn({ accountName: this.config.username, password: this.config.password });
    }

    stop() {
        if (this.isRunning) {
            this.log('🛑 Остановка...', 'info');
            this.client.logOff();
        }
        this.isRunning = false;
        this.stopTrackingHours();
        this.status = 'offline';
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            this.status = 'connecting';
            this.log(`🔐 Отправлен код Steam Guard: ${code}`, 'success');
            return true;
        }
        return false;
    }
}

module.exports = SteamFarmBot;
