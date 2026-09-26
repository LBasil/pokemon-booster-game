-- Pokémon Booster Game — Challenge: weekly missions + live trades
-- Run after 0010_subsets_and_pack_stats.sql.
--
-- 1. Weekly missions, on top of the three daily ones. The week is the ISO
--    week in UTC (Monday 00:00 UTC to Sunday 23:59 UTC), like the game day.
--      week_open_packs  open 25 challenge boosters      +400
--      week_pull_ultra  pull 2 ultra rares or better     +400
--      week_recycle     recycle 50 duplicates            +250
--      week_daily       claim the daily reward 5 days    +300
--    A claim is a challenge_ledger 'mission' row whose game_day is the
--    week's Monday, so the existing unique index (user, mission, game_day)
--    makes each weekly mission claimable once per week.
--      challenge_week_start()             Monday of the current game week
--      challenge_weekly_missions(user)    same shape as challenge_missions()
--      claim_mission(id)                  now takes daily and weekly ids
--      challenge_state()                  + weekly, week_start
--      challenge_badge()                  counts finished weekly missions too
--    The client mirrors nothing but the reset time (msUntilWeeklyReset in
--    src/utils/challenge.js): targets and rewards come from the server.
--
-- 2. trade_offers joins the supabase_realtime publication, so a player sees
--    incoming offers and answers without reloading. Realtime applies the
--    table's RLS ("players read their own trades"): nobody receives other
--    players' trades.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Weekly missions ----------

set local application_name = 'migration 0011: step 1/3 weekly missions';

create or replace function public.challenge_week_start()
returns date
language sql
stable
as $$
  select date_trunc('week', public.challenge_today()::timestamp)::date
$$;

create or replace function public.challenge_weekly_missions(p_user uuid)
returns table (mission text, target int, reward int, progress int, claimed boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with week as (
    select public.challenge_week_start() as d, (public.challenge_week_start()::timestamp at time zone 'utc') as since
  ), defs (mission, target, reward, sort) as (
    values ('week_open_packs', 25, 400, 1), ('week_pull_ultra', 2, 400, 2), ('week_recycle', 50, 250, 3), ('week_daily', 5, 300, 4)
  ), progress as (
    select 'week_open_packs' as mission, count(*)::int as n
    from public.booster_openings o, week
    where o.user_id = p_user and o.mode = 'challenge' and o.opened_at >= week.since
    union all
    select 'week_pull_ultra', coalesce(sum(o.hits), 0)::int
    from public.booster_openings o, week
    where o.user_id = p_user and o.mode = 'challenge' and o.opened_at >= week.since
    union all
    select 'week_recycle', coalesce(sum(l.quantity), 0)::int
    from public.challenge_ledger l, week
    where l.user_id = p_user and l.kind = 'recycle' and l.game_day >= week.d
    union all
    select 'week_daily', count(*)::int
    from public.challenge_ledger l, week
    where l.user_id = p_user and l.kind = 'daily' and l.game_day >= week.d
  )
  select d.mission, d.target, d.reward, least(p.n, d.target),
    exists (
      select 1 from public.challenge_ledger l, week
      where l.user_id = p_user and l.kind = 'mission' and l.mission = d.mission and l.game_day = week.d
    )
  from defs d
  join progress p on p.mission = d.mission
  order by d.sort
$$;

-- Daily ids are recorded on the game day, weekly ones on the week's Monday
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
  v_day date := public.challenge_today();
begin
  select * into v_mission from public.challenge_missions(v_user) m where m.mission = p_mission;
  if not found then
    select * into v_mission from public.challenge_weekly_missions(v_user) m where m.mission = p_mission;
    if not found then
      raise exception 'unknown_mission';
    end if;
    v_day := public.challenge_week_start();
  end if;
  if v_mission.claimed then
    raise exception 'already_claimed';
  end if;
  if v_mission.progress < v_mission.target then
    raise exception 'mission_incomplete';
  end if;

  update public.challenge_wallets set coins = coins + v_mission.reward where user_id = v_user;
  insert into public.challenge_ledger (user_id, kind, amount, mission, game_day)
  values (v_user, 'mission', v_mission.reward, p_mission, v_day);

  return public.challenge_state() || jsonb_build_object('reward', v_mission.reward);
end;
$$;

-- ---------- 2. State + badge ----------

set local application_name = 'migration 0011: step 2/3 challenge_state + badge';

-- Same as 0006, plus weekly and week_start
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
    'missions', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.challenge_missions(v_user) m),
    'weekly', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.challenge_weekly_missions(v_user) m),
    'week_start', public.challenge_week_start()
  );
end;
$$;

-- Same as 0007, weekly missions included
create or replace function public.challenge_badge()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets;
  v_rewards int := 0;
  v_trades int;
begin
  select * into v_wallet from public.challenge_wallets w where w.user_id = v_user;
  if found then
    v_rewards := (v_wallet.last_daily_on is distinct from public.challenge_today())::int
      + (select count(*) from public.challenge_missions(v_user) m where not m.claimed and m.progress >= m.target)::int
      + (select count(*) from public.challenge_weekly_missions(v_user) m where not m.claimed and m.progress >= m.target)::int;
  end if;

  select count(*) into v_trades from public.trade_offers t
  where t.to_user = v_user and t.status = 'pending' and t.created_at > now() - public.trade_ttl();

  return jsonb_build_object('rewards', v_rewards, 'trades', v_trades);
end;
$$;

revoke execute on function public.challenge_weekly_missions(uuid) from public, anon, authenticated;

-- ---------- 3. Live trades ----------

set local application_name = 'migration 0011: step 3/3 realtime trades';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trade_offers'
    ) then
    alter publication supabase_realtime add table public.trade_offers;
  end if;
end;
$$;

set local application_name = 'migration 0011: done, committing';
