# Regression Testing and Release Gates

modREEF protects a small set of complete user workflows in addition to unit
tests. A bug fix is incomplete until a test fails against the broken behavior
and passes with the fix.

## Automated gates

Every pull request and push to `develop` or a feature branch runs:

1. frozen-lockfile installation, including the maintained Matter BLE patch;
2. TypeScript validation across the workspace;
3. unit, integration, and Edge-to-Cloud system tests;
4. a production web export; and
5. production Cloud API and web container builds.

The system suite in `apps/system-tests` exercises the real Cloud application
and Edge synchronizer together. It currently protects:

- journal upload, cursor persistence, restart recovery, ordering, and
  deduplication; and
- delivery and durable acknowledgement of every equipment configuration
  command supported by Edge.

## Mobile acceptance

Maestro smoke flows live in `.maestro/flows`. They use an already authenticated
development build and do not clear its account or controller state.

Run them on the connected iPad or simulator with:

```bash
maestro test .maestro/flows
```

The initial flows protect dashboard startup, journal loading, and responsive
equipment-detail modal behavior. Add the exact reproduction path for each UI
regression before closing it.

## Promotion

Production deploys from the `production` branch, not the moving tip of a
feature branch or `develop`. Run the **Release candidate** workflow with the
full commit SHA. It reruns the complete software gates, builds a deterministic
Edge archive, and publishes that exact commit to the staging channel. It does
not move `production`.

Assign only a disposable test controller to **Staging** in System settings,
request an update, and complete the physical acceptance pass. After it passes,
run **Promote production** with the same full commit SHA. That workflow refuses
to promote a commit that is not the currently published staging candidate and
advances `production` without allowing a non-fast-forward update. Railway waits
for the commit's GitHub checks before deploying it.

Changing a controller back to **Production** immediately requests an update to
the current production archive. A new controller and an upgraded controller
default to Production when no channel file exists.

When the repository plan supports private-repository branch protection,
configure `develop` to require both CI jobs:

- `Typecheck, test, and build`
- `Production container builds`

Require pull requests and prevent force pushes. Railway production services
should not auto-deploy arbitrary feature branches.

## Deferred physical qualification

Automated hardware-in-the-loop qualification for GHome and Tapo is deliberately
deferred. Until it is introduced, pairing changes still require the existing
manual delete, factory-reset, pair, enumerate, control, restart, reconnect, and
delete acceptance pass before release.
