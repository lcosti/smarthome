-- Where a photographed recipe came from: the book, and the page in it.
--
-- `source_url` has answered "where is this from" since 20260730000001, and it
-- answers it for exactly one kind of recipe — the one pasted in as a link. The
-- recipes photographed off the shelf are the ones where the question is worth
-- asking twice, because the answer is the only way back to the original: the
-- extraction gets the method and the ingredients, and it cannot get the
-- headnote, the picture, or the two paragraphs of introduction that say what
-- the dish is for. "It's in the Ottolenghi, page 82" is what somebody says in
-- this house already, and it is the one fact a photograph cannot carry.
--
-- Two columns beside `source_url` rather than one text blob or a `sources`
-- table. A recipe has one provenance and it is either an address or a shelf,
-- and the precedent in this schema is typed fields over a blob — see the
-- nutrition migration (20260801000004) making the same call for eight figures,
-- and the meals migration (20260810000001) for three booleans. The row stays a
-- flat record of primitives, which is what `plainCopy` in app/utils/sync.ts
-- documents itself as copying.
--
-- `source_page` is text, not an integer, and that is deliberate. A recipe
-- photographed out of a cookbook is regularly a spread — the client already
-- sends up to four photos for exactly that reason — so the honest answer is
-- often "82-83". Books also number by section ("4.12"), and a recipe card
-- clipped out of a magazine has no page at all. Nothing sorts by this, nothing
-- does arithmetic with it, and nothing ever will: it is printed back onto the
-- screen exactly as somebody typed it. An integer column would buy validation
-- of a fact nobody validates and lose the commonest case.
--
-- Both nullable, with no backfill and no default. Most recipes here will never
-- have come from a book, and a recipe without a book is not a recipe with a
-- missing field — every surface that shows this collapses when it is null, the
-- way the photograph and the nutrition panel already do.
--
-- No index: a household library is tens of rows, every device holds all of them
-- in memory, and the only read is a string being drawn under a recipe's name.
-- The one aggregate — "which books has this house typed in before", offered
-- back as suggestions so the same shelf is spelled the same way twice — is a
-- pass over that array in the client.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and upserts the whole row, so typing a page number offline
-- queues as an ordinary last-write-wins snapshot. RLS is inherited from the
-- recipes policies — these are columns on a household-scoped row, not a
-- surface.

alter table public.recipes
  add column source_book text,
  add column source_page text;

comment on column public.recipes.source_book is
  'The cookbook this was photographed out of, as somebody typed it. Null for a recipe that did not come off a shelf. See sourceLabel in app/utils/recipe-source.ts, which is what draws it.';

comment on column public.recipes.source_page is
  'The page in source_book, as text: often a spread ("82-83"), sometimes a section number, never arithmetic. Null when unknown, which includes every recipe imported from a URL.';
