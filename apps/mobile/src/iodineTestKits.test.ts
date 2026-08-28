import { describe, expect, it } from "vitest";

import {
  iodineKit,
  iodineKitForEvent,
  iodineReadingIsValid,
} from "./iodineTestKits";

describe("iodine test kits", () => {
  it("accepts the Hanna checker range", () => {
    const kit = iodineKit("iodine-hanna-hi718");
    expect(iodineReadingIsValid(kit, 0)).toBe(true);
    expect(iodineReadingIsValid(kit, 12.5)).toBe(true);
    expect(iodineReadingIsValid(kit, 12.6)).toBe(false);
  });

  it("only accepts Red Sea color-card readings", () => {
    const kit = iodineKit("iodine-red-sea");
    expect(iodineReadingIsValid(kit, 0.03)).toBe(true);
    expect(iodineReadingIsValid(kit, 0.04)).toBe(false);
  });

  it("only accepts Seachem color-card readings", () => {
    const kit = iodineKit("iodine-seachem");
    expect(iodineReadingIsValid(kit, 0.08)).toBe(true);
    expect(iodineReadingIsValid(kit, 0.07)).toBe(false);
  });

  it("restores the saved Salifert mode", () => {
    expect(
      iodineKitForEvent({
        parameter: "iodine",
        testKit: {
          brand: "Salifert",
          rawReading: 0.06,
          resolution: "Iodate + iodine",
        },
      })?.id,
    ).toBe("iodine-salifert-iodate");
  });
});
