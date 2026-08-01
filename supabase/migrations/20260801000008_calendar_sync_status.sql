-- What the calendar sync last did, so "no calendar" stops meaning four things.
--
-- Before this table the only evidence a household had that its calendar worked was
-- the presence of rows in calendar_events. Absence of rows was therefore the single
-- symptom of: the migration never pushed, the vault secrets never created, the
-- shared secret mismatched, GOOGLE_CALENDARS unset, or the service account never
-- shared onto the calendar. Four of those five produce no log line anywhere and the
-- fifth is a console.error inside a function nobody is watching. The settings page
-- said "No calendar connected" for all of them, which is true and useless.
--
-- So the sync now records what happened on every run, the client syncs that row
-- like any other, and the screen reports it. A household that has genuinely not
-- connected a calendar still sees "no calendar" — but it sees it because the row
-- says outcome 'skipped', not because nothing arrived.
--
-- Second table in the app that clients only READ, on the same terms as
-- calendar_events (20260730000005): a single writer holding the service role,
-- nothing to converge, and the absence of insert and update policies is the
-- enforcement.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.calendar_sync_status (
  -- One row per household, but keyed by a surrogate id: the offline layer keys
  -- every cached row by `id` (see rowsOf/applyServerRow in app/stores/sync.ts), so
  -- a table keyed on household_id alone would need a special case in the one place
  -- that is deliberately generic. The uniqueness that actually matters is below.
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  ran_at timestamptz not null,
  -- 'ok'      — Google answered and the rows are current
  -- 'skipped' — nothing to do, and it is not a fault: no calendars configured,
  --             no household yet. This is the genuine "not connected" state.
  -- 'error'   — it tried and could not. `detail` says what Google or Postgres said.
  outcome text not null check (outcome in ('ok', 'skipped', 'error')),
  -- The message, shown to a human on the settings page. Not a code: whoever reads
  -- it is the person who can go and share a calendar with the service account, and
  -- what they need is the sentence Google returned.
  detail text,
  fetched integer,
  written integer,
  removed integer,
  -- Non-zero with outcome 'ok' is impossible; a calendar that failed makes the run
  -- an error even though the others were written, because the board is now showing
  -- a partial day and saying nothing about it.
  calendars_failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.calendar_sync_status enable row level security;

create policy "member reads calendar sync status" on public.calendar_sync_status
  for select to authenticated using (public.is_member(household_id));

-- Deliberately no insert or update policies for `authenticated`, for the same
-- reason as calendar_events: the sync function writes with the service role, and
-- the client-side store has no write path to try it with.
grant select on public.calendar_sync_status to authenticated;
grant all on public.calendar_sync_status to service_role;

alter publication supabase_realtime add table public.calendar_sync_status;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- The job from 20260730000005 is replaced rather than amended, because its body is
-- exactly the thing being fixed. That body was:
--
--   select net.http_post(...) where exists (select 1 from vault.decrypted_secrets
--                                           where name = 'sync_calendar_url')
--
-- which is correct — a local db reset with no vault entries must not error every
-- five minutes — but its failure mode is indistinguishable from success. The job
-- fires, the guard is false, nothing happens, cron.job_run_details records
-- 'succeeded'. A household whose vault secrets were never created gets a green tick
-- every five minutes forever.
--
-- So the guard now has an else branch. Same silence about credentials, same no-op
-- against the network, but it leaves a row saying which secret is missing.
select cron.unschedule('sync-calendar')
where exists (select 1 from cron.job where jobname = 'sync-calendar');

select cron.schedule(
  'sync-calendar',
  '*/5 * * * *',
  -- Two statements rather than one CTE. A plain (non data-modifying) CTE that
  -- nothing selects from is not guaranteed to be evaluated, so folding the POST
  -- into a `with posted as (select net.http_post(...))` would quietly stop calling
  -- the function at all — the exact class of bug this migration exists to remove.
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'sync_calendar_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'sync_calendar_secret')),
      body := '{}'::jsonb)
    where exists (select 1 from vault.decrypted_secrets where name = 'sync_calendar_url');

    insert into public.calendar_sync_status
      (household_id, ran_at, outcome, detail, calendars_failed)
    select
      h.id,
      now(),
      'error',
      case when not exists (select 1 from vault.decrypted_secrets
                            where name = 'sync_calendar_url')
        then 'Calendar sync is not set up on the server: the vault secret sync_calendar_url is missing, so the scheduled job has nothing to call. See supabase/migrations/20260730000005_calendar_events.sql.'
        else 'Calendar sync cannot authenticate: the vault secret sync_calendar_secret is missing. It must match the SYNC_SECRET function secret.'
      end,
      0
    from (select id from public.households order by created_at limit 1) h
    where not exists (select 1 from vault.decrypted_secrets
                      where name in ('sync_calendar_url', 'sync_calendar_secret')
                      having count(*) = 2)
    on conflict (household_id) do update set
      ran_at = excluded.ran_at,
      outcome = excluded.outcome,
      detail = excluded.detail,
      calendars_failed = excluded.calendars_failed,
      updated_at = now();
  $$
);
