import { Redirect } from 'expo-router';

// Creator Ratings & Growth mirrors the client ratings layout for now; the
// dedicated growth view (trend calc) lands with real review data (Phase 3).
export default function CreatorRatings() {
  return <Redirect href="/profile/ratings" />;
}
