/**
 * ULTIMATE STEAM IDLER PRO (SQLite Edition)
 * No external DB required. Data is stored in 'database.sqlite'.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
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

// --- DATABASE SETUP (SQLite) ---
// Создаем файл базы данных прямо в папке проекта
const dbPath = path.join(__dirname, 'database.sqlite');
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false // Отключаем мусор в консоли
});

// --- MODELS ---
const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    steamLogin: { type: DataTypes.STRING, defaultValue: '' },
    steamPassword: { type: DataTypes.STRING, defaultValue: '' },
    sharedSecret: { type: DataTypes.STRING, defaultValue: '' },
    proxy: { type: DataTypes.STRING, defaultValue: '' },
    // В SQLite нет массивов, храним JSON как строку
    config: { 
        type: DataTypes.JSON, 
        defaultValue: {
            games: [730],
            customGame: '',
            personaState: 1,
            autoReply: ''
        }
    },
    isRunning: { type: DataTypes.BOOLEAN, defaultValue: false },
    lastKnownIP: { type: DataTypes.STRING, defaultValue: 'Unknown' }
});

// Синхронизация БД (создаст файл если его нет)
sequelize.sync()
    .then(() => console.log('✅ SQLite Database Ready'))
    .catch(err => console.error('❌ DB Error:', err));

// --- BOT STORAGE ---
const bots = new Map();

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'sqlite_secret_key_999',
    store: new SequelizeStore({ db: sequelize }),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 } // 14 дней
}));

// --- HELPER FUNCTIONS ---
const getBotData = (userId) => {
    if (!bots.has(userId)) {
        bots.set(userId, { 
            client: null, 
            status: 'Stopped', 
            logs: [], 
            startTime: null,
            reconnectAttempts: 0
        });
    }
    return bots.get(userId);
};

const log = (userId, msg, type = 'info') => {
    const bot = getBotData(userId);
    const time = new Date().toLocaleTimeString('ru-RU');
    const entry = { time, msg, type };
    bot.logs.push(entry);
    if (bot.logs.length > 100) bot.logs.shift();
    io.to(userId).emit('new_log', entry);
};

// --- CORE BOT LOGIC ---
async function startBot(user) {
    const userId = user.id.toString(); // Sequelize использует .id (number), переводим в string для Map
    const bot = getBotData(userId);

    if (bot.client) return;

    const options = {};
    if (user.proxy && user.proxy.trim().length > 5) {
        options.httpProxy = user.proxy;
        log(userId, `🌐 Используется прокси`, 'warning');
    }

    const client = new SteamUser(options);
    
    bot.client = client;
    bot.status = 'Starting...';
    bot.reconnectAttempts = 0;
    io.to(userId).emit('status_update', bot.status);

    const logOnDetails = {
        accountName: user.steamLogin,
        password: user.steamPassword,
    };

    if (user.sharedSecret && user.sharedSecret.length > 5) {
        try {
            logOnDetails.twoFactorCode = SteamTotp.generateAuthCode(user.sharedSecret);
            log(userId, `🔐 Сгенерирован 2FA код`, 'success');
        } catch (e) {
            log(userId, `❌ Ошибка Shared Secret`, 'error');
        }
    }

    client.logOn(logOnDetails);

    client.on('loggedOn', async (details) => {
        bot.status = 'Running';
        bot.startTime = Date.now();
        bot.reconnectAttempts = 0;
        
        // Достаем конфиг из JSON
        const cfg = typeof user.config === 'string' ? JSON.parse(user.config) : user.config;
        
        client.setPersona(cfg.personaState || 1);
        const gamesToPlay = cfg.customGame ? [cfg.customGame, ...cfg.games] : cfg.games;
        client.gamesPlayed(gamesToPlay);
        
        bot.publicIP = details.publicIP ? parseIP(details.publicIP) : 'Hidden';
        
        log(userId, `🚀 Вход выполнен! IP: ${bot.publicIP}`, 'success');
        log(userId, `🎮 Игр запущено: ${gamesToPlay.length}`, 'info');
        
        await user.update({ isRunning: true, lastKnownIP: bot.publicIP });
        io.to(userId).emit('status_update', bot.status);
        io.to(userId).emit('uptime_start', bot.startTime);
    });

    client.on('steamGuard', (domain, callback) => {
        if (user.sharedSecret) {
             const code = SteamTotp.generateAuthCode(user.sharedSecret);
             callback(code);
        } else {
            bot.status = 'Need 2FA';
            bot.guardCallback = callback;
            io.to(userId).emit('status_update', bot.status);
            io.to(userId).emit('request_guard', { domain });
            log(userId, `🛡 Введите код Steam Guard`, 'warning');
        }
    });

    client.on('error', (err) => {
        log(userId, `❌ Ошибка Steam: ${err.message}`, 'error');
        if (bot.reconnectAttempts < 5) {
            bot.reconnectAttempts++;
            const delay = bot.reconnectAttempts * 10000;
            log(userId, `🔄 Реконнект через ${delay/1000} сек...`, 'warning');
            setTimeout(() => {
                if(bot.client) { try{bot.client.logOff();}catch(e){} bot.client = null; }
                startBot(user);
            }, delay);
        } else {
            stopBot(userId);
        }
    });
    
    // Fetch Games Handler
    client.on('ownershipCached', () => {
        bot.ownedGames = client.getOwnedApps();
    });
}

function stopBot(userId) {
    const bot = getBotData(userId);
    if (bot.client) {
        bot.client.logOff();
        bot.client = null;
    }
    bot.status = 'Stopped';
    bot.startTime = null;
    
    User.findByPk(userId).then(u => u.update({ isRunning: false }));
    
    io.to(userId).emit('status_update', bot.status);
    log(userId, '🛑 Бот остановлен', 'error');
}

function parseIP(ipInt) {
    return ( (ipInt>>>24) +'.' + (ipInt>>16 & 255) +'.' + (ipInt>>8 & 255) +'.' + (ipInt & 255) );
}

// --- WATCHDOG ---
setInterval(async () => {
    const users = await User.findAll({ where: { isRunning: true } });
    for (const user of users) {
        const bot = bots.get(user.id.toString());
        if (!bot || !bot.client) {
            console.log(`🐶 Watchdog: Reviving bot for ${user.username}`);
            startBot(user);
        }
    }
}, 120000);

// --- ROUTES ---
const auth = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

app.get('/', auth, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const bot = getBotData(user.id.toString());
    // Исправление для EJS: если config строка, парсим
    if(typeof user.config === 'string') user.config = JSON.parse(user.config);
    res.render('dashboard', { user, bot });
});

app.get('/admin', auth, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    if(!user.isAdmin) return res.redirect('/');
    
    const allUsers = await User.findAll();
    const systemStatus = allUsers.map(u => {
        const b = bots.get(u.id.toString());
        return {
            username: u.username,
            status: b ? b.status : 'Stopped',
            proxy: u.proxy ? 'Yes' : 'No'
        };
    });
    res.render('admin', { users: systemStatus });
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user || !awa
