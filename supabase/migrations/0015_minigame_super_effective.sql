-- Pokémon Booster Game — Challenge: "Super effective!" mini-game
-- Run after 0014_minigame_electrode_flip.sql.
--
-- A Pokémon card shows up (its top half: the weakness is printed at the
-- bottom); tap the type it's weak to. A run lasts until the first wrong
-- answer. The answer is the card's real weakness, as printed (pokemontcg.io
-- `weaknesses`), so no type chart to maintain: cards.weaknesses is new here
-- and filled by scripts/populate.mjs (the weekly sync, or a manual run of
-- the "Sync cards" Action). Until it's filled, the game says "Coming soon"
-- (super_effective_state().ready = false).
--
-- Rules (mirrored in src/utils/superEffective.js — change both together):
--   - 10 seconds per question (the server allows 15: display + latency);
--     a late answer ends the run like a wrong one.
--   - More types to pick from as the streak grows: 3 (streak 0-4), 4 (5-9),
--     then 6. Colorless is never offered (no card is weak to it).
--   - 3 paid runs per game day (00:00 UTC): 5 coins per right answer, for
--     the first 20 of the run (100 per run, 300 a day at most). Unpaid runs
--     are unlimited, for the record (best streak).
--
-- The server owns every answer: the client gets the card's name, types and
-- picture, never its weakness, until it has answered. Accepted limit (same
-- as "Higher or lower" and the prices): cards is readable by anyone and the
-- full card image shows the weakness, so a script could look it up within
-- the 10 s — the daily cap bounds what that can earn.
--
-- 1. cards.weaknesses (text[], e.g. {Fire}); challenge_ledger.kind accepts
--    'super_effective' (one row per paid answer, so coins_earned in
--    player_achievements() counts them with no change).
-- 2. super_effective_runs: one row per run; at most one 'playing' run per
--    player. No client access: RPCs only.
-- 3. RPCs (each locks the player's wallet first, like every challenge RPC):
--      super_effective_state()          rules, whether cards are ready, paid
--                                       runs left today, best streak, the run
--                                       in progress (resumed after a reload)
--      super_effective_start()          abandons the run in progress, starts
--                                       one (at most 20 starts a minute)
--      super_effective_answer(p_pick)   a type among the options (null = time's
--                                       up); returns the answer + next state
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Weaknesses + ledger ----------

set local application_name = 'migration 0015: step 1/3 weaknesses + ledger kind';

alter table public.cards add column if not exists weaknesses text[];

alter table public.challenge_ledger drop constraint if exists challenge_ledger_kind_check;
alter table public.challenge_ledger add constraint challenge_ledger_kind_check
  check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission', 'minigame', 'electrode_flip', 'super_effective'));

-- ---------- 2. Runs ----------

set local application_name = 'migration 0015: step 2/3 runs';

create table if not exists public.super_effective_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_day date not null default public.challenge_today(),
  paid boolean not null,
  streak int not null default 0,     -- right answers so far
  coins int not null default 0,      -- coins this run has paid
  card_id text references public.cards (id) on delete set null,
  answer text,                       -- the right type for the current card
  options text[],                    -- the types offered, answer included
  shown_at timestamptz not null default now(),  -- when the current card was drawn
  status text not null default 'playing' check (status in ('playing', 'lost', 'timeout', 'abandoned')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists super_effective_runs_one_playing on public.super_effective_runs (user_id) where status = 'playing';
create index if not exists super_effective_runs_user_day_idx on public.super_effective_runs (user_id, game_day);

-- RLS on, no policy: only the SECURITY DEFINER functions below touch it
alter table public.super_effective_runs enable row level security;
revoke all on public.super_effective_runs from anon, authenticated;

-- ---------- 3. RPCs ----------

set local application_name = 'migration 0015: step 3/3 functions';

create or replace function public.super_effective_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('paid_runs', 3, 'coins_per_answer', 5, 'max_paid_answers', 20, 'answer_seconds', 10)
$$;

-- The types a card can be weak to (Colorless never is)
create or replace function public.super_effective_types()
returns text[]
language sql
immutable
as $$
  select array['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon']
$$;

-- How many types are offered at a streak
create or replace function public.super_effective_option_count(p_streak int)
returns int
language sql
immutable
as $$
  select case when p_streak < 5 then 3 when p_streak < 10 then 4 else 6 end
$$;

-- Cards that can be asked: a weakness, a type and a picture
create or replace function public.super_effective_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.cards c
    where cardinality(c.weaknesses) > 0 and c.types is not null and c.image_small is not null
  )
$$;

-- A card as the client sees it during a question: no weakness
create or replace function public.super_effective_card(p_card_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'types', c.types, 'hp', c.hp, 'image_small', c.image_small,
    'image_url', c.image_url, 'set_id', c.set_id, 'set_name', s.name)
  from public.cards c
  left join public.sets s on s.id = c.set_id
  where c.id = p_card_id
$$;

-- A random card, its answer (one of its weaknesses) and the shuffled options:
-- the answer + types the card isn't weak to
create or replace function public.super_effective_question(p_streak int, out q_card text, out q_answer text, out q_options text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_card public.cards;
begin
  select * into v_card from public.cards c
  where cardinality(c.weaknesses) > 0 and c.types is not null and c.image_small is not null
  order by random() limit 1;
  if not found then
    raise exception 'super_effective_unavailable';
  end if;

  q_card := v_card.id;
  q_answer := v_card.weaknesses[1 + floor(random() * cardinality(v_card.weaknesses))::int];
  select array_agg(o.t order by random()) into q_options
  from (
    select q_answer as t
    union all
    (select p.t from unnest(public.super_effective_types()) p(t)
     where p.t <> all (v_card.weaknesses)
     order by random()
     limit public.super_effective_option_count(p_streak) - 1)
  ) o;
end;
$$;

-- Everything the page needs; closes a run whose question timed out
create or replace function public.super_effective_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.super_effective_rules();
  v_run public.super_effective_runs;
  v_paid int;
begin
  update public.super_effective_runs r set status = 'timeout', ended_at = now()
  where r.user_id = v_user and r.status = 'playing'
    and r.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);

  select * into v_run from public.super_effective_runs r where r.user_id = v_user and r.status = 'playing';
  select count(*) into v_paid from public.super_effective_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();

  return v_rules || jsonb_build_object(
    'ready', public.super_effective_ready(),
    'coins', v_wallet.coins,
    'paid_left', greatest((v_rules->>'paid_runs')::int - v_paid, 0),
    'today_coins', (select coalesce(sum(r.coins), 0) from public.super_effective_runs r
                    where r.user_id = v_user and r.game_day = public.challenge_today()),
    'best', (select coalesce(max(r.streak), 0) from public.super_effective_runs r where r.user_id = v_user),
    'run', case when v_run.id is null then null else jsonb_build_object(
      'paid', v_run.paid,
      'streak', v_run.streak,
      'coins', v_run.coins,
      'card', public.super_effective_card(v_run.card_id),
      'options', to_jsonb(v_run.options),
      'seconds_left', greatest(0, least((v_rules->>'answer_seconds')::int,
        (v_rules->>'answer_seconds')::int - floor(extract(epoch from now() - v_run.shown_at))::int))
    ) end
  );
end;
$$;

create or replace function public.super_effective_start()
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
  if (select count(*) from public.super_effective_runs r
      where r.user_id = v_user and r.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;

  update public.super_effective_runs r set status = 'abandoned', ended_at = now()
  where r.user_id = v_user and r.status = 'playing';

  select count(*) into v_paid from public.super_effective_runs r
  where r.user_id = v_user and r.paid and r.game_day = public.challenge_today();
  select * into v_question from public.super_effective_question(0);

  insert into public.super_effective_runs (user_id, paid, card_id, answer, options)
  values (v_user, v_paid < (public.super_effective_rules()->>'paid_runs')::int,
    v_question.q_card, v_question.q_answer, v_question.q_options);

  return public.super_effective_state();
end;
$$;

create or replace function public.super_effective_answer(p_pick text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.super_effective_rules();
  v_run public.super_effective_runs;
  v_weaknesses text[];
  v_late boolean;
  v_right_answer boolean;
  v_earned int := 0;
  v_question record;
begin
  select * into v_run from public.super_effective_runs r where r.user_id = v_user and r.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if p_pick is not null and not p_pick = any (v_run.options) then
    raise exception 'invalid_pick';
  end if;

  select c.weaknesses into v_weaknesses from public.cards c where c.id = v_run.card_id;
  v_late := p_pick is null or v_run.shown_at < now() - make_interval(secs => (v_rules->>'answer_seconds')::int + 5);
  v_right_answer := not v_late and p_pick = v_run.answer;

  if v_right_answer then
    if v_run.paid and v_run.streak < (v_rules->>'max_paid_answers')::int then
      v_earned := (v_rules->>'coins_per_answer')::int;
      update public.challenge_wallets set coins = coins + v_earned where user_id = v_user;
      insert into public.challenge_ledger (user_id, kind, amount, game_day)
      values (v_user, 'super_effective', v_earned, v_run.game_day);
    end if;
    select * into v_question from public.super_effective_question(v_run.streak + 1);
    update public.super_effective_runs r
    set streak = r.streak + 1, coins = r.coins + v_earned,
        card_id = v_question.q_card, answer = v_question.q_answer, options = v_question.q_options, shown_at = now()
    where r.id = v_run.id;
  else
    update public.super_effective_runs r
    set status = case when v_late then 'timeout' else 'lost' end, ended_at = now()
    where r.id = v_run.id;
  end if;

  return jsonb_build_object(
    'correct', v_right_answer,
    'late', v_late,
    'earned', v_earned,
    'streak', v_run.streak + v_right_answer::int,
    'run_coins', v_run.coins + v_earned,
    'answer', v_run.answer,
    'weaknesses', to_jsonb(coalesce(v_weaknesses, array[v_run.answer])),
    'state', public.super_effective_state()
  );
end;
$$;

revoke execute on function public.super_effective_ready() from public, anon, authenticated;
revoke execute on function public.super_effective_card(text) from public, anon, authenticated;
revoke execute on function public.super_effective_question(int) from public, anon, authenticated;
revoke execute on function public.super_effective_state() from public, anon;
revoke execute on function public.super_effective_start() from public, anon;
revoke execute on function public.super_effective_answer(text) from public, anon;
grant execute on function public.super_effective_state() to authenticated;
grant execute on function public.super_effective_start() to authenticated;
grant execute on function public.super_effective_answer(text) to authenticated;
