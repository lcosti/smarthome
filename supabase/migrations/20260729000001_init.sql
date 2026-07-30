-- Phase 1: the shopping list. Households, people, aisles, items.
--
-- Two conventions matter here and are relied on by the offline layer:
--
--   1. Ids for `aisles` and `shopping_list_items` are minted on the device with
--      crypto.randomUUID(), so rows can be created in airplane mode and upserted
--      later. Those tables deliberately have no id default.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key; a server-side trigger would make every
--      echo look newer than the local write it came from.
--
-- Deletes are soft (`deleted_at`) so that every mutation the client queues is a
-- plain idempotent full-row upsert.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Ambiguous characters (I, O, 0, 1) omitted: this gets read aloud across a kitchen.
create function public.gen_invite_code() returns text
language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1),
    ''
  )
  from generate_series(1, 6)
$$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default public.gen_invite_code(),
  created_at timestamptz not null default now()
);

-- People are not auth users. Adults who sign in get an auth_user_id; children and
-- babies are rows with no login. A row with auth_user_id set IS the household
-- membership record — there is no separate members table.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  -- Life stage is derived from this at query time, never stored as a label.
  date_of_birth date,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index people_household_id_idx on public.people (household_id);

create table public.aisles (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index aisles_household_id_idx on public.aisles (household_id);

create table public.shopping_list_items (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  -- Free text on purpose: "2", "1 tin", "a bunch". Phase 3 canonicalises.
  quantity text,
  aisle_id uuid references public.aisles(id) on delete set null,
  checked boolean not null default false,
  checked_at timestamptz,
  -- Phase 2 adds 'plan' plus a plan-entry provenance column.
  source text not null default 'adhoc' check (source in ('adhoc', 'plan')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shopping_list_items_household_id_idx on public.shopping_list_items (household_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- security definer so that policies on `people` can query `people` without
-- recursing into their own RLS check.
create function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.people
    where household_id = hid
      and auth_user_id = (select auth.uid())
  )
$$;

alter table public.households enable row level security;
alter table public.people enable row level security;
alter table public.aisles enable row level security;
alter table public.shopping_list_items enable row level security;

-- Households and people are read-only to clients; both are written through the
-- bootstrap functions below.
create policy "member reads own household" on public.households
  for select to authenticated using (public.is_member(id));

create policy "member reads household people" on public.people
  for select to authenticated using (public.is_member(household_id));

create policy "member reads aisles" on public.aisles
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts aisles" on public.aisles
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates aisles" on public.aisles
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads items" on public.shopping_list_items
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts items" on public.shopping_list_items
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates items" on public.shopping_list_items
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies anywhere: deletion is `deleted_at`, which is an update.

grant select on public.households to authenticated;
grant select on public.people to authenticated;
grant select, insert, update on public.aisles to authenticated;
grant select, insert, update on public.shopping_list_items to authenticated;

-- The service key bypasses RLS but still needs table privileges. Without this the
-- keepalive function cannot read `households`, returns 500, and the project
-- quietly pauses after its next idle week.
grant all on public.households to service_role;
grant all on public.people to service_role;
grant all on public.aisles to service_role;
grant all on public.shopping_list_items to service_role;

-- `anon` is granted nothing: an unauthenticated client only ever talks to /auth.

-- ---------------------------------------------------------------------------
-- Household bootstrap
-- ---------------------------------------------------------------------------
-- These are security definer because a household and its first person have to be
-- created before any membership exists to authorise against. Keeping them as
-- functions means `households` and `people` need no insert policies at all.

create function public.create_household(hname text, pname text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.people where auth_user_id = uid) then
    raise exception 'already a member of a household';
  end if;

  insert into public.households (name) values (trim(hname)) returning id into hid;

  insert into public.people (household_id, name, auth_user_id)
  values (hid, trim(pname), uid);

  insert into public.aisles (id, household_id, name, sort_order)
  select gen_random_uuid(), hid, d.name, d.ord
  from (values
    ('Fruit & veg', 1),
    ('Bakery', 2),
    ('Chilled', 3),
    ('Meat & fish', 4),
    ('Frozen', 5),
    ('Cupboard', 6),
    ('Household', 7)
  ) as d(name, ord);

  return hid;
end $$;

create function public.join_household(code text, pname text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.people where auth_user_id = uid) then
    raise exception 'already a member of a household';
  end if;

  select id into hid from public.households
  where invite_code = upper(trim(code));

  if hid is null then
    raise exception 'no household with that invite code';
  end if;

  insert into public.people (household_id, name, auth_user_id)
  values (hid, trim(pname), uid);

  return hid;
end $$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- postgres_changes honours RLS, so members only ever receive their own rows.

alter publication supabase_realtime add table public.aisles;
alter publication supabase_realtime add table public.shopping_list_items;
