-- Pokémon Booster Game — subsets inside their parent's packs + pack stats
-- Run after 0009_achievements_by_mode.sql.
--
-- 1. Subsets. Trainer Gallery, Galarian Gallery, Shiny Vault and Classic
--    Collection "sets" were never sold as boosters: in real life their cards
--    come inside the parent set's packs. Opened on their own they gave packs
--    of 10 holos/ultras (they have no commons, so every common slot fell back
--    to "any card of the set"). Now:
--      sets.parent_set_id  the set whose packs carry it (null = a real set)
--      sets.subset_rate    chance that a parent pack carries one of its cards
--    open_booster(subset) opens the parent's pack instead, "any set" never
--    picks a subset, and a parent pack's slot 8 (plain reverse holo) becomes
--    a subset card with that chance. Slot 9/10 odds are unchanged, so the
--    parent's own hit rates stay exactly the same.
--    Rates (approximations of community pull data, tune per row if needed):
--      Trainer Gallery 25% · Galarian Gallery 33% · Shiny Vault 30% ·
--      Classic Collection 33%.
--    link_subsets() fills new subsets (called by scripts/populate.mjs after
--    a sync; service role only).
--
-- 2. player_achievements(mode, username?) also returns `stats`: exact pack
--    counts from booster_openings (packs, hit packs, best day, longest daily
--    streak, sets opened, favorite set...) and, in the challenge, trades,
--    gifts, coins earned, missions, crafts, recycling and the best daily
--    reward streak. They feed the history page and new achievements.
--
-- Safe to run twice. Clients deployed before this migration keep working.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Subsets ----------

set local application_name = 'migration 0010: step 1/3 subsets';

alter table public.sets
  add column if not exists parent_set_id text references public.sets (id) on delete set null,
  add column if not exists subset_rate numeric check (subset_rate between 0 and 1);

-- The parent a subset's id points to (swsh9tg -> swsh9, cel25c -> cel25...)
create or replace function public.guess_subset_parent(p_id text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select s.id
  from public.sets s
  where s.id = case when p_id = 'sma' then 'sm115' else regexp_replace(p_id, '(tg|gg|sv|c)$', '') end
    and s.id <> p_id
$$;

create or replace function public.subset_default_rate(p_id text)
returns numeric
language sql
immutable
as $$
  select case
    when p_id ~ 'tg$' then 0.25
    when p_id ~ 'sv$' or p_id = 'sma' then 0.30
    else 0.33
  end
$$;

-- Links every unlinked subset: an id pointing to an existing set, and too few
-- commons to be a real booster set. Returns how many were linked.
create or replace function public.link_subsets()
returns int
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_linked int;
begin
  update public.sets s
  set parent_set_id = public.guess_subset_parent(s.id),
      subset_rate = coalesce(s.subset_rate, public.subset_default_rate(s.id))
  where s.parent_set_id is null
    and public.guess_subset_parent(s.id) is not null
    and exists (select 1 from public.cards c where c.set_id = s.id)
    and (select count(*) from public.cards c where c.set_id = s.id and c.rarity_bucket = 'common') < 4;
  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

select public.link_subsets();

-- ---------- 2. Pack building ----------

set local application_name = 'migration 0010: step 2/3 open_booster';

-- A subset card: mostly its holos, sometimes an ultra, rarely a secret
-- (the nearest bucket the subset has, the more common one on a tie).
create or replace function public.pick_subset_card(p_set_id text, p_exclude text[])
returns public.cards
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  ranks constant text[] := array['common', 'uncommon', 'rare', 'holo', 'ultra', 'secret'];
  roll double precision := random();
  wanted text := case when roll < 0.04 then 'secret' when roll < 0.40 then 'ultra' else 'holo' end;
  picked public.cards;
begin
  select * into picked
  from public.cards c
  where c.set_id = p_set_id and c.id <> all (p_exclude)
  order by
    abs(array_position(ranks, c.rarity_bucket) - array_position(ranks, wanted)),
    array_position(ranks, c.rarity_bucket),
    random()
  limit 1;
  return picked;
end;
$$;

-- Same slots as 0003, plus the subset card in slot 8
create or replace function public.open_booster(p_set_id text default null)
returns setof public.cards
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_set_id text := p_set_id;
  v_subset public.sets;
  slots text[] := array['common', 'common', 'common', 'common', 'uncommon', 'uncommon', 'uncommon'];
  roll double precision;
  slot text;
  card public.cards;
  picked text[] := array[]::text[];
begin
  -- A subset is never sold on its own: open its parent's pack
  select coalesce(s.parent_set_id, s.id) into v_set_id from public.sets s where s.id = p_set_id;
  v_set_id := coalesce(v_set_id, p_set_id);

  if v_set_id is null then
    select c.set_id into v_set_id
    from public.cards c
    join public.sets s on s.id = c.set_id
    where s.parent_set_id is null
    group by c.set_id
    having count(*) filter (where c.rarity_bucket = 'common') >= 4
       and count(*) filter (where c.rarity_bucket in ('rare', 'holo')) >= 1
    order by random()
    limit 1;
  end if;

  if v_set_id is null or not exists (select 1 from public.cards c where c.set_id = v_set_id) then
    raise exception 'open_booster: no cards for set %', coalesce(p_set_id, '(any)');
  end if;

  select * into v_subset
  from public.sets s
  where s.parent_set_id = v_set_id and exists (select 1 from public.cards c where c.set_id = s.id)
  order by random()
  limit 1;

  -- Slot 8: reverse holo, or a subset card
  roll := random();
  if v_subset.id is not null and random() < coalesce(v_subset.subset_rate, 0) then
    slots := slots || 'subset'::text;
  else
    slots := slots || case when roll < 0.50 then 'common' when roll < 0.88 then 'uncommon' else 'rare' end;
  end if;

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
    if slot = 'subset' then
      card := public.pick_subset_card(v_subset.id, picked);
    else
      card := public.pick_booster_card(v_set_id, slot, picked);
    end if;
    picked := picked || card.id;
    return next card;
  end loop;
end;
$$;

-- ---------- 3. Pack stats ----------

set local application_name = 'migration 0010: step 3/3 player_achievements stats';

create or replace function public.player_achievements(p_mode text, p_username text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_stats jsonb;
begin
  if p_mode is null or p_mode not in ('unlimited', 'challenge') then
    raise exception 'invalid_mode';
  end if;

  if p_username is null then
    v_user := auth.uid();
    if v_user is null then
      raise exception 'not_authenticated';
    end if;
  else
    select p.id into v_user
    from public.profiles p
    where lower(p.username) = lower(btrim(p_username)) and (p.is_public or p.id = auth.uid());
    if v_user is null then
      return null;
    end if;
  end if;

  -- Days are UTC game days, like the challenge's
  with o as (
    select o.set_id, o.hits, o.secrets, o.god_pack, o.opened_at, (o.opened_at at time zone 'utc')::date as d
    from public.booster_openings o
    where o.user_id = v_user and o.mode = p_mode
  ),
  per_day as (select d, count(*) as n from o group by d),
  islands as (select d - (row_number() over (order by d))::int as grp from per_day),
  top_set as (select set_id, count(*) as n from o group by set_id order by n desc, set_id limit 1)
  select jsonb_build_object(
    'packs', (select count(*) from o),
    'first_at', (select min(opened_at) from o),
    'hit_packs', (select count(*) from o where hits > 0),
    'hits', coalesce((select sum(hits) from o), 0),
    'secrets', coalesce((select sum(secrets) from o), 0),
    'max_hits', coalesce((select max(hits) from o), 0),
    'god_packs', (select count(*) from o where god_pack),
    'sets', (select count(distinct set_id) from o),
    'days', (select count(*) from per_day),
    'today', (select count(*) from o where d = (now() at time zone 'utc')::date),
    'best_day', coalesce((select max(n) from per_day), 0),
    'best_streak', coalesce((select max(n) from (select count(*) as n from islands group by grp) s), 0),
    'top_set_id', (select set_id from top_set),
    'top_set_packs', coalesce((select n from top_set), 0)
  ) into v_stats;

  if p_mode = 'challenge' then
    with l as (
      select kind, amount, quantity, game_day from public.challenge_ledger where user_id = v_user
    ),
    daily as (select distinct game_day from l where kind = 'daily'),
    islands as (select game_day - (row_number() over (order by game_day))::int as grp from daily)
    select v_stats || jsonb_build_object(
      'trades', (
        select count(*) from public.trade_offers t
        where t.status = 'accepted' and v_user in (t.from_user, t.to_user) and cardinality(t.request_cards) > 0
      ),
      'gifts', (
        select count(*) from public.trade_offers t
        where t.status = 'accepted' and t.from_user = v_user and cardinality(t.request_cards) = 0
      ),
      'coins_earned', coalesce((select sum(amount) from l where amount > 0 and kind <> 'start'), 0),
      'missions', (select count(*) from l where kind = 'mission'),
      'crafted', coalesce((select sum(quantity) from l where kind = 'craft'), 0),
      'recycled', coalesce((select sum(quantity) from l where kind = 'recycle'), 0),
      'best_daily_streak', coalesce((select max(n) from (select count(*) as n from islands group by grp) s), 0)
    ) into v_stats;
  end if;

  return jsonb_build_object(
    'unlocked', coalesce((
      select jsonb_agg(a.achievement_id order by a.achievement_id)
      from public.achievement_unlocks a
      where a.user_id = v_user and a.mode = p_mode
    ), '[]'::jsonb),
    'packs', (v_stats ->> 'packs')::int,
    'stats', v_stats
  );
end;
$$;

revoke execute on function public.link_subsets() from public, anon, authenticated;
grant execute on function public.link_subsets() to service_role;
revoke execute on function public.player_achievements(text, text) from public;
grant execute on function public.player_achievements(text, text) to anon, authenticated;

set local application_name = 'migration 0010: done, committing';
