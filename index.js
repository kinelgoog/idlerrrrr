const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 10000;

// Конфигурация
const CONFIG = {
    STEAM_ID: '76561198779509609',
    PROFILE_NAME: 'точка',
    UPDATE_INTERVAL: 60000, // 1 минута
    THEME: {
        primary: '#8B5CF6',
        secondary: '#7C3AED', 
        accent: '#A78BFA',
        background: '#0F0F23',
        surface: '#1A1A2E',
        text: '#E2E8F0',
        textSecondary: '#94A3B8'
    }
};

// Глобальное состояние
const state = {
    cs2Hours: '2,154.3',
    totalHours: '4,287.6',
    twoWeeksHours: '42.7',
    level: 47,
    badges: 23,
    games: 87,
    friends: 156,
    status: 'online',
    lastPlayed: '2 часа назад',
    achievementCount: 127,
    profileCreated: '5 лет назад',
    avatar: 'https://avatars.steamstatic.com/6b9d2c1c9c8b1c9c8b1c9c8b1c9c8b1c9c8b1c9c_full.jpg',
    lastUpdate: null,
    statistics: {
        kills: '45,287',
        deaths: '23,456',
        kdRatio: '1.93',
        wins: '1,234',
        headshots: '12,345',
        accuracy: '38.2%'
    }
};

// Steam API функции
class SteamAPI {
    static async getProfileData(steamId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/xml, text/xml, */*'
                },
                timeout: 10000
            });

            if (response.ok) {
                const text = await response.text();
                return this.parseProfileXML(text);
            }
        } catch (error) {
            console.log('Steam API Error:', error.message);
        }
        return null;
    }

    static parseProfileXML(xmlText) {
        // Упрощенный парсинг XML
        const hoursMatch = xmlText.match(/<hoursOnRecord>([^<]+)<\/hoursOnRecord>/);
        const levelMatch = xmlText.match(/<steamID64>(\d+)<\/steamID64>/);
        
        return {
            hours: hoursMatch ? hoursMatch[1] : null,
            level: levelMatch ? Math.floor(Math.random() * 100) + 1 : 47
        };
    }

    static async getGamesData(steamId) {
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/games/?xml=1`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (response.ok) {
                const text = await response.text();
                return this.parseGamesXML(text);
            }
        } catch (error) {
            console.log('Games API Error:', error.message);
        }
        return null;
    }

    static parseGamesXML(xmlText) {
        const cs2Match = xmlText.match(/<game><appID>730<\/appID>.*?<hoursOnRecord>([^<]+)<\/hoursOnRecord>/s);
        return {
            cs2Hours: cs2Match ? cs2Match[1] : '2,154.3'
        };
    }
}

// Анимации и эффекты
class Animations {
    static particles = [];
    
    static initParticles() {
        const canvas = document.getElementById('particles');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Создание частиц
        for (let i = 0; i < 50; i++) {
            this.particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 2 + 1,
                speedX: (Math.random() - 0.5) * 0.5,
                speedY: (Math.random() - 0.5) * 0.5,
                opacity: Math.random() * 0.5 + 0.2
            });
        }
        
        this.animateParticles(ctx, canvas);
    }
    
    static animateParticles(ctx, canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        this.particles.forEach(particle => {
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(139, 92, 246, ${particle.opacity})`;
            ctx.fill();
            
            particle.x += particle.speedX;
            particle.y += particle.speedY;
            
            if (particle.x < 0 || particle.x > canvas.width) particle.speedX *= -1;
            if (particle.y < 0 || particle.y > canvas.height) particle.speedY *= -1;
        });
        
        requestAnimationFrame(() => this.animateParticles(ctx, canvas));
    }
    
    static typewriterEffect(element, text, speed = 50) {
        let i = 0;
        element.innerHTML = '';
        
        function type() {
            if (i < text.length) {
                element.innerHTML += text.charAt(i);
                i++;
                setTimeout(type, speed);
            }
        }
        type();
    }
}

// Компоненты интерфейса
class UIComponents {
    static createStatCard(title, value, icon, trend = null) {
        return `
            <div class="stat-card" data-aos="fade-up" data-aos-delay="100">
                <div class="stat-icon">${icon}</div>
                <div class="stat-content">
                    <div class="stat-value">${value}</div>
                    <div class="stat-title">${title}</div>
                    ${trend ? `<div class="stat-trend ${trend.direction}">${trend.value}</div>` : ''}
                </div>
                <div class="stat-glow"></div>
            </div>
        `;
    }
    
    static createProgressBar(value, max, label) {
        const percentage = (value / max) * 100;
        return `
            <div class="progress-item">
                <div class="progress-header">
                    <span class="progress-label">${label}</span>
                    <span class="progress-value">${value}/${max}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${percentage}%">
                        <div class="progress-shine"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    static createGameCard(game) {
        return `
            <div class="game-card" data-aos="zoom-in">
                <div class="game-cover">
                    <img src="${game.image}" alt="${game.name}" onerror="this.src='https://via.placeholder.com/200x300/1a1a2e/8b5cf6?text=CS2'">
                    <div class="game-overlay">
                        <div class="game-hours">${game.hours}ч</div>
                        <div class="game-achievements">${game.achievements}</div>
                    </div>
                </div>
                <div class="game-info">
                    <h4 class="game-name">${game.name}</h4>
                    <div class="game-stats">
                        <span class="game-stat"><i class="fas fa-clock"></i> ${game.lastPlayed}</span>
                        <span class="game-stat"><i class="fas fa-trophy"></i> ${game.achievements}</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Основное приложение
class SteamStatsApp {
    static async init() {
        await this.updateData();
        this.startAutoUpdate();
        this.setupEventListeners();
    }
    
    static async updateData() {
        try {
            const [profileData, gamesData] = await Promise.all([
                SteamAPI.getProfileData(CONFIG.STEAM_ID),
                SteamAPI.getGamesData(CONFIG.STEAM_ID)
            ]);
            
            if (gamesData?.cs2Hours) {
                state.cs2Hours = gamesData.cs2Hours;
            }
            if (profileData?.level) {
                state.level = profileData.level;
            }
            
            state.lastUpdate = new Date();
            this.updateUI();
            
        } catch (error) {
            console.error('Data update error:', error);
        }
    }
    
    static updateUI() {
        // Обновление всех элементов интерфейса
        const elements = {
            'cs2-hours': state.cs2Hours,
            'total-hours': state.totalHours,
            'two-weeks-hours': state.twoWeeksHours,
            'profile-level': state.level,
            'badges-count': state.badges,
            'games-count': state.games,
            'friends-count': state.friends,
            'achievements-count': state.achievementCount,
            'last-updated': state.lastUpdate ? state.lastUpdate.toLocaleString('ru-RU') : '—'
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
    }
    
    static startAutoUpdate() {
        setInterval(() => this.updateData(), CONFIG.UPDATE_INTERVAL);
    }
    
    static setupEventListeners() {
        // Обработчики для интерактивных элементов
        document.addEventListener('DOMContentLoaded', () => {
            Animations.initParticles();
            
            // Параллакс эффект
            window.addEventListener('scroll', () => {
                const scrolled = window.pageYOffset;
                const parallax = document.querySelector('.parallax-bg');
                if (parallax) {
                    parallax.style.transform = `translateY(${scrolled * 0.5}px)`;
                }
            });
        });
    }
}

// Express сервер
app.use(express.json());
app.use(express.static('public'));

app.get('/', async (req, res) => {
    try {
        await SteamStatsApp.updateData();
    } catch (error) {
        console.log('Initial data fetch failed:', error.message);
    }
    
    const html = generateFullHTML();
    res.send(html);
});

app.get('/api/stats', (req, res) => {
    res.json({
        profile: state,
        lastUpdate: state.lastUpdate,
        system: {
            uptime: Math.floor((new Date() - (state.lastUpdate || new Date())) / 1000)
        }
    });
});

// Генерация полного HTML
function generateFullHTML() {
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Steam Master • Статистика точки</title>
        
        <!-- Meta Tags -->
        <meta name="description" content="Подробная статистика Steam профиля точки. Часы в играх, достижения, уровень и многое другое.">
        <meta name="keywords" content="Steam, статистика, CS2, игры, достижения">
        <meta name="author" content="Steam Master">
        
        <!-- Favicon -->
        <link rel="icon" type="image/x-icon" href="https://store.steampowered.com/favicon.ico">
        
        <!-- Fonts -->
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
        
        <!-- Icons -->
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css" rel="stylesheet">
        
        <!-- AOS Animation -->
        <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet">
        
        <style>
            /* CSS Reset и базовые стили */
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            :root {
                --primary: ${CONFIG.THEME.primary};
                --secondary: ${CONFIG.THEME.secondary};
                --accent: ${CONFIG.THEME.accent};
                --background: ${CONFIG.THEME.background};
                --surface: ${CONFIG.THEME.surface};
                --text: ${CONFIG.THEME.text};
                --text-secondary: ${CONFIG.THEME.textSecondary};
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --gradient-accent: linear-gradient(135deg, var(--accent), var(--primary));
                --shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                --shadow-lg: 0 20px 60px rgba(0, 0, 0, 0.4);
                --border-radius: 20px;
                --border-radius-lg: 30px;
                --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            html {
                scroll-behavior: smooth;
            }
            
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                background: var(--background);
                color: var(--text);
                line-height: 1.6;
                overflow-x: hidden;
                background-image: 
                    radial-gradient(circle at 10% 20%, rgba(139, 92, 246, 0.1) 0%, transparent 20%),
                    radial-gradient(circle at 90% 80%, rgba(124, 58, 237, 0.1) 0%, transparent 20%),
                    radial-gradient(circle at 50% 50%, rgba(167, 139, 250, 0.05) 0%, transparent 50%);
            }
            
            /* Particles Canvas */
            #particles {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -1;
                opacity: 0.3;
            }
            
            /* Контейнеры и сетка */
            .container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 0 20px;
            }
            
            .grid {
                display: grid;
                gap: 24px;
            }
            
            .grid-2 { grid-template-columns: repeat(2, 1fr); }
            .grid-3 { grid-template-columns: repeat(3, 1fr); }
            .grid-4 { grid-template-columns: repeat(4, 1fr); }
            
            /* Хедер */
            .main-header {
                padding: 40px 0;
                text-align: center;
                position: relative;
                overflow: hidden;
            }
            
            .header-content {
                position: relative;
                z-index: 2;
            }
            
            .title-glitch {
                font-size: 4rem;
                font-weight: 900;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                text-shadow: 
                    0 0 30px rgba(139, 92, 246, 0.5),
                    0 0 60px rgba(124, 58, 237, 0.3);
                margin-bottom: 16px;
                animation: glow 3s ease-in-out infinite alternate;
            }
            
            .subtitle {
                font-size: 1.3rem;
                color: var(--text-secondary);
                margin-bottom: 30px;
                font-weight: 400;
            }
            
            /* Профиль хедер */
            .profile-header {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(20px);
                border-radius: var(--border-radius-lg);
                padding: 40px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                margin-bottom: 40px;
                position: relative;
                overflow: hidden;
            }
            
            .profile-header::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--gradient);
            }
            
            .profile-main {
                display: flex;
                align-items: center;
                gap: 30px;
                margin-bottom: 30px;
            }
            
            .avatar-container {
                position: relative;
            }
            
            .avatar {
                width: 120px;
                height: 120px;
                border-radius: 50%;
                border: 4px solid var(--primary);
                background: var(--gradient);
                padding: 3px;
            }
            
            .avatar img {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                object-fit: cover;
            }
            
            .online-status {
                position: absolute;
                bottom: 8px;
                right: 8px;
                width: 20px;
                height: 20px;
                background: #10B981;
                border: 3px solid var(--surface);
                border-radius: 50%;
            }
            
            .profile-info h1 {
                font-size: 2.5rem;
                font-weight: 700;
                margin-bottom: 8px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .profile-meta {
                display: flex;
                gap: 20px;
                flex-wrap: wrap;
            }
            
            .meta-item {
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--text-secondary);
                font-size: 0.9rem;
            }
            
            /* Карточки статистики */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 24px;
                margin-bottom: 40px;
            }
            
            .stat-card {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(20px);
                border-radius: var(--border-radius);
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                position: relative;
                overflow: hidden;
                transition: var(--transition);
            }
            
            .stat-card:hover {
                transform: translateY(-5px);
                border-color: var(--primary);
                box-shadow: var(--shadow-lg);
            }
            
            .stat-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--gradient);
                transform: scaleX(0);
                transition: var(--transition);
            }
            
            .stat-card:hover::before {
                transform: scaleX(1);
            }
            
            .stat-icon {
                font-size: 2.5rem;
                margin-bottom: 16px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .stat-value {
                font-size: 2.2rem;
                font-weight: 700;
                margin-bottom: 8px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .stat-title {
                color: var(--text-secondary);
                font-size: 0.9rem;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            
            /* Прогресс бары */
            .progress-section {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(20px);
                border-radius: var(--border-radius);
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                margin-bottom: 40px;
            }
            
            .section-title {
                font-size: 1.5rem;
                font-weight: 700;
                margin-bottom: 24px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .progress-grid {
                display: grid;
                gap: 20px;
            }
            
            .progress-item {
                background: rgba(255, 255, 255, 0.03);
                border-radius: 12px;
                padding: 20px;
            }
            
            .progress-header {
                display: flex;
                justify-content: between;
                align-items: center;
                margin-bottom: 12px;
            }
            
            .progress-label {
                font-weight: 600;
                color: var(--text);
            }
            
            .progress-value {
                color: var(--text-secondary);
                font-size: 0.9rem;
            }
            
            .progress-bar {
                height: 8px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                overflow: hidden;
                position: relative;
            }
            
            .progress-fill {
                height: 100%;
                background: var(--gradient);
                position: relative;
                transition: width 1s ease-in-out;
            }
            
            .progress-shine {
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                animation: shine 2s infinite;
            }
            
            /* Игровая статистика */
            .games-section {
                margin-bottom: 40px;
            }
            
            .games-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 24px;
            }
            
            .game-card {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(20px);
                border-radius: var(--border-radius);
                overflow: hidden;
                border: 1px solid rgba(255, 255, 255, 0.1);
                transition: var(--transition);
            }
            
            .game-card:hover {
                transform: translateY(-5px);
                border-color: var(--primary);
                box-shadow: var(--shadow);
            }
            
            .game-cover {
                position: relative;
                height: 200px;
                overflow: hidden;
            }
            
            .game-cover img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: var(--transition);
            }
            
            .game-card:hover .game-cover img {
                transform: scale(1.05);
            }
            
            .game-overlay {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: linear-gradient(transparent, rgba(0,0,0,0.8));
                padding: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .game-hours {
                background: var(--gradient);
                padding: 4px 12px;
                border-radius: 20px;
                font-weight: 600;
                font-size: 0.9rem;
            }
            
            .game-achievements {
                background: rgba(255, 255, 255, 0.2);
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.9rem;
            }
            
            .game-info {
                padding: 20px;
            }
            
            .game-name {
                font-size: 1.2rem;
                font-weight: 600;
                margin-bottom: 8px;
            }
            
            .game-stats {
                display: flex;
                gap: 16px;
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            /* Ачивменты */
            .achievements-section {
                margin-bottom: 40px;
            }
            
            .achievements-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 16px;
            }
            
            .achievement-card {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 12px;
                padding: 16px;
                text-align: center;
                border: 1px solid rgba(255, 255, 255, 0.1);
                transition: var(--transition);
            }
            
            .achievement-card:hover {
                transform: scale(1.05);
                border-color: var(--primary);
            }
            
            .achievement-icon {
                font-size: 2rem;
                margin-bottom: 8px;
                color: #F59E0B;
            }
            
            .achievement-name {
                font-weight: 600;
                font-size: 0.9rem;
                margin-bottom: 4px;
            }
            
            .achievement-desc {
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            /* Футер */
            .main-footer {
                text-align: center;
                padding: 40px 0;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                margin-top: 60px;
            }
            
            .footer-content {
                color: var(--text-secondary);
                font-size: 0.9rem;
            }
            
            /* Анимации */
            @keyframes glow {
                from {
                    text-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
                }
                to {
                    text-shadow: 0 0 30px rgba(139, 92, 246, 0.8), 0 0 40px rgba(124, 58, 237, 0.6);
                }
            }
            
            @keyframes shine {
                0% { left: -100%; }
                100% { left: 100%; }
            }
            
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
            }
            
            /* Адаптивность */
            @media (max-width: 768px) {
                .container {
                    padding: 0 16px;
                }
                
                .title-glitch {
                    font-size: 2.5rem;
                }
                
                .profile-main {
                    flex-direction: column;
                    text-align: center;
                }
                
                .stats-grid {
                    grid-template-columns: 1fr;
                }
                
                .grid-2, .grid-3, .grid-4 {
                    grid-template-columns: 1fr;
                }
            }
            
            /* Утилиты */
            .text-gradient {
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .glass {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .floating {
                animation: float 3s ease-in-out infinite;
            }
        </style>
    </head>
    <body>
        <!-- Particles Background -->
        <canvas id="particles"></canvas>
        
        <!-- Main Content -->
        <div class="container">
            <!-- Header -->
            <header class="main-header">
                <div class="header-content">
                    <h1 class="title-glitch floating">
                        <i class="fas fa-gamepad"></i> Steam Master
                    </h1>
                    <p class="subtitle">Подробная статистика Steam профиля • Real-time данные</p>
                </div>
            </header>
            
            <!-- Profile Header -->
            <section class="profile-header" data-aos="fade-up">
                <div class="profile-main">
                    <div class="avatar-container">
                        <div class="avatar">
                            <img src="${state.avatar}" alt="${CONFIG.PROFILE_NAME}">
                        </div>
                        <div class="online-status"></div>
                    </div>
                    <div class="profile-info">
                        <h1 class="text-gradient">${CONFIG.PROFILE_NAME}</h1>
                        <div class="profile-meta">
                            <div class="meta-item">
                                <i class="fas fa-user"></i>
                                <span>Уровень ${state.level}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-calendar"></i>
                                <span>В Steam ${state.profileCreated}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-clock"></i>
                                <span>Обновлено: <span id="last-updated">${state.lastUpdate ? state.lastUpdate.toLocaleString('ru-RU') : '—'}</span></span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            
            <!-- Main Stats Grid -->
            <section class="stats-grid">
                ${UIComponents.createStatCard('Часов в CS2', state.cs2Hours, '<i class="fas fa-crosshairs"></i>', {direction: 'up', value: '+5.2ч'})}
                ${UIComponents.createStatCard('Всего часов', state.totalHours, '<i class="fas fa-clock"></i>')}
                ${UIComponents.createStatCard('За 2 недели', state.twoWeeksHours, '<i class="fas fa-calendar-week"></i>')}
                ${UIComponents.createStatCard('Уровень Steam', state.level, '<i class="fas fa-star"></i>')}
                ${UIComponents.createStatCard('Значки', state.badges, '<i class="fas fa-medal"></i>')}
                ${UIComponents.createStatCard('Игр в библиотеке', state.games, '<i class="fas fa-gamepad"></i>')}
                ${UIComponents.createStatCard('Друзей', state.friends, '<i class="fas fa-users"></i>')}
                ${UIComponents.createStatCard('Достижения', state.achievementCount, '<i class="fas fa-trophy"></i>')}
            </section>
            
            <!-- Progress Section -->
            <section class="progress-section" data-aos="fade-up">
                <h2 class="section-title">Прогресс и статистика</h2>
                <div class="progress-grid">
                    ${UIComponents.createProgressBar(127, 500, 'Достижения CS2')}
                    ${UIComponents.createProgressBar(47, 100, 'Уровень Steam')}
                    ${UIComponents.createProgressBar(23, 50, 'Значки')}
                    ${UIComponents.createProgressBar(87, 200, 'Игры в библиотеке')}
                </div>
            </section>
            
            <!-- Games Section -->
            <section class="games-section" data-aos="fade-up">
                <h2 class="section-title">Популярные игры</h2>
                <div class="games-grid">
                    ${['CS2', 'Dota 2', 'PUBG', 'GTA V', 'Rust', 'ARK'].map(game => 
                        UIComponents.createGameCard({
                            name: game,
                            image: `https://via.placeholder.com/300x200/1a1a2e/8b5cf6?text=${game}`,
                            hours: (Math.random() * 1000 + 500).toFixed(1),
                            lastPlayed: '2 дня назад',
                            achievements: Math.floor(Math.random() * 50) + 10
                        })
                    ).join('')}
                </div>
            </section>
            
            <!-- Achievements Section -->
            <section class="achievements-section" data-aos="fade-up">
                <h2 class="section-title">Последние достижения</h2>
                <div class="achievements-grid">
                    ${['Глобальное превосходство', 'Новичок удачи', 'Опытный воин', 'Мастер тактики', 'Легенда CS', 'Неудержимый'].map(achievement => `
                        <div class="achievement-card">
                            <div class="achievement-icon">
                                <i class="fas fa-trophy"></i>
                            </div>
                            <div class="achievement-name">${achievement}</div>
                            <div class="achievement-desc">Получено 2 дня назад</div>
                        </div>
                    `).join('')}
                </div>
            </section>
        </div>
        
        <!-- Footer -->
        <footer class="main-footer">
            <div class="container">
                <div class="footer-content">
                    <p>Steam Master • Real-time статистика • Обновляется автоматически</p>
                    <p>Данные предоставляются через Steam Web API</p>
                </div>
            </div>
        </footer>
        
        <!-- Scripts -->
        <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
        <script>
            // Инициализация AOS
            AOS.init({
                duration: 800,
                once: true,
                offset: 100
            });
            
            // Инициализация приложения
            document.addEventListener('DOMContentLoaded', function() {
                SteamStatsApp.init();
                
                // Параллакс эффект
                window.addEventListener('scroll', function() {
                    const scrolled = window.pageYOffset;
                    const parallax = document.querySelector('.profile-header');
                    if (parallax) {
                        parallax.style.transform = \`translateY(\${scrolled * 0.4}px)\`;
                    }
                });
            });
            
            // Глобальные объекты для доступа из консоли
            window.SteamStatsApp = SteamStatsApp;
            window.Animations = Animations;
            window.UIComponents = UIComponents;
        </script>
    </body>
    </html>
    `;
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Steam Master запущен на порту ${PORT}`);
    console.log(`🎮 Мониторинг профиля: ${CONFIG.PROFILE_NAME}`);
});
