import { useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteDashboardAccount, exportDashboardAquarium } from "./dashboardConnection";

export function AccountDataActions({ aquariumId, aquariumName, onAccountDeleted }: {
  aquariumId: string;
  aquariumName: string;
  onAccountDeleted(): Promise<void>;
}) {
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function exportAquarium() {
    setBusy("export");
    setMessage(null);
    try {
      const aquariumExport = await exportDashboardAquarium(aquariumId);
      const json = JSON.stringify(aquariumExport, null, 2);
      const safeName = aquariumName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aquarium";
      if (Platform.OS === "web" && globalThis.document) {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = globalThis.document.createElement("a");
        link.href = url;
        link.download = `modreef-${safeName}-export.json`;
        link.click();
        URL.revokeObjectURL(url);
        setMessage("Aquarium export downloaded.");
      } else {
        await Share.share({ message: json, title: `${aquariumName} modREEF export` });
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not export this aquarium.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    setMessage(null);
    try {
      await deleteDashboardAccount();
      await onAccountDeleted();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not delete modREEF account data.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <Pressable disabled={busy !== null} onPress={() => void exportAquarium()} style={styles.button}>
        <Text style={styles.buttonText}>{busy === "export" ? "Exporting…" : "Export aquarium data"}</Text>
      </Pressable>
      {!confirming ? (
        <Pressable disabled={busy !== null} onPress={() => setConfirming(true)} style={[styles.button, styles.dangerButton]}>
          <Text style={styles.dangerText}>Delete modREEF account data</Text>
        </Pressable>
      ) : (
        <View style={styles.confirmCard}>
          <Text style={styles.warning}>Transfer ownership of every aquarium first. This permanently removes your remaining memberships and modREEF cloud profile.</Text>
          <Text style={styles.help}>Type DELETE to confirm.</Text>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setConfirmation}
            placeholder="DELETE"
            placeholderTextColor="#71869F"
            style={styles.input}
            value={confirmation}
          />
          <View style={styles.row}>
            <Pressable onPress={() => { setConfirming(false); setConfirmation(""); }} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={confirmation !== "DELETE" || busy !== null}
              onPress={() => void deleteAccount()}
              style={[styles.button, styles.dangerButton, confirmation !== "DELETE" ? styles.disabled : undefined]}
            >
              <Text style={styles.dangerText}>{busy === "delete" ? "Deleting…" : "Delete permanently"}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderColor: "#1E88B7", borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  buttonText: { color: "#20B7EC", fontSize: 12, fontWeight: "800" },
  dangerButton: { borderColor: "#E76F7A" },
  dangerText: { color: "#FCA5A5", fontSize: 12, fontWeight: "800" },
  confirmCard: { backgroundColor: "#061D34", borderColor: "#663946", borderRadius: 9, borderWidth: 1, flexBasis: "100%", padding: 12 },
  warning: { color: "#FCA5A5", fontSize: 12, lineHeight: 17 },
  help: { color: "#8FA4BF", fontSize: 11, marginTop: 8 },
  input: { borderColor: "#663946", borderRadius: 7, borderWidth: 1, color: "#FFFFFF", marginTop: 7, padding: 9 },
  row: { flexDirection: "row", gap: 8, marginTop: 9 },
  disabled: { opacity: 0.4 },
  message: { color: "#8FA4BF", flexBasis: "100%", fontSize: 11, marginTop: 3 },
});
