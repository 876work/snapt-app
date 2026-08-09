import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DisputeEvidenceForm } from '../../../../components/dispute/EvidenceForm';

// Client door onto the shared dispute-evidence form.
export default function DisputeEvidence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DisputeEvidenceForm bookingId={String(id)} backLabel="Back to booking" />;
}
