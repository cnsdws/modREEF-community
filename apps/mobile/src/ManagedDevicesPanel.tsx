import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  deleteEdgeManagedDevice,
  getEdgeManagedDevices,
  renameEdgeManagedDevice,
  type EdgeManagedDevice,
} from "./edgeClient";
import { CircularActionButton } from "./CircularActionButton";
import {
  managedDeviceCategory,
  managedDeviceDisplayName,
} from "./managedDevicePresentation";
import { managedDeviceViewState } from "./managedDeviceViewState";

export function ManagedDevicesPanel({
  cloudMode = false,
  onDeviceDeleted,
  refreshVersion = 0,
}: {
  cloudMode?: boolean;
  onDeviceDeleted?: (deviceId: string) => void;
  refreshVersion?: number;
}) {
  const [devices, setDevices] = useState<EdgeManagedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);

    try {
      setDevices(await getEdgeManagedDevices());
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not load devices.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [refreshVersion]);

  function confirmDelete(device: EdgeManagedDevice) {
    const displayName = managedDeviceDisplayName(device);
    Alert.alert(
      `Delete “${displayName}”?`,
      "This removes the device, all of its equipment channels, assignments, and schedules from modREEF. The physical device will not be factory-reset.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Device",
          style: "destructive",
          onPress: () => void removeDevice(device),
        },
      ],
    );
  }

  async function removeDevice(device: EdgeManagedDevice) {
    setDeletingId(device.id);
    setError(null);

    try {
      await deleteEdgeManagedDevice(device.id);
      setDevices((current) =>
        current.filter((candidate) => candidate.id !== device.id),
      );
      onDeviceDeleted?.(device.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete device.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function startRename(device: EdgeManagedDevice) {
    setEditingId(device.id);
    setDeviceName(managedDeviceDisplayName(device));
    setError(null);
  }

  function cancelRename() {
    setEditingId(null);
    setDeviceName("");
  }

  async function saveName(device: EdgeManagedDevice) {
    const name = deviceName.trim();

    if (!name) {
      return;
    }

    setSavingId(device.id);
    setError(null);

    try {
      const updated = await renameEdgeManagedDevice(device.id, name);
      setDevices((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      cancelRename();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not rename device.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const viewState = managedDeviceViewState(
    loading,
    error,
    devices.length,
    cloudMode,
  );

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Managed Devices</Text>

      {viewState.kind === "loading" ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#20B7EC" />
          <Text style={styles.muted}>{viewState.message}</Text>
        </View>
      ) : null}

      {viewState.kind === "empty" ? (
        <Text style={styles.muted}>{viewState.message}</Text>
      ) : null}

      {viewState.kind === "ready" ? (
        devices.map((device) => (
          <View key={device.id} style={styles.deviceRow}>
            <View style={styles.deviceText}>
              {editingId === device.id ? (
                <View style={styles.nameEditor}>
                  <TextInput
                    accessibilityLabel="Equipment name"
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={savingId === null}
                    maxLength={48}
                    onChangeText={setDeviceName}
                    onSubmitEditing={() => void saveName(device)}
                    placeholder="Equipment name"
                    placeholderTextColor="#6F7D93"
                    returnKeyType="done"
                    selectTextOnFocus
                    style={styles.nameInput}
                    value={deviceName}
                  />
                  <CircularActionButton
                    accessibilityLabel="Cancel equipment name"
                    disabled={savingId !== null}
                    kind="cancel"
                    onPress={cancelRename}
                    size={34}
                  />
                  <CircularActionButton
                    accessibilityLabel="Save equipment name"
                    busy={savingId === device.id}
                    disabled={savingId !== null || !deviceName.trim()}
                    kind="confirm"
                    onPress={() => void saveName(device)}
                    size={34}
                  />
                </View>
              ) : (
                <Text style={styles.deviceName}>
                  {managedDeviceDisplayName(device)}
                </Text>
              )}
              <Text style={styles.muted}>
                {managedDeviceCategory(device) || "Connected device"}
              </Text>
            </View>

            {editingId !== device.id ? (
              <View style={styles.deviceActions}>
                <Pressable
                  accessibilityLabel={`Rename ${managedDeviceDisplayName(device)}`}
                  accessibilityRole="button"
                  disabled={deletingId !== null || editingId !== null}
                  onPress={() => startRename(device)}
                  style={[
                    styles.renameButton,
                    deletingId !== null || editingId !== null
                      ? styles.disabled
                      : undefined,
                  ]}
                >
                  <Text style={styles.renameText}>Rename</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Delete ${managedDeviceDisplayName(device)}`}
                  accessibilityRole="button"
                  disabled={deletingId !== null || editingId !== null}
                  onPress={() => confirmDelete(device)}
                  style={[
                    styles.deleteButton,
                    deletingId !== null || editingId !== null
                      ? styles.disabled
                      : undefined,
                  ]}
                >
                  <Text style={styles.deleteText}>
                    {deletingId === device.id
                      ? "Deleting…"
                      : "Delete Device"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      ) : null}

      {viewState.kind === "error" ? (
        <View style={styles.errorRow}>
          <Text style={cloudMode ? styles.muted : styles.error}>
            {viewState.message}
          </Text>
          <Pressable
            accessibilityLabel="Retry loading managed devices"
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    gap: 12,
    marginTop: 4,
    paddingTop: 18,
  },
  heading: {
    color: "#F3F7F8",
    fontSize: 16,
    fontWeight: "700",
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  deviceRow: {
    alignItems: "center",
    backgroundColor: "#081D35",
    borderColor: "#164975",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  deviceText: {
    flex: 1,
  },
  deviceName: {
    color: "#F3F7F8",
    fontSize: 15,
    fontWeight: "700",
  },
  nameEditor: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  nameInput: {
    backgroundColor: "#061529",
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1,
    color: "#F3F7F8",
    flex: 1,
    fontSize: 15,
    minWidth: 120,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  muted: {
    color: "#8FA4BF",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  deleteButton: {
    borderColor: "#E74C3C",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  deviceActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  renameButton: {
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  renameText: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "800",
  },
  deleteText: {
    color: "#F87171",
    fontSize: 12,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.45,
  },
  error: {
    color: "#FCA5A5",
    fontSize: 13,
  },
  errorRow: {
    alignItems: "flex-start",
    gap: 8,
  },
  retryButton: {
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "800",
  },
});
