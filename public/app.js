const $ = (sel) => document.querySelector(sel);
const logBox = $("#logBox");
const LOG_LIMIT = 500; // max. Anzahl Zeilen im Log

// Simple client-side logging for UI events
function log(msg, level = "info") {
  const ts = new Date().toISOString().substr(11, 12); // hh:mm:ss.sss
  const line = document.createElement("div");
  line.className = `log-line log-${level}`;

  const timestamp = document.createElement("span");
  timestamp.className = "log-timestamp";
  timestamp.textContent = `[${ts}] `;

  const levelSpan = document.createElement("span");
  levelSpan.className = "log-level";
  levelSpan.textContent = `[${level.toUpperCase()}] `;

  const message = document.createElement("span");
  message.textContent = msg;

  line.appendChild(timestamp);
  line.appendChild(levelSpan);
  line.appendChild(message);

  logBox.appendChild(line);

  // Limit: alte Zeilen löschen
  while (logBox.children.length > LOG_LIMIT) {
    logBox.removeChild(logBox.firstChild);
  }

  // Auto-scroll immer ans Ende
  logBox.scrollTop = logBox.scrollHeight;
  updateLogCount();
}

// Display server logs from API
function displayServerLog(logEntry) {
  const line = document.createElement("div");
  line.className = `log-line log-${logEntry.level.toLowerCase()}`;

  const timestamp = new Date(logEntry.timestamp);
  const ts = timestamp.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const timestampSpan = document.createElement("span");
  timestampSpan.className = "log-timestamp";
  timestampSpan.textContent = `[${ts}] `;

  const levelSpan = document.createElement("span");
  levelSpan.className = "log-level";
  levelSpan.textContent = `[${logEntry.level}] `;

  const message = document.createElement("span");
  let msgText = logEntry.message;
  if (logEntry.data) {
    msgText += ` ${JSON.stringify(logEntry.data)}`;
  }
  message.textContent = msgText;

  line.appendChild(timestampSpan);
  line.appendChild(levelSpan);
  line.appendChild(message);

  logBox.appendChild(line);

  // Limit check
  while (logBox.children.length > LOG_LIMIT) {
    logBox.removeChild(logBox.firstChild);
  }

  logBox.scrollTop = logBox.scrollHeight;
  updateLogCount();
}

function updateLogCount() {
  const count = logBox.children.length;
  const countEl = $("#logCount");
  if (countEl) countEl.textContent = count;
}

function clearLogs() {
  logBox.innerHTML = "";
  updateLogCount();
}

async function loadLogs() {
  try {
    const source = $("#logSourceSelect").value;
    const limit = 200;

    log(`Loading logs from ${source}...`, "info");

    const response = await fetch(`/api/logs?source=${source}&limit=${limit}`);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Failed to load logs");
    }

    // Clear existing logs first
    clearLogs();

    // Display logs in chronological order
    data.logs.forEach((logEntry) => {
      displayServerLog(logEntry);
    });

    log(`Loaded ${data.logs.length} log entries from ${source}`, "info");
  } catch (error) {
    log(`Error loading logs: ${error.message}`, "error");
  }
}

const pill = (el, text, cls) => {
  el.textContent = text;
  el.className = `pill ${cls}`;
};

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
  if (!res.ok || data.ok === false)
    throw new Error(data.error || res.statusText);
  return data;
}

async function loadStatus() {
  try {
    const st = await fetchJSON("/status");
    stateEls.version.textContent = st.version;
    pill(
      stateEls.online,
      st.online ? "online" : "offline",
      st.online ? "pill-yes" : "pill-no"
    );
    stateEls.uptime.textContent = `${st.uptime_s}s`;
    pill(
      stateEls.client,
      st.alpaca_client_connected ? "connected" : "idle",
      st.alpaca_client_connected ? "pill-yes" : "pill-grey"
    );
    pill(
      stateEls.isSafe,
      st.isSafe ? "SAFE" : "UNSAFE",
      st.isSafe ? "pill-safe" : "pill-unsafe"
    );
    const healthCls =
      st.health === "ok"
        ? "pill-safe"
        : st.health === "degraded"
        ? "pill-yes"
        : "pill-unsafe";
    pill(stateEls.health, st.health, healthCls);
    stateEls.reason.textContent = st.reason || "—";
    stateEls.topicBase.textContent = st.topic_base || "—";
  } catch (e) {
    log("Failed to load status: " + e.message, "error");
  }
}

async function loadConfig() {
  try {
    const { config } = await fetchJSON("/config");
    cfgEls.deviceName.value = config.deviceName ?? "";
    cfgEls.mqttUrl.value = config.mqttUrl ?? "";
    cfgEls.topicBase.value = config.topicBase ?? "";
    cfgEls.mqttUser.value = config.mqttUser ?? "";
    cfgEls.mqttPass.value = config.mqttPass ?? "";
    cfgEls.enableMqtt.checked = !!config.enableMqtt;
    cfgEls.enableRestControl.checked = !!config.enableRestControl;
  } catch (e) {
    log("Failed to load config: " + e.message, "error");
  }
}

async function saveConfig(ev) {
  ev.preventDefault();
  cfgEls.saveBtn.disabled = true;
  cfgEls.saveMsg.textContent = "Saving…";
  try {
    const body = {
      deviceName: cfgEls.deviceName.value.trim(),
      mqttUrl: cfgEls.mqttUrl.value.trim(),
      topicBase: cfgEls.topicBase.value.trim(),
      mqttUser: cfgEls.mqttUser.value,
      mqttPass: cfgEls.mqttPass.value,
      enableMqtt: !!cfgEls.enableMqtt.checked,
      enableRestControl: !!cfgEls.enableRestControl.checked,
    };
    const res = await fetchJSON("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    cfgEls.saveMsg.textContent = res.note ? `Saved ✔ (${res.note})` : "Saved ✔";
    const clone = {
      ...res.config,
      mqttPass: res.config.mqttPass ? "••••••" : "",
    };
    log(
      "Configuration saved successfully" + (res.note ? ` (${res.note})` : ""),
      "info"
    );
    await loadStatus();
  } catch (e) {
    cfgEls.saveMsg.textContent = "Error ❌";
    log("Failed to save configuration: " + e.message, "error");
  } finally {
    cfgEls.saveBtn.disabled = false;
    setTimeout(() => (cfgEls.saveMsg.textContent = ""), 2000);
  }
}

async function postControl(path, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`/control/${path}?${query}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false)
    throw new Error(data.error || res.statusText);
  return data;
}

function wire() {
  $("#refreshBtn").addEventListener("click", () => {
    loadStatus();
    log("Manual refresh");
  });
  $("#btnMarkSafe").addEventListener("click", async () => {
    try {
      await postControl("safe", { value: "safe" });
      await loadStatus();
      log("Safety state set to SAFE", "info");
    } catch (e) {
      log("Failed to set SAFE: " + e.message, "error");
    }
  });
  $("#btnMarkUnsafe").addEventListener("click", async () => {
    try {
      await postControl("safe", { value: "unsafe" });
      await loadStatus();
      log("Safety state set to UNSAFE", "warn");
    } catch (e) {
      log("Failed to set UNSAFE: " + e.message, "error");
    }
  });
  $("#btnHealth").addEventListener("click", async () => {
    try {
      const v = $("#healthSelect").value;
      const res = await fetch(
        `/control/health?value=${encodeURIComponent(v)}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await loadStatus();
      log(`Health status set to: ${v}`, v === "error" ? "warn" : "info");
    } catch (e) {
      log("Failed to set health status: " + e.message, "error");
    }
  });
  cfgEls.form.addEventListener("submit", saveConfig);

  // Log controls
  $("#loadLogsBtn").addEventListener("click", loadLogs);
  $("#clearLogsBtn").addEventListener("click", clearLogs);

  $("#year").textContent = new Date().getFullYear();
}

(async function init() {
  wire();

  // Load initial logs from file on startup
  log("Starting Alpaca Safety Monitor Bridge Web Interface", "info");
  await loadLogs();

  await loadStatus();
  await loadConfig();

  // Auto-refresh status every 5 seconds
  setInterval(loadStatus, 5000);

  // Auto-refresh logs every 10 seconds if using buffer source
  setInterval(() => {
    const source = $("#logSourceSelect").value;
    if (source === "buffer") {
      loadLogs();
    }
  }, 10000);
})();
