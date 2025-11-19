/**
 * ULTIMATE STEAM IDLER (QR Edition for Render)
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode'); // Рисовалка кодов
const { Sequelize, DataTypes } = require('sequelize');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// --- БАЗА ДАННЫХ ---
const dbPath = path.join(__dirname, 'database.sqlite');
const sequelize = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    steamLogin: { type: DataTypes.STRING, defaultValue: '' },
    refreshToken: { type: DataTypes.STRING, defaultValue: '' }, // Токен вместо пароля
    proxy: { type: DataTypes.STRING, defaultValue: '' },
    config: { type: DataTypes.JSON, defaultValue: { games: [730], customGame: '', autoReply: '' } },
    isRunning: { type: DataTypes.BOOLEAN, defaultValue: false }
});

sequelize.sync();
const bots = new Map();

// --- НАСТРОЙКИ СЕРВЕРА ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'qr_secret_key',
    store: new SequelizeStore({ db: sequelize }),
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// --- ЛОГИКА БОТА ---
const getBot = (uid) => {
    if (!bots.has(uid)) bots.set(uid, { client: null, status: 'Stopped', logs: [], reconnectTimer: null });
    return bots.get(uid);
};

const log = (uid, msg, type='info') => {
    const b = getBot(uid);
    const entry = { time: new Date().toLocaleTimeString('ru-RU'), msg, type };
    b.logs.push(entry);
    if(b.logs.length > 50) b.logs.shift();
    io.to(uid).emit('new_log', entry);
};

async function startBot(user) {
    const uid = user.id.toString();
    const bot = getBot(uid);

    if (bot.client) return;

    const options = { autoRelogin: true };
    if (user.proxy) {
        options.httpProxy = user.proxy;
        log(uid, '🌐 Использую Proxy', 'warning');
    }

    const client = new SteamUser(options);
    bot.client = client;
    bot.status = 'Starting...';
    io.to(uid).emit('status_update', bot.status);

    // ЛОГИКА ВХОДА
    const details = { accountName: user.steamLogin };

    // 1. Если есть токен - входим тихо
    if (user.refreshToken) {
        details.refreshToken = user.refreshToken;
        log(uid, '🔑 Вхожу по сохраненному токену...', 'info');
    } 
    // 2. Если токена нет - НЕ ПЕРЕДАЕМ ПАРОЛЬ. Это заставит Steam дать QR-код.
    else {
        log(uid, '📷 Запрашиваю QR-код у Steam...', 'info');
    }

    client.logOn(details);

    // --- СОБЫТИЯ ---

    // Генерируем QR для сайта
    client.on('qrCode', (url) => {
        bot.status = 'Scan QR Code';
        io.to(uid).emit('status_update', bot.status);
        log(uid, '👇 СКАНИРУЙ QR КОД НА ЭКРАНЕ 👇', 'warning');
        
        // Превращаем ссылку в картинку
        QRCode.toDataURL(url, (err, src) => {
            if(!err) io.to(uid).emit('show_qr', src);
        });
    });

    client.on('refreshToken', async (token) => {
        await user.update({ refreshToken: token });
        log(uid, '💾 Токен сохранен! В следующий раз QR не нужен.', 'success');
    });

    client.on('loggedOn', async () => {
        bot.status = 'Running';
        io.to(uid).emit('hide_qr'); // Скрыть QR
        
        let cfg = typeof user.config === 'string' ? JSON.parse(user.config) : user.config;
        client.setPersona(1);
        client.gamesPlayed(cfg.games || [730]);
        
        await user.update({ isRunning: true });
        log(uid, '🚀 Успешный вход!', 'success');
        io.to(uid).emit('status_update', 'Running');
    });

    client.on('error', (err) => {
        log(uid, `❌ Ошибка: ${err.message}`, 'error');
        if(err.message.includes('RateLimit')) {
             bot.status = 'Rate Limit (Wait)';
             log(uid, '⏳ IP забанен (Rate Limit). Жди или меняй Proxy.', 'error');
        }
        stopBot(uid);
    });

    client.on('disconnected', (res, msg) => {
        log(uid, `🔌 Дисконект: ${msg}. Реконнект...`, 'warning');
        // Простой реконнект через 30 сек
        if(!bot.reconnectTimer) {
            bot.reconnectTimer = setTimeout(() => {
                bot.reconnectTimer = null;
                if(bot.client) { bot.client.removeAllListeners(); bot.client = null; }
                User.findByPk(user.id).then(u => { if(u.isRunning) startBot(u); });
            }, 30000);
        }
    });
}

function stopBot(uid) {
    const bot = getBot(uid);
    if(bot.client) { bot.client.logOff(); bot.client = null; }
    bot.status = 'Stopped';
    User.findByPk(uid).then(u => u.update({ isRunning: false }));
    io.to(uid).emit('status_update', 'Stopped');
    io.to(uid).emit('hide_qr');
}

// Watchdog
setInterval(async () => {
    const users = await User.findAll({ where: { isRunning: true } });
    users.forEach(u => {
        const b = getBot(u.id.toString());
        if(!b.client) startBot(u);
    });
}, 120000);

// --- API ---
const auth = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

app.get('/', auth, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const bot = getBot(user.id.toString());
    if(typeof user.config === 'string') user.config = JSON.parse(user.config);
    res.render('dashboard', { user, bot });
});

app.post('/api/action', auth, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    if(req.body.action === 'start') startBot(user);
    if(req.body.action === 'stop') stopBot(user.id.toString());
    res.json({ok: true});
});

app.post('/api/update', auth, async (req, res) => {
    const { steamLogin, proxy, games } = req.body;
    const gameIds = games.split(',').map(g => parseInt(g)).filter(n => !isNaN(n));
    await User.update({ 
        steamLogin, proxy, 
        config: { games: gameIds } 
    }, { where: { id: req.session.userId } });
    res.json({ ok: true });
});

// Auth Routes
app.get('/login', (req, res) => res.render('login', {error:null}));
app.post('/login', async (req, res) => {
    const user = await User.findOne({ where: { username: req.body.username } });
    if(user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user.id; res.redirect('/');
    } else res.render('login', {error:'Error'});
});

app.get('/register', (req, res) => res.render('register', {error:null}));
app.post('/register', async (req, res) => {
    if(await User.count() >= 5) return res.render('register', {error:'Full'});
    const user = await User.create({
        username: req.body.username,
        password: await bcrypt.hash(req.body.password, 10),
        isAdmin: (await User.count()) === 0
    });
    req.session.userId = user.id; res.redirect('/');
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

io.on('connection', s => s.on('join', id => s.join(id)));
server.listen(PORT, () => console.log(`🚀 QR Idler running on ${PORT}`));
    res.json({games: b.client ? b.client.getOwnedApps() : []});
});
