import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { isMeasurementEquipment, type Equipment } from "@modreef/digital-twin";

import { CircularActionButton } from "./CircularActionButton";
import {
  createEdgeRoutine,
  deleteEdgeRoutine,
  finishEdgeRoutine,
  getEdgeRoutines,
  runEdgeRoutine,
  stopEdgeRoutine,
  updateEdgeRoutine,
  type EdgeActiveRoutine,
  type EdgeRoutineDefinition,
  type EdgeRoutineTask,
} from "./edgeClient";

interface Props {
  equipment: Equipment[];
}

interface RoutineDraft {
  id?: string;
  name: string;
  tasks: EdgeRoutineTask[];
}

function taskId(): string {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function taskSummary(
  task: EdgeRoutineTask,
  equipment: Equipment[],
): string {
  if (task.type === "wait") {
    return `Wait ${task.durationSeconds} second${task.durationSeconds === 1 ? "" : "s"}`;
  }

  if (task.type === "restore") {
    return "Restore prior equipment states";
  }

  if (task.type === "hold") {
    return "Wait until finished";
  }

  const name = equipment.find((item) => item.id === task.equipmentId)?.name ??
    "Missing equipment";

  if (task.type === "dose") {
    return `Dose ${task.milliliters} mL with ${name}`;
  }

  return `${task.enabled ? "Turn on" : "Turn off"} ${name}`;
}

export function RoutinesPanel({ equipment }: Props) {
  const powerEquipment = useMemo(
    () => equipment.filter((item) => !isMeasurementEquipment(item)),
    [equipment],
  );
  const dosingEquipment = useMemo(
    () => equipment.filter(
      (item) =>
        item.programType === "dosing-pump" &&
        item.doserCalibration !== undefined,
    ),
    [equipment],
  );
  const [routines, setRoutines] = useState<EdgeRoutineDefinition[]>([]);
  const [active, setActive] = useState<EdgeActiveRoutine | null>(null);
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [equipmentMenuTaskId, setEquipmentMenuTaskId] = useState<string | null>(null);
  const [doseInputs, setDoseInputs] = useState<Record<string, string>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const routineResult = await getEdgeRoutines();
    setRoutines(routineResult.routines);
    setActive(routineResult.active);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const routineResult = await getEdgeRoutines();

        if (!cancelled) {
          setRoutines(routineResult.routines);
          setActive(routineResult.active);
          setError(null);
        }
      } catch {
        // Preserve the last known state while Edge reconnects.
      }
    }

    void poll();
    const polling = setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(polling);
    };
  }, []);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function startNewRoutine() {
    setDraft({ name: "", tasks: [] });
    setDoseInputs({});
    setAddMenuOpen(false);
    setDeleteConfirmId(null);
  }

  function editRoutine(routine: EdgeRoutineDefinition) {
    setDraft({
      id: routine.id,
      name: routine.name,
      tasks: routine.tasks.map((task) => ({ ...task })),
    });
    setDoseInputs(Object.fromEntries(
      routine.tasks
        .filter((task) => task.type === "dose")
        .map((task) => [task.id, String(task.milliliters)]),
    ));
    setAddMenuOpen(false);
    setDeleteConfirmId(null);
  }

  function addTask(
    type: "off" | "on" | "dose" | "wait" | "hold" | "restore",
  ) {
    if (!draft) return;

    let task: EdgeRoutineTask;
    if (type === "wait") {
      task = { id: taskId(), type: "wait", durationSeconds: 60 };
    } else if (type === "hold") {
      if (draft.tasks.some((item) => item.type === "hold")) {
        setError("This routine already waits until finished");
        return;
      }
      task = { id: taskId(), type: "hold" };
    } else if (type === "dose") {
      const first = dosingEquipment[0];
      if (!first) {
        setError("Calibrate a dosing pump before adding a dose task");
        return;
      }
      task = {
        id: taskId(),
        type: "dose",
        equipmentId: first.id,
        milliliters: 1,
      };
      setDoseInputs((current) => ({ ...current, [task.id]: "1" }));
    } else if (type === "restore") {
      if (draft.tasks.some((item) => item.type === "restore")) {
        setError("This routine already has a restore task");
        return;
      }
      task = { id: taskId(), type: "restore" };
    } else {
      const first = powerEquipment[0];
      if (!first) {
        setError("Add a power-capable equipment outlet before creating this task");
        return;
      }
      task = {
        id: taskId(),
        type: "power",
        equipmentId: first.id,
        enabled: type === "on",
      };
    }

    setDraft({ ...draft, tasks: [...draft.tasks, task] });
    setAddMenuOpen(false);
  }

  function updateTask(taskIdValue: string, next: EdgeRoutineTask) {
    if (!draft) return;
    setDraft({
      ...draft,
      tasks: draft.tasks.map((task) => task.id === taskIdValue ? next : task),
    });
  }

  function moveTask(index: number, offset: -1 | 1) {
    if (!draft) return;
    const target = index + offset;
    if (target < 0 || target >= draft.tasks.length) return;
    const tasks = [...draft.tasks];
    [tasks[index], tasks[target]] = [tasks[target]!, tasks[index]!];
    setDraft({ ...draft, tasks });
  }

  async function saveDraft() {
    if (!draft) return;
    await perform(async () => {
      const input = { name: draft.name, tasks: draft.tasks };
      if (draft.id) {
        await updateEdgeRoutine(draft.id, input);
      } else {
        await createEdgeRoutine(input);
      }
      setDraft(null);
      await refresh();
    });
  }

  return (
    <View>
      <Text style={styles.intro}>
        Build ordered system actions once, then run them from any paired app.
        Routine definitions and active waits live on the Reef Controller.
      </Text>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>ROUTINES</Text>
          <Text style={styles.sectionTitle}>Saved actions</Text>
        </View>
        <CircularActionButton
          accessibilityLabel="Create routine"
          kind="add"
          onPress={startNewRoutine}
        />
      </View>

      {draft ? (
        <View style={[styles.card, styles.editor]}>
          <View style={styles.editorHeader}>
            <Text style={styles.title}>{draft.id ? "Edit routine" : "New routine"}</Text>
            <View style={styles.editorActions}>
              <CircularActionButton
                accessibilityLabel="Cancel routine changes"
                kind="cancel"
                onPress={() => setDraft(null)}
              />
              <CircularActionButton
                accessibilityLabel="Save routine"
                busy={busy}
                disabled={busy}
                kind="confirm"
                onPress={() => void saveDraft()}
              />
            </View>
          </View>

          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            accessibilityLabel="Routine name"
            maxLength={60}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder="Example: Evening maintenance"
            placeholderTextColor="#58708A"
            style={styles.input}
            value={draft.name}
          />

          <Text style={styles.fieldLabel}>TASKS</Text>
          {draft.tasks.length === 0 ? (
            <Text style={styles.empty}>Add the first task to this routine.</Text>
          ) : null}

          {draft.tasks.map((task, index) => (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskTopRow}>
                <Text style={styles.taskNumber}>{index + 1}</Text>
                <Text style={styles.taskTitle}>{taskSummary(task, equipment)}</Text>
                <Pressable onPress={() => moveTask(index, -1)} style={styles.taskControl}>
                  <Text style={styles.taskControlText}>↑</Text>
                </Pressable>
                <Pressable onPress={() => moveTask(index, 1)} style={styles.taskControl}>
                  <Text style={styles.taskControlText}>↓</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDraft({
                    ...draft,
                    tasks: draft.tasks.filter((item) => item.id !== task.id),
                  })}
                  style={styles.taskControl}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>

              {task.type === "power" || task.type === "dose" ? (
                <View>
                  <Pressable
                    onPress={() => setEquipmentMenuTaskId(
                      equipmentMenuTaskId === task.id ? null : task.id,
                    )}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {(task.type === "dose" ? dosingEquipment : powerEquipment)
                        .find((item) => item.id === task.equipmentId)?.name ?? "Select equipment"}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {equipmentMenuTaskId === task.id ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {equipmentMenuTaskId === task.id ? (
                    <View style={styles.menu}>
                      {(task.type === "dose" ? dosingEquipment : powerEquipment).map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => {
                            updateTask(task.id, { ...task, equipmentId: item.id });
                            setEquipmentMenuTaskId(null);
                          }}
                          style={styles.menuItem}
                        >
                          <Text style={styles.menuItemText}>{item.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {task.type === "dose" ? (
                <View style={styles.waitRow}>
                  <TextInput
                    accessibilityLabel="Dose volume in milliliters"
                    keyboardType="decimal-pad"
                    onChangeText={(value) => {
                      setDoseInputs((current) => ({
                        ...current,
                        [task.id]: value,
                      }));
                      updateTask(task.id, {
                        ...task,
                        milliliters: Number(value),
                      });
                    }}
                    style={[styles.input, styles.waitInput]}
                    value={doseInputs[task.id] ?? String(task.milliliters)}
                  />
                  <Text style={styles.waitUnit}>mL</Text>
                </View>
              ) : null}

              {task.type === "wait" ? (
                <View style={styles.waitRow}>
                  <TextInput
                    accessibilityLabel="Wait duration in seconds"
                    keyboardType="number-pad"
                    onChangeText={(value) => updateTask(task.id, {
                      ...task,
                      durationSeconds: Number.parseInt(value, 10) || 0,
                    })}
                    style={[styles.input, styles.waitInput]}
                    value={String(task.durationSeconds)}
                  />
                  <Text style={styles.waitUnit}>seconds</Text>
                </View>
              ) : null}
            </View>
          ))}

          <Pressable
            onPress={() => setAddMenuOpen((open) => !open)}
            style={styles.addTaskButton}
          >
            <Text style={styles.addTaskText}>+ ADD TASK</Text>
          </Pressable>
          {addMenuOpen ? (
            <View style={styles.taskPalette}>
              {(["off", "on", "dose", "wait", "hold", "restore"] as const)
                .map((type) => (
                <Pressable
                  key={type}
                  onPress={() => addTask(type)}
                  style={styles.paletteChoice}
                >
                  <Text style={styles.paletteChoiceText}>
                    {type === "off" ? "TURN OFF" :
                      type === "on" ? "TURN ON" :
                        type === "hold" ? "WAIT UNTIL FINISHED" :
                          type.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {routines.map((routine) => {
        const isActive = active?.routineId === routine.id;
        const isHolding = isActive && active?.holding === true;
        return (
          <View key={routine.id} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.icon}><Text style={styles.listIcon}>≡</Text></View>
              <View style={styles.copy}>
                <Text style={styles.title}>{routine.name}</Text>
                <Text style={styles.summary}>
                  {isActive
                    ? isHolding
                      ? "Waiting for you to finish"
                      : `Running task ${Math.min((active?.taskIndex ?? 0) + 1, routine.tasks.length)} of ${routine.tasks.length}`
                    : routine.tasks.map((task) => taskSummary(task, equipment)).join(" · ")}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Edit ${routine.name}`}
                disabled={busy || isActive}
                onPress={() => editRoutine(routine)}
                style={styles.smallButton}
              >
                <Text style={styles.smallButtonText}>EDIT</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={
                  isHolding
                    ? `Finish ${routine.name}`
                    : isActive
                      ? `Cancel ${routine.name}`
                      : `Run ${routine.name}`
                }
                disabled={busy}
                onPress={() => void perform(async () => {
                  if (isHolding) await finishEdgeRoutine();
                  else if (isActive) await stopEdgeRoutine();
                  else await runEdgeRoutine(routine.id);
                  await refresh();
                })}
                style={[
                  styles.button,
                  isHolding
                    ? styles.finishButton
                    : isActive
                      ? styles.cancelButton
                      : null,
                ]}
              >
                <Text style={styles.buttonText}>
                  {isHolding ? "FINISH" : isActive ? "CANCEL" : "RUN"}
                </Text>
              </Pressable>
            </View>
            <Pressable
              disabled={busy || isActive}
              onPress={() => {
                if (deleteConfirmId !== routine.id) {
                  setDeleteConfirmId(routine.id);
                  return;
                }
                void perform(async () => {
                  await deleteEdgeRoutine(routine.id);
                  setDeleteConfirmId(null);
                  await refresh();
                });
              }}
              style={styles.deleteRow}
            >
              <Text style={styles.deleteText}>
                {deleteConfirmId === routine.id ? "TAP AGAIN TO DELETE" : "DELETE"}
              </Text>
            </Pressable>
          </View>
        );
      })}

      {busy && !draft ? <ActivityIndicator color="#20B7EC" style={styles.busy} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  addTaskButton: { alignItems: "center", borderColor: "#20B7EC", borderRadius: 9, borderStyle: "dashed", borderWidth: 1, marginTop: 10, padding: 11 },
  addTaskText: { color: "#20B7EC", fontSize: 11, fontWeight: "900" },
  busy: { marginTop: 14 },
  button: { alignItems: "center", backgroundColor: "#1385AE", borderRadius: 10, justifyContent: "center", minHeight: 38, minWidth: 62, paddingHorizontal: 12 },
  buttonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  cancelButton: { backgroundColor: "#B34150" },
  card: { backgroundColor: "#071B31", borderColor: "#153E63", borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  copy: { flex: 1 },
  deleteRow: { alignItems: "flex-end", borderTopColor: "#102F4B", borderTopWidth: 1, paddingHorizontal: 15, paddingVertical: 8 },
  deleteText: { color: "#D66B78", fontSize: 9, fontWeight: "900" },
  editor: { padding: 15 },
  editorActions: { flexDirection: "row", gap: 8 },
  editorHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  empty: { color: "#6E849C", fontSize: 12, marginBottom: 8 },
  error: { color: "#FCA5A5", fontSize: 12, paddingVertical: 10 },
  fieldLabel: { color: "#7890A9", fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 6, marginTop: 10 },
  finishButton: { backgroundColor: "#16865D" },
  icon: { alignItems: "center", borderColor: "#20B7EC", borderRadius: 18, borderWidth: 1.5, height: 36, justifyContent: "center", width: 36 },
  iconText: { color: "#20B7EC", fontSize: 22, lineHeight: 23 },
  input: { backgroundColor: "#0B263F", borderColor: "#174C76", borderRadius: 9, borderWidth: 1, color: "#E7EEF6", fontSize: 13, minHeight: 40, paddingHorizontal: 11 },
  intro: { color: "#8FA4BF", fontSize: 13, lineHeight: 19, marginBottom: 18 },
  listIcon: { color: "#20B7EC", fontSize: 20, fontWeight: "900" },
  menu: { backgroundColor: "#0B263F", borderColor: "#174C76", borderRadius: 9, borderWidth: 1, marginTop: 4, overflow: "hidden" },
  menuItem: { borderBottomColor: "#153E63", borderBottomWidth: 1, padding: 11 },
  menuItemText: { color: "#D9E5F1", fontSize: 12, fontWeight: "700" },
  paletteChoice: { alignItems: "center", backgroundColor: "#103555", borderRadius: 8, flex: 1, minWidth: 74, paddingHorizontal: 8, paddingVertical: 10 },
  paletteChoiceText: { color: "#BBD3E8", fontSize: 9, fontWeight: "900" },
  pressed: { opacity: 0.7 },
  removeText: { color: "#F0808D", fontSize: 18, lineHeight: 20 },
  row: { alignItems: "center", flexDirection: "row", gap: 11, padding: 15 },
  sectionEyebrow: { color: "#20B7EC", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { color: "#E7EEF6", fontSize: 17, fontWeight: "800", marginTop: 2 },
  selector: { alignItems: "center", backgroundColor: "#0B263F", borderColor: "#174C76", borderRadius: 8, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 9, minHeight: 38, paddingHorizontal: 10 },
  selectorArrow: { color: "#20B7EC", fontSize: 10 },
  selectorText: { color: "#D9E5F1", flex: 1, fontSize: 12, fontWeight: "700" },
  smallButton: { alignItems: "center", borderColor: "#2A587C", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 9 },
  smallButtonText: { color: "#9FB8CF", fontSize: 9, fontWeight: "900" },
  summary: { color: "#8198B1", fontSize: 11, lineHeight: 16, marginTop: 3 },
  taskCard: { backgroundColor: "#091F36", borderColor: "#143D60", borderRadius: 10, borderWidth: 1, marginBottom: 8, padding: 10 },
  taskControl: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  taskControlText: { color: "#91ADC5", fontSize: 14 },
  taskNumber: { alignItems: "center", backgroundColor: "#1385AE", borderRadius: 10, color: "#FFFFFF", fontSize: 10, fontWeight: "900", lineHeight: 20, textAlign: "center", width: 20 },
  taskPalette: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  taskTitle: { color: "#D7E3EF", flex: 1, fontSize: 11, fontWeight: "700" },
  taskTopRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  title: { color: "#E7EEF6", fontSize: 13, fontWeight: "800" },
  waitInput: { flex: 1, marginTop: 9 },
  waitRow: { alignItems: "center", flexDirection: "row", gap: 9 },
  waitUnit: { color: "#8198B1", fontSize: 11, marginTop: 9 },
});
