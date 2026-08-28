# Reef Controller Command Standard

The Reef Controller is authoritative for equipment and automation state. The cloud mirrors reported state and routes commands; it does not execute aquarium automation.

## Routing

- Phone and tablet prefer an authenticated direct-LAN command when the selected Reef Controller is reachable.
- Phone and tablet fall back to the cloud command channel when LAN delivery is unavailable.
- The website always uses the cloud command channel.
- UI components call one controller gateway and do not branch on local versus cloud behavior.

## Command lifecycle

1. The client creates an idempotent command scoped to an aquarium and Reef Controller.
2. The Reef Controller validates and executes the command through the same domain handler regardless of transport.
3. The Reef Controller durably records the resulting state.
4. The controller reports completed or failed and publishes its current reported state.
5. The UI changes state only after controller confirmation.

## Reported state

Controller synchronization includes equipment state and active-operation state, including Feed Cycle timing and recovery. Every surface renders the same reported state regardless of where an operation started.

## Trust

Adding a Reef Controller claims it for the account and aquarium and provisions cloud and local credentials. No separate user-facing controller pairing workflow is permitted.

## Safety and testing

- Commands use unique IDs and must be safe to retry.
- Commands must never cross aquarium or Reef Controller boundaries.
- Local operation remains available during a cloud outage.
- Each feature requires equivalent LAN and cloud contract tests plus confirmation and failure tests.
