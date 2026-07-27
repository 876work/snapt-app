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

interface AuthState {
  signedIn: boolean;
  name: string;
  email: string;
  currency: Currency;
  signIn: (name: string, email: string) => void;
  signOut: () => void;
  setCurrency: (c: Currency) => void;
}

export const useAuth = create<AuthState>((set) => ({
  signedIn: false,
  name: '',
  email: '',
  currency: 'USD',
  signIn: (name, email) => set({ signedIn: true, name, email }),
  signOut: () => set({ signedIn: false, name: '', email: '' }),
  setCurrency: (currency) => set({ currency }),
}));

export interface BookingDraft {
  type: 'in-person' | 'remote';
  occasion: Occasion | null;
  date: string | null; // ISO date (day)
  time: string | null;
  durationHours: number | null;
  mediaKind: MediaKind;
  area: Area | null;
  meetingPoint: string;
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
  creatorId: null,
};

interface BookingState {
  draft: BookingDraft;
  bookings: Booking[];
  setDraft: (patch: Partial<BookingDraft>) => void;
  resetDraft: (type?: 'in-person' | 'remote') => void;
  /** Specialty match is a hard filter (exclusion), not a ranking weight — handoff §12. */
  eligibleCreators: () => Creator[];
  confirmDraft: (priceUsd: number) => Booking;
  cancelBooking: (id: string) => void;
  rescheduleBooking: (id: string, newDateIso: string) => void;
  reportNoShow: (id: string) => void;
}

export const useBookings = create<BookingState>((set, get) => ({
  draft: emptyDraft,
  bookings: SEED_BOOKINGS,
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
  return CREATORS.find((c) => c.id === id);
}

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600_000;
}
