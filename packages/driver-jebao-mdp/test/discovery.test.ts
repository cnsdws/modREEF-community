import { describe, expect, it } from "vitest";
import { decodeMdpDiscoveryResponse } from "../src/discovery.js";

const mdp8500Response = Buffer.from(
  "000000037a0000040016463348547035625478753265306b5a65364e377831630006d8bc3880b1e30008303430323042333000203032303339383736373531303439646562343034643164383932323165633462000000000000000275736170692e67697a776974732e636f6d3a383000342e312e32003033303330303030",
  "hex",
);

describe("MDP discovery", () => {
  it("decodes the physical MDP-8500 discovery response", () => {
    expect(decodeMdpDiscoveryResponse(mdp8500Response, "10.0.0.60")).toEqual({
      deviceId: "mdp-d8bc3880b1e3",
      networkAddress: "10.0.0.60",
      macAddress: "d8:bc:38:80:b1:e3",
      moduleId: "04020B30",
      productKey: "02039876751049deb404d1d89221ec4b",
      firmwareVersion: "4.1.2",
    });
  });

  it("rejects unrelated or truncated datagrams", () => {
    expect(decodeMdpDiscoveryResponse(Buffer.alloc(12), "10.0.0.60"))
      .toBeUndefined();
  });
});
