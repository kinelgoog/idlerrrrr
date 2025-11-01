const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'app.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ Ошибка при подключении к базе:', err);
  else console.log('✅ SQLite база подключена');
});

// Инициализация таблиц
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS steam_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    password TEXT,
    display_name TEXT,
    shared_secret TEXT,
    farm_status TEXT DEFAULT 'stopped',
    bot_status TEXT DEFAULT 'offline',
    error TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

module.exports = db;
