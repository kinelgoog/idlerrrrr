const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// 🔐 Настройки безопасности
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"]
    }
  }
}));

app.use(express.json());
app.use(express.static('public'));

// 🎯 Лимит запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // максимум 100 запросов за 15 минут
});
app.use(limiter);

// 🔐 Сессии
app.use(session({
  secret: process.env.SESSION_SECRET || 'steam-booster-secret-key-' + uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 часа
  }
}));

// 🗄️ База данных
const db = new sqlite3.Database(':memory:'); // Для демо - в памяти. В продакшене замени на файл

// Инициализация БД
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS steam_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    account_name TEXT,
    password TEXT,
    shared_secret TEXT,
    steam_id TEXT,
    profile_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS farm_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_account_id INTEGER,
    start_time DATETIME,
    end_time DATETIME,
    hours_farmed REAL DEFAULT 0,
    status TEXT DEFAULT 'running',
    FOREIGN KEY(steam_account_id) REFERENCES steam_accounts(id)
  )`);
});

// 🎯 Класс для управления ботами пользователей
class UserBotManager {
  constructor() {
    this.userBots = new Map(); // user_id -> SteamFarmBot
  }

  getBot(userId) {
    return this.userBots.get(userId);
  }

  createBot(userId, steamConfig) {
    const bot = new SteamFarmBot(steamConfig);
    this.userBots.set(userId, bot);
    return bot;
  }

  removeBot(userId) {
    const bot = this.userBots.get(userId);
    if (bot) {
      bot.stopFarming();
      this.userBots.delete(userId);
    }
  }

  getBotStatus(userId) {
    const bot = this.userBots.get(userId);
    return bot ? bot.getStatus() : null;
  }
}

const botManager = new UserBotManager();

// 🤖 Улучшенный Steam Bot
class SteamFarmBot {
  constructor(config) {
    this.config = config;
    this.client = new steamUser({
      enablePicsCache: true,
      autoRelogin: true,
      dataDirectory: `./steamdata_${config.steam_id}`
    });
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.farmTracker = new FarmTimeTracker();
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('loggedOn', () => {
      console.log(`✅ Steam Bot ${this.config.steam_id} успешно вошел в систему`);
      this.reconnectAttempts = 0;
      
      this.client.setPersona(1);
      this.client.gamesPlayed(this.config.games, true);
      
      console.log(`🎮 Запускаю фарм часов для ${this.config.steam_id}...`);
      this.farmTracker.start();
      this.isRunning = true;
    });

    this.client.on('error', (err) => {
      console.log(`❌ Ошибка Steam Bot ${this.config.steam_id}:`, err);
      this.isRunning = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
        setTimeout(() => this.startFarming(), 15000);
      }
    });

    this.client.on('disconnected', (eresult, msg) => {
      console.log(`🔌 Steam Bot ${this.config.steam_id} отключен:`, eresult, msg);
      this.farmTracker.stop();
      this.isRunning = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`🔄 Автопереподключение ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
        setTimeout(() => this.startFarming(), 20000);
      }
    });

    // Защита от таймаута
    setInterval(() => {
      if (this.isRunning) {
        this.client.gamesPlayed(this.config.games, true);
      }
    }, 300000);
  }

  startFarming() {
    if (this.isRunning) return;

    console.log(`🚀 Запуск Steam Bot для ${this.config.account_name}...`);
    
    const logOnOptions = {
      accountName: this.config.account_name,
      password: this.config.password,
      rememberPassword: true
    };

    if (this.config.shared_secret) {
      logOnOptions.twoFactorCode = steamTotp.generateAuthCode(this.config.shared_secret);
    }

    this.client.logOn(logOnOptions);
  }

  stopFarming() {
    if (this.isRunning) {
      console.log(`🛑 Останавливаю фарм для ${this.config.account_name}...`);
      this.client.logOff();
      this.isRunning = false;
      this.farmTracker.stop();
      this.reconnectAttempts = 0;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      farmStatus: this.isRunning ? 'running' : 'stopped',
      farmedHours: this.farmTracker.getCurrentHours(),
      steamId: this.config.steam_id,
      profileName: this.config.profile_name,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

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

// 🔍 Улучшенный класс для получения данных Steam
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

// 🔐 Middleware для проверки авторизации
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Требуется авторизация' });
  }
}

// 🌐 Маршруты API

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    
    db.run(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ error: 'Пользователь уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка сервера' });
        }

        req.session.userId = this.lastID;
        res.json({ 
          success: true, 
          message: 'Регистрация успешна',
          userId: this.lastID 
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ?',
    [username],
    async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка сервера' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Неверные учетные данные' });
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Неверные учетные данные' });
      }

      req.session.userId = user.id;
      res.json({ 
        success: true, 
        message: 'Вход выполнен успешно',
        user: { id: user.id, username: user.username, email: user.email }
      });
    }
  );
});

// Выход
app.post('/api/logout', (req, res) => {
  const userId = req.session.userId;
  
  if (userId) {
    botManager.removeBot(userId);
  }
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка выхода' });
    }
    res.json({ success: true, message: 'Выход выполнен успешно' });
  });
});

// Добавление Steam аккаунта
app.post('/api/steam-accounts', requireAuth, (req, res) => {
  const { account_name, password, shared_secret, steam_id, profile_name } = req.body;

  if (!account_name || !password || !steam_id) {
    return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
  }

  db.run(
    'INSERT INTO steam_accounts (user_id, account_name, password, shared_secret, steam_id, profile_name) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.userId, account_name, password, shared_secret, steam_id, profile_name],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Ошибка сохранения аккаунта' });
      }

      res.json({ 
        success: true, 
        message: 'Steam аккаунт добавлен',
        accountId: this.lastID 
      });
    }
  );
});

// Получение Steam аккаунтов пользователя
app.get('/api/steam-accounts', requireAuth, (req, res) => {
  db.all(
    'SELECT * FROM steam_accounts WHERE user_id = ?',
    [req.session.userId],
    (err, accounts) => {
      if (err) {
        return res.status(500).json({ error: 'Ошибка получения аккаунтов' });
      }

      // Добавляем статус фарма для каждого аккаунта
      const accountsWithStatus = accounts.map(account => {
        const bot = botManager.getBot(req.session.userId);
        const farmStatus = bot && bot.config.steam_id === account.steam_id ? 
          bot.getStatus() : 
          { farmStatus: 'stopped', farmedHours: '0.0' };
        
        return {
          ...account,
          farmStatus: farmStatus.farmStatus,
          farmedHours: farmStatus.farmedHours
        };
      });

      res.json({ accounts: accountsWithStatus });
    }
  );
});

// Запуск фарма
app.post('/api/farm/start', requireAuth, (req, res) => {
  const { steam_account_id } = req.body;

  db.get(
    'SELECT * FROM steam_accounts WHERE id = ? AND user_id = ?',
    [steam_account_id, req.session.userId],
    (err, account) => {
      if (err || !account) {
        return res.status(404).json({ error: 'Аккаунт не найден' });
      }

      const steamConfig = {
        account_name: account.account_name,
        password: account.password,
        shared_secret: account.shared_secret,
        steam_id: account.steam_id,
        profile_name: account.profile_name,
        games: [730]
      };

      let bot = botManager.getBot(req.session.userId);
      if (!bot) {
        bot = botManager.createBot(req.session.userId, steamConfig);
      }

      bot.startFarming();

      res.json({
        success: true,
        message: 'Фарм часов запущен',
        steamId: account.steam_id
      });
    }
  );
});

// Остановка фарма
app.post('/api/farm/stop', requireAuth, (req, res) => {
  const bot = botManager.getBot(req.session.userId);
  
  if (bot) {
    bot.stopFarming();
    res.json({ success: true, message: 'Фарм часов остановлен' });
  } else {
    res.status(400).json({ error: 'Фарм не запущен' });
  }
});

// Статус фарма
app.get('/api/farm/status', requireAuth, (req, res) => {
  const bot = botManager.getBot(req.session.userId);
  const status = bot ? bot.getStatus() : { farmStatus: 'stopped', farmedHours: '0.0' };
  
  res.json(status);
});

// Получение часов CS2
app.get('/api/cs2-hours/:steamId', requireAuth, async (req, res) => {
  const { steamId } = req.params;
  
  try {
    const hours = await SteamDataFetcher.fetchCS2Hours(steamId);
    res.json({ 
      hours: hours,
      lastUpdate: new Date(),
      steamId: steamId
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// Проверка авторизации
app.get('/api/auth/check', (req, res) => {
  if (req.session.userId) {
    db.get(
      'SELECT id, username, email FROM users WHERE id = ?',
      [req.session.userId],
      (err, user) => {
        if (err || !user) {
          return res.json({ isAuthenticated: false });
        }
        res.json({ isAuthenticated: true, user: user });
      }
    );
  } else {
    res.json({ isAuthenticated: false });
  }
});

// 🎨 Главная страница
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Steam Hour Booster - Multi-user</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Inter', sans-serif; 
                background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
                color: #fff; min-height: 100vh; 
            }
            .container { 
                max-width: 1200px; 
                margin: 0 auto; 
                padding: 20px; 
                min-height: 100vh;
                display: flex;
                flex-direction: column;
            }
            .header { 
                text-align: center; 
                padding: 60px 20px; 
            }
            .header h1 { 
                font-size: 3.5rem; 
                font-weight: 800; 
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                -webkit-background-clip: text; 
                -webkit-text-fill-color: transparent;
                margin-bottom: 20px;
            }
            .header p { 
                font-size: 1.3rem; 
                color: #94A3B8; 
                max-width: 600px;
                margin: 0 auto;
            }
            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 30px;
                margin: 60px 0;
            }
            .feature-card {
                background: rgba(255,255,255,0.05);
                padding: 40px 30px;
                border-radius: 20px;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                transition: transform 0.3s ease;
            }
            .feature-card:hover {
                transform: translateY(-10px);
            }
            .feature-icon {
                font-size: 3rem;
                margin-bottom: 20px;
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .feature-card h3 {
                font-size: 1.5rem;
                margin-bottom: 15px;
                color: #fff;
            }
            .feature-card p {
                color: #94A3B8;
                line-height: 1.6;
            }
            .auth-buttons {
                display: flex;
                gap: 20px;
                justify-content: center;
                margin-top: 40px;
            }
            .btn {
                padding: 15px 30px;
                border: none;
                border-radius: 12px;
                font-size: 1.1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                text-decoration: none;
                display: inline-block;
            }
            .btn-primary {
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                color: white;
            }
            .btn-secondary {
                background: rgba(255,255,255,0.1);
                color: white;
                border: 1px solid rgba(255,255,255,0.2);
            }
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            .footer {
                text-align: center;
                margin-top: auto;
                padding: 40px 0;
                color: #64748B;
            }
            @media (max-width: 768px) {
                .header h1 { font-size: 2.5rem; }
                .auth-buttons { flex-direction: column; align-items: center; }
                .btn { width: 200px; text-align: center; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Steam Hour Booster</h1>
                <p>Мультипользовательская платформа для автоматического фарма часов в Steam играх. Безопасно, удобно, эффективно.</p>
                
                <div class="auth-buttons">
                    <a href="/login" class="btn btn-primary">
                        <i class="fas fa-sign-in-alt"></i> Войти
                    </a>
                    <a href="/register" class="btn btn-secondary">
                        <i class="fas fa-user-plus"></i> Регистрация
                    </a>
                </div>
            </div>

            <div class="features">
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <h3>Мультипользовательский</h3>
                    <p>Поддержка неограниченного количества пользователей и Steam аккаунтов</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-shield-alt"></i>
                    </div>
                    <h3>Безопасность</h3>
                    <p>Ваши данные защищены шифрованием и хранятся безопасно</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-infinity"></i>
                    </div>
                    <h3>24/7 Фарм</h3>
                    <p>Автоматическое переподключение и работа без остановок</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">
                        <i class="fas fa-tachometer-alt"></i>
                    </div>
                    <h3>Мониторинг</h3>
                    <p>Отслеживание прогресса и статистики в реальном времени</p>
                </div>
            </div>

            <div class="footer">
                <p>&copy; 2024 Steam Hour Booster. Все права защищены.</p>
            </div>
        </div>

        <script>
            // Проверяем авторизацию и перенаправляем если пользователь уже вошел
            fetch('/api/auth/check')
                .then(response => response.json())
                .then(data => {
                    if (data.isAuthenticated) {
                        window.location.href = '/dashboard';
                    }
                });
        </script>
    </body>
    </html>
  `);
});

// 📊 Страница регистрации
app.get('/register', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Регистрация - Steam Hour Booster</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Inter', sans-serif; 
                background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
                color: #fff; min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .auth-container {
                width: 100%;
                max-width: 400px;
            }
            .auth-card {
                background: rgba(255,255,255,0.05);
                padding: 40px;
                border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
            }
            .logo {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo h1 {
                font-size: 2rem;
                font-weight: 700;
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #94A3B8;
                font-weight: 500;
            }
            .form-group input {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 10px;
                background: rgba(255,255,255,0.1);
                color: #fff;
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            .form-group input:focus {
                outline: none;
                border-color: #8B5CF6;
                background: rgba(255,255,255,0.15);
            }
            .btn {
                width: 100%;
                padding: 14px;
                border: none;
                border-radius: 10px;
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                color: white;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 30px rgba(139, 92, 246, 0.3);
            }
            .auth-links {
                text-align: center;
                margin-top: 20px;
            }
            .auth-links a {
                color: #8B5CF6;
                text-decoration: none;
            }
            .message {
                padding: 10px;
                border-radius: 8px;
                margin-bottom: 20px;
                text-align: center;
                display: none;
            }
            .message.success {
                background: rgba(6, 214, 160, 0.2);
                border: 1px solid #06D6A0;
                color: #06D6A0;
            }
            .message.error {
                background: rgba(239, 71, 111, 0.2);
                border: 1px solid #EF476F;
                color: #EF476F;
            }
        </style>
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="logo">
                    <h1><i class="fas fa-robot"></i> Steam Booster</h1>
                </div>
                
                <div id="message" class="message"></div>
                
                <form id="registerForm">
                    <div class="form-group">
                        <label for="username">Имя пользователя</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="email">Email (опционально)</label>
                        <input type="email" id="email" name="email">
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Пароль</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    
                    <button type="submit" class="btn">
                        <i class="fas fa-user-plus"></i> Зарегистрироваться
                    </button>
                </form>
                
                <div class="auth-links">
                    <p>Уже есть аккаунт? <a href="/login">Войти</a></p>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('registerForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch('/api/register', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    const messageEl = document.getElementById('message');
                    messageEl.style.display = 'block';
                    
                    if (result.success) {
                        messageEl.className = 'message success';
                        messageEl.innerHTML = '<i class="fas fa-check-circle"></i> ' + result.message;
                        setTimeout(() => {
                            window.location.href = '/dashboard';
                        }, 1500);
                    } else {
                        messageEl.className = 'message error';
                        messageEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + result.error;
                    }
                } catch (error) {
                    const messageEl = document.getElementById('message');
                    messageEl.style.display = 'block';
                    messageEl.className = 'message error';
                    messageEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Ошибка соединения';
                }
            });

            // Проверяем авторизацию
            fetch('/api/auth/check')
                .then(response => response.json())
                .then(data => {
                    if (data.isAuthenticated) {
                        window.location.href = '/dashboard';
                    }
                });
        </script>
    </body>
    </html>
  `);
});

// 🔑 Страница входа
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Вход - Steam Hour Booster</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Inter', sans-serif; 
                background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
                color: #fff; min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .auth-container {
                width: 100%;
                max-width: 400px;
            }
            .auth-card {
                background: rgba(255,255,255,0.05);
                padding: 40px;
                border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
            }
            .logo {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo h1 {
                font-size: 2rem;
                font-weight: 700;
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #94A3B8;
                font-weight: 500;
            }
            .form-group input {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 10px;
                background: rgba(255,255,255,0.1);
                color: #fff;
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            .form-group input:focus {
                outline: none;
                border-color: #8B5CF6;
                background: rgba(255,255,255,0.15);
            }
            .btn {
                width: 100%;
                padding: 14px;
                border: none;
                border-radius: 10px;
                background: linear-gradient(135deg, #8B5CF6, #06D6A0);
                color: white;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 30px rgba(139, 92, 246, 0.3);
            }
            .auth-links {
                text-align: center;
                margin-top: 20px;
            }
            .auth-links a {
                color: #8B5CF6;
                text-decoration: none;
            }
            .message {
                padding: 10px;
                border-radius: 8px;
                margin-bottom: 20px;
                text-align: center;
                display: none;
            }
            .message.success {
                background: rgba(6, 214, 160, 0.2);
                border: 1px solid #06D6A0;
                color: #06D6A0;
            }
            .message.error {
                background: rgba(239, 71, 111, 0.2);
                border: 1px solid #EF476F;
                color: #EF476F;
            }
        </style>
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="logo">
                    <h1><i class="fas fa-robot"></i> Steam Booster</h1>
                </div>
                
                <div id="message" class="message"></div>
                
                <form id="loginForm">
                    <div class="form-group">
                        <label for="username">Имя пользователя</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Пароль</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    
                    <button type="submit" class="btn">
                        <i class="fas fa-sign-in-alt"></i> Войти
                    </button>
                </form>
                
                <div class="auth-links">
                    <p>Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    const messageEl = document.getElementById('message');
                    messageEl.style.display = 'block';
                    
                    if (result.success) {
                        messageEl.className = 'message success';
                        messageEl.innerHTML = '<i class="fas fa-check-circle"></i> ' + result.message;
                        setTimeout(() => {
                            window.location.href = '/dashboard';
                        }, 1500);
                    } else {
                        messageEl.className = 'message error';
                        messageEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + result.error;
                    }
                } catch (error) {
                    const messageEl = document.getElementById('message');
                    messageEl.style.display = 'block';
                    messageEl.className = 'message error';
                    messageEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Ошибка соединения';
                }
            });

            // Проверяем авторизацию
            fetch('/api/auth/check')
                .then(response => response.json())
                .then(data => {
                    if (data.isAuthenticated) {
                        window.location.href = '/dashboard';
                    }
                });
        </script>
    </body>
    </html>
  `);
});

// 📊 Личный кабинет (Dashboard)
app.get('/dashboard', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Личный кабинет - Steam Hour Booster</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            :root {
                --primary: #8B5CF6;
                --secondary: #06D6A0;
                --accent: #FFD166;
                --danger: #EF476F;
                --background: #0A0A1F;
                --surface: rgba(255, 255, 255, 0.05);
                --surface-hover: rgba(255, 255, 255, 0.08);
                --text: #F8FAFC;
                --text-secondary: #94A3B8;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
            }
            body { 
                font-family: 'Inter', sans-serif; 
                background: var(--background);
                color: var(--text);
                min-height: 100vh;
            }
            .navbar {
                background: var(--surface);
                backdrop-filter: blur(10px);
                padding: 15px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                position: sticky;
                top: 0;
                z-index: 1000;
            }
            .nav-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .logo {
                font-size: 1.5rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .nav-links {
                display: flex;
                gap: 30px;
                align-items: center;
            }
            .nav-links a {
                color: var(--text);
                text-decoration: none;
                transition: color 0.3s ease;
            }
            .nav-links a:hover {
                color: var(--primary);
            }
            .user-menu {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 40px 20px;
            }
            .dashboard-header {
                text-align: center;
                margin-bottom: 50px;
            }
            .dashboard-header h1 {
                font-size: 2.5rem;
                font-weight: 700;
                margin-bottom: 10px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .dashboard-header p {
                color: var(--text-secondary);
                font-size: 1.1rem;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 40px;
            }
            .stat-card {
                background: var(--surface);
                padding: 25px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.1);
                text-align: center;
            }
            .stat-value {
                font-size: 2rem;
                font-weight: 700;
                margin-bottom: 5px;
            }
            .stat-label {
                color: var(--text-secondary);
                font-size: 0.9rem;
            }
            .accounts-section {
                margin-bottom: 40px;
            }
            .section-header {
                display: flex;
                justify-content: between;
                align-items: center;
                margin-bottom: 20px;
            }
            .section-header h2 {
                font-size: 1.5rem;
                font-weight: 600;
            }
            .btn {
                padding: 10px 20px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .btn-primary {
                background: var(--primary);
                color: white;
            }
            .btn-success {
                background: var(--secondary);
                color: white;
            }
            .btn-danger {
                background: var(--danger);
                color: white;
            }
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            }
            .accounts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 20px;
            }
            .account-card {
                background: var(--surface);
                padding: 25px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .account-header {
                display: flex;
                justify-content: between;
                align-items: center;
                margin-bottom: 15px;
            }
            .account-name {
                font-weight: 600;
                font-size: 1.1rem;
            }
            .account-status {
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 600;
            }
            .status-farming {
                background: rgba(255, 209, 102, 0.2);
                color: var(--accent);
            }
            .status-stopped {
                background: rgba(148, 163, 184, 0.2);
                color: var(--text-secondary);
            }
            .account-details {
                margin-bottom: 15px;
            }
            .account-detail {
                display: flex;
                justify-content: between;
                margin-bottom: 5px;
            }
            .detail-label {
                color: var(--text-secondary);
            }
            .account-actions {
                display: flex;
                gap: 10px;
            }
            .account-actions .btn {
                flex: 1;
                text-align: center;
                justify-content: center;
            }
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }
            .modal-content {
                background: var(--surface);
                padding: 30px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.1);
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
            }
            .modal-header {
                display: flex;
                justify-content: between;
                align-items: center;
                margin-bottom: 20px;
            }
            .modal-header h3 {
                font-size: 1.3rem;
                font-weight: 600;
            }
            .close-modal {
                background: none;
                border: none;
                color: var(--text);
                font-size: 1.5rem;
                cursor: pointer;
            }
            .form-group {
                margin-bottom: 15px;
            }
            .form-group label {
                display: block;
                margin-bottom: 5px;
                color: var(--text-secondary);
                font-weight: 500;
            }
            .form-group input {
                width: 100%;
                padding: 10px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                background: rgba(255,255,255,0.1);
                color: var(--text);
            }
            .form-group input:focus {
                outline: none;
                border-color: var(--primary);
            }
            .message {
                padding: 10px;
                border-radius: 8px;
                margin-bottom: 15px;
                text-align: center;
                display: none;
            }
            .message.success {
                background: rgba(6, 214, 160, 0.2);
                border: 1px solid var(--secondary);
                color: var(--secondary);
            }
            .message.error {
                background: rgba(239, 71, 111, 0.2);
                border: 1px solid var(--danger);
                color: var(--danger);
            }
        </style>
    </head>
    <body>
        <nav class="navbar">
            <div class="nav-container">
                <div class="logo">
                    <i class="fas fa-robot"></i> Steam Booster
                </div>
                <div class="nav-links">
                    <a href="/dashboard">Главная</a>
                    <a href="#" onclick="showAddAccountModal()">Добавить аккаунт</a>
                    <div class="user-menu">
                        <span id="usernameDisplay"></span>
                        <button class="btn btn-danger" onclick="logout()">
                            <i class="fas fa-sign-out-alt"></i> Выйти
                        </button>
                    </div>
                </div>
            </div>
        </nav>

        <div class="container">
            <div class="dashboard-header">
                <h1>Личный кабинет</h1>
                <p>Управляйте вашими Steam аккаунтами и отслеживайте прогресс фарма</p>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="totalAccounts">0</div>
                    <div class="stat-label">Аккаунтов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="activeFarms">0</div>
                    <div class="stat-label">Активных фармов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="totalHours">0.0</div>
                    <div class="stat-label">Всего часов</div>
                </div>
            </div>

            <div class="accounts-section">
                <div class="section-header">
                    <h2>Мои Steam аккаунты</h2>
                    <button class="btn btn-primary" onclick="showAddAccountModal()">
                        <i class="fas fa-plus"></i> Добавить аккаунт
                    </button>
                </div>
                
                <div id="message" class="message"></div>
                
                <div class="accounts-grid" id="accountsGrid">
                    <!-- Аккаунты будут загружены здесь -->
                </div>
            </div>
        </div>

        <!-- Модальное окно добавления аккаунта -->
        <div id="addAccountModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Добавить Steam аккаунт</h3>
                    <button class="close-modal" onclick="closeAddAccountModal()">&times;</button>
                </div>
                <form id="addAccountForm">
                    <div class="form-group">
                        <label for="account_name">Логин Steam</label>
                        <input type="text" id="account_name" name="account_name" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Пароль</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <div class="form-group">
                        <label for="shared_secret">Shared Secret (опционально)</label>
                        <input type="text" id="shared_secret" name="shared_secret">
                    </div>
                    <div class="form-group">
                        <label for="steam_id">Steam ID</label>
                        <input type="text" id="steam_id" name="steam_id" required>
                    </div>
                    <div class="form-group">
                        <label for="profile_name">Имя профиля</label>
                        <input type="text" id="profile_name" name="profile_name">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">
                        <i class="fas fa-save"></i> Сохранить аккаунт
                    </button>
                </form>
            </div>
        </div>

        <script>
            let userData = null;
            let accounts = [];

            // Проверка авторизации и загрузка данных
            async function checkAuth() {
                try {
                    const response = await fetch('/api/auth/check');
                    const data = await response.json();
                    
                    if (!data.isAuthenticated) {
                        window.location.href = '/login';
                        return;
                    }
                    
                    userData = data.user;
                    document.getElementById('usernameDisplay').textContent = userData.username;
                    loadAccounts();
                    startStatusUpdates();
                } catch (error) {
                    console.error('Ошибка проверки авторизации:', error);
                    window.location.href = '/login';
                }
            }

            // Загрузка аккаунтов
            async function loadAccounts() {
                try {
                    const response = await fetch('/api/steam-accounts');
                    const data = await response.json();
                    
                    if (data.accounts) {
                        accounts = data.accounts;
                        renderAccounts();
                        updateStats();
                    }
                } catch (error) {
                    console.error('Ошибка загрузки аккаунтов:', error);
                    showMessage('Ошибка загрузки аккаунтов', 'error');
                }
            }

            // Отображение аккаунтов
            function renderAccounts() {
                const grid = document.getElementById('accountsGrid');
                
                if (accounts.length === 0) {
                    grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">У вас пока нет добавленных Steam аккаунтов</p>';
                    return;
                }
                
                grid.innerHTML = accounts.map(account => \`
                    <div class="account-card">
                        <div class="account-header">
                            <div class="account-name">\${account.profile_name || account.account_name}</div>
                            <div class="account-status \${account.farmStatus === 'running' ? 'status-farming' : 'status-stopped'}">
                                \${account.farmStatus === 'running' ? 'Фармит' : 'Остановлен'}
                            </div>
                        </div>
                        <div class="account-details">
                            <div class="account-detail">
                                <span class="detail-label">Steam ID:</span>
                                <span>\${account.steam_id}</span>
                            </div>
                            <div class="account-detail">
                                <span class="detail-label">Накручено часов:</span>
                                <span>\${account.farmedHours || '0.0'}</span>
                            </div>
                        </div>
                        <div class="account-actions">
                            \${account.farmStatus === 'running' ? 
                                \`<button class="btn btn-danger" onclick="stopFarming('\${account.steam_id}')">
                                    <i class="fas fa-stop"></i> Стоп
                                </button>\` :
                                \`<button class="btn btn-success" onclick="startFarming(\${account.id})">
                                    <i class="fas fa-play"></i> Старт
                                </button>\`
                            }
                        </div>
                    </div>
                \`).join('');
            }

            // Обновление статистики
            function updateStats() {
                document.getElementById('totalAccounts').textContent = accounts.length;
                document.getElementById('activeFarms').textContent = accounts.filter(a => a.farmStatus === 'running').length;
                document.getElementById('totalHours').textContent = accounts.reduce((sum, acc) => sum + parseFloat(acc.farmedHours || 0), 0).toFixed(1);
            }

            // Запуск фарма
            async function startFarming(accountId) {
                try {
                    const response = await fetch('/api/farm/start', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ steam_account_id: accountId })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showMessage('Фарм запущен успешно', 'success');
                        await loadAccounts();
                    } else {
                        showMessage(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка запуска фарма:', error);
                    showMessage('Ошибка запуска фарма', 'error');
                }
            }

            // Остановка фарма
            async function stopFarming(steamId) {
                try {
                    const response = await fetch('/api/farm/stop', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showMessage('Фарм остановлен', 'success');
                        await loadAccounts();
                    } else {
                        showMessage(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка остановки фарма:', error);
                    showMessage('Ошибка остановки фарма', 'error');
                }
            }

            // Выход
            async function logout() {
                try {
                    await fetch('/api/logout', { method: 'POST' });
                    window.location.href = '/';
                } catch (error) {
                    console.error('Ошибка выхода:', error);
                }
            }

            // Модальное окно добавления аккаунта
            function showAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'flex';
            }

            function closeAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'none';
            }

            // Добавление аккаунта
            document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    const response = await fetch('/api/steam-accounts', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showMessage('Аккаунт добавлен успешно', 'success');
                        closeAddAccountModal();
                        e.target.reset();
                        await loadAccounts();
                    } else {
                        showMessage(result.error, 'error');
                    }
                } catch (error) {
                    console.error('Ошибка добавления аккаунта:', error);
                    showMessage('Ошибка добавления аккаунта', 'error');
                }
            });

            // Показ сообщений
            function showMessage(text, type) {
                const messageEl = document.getElementById('message');
                messageEl.textContent = text;
                messageEl.className = \`message \${type}\`;
                messageEl.style.display = 'block';
                
                setTimeout(() => {
                    messageEl.style.display = 'none';
                }, 5000);
            }

            // Обновление статуса каждые 5 секунд
            function startStatusUpdates() {
                setInterval(async () => {
                    await loadAccounts();
                }, 5000);
            }

            // Инициализация
            checkAuth();
        </script>
    </body>
    </html>
  `);
});

// 🚀 Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Steam Hour Booster запущен на порту ${PORT}`);
  console.log(`🌐 Главная страница: http://localhost:${PORT}`);
  console.log(`📊 Личный кабинет: http://localhost:${PORT}/dashboard`);
  console.log('🔐 Мультипользовательская система активирована!');
});

// Обработка graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Остановка приложения...');
  // Останавливаем все боты
  botManager.userBots.forEach((bot, userId) => {
    bot.stopFarming();
  });
  process.exit(0);
});
