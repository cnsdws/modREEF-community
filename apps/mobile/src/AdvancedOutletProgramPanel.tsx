import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  validateAdvancedOutletProgram,
  type AdvancedOutletProgram,
  type Equipment,
} from "@modreef/digital-twin";

import { setEdgeAdvancedOutletProgram } from "./edgeClient";
import {
  createAdvancedProgram,
  advancedProgramCompletions,
  applyAdvancedProgramCompletion,
  formatAdvancedProgramSource,
  parseAdvancedProgramSource,
} from "./advancedOutletEditor";

interface Props {
  equipment: Equipment;
  aquariumName: string;
  controllerName: string;
  onUpdated(equipment: Equipment): void;
  saveProgram?: (equipmentId: string, program: AdvancedOutletProgram) => Promise<Equipment>;
}

const commandWords = new Set([
  "DEFAULT", "MISSING", "DATA", "IF", "TIME", "TO", "DAYS", "THEN",
  "FEED", "WATER", "CHANGE", "TEMPERATURE", "TEMP", "PH", "ORP",
  "SALINITY", "EQUIPMENT", "IS", "REPEAT", "OFFSET", "DEFER", "MINIMUM",
  "MAXIMUM", "CONTINUOUS", "DAILY", "CHANGES", "PER", "HOUR",
]);
const stateWords = new Set(["ON", "OFF"]);
const dayWords = new Set(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "A", "B", "C"]);
const tokenPattern = /("[^"]*"|#.*$|-?\d+(?:\.\d+)?(?::\d{2})?|>=|<=|>|<|[A-Za-z]+|\s+|.)/gm;
const codeLineHeight = 22;

function tokenColor(token: string): string {
  const upper = token.toUpperCase();
  if (token.startsWith("#")) return "#657B96";
  if (token.startsWith('"')) return "#70D6A3";
  if (stateWords.has(upper)) return "#24C7F4";
  if (commandWords.has(upper)) return "#B78CFF";
  if (dayWords.has(upper)) return "#51D6B1";
  if (/^-?\d/.test(token)) return "#FFB45B";
  if (/^(?:>=|<=|>|<)$/.test(token)) return "#FF7E9F";
  return "#D7E5F4";
}

function HighlightedSource({ source }: { source: string }) {
  const tokens = source.match(tokenPattern) ?? [];
  return (
    <Text style={styles.highlightedText}>
      {tokens.map((token, index) => (
        <Text key={`${index}-${token}`} style={{ color: tokenColor(token) }}>{token}</Text>
      ))}
    </Text>
  );
}

export function AdvancedOutletProgramPanel({
  equipment,
  aquariumName,
  controllerName,
  onUpdated,
  saveProgram = setEdgeAdvancedOutletProgram,
}: Props) {
  const initialProgram = equipment.advancedOutletProgram ?? createAdvancedProgram(equipment.id, equipment.name);
  const [source, setSource] = useState(() => formatAdvancedProgramSource(initialProgram));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const program = equipment.advancedOutletProgram ?? createAdvancedProgram(equipment.id, equipment.name);
    setSource(formatAdvancedProgramSource(program));
  }, [equipment.id, equipment.advancedOutletProgram?.revision]);

  const base = equipment.advancedOutletProgram ?? createAdvancedProgram(equipment.id, equipment.name);
  const parsed = useMemo(() => parseAdvancedProgramSource(source, base), [source, base]);
  const lines = Math.max(10, source.split(/\r?\n/).length);
  const editorHeight = Math.max(230, lines * codeLineHeight + 24);
  const completions = useMemo(
    () => advancedProgramCompletions(source, selection.start),
    [source, selection.start],
  );

  function completeLine(completion: string) {
    const completed = applyAdvancedProgramCompletion(source, selection.start, completion);
    setSource(completed.source);
    setSelection({ start: completed.cursor, end: completed.cursor });
    setError(null);
    setSuccess(null);
    inputRef.current?.focus();
  }

  async function save() {
    if (!parsed.ok) {
      const issue = parsed.issues[0]!;
      setError(`Line ${issue.line}: ${issue.message}`);
      return;
    }
    const next: AdvancedOutletProgram = {
      ...parsed.program,
      revision: (equipment.advancedOutletProgram?.revision ?? 0) + 1,
      name: `${equipment.name} advanced program`,
      updatedAt: new Date().toISOString(),
    };
    const issues = validateAdvancedOutletProgram(next);
    if (issues.length > 0) {
      setError(`${issues[0]!.path}: ${issues[0]!.message}`);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await saveProgram(equipment.id, next);
      if (updated.advancedOutletProgram?.revision !== next.revision) {
        throw new Error("The Reef Controller did not confirm the new program revision.");
      }
      onUpdated(updated);
      setSuccess(`Revision ${next.revision} saved to ${aquariumName} and confirmed by ${controllerName}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  const status = parsed.ok
    ? `${parsed.program.rules.length} rule${parsed.program.rules.length === 1 ? "" : "s"} · Default ${parsed.program.defaultState.toUpperCase()} · Missing data ${parsed.program.safety.missingInputState.toUpperCase()}`
    : parsed.issues.every((issue) => issue.incomplete)
      ? `Editing line ${parsed.issues[0]!.line}…`
      : `${parsed.issues.filter((issue) => !issue.incomplete).length} error${parsed.issues.filter((issue) => !issue.incomplete).length === 1 ? "" : "s"} · Line ${parsed.issues.find((issue) => !issue.incomplete)!.line}: ${parsed.issues.find((issue) => !issue.incomplete)!.message}`;
  const editing = !parsed.ok && parsed.issues.every((issue) => issue.incomplete);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Configuration</Text>
          <Text style={styles.summary}>One command per line. The last matching IF rule executes.</Text>
        </View>
        <Text style={[styles.validation, parsed.ok ? styles.valid : editing ? styles.editing : styles.invalid]}>
          {parsed.ok ? "VALID" : editing ? "EDITING" : "CHECK PROGRAM"}
        </Text>
      </View>

      <View style={[styles.editor, { height: editorHeight }]}>
        <View pointerEvents="none" style={styles.lineNumbers}>
          <Text style={styles.lineNumber}>{Array.from({ length: lines }, (_, index) => index + 1).join("\n")}</Text>
        </View>
        <View pointerEvents="none" style={styles.highlightLayer}>
          <HighlightedSource source={source} />
        </View>
        <TextInput
          ref={inputRef}
          accessibilityLabel="Advanced outlet configuration"
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor="#FFFFFF"
          multiline
          onChangeText={(value) => {
            setSource(value);
            setError(null);
            setSuccess(null);
          }}
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          selectionColor="#287FA7"
          spellCheck={false}
          selection={selection}
          style={[styles.codeInput, { height: editorHeight }, { caretColor: "#FFFFFF" } as never]}
          textAlignVertical="top"
          value={source}
        />
      </View>

      {completions.length > 0 ? (
        <View accessibilityLabel="Command suggestions" style={styles.completionMenu}>
          {completions.map((completion, index) => (
            <Pressable
              accessibilityRole="menuitem"
              key={completion.source}
              onPress={() => completeLine(completion.source)}
              style={[styles.completionItem, index > 0 && styles.completionDivider]}
            >
              <Text style={styles.completionText}>{completion.label}</Text>
              <Text numberOfLines={1} style={styles.completionSource}>{completion.source}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={[styles.status, parsed.ok ? styles.validText : editing ? styles.editingText : styles.errorText]}>{status}</Text>
      <Text style={styles.help}>Commands: DEFAULT, MISSING DATA, IF…THEN, DEFER, MINIMUM, MAXIMUM. Lines beginning with # are comments.</Text>

      <Pressable disabled={saving || !parsed.ok} onPress={() => void save()} style={[styles.saveButton, (saving || !parsed.ok) && styles.disabled]}>
        <Text style={styles.saveText}>{saving ? "Saving…" : "Save Advanced Program"}</Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
    </View>
  );
}

const codeFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  web: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  default: "monospace",
});

const styles = StyleSheet.create({
  panel: { borderColor: "#164975", borderRadius: 14, borderWidth: 1, marginTop: 14, padding: 14 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  flex: { flex: 1 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  summary: { color: "#8298B4", fontSize: 11, marginTop: 4 },
  validation: { borderRadius: 7, borderWidth: 1, fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  valid: { backgroundColor: "#0B3C32", borderColor: "#1D8D70", color: "#70D6A3" },
  invalid: { backgroundColor: "#421B2A", borderColor: "#A84365", color: "#FF9BB7" },
  editing: { backgroundColor: "#302810", borderColor: "#876D26", color: "#FFD27A" },
  editor: { backgroundColor: "#050E1B", borderColor: "#164975", borderRadius: 10, borderWidth: 1, marginTop: 12, overflow: "hidden", position: "relative" },
  lineNumbers: { backgroundColor: "#071A2D", borderRightColor: "#164975", borderRightWidth: 1, bottom: 0, left: 0, paddingHorizontal: 9, paddingVertical: 12, position: "absolute", top: 0, width: 40, zIndex: 3 },
  lineNumber: { color: "#526A86", fontFamily: codeFont, fontSize: 13, letterSpacing: 0, lineHeight: codeLineHeight, textAlign: "right" },
  highlightLayer: { bottom: 0, left: 40, paddingHorizontal: 12, paddingVertical: 12, position: "absolute", right: 0, top: 0, zIndex: 1 },
  highlightedText: { fontFamily: codeFont, fontSize: 13, letterSpacing: 0, lineHeight: codeLineHeight },
  codeInput: { backgroundColor: "transparent", borderWidth: 0, bottom: 0, color: "rgba(255,255,255,0.02)", fontFamily: codeFont, fontSize: 13, fontWeight: "400", left: 40, letterSpacing: 0, lineHeight: codeLineHeight, margin: 0, outlineStyle: "none", paddingHorizontal: 12, paddingVertical: 12, position: "absolute", right: 0, top: 0, zIndex: 2 } as never,
  completionMenu: { backgroundColor: "#0A1526", borderColor: "#4A3F76", borderRadius: 0, borderWidth: 1, marginHorizontal: 8, overflow: "hidden" },
  completionItem: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 38, paddingHorizontal: 12, paddingVertical: 8 },
  completionDivider: { borderTopColor: "#263552", borderTopWidth: 1 },
  completionText: { color: "#B78CFF", fontSize: 10, fontWeight: "800", width: 142 },
  completionSource: { color: "#AFC1D6", flex: 1, fontFamily: codeFont, fontSize: 9 },
  status: { fontSize: 10, fontWeight: "700", marginTop: 9 },
  validText: { color: "#70D6A3" },
  editingText: { color: "#FFD27A" },
  errorText: { color: "#FF8FAD", fontSize: 10, marginTop: 9 },
  help: { color: "#657B96", fontSize: 9, lineHeight: 14, marginTop: 5 },
  saveButton: { alignItems: "center", backgroundColor: "#0E7CAA", borderColor: "#20B7EC", borderRadius: 10, borderWidth: 1, marginTop: 14, paddingVertical: 12 },
  saveText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  success: { color: "#70D6A3", fontSize: 10, marginTop: 9 },
});
