async function showLogin(){ document.getElementById('login-form').style.display='block'; document.getElementById('register-form').style.display='none'; }
async function showRegister(){ document.getElementById('login-form').style.display='none'; document.getElementById('register-form').style.display='block'; }

async function login(){
  const user = document.getElementById('l_user').value;
  const pass = document.getElementById('l_pass').value;
  if(!user||!pass){ alert('fill'); return; }
  const res = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
  const j = await res.json();
  if(j.success) location.href='/dashboard.html'; else alert('Ошибка: '+(j.error||'unknown'));
}

async function register(){
  const user = document.getElementById('r_user').value;
  const pass = document.getElementById('r_pass').value;
  if(!user||!pass){ alert('fill'); return; }
  const res = await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
  const j = await res.json();
  if(j.success) location.href='/dashboard.html'; else alert('Ошибка: '+(j.error||'unknown'));
}
