# Alpaca SafetyMonitor Bridge

A lightweight ASCOM Alpaca SafetyMonitor server built with Node.js + Express.
It bridges between local sensors (rain, cloud, IR, etc.) or external MQTT inputs and Alpaca-enabled astronomy software like N.I.N.A.

 Runs as a simple Node.js app or in a Docker container.
 Includes a built-in Web UI for configuration, status, logs, and debugging.
 Publishes MQTT topics so you can integrate with Home Assistant, ESP32, or other IoT sources.

---

## ✨ Features

- Fully ASCOM Alpaca SafetyMonitor compliant
- Web UI (config, logs, testing)
- MQTT integration (publish state, accept commands)
- Config persistence via `config.json`
- `/status` & `/healthz` endpoints
- Alpaca Discovery (UDP broadcast on port `32227`)
- Multi-arch Docker images (`amd64`, `arm64`, `armv7`)

---

## 🚀 Quick Start

### Run with Node.js

```bash
git clone https://github.com/brendlij/alpaca-safetymonitor-bridge
cd alpaca-safetymonitor-bridge

# install dependencies
npm ci

# optional: minimal .env
cat > .env <<'EOF'
ALPACA_PORT=11111
ASCOM_DISCOVERY_PORT=32227
CONFIG_PATH=./data/config.json
EOF

# start server
node server.js
```

Open http://localhost:11111 for the Web UI.

### Run with Docker

#### Prebuilt images (GHCR)
Images are published automatically via GitHub Actions:

```bash
docker pull ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

#### Run with Docker CLI

```bash
docker run -d --name safemonitor \
  -p 11111:11111/tcp \
  -p 32227:32227/udp \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

#### Run with Docker Compose

```yaml
services:
  safemonitor:
    image: ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
    container_name: safemonitor
    restart: unless-stopped
    environment:
      - ALPACA_PORT=11111
      - ASCOM_DISCOVERY_PORT=32227
      - CONFIG_PATH=/app/data/config.json
    volumes:
      - ./data:/app/data
    ports:
      - "11111:11111/tcp"
      - "32227:32227/udp"
```

Start with:

```bash
docker compose up -d
```

---

## ⚙️ Configuration

### .env (Node) or environment (Docker)

| Variable               | Default                 | Purpose                               |
|------------------------|-------------------------|---------------------------------------|
| `ALPACA_PORT`          | `11111`                 | HTTP port (UI + Alpaca API)           |
| `ASCOM_DISCOVERY_PORT` | `32227`                 | UDP discovery port                    |
| `CONFIG_PATH`          | `./config.json`         | Path to runtime config file           |
| `DEFAULT_SAFE`         | `true`                  | Initial safe/unsafe state             |
| `DEVICE_NAME`          | `default`               | Device name used in MQTT topics       |
| `MQTT_URL`             | `mqtt://localhost:1883` | MQTT broker URL                       |
| `MQTT_USER`            |                         | MQTT username (optional)              |
| `MQTT_PASS`            |                         | MQTT password (optional)              |
| `IGNORE_RETAINED_SET`  | `true`                  | Ignore retained MQTT set commands     |
| `HEARTBEAT_SEC`        | `30`                    | MQTT heartbeat interval (seconds)     |

Minimal example `.env`:

```env
DEVICE_NAME=observatory
MQTT_URL=mqtt://localhost:1883
```

### Runtime `config.json` (managed via Web UI)

Example `data/config.json`:

```json
{
  "deviceName": "observatory",
  "mqttUrl": "mqtt://broker:1883",
  "mqttUser": "user",
  "mqttPass": "pass",
  "topicBase": "alpaca/safetymonitor/observatory",
  "enableMqtt": true,
  "enableRestControl": true
}
```

The Web UI lets you edit this live.

---

## 🔌 Endpoints

### Alpaca (for ASCOM/NINA/etc.)

- `/management/v1/description`
- `/management/v1/configureddevices`
- `/management/apiversions`
- `/api/v1/safetymonitor/0/issafe`

### REST Control

- `POST /control/safe?value=true|false|safe|unsafe|1|0`
- `POST /control/health?value=ok|degraded|error`

### Monitoring

- `GET /status` → JSON with all states
- `GET /healthz` → 200 OK if server + MQTT alive

### Web UI

- http://<host>:11111/

---

## 📡 MQTT Topics

Assume deviceName=observatory → topicBase = alpaca/safetymonitor/observatory

### State

- `.../safe/state` → `safe / unsafe`
- `.../last_change`, `.../reason`, `.../source`, `.../health`, `.../online`, `.../heartbeat`, `.../uptime`

### Control

- `.../safe/set` → accepts `safe`, `unsafe`, `1`, `0`, etc.

### Client (Alpaca consumer like NINA)

- `.../clients/alpaca/connected` (`true/false`)
- `.../clients/alpaca/lastseen` (timestamp)

---

## 🐳 GitHub Container Registry

Images are built & pushed automatically on every main push and version tag (`v*`):

```bash
ghcr.io/brendlij/alpaca-safetymonitor-bridge
```

Supported platforms:

- linux/amd64
- linux/arm64
- linux/arm/v7

---

## 🙌 Credits

ASCOM Alpaca spec → https://ascom-standards.org
