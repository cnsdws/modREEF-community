# Beta cloud deployment

Step 6 packages the cloud API for deployment without selecting or creating a hosting vendor.

The shared Expo web client is packaged separately by `Dockerfile.web`. Its
static export runs in explicit cloud mode against `https://api.modreef.net`,
and the production container serves SPA routes plus `/health` on Railway's
assigned `PORT`.

## Runtime topology

- `www.modreef.net`: adaptive Expo web client
- `api.modreef.net`: `Dockerfile.cloud` behind managed HTTPS
- managed PostgreSQL with encrypted connections and automated backups
- an OIDC provider for browser and native sign-in
- each Pi makes outbound HTTPS requests to `api.modreef.net`; no home-router port forwarding

The container runs checksum-protected migrations under a PostgreSQL advisory lock before starting the API. This makes concurrent deploy starts safe and refuses silently edited migration history. `/health/live` proves the process is responsive; `/health/ready` additionally proves PostgreSQL is reachable.

## Required secrets and settings

Use `deploy/cloud.env.example` as the contract. Store values in the host's secret manager, never in Expo public variables, container images, or Namecheap DNS records. `MODREEF_ALLOWED_ORIGINS` must list exact HTTPS web origins; wildcard credentialed origins are intentionally unsupported. The release publisher token is also stored as an encrypted GitHub Actions secret so the qualification workflow can publish the staging archive; it must not be placed in repository variables or source files.

## Local production-shape check

Docker is optional for normal development. When available:

```bash
docker compose -f deploy/compose.cloud.yml up --build
curl -fsS http://localhost:3001/health/live
curl -fsS http://localhost:3001/health/ready
docker compose -f deploy/compose.cloud.yml down
```

The example identity values allow health checks only. Authenticated APIs will not work until a real OIDC provider is configured.

## DNS and TLS rollout

After choosing the beta host:

1. Deploy the API image and PostgreSQL, run both health checks, and record the host-provided API DNS target.
2. Add the host-required `api` CNAME or A/AAAA record in Namecheap Advanced DNS.
3. Deploy the web build and add the host-required root and `www` records.
4. Let the hosting platforms issue TLS certificates, then verify HTTPS before enabling clients.
5. Configure the OIDC provider's exact web origins and native redirect URIs.
6. Set the client cloud URL to `https://api.modreef.net`, create the beta aquarium/Edge registration, then configure only the beta Pi.
7. Keep the current Pi and local-mode client as the development environment.

DNS records depend on the selected host, so the runbook intentionally does not prescribe placeholder Namecheap values.
