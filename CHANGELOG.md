# Changelog

All notable community releases are recorded here. The project uses semantic
versioning for published controller images and source snapshots while it is in
developer preview.

## 0.2.2 - 2026-09-14

### Fixed

- Use monotonic time for controller uptime and automation-health age so network
  clock corrections cannot create false health transitions.
- Allow qualified updates more time to restore existing Matter state before
  deciding that the local controller API failed to start.

## 0.2.1 - 2026-09-14

### Changed

- Aligned controller health and cloud reporting with the `0.2.1` release.
- Made first-boot discovery immediately advertise the hardware-derived hostname.

### Security

- Community image builds now fail if their embedded source provenance is absent
  or malformed.

## 0.2.0 - 2026-09-13

### Added

- Signed Reef Controller release archives and a public verification key.
- Staging and production controller release channels.
- Controller and cloud-database backup and recovery tooling.
- Public production health monitoring and immutable container qualification.
- Clean device-integration manifests, scaffolding, and qualification levels.
- Multi-user aquarium authorization, invitations, ownership transfer, and
  authorization audit history.
- Aquarium data export, safe account-data deletion, and native release profiles.
- Durable email invitation and alert-delivery infrastructure.

### Changed

- Documented the Apache-2.0 source boundary and reserved modREEF branding.
- Reconciled tablet and web clients around shared cloud contracts.
- Hardened controller lifecycle, onboarding, deletion, and update behavior.

### Security

- Public snapshots are generated from committed objects and scanned with the
  complete Gitleaks ruleset.
- Controller updates are checksum-verified and, once the trust anchor is
  installed, require a valid Ed25519 signature.

## 0.1.0 - 2026-08-28

- Initial public developer-preview source snapshot and Raspberry Pi image.
