const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Статистика
const stats = {
  startTime: new Date(),
  requestCount: 0,
  status: 'running'
};

// Middleware
app.use((req, res, next) => {
  stats.requestCount++;
  console.log(`📨 [${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// Маршруты
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🚂 Railway Booster</title>
        <meta charset="utf-8">
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 40px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white;
                text-align: center;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
            }
            .success {
                color: #00ff88;
                font-weight: bold;
                font-size: 24px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚂 Railway App</h1>
            <p class="success">✅ Работает 24/7 на Railway!</p>
            <p>Uptime: ${uptime} секунд</p>
            <p>Запросов: ${stats.requestCount}</p>
            <p>Порт: ${PORT}</p>
        </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'pong', server: 'railway' });
});

// Твой основной код Steam Booster
function startBooster() {
  setInterval(() => {
    console.log('🎮 Steam Booster работает...', new Date().toLocaleString('ru-RU'));
    // Твоя логика Steam API здесь
  }, 60000);
}

// Запуск
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('⏰ Время запуска:', new Date().toLocaleString('ru-RU'));

  // Запускаем основной функционал
  startBooster();
});
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const keep_alive = require('./keep_alive.js')

var username = 'tochka_bi_laik';
var password = 'JenyaKinel2023steam';
var shared_secret = '';

var games = [730];
var status = 1;


user = new steamUser();
user.logOn({"accountName": username, "password": password});
user.on('loggedOn', () => {
    if (user.steamID != null) console.log(user.steamID + ' - Successfully logged on');
    user.setPersona(status);               
    user.gamesPlayed(games);
});
