import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import en from '../locales/en';

/**
 * SCAFFOLDING, NOT A TRANSLATION.
 *
 * English is the only locale and nothing here is translated. The point is
 * that adding French or Dutch later becomes a data change rather than a
 * rewrite of every screen — retrofitting i18n across a finished app is
 * dramatically more painful than leaving the seam open now.
 *
 * DELIBERATELY PARTIAL. Only auth, the booking flow and error messages are
 * extracted. Sweeping every string into t('booking.summary.usdNote') would
 * make the copy harder to read and edit, and the copy is the product — much
 * of it was written and rewritten this month. The rest can move screen by
 * screen, and because that is pure JS it needs no rebuild.
 *
 * `enableFallback` means a missing key renders the English string rather than
 * the key itself: a half-translated French build shows English words, never
 * "booking.summary.title".
 */
const i18n = new I18n({ en });

i18n.enableFallback = true;
i18n.defaultLocale = 'en';

/**
 * Device language, ignoring region — 'fr-MQ' (Martinique) and 'fr-FR' both
 * want French. Falls back to English when the device reports nothing usable.
 */
const deviceLanguage = getLocales()?.[0]?.languageCode ?? 'en';
i18n.locale = deviceLanguage;

/** Every locale the app currently ships. Add here when translations land. */
export const SUPPORTED_LOCALES = ['en'] as const;

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

/** For a future language switcher; today it only ever holds 'en'. */
export function setLocale(locale: string): void {
  i18n.locale = locale;
}

export function currentLocale(): string {
  return i18n.locale;
}

export default i18n;
