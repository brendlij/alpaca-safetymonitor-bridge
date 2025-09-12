// server.js – orchestriert MQTT, REST, Alpaca-Router, Discovery
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const mqtt = require("mqtt");
const { State, VERSION } = require("./state");
const { createAlpacaRouter } = require("./alpaca");
const { startDiscovery } = require("./discovery");
require("dotenv").config();

// === Boot-Config (nur Start-Infos) ===
const HTTP_PORT      = Number(process.env.ALPACA_PORT || 11111);
const DISCOVERY_PORT = Number(process.env.ASCOM_DISCOVERY_PORT || 32227);
const CONFIG_PATH    = process.env.CONFIG_PATH || "./data/config.json";

const DEFAULT_SAFE = (() => {
  const v = String(process.env.DEFAULT_SAFE != null ? process.env.DEFAULT_SAFE : "false").toLowerCase();
  return ["1","true","on","safe","yes"].includes(v);
})();

// === Express App ===
const app = express();
app.set("case sensitive routing", true);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static frontend (served at /)
app.use(express.static("public"));


// ensure config dir exists
const path = require("path");
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// === Runtime Config (UI-gesteuert) ===
let runtimeConfig = {
  deviceName: process.env.DEVICE_NAME || "default",
  mqttUrl: process.env.MQTT_URL || "mqtt://localhost:1883",
  topicBase: `alpaca/safetymonitor/${process.env.DEVICE_NAME || "default"}`,
  enableMqtt: true,
  enableRestControl: true,
  mqttUser: process.env.MQTT_USER || "",
  mqttPass: process.env.MQTT_PASS || ""
};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    Object.assign(runtimeConfig, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2));
  }
} catch (e) {
  console.warn("[CONFIG] load failed:", e.message);
}

// === Core State ===
const state = new State({ defaultSafe: DEFAULT_SAFE });
// Optional: Device Name in State spiegeln, falls State das unterstützt
if (typeof state.setDeviceName === "function") {
  state.setDeviceName(runtimeConfig.deviceName);
}
console.log(`[STATE] Initial IsSafe=${state.getIsSafe()} (defaultSafe=${DEFAULT_SAFE})`);

// === MQTT Handling (dynamisch nach runtimeConfig) ===
let m = null;
let hbTimer = null;

function getTopics() {
  const BASE = runtimeConfig.topicBase;
  return {
    BASE,
    SUB_SAFE_SET:   `${BASE}/safe/set`,
    PUB_SAFE_STATE: `${BASE}/safe/state`,
    CLIENT_BASE:    `${BASE}/clients/alpaca`,
    ONLINE:         `${BASE}/online`,
    VERSION:        `${BASE}/version`,
    HEARTBEAT:      `${BASE}/heartbeat`,
    UPTIME:         `${BASE}/uptime`,
    LAST_CHANGE:    `${BASE}/last_change`,
    REASON:         `${BASE}/reason`,
    SOURCE:         `${BASE}/source`,
    HEALTH:         `${BASE}/health`,
    CLIENT_CONN:    `${BASE}/clients/alpaca/connected`,
    CLIENT_LASTSEEN:`${BASE}/clients/alpaca/lastseen`,
  };
}

function stopMqtt() {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  if (m) {
    try { m.end(true); } catch {}
    m = null;
  }
}

function startMqtt() {
  stopMqtt();
  if (!runtimeConfig.enableMqtt) {
    console.log("[MQTT] disabled via config");
    return;
  }

  const T = getTopics();
  const opts = {
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    will: { topic: T.ONLINE, payload: "false", retain: true, qos: 1 }
  };

  if (runtimeConfig.mqttUser) opts.username = runtimeConfig.mqttUser;
  if (runtimeConfig.mqttPass) opts.password = runtimeConfig.mqttPass;
  if (!opts.username && process.env.MQTT_USER) opts.username = process.env.MQTT_USER;
  if (!opts.password && process.env.MQTT_PASS) opts.password = process.env.MQTT_PASS;

  console.log(`[MQTT] connect → ${runtimeConfig.mqttUrl}`);
  m = mqtt.connect(runtimeConfig.mqttUrl, opts);

  m.on("connect", () => {
    console.log(`[MQTT] connected ${runtimeConfig.mqttUrl}, sub ${T.SUB_SAFE_SET}`);
    m.subscribe(T.SUB_SAFE_SET);

    // Online / Version / Safe-Status initial
    m.publish(T.ONLINE, "true", { retain: true });
    m.publish(T.VERSION, VERSION, { retain: true });
    m.publish(T.PUB_SAFE_STATE, state.getIsSafe() ? "safe" : "unsafe", { retain: true });

    // Client-Status initial
    const cli = state.getClientConnected?.() ? "true" : "false";
    m.publish(T.CLIENT_CONN, cli, { retain: true });
    if (state.getLastClientSeen?.()) m.publish(T.CLIENT_LASTSEEN, state.getLastClientSeen(), { retain: true });

    // Heartbeat + Uptime
    const HEARTBEAT_SEC = Number(process.env.HEARTBEAT_SEC || 30);
    hbTimer = setInterval(() => {
      if (!m?.connected) return;
      m.publish(T.HEARTBEAT, new Date().toISOString());
      m.publish(T.UPTIME, String(Math.floor(process.uptime())));
    }, HEARTBEAT_SEC * 1000);
  });

  // Commands
  const IGNORE_RETAINED_SET = String(process.env.IGNORE_RETAINED_SET ?? "true").toLowerCase() !== "false";
  m.on("message", (topic, payload, packet) => {
    if (topic !== getTopics().SUB_SAFE_SET) return; // frisch lesen (topics evtl. geändert)
    if (packet?.retain && IGNORE_RETAINED_SET) { console.log("[MQTT] ignore retained set"); return; }

    const s = String(payload).trim().toLowerCase();
    const truthy = ["1","true","on","safe","yes"];
    const falsy  = ["0","false","off","unsafe","no"];
    if (truthy.includes(s)) state.setSafe(true,  `mqtt:${s}`);
    else if (falsy.includes(s)) state.setSafe(false, `mqtt:${s}`);
    else console.log(`[MQTT] ignore payload: "${s}"`);
  });

  m.on("close", () => console.log("[MQTT] connection closed"));
  m.on("error", (e) => console.log("[MQTT] error", e.message));
}

// State → MQTT Bridge
state.on("safeChanged", (isSafe, reason, ts) => {
  console.log(`[STATE] IsSafe=${isSafe} (${reason})`);
  const T = getTopics();
  if (!m?.connected) return;
  m.publish(T.PUB_SAFE_STATE, isSafe ? "safe" : "unsafe", { retain: true });
  m.publish(T.LAST_CHANGE, ts, { retain: true });
  m.publish(T.REASON, reason, { retain: true });
  m.publish(T.SOURCE, (reason.split(":")[0] || "manual"), { retain: true });
  m.publish(T.HEALTH, state.health, { retain: true });
});

state.on("healthChanged", (val) => {
  const T = getTopics();
  if (m?.connected) m.publish(T.HEALTH, val, { retain: true });
});

state.on("clientConnectionChanged", (isConn, _source, ts) => {
  const T = getTopics();
  if (!m?.connected) return;
  m.publish(T.CLIENT_CONN, isConn ? "true" : "false", { retain: true });
  m.publish(T.CLIENT_LASTSEEN, ts, { retain: true });
});

// Erstmal starten (gemäß aktueller Runtime-Config)
startMqtt();

// === /config API (Frontend) ===
app.get("/config", (_req, res) => {
  res.json({ ok: true, config: runtimeConfig, version: VERSION });
});

app.put("/config", (req, res) => {
  const before = { ...runtimeConfig };

  const b = req.body || {};
  if (typeof b.deviceName === "string") runtimeConfig.deviceName = b.deviceName.trim();
  if (typeof b.mqttUrl === "string") runtimeConfig.mqttUrl = b.mqttUrl.trim();
  if (typeof b.topicBase === "string") runtimeConfig.topicBase = b.topicBase.trim();
  if (typeof b.enableMqtt === "boolean") runtimeConfig.enableMqtt = b.enableMqtt;
  if (typeof b.enableRestControl === "boolean") runtimeConfig.enableRestControl = b.enableRestControl;
  if (typeof b.mqttUser === "string") runtimeConfig.mqttUser = b.mqttUser;
  if (typeof b.mqttPass === "string") runtimeConfig.mqttPass = b.mqttPass;


  // persistieren
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2)); }
  catch (e) { return res.status(500).json({ ok: false, error: "persist failed: " + e.message }); }

  // DeviceName optional in State spiegeln (wirkt auf Alpaca-Strings)
  if (before.deviceName !== runtimeConfig.deviceName && typeof state.setDeviceName === "function") {
    state.setDeviceName(runtimeConfig.deviceName);
  }

  // MQTT-Hot-Reload bei relevanten Änderungen
  const mqttChanged =
    before.mqttUrl   !== runtimeConfig.mqttUrl   ||
    before.topicBase !== runtimeConfig.topicBase ||
    before.enableMqtt!== runtimeConfig.enableMqtt;

  if (mqttChanged) startMqtt();

  res.json({ ok: true, config: runtimeConfig, note: mqttChanged ? "mqtt reloaded" : "ok" });
});

// === UDP Discovery ===
startDiscovery({ httpPort: HTTP_PORT, discoveryPort: DISCOVERY_PORT, host: "0.0.0.0" });

// === Alpaca (Management + /api/…) ===
app.use(createAlpacaRouter(state));

// === REST Control (per Config schaltbar) ===
app.post("/control/safe", (req, res) => {
  if (!runtimeConfig.enableRestControl) return res.status(403).json({ ok:false, error:"REST control disabled" });
  const val = (state.getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const truthy = ["1","true","on","safe","yes"];
  const falsy  = ["0","false","off","unsafe","no"];
  if (truthy.includes(val)) { state.setSafe(true,  "http"); return res.json({ ok: true, isSafe: true  }); }
  if (falsy.includes(val))  { state.setSafe(false, "http"); return res.json({ ok: true, isSafe: false }); }
  return res.status(400).json({ ok: false, error: "value must be true/false/safe/unsafe/1/0" });
});

app.post("/control/health", (req, res) => {
  if (!runtimeConfig.enableRestControl) return res.status(403).json({ ok:false, error:"REST control disabled" });
  const val = (state.getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const allowed = ["ok","degraded","error"];
  if (!allowed.includes(val)) return res.status(400).json({ ok:false, error:"value must be ok|degraded|error" });
  state.setHealth(val);
  return res.json({ ok:true, health: val });
});

// === Status + Healthz ===
app.get("/status", (_req, res) => {
  res.json({
    online: !!(m && m.connected),
    version: VERSION,
    uptime_s: Math.floor(process.uptime()),
    isSafe: state.getIsSafe(),
    last_change: state.lastChangeTs,
    reason: state.lastReason,
    health: state.health,
    device: runtimeConfig.deviceName,
    topic_base: runtimeConfig.topicBase,
    alpaca_client_connected: state.getClientConnected?.() || false,
    alpaca_client_lastseen:  state.getLastClientSeen?.()  || null
  });
});

app.get("/healthz", (_req, res) => {
  if (m && m.connected) return res.sendStatus(200);
  res.sendStatus(503);
});

// 404 für unbekannte /api Routen (Alpaca-konformes JSON)
app.use("/api", (req, res) => {
  const ctid = state.getParamCI(req, "ClientTransactionID");
  res.status(404).json(state.errBody("Not Found", ctid, 404));
});

// === Start HTTP ===
app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Alpaca HTTP on http://0.0.0.0:${HTTP_PORT}`);
});
