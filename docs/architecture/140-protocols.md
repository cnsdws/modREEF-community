# Protocol Architecture

## Purpose

Protocols provide transport-specific communication with physical devices.

Protocols do not know device semantics.

Examples include:

- Tuya LAN
- Matter
- Bluetooth LE
- SSDP
- HTTP
- MQTT

## Responsibilities

A protocol implementation can:

- Discover protocol endpoints
- Establish communication
- Exchange protocol messages
- Report protocol capabilities
- Report communication errors
- Measure latency

A protocol implementation cannot:

- Determine device identity
- Decide equipment type
- Apply reef-specific behavior

## Architecture

Discovery
    ↓
Identity
    ↓
Knowledge
    ↓
Qualification
    ↓
Protocol
    ↓
Driver
    ↓
Equipment

## Multiple Protocols

A single device may support multiple protocols.

Example:

GHome WP12

- Tuya LAN
- Matter
- Bluetooth provisioning

Drivers choose the preferred protocol based on capability,
performance, and qualification.

## Design Goals

- Stateless where practical
- Transport-specific
- Unit-testable
- Vendor-independent
- Reusable across multiple device families
