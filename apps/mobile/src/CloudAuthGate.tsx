import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  ResponseType,
  useAuthRequest,
  useAutoDiscovery,
} from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRef } from "react";

import { authConfig } from "./authConfig";
import { requestPasswordReset } from "./passwordReset";
import { shouldLockAfterBackground } from "./biometricLock";
import { communityControllerRelease } from "./communityControllerRelease";
import {
  getCloudAccessToken,
  getCloudRefreshToken,
  clearCloudSession,
  setCloudAccessToken,
  setCloudRefreshToken,
  validateCloudAccessToken,
} from "./dashboardConnection";

WebBrowser.maybeCompleteAuthSession();

type AuthState = "checking" | "signed-out" | "locked" | "signed-in";

const biometricPreferenceKey = "modreef.auth.biometric-unlock";

interface CloudAuthContextValue {
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  biometricLabel: string;
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthContextValue | null>(null);

export function useCloudAuth(): CloudAuthContextValue | null {
  return useContext(CloudAuthContext);
}

export function CloudAuthGate({ children }: { children: ReactNode }) {
  const config = useMemo(() => authConfig(Platform.OS), []);
  const discovery = useAutoDiscovery(config.issuer);
  const redirectUri = makeRedirectUri({
    scheme: "modreef",
    path: "auth/callback",
  });
  const [state, setState] = useState<AuthState>("checking");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometric unlock");
  const backgroundedAt = useRef<number | null>(null);
  const stateRef = useRef<AuthState>("checking");
  const biometricEnabledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: config.clientId,
      extraParams: { audience: config.audience },
      redirectUri,
      responseType: ResponseType.Code,
      scopes: [
        "openid",
        "profile",
        "email",
        ...(Platform.OS === "web" ? [] : ["offline_access"]),
      ],
      usePKCE: true,
    },
    discovery,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  async function biometricCapability(): Promise<{
    available: boolean;
    label: string;
  }> {
    if (Platform.OS === "web") return { available: false, label: "Biometric unlock" };
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const facial = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const fingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    return {
      available: hardware && enrolled,
      label: facial ? "Face ID" : fingerprint ? "Fingerprint / Touch ID" : "Biometric unlock",
    };
  }

  async function authenticateBiometrically(): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      biometricsSecurityLevel: "strong",
      promptMessage: "Unlock modREEF",
      promptSubtitle: "Access your aquarium dashboard",
      fallbackLabel: "Use device passcode",
    });
    return result.success;
  }

  async function unlockRestoredSession(): Promise<void> {
    const capability = await biometricCapability();
    setBiometricAvailable(capability.available);
    setBiometricLabel(capability.label);
    const enabled = capability.available &&
      await SecureStore.getItemAsync(biometricPreferenceKey) === "true";
    setBiometricEnabledState(enabled);
    biometricEnabledRef.current = enabled;
    if (!enabled) {
      setState("signed-in");
      return;
    }
    setState(await authenticateBiometrically() ? "signed-in" : "locked");
  }

  useEffect(() => {
    if (Platform.OS === "web") return;
    void biometricCapability().then(async (capability) => {
      setBiometricAvailable(capability.available);
      setBiometricLabel(capability.label);
      const enabled = capability.available &&
        await SecureStore.getItemAsync(biometricPreferenceKey) === "true";
      biometricEnabledRef.current = enabled;
      setBiometricEnabledState(enabled);
    });
  }, []);

  useEffect(() => {
    async function restoreSession() {
      const token = await getCloudAccessToken();
      if (token && await validateCloudAccessToken()) {
        await unlockRestoredSession();
        return;
      }

      const refreshToken = await getCloudRefreshToken();
      if (!refreshToken || !discovery) {
        setState(discovery ? "signed-out" : "checking");
        return;
      }

      try {
        const refreshed = await refreshAsync(
          { clientId: config.clientId, refreshToken },
          discovery,
        );
        if (!refreshed.accessToken) throw new Error("Auth0 returned no access token");
        await setCloudAccessToken(refreshed.accessToken);
        if (refreshed.refreshToken) {
          await setCloudRefreshToken(refreshed.refreshToken);
        }
        await unlockRestoredSession();
      } catch {
        await clearCloudSession();
        setState("signed-out");
      }
    }

    void restoreSession();
  }, [config.clientId, discovery]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (nextState !== "active") return;
      const shouldLock = biometricEnabledRef.current &&
        stateRef.current === "signed-in" &&
        shouldLockAfterBackground(backgroundedAt.current, Date.now());
      backgroundedAt.current = null;
      if (!shouldLock) return;
      setState("locked");
      void authenticateBiometrically().then((success) => {
        if (success) setState("signed-in");
      });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (response?.type !== "success" || !discovery || !request?.codeVerifier) {
      if (response?.type === "error") {
        setError(response.error?.message ?? "Auth0 sign-in failed");
        setState("signed-out");
      }
      return;
    }

    const authorizationCode = response.params.code ?? "";
    if (!authorizationCode) {
      setError("Auth0 returned no authorization code");
      setState("signed-out");
      return;
    }
    const codeVerifier = request.codeVerifier ?? "";
    const tokenDiscovery = discovery;
    let cancelled = false;
    async function finishSignIn() {
      try {
        setError(null);
        setState("checking");
        const token = await exchangeCodeAsync(
          {
            clientId: config.clientId,
            code: authorizationCode,
            extraParams: { code_verifier: codeVerifier },
            redirectUri,
          },
          tokenDiscovery,
        );
        if (!token.accessToken) throw new Error("Auth0 returned no access token");
        await setCloudAccessToken(token.accessToken);
        if (token.refreshToken) await setCloudRefreshToken(token.refreshToken);
        if (!cancelled) setState("signed-in");
      } catch (caught) {
        await clearCloudSession();
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Auth0 sign-in failed");
          setState("signed-out");
        }
      }
    }

    void finishSignIn();
    return () => {
      cancelled = true;
    };
  }, [config.clientId, discovery, redirectUri, request, response]);

  const validResetEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    resetEmail.trim(),
  );

  async function sendPasswordReset() {
    if (!validResetEmail) {
      return;
    }

    setResetBusy(true);
    setError(null);

    try {
      await requestPasswordReset(
        {
          clientId: config.clientId,
          connection: config.databaseConnection,
          domain: config.domain,
        },
        resetEmail,
      );
      setResetSent(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Password reset is temporarily unavailable.",
      );
    } finally {
      setResetBusy(false);
    }
  }

  function closePasswordReset() {
    setResetOpen(false);
    setResetEmail("");
    setResetSent(false);
    setError(null);
  }

  function createAccount() {
    if (!request?.url) {
      return;
    }

    const signupUrl = new URL(request.url);
    signupUrl.searchParams.set("screen_hint", "signup");
    void promptAsync({ url: signupUrl.toString() });
  }

  function signIn() {
    if (!request?.url) {
      return;
    }

    const signInUrl = new URL(request.url);
    signInUrl.searchParams.set("prompt", "login");
    void promptAsync({ url: signInUrl.toString() });
  }

  const signOut = useCallback(async () => {
    setState("checking");
    setError(null);
    await clearCloudSession();
    setState("signed-out");
  }, []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      await SecureStore.deleteItemAsync(biometricPreferenceKey);
      biometricEnabledRef.current = false;
      setBiometricEnabledState(false);
      return true;
    }
    const capability = await biometricCapability();
    setBiometricAvailable(capability.available);
    setBiometricLabel(capability.label);
    if (!capability.available || !await authenticateBiometrically()) return false;
    await SecureStore.setItemAsync(biometricPreferenceKey, "true");
    biometricEnabledRef.current = true;
    setBiometricEnabledState(true);
    return true;
  }, []);

  if (state === "checking") {
    return (
      <SafeAreaView
        accessibilityLabel="Restoring your modREEF session"
        style={styles.screen}
      >
        <ActivityIndicator color="#20B7EC" size="large" />
      </SafeAreaView>
    );
  }

  if (state === "signed-in") {
    return (
      <CloudAuthContext.Provider value={{
        biometricAvailable,
        biometricEnabled,
        biometricLabel,
        setBiometricEnabled,
        signOut,
      }}>
        {children}
      </CloudAuthContext.Provider>
    );
  }

  if (state === "locked") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.card}>
          <Image
            accessibilityLabel="modREEF"
            resizeMode="contain"
            source={require("../assets/brand/modreef-logo.png")}
            style={styles.logo}
          />
          <Text style={styles.lockCopy}>modREEF is locked.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void authenticateBiometrically().then((success) => {
              if (success) setState("signed-in");
            })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Unlock with {biometricLabel}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.linkButton}>
            <Text style={styles.linkText}>Sign in with another account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {resetOpen ? (
          <View style={styles.resetPanel}>
            <Text style={styles.resetTitle}>Reset your password</Text>
            {resetSent ? (
              <>
                <Text style={styles.resetCopy}>
                  If an account uses that email address, Auth0 has sent a
                  password-reset link. Check your inbox and spam folder.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={closePasswordReset}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Back to sign in</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.resetCopy}>
                  Enter the email address used for your modREEF account.
                </Text>
                <TextInput
                  accessibilityLabel="Account email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  editable={!resetBusy}
                  inputMode="email"
                  keyboardType="email-address"
                  onChangeText={setResetEmail}
                  onSubmitEditing={() => void sendPasswordReset()}
                  placeholder="you@example.com"
                  placeholderTextColor="#7890AC"
                  returnKeyType="send"
                  style={styles.emailInput}
                  value={resetEmail}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!validResetEmail || resetBusy}
                  onPress={() => void sendPasswordReset()}
                  style={[
                    styles.button,
                    !validResetEmail || resetBusy
                      ? styles.disabled
                      : null,
                  ]}
                >
                  {resetBusy ? (
                    <ActivityIndicator color="#062B63" />
                  ) : (
                    <Text style={styles.buttonText}>Email reset link</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={resetBusy}
                  onPress={closePasswordReset}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Back to sign in</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={!request}
              onPress={signIn}
              style={[styles.button, !request ? styles.disabled : null]}
            >
              <Text style={styles.buttonText}>Sign in</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!request}
              onPress={createAccount}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Create account</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setResetOpen(true);
                setError(null);
              }}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Forgot password?</Text>
            </Pressable>
            {Platform.OS === "web" ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(
                  communityControllerRelease.downloadPageUrl,
                )}
                style={styles.communityLinkButton}
              >
                <Text style={styles.communityLinkText}>
                  Build a community Reef Controller
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
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
  logo: {
    alignSelf: "center",
    height: 201,
    marginBottom: 20,
    width: 220,
  },
  error: { color: "#FDA4AF", fontSize: 14, marginTop: 16 },
  button: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 12,
    marginTop: 24,
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  disabled: { opacity: 0.55 },
  buttonText: { color: "#062B63", fontSize: 16, fontWeight: "800" },
  emailInput: {
    backgroundColor: "#061528",
    borderColor: "#20B7EC",
    borderRadius: 12,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 16,
    marginTop: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  linkButton: {
    alignItems: "center",
    marginTop: 14,
    padding: 8,
  },
  linkText: { color: "#7DD3FC", fontSize: 14, fontWeight: "700" },
  communityLinkButton: {
    alignItems: "center",
    borderTopColor: "#31577F",
    borderTopWidth: 1,
    marginTop: 18,
    paddingTop: 20,
  },
  communityLinkText: { color: "#20B7EC", fontSize: 14, fontWeight: "800" },
  lockCopy: { color: "#F5F8FC", fontSize: 15, textAlign: "center" },
  resetCopy: { color: "#F5F8FC", fontSize: 14, lineHeight: 21, marginTop: 8 },
  resetPanel: { marginTop: 20 },
  resetTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
});
