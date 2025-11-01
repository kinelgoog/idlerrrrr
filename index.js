require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const SteamFarmBot = require('./bot');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'secret', resave: false, saveUninitialized: false }));

// Публичные файлы
app.use(express.static(path.join(__dirname, '../public')));

// 🟣 UI страницы, регистрация, вход, dashboard
// Здесь можно использовать HTML + JS + стиль фиолетового космоса из public/style.css
// Для каждого пользователя загружаются его Steam аккаунты
// Для каждого аккаунта можно запускать/останавливать бот, вводить Steam Guard

// Пример простого маршрута
app.get('/', (req, res) => {
  if (!req.session.userId) return res.sendFile(path.join(__dirname, '../public/login.html'));
  res.redirect('/dashboard');
});

// Тут добавляются маршруты регистрации, входа, выхода, dashboard и API для управления ботами
// ...
// Для краткости оставлю детали фронтенда для public/style.css и public/script.js

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

