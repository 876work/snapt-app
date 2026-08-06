import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import { Login } from './screens/Login';
import { Placeholder } from './screens/Placeholder';
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

export function App() {
  const { identity, restoring } = useAuth();

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
        <Route path="/config" element={<Placeholder title="Config" />} />
        <Route path="/legal" element={<Placeholder title="Legal" />} />
        <Route path="/analytics" element={<Placeholder title="Analytics" />} />
        <Route path="/audit" element={<Placeholder title="Audit log" legacy={false} />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
