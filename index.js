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
        botStatus: 'offline',
        lastLoginAttempt: 0
    },
    'acc_2': {
        id: 'acc_2',
        username: 'k1nelsteam',
        password: 'JenyaKinel2023steam',
        displayName: 'кинелька',
        games: '730', 
        farmStatus: 'stopped',
        botStatus: 'offline',
        lastLoginAttempt: 0
    }
};

// 🤖 Steam Bot
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new SteamUser({
            promptSteamGuardCode: false,
            dataDirectory: './steam_data',
            enablePicsCache: false,
            autoRelogin: false
        });
        this.isRunning = false;
        this.steamGuardCallback = null;
        this.loginTimeout = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ [${this.config.displayName}] Успешный вход!`);
            
            this.client.setPersona(1);
            const games = this.config.games.split(' ').map(g => parseInt(g));
            this.client.gamesPlayed(games);
            
            this.isRunning = true;
            accounts[this.config.id].farmStatus = 'running';
            accounts[this.config.id].botStatus = 'online';
            accounts[this.config.id].error = null;
            
            if (this.loginTimeout) {
                clearTimeout(this.loginTimeout);
                this.loginTimeout = null;
            }
        });

        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
            console.log(`🔐 [${this.config.displayName}] Steam Guard запрос!`);
            
            if (lastCodeWrong) {
                console.log(`❌ [${this.config.displayName}] Неверный код!`);
                accounts[this.config.id].error = 'Неверный Steam Guard код';
                return;
            }

            // Сохраняем callback для ввода кода
            this.steamGuardCallback = callback;
            accounts[this.config.id].botStatus = 'steam_guard';
            accounts[this.config.id].needsGuardCode = true;
            accounts[this.config.id].error = null;
            
            console.log(`📱 [${this.config.displayName}] Проверь Steam Mobile - должен прийти запрос на подтверждение!`);
        });

        this.client.on('error', (err) => {
            console.log(`❌ [${this.config.displayName}] Ошибка:`, err.message);
            
            if (err.eresult === SteamUser.EResult.RateLimitExceeded) {
                console.log(`⏳ [${this.config.displayName}] Лимит запросов! Ждем 5 минут...`);
                accounts[this.config.id].error = 'Лимит запросов Steam. Попробуй через 5 минут';
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
                
                // Блокируем повторные попытки на 5 минут
                accounts[this.config.id].lastLoginAttempt = Date.now();
            } else {
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].error = err.message;
            }
            
            if (this.loginTimeout) {
                clearTimeout(this.loginTimeout);
                this.loginTimeout = null;
            }
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

        // Проверяем лимит запросов
        const timeSinceLastAttempt = Date.now() - accounts[this.config.id].lastLoginAttempt;
        if (timeSinceLastAttempt < 300000) { // 5 минут
            const waitTime = Math.ceil((300000 - timeSinceLastAttempt) / 1000 / 60);
            console.log(`⏳ [${this.config.displayName}] Подожди еще ${waitTime} минут(ы) из-за лимита Steam`);
            accounts[this.config.id].error = `Лимит Steam. Подожди ${waitTime} минут(ы)`;
            return;
        }

        console.log(`🚀 [${this.config.displayName}] Запуск...`);
        console.log(`🔑 Логин: ${this.config.username}`);

        accounts[this.config.id].farmStatus = 'starting';
        accounts[this.config.id].botStatus = 'connecting';
        accounts[this.config.id].error = null;
        accounts[this.config.id].needsGuardCode = false;
        accounts[this.config.id].lastLoginAttempt = Date.now();

        // Добавляем случайную задержку перед входом
        const delay = Math.random() * 10000 + 5000; // 5-15 секунд
        console.log(`⏳ [${this.config.displayName}] Задержка ${Math.round(delay/1000)} сек...`);

        setTimeout(() => {
            this.client.logOn({
                accountName: this.config.username,
                password: this.config.password,
                machineName: `SteamBooster-${Date.now()}`
            });

            // Таймаут подключения
            this.loginTimeout = setTimeout(() => {
                if (!this.isRunning) {
                    console.log(`⏰ [${this.config.displayName}] Таймаут подключения`);
                    accounts[this.config.id].botStatus = 'error';
                    accounts[this.config.id].farmStatus = 'stopped';
                    accounts[this.config.id].error = 'Таймаут подключения';
                }
            }, 45000); // 45 секунд

        }, delay);
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
        
        if (this.loginTimeout) {
            clearTimeout(this.loginTimeout);
            this.loginTimeout = null;
        }
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
            .accounts { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; }
            .account { background: #2d2d2d; padding: 20px; border-radius: 10px; border-left: 4px solid #7289da; }
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
            .instructions { background: #faa61a20; padding: 15px; border-radius: 5px; margin: 10px 0; font-size: 0.9em; }
            .rate-limit { background: #f0474720; padding: 15px; border-radius: 5px; margin: 10px 0; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎮 Steam Booster</h1>
            <p>Умный фарминг с защитой от лимитов Steam</p>
        </div>
        
        <div id="steamGuardModal" class="modal">
            <div class="modal-content">
                <h3>🔐 Steam Guard код</h3>
                <div id="steamGuardContent"></div>
            </div>
        </div>
        
        <div class="accounts" id="accounts">
            ${Object.values(accounts).map(acc => {
                const timeSinceLastAttempt = Date.now() - acc.lastLoginAttempt;
                const isRateLimited = timeSinceLastAttempt < 300000;
                const waitMinutes = Math.ceil((300000 - timeSinceLastAttempt) / 1000 / 60);
                
                return `
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
                    
                    ${isRateLimited && acc.error ? `
                    <div class="rate-limit">
                        <strong>⏳ Лимит Steam:</strong> Подожди ${waitMinutes} минут(ы) перед следующим запуском
                    </div>
                    ` : ''}
                    
                    ${acc.error && !isRateLimited ? `<div class="error-text"><strong>Ошибка:</strong> ${acc.error}</div>` : ''}
                    
                    ${acc.needsGuardCode ? `
                    <div class="guard-section">
                        <div class="instructions">
                            <strong>📱 Подтверди вход в Steam Mobile:</strong><br>
                            1. Открой Steam Mobile на телефоне<br>
                            2. Должен прийти запрос "Подтвердить вход"<br>
                            3. Нажми "ПОДТВЕРДИТЬ"<br>
                            <strong>ИЛИ</strong><br>
                            4. Нажми "Steam Guard" внизу<br>
                            5. Скопируй 5-значный код и введи ниже
                        </div>
                        <button class="btn guard" onclick="showSteamGuardModal('${acc.id}', '${acc.displayName}')" style="width: 100%; margin-top: 10px;">
                            🔐 ВВЕСТИ КОД
                        </button>
                    </div>
                    ` : ''}
                    
                    <div style="margin-top: 15px;">
                        ${acc.farmStatus === 'running' ? 
                            '<button class="btn stop" onclick="stopFarm(\'' + acc.id + '\')">⏹️ СТОП</button>' : 
                            `<button class="btn start" onclick="startFarm('${acc.id}')" ${isRateLimited ? 'disabled style="background: #666;"' : ''}>🎮 СТАРТ</button>`
                        }
                        <button class="btn" style="background: #7289da;" onclick="location.reload()">🔄 ОБНОВИТЬ</button>
                    </div>
                </div>
                `;
            }).join('')}
        </div>

        <script>
            function showSteamGuardModal(accountId, accountName) {
                document.getElementById('steamGuardContent').innerHTML = \`
                    <div class="form-group">
                        <label>Введите код для <strong>\${accountName}</strong>:</label>
                        <input type="text" id="steamGuardCode" placeholder="5-значный код из Steam Mobile" maxlength="5" autofocus>
                    </div>
                    <button class="btn guard" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                        🔐 ОТПРАВИТЬ КОД
                    </button>
                    <div style="margin-top: 10px; text-align: center;">
                        <button class="btn" style="background: #747f8d; width: 100%;" onclick="document.getElementById('steamGuardModal').style.display='none'">
                            ❌ ОТМЕНА
                        </button>
                    </div>
                \`;
                document.getElementById('steamGuardModal').style.display = 'flex';
                document.getElementById('steamGuardCode').focus();
            }

            async function submitSteamGuardCode(accountId) {
                const code = document.getElementById('steamGuardCode').value;
                if (!code || code.length !== 5) {
                    alert('Введите 5-значный код');
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
                        setTimeout(() => location.reload(), 1000);
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
                        setTimeout(() => location.reload(), 1000);
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
                        setTimeout(() => location.reload(), 1000);
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

// ... остальные роуты без изменений ...

// 🚀 Запуск
console.log('🚀 Steam Booster с защитой от лимитов запущен!');
console.log('📝 Особенности:');
console.log('   - Случайные задержки 5-15 секунд между запросами');
console.log('   - Блокировка на 5 минут при лимите');
console.log('   - Уникальные machineName для каждого входа');
console.log(`📡 Сервер: http://localhost:${PORT}`);

app.listen(PORT, '0.0.0.0');
