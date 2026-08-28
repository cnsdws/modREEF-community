# Project Guidelines

These guidelines apply to all modREEF code, assets, integrations, documentation, and official distributions.

1. **No copied competitor materials.** Do not copy competitor code, assets, documentation, or interface designs.
2. **Record integration provenance.** Every integration must have a recorded source and legal basis.
3. **Use competitor trademarks only for compatibility.** Competitor trademarks may be used only to describe compatibility and must include clear non-affiliation language.
4. **Review high-risk integrations.** High-risk integrations require review before entering an official distribution.
5. **Use one name-editing pattern.** Display names as text with the standard pencil action. While editing, use the standard green check to save and red X to cancel; do not add separate Save and Cancel buttons for name fields.
6. **Adding a Reef Controller establishes trust.** The Add Reef Controller workflow claims the controller for the account and aquarium and provisions any required cloud and local credentials. Do not expose a separate controller-pairing workflow, pairing code, or “pair this app” recovery step. Device pairing for equipment attached to a controller remains a separate workflow.
7. **Use the controller command standard.** Functional commands must follow `docs/CONTROLLER_COMMAND_STANDARD.md`: one gateway, LAN-first native routing with cloud fallback, website cloud routing, Reef Controller execution and confirmation, and synchronized reported state. Do not implement transport decisions independently inside UI components.
