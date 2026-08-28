# Jebao/Jecod MDP integration record

Status: experimental; physical MDP-8500 verification in progress.

## Source and legal basis

This integration implements local interoperability with modREEF-owned hardware.
The protocol behavior was verified through controlled network observations and
bench tests. No Jebao application code, credentials, tokens, product secrets,
assets, or interface designs are included.

The authentication and framing review also used `python-jebao` 0.1.7 by Justin
Rigling, published under the MIT License:

- <https://pypi.org/project/python-jebao/>
- <https://github.com/jrigling/python-jebao>

The upstream project credits packet-capture analysis of the official Jebao app
and an earlier MIT-licensed GizWits implementation. The modREEF implementation
is a native TypeScript transport with stricter acknowledgement and observed-state
confirmation. The upstream library is not bundled as a runtime dependency.

The Jebao and Jecod names are used only to describe device compatibility.
modREEF is not affiliated with or endorsed by Jebao/Jecod or GizWits.

## Physically verified on MDP-8500

- UDP discovery on port 12414.
- TCP transport on port 12416.
- Device-issued passcode request (`0x06`) and response (`0x07`).
- Login request (`0x08`) and acceptance (`0x09`).
- The passcode is requested for every new connection, used only in memory, and
  neither displayed nor persisted.
- Status read, power on/off, and a reversible speed change from 30% to 35%.
- The production capability range is constrained to the upstream-documented
  30 through 100%; the full range has not been traversed on the test pump.
- Control acknowledgement followed by observed-state confirmation.
- Extended status frames with 129 trailing padding bytes.
- Stable recovery to the original state after a reversible bench test.

## Compatibility claims

- MDP-8500: power, speed, status, discovery, and authentication physically
  verified by modREEF.
- MDP-20000: supported by the reviewed upstream implementation; modREEF hardware
  verification remains pending.
- Other MDP models: no compatibility claim until physically verified.

## Excluded from the first release

- Official-app credential capture or impersonation.
- Temporary access-point traffic interception.
- SoftAP network provisioning.
- Feed mode and internal Program mode control.
- Firmware updates.
- Speeds below 30%.

These capabilities require separate protocol evidence, tests, and a deliberate
product decision before distribution.

## Smart Wi-Fi provisioning

The Edge can provision a factory-reset pump without the Jebao app using the
ESP-Touch/AirLink packet-length protocol. The Edge must itself be connected to
the target 2.4 GHz Wi-Fi network so it can obtain that access point's BSSID and
transmit on the correct interface. The mobile app sends the SSID and password
to the Edge over the authorized local onboarding channel. The Edge keeps the
password only for the duration of the provisioning job, waits for a newly
discovered pump, performs the native ephemeral passcode handshake, and then
registers it for local control.

This complete path was physically verified with an MDP-8500 on August 2, 2026:
AirLink provisioning, LAN discovery, ephemeral authentication, state read, and
durable Edge registration all completed without the vendor app.
