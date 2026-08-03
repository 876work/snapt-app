import React from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  TextInput as RNTextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text, TextInput } from '../../lib/text';
import { COUNTRIES, Country } from '../../lib/constants/countries';
import { colors } from '../../lib/theme';

// Shared building blocks for the redesigned auth screens (CD design):
// decorative blob + paper airplane, logo tile, social sign-in rows, icon
// inputs, and the all-countries dial-code picker.

/** Soft cream blob + dashed trail + paper airplane, absolute top-right. */
export function AuthDecor() {
  return (
    <View pointerEvents="none" style={decorStyles.wrap}>
      <Svg width={150} height={150} viewBox="0 0 150 150">
        <Path
          d="M150 0H70c-8 26 6 38 24 44 22 8 34 24 30 46-3 18 8 30 26 34V0z"
          fill="#F6E7C8"
          opacity={0.75}
        />
        <Path
          d="M60 96c22 4 40-8 48-28"
          stroke="#F2A93B"
          strokeWidth={2.4}
          strokeDasharray="6 7"
          strokeLinecap="round"
          fill="none"
        />
        <Path d="M112 44l24 12-17 5-2 12z" fill="#F2A93B" />
        <Path d="M119 61l17-5-11 14z" fill="#E08F1F" />
      </Svg>
    </View>
  );
}

const decorStyles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, right: 0, zIndex: 0 },
});

/** White rounded tile with the S mark. */
export function LogoTile({ size = 56 }: { size?: number }) {
  return (
    <View style={[tileStyles.tile, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Image
        source={require('../../assets/design/snapt-mark.webp')}
        style={{ width: size * 0.62, height: size * 0.62 }}
        resizeMode="contain"
      />
    </View>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
});

function GoogleG() {
  return (
    <Svg width={19} height={19} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <Path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 010-9.4l-7.8-6.1a24 24 0 000 21.6l7.8-6.1z" />
      <Path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.4-5.5l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-3.9-13.6-9.3l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </Svg>
  );
}

function AppleMark() {
  return (
    <Svg width={18} height={20} viewBox="0 0 24 28">
      <Path
        fill="#fff"
        d="M19.7 14.8c0-3.3 2.7-4.9 2.8-5-1.5-2.2-3.9-2.5-4.7-2.6-2-.2-3.9 1.2-4.9 1.2-1 0-2.6-1.2-4.3-1.1C6.4 7.4 4.4 8.6 3.3 10.5c-2.3 4-.6 9.8 1.6 13 1.1 1.6 2.4 3.3 4.1 3.3 1.6-.1 2.3-1.1 4.3-1.1 2 0 2.6 1.1 4.3 1 1.8 0 2.9-1.6 4-3.2 1.3-1.8 1.8-3.6 1.8-3.7-.1 0-3.6-1.4-3.7-5zM16.4 4.6c.9-1.1 1.5-2.6 1.3-4.1-1.3.1-2.9.9-3.8 2-.8 1-1.6 2.5-1.4 4 1.5.1 3-.8 3.9-1.9z"
      />
    </Svg>
  );
}

function FacebookF() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill="#fff" />
      <Path
        fill="#1877F2"
        d="M16.7 15.4l.5-3.5h-3.3V9.6c0-1 .5-1.9 2-1.9h1.5V4.7s-1.4-.2-2.7-.2c-2.7 0-4.5 1.7-4.5 4.7v2.7H7.1v3.5h3.1V24a12 12 0 003.7 0v-8.6h2.8z"
      />
    </Svg>
  );
}

/** The three social sign-in rows + "or" divider (visual stubs until OAuth). */
export function SocialButtons() {
  return (
    <View style={socialStyles.wrap}>
      <Pressable style={[socialStyles.btn, socialStyles.google]}>
        <GoogleG />
        <Text style={[socialStyles.label, { color: '#1A1A1A' }]}>Continue with Google</Text>
      </Pressable>
      <Pressable style={[socialStyles.btn, socialStyles.apple]}>
        <AppleMark />
        <Text style={[socialStyles.label, { color: '#fff' }]}>Continue with Apple</Text>
      </Pressable>
      <Pressable style={[socialStyles.btn, socialStyles.facebook]}>
        <FacebookF />
        <Text style={[socialStyles.label, { color: '#fff' }]}>Continue with Facebook</Text>
      </Pressable>
      <View style={socialStyles.orRow}>
        <View style={socialStyles.orLine} />
        <Text style={socialStyles.orLabel}>or</Text>
        <View style={socialStyles.orLine} />
      </View>
    </View>
  );
}

const socialStyles = StyleSheet.create({
  wrap: { gap: 11 },
  btn: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  google: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E7E3DA' },
  apple: { backgroundColor: '#0B0B0B' },
  facebook: { backgroundColor: '#1877F2' },
  label: { fontSize: 14.5, fontWeight: '700' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E4DFD4' },
  orLabel: { fontSize: 12, color: '#A8A29A', fontWeight: '600' },
});

const FIELD_ICONS: Record<string, React.ReactNode> = {
  person: (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="3.4" stroke="#A8A29A" strokeWidth={1.8} />
      <Path d="M5.5 19.5c1.1-3.2 3.7-4.8 6.5-4.8s5.4 1.6 6.5 4.8" stroke="#A8A29A" strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  ),
  phone: (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M6 3h3l1.5 4.5L8.5 9a12 12 0 006.5 6.5l1.5-2L21 15v3a2 2 0 01-2.2 2A16.8 16.8 0 014 5.2 2 2 0 016 3z" stroke="#A8A29A" strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  ),
  mail: (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="#A8A29A" strokeWidth={1.8} />
      <Path d="M4.5 7l7.5 6 7.5-6" stroke="#A8A29A" strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  ),
  lock: (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="#A8A29A" strokeWidth={1.8} />
      <Path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" stroke="#A8A29A" strokeWidth={1.8} />
    </Svg>
  ),
};

/** White rounded input row with a leading icon (and optional right accessory). */
export function AuthInput({
  icon,
  right,
  inputRef,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  icon?: keyof typeof FIELD_ICONS;
  right?: React.ReactNode;
  inputRef?: React.Ref<RNTextInput>;
}) {
  return (
    <View style={inputStyles.row}>
      {icon ? FIELD_ICONS[icon] : null}
      <TextInput
        {...props}
        placeholderTextColor="#A8A29A"
        style={[inputStyles.input, props.style]}
      />
      {right}
    </View>
  );
}

const inputStyles = StyleSheet.create({
  row: {
    height: 52,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E3DA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 15,
  },
  input: { flex: 1, fontSize: 14.5, color: colors.ink, paddingVertical: 0 },
});

/** Bottom-sheet picker over all 250 countries: flag, name, dial code. */
export function CountryCodePicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (c: Country) => void;
}) {
  const [query, setQuery] = React.useState('');
  const data = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dialCode.startsWith(q.replace('+', '')),
    );
  }, [query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pickerStyles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={pickerStyles.sheet}>
          <View style={pickerStyles.grabber} />
          <Text style={pickerStyles.title}>Select country code</Text>
          <AuthInput
            placeholder="Search country or code"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          <FlatList
            data={data}
            keyExtractor={(c) => c.iso2}
            style={{ marginTop: 10 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  setQuery('');
                  onClose();
                }}
                style={pickerStyles.row}
              >
                <Text style={pickerStyles.flag}>{item.flag}</Text>
                <Text style={pickerStyles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={pickerStyles.code}>+{item.dialCode}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    height: '72%',
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4DFD4',
  },
  flag: { fontSize: 22 },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  code: { fontSize: 13.5, fontWeight: '700', color: '#8A8377' },
});

/** Round back button used on the light auth screens. */
export function BackCircle({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={backStyles.btn}>
      <Svg width={10} height={17} viewBox="0 0 10 17" fill="none">
        <Path d="M8.5 1.5L2 8.5l6.5 7" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

const backStyles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E3DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
