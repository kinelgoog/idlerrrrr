// index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const logger = require('./src/utils/logger');
const DB = require('./src/db');
const BotManager = require('./src/botManager');

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_prod';
const DB_PATH = process.env.DB_PATH || './data/app.db';

(async () => {
  const db = await DB.init(DB_PATH);
  const manager = new BotManager(db);

  const app = express();
  app.use(helmet());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  const limiter = rateLimit({
    windowMs: 10 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  app.use(express.static(path.join(__dirname, 'public')));

  // API auth middleware (API_KEY or session)
  app.use('/api', (req, res, next) => {
    if (req.session && req.session.loggedIn) return next();
    if (!API_KEY) return next();
    const token = req.headers['x-api-key'] || req.query.api_key;
    if (!token || token !== API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
  });

  app.use('/api/auth', require('./src/routes/auth')(db));
  app.use('/api/farm', require('./src/routes/farm')(manager));
  app.use('/api/steam-guard', require('./src/routes/steamGuard')(manager));
  app.use('/api/status', require('./src/routes/status')(db, manager));

  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Steam Hour Booster listening on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received — stopping bots...');
    await manager.shutdownAll();
    process.exit(0);
  });
})();
