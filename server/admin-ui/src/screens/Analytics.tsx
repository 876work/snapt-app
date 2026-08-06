import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { EmptyState, SectionSkeleton, formatMoney } from '../components/ui';

interface AnalyticsData {
  bookings: { pending: number; confirmed: number; completed: number; cancelled: number; disputed: number };
  money: { charged_usd: number; refunded_usd: number };
  creators: { approved: number; in_review: number };
  open_disputes: number;
  active_strikes: number;
}

export function Analytics() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => api<AnalyticsData>('/v1/admin/analytics'),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <>
        <h1 className="page-title">Analytics</h1>
        <SectionSkeleton rows={4} />
      </>
    );
  }
  if (isError || !data) {
    return (
      <>
        <h1 className="page-title">Analytics</h1>
        <EmptyState glyph="⚠">{(error as Error | undefined)?.message ?? 'Unavailable'}</EmptyState>
      </>
    );
  }

  const totalBookings = Object.values(data.bookings).reduce((s, n) => s + n, 0);

  return (
    <>
      <h1 className="page-title">Analytics</h1>
      <p className="page-sub">Platform counters, straight off the shared data model.</p>

      <div className="section">
        <h2>Money</h2>
        <div className="tiles">
          <div className="card tile">
            <div className="value num">{formatMoney(data.money.charged_usd)}</div>
            <div className="label">charged lifetime</div>
          </div>
          <div className="card tile">
            <div className="value num">{formatMoney(data.money.refunded_usd)}</div>
            <div className="label">refunded lifetime</div>
          </div>
          <div className="card tile">
            <div className="value num">{formatMoney(data.money.charged_usd - data.money.refunded_usd)}</div>
            <div className="label">net</div>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Bookings · {totalBookings} total</h2>
        <div className="tiles">
          {(Object.entries(data.bookings) as [string, number][]).map(([k, v]) => (
            <div className="card tile" key={k}>
              <div className="value num">{v}</div>
              <div className="label">{k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Health</h2>
        <div className="tiles">
          <div className="card tile">
            <div className="value num">{data.creators.approved}</div>
            <div className="label">approved creators</div>
          </div>
          <div className="card tile">
            <div className="value num">{data.creators.in_review}</div>
            <div className="label">applications in review</div>
          </div>
          <div className="card tile">
            <div className="value num">{data.open_disputes}</div>
            <div className="label">open disputes</div>
          </div>
          <div className="card tile">
            <div className="value num">{data.active_strikes}</div>
            <div className="label">active strikes</div>
          </div>
        </div>
      </div>
    </>
  );
}
