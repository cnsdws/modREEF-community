# Cloud foundation

Step 2 adds the first deployable cloud boundary without changing the local Edge control path.

## Service boundary

`@modreef/cloud-api` is the authenticated API used by web, iPhone/iPad, and Android clients. It exposes aquarium, Edge, reported equipment state, event history, and queued-command resources. `/health` remains public for deployment checks.

Authentication uses standard OIDC access tokens. The deployment supplies:

- `MODREEF_DATABASE_URL`: PostgreSQL connection string
- `MODREEF_OIDC_ISSUER`: exact token issuer
- `MODREEF_OIDC_AUDIENCE`: API audience
- `MODREEF_OIDC_JWKS_URL`: optional override for the issuer's JWKS URL
- `PORT`: optional; defaults to `3001`

No identity vendor is embedded in application contracts. The API maps the verified token `sub` to an internal user.

## Tenant isolation

Every aquarium resource query is scoped through `aquarium_memberships`. A caller without membership receives `404`, which avoids revealing another customer's aquarium identifiers. Commands are authorized before being stored and record the requesting user.

Roles are `owner`, `admin`, and `viewer`. This step establishes membership isolation; role-specific write policy is added with account administration.

## Durable records

Migration `001_cloud_foundation.sql` creates users, aquariums, memberships, registered Edges, current equipment snapshots, idempotent cloud commands, and ordered aquarium events. Commands use a client-generated `commandId`; events use an Edge sequence number so reconnect delivery can be safely replayed.

Run a migration with:

```bash
MODREEF_DATABASE_URL='postgresql://...' pnpm --filter @modreef/cloud-api migrate
```

The Edge sync protocol is documented in `170-edge-cloud-sync.md`. The existing LAN connection remains operational independently of cloud availability.
