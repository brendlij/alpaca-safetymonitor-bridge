// alpaca.js – Express Router für ASCOM Alpaca SafetyMonitor
const express = require("express");

function createAlpacaRouter(state) {
  const router = express.Router();

  // Management
  router.get("/management/v1/description", (req, res) => {
    const ctid = state.getParamCI(req, "ClientTransactionID");
    res.json(state.ok({
      ServerName: "JS Alpaca Sim",
      Manufacturer: "GalaxyScape",
      ManufacturerVersion: state.getVersion(),
      Location: "localhost",
    }, ctid));
  });

  router.get("/management/v1/configureddevices", (req, res) => {
    const ctid = state.getParamCI(req, "ClientTransactionID");
    res.json(state.ok([{
      DeviceName: "SafetyMonitor",
      DeviceType: "SafetyMonitor",
      DeviceNumber: 0,
      UniqueID: "sim-safetymonitor-0"
    }], ctid));
  });

  router.get("/management/apiversions", (req, res) => {
    const ctid = state.getParamCI(req, "ClientTransactionID");
    res.json(state.ok([1], ctid));
  });

  // DeviceNumber Validation
  const base = "/api/v1/safetymonitor/:dev";
  router.use(base, (req, res, next) => {
    const ctid = state.getParamCI(req, "ClientTransactionID");
    const devStr = req.params.dev;
    if (!/^\d+$/.test(devStr)) return res.status(400).json(state.errBody("Invalid device number", ctid, 1027));
    const dev = Number(devStr);
    if (dev < 0) return res.status(400).json(state.errBody("Negative device number", ctid, 1028));
    if (dev !== 0) return res.status(404).json(state.errBody("Device not found", ctid, 1029));
    next();
  });

  // Common
  router.get(`${base}/connected`, (req, res) => {
    res.json(state.ok(state.getConnected(), state.getParamCI(req, "ClientTransactionID")));
  });

  router.put(`${base}/connected`, (req, res) => {
    const ctid = state.getParamCI(req, "ClientTransactionID");
    const raw = state.getParamCI(req, "Connected");
    if (raw === undefined) return res.status(400).json(state.errBody("Missing parameter: Connected", ctid, 1025));

    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "1") {
      state.setConnected(true);
      state.setClientConnected(true, "alpaca");   // <— NEW: Client als verbunden markieren
    } else if (s === "false" || s === "0") {
      state.setConnected(false);
      state.setClientConnected(false, "alpaca");  // <— NEW: Client als getrennt markieren
    } else {
      return res.status(400).json(state.errBody(`Invalid Connected value: ${raw}`, ctid, 1026));
    }
    res.json(state.ok(null, ctid));
  });

  router.get(`${base}/description`, (req, res) =>
    res.json(state.ok("JS SafetyMonitor", state.getParamCI(req, "ClientTransactionID")))
  );
  router.get(`${base}/driverinfo`, (req, res) =>
    res.json(state.ok("Alpaca SafetyMonitor Simulator (Node.js)", state.getParamCI(req, "ClientTransactionID")))
  );
  router.get(`${base}/driverversion`, (req, res) =>
    res.json(state.ok(state.getVersion(), state.getParamCI(req, "ClientTransactionID")))
  );
  router.get(`${base}/name`, (req, res) =>
    res.json(state.ok("SafetyMonitor-0", state.getParamCI(req, "ClientTransactionID")))
  );
  router.get(`${base}/supportedactions`, (req, res) =>
    res.json(state.ok([], state.getParamCI(req, "ClientTransactionID")))
  );
  router.get(`${base}/interfaceversion`, (req, res) =>
    res.json(state.ok(1, state.getParamCI(req, "ClientTransactionID")))
  );

  // SafetyMonitor-specific
  router.get(`${base}/issafe`, (req, res) => {
    // Auto-Connect wie gehabt:
    if (!state.getConnected()) state.setConnected(true);
    // NEW: jedes Poll zählt als "Client gesehen"
    state.setClientConnected(true, "alpaca-poll");
    res.json(state.ok(state.getIsSafe(), state.getParamCI(req, "ClientTransactionID")));
  });

  return router;
}

module.exports = { createAlpacaRouter };
