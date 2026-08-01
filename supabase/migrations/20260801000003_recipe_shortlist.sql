-- The shortlist: recipes the household fancies soon.
--
-- The generator picks from the whole library, which is right, but it has no way
-- of knowing that somebody saw a risotto on Tuesday and wants it this week. This
-- is that input — a standing "cook soon" mark that survives the week rolling
-- over, and the strongest single thing a person can say to the scorer without
-- planning a night themselves.
--
-- A column on `recipes` rather than a table of its own, deliberately. A shortlist
-- entry has no attributes: it is one bit and a timestamp about a recipe that is
-- already household-scoped, already synced, already cached in Dexie and already
-- covered by the recipes RLS policies. A join table would buy nothing and would
-- cost a pull ordering, a realtime subscription, a Dexie store and four policies.
--
-- Nullable timestamp rather than a boolean, on the same reasoning as `deleted_at`
-- everywhere else here: null is the resting state, and when it is set it answers
-- "since when" for free — which is what orders the shortlist for anyone reading
-- it, without a second column.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and the whole row is upserted, so shortlisting offline queues as
-- an ordinary last-write-wins snapshot. Two phones shortlisting the same recipe
-- converge on the same end state, which is the property that makes this safe.

alter table public.recipes
  add column shortlisted_at timestamptz;

comment on column public.recipes.shortlisted_at is
  'When somebody put this on the shortlist, or null. A strong bonus in the weekly generator''s scoring — see WEIGHTS.shortlistBonus in app/utils/generator.ts.';

-- No index. A household library is tens of rows, every device holds all of them
-- in memory, and the shortlist is read by filtering that array — never by a
-- query against this column.
