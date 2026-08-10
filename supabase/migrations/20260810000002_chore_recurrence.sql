-- Chores that are not every week.
--
-- 20260801000009_chores.sql shipped two shapes: a weekly rule and a one-off.
-- That covers "bins on a Tuesday" and "fix the gate on Saturday", and misses the
-- next two things a household recites out loud — "recycling, every other
-- Tuesday" and "smoke alarms, first Sunday of the month". Both are rules rather
-- than dates, so both belong here rather than as a one-off somebody has to
-- remake every fortnight.
--
-- Occurrences are still never stored. app/utils/chores.ts answers "does this
-- rule fall on this date" at read time, which is the whole reason a tablet that
-- has been in airplane mode for a fortnight is still right when it wakes up, and
-- widening the rule does not change that — there is still nothing minting rows
-- forward and nothing to catch up on.
--
-- `rule` is an explicit discriminator, which the first migration deliberately
-- did without: with two shapes, "due_date is not null" told you which one you
-- had, and the editor reads exactly that. With four it does not. Monthly has two
-- sub-shapes of its own, so a row half-filled by an older client would otherwise
-- be a chore that silently never occurs rather than one that is obviously
-- wrong. It defaults to 'weekly' and is backfilled from what the two existing
-- shapes already say, so every row written before today keeps its meaning
-- exactly.
--
-- Still no check constraints and no unique constraints, for the reason set out
-- at length in the original migration: a 23514 is a permanent error, so a write
-- that trips one burns its retries, gets dropped, and leaves that device holding
-- a chore the server has never seen. 'weekly' with no weekdays, or 'monthly'
-- with nothing said about the month, is a row that occurs on no day — visible
-- and fixable — rather than a sync queue that has quietly lost somebody's work.
-- The store refuses those, and the editor makes the store's refusal
-- unreachable.
--
-- Every column is nullable and additive, so an older tab left open on the
-- kitchen tablet goes on writing weekly chores through the same full-row upsert
-- without knowing any of this exists.

alter table public.chores
  add column if not exists rule text not null default 'weekly',
  add column if not exists week_interval smallint,
  add column if not exists anchor_date date,
  add column if not exists month_day smallint,
  add column if not exists month_week smallint,
  add column if not exists month_weekday smallint;

-- Every existing row is one of the two original shapes, and which one it is has
-- always been readable off due_date. This is that reading, written down once.
update public.chores
  set rule = 'once'
  where due_date is not null and rule = 'weekly';

comment on column public.chores.rule is
  'Which shape this chore is: ''weekly'' (weekdays, every week_interval weeks), ''monthly'' (month_day, or month_week + month_weekday), ''once'' (due_date). Not constrained here on purpose — see the header of this migration. app/utils/chores.ts is where a rule becomes a day.';

comment on column public.chores.week_interval is
  'Weeks between occurrences of a weekly rule. Null or 1 is every week; 2 is every other week. Phased off anchor_date.';

comment on column public.chores.anchor_date is
  'The week an every-other-week rule starts in, and so which of the two weeks is the one it runs in. Moving it by a week flips the fortnight. A rule does not occur before it.';

comment on column public.chores.month_day is
  'Day of the month, 1-31. A day past the end of a short month falls back to that month''s last day, so the 31st is 28 February — "every month" means every month.';

comment on column public.chores.month_week is
  'Which occurrence of month_weekday in the month: 1-4, or -1 for the last one. The editor offers first to fourth and last, so "the fifth Monday" is not expressible and needs no clamping.';

comment on column public.chores.month_weekday is
  'ISO weekday, 1 = Monday .. 7 = Sunday, paired with month_week. Separate from the weekdays array, which is the weekly rule''s and is read by a different branch.';

-- No index. A household has a handful of chores, every device holds all of them
-- in memory, and the only question ever asked of them is answered in JavaScript
-- two days at a time.
