import { describe, expect, it } from "vitest";

import {
  OnboardingSession,
  type OnboardingCandidate,
  type OnboardingTransport,
} from "../src/index";

const candidate: OnboardingCandidate = {
  id: "ble-device-1",
  transport: "bluetooth-le",
  displayName: "Nearby smart outlet",
  signalStrength: -42,
  serviceUuids: [],
};

class SimulatedBleTransport implements OnboardingTransport {
  readonly kind = "bluetooth-le" as const;

  async scan() {
    return [candidate];
  }

  async provision(
    selected: OnboardingCandidate,
    credentials: {
      ssid: string;
      password: string;
    },
  ) {
    return {
      candidateId: selected.id,
      accepted: credentials.ssid.length > 0,
      deviceId: "simulated-device",
      message: "Device joined Wi-Fi",
    };
  }
}

describe("OnboardingSession", () => {
  it("discovers and provisions through a transport boundary", async () => {
    const session = new OnboardingSession(
      new SimulatedBleTransport(),
    );

    expect(await session.scan()).toEqual({
      status: "selecting",
      candidates: [candidate],
    });

    const result = await session.provision(candidate, {
      ssid: "reef-network",
      password: "secret",
    });

    expect(result.status).toBe("completed");
    expect(session.getState()).toEqual(result);
  });
});
