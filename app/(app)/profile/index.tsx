import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm';
import { LEGAL_DOCS } from '../../../lib/mock/legal';
import { useAuth } from '../../../lib/store';
import { signOutEverywhere } from '../../../lib/auth';
import { colors, spacing, insetTop, insetBottom } from '../../../lib/theme';
import { navShrinkOnScroll } from '../../../lib/navShrink';

const chevron = (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function Profile() {
  const router = useRouter();
  const {
    name,
    email,
    currency,
    setCurrency,
    mode,
    setMode,
    creatorStatus,
  } = useAuth();
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const initial = (name || 'Y').charAt(0).toUpperCase();

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Pressable onPress={() => setCurrency(currency === 'USD' ? 'XCD' : 'USD')} style={styles.currencyPill}>
          <Text style={styles.currencyLabel}>{currency}</Text>
          <Svg width={9} height={6} viewBox="0 0 9 6" fill="none">
            <Path d="M1 1l3.5 3.5L8 1" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Mode toggle */}
        <View style={styles.modeTrack}>
          {(['client', 'creator'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                // Creator mode is status-gated: only approved creators
                // actually switch; applicants land on the right step of
                // their journey and the toggle stays on Client.
                if (m === 'creator') {
                  // Only approved creators switch modes — every other status
                  // routes to its status screen and the toggle stays put.
                  if (creatorStatus === 'approved') {
                    setMode(m);
                    router.push('/creator');
                  } else {
                    router.push('/creator');
                  }
                  return;
                }
                setMode(m);
              }}
              style={[styles.modeSeg, mode === m && styles.modeSegActive]}
            >
              <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>
                {m === 'client' ? 'Client' : 'Creator'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Edit profile card */}
        <Pressable onPress={() => router.push('/profile/edit')} style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName}>{name || 'You'}</Text>
            <Text style={styles.userEmail}>{email}</Text>
            <Text style={styles.editLink}>Edit profile</Text>
          </View>
          {chevron}
        </Pressable>

        {/* Creator journey entry — one card per status, branching off the
            single server-side value. */}
        {creatorStatus === 'not_applied' && (
          <Pressable onPress={() => router.push('/creator/apply')} style={styles.becomeCard}>
            <View style={styles.becomeIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="M4 8a2 2 0 012-2h1.5l1-1.5h5l1 1.5H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" stroke={colors.ink} strokeWidth={1.9} strokeLinejoin="round" />
                <Circle cx="12" cy="12.5" r="3.4" stroke={colors.ink} strokeWidth={1.9} />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.becomeTitle}>Become a Creator</Text>
              <Text style={styles.becomeSub}>Earn doing what you love — shoot & edit on Snapt.</Text>
            </View>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke={colors.yellow} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}
        {creatorStatus === 'in_progress' && (
          <Pressable onPress={() => router.push('/creator/apply')} style={styles.reviewCard}>
            <View style={styles.reviewIcon}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path d="M4 20v-3L15.5 5.5a2.1 2.1 0 013 3L7 20H4z" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinejoin="round" />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reviewTitle}>Finish your creator application</Text>
              <Text style={styles.reviewSub}>Your progress is saved — pick up where you left off.</Text>
            </View>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}
        {creatorStatus === 'pending_review' && (
          <Pressable onPress={() => router.push('/creator/pending')} style={styles.reviewCard}>
            <View style={styles.reviewIcon}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
                <Path d="M12 7.5V12l3 2" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reviewTitle}>Application under review</Text>
              <Text style={styles.reviewSub}>Tap for status, timelines, and support.</Text>
            </View>
          </Pressable>
        )}
        {creatorStatus === 'rejected' && (
          <Pressable onPress={() => router.push('/creator/rejected')} style={[styles.reviewCard, { backgroundColor: '#FDECEA', borderColor: '#F6D5D2' }]}>
            <View style={[styles.reviewIcon, { backgroundColor: '#FBE0DD' }]}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke="#B0392B" strokeWidth={1.8} />
                <Path d="M9 9l6 6M15 9l-6 6" stroke="#B0392B" strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.reviewTitle, { color: '#B0392B' }]}>Application not approved</Text>
              <Text style={[styles.reviewSub, { color: '#A04A3F' }]}>See why, and how to reapply.</Text>
            </View>
          </Pressable>
        )}
        {creatorStatus === 'suspended' && (
          <Pressable onPress={() => router.push('/creator/suspended')} style={[styles.reviewCard, { backgroundColor: '#F1EEE7', borderColor: '#E0DCD2' }]}>
            <View style={[styles.reviewIcon, { backgroundColor: '#E7E3DA' }]}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="#767676" strokeWidth={1.8} />
                <Path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" stroke="#767676" strokeWidth={1.8} />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.reviewTitle, { color: '#3D3A34' }]}>Creator account suspended</Text>
              <Text style={[styles.reviewSub, { color: '#767676' }]}>Creator mode is locked — tap for details.</Text>
            </View>
          </Pressable>
        )}

        {/* Ratings row */}
        <Pressable onPress={() => router.push('/profile/ratings')} style={styles.ratingsCard}>
          <View style={styles.ratingsIcon}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill={colors.yellow}>
              <Path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
            </Svg>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.ratingsTitle}>Your ratings</Text>
            <Text style={styles.ratingsSub}>4.9 · how creators rate you</Text>
          </View>
          {chevron}
        </Pressable>

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.list}>
          <ListRow
            label="Currency"
            detail={currency}
            onPress={() => setCurrency(currency === 'USD' ? 'XCD' : 'USD')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke={colors.grey} strokeWidth={1.8} />
                <Path d="M9.5 9.5a2.5 2.5 0 012.5-1.5c1.4 0 2 .8 2 1.6 0 2-3.8 1.4-3.8 3.4 0 .9.8 1.6 2 1.6a2.5 2.5 0 002.4-1.5M12 6.5v11" stroke={colors.grey} strokeWidth={1.6} strokeLinecap="round" />
              </Svg>
            }
          />
          <ListRow
            label="Payment methods"
            onPress={() => router.push('/(app)/wallet')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Rect x="3" y="6" width="18" height="12.5" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                <Path d="M3 10h18" stroke={colors.grey} strokeWidth={1.8} />
              </Svg>
            }
          />
          {creatorStatus === 'approved' && (
            <ListRow
              label="Specialties"
              onPress={() => router.push('/creator/specialties')}
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l2.6 5.6 6.1.5-4.6 4 1.4 6-5.5-3.2-5.5 3.2 1.4-6-4.6-4 6.1-.5z" stroke={colors.grey} strokeWidth={1.7} strokeLinejoin="round" />
                </Svg>
              }
            />
          )}
          {creatorStatus === 'approved' && (
            <ListRow
              label="Portfolio"
              onPress={() => router.push('/creator/portfolio')}
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke={colors.grey} strokeWidth={1.8} />
                  <Path d="M3.5 15.5l4.5-4 4 3.5 3-2.5 5.5 4.5" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                  <Circle cx="9.5" cy="9" r="1.4" fill={colors.grey} />
                </Svg>
              }
            />
          )}
          <ListRow
            label="Emergency contacts"
            onPress={() => router.push('/profile/emergency')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                <Path d="M12 9.5v3M12 15.5h.01" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            }
          />
          <ListRow
            label="Notification settings"
            onPress={() => router.push('/profile/notifications')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                <Path d="M10 19a2 2 0 004 0" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            }
          />
          <ListRow
            label="Help & support"
            last
            onPress={() => router.push('/help')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke={colors.grey} strokeWidth={1.8} />
                <Path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.7-2.5 1.9-2.5 3.4M12 17.2h.01" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            }
          />
        </View>

        {/* Legal */}
        <Text style={styles.sectionLabel}>Legal</Text>
        <View style={styles.list}>
          {LEGAL_DOCS.map((d) => (
            <ListRow
              key={d.slug}
              label={d.title}
              onPress={() => router.push(`/legal/${d.slug}`)}
              icon={
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M7 3.5h7L19 8v12.5a1 1 0 01-1 1H7a1 1 0 01-1-1v-16a1 1 0 011-1z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d="M13.5 3.5V8H19M9 12.5h6M9 16h4" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
              }
            />
          ))}
          <ListRow
            label="About Snapt"
            detail="v0.1.0"
            last
            onPress={() => router.push('/about')}
            icon={
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke={colors.grey} strokeWidth={1.8} />
                <Path d="M12 11v5M12 8h.01" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            }
          />
        </View>

        <Pressable
          onPress={() => {
            signOutEverywhere();
            router.replace('/(auth)/welcome');
          }}
        >
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
        <Pressable onPress={() => setDeleteOpen(true)}>
          <Text style={styles.deleteLink}>Delete account</Text>
        </Pressable>
        <View style={{ height: 130 }} />
      </ScrollView>

      {/* Delete confirmation — slide-to-confirm (destructive) */}
      <Modal visible={deleteOpen} transparent animationType="slide" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setDeleteOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.deleteIcon}>
              <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                <Path d="M6 7.5h12M9.5 7.5V6a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 6v1.5M8 7.5l.7 11a1.5 1.5 0 001.5 1.4h3.6a1.5 1.5 0 001.5-1.4l.7-11" stroke="#D64535" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.deleteTitle}>Delete your account?</Text>
            <Text style={styles.deleteSub}>
              This permanently removes your profile, bookings, messages, and history. This can't be
              undone.
            </Text>
            <View style={{ marginTop: 18 }}>
              <SlideToConfirm
                label="Slide to delete account"
                onConfirm={() => {
                  setDeleteOpen(false);
                  // Phase 0: signs out only. Real account deletion is a
                  // server-side job (auth user + cascade) — Phase 3.
                  signOutEverywhere();
                  router.replace('/(auth)/welcome');
                }}
              />
            </View>
            <Pressable onPress={() => setDeleteOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ListRow({
  label,
  detail,
  icon,
  onPress,
  last,
}: {
  label: string;
  detail?: string;
  icon: React.ReactNode;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.listRow, !last && styles.listRowBorder]}>
      {icon}
      <Text style={styles.listLabel}>{label}</Text>
      {detail && <Text style={styles.listDetail}>{detail}</Text>}
      {chevron}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  header: {
    paddingTop: insetTop + 19,
    paddingHorizontal: 22,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  currencyPill: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: '#F1EEE7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  currencyLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 12 },
  modeTrack: { flexDirection: 'row', gap: 6, backgroundColor: '#F1EEE7', borderRadius: 14, padding: 4, marginBottom: 18 },
  modeSeg: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeSegActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeLabel: { fontSize: 13.5, fontWeight: '600', color: colors.grey },
  modeLabelActive: { color: colors.ink, fontWeight: '800' },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 17,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 23, fontWeight: '800', color: '#8A7530' },
  userName: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  userEmail: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  editLink: { fontSize: 12, fontWeight: '700', color: colors.yellowDark, marginTop: 6 },
  becomeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    backgroundColor: colors.ink,
    borderRadius: 18,
    padding: 20,
    marginTop: 16,
  },
  becomeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  becomeTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.2, color: '#fff' },
  becomeSub: { fontSize: 12.5, color: 'rgba(255,255,255,0.62)', marginTop: 3, lineHeight: 17 },
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 18,
    padding: 18,
    marginTop: 16,
  },
  reviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  reviewSub: { fontSize: 12.5, color: '#8A7530', marginTop: 2, lineHeight: 17 },
  ratingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    paddingHorizontal: 18,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  ratingsIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingsTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  ratingsSub: { fontSize: 11, color: colors.greyWarm, marginTop: 1 },
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.yellowDark,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 9,
    marginHorizontal: 2,
  },
  list: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15, paddingHorizontal: 18 },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F1F1' },
  listLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  listDetail: { fontSize: 11, color: '#9A948B', fontWeight: '600' },
  logout: { textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#B4442E', marginTop: 24 },
  deleteLink: { textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: '#9A948B', marginTop: 16 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: Math.max(insetBottom + 12, 30),
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 18 },
  deleteIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  deleteTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, textAlign: 'center' },
  deleteSub: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10, paddingHorizontal: 6 },
  cancelBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  cancelLabel: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
});
