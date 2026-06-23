import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth.service';
import { dashboardService, MyDayStats } from '../../services/dashboard.service';
import { notificationsService } from '../../services/notifications.service';
import { offlineService } from '../../services/offline.service';
import { can, currentRole, grantedPermissions, hasFullAccess } from '../../config/permissions';
import { environment } from '../../config/environment';
import { formatHm } from '../../utils/duration';

/** Friendly names for the features a permission set can grant — drives the
 *  "what you can access" summary. Keys are permission-catalog feature prefixes. */
const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  'work-orders': 'Work Orders',
  'production-orders': 'Production Orders',
  kanban: 'Production Board',
  'time-tracking': 'Time Tracking',
  materials: 'Materials',
  shipping: 'Shipping',
  costing: 'Costing',
  'quality-reports': 'QC Reports',
  'quality-analysis': 'Quality Inspection',
  scheduling: 'Scheduling',
  workforce: 'Workforce',
  equipment: 'Equipment',
  stations: 'Stations',
  traceability: 'Traceability',
  coordination: 'Coordination',
  reports: 'Reports',
  templates: 'Templates',
  users: 'Users',
  roles: 'Roles',
  audit: 'Audit Log',
  support: 'Support',
  company: 'Company',
  processes: 'Processes',
};

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Friendly label for a permission feature key, falling back to a humanized
 *  form so a feature added to the catalog later is never silently dropped. */
function featureLabel(feat: string): string {
  return FEATURE_LABELS[feat] || feat.split('-').map(titleCase).join(' ');
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState<MyDayStats | null>(null);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(offlineService.isOnline);

  // Edit-profile + change-password are gated on `users.update` — the only
  // self-service path the backend exposes (managers/admins). Operators get an
  // accurate read-only profile (the API has no operator self-edit).
  const canEdit = can('users.update');

  const [editVisible, setEditVisible] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', mobileNo: '', email: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [pwVisible, setPwVisible] = useState(false);
  const [pwForm, setPwForm] = useState({ next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  const loadData = useCallback(async () => {
    // Refresh the canonical profile (so identity fields are accurate, not the
    // lean login payload) + the personal "today" stats + unread count. Each
    // degrades independently.
    const [, dayRes, unreadRes] = await Promise.allSettled([
      authService.getProfile(),
      dashboardService.getMyDay(),
      notificationsService.unreadCount(),
    ]);
    if (dayRes.status === 'fulfilled') setToday(dayRes.value);
    if (unreadRes.status === 'fulfilled') setUnread(unreadRes.value?.count ?? 0);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => offlineService.subscribeOnline(setOnline), []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Access summary ──
  const accessFeatures = useMemo(() => {
    if (hasFullAccess()) return null; // sentinel → "All features"
    const feats = new Set<string>();
    for (const key of grantedPermissions()) {
      const feat = key.split('.')[0];
      if (feat) feats.add(feat);
    }
    return [...feats].map(featureLabel).sort();
  }, [user?.id]);

  const role = currentRole()?.name || user?.role?.name || 'operator';
  const initials =
    `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`.toUpperCase() || '?';
  const appVersion = Constants.expoConfig?.version || '—';
  const serverHost = environment.apiUrl.replace(/^https?:\/\//, '').replace(/\/api\/?$/, '');

  // ── Edit profile ──
  const openEdit = () => {
    setEditForm({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      mobileNo: user?.mobileNo || '',
      email: user?.email || '',
    });
    setEditVisible(true);
  };

  const saveEdit = async () => {
    const firstName = editForm.firstName.trim();
    const lastName = editForm.lastName.trim();
    if (!firstName || !lastName) {
      Alert.alert('Name required', 'First and last name cannot be empty.');
      return;
    }
    const patch: { firstName: string; lastName: string; mobileNo: string; email?: string } = {
      firstName,
      lastName,
      mobileNo: editForm.mobileNo.trim(),
    };
    const email = editForm.email.trim();
    if (email) patch.email = email; // omit when blank (API validates @IsEmail)
    setEditSaving(true);
    try {
      await authService.updateProfile(patch);
      setEditVisible(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Change password ──
  const openPassword = () => { setPwForm({ next: '', confirm: '' }); setPwVisible(true); };
  const closePassword = () => { setPwVisible(false); setPwForm({ next: '', confirm: '' }); };

  const savePassword = async () => {
    if (pwForm.next.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      Alert.alert('Passwords don’t match', 'Re-enter the same password in both fields.');
      return;
    }
    setPwSaving(true);
    try {
      await authService.changePassword(pwForm.next);
      setPwVisible(false);
      setPwForm({ next: '', confirm: '' });
      Alert.alert('Password changed', 'Your password has been updated. You’ll stay signed in on this device.');
    } catch (e: any) {
      Alert.alert('Could not change password', e?.message || 'Please try again.');
    } finally {
      setPwSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: logout },
    ]);
  };

  const goNotifications = () => navigation.navigate('More', { screen: 'Notifications', initial: false });
  const goStorage = () => navigation.navigate('More', { screen: 'Storage', initial: false });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* Identity header */}
      <View style={styles.headerWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
          <View style={[styles.presence, { backgroundColor: online ? Colors.success : Colors.medium }]} />
        </View>
        <Text style={styles.userName}>
          {user?.firstName} {user?.lastName}
        </Text>
        <View style={styles.roleRow}>
          <View style={styles.roleChip}>
            <Ionicons name="shield-checkmark" size={12} color={Colors.primary} />
            <Text style={styles.roleChipText}>{titleCase(role)}</Text>
          </View>
          {user && !user.isActive && (
            <View style={[styles.roleChip, styles.inactiveChip]}>
              <Text style={[styles.roleChipText, { color: Colors.danger }]}>Inactive</Text>
            </View>
          )}
        </View>
      </View>

      {/* Account details */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Account</Text>
        {canEdit && (
          <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
            <Ionicons name="create-outline" size={16} color={Colors.primary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.card}>
        <InfoRow label="Employee ID" value={user?.employeeId || '—'} />
        <InfoRow label="Email" value={user?.email || '—'} />
        <InfoRow label="Mobile" value={user?.mobileNo || '—'} />
        <InfoRow label="Member since" value={fmtDate(user?.createdAt)} />
        <InfoRow label="Last sign-in" value={fmtDateTime(user?.lastLoginAt)} last />
      </View>

      {/* Access */}
      <Text style={styles.sectionTitle}>Access</Text>
      <View style={styles.card}>
        <View style={styles.accessHead}>
          <Ionicons name="key" size={16} color={Colors.tertiary} />
          <Text style={styles.accessRole}>{titleCase(role)}</Text>
        </View>
        {accessFeatures === null ? (
          <Text style={styles.accessAll}>Full access — all features</Text>
        ) : accessFeatures.length === 0 ? (
          <Text style={styles.accessAll}>No feature access granted</Text>
        ) : (
          <View style={styles.chipWrap}>
            {accessFeatures.map((f) => (
              <View key={f} style={styles.featChip}>
                <Text style={styles.featChipText}>{f}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* My activity today (server-computed) */}
      <Text style={styles.sectionTitle}>Today</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{formatHm(today?.trackedSeconds ?? 0)}</Text>
          <Text style={styles.statLabel}>Time Logged</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{today?.entriesCompleted ?? 0}</Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{today?.workOrdersWorked ?? 0}</Text>
          <Text style={styles.statLabel}>Work Orders</Text>
        </View>
      </View>

      {/* Settings */}
      <Text style={styles.sectionTitle}>Settings</Text>
      <View style={styles.card}>
        <NavRow icon="notifications-outline" label="Notifications" onPress={goNotifications} badge={unread} />
        <NavRow icon="cube-outline" label="Offline 3D models" onPress={goStorage} last />
      </View>

      {/* Security */}
      {canEdit && (
        <>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.card}>
            <NavRow icon="lock-closed-outline" label="Change password" onPress={openPassword} last />
          </View>
        </>
      )}

      {/* About */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <InfoRow label="App version" value={appVersion} />
        <InfoRow label="Server" value={serverHost} />
        <View style={styles.infoRowLast}>
          <Text style={styles.infoLabel}>Connection</Text>
          <View style={styles.connRow}>
            <View style={[styles.connDot, { backgroundColor: online ? Colors.success : Colors.medium }]} />
            <Text style={[styles.infoValue, { color: online ? Colors.success : Colors.medium }]}>
              {online ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color={Colors.white} />
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      {/* ── Edit profile modal ── */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Edit profile</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Field label="First name" value={editForm.firstName} onChangeText={(t) => setEditForm((s) => ({ ...s, firstName: t }))} />
            <Field label="Last name" value={editForm.lastName} onChangeText={(t) => setEditForm((s) => ({ ...s, lastName: t }))} />
            <Field label="Mobile" value={editForm.mobileNo} onChangeText={(t) => setEditForm((s) => ({ ...s, mobileNo: t }))} keyboardType="phone-pad" />
            <Field label="Email" value={editForm.email} onChangeText={(t) => setEditForm((s) => ({ ...s, email: t }))} keyboardType="email-address" autoCapitalize="none" />
            <TouchableOpacity style={[styles.modalSave, editSaving && styles.modalSaveDisabled]} onPress={saveEdit} disabled={editSaving}>
              {editSaving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.modalSaveText}>Save changes</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Change password modal ── */}
      <Modal visible={pwVisible} transparent animationType="slide" onRequestClose={closePassword}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Change password</Text>
              <TouchableOpacity onPress={closePassword} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Field label="New password" value={pwForm.next} onChangeText={(t) => setPwForm((s) => ({ ...s, next: t }))} secureTextEntry autoCapitalize="none" />
            <Field label="Confirm password" value={pwForm.confirm} onChangeText={(t) => setPwForm((s) => ({ ...s, confirm: t }))} secureTextEntry autoCapitalize="none" />
            <Text style={styles.pwHint}>At least 6 characters.</Text>
            <TouchableOpacity style={[styles.modalSave, pwSaving && styles.modalSaveDisabled]} onPress={savePassword} disabled={pwSaving}>
              {pwSaving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.modalSaveText}>Update password</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={last ? styles.infoRowLast : styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function NavRow({
  icon, label, onPress, badge, last,
}: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; badge?: number; last?: boolean }) {
  return (
    <TouchableOpacity style={last ? styles.navRowLast : styles.navRow} onPress={onPress}>
      <Ionicons name={icon} size={20} color={Colors.text} style={{ marginRight: 12 }} />
      <Text style={styles.navLabel}>{label}</Text>
      {!!badge && badge > 0 && (
        <View style={styles.navBadge}><Text style={styles.navBadgeText}>{badge > 99 ? '99+' : badge}</Text></View>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.medium} />
    </TouchableOpacity>
  );
}

function Field({
  label, ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.fieldInput} placeholderTextColor={Colors.medium} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingTop: 60, paddingBottom: 32 },
  // ── Header ──
  headerWrap: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  avatarText: { color: Colors.white, fontSize: 28, fontWeight: '700' },
  presence: {
    position: 'absolute', bottom: 2, right: 2, width: 18, height: 18, borderRadius: 9,
    borderWidth: 3, borderColor: Colors.background,
  },
  userName: { fontSize: 22, fontWeight: '700', color: Colors.text },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e3f2fd',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  roleChipText: { fontSize: 12.5, fontWeight: '700', color: Colors.primary },
  inactiveChip: { backgroundColor: '#fdecea' },
  // ── Sections ──
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  // ── Card ──
  card: {
    backgroundColor: Colors.white, borderRadius: 10, padding: 16, marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 16,
  },
  infoRowLast: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, gap: 16 },
  infoLabel: { fontSize: 14, color: Colors.textSecondary },
  infoValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '500', color: Colors.text },
  // ── Access ──
  accessHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  accessRole: { fontSize: 14, fontWeight: '700', color: Colors.text },
  accessAll: { fontSize: 13.5, color: Colors.textSecondary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featChip: { backgroundColor: Colors.light, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  featChipText: { fontSize: 12.5, color: Colors.text, fontWeight: '500' },
  // ── Today ──
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: Colors.white, borderRadius: 10, padding: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  statValue: { fontSize: 18, fontWeight: '700', color: Colors.primary, marginBottom: 4 },
  statLabel: { fontSize: 12, color: Colors.textSecondary },
  // ── Nav rows ──
  navRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  navRowLast: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  navLabel: { flex: 1, fontSize: 15, color: Colors.text },
  navBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: Colors.danger,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  navBadgeText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  // ── Connection ──
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  // ── Logout ──
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, backgroundColor: Colors.danger, borderRadius: 10,
  },
  logoutText: { color: Colors.white, fontSize: 16, fontWeight: '600' },
  // ── Modals ──
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 32 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  fieldInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.white,
  },
  pwHint: { fontSize: 12, color: Colors.textSecondary, marginTop: -4, marginBottom: 8 },
  modalSave: { height: 50, backgroundColor: Colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  modalSaveDisabled: { opacity: 0.6 },
  modalSaveText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
