import type { ChannelState, DeviceState } from "@modreef/hal";
import type { TuyaDps } from "./transport.js";

export function mapGHomeWp12State(
  deviceId: string,
  dps: TuyaDps,
): DeviceState {
  const channels: Record<string, ChannelState> = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [
      `outlet-${index + 1}`,
      { relayOn: dps[String(index + 1)] === true },
    ]),
  );

  channels.usb = {
    relayOn: dps["7"] === true,
  };

  channels.mains =
    typeof dps["20"] === "number"
      ? { volts: dps["20"] / 10 }
      : {};

  return {
    deviceId,
    connectionState: "connected",
    observedAt: new Date().toISOString(),
    channels,
  };
}
