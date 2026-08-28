import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EdgeCredentialStore } from "../src/edge-credential-store.js";

describe("EdgeCredentialStore", () => {
  it("writes GHome credentials with owner-only permissions", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "modreef-credentials-"),
    );
    const path = join(directory, ".env.edge.local");
    const store = new EdgeCredentialStore(path);

    store.saveGHomeWp12({
      deviceId: "device-1",
      networkAddress: "192.0.2.50",
      localKey: "secret-local-key",
    });

    const content = readFileSync(path, "utf8");
    expect(content).toContain("GHOME_WP12_DEVICE_ID=device-1");
    expect(content).toContain("GHOME_WP12_IP=192.0.2.50");
    expect(content).toContain("GHOME_WP12_LOCAL_KEY=secret-local-key");
    expect(content).toContain("GHOME_WP12_DEVICES_B64=");
    expect(store.listGHomeWp12()).toEqual([{
      deviceId: "device-1",
      networkAddress: "192.0.2.50",
      localKey: "secret-local-key",
    }]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("migrates legacy credentials and adds another device", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "modreef-credentials-"),
    );
    const path = join(directory, ".env.edge.local");

    writeFileSync(
      path,
      [
        "UNCHANGED=value",
        "GHOME_WP12_DEVICE_ID=old-device",
        "GHOME_WP12_IP=192.0.2.2",
        "GHOME_WP12_LOCAL_KEY=old-key",
        "",
      ].join("\n"),
    );

    new EdgeCredentialStore(path).saveGHomeWp12({
      deviceId: "new-device",
      networkAddress: "192.0.2.50",
      localKey: "new-key",
    });

    const content = readFileSync(path, "utf8");
    expect(content).toContain("UNCHANGED=value");
    expect(content).toContain("GHOME_WP12_DEVICE_ID=old-device");
    expect(new EdgeCredentialStore(path).listGHomeWp12()).toEqual([
      {
        deviceId: "old-device",
        networkAddress: "192.0.2.2",
        localKey: "old-key",
      },
      {
        deviceId: "new-device",
        networkAddress: "192.0.2.50",
        localKey: "new-key",
      },
    ]);
  });

  it("updates and deletes one device without changing the others", () => {
    const directory = mkdtempSync(join(tmpdir(), "modreef-credentials-"));
    const path = join(directory, ".env.edge.local");
    const store = new EdgeCredentialStore(path);
    store.saveGHomeWp12({
      deviceId: "one", networkAddress: "10.0.0.1", localKey: "key-1",
      runtimeDeviceId: "ghome-wp12",
    });
    store.saveGHomeWp12({
      deviceId: "two", networkAddress: "10.0.0.2", localKey: "key-2",
      runtimeDeviceId: "two",
    });
    store.saveGHomeWp12({
      deviceId: "two", networkAddress: "10.0.0.22", localKey: "key-2b",
      runtimeDeviceId: "two",
    });

    expect(store.listGHomeWp12()).toHaveLength(2);
    expect(store.listGHomeWp12()[1]).toMatchObject({
      deviceId: "two", networkAddress: "10.0.0.22", localKey: "key-2b",
      runtimeDeviceId: "two",
    });

    store.deleteGHomeWp12("one");
    expect(store.listGHomeWp12()).toEqual([{
      deviceId: "two", networkAddress: "10.0.0.22", localKey: "key-2b",
      runtimeDeviceId: "two",
    }]);
  });

  it("preserves the product identity and detected protocol for a YINMIK Tuya sensor", () => {
    const directory = mkdtempSync(join(tmpdir(), "modreef-credentials-"));
    const path = join(directory, ".env.edge.local");
    const store = new EdgeCredentialStore(path);
    store.saveGHomeWp12({
      deviceId: "yinmik-1",
      networkAddress: "10.0.0.236",
      localKey: "sensor-local-key",
      productId: "u5xgcpcngk3pfxb4",
      deviceKind: "yinmik-water",
      protocolVersion: "3.5",
    });

    expect(store.listGHomeWp12()).toEqual([{
      deviceId: "yinmik-1",
      networkAddress: "10.0.0.236",
      localKey: "sensor-local-key",
      productId: "u5xgcpcngk3pfxb4",
      deviceKind: "yinmik-water",
      protocolVersion: "3.5",
    }]);
  });

});
