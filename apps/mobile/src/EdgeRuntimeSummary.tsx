import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getEdgeHealth, type EdgeHealth } from "./edgeClient";

type RuntimeState =
  | { status: "checking" }
  | { status: "connected"; health: EdgeHealth }
  | { status: "unavailable" };

function edgeTime(timestamp: string | number) {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function healthDotStyle(health: EdgeHealth) {
  if (health.status === "healthy") {
    return styles.dotHealthy;
  }

  if (health.status === "degraded") {
    return styles.dotDegraded;
  }

  return styles.dotUnavailable;
}

export function EdgeRuntimeSummary({
  cloudAvailability,
}: {
  cloudAvailability?: "unknown" | "online" | "offline";
}) {
  const [state, setState] = useState<RuntimeState>({
    status: "checking",
  });
  const [clockTime, setClockTime] = useState<number | null>(null);
  const edgeOffsetMilliseconds = useRef<number | null>(null);

  useEffect(() => {
    if (cloudAvailability !== undefined) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = setInterval(() => {
      const offset = edgeOffsetMilliseconds.current;

      if (offset !== null) {
        setClockTime(Date.now() + offset);
      }
    }, 1_000);

    async function refresh() {
      const requestStartedAt = Date.now();

      try {
        const health = await getEdgeHealth(
          AbortSignal.timeout(5_000),
        );
        const responseReceivedAt = Date.now();
        const edgeTimestamp = Date.parse(health.timestamp);

        if (!cancelled) {
          if (!Number.isNaN(edgeTimestamp)) {
            const requestMidpoint =
              (requestStartedAt + responseReceivedAt) / 2;
            const offset = edgeTimestamp - requestMidpoint;

            edgeOffsetMilliseconds.current = offset;
            setClockTime(responseReceivedAt + offset);
          }

          setState({ status: "connected", health });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "unavailable" });
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => void refresh(), 15_000);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }

      clearInterval(clock);
    };
  }, [cloudAvailability]);

  if (cloudAvailability !== undefined) {
    const cloudOnline = cloudAvailability === "online";

    return (
      <View style={styles.card}>
        <View style={styles.item}>
          <Text style={styles.label}>CONNECTION</Text>
          <Text style={styles.value}>Cloud</Text>
        </View>
        <View style={[styles.item, styles.divided]}>
          <Text style={styles.label}>CONTROL</Text>
          <Text style={styles.value}>{cloudOnline ? "Live" : "Waiting"}</Text>
        </View>
        <View style={[styles.item, styles.divided]}>
          <Text style={styles.label}>EDGE</Text>
          <View style={styles.healthValue}>
            <View
              style={[
                styles.dot,
                cloudOnline
                  ? styles.dotHealthy
                  : cloudAvailability === "unknown"
                    ? styles.dotDegraded
                    : styles.dotUnavailable,
              ]}
            />
            <Text style={styles.value}>
              {cloudOnline
                ? "Online"
                : cloudAvailability === "unknown"
                  ? "Checking"
                  : "Offline"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const connected = state.status === "connected";

  return (
    <View style={styles.card}>
      <View style={styles.item}>
        <Text style={styles.label}>TIME</Text>
        <Text style={[styles.value, styles.timeValue]}>
          {clockTime === null ? "—" : edgeTime(clockTime)}
        </Text>
      </View>

      <View style={[styles.item, styles.divided]}>
        <Text style={styles.label}>VERSION</Text>
        <Text style={styles.value}>
          {connected ? `v${state.health.version}` : "—"}
        </Text>
      </View>

      <View style={[styles.item, styles.divided]}>
        <Text style={styles.label}>HEALTH</Text>
        <View style={styles.healthValue}>
          <View
            style={[
              styles.dot,
              connected
                ? healthDotStyle(state.health)
                : styles.dotUnavailable,
            ]}
          />
          <Text style={styles.value}>
            {connected
              ? statusLabel(state.health.status)
              : state.status === "checking"
                ? "Checking"
                : "Offline"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#081F39",
    borderColor: "#153E63",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 28,
    overflow: "hidden",
    paddingVertical: 12,
  },
  divided: {
    borderLeftColor: "#153E63",
    borderLeftWidth: 1,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  dotHealthy: {
    backgroundColor: "#34D399",
  },
  dotDegraded: {
    backgroundColor: "#FBBF24",
  },
  dotUnavailable: {
    backgroundColor: "#F87171",
  },
  healthValue: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  item: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
  },
  label: {
    color: "#6F879F",
    fontSize: 6.75,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: {
    color: "#DCE8F3",
    fontSize: 9,
    fontWeight: "700",
  },
  timeValue: {
    fontSize: 7.65,
  },
});
