# modREEF Roadmap

## Cloud-managed routines

Enable users to list, create, edit, delete, run, and stop Reef Controller routines from the web application.

Requirements:

- Routine definitions and execution remain on the Reef Controller so automation continues without internet access.
- Every web change is routed to the selected Reef Controller through the cloud command channel.
- The UI reports success only after the Reef Controller validates and confirms the committed change.
- Commands are scoped to the correct aquarium and Reef Controller.
- Create, read, update, delete, run, and stop behavior receives API, controller, and UI regression coverage.
- Existing direct-local routine control on phone and tablet remains available when cloud access is interrupted.
