-- Private bucket for creator portfolio images (moderated before publish —
-- Policy 04 §6.2). Local Supabase Storage fallback; production uses
-- Cloudflare R2 via the server storage driver, same as the media buckets.
insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', false)
on conflict (id) do nothing;
