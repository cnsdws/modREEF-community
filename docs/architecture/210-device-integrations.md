# Device integration architecture

## Goal

A hardware contribution should be localized, reviewable, reproducible, and safe.
Device-specific behavior belongs in a driver package rather than Edge, cloud,
web, or tablet conditionals.

## Package layout

Create integrations with:

```bash
pnpm create:device vendor-model
```

The generator creates:

```text
packages/driver-vendor-model/
  src/index.ts          Driver and protocol-facing implementation
  src/integration.ts    Identity, onboarding, capability, and equipment manifest
  test/                 Unit, fixture, and contract tests
  README.md             Package status and documentation link
docs/device-profiles/vendor-model.md
```

It also adds the package to the compile-time built-in registry. modREEF does not
download or execute third-party driver code on a running Reef Controller.

## Manifest responsibilities

Every integration declares:

- a stable reverse-domain-style ID;
- manufacturer and supported models;
- device class and support level;
- runtime protocols and onboarding methods;
- standard capabilities and equipment-channel defaults;
- deterministic identity matching;
- registration validation and driver construction;
- a device profile containing provenance and bench evidence.

The shared contract is in `@modreef/device-integration`. The official registry
is in `@modreef/device-integrations`.

## Support levels

- `experimental`: implementation exists, with limited hardware evidence.
- `community-tested`: multiple contributors or installations have reproduced it.
- `verified`: maintainers have completed the applicable physical acceptance tests.

Support levels describe evidence, not popularity. New integrations start as
experimental. The evidence and promotion requirements are defined in
[`docs/qualification/DEVICE_QUALIFICATION.md`](../qualification/DEVICE_QUALIFICATION.md).

## Contributor workflow

1. Open an issue naming the exact hardware and firmware.
2. Run the generator and complete the device profile before protocol work.
3. Implement discovery, descriptor, state reads, and commands behind `DeviceDriver`.
4. Add sanitized protocol fixtures and replayable tests.
5. Confirm every command from observed device state; do not rely on optimistic UI state.
6. Test loss of network, loss of power, process restart, and device recovery.
7. Run package tests, repository typecheck, and applicable physical acceptance tests.

## Native provisioning

An integration that needs an iOS or Android SDK declares
`requiresNativeMobileModule: true`. Keep that bridge transport-specific and
return the shared onboarding and registration records. Runtime control must
remain local whenever the device supports it.

## Current migration status

GHome WP12, Jebao MDP, Jebao MD-4.4, the DMP wavemaker, the YINMIK water meter,
and Matter outlets use manifests and registry-based driver construction. All
current hardware families now use this boundary; future integrations should be
created with the device generator instead of adding device-specific Edge code.
