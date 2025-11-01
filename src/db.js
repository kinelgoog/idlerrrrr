const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const logger = require('./utils/logger');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

async function init(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, created_at INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS steam_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, steam_login TEXT, steam_password TEXT,
      display_name TEXT, games TEXT, shared_secret TEXT, identity_secret TEXT,
      farmStatus TEXT, botStatus TEXT, error TEXT, needsGuardCode INTEGER DEFAULT 0,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  return {
    createUser: async (username, password) => {
      const id = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      const now = Date.now();
      await db.run('INSERT INTO users(id, username, password, created_at) VALUES(?,?,?,?)', id, username, hash, now);
      return { id, username, created_at: now };
    },
    findUserByUsername: async (username) => {
      return await db.get('SELECT id, username, password FROM users WHERE username = ?', username);
    },
    getUserById: async (id) => {
      return await db.get('SELECT id, username, created_at FROM users WHERE id = ?', id);
    },
    createSteamAccount: async (userId, acct) => {
      const id = uuidv4();
      const now = Date.now();
      await db.run(`INSERT INTO steam_accounts(id,user_id,steam_login,steam_password,display_name,games,shared_secret,identity_secret,farmStatus,botStatus,error,needsGuardCode,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, userId, acct.steam_login, acct.steam_password, acct.display_name || acct.steam_login, JSON.stringify(acct.games||[]), acct.shared_secret||null, acct.identity_secret||null, 'stopped','offline',null,0, now);
      return id;
    },
    getSteamAccountsByUser: async (userId) => {
      const rows = await db.all('SELECT * FROM steam_accounts WHERE user_id = ?', userId);
      return rows.map(r => ({ ...r, games: JSON.parse(r.games||'[]'), needsGuardCode: !!r.needsGuardCode }));
    },
    getSteamAccount: async (id) => {
      const r = await db.get('SELECT * FROM steam_accounts WHERE id = ?', id);
      if (!r) return null;
      r.games = JSON.parse(r.games||'[]');
      r.needsGuardCode = !!r.needsGuardCode;
      return r;
    },
    upsertSteamAccountStatus: async (id, status) => {
      await db.run('UPDATE steam_accounts SET farmStatus=?, botStatus=?, error=?, needsGuardCode=? WHERE id=?', status.farmStatus, status.botStatus, status.error||null, status.needsGuardCode?1:0, id);
    },
    setSteamGuardNeedsCode: async (id, needs) => {
      await db.run('UPDATE steam_accounts SET needsGuardCode=? WHERE id=?', needs?1:0, id);
    },
    deleteSteamAccount: async (id) => {
      await db.run('DELETE FROM steam_accounts WHERE id=?', id);
    },
    db
  };
}

module.exports = { init };
