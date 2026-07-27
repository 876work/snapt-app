import { create } from 'zustand';
import type { MediaKind } from '../mock/data';

export interface UploadFile {
  id: string;
  type: 'JPG' | 'PNG' | 'MP4' | 'MOV';
  sizeMb: number;
  thumb: number | null; // require() asset or null for tint-only
  tint: string;
  oversize?: boolean;
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

export const MAX_FILES = 15;
export const MAX_TOTAL_GB = 1.5;

// Remote-edit package base prices (USD) by media kind.
export const EDIT_PACKAGES: Record<MediaKind, { name: string; priceUsd: number }> = {
  photo: { name: 'Photo edit package', priceUsd: 95 },
  video: { name: 'Video edit package', priceUsd: 160 },
  both: { name: 'Photo + video package', priceUsd: 220 },
};

interface UploadState {
  files: UploadFile[];
  note: string;
  mediaKind: MediaKind;
  styleId: string;
  addFile: () => void;
  setNote: (n: string) => void;
  setMediaKind: (k: MediaKind) => void;
  setStyleId: (id: string) => void;
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
  addFile: () => {
    const { files } = get();
    if (files.length >= MAX_FILES) return;
    const next = DEMO_POOL[files.length % DEMO_POOL.length];
    set({ files: [...files, { ...next, id: `f${Date.now()}` }] });
  },
  setNote: (note) => set({ note }),
  setMediaKind: (mediaKind) => set({ mediaKind }),
  setStyleId: (styleId) => set({ styleId }),
  reset: () =>
    set({
      files: DEMO_POOL.slice(0, 3).map((f, i) => ({ ...f, id: `f${i}` })),
      note: '',
      mediaKind: 'photo',
      styleId: 'warm',
    }),
}));
