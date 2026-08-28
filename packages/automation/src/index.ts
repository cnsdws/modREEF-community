import {
  getEquipmentControlMode,
  type AquariumDigitalTwin,
  type Equipment,
  type EquipmentRole,
} from "@modreef/digital-twin";

export * from "./advanced-outlet-evaluator";
export * from "./advanced-outlet-safety";

export interface FeedModeAction {
  equipmentId: string;
  turnOff: true;
  restoreOnCompletion: boolean;
  restoreDelaySeconds: number;
}

export interface FeedModeSpeedAction {
  equipmentId: string;
  feedSpeedPercent: number;
  restoreSpeedPercent: number;
}

export interface FeedModePlan {
  id: string;
  intent: "feed-mode";
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  /** Selected user preset. Older persisted cycles predate this field. */
  cycleId?: "A" | "B" | "C";
  actions: FeedModeAction[];
  speedActions?: FeedModeSpeedAction[];
  phase: "feeding" | "recovery";
  completionReason?: "completed" | "cancelled";
  recoveryStartedAt?: string;
  recoveryEndsAt?: string;
  restoredEquipmentIds?: string[];
}

export interface FeedModeOptions {
  durationSeconds?: number;
  cycleId?: "A" | "B" | "C";
  /** @deprecated Restart delays are configured on individual equipment. */
  skimmerRestartDelaySeconds?: number;
  now?: Date;
}

const feedModeRoles: EquipmentRole[] = [
  "return-pump",
  "skimmer",
];

function feedModeShutdownPriority(equipment: Equipment): number {
  const type = equipment.programType ?? equipment.role;

  if (type === "skimmer") {
    return 0;
  }

  if (type === "return-pump") {
    return 1;
  }

  return 2;
}

export function createFeedModePlan(
  twin: AquariumDigitalTwin,
  options: FeedModeOptions = {},
): FeedModePlan {
  const durationSeconds = options.durationSeconds ?? 300;

  if (durationSeconds < 1 || durationSeconds > 3600) {
    throw new Error(
      "Feed mode duration must be between 1 and 3600 seconds",
    );
  }

  const startedAt = options.now ?? new Date();
  const endsAt = new Date(
    startedAt.getTime() + durationSeconds * 1000,
  );

  const actions = twin.equipment
    .filter(
      (equipment) => {
        const isWavemaker = equipment.role === "circulation-pump" &&
          (equipment.id.startsWith("dmp-") || equipment.physicalDeviceId?.startsWith("dmp-") === true);
        const master = equipment.wavemakerLinkRole === "slave"
          ? twin.equipment.find((item) =>
              item.aquariumId === equipment.aquariumId &&
              item.wavemakerLinkRole === "master"
            )
          : undefined;
        const participatingWavemaker = isWavemaker &&
          (master?.feedCycleParticipation ?? equipment.feedCycleParticipation) !== false;
        return getEquipmentControlMode(equipment) === "auto" &&
          (participatingWavemaker || feedModeRoles.includes(equipment.role) ||
            equipment.programType === "return-pump" ||
            equipment.programType === "skimmer") &&
          (equipment.binding?.capability === "power" || participatingWavemaker);
      },
    )
    .sort(
      (left, right) =>
        feedModeShutdownPriority(left) -
        feedModeShutdownPriority(right),
    )
    .map((equipment) => {
      return {
        equipmentId: equipment.id,
        turnOff: true as const,
        restoreOnCompletion: equipment.enabled,
        restoreDelaySeconds: 0,
      };
    });

  const speedActions = twin.equipment
    .filter(
      (equipment) =>
        getEquipmentControlMode(equipment) === "auto" &&
        (equipment.role === "return-pump" || equipment.programType === "return-pump") &&
        equipment.binding?.capability === "speed" &&
        equipment.speedPercent !== undefined,
    )
    .map((equipment) => ({
      equipmentId: equipment.id,
      feedSpeedPercent: 30,
      restoreSpeedPercent: equipment.speedPercent!,
    }));

  if (actions.length === 0 && speedActions.length === 0) {
    throw new Error(
      "Feed mode requires a return pump or skimmer",
    );
  }

  return {
    id: crypto.randomUUID(),
    intent: "feed-mode",
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationSeconds,
    ...(options.cycleId ? { cycleId: options.cycleId } : {}),
    actions,
    speedActions,
    phase: "feeding",
  };
}

export function shouldRestoreFeedModeAction(
  twin: AquariumDigitalTwin,
  action: FeedModeAction,
): boolean {
  if (!action.restoreOnCompletion) {
    return false;
  }

  const equipment = twin.equipment.find(
    (item) => item.id === action.equipmentId,
  );

  return equipment
    ? getEquipmentControlMode(equipment) === "auto"
    : false;
}

export interface WaterChangeAction {
  equipmentId: string;
  turnOff: true;
  restoreOnCompletion: boolean;
}

export interface WaterChangePlan {
  id: string;
  intent: "water-change";
  startedAt: string;
  actions: WaterChangeAction[];
}

const waterChangeRoles: EquipmentRole[] = [
  "return-pump",
  "skimmer",
  "ato",
];

export function createWaterChangePlan(
  twin: AquariumDigitalTwin,
  now = new Date(),
  configuredEquipmentIds?: ReadonlySet<string>,
): WaterChangePlan {
  const actions = twin.equipment
    .filter(
      (equipment) =>
        getEquipmentControlMode(equipment) === "auto" &&
        (configuredEquipmentIds
          ? configuredEquipmentIds.has(equipment.id)
          : waterChangeRoles.includes(equipment.role) ||
            equipment.programType === "return-pump" ||
            equipment.programType === "skimmer") &&
        equipment.binding?.capability === "power",
    )
    .map((equipment) => ({
      equipmentId: equipment.id,
      turnOff: true as const,
      restoreOnCompletion: equipment.enabled,
    }));

  if (actions.length === 0) {
    throw new Error(
      "Water Change requires an AUTO return pump, skimmer, or ATO",
    );
  }

  return {
    id: crypto.randomUUID(),
    intent: "water-change",
    startedAt: now.toISOString(),
    actions,
  };
}

export function shouldRestoreWaterChangeAction(
  twin: AquariumDigitalTwin,
  action: WaterChangeAction,
): boolean {
  if (!action.restoreOnCompletion) {
    return false;
  }

  const equipment = twin.equipment.find(
    (item) => item.id === action.equipmentId,
  );

  return equipment
    ? getEquipmentControlMode(equipment) === "auto"
    : false;
}


export interface EquipmentScheduleClock {
  weekday: number;
  time: string;
}

export interface RoutinePowerTask {
  id: string;
  type: "power";
  equipmentId: string;
  enabled: boolean;
}

export interface RoutineWaitTask {
  id: string;
  type: "wait";
  durationSeconds: number;
}

export interface RoutineDoseTask {
  id: string;
  type: "dose";
  equipmentId: string;
  milliliters: number;
}

export interface RoutineRestoreTask {
  id: string;
  type: "restore";
}

export interface RoutineHoldTask {
  id: string;
  type: "hold";
}

export type RoutineTask =
  | RoutinePowerTask
  | RoutineWaitTask
  | RoutineDoseTask
  | RoutineHoldTask
  | RoutineRestoreTask;

export interface RoutineDefinition {
  id: string;
  name: string;
  tasks: RoutineTask[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDefinitionInput {
  name: string;
  tasks: RoutineTask[];
}

export interface ActiveRoutineExecution {
  id: string;
  routineId: string;
  name: string;
  startedAt: string;
  taskIndex: number;
  snapshots: Record<string, boolean>;
  holding?: boolean;
  resumeAt?: string;
}

export function validateRoutineDefinitionInput(
  input: RoutineDefinitionInput,
  equipmentIds?: ReadonlySet<string>,
  dosingEquipmentIds?: ReadonlySet<string>,
): void {
  if (!input.name.trim() || input.name.trim().length > 60) {
    throw new Error("Routine name must be between 1 and 60 characters");
  }

  if (input.tasks.length < 1 || input.tasks.length > 50) {
    throw new Error("Routine must contain between 1 and 50 tasks");
  }

  const ids = new Set<string>();

  for (const task of input.tasks) {
    if (!task.id || ids.has(task.id)) {
      throw new Error("Each routine task must have a unique id");
    }

    ids.add(task.id);

    if (task.type === "power") {
      if (!task.equipmentId) {
        throw new Error("Power tasks require equipment");
      }

      if (equipmentIds && !equipmentIds.has(task.equipmentId)) {
        throw new Error(`Equipment is not available: ${task.equipmentId}`);
      }
    } else if (task.type === "dose") {
      if (!task.equipmentId) {
        throw new Error("Dose tasks require a calibrated dosing pump");
      }

      if (
        dosingEquipmentIds &&
        !dosingEquipmentIds.has(task.equipmentId)
      ) {
        throw new Error(
          `Calibrated dosing pump is not available: ${task.equipmentId}`,
        );
      }

      if (
        !Number.isFinite(task.milliliters) ||
        task.milliliters < 0.01 ||
        task.milliliters > 1_000
      ) {
        throw new Error("Dose tasks must be between 0.01 and 1000 mL");
      }
    } else if (task.type === "wait") {
      if (
        !Number.isInteger(task.durationSeconds) ||
        task.durationSeconds < 1 ||
        task.durationSeconds > 86_400
      ) {
        throw new Error("Wait tasks must be between 1 and 86400 seconds");
      }
    } else if (task.type !== "restore" && task.type !== "hold") {
      throw new Error("Unsupported routine task");
    }
  }

  if (input.tasks.filter((task) => task.type === "hold").length > 1) {
    throw new Error("Routine can contain only one Wait until finished task");
  }
}

function minutesFromTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function getScheduledEquipmentState(
  equipment: Equipment,
  clock: EquipmentScheduleClock,
): boolean | undefined {
  if (getEquipmentControlMode(equipment) !== "auto") {
    return undefined;
  }

  if (
    equipment.programType === "always-on" ||
    equipment.programType === "return-pump" ||
    equipment.programType === "skimmer"
  ) {
    return true;
  }

  if (equipment.programType === "heater") {
    return false;
  }

  if (
    (equipment.programType === "dosing-pump" ||
      equipment.programType === "advanced") &&
    equipment.intervalProgram?.enabled
  ) {
    const program = equipment.intervalProgram;

    if (!program.weekdays.includes(clock.weekday)) {
      return false;
    }

    const nowSeconds = minutesFromTime(clock.time) * 60;
    const startSeconds = minutesFromTime(program.startTime) * 60;
    const elapsed =
      (nowSeconds - startSeconds + 24 * 60 * 60) %
      (24 * 60 * 60);
    const cyclePosition = elapsed % program.intervalSeconds;
    const dailyRuns = Math.ceil(
      (24 * 60 * 60) / program.intervalSeconds,
    );

    if (
      dailyRuns * program.durationSeconds >
      program.maximumDailyRuntimeSeconds
    ) {
      return false;
    }

    return cyclePosition < program.durationSeconds;
  }

  if (
    !equipment.schedule?.enabled ||
    equipment.schedule.events.length === 0
  ) {
    return undefined;
  }

  const weekMinutes = 7 * 24 * 60;
  const current =
    clock.weekday * 24 * 60 + minutesFromTime(clock.time);

  const candidates = equipment.schedule.events.flatMap((event) =>
    event.weekdays.map((weekday) => {
      const scheduled =
        weekday * 24 * 60 + minutesFromTime(event.time);

      return {
        desiredEnabled: event.desiredEnabled,
        elapsed:
          (current - scheduled + weekMinutes) % weekMinutes,
      };
    }),
  );

  candidates.sort((left, right) => left.elapsed - right.elapsed);
  return candidates[0]?.desiredEnabled;
}

export function getScheduledEquipmentSpeed(
  equipment: Equipment,
  clock: EquipmentScheduleClock,
): number | undefined {
  if (
    getEquipmentControlMode(equipment) !== "auto" ||
    !equipment.speedSchedule?.enabled ||
    equipment.speedSchedule.events.length === 0
  ) return undefined;

  const weekMinutes = 7 * 24 * 60;
  const current = clock.weekday * 24 * 60 + minutesFromTime(clock.time);
  const occurrences = equipment.speedSchedule.events.flatMap((event) =>
    event.weekdays.map((weekday) => ({
      speedPercent: event.speedPercent,
      scheduled: weekday * 24 * 60 + minutesFromTime(event.time),
    })),
  );
  const previous = occurrences
    .map((event) => ({
      event,
      distance: (current - event.scheduled + weekMinutes) % weekMinutes,
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  const next = occurrences
    .map((event) => {
      const distance = (event.scheduled - current + weekMinutes) % weekMinutes;
      return { event, distance: distance === 0 ? weekMinutes : distance };
    })
    .sort((left, right) => left.distance - right.distance)[0];
  if (!previous || !next) return undefined;
  const span = previous.distance + next.distance;
  if (span === 0) return previous.event.speedPercent;
  const progress = previous.distance / span;
  return Math.round(
    previous.event.speedPercent +
    (next.event.speedPercent - previous.event.speedPercent) * progress,
  );
}
