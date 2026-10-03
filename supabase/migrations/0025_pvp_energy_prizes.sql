-- Pokémon Booster Game — Challenge: PvP energy and prize cards
-- Run after 0024_pvp_battles.sql.
--
-- Game design (user, 2026-10-03, right after 0024: "sinon je mets une
-- carte avec une attaque à 130 et je gagne auto"). In 0024 every card hit
-- with its best attack every round, so the deck with the biggest numbers
-- won. Two rules of the real TCG keep the big cards in check:
--   - Energy: each side has a pool, 1 at the start, +1 per round, 5 at
--     most, kept from one round to the next. Each round you pick a card AND
--     one of its attacks you can pay for (printed cost = its number of
--     energies), or no attack (the card takes the hit, the energy is saved).
--     A 130-damage attack usually costs 3-4: it comes late and not every
--     round. (Measured 2026-10-03 on 28,250 attacks: median damage 20 for 1
--     energy, 30 for 2, 70 for 3, 110 for 4, 160 for 5.)
--   - Prize cards: knocking out a Pokémon takes its prizes, 3 win. ex, EX,
--     GX, V, VSTAR, LEGEND give 2; VMAX, TAG TEAM, V-UNION and Mega ex give
--     3 (the real rules; V-UNION gives 4 there). A deck of big cards is
--     beaten in 1 or 2 KOs.
-- Simulated on the real cards (AI against AI): the 5 biggest hitters win
-- 32% against 5 good 1-prize cards, 10% against cheap attackers.
--
-- Rules now (mirrored in src/utils/pvp.js — change both together):
--   - Deck: unchanged (5 different Pokémon of the challenge collection,
--     each with at least one attack that deals damage).
--   - Damage of the attack picked: "30+" counts 30; "20×" = 20 times a
--     roll of 1 to 3. Weakness x2, resistance -30, at least 10; 0 for no
--     attack.
--   - Each round, both sides play one living card and an attack: the
--     defender's are picked (and stored) before the attacker's arrive.
--     Both cards hit each other; HP stays damaged. 3 prizes win (both at
--     once: the most prizes, else a draw). After 20 rounds (was 15), the
--     most prizes win, else a draw.
--   - Defender AI: the living card + affordable attack that hits the
--     attacker's last card (if still standing) hardest while taking the
--     least back, or no attack to save up for a bigger one (worth 40% of
--     it); a little randomness.
--   - Elo, daily limit, matchmaking, formats: unchanged.
--
-- 1. pvp_battles: energy pools (a_energy, d_energy), the defender's next
--    attack (d_next_attack), prizes (a_prizes, d_prizes) instead of KOs
--    (a_kos, d_kos dropped). Battles still in progress from 0024 have card
--    snapshots without attacks: they end as draws, Elo untouched.
-- 2. Old signatures dropped: pvp_play(int), pvp_damage(jsonb, jsonb, int),
--    pvp_defender_pick(jsonb, int[], jsonb).
-- 3. Functions: pvp_rules, pvp_prizes (new), pvp_card (every damaging
--    attack with its cost, + prizes), pvp_damage(from, attack, to, roll),
--    pvp_defender_pick (card + attack), pvp_play(p_slot, p_attack),
--    pvp_battle_view (energy, prizes); the others are re-created as they
--    were. cards.attacks entries get a `cost` from scripts/populate.mjs:
--    until a sync has stored it, pvp_state().ready = false ("Coming soon"),
--    or every attack would be free.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Battles ----------

set local application_name = 'migration 0025: step 1/3 battles';

alter table public.pvp_battles add column if not exists a_energy int not null default 1;
alter table public.pvp_battles add column if not exists d_energy int not null default 1;
alter table public.pvp_battles add column if not exists d_next_attack int;
alter table public.pvp_battles add column if not exists a_prizes int not null default 0;
alter table public.pvp_battles add column if not exists d_prizes int not null default 0;

-- 0024's battles: prizes = KOs (1 per card back then), then the KO columns go
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'pvp_battles' and column_name = 'a_kos') then
    update public.pvp_battles set a_prizes = a_kos, d_prizes = d_kos;
    alter table public.pvp_battles drop column a_kos;
    alter table public.pvp_battles drop column d_kos;
  end if;
end;
$$;

-- In progress from 0024: no attacks in the snapshots, can't go on
update public.pvp_battles b set status = 'draw', elo_change = 0, ended_at = now(), d_next = null
where b.status = 'playing' and not (b.a_deck -> 0 ? 'attacks');

-- ---------- 2. Old signatures ----------

set local application_name = 'migration 0025: step 2/3 old signatures';

drop function if exists public.pvp_play(int);
drop function if exists public.pvp_damage(jsonb, jsonb, int);
drop function if exists public.pvp_defender_pick(jsonb, int[], jsonb);

-- ---------- 3. Functions ----------

set local application_name = 'migration 0025: step 3/3 functions';

create or replace function public.pvp_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('deck_size', 5, 'prizes_to_win', 3, 'max_rounds', 20, 'battles_per_day', 10,
    'start_energy', 1, 'energy_per_round', 1, 'max_energy', 5,
    'start_elo', 1000, 'k_factor', 32, 'weakness_multiplier', 2, 'resistance', 30, 'min_damage', 10)
$$;

-- Prizes a card gives when knocked out (the real TCG's rule boxes)
create or replace function public.pvp_prizes(p_subtypes text[])
returns int
language sql
immutable
as $$
  select case
    when p_subtypes && array['VMAX', 'TAG TEAM', 'V-UNION'] or p_subtypes @> array['MEGA', 'ex'] then 3
    when p_subtypes && array['ex', 'EX', 'GX', 'V', 'VSTAR', 'LEGEND'] then 2
    else 1
  end
$$;

-- A card as a battle sees it, or null if it can't fight (not a Pokémon,
-- no HP, no attack that deals damage). `attacks` = the damaging ones,
-- cheapest first: { name, damage, times ("20×"), cost }
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
    'prizes', public.pvp_prizes(coalesce(c.subtypes, '{}')),
    'attacks', a.attacks)
  from public.cards c
  cross join lateral (
    select jsonb_agg(jsonb_build_object('name', x.name, 'damage', x.damage, 'times', x.times, 'cost', x.cost)
                     order by x.cost, x.damage, x.n) as attacks
    from (
      select y->>'name' as name, (substring(y->>'damage' from '^(\d+)'))::int as damage,
        (y->>'damage') ~ '[×xX]$' as times,
        least(greatest(coalesce((y->>'cost')::int, 0), 0), (public.pvp_rules()->>'max_energy')::int) as cost, n
      from jsonb_array_elements(case when jsonb_typeof(c.attacks) = 'array' then c.attacks else '[]' end) with ordinality z(y, n)
    ) x
    where coalesce(x.damage, 0) > 0
  ) a
  where c.id = p_id and c.supertype = 'Pokémon' and c.hp > 0 and a.attacks is not null
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

-- Damage of one card's attack (an element of its `attacks`, null = no
-- attack) on another. `p_roll` (1-3) multiplies "20×"
create or replace function public.pvp_damage(p_from jsonb, p_attack jsonb, p_to jsonb, p_roll int)
returns int
language sql
immutable
as $$
  select case when p_attack is null then 0 else greatest((public.pvp_rules()->>'min_damage')::int,
    (p_attack->>'damage')::int * case when (p_attack->>'times')::boolean then p_roll else 1 end
      * case when exists (select 1 from jsonb_array_elements_text(p_from->'types') t
                          where p_to->'weaknesses' ? t) then (public.pvp_rules()->>'weakness_multiplier')::int else 1 end
    - case when exists (select 1 from jsonb_array_elements_text(p_from->'types') t
                        where p_to->'resistances' ? t) then (public.pvp_rules()->>'resistance')::int else 0 end) end
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

-- The defender's next card and attack, picked before the attacker plays.
-- Every living card x (each affordable attack, or none) gets a score: the
-- damage it would deal to the attacker's last card (if still standing;
-- else its plain damage), minus half what that card's best affordable-ish
-- attack would deal back, + a little randomness. No attack is worth 40% of
-- the card's best attack it can't pay for yet (saving up), 0 otherwise.
create or replace function public.pvp_defender_pick(p_deck jsonb, p_hp int[], p_energy int, p_last jsonb,
  out pick_slot int, out pick_attack int)
language plpgsql
volatile
as $$
declare
  v_best numeric := null;
  v_card jsonb;
  v_attack jsonb;
  v_score numeric;
  v_taken numeric;
  v_saving numeric;
begin
  for i in 1..cardinality(p_hp) loop
    continue when p_hp[i] <= 0;
    v_card := p_deck->(i - 1);
    -- What the attacker's last card would deal back (its strongest attack)
    v_taken := case when p_last is null then 0 else (
      select coalesce(max(public.pvp_damage(p_last, a, v_card, 2)), 0) from jsonb_array_elements(p_last->'attacks') a) end;
    for j in 0..jsonb_array_length(v_card->'attacks') - 1 loop
      v_attack := v_card->'attacks'->j;
      continue when (v_attack->>'cost')::int > p_energy;
      v_score := case when p_last is null then public.pvp_damage(v_card, v_attack, '{}'::jsonb, 2)
                 else public.pvp_damage(v_card, v_attack, p_last, 2) end
                 - 0.5 * v_taken + random() * 20;
      if v_best is null or v_score > v_best then
        v_best := v_score; pick_slot := i - 1; pick_attack := j;
      end if;
    end loop;
    v_saving := coalesce((select max((a->>'damage')::numeric) from jsonb_array_elements(v_card->'attacks') a
                          where (a->>'cost')::int > p_energy), 0);
    v_score := 0.4 * v_saving - 0.5 * v_taken + random() * 20;
    if v_best is null or v_score > v_best then
      v_best := v_score; pick_slot := i - 1; pick_attack := null;
    end if;
  end loop;
end;
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

  update public.pvp_battles b set status = p_status, elo_change = v_change, ended_at = now(), d_next = null, d_next_attack = null
  where b.id = p_battle_id;
end;
$$;

-- A battle as its attacker sees it: the defender's cards only once played
-- (never its next pick); both energy pools are public, like on a real table
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
    'my_prizes', p_battle.a_prizes,
    'their_prizes', p_battle.d_prizes,
    'my_energy', p_battle.a_energy,
    'their_energy', p_battle.d_energy,
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

-- My eligible cards in a format, strongest attack first
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
    select jsonb_agg(x.card order by (select max((a->>'damage')::int) from jsonb_array_elements(x.card->'attacks') a) desc,
                     (x.card->>'hp')::int desc)
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
    'ready', exists (select 1 from public.cards c where c.attacks -> 0 ? 'cost')
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
  v_hp int[];
  v_pick record;
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

  v_hp := (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_foe.cards) with ordinality x(c, n));
  select * into v_pick from public.pvp_defender_pick(v_foe.cards, v_hp, (v_rules->>'start_energy')::int, null);

  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, a_energy, d_energy, d_next, d_next_attack)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards,
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_mine) with ordinality x(c, n)),
    v_hp, (v_rules->>'start_energy')::int, (v_rules->>'start_energy')::int, v_pick.pick_slot, v_pick.pick_attack);

  return public.pvp_state();
end;
$$;

create or replace function public.pvp_play(p_slot int, p_attack int)
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
  v_my_attack jsonb;
  v_their_attack jsonb;
  v_d int;
  v_roll_a int := 1 + floor(random() * 3)::int;
  v_roll_d int := 1 + floor(random() * 3)::int;
  v_dealt int;
  v_taken int;
  v_ko_theirs boolean;
  v_ko_mine boolean;
  v_round jsonb;
  v_status text;
  v_to_win int := (v_rules->>'prizes_to_win')::int;
  v_next_slot int;
  v_next_attack int;
begin
  select * into v_b from public.pvp_battles b where b.attacker = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if p_slot is null or p_slot < 0 or p_slot >= cardinality(v_b.a_hp) or v_b.a_hp[p_slot + 1] <= 0 then
    raise exception 'pvp_invalid_card';
  end if;
  v_mine := v_b.a_deck->p_slot;
  if p_attack is not null then
    v_my_attack := v_mine->'attacks'->p_attack;
    if p_attack < 0 or v_my_attack is null then
      raise exception 'pvp_invalid_attack';
    end if;
    if (v_my_attack->>'cost')::int > v_b.a_energy then
      raise exception 'pvp_not_enough_energy';
    end if;
  end if;

  v_d := v_b.d_next;
  v_theirs := v_b.d_deck->v_d;
  v_their_attack := case when v_b.d_next_attack is null then null else v_theirs->'attacks'->v_b.d_next_attack end;
  v_dealt := public.pvp_damage(v_mine, v_my_attack, v_theirs, v_roll_a);
  v_taken := public.pvp_damage(v_theirs, v_their_attack, v_mine, v_roll_d);

  v_b.d_hp[v_d + 1] := greatest(v_b.d_hp[v_d + 1] - v_dealt, 0);
  v_b.a_hp[p_slot + 1] := greatest(v_b.a_hp[p_slot + 1] - v_taken, 0);
  v_ko_theirs := v_b.d_hp[v_d + 1] = 0;
  v_ko_mine := v_b.a_hp[p_slot + 1] = 0;
  v_b.a_prizes := v_b.a_prizes + case when v_ko_theirs then (v_theirs->>'prizes')::int else 0 end;
  v_b.d_prizes := v_b.d_prizes + case when v_ko_mine then (v_mine->>'prizes')::int else 0 end;
  -- Energy: pay, then +1 for the next round (5 at most)
  v_b.a_energy := least(v_b.a_energy - coalesce((v_my_attack->>'cost')::int, 0) + (v_rules->>'energy_per_round')::int,
    (v_rules->>'max_energy')::int);
  v_b.d_energy := least(v_b.d_energy - coalesce((v_their_attack->>'cost')::int, 0) + (v_rules->>'energy_per_round')::int,
    (v_rules->>'max_energy')::int);
  v_b.round := v_b.round + 1;
  v_round := jsonb_build_object('a', p_slot, 'd', v_d, 'a_attack', p_attack, 'd_attack', v_b.d_next_attack,
    'dealt', v_dealt, 'taken', v_taken,
    'roll_a', case when (v_my_attack->>'times')::boolean then v_roll_a end,
    'roll_d', case when (v_their_attack->>'times')::boolean then v_roll_d end,
    'ko_theirs', v_ko_theirs, 'ko_mine', v_ko_mine);

  if v_b.a_prizes >= v_to_win or v_b.d_prizes >= v_to_win or v_b.round >= (v_rules->>'max_rounds')::int then
    v_status := case when v_b.a_prizes > v_b.d_prizes then 'won' when v_b.a_prizes < v_b.d_prizes then 'lost' else 'draw' end;
  else
    select p.pick_slot, p.pick_attack into v_next_slot, v_next_attack
    from public.pvp_defender_pick(v_b.d_deck, v_b.d_hp, v_b.d_energy, case when v_ko_mine then null else v_mine end) p;
  end if;

  update public.pvp_battles b
  set d_hp = v_b.d_hp, a_hp = v_b.a_hp, a_prizes = v_b.a_prizes, d_prizes = v_b.d_prizes, round = v_b.round,
      a_energy = v_b.a_energy, d_energy = v_b.d_energy,
      log = b.log || jsonb_build_array(v_round),
      d_next = v_next_slot, d_next_attack = v_next_attack
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
revoke execute on function public.pvp_defender_pick(jsonb, int[], int, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_rating(uuid, text) from public, anon, authenticated;
revoke execute on function public.pvp_finish(bigint, text) from public, anon, authenticated;
revoke execute on function public.pvp_battle_view(public.pvp_battles) from public, anon, authenticated;
revoke execute on function public.pvp_eligible(text) from public, anon;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_save_deck(text, text[]) from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
revoke execute on function public.pvp_play(int, int) from public, anon;
revoke execute on function public.pvp_forfeit() from public, anon;
revoke execute on function public.pvp_leaderboard(text) from public, anon;
grant execute on function public.pvp_eligible(text) to authenticated;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_save_deck(text, text[]) to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
grant execute on function public.pvp_play(int, int) to authenticated;
grant execute on function public.pvp_forfeit() to authenticated;
grant execute on function public.pvp_leaderboard(text) to authenticated;
