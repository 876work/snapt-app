-- Didit identity verification (hosted sessions) for creator applications.
--
-- Didit holds the document and selfie IMAGES. We store only the session
-- reference, status, the extracted fields we actually need, and the face
-- match score — never mirrored images (the admin portal proxies them
-- server-side for review instead).
--
-- The verification INFORMS the admin decision; it never makes it.

create table verification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- Didit's session id (also our idempotency key for webhooks).
  didit_session_id text not null unique,
  document_type text not null check (document_type in ('ID', 'DL', 'P')),
  status text not null default 'Not Started',
  attempt int not null default 1,
  -- Extracted fields we need. NOT the images.
  extracted jsonb not null default '{}',
  face_match_score numeric,
  warnings jsonb not null default '[]',
  -- Age computed server-side from the document's DOB, never a typed field.
  date_of_birth date,
  is_18_plus boolean,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verification_sessions_user_idx on verification_sessions (user_id, created_at desc);
create trigger verification_sessions_updated_at before update on verification_sessions
  for each row execute function set_updated_at();

-- Webhook idempotency: Didit retries, and event_id is unique per delivery.
create table verification_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table creator_profiles
  -- Rolled-up state for the application screen and matching.
  add column verification_status text not null default 'not_started',
  add column verification_session_id uuid references verification_sessions (id),
  add column verification_attempts int not null default 0,
  -- Police certificate: upload + review surface exist now, "Coming soon";
  -- never required, never blocks approval.
  add column police_certificate_path text,
  -- Who decided, and did they agree with Didit's recommendation?
  add column vetting_decided_by uuid references profiles (id),
  add column vetting_decided_at timestamptz,
  add column vetting_agreed_with_didit boolean;

alter table verification_sessions enable row level security;
alter table verification_events enable row level security;
-- Service-role only: verification data never reaches a client directly.
