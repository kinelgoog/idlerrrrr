/**
 * ULTIMATE STEAM IDLER PRO v3.0 (10/10 Edition)
 * Features: Auto-2FA, Proxy, Game Selector, Watchdog, Smart Reconnect.
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const http = require('http');
const socketIo = require('socket.io');
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const bcrypt = require('bcryptjs');

// --- CONFIG ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// --- DATABASE MODELS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    steamLogin: { type: String, default: '' },
    steamPassword: { type: String, default: '' },
    sharedSecret: { type: String, default: '' }, // NEW: Для авто-2FA
    proxy: { type: String, default: '' }, // NEW: http://user:pass@ip:port
    config: {
        games: { type: [Number], default: [730] },
        customGame: { type: String, default: '' },
        personaState: { type: Number, default: 1 },
        autoReply: { type: String, default: '' }
    },
    isRunning: { type: Boolean, default: false },
    lastKnownIP: { type: String, default: 'Unknown' }
});
const User = mongoose.model('User', userSchema);

// --- BOT STORAGE ---
const bots = new Map(); 
// Structure: { client, community, status, logs[], startTime, reconnectAttempts }

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected (Atlas)'))
    .catch(err => console.error('❌ DB Error:', err));

app.use(session({
    secret: 'ultra_secure_phrase_xyz_123',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 } // 14 days
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
    const entry = { time, msg, type }; // type: info, success, error, warning
    bot.logs.push(entry);
    if (bot.logs.length > 100) bot.logs.shift();
    io.to(userId).emit('new_log', entry);
};

// --- CORE BOT LOGIC ---
async function startBot(user) {
    const userId = user._id.toString();
    const bot = getBotData(userId);

    if (bot.client) return; // Already running

    // Options configuration
    const options = {};
    if (user.proxy && user.proxy.trim().length > 5) {
        options.httpProxy = user.proxy; // Поддержка прокси
        log(userId, `🌐 Используется прокси`, 'warning');
    }

    const client = new SteamUser(options);
    const community = new SteamCommunity();
    
    bot.client = client;
    bot.status = 'Starting...';
    bot.reconnectAttempts = 0;
    io.to(userId).emit('status_update', bot.status);

    const logOnDetails = {
        accountName: user.steamLogin,
        password: user.steamPassword,
    };

    // AUTO 2FA LOGIC
    if (user.sharedSecret && user.sharedSecret.length > 5) {
        try {
            logOnDetails.twoFactorCode = SteamTotp.generateAuthCode(user.sharedSecret);
            log(userId, `🔐 Сгенерирован 2FA код: ${logOnDetails.twoFactorCode}`, 'success');
        } catch (e) {
            log(userId, `❌ Ошибка Shared Secret: ${e.message}`, 'error');
        }
    }

    client.logOn(logOnDetails);

    // Event Handlers
    client.on('loggedOn', async (details) => {
        bot.status = 'Running';
        bot.startTime = Date.now();
        bot.reconnectAttempts = 0;
        
        client.setPersona(user.config.personaState);
        const games = user.config.customGame ? [user.config.customGame, ...user.config.games] : user.config.games;
        client.gamesPlayed(games);
        
        // Get Public IP (for verification)
        bot.publicIP = details.publicIP ? parseIP(details.publicIP) : 'Hidden';
        
        log(userId, `🚀 Успешный вход! IP: ${bot.publicIP}`, 'success');
        log(userId, `🎮 Фармим: ${games.length} игр`, 'info');
        
        await User.findByIdAndUpdate(userId, { isRunning: true, lastKnownIP: bot.publicIP });
        io.to(userId).emit('status_update', bot.status);
        io.to(userId).emit('uptime_start', bot.startTime);
    });

    client.on('steamGuard', (domain, callback) => {
        if (user.sharedSecret) {
            // Should have handled in logOn, but if retry needed:
            const code = SteamTotp.generateAuthCode(user.sharedSecret);
            callback(code);
            log(userId, `🔐 Auto-2FA (Retry): ${code}`, 'warning');
        } else {
            bot.status = 'Need 2FA';
            bot.guardCallback = callback; // Save callback to call later from UI
            io.to(userId).emit('status_update', bot.status);
            io.to(userId).emit('request_guard', { domain });
            log(userId, `🛡 Жду код Steam Guard...`, 'warning');
        }
    });

    client.on('error', (err) => {
        log(userId, `❌ Ошибка: ${err.message}`, 'error');
        // Smart Reconnect Logic
        if (bot.reconnectAttempts < 5) {
            bot.reconnectAttempts++;
            const delay = bot.reconnectAttempts * 10000; // 10s, 20s, 30s...
            log(userId, `🔄 Переподключение через ${delay/1000} сек...`, 'warning');
            setTimeout(() => {
                if(bot.client) bot.client.logOff();
                bot.client = null;
                startBot(user);
            }, delay);
        } else {
            stopBot(userId);
        }
    });

    client.on('friendMessage', (senderID, message) => {
        log(userId, `📩 Сообщение от друга: ${message}`, 'info');
        if (user.config.autoReply) {
            client.chatMessage(senderID, user.config.autoReply);
        }
    });
    
    // NEW: Fetch User Games for the Selector
    client.on('ownershipCached', () => {
        const ownedGames = client.getOwnedApps().map(appId => ({
            id: appId,
            name: `AppID ${appId}` // steam-user doesn't give names, only IDs. 
            // In a real production 10/10 app, we would query SteamAPI to get names, 
            // but that requires an API Key. We will stick to IDs for reliability without API Key.
        }));
        bot.ownedGames = ownedGames; 
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
    User.findByIdAndUpdate(userId, { isRunning: false }).exec();
    io.to(userId).emit('status_update', bot.status);
    log(userId, '🛑 Бот остановлен', 'error');
}

function parseIP(ipInt) {
    return ( (ipInt>>>24) +'.' + (ipInt>>16 & 255) +'.' + (ipInt>>8 & 255) +'.' + (ipInt & 255) );
}

// --- WATCHDOG (THE KEEPER) ---
// Проверяет каждые 2 минуты. Если в базе написано isRunning, а бот не в сети -> запускает.
setInterval(async () => {
    const users = await User.find({ isRunning: true });
    users.forEach(user => {
        const bot = bots.get(user._id.toString());
        if (!bot || !bot.client) {
            console.log(`🐶 Watchdog: Reviving bot for ${user.username}`);
            startBot(user);
        }
    });
}, 120000); // 2 minutes

// --- ROUTES ---
const auth = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

app.get('/', auth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bot = getBotData(user._id.toString());
    res.render('dashboard', { user, bot });
});

// Admin Panel
app.get('/admin', auth, async (req, res) => {
    const currentUser = await User.findById(req.session.userId);
    if(!currentUser.isAdmin) return res.redirect('/');
    
    const allUsers = await User.find({});
    const systemStatus = allUsers.map(u => {
        const b = bots.get(u._id.toString());
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
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) return res.render('login', { error: 'Bad credentials' });
    req.session.userId = user._id.toString();
    res.redirect('/');
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
    const count = await User.countDocuments();
    if(count >= 10) return res.render('register', { error: 'Invite only (Max users reached)' }); // Limit for safety
    
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = await User.create({
            username: req.body.username,
            password: hashedPassword,
            isAdmin: count === 0
        });
        req.session.userId = user._id.toString();
        res.redirect('/');
    } catch (e) { res.render('register', { error: 'Username taken' }); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// API
app.post('/api/update', auth, async (req, res) => {
    const { steamLogin, steamPassword, sharedSecret, proxy, games, customGame, autoReply } = req.body;
    const gameIds = games.split(',').map(g => parseInt(g.trim())).filter(n => !isNaN(n));
    
    await User.findByIdAndUpdate(req.session.userId, {
        steamLogin, steamPassword, sharedSecret, proxy,
        config: { games: gameIds, customGame, autoReply, personaState: 1 }
    });
    
    res.json({ ok: true });
});

app.post('/api/action', auth, async (req, res) => {
    const { action, code } = req.body;
    const user = await User.findById(req.session.userId);
    const bot = getBotData(user._id.toString());

    if (action === 'start') startBot(user);
    if (action === 'stop') stopBot(user._id.toString());
    if (action === 'guard') {
        if (bot.guardCallback) {
            bot.guardCallback(code);
            bot.guardCallback = null;
            bot.status = 'Checking Code...';
            io.to(user._id.toString()).emit('status_update', bot.status);
        }
    }
    res.json({ ok: true });
});

app.get('/api/my-games', auth, (req, res) => {
    const bot = getBotData(req.session.userId);
    // Return cached games if bot ran at least once
    if(bot.client && bot.client.steamID) {
         // We get owned apps directly from steam-user memory
         const apps = bot.client.getOwnedApps();
         return res.json({ games: apps });
    }
    res.json({ games: [] });
});

// Socket
io.on('connection', (socket) => {
    socket.on('join', (uid) => socket.join(uid));
});

server.listen(PORT, () => console.log(`🚀 Ultimate Idler running on ${PORT}`));
