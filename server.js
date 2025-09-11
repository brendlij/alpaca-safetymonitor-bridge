// server.js - Alpaca SafetyMonitor Sim (mit MQTT Status + Health + Heartbeat)
const dgram = require("dgram");
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
require("dotenv").config();

// === Config ===
const HTTP_PORT = Number(process.env.ALPACA_PORT || 11111);
const DISCOVERY_PORT = Number(process.env.NINA_DISCOVERY_PORT || 32227);

// --- MQTT Config ---
const MQTT_URL   = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_SUB   = process.env.MQTT_SUB || "alpaca/safetymonitor/safe/set";
const MQTT_PUB   = process.env.MQTT_PUB || "alpaca/safetymonitor/safe/state";

const MQTT_USER  = process.env.MQTT_USER || undefined;
const MQTT_PASS  = process.env.MQTT_PASS || undefined;

// === State ===
let connected = false;
let isRaining = false;
let serverTransactionId = 0;

// Extra Status
let health = "ok";                 // ok | degraded | error
let lastChangeTs = null;           // ISO timestamp
let lastReason = null;             // z.B. "mqtt:unsafe" / "http"
const HEARTBEAT_SEC = Number(process.env.HEARTBEAT_SEC || 30);
const VERSION = "0.4.0";

// === Helpers ===
const getParamCI = (req, key) => {
  const find = (obj) => {
    if (!obj) return undefined;
    const k = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return k ? obj[k] : undefined;
  };
  return find(req.query) ?? find(req.body);
};
const parseUIntOrZero = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const t = Math.trunc(n);
  return t < 0 ? 0 : t; // negatives nicht zurückspiegeln
};
const ok = (value, clientTx) => ({
  Value: value,
  ClientTransactionID: parseUIntOrZero(clientTx),
  ServerTransactionID: ++serverTransactionId,
  ErrorNumber: 0,
  ErrorMessage: ""
});
const errBody = (msg, clientTx, num = 1024) => ({
  ClientTransactionID: parseUIntOrZero(clientTx),
  ServerTransactionID: ++serverTransactionId,
  ErrorNumber: num,
  ErrorMessage: msg
});

// === State helper ===
const setSafe = (safe, reason = "manual") => {
  const prev = !isRaining;
  isRaining = !Boolean(safe);
  const now = !isRaining;

  if (prev !== now) {
    lastChangeTs = new Date().toISOString();
    lastReason = reason;
    console.log(`[STATE] IsSafe=${now} (${reason})`);
    if (m && m.connected) {
      const payload = now ? "safe" : "unsafe";
      m.publish(MQTT_PUB, payload, { retain: true });
      m.publish("alpaca/safetymonitor/last_change", lastChangeTs, { retain: true });
      m.publish("alpaca/safetymonitor/reason", reason, { retain: true });
      m.publish("alpaca/safetymonitor/source", reason.split(":")[0] || "manual", { retain: true });
      m.publish("alpaca/safetymonitor/health", health, { retain: true });
    }
  }
};

// === MQTT connect ===
let m = null;
try {
  const options = {};
  if (MQTT_USER && MQTT_PASS) {
    options.username = MQTT_USER;
    options.password = MQTT_PASS;
  }
  // Last Will: wenn Prozess stirbt -> online=false
  options.will = {
    topic: "alpaca/safetymonitor/online",
    payload: "false",
    retain: true,
    qos: 1
  };

  m = mqtt.connect(MQTT_URL, options);

  m.on("connect", () => {
    console.log(`[MQTT] connected ${MQTT_URL}, sub ${MQTT_SUB}`);
    m.subscribe(MQTT_SUB);

    // Online/Version initial publizieren
    m.publish("alpaca/safetymonitor/online", "true", { retain: true });
    m.publish("alpaca/safetymonitor/version", VERSION, { retain: true });

    // aktuellen Safe-Status rausgeben
    m.publish(MQTT_PUB, (!isRaining ? "safe" : "unsafe"), { retain: true });

    // Heartbeat + Uptime
    setInterval(() => {
      if (!m.connected) return;
      m.publish("alpaca/safetymonitor/heartbeat", new Date().toISOString(), { retain: false });
      m.publish("alpaca/safetymonitor/uptime", String(Math.floor(process.uptime())), { retain: false });
    }, HEARTBEAT_SEC * 1000);
  });

  m.on("message", (topic, payload) => {
    if (topic !== MQTT_SUB) return;
    const s = String(payload).trim().toLowerCase();
    const truthy  = ["1","true","on","safe","yes"];
    const falsy   = ["0","false","off","unsafe","no"];
    if (truthy.includes(s)) setSafe(true, `mqtt:${s}`);
    else if (falsy.includes(s)) setSafe(false, `mqtt:${s}`);
    else console.log(`[MQTT] ignore payload: "${s}"`);
  });

  m.on("close", () => console.log("[MQTT] connection closed"));
  m.on("error", (e) => console.log("[MQTT] error", e.message));

} catch (e) {
  console.log("[MQTT] init failed:", e.message);
}

// === UDP Discovery ===
const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
udp.on("listening", () => {
  udp.setBroadcast(true);
  const a = udp.address();
  console.log(`UDP discovery on ${a.address}:${a.port}`);
});
udp.on("message", (msg, rinfo) => {
  const txt = msg.toString("ascii").trim().toLowerCase();
  if (txt !== "alpacadiscovery1") return;
  const payload = Buffer.from(JSON.stringify({ AlpacaPort: HTTP_PORT }), "ascii");
  udp.send(payload, rinfo.port, rinfo.address);
  udp.send(payload, rinfo.port, "255.255.255.255");
});
udp.bind(DISCOVERY_PORT, "0.0.0.0");

// === HTTP API ===
const app = express();
app.set("case sensitive routing", true);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Management Endpoints
app.get("/management/v1/description", (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  res.json({
    Value: {
      ServerName: "JS Alpaca Sim",
      Manufacturer: "GalaxyScape",
      ManufacturerVersion: VERSION,
      Location: "localhost",
    },
    ClientTransactionID: parseUIntOrZero(ctid),
    ServerTransactionID: ++serverTransactionId,
    ErrorNumber: 0,
    ErrorMessage: ""
  });
});
app.get("/management/v1/configureddevices", (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  res.json({
    Value: [
      {
        DeviceName: "SafetyMonitor",
        DeviceType: "SafetyMonitor",
        DeviceNumber: 0,
        UniqueID: "sim-safetymonitor-0"
      }
    ],
    ClientTransactionID: parseUIntOrZero(ctid),
    ServerTransactionID: ++serverTransactionId,
    ErrorNumber: 0,
    ErrorMessage: ""
  });
});
app.get("/management/apiversions", (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  res.json({
    Value: [1],
    ClientTransactionID: parseUIntOrZero(ctid),
    ServerTransactionID: ++serverTransactionId,
    ErrorNumber: 0,
    ErrorMessage: ""
  });
});

// DeviceNumber Validation
const base = "/api/v1/safetymonitor/:dev";
app.use(base, (req, res, next) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  const devStr = req.params.dev;
  if (!/^\d+$/.test(devStr)) {
    return res.status(400).json(errBody("Invalid device number", ctid, 1027));
  }
  const dev = Number(devStr);
  if (dev < 0) {
    return res.status(400).json(errBody("Negative device number", ctid, 1028));
  }
  if (dev !== 0) {
    return res.status(404).json(errBody("Device not found", ctid, 1029));
  }
  next();
});

// Common Endpoints
app.get(`${base}/connected`, (req, res) => {
  res.json(ok(connected, getParamCI(req, "ClientTransactionID")));
});
app.put(`${base}/connected`, (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  const raw = getParamCI(req, "Connected");
  if (raw === undefined) return res.status(400).json(errBody("Missing parameter: Connected", ctid, 1025));
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1") connected = true;
  else if (s === "false" || s === "0") connected = false;
  else return res.status(400).json(errBody(`Invalid Connected value: ${raw}`, ctid, 1026));
  res.json(ok(null, ctid));
});
app.get(`${base}/description`, (req, res) => res.json(ok("JS SafetyMonitor", getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/driverinfo`, (req, res) => res.json(ok("Alpaca SafetyMonitor Simulator (Node.js)", getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/driverversion`, (req, res) => res.json(ok(VERSION, getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/name`, (req, res) => res.json(ok("SafetyMonitor-0", getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/supportedactions`, (req, res) => res.json(ok([], getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/interfaceversion`, (req, res) => res.json(ok(1, getParamCI(req, "ClientTransactionID"))));

// SafetyMonitor-specific
app.get(`${base}/issafe`, (req, res) => {
  console.log(`[NINA] GET /issafe @ ${new Date().toISOString()}`);
  if (!connected) connected = true; // auto-connect fallback
  res.json(ok(!isRaining, getParamCI(req, "ClientTransactionID")));
});

// Debug Helper
app.post("/_simulate/rain", (req, res) => {
  const on = (getParamCI(req, "on") ?? "false").toString().toLowerCase();
  isRaining = (on === "true" || on === "1");
  res.json({ ok: true, isRaining });
});

// --- REST Control ---
app.post("/control/safe", (req, res) => {
  const val = (getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const truthy = ["1","true","on","safe","yes"];
  const falsy  = ["0","false","off","unsafe","no"];
  if (truthy.includes(val)) { setSafe(true,  "http"); return res.json({ ok: true, isSafe: true  }); }
  if (falsy.includes(val))  { setSafe(false, "http"); return res.json({ ok: true, isSafe: false }); }
  return res.status(400).json({ ok: false, error: "value must be true/false/safe/unsafe/1/0" });
});

// Health setter
app.post("/control/health", (req, res) => {
  const val = (getParamCI(req, "value") ?? "").toString().toLowerCase().trim();
  const allowed = ["ok","degraded","error"];
  if (!allowed.includes(val)) {
    return res.status(400).json({ ok: false, error: "value must be ok|degraded|error" });
  }
  health = val;
  if (m && m.connected) m.publish("alpaca/safetymonitor/health", health, { retain: true });
  return res.json({ ok: true, health });
});

// Status + Healthz
app.get("/status", (_req, res) => {
  res.json({
    online: !!(m && m.connected),
    version: VERSION,
    uptime_s: Math.floor(process.uptime()),
    isSafe: !isRaining,
    last_change: lastChangeTs,
    reason: lastReason,
    health
  });
});
app.get("/healthz", (_req, res) => {
  if (m && m.connected) return res.sendStatus(200);
  res.sendStatus(503);
});

// Catch unknown /api routes
app.use("/api", (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  res.status(404).json(errBody("Not Found", ctid, 404));
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Alpaca HTTP on http://0.0.0.0:${HTTP_PORT}`);
});
