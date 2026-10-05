-- Pokémon Booster Game — cards in French, and the card data Pocket-style battles need
-- Run after 0028_pvp_testers_only.sql.
--
-- User, 2026-10-05: "il faudrait aussi qu'un joueur FR puisse avoir ses
-- cartes en FR pour qu'il comprenne mieux", and PvP rebuilt like Pokémon
-- TCG Pocket (0030), which needs each card's retreat cost and abilities.
--
-- pokemontcg.io is English only. The French data comes from TCGdex
-- (api.tcgdex.net, free, no key), filled by `scripts/populate.mjs fr`
-- (also run by `sync`): sets are matched by their cards (number + English
-- name), then each card by its number in the set. Sets never printed in
-- French (Base Set 2, Gym Heroes, Legendary Collection...) stay English.
--
-- 1. sets.tcgdex_id  the matching TCGdex set ('sv03.5' for 'sv3pt5'),
--                    null = none found
--    sets.name_fr     its French name ("Set de Base")
-- 2. cards.name_fr       French name ("Dracaufeu-ex")
--    cards.image_fr      TCGdex image base URL; the client adds
--                        /low.webp (small) or /high.webp (large)
--    cards.attacks_fr    [{ name, effect }], same order as cards.attacks
--    cards.abilities_fr  [{ name, effect }], same order as cards.abilities
--    cards.retreat_cost  energies to retreat (pokemontcg.io)
--    cards.abilities     [{ name, text, type }] (pokemontcg.io; shown in
--                        battles, not applied)
--    cards.attacks entries also get `text` (printed effect) and the parsed
--    `base` damage, effects `fx`, `coins`, `partial` (src/utils/attackEffects.js) from
--    populate: nothing to change in the schema (jsonb).
-- All readable by anyone, like the rest of cards and sets (0001 policies).
-- 3. set_cards_fr(rows): populate's bulk write of the French columns
--    ([{ id, name_fr, image_fr, attacks_fr, abilities_fr }], a missing
--    field keeps the stored value); service role only.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

set local application_name = 'migration 0029: step 1/2 columns';

alter table public.sets add column if not exists tcgdex_id text;
alter table public.sets add column if not exists name_fr text;

alter table public.cards add column if not exists name_fr text;
alter table public.cards add column if not exists image_fr text;
alter table public.cards add column if not exists attacks_fr jsonb;
alter table public.cards add column if not exists abilities_fr jsonb;
alter table public.cards add column if not exists retreat_cost int;
alter table public.cards add column if not exists abilities jsonb;

set local application_name = 'migration 0029: step 2/2 set_cards_fr';

create or replace function public.set_cards_fr(p_rows jsonb)
returns int
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with updated as (
    update public.cards c
    set name_fr = coalesce(r.name_fr, c.name_fr),
        image_fr = coalesce(r.image_fr, c.image_fr),
        attacks_fr = coalesce(r.attacks_fr, c.attacks_fr),
        abilities_fr = coalesce(r.abilities_fr, c.abilities_fr)
    from jsonb_to_recordset(p_rows) r(id text, name_fr text, image_fr text, attacks_fr jsonb, abilities_fr jsonb)
    where c.id = r.id
    returning 1
  )
  select count(*)::int from updated
$$;

revoke execute on function public.set_cards_fr(jsonb) from public, anon, authenticated;
grant execute on function public.set_cards_fr(jsonb) to service_role;

set local application_name = 'migration 0029: done, committing';
