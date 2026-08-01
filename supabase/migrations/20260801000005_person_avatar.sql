-- A photograph of a person, on the person's own row.
--
-- The board and the plan identify people by a coloured initial. That works, and
-- it keeps working — a household member added tonight has a colour and a letter
-- before anybody has taken a picture of them — but a face is recognised faster
-- than a letter is read, which is the whole job of an avatar on a screen glanced
-- at from across a kitchen.
--
-- The bytes, not an address, which is the opposite of the call `recipes.
-- image_url` makes and for the opposite reason. A recipe's photograph is already
-- on somebody else's CDN and costs us nothing to point at; a picture of a
-- three-year-old exists only on the phone that took it. Storing it would
-- otherwise mean a bucket, storage RLS, signed URLs and a cleanup path on
-- delete — and, worse, a fetch. This app's hard requirement is a kitchen tablet
-- in airplane mode showing the right thing, and a column replicates through the
-- sync layer that already exists: Dexie holds it, Realtime carries it, an
-- offline device that has ever seen the row has the picture too.
--
-- Sized by the client rather than trusted: utils/photo.ts centre-crops to a
-- square and encodes a 192px JPEG, which lands around 8 KB. Six of those is 50
-- KB in a 500 MB database. A check constraint holds the door on the pathological
-- case — a full-resolution camera dump pasted in by hand would be several
-- megabytes travelling through every realtime payload — and 256 KB is roughly
-- thirty times what a correctly encoded avatar costs.
--
-- Nullable and staying that way: most people here will never have a picture, and
-- a person without one is not a person with a missing field.

alter table public.people add column avatar text;

alter table public.people
  add constraint people_avatar_is_small
  check (avatar is null or length(avatar) <= 262144);

comment on column public.people.avatar is
  'A square JPEG data URL, written by the client at 192px. Null means fall back to the initial in the person''s own colour.';
