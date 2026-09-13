# YINMIK Water 7-in-1 integration

Status: verified on the Tuya-based YINMIK Water 7-in-1 / WIFI-3188.

This package owns product identity, the local Tuya protocol fallback, DPS-to-
water-measurement translation, probe calibration, rolling filtering, history,
driver state, and the integration manifest. The Reef Controller reads the meter
over the local network after mobile Bluetooth/Wi-Fi onboarding.

See `docs/device-profiles/YINMIK-Water-7-in-1.md` for the supported data points,
evidence, limitations, and physical regression checklist.
