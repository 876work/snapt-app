import { create } from 'zustand';
import {
  Area,
  Booking,
  Creator,
  MediaKind,
  Occasion,
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
  /**
   * Supabase auth user id. Needed to tell whether a push notification was
   * addressed to THIS account — a device token outlives a sign-out, so a
   * tap can arrive for a previous user.
   */
  userId: string | null;
  /** True once persisted-session restore has settled (immediately in mock mode). */
  hydrated: boolean;
  name: string;
  email: string;
  phone: string;
  /** ISO-3166 alpha-2, lowercase — a direct key into COUNTRIES. */
  country: string;
  /**
   * Whether the four required profile fields are all present.
   *
   * TRI-STATE ON PURPOSE. `null` means "not known yet" — the profiles row
   * hasn't been read back. Only an explicit `false` may redirect anyone to
   * the completion step; treating unknown as incomplete would bounce every
   * user through it for the few hundred ms before hydration lands.
   */
  profileComplete: boolean | null;
  currency: Currency;
  mode: AppMode;
  creatorStatus: CreatorStatus;
  signIn: (name: string, email: string, userId?: string | null) => void;
  signOut: () => void;
  setHydrated: () => void;
  setCurrency: (c: Currency) => void;
  setMode: (m: AppMode) => void;
  setCreatorStatus: (s: CreatorStatus) => void;
  setProfile: (patch: {
    name?: string;
    email?: string;
    phone?: string;
    country?: string;
    profileComplete?: boolean | null;
  }) => void;
}

/** The one definition of "complete" on the client. Mirrors the server's. */
export function isProfileComplete(p: {
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
}): boolean {
  return Boolean(
    p.name?.trim() && p.email?.trim() && p.phone?.trim() && p.country?.trim(),
  );
}

export const useAuth = create<AuthState>((set, get) => ({
  signedIn: false,
  userId: null,
  hydrated: false,
  name: '',
  email: '',
  phone: '',
  country: '',
  profileComplete: null,
  currency: 'USD',
  mode: 'client',
  creatorStatus: 'not_applied',
  signIn: (name, email, userId) =>
    set({ signedIn: true, name, email, ...(userId !== undefined ? { userId } : {}) }),
  signOut: () =>
    set({
      signedIn: false,
      userId: null,
      name: '',
      email: '',
      phone: '',
      country: '',
      // Back to unknown, not to false — the next account's completeness is
      // nothing to do with this one's.
      profileComplete: null,
      mode: 'client',
      creatorStatus: 'not_applied',
    }),
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
  /**
   * Server-authoritative value, CACHED per account as a launch hint.
   *
   * The launch gate (app/index.tsx) routes on mode + creatorStatus, and the
   * server's answer arrives over the network — often after a Render cold
   * start. Holding the splash for that would make every launch as slow as
   * the slowest wake, so the LAST KNOWN status is written through here (on
   * every server refresh) and restored locally before `hydrated` flips.
   * The cache never decides anything the server disagrees with for long:
   * initAuth re-fetches on every launch and demotes mode the moment the
   * answer is anything but approved, and the server refuses creator actions
   * regardless of what any cached value claims.
   *
   * Keyed BY USER ID so one account's approval can never route a different
   * account on the same device into the creator shell.
   */
  setCreatorStatus: (creatorStatus) => {
    set({ creatorStatus });
    const uid = get().userId;
    if (!uid) return;
    import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
      AsyncStorage.setItem(`snapt.creatorStatus.${uid}`, creatorStatus).catch(() => {}),
    );
  },
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
  /**
   * Social bundle tier — the WHOLE tier snapshot so summary can display
   * price/counts without refetching. Server re-prices from config at
   * creation regardless (§8). null for every other occasion.
   */
  social: import('../mock/data').SocialTierDef | null;
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
  social: null,
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
  /** Replace the local list with what the server actually holds. */
  hydrateBookings: (bookings: Booking[]) => void;
  /** True once the server list has landed — screens use it for empty vs loading. */
  bookingsLoaded: boolean;
  cancelBooking: (id: string) => void;
  rescheduleBooking: (id: string, newDateIso: string) => void;
  reportNoShow: (id: string) => void;
}

export const useBookings = create<BookingState>((set, get) => ({
  draft: emptyDraft,
  // EMPTY, not seeded. These used to start as SEED_BOOKINGS/CREATORS from
  // lib/mock/data and nothing ever replaced them, so the bookings list,
  // booking detail and creator browse screens rendered invented data over a
  // working backend. The server is now the only source.
  bookings: [],
  bookingsLoaded: false,
  catalog: [],
  registerCreators: (incoming) =>
    set((s) => ({
      catalog: [...incoming, ...s.catalog.filter((c) => !incoming.some((n) => n.id === c.id))],
    })),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  resetDraft: (type = 'in-person') => set({ draft: { ...emptyDraft, type } }),
  eligibleCreators: () => {
    const { occasion } = get().draft;
    const catalog = get().catalog;
    if (!occasion) return catalog;
    return catalog.filter((c) => c.specialties.includes(occasion));
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
  hydrateBookings: (bookings) => set({ bookings, bookingsLoaded: true }),
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
