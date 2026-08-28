import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

interface SwipeActionRowProps {
  accessibilityLabel: string;
  actionLabel: string;
  children: ReactNode;
  onAction: () => void;
}

const actionWidth = 88;

export function SwipeActionRow({
  accessibilityLabel,
  actionLabel,
  children,
  onAction,
}: SwipeActionRowProps) {
  const swipeable = useRef<Swipeable>(null);

  return (
    <Swipeable
      containerStyle={styles.container}
      dragOffsetFromRightEdge={8}
      enableTrackpadTwoFingerGesture
      friction={1.5}
      overshootFriction={8}
      overshootRight={false}
      ref={swipeable}
      renderRightActions={() => (
        <View style={styles.actionContainer}>
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={() => {
              swipeable.current?.close();
              onAction();
            }}
            style={({ pressed }) => [
              styles.action,
              pressed ? styles.actionPressed : undefined,
            ]}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        </View>
      )}
      rightThreshold={actionWidth / 2}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: "#1678B8",
    flex: 1,
    justifyContent: "center",
    width: actionWidth,
  },
  actionContainer: { width: actionWidth },
  actionPressed: { backgroundColor: "#0F6097" },
  actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  container: { overflow: "hidden" },
});
