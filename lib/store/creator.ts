import { create } from 'zustand';
import type { Occasion } from '../mock/data';

export interface JobOffer {
  /** Social bundle: included edited counts. null/undefined = normal job. */
  social?: { photos: number; videos: number } | null;
  id: string;
  title: string;
  occasion: Occasion;
  payUsd: number; // creator take after platform fee
  when: string;
  loc: string;
  distanceKm: number;
  urgent?: boolean;
  countdown?: string;
  /** ISO expiry of the live offer window (API mode) — drives a ticking countdown. */
  expiresAt?: string;
  type: 'in-person' | 'remote';
  /** Exact meeting pin (API mode) — drives the job-detail map. */
  meetingLat?: number | null;
  meetingLng?: number | null;
  /** Client's optional directions text ("blue gate by the fish market"). */
  directions?: string | null;
}

export const JOB_OFFERS: JobOffer[] = [
  { id: 'j1', title: 'Golden-hour portraits', occasion: 'Portraits', payUsd: 95.2, when: 'Tomorrow · 5:30 PM · 1.5 hrs', loc: 'Rodney Bay · 2.1 km', distanceKm: 2.1, urgent: true, countdown: '14:32', type: 'in-person' },
  { id: 'j2', title: 'Family beach session', occasion: 'Family', payUsd: 146.9, when: 'Sat, 2 Aug · 9:00 AM · 2 hrs', loc: 'Pigeon Island · 3.8 km', distanceKm: 3.8, type: 'in-person' },
  { id: 'j3', title: 'Wedding highlight edit', occasion: 'Wedding', payUsd: 108.8, when: 'Remote · deliver in 5 days', loc: 'Remote edit', distanceKm: 0, type: 'remote' },
];

// Job lifecycle stages for the creator side (accept → wrap → submit).
export type JobStage =
  | 'offer'
  | 'accepted'
  | 'onway'
  | 'checkin'
  | 'session'
  | 'upload'
  | 'submitted';

interface CreatorState {
  available: boolean;
  offers: JobOffer[];
  jobStages: Record<string, JobStage>;
  specialties: Occasion[];
  toggleAvailable: () => void;
  setAvailable: (available: boolean) => void;
  declineOffer: (id: string) => void;
  setStage: (id: string, s: JobStage) => void;
  setSpecialties: (s: Occasion[]) => void;
  /** API mode: replace the mock offer list with real assigned bookings. */
  setOffers: (offers: JobOffer[]) => void;
}

export const useCreator = create<CreatorState>((set) => ({
  available: true,
  offers: JOB_OFFERS,
  jobStages: {},
  specialties: ['Portraits', 'Wedding', 'Events'],
  toggleAvailable: () => set((s) => ({ available: !s.available })),
  setAvailable: (available: boolean) => set({ available }),
  declineOffer: (id) => set((s) => ({ offers: s.offers.filter((o) => o.id !== id) })),
  setStage: (id, stage) => set((s) => ({ jobStages: { ...s.jobStages, [id]: stage } })),
  setSpecialties: (specialties) => set({ specialties }),
  setOffers: (offers) => set({ offers }),
}));
