/**
 * ULTIMATE STEAM IDLER (Token Persistence Edition)
 * Вводишь код 1 раз -> Бот работает вечно.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const bcrypt = require('bcryptjs');
const { Sequelize, DataTypes } = require('sequelize');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const path = require('path');
const fs = require('fs');

// --- CONFIG ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// --- DATABASE ---
const dbPath = path.join(__dirname, 'database.sqlite');
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
});

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    steamLogin: { type: DataTypes.STRING, defaultValue: '' },
    steamPassword: { type: DataTypes.STRING, defaultValue: '' },
    sharedSecret: { type: DataTypes.STRING, defaultValue: '' },
    refreshToken: { type: DataTypes.STRING, defaultValue: '' }, // <--- ВОТ ГЛАВНАЯ ФИШКА
    proxy: { type: DataTypes.STRING, defaultValue: '' },
    config: { 
        type: DataTypes.JSON, 
        defaultValue: { games: [730], customGame: '', personaState: 1, autoReply: '' }
    },
    isRunning: { type: DataTypes.BOOLEAN, defaultValue: false },
    lastKnownIP: { type: DataTypes.STRING, defaultValue: 'Unknown' }
});

sequelize.sync(); // Создаст базу, если нет

const bots = new Map();

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'super_secret_key_x99',
    store: new SequelizeStore({ db: sequelize }),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 дней
}));

// --- HELPERS ---
const getBotData = (userId) => {
    if (!bots.has(userId)) bots.set(userId, { client: null, status: 'Stopped', logs: [], reconnectTimer: null });
    return bots.get(userId);
};

const log = (userId, msg, type = 'info') => {
    const bot = getBotData(userId);
    const time = new Date().toLocaleTimeString('ru-RU');
    bot.logs.push({ time, msg, type });
    if (bot.logs.length > 100) bot.logs.shift();
    io.to(userId).emit('new_log', { time, msg, type });
};

// --- ГЛАВНАЯ ЛОГИКА БОТА ---
async function startBot(user, manualCode = null) {
    const userId = user.id.toString();
    const bot = getBotData(userId);

    if (bot.client || bot.reconnectTimer) return;

    const options = {
        autoRelogin: true // Пусть либа сама пытается реконнектить при обрывах
    };
    if (user.proxy && user.proxy.length > 5) {
        options.httpProxy = user.proxy;
        log(userId, `🌐 Прокси включен`, 'warning');
    }

    const client = new SteamUser(options);
    bot.client = client;
    bot.status = 'Starting...';
    io.to(userId).emit('status_update', bot.status);

    // --- ЛОГИКА ВХОДА ---
    const logOnDetails = {
        accountName: user.steamLogin,
    };

    // 1. Если у нас уже есть ТОКЕН (мы входили раньше) - входим по нему
    if (user.refreshToken && user.refreshToken.length > 10) {
        logOnDetails.refreshToken = user.refreshToken;
        log(userId, `🔑 Вход по сохраненному токену... (Код не нужен)`, 'info');
    } 
    // 2. Иначе входим по паролю
    else {
        logOnDetails.password = user.steamPassword;
        
        // Если есть секрет - генерируем код
        if (user.sharedSecret && user.sharedSecret.length > 5) {
            try {
                logOnDetails.twoFactorCode = SteamTotp.generateAuthCode(user.sharedSecret);
                log(userId, `🔐 Auto-2FA сгенерирован`, 'success');
            } catch (e) {}
        }
        // Если ввели код вручную перед стартом
        else if (manualCode) {
            logOnDetails.twoFactorCode = manualCode;
            log(userId, `🔐 Использую введенный код`, 'info');
        }
    }

    client.logOn(logOnDetails);

    // --- СОБЫТИЯ ---

    // САМОЕ ВАЖНОЕ: Steam выдал нам новый токен. СОХРАНЯЕМ ЕГО!
    client.on('refreshToken', async (token) => {
        log(userId, `💾 Токен обновлен и сохранен в базу!`, 'success');
        await user.update({ refreshToken: token });
    });

    client.on('loggedOn', async (details) => {
        bot.status = 'Running';
        bot.startTime = Date.now();
        
        let cfg = user.config;
        if(typeof cfg === 'string') cfg = JSON.parse(cfg);
        
        client.setPersona(cfg.personaState || 1);
        const games = cfg.customGame ? [cfg.customGame, ...cfg.games] : cfg.games;
        client.gamesPlayed(games);
        
        log(userId, `🚀 Успешный вход!`, 'success');
        await user.update({ isRunning: true });
        io.to(userId).emit('status_update', bot.status);
    });

    client.on('steamGuard', (domain, callback, lastCodeWrong) => {
        if(lastCodeWrong) log(userId, `❌ Код не подошел!`, 'error');
        
        bot.status = 'Need 2FA';
        bot.guardCallback = callback;
        io.to(userId).emit('status_update', bot.status);
        io.to(userId).emit('request_guard', { domain });
        log(userId, `🛡 НУЖЕН КОД! Введите в панели.`, 'warning');
    });

    client.on('error', (err) => {
        log(userId, `❌ Ошибка: ${err.message}`, 'error');
        
        // Если токен протух - удаляем его, чтобы в следующий раз спросил пароль
        if (err.message.includes('InvalidPassword') || err.message.includes('LogonSessionReplaced')) {
             user.update({ refreshToken: '' });
             log(userId, `⚠ Токен сброшен. В следующий раз нужен пароль/код.`, 'warning');
        }

        handleDisconnect(userId, user, err);
    });

    client.on('disconnected', (res, msg) => {
        handleDisconnect(userId, user, { eresult: res, message: msg });
    });
}

function handleDisconnect(userId, user, error) {
    const bot = getBotData(userId);
    if(bot.client) { 
        bot.client.removeAllListeners(); 
        bot.client = null; 
    }
    
    const isKick = error.eresult === 6 || (error.message && error.message.includes('LoggedInElsewhere'));
    let delay = 30000; // 30 сек

    if (isKick) {
        delay = 600000; // 10 минут
        bot.status = 'Sleeping (Owner Playing)';
        log(userId, `🎮 Владелец играет. Жду 10 мин...`, 'warning');
    } else {
        bot.status = 'Reconnecting...';
        log(userId, `🔄 Реконнект через 30 сек...`, 'info');
    }
    
    io.to(userId).emit('status_update', bot.status);
    if(bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
    
    bot.reconnectTimer = setTimeout(() => {
        bot.reconnectTimer = null;
        User.findByPk(userId).then(u => {
            if(u && u.isRunning) startBot(u);
            else stopBot(userId);
        });
    }, delay);
}

function stopBot(userId) {
    const bot = getBotData(userId);
    if(bot.client) { bot.client.logOff(); bot.client = null; }
    if(bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
    
    bot.status = 'Stopped';
    User.findByPk(userId).then(u => u.update({ isRunning: false }));
    io.to(userId).emit('status_update', 'Stopped');
    log(userId, '🛑 Бот остановлен', 'error');
}

// Сторожевой пес (Watchdog)
setInterval(async () => {
    const users = await User.findAll({ where: { isRunning: true } });
    for(const u of users) {
        const b = getBotData(u.id.toString());
        if(!b.client && !b.reconnectTimer) startBot(u);
    }
}, 120000);

// --- ROUTES ---
const auth = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

app.get('/', auth, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const bot = getBotData(user.id.toString());
    if(typeof user.config === 'string') user.config = JSON.parse(user.config);
    res.render('dashboard', { user, bot });
});

app.post('/api/action', auth, async (req, res) => {
    const { action, code, guardCode } = req.body;
    const user = await User.findByPk(req.session.userId);
    const bot = getBotData(user.id.toString());

    if (action === 'start') startBot(user, guardCode);
    if (action === 'stop') stopBot(user.id.toString());
    if (action === 'guard' && bot.guardCallback) {
        bot.guardCallback(code);
        bot.guardCallback = null;
        bot.status = 'Checking...';
        io.to(user.id.toString()).emit('status_update', bot.status);
    }
    res.json({ ok: true });
});

app.post('/api/update', auth, async (req, res) => {
    const { steamLogin, steamPassword, sharedSecret, proxy, games } = req.body;
    const gameIds = games.split(',').map(g => parseInt(g)).filter(n => !isNaN(n));
    
    // Если меняем пароль - сбрасываем токен, чтобы перелогиниться
    const user = await User.findByPk(req.session.userId);
    let resetToken = user.steamPassword !== steamPassword; 
    
    await user.update({
        steamLogin, steamPassword, sharedSecret, proxy,
        refreshToken: resetToken ? '' : user.refreshToken,
        config: { games: gameIds, customGame: '', personaState: 1, autoReply: '' }
    });
    res.json({ ok: true });
});

app.get('/login', (req, res) => res.render('login', {error:null}));
app.post('/login', async (req, res) => {
    const user = await User.findOne({ where: { username: req.body.username } });
    if(user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user.id; res.redirect('/');
    } else res.render('login', {error:'Error'});
});

app.get('/register', (req, res) => res.render('register', {error:null}));
app.post('/register', async (req, res) => {
    if(await User.count() >= 10) return res.render('register', {error:'Full'});
    try {
        const user = await User.create({
            username: req.body.username,
            password: await bcrypt.hash(req.body.password, 10),
            isAdmin: (await User.count()) === 0
        });
        req.session.userId = user.id; res.redirect('/');
    } catch(e) { res.render('register', {error:'Taken'}); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/api/my-games', auth, (req,res) => {
    const b = getBotData(req.session.userId.toString());
    res.json({games: b.client ? b.client.getOwnedApps() : []});
});

io.on('connection', s => s.on('join', id => s.join(id)));
server.listen(PORT, () => console.log(`🚀 Ready on ${PORT}`));
