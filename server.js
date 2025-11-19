/**
 * ULTIMATE STEAM IDLER PRO (SQLite Edition - FINAL FIXED)
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

// --- CONFIG ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// --- DATABASE SETUP (SQLite) ---
const dbPath = path.join(__dirname, 'database.sqlite');
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
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

// Sync DB
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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 }
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
    const userId = user.id.toString();
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
        
        let cfg = user.config;
        if(typeof cfg === 'string') cfg = JSON.parse(cfg);
        
        client.setPersona(cfg.personaState || 1);
        const gamesToPlay = cfg.customGame ? [cfg.customGame, ...cfg.games] : cfg.games;
        client.gamesPlayed(gamesToPlay);
        
        bot.publicIP = details.publicIP ? parseIP(details.publicIP) : 'Hidden';
        
        log(userId, `🚀 Вход выполнен! IP: ${bot.publicIP}`, 'success');
        
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
            startBot(user);
        }
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

// ВОТ ЗДЕСЬ БЫЛА ОШИБКА, ТЕПЕРЬ ИСПРАВЛЕНО:
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user || !await bcrypt.compare(password, user.password)) return res.render('login', { error: 'Error' });
    req.session.userId = user.id;
    res.redirect('/');
});

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const count = await User.count();
    if(count >= 10) return res.render('register', { error: 'Full' });
    
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = await User.create({
            username: req.body.username,
            password: hashedPassword,
            isAdmin: count === 0
        });
        req.session.userId = user.id;
        res.redirect('/');
    } catch (e) { res.render('register', { error: 'Taken' }); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.post('/api/update', auth, async (req, res) => {
    const { steamLogin, steamPassword, sharedSecret, proxy, games, customGame, autoReply } = req.body;
    const gameIds = games.split(',').map(g => parseInt(g.trim())).filter(n => !isNaN(n));
    
    await User.update({
        steamLogin, steamPassword, sharedSecret, proxy,
        config: { games: gameIds, customGame, autoReply, personaState: 1 }
    }, { where: { id: req.session.userId } });
    
    res.json({ ok: true });
});

app.post('/api/action', auth, async (req, res) => {
    const { action, code } = req.body;
    const user = await User.findByPk(req.session.userId);
    const bot = getBotData(user.id.toString());

    if (action === 'start') startBot(user);
    if (action === 'stop') stopBot(user.id.toString());
    if (action === 'guard' && bot.guardCallback) {
        bot.guardCallback(code);
        bot.guardCallback = null;
        bot.status = 'Checking...';
        io.to(user.id.toString()).emit('status_update', bot.status);
    }
    res.json({ ok: true });
});

app.get('/api/my-games', auth, (req, res) => {
    const bot = getBotData(req.session.userId.toString());
    if(bot.client && bot.ownedGames) {
         return res.json({ games: bot.ownedGames });
    }
    res.json({ games: [] });
});

io.on('connection', (socket) => {
    socket.on('join', (uid) => socket.join(uid.toString()));
});

server.listen(PORT, () => console.log(`🚀 SQLite Idler running on ${PORT}`));
