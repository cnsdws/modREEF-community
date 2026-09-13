# Device support matrix

Support levels describe reproduced evidence, not general compatibility with a
manufacturer's product line. Firmware or hardware changes may require renewed
qualification. Never use an experimental integration as the only safeguard for
life-support equipment.

| Integration | Tested models | Transport | Onboarding | Declared level |
| --- | --- | --- | --- | --- |
| Jebao/Jecod MDP return pump | MDP-8500, MDP-20000 | Local Wi-Fi | LAN discovery or manual address | Verified |
| Jebao/Jecod MD-4.4 doser | MD-4.4 | Bluetooth provisioning, local Wi-Fi | Bluetooth plus Wi-Fi credentials | Verified |
| Jebao/Jecod DMP wavemaker | DMP-40 | Bluetooth LE | Direct Bluetooth control | Verified |
| YINMIK Water 7-in-1 | Water 7-in-1, WIFI-3188 | Bluetooth provisioning, Tuya local Wi-Fi | Bluetooth plus Wi-Fi credentials | Verified |
| GHome WP12 power strip | WP12 | Bluetooth provisioning, Tuya local Wi-Fi | Bluetooth plus Wi-Fi credentials | Community-tested |
| Matter outlets and strips | Matter On/Off Plug-in Unit and multi-endpoint strips | Matter | Matter setup code | Community-tested |

Definitions and evidence requirements are in
[`docs/qualification/DEVICE_QUALIFICATION.md`](qualification/DEVICE_QUALIFICATION.md).
Each integration's device profile records its known constraints and acceptance
procedure.

## Platform support

| Component | Supported baseline | Notes |
| --- | --- | --- |
| Reef Controller | Raspberry Pi 4 or 5, 64-bit Raspberry Pi OS Lite | Community image uses Raspberry Pi Imager customization for first-boot user, Wi-Fi, and SSH settings. |
| iPhone/iPad | Expo native application | Some onboarding transports require native modules and cannot run in a browser. |
| Android | Expo native application | Hardware acceptance remains required across representative Android vendors. |
| Web | Current evergreen browsers | Cloud-connected management; Bluetooth and LAN-only administration remain native-client functions. |
