const express = require('express');
const steamUser = require('steam-user');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Конфигурация администратора
const ADMIN_CONFIG = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
};

// 🎯 Основная конфигурация
const CONFIG = {
    UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL) || 30000,
    MAX_GAMES: 32 // Максимальное количество игр для фарма
};

// 🗄️ Хранение данных
const DATA_FILE = './accounts.json';
const SESSIONS_FILE = './sessions.json';

// 🎯 Загрузка данных из файлов
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

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки сессий:', error.message);
    }
    return {};
}

// 🎯 Сохранение данных в файлы
function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов:', error.message);
        return false;
    }
}

function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения сессий:', error.message);
        return false;
    }
}

// 🎯 Инициализация данных
let accounts = loadAccounts();
let steamGuardSessions = loadSessions();

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

    reset() {
        this.startTime = null;
        this.totalAccumulated = 0;
    }
}

// 🤖 Улучшенный Steam Bot с поддержкой Steam Guard
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new steamUser({
            enablePicsCache: true,
            autoRelogin: true,
            dataDirectory: `./steamdata_${accountConfig.id}`
        });
        this.isRunning = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.farmTracker = new FarmTimeTracker();
        this.steamGuardCallback = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Бот ${this.config.displayName} успешно вошел в систему`);
            console.log(`🔐 Логин: ${this.config.username}, Пароль: ${this.config.password}`);
            this.reconnectAttempts = 0;
            
            // Парсим игры из строки
            const games = this.parseGames(this.config.games);
            console.log(`🎮 Запускаю фарм ${games.length} игр для ${this.config.displayName}:`, games);
            
            this.client.setPersona(1);
            this.client.gamesPlayed(games, true);
            
            this.farmTracker.start();
            this.isRunning = true;
            
            // Обновляем состояние
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'running';
                accounts[this.config.id].botStatus = 'online';
                accounts[this.config.id].farmStartTime = new Date();
                accounts[this.config.id].currentGames = games;
                saveAccounts(accounts);
            }
        });

        this.client.on('steamGuard', (domain, callback) => {
            console.log(`🔐 Steam Guard запрос для ${this.config.displayName}`);
            console.log(`📧 Домен: ${domain}`);
            
            // Сохраняем callback для использования позже
            this.steamGuardCallback = callback;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'steam_guard';
                accounts[this.config.id].steamGuardDomain = domain;
                accounts[this.config.id].needsSteamGuard = true;
                saveAccounts(accounts);
            }
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка бота ${this.config.displayName}:`, err);
            console.log(`🔐 Логин: ${this.config.username}, Пароль: ${this.config.password}`);
            this.isRunning = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].needsSteamGuard = false;
                saveAccounts(accounts);
            }

            this.farmTracker.stop();

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                setTimeout(() => this.startFarming(), 15000);
            }
        });

        this.client.on('disconnected', (eresult, msg) => {
            console.log(`🔌 Бот ${this.config.displayName} отключен:`, eresult, msg);
            this.farmTracker.stop();
            this.isRunning = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].needsSteamGuard = false;
                saveAccounts(accounts);
            }

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`🔄 Автопереподключение ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                setTimeout(() => this.startFarming(), 20000);
            }
        });

        // Защита от таймаута
        setInterval(() => {
            if (this.isRunning) {
                const games = this.parseGames(this.config.games);
                this.client.gamesPlayed(games, true);
            }
        }, 300000);
    }

    // Парсинг строки с играми
    parseGames(gamesString) {
        if (!gamesString) return [730]; // По умолчанию CS2
        
        return gamesString
            .split(' ')
            .map(game => parseInt(game.trim()))
            .filter(game => !isNaN(game) && game > 0)
            .slice(0, CONFIG.MAX_GAMES);
    }

    // Обработка Steam Guard кода
    submitSteamGuardCode(code) {
        if (this.steamGuardCallback && typeof this.steamGuardCallback === 'function') {
            console.log(`🔐 Отправка Steam Guard кода для ${this.config.displayName}`);
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].needsSteamGuard = false;
                accounts[this.config.id].steamGuardDomain = null;
                saveAccounts(accounts);
            }
            return true;
        }
        return false;
    }

    startFarming() {
        if (this.isRunning) return;

        console.log(`🚀 Запуск бота для ${this.config.username}...`);
        console.log(`🔐 Логин: ${this.config.username}, Пароль: ${this.config.password}`);
        
        const logOnOptions = {
            accountName: this.config.username,
            password: this.config.password,
            rememberPassword: true
        };

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 Останавливаю фарм для ${this.config.username}...`);
            this.client.logOff();
            this.isRunning = false;
            this.farmTracker.stop();
            this.reconnectAttempts = 0;
            this.steamGuardCallback = null;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].needsSteamGuard = false;
                saveAccounts(accounts);
            }
        }
    }

    getStatus() {
        const games = this.parseGames(this.config.games);
        return {
            isRunning: this.isRunning,
            farmStatus: this.isRunning ? 'running' : 'stopped',
            farmedHours: this.farmTracker.getCurrentHours(),
            botStatus: accounts[this.config.id]?.botStatus || 'offline',
            reconnectAttempts: this.reconnectAttempts,
            currentGames: games,
            needsSteamGuard: accounts[this.config.id]?.needsSteamGuard || false,
            steamGuardDomain: accounts[this.config.id]?.steamGuardDomain || null
        };
    }
}

// 🎯 Менеджер ботов
class BotManager {
    constructor() {
        this.bots = new Map();
        this.initBots();
    }

    initBots() {
        Object.values(accounts).forEach(account => {
            if (account.farmStatus === 'running') {
                // Перезапускаем фарм для аккаунтов, которые были в процессе фарма
                setTimeout(() => {
                    this.startFarm(account.id);
                }, 5000);
            }
        });
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

    getStatus(accountId) {
        const bot = this.bots.get(accountId);
        return bot ? bot.getStatus() : null;
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
        
        // Получаем часы для всех игр аккаунта
        const games = account.games ? account.games.split(' ').map(g => parseInt(g.trim())).filter(g => !isNaN(g)) : [730];
        const hoursData = {};
        
        for (const gameId of games.slice(0, 5)) { // Ограничиваем до 5 игр для производительности
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
        steamGuardPending: accountList.filter(acc => acc.needsSteamGuard).length
    };
}

// 🚀 Express настройки
app.use(express.json());
app.use(express.static('public'));

// 🌐 API Routes

// Главная страница
app.get('/', (req, res) => {
    res.send(generateDashboardHTML());
});

// Получение всех данных
app.get('/api/status', (req, res) => {
    // Обновляем данные фарма для всех аккаунтов
    Object.keys(accounts).forEach(accountId => {
        const botStatus = botManager.getStatus(accountId);
        if (botStatus) {
            accounts[accountId].farmStatus = botStatus.farmStatus;
            accounts[accountId].botStatus = botStatus.botStatus;
            accounts[accountId].farmedHours = botStatus.farmedHours;
            accounts[accountId].needsSteamGuard = botStatus.needsSteamGuard;
            accounts[accountId].steamGuardDomain = botStatus.steamGuardDomain;
            accounts[accountId].currentGames = botStatus.currentGames;
        }
    });
    
    saveAccounts(accounts);
    
    res.json({
        accounts: accounts,
        globalStats: updateGlobalStats(),
        serverTime: new Date()
    });
});

// Добавление нового аккаунта
app.post('/api/accounts/add', (req, res) => {
    const { username, password, displayName, steamId, games } = req.body;
    
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
        games: games || '730', // По умолчанию CS2
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        lastUpdate: null,
        needsSteamGuard: false,
        steamGuardDomain: null,
        currentGames: [],
        createdAt: new Date()
    };

    if (saveAccounts(accounts)) {
        console.log(`✅ Добавлен новый аккаунт: ${displayName} (${username})`);
        res.json({ success: true, message: 'Аккаунт добавлен', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения аккаунта' });
    }
});

// Удаление аккаунта (с авторизацией администратора)
app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { adminUsername, adminPassword } = req.body;
    
    // Проверка авторизации администратора
    if (adminUsername !== ADMIN_CONFIG.username || adminPassword !== ADMIN_CONFIG.password) {
        return res.status(401).json({ error: 'Неверные учетные данные администратора' });
    }
    
    if (accounts[accountId]) {
        const accountName = accounts[accountId].displayName;
        // Останавливаем фарм если запущен
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

// Запуск фарма для аккаунта
app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.startFarm(accountId)) {
        console.log(`🎮 Запущен фарм для аккаунта: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Остановка фарма для аккаунта
app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        console.log(`⏹️ Остановлен фарм для аккаунта: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Отправка Steam Guard кода
app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Код Steam Guard обязателен' });
    }
    
    if (botManager.submitSteamGuardCode(accountId, code)) {
        console.log(`🔐 Отправлен Steam Guard код для: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Код отправлен' });
    } else {
        res.status(400).json({ error: 'Не удалось отправить код Steam Guard' });
    }
});

// Обновление данных аккаунта
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
        <title>Steam Hour Booster - Панель управления</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            :root {
                --primary: #8B5CF6;
                --primary-dark: #7C3AED;
                --primary-light: #A78BFA;
                --secondary: #3B82F6;
                --secondary-dark: #1D4ED8;
                --accent: #60A5FA;
                --danger: #EF4444;
                --warning: #F59E0B;
                --background: #0F172A;
                --surface: rgba(30, 41, 59, 0.8);
                --surface-hover: rgba(51, 65, 85, 0.8);
                --text: #F8FAFC;
                --text-secondary: #94A3B8;
                --text-muted: #64748B;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --gradient-dark: linear-gradient(135deg, var(--primary-dark), var(--secondary-dark));
                --glass: rgba(255, 255, 255, 0.1);
                --glass-border: rgba(255, 255, 255, 0.2);
                --shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                --shadow-glow: 0 0 50px rgba(139, 92, 246, 0.2);
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: var(--background);
                color: var(--text);
                min-height: 100vh;
                overflow-x: hidden;
                line-height: 1.6;
            }
            
            .universe-bg {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -3;
                background: 
                    radial-gradient(circle at 10% 20%, rgba(139, 92, 246, 0.15) 0%, transparent 40%),
                    radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.15) 0%, transparent 40%);
            }
            
            .container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 40px 20px;
                position: relative;
            }
            
            .header {
                text-align: center;
                margin-bottom: 50px;
            }
            
            .header h1 {
                font-size: 3.5rem;
                font-weight: 900;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 15px;
                text-shadow: 0 10px 30px rgba(139, 92, 246, 0.3);
            }
            
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 25px;
                margin-bottom: 50px;
            }
            
            .stat-card {
                background: var(--surface);
                backdrop-filter: blur(20px);
                padding: 30px;
                border-radius: 20px;
                border: 1px solid var(--glass-border);
                text-align: center;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            
            .stat-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: var(--gradient);
            }
            
            .stat-card:hover {
                transform: translateY(-5px);
                box-shadow: var(--shadow), var(--shadow-glow);
            }
            
            .stat-value {
                font-size: 2.5rem;
                font-weight: 800;
                margin-bottom: 10px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .stat-label {
                color: var(--text-secondary);
                font-size: 1rem;
                font-weight: 600;
            }
            
            .actions-section {
                display: flex;
                gap: 20px;
                justify-content: center;
                margin-bottom: 40px;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 14px 24px;
                border: none;
                border-radius: 12px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.3s ease;
                font-family: inherit;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                font-size: 1rem;
                position: relative;
                overflow: hidden;
            }
            
            .btn-primary {
                background: var(--gradient);
                color: white;
                box-shadow: 0 8px 25px rgba(139, 92, 246, 0.3);
            }
            
            .btn-success {
                background: var(--secondary);
                color: white;
                box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
            }
            
            .btn-danger {
                background: var(--danger);
                color: white;
                box-shadow: 0 8px 25px rgba(239, 68, 68, 0.3);
            }
            
            .btn-warning {
                background: var(--warning);
                color: black;
                box-shadow: 0 8px 25px rgba(245, 158, 11, 0.3);
            }
            
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
            }
            
            .accounts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
                gap: 30px;
                margin-bottom: 40px;
            }
            
            .account-card {
                background: var(--surface);
                backdrop-filter: blur(20px);
                padding: 30px;
                border-radius: 20px;
                border: 1px solid var(--glass-border);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            
            .account-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: var(--gradient);
            }
            
            .account-card.steam-guard {
                border-color: var(--warning);
                box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
            }
            
            .account-card.steam-guard::before {
                background: var(--warning);
            }
            
            .account-card:hover {
                transform: translateY(-5px);
                box-shadow: var(--shadow), var(--shadow-glow);
            }
            
            .account-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
            }
            
            .account-name {
                font-size: 1.4rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .account-status {
                padding: 8px 16px;
                border-radius: 12px;
                font-size: 0.85rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .status-farming {
                background: rgba(96, 165, 250, 0.2);
                color: var(--accent);
                border: 1px solid var(--accent);
            }
            
            .status-steam_guard {
                background: rgba(245, 158, 11, 0.2);
                color: var(--warning);
                border: 1px solid var(--warning);
            }
            
            .status-stopped {
                background: rgba(148, 163, 184, 0.2);
                color: var(--text-secondary);
                border: 1px solid var(--text-secondary);
            }
            
            .account-details {
                margin-bottom: 25px;
            }
            
            .detail-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            
            .detail-label {
                color: var(--text-secondary);
                font-weight: 500;
                font-size: 0.9rem;
            }
            
            .detail-value {
                font-weight: 600;
                font-size: 0.95rem;
                text-align: right;
            }
            
            .games-list {
                background: rgba(0,0,0,0.2);
                padding: 10px;
                border-radius: 8px;
                margin-top: 10px;
                font-size: 0.85rem;
            }
            
            .account-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 15px;
            }
            
            .account-actions .btn {
                font-size: 0.9rem;
                padding: 10px 15px;
            }
            
            .delete-section {
                border-top: 1px solid rgba(255,255,255,0.1);
                padding-top: 15px;
            }
            
            .delete-btn {
                width: 100%;
                background: rgba(239, 68, 68, 0.1);
                color: var(--danger);
                border: 1px solid var(--danger);
            }
            
            .delete-btn:hover {
                background: var(--danger);
                color: white;
            }
            
            /* Модальные окна */
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(15, 23, 42, 0.9);
                z-index: 1000;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(10px);
            }
            
            .modal-content {
                background: var(--surface);
                backdrop-filter: blur(20px);
                padding: 40px;
                border-radius: 20px;
                border: 1px solid var(--glass-border);
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
            }
            
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
            }
            
            .modal-header h3 {
                font-size: 1.5rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .close-modal {
                background: none;
                border: none;
                color: var(--text);
                font-size: 1.5rem;
                cursor: pointer;
                padding: 5px;
                border-radius: 5px;
                transition: background 0.3s ease;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: var(--text-secondary);
                font-weight: 600;
            }
            
            .form-group input, .form-group textarea {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid var(--glass-border);
                border-radius: 10px;
                background: rgba(255,255,255,0.1);
                color: var(--text);
                font-size: 1rem;
                transition: all 0.3s ease;
                font-family: inherit;
            }
            
            .form-group textarea {
                resize: vertical;
                min-height: 80px;
            }
            
            .form-group input:focus, .form-group textarea:focus {
                outline: none;
                border-color: var(--primary);
                background: rgba(255,255,255,0.15);
                box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
            }
            
            .form-help {
                font-size: 0.85rem;
                color: var(--text-secondary);
                margin-top: 5px;
            }
            
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 12px;
                background: var(--surface);
                border: 1px solid var(--glass-border);
                backdrop-filter: blur(20px);
                transform: translateX(400px);
                transition: transform 0.3s ease;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 10px;
                max-width: 400px;
            }
            
            .notification.show {
                transform: translateX(0);
            }
            
            .notification.success {
                border-left: 4px solid var(--secondary);
            }
            
            .notification.error {
                border-left: 4px solid var(--danger);
            }
            
            .notification.warning {
                border-left: 4px solid var(--warning);
            }
            
            .steam-guard-section {
                background: rgba(245, 158, 11, 0.1);
                border: 1px solid var(--warning);
                border-radius: 10px;
                padding: 20px;
                margin-top: 20px;
            }
            
            .steam-guard-section h4 {
                color: var(--warning);
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            @media (max-width: 768px) {
                .container {
                    padding: 20px 15px;
                }
                
                .header h1 {
                    font-size: 2.5rem;
                }
                
                .accounts-grid {
                    grid-template-columns: 1fr;
                }
                
                .account-actions {
                    grid-template-columns: 1fr;
                }
                
                .actions-section {
                    flex-direction: column;
                    align-items: center;
                }
            }
        </style>
    </head>
    <body>
        <div class="universe-bg"></div>
        
        <div id="notification" class="notification"></div>
        
        <!-- Модальное окно добавления аккаунта -->
        <div id="addAccountModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-plus-circle"></i> Добавить аккаунт</h3>
                    <button class="close-modal" onclick="closeModal('addAccountModal')">&times;</button>
                </div>
                <form id="addAccountForm">
                    <div class="form-group">
                        <label for="username"><i class="fas fa-user"></i> Логин Steam *</label>
                        <input type="text" id="username" name="username" required placeholder="Введите логин Steam">
                    </div>
                    <div class="form-group">
                        <label for="password"><i class="fas fa-lock"></i> Пароль *</label>
                        <input type="password" id="password" name="password" required placeholder="Введите пароль">
                    </div>
                    <div class="form-group">
                        <label for="displayName"><i class="fas fa-tag"></i> Название на сайте *</label>
                        <input type="text" id="displayName" name="displayName" required placeholder="Придумайте название">
                    </div>
                    <div class="form-group">
                        <label for="steamId"><i class="fas fa-id-card"></i> Steam ID *</label>
                        <input type="text" id="steamId" name="steamId" required placeholder="Например: 76561198779509609">
                    </div>
                    <div class="form-group">
                        <label for="games"><i class="fas fa-gamepad"></i> ID игр для фарма</label>
                        <textarea id="games" name="games" placeholder="Введите ID игр через пробел (максимум 32 игры). Например: 730 570 440"></textarea>
                        <div class="form-help">По умолчанию: 730 (CS2). Оставьте пустым для использования значения по умолчанию.</div>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
                        <i class="fas fa-save"></i> Добавить аккаунт
                    </button>
                </form>
            </div>
        </div>
        
        <!-- Модальное окно Steam Guard -->
        <div id="steamGuardModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-shield-alt"></i> Steam Guard</h3>
                    <button class="close-modal" onclick="closeModal('steamGuardModal')">&times;</button>
                </div>
                <div id="steamGuardContent">
                    <!-- Контент будет заполнен динамически -->
                </div>
            </div>
        </div>
        
        <!-- Модальное окно удаления аккаунта -->
        <div id="deleteAccountModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-trash"></i> Удаление аккаунта</h3>
                    <button class="close-modal" onclick="closeModal('deleteAccountModal')">&times;</button>
                </div>
                <form id="deleteAccountForm">
                    <input type="hidden" id="deleteAccountId" name="accountId">
                    <div class="form-group">
                        <label for="adminUsername"><i class="fas fa-user-shield"></i> Логин администратора *</label>
                        <input type="text" id="adminUsername" name="adminUsername" required placeholder="Введите логин администратора">
                    </div>
                    <div class="form-group">
                        <label for="adminPassword"><i class="fas fa-lock"></i> Пароль администратора *</label>
                        <input type="password" id="adminPassword" name="adminPassword" required placeholder="Введите пароль администратора">
                    </div>
                    <div class="form-group">
                        <p style="color: var(--text-secondary); font-size: 0.9rem;">
                            <i class="fas fa-exclamation-triangle"></i> Это действие невозможно отменить. Аккаунт будет полностью удален из системы.
                        </p>
                    </div>
                    <button type="submit" class="btn btn-danger" style="width: 100%;">
                        <i class="fas fa-trash"></i> Подтвердить удаление
                    </button>
                </form>
            </div>
        </div>
        
        <div class="container">
            <div class="header">
                <h1><i class="fas fa-robot"></i> Steam Hour Booster</h1>
                <p style="color: var(--text-secondary);">Автоматический фарм часов в Steam играх 24/7</p>
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
                    <div class="stat-value" id="total-farmed">${globalStats.totalFarmedHours}</div>
                    <div class="stat-label">Накручено часов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="steam-guard-pending">${globalStats.steamGuardPending}</div>
                    <div class="stat-label">Ожидают Steam Guard</div>
                </div>
            </div>
            
            <div class="actions-section">
                <button class="btn btn-primary" onclick="showModal('addAccountModal')">
                    <i class="fas fa-plus"></i> Добавить аккаунт
                </button>
                <button class="btn btn-success" onclick="updateAllAccounts()">
                    <i class="fas fa-sync-alt"></i> Обновить все данные
                </button>
            </div>
            
            <div class="accounts-grid" id="accounts-container">
                ${accountList.length > 0 ? accountList.map(account => `
                    <div class="account-card ${account.needsSteamGuard ? 'steam-guard' : ''}" data-account-id="${account.id}">
                        <div class="account-header">
                            <div class="account-name">${account.displayName}</div>
                            <div class="account-status status-${account.botStatus}">
                                ${account.botStatus === 'running' ? 'Фармит' : 
                                  account.botStatus === 'steam_guard' ? 'Steam Guard' :
                                  account.botStatus === 'online' ? 'Онлайн' :
                                  account.botStatus === 'error' ? 'Ошибка' : 'Оффлайн'}
                            </div>
                        </div>
                        
                        <div class="account-details">
                            <div class="detail-row">
                                <span class="detail-label">Steam ID:</span>
                                <span class="detail-value">${account.steamId}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Логин:</span>
                                <span class="detail-value">${account.username}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Игры для фарма:</span>
                                <span class="detail-value">${account.games || '730'}</span>
                            </div>
                            ${account.currentGames && account.currentGames.length > 0 ? `
                            <div class="detail-row">
                                <span class="detail-label">Сейчас фармит:</span>
                                <span class="detail-value">${account.currentGames.join(', ')}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">Накручено часов:</span>
                                <span class="detail-value">${account.farmedHours || '0.0'}</span>
                            </div>
                            ${account.lastUpdate ? `
                            <div class="detail-row">
                                <span class="detail-label">Обновлено:</span>
                                <span class="detail-value">${new Date(account.lastUpdate).toLocaleString('ru-RU')}</span>
                            </div>
                            ` : ''}
                        </div>
                        
                        ${account.needsSteamGuard ? `
                        <div class="steam-guard-section">
                            <h4><i class="fas fa-shield-alt"></i> Требуется Steam Guard</h4>
                            <p style="margin-bottom: 15px; font-size: 0.9rem;">${account.steamGuardDomain ? `Код отправлен на: ${account.steamGuardDomain}` : 'Проверьте почту или мобильное приложение'}</p>
                            <button class="btn btn-warning" onclick="showSteamGuardModal('${account.id}', '${account.displayName}')" style="width: 100%;">
                                <i class="fas fa-key"></i> Ввести код Steam Guard
                            </button>
                        </div>
                        ` : ''}
                        
                        <div class="account-actions">
                            ${account.farmStatus === 'running' ? `
                                <button class="btn btn-danger" onclick="stopFarm('${account.id}')">
                                    <i class="fas fa-stop"></i> Стоп
                                </button>
                            ` : `
                                <button class="btn btn-success" onclick="startFarm('${account.id}')">
                                    <i class="fas fa-play"></i> Старт
                                </button>
                            `}
                            <button class="btn btn-primary" onclick="updateAccount('${account.id}')">
                                <i class="fas fa-sync-alt"></i> Обновить
                            </button>
                        </div>
                        
                        <div class="delete-section">
                            <button class="btn delete-btn" onclick="showDeleteModal('${account.id}', '${account.displayName}')">
                                <i class="fas fa-trash"></i> Удалить аккаунт
                            </button>
                        </div>
                    </div>
                `).join('') : `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                        <i class="fas fa-inbox" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;"></i>
                        <h3 style="margin-bottom: 10px;">Нет добавленных аккаунтов</h3>
                        <p>Добавьте первый аккаунт для начала фарма часов</p>
                    </div>
                `}
            </div>
        </div>

        <script>
            class Dashboard {
                constructor() {
                    this.isLoading = false;
                    this.init();
                }
                
                init() {
                    this.loadData();
                    setInterval(() => this.loadData(), 10000);
                }
                
                async loadData() {
                    if (this.isLoading) return;
                    
                    this.isLoading = true;
                    
                    try {
                        const response = await fetch('/api/status');
                        const data = await response.json();
                        this.updateUI(data);
                    } catch (error) {
                        console.error('Ошибка загрузки данных:', error);
                        this.showNotification('Ошибка загрузки данных', 'error');
                    } finally {
                        this.isLoading = false;
                    }
                }
                
                updateUI(data) {
                    document.getElementById('total-accounts').textContent = data.globalStats.totalAccounts;
                    document.getElementById('active-farms').textContent = data.globalStats.activeFarms;
                    document.getElementById('total-farmed').textContent = data.globalStats.totalFarmedHours;
                    document.getElementById('steam-guard-pending').textContent = data.globalStats.steamGuardPending;
                    
                    this.renderAccounts(data.accounts);
                }
                
                renderAccounts(accounts) {
                    const accountsArray = Object.values(accounts);
                    const container = document.getElementById('accounts-container');
                    
                    if (accountsArray.length > 0) {
                        container.innerHTML = accountsArray.map(account => \`
                            <div class="account-card \${account.needsSteamGuard ? 'steam-guard' : ''}" data-account-id="\${account.id}">
                                <div class="account-header">
                                    <div class="account-name">\${account.displayName}</div>
                                    <div class="account-status status-\${account.botStatus}">
                                        \${account.botStatus === 'running' ? 'Фармит' : 
                                          account.botStatus === 'steam_guard' ? 'Steam Guard' :
                                          account.botStatus === 'online' ? 'Онлайн' :
                                          account.botStatus === 'error' ? 'Ошибка' : 'Оффлайн'}
                                    </div>
                                </div>
                                
                                <div class="account-details">
                                    <div class="detail-row">
                                        <span class="detail-label">Steam ID:</span>
                                        <span class="detail-value">\${account.steamId}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span class="detail-label">Логин:</span>
                                        <span class="detail-value">\${account.username}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span class="detail-label">Игры для фарма:</span>
                                        <span class="detail-value">\${account.games || '730'}</span>
                                    </div>
                                    \${account.currentGames && account.currentGames.length > 0 ? \`
                                    <div class="detail-row">
                                        <span class="detail-label">Сейчас фармит:</span>
                                        <span class="detail-value">\${account.currentGames.join(', ')}</span>
                                    </div>
                                    \` : ''}
                                    <div class="detail-row">
                                        <span class="detail-label">Накручено часов:</span>
                                        <span class="detail-value">\${account.farmedHours || '0.0'}</span>
                                    </div>
                                    \${account.lastUpdate ? \`
                                    <div class="detail-row">
                                        <span class="detail-label">Обновлено:</span>
                                        <span class="detail-value">\${new Date(account.lastUpdate).toLocaleString('ru-RU')}</span>
                                    </div>
                                    \` : ''}
                                </div>
                                
                                \${account.needsSteamGuard ? \`
                                <div class="steam-guard-section">
                                    <h4><i class="fas fa-shield-alt"></i> Требуется Steam Guard</h4>
                                    <p style="margin-bottom: 15px; font-size: 0.9rem;">\${account.steamGuardDomain ? \`Код отправлен на: \${account.steamGuardDomain}\` : 'Проверьте почту или мобильное приложение'}</p>
                                    <button class="btn btn-warning" onclick="showSteamGuardModal('\${account.id}', '\${account.displayName}')" style="width: 100%;">
                                        <i class="fas fa-key"></i> Ввести код Steam Guard
                                    </button>
                                </div>
                                \` : ''}
                                
                                <div class="account-actions">
                                    \${account.farmStatus === 'running' ? \`
                                        <button class="btn btn-danger" onclick="stopFarm('\${account.id}')">
                                            <i class="fas fa-stop"></i> Стоп
                                        </button>
                                    \` : \`
                                        <button class="btn btn-success" onclick="startFarm('\${account.id}')">
                                            <i class="fas fa-play"></i> Старт
                                        </button>
                                    \`}
                                    <button class="btn btn-primary" onclick="updateAccount('\${account.id}')">
                                        <i class="fas fa-sync-alt"></i> Обновить
                                    </button>
                                </div>
                                
                                <div class="delete-section">
                                    <button class="btn delete-btn" onclick="showDeleteModal('\${account.id}', '\${account.displayName}')">
                                        <i class="fas fa-trash"></i> Удалить аккаунт
                                    </button>
                                </div>
                            </div>
                        \`).join('');
                    } else {
                        container.innerHTML = \`
                            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                                <i class="fas fa-inbox" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;"></i>
                                <h3 style="margin-bottom: 10px;">Нет добавленных аккаунтов</h3>
                                <p>Добавьте первый аккаунт для начала фарма часов</p>
                            </div>
                        \`;
                    }
                }
                
                showNotification(message, type = 'info') {
                    const notification = document.getElementById('notification');
                    notification.textContent = message;
                    notification.className = \`notification \${type} show\`;
                    
                    setTimeout(() => {
                        notification.classList.remove('show');
                    }, 4000);
                }
            }

            // Функции модальных окон
            function showModal(modalId) {
                document.getElementById(modalId).style.display = 'flex';
            }
            
            function closeModal(modalId) {
                document.getElementById(modalId).style.display = 'none';
                if (modalId === 'addAccountModal') {
                    document.getElementById('addAccountForm').reset();
                }
            }
            
            function showSteamGuardModal(accountId, accountName) {
                document.getElementById('steamGuardContent').innerHTML = \`
                    <div class="form-group">
                        <label for="steamGuardCode"><i class="fas fa-key"></i> Код Steam Guard для \${accountName}</label>
                        <input type="text" id="steamGuardCode" name="code" required placeholder="Введите код из письма или приложения" maxlength="5">
                        <div class="form-help">Код отправлен на вашу почту или мобильное приложение Steam</div>
                    </div>
                    <button type="button" class="btn btn-warning" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                        <i class="fas fa-shield-alt"></i> Подтвердить код
                    </button>
                \`;
                showModal('steamGuardModal');
            }
            
            function showDeleteModal(accountId, accountName) {
                document.getElementById('deleteAccountId').value = accountId;
                document.getElementById('deleteAccountForm').reset();
                showModal('deleteAccountModal');
            }
            
            // Добавление аккаунта
            document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch('/api/accounts/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Аккаунт успешно добавлен', 'success');
                        closeModal('addAccountModal');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка добавления аккаунта', 'error');
                }
            });
            
            // Удаление аккаунта
            document.getElementById('deleteAccountForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch(\`/api/accounts/delete/\${data.accountId}\`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            adminUsername: data.adminUsername,
                            adminPassword: data.adminPassword
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Аккаунт успешно удален', 'success');
                        closeModal('deleteAccountModal');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка удаления аккаунта', 'error');
                }
            });
            
            // Глобальные функции
            async function startFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, { method: 'POST' });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Фарм запущен успешно', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка запуска фарма', 'error');
                }
            }
            
            async function stopFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, { method: 'POST' });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Фарм остановлен', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка остановки фарма', 'error');
                }
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
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Код Steam Guard отправлен', 'success');
                        closeModal('steamGuardModal');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка отправки кода', 'error');
                }
            }
            
            async function updateAccount(accountId) {
                try {
                    const response = await fetch(\`/api/update/\${accountId}\`, { method: 'POST' });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Данные обновлены', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка обновления аккаунта', 'error');
                }
            }
            
            async function updateAllAccounts() {
                try {
                    const accounts = Object.values(dashboard.accounts || {});
                    for (const account of accounts) {
                        await fetch(\`/api/update/\${account.id}\`, { method: 'POST' });
                    }
                    dashboard.showNotification('Все данные обновлены', 'success');
                    await dashboard.loadData();
                } catch (error) {
                    dashboard.showNotification('Ошибка обновления всех данных', 'error');
                }
            }
            
            // Инициализация
            const dashboard = new Dashboard();
            
            // Закрытие модальных окон при клике вне их
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.style.display = 'none';
                    }
                });
            });
        </script>
    </body>
    </html>
  `;
}

// 🚀 Инициализация приложения
console.log('🚀 Запуск Steam Hour Booster...');
console.log(`📊 Загружено аккаунтов: ${Object.keys(accounts).length}`);
console.log(`🔐 Данные администратора: ${ADMIN_CONFIG.username}:${ADMIN_CONFIG.password}`);

// Авто-обновление данных каждые 5 минут
setInterval(() => {
    Object.keys(accounts).forEach(accountId => {
        updateAccountData(accountId);
    });
}, 300000);

// Обработка graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Остановка приложения...');
    Object.keys(accounts).forEach(accountId => {
        botManager.stopFarm(accountId);
    });
    process.exit(0);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT} для доступа к панели управления`);
});
