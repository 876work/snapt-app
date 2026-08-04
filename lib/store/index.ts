import { create } from 'zustand';
import {
  Area,
  Booking,
  Creator,
  CREATORS,
  MediaKind,
  Occasion,
  SEED_BOOKINGS,
} from '../mock/data';
import { Currency } from '../constants/business';

export type AppMode = 'client' | 'creator';
// Server-authoritative six-state model (creator_profiles.vetting_status via
// /v1/creator/me). The client stores this value for rendering only — it is
// re-fetched on launch and after every relevant action, and never derived
// or unlocked locally.
export type CreatorStatus =
  | 'not_applied'
  | 'in_progress'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

interface AuthState {
  signedIn: boolean;
  /** True once persisted-session restore has settled (immediately in mock mode). */
  hydrated: boolean;
  name: string;
  email: string;
  phone: string;
  currency: Currency;
  mode: AppMode;
  creatorStatus: CreatorStatus;
  signIn: (name: string, email: string) => void;
  signOut: () => void;
  setHydrated: () => void;
  setCurrency: (c: Currency) => void;
  setMode: (m: AppMode) => void;
  setCreatorStatus: (s: CreatorStatus) => void;
  setProfile: (patch: { name?: string; email?: string; phone?: string }) => void;
}

export const useAuth = create<AuthState>((set) => ({
  signedIn: false,
  hydrated: false,
  name: '',
  email: '',
  phone: '',
  currency: 'USD',
  mode: 'client',
  creatorStatus: 'not_applied',
  signIn: (name, email) => set({ signedIn: true, name, email }),
  signOut: () => set({ signedIn: false, name: '', email: '', mode: 'client', creatorStatus: 'not_applied' }),
  setHydrated: () => set({ hydrated: true }),
  setCurrency: (currency) => set({ currency }),
  // Selected mode persists across relaunches (restored in initAuth) but is
  // always revalidated against server status — see lib/auth.ts.
  setMode: (mode) => {
    set({ mode });
    import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
      AsyncStorage.setItem('snapt.mode', mode).catch(() => {}),
    );
  },
  setCreatorStatus: (creatorStatus) => set({ creatorStatus }),
  setProfile: (patch) => set((s) => ({ ...s, ...patch })),
}));

export interface BookingDraft {
  type: 'in-person' | 'remote';
  occasion: Occasion | null;
  date: string | null; // ISO date (day)
  time: string | null;
  durationHours: number | null;
  mediaKind: MediaKind;
  area: Area | null;
  /** Optional human directions text ("blue gate by the fish market"). */
  meetingPoint: string;
  /** Exact pin position from the meeting-point map. */
  meetingLat: number | null;
  meetingLng: number | null;
  creatorId: string | null;
}

const emptyDraft: BookingDraft = {
  type: 'in-person',
  occasion: null,
  date: null,
  time: null,
  durationHours: null,
  mediaKind: 'photo',
  area: null,
  meetingPoint: '',
  meetingLat: null,
  meetingLng: null,
  creatorId: null,
};

interface BookingState {
  draft: BookingDraft;
  bookings: Booking[];
  /** Creator catalog: mock entries plus server creators registered in API mode. */
  catalog: Creator[];
  registerCreators: (creators: Creator[]) => void;
  setDraft: (patch: Partial<BookingDraft>) => void;
  resetDraft: (type?: 'in-person' | 'remote') => void;
  /** Specialty match is a hard filter (exclusion), not a ranking weight — handoff §12. */
  eligibleCreators: () => Creator[];
  confirmDraft: (priceUsd: number) => Booking;
  /** Insert a booking already created server-side (API mode) and clear the draft. */
  addServerBooking: (booking: Booking) => void;
  cancelBooking: (id: string) => void;
  rescheduleBooking: (id: string, newDateIso: string) => void;
  reportNoShow: (id: string) => void;
}

export const useBookings = create<BookingState>((set, get) => ({
  draft: emptyDraft,
  bookings: SEED_BOOKINGS,
  catalog: CREATORS,
  registerCreators: (incoming) =>
    set((s) => ({
      catalog: [...incoming, ...s.catalog.filter((c) => !incoming.some((n) => n.id === c.id))],
    })),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  resetDraft: (type = 'in-person') => set({ draft: { ...emptyDraft, type } }),
  eligibleCreators: () => {
    const { occasion } = get().draft;
    if (!occasion) return CREATORS;
    return CREATORS.filter((c) => c.specialties.includes(occasion));
  },
  confirmDraft: (priceUsd) => {
    const d = get().draft;
    const booking: Booking = {
      id: `bk-${Date.now().toString().slice(-6)}`,
      type: d.type,
      occasion: d.occasion ?? 'Portraits',
      creatorId: d.creatorId,
      area: d.area,
      meetingPoint: d.meetingPoint || undefined,
      scheduledAt: d.date && d.time ? `${d.date}T${d.time}:00` : new Date().toISOString(),
      durationHours: d.durationHours ?? 1,
      mediaKind: d.mediaKind,
      priceUsd,
      status: 'confirmed',
      rescheduleCount: 0,
    };
    set((s) => ({ bookings: [booking, ...s.bookings], draft: emptyDraft }));
    return booking;
  },
  addServerBooking: (booking) =>
    set((s) => ({ bookings: [booking, ...s.bookings], draft: emptyDraft })),
  cancelBooking: (id) =>
    set((s) => ({
      bookings: s.bookings.map((b) => (b.id === id ? { ...b, status: 'cancelled' as const } : b)),
    })),
  rescheduleBooking: (id, newDateIso) =>
    set((s) => ({
      bookings: s.bookings.map((b) =>
        b.id === id
          ? { ...b, scheduledAt: newDateIso, rescheduleCount: b.rescheduleCount + 1 }
          : b,
      ),
    })),
  reportNoShow: (id) =>
    set((s) => ({
      bookings: s.bookings.map((b) => (b.id === id ? { ...b, status: 'no-show' as const } : b)),
    })),
}));

export function creatorById(id: string | null): Creator | undefined {
  return useBookings.getState().catalog.find((c) => c.id === id);
}

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600_000;
}
