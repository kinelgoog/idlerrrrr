const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Конфигурация
const CONFIG = {
    UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL) || 30000,
    GAMES: [730] // CS2
};

// 🗄️ Хранение данных в файле (для простоты)
const DATA_FILE = './accounts.json';

// 🎯 Загрузка аккаунтов из файла
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

// 🎯 Сохранение аккаунтов в файл
function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов:', error.message);
        return false;
    }
}

// 🎯 Инициализация состояния
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

    reset() {
        this.startTime = null;
        this.totalAccumulated = 0;
    }
}

// 🤖 Steam Bot
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
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Бот ${this.config.displayName} успешно вошел в систему`);
            this.reconnectAttempts = 0;
            
            this.client.setPersona(1);
            this.client.gamesPlayed(CONFIG.GAMES, true);
            
            console.log(`🎮 Запускаю фарм для ${this.config.displayName}...`);
            this.farmTracker.start();
            this.isRunning = true;
            
            // Обновляем состояние
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'running';
                accounts[this.config.id].botStatus = 'online';
                accounts[this.config.id].farmStartTime = new Date();
                saveAccounts(accounts);
            }
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка бота ${this.config.displayName}:`, err);
            this.isRunning = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
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
                this.client.gamesPlayed(CONFIG.GAMES, true);
            }
        }, 300000);
    }

    startFarming() {
        if (this.isRunning) return;

        console.log(`🚀 Запуск бота для ${this.config.username}...`);
        
        const logOnOptions = {
            accountName: this.config.username,
            password: this.config.password,
            rememberPassword: true
        };

        if (this.config.sharedSecret) {
            logOnOptions.twoFactorCode = steamTotp.generateAuthCode(this.config.sharedSecret);
        }

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 Останавливаю фарм для ${this.config.username}...`);
            this.client.logOff();
            this.isRunning = false;
            this.farmTracker.stop();
            this.reconnectAttempts = 0;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].botStatus = 'offline';
                saveAccounts(accounts);
            }
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            farmStatus: this.isRunning ? 'running' : 'stopped',
            farmedHours: this.farmTracker.getCurrentHours(),
            botStatus: accounts[this.config.id]?.botStatus || 'offline',
            reconnectAttempts: this.reconnectAttempts
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

    getStatus(accountId) {
        const bot = this.bots.get(accountId);
        return bot ? bot.getStatus() : null;
    }

    getAllStatuses() {
        const statuses = {};
        this.bots.forEach((bot, accountId) => {
            statuses[accountId] = bot.getStatus();
        });
        return statuses;
    }
}

const botManager = new BotManager();

// 🔍 Класс для получения данных Steam
class SteamDataFetcher {
    static async fetchCS2Hours(steamId) {
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
                    const cs2Game = gamesData.find(game => game.appid === 730);
                    
                    if (cs2Game && cs2Game.hours_forever) {
                        return parseFloat(cs2Game.hours_forever).toFixed(1);
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
        const hours = await SteamDataFetcher.fetchCS2Hours(account.steamId);
        
        account.cs2Hours = hours;
        account.lastUpdate = new Date();
        account.isLoading = false;
        
        saveAccounts(accounts);
        console.log(`✅ Данные обновлены для ${account.displayName}: ${hours} часов`);
        
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
        totalHours: accountList.reduce((sum, acc) => sum + parseFloat(acc.cs2Hours || 0), 0).toFixed(1),
        totalFarmedHours: accountList.reduce((sum, acc) => sum + parseFloat(acc.farmedHours || 0), 0).toFixed(1)
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
    const { username, password, displayName, steamId, sharedSecret } = req.body;
    
    if (!username || !password || !displayName || !steamId) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }

    const accountId = 'acc_' + Date.now();
    
    accounts[accountId] = {
        id: accountId,
        username,
        password,
        displayName,
        steamId,
        sharedSecret: sharedSecret || '',
        cs2Hours: '0.0',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        lastUpdate: null,
        createdAt: new Date()
    };

    if (saveAccounts(accounts)) {
        res.json({ success: true, message: 'Аккаунт добавлен', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения аккаунта' });
    }
});

// Удаление аккаунта
app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (accounts[accountId]) {
        // Останавливаем фарм если запущен
        botManager.stopFarm(accountId);
        delete accounts[accountId];
        
        if (saveAccounts(accounts)) {
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
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Остановка фарма для аккаунта
app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Обновление данных аккаунта
app.post('/api/update/:accountId', async (req, res) => {
    const { accountId } = req.params;
    await updateAccountData(accountId);
    res.json({ success: true, message: 'Данные обновлены' });
});

// 🎨 Генерация HTML с фиолетово-синей темой
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
                    radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.15) 0%, transparent 40%),
                    radial-gradient(circle at 50% 50%, rgba(96, 165, 250, 0.1) 0%, transparent 50%);
            }
            
            .stars {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -2;
                background-image: 
                    radial-gradient(2px 2px at 20px 30px, #A78BFA, transparent),
                    radial-gradient(2px 2px at 40px 70px, #60A5FA, transparent),
                    radial-gradient(1px 1px at 90px 40px, #3B82F6, transparent),
                    radial-gradient(1px 1px at 130px 80px, #7C3AED, transparent);
                background-repeat: repeat;
                background-size: 200px 100px;
                animation: starsMove 100s linear infinite;
            }
            
            .nebula {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -1;
                opacity: 0.3;
                background: 
                    radial-gradient(circle at 30% 40%, rgba(139, 92, 246, 0.3) 0%, transparent 50%),
                    radial-gradient(circle at 70% 60%, rgba(59, 130, 246, 0.2) 0%, transparent 50%);
                filter: blur(40px);
                animation: nebulaFloat 20s ease-in-out infinite alternate;
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
            
            .header p {
                font-size: 1.3rem;
                color: var(--text-secondary);
                max-width: 600px;
                margin: 0 auto;
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
            
            .btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.6s ease;
            }
            
            .btn:hover::before {
                left: 100%;
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
            
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
            }
            
            .accounts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
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
            
            .status-stopped {
                background: rgba(148, 163, 184, 0.2);
                color: var(--text-secondary);
                border: 1px solid var(--text-secondary);
            }
            
            .status-online {
                background: rgba(59, 130, 246, 0.2);
                color: var(--secondary);
                border: 1px solid var(--secondary);
            }
            
            .status-error {
                background: rgba(239, 68, 68, 0.2);
                color: var(--danger);
                border: 1px solid var(--danger);
            }
            
            .account-details {
                margin-bottom: 25px;
            }
            
            .detail-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                padding: 10px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            
            .detail-label {
                color: var(--text-secondary);
                font-weight: 500;
            }
            
            .detail-value {
                font-weight: 600;
                font-size: 1.1rem;
            }
            
            .hours-value {
                font-size: 1.3rem;
                font-weight: 800;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .account-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            
            .account-actions .btn {
                font-size: 0.9rem;
                padding: 12px 16px;
            }
            
            .last-update {
                text-align: center;
                color: var(--text-secondary);
                margin-top: 30px;
                font-size: 0.9rem;
            }
            
            /* Модальное окно */
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
            
            .close-modal:hover {
                background: var(--surface-hover);
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
            
            .form-group input {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid var(--glass-border);
                border-radius: 10px;
                background: rgba(255,255,255,0.1);
                color: var(--text);
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            
            .form-group input:focus {
                outline: none;
                border-color: var(--primary);
                background: rgba(255,255,255,0.15);
                box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
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
            
            .loading-spinner {
                width: 20px;
                height: 20px;
                border: 2px solid transparent;
                border-top: 2px solid currentColor;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes starsMove {
                0% { transform: translateY(0); }
                100% { transform: translateY(-100px); }
            }
            
            @keyframes nebulaFloat {
                0% { transform: scale(1) rotate(0deg); }
                100% { transform: scale(1.1) rotate(1deg); }
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
            }
            
            .floating {
                animation: float 6s ease-in-out infinite;
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
                
                .stats-grid {
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                }
            }
        </style>
    </head>
    <body>
        <div class="universe-bg"></div>
        <div class="stars"></div>
        <div class="nebula"></div>
        
        <div id="notification" class="notification"></div>
        
        <!-- Модальное окно добавления аккаунта -->
        <div id="addAccountModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-plus-circle"></i> Добавить аккаунт</h3>
                    <button class="close-modal" onclick="closeAddAccountModal()">&times;</button>
                </div>
                <form id="addAccountForm">
                    <div class="form-group">
                        <label for="username"><i class="fas fa-user"></i> Логин Steam</label>
                        <input type="text" id="username" name="username" required placeholder="Введите логин Steam">
                    </div>
                    <div class="form-group">
                        <label for="password"><i class="fas fa-lock"></i> Пароль</label>
                        <input type="password" id="password" name="password" required placeholder="Введите пароль">
                    </div>
                    <div class="form-group">
                        <label for="displayName"><i class="fas fa-tag"></i> Название на сайте</label>
                        <input type="text" id="displayName" name="displayName" required placeholder="Придумайте название">
                    </div>
                    <div class="form-group">
                        <label for="steamId"><i class="fas fa-id-card"></i> Steam ID</label>
                        <input type="text" id="steamId" name="steamId" required placeholder="Например: 76561198779509609">
                    </div>
                    <div class="form-group">
                        <label for="sharedSecret"><i class="fas fa-shield-alt"></i> Shared Secret (опционально)</label>
                        <input type="text" id="sharedSecret" name="sharedSecret" placeholder="Для двухфакторной аутентификации">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
                        <i class="fas fa-save"></i> Добавить аккаунт
                    </button>
                </form>
            </div>
        </div>
        
        <div class="container">
            <div class="header floating">
                <h1><i class="fas fa-robot"></i> Steam Hour Booster</h1>
                <p>Автоматический фарм часов в Steam играх 24/7</p>
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
                    <div class="stat-value" id="total-hours">${globalStats.totalHours}</div>
                    <div class="stat-label">Всего часов в CS2</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="total-farmed">${globalStats.totalFarmedHours}</div>
                    <div class="stat-label">Накручено часов</div>
                </div>
            </div>
            
            <div class="actions-section">
                <button class="btn btn-primary" onclick="showAddAccountModal()">
                    <i class="fas fa-plus"></i> Добавить аккаунт
                </button>
                <button class="btn btn-success" onclick="updateAllAccounts()">
                    <i class="fas fa-sync-alt"></i> Обновить все данные
                </button>
            </div>
            
            <div class="accounts-grid" id="accounts-container">
                ${accountList.length > 0 ? accountList.map(account => `
                    <div class="account-card" data-account-id="${account.id}">
                        <div class="account-header">
                            <div class="account-name">${account.displayName}</div>
                            <div class="account-status status-${account.farmStatus}">
                                ${account.farmStatus === 'running' ? 'Фармит' : 
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
                                <span class="detail-label">Часы в CS2:</span>
                                <span class="detail-value hours-value">${account.cs2Hours}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Накручено часов:</span>
                                <span class="detail-value">${account.farmedHours || '0.0'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Статус бота:</span>
                                <span class="detail-value">${account.botStatus}</span>
                            </div>
                            ${account.lastUpdate ? `
                            <div class="detail-row">
                                <span class="detail-label">Обновлено:</span>
                                <span class="detail-value">${new Date(account.lastUpdate).toLocaleString('ru-RU')}</span>
                            </div>
                            ` : ''}
                        </div>
                        
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
                    </div>
                `).join('') : `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                        <i class="fas fa-inbox" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;"></i>
                        <h3 style="margin-bottom: 10px;">Нет добавленных аккаунтов</h3>
                        <p>Добавьте первый аккаунт для начала фарма часов</p>
                    </div>
                `}
            </div>
            
            <div class="last-update" id="last-update">
                Серверное время: ${new Date().toLocaleString('ru-RU')}
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
                    // Обновляем данные каждые 10 секунд
                    setInterval(() => this.loadData(), 10000);
                    // Обновляем время каждую секунду
                    setInterval(() => this.updateServerTime(), 1000);
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
                    // Обновляем статистику
                    document.getElementById('total-accounts').textContent = data.globalStats.totalAccounts;
                    document.getElementById('active-farms').textContent = data.globalStats.activeFarms;
                    document.getElementById('total-hours').textContent = data.globalStats.totalHours;
                    document.getElementById('total-farmed').textContent = data.globalStats.totalFarmedHours;
                    
                    // Обновляем аккаунты
                    const accounts = Object.values(data.accounts);
                    const container = document.getElementById('accounts-container');
                    
                    if (accounts.length > 0) {
                        container.innerHTML = accounts.map(account => \`
                            <div class="account-card" data-account-id="\${account.id}">
                                <div class="account-header">
                                    <div class="account-name">\${account.displayName}</div>
                                    <div class="account-status status-\${account.farmStatus}">
                                        \${account.farmStatus === 'running' ? 'Фармит' : 
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
                                        <span class="detail-label">Часы в CS2:</span>
                                        <span class="detail-value hours-value">\${account.cs2Hours}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span class="detail-label">Накручено часов:</span>
                                        <span class="detail-value">\${account.farmedHours || '0.0'}</span>
                                    </div>
                                    <div class="detail-row">
                                        <span class="detail-label">Статус бота:</span>
                                        <span class="detail-value">\${account.botStatus}</span>
                                    </div>
                                    \${account.lastUpdate ? \`
                                    <div class="detail-row">
                                        <span class="detail-label">Обновлено:</span>
                                        <span class="detail-value">\${new Date(account.lastUpdate).toLocaleString('ru-RU')}</span>
                                    </div>
                                    \` : ''}
                                </div>
                                
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
                
                updateServerTime() {
                    document.getElementById('last-update').textContent = 
                        'Серверное время: ' + new Date().toLocaleString('ru-RU');
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
            
            // Функции модального окна
            function showAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'flex';
            }
            
            function closeAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'none';
                document.getElementById('addAccountForm').reset();
            }
            
            // Добавление аккаунта
            document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch('/api/accounts/add', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Аккаунт успешно добавлен', 'success');
                        closeAddAccountModal();
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка добавления аккаунта:', error);
                    dashboard.showNotification('Ошибка добавления аккаунта', 'error');
                }
            });
            
            // Глобальные функции
            async function startFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, {
                        method: 'POST'
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Фарм запущен успешно', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка запуска фарма:', error);
                    dashboard.showNotification('Ошибка запуска фарма', 'error');
                }
            }
            
            async function stopFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, {
                        method: 'POST'
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Фарм остановлен', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка остановки фарма:', error);
                    dashboard.showNotification('Ошибка остановки фарма', 'error');
                }
            }
            
            async function updateAccount(accountId) {
                try {
                    const response = await fetch(\`/api/update/\${accountId}\`, {
                        method: 'POST'
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Данные обновлены', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка обновления аккаунта:', error);
                    dashboard.showNotification('Ошибка обновления аккаунта', 'error');
                }
            }
            
            async function updateAllAccounts() {
                try {
                    const promises = Object.keys(dashboard.accounts || {}).map(accountId => 
                        fetch(\`/api/update/\${accountId}\`, { method: 'POST' })
                    );
                    await Promise.all(promises);
                    dashboard.showNotification('Все данные обновлены', 'success');
                    await dashboard.loadData();
                } catch (error) {
                    console.error('Ошибка обновления всех данных:', error);
                    dashboard.showNotification('Ошибка обновления всех данных', 'error');
                }
            }
            
            // Инициализация
            const dashboard = new Dashboard();
            
            // Закрытие модального окна при клике вне его
            document.getElementById('addAccountModal').addEventListener('click', (e) => {
                if (e.target.id === 'addAccountModal') {
                    closeAddAccountModal();
                }
            });
        </script>
    </body>
    </html>
  `;
}

// 🚀 Инициализация приложения
console.log('🚀 Запуск Steam Hour Booster...');
console.log(`📊 Загружено аккаунтов: ${Object.keys(accounts).length}`);

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
