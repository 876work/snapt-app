import React from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { apiBase, authHeaders } from '../../lib/api';
import { colors } from '../../lib/theme';

/**
 * Identity verification via Didit's HOSTED flow.
 *
 * The server creates the session; we open the returned URL in an in-app
 * browser. The RESULT ARRIVES BY WEBHOOK — closing the browser or losing
 * signal never loses it, so this screen only ever reflects status, it never
 * reports the outcome itself.
 *
 * Nothing here blocks the application: Didit unreachable, a decline after
 * the retry, or abandoning halfway all fall through to manual review.
 */

const CALLBACK_URL = 'snapt://creator/verification-complete';

/**
 * false = hand off to the system browser (Safari), where camera access for
 * document capture is guaranteed. true = in-app sheet (nicer UX, no context
 * switch) — only flip this once camera capture is confirmed on a physical
 * device; the iOS Simulator has no camera at all, so it cannot answer this.
 */
const USE_IN_APP_BROWSER = false;

export type DocType = 'ID' | 'DL' | 'P';

const DOCS: { key: DocType; title: string; sub: string }[] = [
  { key: 'ID', title: 'National ID card', sub: 'Front and back' },
  { key: 'DL', title: "Driver's licence", sub: 'Front and back' },
  { key: 'P', title: 'Passport', sub: 'Photo page only' },
];

interface Status {
  status: string;
  attempts: number;
  retries_left: number;
  configured: boolean;
}

export function VerifyIdentity({ onStatus }: { onStatus?: (s: string) => void }) {
  const [doc, setDoc] = React.useState<DocType | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/v1/creator/verification`, { headers: await authHeaders() });
      if (!res.ok) return;
      const body = (await res.json()) as Status;
      setStatus(body);
      onStatus?.(body.status);
    } catch {
      /* offline — the step stays optional */
    }
  }, [onStatus]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const start = async () => {
    if (!doc || busy) return;
    if (!apiBase) {
      setError("The app isn't connected to the server, so ID checks can't start. Submit your application — our team will verify you manually.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`${apiBase}/v1/creator/verification/session`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ document_type: doc }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          didit_status?: number;
          didit_detail?: string;
        };
        if (body.error === 'max_attempts') {
          setError("You've used both attempts. Submit your application — our team will review your documents by hand. Nothing else is needed from you.");
        } else {
          // Always say something concrete. The reason code is for support
          // and for us; the creator is told exactly what to do next.
          const code = body.didit_status ? ` (code ${body.didit_status})` : ` (${res.status})`;
          setError(
            `ID checks aren't available right now${code}. Submit your application as normal — our team will verify you manually.`,
          );
        }
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        setError("Verification didn't return a link. Submit your application — our team will verify you manually.");
        return;
      }
      // System browser, NOT an in-app sheet: document capture needs the
      // camera, and full Safari is the only variant where camera access is
      // certain. Didit returns the creator via the snapt:// callback, which
      // has its own route. (Flip USE_IN_APP_BROWSER once the in-app sheet is
      // camera-verified on a real device.)
      if (USE_IN_APP_BROWSER) {
        await WebBrowser.openAuthSessionAsync(body.url, CALLBACK_URL);
      } else {
        const opened = await Linking.canOpenURL(body.url);
        if (!opened) {
          setError("Couldn't open the verification page. Submit your application — our team will verify you manually.");
          return;
        }
        await Linking.openURL(body.url);
      }
      setNote("Thanks — we're checking your documents. This usually takes a minute.");
      setTimeout(refresh, 2500);
      await refresh();
    } catch (err) {
      setError(
        `Couldn't reach verification${err instanceof Error && err.message ? ` (${err.message.slice(0, 60)})` : ''}. Submit your application — our team will verify you manually.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const s = status?.status ?? 'not_started';
  const done = s === 'approved';
  const inReview = s === 'in_review';
  const declined = s === 'declined';
  const underage = s === 'failed_underage';
  const exhausted = (status?.retries_left ?? 1) <= 0;

  if (status && !status.configured) {
    return (
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          ID checks are briefly unavailable. Submit your application as normal — our team will verify
          you by hand.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {done && (
        <View style={[styles.statusCard, styles.ok]}>
          <Text style={styles.statusTitle}>Identity verified ✓</Text>
          <Text style={styles.statusSub}>Your ID and selfie matched. Nothing more to do here.</Text>
        </View>
      )}
      {inReview && (
        <View style={[styles.statusCard, styles.pending]}>
          <Text style={styles.statusTitle}>Checking your documents</Text>
          <Text style={styles.statusSub}>
            This usually takes a minute. You can submit your application now — we'll finish the check
            in the background.
          </Text>
        </View>
      )}
      {underage && (
        <View style={[styles.statusCard, styles.bad]}>
          <Text style={styles.statusTitle}>Age requirement not met</Text>
          <Text style={styles.statusSub}>
            Your document shows you're under 18. Snapt creators must be 18 or older.
          </Text>
        </View>
      )}
      {declined && !exhausted && (
        <View style={[styles.statusCard, styles.pending]}>
          <Text style={styles.statusTitle}>That didn't go through</Text>
          <Text style={styles.statusSub}>
            Usually it's a blurry photo or glare. You have one more try — or submit anyway and our
            team will check by hand.
          </Text>
        </View>
      )}
      {declined && exhausted && (
        <View style={[styles.statusCard, styles.pending]}>
          <Text style={styles.statusTitle}>We'll take it from here</Text>
          <Text style={styles.statusSub}>
            Both attempts are used, so a person will review your documents instead. Submit your
            application — nothing else is needed from you.
          </Text>
        </View>
      )}

      {!done && !underage && !exhausted && (
        <>
          <Text style={styles.pickLabel}>Which document will you use?</Text>
          {DOCS.map((d) => {
            const on = doc === d.key;
            return (
              <Pressable key={d.key} onPress={() => setDoc(d.key)} style={[styles.docRow, on && styles.docRowOn]}>
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on && (
                    <Svg width={11} height={9} viewBox="0 0 12 10" fill="none">
                      <Path d="M1 5l3.5 3.5L11 1.5" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docTitle}>{d.title}</Text>
                  <Text style={styles.docSub}>{d.sub}</Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            onPress={start}
            disabled={!doc || busy}
            style={[styles.cta, (!doc || busy) && { opacity: 0.5 }]}
          >
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={colors.ink} />
                <Text style={styles.ctaLabel}>Starting…</Text>
              </View>
            ) : (
              <Text style={styles.ctaLabel}>
                {(status?.attempts ?? 0) > 0 ? 'Try verification again' : 'Verify my identity'}
              </Text>
            )}
          </Pressable>
          <Text style={styles.privacy}>
            Your documents go straight to our verification partner — Snapt never stores the images.
            We keep only the result and the details on your application.
          </Text>
        </>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  pickLabel: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 9 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  docRowOn: { borderColor: colors.yellow, backgroundColor: '#FFFDF5' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.8,
    borderColor: '#D8D5CE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.yellow, backgroundColor: colors.yellow },
  docTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  docSub: { fontSize: 12, color: colors.grey, marginTop: 1 },
  cta: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  ctaLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  privacy: { fontSize: 11.5, color: colors.grey, lineHeight: 17, marginTop: 10 },
  note: { fontSize: 12.5, color: colors.goldText, lineHeight: 18, marginTop: 10 },
  errorCard: {
    marginTop: 12,
    backgroundColor: '#FDECEC',
    borderWidth: 1,
    borderColor: '#F5C6C6',
    borderRadius: 12,
    padding: 12,
  },
  errorText: { fontSize: 12.5, color: '#A32C2C', lineHeight: 18 },
  statusCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 12 },
  ok: { backgroundColor: '#E8F6EC', borderColor: '#BFE4C9' },
  pending: { backgroundColor: colors.yellowSoft, borderColor: '#F4E7C0' },
  bad: { backgroundColor: '#FDECEC', borderColor: '#F5C6C6' },
  statusTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  statusSub: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 3 },
  infoCard: {
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: '#F4E7C0',
    borderRadius: 14,
    padding: 14,
  },
  infoText: { fontSize: 12.5, color: colors.goldText, lineHeight: 18 },
});
