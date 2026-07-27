import { Redirect } from 'expo-router';
import { useAuth } from '../lib/store';

export default function Index() {
  const signedIn = useAuth((s) => s.signedIn);
  return <Redirect href={signedIn ? '/(app)/home' : '/(auth)/welcome'} />;
}
