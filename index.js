const express = require('express');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// 🔐 Конфигурация безопасности
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const DATA_FILE = './accounts.json';

// 🎯 Предустановленные аккаунты (зашифрованные)
const DEFAULT_ACCOUNTS = {
    'acc_1': {
        id: 'acc_1',
        username: encrypt('tochka_bi_laik'),
        password: encrypt('JenyaKinel2023steam'),
        displayName: 'точка',
        steamId: '1',
        games: '730',
        sharedSecret: '', // Для Steam Guard Mobile
        guardType: 'none',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline'
    },
    'acc_2': {
        id: 'acc_2',
        username: encrypt('k1nelsteam'),
        password: encrypt('JenyaKinel2023steam'),
        displayName: 'кинелька',
        steamId: '2',
        games: '730',
        sharedSecret: '', // Добавить при настройке
        guardType: 'SGM',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline'
    }
};

// 🔒 Функции шифрования
function encrypt(text) {
    const cipher = crypto.createCipher('aes-256-gcm', ENCRYPTION_KEY);
    return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

function decrypt(encrypted) {
    try {
        const decipher = crypto.createDecipher('aes-256-gcm', ENCRYPTION_KEY);
        return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
    } catch {
        return encrypted; // Fallback для старых данных
    }
}

// 🗄️ Управление данными
function loadAccounts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const accounts = JSON.parse(data);
            // Миграция старых паролей
            Object.values(accounts).forEach(acc => {
                if (!acc.username.startsWith('encrypted:')) {
                    acc.username = encrypt(acc.username);
                    acc.password = encrypt(acc.password);
                    if (acc.sharedSecret) acc.sharedSecret = encrypt(acc.sharedSecret);
                }
            });
            return accounts;
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки, использую предустановленные');
    }
    return DEFAULT_ACCOUNTS;
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов');
        return false;
    }
}

let accounts = loadAccounts();

// 🤖 Улучшенный Steam Bot
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new SteamUser({
            promptSteamGuardCode: false,
            dataDirectory: './steam_data'
        });
        this.isRunning = false;
        this.steamGuardCallback = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            const displayName = this.config.displayName;
            console.log(`✅ [${displayName}] Успешный вход в Steam`);
            
            this.client.setPersona(SteamUser.EPersonaState.Online);
            
            // 🎮 Запуск реального фарминга
            const games = this.config.games.split(' ').map(g => parseInt(g)).filter(g => !isNaN(g));
            if (games.length > 0) {
                this.client.gamesPlayed(games);
                console.log(`🎮 [${displayName}] Фармим игры: ${games.join(', ')}`);
            }
            
            this.isRunning = true;
            this.reconnectAttempts = 0;
            
            this.updateAccountStatus('running', 'online');
        });

        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
            const displayName = this.config.displayName;
            
            if (lastCodeWrong) {
                console.log(`❌ [${displayName}] Неверный Steam Guard код`);
                this.updateAccountStatus('stopped', 'guard_error');
                return;
            }

            // 🔐 Автоматическая генерация кода для Mobile Guard
            if (this.config.sharedSecret) {
                try {
                    const code = SteamTotp.generateAuthCode(this.config.sharedSecret);
                    console.log(`🔐 [${displayName}] Авто-генерация Steam Guard кода: ${code}`);
                    callback(code);
                    return;
                } catch (error) {
                    console.log(`❌ [${displayName}] Ошибка генерации кода:`, error.message);
                }
            }

            console.log(`🔐 [${displayName}] Требуется Steam Guard код ${domain ? `от ${domain}` : ''}`);
            this.steamGuardCallback = callback;
            this.updateAccountStatus('stopped', 'steam_guard', true);
        });

        this.client.on('error', (err) => {
            const displayName = this.config.displayName;
            console.log(`❌ [${displayName}] Ошибка:`, err.message);
            
            if (err.eresult === SteamUser.EResult.InvalidPassword) {
                console.log(`🔑 [${displayName}] Логин: ${decrypt(this.config.username)}`);
                console.log(`🔑 [${displayName}] Пароль: ${decrypt(this.config.password)}`);
            }
            
            this.handleError(err.message);
        });

        this.client.on('disconnected', (eresult, msg) => {
            const displayName = this.config.displayName;
            console.log(`🔌 [${displayName}] Отключен:`, msg || eresult);
            
            if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`🔄 [${displayName}] Переподключение через 10 сек... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.startFarming(), 10000);
            } else {
                this.handleError('Max reconnection attempts reached');
            }
        });
    }

    updateAccountStatus(farmStatus, botStatus, needsGuardCode = false) {
        if (accounts[this.config.id]) {
            accounts[this.config.id].farmStatus = farmStatus;
            accounts[this.config.id].botStatus = botStatus;
            accounts[this.config.id].needsGuardCode = needsGuardCode;
            if (botStatus === 'online') accounts[this.config.id].error = null;
            saveAccounts(accounts);
        }
    }

    handleError(error) {
        this.isRunning = false;
        this.updateAccountStatus('stopped', 'error', false, error);
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            console.log(`🔐 [${this.config.displayName}] Отправка кода: ${code}`);
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            this.updateAccountStatus('starting', 'connecting', false);
            return true;
        }
        return false;
    }

    startFarming() {
        if (this.isRunning) {
            console.log(`⚠️ [${this.config.displayName}] Уже запущен`);
            return;
        }

        console.log(`🚀 [${this.config.displayName}] Запуск фарминга...`);
        console.log(`🔑 [${this.config.displayName}] Логин: ${decrypt(this.config.username)}`);
        console.log(`🔑 [${this.config.displayName}] Пароль: ${decrypt(this.config.password)}`);
        
        const logOnOptions = {
            accountName: decrypt(this.config.username),
            password: decrypt(this.config.password)
        };

        // 🔐 Добавляем sharedSecret для Mobile Guard
        if (this.config.sharedSecret) {
            logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(decrypt(this.config.sharedSecret));
        }

        this.updateAccountStatus('starting', 'connecting');
        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 [${this.config.displayName}] Остановка фарминга...`);
            this.client.logOff();
            this.isRunning = false;
            this.reconnectAttempts = 0;
            this.steamGuardCallback = null;
            this.updateAccountStatus('stopped', 'offline');
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            farmStatus: accounts[this.config.id]?.farmStatus || 'stopped',
            botStatus: accounts[this.config.id]?.botStatus || 'offline',
            needsGuardCode: accounts[this.config.id]?.needsGuardCode || false,
            error: accounts[this.config.id]?.error || null
        };
    }
}

// 🎯 Менеджер ботов
class BotManager {
    constructor() {
        this.bots = new Map();
    }

    createBot(accountConfig) {
        const bot = new SteamFarmBot(accountConfig);
        this.bots.set(accountConfig.id, bot);
        return bot;
    }

    startFarm(accountId) {
        let bot = this.bots.get(accountId);
        if (!bot && accounts[accountId]) {
            bot = this.createBot(accounts[accountId]);
        }
        if (bot) {
            bot.startFarming();
            return true;
        }
        return false;
    }

    stopFarm(accountId) {
        const bot = this.bots.get(accountId);
        if (bot) {
            bot.stopFarming();
            return true;
        }
        return false;
    }

    submitSteamGuardCode(accountId, code) {
        const bot = this.bots.get(accountId);
        if (bot) {
            return bot.submitSteamGuardCode(code);
        }
        return false;
    }

    getStatus(accountId) {
        const bot = this.bots.get(accountId);
        return bot ? bot.getStatus() : {
            isRunning: false,
            farmStatus: 'stopped',
            botStatus: 'offline',
            needsGuardCode: false,
            error: null
        };
    }
}

const botManager = new BotManager();

// 🚀 Express настройки
app.use(express.json());
app.use(express.static('public'));

// 🌐 API Routes
app.get('/', (req, res) => {
    res.send(generateDashboardHTML());
});

app.get('/api/status', (req, res) => {
    Object.keys(accounts).forEach(accountId => {
        const botStatus = botManager.getStatus(accountId);
        if (accounts[accountId]) {
            accounts[accountId].farmStatus = botStatus.farmStatus;
            accounts[accountId].botStatus = botStatus.botStatus;
            accounts[accountId].needsGuardCode = botStatus.needsGuardCode;
            accounts[accountId].error = botStatus.error;
        }
    });
    saveAccounts(accounts);
    res.json({ accounts: accounts, serverTime: new Date() });
});

app.post('/api/accounts/add', (req, res) => {
    const { username, password, displayName, steamId, games, guardType, sharedSecret } = req.body;
    
    if (!username || !password || !displayName || !steamId) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const accountId = 'acc_' + Date.now();
    
    accounts[accountId] = {
        id: accountId,
        username: encrypt(username),
        password: encrypt(password),
        displayName,
        steamId,
        games: games || '730',
        sharedSecret: sharedSecret ? encrypt(sharedSecret) : '',
        guardType: guardType || 'none',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        needsGuardCode: false
    };

    if (saveAccounts(accounts)) {
        console.log(`✅ Добавлен аккаунт: ${displayName}`);
        console.log(`🔑 Логин: ${username}`);
        console.log(`🔑 Пароль: ${password}`);
        res.json({ success: true, message: 'Аккаунт добавлен', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (accounts[accountId]) {
        const accountName = accounts[accountId].displayName;
        botManager.stopFarm(accountId);
        delete accounts[accountId];
        
        if (saveAccounts(accounts)) {
            console.log(`🗑️ Удален аккаунт: ${accountName}`);
            res.json({ success: true, message: 'Аккаунт удален' });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.startFarm(accountId)) {
        console.log(`🎮 Запущен фарм: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        console.log(`⏹️ Остановлен фарм: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Введите код' });
    }
    
    console.log(`🔐 Отправка кода для ${accountId}: ${code}`);
    
    if (botManager.submitSteamGuardCode(accountId, code)) {
        console.log(`✅ Код отправлен для: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Код отправлен' });
    } else {
        res.status(400).json({ error: 'Ошибка отправки кода' });
    }
});

// 🎨 HTML Dashboard
function generateDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Steam Booster</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#0f172a;color:white;padding:20px}.header{text-align:center;margin-bottom:30px}.header h1{font-size:2.5rem;color:#8b5cf6;margin-bottom:10px}.accounts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px}.account-card{background:#1e293b;padding:20px;border-radius:10px;border-left:4px solid #8b5cf6}.account-header{display:flex;justify-content:space-between;margin-bottom:15px}.account-name{font-size:1.3rem;font-weight:bold}.account-status{padding:5px 10px;border-radius:5px;font-size:.8rem}.status-online{background:#10b981}.status-steam_guard{background:#f59e0b}.status-error{background:#ef4444}.status-offline{background:#6b7280}.account-details{margin-bottom:15px}.detail-row{display:flex;justify-content:space-between;margin-bottom:5px}.detail-label{color:#94a3b8}.btn{padding:10px 15px;border:none;border-radius:5px;cursor:pointer;margin:5px;color:white}.btn-success{background:#10b981}.btn-danger{background:#ef4444}.btn-warning{background:#f59e0b}.btn-primary{background:#8b5cf6}.steam-guard-section{background:#f59e0b20;padding:15px;border-radius:5px;margin:10px 0}.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);align-items:center;justify-content:center}.modal-content{background:#1e293b;padding:30px;border-radius:10px;max-width:400px;width:90%}.form-group{margin-bottom:15px}.form-group input{width:100%;padding:10px;border-radius:5px;border:1px solid #374151;background:#0f172a;color:white}.notification{position:fixed;top:20px;right:20px;padding:15px;background:#1e293b;border-radius:5px;transform:translateX(400px);transition:transform .3s}.notification.show{transform:translateX(0)}
    </style>
</head>
<body>
    <div id="notification" class="notification"></div>
    <div id="steamGuardModal" class="modal">
        <div class="modal-content">
            <h3>🔐 Steam Guard код</h3>
            <div id="steamGuardContent"></div>
        </div>
    </div>
    <div class="header">
        <h1>Steam Booster</h1>
        <button class="btn btn-primary" onclick="showAddAccountModal()">+ Добавить аккаунт</button>
    </div>
    <div class="accounts-grid" id="accounts-container"></div>
    <script>
        class Dashboard {
            constructor() {
                this.init();
            }
            init() {
                this.loadData();
                setInterval(() => this.loadData(), 3000);
            }
            async loadData() {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    this.renderAccounts(data.accounts);
                } catch (error) {
                    this.showNotification('Ошибка загрузки','error');
                }
            }
            renderAccounts(accounts) {
                const container = document.getElementById('accounts-container');
                const accountsArray = Object.values(accounts);
                container.innerHTML = accountsArray.map(account => \`
                    <div class="account-card">
                        <div class="account-header">
                            <div class="account-name">\${account.displayName}</div>
                            <div class="account-status status-\${account.botStatus}">
                                \${account.botStatus === 'steam_guard' ? 'Steam Guard' : 
                                  account.botStatus === 'online' ? 'Онлайн' :
                                  account.botStatus === 'error' ? 'Ошибка' : 'Оффлайн'}
                            </div>
                        </div>
                        <div class="account-details">
                            <div class="detail-row">
                                <span class="detail-label">Логин:</span>
                                <span>\${account.username}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Защита:</span>
                                <span>\${account.guardType === 'SGM' ? '📱 Mobile Guard' : account.guardType === 'SGP' ? '📧 Email Guard' : '❌ Нет'}</span>
                            </div>
                            \${account.error ? \`
                            <div class="detail-row">
                                <span class="detail-label">Ошибка:</span>
                                <span style="color: #ef4444;">\${account.error}</span>
                            </div>
                            \` : ''}
                        </div>
                        \${account.needsGuardCode ? \`
                        <div class="steam-guard-section">
                            <p><strong>Требуется Steam Guard код</strong></p>
                            <button class="btn btn-warning" onclick="showSteamGuardModal('\${account.id}', '\${account.displayName}')" style="width: 100%;">
                                Ввести код
                            </button>
                        </div>
                        \` : ''}
                        <div>
                            \${account.farmStatus === 'running' ? \`
                                <button class="btn btn-danger" onclick="stopFarm('\${account.id}')">Стоп</button>
                            \` : \`
                                <button class="btn btn-success" onclick="startFarm('\${account.id}')">Старт</button>
                            \`}
                            <button class="btn btn-primary" onclick="showCredentials('\${account.id}')">Данные</button>
                            <button class="btn btn-danger" onclick="deleteAccount('\${account.id}')">Удалить</button>
                        </div>
                    </div>
                \`).join('');
            }
            showNotification(message, type = 'info') {
                const notification = document.getElementById('notification');
                notification.textContent = message;
                notification.className = \`notification \${type} show\`;
                setTimeout(() => notification.classList.remove('show'), 3000);
            }
        }

        function showSteamGuardModal(accountId, accountName) {
            document.getElementById('steamGuardContent').innerHTML = \`
                <div class="form-group">
                    <label>Код для \${accountName}:</label>
                    <input type="text" id="steamGuardCode" placeholder="Введите 5-значный код" maxlength="5">
                </div>
                <button class="btn btn-warning" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                    Подтвердить
                </button>
            \`;
            document.getElementById('steamGuardModal').style.display = 'flex';
        }

        async function submitSteamGuardCode(accountId) {
            const code = document.getElementById('steamGuardCode').value;
            if (!code) {
                dashboard.showNotification('Введите код','error');
                return;
            }
            try {
                const response = await fetch(\`/api/steam-guard/\${accountId}\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ code })
                });
                const result = await response.json();
                if (result.success) {
                    dashboard.showNotification('Код отправлен!','success');
                    document.getElementById('steamGuardModal').style.display = 'none';
                } else {
                    dashboard.showNotification(result.error,'error');
                }
            } catch (error) {
                dashboard.showNotification('Ошибка отправки','error');
            }
        }

        async function startFarm(accountId) {
            try {
                const response = await fetch(\`/api/farm/start/\${accountId}\`, {method: 'POST'});
                const result = await response.json();
                dashboard.showNotification(result.success ? 'Фарм запущен' : result.error, result.success ? 'success' : 'error');
            } catch (error) {
                dashboard.showNotification('Ошибка запуска','error');
            }
        }

        async function stopFarm(accountId) {
            try {
                const response = await fetch(\`/api/farm/stop/\${accountId}\`, {method: 'POST'});
                const result = await response.json();
                dashboard.showNotification(result.success ? 'Фарм остановлен' : result.error, result.success ? 'success' : 'error');
            } catch (error) {
                dashboard.showNotification('Ошибка остановки','error');
            }
        }

        function showCredentials(accountId) {
            fetch('/api/status')
                .then(r => r.json())
                .then(data => {
                    const account = data.accounts[accountId];
                    if (account) {
                        alert(\`Данные аккаунта:\\nЛогин: \${account.username}\\nПароль: \${account.password}\`);
                    }
                });
        }

        async function deleteAccount(accountId) {
            if (confirm('Удалить аккаунт?')) {
                try {
                    const response = await fetch(\`/api/accounts/delete/\${accountId}\`, {method: 'POST'});
                    const result = await response.json();
                    dashboard.showNotification(result.success ? 'Аккаунт удален' : result.error, result.success ? 'success' : 'error');
                    dashboard.loadData();
                } catch (error) {
                    dashboard.showNotification('Ошибка удаления','error');
                }
            }
        }

        function showAddAccountModal() {
            const username = prompt('Логин Steam:');
            const password = prompt('Пароль Steam:');
            const displayName = prompt('Название на сайте:');
            const steamId = prompt('Steam ID:');
            const guardType = prompt('Тип защиты (SGM - Mobile, SGP - Email, пусто - нет защиты):','');
            const sharedSecret = guardType === 'SGM' ? prompt('Shared Secret (из Steam Mobile):') : '';

            if (username && password && displayName && steamId) {
                fetch('/api/accounts/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        username, password, displayName, steamId, 
                        games: '730', guardType: guardType || 'none', sharedSecret
                    })
                })
                .then(r => r.json())
                .then(result => {
                    alert(result.success ? 'Аккаунт добавлен' : result.error);
                    if (result.success) dashboard.loadData();
                });
            }
        }

        const dashboard = new Dashboard();
        document.getElementById('steamGuardModal').addEventListener('click', (e) => {
            if (e.target.id === 'steamGuardModal') e.target.style.display = 'none';
        });
    </script>
</body>
</html>`;
}

// 🚀 Запуск сервера
console.log('🚀 Запуск Steam Booster...');
console.log('🔐 Пароли зашифрованы');
console.log('📱 Steam Guard Mobile поддержка включена');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT}`);
});
