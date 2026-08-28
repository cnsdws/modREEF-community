# ADR 0004: Apache License 2.0 for modREEF

Status: Accepted

Date: 2026-08-26

## Context

modREEF is being prepared for publication as free and open-source software. Its
architecture spans an Edge controller, mobile and web clients, cloud services,
shared libraries, hardware drivers, and optional interoperability with
separately licensed proprietary SDKs.

The licensing decision must encourage community hardware support while keeping
copyright, attribution, patent, third-party, and trademark boundaries clear.
AGPL-3.0 was considered because its network-use provision can require modified
hosted versions to offer corresponding source to remote users.

## Decision

modREEF-authored program code in the public source distribution is licensed
under the Apache License, Version 2.0, unless a file explicitly states another
license.

Third-party software remains under its own license and is documented through
`THIRD_PARTY_NOTICES.md` and dependency metadata. Proprietary SDKs, credentials,
and service entitlements are not included or sublicensed.

The Apache license does not grant permission to use the modREEF name, logos, or
other brand identifiers for an unofficial product or service. Source-code
licensing and trademark permission remain separate decisions.

## Rationale

- A permissive license lowers the barrier for reef-equipment manufacturers,
  hobbyists, and integrators to contribute or reuse device drivers.
- Apache-2.0 includes an explicit patent license and patent-termination terms.
- It presents fewer distribution conflicts for mobile application stores and
  optional proprietary native SDKs than a strong-copyleft license.
- It permits commercial use without requiring a separate commercial license,
  consistent with the goal of broad adoption.
- Project identity can be protected independently through trademark policy.

## Consequences

- Modified or hosted forks are not required to publish their changes.
- Improvements are encouraged through governance and contribution practices,
  rather than compelled through copyleft.
- Apache-2.0 `LICENSE` and applicable `NOTICE` material must accompany source
  and binary distributions.
- Contributors retain copyright in their contributions while providing the
  rights stated by Apache-2.0 and the project's contribution rules.
- A future license change for existing contributions may require permission
  from their copyright holders; licensing should therefore remain stable after
  public contributions begin.

## Alternatives considered

### AGPL-3.0-only

Rejected for the initial public release. It would better protect against closed
hosted forks, but would add compliance and integration friction across the
mobile, Edge, cloud, native-SDK, and hardware-driver boundaries.

### Split Apache/AGPL licensing

Deferred. Applying AGPL only to hosted cloud components could be reconsidered
after those components have clean package and contribution boundaries. It is
not needed for the initial community hardware platform.
