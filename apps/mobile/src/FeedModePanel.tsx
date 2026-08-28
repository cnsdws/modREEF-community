import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { EdgeSummary, FeedCycleRuntimeState } from "@modreef/api-contract";

import {
  type EdgeFeedMode,
} from "./edgeClient";
import {
  getDashboardFeedMode,
  startDashboardFeedMode,
  stopDashboardFeedMode,
} from "./dashboardConnection";
import { reconcileFeedMode } from "./feedModeReconciliation";

type FeedCycleId = "A" | "B" | "C";
type FeedCycleDurations = Record<FeedCycleId, number>;
type FeedCycleDrafts = Record<FeedCycleId, string>;

const settingsKey = "modreef.feed-cycle-durations";

const defaultDurations: FeedCycleDurations = {
  A: 5,
  B: 10,
  C: 15,
};

const cycleIds: FeedCycleId[] = ["A", "B", "C"];

function validMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 60
  );
}

export function FeedModePanel({
  cloudMode = false,
  controllers,
  targetControllerIds,
  settingsIcon,
  showReconnectNotice = true,
}: {
  cloudMode?: boolean;
  controllers: EdgeSummary[];
  targetControllerIds: string[];
  settingsIcon: ReactNode;
  showReconnectNotice?: boolean;
}) {
  const [active, setActive] = useState<EdgeFeedMode | null>(null);
  const [durations, setDurations] =
    useState<FeedCycleDurations>(defaultDurations);
  const [drafts, setDrafts] = useState<FeedCycleDrafts>({
    A: String(defaultDurations.A),
    B: String(defaultDurations.B),
    C: String(defaultDurations.C),
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSettings() {
      try {
        if (!(await SecureStore.isAvailableAsync())) {
          return;
        }

        const stored = await SecureStore.getItemAsync(settingsKey);

        if (!stored || cancelled) {
          return;
        }

        const parsed = JSON.parse(stored) as Partial<FeedCycleDurations>;

        if (
          validMinutes(parsed.A) &&
          validMinutes(parsed.B) &&
          validMinutes(parsed.C)
        ) {
          const restored = {
            A: parsed.A,
            B: parsed.B,
            C: parsed.C,
          };

          setDurations(restored);
          setDrafts({
            A: String(restored.A),
            B: String(restored.B),
            C: String(restored.C),
          });
        }
      } catch {
        // Defaults remain available if stored settings cannot be read.
      }
    }

    void restoreSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const plan = await getDashboardFeedMode();

        if (!cancelled) {
          if (plan || !cloudMode) setActive(plan);
          setReconnecting(false);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setReconnecting(true);
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not reach the selected Reef Controller.",
          );
        }
      }
    }

    void refresh();

    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const polling = setInterval(() => void refresh(), 5_000);

    return () => {
      cancelled = true;
      clearInterval(clock);
      clearInterval(polling);
    };
  }, [cloudMode]);

  useEffect(() => {
    const reported = controllers
      .filter((controller) => targetControllerIds.includes(controller.id))
      .map((controller) => controller.runtimeState?.feedCycle)
      .filter((item): item is FeedCycleRuntimeState => item !== null && item !== undefined)
      .sort((left, right) =>
        Date.parse(right.endsAt) - Date.parse(left.endsAt)
      )[0];
    setActive((current) => reconcileFeedMode(current, reported));
  }, [controllers, targetControllerIds]);

  const remainingSeconds = active
    ? Math.max(
        0,
        Math.ceil(
          (new Date(active.endsAt).getTime() - now) / 1_000,
        ),
      )
    : 0;

  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(
    remainingSeconds % 60,
  ).padStart(2, "0")}`;

  const activeCycle = active
    ? active.cycleId ?? cycleIds.find(
        (cycleId) =>
          durations[cycleId] * 60 === active.durationSeconds,
      )
    : undefined;

  async function start(cycleId: FeedCycleId) {
    setBusy(true);
    setError(null);

    try {
      setActive(
        await startDashboardFeedMode(
          targetControllerIds,
          durations[cycleId] * 60,
          0,
          cycleId,
        ),
      );
      setNow(Date.now());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!active) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      setActive(await stopDashboardFeedMode(
        targetControllerIds,
      ));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const updated = {
      A: Number(drafts.A),
      B: Number(drafts.B),
      C: Number(drafts.C),
    };

    if (
      !validMinutes(updated.A) ||
      !validMinutes(updated.B) ||
      !validMinutes(updated.C)
    ) {
      setError(
        "Feed Cycle times must be 1–60 minutes.",
      );
      return;
    }

    setDurations(updated);
    setError(null);
    setSettingsOpen(false);

    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync(
          settingsKey,
          JSON.stringify(updated),
        );
      }
    } catch {
      setError(
        "Feed Cycle settings were applied but could not be saved.",
      );
    }
  }

  function toggleSettings() {
    if (!settingsOpen) {
      setDrafts({
        A: String(durations.A),
        B: String(durations.B),
        C: String(durations.C),
      });
    }

    setSettingsOpen((current) => !current);
    setError(null);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>FEED CYCLE</Text>

        {active ? (
          <Text style={styles.countdown}>
            {activeCycle ? `${activeCycle} · ` : ""}
            {remaining}
          </Text>
        ) : null}

        <Pressable
          accessibilityLabel="Configure Feed Cycles"
          accessibilityRole="button"
          onPress={toggleSettings}
          style={styles.settingsButton}
        >
          <View accessibilityElementsHidden style={styles.settingsIcon}>
            {settingsIcon}
          </View>
        </Pressable>
      </View>

      <View style={styles.controls}>
        {cycleIds.map((cycleId) => {
          const selected = activeCycle === cycleId;

          return (
            <Pressable
              accessibilityLabel={`Start Feed Cycle ${cycleId} for ${durations[cycleId]} minutes`}
              accessibilityRole="button"
              disabled={busy || active !== null}
              key={cycleId}
              onPress={() => void start(cycleId)}
              style={[
                styles.cycleButton,
                selected ? styles.cycleButtonActive : undefined,
                busy || (active && !selected)
                  ? styles.disabled
                  : undefined,
              ]}
            >
              <Text
                style={[
                  styles.cycleLetter,
                  selected ? styles.cycleLetterActive : undefined,
                ]}
              >
                {cycleId}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityLabel="Cancel Feed Cycle"
          accessibilityRole="button"
          disabled={busy || !active}
          onPress={() => void stop()}
          style={[
            styles.cancelButton,
            busy || !active
              ? styles.disabled
              : undefined,
          ]}
        >
          {busy && active ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.cancelText}>
              Cancel
            </Text>
          )}
        </Pressable>
      </View>

      {settingsOpen ? (
        <View style={styles.settingsPanel}>
          <Text style={styles.settingsTitle}>
            Cycle time in minutes
          </Text>

          <View style={styles.settingsRows}>
            {cycleIds.map((cycleId) => (
              <View key={cycleId} style={styles.setting}>
                <Text style={styles.settingLabel}>{cycleId}</Text>
                <TextInput
                  accessibilityLabel={`Feed Cycle ${cycleId} minutes`}
                  keyboardType="number-pad"
                  maxLength={2}
                  onChangeText={(value) =>
                    setDrafts((current) => ({
                      ...current,
                      [cycleId]: value.replace(/\D/g, ""),
                    }))
                  }
                  selectTextOnFocus
                  style={styles.settingInput}
                  value={drafts[cycleId]}
                />
                <Text style={styles.settingUnit}>min</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => void saveSettings()}
            style={styles.saveButton}
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </Pressable>
        </View>
      ) : null}

      {reconnecting && showReconnectNotice && !error ? (
        <Text style={styles.reconnecting}>
          Reconnecting to Reef Controller…
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cloudNotice: {
    backgroundColor: "#081D35",
    borderColor: "#164975",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  cloudNoticeTitle: {
    color: "#F3F7F8",
    fontSize: 13,
    fontWeight: "800",
  },
  cloudNoticeCopy: {
    color: "#8FA4BF",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  card: {
    alignSelf: "stretch",
    marginBottom: 10,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 6,
  },
  title: {
    color: "#7890AC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  countdown: {
    color: "#A58AF6",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    marginLeft: 10,
  },
  settingsButton: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginLeft: 8,
    width: 24,
  },
  settingsIcon: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
  },
  cycleButton: {
    alignItems: "center",
    backgroundColor: "#08213D",
    borderColor: "#20B7EC",
    borderRadius: 15,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 48,
  },
  cycleButtonActive: {
    backgroundColor: "#7A35E9",
    borderColor: "#A58AF6",
  },
  cycleLetter: {
    color: "#20B7EC",
    fontSize: 11,
    fontWeight: "900",
  },
  cycleLetterActive: {
    color: "#FFFFFF",
  },
  cancelButton: {
    alignItems: "center",
    backgroundColor: "#A13C55",
    borderRadius: 15,
    height: 34,
    justifyContent: "center",
    marginLeft: 10,
    width: 76,
  },
  cancelText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  settingsPanel: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 12,
  },
  settingsTitle: {
    color: "#8FA4BF",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 10,
  },
  settingsRows: {
    flexDirection: "row",
    gap: 8,
  },
  setting: {
    alignItems: "center",
    flex: 1,
  },
  settingLabel: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 5,
  },
  settingInput: {
    backgroundColor: "#0B3155",
    borderColor: "#164975",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 7,
    textAlign: "center",
    width: "100%",
  },
  settingUnit: {
    color: "#6F7D93",
    fontSize: 10,
    marginTop: 4,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 9,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 40,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.38,
  },
  reconnecting: {
    color: "#F5A623",
    fontSize: 12,
    marginTop: 10,
    textAlign: "right",
  },
  error: {
    color: "#E74C3C",
    fontSize: 12,
    marginTop: 10,
    textAlign: "right",
  },
});
