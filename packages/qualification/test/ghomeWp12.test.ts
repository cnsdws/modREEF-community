import { describe, expect, it } from "vitest";

import { ghomeWp12Qualification } from "../src/ghomeWp12.js";

describe("GHome WP12 qualification", () => {
  it("captures the documented baseline capabilities", () => {
    expect(ghomeWp12Qualification.status).toBe("verified");

    expect(
      ghomeWp12Qualification.capabilities.find(
        (capability) => capability.id === "switch.outlet",
      ),
    ).toEqual({
      id: "switch.outlet",
      supported: true,
      details: {
        count: 6,
        individuallyControllable: true,
        localControl: true,
      },
    });
  });
});
