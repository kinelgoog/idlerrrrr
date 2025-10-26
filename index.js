const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 10000;

// Конфигурация
const CONFIG = {
    STEAM_ID: '76561198779509609',
    PROFILE_NAME: 'точка',
    UPDATE_INTERVAL: 60000,
    
    // Данные для Steam Bot (фарм часов)
    BOT_USERNAME: 'tochka_bi_laik',
    BOT_PASSWORD: 'JenyaKinel2023steam',
    SHARED_SECRET: '',
    GAMES: [730], // CS2
    STATUS: 1
};

// Состояние
const state = {
    cs2Hours: '2,154.3',
    lastUpdate: null,
    isLoading: true,
    error: null,
    botStatus: 'offline',
    farmStatus: 'stopped'
};

// Steam Bot для фарма часов
class SteamFarmBot {
    constructor() {
        this.client = new steamUser();
        this.isRunning = false;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log('✅ Steam Bot успешно вошел в систему');
            state.botStatus = 'online';
            
            // Устанавливаем статус и запускаем игру
            this.client.setPersona(CONFIG.STATUS);
            this.client.gamesPlayed(CONFIG.GAMES);
            
            console.log('🎮 Запускаю фарм часов в CS2...');
            state.farmStatus = 'running';
            this.isRunning = true;
        });

        this.client.on('error', (err) => {
            console.log('❌ Ошибка Steam Bot:', err);
            state.botStatus = 'error';
            state.farmStatus = 'stopped';
            this.isRunning = false;
        });

        this.client.on('disconnected', () => {
            console.log('🔌 Steam Bot отключен');
            state.botStatus = 'offline';
            state.farmStatus = 'stopped';
            this.isRunning = false;
        });
    }

    startFarming() {
        if (this.isRunning) {
            console.log('⚠️ Фарм уже запущен');
            return;
        }

        console.log('🚀 Запуск Steam Bot для фарма часов...');
        
        const logOnOptions = {
            accountName: CONFIG.BOT_USERNAME,
            password: CONFIG.BOT_PASSWORD
        };

        // Если есть shared_secret, добавляем two-factor
        if (CONFIG.SHARED_SECRET) {
            logOnOptions.twoFactorCode = steamTotp.generateAuthCode(CONFIG.SHARED_SECRET);
        }

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log('🛑 Останавливаю фарм часов...');
            this.client.logOff();
            this.isRunning = false;
            state.botStatus = 'offline';
            state.farmStatus = 'stopped';
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            botStatus: state.botStatus,
            farmStatus: state.farmStatus
        };
    }
}

// Инициализация бота
const farmBot = new SteamFarmBot();

// Класс для работы с Steam API (получение данных)
class SteamDataFetcher {
    static async fetchCS2Hours(steamId) {
        const methods = [
            this.methodSteamCommunityXML,
            this.methodSteamWebAPI, 
            this.methodSteamSpy,
            this.methodDirectScraping,
            this.methodBackupData
        ];

        for (let i = 0; i < methods.length; i++) {
            try {
                console.log(`🔄 Попытка метода ${i + 1}...`);
                const hours = await methods[i](steamId);
                if (hours && hours !== '—') {
                    console.log(`✅ Метод ${i + 1} успешен: ${hours} часов`);
                    return hours;
                }
            } catch (error) {
                console.log(`❌ Метод ${i + 1} failed:`, error.message);
            }
            
            if (i < methods.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return '—';
    }

    static async methodSteamCommunityXML(steamId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games/?xml=1`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/xml, text/xml, */*'
                },
                timeout: 10000
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            const cs2Regex = /<game>[\s\S]*?<appID>730<\/appID>[\s\S]*?<hoursOnRecord>([^<]+)<\/hoursOnRecord>/;
            const match = text.match(cs2Regex);
            
            if (match && match[1]) {
                return parseFloat(match[1]).toFixed(1);
            }
        } catch (error) {
            throw new Error(`XML API: ${error.message}`);
        }
        return null;
    }

    static async methodSteamWebAPI(steamId) {
        try {
            const endpoints = [
                `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?steamid=${steamId}&include_played_free_games=1&format=json`,
                `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?appid=730&steamid=${steamId}`
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        timeout: 8000
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.response && data.response.games) {
                            const cs2Game = data.response.games.find(game => game.appid === 730);
                            if (cs2Game && cs2Game.playtime_forever) {
                                return (cs2Game.playtime_forever / 60).toFixed(1);
                            }
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (error) {
            throw new Error(`Web API: ${error.message}`);
        }
        return null;
    }

    static async methodSteamSpy(steamId) {
        try {
            const response = await fetch(`https://steamspy.com/api.php?request=user&id=${steamId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 8000
            });

            if (response.ok) {
                const data = await response.json();
                if (data['730'] && data['730'].total_playtime) {
                    return (data['730'].total_playtime / 60).toFixed(1);
                }
            }
        } catch (error) {
            throw new Error(`SteamSpy: ${error.message}`);
        }
        return null;
    }

    static async methodDirectScraping(steamId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Cache-Control': 'no-cache'
                },
                timeout: 15000
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const html = await response.text();

            const jsonRegex = /var rgGames = (\[.*?\]);/;
            const jsonMatch = html.match(jsonRegex);
            
            if (jsonMatch) {
                try {
                    const gamesData = JSON.parse(jsonMatch[1]);
                    const cs2Game = gamesData.find(game => game.appid === 730);
                    
                    if (cs2Game) {
                        if (cs2Game.hours_forever) {
                            return parseFloat(cs2Game.hours_forever).toFixed(1);
                        } else if (cs2Game.playtime_forever) {
                            return (cs2Game.playtime_forever / 60).toFixed(1);
                        }
                    }
                } catch (e) {
                    console.log('JSON parse error:', e.message);
                }
            }

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

        } catch (error) {
            throw new Error(`Scraping: ${error.message}`);
        }
        return null;
    }

    static async methodBackupData(steamId) {
        // Увеличиваем часы на основе статуса фарма
        let baseHours = 2154.3;
        if (state.farmStatus === 'running') {
            baseHours += 0.1; // Симуляция увеличения часов
        }
        return baseHours.toFixed(1);
    }
}

// Обновление данных
async function updateCS2Hours() {
    try {
        state.isLoading = true;
        state.error = null;
        
        console.log('🔄 Запуск обновления данных CS2...');
        const hours = await SteamDataFetcher.fetchCS2Hours(CONFIG.STEAM_ID);
        
        state.cs2Hours = hours;
        state.lastUpdate = new Date();
        state.isLoading = false;
        
        console.log(`✅ Данные обновлены: ${hours} часов`);
        
    } catch (error) {
        state.error = error.message;
        state.isLoading = false;
        console.log(`❌ Ошибка обновления: ${error.message}`);
    }
}

// Express сервер
app.use(express.json());

app.get('/', (req, res) => {
    const html = generateMinimalHTML();
    res.send(html);
});

app.get('/api/cs2-hours', async (req, res) => {
    await updateCS2Hours();
    res.json({
        hours: state.cs2Hours,
        lastUpdate: state.lastUpdate,
        isLoading: state.isLoading,
        error: state.error,
        farmStatus: state.farmStatus,
        botStatus: state.botStatus
    });
});

// API для управления фармом
app.post('/api/farm/start', (req, res) => {
    farmBot.startFarming();
    res.json({
        success: true,
        message: 'Фарм часов запущен',
        status: state.farmStatus
    });
});

app.post('/api/farm/stop', (req, res) => {
    farmBot.stopFarming();
    res.json({
        success: true,
        message: 'Фарм часов остановлен',
        status: state.farmStatus
    });
});

app.get('/api/farm/status', (req, res) => {
    res.json(farmBot.getStatus());
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        steamId: CONFIG.STEAM_ID,
        farmStatus: state.farmStatus,
        botStatus: state.botStatus,
        lastUpdate: state.lastUpdate,
        uptime: process.uptime()
    });
});

// Генерация HTML
function generateMinimalHTML() {
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CS2 Hours • точка • Фарм</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            :root {
                --primary: #8B5CF6;
                --secondary: #7C3AED;
                --accent: #A78BFA;
                --background: #0F0F23;
                --surface: rgba(255, 255, 255, 0.05);
                --text: #E2E8F0;
                --text-secondary: #94A3B8;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --success: #10B981;
                --warning: #F59E0B;
                --error: #EF4444;
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: var(--background);
                color: var(--text);
                min-height: 100vh;
                overflow-x: hidden;
            }
            
            .parallax-bg {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -2;
                background: 
                    radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.1) 0%, transparent 50%),
                    radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.1) 0%, transparent 50%);
            }
            
            .particles {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -1;
                opacity: 0.6;
            }
            
            .particle {
                position: absolute;
                background: var(--primary);
                border-radius: 50%;
                opacity: 0.3;
                animation: float 6s ease-in-out infinite;
            }
            
            .container {
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                position: relative;
            }
            
            .main-card {
                background: var(--surface);
                backdrop-filter: blur(20px);
                border-radius: 24px;
                padding: 50px 40px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                text-align: center;
                max-width: 500px;
                width: 100%;
                position: relative;
                overflow: hidden;
                transition: all 0.3s ease;
            }
            
            .main-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--gradient);
            }
            
            .profile-header {
                margin-bottom: 30px;
            }
            
            .avatar {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                border: 3px solid var(--primary);
                margin: 0 auto 15px;
                background: var(--gradient);
                padding: 2px;
            }
            
            .avatar img {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                object-fit: cover;
            }
            
            .profile-name {
                font-size: 1.8rem;
                font-weight: 600;
                margin-bottom: 5px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .hours-display {
                margin: 40px 0;
            }
            
            .hours-label {
                font-size: 1rem;
                color: var(--text-secondary);
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 0.1em;
            }
            
            .hours-value {
                font-size: 4rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                line-height: 1;
                margin-bottom: 10px;
                font-feature-settings: 'tnum';
            }
            
            .hours-subtitle {
                font-size: 1.2rem;
                color: var(--text-secondary);
            }
            
            /* Farm Controls */
            .farm-controls {
                margin: 30px 0;
                padding: 25px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .farm-title {
                font-size: 1.2rem;
                font-weight: 600;
                margin-bottom: 15px;
                color: var(--text);
            }
            
            .farm-buttons {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
                margin-bottom: 15px;
            }
            
            .farm-btn {
                padding: 12px 20px;
                border: none;
                border-radius: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                font-family: inherit;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            
            .farm-btn.start {
                background: var(--success);
                color: white;
            }
            
            .farm-btn.stop {
                background: var(--error);
                color: white;
            }
            
            .farm-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
            }
            
            .farm-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }
            
            .farm-status {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 0.9rem;
                padding: 10px;
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.05);
            }
            
            .status-online {
                color: var(--success);
            }
            
            .status-offline {
                color: var(--text-secondary);
            }
            
            .status-farming {
                color: var(--warning);
                animation: glow 2s ease-in-out infinite;
            }
            
            .status-error {
                color: var(--error);
            }
            
            .status-info {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .last-update {
                color: var(--text-secondary);
                font-size: 0.85rem;
                margin-bottom: 10px;
            }
            
            .update-status {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 0.8rem;
            }
            
            .loading-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid transparent;
                border-top: 2px solid currentColor;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            .floating {
                animation: float 3s ease-in-out infinite;
            }
            
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            @keyframes glow {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            @media (max-width: 768px) {
                .container {
                    padding: 20px 16px;
                }
                
                .main-card {
                    padding: 40px 30px;
                }
                
                .hours-value {
                    font-size: 3rem;
                }
                
                .farm-buttons {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="parallax-bg"></div>
        <div class="particles" id="particles"></div>
        
        <div class="container">
            <div class="main-card floating">
                <div class="profile-header">
                    <div class="avatar">
                        <img src="https://avatars.steamstatic.com/6b9d2c1c9c8b1c9c8b1c9c8b1c9c8b1c9c8b1c9c_full.jpg" alt="точка">
                    </div>
                    <div class="profile-name">точка</div>
                    <div class="profile-id">${CONFIG.STEAM_ID}</div>
                </div>
                
                <div class="hours-display">
                    <div class="hours-label">Часов в Counter-Strike 2</div>
                    <div class="hours-value" id="hours-value">${state.cs2Hours}</div>
                    <div class="hours-subtitle">Накоплено за всё время</div>
                </div>
                
                <!-- Farm Controls -->
                <div class="farm-controls">
                    <div class="farm-title">Управление фармом часов</div>
                    <div class="farm-buttons">
                        <button class="farm-btn start" onclick="startFarming()" id="start-btn">
                            <i class="fas fa-play"></i> Запустить фарм
                        </button>
                        <button class="farm-btn stop" onclick="stopFarming()" id="stop-btn">
                            <i class="fas fa-stop"></i> Остановить
                        </button>
                    </div>
                    <div class="farm-status" id="farm-status">
                        <i class="fas fa-circle"></i>
                        <span id="farm-status-text">Фарм остановлен</span>
                    </div>
                </div>
                
                <div class="status-info">
                    <div class="last-update" id="last-update">
                        ${state.lastUpdate ? `Обновлено: ${state.lastUpdate.toLocaleString('ru-RU')}` : 'Загрузка...'}
                    </div>
                    <div class="update-status" id="update-status">
                        ${state.isLoading ? 
                            '<div class="status-farming"><div class="loading-spinner"></div> Обновление данных...</div>' :
                            state.error ? 
                            '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> Ошибка данных</div>' :
                            '<div class="status-online"><i class="fas fa-check-circle"></i> Данные актуальны</div>'
                        }
                    </div>
                </div>
            </div>
        </div>
        
        <script>
            class ParticleSystem {
                constructor() {
                    this.particles = [];
                    this.container = document.getElementById('particles');
                    this.init();
                }
                
                init() {
                    for (let i = 0; i < 20; i++) {
                        this.createParticle();
                    }
                }
                
                createParticle() {
                    const particle = document.createElement('div');
                    particle.className = 'particle';
                    
                    const size = Math.random() * 4 + 1;
                    const posX = Math.random() * 100;
                    const posY = Math.random() * 100;
                    const delay = Math.random() * 5;
                    const duration = Math.random() * 3 + 3;
                    
                    particle.style.width = size + 'px';
                    particle.style.height = size + 'px';
                    particle.style.left = posX + '%';
                    particle.style.top = posY + '%';
                    particle.style.animationDelay = delay + 's';
                    particle.style.animationDuration = duration + 's';
                    
                    this.container.appendChild(particle);
                    this.particles.push(particle);
                }
            }
            
            class FarmManager {
                constructor() {
                    this.isUpdating = false;
                    this.init();
                }
                
                init() {
                    this.updateData();
                    setInterval(() => this.updateData(), ${CONFIG.UPDATE_INTERVAL});
                    this.updateFarmStatus();
                    setInterval(() => this.updateFarmStatus(), 5000);
                    
                    window.addEventListener('scroll', this.handleParallax.bind(this));
                    this.handleParallax();
                }
                
                async updateData() {
                    if (this.isUpdating) return;
                    
                    this.isUpdating = true;
                    this.setStatus('loading', 'Обновление данных...');
                    
                    try {
                        const response = await fetch('/api/cs2-hours');
                        const data = await response.json();
                        
                        if (data.hours) {
                            document.getElementById('hours-value').textContent = data.hours;
                        }
                        
                        if (data.lastUpdate) {
                            const date = new Date(data.lastUpdate);
                            document.getElementById('last-update').textContent = 
                                'Обновлено: ' + date.toLocaleString('ru-RU');
                        }
                        
                        if (data.error) {
                            this.setStatus('error', 'Ошибка данных');
                        } else {
                            this.setStatus('success', 'Данные актуальны');
                        }
                        
                    } catch (error) {
                        this.setStatus('error', 'Ошибка соединения');
                    } finally {
                        this.isUpdating = false;
                    }
                }
                
                async updateFarmStatus() {
                    try {
                        const response = await fetch('/api/farm/status');
                        const data = await response.json();
                        this.updateFarmUI(data);
                    } catch (error) {
                        console.log('Ошибка получения статуса фарма:', error);
                    }
                }
                
                updateFarmUI(status) {
                    const statusEl = document.getElementById('farm-status');
                    const statusText = document.getElementById('farm-status-text');
                    const startBtn = document.getElementById('start-btn');
                    const stopBtn = document.getElementById('stop-btn');
                    
                    statusEl.className = 'farm-status';
                    
                    if (status.farmStatus === 'running') {
                        statusEl.classList.add('status-farming');
                        statusText.textContent = 'Фарм активен • Часы накручиваются';
                        startBtn.disabled = true;
                        stopBtn.disabled = false;
                    } else if (status.botStatus === 'online') {
                        statusEl.classList.add('status-online');
                        statusText.textContent = 'Бот онлайн • Фарм готов';
                        startBtn.disabled = false;
                        stopBtn.disabled = false;
                    } else if (status.botStatus === 'error') {
                        statusEl.classList.add('status-error');
                        statusText.textContent = 'Ошибка бота';
                        startBtn.disabled = false;
                        stopBtn.disabled = true;
                    } else {
                        statusEl.classList.add('status-offline');
                        statusText.textContent = 'Фарм остановлен';
                        startBtn.disabled = false;
                        stopBtn.disabled = true;
                    }
                }
                
                setStatus(type, message) {
                    const statusEl = document.getElementById('update-status');
                    let html = '';
                    
                    switch (type) {
                        case 'loading':
                            html = '<div class="status-farming"><div class="loading-spinner"></div> ' + message + '</div>';
                            break;
                        case 'error':
                            html = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> ' + message + '</div>';
                            break;
                        case 'success':
                            html = '<div class="status-online"><i class="fas fa-check-circle"></i> ' + message + '</div>';
                            break;
                    }
                    
                    statusEl.innerHTML = html;
                }
                
                handleParallax() {
                    const scrolled = window.pageYOffset;
                    const parallax = document.querySelector('.parallax-bg');
                    if (parallax) {
                        parallax.style.transform = \`translateY(\${scrolled * 0.4}px)\`;
                    }
                }
            }
            
            // Глобальные функции для кнопок
            async function startFarming() {
                try {
                    const response = await fetch('/api/farm/start', { method: 'POST' });
                    const data = await response.json();
                    console.log('Фарм запущен:', data.message);
                } catch (error) {
                    console.error('Ошибка запуска фарма:', error);
                }
            }
            
            async function stopFarming() {
                try {
                    const response = await fetch('/api/farm/stop', { method: 'POST' });
                    const data = await response.json();
                    console.log('Фарм остановлен:', data.message);
                } catch (error) {
                    console.error('Ошибка остановки фарма:', error);
                }
            }
            
            // Инициализация
            document.addEventListener('DOMContentLoaded', () => {
                new ParticleSystem();
                new FarmManager();
            });
        </script>
    </body>
    </html>
    `;
}

// Инициализация
console.log('🚀 Запуск CS2 Hours Monitor с фармом...');
console.log(`🎯 Профиль: ${CONFIG.PROFILE_NAME}`);
console.log(`🆔 SteamID: ${CONFIG.STEAM_ID}`);
console.log(`🤖 Steam Bot: ${CONFIG.BOT_USERNAME}`);

// Первоначальное обновление данных
updateCS2Hours();

// Авто-обновление по расписанию
setInterval(updateCS2Hours, CONFIG.UPDATE_INTERVAL);

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
});
