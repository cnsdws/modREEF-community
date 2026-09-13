import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, TextInput, View,
} from "react-native";
import type { AquariumMember, AquariumRole, AuthorizationAuditEvent } from "@modreef/api-contract";
import {
  addDashboardAquariumMember,
  listDashboardAuthorizationAudit,
  listDashboardAquariumMembers,
  removeDashboardAquariumMember,
  resendDashboardAquariumInvitation,
  transferDashboardAquariumOwnership,
  updateDashboardAquariumMember,
} from "./dashboardConnection";

type AssignableRole = Exclude<AquariumRole, "owner">;
const assignableRoles: AssignableRole[] = ["view", "control", "program", "manage"];
const roleCopy: Record<AquariumRole, string> = {
  view: "Can look, but can't touch.",
  control: "Can view and control equipment from the dashboard.",
  program: "Can view, control, and change programming.",
  manage: "Can view, control, program, and manage users.",
  owner: "Owner of this aquarium.",
};

export function AquariumAuthorizationPanel({ aquariumId, currentRole }: {
  aquariumId: string;
  currentRole: AquariumRole;
}) {
  const [members, setMembers] = useState<AquariumMember[]>([]);
  const [audit, setAudit] = useState<AuthorizationAuditEvent[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<AssignableRole>("view");
  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = currentRole === "manage" || currentRole === "owner";

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, nextAudit] = await Promise.all([
        listDashboardAquariumMembers(aquariumId),
        canManage ? listDashboardAuthorizationAudit(aquariumId) : Promise.resolve([]),
      ]);
      setMembers(nextMembers);
      setAudit(nextAudit);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load authorization.");
    }
  }, [aquariumId, canManage]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addMember() {
    if (!email.trim()) return;
    setBusy("add");
    try {
      await addDashboardAquariumMember(aquariumId, email.trim(), newRole);
      setEmail("");
      setNewRole("view");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this user.");
    } finally {
      setBusy(null);
    }
  }

  async function updateMember(userId: string, update: {
    role?: AssignableRole; receiveAlarms?: boolean;
  }) {
    setBusy(userId);
    setRoleMenu(null);
    try {
      const updated = await updateDashboardAquariumMember(aquariumId, userId, update);
      setMembers((current) => current.map((member) => member.userId === userId ? updated : member));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update authorization.");
    } finally {
      setBusy(null);
    }
  }

  function confirmRemove(member: AquariumMember) {
    const message = member.pending
      ? `Cancel the invitation for ${member.email ?? "this user"}?`
      : `${member.email ?? "This user"} will lose access to this aquarium.`;
    const remove = () => {
      setBusy(member.userId);
      void removeDashboardAquariumMember(aquariumId, member.userId)
        .then(refresh)
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not remove this user."))
        .finally(() => setBusy(null));
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) remove();
      return;
    }
    Alert.alert(member.pending ? "Cancel invitation?" : "Remove user?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: remove },
    ]);
  }

  async function resendInvitation(member: AquariumMember) {
    setBusy(member.userId);
    try {
      const updated = await resendDashboardAquariumInvitation(aquariumId, member.userId);
      setMembers((current) => current.map((item) => item.userId === member.userId ? updated : item));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resend this invitation.");
    } finally {
      setBusy(null);
    }
  }

  async function shareInvitation(member: AquariumMember) {
    const url = `https://www.modreef.net/?invitation=${encodeURIComponent(aquariumId)}`;
    const message = `${member.email ?? "You"} has been invited to an aquarium in modREEF. Sign in using this email to accept: ${url}`;
    try {
      if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
        await globalThis.navigator.clipboard.writeText(message);
        globalThis.alert("Invitation copied");
      } else {
        await Share.share({ message, url });
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not share this invitation.");
    }
  }

  function confirmTransfer(member: AquariumMember) {
    const message = `${member.email ?? "This user"} will become the owner. Your access will change to Manage.`;
    const transfer = () => {
      setBusy(member.userId);
      void transferDashboardAquariumOwnership(aquariumId, member.userId)
        .then(setMembers)
        .then(refresh)
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not transfer ownership."))
        .finally(() => setBusy(null));
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) transfer();
      return;
    }
    Alert.alert("Transfer ownership?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Transfer", style: "destructive", onPress: transfer },
    ]);
  }

  function formatDate(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
  }

  return (
    <View>
      <Text style={styles.summary}>Access is assigned per aquarium. Alarm delivery is each user's choice.</Text>
      {members.length === 0 && !error ? <ActivityIndicator color="#20B7EC" /> : null}
      {members.map((member) => {
        const editableRole = canManage && member.role !== "owner" && !member.currentUser;
        const expired = member.pending && member.expiresAt
          ? new Date(member.expiresAt).getTime() <= Date.now()
          : false;
        return (
          <View key={member.userId} style={styles.memberCard}>
            <View style={styles.memberHeading}>
              <View style={styles.memberIdentity}>
                <Text style={styles.email}>{member.currentUser ? "You" : member.email ?? "modREEF user"}</Text>
                {member.currentUser && member.email ? <Text style={styles.secondary}>{member.email}</Text> : null}
                {member.pending ? (
                  <Text style={styles.secondary}>
                    {expired ? "Invitation expired" : "Invitation pending"}
                    {formatDate(member.expiresAt) ? ` · ${expired ? "expired" : "expires"} ${formatDate(member.expiresAt)}` : ""}
                  </Text>
                ) : null}
              </View>
              {editableRole ? (
                <Pressable onPress={() => setRoleMenu((open) => open === member.userId ? null : member.userId)} style={styles.roleSelect}>
                  <Text style={styles.roleText}>{member.role}</Text><Text style={styles.triangle}>▾</Text>
                </Pressable>
              ) : <Text style={styles.roleBadge}>{member.role}</Text>}
            </View>
            {roleMenu === member.userId ? (
              <View style={styles.menu}>
                {assignableRoles.map((role) => (
                  <Pressable key={role} onPress={() => void updateMember(member.userId, { role })} style={styles.menuRow}>
                    <Text style={[styles.menuRole, role === member.role ? styles.selected : undefined]}>{role}</Text>
                    <Text style={styles.menuCopy}>{roleCopy[role]}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.roleCopy}>{roleCopy[member.role]}</Text>
            {member.currentUser ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: member.receiveAlarms }}
                disabled={busy === member.userId}
                onPress={() => void updateMember(member.userId, { receiveAlarms: !member.receiveAlarms })}
                style={styles.alarmRow}
              >
                <View style={[styles.switchTrack, member.receiveAlarms ? styles.switchTrackOn : undefined]}>
                  <View style={[styles.switchThumb, member.receiveAlarms ? styles.switchThumbOn : undefined]} />
                </View>
                <Text style={styles.alarmText}>Receive alarms for this aquarium</Text>
              </Pressable>
            ) : null}
            {editableRole ? (
              <View style={styles.memberActions}>
                {member.pending ? (
                  <>
                    <Pressable disabled={busy === member.userId} onPress={() => void resendInvitation(member)}>
                      <Text style={styles.secondaryAction}>Resend invitation</Text>
                    </Pressable>
                    <Pressable disabled={busy === member.userId} onPress={() => void shareInvitation(member)}>
                      <Text style={styles.secondaryAction}>Share invitation</Text>
                    </Pressable>
                  </>
                ) : null}
                {currentRole === "owner" && member.role === "manage" && !member.pending ? (
                  <Pressable disabled={busy === member.userId} onPress={() => confirmTransfer(member)}>
                    <Text style={styles.secondaryAction}>Transfer ownership</Text>
                  </Pressable>
                ) : null}
                <Pressable disabled={busy === member.userId} onPress={() => confirmRemove(member)}>
                  <Text style={styles.remove}>{busy === member.userId ? "Working…" : member.pending ? "Cancel invitation" : "Remove access"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      {canManage ? (
        <View style={styles.addCard}>
          <Text style={styles.addTitle}>Add user</Text>
          <TextInput
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
            onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#71869F"
            style={styles.input} value={email}
          />
          <Pressable onPress={() => setRoleMenu((open) => open === "new" ? null : "new")} style={styles.newRoleSelect}>
            <Text style={styles.roleText}>{newRole}</Text><Text style={styles.triangle}>▾</Text>
          </Pressable>
          {roleMenu === "new" ? (
            <View style={styles.menu}>
              {assignableRoles.map((role) => (
                <Pressable key={role} onPress={() => { setNewRole(role); setRoleMenu(null); }} style={styles.menuRow}>
                  <Text style={[styles.menuRole, role === newRole ? styles.selected : undefined]}>{role}</Text>
                  <Text style={styles.menuCopy}>{roleCopy[role]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable disabled={busy !== null || !email.trim()} onPress={() => void addMember()} style={[styles.addButton, busy !== null || !email.trim() ? styles.disabled : undefined]}>
            <Text style={styles.addButtonText}>{busy === "add" ? "Adding…" : "Add user"}</Text>
          </Pressable>
          <Text style={styles.hint}>The invitation is valid for 7 days. Access activates when they sign in with this email.</Text>
        </View>
      ) : null}
      {canManage ? (
        <View style={styles.auditCard}>
          <Pressable onPress={() => setAuditOpen((open) => !open)} style={styles.auditHeading}>
            <Text style={styles.addTitle}>Authorization history</Text>
            <Text style={styles.triangle}>{auditOpen ? "▴" : "▾"}</Text>
          </Pressable>
          {auditOpen ? audit.map((event) => (
            <View key={event.id} style={styles.auditRow}>
              <Text style={styles.auditAction}>{event.action.replaceAll(".", " · ").replaceAll("-", " ")}</Text>
              <Text style={styles.secondary}>{event.targetEmail ?? "Unknown user"} · {formatDate(event.occurredAt)}</Text>
              <Text style={styles.secondary}>By {event.actorEmail ?? "system"}</Text>
            </View>
          )) : null}
          {auditOpen && audit.length === 0 ? <Text style={styles.hint}>No authorization changes recorded yet.</Text> : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { color: "#8FA4BF", fontSize: 13, lineHeight: 19, marginBottom: 12 },
  memberCard: { backgroundColor: "#061D34", borderColor: "#234968", borderRadius: 11, borderWidth: 1, marginBottom: 9, padding: 12 },
  memberHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  memberIdentity: { flex: 1, marginRight: 10 },
  email: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  secondary: { color: "#8FA4BF", fontSize: 11, marginTop: 2 },
  roleBadge: { color: "#20B7EC", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  roleSelect: { alignItems: "center", borderColor: "#20B7EC", borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  newRoleSelect: { alignItems: "center", borderColor: "#234968", borderRadius: 8, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 8, padding: 11 },
  roleText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  triangle: { color: "#FFFFFF", fontSize: 11 },
  roleCopy: { color: "#8FA4BF", fontSize: 12, lineHeight: 17, marginTop: 8 },
  menu: { backgroundColor: "#0A2038", borderColor: "#2A5577", borderRadius: 9, borderWidth: 1, marginTop: 8, overflow: "hidden" },
  menuRow: { borderBottomColor: "#153E63", borderBottomWidth: 1, padding: 10 },
  menuRole: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  menuCopy: { color: "#8FA4BF", fontSize: 11, marginTop: 2 },
  selected: { color: "#20B7EC" },
  alarmRow: { alignItems: "center", flexDirection: "row", marginTop: 12 },
  switchTrack: { backgroundColor: "#40536A", borderRadius: 12, height: 22, padding: 2, width: 40 },
  switchTrackOn: { backgroundColor: "#1582B5" },
  switchThumb: { backgroundColor: "#FFFFFF", borderRadius: 9, height: 18, width: 18 },
  switchThumbOn: { alignSelf: "flex-end" },
  alarmText: { color: "#D7E2EE", fontSize: 12, marginLeft: 9 },
  remove: { color: "#FCA5A5", fontSize: 12, fontWeight: "800", marginTop: 12 },
  memberActions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 12 },
  secondaryAction: { color: "#20B7EC", fontSize: 12, fontWeight: "800", marginTop: 12 },
  addCard: { borderTopColor: "#153E63", borderTopWidth: 1, marginTop: 8, paddingTop: 14 },
  addTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  input: { backgroundColor: "#061D34", borderColor: "#234968", borderRadius: 8, borderWidth: 1, color: "#FFFFFF", marginTop: 9, padding: 11 },
  addButton: { alignItems: "center", backgroundColor: "#126D9B", borderRadius: 8, marginTop: 10, padding: 11 },
  addButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  hint: { color: "#71869F", fontSize: 11, marginTop: 7 },
  auditCard: { borderTopColor: "#153E63", borderTopWidth: 1, marginTop: 16, paddingTop: 14 },
  auditHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  auditRow: { borderBottomColor: "#153E63", borderBottomWidth: 1, paddingVertical: 10 },
  auditAction: { color: "#D7E2EE", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  error: { color: "#FCA5A5", fontSize: 12, marginTop: 9 },
});
