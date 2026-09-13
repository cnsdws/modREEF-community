# Matter outlet integration

Status: community-tested with Matter outlets and multi-endpoint power strips,
including the TP-Link Tapo P316M.

This package owns the Matter fabric controller, BLE/Wi-Fi commissioning,
commissioning recovery, node deletion, endpoint discovery, confirmed relay
commands, electrical telemetry, driver state, aquarium equipment mapping, and
the integration manifest. The Reef Controller supplies only the persistent
storage path for its Matter fabric.

See `docs/device-profiles/Matter-Outlets.md` for scope, security ownership,
compatibility behavior, and the physical regression checklist.
