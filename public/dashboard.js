async function fetchAccounts(){
  const res = await fetch('/api/status');
  if(res.status===401){ location.href='/'; return; }
  const j = await res.json();
  const root = document.getElementById('accounts'); root.innerHTML='';
  (j.accounts||[]).forEach(acc=>{
    const div = document.createElement('div'); div.className='card'; div.style.marginBottom='8px';
    const statusClass = acc.botStatus==='online'?'online':acc.botStatus==='steam_guard'?'guard':acc.botStatus==='error'?'error':'offline';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div><strong>${acc.display_name||acc.steam_login}</strong><div style="color:rgba(255,255,255,0.5)">${acc.steam_login}</div></div>
      <div><span class="status ${statusClass}">${(acc.botStatus||'offline').toUpperCase()}</span></div>
    </div>
    <div style="margin-top:8px">Игры: ${acc.games&&acc.games.length?acc.games.join(','):'—'}</div>
    ${acc.error?`<div style="color:#f04747">Ошибка: ${acc.error}</div>`:''}
    <div style="margin-top:8px">
      <button class="btn ${acc.farmStatus==='running'?'stop':'start'}" onclick="${acc.farmStatus==='running'?`stopFarm('${acc.id}')`:`startFarm('${acc.id}')`}">${acc.farmStatus==='running'?'⏹️ СТОП':'▶️ СТАРТ'}</button>
      <button class="btn" style="margin-left:8px" onclick="deleteAccount('${acc.id}')">Удалить</button>
    </div>
    ${acc.needsGuardCode?`<div style="margin-top:8px"><input id="code-${acc.id}" placeholder="Steam Guard код"><button class="btn" onclick="submitCode('${acc.id}')">Отправить код</button></div>`:''}
    `;
    root.appendChild(div);
  });
}

async function addAccount(){
  const payload = {
    steam_login: document.getElementById('sa_login').value,
    steam_password: document.getElementById('sa_pass').value,
    display_name: document.getElementById('sa_display').value,
    games: document.getElementById('sa_games').value ? JSON.stringify(document.getElementById('sa_games').value.split(',').map(s=>s.trim())) : JSON.stringify([]),
    shared_secret: document.getElementById('sa_shared').value || null
  };
  const res = await fetch('/api/user/steam-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j = await res.json();
  if(j.success){ fetchAccounts(); } else alert('Ошибка: '+(j.error||'unknown'));
}

async function startFarm(id){ await fetch('/api/farm/start/'+id,{method:'POST'}); fetchAccounts(); }
async function stopFarm(id){ await fetch('/api/farm/stop/'+id,{method:'POST'}); fetchAccounts(); }
async function deleteAccount(id){ if(!confirm('Удалить?')) return; await fetch('/api/user/steam-accounts/'+id,{method:'DELETE'}); fetchAccounts(); }
async function submitCode(id){ const code = document.getElementById('code-'+id).value; await fetch('/api/steam-guard/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})}); fetchAccounts(); }

async function logout(){ await fetch('/api/auth/logout',{method:'POST'}); location.href='/'; }

fetchAccounts(); setInterval(fetchAccounts,5000);
