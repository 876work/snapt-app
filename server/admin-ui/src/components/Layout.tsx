import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../auth';
import { CommandPalette } from './CommandPalette';
import { GlobalSearch } from './GlobalSearch';
import { Icon } from './icons';
import { Pill } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

// Sidebar order mirrors how the business is run day to day.
const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: 'today', roles: ['admin', 'support'] },
  { to: '/bookings', label: 'Bookings', icon: 'bookings', roles: ['admin', 'support'] },
  { to: '/users', label: 'Users', icon: 'users', roles: ['admin', 'support'] },
  { to: '/creators', label: 'Creators', icon: 'creators', roles: ['admin', 'support'] },
  { to: '/payouts', label: 'Payouts', icon: 'payouts', roles: ['admin', 'support'] },
  { to: '/disputes', label: 'Disputes', icon: 'disputes', roles: ['admin', 'support'] },
  { to: '/moderation', label: 'Moderation', icon: 'moderation', roles: ['admin', 'moderator'] },
  { to: '/config', label: 'Config', icon: 'config', roles: ['admin'] },
  { to: '/legal', label: 'Legal', icon: 'legal', roles: ['admin'] },
  { to: '/analytics', label: 'Analytics', icon: 'analytics', roles: ['admin', 'support'] },
  { to: '/audit', label: 'Audit log', icon: 'audit', roles: ['admin', 'support'] },
  { to: '/team', label: 'Team', icon: 'users', roles: ['admin'] },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

/** Keycap hint for the command palette — a shortcut chip, not a sentence. */
function PaletteKey() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <button
      className="kbd"
      title="Command palette"
      onClick={() => window.dispatchEvent(new Event('snapt:open-palette'))}
    >
      {isMac ? '⌘K' : 'Ctrl+K'}
    </button>
  );
}

export function Layout() {
  const { identity, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  if (!identity) return null;
  const items = navItemsFor(identity.role);

  return (
    <div className="shell">
      <aside className={`sidebar${drawer ? ' open' : ''}`}>
        <div className="logo">
          <span className="dot">S</span> Snapt Admin
        </div>
        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setDrawer(false)}
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          <div className="profile-block">
            <div className="who-row">
              <div className="initial">{(identity.name || identity.email || '?').trim().charAt(0).toUpperCase()}</div>
              <div className="ident">
                <div className="pname">{identity.name || 'Signed in'}</div>
                {identity.email && <div className="pemail">{identity.email}</div>}
              </div>
            </div>
            <div className="actions-row">
              <Pill status={identity.role} />
              <button className="signout" onClick={logout}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          {identity.role !== 'moderator' && <GlobalSearch key={location.pathname} />}
          <PaletteKey />
        </header>
        <main className="content">
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    </div>
  );
}
