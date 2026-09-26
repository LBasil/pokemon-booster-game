-- Pokémon Booster Game — Challenge: "Higher or lower" mini-game
-- Run after 0012_trade_preferences.sql.
--
-- Two cards, one question: which one is worth more (Cardmarket price,
-- cards.value)? A run lasts until the first wrong answer.
--
-- Rules (mirrored in src/utils/minigame.js — change both together):
--   - 15 seconds per question (the server allows 20: display + latency);
--     a late answer ends the run like a wrong one.
--   - The price gap narrows as the streak grows: the pricier card is worth
--     at least x3 (streak 0-2), x2 (3-5), x1.5 (6-9), then x1.25, and at
--     most twice that ratio, so no pair is a coin flip.
--   - 3 paid runs per game day (00:00 UTC): 5 coins per right answer, for
--     the first 20 of the run (100 per run, 300 a day at most). Unpaid runs
--     are unlimited, for the record (best streak).
--
-- The server owns every answer: the client only ever gets names and
-- pictures, never the prices, until it has answered. Accepted limit: card
-- prices are public (cards is readable by anyone), so a script could look
-- them up within the 15 s — the daily cap bounds what that can earn (the
-- same 300 coins as a very good player).
--
-- 1. challenge_ledger.kind accepts 'minigame' (one row per paid answer, so
--    coins_earned in player_achievements() counts them with no change).
-- 2. minigame_runs: one row per run; at most one 'playing' run per player.
--    No client access: RPCs only.
-- 3. RPCs (each locks the player's wallet first, like every challenge RPC):
--      minigame_state()          rules, paid runs left today, best streak,
--                                the run in progress (resumed after a reload)
--      minigame_start()          abandons the run in progress, starts one
--                                (at most 20 starts a minute)
--      minigame_answer(p_pick)   'left' | 'right' (null = time's up);
--                                returns both prices + the next state
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Ledger ----------

set local application_name = 'migration 0013: step 1/3 ledger kind';

alter table public.challenge_ledger drop constraint if exists challenge_ledger_kind_check;
alter table public.challenge_ledger add constraint challenge_ledger_kind_check
  check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission', 'minigame'));

-- ---------- 2. Runs ----------

set local application_name = 'migration 0013: step 2/3 runs';

create table if not exists public.minigame_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_day date not null default public.challenge_today(),
  paid boolean not null,
  streak int not null default 0,     -- right answers so far
  coins int not null default 0,      -- coins this run has paid
  left_card text references public.cards (id) on delete set null,
  right_card text references public.cards (id) on delete set null,
  shown_at timestamptz not null default now(),  -- when the current pair was drawn
  status text not null default 'playing' check (status in ('playing', 'lost', 'timeout', 'abandoned')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists minigame_runs_one_playing on public.minigame_runs (user_id) where status = 'playing';
create index if not exists minigame_runs_user_day_idx on public.minigame_runs (user_id, game_day);

-- RLS on, no policy: only the SECURITY DEFINER functions below touch it
alter table public.minigame_runs enable row level security;
revoke all on public.minigame_runs from anon, authenticated;

-- ---------- 3. RPCs ----------

set local application_name = 'migration 0013: step 3/3 functions';

create or replace function public.minigame_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('paid_runs', 3, 'coins_per_answer', 5, 'max_paid_answers', 20, 'answer_seconds', 15)
$$;

-- The smallest price ratio between the two cards for a streak
create or replace function public.minigame_min_ratio(p_streak int)
returns numeric
language sql
immutable
as $$
  select case when p_streak < 3 then 3 when p_streak < 6 then 2 when p_streak < 10 then 1.5 else 1.25 end::numeric
$$;

-- A card as the client sees it during a question: no price
create or replace function public.minigame_card(p_card_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'image_small', c.image_small,
    'image_url', c.image_url, 'set_id', c.set_id, 'set_name', s.name)
  from public.cards c
  left join public.sets s on s.id = c.set_id
  where c.id = p_card_id
$$;

-- Two priced cards whose prices differ by min_ratio(streak) to twice that
create or replace function public.minigame_pair(p_streak int, out left_card text, out right_card text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ratio numeric := public.minigame_min_ratio(p_streak);
  v_a public.cards;
  v_b public.cards;
begin
  for i in 1..10 loop
    select * into v_a from public.cards c
    where c.value >= 0.1 and c.image_small is not null
    order by random() limit 1;
    if not found then
      exit;
    end if;
    select * into v_b from public.cards c
    where c.value >= 0.1 and c.image_small is not null and c.id <> v_a.id
      and (c.value between v_a.value * v_ratio and v_a.value * v_ratio * 2
        or c.value between v_a.value / (v_ratio * 2) and v_a.value / v_ratio)
    order by random() limit 1;
    if found then
      if random() < 0.5 then
        left_card := v_a.id;
        right_card := v_b.id;
      else
        left_card := v_b.id;
        right_card := v_a.id;
      end if;
      return;
    end if;
  end loop;
  raise exception 'minigame_unavailable';
end;
$$;

-- Everything the page needs; closes a run whose question timed out
create or replace function public.minigame_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.minigame_rules();
  v_run public.minigame_runs;
  v_paid int;
begin
  update public.minigame_runs r set status = 'timeout', ended_at = now()
  where r.user_id = v_user and r.status = 'playing'
    and r.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);

  select * into v_run from public.minigame_runs r where r.user_id = v_user and r.status = 'playing';
  select count(*) into v_paid from public.minigame_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();

  return v_rules || jsonb_build_object(
    'coins', v_wallet.coins,
    'paid_left', greatest((v_rules->>'paid_runs')::int - v_paid, 0),
    'today_coins', (select coalesce(sum(r.coins), 0) from public.minigame_runs r
                    where r.user_id = v_user and r.game_day = public.challenge_today()),
    'best', (select coalesce(max(r.streak), 0) from public.minigame_runs r where r.user_id = v_user),
    'run', case when v_run.id is null then null else jsonb_build_object(
      'paid', v_run.paid,
      'streak', v_run.streak,
      'coins', v_run.coins,
      'left', public.minigame_card(v_run.left_card),
      'right', public.minigame_card(v_run.right_card),
      'seconds_left', greatest(0, least((v_rules->>'answer_seconds')::int,
        (v_rules->>'answer_seconds')::int - floor(extract(epoch from now() - v_run.shown_at))::int))
    ) end
  );
end;
$$;

create or replace function public.minigame_start()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_pair record;
  v_paid int;
begin
  if (select count(*) from public.minigame_runs r
      where r.user_id = v_user and r.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;

  update public.minigame_runs r set status = 'abandoned', ended_at = now()
  where r.user_id = v_user and r.status = 'playing';

  select count(*) into v_paid from public.minigame_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();
  select * into v_pair from public.minigame_pair(0);

  insert into public.minigame_runs (user_id, paid, left_card, right_card)
  values (v_user, v_paid < (public.minigame_rules()->>'paid_runs')::int, v_pair.left_card, v_pair.right_card);

  return public.minigame_state();
end;
$$;

create or replace function public.minigame_answer(p_pick text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.minigame_rules();
  v_run public.minigame_runs;
  v_left numeric;
  v_right numeric;
  v_late boolean;
  v_right_answer boolean;
  v_earned int := 0;
  v_pair record;
begin
  if p_pick is not null and p_pick not in ('left', 'right') then
    raise exception 'invalid_pick';
  end if;
  select * into v_run from public.minigame_runs r where r.user_id = v_user and r.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;

  select c.value into v_left from public.cards c where c.id = v_run.left_card;
  select c.value into v_right from public.cards c where c.id = v_run.right_card;
  v_late := p_pick is null or v_run.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);
  -- Equal prices (only if they changed since the draw) count as right
  v_right_answer := not v_late and (
    (p_pick = 'left' and coalesce(v_left, 0) >= coalesce(v_right, 0))
    or (p_pick = 'right' and coalesce(v_right, 0) >= coalesce(v_left, 0))
  );

  if v_right_answer then
    if v_run.paid and v_run.streak < (v_rules->>'max_paid_answers')::int then
      v_earned := (v_rules->>'coins_per_answer')::int;
      update public.challenge_wallets set coins = coins + v_earned where user_id = v_user;
      insert into public.challenge_ledger (user_id, kind, amount, game_day)
      values (v_user, 'minigame', v_earned, v_run.game_day);
    end if;
    select * into v_pair from public.minigame_pair(v_run.streak + 1);
    update public.minigame_runs r
    set streak = r.streak + 1, coins = r.coins + v_earned,
        left_card = v_pair.left_card, right_card = v_pair.right_card, shown_at = now()
    where r.id = v_run.id;
  else
    update public.minigame_runs r
    set status = case when v_late then 'timeout' else 'lost' end, ended_at = now()
    where r.id = v_run.id;
  end if;

  return jsonb_build_object(
    'correct', v_right_answer,
    'late', v_late,
    'earned', v_earned,
    'streak', v_run.streak + v_right_answer::int,
    'run_coins', v_run.coins + v_earned,
    'left', jsonb_build_object('id', v_run.left_card, 'value', v_left),
    'right', jsonb_build_object('id', v_run.right_card, 'value', v_right),
    'state', public.minigame_state()
  );
end;
$$;

revoke execute on function public.minigame_card(text) from public, anon, authenticated;
revoke execute on function public.minigame_pair(int) from public, anon, authenticated;
revoke execute on function public.minigame_state() from public, anon;
revoke execute on function public.minigame_start() from public, anon;
revoke execute on function public.minigame_answer(text) from public, anon;
grant execute on function public.minigame_state() to authenticated;
grant execute on function public.minigame_start() to authenticated;
grant execute on function public.minigame_answer(text) to authenticated;
