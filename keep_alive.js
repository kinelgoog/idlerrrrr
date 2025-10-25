const express = require('express');
const app = express();
const PORT = 8080; // Используем порт 8080 из твоей конфигурации

// ==================== КОНФИГУРАЦИЯ ====================
const config = {
  pingInterval: 30000,      // Пинг каждые 30 секунд
  logInterval: 60000,       // Лог каждые 60 секунд  
  maxErrors: 10,            // Максимум ошибок перед перезапуском
  restartDelay: 5000        // Задержка перезапуска
};

// ==================== СТАТИСТИКА ====================
let stats = {
  startTime: new Date(),
  totalUptime: 0,
  requestCount: 0,
  errorCount: 0,
  lastActivity: new Date(),
  status: 'running'
};

// ==================== ВЕБ-СЕРВЕР ====================
app.use((req, res, next) => {
  stats.requestCount++;
  stats.lastActivity = new Date();
  console.log(`📨 [${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🛡️ Always-On PROTECTED</title>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="30">
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 40px;
                background: linear-gradient(135deg, #1e3c72, #2a5298);
                color: white;
                text-align: center;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
            }
            .stats {
                background: rgba(0,0,0,0.3);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
                text-align: left;
            }
            .live {
                color: #00ff88;
                font-weight: bold;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.7; }
                100% { opacity: 1; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🛡️ Always-On PROTECTED</h1>
            <p class="live">🔴 LIVE | Страница обновляется каждые 30 секунд</p>

            <div class="stats">
                <h3>📊 Статистика работы:</h3>
                <pre>${JSON.stringify({
                  uptime: `${uptime} секунд`,
                  requests: stats.requestCount,
                  errors: stats.errorCount,
                  lastActivity: stats.lastActivity.toLocaleString('ru-RU'),
                  status: stats.status
                }, null, 2)}</pre>
            </div>

            <p>⏰ Серверное время: ${new Date().toLocaleString('ru-RU')}</p>
            <p>🔄 Авто-обновление: каждые 30 секунд</p>
        </div>

        <script>
            // Клиентский пинг каждые 25 секунд
            setInterval(() => {
                fetch('/ping').catch(e => console.log('Пинг не удался'));
            }, 25000);

            // Показываем время клиента
            function updateClientTime() {
                document.getElementById('clientTime').textContent = new Date().toLocaleString('ru-RU');
            }
            setInterval(updateClientTime, 1000);
            updateClientTime();
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

app.get('/health', (req, res) => {
  stats.lastActivity = new Date();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((new Date() - stats.startTime) / 1000),
    requests: stats.requestCount
  });
});

app.get('/ping', (req, res) => {
  stats.lastActivity = new Date();
  res.json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    server: 'always-on-protected'
  });
});

app.get('/status', (req, res) => {
  stats.lastActivity = new Date();
  res.json({
    ...stats,
    uptime: Math.floor((new Date() - stats.startTime) / 1000),
    config: config
  });
});

// ==================== СИСТЕМА МОНИТОРИНГА ====================

// 1. Периодическое логирование
function startLogging() {
  setInterval(() => {
    const uptime = Math.floor((new Date() - stats.startTime) / 1000);
    console.log(`✅ [${new Date().toLocaleString('ru-RU')}] SERVER ACTIVE | Uptime: ${uptime}s | Requests: ${stats.requestCount} | Errors: ${stats.errorCount}`);
  }, config.logInterval);
}

// 2. Самопинг на разные эндпоинты
function startSelfPinging() {
  setInterval(() => {
    const endpoints = ['/ping', '/health', '/status', '/'];
    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

    fetch(`http://localhost:${PORT}${randomEndpoint}`)
      .then(() => {
        stats.lastActivity = new Date();
      })
      .catch(err => {
        stats.errorCount++;
        console.log(`⚠️ Самопинг не удался: ${err.message}`);

        // Если много ошибок - перезапускаем
        if (stats.errorCount > config.maxErrors) {
          console.log('🔄 Слишком много ошибок, перезапускаем...');
          process.exit(1);
        }
      });
  }, config.pingInterval);
}

// 3. Внешний пинг через fetch
function startExternalPing() {
  setInterval(() => {
    // Пингуем сами себя как внешний сервис
    const fetch = require('node-fetch');
    if (typeof fetch === 'function') {
      fetch(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`)
        .then(() => console.log('🌐 Внешний пинг успешен'))
        .catch(() => console.log('🌐 Внешний пинг не удался'));
    }
  }, 120000); // Каждые 2 минуты
}

// 4. Защита от бездействия
function startActivityMonitor() {
  setInterval(() => {
    const inactiveTime = (new Date() - stats.lastActivity) / 1000;
    if (inactiveTime > 300) { // 5 минут без активности
      console.log('🔄 Слишком долго без активности, делаем самопинг...');
      fetch(`http://localhost:${PORT}/ping`).catch(() => {});
    }
  }, 60000);
}

// ==================== ЗАПУСК СИСТЕМЫ ====================

function startServer() {
  console.log('🚀 ЗАПУСКАЕМ УСИЛЕННЫЙ СЕРВЕР...');
  console.log('🛡️  Многоуровневая защита активирована');
  console.log('📊 Порты: 8080 (веб)');
  console.log('⏰ Время запуска:', new Date().toLocaleString('ru-RU'));

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
    console.log(`📱 URL: https://d103a90f-e565-4e32-9279-3eac0a9aea3c-00-3jvlshoklfvkh.pike.replit.dev`);

    // Запускаем все системы мониторинга
    startLogging();
    startSelfPinging();
    startActivityMonitor();

    // Пробуем запустить внешний пинг
    try {
      startExternalPing();
    } catch (e) {
      console.log('⚠️ Внешний пинг не доступен');
    }
  });

  // Обработка ошибок сервера
  server.on('error', (err) => {
    console.error('💥 Ошибка сервера:', err);
    stats.errorCount++;

    if (stats.errorCount > config.maxErrors) {
      console.log('🔄 Перезапуск из-за ошибок...');
      setTimeout(() => process.exit(1), config.restartDelay);
    }
  });
}

// ==================== ОБРАБОТКА ОШИБОК ====================

process.on('uncaughtException', (error) => {
  console.error('💥 КРИТИЧЕСКАЯ ОШИБКА:', error);
  console.log('🔄 Экстренный перезапуск через 10 секунд...');
  setTimeout(() => process.exit(1), 10000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Необработанный промис:', reason);
  stats.errorCount++;
});

// ==================== ЗАПУСК ====================

// Немедленный запуск
startServer();

// Дополнительная защита: перезапуск каждые 6 часов
setInterval(() => {
  console.log('🔄 Плановый перезапуск...');
  process.exit(0);
}, 6 * 60 * 60 * 1000);