import { Redirect } from 'expo-router';

// The Profile tab in creator mode shows the same Profile screen; the
// client/creator segment there switches modes back.
export default function CreatorProfileTab() {
  return <Redirect href="/(app)/profile" />;
}
