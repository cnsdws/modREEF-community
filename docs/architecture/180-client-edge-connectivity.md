# Client-to-Edge connectivity inventory

modREEF has two explicit runtime modes:

- **Local mode** is used by the installed tablet application. It talks directly to the Edge over the aquarium LAN and remains usable without internet access.
- **Cloud mode** is used by the hosted web application. Equipment state, measurements, events, and Edge availability are read from the cloud API after the Edge synchronizes them. Commands explicitly implemented by the cloud command queue are delivered to the Edge over its outbound sync connection.

The UI must not describe a failed direct-LAN request as a failed cloud connection. Features that still require direct LAN access must say so explicitly until they have a cloud command contract.

| Surface | Local/tablet path | Cloud/web path | Current status |
| --- | --- | --- | --- |
| Account sign-in/out | Not required | Auth0 and persisted browser session | Connected |
| Aquarium selection | Edge aquarium | Cloud membership and persisted selection | Connected |
| Edge availability | `/health` | Edge heartbeat in PostgreSQL | Connected |
| Equipment list/state | `/equipment` | Cloud equipment snapshots | Connected |
| Outlet Off/Auto/On | Direct Edge command | Queued cloud command with Edge confirmation | Connected |
| Equipment rename/role | Direct Edge command | Queued cloud command with Edge confirmation | Connected |
| Water telemetry cards | Edge measurement events | Cloud-synchronized measurement events | Connected for recorded measurements |
| Measurement history | Edge event timeline | Cloud-synchronized event timeline | Connected for reads |
| Water alerts | Measurements in the active mode | Measurements in the active mode | Connected |
| Add journal and measurement entries | Direct Edge timeline API | Queued cloud command; Edge validates, records, and synchronizes the event | Connected |
| Edit/delete journal entries | Direct Edge timeline API | Queued cloud commands with Edge mutation and cloud reconciliation | Connected |
| Feed cycle | Direct Edge automation API | Direct LAN only | Cloud command contract required |
| Equipment schedules | Direct Edge equipment API | Direct LAN only | Cloud command contract required |
| Interval programs | Direct Edge equipment API | Direct LAN only | Cloud command contract required |
| Doser calibration | Direct Edge equipment API | Direct LAN only | Cloud command contract required; intentionally high safety bar |
| Custom routines | Direct Edge automation API | Direct LAN only | Cloud command contract required |
| Managed-device administration | Direct Edge API | Direct LAN pairing | Intentionally local for onboarding and destructive administration |
| Tuya provisioning | Native SDK and Edge credential handoff | Not available in browser | Intentionally native/local |

## Direct-call audit

The following cloud-visible surfaces still import `edgeClient` directly and must not be described as cloud-connected until routed through a mode-aware adapter:

| Surface | Direct operations found | Required resolution |
| --- | --- | --- |
| Alerts and diagnostics | Record alert activity | Connected through the cloud event command adapter |
| Journal | Create, edit, and delete events | Connected through durable Edge commands and cloud reconciliation |
| Water history | Create and edit measurements | Connected through the same event command path |
| Equipment programs | Change program type | Add an equipment configuration command and confirm the equipment snapshot |
| Interval programs | Save interval settings | Add a typed interval command and confirm the equipment snapshot |
| Equipment schedules | Enable and edit schedules | Add a typed schedule command and confirm the equipment snapshot |
| Doser calibration | Run and save calibration | Keep remote execution blocked until its idempotency and restart safety contract is complete; saved calibration may use a separate safe configuration command |
| Feed cycle | Read, start, and stop | Add an automation-state snapshot plus typed start/stop commands |
| Custom routines and water change | CRUD and runtime actions | Add versioned automation definitions and typed lifecycle commands |
| Managed devices | List, rename, and delete | Keep destructive administration LAN-only; label it explicitly in cloud mode |
| Edge pairing and Tuya onboarding | Pairing and credential provisioning | Keep local/native by design |

Additional browser persistence checks are required for equipment layout, feed-cycle preferences, and alert rules anywhere they still rely exclusively on native SecureStore.

New cloud-visible panels should import `dashboardConnection` (or a domain-specific mode-aware adapter), not `edgeClient`. Direct `edgeClient` imports are reserved for explicitly local/native administration surfaces.

## Measurement boundary

The dashboard no longer renders simulated telemetry. It derives the latest value and recent trend from real `measurement` events recorded by the Edge. The Edge synchronizes those events to the cloud, and the hosted client reads them from the cloud event endpoint. Temperature, pH, ORP, and salinity are first-class dashboard parameters.

The cloud event window includes up to 1,000 recent events so equipment activity cannot crowd water measurements out of dashboard and graph queries.

This data path does not itself create sensor readings. A hardware driver must publish readings as Edge measurement events with `source: "sensor"`. Until a compatible sensor integration is installed and producing events, the dashboard correctly displays `No data` / `Awaiting sensor`.

## Command safety boundary

Cloud writes must not bypass the Edge's local safety and persistence logic. Each remaining cloud-write feature needs a typed, idempotent command, Edge-side validation and execution, durable result reporting, and a confirmation strategy before its browser controls can be considered cloud-connected.
