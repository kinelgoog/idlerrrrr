const express = require('express');
const SteamUser = require('steam-user');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Аккаунты
const accounts = {
    'acc_1': {
        id: 'acc_1',
        username: 'tochka_bi_laik',
        password: 'JenyaKinel2023steam',
        displayName: 'точка',
        games: '730',
        farmStatus: 'stopped',
        botStatus: 'offline'
    },
    'acc_2': {
        id: 'acc_2',
        username: 'k1nelsteam',
        password: 'JenyaKinel2023steam',
        displayName: 'кинелька',
        games: '730', 
        farmStatus: 'stopped',
        botStatus: 'offline'
    }
};

// 🤖 Простой Steam Bot
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new SteamUser();
        this.isRunning = false;
        this.steamGuardCallback = null;
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ [${this.config.displayName}] Успешный вход!`);
            
            this.client.setPersona(1);
            this.client.gamesPlayed([730]); // CS2
            
            this.isRunning = true;
            accounts[this.config.id].farmStatus = 'running';
            accounts[this.config.id].botStatus = 'online';
            accounts[this.config.id].error = null;
        });

        this.client.on('steamGuard', (domain, callback) => {
            console.log(`🔐 [${this.config.displayName}] Требуется Steam Guard!`);
            
            // Сохраняем callback для ввода кода
            this.steamGuardCallback = callback;
            accounts[this.config.id].botStatus = 'steam_guard';
            accounts[this.config.id].needsGuardCode = true;
        });

        this.client.on('error', (err) => {
            console.log(`❌ [${this.config.displayName}] Ошибка:`, err.message);
            
            accounts[this.config.id].botStatus = 'error';
            accounts[this.config.id].farmStatus = 'stopped';
            accounts[this.config.id].error = err.message;
        });

        this.client.on('disconnected', () => {
            console.log(`🔌 [${this.config.displayName}] Отключен`);
            this.isRunning = false;
            accounts[this.config.id].botStatus = 'offline';
            accounts[this.config.id].farmStatus = 'stopped';
        });
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            console.log(`🔐 [${this.config.displayName}] Отправка кода: ${code}`);
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            accounts[this.config.id].needsGuardCode = false;
            accounts[this.config.id].botStatus = 'connecting';
            return true;
        }
        return false;
    }

    startFarming() {
        if (this.isRunning) return;

        console.log(`🚀 [${this.config.displayName}] Запуск...`);

        accounts[this.config.id].farmStatus = 'starting';
        accounts[this.config.id].botStatus = 'connecting';
        accounts[this.config.id].error = null;
        accounts[this.config.id].needsGuardCode = false;

        this.setupEventHandlers();
        
        this.client.logOn({
            accountName: this.config.username,
            password: this.config.password
        });
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 [${this.config.displayName}] Остановка...`);
            this.client.logOff();
        }
        this.isRunning = false;
        this.steamGuardCallback = null;
        accounts[this.config.id].farmStatus = 'stopped';
        accounts[this.config.id].botStatus = 'offline';
    }
}

// 🎯 Менеджер ботов
const bots = new Map();

function startFarm(accountId) {
    if (!accounts[accountId]) return false;
    
    let bot = bots.get(accountId);
    if (!bot) {
        bot = new SteamFarmBot(accounts[accountId]);
        bots.set(accountId, bot);
    }
    
    bot.startFarming();
    return true;
}

function stopFarm(accountId) {
    const bot = bots.get(accountId);
    if (bot) {
        bot.stopFarming();
        return true;
    }
    return false;
}

function submitSteamGuardCode(accountId, code) {
    const bot = bots.get(accountId);
    if (bot) {
        return bot.submitSteamGuardCode(code);
    }
    return false;
}

// 🚀 Express
app.use(express.json());

// 🌐 Routes
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Steam Booster</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial; background: #1e1e1e; color: white; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .accounts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .account { background: #2d2d2d; padding: 20px; border-radius: 10px; }
            .account-header { display: flex; justify-content: space-between; margin-bottom: 15px; }
            .account-name { font-size: 1.2em; font-weight: bold; }
            .status { padding: 5px 10px; border-radius: 5px; font-size: 0.8em; }
            .online { background: #43b581; }
            .error { background: #f04747; }
            .offline { background: #747f8d; }
            .steam_guard { background: #faa61a; }
            .btn { padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; color: white; margin: 5px; }
            .start { background: #43b581; }
            .stop { background: #f04747; }
            .guard { background: #faa61a; }
            .error-text { color: #f04747; margin: 10px 0; }
            .guard-section { background: #faa61a20; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); align-items: center; justify-content: center; }
            .modal-content { background: #2d2d2d; padding: 30px; border-radius: 10px; max-width: 400px; width: 90%; }
            .form-group { margin-bottom: 15px; }
            .form-group input { width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #444; background: #1e1e1e; color: white; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎮 Steam Booster</h1>
            <p>Простой фарминг часов</p>
        </div>
        
        <div id="steamGuardModal" class="modal">
            <div class="modal-content">
                <h3>🔐 Steam Guard код</h3>
                <div id="steamGuardContent"></div>
            </div>
        </div>
        
        <div class="accounts" id="accounts">
            ${Object.values(accounts).map(acc => `
                <div class="account">
                    <div class="account-header">
                        <div class="account-name">${acc.displayName}</div>
                        <div class="status ${acc.botStatus}">
                            ${acc.botStatus === 'online' ? 'ОНЛАЙН' : 
                              acc.botStatus === 'steam_guard' ? 'STEAM GUARD' : 
                              acc.botStatus === 'error' ? 'ОШИБКА' : 'ОФФЛАЙН'}
                        </div>
                    </div>
                    <div><strong>Игры:</strong> ${acc.games}</div>
                    ${acc.error ? `<div class="error-text"><strong>Ошибка:</strong> ${acc.error}</div>` : ''}
                    
                    ${acc.needsGuardCode ? `
                    <div class="guard-section">
                        <strong>🔐 Требуется Steam Guard код</strong>
                        <button class="btn guard" onclick="showSteamGuardModal('${acc.id}', '${acc.displayName}')" style="width: 100%; margin-top: 10px;">
                            ВВЕСТИ КОД
                        </button>
                    </div>
                    ` : ''}
                    
                    <div style="margin-top: 15px;">
                        ${acc.farmStatus === 'running' ? 
                            '<button class="btn stop" onclick="stopFarm(\'' + acc.id + '\')">⏹️ СТОП</button>' : 
                            '<button class="btn start" onclick="startFarm(\'' + acc.id + '\')">🎮 СТАРТ</button>'
                        }
                        <button class="btn" style="background: #7289da;" onclick="location.reload()">🔄 ОБНОВИТЬ</button>
                    </div>
                </div>
            `).join('')}
        </div>

        <script>
            function showSteamGuardModal(accountId, accountName) {
                document.getElementById('steamGuardContent').innerHTML = \`
                    <div class="form-group">
                        <label>Введите код для <strong>\${accountName}</strong>:</label>
                        <input type="text" id="steamGuardCode" placeholder="5-значный код" maxlength="5">
                    </div>
                    <button class="btn guard" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                        ОТПРАВИТЬ КОД
                    </button>
                \`;
                document.getElementById('steamGuardModal').style.display = 'flex';
            }

            async function submitSteamGuardCode(accountId) {
                const code = document.getElementById('steamGuardCode').value;
                if (!code) {
                    alert('Введите код');
                    return;
                }

                try {
                    const response = await fetch('/api/steam-guard/' + accountId, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ code: code })
                    });
                    const result = await response.json();
                    if (result.success) {
                        document.getElementById('steamGuardModal').style.display = 'none';
                        location.reload();
                    } else {
                        alert('Ошибка: ' + result.error);
                    }
                } catch (error) {
                    alert('Ошибка сети');
                }
            }

            async function startFarm(accountId) {
                try {
                    const response = await fetch('/api/farm/start/' + accountId, { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        location.reload();
                    } else {
                        alert('Ошибка: ' + result.error);
                    }
                } catch (error) {
                    alert('Ошибка сети');
                }
            }

            async function stopFarm(accountId) {
                try {
                    const response = await fetch('/api/farm/stop/' + accountId, { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        location.reload();
                    }
                } catch (error) {
                    alert('Ошибка сети');
                }
            }

            document.getElementById('steamGuardModal').addEventListener('click', function(e) {
                if (e.target === this) {
                    this.style.display = 'none';
                }
            });

            setInterval(() => {
                location.reload();
            }, 3000);
        </script>
    </body>
    </html>
    `);
});

app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    if (startFarm(accountId)) {
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    if (stopFarm(accountId)) {
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
    
    if (submitSteamGuardCode(accountId, code)) {
        res.json({ success: true, message: 'Код отправлен' });
    } else {
        res.status(400).json({ error: 'Ошибка отправки кода' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ accounts });
});

// 🚀 Запуск
console.log('🚀 Steam Booster запущен!');
console.log(`📡 Сервер: http://localhost:${PORT}`);

app.listen(PORT, '0.0.0.0');
