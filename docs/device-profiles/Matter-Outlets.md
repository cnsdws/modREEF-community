# Matter outlet and power-strip device profile

## Status

Community-tested with Matter On/Off Plug-in Units and multi-endpoint power
strips, including the TP-Link Tapo P316M. Matter certification does not imply
that every vendor exposes the same optional electrical telemetry clusters.

## Identity and transport

- Protocol: Matter over the device's supported operational network
- Commissioning: manual 11-digit setup code or `MT:` QR payload
- Initial transport: Bluetooth LE when Wi-Fi credentials must be delivered
- Runtime control: local Matter fabric owned by the Reef Controller
- Device identity: commissioned Matter node ID, stored as `matter-<node-id>`
- Channels: endpoints exposing the standard On/Off cluster (`0x0006`)

The integration reads Basic Information attributes for manufacturer, product,
node label, firmware version, and serial number when the device provides them.

## Supported capabilities

- Confirmed outlet on/off commands
- Current relay state from the On/Off cluster
- Active power when Electrical Power Measurement (`0x0090`) is exposed
- Cumulative imported energy when Electrical Energy Measurement (`0x0091`) is
  exposed
- Multi-endpoint strips, with one modREEF equipment item per controllable
  endpoint
- Verified fabric removal before a device record is deleted

Matter active power is converted from milliwatts to watts. Imported energy is
converted from milliwatt-hours to kilowatt-hours.

## Fabric ownership and security

The Reef Controller maintains its own Matter fabric under its persistent data
directory. Fabric credentials and commissioned-node state remain on the Edge;
they are not embedded in the repository or device profile. Commissioning and
removal are serialized so two fabric mutations cannot overlap. A recoverable
Bluetooth or operational handoff failure receives one bounded retry.

Deleting a Matter device first removes the node from the controller's fabric.
modREEF refuses to report successful deletion if the node remains commissioned.

## Compatibility behavior

Some Tapo P316M firmware advertises a vendor setup service instead of the
standard Matter commissioning service. The QR payload's vendor ID `5010` and
product ID `274` activate a narrowly scoped BLE compatibility scan. Normal
Matter commissioning and operational control remain standards-based.

## Integration provenance

The implementation uses the open-source Matter.js libraries and public Matter
cluster semantics. It contains no vendor application code, private keys,
commissioning payloads, SDK binary, or user fabric data. Manufacturer names are
used only to describe compatibility; modREEF is not endorsed by those vendors.

## Physical regression checklist

1. Commission with an 11-digit code and an `MT:` QR payload on separate resets.
2. Confirm manufacturer/model metadata and every controllable endpoint.
3. Turn each endpoint on and off and verify the reported state after the command.
4. Confirm optional power and energy values only appear on endpoints that expose
   the corresponding clusters.
5. Restart Edge and verify the existing fabric reconnects without repairing.
6. Interrupt the BLE-to-operational handoff and verify only one recovery attempt.
7. Remove network access and verify the device becomes unavailable without
   blocking other equipment.
8. Restore access and verify control recovers.
9. Delete the device and verify both the fabric node and all endpoint equipment
   are removed.
