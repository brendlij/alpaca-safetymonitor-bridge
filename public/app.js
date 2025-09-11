const $ = (q) => document.querySelector(q);
const logEl = $('#log');
const onlineEl = $('#online');

function log(line){
  const ts = new Date().toISOString();
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function fetchStatus(){
  try{
    const res = await fetch('/status', { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    updateStatus(s);
  }catch(e){
    onlineEl.textContent = 'offline';
    onlineEl.classList.remove('online');
    onlineEl.classList.add('offline');
  }
}

function updateStatus(s){
  onlineEl.textContent = s.online ? 'online' : 'offline';
  onlineEl.classList.toggle('online', !!s.online);
  onlineEl.classList.toggle('offline', !s.online);
  $('#version').textContent = s.version ?? '-';
  $('#uptime').textContent = (s.uptime_s ?? 0) + 's';
  $('#isSafe').textContent = s.isSafe ? 'SAFE' : 'UNSAFE';
  $('#health').textContent = s.health ?? '-';
  $('#reason').textContent = s.reason ?? '-';
  $('#lastChange').textContent = s.last_change ?? '-';
  $('#device').textContent = s.device ?? '-';
  $('#topic').textContent = s.topic_base ?? '-';
  $('#client').textContent = `${s.alpaca_client_connected ? 'connected' : 'disconnected'}${s.alpaca_client_lastseen ? ' @ '+s.alpaca_client_lastseen : ''}`;
}

async function postJSON(url, body){
  const params = new URLSearchParams();
  Object.entries(body || {}).forEach(([k,v]) => {
    if(v !== undefined && v !== null) params.append(k, v);
  });
  const full = params.toString() ? `${url}?${params.toString()}` : url;
  const res = await fetch(full, { method: 'POST' });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

$('#btnSafe').addEventListener('click', async () => {
  try{
    const r = await postJSON('/control/safe', { value: 'safe' });
    log('Set SAFE via HTTP');
    fetchStatus();
  }catch(e){ log('Set SAFE failed: '+e.message); }
});

$('#btnUnsafe').addEventListener('click', async () => {
  try{
    const r = await postJSON('/control/safe', { value: 'unsafe' });
    log('Set UNSAFE via HTTP');
    fetchStatus();
  }catch(e){ log('Set UNSAFE failed: '+e.message); }
});

$('#btnHealth').addEventListener('click', async () => {
  try{
    const v = $('#healthSel').value;
    const r = await postJSON('/control/health', { value: v });
    log('Set health='+v+' via HTTP');
    fetchStatus();
  }catch(e){ log('Set health failed: '+e.message); }
});

// poll
fetchStatus();
setInterval(fetchStatus, 2000);


