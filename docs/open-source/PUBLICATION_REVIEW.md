# Public-source publication review

This checklist is the human approval gate between a technically clean source
snapshot and creation of a public repository. It does not authorize changing
repository visibility or publishing private Git history.

## Automated evidence

- `scripts/create-public-snapshot.sh` builds from committed Git objects and
  rejects generated, diagnostic, factory-private, credential, and local-data
  paths.
- `scripts/audit-public-snapshot.sh` scans a fresh extraction with Gitleaks.
- `.gitleaks.toml` extends the complete default ruleset. Its only exceptions are
  two public protocol product identifiers and one explicitly fake test key.
- `scripts/audit-dependency-licenses.mjs` rejects missing or newly introduced
  dependency license classifications until they receive explicit review.
- CI verifies the open-source Tuya boundary and scans every candidate snapshot.

## Included visual assets

Only the six runtime files under `apps/mobile/assets/brand/` are included. They
are modREEF logo, wordmark, icon, splash, symbol, and adaptive-icon variants.
The working `Graphics/` directory is excluded from public archives.

Before publication, the copyright owner must confirm that these six runtime
assets may be distributed with the source. `NOTICE` reserves the modREEF name
and branding for official distributions; Apache-2.0 covers the program code.

## Human approval checklist

- [x] Dennis Stevens confirmed Apache-2.0 as the intended code license on
      2026-08-26. See ADR 0004.
- [x] Dennis Stevens confirmed redistribution rights for the six runtime brand
      assets on 2026-08-26.
- [ ] Tuya SDK binaries, keys, secrets, and account-derived provisioning data
      are absent.
- [ ] Packet captures, diagnostics, databases, controller images, QR secrets,
      and private factory-label data are absent.
- [ ] Device protocol identifiers documented as public interoperability data do
      not grant access to an individual device or account.
- [ ] Dependency licenses and notices have received a final review.
- [ ] A physical smoke test passes on a disposable aquarium test setup.
- [ ] The final archive hash and source commit are recorded in the release
      decision.

## Publication method

Create the public repository from the approved archive as a new root commit.
Do not mirror, unshallow, or force-push the private repository. This preserves
the private development archive without exposing deleted files or historical
credentials.
