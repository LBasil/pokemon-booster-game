-- Pokémon Booster Game — Challenge: PvP battles (asynchronous)
-- Run after 0023_username_not_from_email.sql.
--
-- Each player saves a deck of 5 Pokémon from their challenge collection,
-- one per format. Attacking = picking a format: the server finds another
-- player of close Elo with a deck there and plays that deck against you
-- (user, 2026-10-03: "on attaque le deck de qq qui est joué par le
-- serveur"). The defender doesn't have to be online, and their deck stays
-- hidden: its cards show up as they're played.
--
-- Formats (user, 2026-10-03): 'all' (every card), 'era:<series>' (one era
-- of the TCG: Base, Neo, EX, ... Scarlet & Violet, sets.series, new here)
-- and 'set:<set id>' (one set; a subset's cards, Trainer Gallery & co,
-- count for their parent set).
--
-- Rules (mirrored in src/utils/pvp.js — change both together):
--   - Deck: 5 different Pokémon cards owned in the challenge collection,
--     each with an attack that deals damage (attacks with an effect only
--     don't count: about 6% of the cards have nothing else).
--   - A card's attack = its best printed one. "30+" counts 30; "20×" = 20
--     times a roll of 1 to 3, made by the server (counted 2 when choosing
--     the best attack). Weakness (attacker's type in the target's
--     weaknesses): x2. Resistance: -30. At least 10 damage.
--   - Each round, both sides play one living card: the defender's is
--     picked (and stored) before the attacker's arrives, so it can't counter
--     it. Both cards hit each other; HP stays damaged from one round to the
--     next. 3 KOs win. After 15 rounds, more KOs win, else a draw.
--   - Defender AI: first round at random, then the living card that hits
--     the attacker's last card hardest while taking the least back (+ a
--     little randomness).
--   - Rewards: Elo only (user: no coins), per format, K = 32, both players
--     move; win rates count attacks and defenses. 10 battles per game day
--     (00:00 UTC). A battle in progress is resumed, never skipped (a new
--     start returns it); giving up counts as a loss.
--   - Matchmaking: among the 5 decks of closest Elo in that format whose
--     cards are all still owned, at random, the last opponent last. Private
--     profiles can be drawn, but their name isn't shown.
--
-- 1. sets.series, cards.attacks (jsonb: [{name, damage}], damage as
--    printed), cards.resistances (types): filled by scripts/populate.mjs
--    (the sync). Until then, pvp_state().ready = false ("Coming soon").
-- 2. pvp_decks, pvp_ratings, pvp_battles: no client access (hidden decks,
--    server-written Elo), RPCs only.
-- 3. RPCs (each locks the player's challenge wallet first, like every
--    challenge RPC):
--      pvp_state()                      rules, formats with my eligible cards,
--                                       my decks + ratings, battles left
--                                       today, battle in progress, history
--      pvp_eligible(p_format)           my cards that fit a format
--      pvp_save_deck(p_format, p_cards) saves my deck for a format
--      pvp_start(p_format)              finds an opponent, starts (or resumes)
--      pvp_play(p_slot)                 plays my card (index 0-4 in my deck)
--      pvp_forfeit()                    gives up the battle in progress
--      pvp_leaderboard(p_format)        top 20 public players + my row
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Card data ----------

set local application_name = 'migration 0024: step 1/3 attacks, resistances, series';

alter table public.sets add column if not exists series text;
alter table public.cards add column if not exists attacks jsonb;
alter table public.cards add column if not exists resistances text[];

-- ---------- 2. Decks, ratings, battles ----------

set local application_name = 'migration 0024: step 2/3 tables';

create table if not exists public.pvp_decks (
  user_id uuid not null references auth.users (id) on delete cascade,
  format text not null,
  card_ids text[] not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, format)
);
create index if not exists pvp_decks_format_idx on public.pvp_decks (format);

create table if not exists public.pvp_ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  format text not null,
  elo int not null default 1000,
  wins int not null default 0,       -- as the attacker
  losses int not null default 0,
  draws int not null default 0,
  def_wins int not null default 0,   -- as the defender
  def_losses int not null default 0,
  def_draws int not null default 0,
  primary key (user_id, format)
);

create table if not exists public.pvp_battles (
  id bigint generated always as identity primary key,
  attacker uuid not null references auth.users (id) on delete cascade,
  defender uuid not null references auth.users (id) on delete cascade,
  format text not null,
  game_day date not null default public.challenge_today(),
  a_deck jsonb not null,      -- card snapshots (pvp_card), frozen at the start
  d_deck jsonb not null,
  a_hp int[] not null,
  d_hp int[] not null,
  d_next int,                 -- the defender's next card (index), picked before the attacker plays
  round int not null default 0,
  a_kos int not null default 0,  -- defender cards knocked out by the attacker
  d_kos int not null default 0,
  log jsonb not null default '[]',
  status text not null default 'playing' check (status in ('playing', 'won', 'lost', 'draw', 'forfeit')),
  elo_change int,             -- the attacker's (the defender moved by the opposite)
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists pvp_battles_one_playing on public.pvp_battles (attacker) where status = 'playing';
create index if not exists pvp_battles_attacker_idx on public.pvp_battles (attacker, created_at desc);
create index if not exists pvp_battles_defender_idx on public.pvp_battles (defender, created_at desc);

-- RLS on, no policy: only the SECURITY DEFINER functions below touch them
alter table public.pvp_decks enable row level security;
alter table public.pvp_ratings enable row level security;
alter table public.pvp_battles enable row level security;
revoke all on public.pvp_decks, public.pvp_ratings, public.pvp_battles from anon, authenticated;

-- ---------- 3. RPCs ----------

set local application_name = 'migration 0024: step 3/3 functions';

create or replace function public.pvp_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('deck_size', 5, 'kos_to_win', 3, 'max_rounds', 15, 'battles_per_day', 10,
    'start_elo', 1000, 'k_factor', 32, 'weakness_multiplier', 2, 'resistance', 30, 'min_damage', 10)
$$;

-- A card as a battle sees it, or null if it can't fight (not a Pokémon,
-- no HP, no attack that deals damage)
create or replace function public.pvp_card(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'image_small', c.image_small, 'hp', c.hp,
    'types', coalesce(to_jsonb(c.types), '[]'), 'weaknesses', coalesce(to_jsonb(c.weaknesses), '[]'),
    'resistances', coalesce(to_jsonb(c.resistances), '[]'),
    'attack', a.name, 'damage', a.damage, 'times', a.times)
  from public.cards c
  cross join lateral (
    select x->>'name' as name, (substring(x->>'damage' from '^(\d+)'))::int as damage, (x->>'damage') ~ '[×xX]$' as times
    from jsonb_array_elements(case when jsonb_typeof(c.attacks) = 'array' then c.attacks else '[]' end) x
    where coalesce((substring(x->>'damage' from '^(\d+)'))::int, 0) > 0
    order by (substring(x->>'damage' from '^(\d+)'))::int * case when (x->>'damage') ~ '[×xX]$' then 2 else 1 end desc
    limit 1
  ) a
  where c.id = p_id and c.supertype = 'Pokémon' and c.hp > 0
$$;

-- Whether a card belongs to a format: 'all', 'era:<series>', 'set:<id>'
-- (a subset's cards count for their parent)
create or replace function public.pvp_fits(p_card_id text, p_format text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_format = 'all' then true
    when p_format like 'era:%' then exists (
      select 1 from public.cards c join public.sets s on s.id = c.set_id
      where c.id = p_card_id and s.series = substring(p_format from 5))
    when p_format like 'set:%' then exists (
      select 1 from public.cards c join public.sets s on s.id = c.set_id
      where c.id = p_card_id and coalesce(s.parent_set_id, s.id) = substring(p_format from 5))
    else false
  end
$$;

create or replace function public.pvp_valid_format(p_format text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_format = 'all'
    or (p_format like 'era:%' and exists (select 1 from public.sets s where s.series = substring(p_format from 5)))
    or (p_format like 'set:%' and exists (select 1 from public.sets s where s.id = substring(p_format from 5) and s.parent_set_id is null))
$$;

-- Damage of one card's attack on another. `p_roll` (1-3) multiplies "20×"
create or replace function public.pvp_damage(p_from jsonb, p_to jsonb, p_roll int)
returns int
language sql
immutable
as $$
  select greatest((public.pvp_rules()->>'min_damage')::int,
    (p_from->>'damage')::int * case when (p_from->>'times')::boolean then p_roll else 1 end
      * case when exists (select 1 from jsonb_array_elements_text(p_from->'types') t
                          where p_to->'weaknesses' ? t) then (public.pvp_rules()->>'weakness_multiplier')::int else 1 end
    - case when exists (select 1 from jsonb_array_elements_text(p_from->'types') t
                        where p_to->'resistances' ? t) then (public.pvp_rules()->>'resistance')::int else 0 end)
$$;

-- A deck's card snapshots if every card is still owned (challenge
-- collection), can fight and fits the format; null otherwise
create or replace function public.pvp_deck_cards(p_user uuid, p_format text, p_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cards jsonb;
begin
  if cardinality(p_ids) is distinct from (public.pvp_rules()->>'deck_size')::int
     or (select count(distinct i) from unnest(p_ids) i) <> cardinality(p_ids) then
    return null;
  end if;
  select jsonb_agg(public.pvp_card(i.id) order by i.n) into v_cards
  from unnest(p_ids) with ordinality i(id, n)
  where exists (select 1 from public.collections c where c.user_id = p_user and c.mode = 'challenge' and c.card_id = i.id)
    and public.pvp_fits(i.id, p_format)
    and public.pvp_card(i.id) is not null;
  if jsonb_array_length(coalesce(v_cards, '[]')) <> cardinality(p_ids) then
    return null;
  end if;
  return v_cards;
end;
$$;

-- The defender's next card: at random first, then the living card that
-- hits the attacker's last card (if still standing) hardest and takes the least back
create or replace function public.pvp_defender_pick(p_deck jsonb, p_hp int[], p_last jsonb)
returns int
language sql
volatile
as $$
  select i - 1
  from generate_series(1, cardinality(p_hp)) i
  where p_hp[i] > 0
  order by case when p_last is null then random() * 100
           else public.pvp_damage(p_deck->(i - 1), p_last, 2) - 0.5 * public.pvp_damage(p_last, p_deck->(i - 1), 2) + random() * 20
           end desc
  limit 1
$$;

-- My rating row in a format (created at 1000)
create or replace function public.pvp_rating(p_user uuid, p_format text)
returns public.pvp_ratings
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.pvp_ratings;
begin
  insert into public.pvp_ratings (user_id, format, elo) values (p_user, p_format, (public.pvp_rules()->>'start_elo')::int)
  on conflict (user_id, format) do nothing;
  select * into v_row from public.pvp_ratings r where r.user_id = p_user and r.format = p_format;
  return v_row;
end;
$$;

-- Elo change for a result (1 win, 0.5 draw, 0 loss) of `a` against `b`
create or replace function public.pvp_elo_change(p_a int, p_b int, p_score numeric)
returns int
language sql
immutable
as $$
  select round((public.pvp_rules()->>'k_factor')::int * (p_score - 1 / (1 + power(10, (p_b - p_a) / 400.0))))::int
$$;

-- Ends a battle: status, both ratings (locked in user id order: two
-- players attacking each other at once can't deadlock)
create or replace function public.pvp_finish(p_battle_id bigint, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_battle public.pvp_battles;
  v_a public.pvp_ratings;
  v_d public.pvp_ratings;
  v_change int;
  v_score numeric := case p_status when 'won' then 1 when 'draw' then 0.5 else 0 end;
begin
  select * into v_battle from public.pvp_battles b where b.id = p_battle_id;
  perform public.pvp_rating(v_battle.attacker, v_battle.format);
  perform public.pvp_rating(v_battle.defender, v_battle.format);
  perform 1 from public.pvp_ratings r
  where r.format = v_battle.format and r.user_id in (v_battle.attacker, v_battle.defender)
  order by r.user_id for update;
  select * into v_a from public.pvp_ratings r where r.user_id = v_battle.attacker and r.format = v_battle.format;
  select * into v_d from public.pvp_ratings r where r.user_id = v_battle.defender and r.format = v_battle.format;

  v_change := public.pvp_elo_change(v_a.elo, v_d.elo, v_score);
  update public.pvp_ratings r set elo = r.elo + v_change,
    wins = r.wins + (p_status = 'won')::int, draws = r.draws + (p_status = 'draw')::int,
    losses = r.losses + (p_status in ('lost', 'forfeit'))::int
  where r.user_id = v_battle.attacker and r.format = v_battle.format;
  update public.pvp_ratings r set elo = r.elo - v_change,
    def_wins = r.def_wins + (p_status in ('lost', 'forfeit'))::int, def_draws = r.def_draws + (p_status = 'draw')::int,
    def_losses = r.def_losses + (p_status = 'won')::int
  where r.user_id = v_battle.defender and r.format = v_battle.format;

  update public.pvp_battles b set status = p_status, elo_change = v_change, ended_at = now(), d_next = null
  where b.id = p_battle_id;
end;
$$;

-- A battle as its attacker sees it: the defender's cards only once played
create or replace function public.pvp_battle_view(p_battle public.pvp_battles)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_battle.id,
    'format', p_battle.format,
    'status', p_battle.status,
    'round', p_battle.round,
    'my_kos', p_battle.a_kos,
    'their_kos', p_battle.d_kos,
    'elo_change', p_battle.elo_change,
    'opponent', jsonb_build_object(
      'username', (select p.username from public.profiles p where p.id = p_battle.defender and p.is_public),
      'elo', (select r.elo from public.pvp_ratings r where r.user_id = p_battle.defender and r.format = p_battle.format)),
    'mine', (select jsonb_agg(c || jsonb_build_object('slot', n - 1, 'hp_left', p_battle.a_hp[n]) order by n)
             from jsonb_array_elements(p_battle.a_deck) with ordinality d(c, n)),
    'theirs', jsonb_build_object(
      'left', (select count(*) from unnest(p_battle.d_hp) h where h > 0),
      'seen', coalesce((
        select jsonb_agg(p_battle.d_deck->s.slot || jsonb_build_object('slot', s.slot, 'hp_left', p_battle.d_hp[s.slot + 1]) order by s.first)
        from (select (l->>'d')::int as slot, min(n) as first
              from jsonb_array_elements(p_battle.log) with ordinality x(l, n) group by 1) s), '[]'),
      -- the whole deck once it's over
      'deck', case when p_battle.status <> 'playing' then
        (select jsonb_agg(c || jsonb_build_object('slot', n - 1, 'hp_left', p_battle.d_hp[n]) order by n)
         from jsonb_array_elements(p_battle.d_deck) with ordinality d(c, n)) end),
    'log', p_battle.log
  )
$$;

-- My eligible cards in a format, best attack first
create or replace function public.pvp_eligible(p_format text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
begin
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  return coalesce((
    select jsonb_agg(x.card order by (x.card->>'damage')::int desc, (x.card->>'hp')::int desc)
    from (select public.pvp_card(c.card_id) as card
          from public.collections c
          where c.user_id = v_user and c.mode = 'challenge' and public.pvp_fits(c.card_id, p_format)) x
    where x.card is not null), '[]');
end;
$$;

create or replace function public.pvp_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.pvp_rules();
  v_battle public.pvp_battles;
begin
  select * into v_battle from public.pvp_battles b where b.attacker = v_user and b.status = 'playing';

  return v_rules || jsonb_build_object(
    'ready', exists (select 1 from public.cards c where c.attacks is not null)
             and exists (select 1 from public.sets s where s.series is not null),
    'battles_left', greatest((v_rules->>'battles_per_day')::int - (
      select count(*) from public.pvp_battles b where b.attacker = v_user and b.game_day = public.challenge_today()), 0),
    -- every format, with how many of my cards could fight there
    'formats', (
      with mine as (
        select c.card_id, s.series, coalesce(s.parent_set_id, s.id) as set_id
        from public.collections c
        join public.cards k on k.id = c.card_id
        join public.sets s on s.id = k.set_id
        where c.user_id = v_user and c.mode = 'challenge' and public.pvp_card(c.card_id) is not null
      )
      select jsonb_build_object(
        'all', (select count(*) from mine),
        'eras', coalesce((
          select jsonb_agg(jsonb_build_object('format', 'era:' || e.series, 'series', e.series,
                   'owned', (select count(*) from mine m where m.series = e.series)) order by e.first)
          from (select s.series, min(s.release_date) as first from public.sets s where s.series is not null group by s.series) e), '[]'),
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object('format', 'set:' || s.id, 'set_id', s.id, 'name', s.name, 'series', s.series,
                   'owned', m.owned) order by s.release_date desc, s.id)
          from (select m.set_id, count(*) as owned from mine m group by m.set_id) m
          join public.sets s on s.id = m.set_id), '[]'))
    ),
    'decks', coalesce((
      select jsonb_object_agg(d.format, jsonb_build_object(
        'cards', (select jsonb_agg(public.pvp_card(i.id) order by i.n) from unnest(d.card_ids) with ordinality i(id, n)),
        'valid', public.pvp_deck_cards(v_user, d.format, d.card_ids) is not null))
      from public.pvp_decks d where d.user_id = v_user), '{}'),
    'ratings', coalesce((
      select jsonb_object_agg(r.format, jsonb_build_object('elo', r.elo, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws,
        'def_wins', r.def_wins, 'def_losses', r.def_losses, 'def_draws', r.def_draws))
      from public.pvp_ratings r where r.user_id = v_user), '{}'),
    'battle', case when v_battle.id is null then null else public.pvp_battle_view(v_battle) end,
    -- my last 10 battles, attacks and defenses, from my side
    'history', coalesce((
      select jsonb_agg(h order by h->>'at' desc) from (
        select jsonb_build_object(
          'id', b.id, 'format', b.format, 'at', coalesce(b.ended_at, b.created_at),
          'role', case when b.attacker = v_user then 'attack' else 'defense' end,
          'result', case
            when b.status = 'draw' then 'draw'
            when (b.status = 'won') = (b.attacker = v_user) then 'won'
            else 'lost' end,
          'elo_change', case when b.attacker = v_user then b.elo_change else -b.elo_change end,
          'opponent', (select p.username from public.profiles p
                       where p.id = case when b.attacker = v_user then b.defender else b.attacker end and p.is_public)) h
        from public.pvp_battles b
        where (b.attacker = v_user or b.defender = v_user) and b.status <> 'playing'
        order by coalesce(b.ended_at, b.created_at) desc
        limit 10) x), '[]')
  );
end;
$$;

create or replace function public.pvp_save_deck(p_format text, p_cards text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
begin
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  if public.pvp_deck_cards(v_user, p_format, p_cards) is null then
    raise exception 'pvp_invalid_deck';
  end if;
  insert into public.pvp_decks (user_id, format, card_ids) values (v_user, p_format, p_cards)
  on conflict (user_id, format) do update set card_ids = excluded.card_ids, updated_at = now();
  perform public.pvp_rating(v_user, p_format);
  return public.pvp_state();
end;
$$;

create or replace function public.pvp_start(p_format text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.pvp_rules();
  v_deck public.pvp_decks;
  v_mine jsonb;
  v_me public.pvp_ratings;
  v_last uuid;
  v_foe record;
begin
  -- A battle in progress comes back: no escaping a bad one
  if exists (select 1 from public.pvp_battles b where b.attacker = v_user and b.status = 'playing') then
    return public.pvp_state();
  end if;
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  if (select count(*) from public.pvp_battles b where b.attacker = v_user and b.game_day = public.challenge_today())
     >= (v_rules->>'battles_per_day')::int then
    raise exception 'pvp_no_battles_left';
  end if;

  select * into v_deck from public.pvp_decks d where d.user_id = v_user and d.format = p_format;
  if not found then
    raise exception 'pvp_no_deck';
  end if;
  v_mine := public.pvp_deck_cards(v_user, p_format, v_deck.card_ids);
  if v_mine is null then
    raise exception 'pvp_invalid_deck';
  end if;
  v_me := public.pvp_rating(v_user, p_format);
  select b.defender into v_last from public.pvp_battles b where b.attacker = v_user order by b.created_at desc limit 1;

  -- The 5 closest in Elo whose deck still holds, one of them at random
  -- (the last opponent only if nobody else is there)
  select f.user_id, f.cards into v_foe
  from (
    select d.user_id, x.cards, d.user_id = v_last as again
    from public.pvp_decks d
    cross join lateral (select public.pvp_deck_cards(d.user_id, p_format, d.card_ids) as cards) x
    left join public.pvp_ratings r on r.user_id = d.user_id and r.format = p_format
    where d.format = p_format and d.user_id <> v_user and x.cards is not null
    order by d.user_id is not distinct from v_last, abs(coalesce(r.elo, (v_rules->>'start_elo')::int) - v_me.elo), random()
    limit 5
  ) f
  order by f.again, random()
  limit 1;
  if v_foe.user_id is null then
    raise exception 'pvp_no_opponent';
  end if;
  perform public.pvp_rating(v_foe.user_id, p_format);

  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, d_next)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards,
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_mine) with ordinality x(c, n)),
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_foe.cards) with ordinality x(c, n)),
    floor(random() * (v_rules->>'deck_size')::int)::int);

  return public.pvp_state();
end;
$$;

create or replace function public.pvp_play(p_slot int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.pvp_rules();
  v_b public.pvp_battles;
  v_mine jsonb;
  v_theirs jsonb;
  v_d int;
  v_roll_a int := 1 + floor(random() * 3)::int;
  v_roll_d int := 1 + floor(random() * 3)::int;
  v_dealt int;
  v_taken int;
  v_ko_theirs boolean;
  v_ko_mine boolean;
  v_round jsonb;
  v_status text;
begin
  select * into v_b from public.pvp_battles b where b.attacker = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if p_slot is null or p_slot < 0 or p_slot >= cardinality(v_b.a_hp) or v_b.a_hp[p_slot + 1] <= 0 then
    raise exception 'pvp_invalid_card';
  end if;

  v_d := v_b.d_next;
  v_mine := v_b.a_deck->p_slot;
  v_theirs := v_b.d_deck->v_d;
  v_dealt := public.pvp_damage(v_mine, v_theirs, v_roll_a);
  v_taken := public.pvp_damage(v_theirs, v_mine, v_roll_d);

  v_b.d_hp[v_d + 1] := greatest(v_b.d_hp[v_d + 1] - v_dealt, 0);
  v_b.a_hp[p_slot + 1] := greatest(v_b.a_hp[p_slot + 1] - v_taken, 0);
  v_ko_theirs := v_b.d_hp[v_d + 1] = 0;
  v_ko_mine := v_b.a_hp[p_slot + 1] = 0;
  v_b.a_kos := v_b.a_kos + v_ko_theirs::int;
  v_b.d_kos := v_b.d_kos + v_ko_mine::int;
  v_b.round := v_b.round + 1;
  v_round := jsonb_build_object('a', p_slot, 'd', v_d, 'dealt', v_dealt, 'taken', v_taken,
    'roll_a', case when (v_mine->>'times')::boolean then v_roll_a end,
    'roll_d', case when (v_theirs->>'times')::boolean then v_roll_d end,
    'ko_theirs', v_ko_theirs, 'ko_mine', v_ko_mine);

  if v_b.a_kos >= (v_rules->>'kos_to_win')::int or v_b.d_kos >= (v_rules->>'kos_to_win')::int
     or v_b.round >= (v_rules->>'max_rounds')::int then
    v_status := case when v_b.a_kos > v_b.d_kos then 'won' when v_b.a_kos < v_b.d_kos then 'lost' else 'draw' end;
  end if;

  update public.pvp_battles b
  set d_hp = v_b.d_hp, a_hp = v_b.a_hp, a_kos = v_b.a_kos, d_kos = v_b.d_kos, round = v_b.round,
      log = b.log || jsonb_build_array(v_round),
      d_next = case when v_status is null
        then public.pvp_defender_pick(v_b.d_deck, v_b.d_hp, case when v_ko_mine then null else v_mine end) end
  where b.id = v_b.id;

  if v_status is not null then
    perform public.pvp_finish(v_b.id, v_status);
  end if;

  select * into v_b from public.pvp_battles b where b.id = v_b.id;
  return jsonb_build_object('round', v_round, 'battle', public.pvp_battle_view(v_b), 'state', public.pvp_state());
end;
$$;

create or replace function public.pvp_forfeit()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_b public.pvp_battles;
begin
  select * into v_b from public.pvp_battles b where b.attacker = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  perform public.pvp_finish(v_b.id, 'forfeit');
  select * into v_b from public.pvp_battles b where b.id = v_b.id;
  return jsonb_build_object('battle', public.pvp_battle_view(v_b), 'state', public.pvp_state());
end;
$$;

-- Top 20 public players of a format (with at least one battle), and my row
create or replace function public.pvp_leaderboard(p_format text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select r.user_id, p.username, r.elo,
      r.wins + r.def_wins as wins, r.losses + r.def_losses as losses, r.draws + r.def_draws as draws,
      (row_number() over (order by r.elo desc, r.wins + r.def_wins desc, p.username))::int as rank
    from public.pvp_ratings r
    join public.profiles p on p.id = r.user_id and p.is_public
    where r.format = p_format and r.wins + r.losses + r.draws + r.def_wins + r.def_losses + r.def_draws > 0
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', x.rank, 'username', x.username, 'elo', x.elo,
              'wins', x.wins, 'losses', x.losses, 'draws', x.draws) order by x.rank)
            from ranked x where x.rank <= 20), '[]'),
    'me', (select jsonb_build_object('rank', x.rank, 'elo', x.elo, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws)
           from ranked x where x.user_id = auth.uid()))
$$;

revoke execute on function public.pvp_card(text) from public, anon, authenticated;
revoke execute on function public.pvp_fits(text, text) from public, anon, authenticated;
revoke execute on function public.pvp_valid_format(text) from public, anon, authenticated;
revoke execute on function public.pvp_deck_cards(uuid, text, text[]) from public, anon, authenticated;
revoke execute on function public.pvp_defender_pick(jsonb, int[], jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_rating(uuid, text) from public, anon, authenticated;
revoke execute on function public.pvp_finish(bigint, text) from public, anon, authenticated;
revoke execute on function public.pvp_battle_view(public.pvp_battles) from public, anon, authenticated;
revoke execute on function public.pvp_eligible(text) from public, anon;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_save_deck(text, text[]) from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
revoke execute on function public.pvp_play(int) from public, anon;
revoke execute on function public.pvp_forfeit() from public, anon;
revoke execute on function public.pvp_leaderboard(text) from public, anon;
grant execute on function public.pvp_eligible(text) to authenticated;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_save_deck(text, text[]) to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
grant execute on function public.pvp_play(int) to authenticated;
grant execute on function public.pvp_forfeit() to authenticated;
grant execute on function public.pvp_leaderboard(text) to authenticated;
