import { StyleSheet, View } from "react-native";

export function FlaskIcon() {
  return (
    <View accessibilityElementsHidden style={styles.flask}>
      <View style={styles.flaskLip} />
      <View style={styles.flaskNeck} />
      <View style={styles.flaskLeftSide} />
      <View style={styles.flaskRightSide} />
      <View style={styles.flaskBottom} />
      <View style={styles.flaskLiquid} />
    </View>
  );
}

export function GraphIcon() {
  return (
    <View accessibilityElementsHidden style={styles.graph}>
      <View style={styles.graphVerticalAxis} />
      <View style={styles.graphHorizontalAxis} />
      <View style={[styles.graphBar, styles.graphBarOne]} />
      <View style={[styles.graphBar, styles.graphBarTwo]} />
      <View style={[styles.graphBar, styles.graphBarThree]} />
      <View style={[styles.graphBar, styles.graphBarFour]} />
    </View>
  );
}

export function DropdownChevron({ open }: { open: boolean }) {
  return (
    <View accessibilityElementsHidden style={styles.chevronBox}>
      <View
        style={[
          styles.chevron,
          open ? styles.chevronUp : styles.chevronDown,
        ]}
      />
    </View>
  );
}

const accent = "#20B7EC";

const styles = StyleSheet.create({
  flask: { height: 24, position: "relative", width: 24 },
  flaskLip: {
    backgroundColor: accent,
    borderRadius: 1,
    height: 2,
    left: 7,
    position: "absolute",
    top: 1,
    width: 10,
  },
  flaskNeck: {
    borderColor: accent,
    borderTopWidth: 0,
    borderWidth: 2,
    height: 8,
    left: 9,
    position: "absolute",
    top: 3,
    width: 6,
  },
  flaskLeftSide: {
    backgroundColor: accent,
    borderRadius: 1,
    height: 13,
    left: 5.5,
    position: "absolute",
    top: 9,
    transform: [{ rotate: "31deg" }],
    width: 2,
  },
  flaskRightSide: {
    backgroundColor: accent,
    borderRadius: 1,
    height: 13,
    position: "absolute",
    right: 5.5,
    top: 9,
    transform: [{ rotate: "-31deg" }],
    width: 2,
  },
  flaskBottom: {
    backgroundColor: accent,
    borderRadius: 1,
    bottom: 1,
    height: 2,
    left: 4,
    position: "absolute",
    width: 16,
  },
  flaskLiquid: {
    backgroundColor: accent,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    bottom: 4,
    height: 5,
    left: 6,
    opacity: 0.45,
    position: "absolute",
    width: 12,
  },
  graph: { height: 24, position: "relative", width: 24 },
  graphVerticalAxis: {
    backgroundColor: accent,
    bottom: 4,
    height: 17,
    left: 3,
    position: "absolute",
    width: 2,
  },
  graphHorizontalAxis: {
    backgroundColor: accent,
    bottom: 3,
    height: 2,
    left: 3,
    position: "absolute",
    width: 19,
  },
  graphBar: {
    backgroundColor: accent,
    bottom: 5,
    position: "absolute",
    width: 3,
  },
  graphBarOne: { height: 6, left: 7 },
  graphBarTwo: { height: 11, left: 11 },
  graphBarThree: { height: 8, left: 15 },
  graphBarFour: { height: 15, left: 19 },
  chevronBox: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    width: 24,
  },
  chevron: {
    borderBottomColor: accent,
    borderBottomWidth: 2,
    borderRightColor: accent,
    borderRightWidth: 2,
    height: 9,
    width: 9,
  },
  chevronDown: {
    transform: [{ rotate: "45deg" }],
  },
  chevronUp: {
    transform: [{ rotate: "-135deg" }],
  },
});
