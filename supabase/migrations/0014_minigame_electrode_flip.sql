-- Pokémon Booster Game — Challenge: "Shiny Electrode Flip" mini-game
-- Run after 0013_minigame_higher_lower.sql.
--
-- Voltorb Flip, with (shiny) Electrodes. A 5x5 board hides 1, 2, 3 and
-- Electrode tiles; every row and column shows its point total and how many
-- Electrodes it holds.
--
-- Rules (mirrored in src/utils/electrodeFlip.js — change both together):
--   - Points = the product of the tiles flipped (0 before the first one).
--   - Every 2 and 3 flipped: the board is won, its points are paid in
--     coins and the next board is one level up (5 levels, harder layouts:
--     electrode_flip_layout()).
--   - An Electrode: the board is lost, 0 points. Cashing out keeps the
--     points. Either way the next level drops to the number of tiles
--     flipped if that's lower (at least 1), like the original.
--   - Coins = points, at most 300 a game day (00:00 UTC) from this game;
--     past that, boards play on for the record (best board, best level).
--
-- The server owns the board: the client gets the hints and the tiles it
-- has flipped, the whole board only once it's over.
--
-- 1. challenge_ledger.kind accepts 'electrode_flip' (coins_earned in
--    player_achievements() counts it with no change).
-- 2. electrode_flip_boards: one row per board; at most one 'playing' board
--    per player. No client access: RPCs only.
-- 3. RPCs (each locks the player's wallet first, like every challenge RPC):
--      electrode_flip_state()          rules, level, coins left today,
--                                      records, the board in progress
--      electrode_flip_start()          deals a board (or returns the one in
--                                      progress; at most 20 a minute)
--      electrode_flip_flip(p_index)    flips tile 0..24 (row by row)
--      electrode_flip_cash_out()       ends the board, keeping its points
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Ledger ----------

set local application_name = 'migration 0014: step 1/3 ledger kind';

alter table public.challenge_ledger drop constraint if exists challenge_ledger_kind_check;
alter table public.challenge_ledger add constraint challenge_ledger_kind_check
  check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission', 'minigame', 'electrode_flip'));

-- ---------- 2. Boards ----------

set local application_name = 'migration 0014: step 2/3 boards';

create table if not exists public.electrode_flip_boards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_day date not null default public.challenge_today(),
  level int not null check (level between 1 and 5),
  tiles smallint[] not null,         -- 25 tiles, row by row: 0 = Electrode, else 1..3
  flipped boolean[] not null default array_fill(false, array[25]),
  flips int not null default 0,      -- point tiles flipped (the Electrode not counted)
  points int not null default 0,
  coins int not null default 0,      -- coins the board paid
  status text not null default 'playing' check (status in ('playing', 'won', 'lost', 'cashed')),
  next_level int,                    -- set when the board ends
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists electrode_flip_one_playing on public.electrode_flip_boards (user_id) where status = 'playing';
create index if not exists electrode_flip_user_day_idx on public.electrode_flip_boards (user_id, game_day);

-- RLS on, no policy: only the SECURITY DEFINER functions below touch it
alter table public.electrode_flip_boards enable row level security;
revoke all on public.electrode_flip_boards from anon, authenticated;

-- ---------- 3. RPCs ----------

set local application_name = 'migration 0014: step 3/3 functions';

create or replace function public.electrode_flip_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('levels', 5, 'daily_coins', 300)
$$;

-- A random layout for a level: how many 2s, 3s and Electrodes (the rest are
-- 1s). Voltorb Flip's levels 1 to 5.
create or replace function public.electrode_flip_layout(p_level int, out twos int, out threes int, out electrodes int)
language plpgsql
volatile
as $$
declare
  v_layouts int[][] := case p_level
    when 1 then array[[3, 1, 6], [0, 3, 6], [5, 0, 6], [2, 2, 6], [4, 1, 6]]
    when 2 then array[[1, 3, 7], [6, 0, 7], [3, 2, 7], [0, 4, 7], [5, 1, 7]]
    when 3 then array[[2, 3, 8], [7, 0, 8], [4, 2, 8], [1, 4, 8], [6, 1, 8]]
    when 4 then array[[3, 3, 8], [0, 5, 8], [8, 0, 10], [5, 2, 10], [2, 4, 10]]
    else array[[7, 1, 10], [4, 3, 10], [1, 5, 10], [9, 0, 10], [6, 2, 10]]
  end;
  v_pick int := 1 + floor(random() * 5)::int;
begin
  twos := v_layouts[v_pick][1];
  threes := v_layouts[v_pick][2];
  electrodes := v_layouts[v_pick][3];
end;
$$;

-- A shuffled board for a level
create or replace function public.electrode_flip_deal(p_level int)
returns smallint[]
language plpgsql
volatile
as $$
declare
  v_layout record;
begin
  select * into v_layout from public.electrode_flip_layout(p_level);
  return (
    select array_agg(t order by random())
    from (
      select 0::smallint t from generate_series(1, v_layout.electrodes)
      union all select 2::smallint from generate_series(1, v_layout.twos)
      union all select 3::smallint from generate_series(1, v_layout.threes)
      union all select 1::smallint from generate_series(1, 25 - v_layout.electrodes - v_layout.twos - v_layout.threes)
    ) tiles
  );
end;
$$;

-- The board as the client sees it: hints, flipped tiles (all once it's over)
create or replace function public.electrode_flip_view(p_board public.electrode_flip_boards)
returns jsonb
language sql
stable
as $$
  with t as (
    select i - 1 as idx, (i - 1) / 5 as r, (i - 1) % 5 as c, p_board.tiles[i] as v, p_board.flipped[i] as shown
    from generate_series(1, 25) i
  )
  select jsonb_build_object(
    'level', p_board.level,
    'points', p_board.points,
    'flips', p_board.flips,
    'status', p_board.status,
    'rows', (select jsonb_agg(h order by r) from (
      select r, jsonb_build_object('points', coalesce(sum(v) filter (where v > 0), 0), 'electrodes', count(*) filter (where v = 0)) h
      from t group by r) rows),
    'cols', (select jsonb_agg(h order by c) from (
      select c, jsonb_build_object('points', coalesce(sum(v) filter (where v > 0), 0), 'electrodes', count(*) filter (where v = 0)) h
      from t group by c) cols),
    'tiles', (select jsonb_agg(case when shown or p_board.status <> 'playing' then to_jsonb(v) else 'null'::jsonb end order by idx) from t),
    'flipped', (select jsonb_agg(shown order by idx) from t)
  )
$$;

-- Coins this game paid today
create or replace function public.electrode_flip_today(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(b.coins), 0)::int from public.electrode_flip_boards b
  where b.user_id = p_user and b.game_day = public.challenge_today()
$$;

create or replace function public.electrode_flip_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.electrode_flip_rules();
  v_board public.electrode_flip_boards;
  v_level int;
  v_today int := public.electrode_flip_today(v_user);
begin
  select * into v_board from public.electrode_flip_boards b where b.user_id = v_user and b.status = 'playing';
  if v_board.id is not null then
    v_level := v_board.level;
  else
    select b.next_level into v_level from public.electrode_flip_boards b
    where b.user_id = v_user and b.next_level is not null
    order by b.ended_at desc, b.id desc limit 1;
  end if;

  return v_rules || jsonb_build_object(
    'coins', v_wallet.coins,
    'level', coalesce(v_level, 1),
    'today_coins', v_today,
    'coins_left', greatest((v_rules->>'daily_coins')::int - v_today, 0),
    'best_points', (select coalesce(max(b.points), 0) from public.electrode_flip_boards b
                    where b.user_id = v_user and b.status in ('won', 'cashed')),
    'best_level', (select coalesce(max(b.level), 0) from public.electrode_flip_boards b
                   where b.user_id = v_user and b.status = 'won'),
    'board', case when v_board.id is null then null else public.electrode_flip_view(v_board) end
  );
end;
$$;

create or replace function public.electrode_flip_start()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_level int;
begin
  -- A board in progress is resumed, never thrown away (that would dodge a loss)
  if exists (select 1 from public.electrode_flip_boards b where b.user_id = v_user and b.status = 'playing') then
    return public.electrode_flip_state();
  end if;
  if (select count(*) from public.electrode_flip_boards b
      where b.user_id = v_user and b.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;

  v_level := (public.electrode_flip_state()->>'level')::int;
  insert into public.electrode_flip_boards (user_id, level, tiles)
  values (v_user, v_level, public.electrode_flip_deal(v_level));

  return public.electrode_flip_state();
end;
$$;

-- Ends the playing board: pays its points (within today's limit), sets the
-- next level. Called by flip (won / lost) and cash out.
create or replace function public.electrode_flip_end(p_board public.electrode_flip_boards, p_status text)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules jsonb := public.electrode_flip_rules();
  v_points int := case when p_status = 'lost' then 0 else p_board.points end;
  v_earned int := 0;
  v_next int;
begin
  if v_points > 0 then
    v_earned := least(v_points, greatest((v_rules->>'daily_coins')::int - public.electrode_flip_today(p_board.user_id), 0));
  end if;
  if v_earned > 0 then
    update public.challenge_wallets set coins = coins + v_earned where user_id = p_board.user_id;
    insert into public.challenge_ledger (user_id, kind, amount, game_day)
    values (p_board.user_id, 'electrode_flip', v_earned, p_board.game_day);
  end if;

  v_next := case when p_status = 'won' then least(p_board.level + 1, (v_rules->>'levels')::int)
                 else greatest(1, least(p_board.level, p_board.flips)) end;
  update public.electrode_flip_boards b
  set status = p_status, points = v_points, coins = v_earned, next_level = v_next, ended_at = now()
  where b.id = p_board.id;
  return v_earned;
end;
$$;

create or replace function public.electrode_flip_flip(p_index int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_board public.electrode_flip_boards;
  v_value int;
  v_earned int := 0;
begin
  if p_index is null or p_index not between 0 and 24 then
    raise exception 'invalid_tile';
  end if;
  select * into v_board from public.electrode_flip_boards b where b.user_id = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if v_board.flipped[p_index + 1] then
    raise exception 'already_flipped';
  end if;

  v_value := v_board.tiles[p_index + 1];
  v_board.flipped[p_index + 1] := true;
  if v_value > 0 then
    v_board.flips := v_board.flips + 1;
    v_board.points := case when v_board.points = 0 then v_value else v_board.points * v_value end;
  end if;
  update public.electrode_flip_boards b
  set flipped = v_board.flipped, flips = v_board.flips, points = v_board.points
  where b.id = v_board.id;

  if v_value = 0 then
    v_earned := public.electrode_flip_end(v_board, 'lost');
  elsif not exists (select 1 from generate_series(1, 25) i where v_board.tiles[i] >= 2 and not v_board.flipped[i]) then
    v_earned := public.electrode_flip_end(v_board, 'won');
  end if;

  select * into v_board from public.electrode_flip_boards b where b.id = v_board.id;
  return jsonb_build_object(
    'index', p_index,
    'value', v_value,
    'earned', v_earned,
    'result', public.electrode_flip_view(v_board),
    'state', public.electrode_flip_state()
  );
end;
$$;

create or replace function public.electrode_flip_cash_out()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_board public.electrode_flip_boards;
  v_earned int;
begin
  select * into v_board from public.electrode_flip_boards b where b.user_id = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if v_board.flips = 0 then
    raise exception 'nothing_to_cash';
  end if;

  v_earned := public.electrode_flip_end(v_board, 'cashed');
  select * into v_board from public.electrode_flip_boards b where b.id = v_board.id;
  return jsonb_build_object(
    'earned', v_earned,
    'result', public.electrode_flip_view(v_board),
    'state', public.electrode_flip_state()
  );
end;
$$;

revoke execute on function public.electrode_flip_layout(int) from public, anon, authenticated;
revoke execute on function public.electrode_flip_deal(int) from public, anon, authenticated;
revoke execute on function public.electrode_flip_view(public.electrode_flip_boards) from public, anon, authenticated;
revoke execute on function public.electrode_flip_today(uuid) from public, anon, authenticated;
revoke execute on function public.electrode_flip_end(public.electrode_flip_boards, text) from public, anon, authenticated;
revoke execute on function public.electrode_flip_state() from public, anon;
revoke execute on function public.electrode_flip_start() from public, anon;
revoke execute on function public.electrode_flip_flip(int) from public, anon;
revoke execute on function public.electrode_flip_cash_out() from public, anon;
grant execute on function public.electrode_flip_state() to authenticated;
grant execute on function public.electrode_flip_start() to authenticated;
grant execute on function public.electrode_flip_flip(int) to authenticated;
grant execute on function public.electrode_flip_cash_out() to authenticated;
