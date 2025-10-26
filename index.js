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
                    (user_id, name, username, password, games, stealth_mode) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                [adminId, 'Точка', 'tochka_bi_laik', 'JenyaKinel2023steam', '730', false]
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
            
            db.run(`UPDATE steam_accounts SET farm_start_date = ? WHERE id = ?`, 
                [this.startTime, this.account.id]);
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка Steam Bot ${this.account.name}:`, err);
            this.isRunning = false;
        });

        this.client.on('disconnected', () => {
            console.log(`🔌 Steam Bot ${this.account.name} отключен`);
            this.isRunning = false;
        });
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
            this.client.logOff();
            this.isRunning = false;
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            startTime: this.startTime,
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
            return {
                ...account,
                isFarming: bot ? bot.isRunning : false,
                farmingTime: bot && bot.startTime ? 
                    Math.floor((new Date() - bot.startTime) / 1000 / 60) : 0
            };
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
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Бот не найден' });
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

// HTML Routes with Liquid Glass design
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Steam Farm • Бесплатный фарм часов</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
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
                --glass: rgba(255, 255, 255, 0.1);
                --glass-border: rgba(255, 255, 255, 0.2);
                --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: var(--background);
                color: var(--text);
                min-height: 100vh;
                overflow-x: hidden;
            }
            
            .liquid-glass-effect {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: 
                    radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.15) 0%, transparent 50%);
                backdrop-filter: blur(40px);
                -webkit-backdrop-filter: blur(40px);
                z-index: -2;
            }
            
            .header {
                position: fixed;
                top: 0;
                width: 100%;
                padding: 20px;
                display: flex;
                justify-content: flex-end;
                z-index: 1000;
            }
            
            .login-btn {
                background: var(--gradient);
                border: none;
                padding: 12px 24px;
                border-radius: 12px;
                color: white;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
                border: 1px solid var(--glass-border);
            }
            
            .login-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(139, 92, 246, 0.4);
            }
            
            .container {
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                position: relative;
            }
            
            .hero-section {
                text-align: center;
                max-width: 800px;
                margin: 0 auto;
            }
            
            .hero-title {
                font-size: 4rem;
                font-weight: 700;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 20px;
                line-height: 1.1;
            }
            
            .hero-subtitle {
                font-size: 1.3rem;
                color: var(--text-secondary);
                margin-bottom: 40px;
                line-height: 1.6;
            }
            
            .create-btn {
                background: var(--gradient);
                border: none;
                padding: 18px 36px;
                border-radius: 16px;
                color: white;
                font-size: 1.2rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
                border: 1px solid var(--glass-border);
                position: relative;
                overflow: hidden;
            }
            
            .create-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.5s;
            }
            
            .create-btn:hover::before {
                left: 100%;
            }
            
            .create-btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 12px 35px rgba(139, 92, 246, 0.5);
            }
            
            .footer {
                position: fixed;
                bottom: 0;
                width: 100%;
                text-align: center;
                padding: 20px;
                color: var(--text-secondary);
                font-size: 0.9rem;
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
                backdrop-filter: blur(10px);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }
            
            .modal-content {
                background: var(--glass);
                backdrop-filter: blur(20px);
                border: 1px solid var(--glass-border);
                border-radius: 20px;
                padding: 40px;
                max-width: 400px;
                width: 90%;
                box-shadow: var(--glass-shadow);
            }
            
            .modal-title {
                font-size: 1.8rem;
                font-weight: 600;
                margin-bottom: 20px;
                text-align: center;
                background: var(--gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-input {
                width: 100%;
                padding: 12px 16px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid var(--glass-border);
                border-radius: 10px;
                color: var(--text);
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            
            .form-input:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.3);
            }
            
            .submit-btn {
                width: 100%;
                background: var(--gradient);
                border: none;
                padding: 14px;
                border-radius: 10px;
                color: white;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .submit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4);
            }
            
            .switch-btn {
                color: var(--primary);
                background: none;
                border: none;
                cursor: pointer;
                font-weight: 500;
                margin-top: 15px;
            }
        </style>
    </head>
    <body>
        <div class="liquid-glass-effect"></div>
        
        <div class="header">
            <button class="login-btn" onclick="showLoginModal()">Вход+</button>
        </div>
        
        <div class="container">
            <div class="hero-section">
                <h1 class="hero-title">Фарм часов Steam</h1>
                <p class="hero-subtitle">
                    Это сайт для бесплатного фарма часов в Steam.<br>
                    Добавляй до 5 аккаунтов и управляй фармом в одном месте.
                </p>
                <button class="create-btn" onclick="showRegisterModal()">Создать аккаунт+</button>
            </div>
        </div>
        
        <div class="footer">
            Powered by kinel
        </div>
        
        <!-- Login Modal -->
        <div class="modal" id="loginModal">
            <div class="modal-content">
                <h2 class="modal-title">Вход в аккаунт</h2>
                <form id="loginForm">
                    <div class="form-group">
                        <input type="text" class="form-input" placeholder="Логин" name="username" required>
                    </div>
                    <div class="form-group">
                        <input type="password" class="form-input" placeholder="Пароль" name="password" required>
                    </div>
                    <button type="submit" class="submit-btn">Войти</button>
                </form>
                <button class="switch-btn" onclick="showRegisterModal()">Нет аккаунта? Зарегистрируйтесь</button>
            </div>
        </div>
        
        <!-- Register Modal -->
        <div class="modal" id="registerModal">
            <div class="modal-content">
                <h2 class="modal-title">Создать аккаунт</h2>
                <form id="registerForm">
                    <div class="form-group">
                        <input type="text" class="form-input" placeholder="Логин" name="username" required>
                    </div>
                    <div class="form-group">
                        <input type="password" class="form-input" placeholder="Пароль" name="password" required>
                    </div>
                    <button type="submit" class="submit-btn">Создать аккаунт</button>
                </form>
                <button class="switch-btn" onclick="showLoginModal()">Уже есть аккаунт? Войдите</button>
            </div>
        </div>
        
        <script>
            function showLoginModal() {
                document.getElementById('loginModal').style.display = 'flex';
                document.getElementById('registerModal').style.display = 'none';
            }
            
            function showRegisterModal() {
                document.getElementById('registerModal').style.display = 'flex';
                document.getElementById('loginModal').style.display = 'none';
            }
            
            function hideModals() {
                document.getElementById('loginModal').style.display = 'none';
                document.getElementById('registerModal').style.display = 'none';
            }
            
            // Close modal on outside click
            document.addEventListener('click', function(event) {
                const modals = document.querySelectorAll('.modal');
                modals.forEach(modal => {
                    if (event.target === modal) {
                        modal.style.display = 'none';
                    }
                });
            });
            
            // Login form handler
            document.getElementById('loginForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                const formData = new FormData(this);
                const data = {
                    username: formData.get('username'),
                    password: formData.get('password')
                };
                
                try {
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        localStorage.setItem('token', result.token);
                        if (result.user.is_admin) {
                            window.location.href = '/admin';
                        } else {
                            window.location.href = '/dashboard';
                        }
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Ошибка соединения');
                }
            });
            
            // Register form handler
            document.getElementById('registerForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                const formData = new FormData(this);
                const data = {
                    username: formData.get('username'),
                    password: formData.get('password')
                };
                
                try {
                    const response = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        alert('Аккаунт создан! Теперь войдите.');
                        showLoginModal();
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Ошибка соединения');
                }
            });
            
            // Check if user is already logged in
            const token = localStorage.getItem('token');
            if (token) {
                // Verify token and redirect
                try {
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    if (payload.is_admin) {
                        window.location.href = '/admin';
                    } else {
                        window.location.href = '/dashboard';
                    }
                } catch (e) {
                    localStorage.removeItem('token');
                }
            }
        </script>
    </body>
    </html>
    `);
});

// Добавь также маршруты /dashboard и /admin как в предыдущем коде...
// [Здесь должен быть тот же код для /dashboard и /admin что и в предыдущем сообщении]

// Запуск сервера
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
            * { margin: 0; padding: 0; box-sizing: border-box; }
            :root {
                --primary: #8B5CF6; --secondary: #7C3AED; --accent: #A78BFA;
                --background: #0F0F23; --surface: rgba(255, 255, 255, 0.05);
                --text: #E2E8F0; --text-secondary: #94A3B8;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --glass: rgba(255, 255, 255, 0.1); --glass-border: rgba(255, 255, 255, 0.2);
                --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            body { font-family: 'Inter', sans-serif; background: var(--background); color: var(--text); min-height: 100vh; }
            .liquid-glass-effect {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.15) 0%, transparent 50%);
                backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); z-index: -2;
            }
            .header { padding: 20px; display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid var(--glass-border); background: var(--glass); backdrop-filter: blur(20px); }
            .logo { font-size: 1.5rem; font-weight: 700; background: var(--gradient); -webkit-background-clip: text;
                -webkit-text-fill-color: transparent; }
            .user-menu { display: flex; align-items: center; gap: 15px; }
            .logout-btn { background: none; border: 1px solid var(--glass-border); color: var(--text);
                padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; }
            .logout-btn:hover { background: rgba(255, 255, 255, 0.1); }
            .container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
            .accounts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; }
            .account-card { background: var(--glass); backdrop-filter: blur(20px); border: 1px solid var(--glass-border);
                border-radius: 16px; padding: 24px; transition: all 0.3s ease; position: relative; overflow: hidden; }
            .account-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--gradient); }
            .account-card:hover { transform: translateY(-5px); box-shadow: var(--glass-shadow); }
            .account-name { font-size: 1.3rem; font-weight: 600; margin-bottom: 10px; background: var(--gradient);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .account-info { margin-bottom: 15px; }
            .info-item { margin-bottom: 5px; font-size: 0.9rem; color: var(--text-secondary); }
            .password-hover { position: relative; cursor: help; }
            .password-hover:hover::after { content: attr(data-password); position: absolute; bottom: 100%; left: 0;
                background: var(--background); border: 1px solid var(--glass-border); padding: 5px 10px;
                border-radius: 6px; font-size: 0.8rem; white-space: nowrap; z-index: 10; }
            .farm-controls { display: flex; gap: 10px; margin-top: 15px; }
            .farm-btn { flex: 1; padding: 8px 12px; border: none; border-radius: 8px; font-weight: 500;
                cursor: pointer; transition: all 0.3s ease; font-size: 0.9rem; }
            .farm-btn.start { background: var(--primary); color: white; }
            .farm-btn.stop { background: #EF4444; color: white; }
            .farm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .farm-status { margin-top: 10px; padding: 8px; border-radius: 6px; font-size: 0.8rem; text-align: center; }
            .status-farming { background: rgba(16, 185, 129, 0.2); color: #10B981; }
            .status-stopped { background: rgba(107, 114, 128, 0.2); color: var(--text-secondary); }
            .add-account-card { background: var(--glass); backdrop-filter: blur(20px); border: 2px dashed var(--glass-border);
                border-radius: 16px; padding: 40px 24px; display: flex; flex-direction: column; align-items: center;
                justify-content: center; cursor: pointer; transition: all 0.3s ease; text-align: center; }
            .add-account-card:hover { border-color: var(--primary); transform: translateY(-5px); }
            .add-icon { font-size: 2rem; color: var(--primary); margin-bottom: 10px; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(10px); z-index: 2000; align-items: center; justify-content: center; }
            .modal-content { background: var(--glass); backdrop-filter: blur(20px); border: 1px solid var(--glass-border);
                border-radius: 20px; padding: 30px; max-width: 500px; width: 90%; max-height: 90vh;
                overflow-y: auto; box-shadow: var(--glass-shadow); }
            .modal-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 20px; text-align: center;
                background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .form-group { margin-bottom: 15px; }
            .form-label { display: block; margin-bottom: 5px; font-weight: 500; color: var(--text-secondary); }
            .form-input, .form-select { width: 100%; padding: 10px 12px; background: rgba(255, 255, 255, 0.1);
                border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text); font-size: 0.9rem;
                transition: all 0.3s ease; }
            .form-input:focus, .form-select:focus { outline: none; border-color: var(--primary);
                box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.3); }
            .form-hint { font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px; }
            .submit-btn { width: 100%; background: var(--gradient); border: none; padding: 12px; border-radius: 8px;
                color: white; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 10px; }
            .submit-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4); }
            .close-btn { position: absolute; top: 15px; right: 15px; background: none; border: none;
                color: var(--text-secondary); font-size: 1.2rem; cursor: pointer; }
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
            const token = localStorage.getItem('token');
            if (!token) window.location.href = '/';
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                document.getElementById('usernameDisplay').textContent = payload.username;
            } catch (e) { logout(); }
            async function loadAccounts() {
                try {
                    const response = await fetch('/api/accounts', { headers: { 'Authorization': 'Bearer ' + token } });
                    const data = await response.json();
                    displayAccounts(data.accounts);
                } catch (error) { console.error('Error loading accounts:', error); }
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
                            <div class="info-item">Логин: \${account.username}</div>
                            <div class="info-item password-hover" data-password="\${account.password}">Пароль: ••••••••</div>
                            <div class="info-item">Игры: \${account.games}</div>
                            <div class="info-item">Режим: \${account.stealth_mode ? 'Не в сети' : 'В сети'}</div>
                            <div class="info-item">Фарм: \${getFarmDaysText(account.farm_days)}</div>
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
                            \${account.isFarming ? \`Фарм активен • \${Math.floor(account.farmingTime / 60)}ч \${account.farmingTime % 60}м\` : 'Фарм остановлен'}
                        </div>
                    \`;
                    grid.appendChild(accountCard);
                });
                if (accounts.length < 5) {
                    const addCard = document.createElement('div');
                    addCard.className = 'account-card add-account-card';
                    addCard.onclick = showAddAccountModal;
                    addCard.innerHTML = \`
                        <div class="add-icon">+</div>
                        <div>Добавить аккаунт</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">Осталось слотов: \${5 - accounts.length}</div>
                    \`;
                    grid.appendChild(addCard);
                }
            }
            function getFarmDaysText(days) {
                if (days === 0) return 'Навсегда';
                if (days === 1) return '1 день';
                return \`\${days} дней\`;
            }
            function showAddAccountModal() { document.getElementById('addAccountModal').style.display = 'flex'; }
            function hideAddAccountModal() { document.getElementById('addAccountModal').style.display = 'none'; }
            async function startFarming(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
                    const result = await response.json();
                    if (result.success) loadAccounts(); else alert(result.error);
                } catch (error) { alert('Ошибка запуска фарма'); }
            }
            async function stopFarming(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
                    const result = await response.json();
                    if (result.success) loadAccounts(); else alert(result.error);
                } catch (error) { alert('Ошибка остановки фарма'); }
            }
            document.getElementById('addAccountForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                const formData = new FormData(this);
                const data = {
                    name: formData.get('name'), username: formData.get('username'), password: formData.get('password'),
                    games: formData.get('games'), stealth_mode: formData.get('stealth_mode') === 'true',
                    farm_days: parseInt(formData.get('farm_days'))
                };
                try {
                    const response = await fetch('/api/accounts', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify(data)
                    });
                    const result = await response.json();
                    if (result.success) { hideAddAccountModal(); this.reset(); loadAccounts(); } else { alert(result.error); }
                } catch (error) { alert('Ошибка создания аккаунта'); }
            });
            function logout() { localStorage.removeItem('token'); window.location.href = '/'; }
            document.addEventListener('click', function(event) {
                if (event.target === document.getElementById('addAccountModal')) hideAddAccountModal();
            });
            loadAccounts(); setInterval(loadAccounts, 30000);
        </script>
    </body>
    </html>
    `);
});

app.get('/admin', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Админ панель • Steam Farm</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            :root {
                --primary: #8B5CF6; --secondary: #7C3AED; --accent: #A78BFA;
                --background: #0F0F23; --surface: rgba(255, 255, 255, 0.05);
                --text: #E2E8F0; --text-secondary: #94A3B8;
                --gradient: linear-gradient(135deg, var(--primary), var(--secondary));
                --glass: rgba(255, 255, 255, 0.1); --glass-border: rgba(255, 255, 255, 0.2);
                --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            body { font-family: 'Inter', sans-serif; background: var(--background); color: var(--text); min-height: 100vh; }
            .liquid-glass-effect {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.15) 0%, transparent 50%);
                backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); z-index: -2;
            }
            .header { padding: 20px; display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid var(--glass-border); background: var(--glass); backdrop-filter: blur(20px); }
            .logo { font-size: 1.5rem; font-weight: 700; background: var(--gradient); -webkit-background-clip: text;
                -webkit-text-fill-color: transparent; }
            .user-menu { display: flex; align-items: center; gap: 15px; }
            .logout-btn { background: none; border: 1px solid var(--glass-border); color: var(--text);
                padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; }
            .logout-btn:hover { background: rgba(255, 255, 255, 0.1); }
            .container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px; }
            .stat-card { background: var(--glass); backdrop-filter: blur(20px); border: 1px solid var(--glass-border);
                border-radius: 16px; padding: 24px; text-align: center; position: relative; overflow: hidden; }
            .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--gradient); }
            .stat-value { font-size: 2.5rem; font-weight: 700; background: var(--gradient); -webkit-background-clip: text;
                -webkit-text-fill-color: transparent; margin-bottom: 10px; }
            .stat-label { color: var(--text-secondary); font-size: 0.9rem; }
            .users-table { background: var(--glass); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: 16px; overflow: hidden; }
            .table-header { padding: 20px; border-bottom: 1px solid var(--glass-border); font-weight: 600;
                background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .table-row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; padding: 15px 20px;
                border-bottom: 1px solid var(--glass-border); align-items: center; }
            .table-row:last-child { border-bottom: none; }
            .table-row:hover { background: rgba(255, 255, 255, 0.05); }
            .admin-badge { background: var(--gradient); color: white; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; }
            .loading { text-align: center; padding: 40px; color: var(--text-secondary); }
        </style>
    </head>
    <body>
        <div class="liquid-glass-effect"></div>
        <div class="header">
            <div class="logo">Steam Farm • Админ</div>
            <div class="user-menu">
                <span id="usernameDisplay"></span>
                <button class="logout-btn" onclick="logout()">Выйти</button>
            </div>
        </div>
        <div class="container">
            <div class="stats-grid" id="statsGrid">
                <div class="loading">Загрузка статистики...</div>
            </div>
            <div class="users-table">
                <div class="table-header">Пользователи системы</div>
                <div id="usersList">
                    <div class="loading">Загрузка пользователей...</div>
                </div>
            </div>
        </div>
        <script>
            const token = localStorage.getItem('token');
            if (!token) window.location.href = '/';
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                document.getElementById('usernameDisplay').textContent = payload.username + ' (Admin)';
                if (!payload.is_admin) window.location.href = '/dashboard';
            } catch (e) { logout(); }
            async function loadAdminStats() {
                try {
                    const response = await fetch('/api/admin/stats', { headers: { 'Authorization': 'Bearer ' + token } });
                    const data = await response.json();
                    displayStats(data); displayUsers(data.users);
                } catch (error) { console.error('Error loading admin stats:', error); }
            }
            function displayStats(stats) {
                const grid = document.getElementById('statsGrid');
                grid.innerHTML = \`
                    <div class="stat-card"><div class="stat-value">\${stats.totalUsers}</div><div class="stat-label">Всего пользователей</div></div>
                    <div class="stat-card"><div class="stat-value">\${stats.totalAccounts}</div><div class="stat-label">Steam аккаунтов</div></div>
                    <div class="stat-card"><div class="stat-value">\${stats.activeFarms}</div><div class="stat-label">Активных фармов</div></div>
                \`;
            }
            function displayUsers(users) {
                const usersList = document.getElementById('usersList');
                usersList.innerHTML = '';
                users.forEach(user => {
                    const row = document.createElement('div');
                    row.className = 'table-row';
                    row.innerHTML = \`
                        <div>\${user.username}</div>
                        <div>\${new Date(user.created_at).toLocaleDateString('ru-RU')}</div>
                        <div>\${user.is_admin ? '<span class="admin-badge">Админ</span>' : 'Пользователь'}</div>
                        <div>\${user.id === JSON.parse(atob(token.split('.')[1])).id ? 'Вы' : ''}</div>
                    \`;
                    usersList.appendChild(row);
                });
            }
            function logout() { localStorage.removeItem('token'); window.location.href = '/'; }
            loadAdminStats(); setInterval(loadAdminStats, 30000);
        </script>
    </body>
    </html>
    `);
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🔐 Админ аккаунт: kinel / JenyaKinel`);
    console.log(`🎮 Привязанный Steam аккаунт: tochka_bi_laik`);
});
