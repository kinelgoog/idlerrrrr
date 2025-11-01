require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false
}));

// 🟣 Главная
app.get('/', (req, res) => {
  if (!req.session.userId) return res.send('Привет! <a href="/register">Регистрация</a> или <a href="/login">Вход</a>');
  res.send(`Привет, пользователь! <a href="/dashboard">Перейти в панель</a>`);
});

// 🔑 Регистрация
app.get('/register', (req, res) => {
  res.send(`<form method="POST">
    <input name="username" placeholder="Логин" required/>
    <input name="password" type="password" placeholder="Пароль" required/>
    <button>Регистрация</button>
  </form>`);
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  db.run(`INSERT INTO users (id, username, password) VALUES (?, ?, ?)`, [id, username, hash], function(err){
    if (err) return res.send('Ошибка: ' + err.message);
    req.session.userId = id;
    res.redirect('/dashboard');
  });
});

// 🔑 Вход
app.get('/login', (req, res) => {
  res.send(`<form method="POST">
    <input name="username" placeholder="Логин" required/>
    <input name="password" type="password" placeholder="Пароль" required/>
    <button>Вход</button>
  </form>`);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.send('Неверный логин/пароль');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Неверный логин/пароль');
    req.session.userId = user.id;
    res.redirect('/dashboard');
  });
});

// 🔮 Панель пользователя
app.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  db.all(`SELECT * FROM steam_accounts WHERE user_id = ?`, [req.session.userId], (err, accounts) => {
    if (err) return res.send('Ошибка загрузки аккаунтов');
    res.send(`
      <h1>Ваши Steam аккаунты</h1>
      <a href="/logout">Выйти</a>
      <ul>
        ${accounts.map(a => `<li>${a.display_name || a.username} - Статус: ${a.bot_status}</li>`).join('')}
      </ul>
      <form method="POST" action="/add-account">
        <input name="username" placeholder="Steam логин" required/>
        <input name="password" placeholder="Пароль" required/>
        <input name="display_name" placeholder="Имя для панели"/>
        <button>Добавить аккаунт</button>
      </form>
    `);
  });
});

// ➕ Добавление Steam аккаунта
app.post('/add-account', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { username, password, display_name } = req.body;
  const id = uuidv4();
  db.run(`INSERT INTO steam_accounts (id, user_id, username, password, display_name) VALUES (?, ?, ?, ?, ?)`,
    [id, req.session.userId, username, password, display_name || username],
    (err) => {
      if (err) return res.send('Ошибка добавления аккаунта: ' + err.message);
      res.redirect('/dashboard');
    });
});

// Выход
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// 🚀 Запуск
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});
