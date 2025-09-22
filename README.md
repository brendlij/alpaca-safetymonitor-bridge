# Alpaca SafetyMonitor Bridge

A lightweight ASCOM Alpaca SafetyMonitor server built with Node.js + Express.
It bridges between local sensors (rain, cloud, IR, etc.) or external MQTT inputs and Alpaca-enabled astronomy software like N.I.N.A.

✅ Runs as a simple Node.js app or in a Docker container.  
✅ Includes a built-in Web UI for configuration, status, logs, and debugging.  
✅ Publishes MQTT topics so you can integrate with Home Assistant, ESP32, or other IoT sources.  
✅ Proper Docker volume handling with persistent configuration.

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

#### Linux / macOS / Git Bash / WSL

```bash
git clone https://github.com/brendlij/alpaca-safetymonitor-bridge
cd alpaca-safetymonitor-bridge

npm ci

printf "ALPACA_PORT=11111\nASCOM_DISCOVERY_PORT=32227\nCONFIG_PATH=./data/config.json\n" > .env

node server.js
```

Web UI accesable at:

```bash
http://localhost:11111
```

### Run with Docker (Recommended)

#### Option 1: Docker Compose (Easiest)

```bash
git clone https://github.com/brendlij/alpaca-safetymonitor-bridge
cd alpaca-safetymonitor-bridge

# Setup data directories (Windows)
setup.bat

# Or for Linux/Mac
chmod +x setup.sh
./setup.sh

# Start the service
docker-compose up -d
```

#### Option 2: Prebuilt images (GHCR)

Images are published automatically via GitHub Actions:

```bash
docker pull ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest

# Create data directory first
mkdir -p ./data

# Run with proper volume mounting
docker run -d \
  --name alpaca-safetymonitor \
  -p 8080:8080 \
  -p 32227:32227/udp \
  -v $(pwd)/data:/app/data:rw \
  -e WEB_PORT=8080 \
  -e DEVICE_NAME=my-safety-monitor \
  -e MQTT_URL=mqtt://your-mqtt-broker:1883 \
  --restart unless-stopped \
  ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

#### Windows Powershell

```bash
git clone https://github.com/brendlij/alpaca-safetymonitor-bridge
cd alpaca-safetymonitor-bridge

npm ci

@"
ALPACA_PORT=11111
ASCOM_DISCOVERY_PORT=32227
CONFIG_PATH=./data/config.json
"@ | Out-File -FilePath .env -Encoding utf8 -NoNewline

node server.js
```

---

## ⚙️ Configuration

The web interface port and other settings can be configured via environment variables:

### Environment Variables

| Variable               | Default                 | Description                               |
| ---------------------- | ----------------------- | ----------------------------------------- |
| `WEB_PORT`             | `8085`                  | Port for the web interface and Alpaca API |
| `ASCOM_DISCOVERY_PORT` | `32227`                 | UDP port for ASCOM device discovery       |
| `DEVICE_NAME`          | `default`               | Name of the safety monitor device         |
| `MQTT_URL`             | `mqtt://localhost:1883` | MQTT broker connection URL                |
| `MQTT_USER`            | _(empty)_               | MQTT username (optional)                  |
| `MQTT_PASS`            | _(empty)_               | MQTT password (optional)                  |
| `DEFAULT_SAFE`         | `false`                 | Default safety state on startup           |
| `CONFIG_PATH`          | `/app/data/config.json` | Path to configuration file                |

### Example Configurations

**Custom Port (11111 for ASCOM compatibility):**

```bash
# Docker Compose
echo "WEB_PORT=11111" > .env
docker-compose up -d

# Direct Docker
docker run -d -p 11111:11111 -e WEB_PORT=11111 ghcr.io/brendlij/alpaca-safetymonitor-bridge
```

**Custom MQTT Broker:**

```bash
docker run -d \
  -p 11111:11111 \
  -e MQTT_URL=mqtt://192.168.1.100:1883 \
  -e MQTT_USER=myuser \
  -e MQTT_PASS=mypassword \
  ghcr.io/brendlij/alpaca-safetymonitor-bridge
```

---

#### Windows CMD

```bash
it clone https://github.com/brendlij/alpaca-safetymonitor-bridge
cd alpaca-safetymonitor-bridge

npm ci

(
echo ALPACA_PORT=11111
echo ASCOM_DISCOVERY_PORT=32227
echo CONFIG_PATH=./data/config.json
) > .env

node server.js
```

## Run with Docker CLI

### Linux / macOS (bash/zsh)

```bash
docker run -d --name safemonitor \
  -p 11111:11111/tcp \
  -p 32227:32227/udp \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

### Windows CMD

```bash
docker run -d --name safemonitor ^
  -p 11111:11111/tcp ^
  -p 32227:32227/udp ^
  -v "%cd%\data:/app/data" ^
  ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

### Windows PowerShell

```bash
docker run -d --name safemonitor `
  -p 11111:11111/tcp `
  -p 32227:32227/udp `
  -v "${PWD}\data:/app/data" `
  ghcr.io/brendlij/alpaca-safetymonitor-bridge:latest
```

## Run with Docker Compose

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

| Variable               | Default                 | Purpose                           |
| ---------------------- | ----------------------- | --------------------------------- |
| `ALPACA_PORT`          | `11111`                 | HTTP port (UI + Alpaca API)       |
| `ASCOM_DISCOVERY_PORT` | `32227`                 | UDP discovery port                |
| `CONFIG_PATH`          | `./data/config.json`    | Path to runtime config file       |
| `DEFAULT_SAFE`         | `true`                  | Initial safe/unsafe state         |
| `DEVICE_NAME`          | `default`               | Device name used in MQTT topics   |
| `MQTT_URL`             | `mqtt://localhost:1883` | MQTT broker URL                   |
| `MQTT_USER`            |                         | MQTT username (optional)          |
| `MQTT_PASS`            |                         | MQTT password (optional)          |
| `IGNORE_RETAINED_SET`  | `true`                  | Ignore retained MQTT set commands |
| `HEARTBEAT_SEC`        | `30`                    | MQTT heartbeat interval (seconds) |

Minimal example `.env`:

```env
ALPACA_PORT=11111
ASCOM_DISCOVERY_PORT=32227
CONFIG_PATH=./data/config.json
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
