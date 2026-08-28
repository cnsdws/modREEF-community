#  # modREEF Edge Architecture

**Version:** 1.0  
**Status:** Draft

---

# Purpose

modREEF Edge is the always-on local runtime for the modREEF platform.

Its purpose is to provide deterministic, reliable, local control of aquarium equipment without requiring cloud connectivity.

The mobile app is the user interface.

The Edge runtime is the controller.

Cloud services are optional.

---

# System Architecture

```
             modREEF Cloud (Optional)
        AI • Backup • Sync • Analytics
                    ▲
                    │
             Secure HTTPS
                    │
                    ▼
             modREEF Mobile
 Dashboard • Setup • Reef Coach
 Notifications • Configuration
                    │
          REST / WebSocket
                    │
                    ▼
              modREEF Edge
────────────────────────────────────
REST API
WebSocket API
Equipment Manager
Scheduler
Event Engine
Driver Manager
Digital Twin
SQLite Database
────────────────────────────────────
                    │
            Hardware Drivers
                    │
                    ▼
 Smart Strips • Pumps • Lights
 Heaters • Sensors • ATO
```

---

# Responsibilities

## Mobile

Responsible for:

- Dashboard
- Notifications
- Configuration
- Chemistry entry
- Device setup
- Reef Coach
- Remote access

Not responsible for:

- Automation
- Scheduling
- Device polling
- Safety logic

---

## Edge

Responsible for:

- Driver execution
- Device discovery
- Equipment Manager
- Scheduler
- Event Engine
- Digital Twin
- Local database
- Safety interlocks
- Local automation
- Feed Mode
- Maintenance Mode

Edge operates continuously.

---

## Cloud

Optional.

Provides:

- Backup
- Synchronization
- Fleet analytics
- AI improvements
- Community device profiles
- Community automations

Cloud failure must never stop the aquarium.

---

# Core Services

## Driver Manager

Loads hardware drivers.

Examples:

- Tuya
- Matter
- Shelly
- Kasa
- Ecotech
- AI
- Jebao

Drivers expose capabilities.

Never vendor-specific UI.

---

## Equipment Manager

Maps logical equipment to hardware.

Example

```
Return Pump

↓

GHome Smart Strip

↓

Outlet 1
```

UI never references outlets.

---

## Scheduler

Executes:

- Feed Mode
- Lighting
- Dosing
- Maintenance
- Timers

Schedules are deterministic.

---

## Event Engine

Processes:

- Equipment failures
- State changes
- Sensor changes
- User commands
- Scheduled events

Example:

Return Pump OFF

↓

Skimmer OFF

↓

ATO OFF

↓

Notify User

---

## Digital Twin

Source of truth.

Contains:

- Aquarium
- Equipment
- Measurements
- Livestock
- Maintenance
- Automation
- Recommendations

---

# Communication

Mobile ↔ Edge

REST

Configuration

WebSocket

Live updates.

Future:

MQTT supported if beneficial.

---

# Local Database

SQLite initially.

Stores:

- Equipment
- Measurements
- Events
- Schedules
- Recommendations
- Device bindings

Future database migration should be transparent.

---

# Security

Local authentication.

Encrypted remote access.

No cloud dependency for local operation.

Secrets never stored in source code.

---

# Plugin Model

Every hardware integration is a driver.

Every driver implements the HAL.

Drivers may be installed independently.

---

# Deployment Targets

Supported:

- Raspberry Pi 4+
- Home Assistant host
- Docker
- Linux
- Windows
- macOS
- NAS

Reference platform:

Raspberry Pi 4 (4 GB)

---

# Design Rules

Edge owns automation.

Mobile owns interaction.

Cloud enhances.

Never reverse those responsibilities.

---

# Future

Future Edge services may include:

- Vision processing
- Camera support
- Local AI inference
- Voice interface
- Automatic backup
- Distributed Edge clustering

These are enhancements.

The core runtime remains lightweight, deterministic, and reliable.

                    Edge
                     │
             Discovery Engine
                     │
        ┌────────────┴────────────┐
        │                         │
      ARP                      mDNS
        │                         │
        └────────────┬────────────┘
                     │
              Device Identity
                     │
              Device Knowledge
                     │
             Qualification
                     │
             Protocol Manager
        ┌────────────┴────────────┐
        │                         │
      Tuya                    Matter
        │                         │
        └────────────┬────────────┘
                     │
                Device Driver
                     │
                  Equipment
                     │
               Digital Twin
                     │
                Automation AI