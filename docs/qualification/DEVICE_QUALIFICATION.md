# Device qualification

Device support labels are evidence levels, not marketing claims.

## Levels

### Experimental

The integration compiles and has limited protocol or hardware evidence. It is
not suitable as the sole control path for life-support equipment.

### Community-tested

At least two independent installations, contributors, or hardware samples have
reproduced onboarding, state reads, commands, restart recovery, and deletion.
The device profile records the tested model and firmware for each result.

### Verified

A maintainer has completed and recorded the full isolated-bench acceptance
suite on every model named by the manifest. Verification is firmware-specific;
materially different firmware returns the integration to experimental until
requalified.

## Required evidence

- Exact manufacturer, model, hardware revision, and firmware/app version.
- Legal and technical provenance for protocol behavior.
- Repeatable discovery and clean onboarding from factory-reset state.
- Deterministic physical-device identity and duplicate prevention.
- Channel enumeration and locked equipment roles where appropriate.
- Observed-state confirmation for every command; failed confirmation rolls the
  UI back instead of reporting optimistic state.
- Local schedules across restart, network loss, cloud loss, and power loss.
- Offline detection, alarm creation, recovery, and alarm clearing.
- Delete, re-pair, controller transfer, backup, and restore behavior.
- Sanitized fixtures and automated protocol/state-mapping regression tests.

## Current declared support

| Integration | Models | Declared level |
| --- | --- | --- |
| Jebao/Jecod DMP wavemaker | DMP-40 | Verified |
| Jebao/Jecod MD-4.4 doser | MD-4.4 | Verified |
| Jebao/Jecod MDP return pump | MDP-8500, MDP-20000 | Verified |
| YINMIK Water 7-in-1 | Water 7-in-1, WIFI-3188 | Verified |
| GHome WP12 power strip | WP12 | Community-tested |
| Matter outlets and power strips | On/Off Plug-in Unit, multi-endpoint strip | Community-tested |

The table mirrors integration manifests. A pull request changing a support
level must include the completed bench record in the corresponding device
profile and tests for every behavior that can be replayed without hardware.
