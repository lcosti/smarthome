-- A photograph of the dish, taken in this kitchen, on the recipe's own row.
--
-- 20260731000002 gave recipes an `image_url` and argued for an address rather
-- than bytes: a recipe imported from a website already has a photograph sitting
-- on somebody else's CDN, and pointing at it costs this database nothing. That
-- reasoning holds, and that column is not going anywhere. It just does not
-- reach the recipes that need it most — the ones photographed out of a cookbook
-- on the shelf, and the ones typed in by hand. There is no address to store for
-- those, because the only picture that will ever exist is the one somebody takes
-- of the plate.
--
-- So the same call `people.avatar` made in 20260801000005, for the same reason:
-- the bytes, in a column, because they exist on one phone and nowhere else.
-- Storing them properly would mean a bucket, storage RLS, signed URLs, a cleanup
-- path on delete and — the part that actually matters here — a fetch. This app's
-- hard requirement is a kitchen tablet in airplane mode showing the right thing.
-- A column replicates through the sync layer that already exists: Dexie holds
-- it, Realtime carries it, and a device that has ever seen the row has the
-- picture too, forever, with no service worker cache entry to expire.
--
-- Two columns rather than one because they are two different things. `image_url`
-- is an address that can 404 the day the source site reorganises, which is why
-- RecipeImage.vue renders nothing at all on error. `photo` is bytes this
-- household owns and cannot lose. The client prefers `photo` where both exist,
-- so replacing an imported picture with your own is a write to one column and
-- removing yours falls back to theirs rather than to a blank page.
--
-- Sized by the client rather than trusted: utils/photo.ts encodes an 800px JPEG
-- at q0.8, which lands near 100 KB — enough for the aspect-video hero at the
-- tablet's widest, and the same bytes serve the 48px library thumbnail through
-- object-cover. The check constraint is roughly five times that, so it never
-- fires on a correctly encoded picture and does stop the pathological case: a
-- full-resolution camera dump pasted in by hand would be several megabytes
-- travelling through every realtime payload to every device in the house.
--
-- Nullable and staying that way. Most recipes here will never have a picture,
-- and the pages that show one are all built to collapse when there is none — a
-- recipe without a photograph is not a recipe with a missing field.
--
-- No index: nothing queries by it, and nothing ever will.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and the whole row is upserted, so this column travels with every
-- other edit to a recipe and resolves last-write-wins like the rest.

alter table public.recipes add column photo text;

alter table public.recipes
  add constraint recipes_photo_is_small
  check (photo is null or length(photo) <= 524288);

comment on column public.recipes.photo is
  'A JPEG data URL, written by the client at 800px on the long edge (see photoForRecipe in app/utils/photo.ts). Takes precedence over image_url, which is the source site''s address. Null means fall back to image_url, or to no picture at all.';
