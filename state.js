// state.js – zentrale Zustände & Alpaca-Helper
const EventEmitter = require("events");

const VERSION = "0.4.0";

class State extends EventEmitter {
    constructor(opts = {}) {
      super();
      const defaultSafe = opts.defaultSafe ?? true; // Standard = safe
      this.connected = false;
      this.isSafe = Boolean(defaultSafe);          // neutraler Safety-State
      this.serverTransactionId = 0;
  
      this.health = "ok";
      this.lastChangeTs = null;
      this.lastReason = null;
    }
  

  // ---- Helpers (Alpaca Spec) ----
  parseUIntOrZero(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const t = Math.trunc(n);
    return t < 0 ? 0 : t;
  }
  getParamCI(req, key) {
    const find = (obj) => {
      if (!obj) return undefined;
      const k = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
      return k ? obj[k] : undefined;
    };
    return find(req.query) ?? find(req.body);
  }
  ok(value, clientTx) {
    return {
      Value: value,
      ClientTransactionID: this.parseUIntOrZero(clientTx),
      ServerTransactionID: ++this.serverTransactionId,
      ErrorNumber: 0,
      ErrorMessage: ""
    };
  }
  errBody(msg, clientTx, num = 1024) {
    return {
      ClientTransactionID: this.parseUIntOrZero(clientTx),
      ServerTransactionID: ++this.serverTransactionId,
      ErrorNumber: num,
      ErrorMessage: msg
    };
  }

  // ---- Business State ----
  setConnected(v) { this.connected = !!v; }
  getConnected() { return this.connected; }
  getIsSafe() { return this.isSafe; }
  getVersion() { return VERSION; }

  setHealth(val) {
    this.health = val;
    this.emit("healthChanged", val);
  }

  // Master Setter: löst Events für MQTT/REST aus
  setSafe(safe, reason = "manual") {
    const prev = this.isSafe;
    this.isSafe = Boolean(safe);
    if (prev !== this.isSafe) {
      this.lastChangeTs = new Date().toISOString();
      this.lastReason = reason;
      this.emit("safeChanged", this.isSafe, reason, this.lastChangeTs);
    }
  }
}

module.exports = { State, VERSION };
