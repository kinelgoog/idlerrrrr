
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const SteamFarmBot = require('./bots');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

const accounts = {
    acc_1: {
        id: 'acc_1',
        displayName: 'точка',
        username: process.env.ACC_1_USERNAME,
        password: process.env.ACC_1_PASSWORD,
        sharedSecret: process.env.ACC_1_SHAREDSECRET,
        games: [730],
    },
    acc_2: {
        id: 'acc_2',
        displayName: 'кинелька',
        username: process.env.ACC_2_USERNAME,
        password: process.env.ACC_2_PASSWORD,
        sharedSecret: process.env.ACC_2_SHAREDSECRET,
        games: [730],
    },
};

const bots = {};
for (const id in accounts) {
    bots[id] = new SteamFarmBot({ ...accounts[id], id });
}

wss.on('connection', ws => {
    const interval = setInterval(() => {
        const statusData = {};
        for (const id in bots) {
            const bot = bots[id];
            statusData[id] = {
                displayName: bot.config.displayName,
                status: bot.status,
                needsGuardCode: !!bot.steamGuardCallback,
                errorMessage: bot.errorMessage || null,
                log: bot.logMessages,
                hoursPlayed: bot.hoursPlayed,
            };
        }
        ws.send(JSON.stringify({ type: 'update', accounts: statusData }));
    }, 2000);

    ws.on('close', () => clearInterval(interval));
});

app.post('/api/farm/start/:id', (req, res) => {
    const bot = bots[req.params.id];
    if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
    bot.start();
    res.json({ success: true });
});

app.post('/api/farm/stop/:id', (req, res) => {
    const bot = bots[req.params.id];
    if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
    bot.stop();
    res.json({ success: true });
});

app.post('/api/steam-guard/:id', (req, res) => {
    const bot = bots[req.params.id];
    const { code } = req.body;
    if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
    if (!code) return res.status(400).json({ error: 'Введите код' });
    if (bot.submitSteamGuardCode(code)) res.json({ success: true });
    else res.status(400).json({ error: 'Код не принят' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на http://localhost:${PORT}`));
