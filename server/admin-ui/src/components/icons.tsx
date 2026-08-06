// Minimal stroke icon set (Feather-style geometry) — no icon library dep.

const PATHS: Record<string, React.ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  bookings: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 11h16" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 20c.6-3.4 2.9-5 5.5-5s4.9 1.6 5.5 5" />
      <path d="M16 8.5a3 3 0 1 0 0-5.9M17.5 15.2c2 .5 3.2 1.9 3.6 4.3" />
    </>
  ),
  creators: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  payouts: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <circle cx="12" cy="13" r="2.8" />
      <path d="M3 11h3M18 15h3" />
    </>
  ),
  disputes: (
    <>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17.2v.3" />
    </>
  ),
  moderation: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.37.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.37 2.54a7 7 0 0 0-2.42 1.4l-2.37-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.37-.95a7 7 0 0 0 2.42 1.4l.37 2.54h3.4l.37-2.54a7 7 0 0 0 2.42-1.4l2.37.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z" />
    </>
  ),
  legal: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
    </>
  ),
  audit: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21M10.5 7.5v3l2 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: (
    <>
      <path d="M14 4H6v16h8" />
      <path d="M10 12h10M17 9l3 3-3 3" />
    </>
  ),
};

export function Icon({ name, size = 17 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
