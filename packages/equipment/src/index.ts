import {
  getEquipmentById,
  setEquipmentEnabled,
  setEquipmentSpeed,
  type AquariumDigitalTwin,
  type Equipment,
} from "@modreef/digital-twin";

import type {
  DeviceDriver,
  DeviceState,
} from "@modreef/hal";

export type EquipmentOperationalState =
  | "off"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "unknown"
  | "disconnected";

export interface EquipmentControlResult {
  twin: AquariumDigitalTwin;
  equipment: Equipment;
  operationalState: EquipmentOperationalState;
  confirmedDeviceState?: DeviceState;
  message: string;
}

export interface EquipmentControllerOptions {
  commandTimeoutMs?: number;
}

export class EquipmentController {
  private readonly drivers = new Map<string, DeviceDriver>();
  private readonly commandTimeoutMs: number;

  constructor(
    drivers: DeviceDriver[],
    options: EquipmentControllerOptions = {},
  ) {
    for (const driver of drivers) {
      this.drivers.set(driver.id, driver);
    }

    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
  }

  async connectBoundEquipment(
    twin: AquariumDigitalTwin,
  ): Promise<void> {
    const connections = new Map<
      string,
      {
        driver: DeviceDriver;
        deviceId: string;
      }
    >();

    for (const equipment of twin.equipment) {
      const binding = equipment.binding;

      if (!binding) {
        continue;
      }

      const driver = this.drivers.get(binding.driverId);

      if (!driver) {
        continue;
      }

      const key = `${binding.driverId}:${binding.deviceId}`;

      connections.set(key, {
        driver,
        deviceId: binding.deviceId,
      });
    }

    await Promise.all(
      [...connections.values()].map(({ driver, deviceId }) =>
        driver.connect(deviceId),
      ),
    );
  }

  async disconnectBoundEquipment(
    twin: AquariumDigitalTwin,
  ): Promise<void> {
    const connections = new Map<
      string,
      {
        driver: DeviceDriver;
        deviceId: string;
      }
    >();

    for (const equipment of twin.equipment) {
      const binding = equipment.binding;

      if (!binding) {
        continue;
      }

      const driver = this.drivers.get(binding.driverId);

      if (!driver) {
        continue;
      }

      const key = `${binding.driverId}:${binding.deviceId}`;

      connections.set(key, {
        driver,
        deviceId: binding.deviceId,
      });
    }

    await Promise.all(
      [...connections.values()].map(({ driver, deviceId }) =>
        driver.disconnect(deviceId),
      ),
    );
  }

  async setPower(
    twin: AquariumDigitalTwin,
    equipmentId: string,
    on: boolean,
  ): Promise<EquipmentControlResult> {
    const equipment = getEquipmentById(twin, equipmentId);

    if (!equipment) {
      throw new Error(`Equipment not found: ${equipmentId}`);
    }

    const binding = equipment.binding;

    if (!binding) {
      throw new Error(
        `Equipment is not bound to a device: ${equipmentId}`,
      );
    }

    if (binding.capability !== "power" && binding.capability !== "speed") {
      throw new Error(
        `Equipment does not have a power binding: ${equipmentId}`,
      );
    }

    if (!binding.channelId) {
      throw new Error(
        `Equipment power binding has no channel: ${equipmentId}`,
      );
    }

    // Turning an unreachable device on must always require confirmation. An
    // OFF request is different: it is safe to persist as the desired state so
    // the UI is not trapped showing stale ON data, and automation can enforce
    // OFF as soon as the device reconnects.
    if (!on && equipment.connectionStatus === "offline") {
      const updatedTwin = setEquipmentEnabled(twin, equipmentId, false);
      const updatedEquipment = getEquipmentById(updatedTwin, equipmentId)!;
      return {
        twin: updatedTwin,
        equipment: updatedEquipment,
        operationalState: "disconnected",
        message: `${equipment.name} is offline; OFF was saved and will be enforced when it reconnects`,
      };
    }

    const driver = this.drivers.get(binding.driverId);

    if (!driver) {
      throw new Error(
        `Driver not registered: ${binding.driverId}`,
      );
    }

    const result = await withTimeout(
      driver.execute({
        type: "set-relay",
        deviceId: binding.deviceId,
        channelId: binding.channelId,
        on,
      }),
      this.commandTimeoutMs,
      `Timed out controlling ${equipment.name}`,
    );

    if (!result.accepted) {
      throw new Error(
        result.message ?? `Command rejected for ${equipment.name}`,
      );
    }

    if (!result.completed) {
      throw new Error(
        result.message ?? `Command was not completed for ${equipment.name}`,
      );
    }

    const confirmedState = result.resultingState;
    const channelState =
      confirmedState?.channels[binding.channelId];

    if (!confirmedState || channelState?.relayOn !== on) {
      throw new Error(
        `Device did not confirm ${equipment.name} ${
          on ? "on" : "off"
        }`,
      );
    }

    const updatedTwin = setEquipmentEnabled(
      twin,
      equipmentId,
      on,
    );

    const updatedEquipment = getEquipmentById(
      updatedTwin,
      equipmentId,
    );

    if (!updatedEquipment) {
      throw new Error(
        `Equipment disappeared after update: ${equipmentId}`,
      );
    }

    return {
      twin: updatedTwin,
      equipment: updatedEquipment,
      operationalState: on ? "running" : "off",
      confirmedDeviceState: confirmedState,
      message: `${equipment.name} confirmed ${
        on ? "running" : "off"
      }`,
    };
  }

  async setSpeed(
    twin: AquariumDigitalTwin,
    equipmentId: string,
    percent: number,
  ): Promise<EquipmentControlResult> {
    const equipment = getEquipmentById(twin, equipmentId);
    if (!equipment) throw new Error(`Equipment not found: ${equipmentId}`);
    const binding = equipment.binding;
    if (!binding || binding.capability !== "speed" || !binding.channelId) {
      throw new Error(`Equipment does not have a speed binding: ${equipmentId}`);
    }
    const driver = this.drivers.get(binding.driverId);
    if (!driver) throw new Error(`Driver not registered: ${binding.driverId}`);
    const descriptor = await driver.getDescriptor(binding.deviceId);
    const channel = descriptor.channels.find(({ id }) => id === binding.channelId);
    const capability = channel?.capabilities.find((item) => item.kind === "variable-speed");
    if (!capability) throw new Error(`Speed control is unavailable for ${equipment.name}`);
    if (!Number.isInteger(percent) || percent < capability.minimumPercent || percent > capability.maximumPercent) {
      throw new Error(`${equipment.name} speed must be ${capability.minimumPercent}-${capability.maximumPercent}%`);
    }
    const result = await withTimeout(driver.execute({
      type: "set-speed",
      deviceId: binding.deviceId,
      channelId: binding.channelId,
      percent,
    }), this.commandTimeoutMs, `Timed out setting speed for ${equipment.name}`);
    const confirmedState = result.resultingState;
    if (!result.accepted || !result.completed ||
      confirmedState?.channels[binding.channelId]?.speedPercent !== percent) {
      throw new Error(result.message ?? `Device did not confirm ${equipment.name} at ${percent}%`);
    }
    const updatedTwin = setEquipmentSpeed(twin, equipmentId, percent);
    const updatedEquipment = getEquipmentById(updatedTwin, equipmentId)!;
    return {
      twin: updatedTwin,
      equipment: updatedEquipment,
      operationalState: updatedEquipment.enabled ? "running" : "off",
      confirmedDeviceState: confirmedState,
      message: `${equipment.name} confirmed at ${percent}%`,
    };
  }

  async startDose(
    twin: AquariumDigitalTwin,
    equipmentId: string,
    runtimeSeconds: number,
  ): Promise<EquipmentControlResult> {
    const equipment = getEquipmentById(twin, equipmentId);

    if (!equipment) {
      throw new Error(`Equipment not found: ${equipmentId}`);
    }

    if (equipment.programType !== "dosing-pump") {
      throw new Error(
        `Equipment is not configured as a doser: ${equipmentId}`,
      );
    }

    if (!Number.isInteger(runtimeSeconds) || runtimeSeconds < 1) {
      throw new Error("Dose runtime must be a positive integer");
    }

    const binding = equipment.binding;

    if (!binding || binding.capability !== "power" || !binding.channelId) {
      throw new Error(
        `Doser requires a bound power channel: ${equipmentId}`,
      );
    }

    const driver = this.drivers.get(binding.driverId);

    if (!driver) {
      throw new Error(`Driver not registered: ${binding.driverId}`);
    }

    const descriptor = await driver.getDescriptor(binding.deviceId);
    const channel = descriptor.channels.find(
      (candidate) => candidate.id === binding.channelId,
    );
    const countdown = channel?.capabilities.find(
      (capability) => capability.kind === "countdown",
    );

    if (
      !countdown ||
      countdown.executionLocation !== "device" ||
      !countdown.runsWithoutApp ||
      runtimeSeconds < countdown.minimumSeconds ||
      runtimeSeconds > countdown.maximumSeconds
    ) {
      throw new Error(
        `Doser cannot start without a supported device-local countdown: ${equipment.name}`,
      );
    }

    const result = await withTimeout(
      driver.execute({
        type: "start-countdown",
        deviceId: binding.deviceId,
        channelId: binding.channelId,
        seconds: runtimeSeconds,
        finalRelayState: false,
      }),
      this.commandTimeoutMs,
      `Timed out starting dose for ${equipment.name}`,
    );

    if (!result.accepted || !result.completed) {
      throw new Error(
        result.message ?? `Failsafe dose command failed for ${equipment.name}`,
      );
    }

    const confirmedState = result.resultingState;
    const channelState = confirmedState?.channels[binding.channelId];

    if (!confirmedState || channelState?.relayOn !== true) {
      throw new Error(
        `Device did not confirm ${equipment.name} running`,
      );
    }

    const updatedTwin = setEquipmentEnabled(twin, equipmentId, true);
    const updatedEquipment = getEquipmentById(updatedTwin, equipmentId);

    if (!updatedEquipment) {
      throw new Error(
        `Equipment disappeared after update: ${equipmentId}`,
      );
    }

    return {
      twin: updatedTwin,
      equipment: updatedEquipment,
      operationalState: "running",
      confirmedDeviceState: confirmedState,
      message: `${equipment.name} confirmed running with a ${runtimeSeconds}-second device failsafe`,
    };
  }

  getDriver(driverId: string): DeviceDriver | undefined {
    return this.drivers.get(driverId);
  }
}

export function getTransitionalState(
  requestedOn: boolean,
): EquipmentOperationalState {
  return requestedOn ? "starting" : "stopping";
}

export function getStableOperationalState(
  equipment: Equipment,
): EquipmentOperationalState {
  if (equipment.connectionStatus === "offline") {
    return "disconnected";
  }

  if (equipment.connectionStatus === "unknown") {
    return "unknown";
  }

  return equipment.enabled ? "running" : "off";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
