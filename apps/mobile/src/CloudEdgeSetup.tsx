import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CircularActionButton } from "./CircularActionButton";

import {
  registerCloudEdge,
  removeCloudEdge,
  removeUnconfirmedCloudEdgesExcept,
} from "./dashboardConnection";
import {
  discoverReefControllers,
  type DiscoveredController,
} from "./controllerDiscovery";
import { claimLocalEdge, configureEdgeTarget } from "./edgeClient";
import { localUrlForHostname } from "./edgeTarget";

export function CloudEdgeSetup({
  onConfigured,
  onCancel,
}: {
  onConfigured: () => void;
  onCancel: () => void;
}) {
  const [controllers, setControllers] = useState<DiscoveredController[]>([]);
  const [selected, setSelected] = useState<DiscoveredController | null>(null);
  const [name, setName] = useState("Reef Controller");
  const [manualAddress, setManualAddress] = useState("");
  const [showManualAddress, setShowManualAddress] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisioningStatus, setProvisioningStatus] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const cloudClaimInFlight = useRef(false);

  async function scan(signal?: AbortSignal) {
    try {
      setScanning(true);
      setError(null);
      const found = await discoverReefControllers(signal);
      setControllers(found);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof Error ? caught.message : "Could not scan for Reef Controllers.");
      }
    } finally {
      if (!signal?.aborted) setScanning(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void scan(controller.signal);
    return () => controller.abort();
  }, []);

  const availableControllers = useMemo(
    () => controllers.filter((controller) => !controller.claimed),
    [controllers],
  );

  function chooseController(controller: DiscoveredController) {
    setSelected(controller);
    setName(`Reef Controller ${controller.setupId}`);
    setError(null);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  async function connectController() {
    if (cloudClaimInFlight.current) return;
    const trimmed = name.trim();
    const targetUrl = selected?.url ?? (
      manualAddress.trim().startsWith("http")
        ? manualAddress.trim().replace(/\/$/, "")
        : manualAddress.trim()
          ? localUrlForHostname(manualAddress.trim().replace(/\.local$/i, ""))
          : ""
    );
    if (!trimmed || !targetUrl) return;

    let registeredEdgeId: string | undefined;
    let claimCompleted = false;
    try {
      cloudClaimInFlight.current = true;
      Keyboard.dismiss();
      setSaving(true);
      setError(null);
      setProvisioningStatus("Reserving this Reef Controller for the selected aquarium…");
      const credentials = await registerCloudEdge(trimmed);
      registeredEdgeId = credentials.edgeId;
      setProvisioningStatus("Saving the controller connection on this tablet…");
      await configureEdgeTarget({
        edgeId: credentials.edgeId,
        name: trimmed,
        url: targetUrl,
      });
      setProvisioningStatus("Securely connecting the Reef Controller to modREEF Cloud…");
      await claimLocalEdge(targetUrl, credentials);
      claimCompleted = true;
      setProvisioningStatus("Controller connected. Loading the aquarium…");
      await removeUnconfirmedCloudEdgesExcept(credentials.edgeId).catch(() => undefined);
      onConfigured();
    } catch (caught) {
      if (registeredEdgeId && !claimCompleted) {
        await removeCloudEdge(registeredEdgeId).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : "Could not connect the Reef Controller.");
    } finally {
      cloudClaimInFlight.current = false;
      setSaving(false);
    }
  }

  const targetReady = Boolean(selected || manualAddress.trim());

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardScreen}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
      >
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>REEF CONTROLLER SETUP</Text>
            <CircularActionButton
              accessibilityLabel="Cancel Reef Controller setup"
              kind="close"
              onPress={onCancel}
              size={38}
            />
          </View>
          <Text style={styles.title}>Connect your Reef Controller</Text>
          <Text style={styles.copy}>
            Keep the controller powered on. modREEF finds available controllers on this network automatically.
          </Text>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nearby controllers</Text>
            <Pressable
              accessibilityRole="button"
              disabled={scanning || saving}
              onPress={() => void scan()}
              style={styles.scanButton}
            >
              <Text style={styles.scanButtonText}>{scanning ? "Scanning…" : "Scan again"}</Text>
            </Pressable>
          </View>

          {scanning ? (
            <View style={styles.progressRow}>
              <ActivityIndicator color="#20B7EC" />
              <Text style={styles.progressText}>Looking for Reef Controllers…</Text>
            </View>
          ) : availableControllers.length > 0 ? (
            availableControllers.map((controller) => (
              <Pressable
                accessibilityLabel={`Connect controller ${controller.setupId}`}
                accessibilityRole="button"
                key={controller.id}
                onPress={() => chooseController(controller)}
                style={[
                  styles.controllerCard,
                  selected?.id === controller.id ? styles.controllerCardSelected : null,
                ]}
              >
                <Text style={styles.controllerName}>{controller.name}</Text>
                <Text style={styles.controllerMeta}>Identifier {controller.setupId} · Ready to connect</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>
              No unclaimed controller was found on this network. Make sure it is
              powered on and connected to the same network as this tablet.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setShowManualAddress((current) => !current);
              setSelected(null);
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              {showManualAddress ? "Hide network address" : "Enter network address instead"}
            </Text>
          </Pressable>

          {showManualAddress ? (
            <>
              <Text style={styles.label}>Controller network address</Text>
              <TextInput
                accessibilityLabel="Controller network address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
                onChangeText={setManualAddress}
                placeholder="Example: modreef-01.local"
                placeholderTextColor="#60738C"
                style={styles.input}
                value={manualAddress}
              />
            </>
          ) : null}

          {targetReady ? (
            <View style={styles.namingSection}>
              <Text style={styles.label}>What would you like to call it?</Text>
              <TextInput
                accessibilityLabel="Reef Controller name"
                editable={!saving}
                maxLength={80}
                onChangeText={setName}
                onFocus={() => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))}
                onSubmitEditing={() => void connectController()}
                returnKeyType="done"
                selectTextOnFocus
                style={styles.input}
                value={name}
              />
              <Text style={styles.namePreview}>Connecting as: {name.trim() || "Reef Controller"}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {targetReady && provisioningStatus && !error ? (
            <Text style={styles.statusText}>{provisioningStatus}</Text>
          ) : null}

          {targetReady ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving || !name.trim()}
              onPress={() => void connectController()}
              style={[styles.button, saving || !name.trim() ? styles.disabled : null]}
            >
              {saving ? <ActivityIndicator color="#062B63" /> : (
                <Text style={styles.buttonText}>Connect Reef Controller</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardScreen: { flex: 1, width: "100%" },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: {
    alignSelf: "center",
    backgroundColor: "#062B63",
    borderColor: "#20B7EC",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 760,
    padding: 26,
    width: "100%",
  },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: "#20B7EC", fontSize: 13, fontWeight: "700", letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "800", marginTop: 8 },
  copy: { color: "#F5F8FC", fontSize: 15, lineHeight: 22, marginTop: 12 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  sectionTitle: { color: "#F5F8FC", fontSize: 16, fontWeight: "800" },
  scanButton: { paddingHorizontal: 8, paddingVertical: 6 },
  scanButtonText: { color: "#20B7EC", fontSize: 14, fontWeight: "700" },
  progressRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 16 },
  progressText: { color: "#F5F8FC", fontSize: 14 },
  controllerCard: { backgroundColor: "#061E42", borderColor: "#31577F", borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 14 },
  controllerCardSelected: { borderColor: "#20B7EC", borderWidth: 2 },
  controllerName: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  controllerMeta: { color: "#AFC7DD", fontSize: 13, marginTop: 4 },
  emptyText: { color: "#AFC7DD", fontSize: 14, lineHeight: 20, marginTop: 14 },
  secondaryButton: { alignItems: "center", borderColor: "#31577F", borderRadius: 10, borderWidth: 1, marginTop: 16, minHeight: 44, justifyContent: "center" },
  secondaryButtonText: { color: "#20B7EC", fontSize: 14, fontWeight: "700" },
  namingSection: { marginTop: 4 },
  statusText: { color: "#AFC7DD", fontSize: 13, lineHeight: 19, marginTop: 12 },
  label: { color: "#F5F8FC", fontSize: 13, fontWeight: "700", marginTop: 18 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 10, color: "#062B63", fontSize: 16, marginTop: 8, minHeight: 48, paddingHorizontal: 14 },
  namePreview: { color: "#AFC7DD", fontSize: 13, marginTop: 8 },
  button: { alignItems: "center", backgroundColor: "#0A8FEA", borderRadius: 12, justifyContent: "center", marginTop: 18, minHeight: 50, paddingHorizontal: 18 },
  buttonText: { color: "#062B63", fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  error: { color: "#FF8A8A", fontSize: 14, marginTop: 12 },
});
