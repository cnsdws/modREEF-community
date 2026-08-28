import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type CircularActionKind = "add" | "cancel" | "confirm" | "close";

interface CircularActionButtonProps {
  accessibilityLabel: string;
  busy?: boolean;
  disabled?: boolean;
  kind: CircularActionKind;
  onPress: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function CircularActionGlyph({
  kind,
}: {
  kind: CircularActionKind;
}) {
  if (kind === "add") {
    return (
      <View accessibilityElementsHidden style={styles.glyphFrame}>
        <View style={[styles.stroke, styles.addHorizontal]} />
        <View style={[styles.stroke, styles.addVertical]} />
      </View>
    );
  }

  if (kind === "cancel" || kind === "close") {
    return (
      <View accessibilityElementsHidden style={styles.glyphFrame}>
        <View
          style={[
            styles.stroke,
            kind === "close" ? styles.closeStroke : undefined,
            styles.cancelForward,
          ]}
        />
        <View
          style={[
            styles.stroke,
            kind === "close" ? styles.closeStroke : undefined,
            styles.cancelBackward,
          ]}
        />
      </View>
    );
  }

  return (
    <View accessibilityElementsHidden style={styles.glyphFrame}>
      <View style={[styles.stroke, styles.confirmShort]} />
      <View style={[styles.stroke, styles.confirmLong]} />
    </View>
  );
}

export function CircularActionButton({
  accessibilityLabel,
  busy = false,
  disabled = false,
  kind,
  onPress,
  size = 44,
  style,
}: CircularActionButtonProps) {
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: inactive }}
      disabled={inactive}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            kind === "add"
              ? "#1385AE"
              : kind === "confirm"
                ? "#1F9D67"
                : kind === "close"
                  ? "#172B42"
                  : "#C83E4D",
          borderColor: kind === "close" ? "#D45A6A" : undefined,
          borderRadius: size / 2,
          borderWidth: kind === "close" ? 1 : 0,
          height: size,
          width: size,
        },
        inactive && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <CircularActionGlyph kind={kind} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addHorizontal: { width: 16 },
  addVertical: { transform: [{ rotate: "90deg" }], width: 16 },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBackward: {
    transform: [{ rotate: "-45deg" }],
    width: 15,
  },
  cancelForward: {
    transform: [{ rotate: "45deg" }],
    width: 15,
  },
  closeStroke: { backgroundColor: "#FCA5A5" },
  confirmLong: {
    left: 5,
    top: 8,
    transform: [{ rotate: "-45deg" }],
    width: 12,
  },
  confirmShort: {
    left: 1,
    top: 10,
    transform: [{ rotate: "45deg" }],
    width: 7,
  },
  disabled: { opacity: 0.45 },
  glyphFrame: {
    height: 18,
    position: "relative",
    width: 18,
  },
  pressed: { opacity: 0.72 },
  stroke: {
    backgroundColor: "#FFFFFF",
    borderRadius: 1.5,
    height: 2.5,
    left: 1,
    position: "absolute",
    top: 7.75,
  },
});
