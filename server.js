// server.js – orchestriert MQTT, REST, Alpaca-Router, Discovery
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
const { State, VERSION } = require("./state");
const { createAlpacaRouter } = require("./alpaca");
const { startDiscovery } = require("./discovery");
require("dotenv").config();

// === Config ===
const HTTP_PORT = Number(process.env.ALPACA_PORT || 11111);
const DISCOVERY_PORT = Number(process.env.ASCOM_DISCOVERY_PORT || 32227);

const DEFAULT_SAFE = (() => {
  const v = String(process.env.DEFAULT_SAFE ?? "true").toLowerCase();
  return ["1", "true", "on", "safe", "yes"].includes(v);
})();

// MQTT / Topics
const DEVICE_NAME = process.env.DEVICE_NAME || "default";
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const TOPIC_BASE = `alpaca/safetymonitor/${DEVICE_NAME}`;
const MQTT_SUB = `${TOPIC_BASE}/safe/set`;   // INPUT (Command)
const MQTT_PUB = `${TOPIC_BASE}/safe/state`; // OUTPUT (State)
const CLIENT_BASE = `${TOPIC_BASE}/clients/alpaca`; // Alpaca-Client (z.B. NINA)

const MQTT_USER = process.env.MQTT_USER || undefined;
const MQTT_PASS = process.env.MQTT_PASS || undefined;
const IGNORE_RETAINED_SET = String(process.env.IGNORE_RETAINED_SET ?? "true").toLowerCase() !== "false";
const HEARTBEAT_SEC = Number(process.env.HEARTBEAT_SEC || 30);

// === State ===
const state = new State({ defaultSafe: DEFAULT_SAFE });
console.log(`[STATE] Initial IsSafe=${state.getIsSafe()} (defaultSafe from .env = ${DEFAULT_SAFE})`);

// === MQTT ===
let m = null;
let hbTimer = null;

(function connectMqtt() {
  try {
    const options = {};
    if (MQTT_USER && MQTT_PASS) {
      options.username = MQTT_USER;
      options.password = MQTT_PASS;
    }
    // LWT unter dem Instanz-Namespace
    options.will = { topic: `${TOPIC_BASE}/online`, payload: "false", retain: true, qos: 1 };

    m = mqtt.connect(MQTT_URL, options);

    m.on("connect", () => {
      console.log(`[MQTT] connected ${MQTT_URL}, sub ${MQTT_SUB}`);
      m.subscribe(MQTT_SUB);

      // Online/Version initial
      m.publish(`${TOPIC_BASE}/online`, "true", { retain: true });
      m.publish(`${TOPIC_BASE}/version`, VERSION, { retain: true });

      // aktuellen Safe-Status rausgeben
      m.publish(MQTT_PUB, state.getIsSafe() ? "safe" : "unsafe", { retain: true });

      // Alpaca-Client-Status initial spiegeln
      m.publish(`${CLIENT_BASE}/connected`, state.getClientConnected() ? "true" : "false", { retain: true });
      if (state.getLastClientSeen()) {
        m.publish(`${CLIENT_BASE}/lastseen`, state.getLastClientSeen(), { retain: true });
      }

      // Heartbeat + Uptime (ein Timer, auch bei Reconnects)
      if (hbTimer) clearInterval(hbTimer);
      hbTimer = setInterval(() => {
        if (!m.connected) return;
        m.publish(`${TOPIC_BASE}/heartbeat`, new Date().toISOString());
        m.publish(`${TOPIC_BASE}/uptime`, String(Math.floor(process.uptime())));
      }, HEARTBEAT_SEC * 1000);
    });

    // Direkt-Override (Command)
    m.on("message", (topic, payload, packet) => {
      if (topic !== MQTT_SUB) return;
      if (packet?.retain && IGNORE_RETAINED_SET) {
        console.log("[MQTT] ignore retained set");
        return;
      }
      const s = String(payload).trim().toLowerCase();
      const truthy = ["1", "true", "on", "safe", "yes"];
      const falsy = ["0", "false", "off", "unsafe", "no"];
      if (truthy.includes(s)) state.setSafe(true, `mqtt:${s}`);
      else if (falsy.includes(s)) state.setSafe(false, `mqtt:${s}`);
      else console.log(`[MQTT] ignore payload: "${s}"`);
    });

    m.on("close", () => console.log("[MQTT] connection closed"));
    m.on("error", (e) => console.log("[MQTT] error", e.message));
  } catch (e) {
    console.log("[MQTT] init failed:", e.message);
  }
})();

// State→MQTT Bridge (alles unter TOPIC_BASE)
state.on("safeChanged", (isSafe, reason, ts) => {
  console.log(`[STATE] IsSafe=${isSafe} (${reason})`);
  if (!m || !m.connected) return;
  const payload = isSafe ? "safe" : "unsafe";
  m.publish(MQTT_PUB, payload, { retain: true });
  m.publish(`${TOPIC_BASE}/last_change`, ts, { retain: true });
  m.publish(`${TOPIC_BASE}/reason`, reason, { retain: true });
  m.publish(`${TOPIC_BASE}/source`, (reason.split(":")[0] || "manual"), { retain: true });
  m.publish(`${TOPIC_BASE}/health`, state.health, { retain: true });
});

state.on("healthChanged", (val) => {
  if (m && m.connected) m.publish(`${TOPIC_BASE}/health`, val, { retain: true });
});

// NEW: Alpaca-Client-Status -> MQTT
state.on("clientConnectionChanged", (isConn, source, ts) => {
  if (!m || !m.connected) return;
  m.publish(`${CLIENT_BASE}/connected`, isConn ? "true" : "false", { retain: true });
  m.publish(`${CLIENT_BASE}/lastseen`, ts, { retain: true });
});

// === UDP Discovery ===
startDiscovery({ httpPort: HTTP_PORT, discoveryPort: DISCOVERY_PORT, host: "0.0.0.0" });

// === HTTP API ===
const app = express();
app.set("case sensitive routing", true);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Alpaca (Management + /api/…)
app.use(createAlpacaRouter(state));

// REST Control
app.post("/control/safe", (req, res) => {
  const val = (state.getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const truthy = ["1", "true", "on", "safe", "yes"];
  const falsy = ["0", "false", "off", "unsafe", "no"];
  if (truthy.includes(val)) {
    state.setSafe(true, "http");
    return res.json({ ok: true, isSafe: true });
  }
  if (falsy.includes(val)) {
    state.setSafe(false, "http");
    return res.json({ ok: true, isSafe: false });
  }
  return res.status(400).json({ ok: false, error: "value must be true/false/safe/unsafe/1/0" });
});

app.post("/control/health", (req, res) => {
  const val = (state.getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const allowed = ["ok", "degraded", "error"];
  if (!allowed.includes(val)) return res.status(400).json({ ok: false, error: "value must be ok|degraded|error" });
  state.setHealth(val);
  return res.json({ ok: true, health: val });
});

// Status + Healthz
app.get("/status", (_req, res) => {
  res.json({
    online: !!(m && m.connected),
    version: VERSION,
    uptime_s: Math.floor(process.uptime()),
    isSafe: state.getIsSafe(),
    last_change: state.lastChangeTs,
    reason: state.lastReason,
    health: state.health,
    device: DEVICE_NAME,
    topic_base: TOPIC_BASE,
    // NEW: Alpaca-Client-Infos
    alpaca_client_connected: state.getClientConnected(),
    alpaca_client_lastseen: state.getLastClientSeen()
  });
});
app.get("/healthz", (_req, res) => {
  if (m && m.connected) return res.sendStatus(200);
  res.sendStatus(503);
});

// Catch unknown /api routes (JSON)
app.use("/api", (req, res) => {
  const ctid = state.getParamCI(req, "ClientTransactionID");
  res.status(404).json(state.errBody("Not Found", ctid, 404));
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Alpaca HTTP on http://0.0.0.0:${HTTP_PORT}`);
});
