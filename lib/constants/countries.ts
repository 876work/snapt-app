import { allCountries } from 'country-telephone-data';

// All 250 countries with dial codes for the phone country-code picker.
// Snapt itself is live in Saint Lucia only (the COUNTRY field is locked),
// but the phone selector deliberately offers every country per the design.

export interface Country {
  name: string;
  iso2: string;
  dialCode: string;
  flag: string;
}

/** ISO-3166 alpha-2 → emoji flag via Unicode regional indicators. */
export function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)));
}

export const COUNTRIES: Country[] = allCountries
  .map((c) => ({ name: c.name.replace(/ \(.*\)$/, ''), iso2: c.iso2, dialCode: c.dialCode, flag: flagEmoji(c.iso2) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const SAINT_LUCIA: Country = COUNTRIES.find((c) => c.iso2 === 'lc') ?? {
  name: 'Saint Lucia',
  iso2: 'lc',
  dialCode: '1758',
  flag: flagEmoji('lc'),
};
