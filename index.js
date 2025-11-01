require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const logger = require('./utils/logger'); // <-- исправлено
const DB = require('./db');               // <-- исправлено
const BotManager = require('./botManager');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 10000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this';
const DB_PATH = process.env.DB_PATH || './data/app.db';

(async () => {
  const db = await DB.init(DB_PATH);
  const manager = new BotManager(db);

  const app = express();
  app.use(helmet());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser());

  const limiter = rateLimit({ windowMs: 10000, max: 50 });
  app.use('/api', limiter);

  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  app.use(express.static(path.join(__dirname, 'public')));

  // routes
  app.use('/api/auth', require('./src/routes/auth')(db));
  app.use('/api/user', require('./src/routes/user')(db));
  app.use('/api/steam-accounts', require('./src/routes/steamAccounts')(db, manager));
  app.use('/api/farm', require('./src/routes/farm')(manager));
  app.use('/api/steam-guard', require('./src/routes/steamGuard')(manager));
  app.use('/api/status', require('./src/routes/status')(db));

  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server listening on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT - shutting down bots...');
    await manager.shutdownAll();
    process.exit(0);
  });
})();
