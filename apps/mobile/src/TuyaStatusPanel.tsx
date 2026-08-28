import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import TuyaBridgeModule, {
  type TuyaHome,
  type TuyaSdkStatus,
} from "../modules/tuya-bridge/src/TuyaBridgeModule";

export function TuyaStatusPanel() {
  const [status, setStatus] = useState<TuyaSdkStatus>(
    TuyaBridgeModule.getStatus(),
  );
  const [connecting, setConnecting] = useState(false);
  const [creatingHome, setCreatingHome] = useState(false);
  const [homes, setHomes] = useState<TuyaHome[]>([]);
  const [loadingHomes, setLoadingHomes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status.loggedIn) {
      setHomes([]);
      return;
    }

    let active = true;
    setLoadingHomes(true);

    void TuyaBridgeModule.getHomes()
      .then((loadedHomes) => {
        if (active) {
          setHomes(loadedHomes);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load Tuya homes.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingHomes(false);
        }
      });

    return () => {
      active = false;
    };
  }, [status.loggedIn]);

  async function createModReefHome() {
    setCreatingHome(true);
    setError(null);

    try {
      const home = await TuyaBridgeModule.createHome(
        "modREEF Aquarium",
      );
      setHomes([home]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the Tuya Home.",
      );
    } finally {
      setCreatingHome(false);
    }
  }

  async function connectDevelopmentAccount() {
    setConnecting(true);
    setError(null);

    try {
      const result = await TuyaBridgeModule.registerAnonymous("1");
      setStatus((current) => ({
        ...current,
        loggedIn: result.loggedIn,
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect the Tuya development account.",
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>TUYA</Text>
      <Text style={styles.title}>iOS SDK</Text>
      <Text style={styles.status}>
        {status.sdkLoaded ? "Native SDK connected" : "Native SDK unavailable"}
      </Text>
      <Text style={styles.detail}>Platform: {status.platform}</Text>
      <Text style={styles.detail}>
        Account: {status.loggedIn ? "Connected" : "Not connected"}
      </Text>

      {status.loggedIn ? (
        <Text style={styles.detail}>
          Home:{" "}
          {loadingHomes
            ? "Loading…"
            : homes.length > 0
              ? homes.map((home) => home.name).join(", ")
              : "None configured"}
        </Text>
      ) : null}

      {status.loggedIn &&
      !loadingHomes &&
      homes.length === 0 ? (
        <Pressable
          disabled={creatingHome}
          onPress={createModReefHome}
          style={styles.button}
        >
          {creatingHome ? (
            <ActivityIndicator color="#EFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              Create modREEF Home
            </Text>
          )}
        </Pressable>
      ) : null}

      {status.sdkLoaded && !status.loggedIn ? (
        <Pressable
          disabled={connecting}
          onPress={connectDevelopmentAccount}
          style={styles.button}
        >
          {connecting ? (
            <ActivityIndicator color="#EFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              Connect Development Account
            </Text>
          )}
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0A2949",
    borderColor: "#123E6B",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  eyebrow: {
    color: "#20B7EC",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    color: "#F3F7F8",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 3,
  },
  status: {
    color: "#2ECC71",
    fontWeight: "700",
    marginTop: 10,
  },
  detail: {
    color: "#A9B7CA",
    marginTop: 4,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 10,
    marginTop: 14,
    padding: 12,
  },
  buttonText: {
    color: "#EFFFFF",
    fontWeight: "800",
  },
  error: {
    color: "#E74C3C",
    marginTop: 10,
  },
});
