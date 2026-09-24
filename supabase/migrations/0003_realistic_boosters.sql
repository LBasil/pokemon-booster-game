-- Pokémon Booster Game — realistic booster packs + set artwork URLs
-- Run after 0002_functions.sql, then re-run `npm run populate:sets` to fill
-- the new sets.logo_url / sets.symbol_url columns.
--
-- 1. Set artwork. Since early 2026, pokemontcg.io hosts new sets' logos and
--    symbols on images.scrydex.com with a different URL scheme, so they can't
--    be derived from the set id any more. We now store the URLs the API gives.
--
-- 2. Rarity buckets. The ~45 raw rarity labels (they changed every era) are
--    collapsed into 6 buckets, stored as a generated column so packs can be
--    drawn per bucket with an index. The client mirrors this mapping in
--    src/utils/rarity.js — keep both in sync.
--      common    Common, Promo, no rarity (basic Energy)
--      uncommon  Uncommon
--      rare      Rare
--      holo      Rare Holo, ex/EX/GX/V/VMAX/VSTAR, Double Rare, Radiant, ACE SPEC...
--      ultra     Ultra Rare, Illustration Rare, Trainer Gallery, Shiny...
--      secret    Special Illustration Rare, Hyper Rare, Secret, Rainbow
--    If you change rarity_bucket(), drop and re-add the generated column so
--    existing rows are recomputed.
--
-- 3. open_booster(p_set_id). Replaces the uniform random draw, which gave
--    ~4 rares and more than one "hit" per pack on modern sets (their card
--    lists are ~40% rares). A pack is now built slot by slot like a real
--    modern booster (10 cards):
--      slots 1-4   common
--      slots 5-7   uncommon
--      slot  8     reverse holo: 50% common, 38% uncommon, 12% rare
--      slot  9     reverse holo / hit: 31% common, 35% uncommon, 25% rare,
--                  8.2% ultra, 0.8% secret (where modern sets hide IR/SIR)
--      slot 10     rare slot: 70% rare, 21% holo, 8% ultra, 1% secret
--    => roughly 1 holo/ex in 5 packs, 1 ultra-or-better in 5-6 packs and
--    1 secret (SIR, Hyper...) in ~55 packs — close to modern pull rates.
--    Checked by simulating 3000 packs per set against real card lists.
--    A missing bucket falls back to the next lower one (e.g. Base Set has no
--    ultras, so its "ultra" rolls become holos), and a pack never repeats a
--    card unless the set is too small. With no set id, each pack comes from
--    one random "real" set (at least 4 commons and a rare, so promo-only sets
--    are skipped) — real packs never mix sets.
--
-- random_cards / random_cards_by_set from 0002 are left in place: the client
-- falls back to them if this migration hasn't been applied yet.

-- ---------- 1. Set artwork ----------

alter table public.sets
  add column if not exists logo_url text,
  add column if not exists symbol_url text;

-- ---------- 2. Rarity buckets ----------

create or replace function public.rarity_bucket(rarity text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when rarity is null then 'common'
    when lower(rarity) in ('common', 'promo') then 'common'
    when lower(rarity) = 'uncommon' then 'uncommon'
    when lower(rarity) = 'rare' then 'rare'
    when lower(rarity) in (
      'special illustration rare', 'hyper rare', 'mega hyper rare', 'rare secret', 'rare rainbow'
    ) then 'secret'
    when lower(rarity) in (
      'ultra rare', 'rare ultra', 'illustration rare', 'trainer gallery rare holo', 'rare holo star',
      'rare shining', 'rare shiny', 'shiny rare', 'rare shiny gx', 'shiny ultra rare',
      'black white rare', 'mega_attack_rare', 'pikachu rare'
    ) then 'ultra'
    -- Every other "rare"-ish label (Rare Holo, Double Rare, Radiant Rare, ...)
    when lower(rarity) like '%rare%' or lower(rarity) like '%holo%'
      or lower(rarity) in ('legend', 'classic collection') then 'holo'
    else 'common'
  end
$$;

alter table public.cards
  add column if not exists rarity_bucket text
  generated always as (public.rarity_bucket(rarity)) stored;

create index if not exists cards_set_bucket_idx on public.cards (set_id, rarity_bucket);

-- ---------- 3. Pack building ----------

-- One card for a slot: the requested bucket, else the next lower bucket that
-- exists in the set, never a card already in the pack (unless unavoidable).
create or replace function public.pick_booster_card(p_set_id text, p_bucket text, p_exclude text[])
returns public.cards
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  ladder constant text[] := array['secret', 'ultra', 'holo', 'rare', 'uncommon', 'common'];
  bucket text;
  picked public.cards;
begin
  foreach bucket in array ladder[array_position(ladder, p_bucket):] loop
    select * into picked
    from public.cards c
    where c.set_id = p_set_id and c.rarity_bucket = bucket and c.id <> all (p_exclude)
    order by random()
    limit 1;
    if found then
      return picked;
    end if;
  end loop;

  -- Odd sets (e.g. all-ultra subsets, tiny sets): anything left in the set,
  -- then allow repeats as a last resort.
  select * into picked
  from public.cards c
  where c.set_id = p_set_id and c.id <> all (p_exclude)
  order by random()
  limit 1;
  if not found then
    select * into picked from public.cards c where c.set_id = p_set_id order by random() limit 1;
  end if;
  return picked;
end;
$$;

create or replace function public.open_booster(p_set_id text default null)
returns setof public.cards
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_set_id text := p_set_id;
  slots text[] := array['common', 'common', 'common', 'common', 'uncommon', 'uncommon', 'uncommon'];
  roll double precision;
  slot text;
  card public.cards;
  picked text[] := array[]::text[];
begin
  if v_set_id is null then
    select c.set_id into v_set_id
    from public.cards c
    group by c.set_id
    having count(*) filter (where c.rarity_bucket = 'common') >= 4
       and count(*) filter (where c.rarity_bucket in ('rare', 'holo')) >= 1
    order by random()
    limit 1;
  end if;

  if v_set_id is null or not exists (select 1 from public.cards c where c.set_id = v_set_id) then
    raise exception 'open_booster: no cards for set %', coalesce(p_set_id, '(any)');
  end if;

  -- Slot 8: reverse holo
  roll := random();
  slots := slots || case when roll < 0.50 then 'common' when roll < 0.88 then 'uncommon' else 'rare' end;

  -- Slot 9: reverse holo that can be a hit
  roll := random();
  slots := slots || case
    when roll < 0.008 then 'secret'
    when roll < 0.090 then 'ultra'
    when roll < 0.400 then 'common'
    when roll < 0.750 then 'uncommon'
    else 'rare'
  end;

  -- Slot 10: the rare slot
  roll := random();
  slots := slots || case
    when roll < 0.010 then 'secret'
    when roll < 0.090 then 'ultra'
    when roll < 0.300 then 'holo'
    else 'rare'
  end;

  foreach slot in array slots loop
    card := public.pick_booster_card(v_set_id, slot, picked);
    picked := picked || card.id;
    return next card;
  end loop;
end;
$$;
