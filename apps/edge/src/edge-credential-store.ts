import {
  chmodSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

export interface GHomeWp12Credentials {
  deviceId: string;
  networkAddress: string;
  localKey: string;
  runtimeDeviceId?: string;
  productId?: string;
  deviceKind?: "ghome-wp12" | "yinmik-water";
  protocolVersion?: "3.3" | "3.4" | "3.5";
}

const credentialKeys = [
  "GHOME_WP12_DEVICE_ID",
  "GHOME_WP12_IP",
  "GHOME_WP12_LOCAL_KEY",
  "GHOME_WP12_DEVICES_B64",
] as const;

export class EdgeCredentialStore {
  constructor(private readonly path: string) {}

  saveGHomeWp12(credentials: GHomeWp12Credentials): void {
    const credentialsById = new Map(
      this.listGHomeWp12().map((item) => [item.deviceId, item]),
    );
    credentialsById.set(credentials.deviceId, credentials);
    this.writeGHomeWp12([...credentialsById.values()]);
  }

  listGHomeWp12(): GHomeWp12Credentials[] {
    const values = this.readValues();
    const encoded = values.get("GHOME_WP12_DEVICES_B64");
    const devices = encoded ? this.decodeDevices(encoded) : [];
    const legacy = this.legacyCredentials(values);

    if (legacy && !devices.some((item) => item.deviceId === legacy.deviceId)) {
      devices.unshift(legacy);
    }

    return devices;
  }

  deleteGHomeWp12(deviceId: string): void {
    this.writeGHomeWp12(
      this.listGHomeWp12().filter((item) => item.deviceId !== deviceId),
    );
  }

  private writeGHomeWp12(devices: GHomeWp12Credentials[]): void {
    const existing = this.readExisting();

    const retained = existing.filter((line) => {
      const key = line.split("=", 1)[0]?.trim();
      return !credentialKeys.includes(
        key as (typeof credentialKeys)[number],
      );
    });

    const content = [
      ...retained,
      ...(devices[0]
        ? [
            `GHOME_WP12_DEVICE_ID=${devices[0].deviceId}`,
            `GHOME_WP12_IP=${devices[0].networkAddress}`,
            `GHOME_WP12_LOCAL_KEY=${devices[0].localKey}`,
            `GHOME_WP12_DEVICES_B64=${Buffer.from(JSON.stringify(devices)).toString("base64url")}`,
          ]
        : []),
    ].join("\n") + "\n";

    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, this.path);
    chmodSync(this.path, 0o600);
  }

  private readValues(): Map<string, string> {
    return new Map(
      this.readExisting().flatMap((line) => {
        const separator = line.indexOf("=");
        return separator < 1
          ? []
          : [[line.slice(0, separator).trim(), line.slice(separator + 1)]];
      }),
    );
  }

  private legacyCredentials(
    values: Map<string, string>,
  ): GHomeWp12Credentials | null {
    const deviceId = values.get("GHOME_WP12_DEVICE_ID");
    const networkAddress = values.get("GHOME_WP12_IP");
    const localKey = values.get("GHOME_WP12_LOCAL_KEY");
    return deviceId && networkAddress && localKey
      ? { deviceId, networkAddress, localKey }
      : null;
  }

  private decodeDevices(encoded: string): GHomeWp12Credentials[] {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is GHomeWp12Credentials =>
        typeof item === "object" && item !== null &&
        typeof item.deviceId === "string" &&
        typeof item.networkAddress === "string" &&
        typeof item.localKey === "string" &&
        (item.runtimeDeviceId === undefined || typeof item.runtimeDeviceId === "string") &&
        (item.productId === undefined || typeof item.productId === "string") &&
        (item.protocolVersion === undefined ||
          item.protocolVersion === "3.3" ||
          item.protocolVersion === "3.4" ||
          item.protocolVersion === "3.5") &&
        (item.deviceKind === undefined ||
          item.deviceKind === "ghome-wp12" ||
          item.deviceKind === "yinmik-water")
      );
    } catch {
      return [];
    }
  }

  private readExisting(): string[] {
    try {
      return readFileSync(this.path, "utf8")
        .split(/\r?\n/)
        .filter((line) => line !== "");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }
}
