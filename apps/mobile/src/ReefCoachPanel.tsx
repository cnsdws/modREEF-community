import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReefCoachReport } from "@modreef/api-contract";

const severityColors = {
  info: "#34D399",
  watch: "#FBBF24",
  warning: "#FB923C",
  critical: "#F87171",
} as const;

export function ReefCoachPanel({
  report, analyzing = false, analysisError, onAnalyze,
}: {
  report: ReefCoachReport;
  analyzing?: boolean;
  analysisError?: string | null;
  onAnalyze?: () => void;
}) {
  const { recommendation, snapshot } = report;
  return (
    <View style={styles.root}>
      <View style={styles.summaryCard}>
        <View style={[styles.statusDot, { backgroundColor: severityColors[recommendation.severity] }]} />
        <View style={styles.grow}>
          <Text style={styles.summary}>{recommendation.summary}</Text>
          <Text style={styles.meta}>{recommendation.confidence.toUpperCase()} CONFIDENCE · OBSERVER MODE</Text>
          {report.generation?.mode === "model" ? (
            <Text style={styles.meta}>AI ANALYSIS · {report.generation.model}</Text>
          ) : null}
        </View>
      </View>

      {onAnalyze ? (
        <Pressable disabled={analyzing} onPress={onAnalyze} style={styles.analyzeButton}>
          {analyzing ? <ActivityIndicator color="#071D33" size="small" /> : null}
          <Text style={styles.analyzeButtonText}>{analyzing ? "Analyzing current snapshot…" : "Analyze Current Snapshot"}</Text>
        </Pressable>
      ) : null}
      {analysisError ? <Text style={styles.error}>{analysisError}</Text> : null}

      <Text style={styles.sectionTitle}>Observed Facts</Text>
      {recommendation.observations.length ? recommendation.observations.map((observation, index) => (
        <View key={`${observation.evidenceIds.join(":")}-${index}`} style={styles.card}>
          <Text style={styles.body}>{observation.statement}</Text>
          <Text style={styles.evidence}>Evidence: {observation.evidenceIds.join(", ")}</Text>
        </View>
      )) : <View style={styles.card}><Text style={styles.muted}>Waiting for current water-quality readings.</Text></View>}

      {recommendation.recommendations.length ? <>
        <Text style={styles.sectionTitle}>Recommended Next Steps</Text>
        {recommendation.recommendations.map((item, index) => (
          <View key={`${item.action}-${index}`} style={styles.card}>
            <Text style={styles.cardTitle}>{item.action}</Text>
            <Text style={styles.muted}>{item.reason}</Text>
          </View>
        ))}
      </> : null}

      {recommendation.hypotheses.length ? <>
        <Text style={styles.sectionTitle}>Possible Explanations</Text>
        {recommendation.hypotheses.map((item, index) => (
          <View key={`${item.explanation}-${index}`} style={styles.card}>
            <Text style={styles.body}>{item.explanation}</Text>
            <Text style={styles.evidence}>{item.confidence.toUpperCase()} CONFIDENCE · HYPOTHESIS, NOT A CONFIRMED CAUSE</Text>
          </View>
        ))}
      </> : null}

      {recommendation.missingInformation.length ? <>
        <Text style={styles.sectionTitle}>Missing or Lower-Confidence Information</Text>
        <View style={styles.card}>
          {recommendation.missingInformation.map((item) => <Text key={item} style={styles.missing}>• {item}</Text>)}
        </View>
      </> : null}

      <Text style={styles.sectionTitle}>Snapshot</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>{snapshot.equipment.online} of {snapshot.equipment.total} equipment items online</Text>
        <Text style={styles.muted}>{snapshot.recentEvents.length} relevant events in the last 24 hours</Text>
        <Text style={styles.evidence}>Snapshot schema v{snapshot.schemaVersion} · {new Date(snapshot.observedAt).toLocaleString()}</Text>
      </View>
      <Text style={styles.disclaimer}>Reef Coach is advisory. It does not operate equipment or change dosing.</Text>
      {report.generation?.fallbackReason ? <Text style={styles.disclaimer}>{report.generation.fallbackReason}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  summaryCard: { alignItems: "center", backgroundColor: "#0A2949", borderColor: "#153E63", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, padding: 16 },
  statusDot: { borderRadius: 8, height: 16, width: 16 },
  grow: { flex: 1 },
  summary: { color: "#FFF", fontSize: 17, fontWeight: "800", lineHeight: 23 },
  meta: { color: "#64809A", fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginTop: 6 },
  sectionTitle: { color: "#FFF", fontSize: 15, fontWeight: "800", marginTop: 6 },
  card: { backgroundColor: "#071D33", borderColor: "#153E63", borderRadius: 12, borderWidth: 1, gap: 7, padding: 14 },
  cardTitle: { color: "#FFF", fontSize: 13, fontWeight: "800", lineHeight: 18 },
  body: { color: "#DDEBFA", fontSize: 13, lineHeight: 19 },
  muted: { color: "#8FA4BF", fontSize: 12, lineHeight: 18 },
  missing: { color: "#FBBF24", fontSize: 12, lineHeight: 19 },
  evidence: { color: "#64809A", fontSize: 9, lineHeight: 14 },
  disclaimer: { color: "#64809A", fontSize: 10, lineHeight: 16, paddingHorizontal: 8, textAlign: "center" },
  analyzeButton: { alignItems: "center", backgroundColor: "#20B7EC", borderRadius: 10, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  analyzeButtonText: { color: "#071D33", fontSize: 13, fontWeight: "900" },
  error: { color: "#F87171", fontSize: 12, lineHeight: 18, textAlign: "center" },
});
