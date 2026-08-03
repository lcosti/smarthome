-- Staples: the things the house simply has.
--
-- Deriving a week put every recipe line on the shopping list, olive oil and salt
-- and ground cumin along with the chicken. Nobody buys those weekly, and a list
-- you have to read past is a list that loses to the WhatsApp group it replaced.
--
-- The flag lives on the canonical ingredient rather than on the recipe line or
-- the list row, because "we always have this" is a fact about the thing, not
-- about one recipe's use of it or one week's shop. Filing it here means one
-- toggle covers every recipe that has ever asked for oil, including the ones
-- imported next month.
--
-- Nothing about derivation changes. The rows are still written, one per (plan
-- entry, recipe line) — that is the unit last-write-wins reconciles and every
-- rule in app/utils/derive.ts is expressed in terms of it, and it is also what
-- keeps the pantry reservations honest. What changes is only how the list draws
-- them: app/utils/aggregate.ts collapses a staple's rows into one
-- "check the cupboard" line per aisle, in the same render-time way it already
-- collapses two recipes' tomatoes into one. Expand it and the rows are there to
-- tick, for the week you turn out to be out of butter.
--
-- A boolean rather than the nullable timestamp used for recipes.shortlisted_at:
-- nothing reads "staple since when", and there is no ordering to derive from it.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and upserts the whole row, so toggling this offline queues as an
-- ordinary last-write-wins snapshot.

alter table public.ingredients
  add column staple boolean not null default false;

comment on column public.ingredients.staple is
  'The house always has this. The shopping list collapses it into a check-the-cupboard row instead of a line of its own — see splitStaples in app/utils/aggregate.ts.';

-- A starter set, so this does something the day it lands rather than after
-- somebody walks the whole ingredient library flipping switches.
--
-- Exact matches on the normalised name only, against the canonical name or a
-- recorded alias. A fuzzy rule — anything containing "oil", anything ending
-- "powder" — would quietly swallow sesame oil and cocoa powder, and a staple
-- marked wrongly is worse than one left off: the one left off is a line you
-- read, the wrong one is a thing you get home without.
--
-- Nothing ambiguous is in here. Bare 'coriander', 'parsley', 'thyme', 'rosemary'
-- and 'ginger' are deliberately absent — as often as not they are the fresh
-- thing, which is a real line on a real shop. Only the ground and dried forms.
--
-- Every one of these is undone by one toggle in the ingredient editor, which is
-- the reason a list this opinionated is safe to ship.
--
-- `updated_at` is bumped so the flip travels as an ordinary inbound row on each
-- device's next pull, rather than losing last-write-wins to a cached copy.
with seed(name) as (values
  ('salt'), ('sea salt'), ('fine sea salt'), ('flaky sea salt'),
  ('table salt'), ('rock salt'), ('kosher salt'),
  ('pepper'), ('black pepper'), ('ground black pepper'), ('white pepper'),
  ('peppercorns'), ('black peppercorns'), ('salt and pepper'),
  ('oil'), ('olive oil'), ('extra virgin olive oil'), ('vegetable oil'),
  ('sunflower oil'), ('rapeseed oil'), ('cooking oil'), ('sesame oil'),
  ('butter'), ('unsalted butter'), ('salted butter'),
  ('vinegar'), ('white wine vinegar'), ('red wine vinegar'),
  ('balsamic vinegar'), ('cider vinegar'), ('apple cider vinegar'),
  ('rice vinegar'), ('malt vinegar'),
  ('soy sauce'), ('light soy sauce'), ('dark soy sauce'),
  ('worcestershire sauce'), ('fish sauce'), ('tabasco'), ('hot sauce'),
  ('mustard'), ('dijon mustard'), ('english mustard'), ('wholegrain mustard'),
  ('plain flour'), ('self-raising flour'), ('cornflour'), ('cornstarch'),
  ('baking powder'), ('bicarbonate of soda'), ('baking soda'),
  ('sugar'), ('caster sugar'), ('granulated sugar'), ('golden caster sugar'),
  ('honey'), ('water'), ('cold water'), ('boiling water'),
  ('stock cube'), ('stock cubes'), ('vegetable stock cube'),
  ('chicken stock cube'), ('beef stock cube'), ('vegetable bouillon'),
  ('ground cumin'), ('cumin'), ('cumin seeds'),
  ('ground coriander'), ('coriander seeds'),
  ('paprika'), ('smoked paprika'), ('ground turmeric'), ('turmeric'),
  ('ground cinnamon'), ('cinnamon'), ('cinnamon stick'), ('cinnamon sticks'),
  ('ground nutmeg'), ('nutmeg'), ('ground ginger'), ('ground allspice'),
  ('chilli powder'), ('chilli flakes'), ('dried chilli flakes'),
  ('red pepper flakes'), ('cayenne pepper'), ('curry powder'),
  ('garam masala'), ('chinese five spice'), ('ras el hanout'),
  ('dried oregano'), ('dried thyme'), ('dried rosemary'), ('dried basil'),
  ('dried parsley'), ('dried mint'), ('mixed herbs'), ('dried mixed herbs'),
  ('italian seasoning'), ('herbes de provence'),
  ('bay leaf'), ('bay leaves'), ('dried bay leaves'),
  ('mustard seeds'), ('fennel seeds'), ('cardamom pods'), ('cloves'),
  ('ground cloves'), ('star anise'), ('vanilla extract'), ('vanilla essence')
),
matched as (
  select i.id
    from public.ingredients i
    join seed s on lower(btrim(i.name)) = s.name
  union
  select a.ingredient_id
    from public.ingredient_aliases a
    join seed s on lower(btrim(a.alias)) = s.name
   where a.deleted_at is null
)
update public.ingredients i
   set staple = true,
       updated_at = now()
 where i.id in (select id from matched)
   and i.staple = false
   and i.deleted_at is null
   -- A merged-away row is nobody's ingredient now. Its winner matches on its
   -- own name if it deserves to.
   and i.merged_into is null;

-- No index. A household's ingredient library is hundreds of rows at most, every
-- device holds all of them in memory, and this column is only ever read by
-- filtering that map.
