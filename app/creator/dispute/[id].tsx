import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DisputeEvidenceForm } from '../../../components/dispute/EvidenceForm';

// Creator door onto the shared dispute-evidence form (`id` = booking id).
// RLS already admitted creators; this route existing is what lets dispute
// notifications point creators at their own surface instead of the client's.
export default function CreatorDisputeEvidence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DisputeEvidenceForm bookingId={String(id)} backLabel="Back to job" />;
}
