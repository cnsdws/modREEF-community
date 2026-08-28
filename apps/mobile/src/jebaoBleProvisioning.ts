export const jebaoBleServiceUuid = "ABF0";
export const jebaoBleCharacteristicUuid = "ABF7";
export const jebaoBleManufacturerMarker = "jebao-gizwits-ble";
export const jebaoDmpBleManufacturerMarker = "jebao-dmp-ble";

export function isJebaoDmpBleAdvertisement(input: {
  name?: string | null | undefined;
  serviceUuids?: string[];
}): boolean {
  const name = input.name ?? "";
  return /^W_[0-9A-F]{6}$/i.test(name) ||
    /^XPG-GAgent-[0-9A-F]{4}$/i.test(name) ||
    input.serviceUuids?.some((uuid) =>
      uuid.replaceAll("-", "").toUpperCase().includes("F0AB")
    ) === true;
}

export function isJebaoBleAdvertisement(input: {
  name?: string | null | undefined;
  serviceUuids?: string[];
}): boolean {
  return input.name?.toLowerCase().startsWith("jebao_wifi-") === true ||
    input.serviceUuids?.some((uuid) =>
      uuid.replaceAll("-", "").toUpperCase().includes(jebaoBleServiceUuid)
    ) === true;
}

export function buildJebaoBleWifiFrame(
  ssid: string,
  password: string,
): number[] {
  const ssidBytes = [...new TextEncoder().encode(ssid)];
  const passwordBytes = [...new TextEncoder().encode(password)];
  if (ssidBytes.length === 0 || ssidBytes.length > 255) {
    throw new Error("Wi-Fi network name must be 1–255 bytes");
  }
  if (passwordBytes.length < 8 || passwordBytes.length > 255) {
    throw new Error("Wi-Fi password must be 8–255 bytes");
  }

  return [
    0x00, 0x00, 0x00, 0x03,
    (ssidBytes.length + passwordBytes.length + 7) & 0xff,
    0x00, 0x00, 0x01, 0x00,
    ssidBytes.length,
    ...ssidBytes,
    0x00,
    passwordBytes.length,
    ...passwordBytes,
  ];
}

export function chunkJebaoBleWifiFrame(
  frame: number[],
  size = 20,
): number[][] {
  const chunks: number[][] = [];
  for (let offset = 0; offset < frame.length; offset += size) {
    chunks.push(frame.slice(offset, offset + size));
  }
  return chunks;
}
