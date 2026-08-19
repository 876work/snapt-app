import { create } from 'zustand';
import type { MediaKind } from '../mock/data';

export interface UploadFile {
  id: string;
  type: 'JPG' | 'PNG' | 'MP4' | 'MOV';
  sizeMb: number;
  thumb: number | { uri: string } | null; // asset, picked-file preview, or tint-only
  tint: string;
  oversize?: boolean;
  /** Real picked file — uploaded to the draft the moment it is selected. */
  uri?: string;
  name?: string;
  mimeType?: string;
  /** Per-file upload lifecycle. A silent failure on a paid order is a dispute.
   *  'finishing' = every byte handed to the network, but the file is not yet
   *  confirmed usable (R2's ack + our register call are still outstanding) —
   *  the phase that used to display as a dead "100%". */
  status?: 'queued' | 'uploading' | 'finishing' | 'done' | 'failed';
  /** 0–1, or null when the true total is unknowable (see rawUpload's put). */
  progress?: number | null;
  error?: string;
  /** booking_media row id once registered — needed to delete it server-side. */
  mediaId?: string;
}

export interface EditStyle {
  id: string;
  name: string;
  desc: string;
  tint: string;
}

// Style set from the prototype's Choose-your-edit screen.
export const EDIT_STYLES: EditStyle[] = [
  { id: 'natural', name: 'Natural & true-to-life', desc: 'Colors stay honest to the day — light clean-up, balanced tones, no heavy filters.', tint: '#8ED7A6' },
  { id: 'warm', name: 'Warm & golden', desc: 'Sun-kissed, glowing tones that flatter skin and make evenings feel like golden hour.', tint: '#F2C14E' },
  { id: 'bold', name: 'Bold & vibrant', desc: 'Punchy color and contrast that pops on a feed — made for social sharing.', tint: '#6FD3E0' },
  { id: 'cinematic', name: 'Cinematic film look', desc: 'Moody, filmic grade with soft blacks and restrained color — gives photos and video the same big-screen feel.', tint: '#F2A0B5' },
];

// NOTE: this 15-file cap predates the confirmed remote pricing tiers (it
// shipped in the prototype alongside a flat package + "extra files" add-on).
// It happens to equal the top photo tier (11–15) but was set independently.
export const MAX_FILES = 15;
export const MAX_TOTAL_GB = 1.5;

// Per-file ceilings. A phone photo is 2-8MB and a minute of 4K is ~350MB,
// so these are generous for real source material while stopping a single
// file from eating the whole order budget. Mirrored server-side — the
// client check is for a good error message, not for enforcement.
export const MAX_IMAGE_MB = 50;
export const MAX_VIDEO_MB = 750;
export const ACCEPTED_MIME = /^(image\/(jpeg|jpg|png|heic|heif|webp)|video\/(mp4|quicktime|x-m4v))$/i;

/** Why a picked file was rejected — surfaced per file, never silently dropped. */
export type RejectReason = 'count' | 'type' | 'size' | 'total';

export interface RejectedFile {
  name: string;
  reason: RejectReason;
}

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
  /**
   * The draft these files are uploading into. Minted on the first pick and
   * carried through checkout, where the webhook claims the draft's media
   * onto the booking it creates. Null until something is picked.
   */
  draftId: string | null;
  note: string;
  mediaKind: MediaKind;
  styleId: string;
  /** Selected remote package tier (key in REMOTE_PACKAGES[mediaKind]). */
  tier: string;
  /** Returns what was REJECTED so the screen can say so out loud. */
  addPicked: (
    files: { uri: string; name: string; mimeType?: string; sizeMb: number }[],
  ) => RejectedFile[];
  removeFile: (id: string) => void;
  setFileStatus: (id: string, patch: Partial<UploadFile>) => void;
  setDraftId: (id: string | null) => void;
  /** Files restored from a draft the client left earlier — already uploaded. */
  adoptDraftFiles: (files: { mediaId: string; name: string; contentType: string | null }[]) => void;
  setNote: (n: string) => void;
  setMediaKind: (k: MediaKind) => void;
  setStyleId: (id: string) => void;
  setTier: (t: string) => void;
  reset: () => void;
}

// DEMO_POOL was DELETED (2026-08-08). The store used to initialise with
// three fake files — and reset() put them back after every order — so the
// Upload Footage screen opened showing thumbnails of stock photos the user
// had never chosen. Worse: those fakes carried no `uri`, so they were
// skipped at upload time. Someone who picked nothing still saw "3 files
// ready", could pay, and the order arrived with no source material at all.
// Same class as SEED_BOOKINGS/CREATORS. Do not reintroduce.

export const useUpload = create<UploadState>((set, get) => ({
  files: [],
  draftId: null,
  note: '',
  mediaKind: 'photo',
  styleId: 'warm',
  tier: 'photos_1_5',
  addPicked: (picked) => {
    const existing = get().files;
    const rejected: RejectedFile[] = [];
    const accepted: UploadFile[] = [];
    let runningMb = existing.reduce((sum, f) => sum + f.sizeMb, 0);

    for (const f of picked) {
      const label = f.name || 'file';
      // ORDER MATTERS: count first, so the 16th file is refused for the
      // reason the user will understand, not for an incidental size rule.
      if (existing.length + accepted.length >= MAX_FILES) {
        rejected.push({ name: label, reason: 'count' });
        continue;
      }
      const isVideo = (f.mimeType ?? '').startsWith('video');
      if (f.mimeType && !ACCEPTED_MIME.test(f.mimeType)) {
        rejected.push({ name: label, reason: 'type' });
        continue;
      }
      if (f.sizeMb > (isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB)) {
        rejected.push({ name: label, reason: 'size' });
        continue;
      }
      if (runningMb + f.sizeMb > MAX_TOTAL_GB * 1000) {
        rejected.push({ name: label, reason: 'total' });
        continue;
      }
      runningMb += f.sizeMb;
      accepted.push({
        id: `p${Date.now()}-${accepted.length}`,
        type: (isVideo ? 'MP4' : 'JPG') as UploadFile['type'],
        sizeMb: f.sizeMb,
        thumb: { uri: f.uri },
        tint: '#F2C14E',
        uri: f.uri,
        name: f.name,
        mimeType: f.mimeType,
        status: 'queued',
      });
    }
    if (accepted.length) set({ files: [...existing, ...accepted] });
    return rejected;
  },
  removeFile: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
  setFileStatus: (id, patch) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  setDraftId: (draftId) => set({ draftId }),
  adoptDraftFiles: (restored) =>
    set({
      // Already on the server, so they start `done`. No local uri: the bytes
      // are in the bucket, not on this device any more — which is exactly
      // why these must never be re-uploaded.
      files: restored.map((r) => ({
        id: `d${r.mediaId}`,
        type: ((r.contentType ?? '').startsWith('video') ? 'MP4' : 'JPG') as UploadFile['type'],
        sizeMb: 0,
        thumb: null,
        tint: '#F2C14E',
        name: r.name,
        mimeType: r.contentType ?? undefined,
        status: 'done' as const,
        progress: 1,
        mediaId: r.mediaId,
      })),
    }),
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
      files: [],
      draftId: null,
      note: '',
      mediaKind: 'photo',
      styleId: 'warm',
      tier: 'photos_1_5',
    }),
}));
