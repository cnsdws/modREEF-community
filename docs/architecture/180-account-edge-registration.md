# Account and Edge registration

Step 4 provides the authenticated setup workflow that precedes cloud deployment.

1. An OIDC-authenticated user creates an aquarium with `POST /v1/aquariums`. The creator receives the `owner` membership.
2. An owner or admin registers a Pi with `POST /v1/aquariums/:aquariumId/edges`.
3. The response contains `edgeId`, `aquariumId`, and a cryptographically random device `token`.
4. The raw token is shown once and installed on the Pi with the cloud URL and IDs. PostgreSQL stores only its SHA-256 hash.
5. The Edge authenticates its outbound sync exchanges with that token.

The shared `ModReefCloudClient` exposes aquarium creation and Edge registration through the same transport boundary used by web, iPhone/iPad, and Android.

## Authorization

- `owner`: read, register Edges, and issue equipment commands
- `admin`: read, register Edges, and issue equipment commands
- `viewer`: read only
- non-member: no resource discovery; aquarium routes return `404`

The prototype currently returns the same resource-hiding response for a viewer's rejected write and a non-member request. Account administration and invitations will add explicit user-facing permission feedback without weakening repository enforcement.

No hosted identity provider, database, API, DNS record, or Pi cloud configuration is created by this step.
