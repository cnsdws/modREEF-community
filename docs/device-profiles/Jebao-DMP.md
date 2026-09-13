# Jebao/Jecod DMP wavemaker device profile

## Status

Verified on DMP-40. The DMP-40M Wi-Fi model is not included in this claim.

## Identity

- Manufacturer: Jebao / Jecod
- Tested model: DMP-40
- Transport: Bluetooth Low Energy
- Pairing names: `W_` followed by six hexadecimal characters, or legacy
  `XPG-GAgent-` followed by four hexadecimal characters
- Service: `ABF0`
- Writable and notifying characteristic: `ABF7`
- A stable public Bluetooth address is required for Edge control

## Supported capabilities

- Power on and off with protocol acknowledgement
- Flow from 0 through 100 percent
- M1 pulse/cross-flow mode
- M2 sine mode
- M3 constant mode
- M4 random mode
- Pulse-frequency adjustment for modes that use it
- Feed-cycle participation and time-of-day flow programs through the Reef Controller

The driver confirms DMP commands from Bluetooth notifications before reporting
completion. It does not claim that the device reports an independently readable
power state; the last confirmed command remains the local state.

## Integration provenance and legal basis

The protocol was independently observed on owner-authorized DMP-40 hardware
using controlled Bluetooth traces and reversible bench commands. The package
contains independently written framing and authentication code. It contains no
vendor application code, credentials, copyrighted manual content, SDK binary,
or unredacted user capture.

Jebao and Jecod names are used only to describe compatibility. modREEF is not
affiliated with or endorsed by Jebao/Jecod.

## Physical regression checklist

1. Discover a pairing-mode DMP by its advertised name and stable public address.
2. Verify ABF0/ABF7 before registration.
3. Authenticate and issue power on, then power off.
4. Select each supported mode and confirm the physical controller display.
5. Change flow and pulse frequency and confirm the physical response.
6. Disconnect after every command and confirm that the next command reconnects.
7. Unplug the DMP and confirm that connectivity becomes offline.
8. Restore power and confirm that control recovers without repairing.
