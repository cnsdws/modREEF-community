import { describe, expect, it } from "vitest";

import {
  openControllerWifiCredentials,
  sealControllerWifiCredentials,
  type ControllerBleIdentity,
} from "../src/index.js";

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const identity: ControllerBleIdentity = {
  version: 1,
  setupId: "ABCDEF",
  hardwareSerial: "10000000abcdef",
  serverNonce: base64url(Uint8Array.from({ length: 24 }, (_, index) => index + 1)),
};
const secret = base64url(Uint8Array.from({ length: 32 }, (_, index) => index + 11));
const clientNonce = Uint8Array.from({ length: 24 }, (_, index) => 200 - index);

describe("QR-authenticated controller Wi-Fi provisioning", () => {
  it("round trips credentials through XChaCha20-Poly1305", () => {
    const envelope = sealControllerWifiCredentials(identity, secret, {
      ssid: "Reef Network",
      password: "correct horse battery staple",
    }, clientNonce);
    expect(openControllerWifiCredentials(identity, secret, envelope)).toEqual({
      ssid: "Reef Network",
      password: "correct horse battery staple",
    });
  });

  it("rejects the wrong QR secret without exposing credentials", () => {
    const envelope = sealControllerWifiCredentials(identity, secret, {
      ssid: "Reef Network",
      password: "super-secret",
    }, clientNonce);
    const wrongSecret = base64url(new Uint8Array(32).fill(99));
    expect(() => openControllerWifiCredentials(identity, wrongSecret, envelope)).toThrow("rejected");
  });

  it("binds ciphertext to the physical controller identity", () => {
    const envelope = sealControllerWifiCredentials(identity, secret, {
      ssid: "Reef Network",
      password: "super-secret",
    }, clientNonce);
    expect(() => openControllerWifiCredentials({ ...identity, setupId: "123456" }, secret, envelope)).toThrow("identity mismatch");
  });
});
