# Governance

modREEF is currently a founder-maintained project led by Dennis Stevens.

Dennis Stevens is the current project steward, release authority, copyright
owner for original project code, and steward of the modREEF name and official
brand assets. No ownership transfer to a future company is implied until a
written project update names that legal entity.

## Decision making

- Routine changes are accepted through review after automated checks pass.
- Changes to safety behavior, trust boundaries, data ownership, public APIs,
  licensing, or supported hardware require an architecture decision record.
- Device compatibility claims require repeatable physical verification.
- The maintainer may reject changes that create unsafe failure modes, depend on
  copied proprietary material, or make local control depend on cloud access.

## Releases and conflicts

- The project steward approves source releases, official controller images,
  signing-key rotation, and changes to verified-device claims.
- A contributor with a personal or financial conflict must disclose it and not
  act as the sole reviewer of the affected change.
- Technical disagreements should be resolved with reproducible tests, documented
  safety constraints, and an architecture decision record when the outcome
  changes a project boundary.
- Conduct disputes are handled privately under `CODE_OF_CONDUCT.md`; security
  reports use GitHub private vulnerability reporting.

This lightweight model is appropriate for the developer-preview stage.
Additional maintainers and delegated release authority will be listed here when
they are appointed.
