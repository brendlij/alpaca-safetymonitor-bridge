// testpub.js
const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://192.168.178.185", {
  username: "mqtt",
  password: "mqtt"
});

client.on("connect", () => {
  console.log("connected");
  client.publish("alpaca/safetymonitor/safe/set", "safe", { retain: true });
  setTimeout(() => client.end(), 500);
});
