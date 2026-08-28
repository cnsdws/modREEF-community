import {
  advancedOutletProgramSchema,
  type AdvancedOutletCondition,
  type AdvancedOutletProgram,
  type AdvancedOutletRule,
} from "@modreef/digital-twin";

export type BasicAdvancedConditionType =
  | "time-range"
  | "feed-cycle"
  | "water-change"
  | "measurement"
  | "equipment-state"
  | "oscillation";

export const basicAdvancedConditionTypes: Array<{
  type: BasicAdvancedConditionType;
  label: string;
}> = [
  { type: "time-range", label: "Time" },
  { type: "feed-cycle", label: "Feed" },
  { type: "water-change", label: "Water Change" },
  { type: "measurement", label: "Measurement" },
  { type: "equipment-state", label: "Equipment" },
  { type: "oscillation", label: "Repeat" },
];

export function createCondition(type: BasicAdvancedConditionType): AdvancedOutletCondition {
  if (type === "time-range") return { type, startTime: "08:00", endTime: "20:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
  if (type === "feed-cycle") return { type, cycle: "A", active: true };
  if (type === "water-change") return { type, active: true };
  if (type === "measurement") return { type, measurementId: "temperature", comparison: "gt", value: 82, unit: "degF" };
  if (type === "equipment-state") return { type, equipmentId: "", state: "on" };
  return { type, offsetSeconds: 0, onSeconds: 60, offSeconds: 300 };
}

export function createAdvancedRule(index: number): AdvancedOutletRule {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${index}`,
    name: `Rule ${index + 1}`,
    enabled: true,
    condition: createCondition("time-range"),
    action: { type: "set-power", state: "off" },
  };
}

export function createAdvancedProgram(
  equipmentId: string,
  equipmentName: string,
): AdvancedOutletProgram {
  return {
    schema: advancedOutletProgramSchema,
    version: 1,
    id: `${equipmentId}-advanced`,
    revision: 1,
    name: `${equipmentName} advanced program`,
    enabled: false,
    defaultState: "off",
    fallbackState: "off",
    rules: [],
    safety: {
      missingInputState: "off",
      deferOnSeconds: 0,
      deferOffSeconds: 0,
      minimumOnSeconds: 0,
      minimumOffSeconds: 0,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

export function moveAdvancedRule(
  rules: AdvancedOutletRule[],
  index: number,
  offset: -1 | 1,
): AdvancedOutletRule[] {
  const destination = index + offset;
  if (destination < 0 || destination >= rules.length) return rules;
  const moved = [...rules];
  [moved[index], moved[destination]] = [moved[destination]!, moved[index]!];
  return moved;
}

export function isBasicAdvancedCondition(
  condition: AdvancedOutletCondition,
): condition is Extract<AdvancedOutletCondition, { type: BasicAdvancedConditionType }> {
  return basicAdvancedConditionTypes.some((item) => item.type === condition.type);
}

export interface AdvancedProgramSourceIssue {
  line: number;
  message: string;
  incomplete?: boolean;
}

export type AdvancedProgramSourceResult =
  | { ok: true; program: AdvancedOutletProgram }
  | { ok: false; issues: AdvancedProgramSourceIssue[] };

export interface AdvancedProgramCompletion {
  label: string;
  source: string;
}

const sourceCompletions: AdvancedProgramCompletion[] = [
  { label: "Default OFF", source: "DEFAULT OFF" },
  { label: "Default ON", source: "DEFAULT ON" },
  { label: "Missing data OFF", source: "MISSING DATA OFF" },
  { label: "Missing data ON", source: "MISSING DATA ON" },
  { label: "Time rule", source: "IF TIME 08:00 TO 20:00 THEN ON" },
  { label: "Weekday time rule", source: "IF TIME 08:00 TO 20:00 DAYS MON,TUE,WED,THU,FRI THEN ON" },
  { label: "Feed rule", source: "IF FEED A THEN OFF" },
  { label: "Water Change rule", source: "IF WATER CHANGE THEN OFF" },
  { label: "Temperature rule", source: "IF TEMPERATURE > 82 THEN OFF" },
  { label: "pH rule", source: "IF PH < 7.9 THEN OFF" },
  { label: "ORP rule", source: "IF ORP > 450 THEN OFF" },
  { label: "Salinity rule", source: "IF SALINITY < 34 THEN OFF" },
  { label: "Equipment rule", source: 'IF EQUIPMENT "equipment-id" IS ON THEN ON' },
  { label: "Repeat rule", source: "IF REPEAT ON 60 OFF 300 THEN ON" },
  { label: "Defer ON", source: "DEFER ON 300" },
  { label: "Defer OFF", source: "DEFER OFF 300" },
  { label: "Minimum ON", source: "MINIMUM ON 300" },
  { label: "Minimum OFF", source: "MINIMUM OFF 300" },
  { label: "Maximum continuous ON", source: "MAXIMUM CONTINUOUS ON 3600" },
  { label: "Maximum daily ON", source: "MAXIMUM DAILY ON 43200" },
  { label: "Maximum changes/hour", source: "MAXIMUM CHANGES PER HOUR 6" },
];

function sourceLineAt(source: string, cursor: number): { start: number; end: number; text: string } {
  const safeCursor = Math.max(0, Math.min(cursor, source.length));
  const start = source.lastIndexOf("\n", safeCursor - 1) + 1;
  const nextBreak = source.indexOf("\n", safeCursor);
  const end = nextBreak === -1 ? source.length : nextBreak;
  return { start, end, text: source.slice(start, end) };
}

/** Returns command templates relevant to the text on the active line. */
export function advancedProgramCompletions(
  source: string,
  cursor: number,
): AdvancedProgramCompletion[] {
  const query = sourceLineAt(source, cursor).text.trim().toUpperCase();
  if (query === "" || query.startsWith("#")) return [];
  if (sourceCompletions.some((completion) => completion.source === query)) return [];
  return sourceCompletions.filter((completion) =>
    completion.source.startsWith(query) || completion.label.toUpperCase().startsWith(query),
  ).slice(0, 6);
}

/** Replaces only the active line and returns the new caret position. */
export function applyAdvancedProgramCompletion(
  source: string,
  cursor: number,
  completion: string,
): { source: string; cursor: number } {
  const line = sourceLineAt(source, cursor);
  return {
    source: `${source.slice(0, line.start)}${completion}${source.slice(line.end)}`,
    cursor: line.start + completion.length,
  };
}

const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const measurementSource: Record<string, { id: string; unit: string }> = {
  TEMPERATURE: { id: "temperature", unit: "degF" },
  TEMP: { id: "temperature", unit: "degF" },
  PH: { id: "ph", unit: "" },
  ORP: { id: "orp", unit: "mV" },
  SALINITY: { id: "salinity", unit: "ppt" },
};

function sourceState(value: string): "on" | "off" {
  return value.toLowerCase() as "on" | "off";
}

function sourceInteger(value: string): number {
  return Number.parseInt(value, 10);
}

function sourceRule(line: number, condition: AdvancedOutletCondition, state: "on" | "off"): AdvancedOutletRule {
  return {
    id: `source-line-${line}`,
    name: `Line ${line}`,
    enabled: true,
    condition,
    action: { type: "set-power", state },
  };
}

function looksLikeIncompleteCommand(text: string): boolean {
  const upper = text.toUpperCase();
  const commandStarts = ["DEFAULT", "MISSING DATA", "IF", "DEFER", "MINIMUM", "MAXIMUM"];
  return commandStarts.some((command) => command.startsWith(upper) || upper.startsWith(`${command} `) || upper === command);
}

/** Parses the intentionally small, line-oriented Advanced Outlet syntax. */
export function parseAdvancedProgramSource(
  sourceText: string,
  base: AdvancedOutletProgram,
): AdvancedProgramSourceResult {
  const program: AdvancedOutletProgram = {
    ...base,
    enabled: true,
    defaultState: "off",
    fallbackState: "off",
    rules: [],
    safety: {
      missingInputState: "off",
      deferOnSeconds: 0,
      deferOffSeconds: 0,
      minimumOnSeconds: 0,
      minimumOffSeconds: 0,
    },
    sourceText,
  };
  const issues: AdvancedProgramSourceIssue[] = [];

  sourceText.split(/\r?\n/).forEach((original, index) => {
    const line = index + 1;
    const text = original.trim();
    if (text === "" || text.startsWith("#")) return;
    let match: RegExpExecArray | null;

    match = /^DEFAULT\s+(ON|OFF)$/i.exec(text);
    if (match) { program.defaultState = sourceState(match[1]!); return; }
    match = /^MISSING\s+DATA\s+(ON|OFF)$/i.exec(text);
    if (match) { program.safety.missingInputState = sourceState(match[1]!); return; }
    match = /^IF\s+TIME\s+((?:[01]\d|2[0-3]):[0-5]\d)\s+TO\s+((?:[01]\d|2[0-3]):[0-5]\d)(?:\s+DAYS\s+([A-Z,]+))?\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      const weekdays = match[3]
        ? match[3]!.toUpperCase().split(",").map((day) => dayNames.indexOf(day))
        : [0, 1, 2, 3, 4, 5, 6];
      if (weekdays.some((day) => day < 0)) {
        issues.push({ line, message: "DAYS must use SUN,MON,TUE,WED,THU,FRI,SAT." });
      } else {
        program.rules.push(sourceRule(line, {
          type: "time-range", startTime: match[1]!, endTime: match[2]!, weekdays,
        }, sourceState(match[4]!)));
      }
      return;
    }
    match = /^IF\s+FEED\s+([ABC])\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      program.rules.push(sourceRule(line, { type: "feed-cycle", cycle: match[1]!.toUpperCase() as "A" | "B" | "C", active: true }, sourceState(match[2]!)));
      return;
    }
    match = /^IF\s+WATER\s+CHANGE\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      program.rules.push(sourceRule(line, { type: "water-change", active: true }, sourceState(match[1]!)));
      return;
    }
    match = /^IF\s+(TEMPERATURE|TEMP|PH|ORP|SALINITY)\s*([<>])\s*(-?\d+(?:\.\d+)?)\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      const measurement = measurementSource[match[1]!.toUpperCase()]!;
      program.rules.push(sourceRule(line, {
        type: "measurement",
        measurementId: measurement.id,
        comparison: match[2] === ">" ? "gt" : "lt",
        value: Number(match[3]),
        unit: measurement.unit,
      }, sourceState(match[4]!)));
      return;
    }
    match = /^IF\s+EQUIPMENT\s+(?:"([^"]+)"|(\S+))\s+IS\s+(ON|OFF)\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      program.rules.push(sourceRule(line, {
        type: "equipment-state", equipmentId: match[1] ?? match[2]!, state: sourceState(match[3]!),
      }, sourceState(match[4]!)));
      return;
    }
    match = /^IF\s+REPEAT\s+ON\s+(\d+)\s+OFF\s+(\d+)(?:\s+OFFSET\s+(\d+))?\s+THEN\s+(ON|OFF)$/i.exec(text);
    if (match) {
      program.rules.push(sourceRule(line, {
        type: "oscillation", onSeconds: sourceInteger(match[1]!), offSeconds: sourceInteger(match[2]!), offsetSeconds: sourceInteger(match[3] ?? "0"),
      }, sourceState(match[4]!)));
      return;
    }
    match = /^(DEFER|MINIMUM)\s+(ON|OFF)\s+(\d+)$/i.exec(text);
    if (match) {
      const field = `${match[1]!.toLowerCase()}${match[2]![0]!.toUpperCase()}${match[2]!.slice(1).toLowerCase()}Seconds` as
        "deferOnSeconds" | "deferOffSeconds" | "minimumOnSeconds" | "minimumOffSeconds";
      program.safety[field] = sourceInteger(match[3]!);
      return;
    }
    match = /^MAXIMUM\s+CONTINUOUS\s+ON\s+(\d+)$/i.exec(text);
    if (match) { program.safety.maximumContinuousOnSeconds = sourceInteger(match[1]!); return; }
    match = /^MAXIMUM\s+DAILY\s+ON\s+(\d+)$/i.exec(text);
    if (match) { program.safety.maximumDailyRuntimeSeconds = sourceInteger(match[1]!); return; }
    match = /^MAXIMUM\s+CHANGES\s+PER\s+HOUR\s+(\d+)$/i.exec(text);
    if (match) { program.safety.maximumTransitionsPerHour = sourceInteger(match[1]!); return; }

    issues.push(looksLikeIncompleteCommand(text)
      ? { line, message: "Finish this command.", incomplete: true }
      : { line, message: "Command not recognized. Check spelling and command order." });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, program };
}

function conditionSource(rule: AdvancedOutletRule): string | undefined {
  const condition = rule.condition;
  const state = rule.action.state.toUpperCase();
  if (condition.type === "time-range") {
    const allDays = condition.weekdays.length === 7;
    const days = allDays ? "" : ` DAYS ${condition.weekdays.map((day) => dayNames[day]).join(",")}`;
    return `IF TIME ${condition.startTime} TO ${condition.endTime}${days} THEN ${state}`;
  }
  if (condition.type === "feed-cycle" && condition.active) return `IF FEED ${condition.cycle} THEN ${state}`;
  if (condition.type === "water-change" && condition.active) return `IF WATER CHANGE THEN ${state}`;
  if (condition.type === "measurement" && (condition.comparison === "gt" || condition.comparison === "lt")) {
    const name = condition.measurementId === "temperature" ? "TEMPERATURE" : condition.measurementId.toUpperCase();
    return `IF ${name} ${condition.comparison === "gt" ? ">" : "<"} ${condition.value} THEN ${state}`;
  }
  if (condition.type === "equipment-state") return `IF EQUIPMENT "${condition.equipmentId}" IS ${condition.state.toUpperCase()} THEN ${state}`;
  if (condition.type === "oscillation") return `IF REPEAT ON ${condition.onSeconds} OFF ${condition.offSeconds} OFFSET ${condition.offsetSeconds} THEN ${state}`;
  return undefined;
}

/** Creates editable source for programs saved by the former form editor. */
export function formatAdvancedProgramSource(program: AdvancedOutletProgram): string {
  if (program.sourceText !== undefined) return program.sourceText;
  const lines = [
    `DEFAULT ${program.defaultState.toUpperCase()}`,
    `MISSING DATA ${program.safety.missingInputState.toUpperCase()}`,
    "",
    ...program.rules.filter((rule) => rule.enabled).flatMap((rule) => {
      const source = conditionSource(rule);
      return source ? [source] : [`# ${rule.name}: this condition requires a newer editor`];
    }),
  ];
  const safety = program.safety;
  if (safety.deferOnSeconds) lines.push("", `DEFER ON ${safety.deferOnSeconds}`);
  if (safety.deferOffSeconds) lines.push(`DEFER OFF ${safety.deferOffSeconds}`);
  if (safety.minimumOnSeconds) lines.push(`MINIMUM ON ${safety.minimumOnSeconds}`);
  if (safety.minimumOffSeconds) lines.push(`MINIMUM OFF ${safety.minimumOffSeconds}`);
  if (safety.maximumContinuousOnSeconds) lines.push(`MAXIMUM CONTINUOUS ON ${safety.maximumContinuousOnSeconds}`);
  if (safety.maximumDailyRuntimeSeconds) lines.push(`MAXIMUM DAILY ON ${safety.maximumDailyRuntimeSeconds}`);
  if (safety.maximumTransitionsPerHour) lines.push(`MAXIMUM CHANGES PER HOUR ${safety.maximumTransitionsPerHour}`);
  return lines.join("\n");
}
