import { describe, expect, it } from "vitest";
import { hasAquariumRole, requiredRoleForCommand } from "../src/authorization.js";

describe("aquarium authorization", () => {
  it("applies the increasing View, Control, Program, Manage, Owner hierarchy", () => {
    expect(hasAquariumRole("view", "control")).toBe(false);
    expect(hasAquariumRole("control", "control")).toBe(true);
    expect(hasAquariumRole("control", "program")).toBe(false);
    expect(hasAquariumRole("program", "control")).toBe(true);
    expect(hasAquariumRole("manage", "program")).toBe(true);
    expect(hasAquariumRole("owner", "manage")).toBe(true);
    expect(hasAquariumRole(null, "view")).toBe(false);
  });

  it("separates dashboard control, programming, and administration commands", () => {
    expect(requiredRoleForCommand("equipment.set-power")).toBe("control");
    expect(requiredRoleForCommand("automation.feed-cycle.start")).toBe("control");
    expect(requiredRoleForCommand("equipment.update-configuration")).toBe("program");
    expect(requiredRoleForCommand("aquarium.event.create")).toBe("program");
    expect(requiredRoleForCommand("managed-device.delete")).toBe("manage");
    expect(requiredRoleForCommand("controller.check-for-update")).toBe("manage");
  });
});
