-- Snapt Phase 0 — core data model (handoff §4).
-- Business values live in app_config (seed.sql), not in constraints, so they
-- stay admin-editable per handoff §0/§6.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type app_mode as enum ('client', 'creator');
create type occasion as enum ('Events', 'Portraits', 'Social', 'Family', 'Wedding');
create type media_kind as enum ('photo', 'video', 'both');
create type booking_type as enum ('in_person', 'remote');
create type booking_status as enum
  ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'disputed');
create type vetting_status as enum
  ('not_started', 'in_review', 'approved', 'rejected', 'suspended');
create type background_check_status as enum
  ('not_started', 'pending', 'passed', 'failed', 'expired');
create type transaction_type as enum ('charge', 'refund', 'cancellation_fee', 'no_show_charge');
create type transaction_status as enum ('pending', 'succeeded', 'failed');
create type payout_status as enum ('pending', 'held', 'available', 'paid_out', 'clawed_back');
create type strike_type as enum ('cancellation', 'late_cancellation', 'no_show');
create type dispute_category as enum ('quality', 'fulfillment', 'conduct', 'appeal');
create type dispute_status as enum
  ('open', 'evidence_window', 'under_review', 'resolved', 'appealed', 'closed');
create type safety_report_type as enum ('sos', 'safety_concern', 'end_session');
create type safety_queue_status as enum ('new', 'acknowledged', 'escalated', 'resolved');
create type notification_channel as enum ('push', 'in_app', 'sms');
create type notification_category as enum
  ('bookings', 'messages', 'promotions', 'safety', 'account');
create type policy_doc_status as enum ('draft', 'published', 'archived');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- App configuration (handoff §5 confirmed values + §6 open values)
-- ---------------------------------------------------------------------------

create table app_config (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  -- §6 values are working defaults; false = do not build financial/legal
  -- logic against this number until Don confirms it.
  confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger app_config_updated_at before update on app_config
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  mode app_mode not null default 'client',
  currency text not null default 'USD' check (currency in ('USD', 'XCD')),
  avatar_url text,
  -- Minimal preference set per handoff §13; critical alerts are not a
  -- preference (non-toggleable bucket) so they are deliberately absent here.
  notification_prefs jsonb not null default
    '{"order_updates": true, "messages": true, "booking_reminders": true, "promotions": true}',
  push_permission jsonb not null default '{"primed": false, "granted": null}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row on signup.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  phone text not null,
  relationship text,
  created_at timestamptz not null default now()
);
create index emergency_contacts_user_idx on emergency_contacts (user_id);

-- ---------------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------------

create table creator_profiles (
  user_id uuid primary key references profiles (id) on delete cascade,
  vetting_status vetting_status not null default 'not_started',
  background_check_status background_check_status not null default 'not_started',
  background_check_completed_at timestamptz,
  -- §12: required (>=1) at application, same category set as client Occasion.
  -- Matching must EXCLUDE creators lacking the booking's occasion (§7/§12).
  specialties occasion[] not null check (cardinality(specialties) >= 1),
  service_radius_km numeric,
  base_area text,
  bio text,
  -- Weekly availability template + one-off blocked dates. The real
  -- slot-availability engine is Phase 1; this is just the storage shape.
  availability jsonb not null default '{}',
  blocked_dates date[] not null default '{}',
  -- Verified badge is tied to completed background check (§11); maintained
  -- server-side, never client-writable.
  verified boolean not null default false,
  -- Promo fee rate override (e.g. 0.20). Null = standard rate from app_config.
  promo_fee_rate numeric check (promo_fee_rate > 0 and promo_fee_rate < 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger creator_profiles_updated_at before update on creator_profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Bookings & sessions
-- ---------------------------------------------------------------------------

create table bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id),
  -- Nullable until matched (§4).
  creator_id uuid references profiles (id),
  type booking_type not null,
  occasion occasion not null,
  media_kind media_kind not null default 'photo',
  duration_hours numeric,
  area text,
  meeting_point text,
  scheduled_at timestamptz,
  status booking_status not null default 'pending',
  reschedule_count int not null default 0,
  -- Pricing snapshot at time of booking (§4): line items, fee rates, and the
  -- XCD peg captured so later rate changes never alter an existing booking.
  price_usd numeric not null default 0,
  pricing_snapshot jsonb not null default '{}',
  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint remote_bookings_have_no_meeting_point
    check (type = 'in_person' or meeting_point is null)
);
create trigger bookings_updated_at before update on bookings
  for each row execute function set_updated_at();
create index bookings_client_idx on bookings (client_id, scheduled_at desc);
create index bookings_creator_idx on bookings (creator_id, scheduled_at desc);
create index bookings_status_idx on bookings (status);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  safety_code text,
  client_checked_in_at timestamptz,
  creator_checked_in_at timestamptz,
  safety_code_verified_at timestamptz,
  session_active_at timestamptz,
  session_ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

create table transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  user_id uuid not null references profiles (id),
  type transaction_type not null,
  status transaction_status not null default 'pending',
  amount_usd numeric not null,
  -- Display currency + peg rate at time of transaction (§4/§5).
  display_currency text not null default 'USD' check (display_currency in ('USD', 'XCD')),
  xcd_peg_rate numeric not null default 2.70,
  fees jsonb not null default '{}',
  stripe_payment_intent_id text,
  stripe_refund_id text,
  created_at timestamptz not null default now()
);
create index transactions_booking_idx on transactions (booking_id);
create index transactions_user_idx on transactions (user_id, created_at desc);

create table creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles (id),
  booking_id uuid not null references bookings (id),
  amount_usd numeric not null,
  -- Fee rate applied at payout time (standard or promo), snapshotted (§4).
  fee_rate_applied numeric not null,
  is_promo_rate boolean not null default false,
  status payout_status not null default 'pending',
  -- Holding window timestamps (§4). Hold = 7 days (payout_hold_days config),
  -- matching the dispute filing window exactly so no payout can precede a
  -- dispute — clawback scenario eliminated (Don's decision, 2026-07-26).
  hold_until timestamptz,
  available_at timestamptz,
  paid_out_at timestamptz,
  stripe_transfer_id text,
  created_at timestamptz not null default now()
);
create index creator_payouts_creator_idx on creator_payouts (creator_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reliability / strikes (§9)
-- ---------------------------------------------------------------------------

create table strikes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles (id),
  booking_id uuid references bookings (id),
  type strike_type not null,
  -- Late (<24h) cancellations count double (§5). No-shows are higher severity
  -- and can trigger immediate suspension — that is enforcement logic, not weight.
  weight int not null default 1,
  occurred_at timestamptz not null default now(),
  -- Rolling 60-day window (§5/§9): strikes decay automatically; standing
  -- queries filter on expires_at > now().
  expires_at timestamptz not null,
  contested boolean not null default false,
  overturned boolean not null default false,
  dispute_id uuid,
  created_at timestamptz not null default now()
);
create index strikes_creator_idx on strikes (creator_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- Disputes (§10)
-- ---------------------------------------------------------------------------

create table disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  opened_by uuid not null references profiles (id),
  category dispute_category not null,
  status dispute_status not null default 'open',
  description text not null default '',
  evidence_deadline_at timestamptz,
  resolution text,
  resolved_at timestamptz,
  -- Appeals route to a different reviewer than the original decision (§10).
  appeal_of uuid references disputes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger disputes_updated_at before update on disputes
  for each row execute function set_updated_at();
create index disputes_booking_idx on disputes (booking_id);

alter table strikes
  add constraint strikes_dispute_fk foreign key (dispute_id) references disputes (id);

create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes (id) on delete cascade,
  submitted_by uuid not null references profiles (id),
  kind text not null default 'text',
  content text not null,
  storage_path text,
  created_at timestamptz not null default now()
);
create index dispute_evidence_dispute_idx on dispute_evidence (dispute_id);

-- ---------------------------------------------------------------------------
-- Trust & safety (§11)
-- ---------------------------------------------------------------------------

create table safety_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id),
  reporter_id uuid not null references profiles (id),
  type safety_report_type not null,
  details text,
  -- SOS-level reports need real-time on-call escalation, not just a queue
  -- entry (§11/§13) — that dispatcher is Phase 4; the state lives here.
  queue_status safety_queue_status not null default 'new',
  escalated_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index safety_reports_queue_idx on safety_reports (queue_status, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications (§13)
-- ---------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- Trigger type slug from 11_Notification_Trigger_Mapping.md (~30 types).
  trigger_type text not null,
  category notification_category not null,
  title text not null,
  body text not null default '',
  channels notification_channel[] not null default '{in_app}',
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Legal & policy content (§14)
-- ---------------------------------------------------------------------------

create table policy_documents (
  id uuid primary key default gen_random_uuid(),
  -- Slugs match the app's Legal section (lib/mock/legal.ts).
  doc_type text not null check (doc_type in (
    'terms', 'privacy', 'cancellation', 'creator-agreement', 'trust-safety',
    'content-usage', 'payment-payout', 'data-retention', 'minor-safety',
    'dispute-resolution', 'background-check', 'accessibility', 'notifications'
  )),
  version int not null default 1,
  title text not null,
  content text not null,
  -- Draft vs published is required workflow (§14): drafts need lawyer review
  -- before any version reaches real users.
  status policy_doc_status not null default 'draft',
  published_at timestamptz,
  -- Material changes to creator-agreement / background-check force re-consent (§14).
  requires_reconsent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (doc_type, version)
);

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  policy_document_id uuid not null references policy_documents (id),
  -- Snapshot so the consent record survives doc edits (§14: dispute-grade audit).
  doc_type text not null,
  version int not null,
  consented_at timestamptz not null default now(),
  unique (user_id, policy_document_id)
);
create index consent_records_user_idx on consent_records (user_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Principle: clients/creators read their own rows; all state transitions with
-- financial or enforcement consequences (booking status, fees, payouts,
-- strikes, disputes resolution) happen server-side via the service role,
-- which bypasses RLS. Handoff §8: fee-tier calculation must run server-side.

alter table app_config enable row level security;
alter table profiles enable row level security;
alter table emergency_contacts enable row level security;
alter table creator_profiles enable row level security;
alter table bookings enable row level security;
alter table sessions enable row level security;
alter table transactions enable row level security;
alter table creator_payouts enable row level security;
alter table strikes enable row level security;
alter table disputes enable row level security;
alter table dispute_evidence enable row level security;
alter table safety_reports enable row level security;
alter table notifications enable row level security;
alter table policy_documents enable row level security;
alter table consent_records enable row level security;

-- Config is public (fees shown at checkout pre-login).
create policy "config readable by everyone" on app_config
  for select using (true);

-- Profiles: own row, plus basic info of approved creators (assignment cards).
create policy "read own profile" on profiles
  for select using (auth.uid() = id);
create policy "read approved creator profiles" on profiles
  for select using (exists (
    select 1 from creator_profiles cp
    where cp.user_id = profiles.id and cp.vetting_status = 'approved'
  ));
create policy "update own profile" on profiles
  for update using (auth.uid() = id);

create policy "own emergency contacts" on emergency_contacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Creator profiles: own row full access to safe fields (column-level control
-- is server-side; vetting/verified transitions are service-role only in
-- practice because the API owns them — Phase 1 moves approval server-side).
create policy "read own creator profile" on creator_profiles
  for select using (auth.uid() = user_id);
create policy "read approved creator profiles public" on creator_profiles
  for select using (vetting_status = 'approved');
create policy "apply as creator" on creator_profiles
  for insert with check (auth.uid() = user_id);
create policy "update own creator profile" on creator_profiles
  for update using (auth.uid() = user_id);

-- Bookings: participants read; clients create their own pending bookings.
-- No user-side update policy: cancellation/reschedule/no-show run through the
-- API so fee tiers are computed server-side (§8).
create policy "participants read bookings" on bookings
  for select using (auth.uid() = client_id or auth.uid() = creator_id);
create policy "clients create own bookings" on bookings
  for insert with check (auth.uid() = client_id and status = 'pending');

create policy "participants read sessions" on sessions
  for select using (exists (
    select 1 from bookings b
    where b.id = sessions.booking_id
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));

create policy "own transactions" on transactions
  for select using (auth.uid() = user_id);

create policy "own payouts" on creator_payouts
  for select using (auth.uid() = creator_id);

-- Strikes: admin + notification only per §9 — no client/creator read policy.

-- Disputes: parties read; either party may open one against their booking.
create policy "parties read disputes" on disputes
  for select using (exists (
    select 1 from bookings b
    where b.id = disputes.booking_id
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));
create policy "parties open disputes" on disputes
  for insert with check (
    auth.uid() = opened_by and exists (
      select 1 from bookings b
      where b.id = disputes.booking_id
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );

create policy "parties read evidence" on dispute_evidence
  for select using (exists (
    select 1 from disputes d
    join bookings b on b.id = d.booking_id
    where d.id = dispute_evidence.dispute_id
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));
create policy "parties submit evidence" on dispute_evidence
  for insert with check (
    auth.uid() = submitted_by and exists (
      select 1 from disputes d
      join bookings b on b.id = d.booking_id
      where d.id = dispute_evidence.dispute_id
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );

-- Safety reports: session participants can file; reporter can read their own.
create policy "reporter reads own safety reports" on safety_reports
  for select using (auth.uid() = reporter_id);
create policy "participants file safety reports" on safety_reports
  for insert with check (
    auth.uid() = reporter_id and exists (
      select 1 from sessions s
      join bookings b on b.id = s.booking_id
      where s.id = safety_reports.session_id
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );

create policy "own notifications" on notifications
  for select using (auth.uid() = user_id);
create policy "mark own notifications read" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Published policies are public (legal screens render pre-login too).
create policy "published policies are public" on policy_documents
  for select using (status = 'published');

create policy "read own consents" on consent_records
  for select using (auth.uid() = user_id);
create policy "record own consent" on consent_records
  for insert with check (auth.uid() = user_id);
