import { describe, expect, it } from "vitest";
import { decodeJebaoMd44DiscoveryResponse } from "../src/discovery.js";

function field(value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0, value.length]), value]);
}

describe("MD-4.4 discovery", () => {
  it("preserves the GizWits DID and derives a stable local ID", () => {
    const response = Buffer.concat([
      Buffer.from("0000000300000004", "hex"),
      field(Buffer.from("Fe4w2gEJHJIsTKdrJ46u0k")),
      field(Buffer.from("9c139e69f7e0", "hex")),
      field(Buffer.from("04X3000R")),
      field(Buffer.from("1aa33c38ba9d4b78a9e7796705b2fad7")),
      Buffer.from("\0firmware 4.1.4\0"),
    ]);
    expect(decodeJebaoMd44DiscoveryResponse(response, "10.0.0.45")).toEqual({
      deviceId: "md44-9c139e69f7e0",
      gizwitsDeviceId: "Fe4w2gEJHJIsTKdrJ46u0k",
      networkAddress: "10.0.0.45",
      macAddress: "9c:13:9e:69:f7:e0",
      moduleId: "04X3000R",
      productKey: "1aa33c38ba9d4b78a9e7796705b2fad7",
      firmwareVersion: "4.1.4",
    });
  });
});
