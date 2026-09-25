-- Pokémon Booster Game — Challenge mode ("mode Défi")
-- Run after 0004_collector_social.sql, then deploy the matching client.
--
-- The challenge mode is the limited counterpart of the unlimited mode: its
-- own separate collection (collections.mode = 'challenge', already in the
-- schema since 0004) and an economy built around coins.
--
-- 1. challenge_wallets: one row per player (coins, pity counter, daily
--    streak), created on first use with START coins. Readable by its owner,
--    never writable by clients: every change goes through the RPCs below.
--
-- 2. challenge_ledger: every coin movement (start bonus, daily reward, pack
--    bought, cards recycled or crafted, mission reward). Private to its owner.
--    Also the source of truth for "already claimed today" (one mission
--    reward per mission and game day, enforced by a unique index).
--
-- 3. Economy (mirrored in src/utils/challenge.js — change both together):
--      start            1000 coins
--      booster          100 coins (any set or a chosen one)
--      daily reward     200 coins, +50 per consecutive day, max 500 (day 7+)
--      recycle / craft  per rarity bucket, see challenge_recycle_value() and
--                       challenge_craft_price(). Recycling always keeps one
--                       copy; crafting costs ~20x what recycling gives.
--      pity timer       a pack is forced to contain an ultra (or the best
--                       the set has) after 9 packs in a row without one
--      god pack         1 challenge pack in 500: every card holo or better
--    Daily missions (reset at 00:00 UTC):
--      open_packs  open 3 challenge boosters    75 coins
--      pull_holo   pull a holo or better        100 coins
--      recycle     recycle 5 duplicate cards    50 coins
--
-- 4. RPCs (SECURITY DEFINER, only ever touch auth.uid()'s rows; each one
--    locks the player's wallet row first, which serializes a player's
--    economy actions so two tabs can't spend the same coins twice):
--      challenge_state()                 wallet + daily reward + missions
--      claim_daily_reward()
--      claim_mission(p_mission)
--      open_challenge_booster(p_set_id)  pays, draws, saves: returns jsonb
--      recycle_duplicates(p_card_id)     null = every duplicate
--      craft_card(p_card_id)
--
-- 5. open_my_booster() keeps its signature and behavior for the unlimited
--    mode; its saving half moves to save_booster_opening(), shared with the
--    challenge. booster_openings gets god_pack / pity flags and pull_feed a
--    mode column (hits from both modes go to the live feed). The wishlist
--    belongs to the unlimited collection: challenge pulls don't touch it.
--
-- Safe to run twice.
--
-- Progress: the SQL editor only shows "running", so each step names itself
-- in application_name (visible live from another tab, see
-- docs/manual-testing.md > "Watching a migration run"), and any lock wait
-- longer than 15s fails with "canceling statement due to lock timeout"
-- instead of hanging. Both settings are LOCAL: they end with the migration.

set local lock_timeout = '15s';

-- ---------- 1. Wallets ----------

set local application_name = 'migration 0005: step 1/6 wallets';

create table if not exists public.challenge_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  packs_since_hit int not null default 0,  -- challenge packs in a row without an ultra/secret
  daily_streak int not null default 0,
  last_daily_on date,
  created_at timestamptz not null default now()
);

alter table public.challenge_wallets enable row level security;

drop policy if exists "users read their own wallet" on public.challenge_wallets;
create policy "users read their own wallet" on public.challenge_wallets
  for select using (auth.uid() = user_id);

-- ---------- 2. Ledger ----------

set local application_name = 'migration 0005: step 2/6 ledger';

-- The game day: missions and the daily reward reset at 00:00 UTC
create or replace function public.challenge_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'utc')::date
$$;

create table if not exists public.challenge_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission')),
  amount int not null,          -- coins: positive = earned, negative = spent
  card_id text references public.cards (id) on delete set null,
  quantity int,                 -- cards recycled / crafted
  mission text,
  game_day date not null default public.challenge_today(),
  created_at timestamptz not null default now()
);

create index if not exists challenge_ledger_user_idx on public.challenge_ledger (user_id, created_at desc);
create unique index if not exists challenge_ledger_mission_once
  on public.challenge_ledger (user_id, mission, game_day) where kind = 'mission';

alter table public.challenge_ledger enable row level security;

drop policy if exists "users read their own ledger" on public.challenge_ledger;
create policy "users read their own ledger" on public.challenge_ledger
  for select using (auth.uid() = user_id);

-- ---------- 3. Economy ----------

set local application_name = 'migration 0005: step 3/6 economy';

create or replace function public.challenge_recycle_value(p_bucket text)
returns int
language sql
immutable
as $$
  select case p_bucket
    when 'common' then 1 when 'uncommon' then 2 when 'rare' then 5
    when 'holo' then 15 when 'ultra' then 60 when 'secret' then 200
    else 1
  end
$$;

create or replace function public.challenge_craft_price(p_bucket text)
returns int
language sql
immutable
as $$
  select case p_bucket
    when 'common' then 20 when 'uncommon' then 40 when 'rare' then 100
    when 'holo' then 300 when 'ultra' then 1500 when 'secret' then 5000
    else 20
  end
$$;

-- Day 1: 200, day 2: 250 ... day 7 and later: 500
create or replace function public.challenge_daily_reward(p_streak int)
returns int
language sql
immutable
as $$
  select 200 + 50 * least(greatest(p_streak, 1) - 1, 6)
$$;

-- Today's missions for a player, with their progress
create or replace function public.challenge_missions(p_user uuid)
returns table (mission text, target int, reward int, progress int, claimed boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with day as (
    select public.challenge_today() as d, (public.challenge_today()::timestamp at time zone 'utc') as since
  ), defs (mission, target, reward, sort) as (
    values ('open_packs', 3, 75, 1), ('pull_holo', 1, 100, 2), ('recycle', 5, 50, 3)
  ), progress as (
    select 'open_packs' as mission, count(*)::int as n
    from public.booster_openings o, day
    where o.user_id = p_user and o.mode = 'challenge' and o.opened_at >= day.since
    union all
    select 'pull_holo', count(*)::int
    from public.booster_openings o
    join public.cards c on c.id = o.best_card_id, day
    where o.user_id = p_user and o.mode = 'challenge' and o.opened_at >= day.since
      and c.rarity_bucket in ('holo', 'ultra', 'secret')
    union all
    select 'recycle', coalesce(sum(l.quantity), 0)::int
    from public.challenge_ledger l, day
    where l.user_id = p_user and l.kind = 'recycle' and l.game_day = day.d
  )
  select d.mission, d.target, d.reward, least(p.n, d.target),
    exists (
      select 1 from public.challenge_ledger l, day
      where l.user_id = p_user and l.kind = 'mission' and l.mission = d.mission and l.game_day = day.d
    )
  from defs d
  join progress p on p.mission = d.mission
  order by d.sort
$$;

-- Creates the wallet with the start bonus if needed, then locks it for the
-- rest of the transaction (the per-player mutex every RPC below relies on).
create or replace function public.lock_challenge_wallet(p_user uuid)
returns public.challenge_wallets
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.challenge_wallets;
begin
  insert into public.challenge_wallets (user_id, coins) values (p_user, 1000)
  on conflict (user_id) do nothing;
  if found then
    insert into public.challenge_ledger (user_id, kind, amount) values (p_user, 'start', 1000);
  end if;
  select * into v_wallet from public.challenge_wallets w where w.user_id = p_user for update;
  return v_wallet;
end;
$$;

create or replace function public.require_player()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return auth.uid();
end;
$$;

-- ---------- 4. Shared opening logic ----------

set local application_name = 'migration 0005: step 4/6 shared opening logic';

alter table public.booster_openings
  add column if not exists god_pack boolean not null default false,
  add column if not exists pity boolean not null default false;

alter table public.pull_feed add column if not exists mode text not null default 'unlimited';

create or replace function public.check_booster_rate(p_user uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.booster_openings o
      where o.user_id = p_user and o.opened_at > now() - interval '1 minute') >= 60 then
    raise exception 'too many boosters opened, slow down a little';
  end if;
end;
$$;

-- Adds a drawn pack to the player's collection of that mode, logs it and
-- posts its hits to the public feed (same steps open_my_booster did in 0004)
create or replace function public.save_booster_opening(
  p_user uuid,
  p_mode text,
  p_cards public.cards[],
  p_god_pack boolean default false,
  p_pity boolean default false
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

  insert into public.booster_openings (user_id, mode, set_id, card_ids, best_card_id, hits, secrets, god_pack, pity)
  values (
    p_user,
    p_mode,
    p_cards[1].set_id,
    array(select c.id from unnest(p_cards) c),
    v_best.id,
    (select count(*) from unnest(p_cards) c where c.rarity_bucket in ('ultra', 'secret')),
    (select count(*) from unnest(p_cards) c where c.rarity_bucket = 'secret'),
    p_god_pack,
    p_pity
  );

  if p_mode = 'unlimited' then
    delete from public.wishlist w where w.user_id = p_user and w.card_id = any (array(select c.id from unnest(p_cards) c));
  end if;

  select p.username, p.is_public into v_username, v_is_public from public.profiles p where p.id = p_user;
  if coalesce(v_is_public, false) then
    insert into public.pull_feed (user_id, username, card_id, card_name, image_small, bucket, set_id, mode)
    select p_user, v_username, c.id, c.name, c.image_small, c.rarity_bucket, c.set_id, p_mode
    from unnest(p_cards) c
    where c.rarity_bucket in ('ultra', 'secret');
  end if;

  -- Keep the feed small (cheap thanks to the pulled_at index)
  if random() < 0.02 then
    delete from public.pull_feed where pulled_at < now() - interval '30 days';
  end if;
end;
$$;

-- Unlimited mode: same contract as in 0004
create or replace function public.open_my_booster(p_set_id text default null, p_mode text default 'unlimited')
returns setof public.cards
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_cards public.cards[];
begin
  if p_mode <> 'unlimited' then
    raise exception 'mode % is opened with open_challenge_booster', p_mode;
  end if;
  perform public.check_booster_rate(v_user);

  select array_agg(b) into v_cards from public.open_booster(p_set_id) b;
  perform public.save_booster_opening(v_user, 'unlimited', v_cards);

  return query select * from unnest(v_cards);
end;
$$;

-- ---------- 5. Challenge RPCs ----------

set local application_name = 'migration 0005: step 5/6 challenge rpcs';

create or replace function public.challenge_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_today date := public.challenge_today();
  v_streak int;
begin
  -- The streak the next claim would reach (it breaks after a missed day)
  v_streak := case when v_wallet.last_daily_on = v_today - 1 then v_wallet.daily_streak + 1 else 1 end;

  return jsonb_build_object(
    'coins', v_wallet.coins,
    'packs_since_hit', v_wallet.packs_since_hit,
    'daily_streak', case when v_wallet.last_daily_on >= v_today - 1 then v_wallet.daily_streak else 0 end,
    'daily_available', v_wallet.last_daily_on is distinct from v_today,
    'daily_reward', public.challenge_daily_reward(
      case when v_wallet.last_daily_on = v_today then v_wallet.daily_streak + 1 else v_streak end
    ),
    'today', v_today,
    'missions', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.challenge_missions(v_user) m)
  );
end;
$$;

create or replace function public.claim_daily_reward()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_today date := public.challenge_today();
  v_streak int;
  v_reward int;
begin
  if v_wallet.last_daily_on = v_today then
    raise exception 'already_claimed';
  end if;

  v_streak := case when v_wallet.last_daily_on = v_today - 1 then v_wallet.daily_streak + 1 else 1 end;
  v_reward := public.challenge_daily_reward(v_streak);

  update public.challenge_wallets
  set coins = coins + v_reward, daily_streak = v_streak, last_daily_on = v_today
  where user_id = v_user;
  insert into public.challenge_ledger (user_id, kind, amount) values (v_user, 'daily', v_reward);

  return public.challenge_state() || jsonb_build_object('reward', v_reward);
end;
$$;

create or replace function public.claim_mission(p_mission text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_mission record;
begin
  select * into v_mission from public.challenge_missions(v_user) m where m.mission = p_mission;
  if not found then
    raise exception 'unknown_mission';
  end if;
  if v_mission.claimed then
    raise exception 'already_claimed';
  end if;
  if v_mission.progress < v_mission.target then
    raise exception 'mission_incomplete';
  end if;

  update public.challenge_wallets set coins = coins + v_mission.reward where user_id = v_user;
  insert into public.challenge_ledger (user_id, kind, amount, mission)
  values (v_user, 'mission', v_mission.reward, p_mission);

  return public.challenge_state() || jsonb_build_object('reward', v_mission.reward);
end;
$$;

-- Buys and opens one challenge pack. Returns
-- { cards: [10 cards], coins, packs_since_hit, god_pack, pity }.
create or replace function public.open_challenge_booster(p_set_id text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_price constant int := 100;
  v_pity_after constant int := 10;
  god_slots constant text[] := array['holo', 'holo', 'holo', 'holo', 'holo', 'holo', 'ultra', 'ultra', 'ultra', 'secret'];
  v_cards public.cards[];
  v_set_id text;
  v_card public.cards;
  v_picked text[] := array[]::text[];
  v_bucket text;
  v_god boolean := false;
  v_pity boolean := false;
  v_has_hit boolean;
begin
  perform public.check_booster_rate(v_user);
  if v_wallet.coins < v_price then
    raise exception 'not_enough_coins';
  end if;

  -- A normal pack first: it also picks the set when none is given
  select array_agg(b) into v_cards from public.open_booster(p_set_id) b;
  v_set_id := v_cards[1].set_id;

  if random() < 0.002 then
    v_god := true;
    v_cards := array[]::public.cards[];
    foreach v_bucket in array god_slots loop
      v_card := public.pick_booster_card(v_set_id, v_bucket, v_picked);
      v_picked := v_picked || v_card.id;
      v_cards := v_cards || v_card;
    end loop;
  end if;

  v_has_hit := exists (select 1 from unnest(v_cards) c where c.rarity_bucket in ('ultra', 'secret'));

  -- Pity timer: the rare slot (last card) becomes an ultra
  if not v_has_hit and v_wallet.packs_since_hit >= v_pity_after - 1 then
    v_card := public.pick_booster_card(
      v_set_id,
      'ultra',
      array(select c.id from unnest(v_cards[1:array_length(v_cards, 1) - 1]) c)
    );
    v_cards[array_length(v_cards, 1)] := v_card;
    v_pity := true;
    v_has_hit := true; -- even if the set has no ultra at all: the timer restarts
  end if;

  update public.challenge_wallets
  set coins = coins - v_price,
      packs_since_hit = case when v_has_hit then 0 else packs_since_hit + 1 end
  where user_id = v_user
  returning * into v_wallet;
  insert into public.challenge_ledger (user_id, kind, amount) values (v_user, 'booster', -v_price);

  perform public.save_booster_opening(v_user, 'challenge', v_cards, v_god, v_pity);

  return jsonb_build_object(
    'cards', to_jsonb(v_cards),
    'coins', v_wallet.coins,
    'packs_since_hit', v_wallet.packs_since_hit,
    'god_pack', v_god,
    'pity', v_pity
  );
end;
$$;

-- Sells every copy beyond the first of one card (or of every card when
-- p_card_id is null). Returns { recycled, gained, coins }.
create or replace function public.recycle_duplicates(p_card_id text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_count int;
  v_gained int;
begin
  select coalesce(sum(col.quantity - 1), 0), coalesce(sum((col.quantity - 1) * public.challenge_recycle_value(c.rarity_bucket)), 0)
  into v_count, v_gained
  from public.collections col
  join public.cards c on c.id = col.card_id
  where col.user_id = v_user and col.mode = 'challenge' and col.quantity > 1
    and (p_card_id is null or col.card_id = p_card_id);

  if v_count > 0 then
    update public.collections col
    set quantity = 1
    where col.user_id = v_user and col.mode = 'challenge' and col.quantity > 1
      and (p_card_id is null or col.card_id = p_card_id);

    update public.challenge_wallets set coins = coins + v_gained where user_id = v_user
    returning * into v_wallet;
    insert into public.challenge_ledger (user_id, kind, amount, card_id, quantity)
    values (v_user, 'recycle', v_gained, p_card_id, v_count);
  end if;

  return jsonb_build_object('recycled', v_count, 'gained', v_gained, 'coins', v_wallet.coins);
end;
$$;

-- Buys one copy of a card. Returns { card_id, quantity, price, coins }.
create or replace function public.craft_card(p_card_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_card public.cards;
  v_price int;
  v_quantity int;
begin
  select * into v_card from public.cards c where c.id = p_card_id;
  if not found then
    raise exception 'unknown_card';
  end if;
  v_price := public.challenge_craft_price(v_card.rarity_bucket);
  if v_wallet.coins < v_price then
    raise exception 'not_enough_coins';
  end if;

  update public.challenge_wallets set coins = coins - v_price where user_id = v_user
  returning * into v_wallet;

  insert into public.collections (user_id, mode, card_id, quantity)
  values (v_user, 'challenge', v_card.id, 1)
  on conflict (user_id, mode, card_id)
  do update set quantity = public.collections.quantity + 1
  returning quantity into v_quantity;

  insert into public.challenge_ledger (user_id, kind, amount, card_id, quantity)
  values (v_user, 'craft', -v_price, v_card.id, 1);

  return jsonb_build_object('card_id', v_card.id, 'quantity', v_quantity, 'price', v_price, 'coins', v_wallet.coins);
end;
$$;

-- ---------- Grants ----------

set local application_name = 'migration 0005: step 6/6 grants';

-- Internal helpers: only callable from the RPCs above
revoke execute on function public.challenge_missions(uuid) from public, anon, authenticated;
revoke execute on function public.lock_challenge_wallet(uuid) from public, anon, authenticated;
revoke execute on function public.check_booster_rate(uuid) from public, anon, authenticated;
revoke execute on function public.save_booster_opening(uuid, text, public.cards[], boolean, boolean) from public, anon, authenticated;

revoke execute on function public.challenge_state() from public, anon;
revoke execute on function public.claim_daily_reward() from public, anon;
revoke execute on function public.claim_mission(text) from public, anon;
revoke execute on function public.open_challenge_booster(text) from public, anon;
revoke execute on function public.recycle_duplicates(text) from public, anon;
revoke execute on function public.craft_card(text) from public, anon;
grant execute on function public.challenge_state() to authenticated;
grant execute on function public.claim_daily_reward() to authenticated;
grant execute on function public.claim_mission(text) to authenticated;
grant execute on function public.open_challenge_booster(text) to authenticated;
grant execute on function public.recycle_duplicates(text) to authenticated;
grant execute on function public.craft_card(text) to authenticated;

set local application_name = 'migration 0005: done, committing';
