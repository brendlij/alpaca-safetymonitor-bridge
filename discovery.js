// discovery.js – UDP Alpaca Discovery
const dgram = require("dgram");
const logger = require("./logger");

function startDiscovery({ httpPort, discoveryPort = 32227, host = "0.0.0.0" }) {
  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });

  udp.on("listening", () => {
    udp.setBroadcast(true);
    const a = udp.address();
    logger.info(`ASCOM Discovery service started`, {
      address: a.address,
      port: a.port,
      advertisedHttpPort: httpPort,
    });
  });

  udp.on("message", (msg, rinfo) => {
    const txt = msg.toString("ascii").trim().toLowerCase();
    if (txt !== "alpacadiscovery1") return;

    logger.debug(`ASCOM Discovery request received`, {
      from: `${rinfo.address}:${rinfo.port}`,
      advertisedPort: httpPort,
    });

    const payload = Buffer.from(
      JSON.stringify({ AlpacaPort: httpPort }),
      "ascii"
    );
    try {
      udp.send(payload, rinfo.port, rinfo.address);
      udp.send(payload, rinfo.port, "255.255.255.255");
    } catch (error) {
      logger.error("Failed to send discovery response", {
        error: error.message,
      });
    }
  });

  udp.on("error", (error) => {
    logger.error("ASCOM Discovery UDP error", { error: error.message });
  });

  udp.bind(discoveryPort, host);
  return udp; // falls du später schließen willst
}

module.exports = { startDiscovery };
