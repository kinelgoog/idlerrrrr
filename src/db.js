// src/db.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const logger = require('./utils/logger');

async function init(dbPath) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // Создаём таблицы, если их нет
  await db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT,
      password TEXT,
      displayName TEXT,
      games TEXT,
      shared_secret TEXT,
      identity_secret TEXT,
      farmStatus TEXT,
      botStatus TEXT,
      error TEXT,
      needsGuardCode INTEGER DEFAULT 0
    );
  `);

  // если есть ACCOUNTS_JSON в env — загрузим в таблицу (без перезаписи если уже существует)
  if (process.env.ACCOUNTS_JSON) {
    try {
      const arr = JSON.parse(process.env.ACCOUNTS_JSON);
      for (const a of arr) {
        const exists = await db.get('SELECT id FROM accounts WHERE id = ?', a.id);
        if (!exists) {
          await db.run(
            `INSERT INTO accounts(id, username, password, displayName, games, shared_secret, identity_secret, farmStatus, botStatus)
             VALUES(?,?,?,?,?,?,?,?,?)`,
             a.id, a.username, a.password, a.displayName || a.username, JSON.stringify(a.games || []), a.shared_secret || null, a.identity_secret || null, 'stopped', 'offline'
          );
        }
      }
    } catch (e) {
      logger.warn('Invalid ACCOUNTS_JSON env — skipping initial import.');
    }
  }

  return {
    getAccounts: async () => {
      const rows = await db.all('SELECT * FROM accounts');
      return rows.map(r => ({
        ...r,
        games: JSON.parse(r.games || '[]'),
        needsGuardCode: !!r.needsGuardCode
      }));
    },
    getAccount: async (id) => {
      const r = await db.get('SELECT * FROM accounts WHERE id = ?', id);
      if (!r) return null;
      r.games = JSON.parse(r.games || '[]');
      r.needsGuardCode = !!r.needsGuardCode;
      return r;
    },
    upsertAccountStatus: async (id, status) => {
      const stmt = `
        UPDATE accounts SET farmStatus=?, botStatus=?, error=?, needsGuardCode=?
        WHERE id = ?
      `;
      await db.run(stmt, status.farmStatus, status.botStatus, status.error || null, status.needsGuardCode ? 1 : 0, id);
    },
    setSteamGuardNeedsCode: async (id, needs) => {
      await db.run('UPDATE accounts SET needsGuardCode=? WHERE id=?', needs ? 1 : 0, id);
    },
    createOrUpdateAccount: async (account) => {
      // Not implemented in full; implement as needed
    },
    db // raw handle if нужно
  };
}

module.exports = { init };
