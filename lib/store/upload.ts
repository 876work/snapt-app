import { create } from 'zustand';
import type { MediaKind } from '../mock/data';

export interface UploadFile {
  id: string;
  type: 'JPG' | 'PNG' | 'MP4' | 'MOV';
  sizeMb: number;
  thumb: number | { uri: string } | null; // asset, picked-file preview, or tint-only
  tint: string;
  oversize?: boolean;
  /** Real picked file (API mode) — uploaded as raw after order creation. */
  uri?: string;
  name?: string;
  mimeType?: string;
}

export interface EditStyle {
  id: string;
  name: string;
  desc: string;
  tint: string;
  video?: boolean;
}

// Style set from the prototype's Choose-your-edit screen.
export const EDIT_STYLES: EditStyle[] = [
  { id: 'natural', name: 'Natural & true-to-life', desc: 'Colors stay honest to the day — light clean-up, balanced tones, no heavy filters.', tint: '#8ED7A6' },
  { id: 'warm', name: 'Warm & golden', desc: 'Sun-kissed, glowing tones that flatter skin and make evenings feel like golden hour.', tint: '#F2C14E' },
  { id: 'bold', name: 'Bold & vibrant', desc: 'Punchy color and contrast that pops on a feed — made for social sharing.', tint: '#6FD3E0' },
  { id: 'cinematic', name: 'Cinematic film look', desc: 'Moody, filmic grade with soft blacks — best for storytelling video edits.', tint: '#F2A0B5', video: true },
];

// NOTE: this 15-file cap predates the confirmed remote pricing tiers (it
// shipped in the prototype alongside a flat package + "extra files" add-on).
// It happens to equal the top photo tier (11–15) but was set independently.
export const MAX_FILES = 15;
export const MAX_TOTAL_GB = 1.5;

export interface RemotePackage {
  /** Key in the remote_pricing_table app_config row. */
  tier: string;
  name: string;
  desc: string;
  priceUsd: number;
}

// CONFIRMED remote-edit pricing (Don, 2026-07-27). Mirrors the
// remote_pricing_table config row — the server is the charging authority;
// these values only render prices in the UI.
export const REMOTE_PACKAGES: Record<MediaKind, RemotePackage[]> = {
  photo: [
    { tier: 'photos_1_5', name: '1–5 photos', desc: 'Up to 5 edited, retouched photos', priceUsd: 25 },
    { tier: 'photos_6_10', name: '6–10 photos', desc: 'Up to 10 edited, retouched photos', priceUsd: 45 },
    { tier: 'photos_11_15', name: '11–15 photos', desc: 'Up to 15 edited, retouched photos', priceUsd: 65 },
  ],
  video: [
    { tier: 'short', name: 'Short reel', desc: '1 reel, up to 1 minute', priceUsd: 70 },
    { tier: 'standard', name: 'Standard reel', desc: '1 reel, up to 3 minutes', priceUsd: 120 },
    { tier: 'extended', name: 'Extended edit', desc: 'Multiple reels or a full video', priceUsd: 180 },
  ],
  both: [
    { tier: 'small', name: 'Small combo', desc: 'Small photo batch + short reel', priceUsd: 85 },
    { tier: 'medium', name: 'Medium combo', desc: 'Medium batch + standard reel', priceUsd: 150 },
    { tier: 'large', name: 'Large combo', desc: 'Large batch + extended reel', priceUsd: 220 },
  ],
};

/** Suggested photo tier from how many files the client queued. */
export function suggestedPhotoTier(fileCount: number): string {
  if (fileCount <= 5) return 'photos_1_5';
  if (fileCount <= 10) return 'photos_6_10';
  return 'photos_11_15';
}

interface UploadState {
  files: UploadFile[];
  note: string;
  mediaKind: MediaKind;
  styleId: string;
  /** Selected remote package tier (key in REMOTE_PACKAGES[mediaKind]). */
  tier: string;
  addFile: () => void;
  addPicked: (files: { uri: string; name: string; mimeType?: string; sizeMb: number }[]) => void;
  setNote: (n: string) => void;
  setMediaKind: (k: MediaKind) => void;
  setStyleId: (id: string) => void;
  setTier: (t: string) => void;
  reset: () => void;
}

const DEMO_POOL: Omit<UploadFile, 'id'>[] = [
  { type: 'JPG', sizeMb: 8, thumb: require('../../assets/design/bookings/p1.webp'), tint: '#F2C14E' },
  { type: 'MP4', sizeMb: 412, thumb: require('../../assets/design/bookings/p2.webp'), tint: '#6FD3E0' },
  { type: 'JPG', sizeMb: 12, thumb: require('../../assets/design/bookings/p3.webp'), tint: '#F2A0B5' },
  { type: 'MOV', sizeMb: 260, thumb: require('../../assets/design/bookings/p4.webp'), tint: '#8ED7A6' },
  { type: 'PNG', sizeMb: 22, thumb: require('../../assets/design/bookings/p5.webp'), tint: '#E8863D' },
];

export const useUpload = create<UploadState>((set, get) => ({
  files: DEMO_POOL.slice(0, 3).map((f, i) => ({ ...f, id: `f${i}` })),
  note: '',
  mediaKind: 'photo',
  styleId: 'warm',
  tier: 'photos_1_5',
  addFile: () => {
    const { files } = get();
    if (files.length >= MAX_FILES) return;
    const next = DEMO_POOL[files.length % DEMO_POOL.length];
    set({ files: [...files, { ...next, id: `f${Date.now()}` }] });
  },
  addPicked: (picked) =>
    set((s) => ({
      files: [
        ...s.files,
        ...picked.slice(0, Math.max(0, MAX_FILES - s.files.length)).map((f, i) => ({
          id: `p${Date.now()}-${i}`,
          type: (f.mimeType?.includes('video') ? 'MP4' : 'JPG') as UploadFile['type'],
          sizeMb: f.sizeMb,
          thumb: { uri: f.uri },
          tint: '#F2C14E',
          uri: f.uri,
          name: f.name,
          mimeType: f.mimeType,
        })),
      ],
    })),
  setNote: (note) => set({ note }),
  setMediaKind: (mediaKind) =>
    set((s) => ({
      mediaKind,
      // Switching service type resets the tier: suggested-by-count for
      // photos, first tier otherwise (always overridable).
      tier:
        mediaKind === 'photo'
          ? suggestedPhotoTier(s.files.length)
          : REMOTE_PACKAGES[mediaKind][0].tier,
    })),
  setStyleId: (styleId) => set({ styleId }),
  setTier: (tier) => set({ tier }),
  reset: () =>
    set({
      files: DEMO_POOL.slice(0, 3).map((f, i) => ({ ...f, id: `f${i}` })),
      note: '',
      mediaKind: 'photo',
      styleId: 'warm',
      tier: 'photos_1_5',
    }),
}));
