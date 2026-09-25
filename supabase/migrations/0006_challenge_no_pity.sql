-- Pokémon Booster Game — Challenge mode: no more pity timer
-- Run after 0005_challenge_mode.sql.
--
-- User decision (2026-09-25): nothing in the game costs real money, so the
-- challenge keeps the base real-life pull rates of open_booster(), like the
-- unlimited mode. The pity timer from 0005 (an ultra forced after 9 packs
-- without one) is removed: about 1 ultra in 7 was forced rather than pulled.
-- God packs stay (1 challenge pack in 500: holos and better only).
--
-- 1. open_challenge_booster(p_set_id) pays 100 coins, draws a normal pack
--    (or, 1 time in 500, a god pack). Returns { cards, coins, god_pack }.
-- 2. challenge_state() no longer returns packs_since_hit.
-- 3. Dropped: challenge_wallets.packs_since_hit and booster_openings.pity.
--    save_booster_opening() loses its p_pity flag.
--
-- Safe to run twice. Clients deployed before this migration keep working
-- (they read the missing pity keys as "no pity").
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Opening a challenge pack ----------

set local application_name = 'migration 0006: step 1/3 open_challenge_booster';

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
  god_slots constant text[] := array['holo', 'holo', 'holo', 'holo', 'holo', 'holo', 'ultra', 'ultra', 'ultra', 'secret'];
  v_cards public.cards[];
  v_set_id text;
  v_card public.cards;
  v_picked text[] := array[]::text[];
  v_bucket text;
  v_god boolean := false;
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

  update public.challenge_wallets set coins = coins - v_price where user_id = v_user
  returning * into v_wallet;
  insert into public.challenge_ledger (user_id, kind, amount) values (v_user, 'booster', -v_price);

  perform public.save_booster_opening(v_user, 'challenge', v_cards, v_god);

  return jsonb_build_object('cards', to_jsonb(v_cards), 'coins', v_wallet.coins, 'god_pack', v_god);
end;
$$;

-- ---------- 2. State without the pity counter ----------

set local application_name = 'migration 0006: step 2/3 challenge_state';

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

-- ---------- 3. Drop the pity leftovers ----------

set local application_name = 'migration 0006: step 3/3 drop pity columns';

-- Same steps as in 0005, without the pity flag
drop function if exists public.save_booster_opening(uuid, text, public.cards[], boolean, boolean);

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

revoke execute on function public.save_booster_opening(uuid, text, public.cards[], boolean) from public, anon, authenticated;

alter table public.challenge_wallets drop column if exists packs_since_hit;
alter table public.booster_openings drop column if exists pity;

set local application_name = 'migration 0006: done, committing';
