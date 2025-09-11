## Alpaca SafetyMonitor Bridge

Node.js simulator for an ASCOM Alpaca SafetyMonitor with MQTT bridge, REST control, and UDP discovery. Designed to be used by Alpaca clients (e.g., N.I.N.A., ASCOM Remote), while also exposing the safety state via MQTT for home automation and monitoring.

### Features
- **Alpaca API**: Implements SafetyMonitor v1 endpoints under `/api/v1/safetymonitor/0/...` and management endpoints.
- **MQTT bridge**: Publishes safety state and metadata; accepts safe/unsafe override commands.
- **REST control**: Simple HTTP endpoints to set safety and health.
- **UDP discovery**: Responds to `alpacadiscovery1` queries with the configured HTTP port.
- **Client tracking**: Tracks Alpaca client connection/polling and mirrors it to MQTT.

### Requirements
- Node.js 18+ (recommended)
- MQTT broker (optional but recommended), e.g., Mosquitto

### Install
```bash
npm install
```

### Run
```bash
node server.js
```
The server listens on `0.0.0.0:{ALPACA_PORT}` (default `11111`).

### Configuration (.env)
Create a `.env` file in the project root (all are optional):

```env
# HTTP / Discovery
ALPACA_PORT=11111            # Alpaca HTTP port
ASCOM_DISCOVERY_PORT=32227   # UDP discovery port

# Device identity
DEVICE_NAME=my-safety        # used in MQTT topic base: alpaca/safetymonitor/{DEVICE_NAME}

# MQTT connection
MQTT_URL=mqtt://localhost:1883
MQTT_USER=                    # optional
MQTT_PASS=                    # optional

# Behavior
DEFAULT_SAFE=true            # default initial state (true|false|on|off|safe|unsafe|1|0)
IGNORE_RETAINED_SET=true     # ignore retained MQTT commands on startup (true/false)
HEARTBEAT_SEC=30             # MQTT heartbeat interval in seconds
```

Defaults (when variables are unset):
- **ALPACA_PORT**: 11111
- **ASCOM_DISCOVERY_PORT**: 32227
- **DEVICE_NAME**: `default`
- **MQTT_URL**: `mqtt://localhost:1883`
- **IGNORE_RETAINED_SET**: true
- **HEARTBEAT_SEC**: 30
- **DEFAULT_SAFE**: true

### HTTP Endpoints
Base URL: `http://<host>:<ALPACA_PORT>`

- `GET /status` – Overall status JSON
  - Includes: `online, version, uptime_s, isSafe, last_change, reason, health, device, topic_base, alpaca_client_connected, alpaca_client_lastseen`

- `GET /healthz` – 200 when MQTT is connected, otherwise 503

- `POST /control/safe` – Set safety state
  - Body or query `value` in: `true,false,on,off,safe,unsafe,1,0`
  - Example:
    ```bash
    curl -X POST "http://localhost:11111/control/safe?value=unsafe"
    ```

- `POST /control/health` – Set health indicator
  - Allowed values: `ok | degraded | error`
  - Example:
    ```bash
    curl -X POST "http://localhost:11111/control/health" -H "Content-Type: application/json" -d '{"value":"degraded"}'
    ```

### Alpaca API (SafetyMonitor v1)
Management:
- `GET /management/v1/description`
- `GET /management/v1/configureddevices`
- `GET /management/apiversions`

Device base: `/api/v1/safetymonitor/0`
- `GET /connected` – Returns boolean
- `PUT /connected?Connected=true|false` – Connect/disconnect
- `GET /description` – String
- `GET /driverinfo` – String
- `GET /driverversion` – String (e.g., `0.5.0`)
- `GET /name` – String
- `GET /supportedactions` – `[]`
- `GET /interfaceversion` – `1`
- `GET /issafe` – Returns boolean

Notes:
- `GET /issafe` will auto-set internal `Connected=true` and also mark an Alpaca client as seen, which is reflected to MQTT (see below).
- All Alpaca responses include `ClientTransactionID` echoing and `ServerTransactionID` sequencing as per Alpaca conventions.

### MQTT Topics
Topic base: `alpaca/safetymonitor/{DEVICE_NAME}`

Publish (retained where noted):
- `{base}/online` – `true|false` (LWT, retained)
- `{base}/version` – simulator version string (retained)
- `{base}/safe/state` – `safe|unsafe` (retained)
- `{base}/last_change` – ISO timestamp of last state change (retained)
- `{base}/reason` – last change reason, e.g., `http`, `mqtt:true` (retained)
- `{base}/source` – reason source prefix, e.g., `http`, `mqtt` (retained)
- `{base}/health` – `ok|degraded|error` (retained)
- `{base}/heartbeat` – ISO timestamp heartbeat (interval = `HEARTBEAT_SEC`)
- `{base}/uptime` – integer seconds uptime

Alpaca client mirror under `{base}/clients/alpaca` (retained):
- `{base}/clients/alpaca/connected` – `true|false`
- `{base}/clients/alpaca/lastseen` – ISO timestamp

Subscribe (commands):
- `{base}/safe/set` – accepts: `1,true,on,safe,yes` or `0,false,off,unsafe,no`
  - Example (unsafe):
    ```bash
    mosquitto_pub -h localhost -t "alpaca/safetymonitor/default/safe/set" -m "unsafe"
    ```

Retained command handling:
- If `IGNORE_RETAINED_SET=true` (default), retained command messages are ignored on receipt.

### UDP Discovery
Listens on `ASCOM_DISCOVERY_PORT` (default `32227`) and responds to ASCII `alpacadiscovery1` with JSON:
```json
{"AlpacaPort": 11111}
```
Response is sent to the sender and broadcast to `255.255.255.255`.

### Typical Workflows
1) Start the simulator
```bash
node server.js
```

2) Verify status
```bash
curl http://localhost:11111/status
```

3) Toggle safety via REST
```bash
curl -X POST "http://localhost:11111/control/safe?value=safe"
```

4) Toggle safety via MQTT
```bash
mosquitto_pub -h localhost -t "alpaca/safetymonitor/default/safe/set" -m "unsafe"
```

5) Use with an Alpaca client
- Point your client to the host and port; discovery should find it automatically if the network allows UDP broadcast.
- Polling `issafe` will update the MQTT client mirror topics.

### Versioning
Exposed simulator version: see `state.js` `VERSION` (currently `0.5.0`). Published to MQTT at `{base}/version` and returned by `/driverversion` and `/status`.

### Troubleshooting
- No MQTT messages: verify `MQTT_URL`, broker reachable, and credentials.
- Health check failing: `/healthz` returns 503 until MQTT is connected.
- Discovery not working: ensure UDP broadcast allowed on your network; port `32227` open.
- Alpaca client cannot connect: confirm `ALPACA_PORT` and firewall rules.
- Retained commands causing unexpected state: set `IGNORE_RETAINED_SET=true` (default) or clear retained messages on `{base}/safe/set`.

### License
ISC


