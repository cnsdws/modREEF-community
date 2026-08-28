import { useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  communityControllerImagerUrl,
  communityControllerRelease,
} from "./communityControllerRelease";

export function CommunityControllerDownload() {
  const [launchError, setLaunchError] = useState(false);

  async function open(url: string, imager = false) {
    try {
      setLaunchError(false);
      await Linking.openURL(url);
    } catch {
      if (imager) setLaunchError(true);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Image
            accessibilityLabel="modREEF — Modular, Smart, Connected"
            resizeMode="contain"
            source={require("../assets/brand/modreef-wordmark-transparent.png")}
            style={styles.logo}
          />
          <Text style={styles.eyebrow}>COMMUNITY REEF CONTROLLER</Text>
          <Text style={styles.title}>Build your own modREEF controller</Text>
          <Text style={styles.summary}>
            Install the open-source controller on a Raspberry Pi 4 or Pi 5.
            Raspberry Pi Imager handles the device choice, Wi-Fi, account, and
            SD-card setup.
          </Text>

          <Pressable
            accessibilityRole="link"
            onPress={() => void open(communityControllerImagerUrl(), true)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open in Raspberry Pi Imager</Text>
          </Pressable>

          {launchError ? (
            <Text style={styles.notice}>
              Raspberry Pi Imager did not open. Install it below, then download
              and double-click the modREEF manifest.
            </Text>
          ) : null}

          <View style={styles.secondaryActions}>
            <Pressable
              accessibilityRole="link"
              onPress={() => void open(communityControllerRelease.imagerWindowsUrl)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Download Imager for Windows</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => void open(communityControllerRelease.imagerMacUrl)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Download Imager for macOS</Text>
            </Pressable>
          </View>
          <View style={styles.tertiaryActions}>
            <Pressable
              accessibilityRole="link"
              onPress={() => void open(communityControllerRelease.imagerUrl)}
            >
              <Text style={styles.tertiaryLink}>Linux and other Imager downloads</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => void open(communityControllerRelease.manifestUrl)}
            >
              <Text style={styles.tertiaryLink}>Download setup manifest</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.requirementsCard}>
          <Text style={styles.stepsTitle}>What you need</Text>
          <Text style={styles.requirement}>• Raspberry Pi 4 or Raspberry Pi 5 with its power supply</Text>
          <Text style={styles.requirement}>• Reliable 16 GB or larger microSD card</Text>
          <Text style={styles.requirement}>• Windows or Mac computer with an SD-card reader</Text>
          <Text style={styles.requirement}>• Aquarium Wi-Fi name and password</Text>
          <Text style={styles.requirement}>• modREEF tablet or phone app</Text>
        </View>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>Complete installation</Text>
          <Step number="1" title="Install Raspberry Pi Imager">
            Download the Windows or macOS installer above, run it, and open
            Raspberry Pi Imager.
          </Step>
          <Step number="2" title="Open the modREEF image">
            Return to this page and select Open in Raspberry Pi Imager. If the
            browser does not open Imager, download and double-click the setup
            manifest. Do not extract or manually select the .img.xz file.
          </Step>
          <Step number="3" title="Choose your Raspberry Pi">
            Select Pi 4 or Pi 5. Imager automatically selects modREEF Community
            Reef Controller as the compatible operating system.
          </Step>
          <Step number="4" title="Select the microSD card">
            Insert the card, select Choose Storage, and carefully choose that
            card. Writing the image erases everything currently on it.
          </Step>
          <Step number="5" title="Enter controller settings">
            Set a unique hostname, use admin as the username, and enter a unique
            password. Configure the aquarium Wi-Fi name, password, country,
            time zone, and keyboard layout. SSH is optional.
          </Step>
          <Step number="6" title="Write and verify">
            Review the selected Pi and storage device, then let Imager write and
            verify the card. Eject it safely when verification succeeds.
          </Step>
          <Step number="7" title="Boot the controller">
            Insert the card into the Pi and connect power. First boot typically
            takes three to five minutes while the controller applies settings
            and joins Wi-Fi.
          </Step>
          <Step number="8" title="Add it to an aquarium">
            Keep the tablet on the same network. In modREEF, choose Add Reef
            Controller, select the discovered controller, name it, and assign it
            to the intended aquarium. No QR code is required.
          </Step>
          <Step number="9" title="Confirm it is ready">
            Wait for the controller to report Ready and load its equipment.
            Future qualified controller updates install automatically.
          </Step>
        </View>

        <View style={styles.footerActions}>
          <Pressable
            accessibilityRole="link"
            onPress={() => void open(communityControllerRelease.imageUrl)}
          >
            <Text style={styles.footerLink}>Advanced: download image</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => void open(communityControllerRelease.sourceUrl)}
          >
            <Text style={styles.footerLink}>Source code · Apache-2.0</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => void open("https://www.modreef.net/")}
          >
            <Text style={styles.footerLink}>Return to modREEF</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDescription}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#061528", flex: 1 },
  content: {
    alignItems: "center",
    gap: 24,
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  hero: { alignItems: "center", maxWidth: 780, width: "100%" },
  logo: { height: 96, width: 300 },
  eyebrow: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 20,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "900",
    marginTop: 12,
    textAlign: "center",
  },
  summary: {
    color: "#C7D8EA",
    fontSize: 18,
    lineHeight: 28,
    marginTop: 16,
    maxWidth: 680,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#20B7EC",
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 28,
    minHeight: 56,
    paddingHorizontal: 26,
  },
  primaryButtonText: { color: "#061E42", fontSize: 17, fontWeight: "900" },
  notice: {
    color: "#FBBF24",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 16,
    maxWidth: 620,
    textAlign: "center",
  },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    marginTop: 16,
  },
  secondaryButton: {
    borderColor: "#31577F",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: "#7DD3FC", fontSize: 14, fontWeight: "800" },
  tertiaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 22,
    justifyContent: "center",
    marginTop: 14,
  },
  tertiaryLink: { color: "#AFC7DD", fontSize: 13, fontWeight: "700" },
  requirementsCard: {
    backgroundColor: "#081F3A",
    borderColor: "#31577F",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 780,
    padding: 26,
    width: "100%",
  },
  requirement: { color: "#C7D8EA", fontSize: 15, lineHeight: 24, marginTop: 8 },
  stepsCard: {
    backgroundColor: "#062B63",
    borderColor: "#20B7EC",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 780,
    padding: 26,
    width: "100%",
  },
  stepsTitle: { color: "#FFFFFF", fontSize: 23, fontWeight: "900" },
  step: { flexDirection: "row", gap: 16, marginTop: 22 },
  stepNumber: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  stepNumberText: { color: "#061E42", fontSize: 15, fontWeight: "900" },
  stepCopy: { flex: 1 },
  stepTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  stepDescription: { color: "#C7D8EA", fontSize: 14, lineHeight: 21, marginTop: 4 },
  footerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 22,
    justifyContent: "center",
    maxWidth: 780,
  },
  footerLink: { color: "#7DD3FC", fontSize: 14, fontWeight: "700" },
});
