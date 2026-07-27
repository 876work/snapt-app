import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Phase 0: real Supabase auth when env is set, mock mode otherwise so the
// app stays fully tappable without a backend (frontend-first decision).
// Local values come from `supabase start`; set them in .env at the repo root:
//   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
