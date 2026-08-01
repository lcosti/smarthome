-- Phase 5, part two: today's calendar, cached from Google.
--
-- The wall dashboard's schedule card needs "what else is happening today". That
-- lives in the family's Google Calendar, which no browser can read offline and no
-- client should hold credentials for. So an Edge Function
-- (supabase/functions/sync-calendar) reads Google with a service account every few
-- minutes and writes rows here; the client syncs this table like any other and
-- renders from its local copy. The cache is not an optimisation — it is the only
-- reason the board can show a schedule with the wifi down.
--
-- This is the first table in the app that clients only ever READ. Every other
-- table is client-writable and converges by last-write-wins; this one has a single
-- writer holding the service role, so there is nothing to converge. The absence of
-- insert and update policies below is the enforcement.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.calendar_events (
  -- uuidv5 of (calendar id, Google event id), minted by the function. The same
  -- Google event therefore always lands on the same row, which is what makes the
  -- sync an idempotent upsert rather than a diff — exactly the trick attendance
  -- and ingredient aliases use, for the same reason.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  -- Whose event it is, or null for a shared household one ("bins out"). Resolved
  -- by the function from its calendar-to-person configuration; `set null` so
  -- removing a person leaves their events on the board rather than deleting
  -- history out from under it.
  person_id uuid references public.people(id) on delete set null,
  calendar_id text not null,
  google_event_id text not null,
  title text not null default '',
  all_day boolean not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The local calendar date, stored rather than derived. The board asks "what is
  -- on today", and answering that from a timestamptz means converting in the
  -- client's timezone at read time — which is right until the tablet's clock is on
  -- UTC, or the query runs at 23:30 BST. The function has already decided which
  -- household day this belongs to; that decision is recorded here.
  --
  -- end_date is exclusive, matching Google's own convention for all-day events, so
  -- a one-day event has end_date = start_date + 1 and a multi-day event spans
  -- start_date <= d < end_date.
  start_date date not null,
  end_date date not null,
  -- Google's own last-modified stamp, used only to skip unchanged rows on a sync
  -- run. Without it every run would rewrite every event, and every rewrite would
  -- be broadcast to every device over realtime — a lot of traffic to say nothing.
  google_updated_at timestamptz,
  -- Cancelled, or simply gone from the window Google returns. Soft, like every
  -- other deletion here, so devices learn about it through the ordinary row-update
  -- path instead of having to notice an absence.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_household_id_idx on public.calendar_events (household_id);
-- The board only ever reads a day or two at a time.
create index calendar_events_household_date_idx
  on public.calendar_events (household_id, start_date);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.calendar_events enable row level security;

create policy "member reads calendar events" on public.calendar_events
  for select to authenticated using (public.is_member(household_id));

-- Deliberately no insert or update policies for `authenticated`. The sync function
-- writes with the service role, which bypasses RLS; a client that tried to commit
-- a calendar row would be rejected, and the client-side store has no write path to
-- try it with.
grant select on public.calendar_events to authenticated;
grant all on public.calendar_events to service_role;

alter publication supabase_realtime add table public.calendar_events;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- The sync runs from pg_cron rather than from config.toml, which has no cron
-- support in the pinned CLI, and rather than from another GitHub Action, which
-- would mean holding a Supabase secret in a second place.
--
-- This does NOT replace .github/workflows/keepalive.yml, and that workflow must
-- stay: a cron job inside a paused database cannot unpause it. The external ping
-- is what keeps the project awake; this job is what keeps the calendar fresh.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The job reads its target and its shared secret from Vault at run time. Nothing
-- sensitive is committed, and a local `supabase db reset` — where those secrets do
-- not exist — creates a job whose body is a no-op rather than one that errors
-- every five minutes.
--
-- One-time setup on the hosted project, after deploying the function:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/sync-calendar',
--     'sync_calendar_url');
--   select vault.create_secret('<a long random string>', 'sync_calendar_secret');
--
-- and the matching function secrets:
--
--   supabase secrets set SYNC_SECRET='<the same random string>' \
--     GOOGLE_SERVICE_ACCOUNT="$(cat service-account.json)" \
--     GOOGLE_CALENDARS='[{"calendarId":"family@group.calendar.google.com","person":null}]'
--
-- Until those exist the job fires and does nothing, which is the correct
-- behaviour for a household that has not connected a calendar yet.
--
-- If the board says "no calendar" and you believe it should not, do not start
-- here: read public.calendar_sync_status, added by 20260801000008, which records
-- what the last run did and why it stopped. This job is replaced there too.
select cron.schedule(
  'sync-calendar',
  -- Five minutes. A wall board showing a schedule five minutes stale is fine, and
  -- ~8.6k invocations a month is noise against the free tier's 500k.
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'sync_calendar_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'sync_calendar_secret')),
      body := '{}'::jsonb)
    where exists (select 1 from vault.decrypted_secrets where name = 'sync_calendar_url')
  $$
);
