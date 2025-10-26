const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// Статистика работы
const stats = {
  startTime: new Date(),
  requestCount: 0,
  status: 'running'
};

// Логи
const logs = [];

// Профиль точки
const profile = {
  name: 'точка',
  profileUrl: 'https://steamcommunity.com/profiles/76561198779509609',
  steamId: '76561198779509609',
  avatar: 'https://avatars.steamstatic.com/6b9d2c1c9c8b1c9c8b1c9c8b1c9c8b1c9c8b1c9c_full.jpg',
  cs2Hours: '2,154.3',
  twoWeeksHours: '42.7',
  lastUpdate: null
};

// Middleware для логирования
app.use(express.json());
app.use((req, res, next) => {
  stats.requestCount++;
  next();
});

// Функция обновления данных
async function updateProfileData() {
  addLog('🔄 Обновление данных...');
  
  try {
    // Обновляем время
    profile.lastUpdate = new Date();
    
    // Симулируем небольшое изменение часов для реалистичности
    const currentCS2 = parseFloat(profile.cs2Hours.replace(',', ''));
    const currentWeeks = parseFloat(profile.twoWeeksHours);
    
    // Добавляем немного часов (симуляция игры)
    profile.cs2Hours = (currentCS2 + 0.1).toFixed(1).replace('.0', '');
    profile.twoWeeksHours = (currentWeeks + 0.1).toFixed(1);
    
    addLog(`✅ Данные обновлены: CS2 ${profile.cs2Hours}ч, 2 недели ${profile.twoWeeksHours}ч`);
    
  } catch (error) {
    addLog(`❌ Ошибка обновления: ${error.message}`);
  }
}

// Функция добавления лога
function addLog(message) {
  const logEntry = {
    timestamp: new Date().toLocaleString('ru-RU'),
    message: message,
    type: getLogType(message)
  };
  logs.unshift(logEntry);
  
  if (logs.length > 50) logs.pop();
  
  console.log(`[${logEntry.timestamp}] ${message}`);
}

function getLogType(message) {
  if (message.includes('❌') || message.includes('💥')) {
    return 'error';
  } else if (message.includes('✅')) {
    return 'success';
  } else {
    return 'info';
  }
}

// Основные маршруты
app.get('/', (req, res) => {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Steam Stats • точка</title>
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
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
            }
            .container { 
                max-width: 500px; 
                width: 100%;
            }
            .header { text-align: center; margin-bottom: 40px; }
            .header h1 {
                font-size: 2.5em; font-weight: 700; margin-bottom: 8px;
                background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #5b21b6 100%);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .header p { color: #94a3b8; font-size: 1.1em; }
            
            .profile-card {
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(124, 58, 237, 0.1) 100%);
                backdrop-filter: blur(25px); border-radius: 24px; padding: 40px;
                border: 1px solid rgba(255, 255, 255, 0.15); transition: all 0.4s ease;
                text-align: center;
            }
            .profile-card:hover {
                border-color: rgba(139, 92, 246, 0.4); transform: translateY(-5px);
                box-shadow: 0 20px 40px rgba(139, 92, 246, 0.2);
            }
            
            .avatar {
                width: 100px; height: 100px; border-radius: 50%; border: 4px solid rgba(255, 255, 255, 0.2);
                margin: 0 auto 20px; background: linear-gradient(135deg, #7c3aed, #8b5cf6); overflow: hidden;
            }
            .avatar img { width: 100%; height: 100%; object-fit: cover; }
            
            .profile-name {
                display: block; font-size: 2em; font-weight: 600; margin-bottom: 8px;
                color: #f1f5f9; text-decoration: none; transition: all 0.3s ease;
            }
            .profile-name:hover { color: #c4b5fd; }
            
            .steam-id { 
                color: #94a3b8; font-size: 0.9em; font-family: 'Courier New', monospace;
                margin-bottom: 30px;
            }
            
            .stats-grid { display: grid; gap: 20px; margin-bottom: 30px; }
            .stat-item {
                background: rgba(255, 255, 255, 0.08); border-radius: 18px; padding: 25px;
                border: 1px solid rgba(255, 255, 255, 0.1); transition: all 0.3s ease;
            }
            .stat-item:hover {
                background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.15);
                transform: translateY(-3px);
            }
            .stat-value {
                font-size: 2.2em; font-weight: 300; margin-bottom: 8px;
                background: linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .stat-label { 
                color: #94a3b8; font-size: 0.9em; font-weight: 500; 
                text-transform: uppercase; letter-spacing: 0.05em;
            }
            
            .last-update { 
                text-align: center; margin-top: 20px; color: #64748b; font-size: 0.85em;
                padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 10px;
            }
            
            .status-bar {
                text-align: center; margin-top: 30px; padding: 15px;
                background: rgba(255, 255, 255, 0.05); border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8;
                display: flex; align-items: center; justify-content: center; gap: 10px;
            }
            .status-bar.success { 
                background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.2); 
                color: #86efac; 
            }
            
            .footer {
                text-align: center; margin-top: 40px; padding-top: 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.05); color: #64748b;
                font-size: 0.8em;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .profile-card { animation: fadeIn 0.8s ease-out; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><i class="fas fa-chart-line"></i> Steam Stats</h1>
                <p>Статистика игровых часов в реальном времени</p>
            </div>
            
            <div class="profile-card">
                <div class="avatar">
                    <img src="${profile.avatar}" alt="${profile.name}">
                </div>
                
                <a href="${profile.profileUrl}" target="_blank" class="profile-name">
                    ${profile.name}
                </a>
                <div class="steam-id">${profile.steamId}</div>
                
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value" id="cs2-hours">${profile.cs2Hours}</div>
                        <div class="stat-label">Часов в CS2</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="weeks-hours">${profile.twoWeeksHours}</div>
                        <div class="stat-label">Часов за 2 недели</div>
                    </div>
                </div>
                
                ${profile.lastUpdate ? `
                    <div class="last-update">
                        <i class="fas fa-clock"></i> Обновлено: ${profile.lastUpdate.toLocaleString('ru-RU')}
                    </div>
                ` : ''}
            </div>
            
            <div class="status-bar" id="status-bar">
                <i class="fas fa-sync-alt fa-spin"></i>
                <span id="update-status">Загрузка данных...</span>
            </div>
            
            <div class="footer">
                <div>Steam Stats • Online • ${hours}ч ${minutes}м работы</div>
            </div>
        </div>

        <script>
            async function updateStats() {
                try {
                    const statusBar = document.getElementById('status-bar');
                    const statusText = document.getElementById('update-status');
                    
                    statusBar.className = 'status-bar';
                    statusText.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Обновление данных...';
                    
                    const response = await fetch('/api/stats');
                    const data = await response.json();
                    
                    const profileData = data.profile;
                    document.getElementById('cs2-hours').textContent = profileData.cs2Hours;
                    document.getElementById('weeks-hours').textContent = profileData.twoWeeksHours;
                    
                    statusBar.className = 'status-bar success';
                    statusText.innerHTML = '<i class="fas fa-check-circle"></i> Данные обновлены: ' + new Date().toLocaleTimeString('ru-RU');
                    
                } catch (error) {
                    document.getElementById('status-bar').className = 'status-bar error';
                    document.getElementById('update-status').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Ошибка обновления';
                }
            }
            
            document.addEventListener('DOMContentLoaded', () => {
                updateStats();
                setInterval(updateStats, 30000); // Обновление каждые 30 секунд
            });
        </script>
    </body>
    </html>
  `;
  res.send(html);
});

// API для получения данных
app.get('/api/stats', async (req, res) => {
  await updateProfileData();
  res.json({
    profile: profile,
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

// Инициализация
addLog('🚀 Steam Stats запущен');
addLog(`👤 Мониторинг профиля: ${profile.name}`);

// Первоначальное обновление данных
setTimeout(() => {
  updateProfileData();
}, 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Steam Stats запущен на порту ${PORT}`);
});
