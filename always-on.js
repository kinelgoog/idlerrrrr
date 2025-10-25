// Always-On модуль для Replit
// Просто импортируй этот файл в твой index.js

const express = require('express');
const app = express();

// Статистика работы
const stats = {
  startTime: new Date(),
  requestCount: 0,
  status: 'running',
  project: 'Always-On Helper'
};

// Middleware для логирования
app.use((req, res, next) => {
  stats.requestCount++;
  console.log(`📨 [${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// Основные маршруты
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🤖 Always-On</title>
        <meta charset="utf-8">
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 40px;
                background: #1a1a1a;
                color: white;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background: #2a2a2a;
                border-radius: 10px;
            }
            .stats {
                background: #333;
                padding: 15px;
                border-radius: 5px;
                margin: 15px 0;
            }
            .success {
                color: #00ff88;
                font-weight: bold;
            }
            a {
                color: #00ff88;
                margin: 0 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 Always-On Активен</h1>
            <p class="success">✅ Сервер работает 24/7</p>

            <div class="stats">
                <h3>📊 Статистика:</h3>
                <pre>${JSON.stringify({
                  uptime: `${uptime} секунд`,
                  requests: stats.requestCount,
                  startTime: stats.startTime.toLocaleString('ru-RU')
                }, null, 2)}</pre>
            </div>

            <p>
                <a href="/health">Health</a>
                <a href="/ping">Ping</a>
                <a href="/status">Status</a>
            </p>
        </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((new Date() - stats.startTime) / 1000)
  });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'pong', time: new Date().toISOString() });
});

app.get('/status', (req, res) => {
  res.json(stats);
});

// Фоновая задача для поддержания активности
function startBackgroundTasks() {
  // Периодическая проверка
  setInterval(() => {
    const uptime = Math.floor((new Date() - stats.startTime) / 1000);
    console.log(`✅ [${new Date().toLocaleTimeString()}] Always-On активен | Uptime: ${uptime}с | Запросов: ${stats.requestCount}`);
  }, 60000); // Каждые 60 секунд

  // Самопинг каждые 5 минут
  setInterval(() => {
    try {
      fetch(`http://localhost:5000/ping`)
        .then(() => console.log('🔄 Самопинг успешен'))
        .catch(() => console.log('⚠️ Самопинг не удался'));
    } catch (e) {
      // Игнорируем ошибки самопинга
    }
  }, 300000);
}

// Запуск сервера
function startServer(port = 5000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`🚀 Always-On сервер запущен на порту ${port}`);
        console.log(`⏰ Время запуска: ${stats.startTime.toLocaleString('ru-RU')}`);
        resolve(server);
      }
    });
  });
}

// Экспортируем для использования в основном файле
module.exports = {
  startServer,
  startBackgroundTasks,
  stats,
  app
};