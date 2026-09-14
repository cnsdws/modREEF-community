import {
  applyAdvancedOutletSafety,
  createFeedModePlan,
  createWaterChangePlan,
  evaluateAdvancedOutletProgram,
  getScheduledEquipmentSpeed,
  getScheduledEquipmentState,
  shouldRestoreFeedModeAction,
  shouldRestoreWaterChangeAction,
  validateRoutineDefinitionInput,
  type ActiveRoutineExecution,
  type AdvancedOutletEvaluationInputs,
  type AdvancedOutletRuntimeState,
  type FeedModePlan,
  type RoutineDefinition,
  type RoutineDefinitionInput,
  type RoutineTask,
  type WaterChangePlan,
} from "@modreef/automation";
import {
  getDosingRuntimeSeconds,
  getEquipmentControlMode,
  isAdvancedOutletProgram,
  type AquariumDigitalTwin,
  type Equipment,
} from "@modreef/digital-twin";

import {
  getTwin,
  initializeEquipment,
  recordAquariumActivity,
  runtimeStore,
  setEquipmentPower,
  setEquipmentSpeed,
  startEquipmentDose,
} from "./equipment-runtime.js";
import {
  trackMd44ScheduledDoses,
  type Md44DoseTrackerState,
} from "./md44-dose-tracker.js";

const stateKey = "active-feed-mode";
const waterChangeStateKey = "active-water-change";
const waterChangeRoutineStateKey = "water-change-routine";
const waterChangeRoutineMigratedStateKey = "water-change-routine-migrated";
const customRoutinesStateKey = "custom-routines";
const activeCustomRoutineStateKey = "active-custom-routine";
const pendingAutomaticRestartsStateKey = "pending-automatic-restarts";
const advancedOutletRuntimeStateKeyPrefix = "advanced-outlet-runtime:";
const retryDelayMs = 5_000;
const scheduleIntervalMs = 1_000;
const md44DoseTrackerStateKey = "md44-scheduled-dose-tracker-v2";

function normalizeFeedModePlan(
  plan: FeedModePlan | undefined,
): FeedModePlan | undefined {
  if (!plan) {
    return undefined;
  }

  return {
    ...plan,
    phase: plan.phase ?? "feeding",
    actions: plan.actions.map((action) => ({
      ...action,
      restoreDelaySeconds: action.restoreDelaySeconds ?? 0,
    })),
    speedActions: plan.speedActions ?? [],
  };
}

let activePlan = normalizeFeedModePlan(
  runtimeStore.loadState<FeedModePlan>(stateKey),
);
let activeWaterChange =
  runtimeStore.loadState<WaterChangePlan>(waterChangeStateKey);
let waterChangeRoutine =
  runtimeStore.loadState<RoutineDefinition>(waterChangeRoutineStateKey);
let waterChangeRoutineMigrated =
  runtimeStore.loadState<boolean>(waterChangeRoutineMigratedStateKey) ?? false;
let customRoutines =
  runtimeStore.loadState<RoutineDefinition[]>(customRoutinesStateKey) ?? [];
let activeCustomRoutine =
  runtimeStore.loadState<ActiveRoutineExecution>(activeCustomRoutineStateKey);

interface PendingAutomaticRestart {
  equipmentId: string;
  dueAt: string;
  reason: string;
}

let pendingAutomaticRestarts =
  runtimeStore.loadState<PendingAutomaticRestart[]>(
    pendingAutomaticRestartsStateKey,
  ) ?? [];

let timer: ReturnType<typeof setTimeout> | undefined;
let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
let scheduleRunning = false;
let customRoutineTimer: ReturnType<typeof setTimeout> | undefined;
const automationStartedAt = performance.now();
let lastScheduleCompletedAt: number | undefined;
let lastScheduleError: string | undefined;

export interface AutomationRuntimeHealth {
  startedAt: number;
  running: boolean;
  lastCompletedAt?: number;
  lastError?: string;
}

export function getAutomationRuntimeHealth(): AutomationRuntimeHealth {
  return {
    startedAt: automationStartedAt,
    running: scheduleRunning,
    ...(lastScheduleCompletedAt === undefined
      ? {}
      : { lastCompletedAt: lastScheduleCompletedAt }),
    ...(lastScheduleError === undefined
      ? {}
      : { lastError: lastScheduleError }),
  };
}

function savePendingAutomaticRestarts(): void {
  if (pendingAutomaticRestarts.length === 0) {
    runtimeStore.deleteState(pendingAutomaticRestartsStateKey);
  } else {
    runtimeStore.saveState(
      pendingAutomaticRestartsStateKey,
      pendingAutomaticRestarts,
    );
  }
}

export function cancelPendingAutomaticRestart(equipmentId: string): void {
  const remaining = pendingAutomaticRestarts.filter(
    (item) => item.equipmentId !== equipmentId,
  );
  if (remaining.length !== pendingAutomaticRestarts.length) {
    pendingAutomaticRestarts = remaining;
    savePendingAutomaticRestarts();
  }
}

function taskEquipmentId(task: RoutineTask): string | undefined {
  return task.type === "power" || task.type === "dose"
    ? task.equipmentId
    : undefined;
}

/**
 * Removes durable automation references before their owning equipment channels
 * are deleted. Active workflows are rejected so a delete cannot strand an
 * in-progress restore operation.
 */
export function prepareEquipmentRemoval(equipmentIds: readonly string[]): void {
  const removing = new Set(equipmentIds);
  const activeReferences = [
    ...(activePlan?.actions ?? []).map(({ equipmentId }) => equipmentId),
    ...(activePlan?.speedActions ?? []).map(({ equipmentId }) => equipmentId),
    ...(activeWaterChange?.actions ?? []).map(({ equipmentId }) => equipmentId),
    ...Object.keys(activeCustomRoutine?.snapshots ?? {}),
  ].filter((equipmentId) => removing.has(equipmentId));
  if (activeReferences.length > 0) {
    throw new Error(
      `Finish the active automation before removing equipment: ${[
        ...new Set(activeReferences),
      ].join(", ")}`,
    );
  }

  for (const equipmentId of removing) {
    cancelPendingAutomaticRestart(equipmentId);
    runtimeStore.deleteState(advancedRuntimeStateKey(equipmentId));
  }

  const tracker = runtimeStore.loadState<Md44DoseTrackerState>(
    md44DoseTrackerStateKey,
  ) ?? {};
  let trackerChanged = false;
  for (const equipmentId of removing) {
    if (tracker[equipmentId]) {
      delete tracker[equipmentId];
      trackerChanged = true;
    }
  }
  if (trackerChanged) runtimeStore.saveState(md44DoseTrackerStateKey, tracker);

  if (waterChangeRoutine) {
    const tasks = waterChangeRoutine.tasks.filter(
      (task) => !removing.has(taskEquipmentId(task) ?? ""),
    );
    if (tasks.length !== waterChangeRoutine.tasks.length) {
      waterChangeRoutine = { ...waterChangeRoutine, tasks };
      runtimeStore.saveState(waterChangeRoutineStateKey, waterChangeRoutine);
    }
  }

  let routinesChanged = false;
  customRoutines = customRoutines.map((routine) => {
    const tasks = routine.tasks.filter(
      (task) => !removing.has(taskEquipmentId(task) ?? ""),
    );
    if (tasks.length === routine.tasks.length) return routine;
    routinesChanged = true;
    return { ...routine, tasks, updatedAt: new Date().toISOString() };
  });
  if (routinesChanged) saveCustomRoutines();
}

async function restoreEquipmentAfterAutomation(
  equipmentId: string,
  reason: string,
): Promise<void> {
  const equipment = getTwin().equipment.find((item) => item.id === equipmentId);
  if (!equipment || getEquipmentControlMode(equipment) !== "auto") return;

  const delaySeconds = equipment.automaticRestartDelaySeconds ?? 0;
  cancelPendingAutomaticRestart(equipmentId);
  if (delaySeconds === 0) {
    await setEquipmentPower(equipmentId, true, {
      source: "automation",
      category: "equipment",
      action: "automatic-restart",
      details: reason,
    });
    return;
  }

  pendingAutomaticRestarts.push({
    equipmentId,
    dueAt: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
    reason,
  });
  savePendingAutomaticRestarts();
}

async function applyPendingAutomaticRestarts(now: Date): Promise<void> {
  const due = pendingAutomaticRestarts.filter(
    (item) => Date.parse(item.dueAt) <= now.getTime(),
  );
  for (const item of due) {
    const equipment = getTwin().equipment.find(
      (candidate) => candidate.id === item.equipmentId,
    );
    if (equipment && getEquipmentControlMode(equipment) === "auto") {
      await setEquipmentPower(item.equipmentId, true, {
        source: "automation",
        category: "equipment",
        action: "automatic-restart",
        details: item.reason,
      });
    }
    cancelPendingAutomaticRestart(item.equipmentId);
  }
}

function saveCustomRoutines(): void {
  runtimeStore.saveState(customRoutinesStateKey, customRoutines);
}

function powerEquipmentIds(): Set<string> {
  return new Set(
    getTwin().equipment
      .filter((equipment) => equipment.binding?.capability === "power")
      .map((equipment) => equipment.id),
  );
}

function dosingEquipmentIds(): Set<string> {
  return new Set(
    getTwin().equipment
      .filter(
        (equipment) =>
          equipment.programType === "dosing-pump" &&
          equipment.binding?.capability === "power" &&
          equipment.doserCalibration !== undefined,
      )
      .map((equipment) => equipment.id),
  );
}

function defaultWaterChangeRoutine(): RoutineDefinition {
  const now = new Date().toISOString();
  const tasks = getTwin().equipment
    .filter(
      (equipment) =>
        equipment.binding?.capability === "power" &&
        (equipment.role === "return-pump" ||
          equipment.role === "skimmer" ||
          equipment.role === "ato" ||
          equipment.programType === "return-pump" ||
          equipment.programType === "skimmer"),
    )
    .map((equipment) => ({
      id: crypto.randomUUID(),
      type: "power" as const,
      equipmentId: equipment.id,
      enabled: false,
    }));

  return {
    id: "water-change",
    name: "Water Change",
    tasks: [
      ...tasks,
      { id: crypto.randomUUID(), type: "hold" as const },
      { id: crypto.randomUUID(), type: "restore" as const },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function ensureWaterChangeRoutineMigrated(): void {
  if (waterChangeRoutineMigrated) return;

  const existingIndex = customRoutines.findIndex(
    (routine) => routine.id === "water-change",
  );
  const source = existingIndex >= 0
    ? customRoutines[existingIndex]!
    : waterChangeRoutine ?? defaultWaterChangeRoutine();
  const tasks: RoutineTask[] = source.tasks.some((task) => task.type === "hold")
    ? source.tasks
    : source.tasks.reduce<RoutineTask[]>((migrated, task) => {
      if (task.type === "restore") {
        migrated.push({ id: crypto.randomUUID(), type: "hold" });
      }
      migrated.push(task);
      return migrated;
    }, []);

  if (existingIndex >= 0) {
    customRoutines = customRoutines.map((routine, index) =>
      index === existingIndex ? { ...source, tasks } : routine
    );
    saveCustomRoutines();
  } else {
    customRoutines = [{ ...source, tasks }, ...customRoutines];
    saveCustomRoutines();
  }

  waterChangeRoutineMigrated = true;
  runtimeStore.saveState(waterChangeRoutineMigratedStateKey, true);
}

export function getWaterChangeRoutine(): RoutineDefinition | undefined {
  ensureWaterChangeRoutineMigrated();
  const routine = customRoutines.find((item) => item.id === "water-change");
  return routine ? structuredClone(routine) : undefined;
}

export function updateWaterChangeRoutine(
  input: RoutineDefinitionInput,
): RoutineDefinition {
  return updateCustomRoutine("water-change", input);
}

export function getCustomRoutines(): RoutineDefinition[] {
  ensureWaterChangeRoutineMigrated();
  return structuredClone(customRoutines);
}

export function createCustomRoutine(
  input: RoutineDefinitionInput,
): RoutineDefinition {
  ensureWaterChangeRoutineMigrated();
  validateRoutineDefinitionInput(
    input,
    powerEquipmentIds(),
    dosingEquipmentIds(),
  );
  const now = new Date().toISOString();
  const routine: RoutineDefinition = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    tasks: structuredClone(input.tasks),
    createdAt: now,
    updatedAt: now,
  };

  customRoutines = [...customRoutines, routine];
  saveCustomRoutines();
  return structuredClone(routine);
}

export function updateCustomRoutine(
  routineId: string,
  input: RoutineDefinitionInput,
): RoutineDefinition {
  ensureWaterChangeRoutineMigrated();
  if (activeCustomRoutine?.routineId === routineId) {
    throw new Error("Finish the active routine before editing it");
  }

  validateRoutineDefinitionInput(
    input,
    powerEquipmentIds(),
    dosingEquipmentIds(),
  );
  const index = customRoutines.findIndex((item) => item.id === routineId);

  if (index < 0) {
    throw new Error("Routine not found");
  }

  const existing = customRoutines[index]!;
  const updated: RoutineDefinition = {
    ...existing,
    name: input.name.trim(),
    tasks: structuredClone(input.tasks),
    updatedAt: new Date().toISOString(),
  };

  customRoutines = customRoutines.map((item) =>
    item.id === routineId ? updated : item,
  );
  saveCustomRoutines();
  return structuredClone(updated);
}

export function deleteCustomRoutine(routineId: string): void {
  ensureWaterChangeRoutineMigrated();
  if (activeCustomRoutine?.routineId === routineId) {
    throw new Error("Finish the active routine before deleting it");
  }

  const next = customRoutines.filter((item) => item.id !== routineId);

  if (next.length === customRoutines.length) {
    throw new Error("Routine not found");
  }

  customRoutines = next;
  saveCustomRoutines();
}

function scheduleCustomRoutine(delayMs: number): void {
  if (customRoutineTimer) {
    clearTimeout(customRoutineTimer);
  }

  customRoutineTimer = setTimeout(() => {
    void continueCustomRoutine().catch((error) => {
      console.error("Unable to continue custom routine:", error);
      scheduleCustomRoutine(retryDelayMs);
    });
  }, Math.max(0, delayMs));
}

async function restoreCustomRoutineSnapshots(
  execution: ActiveRoutineExecution,
): Promise<void> {
  for (const [equipmentId, enabled] of Object.entries(execution.snapshots)) {
    const equipment = getTwin().equipment.find((item) => item.id === equipmentId);

    if (equipment && getEquipmentControlMode(equipment) === "auto") {
      if (enabled) {
        await restoreEquipmentAfterAutomation(
          equipmentId,
          `Restarted after ${execution.name}`,
        );
      } else {
        await setEquipmentPower(equipmentId, false, {
          source: "automation",
          category: "routine",
          action: "restored-by-routine",
          details: `Restored by ${execution.name}`,
        });
      }
    }
  }
}

async function finalizeCustomRoutine(
  status: "completed" | "cancelled",
): Promise<void> {
  const execution = activeCustomRoutine;

  if (!execution) {
    return;
  }

  if (status === "cancelled") {
    await restoreCustomRoutineSnapshots(execution);
  }

  if (customRoutineTimer) {
    clearTimeout(customRoutineTimer);
    customRoutineTimer = undefined;
  }

  activeCustomRoutine = undefined;
  runtimeStore.deleteState(activeCustomRoutineStateKey);
  recordAquariumActivity({
    source: "automation",
    category: "routine",
    action: status,
    title: `${execution.name} ${status}`,
    details: `${execution.taskIndex} task${execution.taskIndex === 1 ? "" : "s"} processed`,
  });
}

async function continueCustomRoutine(): Promise<void> {
  const execution = activeCustomRoutine;

  if (!execution) {
    return;
  }

  const routine = customRoutines.find((item) => item.id === execution.routineId);

  if (!routine) {
    await finalizeCustomRoutine("cancelled");
    return;
  }

  while (execution.taskIndex < routine.tasks.length) {
    const task = routine.tasks[execution.taskIndex]!;

    if (task.type === "wait") {
      if (!execution.resumeAt) {
        execution.resumeAt = new Date(
          Date.now() + task.durationSeconds * 1000,
        ).toISOString();
        runtimeStore.saveState(activeCustomRoutineStateKey, execution);
      }

      const remaining = new Date(execution.resumeAt).getTime() - Date.now();

      if (remaining > 0) {
        scheduleCustomRoutine(remaining);
        return;
      }

      delete execution.resumeAt;
    } else if (task.type === "dose") {
      const equipment = getTwin().equipment.find(
        (item) => item.id === task.equipmentId,
      );
      const calibration = equipment?.doserCalibration;

      if (
        !equipment ||
        equipment.programType !== "dosing-pump" ||
        !calibration
      ) {
        throw new Error(
          `Calibrated dosing pump is not available: ${task.equipmentId}`,
        );
      }

      if (!(task.equipmentId in execution.snapshots)) {
        execution.snapshots[task.equipmentId] = equipment.enabled;
      }

      if (!execution.resumeAt) {
        const runtimeSeconds = getDosingRuntimeSeconds(
          calibration,
          task.milliliters,
        );

        await startEquipmentDose(task.equipmentId, runtimeSeconds, {
          source: "automation",
          category: "routine",
          action: "dosed-by-routine",
          requestedDoseMilliliters: task.milliliters,
          details: `${task.milliliters} mL requested by ${execution.name}`,
        });
        execution.resumeAt = new Date(
          Date.now() + runtimeSeconds * 1000,
        ).toISOString();
        runtimeStore.saveState(activeCustomRoutineStateKey, execution);
      }

      const remaining = new Date(execution.resumeAt).getTime() - Date.now();

      if (remaining > 0) {
        scheduleCustomRoutine(remaining);
        return;
      }

      delete execution.resumeAt;
      await setEquipmentPower(task.equipmentId, false, {
        source: "automation",
        category: "routine",
        action: "dose-completed-by-routine",
        details: `${task.milliliters} mL dose completed in ${execution.name}`,
        record: false,
      });
    } else if (task.type === "power") {
      const equipment = getTwin().equipment.find(
        (item) => item.id === task.equipmentId,
      );

      if (!equipment) {
        throw new Error(`Equipment is not available: ${task.equipmentId}`);
      }

      if (!(task.equipmentId in execution.snapshots)) {
        execution.snapshots[task.equipmentId] = equipment.enabled;
      }

      await setEquipmentPower(task.equipmentId, task.enabled, {
        source: "automation",
        category: "routine",
        action: task.enabled ? "turned-on-by-routine" : "turned-off-by-routine",
        details: `${task.enabled ? "Turned on" : "Turned off"} by ${execution.name}`,
      });
    } else if (task.type === "hold") {
      execution.holding = true;
      runtimeStore.saveState(activeCustomRoutineStateKey, execution);
      return;
    } else {
      await restoreCustomRoutineSnapshots(execution);
    }

    execution.taskIndex += 1;
    runtimeStore.saveState(activeCustomRoutineStateKey, execution);
  }

  await finalizeCustomRoutine("completed");
}

export async function startCustomRoutine(
  routineId: string,
): Promise<ActiveRoutineExecution | undefined> {
  if (activePlan || activeWaterChange || activeCustomRoutine) {
    throw new Error("Finish the active automation before starting a routine");
  }

  ensureWaterChangeRoutineMigrated();
  const routine = customRoutines.find((item) => item.id === routineId);

  if (!routine) {
    throw new Error("Routine not found");
  }

  await initializeEquipment();
  activeCustomRoutine = {
    id: crypto.randomUUID(),
    routineId,
    name: routine.name,
    startedAt: new Date().toISOString(),
    taskIndex: 0,
    snapshots: {},
  };
  runtimeStore.saveState(activeCustomRoutineStateKey, activeCustomRoutine);
  recordAquariumActivity({
    source: "automation",
    category: "routine",
    action: "started",
    title: `${routine.name} started`,
    details: `${routine.tasks.length} task${routine.tasks.length === 1 ? "" : "s"}`,
  });

  try {
    await continueCustomRoutine();
  } catch (error) {
    await finalizeCustomRoutine("cancelled");
    throw error;
  }
  return activeCustomRoutine ? structuredClone(activeCustomRoutine) : undefined;
}

export async function finishCustomRoutine(): Promise<void> {
  const execution = activeCustomRoutine;

  if (!execution?.holding) {
    throw new Error("Routine is not waiting to be finished");
  }

  execution.holding = false;
  execution.taskIndex += 1;
  runtimeStore.saveState(activeCustomRoutineStateKey, execution);

  try {
    await continueCustomRoutine();
  } catch (error) {
    await finalizeCustomRoutine("cancelled");
    throw error;
  }
}

export async function cancelCustomRoutine(): Promise<void> {
  await finalizeCustomRoutine("cancelled");
}

export function getActiveCustomRoutine(): ActiveRoutineExecution | undefined {
  return activeCustomRoutine
    ? structuredClone(activeCustomRoutine)
    : undefined;
}

function nextFeedModeTransitionAt(plan: FeedModePlan): number {
  if (plan.phase !== "recovery") {
    return new Date(plan.endsAt).getTime();
  }

  const restored = new Set(plan.restoredEquipmentIds ?? []);
  const recoveryStartedAt = new Date(
    plan.recoveryStartedAt ?? plan.endsAt,
  ).getTime();
  const pending = plan.actions
    .filter((action) => !restored.has(action.equipmentId))
    .map(
      (action) =>
        recoveryStartedAt + action.restoreDelaySeconds * 1000,
    );

  return pending.length > 0 ? Math.min(...pending) : Date.now();
}

function scheduleCompletion(plan: FeedModePlan): void {
  if (timer) {
    clearTimeout(timer);
  }

  const delay = Math.max(
    0,
    nextFeedModeTransitionAt(plan) - Date.now(),
  );

  timer = setTimeout(() => {
    void completeWithRetry();
  }, delay);
}

async function completeWithRetry(): Promise<void> {
  try {
    await completeFeedMode();
  } catch (error) {
    console.error("Unable to complete Feed Mode:", error);

    timer = setTimeout(() => {
      void completeWithRetry();
    }, retryDelayMs);
  }
}

export async function startFeedMode(
  durationSeconds = 300,
  _legacySkimmerRestartDelaySeconds = 0,
  cycleId?: "A" | "B" | "C",
): Promise<FeedModePlan> {
  if (activePlan) {
    // Starting a feed cycle is idempotent. The cloud may redeliver a command
    // before its completion acknowledgement arrives; returning the persisted
    // plan prevents that retry from becoming a false controller rejection.
    return activePlan;
  }

  if (activeWaterChange || activeCustomRoutine) {
    throw new Error("Finish the active routine before starting Feed Mode");
  }

  await initializeEquipment();

  const plan = createFeedModePlan(getTwin(), {
    durationSeconds,
    ...(cycleId ? { cycleId } : {}),
  });

  activePlan = plan;
  runtimeStore.saveState(stateKey, plan);

  try {
    for (const action of plan.actions) {
      await setEquipmentPower(
        action.equipmentId,
        false,
        {
          source: "automation",
          category: "feed-cycle",
          action: "paused-for-feed-cycle",
          details: "Paused for feed cycle",
        },
      );
    }
    for (const action of plan.speedActions ?? []) {
      await setEquipmentSpeed(action.equipmentId, action.feedSpeedPercent, {
        source: "automation",
        category: "feed-cycle",
        action: "reduced-for-feed-cycle",
        details: "Reduced to 30% for feed cycle",
      });
    }
  } catch (error) {
    for (const action of [...plan.actions].reverse()) {
      if (shouldRestoreFeedModeAction(getTwin(), action)) {
        try {
          await setEquipmentPower(
            action.equipmentId,
            true,
            { record: false },
          );
        } catch {
          // Preserve the original failure.
        }
      }
    }
    for (const action of [...(plan.speedActions ?? [])].reverse()) {
      try {
        await setEquipmentSpeed(action.equipmentId, action.restoreSpeedPercent, { record: false });
      } catch {
        // Preserve the original failure.
      }
    }

    activePlan = undefined;
    runtimeStore.deleteState(stateKey);
    throw error;
  }

  scheduleCompletion(plan);
  recordAquariumActivity({
    source: "automation",
    category: "feed-cycle",
    action: "started",
    title: "Feed cycle started",
    details: `${durationSeconds} seconds; ${plan.actions.length + (plan.speedActions?.length ?? 0)} device${plan.actions.length + (plan.speedActions?.length ?? 0) === 1 ? "" : "s"} adjusted`,
  });
  return plan;
}

export async function startWaterChange(): Promise<WaterChangePlan> {
  if (activeWaterChange) {
    throw new Error("Water Change is already active");
  }

  if (activePlan || activeCustomRoutine) {
    throw new Error("Finish the active automation before starting Water Change");
  }

  await initializeEquipment();

  const routine = getWaterChangeRoutine();
  if (!routine) {
    throw new Error("Routine not found");
  }
  const configuredEquipmentIds = new Set(
    routine.tasks.flatMap((task) =>
      task.type === "power" ? [task.equipmentId] : []
    ),
  );
  const plan = createWaterChangePlan(
    getTwin(),
    new Date(),
    configuredEquipmentIds,
  );
  activeWaterChange = plan;
  runtimeStore.saveState(waterChangeStateKey, plan);

  try {
    for (const action of plan.actions) {
      await setEquipmentPower(action.equipmentId, false, {
        source: "automation",
        category: "routine",
        action: "paused-for-water-change",
        details: "Paused by Water Change routine",
      });
    }
  } catch (error) {
    for (const action of plan.actions) {
      if (shouldRestoreWaterChangeAction(getTwin(), action)) {
        try {
          await setEquipmentPower(action.equipmentId, true, {
            record: false,
          });
        } catch {
          // Preserve the original failure.
        }
      }
    }

    activeWaterChange = undefined;
    runtimeStore.deleteState(waterChangeStateKey);
    throw error;
  }

  recordAquariumActivity({
    source: "automation",
    category: "routine",
    action: "started",
    title: `${routine.name} started`,
    details: `${plan.actions.length} outlet${plan.actions.length === 1 ? "" : "s"} paused`,
  });

  return plan;
}

export async function completeWaterChange(): Promise<void> {
  const plan = activeWaterChange;

  if (!plan) {
    return;
  }

  for (const action of plan.actions) {
    if (shouldRestoreWaterChangeAction(getTwin(), action)) {
      await restoreEquipmentAfterAutomation(
        action.equipmentId,
        "Restarted after Water Change routine",
      );
    }
  }

  runtimeStore.deleteState(waterChangeStateKey);
  activeWaterChange = undefined;
  const routine = getWaterChangeRoutine();

  recordAquariumActivity({
    source: "automation",
    category: "routine",
    action: "completed",
    title: `${routine?.name ?? "Water Change"} completed`,
    details: `${plan.actions.length} outlet${plan.actions.length === 1 ? "" : "s"} restored`,
  });
}

export async function completeFeedMode(
  reason: "completed" | "cancelled" = "completed",
): Promise<FeedModePlan | undefined> {
  const plan = activePlan;

  if (!plan) {
    return undefined;
  }

  for (const action of [...plan.actions].reverse()) {
    if (shouldRestoreFeedModeAction(getTwin(), action)) {
      await restoreEquipmentAfterAutomation(
        action.equipmentId,
        "Restarted after feed cycle",
      );
    }
  }

  const now = new Date();
  const clock = {
    weekday: now.getDay(),
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  };
  for (const action of [...(plan.speedActions ?? [])].reverse()) {
    const equipment = getTwin().equipment.find((item) => item.id === action.equipmentId);
    if (equipment && getEquipmentControlMode(equipment) === "auto") {
      await setEquipmentSpeed(
        action.equipmentId,
        getScheduledEquipmentSpeed(equipment, clock) ?? action.restoreSpeedPercent,
        {
          source: "automation",
          category: "feed-cycle",
          action: "restored-after-feed-cycle",
          details: "Restored pump speed after feed cycle",
        },
      );
    }
  }

  runtimeStore.deleteState(stateKey);
  activePlan = undefined;

  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }

  recordAquariumActivity({
    source: "automation",
    category: "feed-cycle",
    action: plan.completionReason ?? reason,
    title: `Feed cycle ${plan.completionReason ?? reason}`,
    details: `${plan.actions.length + (plan.speedActions?.length ?? 0)} device${plan.actions.length + (plan.speedActions?.length ?? 0) === 1 ? "" : "s"} restored`,
  });

  return undefined;
}

export async function applyEquipmentSchedules(
  now = new Date(),
): Promise<void> {
  await applyPendingAutomaticRestarts(now);
  // The one-shot Feed Cycle timer is the primary transition trigger. The
  // scheduler is an independent safety backstop so a lost timer can never
  // leave circulation equipment held off indefinitely.
  if (
    activePlan &&
    nextFeedModeTransitionAt(activePlan) <= now.getTime()
  ) {
    await completeFeedMode();
  }

  await initializeEquipment();

  const snapshot = getTwin();
  const md44Equipment = snapshot.equipment.filter(
    (equipment) => equipment.binding?.driverId.startsWith("modreef.jebao-md44:") &&
      equipment.intervalProgram,
  );
  const md44Tracking = trackMd44ScheduledDoses(
    runtimeStore.loadState<Md44DoseTrackerState>(md44DoseTrackerStateKey) ?? {},
    md44Equipment,
    now,
  );
  if (md44Tracking.changed) {
    runtimeStore.saveState(md44DoseTrackerStateKey, md44Tracking.state);
  }
  for (const transition of md44Tracking.transitions) {
    recordAquariumActivity({
      source: "automation",
      category: "equipment",
      action: transition.action,
      title: transition.title,
      equipmentId: transition.equipmentId,
      details: transition.details,
    });
  }
  const clock = {
    weekday: now.getDay(),
    time: `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`,
  };

  const advancedInputs = createAdvancedOutletInputs(snapshot, now);

  for (const equipment of snapshot.equipment) {
    try {
    const desiredSpeed = getScheduledEquipmentSpeed(equipment, clock);
    const heldAtFeedSpeed = activePlan?.speedActions?.some(
      (action) => action.equipmentId === equipment.id,
    );
    if (!heldAtFeedSpeed && desiredSpeed !== undefined && desiredSpeed !== equipment.speedPercent) {
      await setEquipmentSpeed(equipment.id, desiredSpeed, {
        source: "automation",
        action: "scheduled-speed-change",
        details: "Changed by pump speed schedule",
      });
    }
    if (await applyAdvancedOutletProgram(equipment, advancedInputs, now)) {
      continue;
    }
    // MD-4.4 programs execute from the doser's own clock. Edge must not also
    // synthesize relay changes or it can duplicate/interrupt a native dose.
    if (
      equipment.intervalProgram?.enabled &&
      equipment.binding?.driverId.startsWith("modreef.jebao-md44:")
    ) {
      continue;
    }
    const desired = getScheduledEquipmentState(
      equipment,
      clock,
    );

    if (
      desired === undefined ||
      desired === equipment.enabled
    ) {
      continue;
    }

    const heldOffByFeedMode =
      desired &&
      activePlan?.actions.some(
        (action) => action.equipmentId === equipment.id,
      );

    const heldOffByWaterChange =
      desired &&
      activeWaterChange?.actions.some(
        (action) => action.equipmentId === equipment.id,
      );

    const heldOffByRestartDelay =
      desired && pendingAutomaticRestarts.some(
        (item) => item.equipmentId === equipment.id,
      );

    const customRoutine = activeCustomRoutine
      ? customRoutines.find(
          (item) => item.id === activeCustomRoutine?.routineId,
        )
      : undefined;
    const latestCustomPowerTask = customRoutine?.tasks
      .slice(0, activeCustomRoutine?.taskIndex ?? 0)
      .filter(
        (task) =>
          task.type === "power" && task.equipmentId === equipment.id,
      )
      .at(-1);
    const heldByCustomRoutine =
      latestCustomPowerTask?.type === "power" &&
      latestCustomPowerTask.enabled === equipment.enabled;

    if (
      heldOffByFeedMode || heldOffByWaterChange ||
      heldOffByRestartDelay || heldByCustomRoutine
    ) {
      continue;
    }

    if (
      desired &&
      equipment.programType === "dosing-pump" &&
      equipment.intervalProgram?.enabled
    ) {
      await startEquipmentDose(
        equipment.id,
        equipment.intervalProgram.durationSeconds,
        {
          source: "automation",
          category: "automation",
          action: "scheduled-dose",
          ...(equipment.intervalProgram.doseMilliliters === undefined
            ? {}
            : {
                requestedDoseMilliliters:
                  equipment.intervalProgram.doseMilliliters,
              }),
          details: "Started by dosing schedule",
        },
      );
      continue;
    }

    await setEquipmentPower(equipment.id, desired, {
      source: "automation",
      category: "automation",
      action: "scheduled-power-change",
      details: "Changed by equipment schedule",
    });
    } catch (error) {
      console.warn(
        `Could not apply equipment schedule for ${equipment.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

function advancedRuntimeStateKey(equipmentId: string): string {
  return `${advancedOutletRuntimeStateKeyPrefix}${equipmentId}`;
}

function createAdvancedOutletInputs(
  snapshot: AquariumDigitalTwin,
  now: Date,
): AdvancedOutletEvaluationInputs {
  const measurements: AdvancedOutletEvaluationInputs["measurements"] = {};
  for (const measurement of [...snapshot.measurements].sort(
    (left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt),
  )) {
    const value = {
      value: measurement.value,
      unit: measurement.unit,
      measuredAt: measurement.measuredAt,
    };
    measurements[measurement.id] = value;
    // Parameter aliases resolve to the newest reading and give the editor a
    // stable reference when individual event IDs change.
    measurements[measurement.parameter] = value;
  }

  const equipment = Object.fromEntries(snapshot.equipment.map((item) => [
    item.id,
    {
      powerState: item.enabled ? "on" as const : "off" as const,
      connectivity: item.connectionStatus === "online" ? "online" as const : "offline" as const,
    },
  ]));
  const activeCycle = activePlan?.cycleId ?? (activePlan ? "A" : undefined);

  return {
    clock: {
      now: now.toISOString(),
      weekday: now.getDay(),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
    },
    feedCycles: {
      A: activeCycle === "A",
      B: activeCycle === "B",
      C: activeCycle === "C",
    },
    waterChangeActive: activeWaterChange !== undefined,
    measurements,
    equipment,
  };
}

async function applyAdvancedOutletProgram(
  equipment: Equipment,
  inputs: AdvancedOutletEvaluationInputs,
  now: Date,
): Promise<boolean> {
  const program = equipment.advancedOutletProgram;
  if (equipment.programType !== "advanced" || program === undefined) return false;
  if (!isAdvancedOutletProgram(program)) {
    throw new Error(`Invalid advanced outlet program: ${equipment.name}`);
  }
  if (getEquipmentControlMode(equipment) !== "auto") return true;
  // Active routines outrank outlet programs. This prevents an Advanced
  // default of ON from undoing a Feed Mode or Water Change shutdown.
  if (
    activePlan?.actions.some((action) => action.equipmentId === equipment.id) ||
    activeWaterChange?.actions.some((action) => action.equipmentId === equipment.id) ||
    pendingAutomaticRestarts.some((item) => item.equipmentId === equipment.id)
  ) {
    return true;
  }
  if (activeCustomRoutine) {
    const routine = customRoutines.find((item) => item.id === activeCustomRoutine?.routineId);
    const latestPowerTask = routine?.tasks
      .slice(0, activeCustomRoutine.taskIndex)
      .filter((task) => task.type === "power" && task.equipmentId === equipment.id)
      .at(-1);
    if (latestPowerTask?.type === "power" && latestPowerTask.enabled === equipment.enabled) {
      return true;
    }
  }

  const key = advancedRuntimeStateKey(equipment.id);
  const previous = runtimeStore.loadState<AdvancedOutletRuntimeState>(key);
  const evaluation = evaluateAdvancedOutletProgram(program, inputs);
  const decision = applyAdvancedOutletSafety(program, evaluation, previous, {
    now: now.toISOString(),
    localDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    observedState: equipment.enabled ? "on" : "off",
  });
  runtimeStore.saveState(key, decision.runtimeState);

  if (decision.requestedState === null) return true;
  await setEquipmentPower(equipment.id, decision.requestedState === "on", {
    source: "automation",
    category: "automation",
    action: "advanced-program-power-change",
    details: `Changed by advanced program: ${decision.reason}`,
  });
  return true;
}

async function runEquipmentSchedules(): Promise<void> {
  if (scheduleRunning) {
    return;
  }

  scheduleRunning = true;

  try {
    await applyEquipmentSchedules();
    lastScheduleError = undefined;
  } catch (error) {
    lastScheduleError =
      error instanceof Error ? error.message : String(error);
    console.error("Unable to apply equipment schedules:", error);
  } finally {
    lastScheduleCompletedAt = performance.now();
    scheduleRunning = false;
    scheduleTimer = setTimeout(() => {
      void runEquipmentSchedules();
    }, scheduleIntervalMs);
  }
}

function startEquipmentScheduler(): void {
  if (scheduleTimer || scheduleRunning) {
    return;
  }

  void runEquipmentSchedules();
}

export async function initializeAutomation(): Promise<void> {
  startEquipmentScheduler();

  const plan = activePlan;
  const waterChange = activeWaterChange;
  const customRoutine = activeCustomRoutine;

  if (!plan && !waterChange && !customRoutine) {
    return;
  }

  try {
    await initializeEquipment();

    if (waterChange) {
      for (const action of waterChange.actions) {
        await setEquipmentPower(action.equipmentId, false, {
          record: false,
        });
      }
    }

    if (plan) {
      if (
        plan.phase === "recovery" ||
        new Date(plan.endsAt).getTime() <= Date.now()
      ) {
        await completeWithRetry();
        return;
      }

      for (const action of plan.actions) {
        await setEquipmentPower(action.equipmentId, false, {
          record: false,
        });
      }
      for (const action of plan.speedActions ?? []) {
        await setEquipmentSpeed(action.equipmentId, action.feedSpeedPercent, { record: false });
      }

      scheduleCompletion(plan);
    }

    if (customRoutine) {
      await continueCustomRoutine();
    }
  } catch (error) {
    console.error("Unable to resume automation:", error);

    timer = setTimeout(() => {
      void initializeAutomation();
    }, retryDelayMs);
  }
}

export function getActiveFeedMode(): FeedModePlan | undefined {
  return activePlan
    ? structuredClone(activePlan)
    : undefined;
}

export function getActiveWaterChange(): WaterChangePlan | undefined {
  return activeWaterChange
    ? structuredClone(activeWaterChange)
    : undefined;
}
