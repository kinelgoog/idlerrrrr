const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');

const app = express();
const PORT = process.env.PORT || 10000;

// Статистика работы
const stats = {
  startTime: new Date(),
  requestCount: 0,
  status: 'running',
  platform: 'Render.com'
};

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  stats.requestCount++;
  console.log(`📨 [${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// Основные маршруты
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🎮 Steam Booster</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #8A2BE2 0%, #4B0082 50%, #9400D3 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(15px);
                border-radius: 25px;
                padding: 50px 40px;
                max-width: 700px;
                width: 100%;
                box-shadow: 0 20px 40px rgba(138, 43, 226, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.3);
                position: relative;
                overflow: hidden;
            }
            .container::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
                animation: rotate 20s linear infinite;
                pointer-events: none;
            }
            @keyframes rotate {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .header {
                text-align: center;
                margin-bottom: 40px;
                position: relative;
                z-index: 2;
            }
            .header h1 {
                font-size: 3em;
                margin-bottom: 15px;
                background: linear-gradient(45deg, #E0B0FF, #DA70D6, #FF69B4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                text-shadow: 0 0 30px rgba(224, 176, 255, 0.5);
            }
            .status {
                background: linear-gradient(135deg, rgba(224, 176, 255, 0.2), rgba(218, 112, 214, 0.2));
                border: 1px solid rgba(224, 176, 255, 0.5);
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 30px;
                text-align: center;
                backdrop-filter: blur(10px);
                position: relative;
                z-index: 2;
            }
            .stats {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 15px;
                padding: 25px;
                margin-bottom: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                position: relative;
                z-index: 2;
            }
            .stats pre {
                white-space: pre-wrap;
                word-wrap: break-word;
                font-family: 'Courier New', monospace;
                font-size: 0.95em;
                color: #E0B0FF;
            }
            .info {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 20px;
                margin-top: 25px;
                position: relative;
                z-index: 2;
            }
            .info-item {
                background: linear-gradient(135deg, rgba(138, 43, 226, 0.3), rgba(148, 0, 211, 0.3));
                padding: 20px 15px;
                border-radius: 12px;
                text-align: center;
                border: 1px solid rgba(224, 176, 255, 0.3);
                transition: transform 0.3s ease, box-shadow 0.3s ease;
            }
            .info-item:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(138, 43, 226, 0.4);
            }
            .uptime {
                color: #E0B0FF;
                font-weight: bold;
                font-size: 1.3em;
                text-shadow: 0 0 10px rgba(224, 176, 255, 0.5);
            }
            .info-item div:last-child {
                color: #DA70D6;
                font-size: 0.9em;
                margin-top: 5px;
            }
            @keyframes pulse {
                0% { 
                    transform: scale(1);
                    box-shadow: 0 0 0 0 rgba(224, 176, 255, 0.7);
                }
                70% { 
                    transform: scale(1.05);
                    box-shadow: 0 0 0 15px rgba(224, 176, 255, 0);
                }
                100% { 
                    transform: scale(1);
                    box-shadow: 0 0 0 0 rgba(224, 176, 255, 0);
                }
            }
            .live {
                animation: pulse 3s infinite;
                color: #E0B0FF;
                font-weight: bold;
                display: inline-block;
                padding: 8px 16px;
                background: rgba(224, 176, 255, 0.2);
                border-radius: 20px;
                border: 1px solid #E0B0FF;
            }
            .nav-links {
                display: flex;
                justify-content: center;
                gap: 15px;
                margin-top: 25px;
                position: relative;
                z-index: 2;
            }
            .nav-link {
                color: #DA70D6;
                text-decoration: none;
                padding: 10px 20px;
                border: 1px solid #DA70D6;
                border-radius: 25px;
                transition: all 0.3s ease;
                font-size: 0.9em;
            }
            .nav-link:hover {
                background: rgba(218, 112, 214, 0.2);
                transform: translateY(-2px);
            }
            .footer {
                text-align: center;
                margin-top: 30px;
                color: #C9A0FF;
                font-size: 0.8em;
                position: relative;
                z-index: 2;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎮 Steam Hour Booster</h1>
                <p class="live">🟣 LIVE на Render.com | 24/7</p>
            </div>
            
            <div class="status">
                <h3>✨ Система активна и работает</h3>
                <p>Надежный фиолетовый бустер для Steam</p>
            </div>
            
            <div class="stats">
                <h3>📊 Статистика работы:</h3>
                <pre>${JSON.stringify({
                  platform: stats.platform,
                  uptime: `${hours}ч ${minutes}м ${seconds}с`,
                  total_requests: stats.requestCount,
                  start_time: stats.startTime.toLocaleString('ru-RU'),
                  current_time: new Date().toLocaleString('ru-RU'),
                  status: stats.status,
                  port: PORT
                }, null, 2)}</pre>
            </div>
            
            <div class="info">
                <div class="info-item">
                    <div class="uptime">${hours}ч</div>
                    <div>Время работы</div>
                </div>
                <div class="info-item">
                    <div class="uptime">${stats.requestCount}</div>
                    <div>Запросов</div>
                </div>
                <div class="info-item">
                    <div class="uptime">24/7</div>
                    <div>Режим</div>
                </div>
                <div class="info-item">
                    <div class="uptime">🟣</div>
                    <div>Фиолетовый</div>
                </div>
            </div>

            <div class="nav-links">
                <a href="/health" class="nav-link">❤️ Health</a>
                <a href="/ping" class="nav-link">🏓 Ping</a>
                <a href="/status" class="nav-link">📈 Status</a>
            </div>
            
            <div class="footer">
                <p>🎯 Steam Hour Booster | ✨ Фиолетовая тема | 🚀 Render.com</p>
            </div>
        </div>

        <script>
            // Авто-обновление каждые 30 секунд
            setTimeout(() => {
                window.location.reload();
            }, 30000);
            
            // Клиентский пинг каждые 25 секунд
            setInterval(() => {
                fetch('/ping').catch(e => console.log('Пинг...'));
            }, 25000);

            // Анимация появления элементов
            document.addEventListener('DOMContentLoaded', () => {
                const elements = document.querySelectorAll('.info-item, .status, .stats');
                elements.forEach((el, index) => {
                    setTimeout(() => {
                        el.style.opacity = '0';
                        el.style.transform = 'translateY(20px)';
                        el.style.transition = 'all 0.6s ease';
                        
                        setTimeout(() => {
                            el.style.opacity = '1';
                            el.style.transform = 'translateY(0)';
                        }, 50);
                    }, index * 200);
                });
            });
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((new Date() - stats.startTime) / 1000),
    platform: 'Render.com',
    message: '✅ Все системы работают нормально',
    theme: 'purple'
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    server: 'render-steam-booster',
    theme: '🟣 purple'
  });
});

app.get('/status', (req, res) => {
  res.json({
    ...stats,
    uptime: Math.floor((new Date() - stats.startTime) / 1000),
    environment: process.env.NODE_ENV || 'production',
    theme: {
      name: 'purple',
      colors: ['#8A2BE2', '#4B0082', '#9400D3', '#E0B0FF', '#DA70D6']
    }
  });
});

// Steam Bot логика
var username = 'tochka_bi_laik';
var password = 'JenyaKinel2023steam';
var shared_secret = '';
var games = [730]; // CS:GO
var status = 1;

var user = new steamUser();

user.logOn({
  "accountName": username,
  "password": password
});

user.on('loggedOn', () => {
  if (user.steamID != null) {
    console.log('✅ Steam Bot успешно вошел: ' + user.steamID);
    console.log('🎮 Запускаю игру: CS:GO');
  }
  user.setPersona(status);
  user.gamesPlayed(games);
});

user.on('error', (err) => {
  console.log('❌ Ошибка Steam Bot:', err);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🎨 Тема: Фиолетовая`);
  console.log(`⏰ Время запуска: ${new Date().toLocaleString('ru-RU')}`);
  console.log(`🎮 Steam Bot запускается...`);
});

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('💥 Непредвиденная ошибка:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Необработанный промис:', reason);
});
