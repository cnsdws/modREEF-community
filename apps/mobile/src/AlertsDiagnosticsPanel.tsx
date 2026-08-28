import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { createDashboardEvent } from "./dashboardConnection";
import type { AquariumEvent } from "@modreef/digital-twin";
import type {
  AlertMetric,
  AlertReadings,
  AlertRules,
  DiagnosticIssue,
  DiagnosticSeverity,
} from "./diagnostics";
import {
  acknowledgedAlertsFromEvents,
  defaultAlertRules,
} from "./diagnostics";
import { SwipeActionRow } from "./ui/SwipeActionRow";

interface DiagnosticHistoryEntry {
  id: string;
  issueId: string;
  occurredAt: string;
  severity: DiagnosticSeverity;
  status: "active" | "acknowledged" | "resolved";
  title: string;
}

interface StoredDiagnosticsState {
  active: Record<string, DiagnosticIssue>;
  acknowledged: Record<string, string>;
  history: DiagnosticHistoryEntry[];
  rules: AlertRules;
}

interface AlertsDiagnosticsPanelProps {
  aquariumId: string;
  issues: DiagnosticIssue[];
  readings: AlertReadings;
  onAcknowledgedChange: (acknowledged: Record<string, string>) => void;
  onRulesChange: (rules: AlertRules) => void;
  onRulesSave: (rules: AlertRules) => void;
  rules: AlertRules;
  refreshVersion: number;
  sharedAcknowledged: Record<string, string>;
}

const emptyState: StoredDiagnosticsState = {
  active: {},
  acknowledged: {},
  history: [],
  rules: defaultAlertRules,
};

const alertMetrics: AlertMetric[] = ["temperature", "ph", "orp", "salinity"];

function storageKey(aquariumId: string): string {
  return `modreef.diagnostics.${aquariumId}`;
}

function browserStorage(): Storage | null {
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

async function readStoredState(aquariumId: string): Promise<string | null> {
  if (await SecureStore.isAvailableAsync()) return SecureStore.getItemAsync(storageKey(aquariumId));
  return browserStorage()?.getItem(storageKey(aquariumId)) ?? null;
}

async function writeStoredState(aquariumId: string, value: string): Promise<void> {
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.setItemAsync(storageKey(aquariumId), value);
  } else {
    browserStorage()?.setItem(storageKey(aquariumId), value);
  }
}

export async function loadAlertPreferences(aquariumId: string): Promise<{
  acknowledged: Record<string, string>;
  rules: AlertRules;
}> {
  const stored = await readStoredState(aquariumId);
  if (!stored) {
    return { acknowledged: {}, rules: defaultAlertRules };
  }

  const parsed = JSON.parse(stored) as Partial<StoredDiagnosticsState>;
  return {
    acknowledged:
      parsed.acknowledged && typeof parsed.acknowledged === "object"
        ? parsed.acknowledged
        : {},
    rules: restoredRules(parsed.rules),
  };
}

export async function saveAlertRules(
  aquariumId: string,
  rules: AlertRules,
): Promise<void> {
  const state = await loadStoredDiagnosticsState(aquariumId);
  await writeStoredState(aquariumId, JSON.stringify({ ...state, rules }));
}

async function loadStoredDiagnosticsState(
  aquariumId: string,
): Promise<StoredDiagnosticsState> {
  const stored = await readStoredState(aquariumId);
  if (!stored) return emptyState;

  const parsed = JSON.parse(stored) as Partial<StoredDiagnosticsState>;
  return {
    active:
      parsed.active && typeof parsed.active === "object"
        ? parsed.active
        : {},
    acknowledged:
      parsed.acknowledged && typeof parsed.acknowledged === "object"
        ? parsed.acknowledged
        : {},
    history: Array.isArray(parsed.history) ? parsed.history.slice(0, 100) : [],
    rules: restoredRules(parsed.rules),
  };
}

export async function reconcileAlertLifecycle(
  aquariumId: string,
  issues: DiagnosticIssue[],
  events: AquariumEvent[],
): Promise<{
  acknowledged: Record<string, string>;
  changed: boolean;
  rules: AlertRules;
}> {
  const state = await loadStoredDiagnosticsState(aquariumId);
  const current = new Map(issues.map((issue) => [issue.id, issue]));
  const latestShared = new Map<
    string,
    Extract<AquariumEvent, { type: "activity" }>
  >();
  for (const event of [...events].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  )) {
    if (event.type === "activity" && event.category === "alert" && event.alertId) {
      latestShared.set(event.alertId, event);
    }
  }
  const sharedActiveIds = new Set(
    [...latestShared].flatMap(([alertId, event]) =>
      event.action === "activated" || event.action === "acknowledged"
        ? [alertId]
        : [],
    ),
  );
  const activated = issues.filter(
    (issue) => !state.active[issue.id] && !sharedActiveIds.has(issue.id),
  );
  const locallyResolved = Object.values(state.active).filter(
    (issue) => !current.has(issue.id),
  );
  const locallyResolvedIds = new Set(locallyResolved.map((issue) => issue.id));
  const sharedResolved: DiagnosticIssue[] = [...sharedActiveIds].flatMap(
    (alertId) => {
      if (current.has(alertId) || locallyResolvedIds.has(alertId)) return [];
      const event = latestShared.get(alertId)!;
      return [{
        id: alertId,
        title: event.title
          .replace(/^Alert activated: /, "")
          .replace(/^Acknowledged alert: /, ""),
        summary: "The monitored condition returned to normal.",
        severity: "warning",
      }];
    },
  );
  const resolved = [...locallyResolved, ...sharedResolved];
  const sharedAcknowledged = acknowledgedAlertsFromEvents(events);

  if (activated.length === 0 && resolved.length === 0) {
    return {
      acknowledged: { ...state.acknowledged, ...sharedAcknowledged },
      changed: false,
      rules: state.rules,
    };
  }

  const acknowledged = { ...state.acknowledged, ...sharedAcknowledged };
  const active = { ...state.active };
  for (const issue of activated) {
    active[issue.id] = issue;
    delete acknowledged[issue.id];
  }
  for (const issue of resolved) {
    delete active[issue.id];
    delete acknowledged[issue.id];
  }

  const nextState: StoredDiagnosticsState = {
    ...state,
    active,
    acknowledged,
    history: [
      ...activated.map((issue) => historyEntry(issue, "active")),
      ...resolved.map((issue) => historyEntry(issue, "resolved")),
      ...state.history,
    ].slice(0, 100),
  };

  await writeStoredState(aquariumId, JSON.stringify(nextState));

  await Promise.all([
    ...activated.map((issue) => createDashboardEvent({
      type: "activity",
      category: "alert",
      action: "activated",
      alertId: issue.id,
      title: `Alert activated: ${issue.title}`,
      details: issue.summary,
      source: "automation",
    })),
    ...resolved.map((issue) => createDashboardEvent({
      type: "activity",
      category: "alert",
      action: "resolved",
      alertId: issue.id,
      title: `Alert resolved: ${issue.title}`,
      details: "The monitored condition returned to normal.",
      source: "automation",
    })),
  ]);

  return { acknowledged, changed: true, rules: state.rules };
}

function historyEntry(
  issue: DiagnosticIssue,
  status: DiagnosticHistoryEntry["status"],
  occurredAt = new Date().toISOString(),
): DiagnosticHistoryEntry {
  return {
    id: `${issue.id}:${status}:${occurredAt}`,
    issueId: issue.id,
    occurredAt,
    severity: issue.severity,
    status,
    title: issue.title,
  };
}

function restoredRules(value: unknown): AlertRules {
  if (!value || typeof value !== "object") {
    return defaultAlertRules;
  }

  const stored = value as Partial<AlertRules>;
  const storedMetrics: Partial<AlertRules["metrics"]> =
    stored.metrics && typeof stored.metrics === "object"
      ? stored.metrics
      : {};

  return {
    edgeWatchdogEnabled:
      typeof stored.edgeWatchdogEnabled === "boolean"
        ? stored.edgeWatchdogEnabled
        : defaultAlertRules.edgeWatchdogEnabled,
    equipmentEnabled:
      typeof stored.equipmentEnabled === "boolean"
        ? stored.equipmentEnabled
        : defaultAlertRules.equipmentEnabled,
    metrics: Object.fromEntries(
      alertMetrics.map((metric) => {
        const fallback = defaultAlertRules.metrics[metric];
        const candidate = storedMetrics[metric];

        return [
          metric,
          {
            ...fallback,
            ...(candidate && typeof candidate === "object"
              ? candidate
              : {}),
          },
        ];
      }),
    ) as AlertRules["metrics"],
  };
}

export function AlertsDiagnosticsPanel({
  aquariumId,
  issues,
  readings,
  onAcknowledgedChange,
  onRulesChange,
  onRulesSave,
  rules,
  refreshVersion,
  sharedAcknowledged,
}: AlertsDiagnosticsPanelProps) {
  const [state, setState] =
    useState<StoredDiagnosticsState>(emptyState);
  const [restored, setRestored] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const stored = await readStoredState(aquariumId);

        if (!stored || cancelled) {
          return;
        }

        setState(await loadStoredDiagnosticsState(aquariumId));
      } catch {
        // Damaged local history should never prevent diagnostics from opening.
      } finally {
        if (!cancelled) {
          setRestored(true);
        }
      }
    }

    setRestored(false);
    setState(emptyState);
    void restore();

    return () => {
      cancelled = true;
    };
  }, [aquariumId, refreshVersion]);

  useEffect(() => {
    setState((current) => ({ ...current, rules }));
  }, [rules]);

  useEffect(() => {
    if (!restored) {
      return;
    }

    onAcknowledgedChange(state.acknowledged);

    async function persist() {
      try {
        await writeStoredState(aquariumId, JSON.stringify(state));
      } catch {
        // Diagnostics remain usable even when local persistence is unavailable.
      }
    }

    void persist();
  }, [aquariumId, onAcknowledgedChange, restored, state]);

  useEffect(() => {
    if (restored) {
      onRulesChange(state.rules);
    }
  }, [onRulesChange, restored, state.rules]);

  function updateRules(updater: (rules: AlertRules) => AlertRules) {
    const updated = updater(state.rules);
    setState((current) => ({ ...current, rules: updated }));
    onRulesSave(updated);
  }

  async function acknowledge(issue: DiagnosticIssue) {
    const occurredAt = new Date().toISOString();

    setJournalError(null);
    setState((current) => ({
      ...current,
      acknowledged: {
        ...current.acknowledged,
        [issue.id]: occurredAt,
      },
      history: [
        historyEntry(issue, "acknowledged", occurredAt),
        ...current.history,
      ].slice(0, 100),
    }));

    try {
      await createDashboardEvent({
        type: "activity",
        category: "alert",
        action: "acknowledged",
        alertId: issue.id,
        title: `Acknowledged alert: ${issue.title}`,
        details: issue.summary,
        source: "manual",
      });
    } catch (error) {
      setJournalError(
        `Alert was acknowledged locally, but the journal entry could not be saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  function deleteLocalHistoryEntry(entryId: string) {
    setState((current) => ({
      ...current,
      history: current.history.filter((entry) => entry.id !== entryId),
    }));
  }

  const activeIssues = issues.filter(
    (issue) =>
      !state.acknowledged[issue.id] && !sharedAcknowledged[issue.id],
  );
  const visibleHistory = state.history
    .filter((entry) => entry.status !== "active")
    .slice(0, 50);

  return (
    <View>
      <Text style={styles.sectionTitle}>Active Issues</Text>
      {journalError ? (
        <Text style={styles.journalError}>{journalError}</Text>
      ) : null}
      {activeIssues.length === 0 ? (
        <Text style={styles.noActiveIssues}>No active issues.</Text>
      ) : (
        <View style={styles.listCard}>
          {activeIssues.map((issue, index) => (
            <View
              key={issue.id}
              style={[
                styles.issueRow,
                index < activeIssues.length - 1 ? styles.rowBorder : undefined,
              ]}
            >
              <View
                style={[
                  styles.severityBar,
                  issue.severity === "critical"
                    ? styles.severityCritical
                    : styles.severityWarning,
                ]}
              />
              <View style={styles.issueCopy}>
                <View style={styles.issueHeading}>
                  <Text style={styles.issueTitle}>{issue.title}</Text>
                  <Text
                    style={[
                      styles.severityLabel,
                      issue.severity === "critical"
                        ? styles.severityLabelCritical
                        : styles.severityLabelWarning,
                    ]}
                  >
                    {issue.severity.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.issueSummary}>{issue.summary}</Text>
                <Pressable
                  accessibilityLabel={`Acknowledge ${issue.title}`}
                  accessibilityRole="button"
                  onPress={() => acknowledge(issue)}
                  style={({ pressed }) => [
                    styles.acknowledgeButton,
                    pressed ? styles.acknowledgeButtonPressed : undefined,
                  ]}
                >
                  <Text style={styles.acknowledgeButtonText}>Acknowledge</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Alarm History</Text>
      {visibleHistory.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No alarm history yet.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {visibleHistory.map((entry, index) => (
            <SwipeableHistoryRow
              entry={entry}
              key={entry.id}
              onDelete={() => deleteLocalHistoryEntry(entry.id)}
              showBorder={index < visibleHistory.length - 1}
            />
          ))}
        </View>
      )}

      <Pressable
        accessibilityLabel={`${rulesExpanded ? "Collapse" : "Expand"} alarm rules`}
        accessibilityRole="button"
        accessibilityState={{ expanded: rulesExpanded }}
        onPress={() => setRulesExpanded((current) => !current)}
        style={styles.sectionHeading}
      >
        <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>
          Equipment Alarm Rules
        </Text>
        <View style={styles.rulesHeaderRight}>
          <Text style={styles.instantSave}>SAVED AUTOMATICALLY</Text>
          <Text style={styles.collapseGlyph}>{rulesExpanded ? "▴" : "▾"}</Text>
        </View>
      </Pressable>
      {rulesExpanded ? <View style={styles.listCard}>
        <RuleToggleRow
          enabled={state.rules.edgeWatchdogEnabled}
          label="Reef Controller watchdog"
          onPress={() =>
            updateRules((rules) => ({
              ...rules,
              edgeWatchdogEnabled: !rules.edgeWatchdogEnabled,
            }))
          }
          summary="Alarm when the app cannot reach the local Reef Controller."
        />
        <RuleToggleRow
          enabled={state.rules.equipmentEnabled}
          label="Equipment health"
          onPress={() =>
            updateRules((rules) => ({
              ...rules,
              equipmentEnabled: !rules.equipmentEnabled,
            }))
          }
          summary="Alarm for offline equipment and device-reported faults."
        />
      </View> : null}

    </View>
  );
}

function SwipeableHistoryRow({
  entry,
  onDelete,
  showBorder,
}: {
  entry: DiagnosticHistoryEntry;
  onDelete: () => void;
  showBorder: boolean;
}) {
  return (
    <View style={[styles.swipeContainer, showBorder ? styles.rowBorder : undefined]}>
      <SwipeActionRow
        accessibilityLabel={`Delete ${entry.title} from local alarm history`}
        actionLabel="Delete"
        onAction={onDelete}
      >
        <View style={styles.historyRow}>
          <View style={styles.historyCopy}>
            <Text style={styles.historyTitle}>{entry.title}</Text>
            <Text style={styles.historyTime}>
              {new Date(entry.occurredAt).toLocaleString()}
            </Text>
          </View>
          <Text
            style={[
              styles.historyStatus,
              entry.status === "resolved"
                ? styles.historyResolved
                : entry.status === "acknowledged"
                  ? styles.historyAcknowledged
                  : styles.historyActive,
            ]}
          >
            {entry.status.toUpperCase()}
          </Text>
        </View>
      </SwipeActionRow>
    </View>
  );
}

function RuleToggleRow({
  enabled,
  label,
  onPress,
  summary,
}: {
  enabled: boolean;
  label: string;
  onPress: () => void;
  summary: string;
}) {
  return (
    <View style={[styles.ruleRow, styles.rowBorder]}>
      <View style={styles.ruleHeading}>
        <View style={styles.ruleCopy}>
          <Text style={styles.ruleLabel}>{label}</Text>
          <Text style={styles.ruleSummary}>{summary}</Text>
        </View>
        <Pressable
          accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${label}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          onPress={onPress}
          style={[
            styles.ruleToggle,
            enabled ? styles.ruleToggleEnabled : undefined,
          ]}
        >
          <Text
            style={[
              styles.ruleToggleText,
              enabled ? styles.ruleToggleTextEnabled : undefined,
            ]}
          >
            {enabled ? "ON" : "OFF"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  acknowledgeButton: {
    alignSelf: "flex-start",
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  acknowledgeButtonPressed: { backgroundColor: "#103B60" },
  acknowledgeButtonText: { color: "#58CCF4", fontSize: 12, fontWeight: "800" },
  acknowledgedText: { color: "#6F879F", fontSize: 11, marginTop: 9 },
  collapseGlyph: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", lineHeight: 22 },
  emptyCard: {
    backgroundColor: "#071B31",
    borderColor: "#153E63",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    padding: 18,
  },
  emptyText: { color: "#8FA4BF", fontSize: 13 },
  historyAcknowledged: { color: "#FBBF24" },
  historyActive: { color: "#F87171" },
  historyCopy: { flex: 1 },
  historyResolved: { color: "#34D399" },
  historyRow: {
    alignItems: "center",
    backgroundColor: "#071B31",
    flexDirection: "row",
    gap: 14,
    minHeight: 58,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  historyStatus: { fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  historyTime: { color: "#6F879F", fontSize: 11, marginTop: 3 },
  historyTitle: { color: "#D9E4F0", fontSize: 13, fontWeight: "700" },
  issueCopy: { flex: 1 },
  issueHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  issueRow: { flexDirection: "row", gap: 13, padding: 15 },
  issueSummary: { color: "#91A6BD", fontSize: 12, lineHeight: 18, marginTop: 5 },
  issueTitle: { color: "#FFFFFF", flex: 1, fontSize: 14, fontWeight: "800" },
  instantSave: { color: "#56718C", fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  journalError: { color: "#F87171", fontSize: 12, lineHeight: 17, marginBottom: 10 },
  listCard: {
    backgroundColor: "#071B31",
    borderColor: "#153E63",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    overflow: "hidden",
  },
  noActiveIssues: { color: "#8FA4BF", fontSize: 13, marginBottom: 24 },
  rowBorder: { borderBottomColor: "#153E63", borderBottomWidth: 1 },
  ruleCopy: { flex: 1, paddingRight: 12 },
  rulesHeaderRight: { alignItems: "center", flexDirection: "row", gap: 10 },
  ruleHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ruleLabel: { color: "#E5EEF8", fontSize: 13, fontWeight: "800" },
  ruleRow: { paddingHorizontal: 15, paddingVertical: 13 },
  ruleStatus: { color: "#6F879F", fontSize: 10, marginTop: 3 },
  ruleSummary: { color: "#8299B2", fontSize: 11, lineHeight: 16, marginTop: 4 },
  ruleToggle: {
    alignItems: "center",
    borderColor: "#38546E",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 25,
    minWidth: 45,
  },
  ruleToggleEnabled: { backgroundColor: "#123F59", borderColor: "#20B7EC" },
  ruleToggleText: { color: "#71869B", fontSize: 10, fontWeight: "900" },
  ruleToggleTextEnabled: { color: "#58CCF4" },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginBottom: 10 },
  sectionTitleInline: { marginBottom: 0 },
  severityBar: { borderRadius: 3, width: 5 },
  severityCritical: { backgroundColor: "#F87171" },
  severityLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  severityLabelCritical: { color: "#F87171" },
  severityLabelWarning: { color: "#FBBF24" },
  severityWarning: { backgroundColor: "#FBBF24" },
  summaryCard: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#1A4C76",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 15,
    marginBottom: 24,
    padding: 17,
  },
  summaryCopy: { flex: 1 },
  summaryGlyph: {
    alignItems: "center",
    backgroundColor: "#5C2028",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  summaryGlyphClear: { backgroundColor: "#12483E" },
  summaryGlyphText: { color: "#FFFFFF", fontSize: 23, fontWeight: "900" },
  summaryText: { color: "#8FA4BF", fontSize: 12, lineHeight: 18, marginTop: 4 },
  summaryTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  swipeContainer: { overflow: "hidden" },
  thresholdField: { flex: 1 },
  thresholdInput: {
    backgroundColor: "#0B243D",
    borderColor: "#234B6D",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  thresholdLabel: { color: "#58728C", fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  thresholdRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 9,
    marginTop: 11,
  },
  thresholdUnit: { color: "#7890A8", fontSize: 11, minWidth: 25, paddingBottom: 10 },
});
