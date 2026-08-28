import { describe, expect, it } from "vitest";

import { renderControllerWifiConnection } from "../src/controller-wifi-provisioner.js";

describe("controller Wi-Fi profile", () => {
  it("renders a persistent NetworkManager profile", () => {
    const result = renderControllerWifiConnection({ ssid: "Reef WiFi", password: "safe;password" });
    expect(result).toContain("ssid=Reef WiFi");
    expect(result).toContain("psk=safe\\;password");
    expect(result).toContain("autoconnect=true");
  });

  it("rejects credentials that could inject keyfile fields", () => {
    expect(() => renderControllerWifiConnection({ ssid: "reef\npsk=bad", password: "password1" })).toThrow();
    expect(() => renderControllerWifiConnection({ ssid: "reef", password: "bad\npassword" })).toThrow();
  });
});
