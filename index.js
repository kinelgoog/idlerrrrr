const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'kinel-secret-key-2024';

// Простая функция хеширования пароля
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

// Простая JWT реализация
function createToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = crypto.createHmac('sha256', JWT_SECRET)
        .update(header + '.' + payloadEncoded)
        .digest('base64');
    return header + '.' + payloadEncoded + '.' + signature;
}

function verifyToken(token) {
    try {
        const [header, payloadEncoded, signature] = token.split('.');
        const expectedSignature = crypto.createHmac('sha256', JWT_SECRET)
            .update(header + '.' + payloadEncoded)
            .digest('base64');
        
        if (signature !== expectedSignature) return null;
        
        const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64').toString());
        return payload;
    } catch (error) {
        return null;
    }
}

// Инициализация БД
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS steam_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        username TEXT,
        password TEXT,
        games TEXT,
        status INTEGER DEFAULT 1,
        stealth_mode BOOLEAN DEFAULT FALSE,
        farm_days INTEGER DEFAULT 0,
        farm_start_date DATETIME,
        total_hours REAL DEFAULT 0,
        farmed_hours REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Создаем админ аккаунт
    const adminPassword = hashPassword('JenyaKinel');
    db.run(`INSERT OR IGNORE INTO users (username, password, is_admin) VALUES (?, ?, ?)`, 
        ['kinel', adminPassword, true], function(err) {
        if (!err && this.changes > 0) {
            // Создаем привязанный Steam аккаунт для kinel
            const adminId = this.lastID;
            db.run(`INSERT INTO steam_accounts 
                    (user_id, name, username, password, games, stealth_mode, total_hours) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [adminId, 'Точка', 'tochka_bi_laik', 'JenyaKinel2023steam', '730', false, 2154.3]
            );
        }
    });
});

// Конфигурация
const CONFIG = {
    UPDATE_INTERVAL: 60000,
    MAX_GAMES: 32
};

// Состояние приложения
const farmingBots = new Map();

// Steam Bot для фарма часов
class SteamFarmBot {
    constructor(account, user) {
        this.account = account;
        this.user = user;
        this.client = new steamUser();
        this.isRunning = false;
        this.startTime = null;
        this.lastUpdateTime = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Steam Bot ${this.account.name} успешно вошел в систему`);
            
            const status = this.account.stealth_mode ? 7 : 1;
            this.client.setPersona(status);
            
            const games = this.account.games.split(',').map(id => parseInt(id.trim()));
            this.client.gamesPlayed(games);
            
            this.isRunning = true;
            this.startTime = new Date();
            this.lastUpdateTime = new Date();
            
            db.run(`UPDATE steam_accounts SET farm_start_date = ? WHERE id = ?`, 
                [this.startTime, this.account.id]);
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка Steam Bot ${this.account.name}:`, err);
            this.isRunning = false;
        });

        this.client.on('disconnected', () => {
            console.log(`🔌 Steam Bot ${this.account.name} отключен`);
            this.updateFarmedHours();
            this.isRunning = false;
        });
    }

    updateFarmedHours() {
        if (this.startTime && this.lastUpdateTime) {
            const now = new Date();
            const hoursFarmed = (now - this.lastUpdateTime) / (1000 * 60 * 60); // часы
            this.lastUpdateTime = now;
            
            // Обновляем в базе данных
            db.run(`UPDATE steam_accounts SET farmed_hours = farmed_hours + ? WHERE id = ?`, 
                [hoursFarmed, this.account.id]);
        }
    }

    startFarming() {
        if (this.isRunning) return;

        console.log(`🚀 Запуск Steam Bot ${this.account.name}...`);
        
        const logOnOptions = {
            accountName: this.account.username,
            password: this.account.password
        };

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 Останавливаю фарм ${this.account.name}...`);
            this.updateFarmedHours();
            this.client.logOff();
            this.isRunning = false;
            this.startTime = null;
            this.lastUpdateTime = null;
        }
    }

    getStatus() {
        const currentHours = this.account.farmed_hours || 0;
        if (this.startTime && this.isRunning) {
            const additionalHours = (new Date() - this.lastUpdateTime) / (1000 * 60 * 60);
            return {
                isRunning: this.isRunning,
                startTime: this.startTime,
                totalHours: (this.account.total_hours || 0) + currentHours + additionalHours,
                farmedHours: currentHours + additionalHours,
                games: this.account.games,
                account: this.account
            };
        }
        
        return {
            isRunning: this.isRunning,
            startTime: this.startTime,
            totalHours: (this.account.total_hours || 0) + currentHours,
            farmedHours: currentHours,
            games: this.account.games,
            account: this.account
        };
    }
}

// Middleware
app.use(express.json());

// Auth middleware
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Неверный токен' });

    req.user = decoded;
    next();
}

// Admin middleware
function adminMiddleware(req, res, next) {
    if (!req.user.is_admin) {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }
    next();
}

// Routes
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    try {
        const hashedPassword = hashPassword(password);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, 
            [username, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ error: 'Пользователь уже существует' });
            }
            res.json({ success: true, message: 'Аккаунт создан' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const validPassword = (hashPassword(password) === user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const token = createToken(
            { id: user.id, username: user.username, is_admin: user.is_admin }
        );

        res.json({ 
            success: true, 
            token, 
            user: { 
                username: user.username, 
                is_admin: user.is_admin 
            } 
        });
    });
});

// Steam accounts management
app.get('/api/accounts', authMiddleware, (req, res) => {
    db.all(`SELECT * FROM steam_accounts WHERE user_id = ?`, [req.user.id], (err, accounts) => {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        
        const accountsWithStatus = accounts.map(account => {
            const bot = farmingBots.get(account.id);
            if (bot) {
                const status = bot.getStatus();
                return {
                    ...account,
                    isFarming: status.isRunning,
                    farmingTime: status.startTime ? Math.floor((new Date() - status.startTime) / 1000 / 60) : 0,
                    totalHours: status.totalHours,
                    farmedHours: status.farmedHours,
                    games: status.games,
                    botStatus: status
                };
            } else {
                return {
                    ...account,
                    isFarming: false,
                    farmingTime: 0,
                    totalHours: account.total_hours + (account.farmed_hours || 0),
                    farmedHours: account.farmed_hours || 0,
                    games: account.games
                };
            }
        });
        
        res.json({ accounts: accountsWithStatus });
    });
});

app.post('/api/accounts', authMiddleware, (req, res) => {
    const { name, username, password, games, stealth_mode, farm_days } = req.body;

    db.get(`SELECT COUNT(*) as count FROM steam_accounts WHERE user_id = ?`, [req.user.id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        
        if (result.count >= 5) {
            return res.status(400).json({ error: 'Максимум 5 аккаунтов' });
        }

        const gamesArray = games.split(',').map(g => g.trim());
        if (gamesArray.length > CONFIG.MAX_GAMES) {
            return res.status(400).json({ error: `Максимум ${CONFIG.MAX_GAMES} игр` });
        }

        db.run(`INSERT INTO steam_accounts 
                (user_id, name, username, password, games, stealth_mode, farm_days) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, name, username, password, games, stealth_mode, farm_days],
            function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка создания аккаунта' });
                
                res.json({ 
                    success: true, 
                    message: 'Аккаунт создан',
                    accountId: this.lastID 
                });
            }
        );
    });
});

// Farm management
app.post('/api/farm/start/:accountId', authMiddleware, (req, res) => {
    const accountId = req.params.accountId;

    db.get(`SELECT * FROM steam_accounts WHERE id = ? AND user_id = ?`, 
        [accountId, req.user.id], (err, account) => {
        if (err || !account) {
            return res.status(404).json({ error: 'Аккаунт не найден' });
        }

        let bot = farmingBots.get(accountId);
        if (!bot) {
            bot = new SteamFarmBot(account, req.user);
            farmingBots.set(accountId, bot);
        }

        bot.startFarming();
        res.json({ success: true, message: 'Фарм запущен' });
    });
});

app.post('/api/farm/stop/:accountId', authMiddleware, (req, res) => {
    const accountId = req.params.accountId;
    const bot = farmingBots.get(accountId);

    if (bot) {
        bot.stopFarming();
        // Удаляем бота из мапы после остановки
        farmingBots.delete(accountId);
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Бот не найден' });
    }
});

// Получение статуса фарма
app.get('/api/farm/status/:accountId', authMiddleware, (req, res) => {
    const accountId = req.params.accountId;
    const bot = farmingBots.get(accountId);

    if (bot) {
        const status = bot.getStatus();
        res.json({ success: true, status });
    } else {
        res.json({ success: true, status: { isRunning: false } });
    }
});

// Admin routes
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
    db.all(`SELECT * FROM users`, (err, users) => {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        
        // Получаем общее количество аккаунтов
        db.get(`SELECT COUNT(*) as totalAccounts FROM steam_accounts`, (err, accountResult) => {
            const stats = {
                totalUsers: users.length,
                totalAccounts: accountResult.totalAccounts,
                activeFarms: Array.from(farmingBots.values()).filter(bot => bot.isRunning).length,
                users: users
            };
            
            res.json(stats);
        });
    });
});

// Обновление часов каждую минуту для активных ботов
setInterval(() => {
    farmingBots.forEach((bot, accountId) => {
        if (bot.isRunning) {
            bot.updateFarmedHours();
        }
    });
}, 60000); // Каждую минуту

// HTML Routes (остальной код остается таким же, но обновим JavaScript часть для dashboard)

app.get('/', (req, res) => {
    // ... (код главной страницы остается без изменений)
    res.send(`...`);
});

app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Мои аккаунты • Steam Farm</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            /* Стили остаются без изменений */
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            :root {
                --primary: #8B5CF6;
                --secondary: #7C3AED;
                --accent: #A78BFA;
                --background: #0F0F23;
                --surface: rgba(255, 255, 255, 0.05);
                --text: #E2E8F0;
                --text-secondary: #94A3B8;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --gradient-glow: linear-gradient(135deg, #8B5CF6, #7C3AED, #A78BFA);
                --glass: rgba(255, 255, 255, 0.08);
                --glass-border: rgba(255, 255, 255, 0.15);
                --glass-shadow: 0 8px 32px rgba(139, 92, 246, 0.15);
                --neon-glow: 0 0 20px rgba(139, 92, 246, 0.3);
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: var(--background);
                color: var(--text);
                min-height: 100vh;
            }
            
            .liquid-glass-effect {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: 
                    radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.2) 0%, transparent 50%),
                    radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.2) 0%, transparent 50%),
                    radial-gradient(circle at 40% 80%, rgba(167, 139, 250, 0.15) 0%, transparent 50%);
                backdrop-filter: blur(60px) saturate(180%);
                -webkit-backdrop-filter: blur(60px) saturate(180%);
                z-index: -2;
            }
            
            .header {
                padding: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid var(--glass-border);
                background: var(--glass);
                backdrop-filter: blur(20px);
            }
            
            .logo {
                font-size: 1.5rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .user-menu {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .logout-btn {
                background: none;
                border: 1px solid var(--glass-border);
                color: var(--text);
                padding: 8px 16px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .logout-btn:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 40px 20px;
            }
            
            .accounts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                gap: 25px;
                margin-bottom: 40px;
            }
            
            .account-card {
                background: var(--glass);
                backdrop-filter: blur(20px);
                border: 1px solid var(--glass-border);
                border-radius: 20px;
                padding: 30px;
                transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                position: relative;
                overflow: hidden;
                box-shadow: var(--glass-shadow);
            }
            
            .account-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: var(--gradient);
            }
            
            .account-card:hover {
                transform: translateY(-8px);
                box-shadow: var(--glass-shadow), var(--neon-glow);
                border-color: rgba(139, 92, 246, 0.3);
            }
            
            .account-name {
                font-size: 1.4rem;
                font-weight: 700;
                margin-bottom: 15px;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .account-info {
                margin-bottom: 20px;
            }
            
            .info-item {
                margin-bottom: 8px;
                font-size: 0.95rem;
                color: var(--text-secondary);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .password-hover {
                position: relative;
                cursor: help;
                padding: 4px 8px;
                border-radius: 6px;
                transition: all 0.3s ease;
            }
            
            .password-hover:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            .password-hover:hover::after {
                content: attr(data-password);
                position: absolute;
                bottom: 100%;
                left: 0;
                background: var(--background);
                border: 1px solid var(--glass-border);
                padding: 8px 12px;
                border-radius: 8px;
                font-size: 0.8rem;
                white-space: nowrap;
                z-index: 10;
                backdrop-filter: blur(10px);
            }
            
            .farm-controls {
                display: flex;
                gap: 12px;
                margin-top: 20px;
            }
            
            .farm-btn {
                flex: 1;
                padding: 12px 16px;
                border: none;
                border-radius: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 0.95rem;
                position: relative;
                overflow: hidden;
            }
            
            .farm-btn.start {
                background: var(--primary);
                color: white;
                box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
            }
            
            .farm-btn.stop {
                background: #EF4444;
                color: white;
                box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);
            }
            
            .farm-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none !important;
            }
            
            .farm-btn:not(:disabled):hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
            }
            
            .farm-status {
                margin-top: 15px;
                padding: 12px;
                border-radius: 10px;
                font-size: 0.85rem;
                text-align: center;
                backdrop-filter: blur(10px);
            }
            
            .status-farming {
                background: rgba(16, 185, 129, 0.2);
                color: #10B981;
                border: 1px solid rgba(16, 185, 129, 0.3);
            }
            
            .status-stopped {
                background: rgba(107, 114, 128, 0.2);
                color: var(--text-secondary);
                border: 1px solid var(--glass-border);
            }
            
            .hours-info {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                padding: 15px;
                margin-top: 15px;
            }
            
            .hours-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-size: 0.9rem;
            }
            
            .hours-label {
                color: var(--text-secondary);
            }
            
            .hours-value {
                font-weight: 600;
                color: var(--primary);
            }
            
            .games-info {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 10px;
                margin-top: 10px;
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            .add-account-card {
                background: var(--glass);
                backdrop-filter: blur(20px);
                border: 2px dashed var(--glass-border);
                border-radius: 20px;
                padding: 50px 30px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                text-align: center;
            }
            
            .add-account-card:hover {
                border-color: var(--primary);
                transform: translateY(-8px);
                box-shadow: var(--glass-shadow), var(--neon-glow);
            }
            
            .add-icon {
                font-size: 3rem;
                color: var(--primary);
                margin-bottom: 15px;
                transition: all 0.3s ease;
            }
            
            .add-account-card:hover .add-icon {
                transform: scale(1.1);
            }
            
            /* Modal styles */
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(15px);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }
            
            .modal-content {
                background: var(--glass);
                backdrop-filter: blur(30px);
                border: 1px solid var(--glass-border);
                border-radius: 25px;
                padding: 35px;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: var(--glass-shadow), var(--neon-glow);
            }
            
            .modal-title {
                font-size: 1.6rem;
                font-weight: 700;
                margin-bottom: 25px;
                text-align: center;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-label {
                display: block;
                margin-bottom: 8px;
                font-weight: 600;
                color: var(--text-secondary);
            }
            
            .form-input, .form-select {
                width: 100%;
                padding: 14px 16px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid var(--glass-border);
                border-radius: 12px;
                color: var(--text);
                font-size: 0.95rem;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
            }
            
            .form-input:focus, .form-select:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.3), var(--neon-glow);
                background: rgba(255, 255, 255, 0.15);
            }
            
            .form-hint {
                font-size: 0.8rem;
                color: var(--text-secondary);
                margin-top: 6px;
            }
            
            .submit-btn {
                width: 100%;
                background: var(--gradient);
                border: none;
                padding: 16px;
                border-radius: 12px;
                color: white;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: var(--glass-shadow);
                margin-top: 15px;
            }
            
            .submit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(139, 92, 246, 0.5), var(--neon-glow);
            }
            
            .close-btn {
                position: absolute;
                top: 20px;
                right: 20px;
                background: none;
                border: none;
                color: var(--text-secondary);
                font-size: 1.5rem;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .close-btn:hover {
                color: var(--text);
                transform: scale(1.1);
            }
            
            .loading {
                text-align: center;
                padding: 40px;
                color: var(--text-secondary);
                font-size: 1.1rem;
            }
        </style>
    </head>
    <body>
        <div class="liquid-glass-effect"></div>
        
        <div class="header">
            <div class="logo">Steam Farm</div>
            <div class="user-menu">
                <span id="usernameDisplay"></span>
                <button class="logout-btn" onclick="logout()">Выйти</button>
            </div>
        </div>
        
        <div class="container">
            <div class="accounts-grid" id="accountsGrid">
                <div class="loading">Загрузка аккаунтов...</div>
            </div>
        </div>
        
        <!-- Add Account Modal -->
        <div class="modal" id="addAccountModal">
            <div class="modal-content">
                <button class="close-btn" onclick="hideAddAccountModal()">×</button>
                <h2 class="modal-title">Добавить Steam аккаунт</h2>
                <form id="addAccountForm">
                    <div class="form-group">
                        <label class="form-label">Имя аккаунта</label>
                        <input type="text" class="form-input" name="name" placeholder="Мой основной аккаунт" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Логин Steam</label>
                        <input type="text" class="form-input" name="username" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Пароль Steam</label>
                        <input type="password" class="form-input" name="password" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Айди игр для фарма</label>
                        <input type="text" class="form-input" name="games" value="730" required>
                        <div class="form-hint">Через запятую. Максимум 32 айди. CS2 = 730</div>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Режим скрытности</label>
                        <select class="form-select" name="stealth_mode">
                            <option value="false">В сети (Status: 1)</option>
                            <option value="true">Не в сети (Status: 7)</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Время фарма</label>
                        <select class="form-select" name="farm_days">
                            <option value="1">1 день</option>
                            <option value="3">3 дня</option>
                            <option value="7">7 дней</option>
                            <option value="0" selected>Навсегда</option>
                        </select>
                    </div>
                    
                    <button type="submit" class="submit-btn">Добавить аккаунт</button>
                </form>
            </div>
        </div>
        
        <script>
            // Play gentle sound
            function playGentleSound() {
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
                    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1);
                    
                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + 1);
                } catch (e) {
                    console.log('Audio not supported');
                }
            }
            
            const token = localStorage.getItem('token');
            if (!token) {
                window.location.href = '/';
            }
            
            let currentUser = null;
            try {
                currentUser = JSON.parse(atob(token.split('.')[1]));
                document.getElementById('usernameDisplay').textContent = currentUser.username;
            } catch (e) {
                logout();
            }
            
            async function loadAccounts() {
                try {
                    const response = await fetch('/api/accounts', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    
                    const data = await response.json();
                    displayAccounts(data.accounts);
                } catch (error) {
                    console.error('Error loading accounts:', error);
                    document.getElementById('accountsGrid').innerHTML = '<div class="loading">Ошибка загрузки аккаунтов</div>';
                }
            }
            
            function displayAccounts(accounts) {
                const grid = document.getElementById('accountsGrid');
                grid.innerHTML = '';
                
                accounts.forEach(account => {
                    const accountCard = document.createElement('div');
                    accountCard.className = 'account-card';
                    accountCard.innerHTML = \`
                        <div class="account-name">\${account.name}</div>
                        <div class="account-info">
                            <div class="info-item">
                                <i class="fas fa-user"></i>
                                Логин: \${account.username}
                            </div>
                            <div class="info-item password-hover" data-password="\${account.password}">
                                <i class="fas fa-lock"></i>
                                Пароль: ••••••••
                            </div>
                            <div class="info-item">
                                <i class="fas fa-eye\${account.stealth_mode ? '-slash' : ''}"></i>
                                Режим: \${account.stealth_mode ? 'Не в сети' : 'В сети'}
                            </div>
                            <div class="info-item">
                                <i class="fas fa-clock"></i>
                                Фарм: \${getFarmDaysText(account.farm_days)}
                            </div>
                        </div>
                        
                        <div class="games-info">
                            <i class="fas fa-gamepad"></i> Игры для фарма: \${account.games}
                        </div>
                        
                        <div class="hours-info">
                            <div class="hours-item">
                                <span class="hours-label">Всего часов:</span>
                                <span class="hours-value">\${account.totalHours ? account.totalHours.toFixed(1) : '0.0'}</span>
                            </div>
                            <div class="hours-item">
                                <span class="hours-label">Нафармлено:</span>
                                <span class="hours-value">\${account.farmedHours ? account.farmedHours.toFixed(1) : '0.0'}</span>
                            </div>
                        </div>
                        
                        <div class="farm-controls">
                            <button class="farm-btn start" onclick="startFarming(\${account.id})" \${account.isFarming ? 'disabled' : ''}>
                                <i class="fas fa-play"></i> Старт
                            </button>
                            <button class="farm-btn stop" onclick="stopFarming(\${account.id})" \${!account.isFarming ? 'disabled' : ''}>
                                <i class="fas fa-stop"></i> Стоп
                            </button>
                        </div>
                        <div class="farm-status \${account.isFarming ? 'status-farming' : 'status-stopped'}">
                            \${account.isFarming ? 
                                \`🎮 Фарм активен • \${Math.floor(account.farmingTime / 60)}ч \${account.farmingTime % 60}м\` : 
                                '💤 Фарм остановлен'
                            }
                        </div>
                    \`;
                    grid.appendChild(accountCard);
                });
                
                // Add "Add Account" card if less than 5 accounts
                if (accounts.length < 5) {
                    const addCard = document.createElement('div');
                    addCard.className = 'account-card add-account-card';
                    addCard.onclick = showAddAccountModal;
                    addCard.innerHTML = \`
                        <div class="add-icon">+</div>
                        <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 8px;">Добавить аккаунт</div>
                        <div style="font-size: 0.9rem; color: var(--text-secondary);">
                            Осталось слотов: \${5 - accounts.length}
                        </div>
                    \`;
                    grid.appendChild(addCard);
                }
                
                // Add hover effects to all buttons
                const buttons = document.querySelectorAll('button');
                buttons.forEach(button => {
                    button.addEventListener('mouseenter', playGentleSound);
                });
            }
            
            function getFarmDaysText(days) {
                if (days === 0) return 'Навсегда';
                if (days === 1) return '1 день';
                return \`\${days} дней\`;
            }
            
            function showAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'flex';
                playGentleSound();
            }
            
            function hideAddAccountModal() {
                document.getElementById('addAccountModal').style.display = 'none';
            }
            
            async function startFarming(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        playGentleSound();
                        loadAccounts();
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Ошибка запуска фарма');
                }
            }
            
            async function stopFarming(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        playGentleSound();
                        loadAccounts();
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Ошибка остановки фарма');
                }
            }
            
            document.getElementById('addAccountForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                const formData = new FormData(this);
                const data = {
                    name: formData.get('name'),
                    username: formData.get('username'),
                    password: formData.get('password'),
                    games: formData.get('games'),
                    stealth_mode: formData.get('stealth_mode') === 'true',
                    farm_days: parseInt(formData.get('farm_days'))
                };
                
                try {
                    const response = await fetch('/api/accounts', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        playGentleSound();
                        hideAddAccountModal();
                        this.reset();
                        loadAccounts();
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Ошибка создания аккаунта');
                }
            });
            
            function logout() {
                localStorage.removeItem('token');
                window.location.href = '/';
            }
            
            // Close modal on outside click
            document.addEventListener('click', function(event) {
                if (event.target === document.getElementById('addAccountModal')) {
                    hideAddAccountModal();
                }
            });
            
            // Load accounts on page load
            document.addEventListener('DOMContentLoaded', function() {
                loadAccounts();
                playGentleSound();
                
                // Refresh accounts every 10 seconds
                setInterval(loadAccounts, 10000);
            });
        </script>
    </body>
    </html>
    `);
});

// Admin Route (остается без изменений)
app.get('/admin', (req, res) => {
    res.send(`...`);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🔐 Админ аккаунт: kinel / JenyaKinel`);
    console.log(`🎮 Привязанный Steam аккаунт: tochka_bi_laik`);
});
