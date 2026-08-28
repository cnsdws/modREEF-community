# Open-source Phase 1 foundation

## Purpose

Phase 1 prepares a reviewable source snapshot without changing the private
repository's visibility or publishing its historical Git objects.

The starting source baseline is commit `fefd7ba1` ("Save equipment layout
atomically") on 2026-08-26. A public preview must be produced from a later,
fully qualified Phase 1 commit and must not inherit this private repository's
history.

## Decisions recorded

- Open code is licensed under Apache-2.0 unless a file states otherwise.
- The modREEF name and brand assets are not licensed as identifiers for
  unofficial distributions.
- Tuya's proprietary SDK and credentials are outside the open-source boundary;
  the standard build excludes the native bridge unless explicitly enabled.
- Local operation remains the primary product boundary.
- The current private repository remains the development archive.
- A public repository will begin from a sanitized, auditable snapshot.

## Public-snapshot exclusions

- Git history and reflogs
- dependency directories and build caches
- diagnostic archives, packet captures, and transient logs
- factory images and private controller label manifests
- generated native projects, signing material, and provisioning profiles
- credentials, local databases, device snapshots, and QR setup secrets
- unreviewed working design assets
- proprietary third-party SDKs

`.gitattributes` records archive exclusions for generated and sensitive paths.
The snapshot must also pass an independent secret scan and a manual file review;
archive exclusions alone are not a security boundary.

## Exit criteria

Phase 1 is complete when:

1. The license, notices, security policy, code of conduct, contribution rules,
   and governance files have been reviewed and committed.
2. The Tuya boundary is represented in both documentation and build behavior.
3. A clean source archive contains no forbidden paths or untracked local data.
4. A fresh machine can install dependencies and run the standard checks.
5. The selected baseline passes CI and physical smoke tests.
6. No repository visibility or history change occurs until the snapshot report
   is approved.
