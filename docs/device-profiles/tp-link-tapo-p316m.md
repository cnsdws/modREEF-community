# TP-Link Tapo P316M compatibility profile

Status: local integration under development; review required before official distribution.

modREEF integrates this device through the open Matter protocol. It does not use copied vendor code, private APIs, vendor assets, or a reproduction of the Tapo interface.

## Supported surface

- One Matter device with six independently controlled AC outlet endpoints.
- Local on/off control through the modREEF Edge controller.
- Persistent Matter fabric credentials under the Edge data directory.
- The three USB ports are intentionally not shown as controllable outlets because TP-Link documents them as always on.
- Per-outlet active power is read from Matter Electrical Power Measurement (`0x0090`) when advertised by the endpoint and converted from mW to W.
- Per-outlet cumulative imported energy is read from Matter Electrical Energy Measurement (`0x0091`) when advertised by the endpoint and converted from mWh to kWh.
- Endpoints that do not advertise these standard clusters omit telemetry. No undocumented data points are assumed.

## Pairing and recovery notes

- A factory-fresh or factory-reset device can be commissioned directly by the
  modREEF Edge over Bluetooth LE. The mobile app sends the printed Matter setup
  code and Wi-Fi credentials to the already-paired Edge; credentials are used
  for commissioning and are not persisted by modREEF.
- Hardware observation on 2026-07-28 found that an unprovisioned P316M advertises
  TP-Link service UUID `8641`, while its standard Matter GATT service `FFF6` is
  visible only after a BLE connection is established. The mobile app therefore
  recognizes `8641` as a setup-code device and supplies the observed BLE address
  to the Edge. The Edge still performs authenticated Matter PASE commissioning;
  it does not use the proprietary TP-Link provisioning characteristics.
- The unique Matter QR code or numeric setup code is printed on the device or its packaging. The QR codes in the general quick-start guide lead to the Tapo app and TP-Link support; they are not device credentials.
- The system LED blinks white three times when the strip enters Matter pairing mode.
- Matter setup mode closes 15 minutes after the device is powered. Power-cycle the strip to reopen it.
- Holding an individual outlet button for about 5 seconds resets Wi-Fi while retaining other settings. Holding it for about 10 seconds restores factory defaults.
- An original Matter code can be used for the first ecosystem only. A device already commissioned elsewhere must expose a new code from its current Matter administrator, or be factory-reset before the original code is reused.

## Electrical constraints

- Overall rating: 125 V, 15 A maximum general/resistive load.
- Manufacturer-listed heater limit: 15 A / 1800 W.
- Manufacturer-listed water-pump limit: 1.4 A / 120 W / 1/6 HP.
- Outlet configuration must never imply that the controller can override the strip's electrical ratings or safety requirements.

## Source and legal basis

- Device capabilities: [TP-Link P316M product page](https://www.tp-link.com/us/home-networking/smart-plug/tapo-p316m/).
- Commissioning behavior: [TP-Link Matter setup guide](https://www.tp-link.com/us/document/127673/).
- Ecosystem and endpoint limitations: [TP-Link Matter feature FAQ](https://www.tp-link.com/us/support/faq/3777/).
- Pairing indicators, reset behavior, and electrical limits: manufacturer quick-start guide supplied with the user's device (document reviewed 2026-07-27; not redistributed).
- Protocol implementation: [matter.js](https://github.com/matter-js/matter.js), Apache-2.0 licensed.
- Device-specific BLE behavior: independently observed from a user-owned P316M
  using BlueZ service enumeration on 2026-07-28. No decompiled vendor code was
  used. The local compatibility patch to matter.js is maintained in
  `patches/@matter__nodejs-ble@0.17.6.patch` under the upstream Apache-2.0 terms.
- Legal basis: user-authorized interoperability through the published Matter
  standard, independently observed device behavior, and an Apache-2.0
  controller implementation. Review remains required before official distribution.

TP-Link and Tapo are trademarks of their respective owner. modREEF is not affiliated with, endorsed by, or sponsored by TP-Link.
