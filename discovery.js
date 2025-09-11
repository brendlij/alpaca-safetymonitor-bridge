// discovery.js – UDP Alpaca Discovery
const dgram = require("dgram");

function startDiscovery({ httpPort, discoveryPort = 32227, host = "0.0.0.0" }) {
  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });

  udp.on("listening", () => {
    udp.setBroadcast(true);
    const a = udp.address();
    console.log(`UDP discovery on ${a.address}:${a.port}`);
  });

  udp.on("message", (msg, rinfo) => {
    const txt = msg.toString("ascii").trim().toLowerCase();
    if (txt !== "alpacadiscovery1") return;
    const payload = Buffer.from(JSON.stringify({ AlpacaPort: httpPort }), "ascii");
    udp.send(payload, rinfo.port, rinfo.address);
    udp.send(payload, rinfo.port, "255.255.255.255");
  });

  udp.bind(discoveryPort, host);
  return udp; // falls du später schließen willst
}

module.exports = { startDiscovery };
