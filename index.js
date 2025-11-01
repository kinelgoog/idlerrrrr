// index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const pino = require('./src/utils/logger');
const DB = require('./src/db');
const BotManager = require('./src/botManager');

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_prod';
const DB_PATH = process.env.DB_PATH || './data/app.db';

(async () => {
  // Инициализация БД
  const db = await DB.init(DB_PATH);

  // Подготовка менеджера ботов (он загрузит аккаунты из БД / ENV)
  const manager = new BotManager(db);

  // Express
  const app = express();
  app.use(helmet());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  // Rate limiter для API
  const limiter = rateLimit({
    windowMs: 10 * 1000, // 10s
    max: 20, // limit each IP
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // Сессии для веб-панели (минимально)
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // в prod: secure: true + https
  }));

  // Статические файлы (frontend)
  app.use(express.static(path.join(__dirname, 'public')));

  // Middleware - защита API (API_KEY либо сессия)
  app.use('/api', (req, res, next) => {
    // allow if logged in via session
    if (req.session && req.session.loggedIn) return next();

    const token = req.headers['x-api-key'] || req.query.api_key;
    if (!API_KEY) {
      pino.warn('API_KEY not set — API is open to sessions only');
      return next();
    }
    if (!token || token !== API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
  });

  // Routes
  app.use('/api/auth', require('./src/routes/auth')(db));
  app.use('/api/farm', require('./src/routes/farm')(manager));
  app.use('/api/steam-guard', require('./src/routes/steamGuard')(manager));
  app.use('/api/status', require('./src/routes/status')(db, manager));

  // Health
  app.get('/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Start HTTP
  app.listen(PORT, '0.0.0.0', () => {
    pino.info(`🚀 Steam Hour Booster listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    pino.info('SIGINT received — stopping bots...');
    await manager.shutdownAll();
    process.exit(0);
  });
})();
