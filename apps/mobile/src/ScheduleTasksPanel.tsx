import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Equipment } from "@modreef/digital-twin";

import {
  getMaintenanceTasks,
  getScheduleRules,
  getTodayScheduleItems,
} from "./scheduleOverview";

interface ScheduleTasksPanelProps {
  equipment: Equipment[];
  onSelectEquipment: (equipmentId: string) => void;
}

export function ScheduleTasksPanel({
  equipment,
  onSelectEquipment,
}: ScheduleTasksPanelProps) {
  const [calendarMode, setCalendarMode] = useState<"agenda" | "month">("agenda");
  const [selectedDate, setSelectedDate] = useState(() => normalizeDate(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(() => weekDates(selectedDate), [selectedDate]);
  const monthDays = useMemo(() => calendarDates(visibleMonth), [visibleMonth]);
  const agenda = useMemo(
    () => getTodayScheduleItems(equipment, selectedDate),
    [equipment, selectedDate],
  );
  const rules = useMemo(() => getScheduleRules(equipment), [equipment]);
  const tasks = useMemo(() => getMaintenanceTasks(equipment), [equipment]);
  const activeRules = rules.filter((rule) => rule.enabled).length;

  return (
    <View>
      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryValue}>{agenda.length}</Text>
          <Text style={styles.summaryLabel}>SELECTED DAY</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>{activeRules}</Text>
          <Text style={styles.summaryLabel}>ACTIVE RULES</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>
            {tasks.filter((task) => task.status !== "scheduled").length}
          </Text>
          <Text style={styles.summaryLabel}>TASKS DUE</Text>
        </View>
      </View>

      <View style={styles.viewPicker}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setCalendarMode("agenda")}
          style={[styles.viewOption, calendarMode === "agenda" ? styles.viewOptionSelected : undefined]}
        >
          <Text style={[styles.viewOptionText, calendarMode === "agenda" ? styles.viewOptionTextSelected : undefined]}>
            Agenda
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setVisibleMonth(monthStart(selectedDate));
            setCalendarMode("month");
          }}
          style={[styles.viewOption, calendarMode === "month" ? styles.viewOptionSelected : undefined]}
        >
          <Text style={[styles.viewOptionText, calendarMode === "month" ? styles.viewOptionTextSelected : undefined]}>
            Month
          </Text>
        </Pressable>
      </View>

      {calendarMode === "agenda" ? (
        <>
          <CalendarNavigation
            label={weekLabel(days)}
            onNext={() => setSelectedDate(addDays(selectedDate, 7))}
            onPrevious={() => setSelectedDate(addDays(selectedDate, -7))}
          />
          <View style={styles.dayPicker}>
            {days.map((date) => {
              const selected = sameDay(date, selectedDate);
              return (
                <Pressable
                  accessibilityLabel={`Show ${date.toLocaleDateString()}`}
                  accessibilityRole="button"
                  key={date.toISOString()}
                  onPress={() => setSelectedDate(date)}
                  style={[styles.day, selected ? styles.daySelected : undefined]}
                >
                  <Text style={[styles.dayName, selected ? styles.dayTextSelected : undefined]}>
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                  </Text>
                  <Text style={[styles.dayNumber, selected ? styles.dayTextSelected : undefined]}>
                    {date.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <>
          <CalendarNavigation
            label={visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            onNext={() => setVisibleMonth(changeMonth(visibleMonth, 1))}
            onPrevious={() => setVisibleMonth(changeMonth(visibleMonth, -1))}
          />
          <View style={styles.weekdayHeader}>
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <Text key={weekday} style={styles.weekdayLabel}>{weekday}</Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthDays.map((date) => {
              const selected = sameDay(date, selectedDate);
              const inMonth = date.getMonth() === visibleMonth.getMonth();
              const itemCount = getTodayScheduleItems(equipment, date).length;
              return (
                <Pressable
                  accessibilityLabel={`Show ${date.toLocaleDateString()}`}
                  accessibilityRole="button"
                  key={date.toISOString()}
                  onPress={() => {
                    setSelectedDate(date);
                    if (!inMonth) setVisibleMonth(monthStart(date));
                  }}
                  style={[styles.monthDay, selected ? styles.monthDaySelected : undefined]}
                >
                  <Text style={[
                    styles.monthDayNumber,
                    !inMonth ? styles.monthDayOutside : undefined,
                    selected ? styles.dayTextSelected : undefined,
                  ]}>
                    {date.getDate()}
                  </Text>
                  {itemCount > 0 ? (
                    <View style={styles.monthCount}>
                      <Text style={styles.monthCountText}>{itemCount}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.selectedDate}>
        {selectedDate.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </Text>
      {agenda.length === 0 ? (
        <EmptyCard text="No scheduled actions on this day." />
      ) : (
        <View style={styles.card}>
          {agenda.map((item, index) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => onSelectEquipment(item.equipmentId)}
              style={({ pressed }) => [
                styles.timelineRow,
                index < agenda.length - 1 ? styles.rowBorder : undefined,
                pressed ? styles.rowPressed : undefined,
              ]}
            >
              <Text style={styles.timelineTime}>{item.time}</Text>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSummary}>{item.summary}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Configured rules</Text>
      {rules.length === 0 ? (
        <EmptyCard text="No equipment schedules are configured." />
      ) : (
        <View style={styles.card}>
          {rules.map((rule, index) => (
            <Pressable
              accessibilityRole="button"
              key={rule.id}
              onPress={() => onSelectEquipment(rule.equipmentId)}
              style={({ pressed }) => [
                styles.ruleRow,
                index < rules.length - 1 ? styles.rowBorder : undefined,
                pressed ? styles.rowPressed : undefined,
              ]}
            >
              <View style={styles.rowCopy}>
                <View style={styles.ruleHeading}>
                  <Text style={styles.ruleEquipment}>{rule.equipmentName}</Text>
                  <Text
                    style={[
                      styles.ruleStatus,
                      rule.enabled ? styles.ruleStatusEnabled : undefined,
                    ]}
                  >
                    {rule.enabled ? "ENABLED" : "DISABLED"}
                  </Text>
                </View>
                <Text style={styles.rowTitle}>{rule.title}</Text>
                <Text style={styles.rowSummary}>
                  {rule.kind === "interval" ? "REPEATING · " : "POWER · "}
                  {rule.summary}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Maintenance Tasks</Text>
      {tasks.length === 0 ? (
        <EmptyCard text="No scheduled maintenance tasks." />
      ) : (
        <View style={styles.card}>
          {tasks.map((task, index) => (
            <Pressable
              accessibilityRole="button"
              key={task.id}
              onPress={() => onSelectEquipment(task.equipmentId)}
              style={({ pressed }) => [
                styles.taskRow,
                index < tasks.length - 1 ? styles.rowBorder : undefined,
                pressed ? styles.rowPressed : undefined,
              ]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{task.title}</Text>
                <Text style={styles.rowSummary}>
                  Due {new Date(task.dueAt).toLocaleDateString()}
                </Text>
              </View>
              <Text
                style={[
                  styles.taskStatus,
                  task.status === "overdue"
                    ? styles.taskStatusOverdue
                    : task.status === "upcoming"
                      ? styles.taskStatusUpcoming
                      : styles.taskStatusScheduled,
                ]}
              >
                {task.status.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const CALENDAR_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function normalizeDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized;
}

function monthStart(date: Date): Date {
  const start = normalizeDate(date);
  start.setDate(1);
  return start;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return normalizeDate(result);
}

function changeMonth(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + amount);
  return normalizeDate(result);
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function weekDates(selectedDate: Date): Date[] {
  const start = addDays(selectedDate, -selectedDate.getDay());
  return Array.from({ length: 7 }, (_, offset) => addDays(start, offset));
}

function calendarDates(month: Date): Date[] {
  const start = monthStart(month);
  const gridStart = addDays(start, -start.getDay());
  return Array.from({ length: 42 }, (_, offset) => addDays(gridStart, offset));
}

function weekLabel(days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  const firstLabel = first.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastLabel = last.toLocaleDateString(undefined, {
    month: first.getMonth() === last.getMonth() ? undefined : "short",
    day: "numeric",
    year: first.getFullYear() === last.getFullYear() ? undefined : "numeric",
  });
  return `${firstLabel} – ${lastLabel}`;
}

function CalendarNavigation({
  label,
  onNext,
  onPrevious,
}: {
  label: string;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <View style={styles.calendarNavigation}>
      <Pressable
        accessibilityLabel="Previous calendar period"
        accessibilityRole="button"
        onPress={onPrevious}
        style={styles.calendarNavigationButton}
      >
        <Text style={styles.calendarNavigationChevron}>‹</Text>
      </Pressable>
      <Text style={styles.calendarNavigationLabel}>{label}</Text>
      <Pressable
        accessibilityLabel="Next calendar period"
        accessibilityRole="button"
        onPress={onNext}
        style={styles.calendarNavigationButton}
      >
        <Text style={styles.calendarNavigationChevron}>›</Text>
      </Pressable>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#071B31",
    borderColor: "#153E63",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    overflow: "hidden",
  },
  day: {
    alignItems: "center",
    borderColor: "#153E63",
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    minHeight: 52,
    justifyContent: "center",
  },
  dayName: { color: "#7892AD", fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  dayNumber: { color: "#D8E5F2", fontSize: 16, fontWeight: "900", marginTop: 2 },
  dayPicker: { flexDirection: "row", gap: 6, marginBottom: 10 },
  daySelected: { backgroundColor: "#0A8FEA", borderColor: "#20B7EC" },
  dayTextSelected: { color: "#FFFFFF" },
  chevron: { color: "#20B7EC", fontSize: 25, lineHeight: 25 },
  emptyCard: {
    backgroundColor: "#071B31",
    borderColor: "#153E63",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
    padding: 18,
  },
  emptyText: { color: "#8FA4BF", fontSize: 13 },
  calendarNavigation: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  calendarNavigationButton: { alignItems: "center", borderColor: "#153E63", borderRadius: 11, borderWidth: 1, height: 38, justifyContent: "center", width: 42 },
  calendarNavigationChevron: { color: "#20B7EC", fontSize: 24, lineHeight: 26, textAlign: "center" },
  calendarNavigationLabel: { color: "#D8E5F2", fontSize: 13, fontWeight: "900" },
  monthCount: { alignItems: "center", backgroundColor: "#0A8FEA", borderRadius: 8, height: 16, justifyContent: "center", marginTop: 3, minWidth: 16, paddingHorizontal: 4 },
  monthCountText: { color: "#FFFFFF", fontSize: 8, fontWeight: "900" },
  monthDay: { alignItems: "center", borderBottomColor: "#153E63", borderBottomWidth: 1, borderRightColor: "#153E63", borderRightWidth: 1, height: 58, justifyContent: "center", width: "14.2857%" },
  monthDayNumber: { color: "#D8E5F2", fontSize: 12, fontWeight: "900" },
  monthDayOutside: { color: "#48647F" },
  monthDaySelected: { backgroundColor: "#0A8FEA" },
  monthGrid: { backgroundColor: "#071B31", borderColor: "#153E63", borderRadius: 12, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", marginBottom: 12, overflow: "hidden" },
  rowBorder: { borderBottomColor: "#153E63", borderBottomWidth: 1 },
  rowCopy: { flex: 1 },
  rowPressed: { backgroundColor: "#0D2B48" },
  rowSummary: { color: "#8198B1", fontSize: 11, lineHeight: 16, marginTop: 3 },
  rowTitle: { color: "#E7EEF6", fontSize: 13, fontWeight: "800" },
  ruleEquipment: {
    color: "#20B7EC",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  ruleHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  ruleStatus: { color: "#7892AD", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  ruleStatusEnabled: { color: "#42D7A0" },
  ruleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 75,
    padding: 15,
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginBottom: 10 },
  selectedDate: { color: "#9CB0C6", fontSize: 11, fontWeight: "800", marginBottom: 10 },
  summaryCard: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#1A4C76",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 24,
    paddingVertical: 17,
  },
  summaryDivider: { backgroundColor: "#1A4C76", height: 34, width: 1 },
  summaryLabel: { color: "#7892AD", fontSize: 9, fontWeight: "900", letterSpacing: 0.7, marginTop: 3 },
  summaryValue: { color: "#FFFFFF", fontSize: 23, fontWeight: "800", textAlign: "center" },
  taskRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 15,
  },
  taskStatus: { fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  taskStatusOverdue: { color: "#F87171" },
  taskStatusScheduled: { color: "#7892AD" },
  taskStatusUpcoming: { color: "#FBBF24" },
  timelineRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 13,
    minHeight: 61,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  timelineTime: { color: "#20B7EC", fontSize: 15, fontWeight: "900", width: 48 },
  viewOption: { alignItems: "center", borderRadius: 9, flex: 1, justifyContent: "center", minHeight: 36 },
  viewOptionSelected: { backgroundColor: "#0A8FEA" },
  viewOptionText: { color: "#7892AD", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  viewOptionTextSelected: { color: "#FFFFFF" },
  viewPicker: { backgroundColor: "#071B31", borderColor: "#153E63", borderRadius: 11, borderWidth: 1, flexDirection: "row", marginBottom: 14, padding: 3 },
  weekdayHeader: { flexDirection: "row" },
  weekdayLabel: { color: "#7892AD", fontSize: 8, fontWeight: "900", paddingBottom: 7, textAlign: "center", width: "14.2857%" },
});
