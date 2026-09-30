-- Pokémon Booster Game — "Evolution chain": two-stage lines + a Stop button
-- Run after 0018_minigame_evolution_chain.sql.
--
-- User, 2026-09-30: "un bouton pour dire qu'on stop" and "des lignées
-- évolutives que de deux, car ça restreint beaucoup de se limiter à 3".
--
-- 1. Two-stage lines: about 2 lines in 5 are a Basic and a Stage 1 that
--    nothing evolves from (Pikachu -> Raichu, Magikarp -> Gyarados, Eevee ->
--    Vaporeon...), never a three-stage line cut short (Charmander ->
--    Charmeleon would leave Charizard out). If one kind can't be drawn, the
--    other is. The run tells the client how many cards to pick
--    (`run.length`: 2 or 3; the intruders come on top), and an answer must
--    have exactly that many. An index on cards.evolves_from finds the
--    Stage 1 nothing evolves from.
-- 2. evolution_chain_stop(): ends the run in progress (status 'stopped').
--    Coins already earned stay (they're paid answer by answer), and its
--    streak counts for the best one, like a lost run.
--
-- Rewritten: evolution_chain_ready, evolution_chain_question,
-- evolution_chain_state (+ run.length), evolution_chain_answer (length
-- check). New: evolution_chain_line (internal), evolution_chain_stop.
-- Rules and pay are unchanged (src/utils/evolutionChain.js).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Index + status ----------

set local application_name = 'migration 0019: step 1/2 index + stopped status';

create index if not exists cards_evolves_from_idx on public.cards (evolves_from);

alter table public.evolution_chain_runs drop constraint if exists evolution_chain_runs_status_check;
alter table public.evolution_chain_runs add constraint evolution_chain_runs_status_check
  check (status in ('playing', 'lost', 'timeout', 'abandoned', 'stopped'));

-- ---------- 2. Functions ----------

set local application_name = 'migration 0019: step 2/2 functions';

-- Some line exists: a Basic and a Stage 1 that evolves from it (a Stage 2
-- line needs one too; a two-stage line is nothing more)
create or replace function public.evolution_chain_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cards mid
    join public.cards base on base.name = mid.evolves_from and 'Basic' = any (base.subtypes) and base.image_small is not null
    where 'Stage 1' = any (mid.subtypes) and mid.image_small is not null
      and mid.supertype = 'Pokémon' and base.supertype = 'Pokémon'
  )
$$;

-- A random line of 2 or 3 stages (one printing per stage, Basic first), or
-- null if none could be drawn. 3: a Stage 2 -> the Stage 1 it names -> the
-- Basic that one names. 2: a Stage 1 nothing evolves from -> its Basic.
create or replace function public.evolution_chain_line(p_stages int)
returns text[]
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_top public.cards;
  v_mid public.cards;
  v_base public.cards;
begin
  -- The rare dead end (a stage missing from the database) just draws again
  for i in 1..30 loop
    if p_stages = 3 then
      select * into v_top from public.cards c
      where 'Stage 2' = any (c.subtypes) and c.supertype = 'Pokémon' and c.evolves_from is not null and c.image_small is not null
      order by random() limit 1;
      exit when not found;

      select * into v_mid from public.cards c
      where c.name = v_top.evolves_from and 'Stage 1' = any (c.subtypes) and c.supertype = 'Pokémon'
        and c.evolves_from is not null and c.image_small is not null
      order by random() limit 1;
      continue when not found;
    else
      select * into v_mid from public.cards c
      where 'Stage 1' = any (c.subtypes) and c.supertype = 'Pokémon' and c.evolves_from is not null and c.image_small is not null
        and not exists (
          select 1 from public.cards n
          where n.evolves_from = c.name and 'Stage 2' = any (n.subtypes) and n.supertype = 'Pokémon'
        )
      order by random() limit 1;
      exit when not found;
    end if;

    select * into v_base from public.cards c
    where c.name = v_mid.evolves_from and 'Basic' = any (c.subtypes) and c.supertype = 'Pokémon' and c.image_small is not null
    order by random() limit 1;
    if found then
      return case when p_stages = 3 then array[v_base.id, v_mid.id, v_top.id] else array[v_base.id, v_mid.id] end;
    end if;
  end loop;
  return null;
end;
$$;

-- A random line (2 stages 2 times in 5, else 3) and the shuffled cards to
-- show: the line + intruders from other lines (same type first, so they
-- blend in)
create or replace function public.evolution_chain_question(p_streak int, out q_chain text[], out q_cards text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_stages int := case when random() < 0.4 then 2 else 3 end;
  v_names text[];
  v_dex int[];
  v_types text[];
begin
  q_chain := coalesce(public.evolution_chain_line(v_stages), public.evolution_chain_line(5 - v_stages));
  if q_chain is null then
    raise exception 'evolution_chain_unavailable';
  end if;

  -- Intruders: nothing that could belong to the line (same names, same
  -- Pokédex numbers, or evolving from one of its stages)
  select array_agg(c.name), array_remove(array_agg(c.national_pokedex_number), null)
  into v_names, v_dex
  from public.cards c where c.id = any (q_chain);
  select c.types into v_types from public.cards c where c.id = q_chain[cardinality(q_chain)];

  select array_agg(x.id order by random()) into q_cards
  from (
    select unnest(q_chain) as id
    union all
    (select c.id from public.cards c
     where c.supertype = 'Pokémon' and c.image_small is not null
       and c.name <> all (v_names)
       and (c.evolves_from is null or c.evolves_from <> all (v_names))
       and (c.national_pokedex_number is null or c.national_pokedex_number <> all (v_dex))
     order by coalesce(c.types && v_types, false) desc, random()
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
      'length', cardinality(v_run.chain),
      'cards', public.evolution_chain_cards(v_run.cards),
      'seconds_left', greatest(0, least((v_rules->>'answer_seconds')::int,
        (v_rules->>'answer_seconds')::int - floor(extract(epoch from now() - v_run.shown_at))::int))
    ) end
  );
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
  -- As many different cards as the line has stages, among those shown
  if p_order is not null and (
    cardinality(p_order) <> cardinality(v_run.chain)
    or not p_order <@ v_run.cards
    or (select count(distinct o) from unnest(p_order) o) <> cardinality(v_run.chain)
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

-- The player ends the run: coins earned stay, the streak counts for the best
create or replace function public.evolution_chain_stop()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_run public.evolution_chain_runs;
begin
  update public.evolution_chain_runs r set status = 'stopped', ended_at = now()
  where r.user_id = v_user and r.status = 'playing'
  returning * into v_run;
  if v_run.id is null then
    raise exception 'no_game';
  end if;

  return jsonb_build_object(
    'streak', v_run.streak,
    'run_coins', v_run.coins,
    'state', public.evolution_chain_state()
  );
end;
$$;

revoke execute on function public.evolution_chain_ready() from public, anon, authenticated;
revoke execute on function public.evolution_chain_line(int) from public, anon, authenticated;
revoke execute on function public.evolution_chain_question(int) from public, anon, authenticated;
revoke execute on function public.evolution_chain_state() from public, anon;
revoke execute on function public.evolution_chain_answer(text[]) from public, anon;
revoke execute on function public.evolution_chain_stop() from public, anon;
grant execute on function public.evolution_chain_state() to authenticated;
grant execute on function public.evolution_chain_answer(text[]) to authenticated;
grant execute on function public.evolution_chain_stop() to authenticated;
