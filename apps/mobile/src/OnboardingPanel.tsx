import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";

import {
  OnboardingSession,
  type OnboardingCandidate,
  type OnboardingState,
} from "@modreef/onboarding";

import {
  createOnboardingTransport,
  removeOwnedTuyaDevice,
  type DeviceDiscoveryKind,
  tuyaOwnedDeviceMarker,
} from "./bleTransport";
import {
  commissionMatterDevice,
  discoverDmpWavemakers,
  discoverMd44Dosers,
  discoverMdpPumps,
  getEdgeManagedDevices,
  getOnboardedEquipment,
  provisionGizwitsEquipment,
  registerMdpPump,
  registerDmpWavemaker,
  type MdpPumpCandidate,
  type Md44DoserCandidate,
} from "./edgeClient";
import {
  isRegisteredDmpCandidate,
  isRegisteredOnboardingCandidate,
} from "./onboardingCandidateFiltering";
import { shouldOfferManualSetupCode } from "./onboardingChoices";
import {
  listAssignedDashboardDeviceIds,
  waitForDashboardDevice,
} from "./dashboardConnection";
import {
  jebaoBleManufacturerMarker,
  jebaoDmpBleManufacturerMarker,
} from "./jebaoBleProvisioning";
import { isYinmikWaterCandidate } from "./tuyaCandidateIdentity";

const pairingWifiSsidKey = "modreef.pairing.wifi-ssid";
const pairingWifiPasswordKey = "modreef.pairing.wifi-password";
const nearbyScanTimeoutMs = 25_000;

function isMatterCandidate(candidate: OnboardingCandidate): boolean {
  return candidate.manufacturerData?.startsWith("matter") === true ||
    candidate.serviceUuids.some((uuid) =>
      uuid.replaceAll("-", "").toUpperCase().includes("FFF6")
    );
}

function isOwnedTuyaCandidate(candidate: OnboardingCandidate): boolean {
  return candidate.serviceUuids.includes(tuyaOwnedDeviceMarker);
}

function candidateFriendlyName(candidate: OnboardingCandidate): string {
  if (isYinmikWaterCandidate(candidate)) {
    return "Water Meter";
  }
  if (candidate.manufacturerData === jebaoDmpBleManufacturerMarker) {
    return "Jebao Wavemaker";
  }
  if (candidate.manufacturerData === jebaoBleManufacturerMarker) {
    return "Jebao Doser";
  }
  if (candidate.manufacturerData === "matter-tapo-known-address") {
    return "Outlet";
  }
  if (isMatterCandidate(candidate)) return "Outlet";
  return "Outlet";
}

function WifiButtonIcon() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.wifiButtonIcon}>
      <View style={styles.wifiButtonArcOuter} />
      <View style={styles.wifiButtonArcInner} />
      <View style={styles.wifiButtonDot} />
    </View>
  );
}

export function OnboardingPanel({
  compact = false,
  onBeforeScan,
  onDeviceConnected,
}: {
  compact?: boolean;
  onBeforeScan?: () => Promise<void>;
  onDeviceConnected?: (deviceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [discoveryKind, setDiscoveryKind] =
    useState<DeviceDiscoveryKind>("bluetooth");
  const [state, setState] = useState<OnboardingState>({ status: "idle" });
  const [selected, setSelected] =
    useState<OnboardingCandidate | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"nearby" | "matter">("nearby");
  const [matterCode, setMatterCode] = useState("");
  const [matterName, setMatterName] = useState("");
  const [nearbyName, setNearbyName] = useState("");
  const [matterCompatibility, setMatterCompatibility] = useState<string | undefined>();
  const [matterBusy, setMatterBusy] = useState(false);
  const [matterProgress, setMatterProgress] = useState("");
  const [matterError, setMatterError] = useState<string | null>(null);
  const [scanningMatterCode, setScanningMatterCode] = useState(false);
  const [mdpPumps, setMdpPumps] = useState<MdpPumpCandidate[]>([]);
  const [md44Dosers, setMd44Dosers] = useState<Md44DoserCandidate[]>([]);
  const [selectedMdp, setSelectedMdp] = useState<MdpPumpCandidate | null>(null);
  const [mdpName, setMdpName] = useState("Return Pump");
  const [mdpScanning, setMdpScanning] = useState(false);
  const [mdpBusy, setMdpBusy] = useState(false);
  const [mdpError, setMdpError] = useState<string | null>(null);
  const [selectedDmp, setSelectedDmp] = useState<OnboardingCandidate | null>(null);
  const [dmpInspectionBusy, setDmpInspectionBusy] = useState(false);
  const [dmpInspectionError, setDmpInspectionError] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanController = useRef<AbortController | null>(null);
  const activeSession = useRef<{
    kind: DeviceDiscoveryKind;
    session: OnboardingSession;
  } | null>(null);
  const matterCodeIsValid = matterCode.trim().startsWith("MT:") ||
    matterCode.replace(/\D/g, "").length === 11;

  useEffect(() => {
    void (async () => {
      if (!(await SecureStore.isAvailableAsync())) return;
      const [storedSsid, storedPassword] = await Promise.all([
        SecureStore.getItemAsync(pairingWifiSsidKey),
        SecureStore.getItemAsync(pairingWifiPasswordKey),
      ]);
      if (storedSsid) setSsid(storedSsid);
      if (storedPassword) setPassword(storedPassword);
    })();
  }, []);

  useEffect(() => () => scanController.current?.abort(), []);

  async function rememberWifiCredentials() {
    if (!(await SecureStore.isAvailableAsync())) return;
    await Promise.all([
      SecureStore.setItemAsync(pairingWifiSsidKey, ssid.trim()),
      SecureStore.setItemAsync(pairingWifiPasswordKey, password),
    ]);
  }

  async function continueWifiEquipmentScan() {
    if (!ssid.trim() || password.length < 8) return;
    await rememberWifiCredentials();
    await scan("wifi");
  }

  function finishPairing(deviceId: string) {
    setOpen(false);
    setSelected(null);
    setState({ status: "idle" });
    setMethod("nearby");
    setMatterError(null);
    setMatterProgress("");
    setMatterCompatibility(undefined);
    setScanningMatterCode(false);
    setNearbyName("");
    setMdpPumps([]);
    setMd44Dosers([]);
    setSelectedMdp(null);
    setMdpError(null);
    setMdpScanning(false);
    setSelectedDmp(null);
    setDmpInspectionError(null);
    onDeviceConnected?.(deviceId);
  }

  async function openMatterScanner() {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!permission.granted) {
      setMatterError("Camera permission is required to scan the Matter QR code.");
      return;
    }
    setMatterError(null);
    setScanningMatterCode(true);
  }

  async function scan(kind: DeviceDiscoveryKind) {
    scanController.current?.abort();
    // Create the transport per scan. Besides preventing stale Expo hot-reload
    // instances, this ensures every pairing attempt starts with a fresh Tuya
    // discovery cache while preserving that exact cache for provisioning.
    const session = new OnboardingSession(createOnboardingTransport(kind));
    activeSession.current = { kind, session };
    setOpen(true);
    setDiscoveryKind(kind);
    setMethod("nearby");
    setSelected(null);
    setNearbyName("");
    setState({ status: "scanning" });
    setMdpPumps([]);
    setMd44Dosers([]);
    setSelectedMdp(null);
    setMdpError(null);
    setSelectedDmp(null);
    setDmpInspectionError(null);

    const controller = new AbortController();
    scanController.current = controller;
    // Bluetooth Tuya discovery has a fast raw advertisement pass followed by
    // authoritative SDK identity enrichment. Allow both passes to complete.
    const scanTimeoutMs = nearbyScanTimeoutMs;
    const timeout = setTimeout(() => {
      if (scanController.current !== controller) return;
      controller.abort();
      scanController.current = null;
      setMdpScanning(false);
      setState({
        status: "failed",
        message: `${kind === "bluetooth" ? "Bluetooth" : "Wi-Fi device"} scan timed out. Confirm the device is in pairing mode and scan again.`,
      });
    }, scanTimeoutMs);

    try {
      await onBeforeScan?.();
    } catch (error) {
      clearTimeout(timeout);
      if (scanController.current === controller) scanController.current = null;
      setState({
        status: "failed",
        message: error instanceof Error
          ? error.message
          : "Could not authorize the Reef Controller for device setup.",
      });
      return;
    }

    // Start the selected radio path immediately. Wi-Fi devices may still use
    // BLE for commissioning, but direct Bluetooth devices skip those scans.
    const nearbyResult = kind === "bluetooth"
      ? Promise.all([
          getEdgeManagedDevices().catch(() => []),
          getOnboardedEquipment().catch(() => []),
          listAssignedDashboardDeviceIds().catch(() => []),
        ]).then(async ([registered, onboarded, assignedDeviceIds]): Promise<OnboardingState> => {
          const assigned = new Set(assignedDeviceIds);
          const tuyaResult = session.scan(controller.signal).then((result) => ({
            status: "selecting" as const,
            candidates: result.status === "selecting"
              ? result.candidates.filter((candidate) =>
                  !assigned.has(candidate.id) &&
                  !isRegisteredOnboardingCandidate(candidate, onboarded)
                )
              : [],
          })).catch(() => ({ status: "selecting" as const, candidates: [] }));
          const dmpResult = discoverDmpWavemakers().then((devices) => ({
            status: "selecting" as const,
            candidates: devices.map((device): OnboardingCandidate => ({
              id: `edge-dmp:${device.bluetoothAddress}`,
              transport: "bluetooth-le",
              displayName: device.advertisedName,
              ...(device.signalStrength === undefined
                ? {}
                : { signalStrength: device.signalStrength }),
              manufacturerData: jebaoDmpBleManufacturerMarker,
              serviceUuids: [],
            })).filter((candidate) => !isRegisteredDmpCandidate(candidate, registered)),
          })).catch(() => ({ status: "selecting" as const, candidates: [] }));

          const first = await Promise.race([
            tuyaResult.then((result) => ({ source: "tuya" as const, result })),
            dmpResult.then((result) => ({ source: "dmp" as const, result })),
          ]);
          if (first.result.candidates.length > 0) return first.result;
          return first.source === "tuya" ? dmpResult : tuyaResult;
        })
      : Promise.all([
          session.scan(controller.signal),
          getOnboardedEquipment().catch(() => []),
        ]).then(([result, onboarded]): OnboardingState => result.status === "selecting"
          ? {
              status: "selecting",
              candidates: result.candidates.filter((candidate) =>
                !isRegisteredOnboardingCandidate(candidate, onboarded)
              ),
            }
          : result);

    let directPumpCount = 0;
    let directDoserCount = 0;
    if (kind === "wifi") try {
      setMdpScanning(true);
      const [pumpResult, doserResult] = await Promise.allSettled([
        discoverMdpPumps(),
        discoverMd44Dosers(),
      ]);
      if (pumpResult.status === "fulfilled") {
        directPumpCount = pumpResult.value.length;
        setMdpPumps(pumpResult.value);
      }
      else setMdpError(
        pumpResult.reason instanceof Error
          ? pumpResult.reason.message
          : String(pumpResult.reason),
      );
      if (doserResult.status === "fulfilled") {
        directDoserCount = doserResult.value.length;
        setMd44Dosers(doserResult.value);
      }
      else setMdpError(
        doserResult.reason instanceof Error
          ? doserResult.reason.message
          : String(doserResult.reason),
      );
    } finally {
      setMdpScanning(false);
    }
    const result = await nearbyResult;
    clearTimeout(timeout);
    if (scanController.current !== controller) return;
    scanController.current = null;
    if (result.status === "selecting") {
      console.info(
        "[modREEF pairing results]",
        result.candidates.map((candidate) => ({
          id: candidate.id,
          advertisedName: candidate.displayName,
          productId: candidate.manufacturerData,
          serviceUuids: candidate.serviceUuids,
          presentedAs: candidateFriendlyName(candidate),
        })),
      );
      const jebaoCandidate = result.candidates.find(
        (candidate) => candidate.manufacturerData === jebaoBleManufacturerMarker,
      );
      if (jebaoCandidate) {
        setSelected(jebaoCandidate);
        setNearbyName(candidateFriendlyName(jebaoCandidate));
      }
    }
    setState(result);

    const nearbyCount = result.status === "selecting"
      ? result.candidates.length
      : 0;
    if (
      kind === "wifi" &&
      nearbyCount === 0 &&
      directPumpCount === 0 &&
      directDoserCount === 0 &&
      ssid.trim() &&
      password.length >= 8
    ) {
      setMdpScanning(true);
      try {
        const provisioned = await provisionGizwitsEquipment({
          ssid: ssid.trim(),
          password,
        });
        if (provisioned.equipmentType === "jebao-md44") {
          setMd44Dosers([{ ...provisioned, headCount: 4 }]);
          setMdpError(null);
        }
      } catch (error) {
        setMdpError(error instanceof Error ? error.message : String(error));
      } finally {
        setMdpScanning(false);
      }
    }
  }

  async function addMdpPump() {
    if (!selectedMdp) return;
    setMdpBusy(true);
    setMdpError(null);
    try {
      const deviceId = await registerMdpPump(
        selectedMdp,
        mdpName.trim() || "Return Pump",
      );
      finishPairing(deviceId);
    } catch (error) {
      setMdpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMdpBusy(false);
    }
  }

  function closePanel() {
    scanController.current?.abort();
    scanController.current = null;
    setOpen(false);
    setState({ status: "idle" });
    setMdpPumps([]);
    setMd44Dosers([]);
    setSelectedMdp(null);
    setMdpError(null);
    setMdpScanning(false);
    setSelectedDmp(null);
    setDmpInspectionError(null);
  }

  async function inspectDmp(candidate: OnboardingCandidate) {
    if (dmpInspectionBusy) return;
    setSelectedDmp(candidate);
    setDmpInspectionError(null);
    setDmpInspectionBusy(true);
    try {
      const bluetoothAddress = candidate.id.replace(/^edge-dmp:/, "");
      const deviceId = await registerDmpWavemaker({
        advertisedName: candidate.displayName,
        bluetoothAddress,
        ...(candidate.signalStrength === undefined
          ? {}
          : { signalStrength: candidate.signalStrength }),
      });
      finishPairing(deviceId);
    } catch (error) {
      setDmpInspectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setDmpInspectionBusy(false);
    }
  }

  async function provision() {
    if (!selected) {
      return;
    }

    const candidate = {
      ...selected,
      displayName: nearbyName.trim() || candidateFriendlyName(selected),
    };

    setState({
      status: "provisioning",
      candidate,
    });

    const session = activeSession.current?.kind === discoveryKind
      ? activeSession.current.session
      : new OnboardingSession(createOnboardingTransport(discoveryKind));
    const result = await session.provision(candidate, {
      ssid,
      password,
    });

    if (result.status === "completed" && result.result.deviceId) {
      try {
        // A successful radio handoff is not the end of onboarding. Keep the
        // panel open until the controller's authoritative device snapshot is
        // visible through the same inventory API used by the dashboard.
        await waitForDashboardDevice(result.result.deviceId);
      } catch (error) {
        setState({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (!isOwnedTuyaCandidate(candidate)) await rememberWifiCredentials();
      finishPairing(result.result.deviceId);
      return;
    }

    setState(result);
  }

  async function forgetOwnedTuyaDevice() {
    if (!selected || !isOwnedTuyaCandidate(selected)) return;
    setState({ status: "provisioning", candidate: selected });
    try {
      await removeOwnedTuyaDevice(selected.id);
      setSelected(null);
      await scan("bluetooth");
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function commissionMatter() {
    setMatterBusy(true);
    setMatterError(null);
    setMatterProgress("Starting secure pairing…");
    try {
      const deviceId = await commissionMatterDevice(
        matterCode,
        matterName.trim() || undefined,
        { ssid: ssid.trim(), password },
        matterCompatibility,
        setMatterProgress,
      );
      await rememberWifiCredentials();
      setMatterCode("");
      setMatterName("");
      finishPairing(deviceId);
    } catch (error) {
      setMatterError(error instanceof Error ? error.message : String(error));
    } finally {
      setMatterBusy(false);
    }
  }

  if (!open) {
    const addButtons = (
      <>
        <Pressable
          onPress={() => void scan("bluetooth")}
          style={[styles.addButton, compact ? styles.compactAddButton : undefined]}
        >
          <Text style={[styles.addButtonIcon, compact ? styles.compactAddButtonIcon : undefined]}>ᛒ</Text>
          <Text style={[styles.addButtonText, compact ? styles.compactAddButtonText : undefined]}>
            Add BT Device
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void scan("wifi")}
          style={[styles.addButton, compact ? styles.compactAddButton : undefined]}
        >
          <WifiButtonIcon />
          <Text style={[styles.addButtonText, compact ? styles.compactAddButtonText : undefined]}>
            Add Wi-Fi Device
          </Text>
        </Pressable>
      </>
    );
    if (compact) return addButtons;
    return <View style={styles.addButtonRow}>{addButtons}</View>;
  }

  const panel = (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>ONBOARDING</Text>
          <Text style={styles.title}>
            Add {discoveryKind === "bluetooth" ? "Bluetooth" : "Wi-Fi"} equipment
          </Text>
        </View>

        <Pressable onPress={closePanel}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      {method === "matter" ? (
        <>
          <Pressable
            onPress={() => {
              setScanningMatterCode(false);
              setMatterError(null);
              setMethod("nearby");
            }}
          >
            <Text style={styles.backLink}>‹ Back to nearby devices</Text>
          </Pressable>
          <Text style={styles.stepLabel}>STEP 1 OF 3 · SCAN SETUP CODE</Text>
          <Text style={styles.muted}>
            Scan the square setup code printed on the device, box, or quick-start card. You only need to scan it once.
          </Text>
          {scanningMatterCode ? (
            <View style={styles.scannerFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                facing="back"
                onBarcodeScanned={({ data }) => {
                  if (!data.startsWith("MT:")) {
                    setMatterError("That is not a compatible setup QR code.");
                    return;
                  }
                  setMatterCode(data);
                  setMatterError(null);
                  setScanningMatterCode(false);
                }}
                style={styles.scanner}
              />
              <Pressable onPress={() => setScanningMatterCode(false)} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Cancel Scan</Text>
              </Pressable>
            </View>
          ) : matterCode.startsWith("MT:") ? (
            <View style={styles.capturedCodeRow}>
              <Text style={styles.success}>✓ Setup code captured</Text>
              <Pressable onPress={() => setMatterCode("")}>
                <Text style={styles.retryButtonText}>Scan a different code</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable onPress={openMatterScanner} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Scan Setup QR Code</Text>
              </Pressable>
              <Text style={styles.orText}>or enter the 11-digit number printed beside it</Text>
              <TextInput
                keyboardType="number-pad"
                maxLength={13}
                onChangeText={setMatterCode}
                placeholder="11-digit setup code"
                placeholderTextColor="#6F7D93"
                style={styles.input}
                value={matterCode}
              />
            </>
          )}
          {matterCodeIsValid ? (
            <>
              <Text style={styles.stepLabel}>STEP 2 OF 3 · CONFIRM DETAILS</Text>
              <TextInput
                onChangeText={setMatterName}
                placeholder="Device name (optional)"
                placeholderTextColor="#6F7D93"
                style={styles.input}
                value={matterName}
              />
              <TextInput
                autoCapitalize="none"
                onChangeText={setSsid}
                placeholder="2.4 GHz Wi-Fi network"
                placeholderTextColor="#6F7D93"
                style={styles.input}
                value={ssid}
              />
              <TextInput
                autoCapitalize="none"
                onChangeText={setPassword}
                placeholder="Wi-Fi password"
                placeholderTextColor="#6F7D93"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <Text style={styles.savedWifiHint}>
                Wi-Fi credentials are saved securely on this device for future pairing.
              </Text>
              <Text style={styles.stepLabel}>STEP 3 OF 3 · CONNECT</Text>
              {matterError ? <Text style={styles.failure}>{matterError}</Text> : null}
              {matterBusy ? (
                <View style={styles.commissioningProgress}>
                  <ActivityIndicator color="#20B7EC" />
                  <View style={styles.progressCopy}>
                    <Text style={styles.progressTitle}>
                      {matterProgress || "Connecting smart device…"}
                    </Text>
                    <Text style={styles.muted}>
                      Keep it powered and in pairing mode. Secure setup can take up to three minutes.
                    </Text>
                  </View>
                </View>
              ) : (
                <Pressable
                  disabled={!ssid.trim()}
                  onPress={commissionMatter}
                  style={[styles.primaryButton, !ssid.trim() && styles.buttonDisabled]}
                >
                  <Text style={styles.primaryButtonText}>
                    Connect Outlet
                  </Text>
                </Pressable>
              )}
            </>
          ) : matterError ? <Text style={styles.failure}>{matterError}</Text> : null}
        </>
      ) : null}

      {method === "nearby" && state.status === "scanning" ? (
        <View style={styles.progress}>
          <ActivityIndicator color="#20B7EC" />
          <Text style={[styles.muted, styles.progressText]}>
            {discoveryKind === "bluetooth"
              ? "Looking for nearby Bluetooth aquarium equipment…"
              : "Looking for Wi-Fi and Wi-Fi commissioning equipment…"}
          </Text>
        </View>
      ) : null}

      {method === "nearby" && state.status === "selecting" ? (
        <>
          <Text style={styles.muted}>
            {state.candidates.length > 0 || mdpPumps.length > 0 || md44Dosers.length > 0
              ? "Choose the device you want to add."
              : "No equipment was identified."}
          </Text>

          {discoveryKind === "wifi" && method === "nearby" && mdpScanning ? (
            <Text style={styles.muted}>Checking this Reef Controller for Wi-Fi aquarium equipment…</Text>
          ) : null}

          {discoveryKind === "wifi" && method === "nearby" && !mdpScanning && mdpError ? (
            <Text style={styles.failure}>Equipment scan failed: {mdpError}</Text>
          ) : null}

          {discoveryKind === "wifi" && method === "nearby" && mdpPumps.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>JEBAO PUMPS FOUND</Text>
              {mdpPumps.map((pump) => (
                <Pressable
                  key={pump.deviceId}
                  onPress={() => setSelectedMdp(pump)}
                  style={[
                    styles.candidate,
                    selectedMdp?.deviceId === pump.deviceId
                      ? styles.candidateSelected
                      : undefined,
                  ]}
                >
                  <Text style={styles.candidateName}>Jebao Pump</Text>
                  <Text style={styles.signal}>MDP series</Text>
                  <Text style={styles.signal}>
                    {pump.networkAddress}
                    {pump.firmwareVersion ? ` · Firmware ${pump.firmwareVersion}` : ""}
                  </Text>
                </Pressable>
              ))}
              {selectedMdp ? (
                <>
                  <TextInput
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={48}
                    onChangeText={setMdpName}
                    placeholder="Pump name"
                    placeholderTextColor="#6F7D93"
                    style={styles.input}
                    value={mdpName}
                  />
                  {mdpError ? <Text style={styles.failure}>{mdpError}</Text> : null}
                  <Pressable
                    disabled={mdpBusy}
                    onPress={() => void addMdpPump()}
                    style={styles.primaryButton}
                  >
                    {mdpBusy
                      ? <ActivityIndicator color="#FFFFFF" />
                      : <Text style={styles.primaryButtonText}>Add Pump</Text>}
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {discoveryKind === "wifi" && method === "nearby" && md44Dosers.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>JEBAO DOSERS FOUND</Text>
              {md44Dosers.map((doser) => (
                <View key={doser.deviceId} style={styles.candidate}>
                  <Text style={styles.candidateName}>Jebao Doser</Text>
                  <Text style={styles.signal}>MD-4.4</Text>
                  <Text style={styles.signal}>
                    {doser.networkAddress} · {doser.headCount} dosing heads
                    {doser.firmwareVersion ? ` · Firmware ${doser.firmwareVersion}` : ""}
                  </Text>
                  <Text style={doser.localControlReady ? styles.savedWifiHint : styles.failure}>
                    {doser.localControlReady
                      ? `Local control authenticated · ${doser.statusFrameLength ?? 0}-byte live status received`
                      : `Found, but local status failed${doser.statusError ? `: ${doser.statusError}` : ""}`}
                  </Text>
                  <Text style={styles.savedWifiHint}>DID {doser.gizwitsDeviceId}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {discoveryKind === "wifi" && shouldOfferManualSetupCode(state.candidates) ? (
            <Pressable
              onPress={() => {
                setMethod("matter");
                setMatterName("Smart Outlet");
                void openMatterScanner();
              }}
              style={styles.qrSetupChoice}
            >
              <Text style={styles.qrSetupTitle}>Device has a setup QR code?</Text>
              <Text style={styles.qrSetupSummary}>
                Scan the square code on the device or its card.
              </Text>
              <Text style={styles.qrSetupAction}>Scan setup code →</Text>
            </Pressable>
          ) : null}

          {state.candidates.length > 0 ? (
            <Text style={styles.sectionLabel}>NEARBY DEVICES FOUND</Text>
          ) : null}

          {state.candidates.length === 0 ? (
            <Text style={styles.muted}>
              Confirm the pairing indicator is blinking, or use the setup-code option above.
            </Text>
          ) : null}

          {state.candidates.map((candidate) => (
            candidate.manufacturerData === jebaoDmpBleManufacturerMarker ? (
              <Pressable
                key={candidate.id}
                disabled={dmpInspectionBusy}
                onPress={() => void inspectDmp(candidate)}
                style={[
                  styles.candidate,
                  selectedDmp?.id === candidate.id ? styles.candidateSelected : undefined,
                ]}
              >
                <Text style={styles.candidateName}>Jebao Wavemaker</Text>
                <Text style={styles.signal}>
                  {candidate.displayName} · DMP series · Bluetooth control
                  {typeof candidate.signalStrength === "number"
                    ? ` · Signal ${candidate.signalStrength} dBm`
                    : ""}
                </Text>
                <Text style={styles.savedWifiHint}>
                  {selectedDmp?.id !== candidate.id
                    ? "Tap to connect and identify its control protocol."
                    : dmpInspectionBusy
                      ? "Connecting and reading Bluetooth services…"
                      : "Tap to have the Reef Controller verify and add this wavemaker."}
                </Text>
                {selectedDmp?.id === candidate.id && dmpInspectionBusy ? (
                  <ActivityIndicator color="#20B7EC" style={styles.dmpInspectionSpinner} />
                ) : null}
                {selectedDmp?.id === candidate.id && dmpInspectionError ? (
                  <Text style={styles.failure}>{dmpInspectionError}</Text>
                ) : null}
              </Pressable>
            ) : (
            <Pressable
              key={candidate.id}
              onPress={() => {
                setSelected(candidate);
                setNearbyName(candidateFriendlyName(candidate));
                if (isMatterCandidate(candidate)) {
                  setMethod("matter");
                  setMatterName(candidateFriendlyName(candidate));
                  setMatterCompatibility(
                    candidate.manufacturerData === "matter-tapo-known-address"
                      ? "tapo-p316m"
                      : undefined,
                  );
                  void openMatterScanner();
                }
              }}
              style={[
                styles.candidate,
                selected?.id === candidate.id
                  ? styles.candidateSelected
                  : undefined,
              ]}
            >
              <Text style={styles.candidateName}>
                {candidateFriendlyName(candidate)}
              </Text>
              <Text style={styles.signal}>
                {candidate.displayName} · {isMatterCandidate(candidate)
                  ? "Uses a setup QR code"
                  : discoveryKind === "bluetooth"
                    ? "Bluetooth setup"
                    : "Direct Wi-Fi setup"}
                {typeof candidate.signalStrength === "number"
                  ? ` · Signal ${candidate.signalStrength} dBm`
                  : ""}
              </Text>
            </Pressable>
            )
          ))}

          {selected ? (
            <>
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={48}
                onChangeText={setNearbyName}
                placeholder="Device name"
                placeholderTextColor="#6F7D93"
                style={styles.input}
                value={nearbyName}
              />
              {!isOwnedTuyaCandidate(selected) ? (
                <>
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setSsid}
                    placeholder="Wi-Fi network"
                    placeholderTextColor="#6F7D93"
                    style={styles.input}
                    value={ssid}
                  />
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setPassword}
                    placeholder="Wi-Fi password"
                    placeholderTextColor="#6F7D93"
                    secureTextEntry
                    style={styles.input}
                    value={password}
                  />
                  <Text style={styles.savedWifiHint}>
                    Wi-Fi credentials are saved securely on this device for future pairing.
                  </Text>
                </>
              ) : (
                <Text style={styles.savedWifiHint}>
                  This device is already on Wi-Fi. Reconnect it to this aquarium without pairing it again.
                </Text>
              )}

              <Pressable
                disabled={!isOwnedTuyaCandidate(selected) && !ssid.trim()}
                onPress={provision}
                style={[
                  styles.primaryButton,
                  !isOwnedTuyaCandidate(selected) && !ssid.trim()
                    ? styles.buttonDisabled
                    : undefined,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isOwnedTuyaCandidate(selected) ? "Reconnect Device" : "Connect Device"}
                </Text>
              </Pressable>
              {isOwnedTuyaCandidate(selected) ? (
                <Pressable onPress={() => void forgetOwnedTuyaDevice()} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Forget and Re-pair</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

        </>
      ) : null}

      {method === "nearby" && state.status === "provisioning" ? (
        <View style={styles.progress}>
          <ActivityIndicator color="#20B7EC" />
          <Text style={styles.muted}>
            Connecting {state.candidate.displayName}…
          </Text>
        </View>
      ) : null}

      {method === "nearby" && state.status === "completed" ? (
        <>
          <Text style={styles.success}>Device connected</Text>
          <Text style={styles.muted}>{state.result.message}</Text>
        </>
      ) : null}

      {method === "nearby" && state.status === "failed" ? (
        <>
          {discoveryKind === "wifi" && (!ssid.trim() || password.length < 8) ? (
            <>
              <Text style={styles.sectionLabel}>CONNECT EQUIPMENT TO WI-FI</Text>
              <Text style={styles.muted}>
                Enter the 2.4 GHz network this equipment should join, then continue the scan.
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSsid}
                placeholder="2.4 GHz Wi-Fi network"
                placeholderTextColor="#6F7D93"
                style={styles.input}
                value={ssid}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                placeholder="Wi-Fi password"
                placeholderTextColor="#6F7D93"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <Text style={styles.savedWifiHint}>
                Wi-Fi credentials are saved securely on this device for future equipment setup.
              </Text>
              <Pressable
                disabled={!ssid.trim() || password.length < 8}
                onPress={() => void continueWifiEquipmentScan()}
                style={[
                  styles.primaryButton,
                  (!ssid.trim() || password.length < 8) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>Continue Scan</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.failure}>Could not connect</Text>
              <Text style={styles.muted}>{state.message}</Text>
              <Pressable onPress={() => void scan(discoveryKind)} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Scan Again</Text>
              </Pressable>
            </>
          )}
        </>
      ) : null}
    </View>
  );

  if (!compact) return panel;

  return (
    <Modal
      animationType="fade"
      onRequestClose={closePanel}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View style={styles.modalBackdrop}>
        <ScrollView
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="handled"
          style={styles.modalScroll}
        >
          {panel}
        </ScrollView>
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  addButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  addButton: {
    alignItems: "center",
    borderColor: "#0A8FEA",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    padding: 14,
  },
  addButtonIcon: {
    color: "#20B7EC",
    fontSize: 17,
    fontWeight: "800",
  },
  addButtonText: {
    color: "#20B7EC",
    fontSize: 16,
    fontWeight: "700",
  },
  compactAddButton: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 8,
    justifyContent: "center",
    marginBottom: 0,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  compactAddButtonText: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
  },
  compactAddButtonIcon: {
    fontSize: 13,
  },
  wifiButtonIcon: {
    height: 17,
    position: "relative",
    width: 18,
  },
  wifiButtonArcOuter: {
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderTopWidth: 2,
    height: 11,
    left: 1,
    position: "absolute",
    top: 1,
    width: 16,
  },
  wifiButtonArcInner: {
    borderColor: "#20B7EC",
    borderRadius: 5,
    borderTopWidth: 2,
    height: 7,
    left: 5,
    position: "absolute",
    top: 6,
    width: 8,
  },
  wifiButtonDot: {
    backgroundColor: "#20B7EC",
    borderRadius: 2,
    bottom: 0,
    height: 3,
    left: 8,
    position: "absolute",
    width: 3,
  },
  card: {
    backgroundColor: "#0A2949",
    borderColor: "#123E6B",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginBottom: 18,
    padding: 18,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(1, 12, 24, 0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalScroll: {
    maxHeight: "92%",
    maxWidth: 760,
    width: "100%",
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#20B7EC",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    color: "#F3F7F8",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 3,
  },
  close: {
    color: "#A9B7CA",
    padding: 4,
  },
  backLink: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "700",
  },
  stepLabel: {
    color: "#20B7EC",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 4,
  },
  sectionLabel: {
    color: "#82979F",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 6,
  },
  muted: {
    color: "#A9B7CA",
    lineHeight: 20,
  },
  progress: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
    paddingVertical: 8,
  },
  progressText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  commissioningProgress: {
    alignItems: "flex-start",
    backgroundColor: "#081D35",
    borderColor: "#164975",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  progressCopy: {
    flex: 1,
    gap: 3,
  },
  progressTitle: {
    color: "#F3F7F8",
    fontSize: 15,
    fontWeight: "700",
  },
  candidate: {
    backgroundColor: "#081D35",
    borderColor: "#164975",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  candidateSelected: {
    borderColor: "#20B7EC",
  },
  dmpInspectionSpinner: {
    alignSelf: "flex-start",
    marginTop: 10,
  },
  candidateName: {
    color: "#F3F7F8",
    fontSize: 16,
    fontWeight: "700",
  },
  signal: {
    color: "#82979F",
    fontSize: 12,
    marginTop: 4,
  },
  input: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 10,
    borderWidth: 1,
    color: "#F3F7F8",
    padding: 13,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 10,
    padding: 14,
  },
  primaryButtonText: {
    color: "#EFFFFF",
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  success: {
    color: "#2ECC71",
    fontSize: 18,
    fontWeight: "800",
  },
  failure: {
    color: "#E74C3C",
    fontSize: 18,
    fontWeight: "800",
  },
  retryButton: {
    alignItems: "center",
    borderColor: "#20B7EC",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  retryButtonText: {
    color: "#20B7EC",
    fontWeight: "700",
  },
  orText: {
    color: "#82979F",
    fontSize: 12,
    textAlign: "center",
  },
  savedWifiHint: {
    color: "#82979F",
    fontSize: 11,
    lineHeight: 16,
  },
  qrSetupChoice: {
    backgroundColor: "#0B355B",
    borderColor: "#20B7EC",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  qrSetupTitle: {
    color: "#F3F7F8",
    fontSize: 16,
    fontWeight: "800",
  },
  qrSetupSummary: {
    color: "#A9B7CA",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  qrSetupAction: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
  },
  scannerFrame: {
    gap: 10,
  },
  capturedCodeRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  scanner: {
    borderRadius: 12,
    height: 280,
    overflow: "hidden",
  },
});
