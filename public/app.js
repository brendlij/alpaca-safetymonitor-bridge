const $ = (sel) => document.querySelector(sel);
const logBox = $("#logBox");
const LOG_LIMIT = 200; // max. Anzahl Zeilen im Log

function log(msg) {
  const ts = new Date().toISOString().substr(11, 8); // hh:mm:ss
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = `[${ts}] ${msg}`;
  logBox.appendChild(line);

  // Limit: alte Zeilen löschen
  while (logBox.children.length > LOG_LIMIT) {
    logBox.removeChild(logBox.firstChild);
  }

  // Auto-scroll immer ans Ende
  logBox.scrollTop = logBox.scrollHeight;
}

const pill = (el, text, cls) => { el.textContent = text; el.className = `pill ${cls}`; };

const stateEls = {
  version: $("#stVersion"),
  online: $("#stOnline"),
  uptime: $("#stUptime"),
  client: $("#stAlpacaClient"),
  isSafe: $("#stIsSafe"),
  health: $("#stHealth"),
  reason: $("#stReason"),
  topicBase: $("#stTopicBase"),
};

const cfgEls = {
  form: $("#cfgForm"),
  deviceName: $("#deviceName"),
  mqttUrl: $("#mqttUrl"),
  topicBase: $("#topicBase"),
  mqttUser: $("#mqttUser"),          
  mqttPass: $("#mqttPass"),          
  enableMqtt: $("#enableMqtt"),
  enableRestControl: $("#enableRestControl"),
  saveBtn: $("#saveBtn"),
  saveMsg: $("#saveMsg"),
};

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

async function loadStatus() {
  try {
    const st = await fetchJSON("/status");
    stateEls.version.textContent = st.version;
    pill(stateEls.online, st.online ? "online" : "offline", st.online ? "pill-yes" : "pill-no");
    stateEls.uptime.textContent = `${st.uptime_s}s`;
    pill(stateEls.client, st.alpaca_client_connected ? "connected" : "idle", st.alpaca_client_connected ? "pill-yes" : "pill-grey");
    pill(stateEls.isSafe, st.isSafe ? "SAFE" : "UNSAFE", st.isSafe ? "pill-safe" : "pill-unsafe");
    const healthCls = st.health === "ok" ? "pill-safe" : st.health === "degraded" ? "pill-yes" : "pill-unsafe";
    pill(stateEls.health, st.health, healthCls);
    stateEls.reason.textContent = st.reason || "—";
    stateEls.topicBase.textContent = st.topic_base || "—";
  } catch (e) {
    log("Status error: " + e.message);
  }
}

async function loadConfig() {
  try {
    const { config } = await fetchJSON("/config");
    cfgEls.deviceName.value = config.deviceName ?? "";
    cfgEls.mqttUrl.value = config.mqttUrl ?? "";
    cfgEls.topicBase.value = config.topicBase ?? "";
    cfgEls.mqttUser.value   = config.mqttUser ?? "";  
    cfgEls.mqttPass.value   = config.mqttPass ?? "";  
    cfgEls.enableMqtt.checked = !!config.enableMqtt;
    cfgEls.enableRestControl.checked = !!config.enableRestControl;
  } catch (e) {
    log("Config error: " + e.message);
  }
}

async function saveConfig(ev) {
  ev.preventDefault();
  cfgEls.saveBtn.disabled = true; cfgEls.saveMsg.textContent = "Saving…";
  try {
    const body = {
      deviceName: cfgEls.deviceName.value.trim(),
      mqttUrl: cfgEls.mqttUrl.value.trim(),
      topicBase: cfgEls.topicBase.value.trim(),
      mqttUser: cfgEls.mqttUser.value,          
      mqttPass: cfgEls.mqttPass.value,          
      enableMqtt: !!cfgEls.enableMqtt.checked,
      enableRestControl: !!cfgEls.enableRestControl.checked
    };
    const res = await fetchJSON("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    cfgEls.saveMsg.textContent = res.note ? `Saved ✔ (${res.note})` : "Saved ✔";
    const clone = { ...res.config, mqttPass: res.config.mqttPass ? "••••••" : "" };
    log("Saved config: " + JSON.stringify(clone));
    await loadStatus(); 
  } catch (e) {
    cfgEls.saveMsg.textContent = "Error ❌";
    log("Save error: " + e.message);
  } finally {
    cfgEls.saveBtn.disabled = false;
    setTimeout(()=> cfgEls.saveMsg.textContent = "", 2000);
  }
}

async function postControl(path, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`/control/${path}?${query}`, { method: "POST" });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

function wire() {
  $("#refreshBtn").addEventListener("click", () => { loadStatus(); log("Manual refresh"); });
  $("#btnMarkSafe").addEventListener("click", async () => {
    try { await postControl("safe", { value:"safe" }); await loadStatus(); log("Marked SAFE"); } catch(e){ log(e.message); }
  });
  $("#btnMarkUnsafe").addEventListener("click", async () => {
    try { await postControl("safe", { value:"unsafe" }); await loadStatus(); log("Marked UNSAFE"); } catch(e){ log(e.message); }
  });
  $("#btnHealth").addEventListener("click", async () => {
    try {
      const v = $("#healthSelect").value;
      const res = await fetch(`/control/health?value=${encodeURIComponent(v)}`, { method:"POST" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await loadStatus(); log("Health set: " + v);
    } catch(e){ log(e.message); }
  });
  cfgEls.form.addEventListener("submit", saveConfig);
  $("#year").textContent = new Date().getFullYear();
}

(async function init(){
  wire();
  await loadStatus();
  await loadConfig();
  setInterval(loadStatus, 5000);
})();
