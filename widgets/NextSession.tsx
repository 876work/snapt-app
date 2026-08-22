import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/**
 * THE CLIENT'S NEXT SESSION, ON THE HOME SCREEN.
 *
 * The first native target in this project. It exists partly for itself and
 * partly because the extension, App Group and provisioning it establishes are
 * what Live Activities will reuse — so it is deliberately the simplest
 * surface that is still genuinely useful.
 *
 * NO NETWORK, NO CREDENTIALS, NO SERVER. A widget process cannot hold a
 * session and must never try: everything here arrives as props the app wrote
 * through the App Group (lib/widgetSnapshot.ts). The widget only renders.
 *
 * THE COUNTDOWN IS THE SYSTEM'S, NOT OURS. `dateStyle="timer"` is SwiftUI's
 * `Text(date, style: .timer)` — WidgetKit redraws it as time passes without
 * the extension waking, without a timeline entry per minute, and without the
 * app running. A hand-rolled countdown would need a timeline entry per tick
 * and would still be wrong between them.
 *
 * NOTHING HERE IS EVER STALE OR BLANK. `hasSession: false` is a real state
 * with real words, not an empty view, and the app schedules a timeline entry
 * at the session's END that flips this widget into it — so a session that has
 * already happened disappears on its own, with the app closed. That is the
 * whole reason the creator's job-count widget was not built: a number with no
 * expiry goes stale the moment the app closes, and a wrong number on someone's
 * home screen is worse than no widget.
 */
export type NextSessionProps = {
  /** False renders the empty state — never an empty view, never a placeholder. */
  hasSession: boolean;
  /** Epoch ms. The timer counts to this; only read when hasSession. */
  startsAt: number;
  occasion: string;
  area: string;
};

const INK = '#1A1A1A';
const MUTED = '#767676';
const BRAND = '#B8860B';

const NextSession = (props: NextSessionProps, environment: WidgetEnvironment) => {
  'widget';

  if (!props.hasSession) {
    return (
      <VStack spacing={4}>
        <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(INK)]}>
          No upcoming session
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(MUTED)]}>
          Book one in Snapt and it will count down here.
        </Text>
      </VStack>
    );
  }

  const startsAt = new Date(props.startsAt);
  // The medium family has room for the occasion AND the area on one line;
  // the small one does not, so it drops the area rather than truncating both.
  const wide = environment.widgetFamily === 'systemMedium';

  return (
    <VStack spacing={2}>
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(MUTED)]}>
        Next session
      </Text>
      <Text
        date={startsAt}
        dateStyle="timer"
        modifiers={[font({ weight: 'bold', size: 30 }), foregroundStyle(BRAND)]}
      />
      <Text modifiers={[font({ weight: 'semibold', size: 13 }), foregroundStyle(INK)]}>
        {props.occasion}
      </Text>
      {wide ? (
        <HStack spacing={4}>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(MUTED)]}>{props.area}</Text>
          <Spacer />
        </HStack>
      ) : (
        <Text modifiers={[font({ size: 12 }), foregroundStyle(MUTED)]}>{props.area}</Text>
      )}
    </VStack>
  );
};

// The name MUST match `widgets[].name` in the app config's expo-widgets
// plugin block — that string is what binds this component to the generated
// extension target.
export default createWidget<NextSessionProps>('NextSession', NextSession);
