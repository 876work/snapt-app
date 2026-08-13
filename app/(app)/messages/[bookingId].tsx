import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { ChatThread, type ChatThreadInfo } from '../../../components/chat/ChatThread';
import { colors } from '../../../lib/theme';

/**
 * One conversation, full screen. The chat itself lives in
 * components/chat/ChatThread — the same component the session-day sheet
 * renders, so the two can no longer drift apart. This file is now only the
 * screen chrome around it.
 */
export default function MessageThread() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  // The header needs the counterparty, which only the thread fetch knows.
  const [thread, setThread] = React.useState<ChatThreadInfo | null>(null);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={thread?.other_name ?? 'Conversation'}
        right={
          thread ? (
            <View style={styles.headerAvatar}>
              <CreatorAvatar
                name={thread.other_name}
                photo={thread.other_avatar ? { uri: thread.other_avatar } : null}
                textSize={13}
              />
            </View>
          ) : undefined
        }
      />
      <ChatThread bookingId={bookingId ?? ''} mode="full" onThread={setThread} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
