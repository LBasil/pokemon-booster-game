-- Pokémon Booster Game — the live feed counts each set's best rarity
-- Run after 0015_minigame_super_effective.sql.
--
-- The feed only took ultra/secret pulls, and ~20 old sets have none at all
-- (Base, Jungle, Fossil, Base Set 2, Gym, Neo Genesis/Discovery, Legendary
-- Collection, Expedition, Ruby & Sapphire, Sandstorm, Diamond & Pearl up to
-- Arceus, Call of Legends, Dragon Vault): their best cards are "Rare Holo"
-- (bucket holo), so a Base Set Charizard never showed up in the feed.
--
-- Now a pack posts its ultra/secret cards as before, and, when the pack's set
-- has no ultra/secret card at all, its holo cards. The pack's set is its
-- first card's set (slot 1 is always a common of the main set), or that
-- set's parent: a subset card (Classic Collection holos in Celebrations
-- packs) doesn't count, since its parent has real hits.
--
-- Deliberately unchanged: booster_openings.hits / secrets (hit-rate
-- leaderboard, "With a hit" history filter, achievements). A holo comes in
-- about 1 pack in 3 against ~1 in 6 for an ultra, so counting them there
-- would make the leaderboard farmable by opening Base only.
--
-- 1. feed_buckets(set_id): the buckets that go to the feed for a pack of
--    that set ({ultra,secret}, plus holo for a set without either).
-- 2. save_booster_opening() posts to the feed with it (same signature as
--    0006, both modes go through it).
--
-- Only new pulls are affected; nothing is backfilled.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Feed buckets per set ----------

set local application_name = 'migration 0016: step 1/2 feed buckets per set';

create or replace function public.feed_buckets(p_set_id text)
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.cards c
      where c.set_id = p_set_id and c.rarity_bucket in ('ultra', 'secret')
    ) then array['ultra', 'secret']
    else array['holo', 'ultra', 'secret']
  end
$$;

revoke execute on function public.feed_buckets(text) from public, anon, authenticated;

-- ---------- 2. Saving a pack ----------

set local application_name = 'migration 0016: step 2/2 save_booster_opening';

-- Same as 0006, only the feed insert changes
create or replace function public.save_booster_opening(
  p_user uuid,
  p_mode text,
  p_cards public.cards[],
  p_god_pack boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_best public.cards;
  v_username text;
  v_is_public boolean;
  v_pack_set text;
  ranks constant text[] := array['common', 'uncommon', 'rare', 'holo', 'ultra', 'secret'];
begin
  insert into public.collections (user_id, mode, card_id, quantity)
  select p_user, p_mode, c.id, count(*)
  from unnest(p_cards) c
  group by c.id
  on conflict (user_id, mode, card_id)
  do update set quantity = public.collections.quantity + excluded.quantity;

  select * into v_best
  from unnest(p_cards) c
  order by array_position(ranks, c.rarity_bucket) desc, c.value desc nulls last
  limit 1;

  insert into public.booster_openings (user_id, mode, set_id, card_ids, best_card_id, hits, secrets, god_pack)
  values (
    p_user,
    p_mode,
    p_cards[1].set_id,
    array(select c.id from unnest(p_cards) c),
    v_best.id,
    (select count(*) from unnest(p_cards) c where c.rarity_bucket in ('ultra', 'secret')),
    (select count(*) from unnest(p_cards) c where c.rarity_bucket = 'secret'),
    p_god_pack
  );

  if p_mode = 'unlimited' then
    delete from public.wishlist w where w.user_id = p_user and w.card_id = any (array(select c.id from unnest(p_cards) c));
  end if;

  select p.username, p.is_public into v_username, v_is_public from public.profiles p where p.id = p_user;
  if coalesce(v_is_public, false) then
    select coalesce(s.parent_set_id, s.id) into v_pack_set from public.sets s where s.id = p_cards[1].set_id;
    v_pack_set := coalesce(v_pack_set, p_cards[1].set_id);

    insert into public.pull_feed (user_id, username, card_id, card_name, image_small, bucket, set_id, mode)
    select p_user, v_username, c.id, c.name, c.image_small, c.rarity_bucket, c.set_id, p_mode
    from unnest(p_cards) c
    where c.rarity_bucket = any (public.feed_buckets(v_pack_set))
      -- a subset card only counts as a real hit, never as the holo fallback
      and (c.rarity_bucket in ('ultra', 'secret') or c.set_id = v_pack_set);
  end if;

  -- Keep the feed small (cheap thanks to the pulled_at index)
  if random() < 0.02 then
    delete from public.pull_feed where pulled_at < now() - interval '30 days';
  end if;
end;
$$;

revoke execute on function public.save_booster_opening(uuid, text, public.cards[], boolean) from public, anon, authenticated;
