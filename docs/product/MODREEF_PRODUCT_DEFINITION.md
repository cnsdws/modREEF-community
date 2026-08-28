#  modREEF Product Definition v1.0

Version: 1.0 (Draft)
Status: Living Document

Vision

modREEF is an open, intelligent reef aquarium operating system.

It provides a modern, hardware-agnostic platform that allows reef aquarists to build and automate their systems without vendor lock-in.

Rather than selling expensive proprietary hardware, modREEF delivers software that can orchestrate equipment from many manufacturers while providing intelligent recommendations through Reef Coach.

Mission

Create the easiest, smartest, and most open reef controller available.

The software should:

Reduce livestock loss
Simplify automation
Recommend best practices
Support inexpensive hardware
Never lock users into one ecosystem
Design Principles
1. Open

Support as many vendors as practical.

Examples:

Tuya
Matter
Neptune Apex
Jebao
AI
Ecotech
Kasa
Shelly

If a device exposes useful capabilities, modREEF should be able to use it.

2. Hardware Agnostic

Users should choose the best equipment.

Not the equipment that happens to be compatible.

3. Intent First

Users think:

Feed Fish

not

Turn outlet 4 off.

Automation operates on equipment and intent—not outlets.

4. Local First

Critical automation must continue operating without Internet connectivity.

Cloud services enhance the system but never become mandatory.

5. Safety First

Livestock safety always overrides convenience.

The controller should fail safely.

Examples:

Unknown heater state → notify user.
Return pump failure → disable skimmer.
Leak detected → stop return pump.
6. Explainable AI

Every recommendation should include reasoning.

Example:

Reduce calcium dosing from 24 mL/day to 20 mL/day because calcium has increased from 420 ppm to 444 ppm over the last four measurements.

The user should understand why.

Product Components
modREEF Mobile

Responsibilities:

Dashboard
Notifications
Configuration
Manual control
Chemistry logging
Reef Coach
Remote access
modREEF Edge

Always-on runtime.

Runs on:

Raspberry Pi
Home Assistant
Docker
Linux
Windows
macOS
NAS

Responsibilities:

Driver Manager
Equipment Manager
Scheduler
Automation Engine
Digital Twin
Local Database
REST API
WebSocket API
Event Engine
modREEF Cloud (Optional)

Responsibilities:

Backup
Synchronization
Fleet analytics
Device qualification database
AI model improvements
Remote access

Cloud services are optional.

Core Technologies

Digital Twin

Every aquarium exists as a complete software model.

Includes:

Equipment
Measurements
Livestock
Corals
Maintenance
Water chemistry
Lighting
Flow
Automation

The Digital Twin becomes the source of truth.

Equipment Manager

Maps logical equipment to physical hardware.

Example:

Protein Skimmer

↓

Smart Strip

↓

Outlet 3

No UI component should reference outlet numbers.

Hardware Abstraction Layer

Provides a common interface for every driver.

Drivers implement capabilities instead of vendor-specific logic.

Device Qualification

Every supported device receives a capability profile.

Example:

★★★★★

Supports:

✓ Local scheduling

✓ Power monitoring

✓ Offline execution

✓ Local API

✓ Fast response

Recommended

Reef Coach

Provides recommendations, not autonomous control.

Examples:

Suggested dosing adjustments
Maintenance reminders
Equipment optimization
Livestock observations
Trend analysis
Safety alerts

High-risk recommendations require user approval.

Out of Scope (v1)
Automatic water testing hardware
Vision-based coral health
Autonomous dosing adjustments
Full Apex migration tools
Commercial aquaculture
Machine-learning prediction of coral growth

These may become future releases.

Differentiators

Unlike traditional controllers:

Open hardware
Vendor neutral
Modern mobile UI
AI-assisted recommendations
Equipment abstraction
Digital Twin architecture
Local-first operation
Capability-based drivers
Community device qualification
Success Metrics

A successful v1 should allow a user to:

Install modREEF Edge
Discover a smart strip
Bind equipment
Create feed mode
Schedule equipment
Log chemistry
Receive intelligent recommendations
Operate completely without a cloud connection
Five-Year Vision

modREEF becomes the operating system for reef aquariums.

The ecosystem includes:

Hundreds of qualified devices
Community-shared automations
Shared equipment profiles
Reef Coach trained on millions of observations
Professional and public aquarium deployments
Home aquarists running inexpensive hardware with enterprise-grade intelligence

