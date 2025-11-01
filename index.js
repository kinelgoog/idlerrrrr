const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp'); // ДОБАВЛЯЕМ ЭТОТ МОДУЛЬ!
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Конфигурация администратора
const ADMIN_CONFIG = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
};

console.log('🔐 Данные администратора для удаления аккаунтов:');
console.log(`👤 Логин: ${ADMIN_CONFIG.username}`);
console.log(`🔑 Пароль: ${ADMIN_CONFIG.password}`);

// 🎯 Основная конфигурация
const CONFIG = {
    UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL) || 30000,
    MAX_GAMES: 32
};

// 🗄️ Хранение данных
const DATA_FILE = './accounts.json';

function loadAccounts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки аккаунтов:', error.message);
    }
    return {};
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов:', error.message);
        return false;
    }
}

let accounts = loadAccounts();

// 🕒 Трекер времени фарма
class FarmTimeTracker {
    constructor() {
        this.startTime = null;
        this.totalAccumulated = 0;
    }

    start() {
        this.startTime = new Date();
    }

    stop() {
        if (this.startTime) {
            const sessionSeconds = Math.floor((new Date() - this.startTime) / 1000);
            this.totalAccumulated += sessionSeconds;
            this.startTime = null;
        }
    }

    getCurrentHours() {
        let totalSeconds = this.totalAccumulated;
        
        if (this.startTime) {
            const currentSessionSeconds = Math.floor((new Date() - this.startTime) / 1000);
            totalSeconds += currentSessionSeconds;
        }
        
        return (totalSeconds / 3600).toFixed(1);
    }
}

// 🤖 ИСПРАВЛЕННЫЙ Steam Bot с поддержкой Mobile Steam Guard
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new steamUser({
            enablePicsCache: true,
            autoRelogin: false,
            dataDirectory: `./steamdata_${accountConfig.id}`
        });
        this.isRunning = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 1;
        this.farmTracker = new FarmTimeTracker();
        this.steamGuardCallback = null;
        this.isWaitingForGuard = false;
        this.lastConnectionAttempt = 0;
        this.connectionTimeout = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Бот ${this.config.displayName} успешно вошел в систему`);
            this.reconnectAttempts = 0;
            this.isWaitingForGuard = false;
            
            const games = this.parseGames(this.config.games);
            console.log(`🎮 Запускаю фарм ${games.length} игр для ${this.config.displayName}:`, games);
            
            this.client.setPersona(1);
            this.client.gamesPlayed(games, true);
            
            this.farmTracker.start();
            this.isRunning = true;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'running';
                accounts[this.config.id].botStatus = 'online';
                accounts[this.config.id].farmStartTime = new Date();
                accounts[this.config.id].currentGames = games;
                accounts[this.config.id].needsSteamGuard = false;
                accounts[this.config.id].steamGuardType = null;
                accounts[this.config.id].error = null;
                accounts[this.config.id].rateLimit = false;
                saveAccounts(accounts);
            }
        });

        // 🔥 ПРАВИЛЬНЫЙ обработчик Steam Guard для Mobile
        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
            console.log(`🔐 Steam Guard запрос для ${this.config.displayName}`);
            console.log(`📧 Домен: ${domain}`);
            console.log(`❓ Неверный предыдущий код: ${lastCodeWrong}`);
            
            this.isWaitingForGuard = true;
            this.steamGuardCallback = callback;
            
            // Определяем тип Steam Guard
            let guardType = 'email';
            if (!domain || domain === 'mobile') {
                guardType = 'mobile';
            }
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'steam_guard';
                accounts[this.config.id].farmStatus = 'waiting';
                accounts[this.config.id].needsSteamGuard = true;
                accounts[this.config.id].steamGuardType = guardType;
                accounts[this.config.id].steamGuardDomain = domain;
                accounts[this.config.id].lastCodeWrong = lastCodeWrong || false;
                accounts[this.config.id].error = null;
                accounts[this.config.id].rateLimit = false;
                saveAccounts(accounts);
            }
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка бота ${this.config.displayName}:`, err.message);
            
            this.isRunning = false;
            this.isWaitingForGuard = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].error = err.message;
                
                if (err.message.includes('RateLimitExceeded') || err.eresult === 84) {
                    accounts[this.config.id].needsSteamGuard = false;
                    accounts[this.config.id].rateLimit = true;
                    accounts[this.config.id].rateLimitUntil = Date.now() + 3600000;
                    console.log(`🚫 RateLimit для ${this.config.displayName}. Блокировка на 1 час.`);
                } else if (err.message.includes('InvalidPassword') || err.eresult === 5) {
                    accounts[this.config.id].needsSteamGuard = true;
                    accounts[this.config.id].steamGuardType = 'unknown';
                    accounts[this.config.id].rateLimit = false;
                } else {
                    accounts[this.config.id].needsSteamGuard = false;
                    accounts[this.config.id].steamGuardType = null;
                    accounts[this.config.id].rateLimit = false;
                }
                saveAccounts(accounts);
            }

            this.farmTracker.stop();
            this.clearConnectionTimeout();
        });

        this.client.on('disconnected', (eresult, msg) => {
            console.log(`🔌 Бот ${this.config.displayName} отключен:`, eresult, msg);
            this.farmTracker.stop();
            this.isRunning = false;
            this.isWaitingForGuard = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].farmStatus = 'stopped';
                
                if (eresult === 5) {
                    accounts[this.config.id].needsSteamGuard = true;
                    accounts[this.config.id].steamGuardType = 'unknown';
                } else if (eresult === 84) {
                    accounts[this.config.id].rateLimit = true;
                    accounts[this.config.id].rateLimitUntil = Date.now() + 3600000;
                }
                saveAccounts(accounts);
            }
            
            this.clearConnectionTimeout();
        });

        setInterval(() => {
            if (this.isRunning) {
                const games = this.parseGames(this.config.games);
                this.client.gamesPlayed(games, true);
            }
        }, 300000);
    }

    parseGames(gamesString) {
        if (!gamesString) return [730];
        
        return gamesString
            .split(' ')
            .map(game => parseInt(game.trim()))
            .filter(game => !isNaN(game) && game > 0)
            .slice(0, CONFIG.MAX_GAMES);
    }

    clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    // 🔥 УЛУЧШЕННАЯ отправка Steam Guard кода
    submitSteamGuardCode(code) {
        if (this.steamGuardCallback && typeof this.steamGuardCallback === 'function') {
            console.log(`🔐 Отправка Steam Guard кода для ${this.config.displayName}: ${code}`);
            
            // Вызываем callback с кодом
            this.steamGuardCallback(code);
            
            this.steamGuardCallback = null;
            this.isWaitingForGuard = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].needsSteamGuard = false;
                accounts[this.config.id].steamGuardType = null;
                accounts[this.config.id].lastCodeWrong = false;
                saveAccounts(accounts);
            }
            return true;
        } else {
            console.log(`❌ Нет активного Steam Guard запроса для ${this.config.displayName}`);
            return false;
        }
    }

    // 🔥 НОВЫЙ МЕТОД: Поддержка Two-Factor Code для Mobile Guard
    submitTwoFactorCode(code) {
        console.log(`🔐 Отправка Two-Factor кода для ${this.config.displayName}: ${code}`);
        
        // Используем twoFactorCode для мобильного аутентификатора
        this.client.logOn({
            accountName: this.config.username,
            password: this.config.password,
            twoFactorCode: code
        });
        
        this.isWaitingForGuard = false;
        
        if (accounts[this.config.id]) {
            accounts[this.config.id].needsSteamGuard = false;
            accounts[this.config.id].steamGuardType = null;
            saveAccounts(accounts);
        }
        return true;
    }

    startFarming() {
        if (this.isRunning) {
            console.log(`⚠️ Бот ${this.config.displayName} уже запущен`);
            return;
        }

        // Проверяем RateLimit
        const account = accounts[this.config.id];
        if (account && account.rateLimit && account.rateLimitUntil > Date.now()) {
            const remainingTime = Math.ceil((account.rateLimitUntil - Date.now()) / 60000);
            console.log(`🚫 ${this.config.displayName} заблокирован RateLimit. Осталось: ${remainingTime} мин`);
            
            if (account) {
                account.error = `RateLimit заблокирован. Ожидание ${remainingTime} мин`;
                saveAccounts(accounts);
            }
            return;
        }

        // Проверяем время с последней попытки подключения
        const timeSinceLastAttempt = Date.now() - this.lastConnectionAttempt;
        if (timeSinceLastAttempt < 30000) {
            const waitTime = Math.ceil((30000 - timeSinceLastAttempt) / 1000);
            console.log(`⏳ Слишком частые попытки подключения для ${this.config.displayName}. Ждем ${waitTime} сек`);
            return;
        }

        console.log(`🚀 Запуск бота для ${this.config.displayName}...`);
        this.lastConnectionAttempt = Date.now();
        
        const logOnOptions = {
            accountName: this.config.username,
            password: this.config.password
        };

        // 🔥 ДОБАВЛЯЕМ ПОДДЕРЖКУ SHARED SECRET ДЛЯ MOBILE GUARD
        if (account && account.sharedSecret) {
            try {
                const twoFactorCode = steamTotp.generateAuthCode(account.sharedSecret);
                logOnOptions.twoFactorCode = twoFactorCode;
                console.log(`📱 Используется Two-Factor код из Shared Secret для ${this.config.displayName}`);
            } catch (error) {
                console.log(`❌ Ошибка генерации Two-Factor кода: ${error.message}`);
            }
        }

        if (account) {
            account.farmStatus = 'starting';
            account.botStatus = 'connecting';
            account.error = null;
            account.rateLimit = false;
            saveAccounts(accounts);
        }

        this.clearConnectionTimeout();
        
        this.connectionTimeout = setTimeout(() => {
            if (!this.isRunning && !this.isWaitingForGuard) {
                console.log(`⏰ Таймаут подключения для ${this.config.displayName}`);
                if (account) {
                    account.botStatus = 'timeout';
                    account.error = 'Таймаут подключения';
                    saveAccounts(accounts);
                }
            }
        }, 30000);

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning || this.isWaitingForGuard) {
            console.log(`🛑 Останавливаю фарм для ${this.config.displayName}...`);
            this.client.logOff();
            this.isRunning = false;
            this.isWaitingForGuard = false;
            this.steamGuardCallback = null;
            this.farmTracker.stop();
            this.reconnectAttempts = 0;
            this.clearConnectionTimeout();
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].needsSteamGuard = false;
                accounts[this.config.id].steamGuardType = null;
                accounts[this.config.id].rateLimit = false;
                saveAccounts(accounts);
            }
        }
    }

    getStatus() {
        const account = accounts[this.config.id];
        const games = this.parseGames(this.config.games);
        
        let rateLimitActive = false;
        let rateLimitRemaining = 0;
        
        if (account && account.rateLimit && account.rateLimitUntil) {
            if (account.rateLimitUntil > Date.now()) {
                rateLimitActive = true;
                rateLimitRemaining = Math.ceil((account.rateLimitUntil - Date.now()) / 60000);
            } else {
                account.rateLimit = false;
                account.rateLimitUntil = null;
                saveAccounts(accounts);
            }
        }
        
        return {
            isRunning: this.isRunning,
            farmStatus: this.isRunning ? 'running' : (this.isWaitingForGuard ? 'waiting' : 'stopped'),
            farmedHours: this.farmTracker.getCurrentHours(),
            botStatus: account?.botStatus || 'offline',
            currentGames: games,
            needsSteamGuard: this.isWaitingForGuard || account?.needsSteamGuard || false,
            steamGuardType: account?.steamGuardType || null,
            steamGuardDomain: account?.steamGuardDomain || null,
            lastCodeWrong: account?.lastCodeWrong || false,
            error: account?.error || null,
            rateLimit: rateLimitActive,
            rateLimitRemaining: rateLimitRemaining,
            hasSharedSecret: !!(account?.sharedSecret)
        };
    }
}

// 🎯 Менеджер ботов
class BotManager {
    constructor() {
        this.bots = new Map();
    }

    createBot(accountConfig) {
        const bot = new SteamFarmBot(accountConfig);
        this.bots.set(accountConfig.id, bot);
        return bot;
    }

    startFarm(accountId) {
        let bot = this.bots.get(accountId);
        if (!bot && accounts[accountId]) {
            bot = this.createBot(accounts[accountId]);
        }
        if (bot) {
            bot.startFarming();
            return true;
        }
        return false;
    }

    stopFarm(accountId) {
        const bot = this.bots.get(accountId);
        if (bot) {
            bot.stopFarming();
            return true;
        }
        return false;
    }

    submitSteamGuardCode(accountId, code) {
        const bot = this.bots.get(accountId);
        if (bot) {
            return bot.submitSteamGuardCode(code);
        }
        return false;
    }

    // 🔥 НОВЫЙ МЕТОД: Отправка Two-Factor кода для Mobile Guard
    submitTwoFactorCode(accountId, code) {
        const bot = this.bots.get(accountId);
        if (bot) {
            return bot.submitTwoFactorCode(code);
        }
        return false;
    }

    getStatus(accountId) {
        const bot = this.bots.get(accountId);
        return bot ? bot.getStatus() : {
            isRunning: false,
            farmStatus: 'stopped',
            farmedHours: '0.0',
            botStatus: 'offline',
            currentGames: [],
            needsSteamGuard: false,
            steamGuardType: null,
            steamGuardDomain: null,
            lastCodeWrong: false,
            error: null,
            rateLimit: false,
            rateLimitRemaining: 0,
            hasSharedSecret: false
        };
    }
}

const botManager = new BotManager();

// 🔍 Класс для получения данных Steam
class SteamDataFetcher {
    static async fetchGameHours(steamId, gameId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const html = await response.text();

            const jsonRegex = /var rgGames = (\[.*?\]);/;
            const jsonMatch = html.match(jsonRegex);
            
            if (jsonMatch) {
                try {
                    const gamesData = JSON.parse(jsonMatch[1]);
                    const game = gamesData.find(g => g.appid === gameId);
                    
                    if (game && game.hours_forever) {
                        return parseFloat(game.hours_forever).toFixed(1);
                    }
                } catch (e) {
                    console.log('JSON parse error:', e.message);
                }
            }

            return '0.0';
        } catch (error) {
            console.log('Ошибка получения данных Steam:', error.message);
            return '0.0';
        }
    }
}

// 🔄 Обновление данных аккаунта
async function updateAccountData(accountId) {
    const account = accounts[accountId];
    if (!account) return;

    try {
        account.isLoading = true;
        account.error = null;
        
        console.log(`🔄 Обновление данных для ${account.displayName}...`);
        
        const games = account.games ? account.games.split(' ').map(g => parseInt(g.trim())).filter(g => !isNaN(g)) : [730];
        const hoursData = {};
        
        for (const gameId of games.slice(0, 3)) {
            const hours = await SteamDataFetcher.fetchGameHours(account.steamId, gameId);
            hoursData[gameId] = hours;
        }
        
        account.gameHours = hoursData;
        account.lastUpdate = new Date();
        account.isLoading = false;
        
        saveAccounts(accounts);
        console.log(`✅ Данные обновлены для ${account.displayName}`);
        
    } catch (error) {
        account.error = error.message;
        account.isLoading = false;
        saveAccounts(accounts);
        console.log(`❌ Ошибка обновления для ${account.displayName}: ${error.message}`);
    }
}

// 📊 Обновление глобальной статистики
function updateGlobalStats() {
    const accountList = Object.values(accounts);
    return {
        totalAccounts: accountList.length,
        activeFarms: accountList.filter(acc => acc.farmStatus === 'running').length,
        totalFarmedHours: accountList.reduce((sum, acc) => sum + parseFloat(acc.farmedHours || 0), 0).toFixed(1),
        steamGuardPending: accountList.filter(acc => acc.needsSteamGuard).length,
        rateLimited: accountList.filter(acc => acc.rateLimit && acc.rateLimitUntil > Date.now()).length
    };
}

// 🚀 Express настройки
app.use(express.json());
app.use(express.static('public'));

// 🌐 API Routes
app.get('/', (req, res) => {
    res.send(generateDashboardHTML());
});

app.get('/api/status', (req, res) => {
    Object.keys(accounts).forEach(accountId => {
        const botStatus = botManager.getStatus(accountId);
        if (botStatus) {
            accounts[accountId].farmStatus = botStatus.farmStatus;
            accounts[accountId].botStatus = botStatus.botStatus;
            accounts[accountId].farmedHours = botStatus.farmedHours;
            accounts[accountId].needsSteamGuard = botStatus.needsSteamGuard;
            accounts[accountId].steamGuardType = botStatus.steamGuardType;
            accounts[accountId].steamGuardDomain = botStatus.steamGuardDomain;
            accounts[accountId].currentGames = botStatus.currentGames;
            accounts[accountId].lastCodeWrong = botStatus.lastCodeWrong;
            accounts[accountId].error = botStatus.error;
            accounts[accountId].rateLimit = botStatus.rateLimit;
            accounts[accountId].rateLimitRemaining = botStatus.rateLimitRemaining;
            accounts[accountId].hasSharedSecret = botStatus.hasSharedSecret;
        }
    });
    
    saveAccounts(accounts);
    
    res.json({
        accounts: accounts,
        globalStats: updateGlobalStats(),
        serverTime: new Date()
    });
});

app.post('/api/accounts/add', (req, res) => {
    const { username, password, displayName, steamId, games, sharedSecret } = req.body;
    
    if (!username || !password || !displayName || !steamId) {
        return res.status(400).json({ error: 'Все обязательные поля должны быть заполнены' });
    }

    const accountId = 'acc_' + Date.now();
    
    accounts[accountId] = {
        id: accountId,
        username,
        password,
        displayName,
        steamId,
        games: games || '730',
        sharedSecret: sharedSecret || '', // 🔥 ДОБАВЛЯЕМ ПОЛЕ ДЛЯ SHARED SECRET
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        lastUpdate: null,
        needsSteamGuard: false,
        steamGuardType: null,
        currentGames: [],
        rateLimit: false,
        rateLimitRemaining: 0,
        createdAt: new Date()
    };

    if (saveAccounts(accounts)) {
        console.log(`✅ Добавлен новый аккаунт: ${displayName} (${username})`);
        if (sharedSecret) {
            console.log(`📱 Аккаунт использует Mobile Steam Guard (Shared Secret)`);
        }
        res.json({ success: true, message: 'Аккаунт добавлен', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения аккаунта' });
    }
});

app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { adminUsername, adminPassword } = req.body;
    
    if (adminUsername !== ADMIN_CONFIG.username || adminPassword !== ADMIN_CONFIG.password) {
        return res.status(401).json({ error: 'Неверные учетные данные администратора' });
    }
    
    if (accounts[accountId]) {
        const accountName = accounts[accountId].displayName;
        botManager.stopFarm(accountId);
        delete accounts[accountId];
        
        if (saveAccounts(accounts)) {
            console.log(`🗑️ Удален аккаунт: ${accountName} (ID: ${accountId})`);
            res.json({ success: true, message: 'Аккаунт удален' });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения изменений' });
        }
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.startFarm(accountId)) {
        console.log(`🎮 Запущен фарм для аккаунта: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        console.log(`⏹️ Остановлен фарм для аккаунта: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// 🔥 ОБНОВЛЕННЫЙ Steam Guard endpoint
app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { code, guardType } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Код обязателен' });
    }
    
    console.log(`🔐 Получен ${guardType || 'Steam Guard'} код для ${accountId}: ${code}`);
    
    let success = false;
    
    // 🔥 ВЫБИРАЕМ ПРАВИЛЬНЫЙ МЕТОД В ЗАВИСИМОСТИ ОТ ТИПА GUARD
    if (guardType === 'mobile') {
        success = botManager.submitTwoFactorCode(accountId, code);
    } else {
        success = botManager.submitSteamGuardCode(accountId, code);
    }
    
    if (success) {
        console.log(`✅ Код отправлен для: ${accounts[accountId]?.displayName}`);
        
        // Перезапускаем фарм
        setTimeout(() => {
            botManager.startFarm(accountId);
        }, 3000);
        
        res.json({ success: true, message: 'Код отправлен, перезапускаем подключение...' });
    } else {
        console.log(`❌ Не удалось отправить код для: ${accounts[accountId]?.displayName}`);
        res.status(400).json({ error: 'Не удалось отправить код. Попробуйте остановить и запустить фарм снова.' });
    }
});

app.post('/api/update/:accountId', async (req, res) => {
    const { accountId } = req.params;
    await updateAccountData(accountId);
    res.json({ success: true, message: 'Данные обновлены' });
});

// 🎨 Генерация HTML
function generateDashboardHTML() {
    const globalStats = updateGlobalStats();
    const accountList = Object.values(accounts);
    
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Steam Hour Booster</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            :root {
                --primary: #8B5CF6; --secondary: #3B82F6; --danger: #EF4444; 
                --warning: #F59E0B; --success: #10B981; --background: #0F172A; 
                --surface: rgba(30, 41, 59, 0.8); --text: #F8FAFC; --text-secondary: #94A3B8; 
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
            }
            body { font-family: 'Inter', sans-serif; background: var(--background); color: var(--text); }
            .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { font-size: 2.5rem; font-weight: 700; background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
            .stat-card { background: var(--surface); padding: 20px; border-radius: 15px; text-align: center; border-left: 4px solid var(--primary); }
            .stat-value { font-size: 2rem; font-weight: 700; margin-bottom: 5px; }
            .stat-label { color: var(--text-secondary); font-size: 0.9rem; }
            .btn { padding: 12px 20px; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; gap: 8px; margin: 5px; }
            .btn-primary { background: var(--gradient); color: white; }
            .btn-success { background: var(--success); color: white; }
            .btn-danger { background: var(--danger); color: white; }
            .btn-warning { background: var(--warning); color: black; }
            .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
            .btn:hover:not(:disabled) { transform: translateY(-2px); }
            .accounts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
            .account-card { background: var(--surface); padding: 20px; border-radius: 15px; border-left: 4px solid var(--primary); }
            .account-card.steam-guard { border-left-color: var(--warning); background: rgba(245, 158, 11, 0.1); }
            .account-card.mobile-guard { border-left-color: var(--success); background: rgba(16, 185, 129, 0.1); }
            .account-card.error { border-left-color: var(--danger); background: rgba(239, 68, 68, 0.1); }
            .account-card.rate-limit { border-left-color: #6B7280; background: rgba(107, 114, 128, 0.1); }
            .account-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
            .account-name { font-weight: 700; font-size: 1.2rem; }
            .account-status { padding: 5px 10px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; }
            .status-steam_guard { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
            .status-mobile_guard { background: rgba(16, 185, 129, 0.2); color: var(--success); }
            .status-error { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
            .status-rate_limit { background: rgba(107, 114, 128, 0.2); color: #6B7280; }
            .account-details { margin-bottom: 15px; font-size: 0.9rem; }
            .detail-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .detail-label { color: var(--text-secondary); }
            .steam-guard-section { background: rgba(245, 158, 11, 0.2); padding: 15px; border-radius: 10px; margin: 10px 0; }
            .mobile-guard-section { background: rgba(16, 185, 129, 0.2); padding: 15px; border-radius: 10px; margin: 10px 0; }
            .rate-limit-section { background: rgba(107, 114, 128, 0.2); padding: 15px; border-radius: 10px; margin: 10px 0; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; }
            .modal-content { background: var(--surface); padding: 30px; border-radius: 15px; max-width: 400px; width: 90%; }
            .form-group { margin-bottom: 15px; }
            .form-group input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--text-secondary); background: rgba(255,255,255,0.1); color: var(--text); }
            .notification { position: fixed; top: 20px; right: 20px; padding: 15px; border-radius: 10px; background: var(--surface); transform: translateX(400px); transition: transform 0.3s ease; }
            .notification.show { transform: translateX(0); }
            .guard-type-selector { display: flex; gap: 10px; margin-bottom: 15px; }
            .guard-type-btn { flex: 1; padding: 10px; border: 2px solid var(--text-secondary); border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; text-align: center; }
            .guard-type-btn.active { border-color: var(--primary); background: var(--primary); color: white; }
        </style>
    </head>
    <body>
        <div id="notification" class="notification"></div>
        
        <div id="steamGuardModal" class="modal">
            <div class="modal-content">
                <h3><i class="fas fa-shield-alt"></i> Steam Guard</h3>
                <div id="steamGuardContent"></div>
            </div>
        </div>

        <div class="container">
            <div class="header">
                <h1><i class="fas fa-robot"></i> Steam Hour Booster</h1>
                <button class="btn btn-primary" onclick="showAddAccountModal()">
                    <i class="fas fa-plus"></i> Добавить аккаунт
                </button>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="total-accounts">${globalStats.totalAccounts}</div>
                    <div class="stat-label">Аккаунтов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="active-farms">${globalStats.activeFarms}</div>
                    <div class="stat-label">Активных фармов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="steam-guard-pending">${globalStats.steamGuardPending}</div>
                    <div class="stat-label">Ожидают Steam Guard</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="rate-limited">${globalStats.rateLimited}</div>
                    <div class="stat-label">Заблокированы</div>
                </div>
            </div>
            
            <div class="accounts-grid" id="accounts-container">
                ${accountList.map(account => `
                    <div class="account-card ${account.rateLimit ? 'rate-limit' : account.steamGuardType === 'mobile' ? 'mobile-guard' : account.needsSteamGuard ? 'steam-guard' : ''} ${account.error ? 'error' : ''}">
                        <div class="account-header">
                            <div class="account-name">${account.displayName}</div>
                            <div class="account-status status-${account.rateLimit ? 'rate_limit' : account.steamGuardType === 'mobile' ? 'mobile_guard' : account.botStatus}">
                                ${account.rateLimit ? 'Заблокирован' : 
                                  account.steamGuardType === 'mobile' ? 'Mobile Guard' :
                                  account.botStatus === 'steam_guard' ? 'Email Guard' : 
                                  account.botStatus === 'error' ? 'Ошибка' : account.botStatus}
                            </div>
                        </div>
                        
                        <div class="account-details">
                            <div class="detail-row">
                                <span class="detail-label">Логин:</span>
                                <span>${account.username}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Игры:</span>
                                <span>${account.games || '730'}</span>
                            </div>
                            ${account.hasSharedSecret ? `
                            <div class="detail-row">
                                <span class="detail-label">Тип аутентификации:</span>
                                <span style="color: var(--success);">📱 Mobile Guard (Shared Secret)</span>
                            </div>
                            ` : ''}
                            ${account.rateLimit ? `
                            <div class="detail-row">
                                <span class="detail-label">Разблокировка через:</span>
                                <span>${account.rateLimitRemaining} мин</span>
                            </div>
                            ` : ''}
                            ${account.error && !account.rateLimit ? `
                            <div class="detail-row">
                                <span class="detail-label">Ошибка:</span>
                                <span style="color: var(--danger);">${account.error}</span>
                            </div>
                            ` : ''}
                        </div>
                        
                        ${account.rateLimit ? `
                        <div class="rate-limit-section">
                            <p><strong>🚫 Steam RateLimit</strong></p>
                            <p style="font-size: 0.9rem; margin-bottom: 10px;">Аккаунт заблокирован Steam на ${account.rateLimitRemaining} минут</p>
                            <button class="btn" disabled style="width: 100%; background: #6B7280; color: white;">
                                <i class="fas fa-clock"></i> Ожидание разблокировки...
                            </button>
                        </div>
                        ` : ''}
                        
                        ${account.needsSteamGuard && !account.rateLimit ? `
                        <div class="${account.steamGuardType === 'mobile' ? 'mobile-guard' : 'steam-guard'}-section">
                            <p><strong>${account.steamGuardType === 'mobile' ? '📱 Mobile Steam Guard' : '📧 Email Steam Guard'}</strong></p>
                            <p style="font-size: 0.9rem; margin-bottom: 10px;">
                                ${account.steamGuardType === 'mobile' ? 
                                  'Введите код из мобильного приложения Steam' : 
                                  'Код отправлен на вашу почту'}
                            </p>
                            <button class="btn ${account.steamGuardType === 'mobile' ? 'btn-success' : 'btn-warning'}" onclick="showSteamGuardModal('${account.id}', '${account.displayName}', '${account.steamGuardType}')" style="width: 100%;">
                                <i class="fas fa-key"></i> Ввести код
                            </button>
                        </div>
                        ` : ''}
                        
                        <div style="display: flex; flex-wrap: wrap;">
                            ${account.farmStatus === 'running' ? `
                                <button class="btn btn-danger" onclick="stopFarm('${account.id}')">
                                    <i class="fas fa-stop"></i> Стоп
                                </button>
                            ` : `
                                <button class="btn btn-success" onclick="startFarm('${account.id}')" ${account.rateLimit ? 'disabled' : ''}>
                                    <i class="fas fa-play"></i> Старт
                                </button>
                            `}
                            <button class="btn btn-primary" onclick="updateAccount('${account.id}')" ${account.rateLimit ? 'disabled' : ''}>
                                <i class="fas fa-sync-alt"></i> Обновить
                            </button>
                            <button class="btn btn-danger" onclick="showDeleteModal('${account.id}', '${account.displayName}')">
                                <i class="fas fa-trash"></i> Удалить
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <script>
            class Dashboard {
                constructor() {
                    this.init();
                }
                
                init() {
                    this.loadData();
                    setInterval(() => this.loadData(), 5000);
                }
                
                async loadData() {
                    try {
                        const response = await fetch('/api/status');
                        const data = await response.json();
                        this.updateUI(data);
                    } catch (error) {
                        this.showNotification('Ошибка загрузки данных', 'error');
                    }
                }
                
                updateUI(data) {
                    document.getElementById('total-accounts').textContent = data.globalStats.totalAccounts;
                    document.getElementById('active-farms').textContent = data.globalStats.activeFarms;
                    document.getElementById('steam-guard-pending').textContent = data.globalStats.steamGuardPending;
                    document.getElementById('rate-limited').textContent = data.globalStats.rateLimited;
                    this.renderAccounts(data.accounts);
                }
                
                renderAccounts(accounts) {
                    const container = document.getElementById('accounts-container');
                    const accountsArray = Object.values(accounts);
                    
                    container.innerHTML = accountsArray.map(account => \`
                        <div class="account-card \${account.rateLimit ? 'rate-limit' : account.steamGuardType === 'mobile' ? 'mobile-guard' : account.needsSteamGuard ? 'steam-guard' : ''} \${account.error ? 'error' : ''}">
                            <div class="account-header">
                                <div class="account-name">\${account.displayName}</div>
                                <div class="account-status status-\${account.rateLimit ? 'rate_limit' : account.steamGuardType === 'mobile' ? 'mobile_guard' : account.botStatus}">
                                    \${account.rateLimit ? 'Заблокирован' : 
                                      account.steamGuardType === 'mobile' ? 'Mobile Guard' :
                                      account.botStatus === 'steam_guard' ? 'Email Guard' : 
                                      account.botStatus === 'error' ? 'Ошибка' : account.botStatus}
                                </div>
                            </div>
                            
                            <div class="account-details">
                                <div class="detail-row">
                                    <span class="detail-label">Логин:</span>
                                    <span>\${account.username}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Игры:</span>
                                    <span>\${account.games || '730'}</span>
                                </div>
                                \${account.hasSharedSecret ? \`
                                <div class="detail-row">
                                    <span class="detail-label">Тип аутентификации:</span>
                                    <span style="color: var(--success);">📱 Mobile Guard (Shared Secret)</span>
                                </div>
                                \` : ''}
                                \${account.rateLimit ? \`
                                <div class="detail-row">
                                    <span class="detail-label">Разблокировка через:</span>
                                    <span>\${account.rateLimitRemaining} мин</span>
                                </div>
                                \` : ''}
                                \${account.error && !account.rateLimit ? \`
                                <div class="detail-row">
                                    <span class="detail-label">Ошибка:</span>
                                    <span style="color: var(--danger);">\${account.error}</span>
                                </div>
                                \` : ''}
                            </div>
                            
                            \${account.rateLimit ? \`
                            <div class="rate-limit-section">
                                <p><strong>🚫 Steam RateLimit</strong></p>
                                <p style="font-size: 0.9rem; margin-bottom: 10px;">Аккаунт заблокирован Steam на \${account.rateLimitRemaining} минут</p>
                                <button class="btn" disabled style="width: 100%; background: #6B7280; color: white;">
                                    <i class="fas fa-clock"></i> Ожидание разблокировки...
                                </button>
                            </div>
                            \` : ''}
                            
                            \${account.needsSteamGuard && !account.rateLimit ? \`
                            <div class="\${account.steamGuardType === 'mobile' ? 'mobile-guard' : 'steam-guard'}-section">
                                <p><strong>\${account.steamGuardType === 'mobile' ? '📱 Mobile Steam Guard' : '📧 Email Steam Guard'}</strong></p>
                                <p style="font-size: 0.9rem; margin-bottom: 10px;">
                                    \${account.steamGuardType === 'mobile' ? 
                                      'Введите код из мобильного приложения Steam' : 
                                      'Код отправлен на вашу почту'}
                                </p>
                                <button class="btn \${account.steamGuardType === 'mobile' ? 'btn-success' : 'btn-warning'}" onclick="showSteamGuardModal('\${account.id}', '\${account.displayName}', '\${account.steamGuardType}')" style="width: 100%;">
                                    <i class="fas fa-key"></i> Ввести код
                                </button>
                            </div>
                            \` : ''}
                            
                            <div style="display: flex; flex-wrap: wrap;">
                                \${account.farmStatus === 'running' ? \`
                                    <button class="btn btn-danger" onclick="stopFarm('\${account.id}')">
                                        <i class="fas fa-stop"></i> Стоп
                                    </button>
                                \` : \`
                                    <button class="btn btn-success" onclick="startFarm('\${account.id}')" \${account.rateLimit ? 'disabled' : ''}>
                                        <i class="fas fa-play"></i> Старт
                                    </button>
                                \`}
                                <button class="btn btn-primary" onclick="updateAccount('\${account.id}')" \${account.rateLimit ? 'disabled' : ''}>
                                    <i class="fas fa-sync-alt"></i> Обновить
                                </button>
                                <button class="btn btn-danger" onclick="showDeleteModal('\${account.id}', '\${account.displayName}')">
                                    <i class="fas fa-trash"></i> Удалить
                                </button>
                            </div>
                        </div>
                    \`).join('');
                }
                
                showNotification(message, type = 'info') {
                    const notification = document.getElementById('notification');
                    notification.textContent = message;
                    notification.className = \`notification \${type} show\`;
                    setTimeout(() => notification.classList.remove('show'), 4000);
                }
            }

            let currentGuardType = 'email';

            function showSteamGuardModal(accountId, accountName, guardType = 'email') {
                currentGuardType = guardType;
                
                document.getElementById('steamGuardContent').innerHTML = \`
                    <div style="margin-bottom: 15px;">
                        <p><strong>\${guardType === 'mobile' ? '📱 Mobile Steam Guard' : '📧 Email Steam Guard'}</strong></p>
                        <p style="font-size: 0.9rem; color: var(--text-secondary);">
                            \${guardType === 'mobile' ? 
                              'Введите 5-значный код из мобильного приложения Steam' : 
                              'Введите код, отправленный на вашу почту'}
                        </p>
                    </div>
                    <div class="form-group">
                        <input type="text" id="steamGuardCode" placeholder="Введите 5-значный код" maxlength="5">
                    </div>
                    <button class="btn \${guardType === 'mobile' ? 'btn-success' : 'btn-warning'}" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                        <i class="fas fa-shield-alt"></i> Подтвердить \${guardType === 'mobile' ? 'Mobile' : 'Email'} код
                    </button>
                    <p style="margin-top: 15px; font-size: 0.9rem; color: var(--text-secondary);">
                        <i class="fas fa-info-circle"></i> После ввода кода система автоматически перезапустит подключение
                    </p>
                \`;
                document.getElementById('steamGuardModal').style.display = 'flex';
            }

            async function submitSteamGuardCode(accountId) {
                const code = document.getElementById('steamGuardCode').value;
                if (!code) {
                    dashboard.showNotification('Введите код Steam Guard', 'error');
                    return;
                }

                try {
                    const response = await fetch(\`/api/steam-guard/\${accountId}\`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            code: code,
                            guardType: currentGuardType 
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Код отправлен! Перезапускаем подключение...', 'success');
                        document.getElementById('steamGuardModal').style.display = 'none';
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка отправки кода', 'error');
                }
            }

            async function startFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, {method: 'POST'});
                    const result = await response.json();
                    dashboard.showNotification(result.success ? 'Фарм запущен' : result.error, result.success ? 'success' : 'error');
                } catch (error) {
                    dashboard.showNotification('Ошибка запуска фарма', 'error');
                }
            }

            async function stopFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, {method: 'POST'});
                    const result = await response.json();
                    dashboard.showNotification(result.success ? 'Фарм остановлен' : result.error, result.success ? 'success' : 'error');
                } catch (error) {
                    dashboard.showNotification('Ошибка остановки фарма', 'error');
                }
            }

            async function updateAccount(accountId) {
                try {
                    const response = await fetch(\`/api/update/\${accountId}\`, {method: 'POST'});
                    dashboard.showNotification('Данные обновлены', 'success');
                } catch (error) {
                    dashboard.showNotification('Ошибка обновления', 'error');
                }
            }

            function showDeleteModal(accountId, accountName) {
                const adminUsername = prompt('Логин администратора:');
                const adminPassword = prompt('Пароль администратора:');
                
                if (adminUsername && adminPassword) {
                    fetch(\`/api/accounts/delete/\${accountId}\`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({adminUsername, adminPassword})
                    })
                    .then(r => r.json())
                    .then(result => {
                        alert(result.success ? 'Аккаунт удален' : result.error);
                        if (result.success) dashboard.loadData();
                    });
                }
            }

            function showAddAccountModal() {
                const username = prompt('Логин Steam:');
                const password = prompt('Пароль Steam:');
                const displayName = prompt('Название на сайте:');
                const steamId = prompt('Steam ID:');
                const games = prompt('ID игр через пробел (по умолчанию 730):', '730');
                const sharedSecret = prompt('Shared Secret (для Mobile Guard, опционально):');

                if (username && password && displayName && steamId) {
                    fetch('/api/accounts/add', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({username, password, displayName, steamId, games, sharedSecret})
                    })
                    .then(r => r.json())
                    .then(result => {
                        alert(result.success ? 'Аккаунт добавлен' : result.error);
                        if (result.success) dashboard.loadData();
                    });
                }
            }

            const dashboard = new Dashboard();

            document.getElementById('steamGuardModal').addEventListener('click', (e) => {
                if (e.target.id === 'steamGuardModal') {
                    e.target.style.display = 'none';
                }
            });
        </script>
    </body>
    </html>
  `;
}

// 🚀 Запуск сервера
console.log('🚀 Запуск Steam Hour Booster...');
console.log(`📊 Загружено аккаунтов: ${Object.keys(accounts).length}`);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT}`);
});
