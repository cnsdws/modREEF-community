import type { AquariumDigitalTwin, Equipment } from "@modreef/digital-twin";

function bindingClass(equipment: Equipment): string | undefined {
  const binding = equipment.binding;
  if (!binding?.channelId || binding.capability !== "power") return undefined;
  const channelClass = binding.channelId.toLowerCase().startsWith("usb")
    ? "usb"
    : "outlet";
  return `${binding.capability}:${channelClass}`;
}

function compatiblePair(
  twin: AquariumDigitalTwin,
  firstId: string,
  secondId: string,
): [Equipment, Equipment] {
  const first = twin.equipment.find((item) => item.id === firstId);
  const second = twin.equipment.find((item) => item.id === secondId);
  if (!first || !second) throw new Error("Equipment not found");
  if (first.id === second.id) throw new Error("Choose a different outlet");
  const firstClass = bindingClass(first);
  if (!firstClass || firstClass !== bindingClass(second)) {
    throw new Error("Outlets must have compatible physical connection types");
  }
  return [first, second];
}

export function cloneEquipmentConfigurationInTwin(
  twin: AquariumDigitalTwin,
  sourceId: string,
  destinationId: string,
  name: string,
): AquariumDigitalTwin {
  const [source] = compatiblePair(twin, sourceId, destinationId);
  return {
    ...twin,
    equipment: twin.equipment.map((item) => {
      if (item.id !== destinationId) return item;
      const {
        role: _role,
        programType: _programType,
        automaticRestartDelaySeconds: _automaticRestartDelaySeconds,
        schedule: _schedule,
        speedSchedule: _speedSchedule,
        intervalProgram: _intervalProgram,
        advancedOutletProgram: _advancedOutletProgram,
        doserCalibration: _doserCalibration,
        dosingParameter: _dosingParameter,
        dosingParameterName: _dosingParameterName,
        feedCycleParticipation: _feedCycleParticipation,
        ...destination
      } = item;
      const configurable = structuredClone({
        role: source.role,
        ...(source.programType ? { programType: source.programType } : {}),
        ...(source.automaticRestartDelaySeconds !== undefined
          ? { automaticRestartDelaySeconds: source.automaticRestartDelaySeconds }
          : {}),
        ...(source.schedule ? { schedule: source.schedule } : {}),
        ...(source.speedSchedule ? { speedSchedule: source.speedSchedule } : {}),
        ...(source.intervalProgram ? { intervalProgram: source.intervalProgram } : {}),
        ...(source.advancedOutletProgram
          ? { advancedOutletProgram: source.advancedOutletProgram }
          : {}),
        ...(source.doserCalibration ? { doserCalibration: source.doserCalibration } : {}),
        ...(source.dosingParameter ? { dosingParameter: source.dosingParameter } : {}),
        ...(source.dosingParameterName
          ? { dosingParameterName: source.dosingParameterName }
          : {}),
        ...(source.feedCycleParticipation !== undefined
          ? { feedCycleParticipation: source.feedCycleParticipation }
          : {}),
      });
      if (configurable.schedule) {
        configurable.schedule.events = configurable.schedule.events.map((event) => ({
          ...event,
          id: crypto.randomUUID(),
        }));
      }
      return {
        ...destination,
        name,
        ...configurable,
      };
    }),
  };
}

export function swapEquipmentBindingsInTwin(
  twin: AquariumDigitalTwin,
  firstId: string,
  secondId: string,
): AquariumDigitalTwin {
  const [first, second] = compatiblePair(twin, firstId, secondId);
  const devices = twin.devices ?? [];
  const ownership = (binding: NonNullable<Equipment["binding"]>) => ({
    binding,
    physicalDeviceId: binding.deviceId,
    ...(devices.find(({ id }) => id === binding.deviceId)?.name
      ? { physicalDeviceName: devices.find(({ id }) => id === binding.deviceId)!.name }
      : {}),
    ...(binding.channelId ? { physicalConnectionId: binding.channelId } : {}),
  });
  return {
    ...twin,
    equipment: twin.equipment.map((item) =>
      item.id === firstId
        ? { ...item, ...ownership(second.binding!) }
        : item.id === secondId
          ? { ...item, ...ownership(first.binding!) }
          : item,
    ),
  };
}
