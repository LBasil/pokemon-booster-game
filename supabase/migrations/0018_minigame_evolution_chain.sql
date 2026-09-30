-- Pokémon Booster Game — Challenge: "Evolution chain" mini-game
-- Run after 0017_trade_answers_recycle_picks.sql.
--
-- Three cards of one evolution line show up shuffled (Basic, Stage 1,
-- Stage 2); tap them in evolution order. A run lasts until the first wrong
-- order. The lines come from the cards themselves: cards.evolves_from is new
-- here (pokemontcg.io `evolvesFrom`, the name of the previous stage) and
-- filled by scripts/populate.mjs (the sync, or a manual run of the "Sync
-- cards" Action). Until it's filled, the game says "Coming soon"
-- (evolution_chain_state().ready = false). The Pokédex number isn't enough
-- (Eevee, regional forms): a line is Stage 2 -> the Stage 1 it names ->
-- the Basic that one names, any printing of each.
--
-- The simplest of the mini-games, so it pays the least (user, 2026-09-30):
-- 180 coins a day at most, where the others pay 300.
--
-- Rules (mirrored in src/utils/evolutionChain.js — change both together):
--   - 15 seconds per line (the server allows 20: display + latency); a late
--     answer ends the run like a wrong one.
--   - Intruders (cards from another line, never picked) as the streak
--     grows: none (streak 0-4), 1 (5-9), then 2.
--   - 3 paid runs per game day (00:00 UTC): 3 coins per right line, for the
--     first 20 of the run (60 per run, 180 a day at most). Unpaid runs are
--     unlimited, for the record (best streak).
--
-- The server owns every answer: the client gets the cards' names and
-- pictures (the page crops the stage and "Evolves from" off), never their
-- stage, until it has answered. Accepted limit (same as the other games):
-- cards is readable by anyone, a script could look the stages up within the
-- 15 s — the daily cap bounds what that can earn.
--
-- 1. cards.evolves_from (text) + an index on cards.name to follow the lines;
--    challenge_ledger.kind accepts 'evolution_chain' (one row per paid
--    answer, so coins_earned in player_achievements() counts them).
-- 2. evolution_chain_runs: one row per run; at most one 'playing' run per
--    player. No client access: RPCs only.
-- 3. RPCs (each locks the player's wallet first, like every challenge RPC):
--      evolution_chain_state()           rules, whether lines are ready, paid
--                                        runs left today, best streak, the run
--                                        in progress (resumed after a reload)
--      evolution_chain_start()           abandons the run in progress, starts
--                                        one (at most 20 starts a minute)
--      evolution_chain_answer(p_order)   the 3 card ids in evolution order
--                                        (null = time's up); returns the right
--                                        order + next state
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Lines + ledger ----------

set local application_name = 'migration 0018: step 1/3 evolves_from + ledger kind';

alter table public.cards add column if not exists evolves_from text;
create index if not exists cards_name_idx on public.cards (name);

alter table public.challenge_ledger drop constraint if exists challenge_ledger_kind_check;
alter table public.challenge_ledger add constraint challenge_ledger_kind_check
  check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission', 'minigame', 'electrode_flip', 'super_effective', 'evolution_chain'));

-- ---------- 2. Runs ----------

set local application_name = 'migration 0018: step 2/3 runs';

create table if not exists public.evolution_chain_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_day date not null default public.challenge_today(),
  paid boolean not null,
  streak int not null default 0,     -- right lines so far
  coins int not null default 0,      -- coins this run has paid
  chain text[],                      -- the current line's card ids, Basic first
  cards text[],                      -- the cards shown: the line + intruders, shuffled
  shown_at timestamptz not null default now(),  -- when the current line was drawn
  status text not null default 'playing' check (status in ('playing', 'lost', 'timeout', 'abandoned')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists evolution_chain_runs_one_playing on public.evolution_chain_runs (user_id) where status = 'playing';
create index if not exists evolution_chain_runs_user_day_idx on public.evolution_chain_runs (user_id, game_day);

-- RLS on, no policy: only the SECURITY DEFINER functions below touch it
alter table public.evolution_chain_runs enable row level security;
revoke all on public.evolution_chain_runs from anon, authenticated;

-- ---------- 3. RPCs ----------

set local application_name = 'migration 0018: step 3/3 functions';

create or replace function public.evolution_chain_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('paid_runs', 3, 'coins_per_answer', 3, 'max_paid_answers', 20, 'answer_seconds', 15)
$$;

-- How many cards from another line are mixed in at a streak
create or replace function public.evolution_chain_intruders(p_streak int)
returns int
language sql
immutable
as $$
  select case when p_streak < 5 then 0 when p_streak < 10 then 1 else 2 end
$$;

-- Some full line exists: a Stage 2 whose Stage 1 exists, whose Basic exists
create or replace function public.evolution_chain_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cards top
    join public.cards mid on mid.name = top.evolves_from and 'Stage 1' = any (mid.subtypes) and mid.image_small is not null
    join public.cards base on base.name = mid.evolves_from and 'Basic' = any (base.subtypes) and base.image_small is not null
    where 'Stage 2' = any (top.subtypes) and top.image_small is not null
      and top.supertype = 'Pokémon' and mid.supertype = 'Pokémon' and base.supertype = 'Pokémon'
  )
$$;

-- The cards as the client sees them during a question, in the given order:
-- name and picture, no stage
create or replace function public.evolution_chain_cards(p_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'image_small', c.image_small) order by i.n), '[]'::jsonb)
  from unnest(p_ids) with ordinality i(id, n)
  join public.cards c on c.id = i.id
$$;

-- A random line (one printing per stage) and the shuffled cards to show:
-- the line + intruders from other lines (same type first, so they blend in)
create or replace function public.evolution_chain_question(p_streak int, out q_chain text[], out q_cards text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_top public.cards;
  v_mid public.cards;
  v_base public.cards;
  v_names text[];
  v_dex int[];
begin
  -- A random Stage 2, then a random printing of each previous stage. Most
  -- Stage 2 lead to a full line; the rare dead end (a stage missing from
  -- the database) just draws again.
  for i in 1..30 loop
    select * into v_top from public.cards c
    where 'Stage 2' = any (c.subtypes) and c.supertype = 'Pokémon' and c.evolves_from is not null and c.image_small is not null
    order by random() limit 1;
    exit when not found;

    select * into v_mid from public.cards c
    where c.name = v_top.evolves_from and 'Stage 1' = any (c.subtypes) and c.supertype = 'Pokémon'
      and c.evolves_from is not null and c.image_small is not null
    order by random() limit 1;
    continue when not found;

    select * into v_base from public.cards c
    where c.name = v_mid.evolves_from and 'Basic' = any (c.subtypes) and c.supertype = 'Pokémon' and c.image_small is not null
    order by random() limit 1;
    if found then
      q_chain := array[v_base.id, v_mid.id, v_top.id];
      exit;
    end if;
  end loop;

  if q_chain is null then
    raise exception 'evolution_chain_unavailable';
  end if;

  -- Intruders: nothing that could belong to the line (same names, same
  -- Pokédex numbers, or evolving from one of its stages)
  v_names := array[v_base.name, v_mid.name, v_top.name];
  v_dex := array_remove(array[v_base.national_pokedex_number, v_mid.national_pokedex_number, v_top.national_pokedex_number], null);
  select array_agg(x.id order by random()) into q_cards
  from (
    select unnest(q_chain) as id
    union all
    (select c.id from public.cards c
     where c.supertype = 'Pokémon' and c.image_small is not null
       and c.name <> all (v_names)
       and (c.evolves_from is null or c.evolves_from <> all (v_names))
       and (c.national_pokedex_number is null or c.national_pokedex_number <> all (v_dex))
     order by coalesce(c.types && v_top.types, false) desc, random()
     limit public.evolution_chain_intruders(p_streak))
  ) x;
end;
$$;

-- Everything the page needs; closes a run whose question timed out
create or replace function public.evolution_chain_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.evolution_chain_rules();
  v_run public.evolution_chain_runs;
  v_paid int;
begin
  update public.evolution_chain_runs r set status = 'timeout', ended_at = now()
  where r.user_id = v_user and r.status = 'playing'
    and r.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);

  select * into v_run from public.evolution_chain_runs r where r.user_id = v_user and r.status = 'playing';
  select count(*) into v_paid from public.evolution_chain_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();

  return v_rules || jsonb_build_object(
    'ready', public.evolution_chain_ready(),
    'coins', v_wallet.coins,
    'paid_left', greatest((v_rules->>'paid_runs')::int - v_paid, 0),
    'today_coins', (select coalesce(sum(r.coins), 0) from public.evolution_chain_runs r
                    where r.user_id = v_user and r.game_day = public.challenge_today()),
    'best', (select coalesce(max(r.streak), 0) from public.evolution_chain_runs r where r.user_id = v_user),
    'run', case when v_run.id is null then null else jsonb_build_object(
      'paid', v_run.paid,
      'streak', v_run.streak,
      'coins', v_run.coins,
      'cards', public.evolution_chain_cards(v_run.cards),
      'seconds_left', greatest(0, least((v_rules->>'answer_seconds')::int,
        (v_rules->>'answer_seconds')::int - floor(extract(epoch from now() - v_run.shown_at))::int))
    ) end
  );
end;
$$;

create or replace function public.evolution_chain_start()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_question record;
  v_paid int;
begin
  if (select count(*) from public.evolution_chain_runs r
      where r.user_id = v_user and r.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;

  update public.evolution_chain_runs r set status = 'abandoned', ended_at = now()
  where r.user_id = v_user and r.status = 'playing';

  select count(*) into v_paid from public.evolution_chain_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();
  select * into v_question from public.evolution_chain_question(0);

  insert into public.evolution_chain_runs (user_id, paid, chain, cards)
  values (v_user, v_paid < (public.evolution_chain_rules()->>'paid_runs')::int, v_question.q_chain, v_question.q_cards);

  return public.evolution_chain_state();
end;
$$;

create or replace function public.evolution_chain_answer(p_order text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.evolution_chain_rules();
  v_run public.evolution_chain_runs;
  v_late boolean;
  v_right_answer boolean;
  v_earned int := 0;
  v_question record;
begin
  select * into v_run from public.evolution_chain_runs r where r.user_id = v_user and r.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  -- 3 different cards among those shown
  if p_order is not null and (
    cardinality(p_order) <> 3
    or not p_order <@ v_run.cards
    or (select count(distinct o) from unnest(p_order) o) <> 3
  ) then
    raise exception 'invalid_pick';
  end if;

  v_late := p_order is null or v_run.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);
  v_right_answer := not v_late and p_order = v_run.chain;

  if v_right_answer then
    if v_run.paid and v_run.streak < (v_rules->>'max_paid_answers')::int then
      v_earned := (v_rules->>'coins_per_answer')::int;
      update public.challenge_wallets set coins = coins + v_earned where user_id = v_user;
      insert into public.challenge_ledger (user_id, kind, amount, game_day)
      values (v_user, 'evolution_chain', v_earned, v_run.game_day);
    end if;
    select * into v_question from public.evolution_chain_question(v_run.streak + 1);
    update public.evolution_chain_runs r
    set streak = r.streak + 1, coins = r.coins + v_earned,
        chain = v_question.q_chain, cards = v_question.q_cards, shown_at = now()
    where r.id = v_run.id;
  else
    update public.evolution_chain_runs r
    set status = case when v_late then 'timeout' else 'lost' end, ended_at = now()
    where r.id = v_run.id;
  end if;

  return jsonb_build_object(
    'correct', v_right_answer,
    'late', v_late,
    'earned', v_earned,
    'streak', v_run.streak + v_right_answer::int,
    'run_coins', v_run.coins + v_earned,
    'chain', to_jsonb(v_run.chain),
    'state', public.evolution_chain_state()
  );
end;
$$;

revoke execute on function public.evolution_chain_ready() from public, anon, authenticated;
revoke execute on function public.evolution_chain_cards(text[]) from public, anon, authenticated;
revoke execute on function public.evolution_chain_question(int) from public, anon, authenticated;
revoke execute on function public.evolution_chain_state() from public, anon;
revoke execute on function public.evolution_chain_start() from public, anon;
revoke execute on function public.evolution_chain_answer(text[]) from public, anon;
grant execute on function public.evolution_chain_state() to authenticated;
grant execute on function public.evolution_chain_start() to authenticated;
grant execute on function public.evolution_chain_answer(text[]) to authenticated;
