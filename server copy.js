// server.js - Alpaca SafetyMonitor Sim (vollständig ConformU-kompatibel)
const dgram = require("dgram");
const express = require("express");
const cors = require("cors");

// === Config ===
const HTTP_PORT = Number(process.env.ALPACA_PORT || 11111);
const DISCOVERY_PORT = 32227;

// === State ===
let connected = false;
let isRaining = false;
let serverTransactionId = 0;

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
// /management/v1/description – jetzt mit Value-Wrapper
app.get("/management/v1/description", (req, res) => {
    const ctid = getParamCI(req, "ClientTransactionID");
    res.json({
      Value: {
        ServerName: "JS Alpaca Sim",
        Manufacturer: "GalaxyScape",
        ManufacturerVersion: "0.3.0",
        Location: "localhost",
        // Devices-Feld ist optional hier; ConformU liest Hauptangaben aus Value
      },
      ClientTransactionID: parseUIntOrZero(ctid),
      ServerTransactionID: ++serverTransactionId,
      ErrorNumber: 0,
      ErrorMessage: ""
    });
  });
  
// /management/v1/configureddevices – Value = Array von Geräten
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
  
// Pflicht laut Spec: API Versions
// /management/apiversions (falls noch nicht so drin – auch hier Alpaca-Envelope)
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
app.get(`${base}/driverversion`, (req, res) => res.json(ok("0.3", getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/name`, (req, res) => res.json(ok("SafetyMonitor-0", getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/supportedactions`, (req, res) => res.json(ok([], getParamCI(req, "ClientTransactionID"))));
app.get(`${base}/interfaceversion`, (req, res) => res.json(ok(1, getParamCI(req, "ClientTransactionID"))));

// SafetyMonitor-specific
app.get(`${base}/issafe`, (req, res) => {
  if (!connected) connected = true; // auto-connect fallback
  res.json(ok(!isRaining, getParamCI(req, "ClientTransactionID")));
});

// Debug Helper
app.post("/_simulate/rain", (req, res) => {
  const on = (getParamCI(req, "on") ?? "false").toString().toLowerCase();
  isRaining = (on === "true" || on === "1");
  res.json({ ok: true, isRaining });
});

// Catch unknown /api routes
app.use("/api", (req, res) => {
  const ctid = getParamCI(req, "ClientTransactionID");
  res.status(404).json(errBody("Not Found", ctid, 404));
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Alpaca HTTP on http://0.0.0.0:${HTTP_PORT}`);
});
