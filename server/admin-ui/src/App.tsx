import { Navigate, Route, Routes } from 'react-router-dom';
import { Promotions } from './screens/Promotions';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import { Login } from './screens/Login';
import { SetPassword } from './screens/SetPassword';
import { Today } from './screens/Today';
import { Users } from './screens/Users';
import { UserDetail } from './screens/UserDetail';
import { Creators } from './screens/Creators';
import { CreatorDetail } from './screens/CreatorDetail';
import { Bookings } from './screens/Bookings';
import { BookingDetail } from './screens/BookingDetail';
import { Payouts } from './screens/Payouts';
import { Disputes } from './screens/Disputes';
import { Moderation } from './screens/Moderation';
import { Config } from './screens/Config';
import { Legal } from './screens/Legal';
import { Audit } from './screens/Audit';
import { Analytics } from './screens/Analytics';
import { Team } from './screens/Team';

export function App() {
  const { identity, restoring } = useAuth();

  // Invite links land here from email — must work with no session at all.
  if (window.location.pathname.endsWith('/set-password')) return <SetPassword />;

  if (restoring) {
    // Validating a stored session — skeleton shell, not a blank page.
    return (
      <div style={{ padding: 40, display: 'grid', gap: 14, maxWidth: 700, margin: '0 auto' }}>
        <Skeleton h={28} w={200} />
        <Skeleton h={90} />
        <Skeleton h={90} />
        <Skeleton h={90} />
      </div>
    );
  }

  if (!identity) return <Login />;

  const home = identity.role === 'moderator' ? '/moderation' : '/';

  return (
    <Routes>
      <Route element={<Layout />}>
        {identity.role !== 'moderator' && <Route index element={<Today />} />}
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/bookings/:id" element={<BookingDetail />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/creators" element={<Creators />} />
        <Route path="/creators/:id" element={<CreatorDetail />} />
        <Route path="/payouts" element={<Payouts />} />
        <Route path="/disputes" element={<Disputes />} />
        <Route path="/moderation" element={<Moderation />} />
        <Route path="/config" element={<Config />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/audit" element={<Audit />} />
        {identity.role === 'admin' && <Route path="/promotions" element={<Promotions />} />}
        {identity.role === 'admin' && <Route path="/team" element={<Team />} />}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
