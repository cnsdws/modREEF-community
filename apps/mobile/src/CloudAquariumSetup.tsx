import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { createCloudAquarium } from "./dashboardConnection";

export function CloudAquariumSetup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("My Reef");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter an aquarium name.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await createCloudAquarium(trimmed);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the aquarium.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Image
          accessibilityLabel="modREEF — Modular, Smart, Connected"
          resizeMode="contain"
          source={require("../assets/brand/modreef-logo.png")}
          style={styles.logo}
        />
        <Text style={styles.eyebrow}>CLOUD SETUP</Text>
        <Text style={styles.title}>Create your aquarium</Text>
        <Text style={styles.copy}>
          This creates the secure cloud workspace that your beta modREEF Edge
          will report to. No outlets will be controllable until an Edge is
          registered and online.
        </Text>
        <Text style={styles.label}>Aquarium name</Text>
        <TextInput
          accessibilityLabel="Aquarium name"
          autoCapitalize="words"
          editable={!saving}
          maxLength={80}
          onChangeText={setName}
          onSubmitEditing={() => void create()}
          selectTextOnFocus
          style={styles.input}
          value={name}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={saving || !name.trim()}
          onPress={() => void create()}
          style={[styles.button, saving || !name.trim() ? styles.disabled : null]}
        >
          {saving ? (
            <ActivityIndicator color="#062B63" />
          ) : (
            <Text style={styles.buttonText}>Create aquarium</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#061528",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#062B63",
    borderColor: "#20B7EC",
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 520,
    padding: 32,
    width: "100%",
  },
  logo: { alignSelf: "center", height: 183, marginBottom: 20, width: 200 },
  eyebrow: { color: "#20B7EC", fontSize: 13, fontWeight: "700", letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 30, fontWeight: "800", marginTop: 10 },
  copy: { color: "#F5F8FC", fontSize: 15, lineHeight: 22, marginTop: 14 },
  label: { color: "#F5F8FC", fontSize: 13, fontWeight: "700", marginTop: 22 },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#20B7EC",
    borderRadius: 10,
    borderWidth: 1,
    color: "#062B63",
    fontSize: 16,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  error: { color: "#E74C3C", fontSize: 14, marginTop: 12 },
  button: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 12,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  disabled: { opacity: 0.55 },
  buttonText: { color: "#062B63", fontSize: 16, fontWeight: "800" },
});
