-- The picture a recipe already had.
--
-- Every recipe page publishes a photograph and we were throwing it away: the
-- JSON-LD reader parses the `image` field and drops it on the floor, and the
-- wall board — a screen that is on all day at kitchen distance — shows tonight's
-- dinner as a name and a list. A picture is how you recognise a meal from across
-- the room.
--
-- The address, not the bytes. Storing the image itself would mean a bucket,
-- storage RLS, and a cleanup path on delete, for a household whose recipes all
-- come from sites that are already serving these files from a CDN. A workbox
-- runtimeCaching rule keeps them readable offline once seen, which is the only
-- offline guarantee this needs — a missing photograph is a plainer page, not a
-- broken one, and the <img> tag hides itself when the address stops resolving.
--
-- Nullable and staying that way: a recipe typed in by hand has no picture, and a
-- recipe imported from a page that published none is not defective.

alter table public.recipes add column image_url text;

-- Not backfilled. The recipes already in the library were imported before this
-- column existed, and re-fetching their pages to collect the images would spend
-- a request per recipe on something a re-import does for free.
