const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Конфигурация (можно менять через переменные окружения)
const CONFIG = {
    STEAM_ACCOUNTS: [
        {
            username: process.env.STEAM_USERNAME || 'tochka_bi_laik',
            password: process.env.STEAM_PASSWORD || 'JenyaKinel2023steam',
            sharedSecret: process.env.STEAM_SHARED_SECRET || '',
            steamId: process.env.STEAM_ID || '76561198779509609',
            profileName: process.env.PROFILE_NAME || 'точка'
        }
    ],
    UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL) || 30000,
    GAMES: [730] // CS2
};

// 🎯 Состояние системы
const state = {
    accounts: {},
    globalStats: {
        totalAccounts: 0,
        activeFarms: 0,
        totalHours: '0.0',
        totalFarmedHours: '0.0'
    }
};

// Инициализация состояния для каждого аккаунта
CONFIG.STEAM_ACCOUNTS.forEach(account => {
    state.accounts[account.steamId] = {
        ...account,
        cs2Hours: '0.0',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        lastUpdate: null,
        isLoading: false,
        error: null,
        farmStartTime: null
    };
});

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

// 🤖 Улучшенный Steam Bot
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new steamUser({
            enablePicsCache: true,
            autoRelogin: true,
            dataDirectory: './steamdata'
        });
        this.isRunning = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.farmTracker = new FarmTimeTracker();
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Steam Bot ${this.config.steamId} успешно вошел в систему`);
            this.reconnectAttempts = 0;
            
            this.client.setPersona(1);
            this.client.gamesPlayed(CONFIG.GAMES, true);
            
            console.log(`🎮 Запускаю фарм часов для ${this.config.steamId}...`);
            this.farmTracker.start();
            this.isRunning = true;
            
            // Обновляем состояние
            state.accounts[this.config.steamId].farmStatus = 'running';
            state.accounts[this.config.steamId].botStatus = 'online';
            state.accounts[this.config.steamId].farmStartTime = new Date();
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка Steam Bot ${this.config.steamId}:`, err);
            this.isRunning = false;
            
            state.accounts[this.config.steamId].botStatus = 'error';
            state.accounts[this.config.steamId].farmStatus = 'stopped';
            this.farmTracker.stop();

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                setTimeout(() => this.startFarming(), 15000);
            }
        });

        this.client.on('disconnected', (eresult, msg) => {
            console.log(`🔌 Steam Bot ${this.config.steamId} отключен:`, eresult, msg);
            this.farmTracker.stop();
            this.isRunning = false;
            
            state.accounts[this.config.steamId].botStatus = 'offline';
            state.accounts[this.config.steamId].farmStatus = 'stopped';

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

        console.log(`🚀 Запуск Steam Bot для ${this.config.username}...`);
        
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
            
            state.accounts[this.config.steamId].farmStatus = 'stopped';
            state.accounts[this.config.steamId].botStatus = 'offline';
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            farmStatus: this.isRunning ? 'running' : 'stopped',
            farmedHours: this.farmTracker.getCurrentHours(),
            botStatus: state.accounts[this.config.steamId].botStatus,
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
        CONFIG.STEAM_ACCOUNTS.forEach(account => {
            const bot = new SteamFarmBot(account);
            this.bots.set(account.steamId, bot);
        });
    }

    startFarm(steamId) {
        const bot = this.bots.get(steamId);
        if (bot) {
            bot.startFarming();
            return true;
        }
        return false;
    }

    stopFarm(steamId) {
        const bot = this.bots.get(steamId);
        if (bot) {
            bot.stopFarming();
            return true;
        }
        return false;
    }

    stopAllFarms() {
        this.bots.forEach(bot => {
            bot.stopFarming();
        });
    }

    getStatus(steamId) {
        const bot = this.bots.get(steamId);
        return bot ? bot.getStatus() : null;
    }

    getAllStatuses() {
        const statuses = {};
        this.bots.forEach((bot, steamId) => {
            statuses[steamId] = bot.getStatus();
        });
        return statuses;
    }
}

const botManager = new BotManager();

// 🔍 Улучшенный класс для получения данных Steam
class SteamDataFetcher {
    static async fetchCS2Hours(steamId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

            // Альтернативный поиск
            const regexPatterns = [
                /"appid":730[^}]*"playtime_forever":(\d+)/,
                /Counter-Strike 2[^>]*>([\d,\.]+)\s*hrs/,
                /"730"[^}]*"hours_forever":"([^"]+)"/
            ];

            for (const pattern of regexPatterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    const hours = parseFloat(match[1].replace(',', ''));
                    if (!isNaN(hours)) {
                        return hours.toFixed(1);
                    }
                }
            }

            return '0.0';
        } catch (error) {
            console.log('Ошибка получения данных Steam:', error.message);
            return '0.0';
        }
    }
}

// 🔄 Обновление данных аккаунтов
async function updateAccountData(steamId) {
    const account = state.accounts[steamId];
    if (!account) return;

    try {
        account.isLoading = true;
        account.error = null;
        
        console.log(`🔄 Обновление данных для ${steamId}...`);
        const hours = await SteamDataFetcher.fetchCS2Hours(steamId);
        
        account.cs2Hours = hours;
        account.lastUpdate = new Date();
        account.isLoading = false;
        
        console.log(`✅ Данные обновлены для ${steamId}: ${hours} часов`);
        
    } catch (error) {
        account.error = error.message;
        account.isLoading = false;
        console.log(`❌ Ошибка обновления для ${steamId}: ${error.message}`);
    }
}

async function updateAllAccountsData() {
    const promises = Object.keys(state.accounts).map(steamId => 
        updateAccountData(steamId)
    );
    await Promise.all(promises);
    updateGlobalStats();
}

// 📊 Обновление глобальной статистики
function updateGlobalStats() {
    const accounts = Object.values(state.accounts);
    state.globalStats.totalAccounts = accounts.length;
    state.globalStats.activeFarms = accounts.filter(acc => acc.farmStatus === 'running').length;
    
    const totalHours = accounts.reduce((sum, acc) => sum + parseFloat(acc.cs2Hours || 0), 0);
    const totalFarmed = accounts.reduce((sum, acc) => sum + parseFloat(acc.farmedHours || 0), 0);
    
    state.globalStats.totalHours = totalHours.toFixed(1);
    state.globalStats.totalFarmedHours = totalFarmed.toFixed(1);
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
    Object.keys(state.accounts).forEach(steamId => {
        const botStatus = botManager.getStatus(steamId);
        if (botStatus) {
            state.accounts[steamId].farmStatus = botStatus.farmStatus;
            state.accounts[steamId].botStatus = botStatus.botStatus;
            state.accounts[steamId].farmedHours = botStatus.farmedHours;
        }
    });
    
    updateGlobalStats();
    
    res.json({
        accounts: state.accounts,
        globalStats: state.globalStats,
        serverTime: new Date()
    });
});

// Запуск фарма для аккаунта
app.post('/api/farm/start/:steamId', (req, res) => {
    const { steamId } = req.params;
    
    if (botManager.startFarm(steamId)) {
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Остановка фарма для аккаунта
app.post('/api/farm/stop/:steamId', (req, res) => {
    const { steamId } = req.params;
    
    if (botManager.stopFarm(steamId)) {
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

// Остановка всех фармов
app.post('/api/farm/stop-all', (req, res) => {
    botManager.stopAllFarms();
    res.json({ success: true, message: 'Все фармы остановлены' });
});

// Обновление данных аккаунта
app.post('/api/update/:steamId', async (req, res) => {
    const { steamId } = req.params;
    await updateAccountData(steamId);
    res.json({ success: true, message: 'Данные обновлены' });
});

// Обновление всех данных
app.post('/api/update-all', async (req, res) => {
    await updateAllAccountsData();
    res.json({ success: true, message: 'Все данные обновлены' });
});

// 🎨 Генерация HTML с УЛЬТРА-КРАСИВЫМ дизайном
function generateDashboardHTML() {
    const accounts = Object.values(state.accounts);
    
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
                --secondary: #06D6A0;
                --accent: #FFD166;
                --danger: #EF476F;
                --background: #0A0A1F;
                --surface: rgba(255, 255, 255, 0.05);
                --surface-hover: rgba(255, 255, 255, 0.08);
                --text: #F8FAFC;
                --text-secondary: #94A3B8;
                --text-muted: #64748B;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --gradient-dark: linear-gradient(135deg, var(--primary-dark), #059669);
                --glass: rgba(255, 255, 255, 0.1);
                --glass-border: rgba(255, 255, 255, 0.2);
                --shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                --shadow-glow: 0 0 50px rgba(139, 92, 246, 0.3);
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
                    radial-gradient(circle at 90% 80%, rgba(6, 214, 160, 0.15) 0%, transparent 40%),
                    radial-gradient(circle at 50% 50%, rgba(255, 209, 102, 0.1) 0%, transparent 50%);
            }
            
            .stars {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -2;
                background-image: 
                    radial-gradient(2px 2px at 20px 30px, #eee, transparent),
                    radial-gradient(2px 2px at 40px 70px, #A78BFA, transparent),
                    radial-gradient(1px 1px at 90px 40px, #FFD166, transparent),
                    radial-gradient(1px 1px at 130px 80px, #06D6A0, transparent),
                    radial-gradient(2px 2px at 160px 30px, #EF476F, transparent);
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
                opacity: 0.4;
                background: 
                    radial-gradient(circle at 30% 40%, rgba(139, 92, 246, 0.4) 0%, transparent 50%),
                    radial-gradient(circle at 70% 60%, rgba(6, 214, 160, 0.3) 0%, transparent 50%),
                    radial-gradient(circle at 50% 20%, rgba(255, 209, 102, 0.2) 0%, transparent 50%);
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
            
            .accounts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
                gap: 30px;
                margin-bottom: 40px;
            }
            
            .account-card {
                background: var(--surface);
                backdrop-filter: blur(20px);
                padding: 35px;
                border-radius: 25px;
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
                background: rgba(255, 209, 102, 0.2);
                color: var(--accent);
                border: 1px solid var(--accent);
            }
            
            .status-stopped {
                background: rgba(148, 163, 184, 0.2);
                color: var(--text-secondary);
                border: 1px solid var(--text-secondary);
            }
            
            .status-online {
                background: rgba(6, 214, 160, 0.2);
                color: var(--secondary);
                border: 1px solid var(--secondary);
            }
            
            .status-error {
                background: rgba(239, 71, 111, 0.2);
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
            
            .btn {
                padding: 14px 20px;
                border: none;
                border-radius: 12px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.3s ease;
                font-family: inherit;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 0.95rem;
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
            
            .btn-success {
                background: var(--secondary);
                color: #000;
                box-shadow: 0 8px 25px rgba(6, 214, 160, 0.3);
            }
            
            .btn-danger {
                background: var(--danger);
                color: white;
                box-shadow: 0 8px 25px rgba(239, 71, 111, 0.3);
            }
            
            .btn-primary {
                background: var(--primary);
                color: white;
                box-shadow: 0 8px 25px rgba(139, 92, 246, 0.3);
            }
            
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
            }
            
            .btn:active {
                transform: translateY(-1px);
            }
            
            .btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }
            
            .global-actions {
                display: flex;
                gap: 15px;
                justify-content: center;
                margin-top: 40px;
            }
            
            .last-update {
                text-align: center;
                color: var(--text-secondary);
                margin-top: 30px;
                font-size: 0.9rem;
            }
            
            .loading-spinner {
                width: 20px;
                height: 20px;
                border: 2px solid transparent;
                border-top: 2px solid currentColor;
                border-radius: 50%;
                animation: spin 1s linear infinite;
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
            
            .notification.info {
                border-left: 4px solid var(--primary);
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
                
                .global-actions {
                    flex-direction: column;
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
        
        <div class="container">
            <div class="header floating">
                <h1><i class="fas fa-robot"></i> Steam Hour Booster</h1>
                <p>Автоматический фарм часов в Steam играх 24/7</p>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="total-accounts">${state.globalStats.totalAccounts}</div>
                    <div class="stat-label">Аккаунтов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="active-farms">${state.globalStats.activeFarms}</div>
                    <div class="stat-label">Активных фармов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="total-hours">${state.globalStats.totalHours}</div>
                    <div class="stat-label">Всего часов в CS2</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="total-farmed">${state.globalStats.totalFarmedHours}</div>
                    <div class="stat-label">Накручено часов</div>
                </div>
            </div>
            
            <div class="accounts-grid" id="accounts-container">
                ${accounts.map(account => `
                    <div class="account-card" data-steam-id="${account.steamId}">
                        <div class="account-header">
                            <div class="account-name">${account.profileName}</div>
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
                                <button class="btn btn-danger" onclick="stopFarm('${account.steamId}')">
                                    <i class="fas fa-stop"></i> Остановить фарм
                                </button>
                            ` : `
                                <button class="btn btn-success" onclick="startFarm('${account.steamId}')">
                                    <i class="fas fa-play"></i> Запустить фарм
                                </button>
                            `}
                            <button class="btn btn-primary" onclick="updateAccount('${account.steamId}')">
                                <i class="fas fa-sync-alt"></i> Обновить
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="global-actions">
                <button class="btn btn-primary" onclick="updateAllAccounts()">
                    <i class="fas fa-sync-alt"></i> Обновить все данные
                </button>
                <button class="btn btn-danger" onclick="stopAllFarms()">
                    <i class="fas fa-stop-circle"></i> Остановить все фармы
                </button>
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
                    const container = document.getElementById('accounts-container');
                    container.innerHTML = Object.values(data.accounts).map(account => \`
                        <div class="account-card" data-steam-id="\${account.steamId}">
                            <div class="account-header">
                                <div class="account-name">\${account.profileName}</div>
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
                                    <button class="btn btn-danger" onclick="stopFarm('\${account.steamId}')">
                                        <i class="fas fa-stop"></i> Остановить фарм
                                    </button>
                                \` : \`
                                    <button class="btn btn-success" onclick="startFarm('\${account.steamId}')">
                                        <i class="fas fa-play"></i> Запустить фарм
                                    </button>
                                \`}
                                <button class="btn btn-primary" onclick="updateAccount('\${account.steamId}')">
                                    <i class="fas fa-sync-alt"></i> Обновить
                                </button>
                            </div>
                        </div>
                    \`).join('');
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
            
            // Глобальные функции
            async function startFarm(steamId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${steamId}\`, {
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
            
            async function stopFarm(steamId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${steamId}\`, {
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
            
            async function stopAllFarms() {
                try {
                    const response = await fetch('/api/farm/stop-all', {
                        method: 'POST'
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Все фармы остановлены', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка остановки всех фармов:', error);
                    dashboard.showNotification('Ошибка остановки всех фармов', 'error');
                }
            }
            
            async function updateAccount(steamId) {
                try {
                    const response = await fetch(\`/api/update/\${steamId}\`, {
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
                    const response = await fetch('/api/update-all', {
                        method: 'POST'
                    });
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Все данные обновлены', 'success');
                        await dashboard.loadData();
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка обновления всех данных:', error);
                    dashboard.showNotification('Ошибка обновления всех данных', 'error');
                }
            }
            
            // Инициализация
            const dashboard = new Dashboard();
        </script>
    </body>
    </html>
  `;
}

// 🚀 Инициализация приложения
console.log('🚀 Запуск Steam Hour Booster...');
console.log(`📊 Загружено аккаунтов: ${CONFIG.STEAM_ACCOUNTS.length}`);
CONFIG.STEAM_ACCOUNTS.forEach(account => {
    console.log(`🤖 ${account.username} (${account.steamId})`);
});

// Первоначальное обновление данных
updateAllAccountsData();

// Авто-обновление по расписанию
setInterval(updateAllAccountsData, CONFIG.UPDATE_INTERVAL);

// Обработка graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Остановка приложения...');
    botManager.stopAllFarms();
    process.exit(0);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT} для доступа к панели управления`);
});
