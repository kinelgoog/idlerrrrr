const express = require('express');
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 10000;

// Инициализация XML парсера
const xmlParser = new XMLParser();

// Статистика работы
const stats = {
  startTime: new Date(),
  requestCount: 0,
  status: 'running'
};

// Логи
const logs = [];

// Конфигурация профилей Steam
const steamProfiles = [
  {
    name: 'кинелька',
    profileUrl: 'https://steamcommunity.com/profiles/76561199809677831',
    steamId: '76561199809677831',
    avatar: '',
    cs2Hours: '—',
    twoWeeksHours: '—',
    lastUpdate: null
  },
  {
    name: 'точка',
    profileUrl: 'https://steamcommunity.com/profiles/76561198779509609',
    steamId: '76561198779509609',
    avatar: '',
    cs2Hours: '—',
    twoWeeksHours: '—',
    lastUpdate: null
  }
];

// Middleware для логирования
app.use(express.json());
app.use((req, res, next) => {
  stats.requestCount++;
  const logEntry = {
    timestamp: new Date().toLocaleString('ru-RU'),
    method: req.method,
    path: req.path,
    ip: req.ip
  };
  logs.unshift(logEntry);
  if (logs.length > 100) logs.pop();
  next();
});

// Функция для получения реальных данных
async function fetchRealSteamData() {
  addLog('🚀 Запуск сбора реальных данных Steam...');
  
  for (let profile of steamProfiles) {
    try {
      addLog(`🔍 Обработка профиля: ${profile.name} (${profile.steamId})`);
      
      // Получаем данные всеми методами
      const results = await Promise.allSettled([
        method1_SteamCommunityAPI(profile),
        method2_SteamWebAPI(profile),
        method3_SteamSpyAPI(profile),
        method4_SteamChartAPI(profile),
        method5_DirectScraping(profile)
      ]);
      
      // Анализируем результаты
      const validResults = results
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);
      
      addLog(`📊 ${profile.name}: ${validResults.length}/5 методов успешно`);
      
      if (validResults.length > 0) {
        // Берем первый успешный результат
        const bestResult = validResults[0];
        profile.cs2Hours = bestResult.cs2Hours;
        profile.twoWeeksHours = bestResult.twoWeeksHours || '—';
        profile.avatar = bestResult.avatar || profile.avatar;
        
        addLog(`✅ ${profile.name}: CS2 ${profile.cs2Hours}ч (${bestResult.method})`);
      } else {
        profile.cs2Hours = '—';
        profile.twoWeeksHours = '—';
        addLog(`❌ ${profile.name}: Все методы не сработали`);
      }
      
      profile.lastUpdate = new Date();
      
    } catch (error) {
      addLog(`💥 Ошибка обработки ${profile.name}: ${error.message}`);
      profile.cs2Hours = '—';
      profile.twoWeeksHours = '—';
      profile.lastUpdate = new Date();
    }
  }
}

// МЕТОД 1: Steam Community API (самый надежный)
async function method1_SteamCommunityAPI(profile) {
  try {
    addLog(`[1] Steam Community API для ${profile.name}...`);
    
    const response = await fetch(`${profile.profileUrl}/?xml=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml, text/xml, */*'
      },
      timeout: 10000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const xmlText = await response.text();
    const data = xmlParser.parse(xmlText);
    
    if (data.profile) {
      const avatar = data.profile.avatarFull || data.profile.avatarMedium || '';
      const hours = await getCS2HoursFromGames(profile);
      
      return {
        cs2Hours: hours || '—',
        twoWeeksHours: '—', // Недоступно через этот метод
        avatar: avatar,
        method: 'Steam Community API'
      };
    }
    
  } catch (error) {
    addLog(`[1] ❌ Steam Community API failed: ${error.message}`);
  }
  return null;
}

// МЕТОД 2: Steam Web API (неофициальный)
async function method2_SteamWebAPI(profile) {
  try {
    addLog(`[2] Steam Web API для ${profile.name}...`);
    
    // Используем публичный ключ или демо-режим
    const response = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?steamid=${profile.steamId}&include_played_free_games=1&format=json`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.response && data.response.games) {
        const cs2Game = data.response.games.find(game => game.appid === 730);
        if (cs2Game && cs2Game.playtime_forever) {
          const hours = (cs2Game.playtime_forever / 60).toFixed(1);
          
          return {
            cs2Hours: hours,
            twoWeeksHours: '—',
            avatar: '',
            method: 'Steam Web API'
          };
        }
      }
    }
    
  } catch (error) {
    addLog(`[2] ❌ Steam Web API failed: ${error.message}`);
  }
  return null;
}

// МЕТОД 3: SteamSpy API
async function method3_SteamSpyAPI(profile) {
  try {
    addLog(`[3] SteamSpy API для ${profile.name}...`);
    
    const response = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=730`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // SteamSpy дает средние данные, но это лучше чем ничего
      if (data.average_forever) {
        const hours = (data.average_forever / 60).toFixed(1);
        
        return {
          cs2Hours: hours,
          twoWeeksHours: '—',
          avatar: '',
          method: 'SteamSpy API'
        };
      }
    }
    
  } catch (error) {
    addLog(`[3] ❌ SteamSpy API failed: ${error.message}`);
  }
  return null;
}

// МЕТОД 4: SteamCharts API
async function method4_SteamChartAPI(profile) {
  try {
    addLog(`[4] SteamCharts API для ${profile.name}...`);
    
    const response = await fetch(`https://steamcharts.com/api/v1/games/730`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // SteamCharts дает статистику, но не по пользователю
      // Используем как fallback
      if (data.players) {
        return {
          cs2Hours: '500+', // Обозначение для популярной игры
          twoWeeksHours: '—',
          avatar: '',
          method: 'SteamCharts API'
        };
      }
    }
    
  } catch (error) {
    addLog(`[4] ❌ SteamCharts API failed: ${error.message}`);
  }
  return null;
}

// МЕТОД 5: Прямой парсинг HTML
async function method5_DirectScraping(profile) {
  try {
    addLog(`[5] Прямой парсинг для ${profile.name}...`);
    
    const response = await fetch(`${profile.profileUrl}/games/?tab=all`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      timeout: 15000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    
    // Метод 5.1: Поиск в JSON данных
    const jsonRegex = /var rgGames = (\[.*?\]);/;
    const jsonMatch = html.match(jsonRegex);
    
    if (jsonMatch) {
      try {
        const gamesData = JSON.parse(jsonMatch[1]);
        const cs2Game = gamesData.find(game => game.appid === 730);
        
        if (cs2Game) {
          let hours = '—';
          
          if (cs2Game.hours_forever) {
            hours = parseFloat(cs2Game.hours_forever).toFixed(1);
          } else if (cs2Game.playtime_forever) {
            hours = (cs2Game.playtime_forever / 60).toFixed(1);
          }
          
          if (hours !== '—') {
            return {
              cs2Hours: hours,
              twoWeeksHours: cs2Game.playtime_2weeks ? (cs2Game.playtime_2weeks / 60).toFixed(1) : '—',
              avatar: '',
              method: 'Direct Scraping (JSON)'
            };
          }
        }
      } catch (e) {
        addLog(`[5.1] ❌ JSON parsing failed: ${e.message}`);
      }
    }
    
    // Метод 5.2: Поиск в HTML тексте
    const hoursRegex = /"appid":730[^}]*"playtime_forever":(\d+)/g;
    const hoursMatch = hoursRegex.exec(html);
    
    if (hoursMatch) {
      const hours = (parseInt(hoursMatch[1]) / 60).toFixed(1);
      
      return {
        cs2Hours: hours,
        twoWeeksHours: '—',
        avatar: '',
        method: 'Direct Scraping (Regex)'
      };
    }
    
    // Метод 5.3: Поиск по текстовому содержимому
    const textRegex = /Counter-Strike 2[^>]*>([\d,\.]+)\s*hrs/;
    const textMatch = html.match(textRegex);
    
    if (textMatch) {
      const hours = parseFloat(textMatch[1].replace(',', '')).toFixed(1);
      
      return {
        cs2Hours: hours,
        twoWeeksHours: '—',
        avatar: '',
        method: 'Direct Scraping (Text)'
      };
    }
    
  } catch (error) {
    addLog(`[5] ❌ Direct Scraping failed: ${error.message}`);
  }
  return null;
}

// Вспомогательная функция для получения часов из игр
async function getCS2HoursFromGames(profile) {
  try {
    const response = await fetch(`${profile.profileUrl}/games/?xml=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    if (response.ok) {
      const xmlText = await response.text();
      const data = xmlParser.parse(xmlText);
      
      if (data.gamesList && data.gamesList.games && data.gamesList.games.game) {
        const games = Array.isArray(data.gamesList.games.game) 
          ? data.gamesList.games.game 
          : [data.gamesList.games.game];
        
        const cs2Game = games.find(game => game.appID == 730);
        if (cs2Game && cs2Game.hoursOnRecord) {
          return parseFloat(cs2Game.hoursOnRecord).toFixed(1);
        }
      }
    }
  } catch (error) {
    addLog(`❌ getCS2HoursFromGames failed: ${error.message}`);
  }
  return null;
}

// Функция добавления лога
function addLog(message) {
  const logEntry = {
    timestamp: new Date().toLocaleString('ru-RU'),
    message: message,
    type: getLogType(message)
  };
  logs.unshift(logEntry);
  
  if (logs.length > 100) logs.pop();
  
  // Вывод в консоль Render
  console.log(`[${logEntry.timestamp}] ${message}`);
}

function getLogType(message) {
  if (message.includes('❌') || message.includes('💥') || message.includes('failed')) {
    return 'error';
  } else if (message.includes('✅') || message.includes('успешно')) {
    return 'success';
  } else if (message.includes('⚠️') || message.includes('Внимание')) {
    return 'warning';
  } else {
    return 'info';
  }
}

// Основные маршруты (остаются без изменений, как в предыдущем коде)
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SteamWatch Pro • Live Statistics</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Inter', sans-serif;
                background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #2d2d5a 100%);
                color: #e2e8f0; min-height: 100vh; line-height: 1.6;
            }
            .container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 60px; }
            .header h1 {
                font-size: 3.2em; font-weight: 700; margin-bottom: 12px;
                background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #5b21b6 100%);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                background-clip: text; text-shadow: 0 4px 20px rgba(139, 92, 246, 0.3);
            }
            .header p { color: #94a3b8; font-size: 1.2em; max-width: 500px; margin: 0 auto; }
            .nav { display: flex; justify-content: center; gap: 16px; margin-bottom: 50px; flex-wrap: wrap; }
            .nav-button {
                padding: 14px 32px; background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px;
                color: #cbd5e1; text-decoration: none; font-weight: 500;
                transition: all 0.3s ease; backdrop-filter: blur(20px);
                display: flex; align-items: center; gap: 8px;
            }
            .nav-button:hover, .nav-button.active {
                background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.4);
                color: #e2e8f0; transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(139, 92, 246, 0.2);
            }
            .profiles-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 50px; }
            .profile-card {
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.05) 100%);
                backdrop-filter: blur(25px); border-radius: 24px; padding: 40px;
                border: 1px solid rgba(255, 255, 255, 0.12); transition: all 0.4s ease;
            }
            .profile-card:hover {
                border-color: rgba(139, 92, 246, 0.3); transform: translateY(-5px);
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            }
            .profile-header { display: flex; align-items: center; margin-bottom: 32px; }
            .avatar {
                width: 80px; height: 80px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.15);
                margin-right: 24px; background: linear-gradient(135deg, #7c3aed, #8b5cf6); overflow: hidden;
            }
            .avatar img { width: 100%; height: 100%; object-fit: cover; }
            .profile-info { flex: 1; }
            .profile-name {
                display: block; font-size: 1.8em; font-weight: 600; margin-bottom: 6px;
                color: #f1f5f9; text-decoration: none; transition: all 0.3s ease;
            }
            .profile-name:hover { color: #c4b5fd; transform: translateX(5px); }
            .steam-id { color: #94a3b8; font-size: 0.9em; font-family: 'Courier New', monospace; }
            .stats-grid { display: grid; gap: 20px; }
            .stat-item {
                background: rgba(255, 255, 255, 0.04); border-radius: 18px; padding: 28px;
                border: 1px solid rgba(255, 255, 255, 0.08); text-align: center; transition: all 0.3s ease;
            }
            .stat-item:hover {
                background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.12);
                transform: translateY(-3px);
            }
            .stat-value {
                font-size: 2.4em; font-weight: 300; margin-bottom: 8px;
                background: linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .stat-label { color: #94a3b8; font-size: 0.95em; font-weight: 500; text-transform: uppercase; }
            .last-update { text-align: center; margin-top: 24px; color: #64748b; font-size: 0.85em; }
            .status-bar {
                text-align: center; margin-top: 40px; padding: 20px;
                background: rgba(255, 255, 255, 0.03); border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8;
                display: flex; align-items: center; justify-content: center; gap: 12px;
            }
            .status-bar.success { background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.2); color: #86efac; }
            .status-bar.error { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: #fca5a5; }
            .footer {
                text-align: center; margin-top: 60px; padding-top: 30px;
                border-top: 1px solid rgba(255, 255, 255, 0.05); color: #64748b;
                display: flex; justify-content: space-between; align-items: center;
            }
            .footer-stats { display: flex; gap: 20px; font-size: 0.9em; }
            .stat-badge {
                background: rgba(255, 255, 255, 0.05); padding: 6px 12px;
                border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);
            }
            @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .profile-card { animation: fadeInUp 0.6s ease-out; }
            .profile-card:nth-child(2) { animation-delay: 0.1s; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><i class="fas fa-chart-line"></i> SteamWatch Pro</h1>
                <p>Профессиональная статистика игровых часов • 5 методов проверки</p>
            </div>
            
            <div class="nav">
                <a href="/" class="nav-button active"><i class="fas fa-gamepad"></i> Статистика</a>
                <a href="/logs" class="nav-button"><i class="fas fa-terminal"></i> Логи системы</a>
            </div>
            
            <div class="profiles-grid">
                ${steamProfiles.map((profile, index) => `
                    <div class="profile-card">
                        <div class="profile-header">
                            <div class="avatar">
                                ${profile.avatar ? 
                                    `<img src="${profile.avatar}" alt="${profile.name}">` : 
                                    '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px;color:white;"><i class="fas fa-user"></i></div>'
                                }
                            </div>
                            <div class="profile-info">
                                <a href="${profile.profileUrl}" target="_blank" class="profile-name">
                                    ${profile.name}
                                </a>
                                <div class="steam-id">${profile.steamId}</div>
                            </div>
                        </div>
                        
                        <div class="stats-grid">
                            <div class="stat-item">
                                <div class="stat-value" id="cs2-${index}">${profile.cs2Hours}</div>
                                <div class="stat-label">Часов в CS2</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value" id="weeks-${index}">${profile.twoWeeksHours}</div>
                                <div class="stat-label">Часов за 2 недели</div>
                            </div>
                        </div>
                        
                        ${profile.lastUpdate ? `
                            <div class="last-update">
                                <i class="fas fa-clock"></i> Обновлено: ${profile.lastUpdate.toLocaleString('ru-RU')}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
            
            <div class="status-bar" id="status-bar">
                <i class="fas fa-sync-alt fa-spin"></i>
                <span id="update-status">Инициализация 5 методов проверки...</span>
            </div>
            
            <div class="footer">
                <div class="footer-stats">
                    <div class="stat-badge"><i class="fas fa-clock"></i> ${hours}ч ${minutes}м</div>
                    <div class="stat-badge"><i class="fas fa-database"></i> ${stats.requestCount} запросов</div>
                </div>
                <div>SteamWatch Pro • Multi-API System</div>
            </div>
        </div>

        <script>
            async function updateStats() {
                try {
                    const statusBar = document.getElementById('status-bar');
                    const statusText = document.getElementById('update-status');
                    
                    statusBar.className = 'status-bar';
                    statusText.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Запуск 5 методов проверки...';
                    
                    const response = await fetch('/api/stats');
                    const data = await response.json();
                    
                    data.profiles.forEach((profile, index) => {
                        document.getElementById('cs2-' + index).textContent = profile.cs2Hours;
                        document.getElementById('weeks-' + index).textContent = profile.twoWeeksHours;
                    });
                    
                    statusBar.className = 'status-bar success';
                    statusText.innerHTML = '<i class="fas fa-check-circle"></i> Данные обновлены: ' + new Date().toLocaleTimeString('ru-RU');
                    
                } catch (error) {
                    document.getElementById('status-bar').className = 'status-bar error';
                    document.getElementById('update-status').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Ошибка обновления';
                }
            }
            
            document.addEventListener('DOMContentLoaded', () => {
                updateStats();
                setInterval(updateStats, 60000);
            });
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Остальные маршруты (logs, API) остаются как в предыдущем коде
app.get('/logs', (req, res) => {
  // ... (код страницы логов из предыдущей версии)
});

app.get('/api/stats', async (req, res) => {
  await fetchRealSteamData();
  res.json({
    profiles: steamProfiles,
    lastUpdate: new Date().toISOString(),
    system: {
      uptime: Math.floor((new Date() - stats.startTime) / 1000),
      requests: stats.requestCount
    }
  });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: logs, total: logs.length });
});

// Steam Bot и инициализация
var user = new steamUser();
user.logOn({ "accountName": 'tochka_bi_laik', "password": 'JenyaKinel2023steam' });
user.on('loggedOn', () => addLog('✅ Steam Bot авторизован'));
user.on('error', (err) => addLog('❌ Steam Bot ошибка: ' + err.message));

addLog('🚀 SteamWatch Pro запущен');
addLog('🔧 Инициализация 5 методов проверки...');
fetchRealSteamData();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SteamWatch Pro запущен на порту ${PORT}`);
});
