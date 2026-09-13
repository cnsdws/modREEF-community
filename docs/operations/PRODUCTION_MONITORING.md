# Production monitoring

The `Production monitor` GitHub Actions workflow checks Cloud API liveness and
readiness, the web application, and the production Edge release manifest every
15 minutes. Enable GitHub Actions failure notifications for repository
maintainers so a failed scheduled run reaches an operator.

Railway must also have deployment-failure and service-crash notifications
enabled for both the `@modreef` Cloud API and `modREEF` web services. GitHub
health checks do not replace provider alerts because a failed deployment can
leave the previous version healthy.

## Controller synchronization

Controller connectivity is aquarium-specific rather than a public service
health signal. The Cloud API records `edges.last_seen_at`; the application
raises the aquarium's controller-offline issue when that heartbeat is stale.
Alarm delivery must notify opted-in aquarium members without making cloud
availability part of local equipment control.

Operators investigating an incident should record:

- the failing service and deployment commit;
- first and last observed failure time;
- whether the previous deployment remained active;
- database readiness and controller heartbeat impact;
- mitigation, rollback, and final recovery time.

Never place database credentials, controller tokens, Auth0 tokens, or device
credentials in workflow output or incident screenshots.
