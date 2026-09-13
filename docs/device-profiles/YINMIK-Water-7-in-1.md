# YINMIK Water 7-in-1 device profile

## Status

Verified on the Tuya-based YINMIK Water 7-in-1 / WIFI-3188 water meter.

## Identity and transport

- Manufacturer: YINMIK
- Models: Water 7-in-1, WIFI-3188
- Tuya product ID: `u5xgcpcngk3pfxb4`
- Onboarding: native Tuya Bluetooth-to-Wi-Fi provisioning
- Runtime: local Tuya Wi-Fi; protocol versions 3.4, 3.5, and 3.3 are probed in
  that bounded order when the saved version no longer responds
- Normal runtime does not require the Tuya cloud or vendor application

## Supported measurements

| Tuya DPS | Source value | modREEF result |
| --- | --- | --- |
| 2 | Temperature in tenths of a degree Celsius | Temperature in degrees Fahrenheit |
| 10 | pH in hundredths | pH |
| 11 | Conductivity in thousandths of mS/cm | Practical salinity in ppt using PSS-78 |
| 12 | ORP in mV | ORP in mV |

TDS, humidity, and CF values are intentionally not exposed. They are not used
by modREEF water-quality control or recommendations.

## Measurement handling

The Reef Controller samples at most once every five seconds, retains one minute
of raw samples, rejects outliers with a trimmed rolling mean, and stores chart
history at five-minute intervals for the most recent 24 hours. Calibration is
applied after filtering so original readings remain available:

- temperature: offset;
- pH: two- or three-point linear calibration;
- ORP: offset against a 256 or 400 mV reference solution;
- salinity: scale against a trusted reference measurement.

## Integration provenance and legal basis

The DPS mapping and protocol behavior were independently observed on
owner-authorized hardware using controlled local-network tests. The package
contains independently written translation, recovery, filtering, and
calibration code. It contains no vendor application code, credentials, SDK
binary, or unredacted user capture.

YINMIK and Tuya names are used only to describe compatibility. modREEF is not
affiliated with or endorsed by either company.

## Physical regression checklist

1. Discover an unowned meter during Bluetooth onboarding and pass Wi-Fi
   credentials.
2. Confirm the exact Tuya product ID before registration.
3. Confirm one physical device and one locked water-quality sensor are created.
4. Verify temperature, pH, ORP, and salinity reach the correct aquarium.
5. Compare raw values with the meter display and verify unit conversions.
6. Exercise each supported calibration and confirm raw readings are preserved.
7. Remove network access and confirm the sensor becomes offline.
8. Restore access, including after an IP-address change, and confirm recovery
   without repairing.
9. Delete the device and confirm its credentials, sensor, and onboarding record
   are removed together.
