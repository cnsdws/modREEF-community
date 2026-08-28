# GHome WP12 Device Profile

## Status

Experimental

## Documented Identity

- Brand: GHome
- Manufacturer: Shenzhen Cuco Smart Technology Co., Ltd.
- Model: WP12
- Device class: Smart power strip

## Documented Capabilities

- 6 individually controllable AC outlets
- 2 USB-A ports
- 1 USB-C port
- USB-C output up to 20 W
- Maximum load: 15 A / 1800 W
- 2.4 GHz Wi-Fi
- Bluetooth-assisted provisioning
- App-based scheduling and timers
- Group control
- Energy monitoring

## Discovery Evidence

Not yet conclusively identified on the LAN.

Several devices advertise `_matter._tcp`, but none has been proven to be the WP12.

## Unknowns

- LAN IP address
- MAC address and OUI
- Matter support
- Tuya protocol support
- Local control availability
- Cloud dependency
- Open ports
- Per-outlet versus whole-strip telemetry
- Local scheduling
- Offline behavior
- Firmware version
- Command latency

## Qualification Plan

1. Capture network scan with the strip online.
2. Unplug the strip.
3. Capture another scan.
4. Identify the disappearing IP/MAC.
5. Reconnect and confirm the same address returns.
6. Inspect mDNS, Matter, SSDP, ports, and Tuya evidence.
7. Test outlet control and telemetry.
8. Test Internet loss and reboot recovery.

## Current Qualification

- Status: Experimental
- Confidence: 0.85
- Supported driver: `@modreef/driver-ghome-wp12`
- Multiple strips: Each physical device has independent credentials, driver
  state, and device-scoped outlet identifiers. The original installed strip
  retains its legacy identifiers during migration.

## Verified Network Evidence

- Confirmed IP: 10.0.0.224
- Confirmed MAC: 30:48:7d:d1:fc:88
- TCP port 6668 open
- No other common TCP services detected
- Service fingerprint unresolved by nmap
- Evidence strongly suggests Tuya LAN protocol

## Current Protocol Assessment

- ARP: Confirmed
- mDNS: Not confirmed
- SSDP: Not confirmed
- Matter: Not confirmed
- Bluetooth: Used for provisioning
- Tuya LAN: Strongly indicated by TCP 6668

## Confirmed Tuya Identity

- Device name: modREEFO1
- Tuya product name: WP12_T1
- Tuya product ID: iwmmfr8umokrphak
- Tuya protocol version: 3.5
- Local IP: 10.0.0.224
- Local control port: TCP 6668
- Local key retrieved and stored outside source control
- Identity confidence: High

## Confirmed Control Path

The modREEF iOS app uses Tuya's official iOS SDK to create an anonymous,
app-scoped account and home, provision the owner-authorized device over BLE,
and transfer its local credential directly to the paired Edge. The user does
not need the Smart Life or GHome application and does not handle a local key.

Normal modREEF operation should use direct Tuya LAN communication and must not depend on cloud availability.

## Integration provenance and legal basis

- Protocol behavior and DPS mappings were independently observed on
  owner-authorized WP12 hardware and are recorded in this profile.
- Provisioning uses the official Tuya iOS SDK under its applicable SDK terms.
  It creates an anonymous app-scoped account and requires Tuya cloud only
  during initial provisioning. The resulting local credential is stored with
  owner-only filesystem permissions on the Edge.
- Runtime communication uses the documented public interface of the
  open-source TinyTuya dependency; modREEF contains no copied competitor code,
  assets, documentation, or interface designs.
- GHome and Tuya names are used only to describe compatibility. modREEF is not
  affiliated with or endorsed by either company.
- The integration remains experimental and requires project review before
  inclusion in an official stable distribution.

## Verified Tuya DPS Mapping

- DPS 1: AC outlet 1
- DPS 2: AC outlet 2
- DPS 3: AC outlet 3
- DPS 4: AC outlet 4
- DPS 5: AC outlet 5
- DPS 6: AC outlet 6
- DPS 7: USB power group
- DPS 20: Line voltage, scaled by 10

## Unresolved DPS

- DPS 9–15
- DPS 18
- DPS 19
- DPS 38
- DPS 40–44
