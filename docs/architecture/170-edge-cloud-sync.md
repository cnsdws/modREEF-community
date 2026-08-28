# Edge cloud synchronization

The Edge initiates an HTTPS exchange with the cloud every two seconds. No inbound port, port forwarding, or fixed home IP is required. Each exchange uploads current equipment state, ordered aquarium events, and command results, then receives up to 50 queued commands. After executing a command, the Edge immediately performs a follow-up exchange so the confirmed hardware state and command result do not wait for the next interval.

Cloud synchronization is disabled unless all settings are present:

```text
MODREEF_CLOUD_URL=https://api.modreef.net
MODREEF_EDGE_ID=<cloud Edge UUID>
MODREEF_AQUARIUM_ID=<cloud aquarium UUID>
MODREEF_EDGE_TOKEN=<random device token>
```

The cloud stores only the lowercase SHA-256 hash of the device token. When an aquarium has no registered Edge, the cloud dashboard registers one and displays a one-time systemd provisioning block. Running that block on the Pi installs the four settings in a service drop-in and restarts the Edge runtime.

## Offline behavior

Local schedules, safety logic, LAN control, and device drivers do not depend on cloud availability. Failed exchanges are logged and retried. The SQLite sync state preserves the event cursor, monotonically increasing event sequence, unsent batch, and unacknowledged command results across service restarts.

Only `equipment.set-control-mode` and the backward-compatible `equipment.set-power` command are remotely executable in this prototype. The control-mode command supports persistent Off and On overrides and restoring Auto operation. Unsupported commands are rejected and reported as failed. Dosing commands are intentionally excluded until their restart/crash safety semantics are explicitly designed.

The cloud/API infrastructure is not deployed yet. With the environment variables absent, this code opens no cloud connection and changes no current Edge behavior.
