import { describe, expect, it } from "vitest";

import {
  assertCommandSupported,
  getChannelCapability,
  type DeviceDescriptor,
} from "../src/index";

const descriptor: DeviceDescriptor = {
  id: "test-strip",
  driverId: "test-driver",
  manufacturer: "modREEF",
  model: "Test Strip",
  displayName: "Test Smart Strip",
  protocol: "simulator",
  channels: [
    {
      id: "outlet-1",
      name: "Outlet 1",
      channelNumber: 1,
      capabilities: [
        {
          kind: "relay",
          executionLocation: "device",
          internetRequired: false,
          reportsState: true,
          supportsAutoOff: true,
          minimumAutoOffSeconds: 1,
          maximumAutoOffSeconds: 3600,
        },
        {
          kind: "schedule",
          executionLocation: "device",
          internetRequired: false,
          runsWithoutApp: true,
          runsWithoutInternet: true,
          timingResolutionSeconds: 1,
          maximumEvents: 20,
          supportsWeekdays: true,
          survivesPowerLoss: true,
        },
      ],
    },
  ],
};

describe("getChannelCapability", () => {
  it("returns the requested capability", () => {
    const channel = descriptor.channels[0];

    expect(channel).toBeDefined();

    const relay = getChannelCapability(channel!, "relay");

    expect(relay?.kind).toBe("relay");
    expect(relay?.reportsState).toBe(true);
  });

  it("returns undefined when the capability is absent", () => {
    const channel = descriptor.channels[0];

    expect(channel).toBeDefined();

    expect(
      getChannelCapability(channel!, "power-monitoring"),
    ).toBeUndefined();
  });
});

describe("assertCommandSupported", () => {
  it("accepts a supported relay command", () => {
    expect(() =>
      assertCommandSupported(descriptor, {
        type: "set-relay",
        deviceId: "test-strip",
        channelId: "outlet-1",
        on: true,
      }),
    ).not.toThrow();
  });

  it("accepts a schedule command when scheduling is supported", () => {
    expect(() =>
      assertCommandSupported(descriptor, {
        type: "replace-schedule",
        deviceId: "test-strip",
        events: [],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown channel", () => {
    expect(() =>
      assertCommandSupported(descriptor, {
        type: "set-relay",
        deviceId: "test-strip",
        channelId: "missing-outlet",
        on: true,
      }),
    ).toThrow("Channel not found: test-strip/missing-outlet");
  });

  it("rejects an unsupported capability", () => {
    expect(() =>
      assertCommandSupported(descriptor, {
        type: "set-speed",
        deviceId: "test-strip",
        channelId: "outlet-1",
        percent: 50,
      }),
    ).toThrow(
      "Channel outlet-1 does not support variable-speed",
    );
  });
});
