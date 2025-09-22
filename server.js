// server.js – orchestriert MQTT, REST, Alpaca-Router, Discovery
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const mqtt = require("mqtt");
const { State, VERSION } = require("./state");
const { createAlpacaRouter } = require("./alpaca");
const { startDiscovery } = require("./discovery");
const logger = require("./logger");
require("dotenv").config();

// === Boot-Config (nur Start-Infos) ===
// Web interface port - defaults to 8085
const WEB_PORT = Number(process.env.WEB_PORT || 8085);
const DISCOVERY_PORT = Number(process.env.ASCOM_DISCOVERY_PORT || 32227);
const CONFIG_PATH = process.env.CONFIG_PATH || "./data/config.json";

// The HTTP server runs on WEB_PORT and serves both web interface and Alpaca API
const HTTP_PORT = WEB_PORT;

const DEFAULT_SAFE = (() => {
  const v = String(
    process.env.DEFAULT_SAFE != null ? process.env.DEFAULT_SAFE : "false"
  ).toLowerCase();
  return ["1", "true", "on", "safe", "yes"].includes(v);
})();

// === Express App ===
const app = express();
app.set("case sensitive routing", true);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static frontend (served at /)
app.use(express.static("public"));

// ensure config dir exists with proper error handling
const path = require("path");
const configDir = path.dirname(CONFIG_PATH);

function ensureConfigDir() {
  try {
    if (!fs.existsSync(configDir)) {
      logger.info(`Creating config directory: ${configDir}`);
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
    }

    // Test write permissions
    const testFile = path.join(configDir, ".write-test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    logger.info(`Config directory permissions OK: ${configDir}`);
  } catch (error) {
    logger.error(`Failed to setup config directory: ${error.message}`);
    logger.error(`Please ensure ${configDir} exists and is writable`);
    process.exit(1);
  }
}

ensureConfigDir();

// === Runtime Config (UI-gesteuert) ===
let runtimeConfig = {
  deviceName: process.env.DEVICE_NAME || "default",
  mqttUrl: process.env.MQTT_URL || "mqtt://localhost:1883",
  topicBase: `alpaca/safetymonitor/${process.env.DEVICE_NAME || "default"}`,
  enableMqtt: true,
  enableRestControl: true,
  mqttUser: process.env.MQTT_USER || "",
  mqttPass: process.env.MQTT_PASS || "",
};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    Object.assign(
      runtimeConfig,
      JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
    );
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2));
  }
} catch (e) {
  logger.warn("Config load failed", { error: e.message, path: CONFIG_PATH });
}

// === Startup Info ===
logger.info("Starting Alpaca SafetyMonitor Bridge", {
  version: VERSION,
  nodeVersion: process.version,
  webPort: HTTP_PORT,
  discoveryPort: DISCOVERY_PORT,
  configPath: CONFIG_PATH,
});

// === Core State ===
const state = new State({ defaultSafe: DEFAULT_SAFE });
// Optional: Device Name in State spiegeln, falls State das unterstützt
if (typeof state.setDeviceName === "function") {
  state.setDeviceName(runtimeConfig.deviceName);
}
logger.info(`Initial safety state: ${state.getIsSafe() ? "SAFE" : "UNSAFE"}`, {
  defaultSafe: DEFAULT_SAFE,
  deviceName: runtimeConfig.deviceName,
});

// === MQTT Handling (dynamisch nach runtimeConfig) ===
let m = null;
let hbTimer = null;

function getTopics() {
  const BASE = runtimeConfig.topicBase;
  return {
    BASE,
    SUB_SAFE_SET: `${BASE}/safe/set`,
    PUB_SAFE_STATE: `${BASE}/safe/state`,
    CLIENT_BASE: `${BASE}/clients/alpaca`,
    ONLINE: `${BASE}/online`,
    VERSION: `${BASE}/version`,
    HEARTBEAT: `${BASE}/heartbeat`,
    UPTIME: `${BASE}/uptime`,
    LAST_CHANGE: `${BASE}/last_change`,
    REASON: `${BASE}/reason`,
    SOURCE: `${BASE}/source`,
    HEALTH: `${BASE}/health`,
    CLIENT_CONN: `${BASE}/clients/alpaca/connected`,
    CLIENT_LASTSEEN: `${BASE}/clients/alpaca/lastseen`,
  };
}

function stopMqtt() {
  if (hbTimer) {
    clearInterval(hbTimer);
    hbTimer = null;
  }
  if (m) {
    try {
      m.end(true);
    } catch {}
    m = null;
  }
}

function startMqtt() {
  stopMqtt();
  if (!runtimeConfig.enableMqtt) {
    logger.info("MQTT disabled via configuration");
    return;
  }

  const T = getTopics();
  const opts = {
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    will: { topic: T.ONLINE, payload: "false", retain: true, qos: 1 },
  };

  if (runtimeConfig.mqttUser) opts.username = runtimeConfig.mqttUser;
  if (runtimeConfig.mqttPass) opts.password = runtimeConfig.mqttPass;
  if (!opts.username && process.env.MQTT_USER)
    opts.username = process.env.MQTT_USER;
  if (!opts.password && process.env.MQTT_PASS)
    opts.password = process.env.MQTT_PASS;

  logger.info(`Connecting to MQTT broker`, {
    url: runtimeConfig.mqttUrl,
    username: opts.username || "(none)",
    topicBase: runtimeConfig.topicBase,
  });

  try {
    m = mqtt.connect(runtimeConfig.mqttUrl, opts);
  } catch (error) {
    logger.error(`Failed to connect to MQTT broker`, {
      url: runtimeConfig.mqttUrl,
      error: error.message,
    });
    return;
  }

  m.on("connect", () => {
    logger.info(`MQTT connected successfully`, {
      broker: runtimeConfig.mqttUrl,
      subscribeTopics: T.SUB_SAFE_SET,
    });
    m.subscribe(T.SUB_SAFE_SET);

    // Online / Version / Safe-Status initial
    m.publish(T.ONLINE, "true", { retain: true });
    m.publish(T.VERSION, VERSION, { retain: true });
    m.publish(T.PUB_SAFE_STATE, state.getIsSafe() ? "safe" : "unsafe", {
      retain: true,
    });

    // Client-Status initial
    const cli = state.getClientConnected?.() ? "true" : "false";
    m.publish(T.CLIENT_CONN, cli, { retain: true });
    if (state.getLastClientSeen?.())
      m.publish(T.CLIENT_LASTSEEN, state.getLastClientSeen(), { retain: true });

    // Heartbeat + Uptime
    const HEARTBEAT_SEC = Number(process.env.HEARTBEAT_SEC || 30);
    hbTimer = setInterval(() => {
      if (!m?.connected) return;
      m.publish(T.HEARTBEAT, new Date().toISOString());
      m.publish(T.UPTIME, String(Math.floor(process.uptime())));
    }, HEARTBEAT_SEC * 1000);
  });

  // Commands
  const IGNORE_RETAINED_SET =
    String(process.env.IGNORE_RETAINED_SET ?? "true").toLowerCase() !== "false";
  m.on("message", (topic, payload, packet) => {
    if (topic !== getTopics().SUB_SAFE_SET) return; // frisch lesen (topics evtl. geändert)
    if (packet?.retain && IGNORE_RETAINED_SET) {
      logger.debug("Ignoring retained MQTT message");
      return;
    }

    const s = String(payload).trim().toLowerCase();
    const truthy = ["1", "true", "on", "safe", "yes"];
    const falsy = ["0", "false", "off", "unsafe", "no"];
    if (truthy.includes(s)) {
      logger.info(`MQTT command: Set SAFE`, { payload: s, topic });
      state.setSafe(true, `mqtt:${s}`);
    } else if (falsy.includes(s)) {
      logger.info(`MQTT command: Set UNSAFE`, { payload: s, topic });
      state.setSafe(false, `mqtt:${s}`);
    } else {
      logger.warn(`MQTT: Invalid payload received`, { payload: s, topic });
    }
  });

  m.on("close", () => logger.warn("MQTT connection closed"));
  m.on("error", (e) =>
    logger.error("MQTT connection error", { error: e.message })
  );
}

// State → MQTT Bridge
state.on("safeChanged", (isSafe, reason, ts) => {
  const status = isSafe ? "SAFE" : "UNSAFE";
  logger.info(`Safety state changed: ${status}`, { reason, timestamp: ts });

  const T = getTopics();
  if (!m?.connected) {
    logger.warn("Cannot publish state change - MQTT not connected");
    return;
  }

  try {
    m.publish(T.PUB_SAFE_STATE, isSafe ? "safe" : "unsafe", { retain: true });
    m.publish(T.LAST_CHANGE, ts, { retain: true });
    m.publish(T.REASON, reason, { retain: true });
    logger.debug("Published state change to MQTT", { status, reason });
  } catch (error) {
    logger.error("Failed to publish state change to MQTT", {
      error: error.message,
    });
  }
  m.publish(T.SOURCE, reason.split(":")[0] || "manual", { retain: true });
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
  if (typeof b.deviceName === "string")
    runtimeConfig.deviceName = b.deviceName.trim();
  if (typeof b.mqttUrl === "string") runtimeConfig.mqttUrl = b.mqttUrl.trim();
  if (typeof b.topicBase === "string")
    runtimeConfig.topicBase = b.topicBase.trim();
  if (typeof b.enableMqtt === "boolean")
    runtimeConfig.enableMqtt = b.enableMqtt;
  if (typeof b.enableRestControl === "boolean")
    runtimeConfig.enableRestControl = b.enableRestControl;
  if (typeof b.mqttUser === "string") runtimeConfig.mqttUser = b.mqttUser;
  if (typeof b.mqttPass === "string") runtimeConfig.mqttPass = b.mqttPass;

  // persistieren with atomic write (safer)
  try {
    const tempPath = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(runtimeConfig, null, 2));
    fs.renameSync(tempPath, CONFIG_PATH);
    logger.info(`Configuration saved successfully`, { path: CONFIG_PATH });
  } catch (e) {
    logger.error(`Failed to save configuration`, {
      error: e.message,
      path: CONFIG_PATH,
    });
    return res
      .status(500)
      .json({ ok: false, error: "persist failed: " + e.message });
  }

  // DeviceName optional in State spiegeln (wirkt auf Alpaca-Strings)
  if (
    before.deviceName !== runtimeConfig.deviceName &&
    typeof state.setDeviceName === "function"
  ) {
    state.setDeviceName(runtimeConfig.deviceName);
  }

  // MQTT-Hot-Reload bei relevanten Änderungen
  const mqttChanged =
    before.mqttUrl !== runtimeConfig.mqttUrl ||
    before.topicBase !== runtimeConfig.topicBase ||
    before.enableMqtt !== runtimeConfig.enableMqtt;

  if (mqttChanged) startMqtt();

  res.json({
    ok: true,
    config: runtimeConfig,
    note: mqttChanged ? "mqtt reloaded" : "ok",
  });
});

// === UDP Discovery ===
startDiscovery({
  httpPort: HTTP_PORT,
  discoveryPort: DISCOVERY_PORT,
  host: "0.0.0.0",
});

// === Alpaca (Management + /api/…) ===
app.use(createAlpacaRouter(state));

// === REST Control (per Config schaltbar) ===
app.post("/control/safe", (req, res) => {
  try {
    if (!runtimeConfig.enableRestControl) {
      logger.warn("REST control request denied - feature disabled", {
        endpoint: "/control/safe",
      });
      return res
        .status(403)
        .json({ ok: false, error: "REST control disabled" });
    }

    const val = (state.getParamCI(req, "value") ?? "")
      .toString()
      .toLowerCase()
      .trim();
    const truthy = ["1", "true", "on", "safe", "yes"];
    const falsy = ["0", "false", "off", "unsafe", "no"];

    if (truthy.includes(val)) {
      logger.info("REST API: Setting safety state to SAFE", {
        value: val,
        source: "http",
      });
      state.setSafe(true, "http");
      return res.json({ ok: true, isSafe: true });
    }
    if (falsy.includes(val)) {
      logger.info("REST API: Setting safety state to UNSAFE", {
        value: val,
        source: "http",
      });
      state.setSafe(false, "http");
      return res.json({ ok: true, isSafe: false });
    }

    logger.warn("REST API: Invalid safety value provided", { value: val });
    return res
      .status(400)
      .json({ ok: false, error: "value must be true/false/safe/unsafe/1/0" });
  } catch (error) {
    logger.error("REST API: Error in /control/safe", { error: error.message });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/control/health", (req, res) => {
  try {
    if (!runtimeConfig.enableRestControl) {
      logger.warn("REST control request denied - feature disabled", {
        endpoint: "/control/health",
      });
      return res
        .status(403)
        .json({ ok: false, error: "REST control disabled" });
    }

    const val = (state.getParamCI(req, "value") ?? "")
      .toString()
      .toLowerCase()
      .trim();
    const allowed = ["ok", "degraded", "error"];

    if (!allowed.includes(val)) {
      logger.warn("REST API: Invalid health value provided", { value: val });
      return res
        .status(400)
        .json({ ok: false, error: "value must be ok|degraded|error" });
    }

    logger.info("REST API: Setting health status", {
      health: val,
      source: "http",
    });
    state.setHealth(val);
    return res.json({ ok: true, health: val });
  } catch (error) {
    logger.error("REST API: Error in /control/health", {
      error: error.message,
    });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
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
    alpaca_client_lastseen: state.getLastClientSeen?.() || null,
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

// === Logs API ===
app.get("/api/logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const source = req.query.source || "buffer"; // 'buffer' or 'file'

    let logs;
    if (source === "file") {
      logs = await logger.getLogsFromFile(limit);
    } else {
      logs = logger.getRecentLogs(limit);
    }

    res.json({ ok: true, logs });
  } catch (error) {
    logger.error("Failed to retrieve logs", { error: error.message });
    res.status(500).json({ ok: false, error: "Failed to retrieve logs" });
  }
});

// === Start HTTP ===
app.listen(HTTP_PORT, "0.0.0.0", () => {
  logger.info(`Alpaca SafetyMonitor Bridge started`, {
    webPort: HTTP_PORT,
    discoveryPort: DISCOVERY_PORT,
    configPath: CONFIG_PATH,
    version: VERSION,
  });
});
