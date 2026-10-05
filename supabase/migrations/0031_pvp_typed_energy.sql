-- Pokémon Booster Game — Challenge: PvP with typed energy, bots matched to my deck
-- Run after 0030_pvp_pocket.sql, then let a card sync run (it stores each
-- attack's typed cost: attacks[].energy).
--
-- User, 2026-10-05, after a bot battle won by "placer mon pokemon, mettre
-- les énergies": "ça manque de profondeur". With colorless energy any card
-- paid any attack, so the best deck was the 20 strongest cards of every type
-- and every era, and the "all" format put 2025 ex (230 HP) against 1999
-- Gastlys (40 HP). Picked: "A - 1 à 2 énergies", "B. Okay".
--
-- A. Typed energy, like Pokémon TCG Pocket:
--   - Each deck picks 1 or 2 energy types (pvp_decks.energy; null = picked
--     from the deck's costs by pvp_deck_energy()). The 9 types with a basic
--     Energy card: Grass, Fire, Water, Lightning, Psychic, Fighting,
--     Darkness, Metal, Fairy (Dragon Pokémon pay with other types).
--   - The energy zone: at the start of each turn one energy of a random type
--     of the deck appears (`zone`); the next one is already shown (`next`).
--     Not attached this turn = lost. Still none on the first turn.
--   - Attacks cost their printed energy (cards.attacks[].energy, filled by
--     populate.mjs): each typed symbol needs that type, Colorless any type.
--     A card synced before this migration has no typed cost: all Colorless.
--   - A slot keeps its energies' types (`etypes`, `energy` stays the count).
--     Retreat, discards and moves drop first the energies its attacks don't
--     need (pvp_drop_energy).
-- B. Bots matched to my deck (pvp_bot_deck(format, level, my cards)):
--   - same eras as my deck (the "all" format no longer pits eras together),
--   - 1 or 2 energy types and cards that can pay with them ('hard' leans on
--     the most common Weakness of my deck),
--   - its cards' strength is aimed at mine (percentile in the same pool):
--     easy 60% of it, normal a bit below, hard above. The level still
--     sets how it plays (pvp_ai_turn).
--
-- Battles in progress (no energy types yet) end as draws, no Elo, no coins.
-- `pvp_rules().engine` = 3; pvp_save_deck takes p_energy; pvp_state's
-- decks carry `energy` + `energy_auto`; battle sides carry `energy_types`,
-- `zone`, `next`; slots `etypes`; attacks `energy`.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Battles and decks ----------

set local application_name = 'migration 0031: step 1/5 battles and decks';

alter table public.pvp_decks add column if not exists energy text[];

update public.pvp_battles b
set status = 'draw', elo_change = 0, coins = case when b.bot is not null then 0 end, ended_at = now(), d_next = null, d_next_attack = null
where b.status = 'playing' and b.engine < 3;

drop function if exists public.pvp_save_deck(text, text[], text);
drop function if exists public.pvp_game_new(jsonb, jsonb, text);
drop function if exists public.pvp_new_side(jsonb);
drop function if exists public.pvp_bot_deck(text, text);

-- ---------- 2. Rules, cards, energy ----------

set local application_name = 'migration 0031: step 2/5 cards and energy';

create or replace function public.pvp_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('engine', 3, 'deck_size', 20, 'max_copies', 2, 'hand_size', 5, 'bench_size', 3,
    'points_to_win', 3, 'max_turns', 30, 'battles_per_day', 10,
    'start_elo', 1000, 'k_factor', 32, 'weakness_multiplier', 2, 'resistance', 30, 'poison', 10, 'burn', 20,
    'energy_types', jsonb_build_array('Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy'),
    'max_energy_types', 2,
    'bot_levels', jsonb_build_array('easy', 'normal', 'hard'),
    'bot_coins', jsonb_build_object('easy', 10, 'normal', 25, 'hard', 50),
    'bot_paid_per_day', 5, 'bot_battles_per_day', 20)
$$;

-- A card as a battle sees it, or null if it isn't a Pokémon with HP.
-- stage: 'basic' | 'evolution' | 'none' (can't be played: LEGEND halves...)
-- attacks: every printed attack with a known cost, in printed order:
--   { name, name_fr, printed, base, cost, energy, text, text_fr, fx, coins, partial, usable }
-- energy (0031): the typed cost, ['Fire', 'Colorless']; [] before a sync
-- stored it (then the cost is all Colorless).
-- usable = it deals damage or has an effect the engine applies.
create or replace function public.pvp_card(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'name_fr', c.name_fr,
    'image_small', c.image_small, 'image_fr', c.image_fr, 'hp', c.hp,
    'types', coalesce(to_jsonb(c.types), '[]'), 'weaknesses', coalesce(to_jsonb(c.weaknesses), '[]'),
    'resistances', coalesce(to_jsonb(c.resistances), '[]'),
    'prizes', public.pvp_prizes(coalesce(c.subtypes, '{}')),
    'stage', case
      when c.evolves_from is not null then 'evolution'
      when coalesce(c.subtypes, '{}') && array['Basic', 'Baby'] or coalesce(cardinality(c.subtypes), 0) = 0 then 'basic'
      else 'none' end,
    'evolves_from', c.evolves_from,
    'retreat', coalesce(c.retreat_cost, 0),
    'attacks', coalesce(a.attacks, '[]'),
    'abilities', coalesce((
      select jsonb_agg(jsonb_build_object('name', y->>'name', 'text', y->>'text',
               'name_fr', c.abilities_fr->(n::int - 1)->>'name', 'text_fr', c.abilities_fr->(n::int - 1)->>'effect') order by n)
      from jsonb_array_elements(case when jsonb_typeof(c.abilities) = 'array' then c.abilities else '[]' end) with ordinality z(y, n)), '[]'))
  from public.cards c
  cross join lateral (
    select jsonb_agg(x.attack || jsonb_build_object('usable',
             (x.attack->>'base')::int > 0 or exists (select 1 from jsonb_array_elements(x.attack->'fx') o where o->>'op' <> 'once'))
           order by x.n) as attacks
    from (
      select z.n, jsonb_build_object(
          'name', y->>'name', 'name_fr', c.attacks_fr->(z.n::int - 1)->>'name',
          'printed', coalesce(y->>'damage', ''),
          'base', coalesce((y->>'base')::int, (substring(y->>'damage' from '^(\d+)'))::int, 0),
          'cost', greatest((y->>'cost')::int, case when jsonb_typeof(y->'energy') = 'array' then jsonb_array_length(y->'energy') else 0 end, 0),
          'energy', case when jsonb_typeof(y->'energy') = 'array' then y->'energy' else '[]' end,
          'text', coalesce(y->>'text', ''), 'text_fr', c.attacks_fr->(z.n::int - 1)->>'effect',
          'fx', case when jsonb_typeof(y->'fx') = 'array' then y->'fx' else '[]' end,
          'coins', y->'coins',
          'partial', coalesce((y->>'partial')::boolean, false)) as attack
      from jsonb_array_elements(case when jsonb_typeof(c.attacks) = 'array' then c.attacks else '[]' end) with ordinality z(y, n)
      -- imported before 0025 (no cost yet): unknown, never free
      where jsonb_typeof(y->'cost') = 'number'
    ) x
  ) a
  where c.id = p_id and c.supertype = 'Pokémon' and c.hp > 0
$$;

-- Energies still missing to pay a cost: each typed symbol needs its type,
-- Colorless takes whatever is left. p_have = a slot's etypes, p_cost = an
-- attack's energy (typed symbols), p_total = its cost (number of energies).
create or replace function public.pvp_missing(p_have jsonb, p_cost jsonb, p_total int)
returns int
language sql
immutable
as $$
  with need as (
    select t, count(*)::int as n from jsonb_array_elements_text(coalesce(p_cost, '[]')) t where t <> 'Colorless' group by t
  ), typed as (
    select coalesce(sum(greatest(need.n - h.n, 0)), 0)::int as missing,
           coalesce(sum(least(need.n, h.n)), 0)::int as used,
           coalesce(sum(need.n), 0)::int as needed
    from need
    cross join lateral (select count(*)::int as n from jsonb_array_elements_text(coalesce(p_have, '[]')) e where e = need.t) h
  )
  select typed.missing + greatest(greatest(p_total, typed.needed) - typed.needed - (jsonb_array_length(coalesce(p_have, '[]')) - typed.used), 0)
  from typed
$$;

-- 1 or 2 distinct energy types among pvp_rules().energy_types
create or replace function public.pvp_valid_energy(p_energy text[])
returns boolean
language sql
immutable
as $$
  select coalesce(cardinality(p_energy), 0) between 1 and (public.pvp_rules()->>'max_energy_types')::int
    and cardinality(p_energy) = (select count(distinct e) from unnest(p_energy) e)
    and not exists (select 1 from unnest(p_energy) e where not (public.pvp_rules()->'energy_types' ? e))
$$;

-- A deck's energy when its owner didn't pick one: the typed symbols its
-- usable attacks ask for most (a second type if it's asked at least a
-- quarter as much as the first), else its Pokémon's own types, else Grass
create or replace function public.pvp_deck_energy(p_cards jsonb)
returns jsonb
language sql
immutable
as $$
  with symbols as (
    select t, count(*) as n
    from jsonb_array_elements(coalesce(p_cards, '[]')) c
    cross join lateral jsonb_array_elements(c->'attacks') a
    cross join lateral jsonb_array_elements_text(coalesce(a->'energy', '[]')) t
    where (a->>'usable')::boolean and public.pvp_rules()->'energy_types' ? t
    group by t
  ), ranked as (
    select t, n, row_number() over (order by n desc, t) as r, max(n) over () as top from symbols
  ), own as (
    select t, count(*) as n
    from jsonb_array_elements(coalesce(p_cards, '[]')) c
    cross join lateral jsonb_array_elements_text(coalesce(c->'types', '[]')) t
    where public.pvp_rules()->'energy_types' ? t
    group by t
    order by count(*) desc, t
    limit 1
  )
  select coalesce(
    (select jsonb_agg(t order by r) from ranked where r = 1 or (r = 2 and n * 4 >= top)),
    (select jsonb_build_array(t) from own),
    '["Grass"]'::jsonb)
$$;

-- A slot without n of its energies. Its owner drops first the ones its
-- attacks don't need; an opponent's attack (p_needed_first) the ones they do.
create or replace function public.pvp_drop_energy(p_card jsonb, p_slot jsonb, p_n int, p_needed_first boolean default false)
returns jsonb
language sql
immutable
as $$
  with e as (
    select x.e, x.n, exists (
        select 1 from jsonb_array_elements(p_card->'attacks') a, jsonb_array_elements_text(coalesce(a->'energy', '[]')) t
        where t = x.e #>> '{}' and t <> 'Colorless') as needed
    from jsonb_array_elements(coalesce(p_slot->'etypes', '[]')) with ordinality x(e, n)
  ), kept as (
    select e.e, e.n from e
    order by case when p_needed_first then not e.needed else e.needed end desc, e.n
    limit greatest(jsonb_array_length(coalesce(p_slot->'etypes', '[]')) - greatest(p_n, 0), 0)
  )
  select p_slot || jsonb_build_object(
    'etypes', coalesce((select jsonb_agg(kept.e order by kept.n) from kept), '[]'),
    'energy', (select count(*) from kept))
$$;

-- One energy of a type on a slot
create or replace function public.pvp_add_energy(p_slot jsonb, p_type text)
returns jsonb
language sql
immutable
as $$
  select p_slot || jsonb_build_object('etypes', coalesce(p_slot->'etypes', '[]') || to_jsonb(p_type),
    'energy', jsonb_array_length(coalesce(p_slot->'etypes', '[]')) + 1)
$$;

-- A random type of a deck's energy
create or replace function public.pvp_random_energy(p_types jsonb)
returns text
language sql
volatile
as $$
  select t from jsonb_array_elements_text(coalesce(p_types, '["Grass"]')) t order by random() limit 1
$$;

-- Whether a slot can pay an attack of its card now
create or replace function public.pvp_can_pay(p_slot jsonb, p_attack jsonb)
returns boolean
language sql
immutable
as $$
  select public.pvp_missing(p_slot->'etypes', p_attack->'energy', (p_attack->>'cost')::int) = 0
$$;

-- ---------- 3. The engine ----------

set local application_name = 'migration 0031: step 3/5 engine';

create or replace function public.pvp_new_slot(p_card int, p_turn int)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('c', p_card, 'under', '[]'::jsonb, 'damage', 0, 'energy', 0, 'etypes', '[]'::jsonb, 'turn_in', p_turn,
    'status', null, 'status_turn', null, 'poisoned', false, 'burned', false,
    'lock_attack', null, 'no_retreat', null, 'reduce', null, 'prevent', null, 'smoke', null, 'weaken', null)
$$;

-- A side at the start: deck shuffled, 5 cards in hand with at least 1 Basic,
-- its energy types, no energy in the zone yet, the next one drawn
create or replace function public.pvp_new_side(p_cards jsonb, p_energy jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_order int[];
  v_basic int;
  v_hand int[];
  v_size int := (public.pvp_rules()->>'hand_size')::int;
begin
  select array_agg(i order by random()) into v_order from generate_series(0, jsonb_array_length(p_cards) - 1) i;
  select i into v_basic from unnest(v_order) i where p_cards->i->>'stage' = 'basic' limit 1;
  v_order := array_remove(v_order, v_basic);
  v_hand := array[v_basic] || coalesce(v_order[1:v_size - 1], '{}');
  v_order := coalesce(v_order[v_size:], '{}');
  return jsonb_build_object('cards', p_cards, 'deck', to_jsonb(v_order), 'hand', to_jsonb(v_hand), 'discard', '[]'::jsonb,
    'active', null, 'bench', '[]'::jsonb, 'points', 0, 'attached', false, 'retreated', false, 'used_once', false,
    'energy_types', p_energy, 'zone', null, 'next', public.pvp_random_energy(p_energy));
end;
$$;

-- Why an attack can't be used now, null if it can
create or replace function public.pvp_attack_block(p_g jsonb, p_side text, p_attack int)
returns text
language plpgsql
immutable
as $$
declare
  v_slot jsonb := public.pvp_slot(p_g, p_side, 0);
  v_attack jsonb;
  v_turn int := (p_g->>'turn')::int;
begin
  if v_slot is null then
    return 'no_active';
  end if;
  v_attack := public.pvp_top(p_g, p_side, v_slot)->'attacks'->p_attack;
  if v_attack is null then
    return 'unknown';
  elsif not (v_attack->>'usable')::boolean then
    return 'unusable';
  elsif v_turn = 1 then
    return 'first_turn';
  elsif v_slot->>'status' in ('asleep', 'paralyzed') then
    return v_slot->>'status';
  elsif (v_slot->>'lock_attack')::int = v_turn then
    return 'locked';
  elsif not public.pvp_can_pay(v_slot, v_attack) then
    return 'energy';
  elsif (p_g->p_side->>'used_once')::boolean and v_attack->'fx' @> '[{"op": "once"}]' then
    return 'once';
  end if;
  return null;
end;
$$;

-- AI: the Benched Pokémon that's the best to bring in (ready to hit, healthy)
create or replace function public.pvp_ai_bench_pick(p_g jsonb, p_side text)
returns int
language sql
immutable
as $$
  select p.pos
  from public.pvp_positions(p_g, p_side) p(pos)
  cross join lateral (select public.pvp_slot(p_g, p_side, p.pos) as slot) s
  where p.pos > 0
  order by coalesce((select max((a->>'base')::int) from jsonb_array_elements(public.pvp_top(p_g, p_side, s.slot)->'attacks') a
                     where (a->>'usable')::boolean and public.pvp_can_pay(s.slot, a)), 0)
           + public.pvp_hp_left(p_g, p_side, s.slot) / 2 desc, p.pos
  limit 1
$$;

-- One attack of my Active: coins, damage, effects. p_opts: { target: the
-- opponent's position for bench_one / snipe, switch_to / energy_to: one of
-- my Benched positions }; the server picks when they're missing.
create or replace function public.pvp_attack(p_g jsonb, p_side text, p_attack int, p_opts jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_foe text := public.pvp_other(p_side);
  v_turn int := (g->>'turn')::int;
  v_me jsonb := public.pvp_slot(g, p_side, 0);
  v_card jsonb := public.pvp_top(g, p_side, v_me);
  v_attack jsonb := v_card->'attacks'->p_attack;
  v_fx jsonb := v_attack->'fx';
  v_them jsonb := public.pvp_slot(g, v_foe, 0);
  v_target jsonb := case when v_them is not null then public.pvp_top(g, v_foe, v_them) end;
  v_op jsonb;
  v_flips jsonb := '[]';
  v_heads int := 0;
  v_up boolean;
  v_damage int;
  v_dealt int := 0;
  v_prevented boolean := false;
  v_n int;
  v_pos int;
  v_coins jsonb := v_attack->'coins';
  v_moved text;
begin
  if v_fx @> '[{"op": "once"}]' then
    g := jsonb_set(g, array[p_side, 'used_once'], 'true');
  end if;

  -- Confused, or behind a smokescreen: a coin, tails = nothing happens
  if v_me->>'status' = 'confused' or (v_me->>'smoke')::int = v_turn then
    v_up := public.pvp_flip();
    if not v_up then
      return public.pvp_ev(g, jsonb_build_object('k', 'attack', 's', p_side, 'c', v_me->'c', 'i', p_attack,
        'failed', case when v_me->>'status' = 'confused' then 'confused' else 'smokescreen' end, 'flips', jsonb_build_array(false)));
    end if;
  end if;

  -- Coins
  if jsonb_typeof(v_coins) = 'number' then
    for i in 1..least((v_coins #>> '{}')::int, 10) loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      v_heads := v_heads + v_up::int;
    end loop;
    v_up := v_heads > 0;
  elsif v_coins = '"until"'::jsonb then
    for i in 1..10 loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      exit when not v_up;
      v_heads := v_heads + 1;
    end loop;
    v_up := v_heads > 0;
  else
    v_up := null;
  end if;

  if exists (select 1 from jsonb_array_elements(v_fx) o where o->>'op' = 'nothing' and public.pvp_cond(o, v_up)) then
    return public.pvp_ev(g, jsonb_build_object('k', 'attack', 's', p_side, 'c', v_me->'c', 'i', p_attack, 'failed', 'tails', 'flips', v_flips));
  end if;

  -- Damage
  v_damage := (v_attack->>'base')::int;
  for v_op in select * from jsonb_array_elements(v_fx) loop
    continue when not public.pvp_cond(v_op, v_up);
    v_n := case when jsonb_typeof(v_op->'n') = 'number' then (v_op->>'n')::int else 0 end;
    v_damage := v_damage + case v_op->>'op'
      when 'times' then v_n * v_heads
      when 'plus_heads' then v_n * v_heads
      when 'plus' then v_n
      when 'per_energy_self' then v_n * (v_me->>'energy')::int
      when 'per_energy_opp' then v_n * coalesce((v_them->>'energy')::int, 0)
      when 'per_counter_self' then v_n * ((v_me->>'damage')::int / 10)
      when 'per_counter_opp' then v_n * coalesce((v_them->>'damage')::int / 10, 0)
      when 'minus_counter_self' then -v_n * ((v_me->>'damage')::int / 10)
      when 'per_bench_opp' then v_n * jsonb_array_length(g->v_foe->'bench')
      when 'per_bench_self' then v_n * jsonb_array_length(g->p_side->'bench')
      when 'per_points_self' then v_n * (g->p_side->>'points')::int
      when 'per_points_opp' then v_n * (g->v_foe->>'points')::int
      when 'per_hand_self' then v_n * jsonb_array_length(g->p_side->'hand')
      when 'per_hand_opp' then v_n * jsonb_array_length(g->v_foe->'hand')
      when 'if_damaged_self' then case when (v_me->>'damage')::int > 0 then v_n else 0 end
      when 'if_damaged_opp' then case when coalesce((v_them->>'damage')::int, 0) > 0 then v_n else 0 end
      when 'if_status_opp' then case when v_them is not null and (v_them->>'status' = v_op->>'status'
        or (v_op->>'status' = 'poisoned' and (v_them->>'poisoned')::boolean)
        or (v_op->>'status' = 'burned' and (v_them->>'burned')::boolean)) then v_n else 0 end
      else 0 end;
  end loop;
  v_damage := greatest(v_damage, 0);

  if v_them is not null then
    v_prevented := coalesce((v_them->>'prevent')::int = v_turn, false);
    if v_damage > 0 and not v_prevented then
      if not v_fx @> '[{"op": "no_weakness"}]'
         and exists (select 1 from jsonb_array_elements_text(v_card->'types') t where v_target->'weaknesses' ? t) then
        v_damage := v_damage * (public.pvp_rules()->>'weakness_multiplier')::int;
      end if;
      if not v_fx @> '[{"op": "no_resistance"}]'
         and exists (select 1 from jsonb_array_elements_text(v_card->'types') t where v_target->'resistances' ? t) then
        v_damage := v_damage - (public.pvp_rules()->>'resistance')::int;
      end if;
      if (v_me->'weaken'->>'turn')::int = v_turn then
        v_damage := v_damage - (v_me->'weaken'->>'n')::int;
      end if;
      if (v_them->'reduce'->>'turn')::int = v_turn then
        v_damage := v_damage - (v_them->'reduce'->>'n')::int;
      end if;
      v_dealt := greatest(v_damage, 0);
    end if;
  end if;
  g := public.pvp_ev(g, jsonb_build_object('k', 'attack', 's', p_side, 'c', v_me->'c', 'i', p_attack,
    'damage', v_dealt, 'flips', v_flips, 'prevented', v_prevented));
  g := public.pvp_hurt(g, v_foe, 0, v_dealt);

  -- Effects (switches last)
  for v_op in select * from jsonb_array_elements(v_fx) loop
    continue when not public.pvp_cond(v_op, v_up);
    v_n := case when jsonb_typeof(v_op->'n') = 'number' then (v_op->>'n')::int else 0 end;
    case v_op->>'op'
      when 'status' then
        if v_op->>'target' = 'self' then
          g := public.pvp_condition(g, p_side, 0, v_op->>'status');
        elsif not v_prevented then
          g := public.pvp_condition(g, v_foe, 0, v_op->>'status');
        end if;
      when 'heal_self' then
        g := public.pvp_heal(g, p_side, 0, v_n);
      when 'heal_all' then
        for v_pos in select * from public.pvp_positions(g, p_side) loop
          g := public.pvp_heal(g, p_side, v_pos, v_n);
        end loop;
      when 'drain' then
        g := public.pvp_heal(g, p_side, 0, v_dealt);
      when 'self_damage' then
        g := public.pvp_hurt(g, p_side, 0, v_n);
      when 'bench_one' then
        v_pos := (p_opts->>'target')::int;
        if v_pos is null or v_pos < 1 or public.pvp_slot(g, v_foe, v_pos) is null then
          v_pos := public.pvp_ai_weakest(g, v_foe, false);
        end if;
        g := public.pvp_hurt(g, v_foe, v_pos, v_n);
      when 'bench_each' then
        for v_pos in select p from public.pvp_positions(g, v_foe) p where p > 0 loop
          g := public.pvp_hurt(g, v_foe, v_pos, v_n);
        end loop;
      when 'own_bench_each' then
        for v_pos in select p from public.pvp_positions(g, p_side) p where p > 0 loop
          g := public.pvp_hurt(g, p_side, v_pos, v_n);
        end loop;
      when 'snipe' then
        v_pos := (p_opts->>'target')::int;
        if v_pos is null or public.pvp_slot(g, v_foe, v_pos) is null then
          v_pos := public.pvp_ai_weakest(g, v_foe, true);
        end if;
        if not (v_pos = 0 and v_prevented) then
          g := public.pvp_hurt(g, v_foe, v_pos, v_n);
        end if;
      when 'spread' then
        for v_pos in select * from public.pvp_positions(g, v_foe) loop
          continue when v_pos = 0 and v_prevented;
          g := public.pvp_hurt(g, v_foe, v_pos, v_n);
        end loop;
      when 'discard_self' then
        g := jsonb_set(g, public.pvp_path(p_side, 0), public.pvp_drop_energy(v_card, public.pvp_slot(g, p_side, 0),
          case when v_op->>'n' = 'all' then 999 else v_n end));
      when 'discard_opp' then
        if public.pvp_slot(g, v_foe, 0) is not null and not v_prevented then
          g := jsonb_set(g, public.pvp_path(v_foe, 0), public.pvp_drop_energy(v_target, public.pvp_slot(g, v_foe, 0), v_n, true));
          g := public.pvp_ev(g, jsonb_build_object('k', 'discard_energy', 's', v_foe, 'c', public.pvp_slot(g, v_foe, 0)->'c', 'n', v_n));
        end if;
      when 'lock_self' then
        g := public.pvp_set(g, p_side, 0, 'lock_attack', to_jsonb(v_turn + 2));
      when 'lock_opp' then
        if not v_prevented then g := public.pvp_set(g, v_foe, 0, 'lock_attack', to_jsonb(v_turn + 1)); end if;
      when 'no_retreat' then
        if not v_prevented then g := public.pvp_set(g, v_foe, 0, 'no_retreat', to_jsonb(v_turn + 1)); end if;
      when 'reduce_next' then
        g := public.pvp_set(g, p_side, 0, 'reduce', jsonb_build_object('n', v_n, 'turn', v_turn + 1));
      when 'prevent_next' then
        g := public.pvp_set(g, p_side, 0, 'prevent', to_jsonb(v_turn + 1));
      when 'smokescreen' then
        if not v_prevented then g := public.pvp_set(g, v_foe, 0, 'smoke', to_jsonb(v_turn + 1)); end if;
      when 'weaken_opp' then
        if not v_prevented then g := public.pvp_set(g, v_foe, 0, 'weaken', jsonb_build_object('n', v_n, 'turn', v_turn + 1)); end if;
      when 'draw' then
        g := public.pvp_draw(g, p_side, v_n);
      when 'call_basic' then
        for i in 1..greatest(v_n, 1) loop
          exit when jsonb_array_length(g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int;
          select (d.c #>> '{}')::int into v_pos from jsonb_array_elements(g->p_side->'deck') d(c)
          where g->p_side->'cards'->((d.c #>> '{}')::int)->>'stage' = 'basic' limit 1;
          exit when v_pos is null;
          g := jsonb_set(g, array[p_side, 'deck'], (
            select coalesce(jsonb_agg(d.c order by d.n), '[]') from jsonb_array_elements(g->p_side->'deck') with ordinality d(c, n)
            where d.n <> (select min(e.n) from jsonb_array_elements(g->p_side->'deck') with ordinality e(c, n) where (e.c #>> '{}')::int = v_pos)));
          g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') || jsonb_build_array(public.pvp_new_slot(v_pos, v_turn)));
          g := public.pvp_ev(g, jsonb_build_object('k', 'bench', 's', p_side, 'c', v_pos));
        end loop;
      when 'move_energy' then
        v_pos := (p_opts->>'energy_to')::int;
        if v_pos is null or v_pos < 1 or public.pvp_slot(g, p_side, v_pos) is null then
          v_pos := public.pvp_ai_bench_pick(g, p_side);
        end if;
        if v_pos is not null and (public.pvp_slot(g, p_side, 0)->>'energy')::int > 0 then
          -- the newest energy moves, with its type
          v_moved := public.pvp_slot(g, p_side, 0)->'etypes'->>-1;
          g := jsonb_set(g, public.pvp_path(p_side, 0), public.pvp_slot(g, p_side, 0)
            || jsonb_build_object('etypes', (public.pvp_slot(g, p_side, 0)->'etypes') - -1, 'energy', (public.pvp_slot(g, p_side, 0)->>'energy')::int - 1));
          g := jsonb_set(g, public.pvp_path(p_side, v_pos), public.pvp_add_energy(public.pvp_slot(g, p_side, v_pos), coalesce(v_moved, 'Colorless')));
        end if;
      else
        null;
    end case;
  end loop;

  -- Switches, after the damage
  for v_op in select * from jsonb_array_elements(v_fx) loop
    continue when not public.pvp_cond(v_op, v_up);
    if v_op->>'op' = 'switch_self' and public.pvp_slot(g, p_side, 0) is not null then
      v_pos := (p_opts->>'switch_to')::int;
      if v_pos is null or v_pos < 1 or public.pvp_slot(g, p_side, v_pos) is null then
        v_pos := public.pvp_ai_bench_pick(g, p_side);
      end if;
      if v_pos is not null then g := public.pvp_switch(g, p_side, v_pos); end if;
    elsif v_op->>'op' = 'opp_switch' and public.pvp_slot(g, v_foe, 0) is not null and not v_prevented then
      v_pos := public.pvp_ai_bench_pick(g, v_foe);
      if v_pos is not null then g := public.pvp_switch(g, v_foe, v_pos); end if;
    end if;
  end loop;

  return public.pvp_ko(g);
end;
$$;

-- One action of a side on its turn, validated. Raises pvp_invalid_action
-- (or a more precise reason) when it isn't allowed.
--   { type: 'bench', card }            a Basic from my hand to my Bench
--   { type: 'evolve', card, pos }      an evolution from my hand onto a Pokémon
--   { type: 'attach', pos }            the turn's energy
--   { type: 'retreat', pos }           Active <-> that Benched Pokémon
--   { type: 'attack', attack, target?, switch_to?, energy_to? }
--   { type: 'end' }
create or replace function public.pvp_do(p_g jsonb, p_side text, p_action jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_turn int := (g->>'turn')::int;
  v_type text := p_action->>'type';
  v_card int := (p_action->>'card')::int;
  v_pos int := (p_action->>'pos')::int;
  v_slot jsonb;
  v_snap jsonb;
  v_block text;
begin
  if g->>'phase' <> 'play' or g->>'current' <> p_side or g->>'stage' <> 'play' then
    raise exception 'pvp_not_your_turn';
  end if;

  if v_type = 'bench' then
    v_snap := g->p_side->'cards'->v_card;
    if v_card is null or not (g->p_side->'hand' @> to_jsonb(array[v_card])) or v_snap->>'stage' <> 'basic' then
      raise exception 'pvp_invalid_action';
    end if;
    if jsonb_array_length(g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int then
      raise exception 'pvp_bench_full';
    end if;
    g := public.pvp_take_from_hand(g, p_side, v_card);
    g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') || jsonb_build_array(public.pvp_new_slot(v_card, v_turn)));
    return public.pvp_ev(g, jsonb_build_object('k', 'bench', 's', p_side, 'c', v_card));

  elsif v_type = 'evolve' then
    v_snap := g->p_side->'cards'->v_card;
    v_slot := public.pvp_slot(g, p_side, v_pos);
    if v_card is null or v_slot is null or not (g->p_side->'hand' @> to_jsonb(array[v_card]))
       or v_snap->>'stage' <> 'evolution' or v_snap->>'evolves_from' is distinct from public.pvp_top(g, p_side, v_slot)->>'name' then
      raise exception 'pvp_invalid_action';
    end if;
    if v_turn <= 2 or (v_slot->>'turn_in')::int >= v_turn then
      raise exception 'pvp_cannot_evolve_yet';
    end if;
    g := public.pvp_take_from_hand(g, p_side, v_card);
    v_slot := public.pvp_cleared(v_slot) || jsonb_build_object('c', v_card, 'under', (v_slot->'under') || (v_slot->'c'), 'turn_in', v_turn);
    g := jsonb_set(g, public.pvp_path(p_side, v_pos), v_slot);
    return public.pvp_ev(g, jsonb_build_object('k', 'evolve', 's', p_side, 'pos', v_pos, 'c', v_card));

  elsif v_type = 'attach' then
    v_slot := public.pvp_slot(g, p_side, v_pos);
    if v_slot is null then
      raise exception 'pvp_invalid_action';
    end if;
    -- the zone's energy, with its type (0031)
    if (g->p_side->>'attached')::boolean or v_turn = 1 or jsonb_typeof(g->p_side->'zone') is distinct from 'string' then
      raise exception 'pvp_no_energy';
    end if;
    g := jsonb_set(g, public.pvp_path(p_side, v_pos), public.pvp_add_energy(v_slot, g->p_side->>'zone'));
    g := jsonb_set(g, array[p_side, 'attached'], 'true');
    g := public.pvp_ev(g, jsonb_build_object('k', 'attach', 's', p_side, 'pos', v_pos, 'c', v_slot->'c', 'type', g->p_side->'zone'));
    return jsonb_set(g, array[p_side, 'zone'], 'null');

  elsif v_type = 'retreat' then
    v_slot := public.pvp_slot(g, p_side, 0);
    if v_slot is null or v_pos is null or v_pos < 1 or public.pvp_slot(g, p_side, v_pos) is null then
      raise exception 'pvp_invalid_action';
    end if;
    if (g->p_side->>'retreated')::boolean or v_slot->>'status' in ('asleep', 'paralyzed') or (v_slot->>'no_retreat')::int = v_turn
       or (v_slot->>'energy')::int < (public.pvp_top(g, p_side, v_slot)->>'retreat')::int then
      raise exception 'pvp_cannot_retreat';
    end if;
    g := jsonb_set(g, public.pvp_path(p_side, 0),
      public.pvp_drop_energy(public.pvp_top(g, p_side, v_slot), v_slot, (public.pvp_top(g, p_side, v_slot)->>'retreat')::int));
    g := jsonb_set(g, array[p_side, 'retreated'], 'true');
    return public.pvp_switch(g, p_side, v_pos);

  elsif v_type = 'attack' then
    v_block := public.pvp_attack_block(g, p_side, (p_action->>'attack')::int);
    if v_block is not null then
      raise exception 'pvp_cannot_attack: %', v_block;
    end if;
    g := public.pvp_attack(g, p_side, (p_action->>'attack')::int, p_action);
    return jsonb_set(g, '{stage}', '"end"');

  elsif v_type = 'end' then
    return public.pvp_ev(jsonb_set(g, '{stage}', '"end"'), jsonb_build_object('k', 'end', 's', p_side));
  end if;
  raise exception 'pvp_invalid_action';
end;
$$;

-- Plays on until it's the attacker's move (or the game is over): the
-- server's promotions and turns, checkups, draws, turn changes
create or replace function public.pvp_run(p_g jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_guard int := 0;
  v_rules jsonb := public.pvp_rules();
begin
  loop
    v_guard := v_guard + 1;
    exit when g->>'phase' = 'over' or v_guard > 50;
    if coalesce(g->'promote', '[]') ? 'd' then
      g := public.pvp_promote(g, 'd', public.pvp_ai_bench_pick(g, 'd'));
      continue;
    end if;
    if coalesce(g->'promote', '[]') ? 'a' then
      return g || jsonb_build_object('phase', 'promote');
    end if;
    case g->>'stage'
      when 'start' then
        g := public.pvp_draw(g, g->>'current', 1);
        g := jsonb_set(g, array[g->>'current', 'attached'], 'false');
        g := jsonb_set(g, array[g->>'current', 'retreated'], 'false');
        -- the energy zone (0031): the announced energy arrives, the next one
        -- is drawn; nothing on the first turn
        if (g->>'turn')::int > 1 then
          g := jsonb_set(g, array[g->>'current', 'zone'], coalesce(g->(g->>'current')->'next', 'null'));
          g := jsonb_set(g, array[g->>'current', 'next'], to_jsonb(public.pvp_random_energy(g->(g->>'current')->'energy_types')));
        end if;
        g := g || jsonb_build_object('stage', 'play', 'phase', 'play');
      when 'play' then
        if g->>'current' = 'a' then
          return g || jsonb_build_object('phase', 'play');
        end if;
        g := public.pvp_ai_turn(g || jsonb_build_object('phase', 'play'), 'd', g->>'level');
      when 'end' then
        -- an energy not attached is lost
        g := jsonb_set(g, array[g->>'current', 'zone'], 'null');
        g := public.pvp_checkup(g);
        g := g || jsonb_build_object('stage', 'next');
      when 'next' then
        if (g->>'turn')::int >= (v_rules->>'max_turns')::int then
          g := g || jsonb_build_object('phase', 'over', 'winner', case
            when (g->'a'->>'points')::int > (g->'d'->>'points')::int then 'a'
            when (g->'a'->>'points')::int < (g->'d'->>'points')::int then 'd' else 'draw' end);
          g := public.pvp_ev(g, jsonb_build_object('k', 'over', 'winner', g->'winner', 'reason', 'turns'));
          exit;
        end if;
        g := g || jsonb_build_object('turn', (g->>'turn')::int + 1, 'current', public.pvp_other(g->>'current'), 'stage', 'start');
        g := public.pvp_ev(g, jsonb_build_object('k', 'turn', 's', g->>'current'));
      else
        exit;
    end case;
  end loop;
  return g;
end;
$$;

-- A new game: both sides dealt with their energy types, the server's side
-- set up, a coin for who goes first; the attacker ('a') sets up next.
create or replace function public.pvp_game_new(p_mine jsonb, p_mine_energy jsonb, p_theirs jsonb, p_theirs_energy jsonb, p_level text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb;
begin
  g := jsonb_build_object('turn', 0, 'phase', 'setup', 'stage', 'setup', 'current', null,
    'first', case when public.pvp_flip() then 'a' else 'd' end, 'level', p_level, 'promote', '[]'::jsonb, 'winner', null,
    'events', '[]'::jsonb, 'a', public.pvp_new_side(p_mine, coalesce(p_mine_energy, public.pvp_deck_energy(p_mine))),
    'd', public.pvp_new_side(p_theirs, coalesce(p_theirs_energy, public.pvp_deck_energy(p_theirs))));
  return public.pvp_ai_setup(g, 'd', p_level);
end;
$$;


-- ---------- 4. The AI and the bots' decks ----------

set local application_name = 'migration 0031: step 4/5 AI and bots';

-- A whole turn of the server's side: evolve, fill the Bench, retreat when
-- it pays, attach the energy where it's needed most, attack (the best
-- expected hit) or end the turn. 'easy' never retreats, puts 4 energies in
-- 10 anywhere and picks its attack at random; 'normal' hesitates a little
-- between attacks.
create or replace function public.pvp_ai_turn(p_g jsonb, p_side text, p_level text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_turn int := (g->>'turn')::int;
  v_card int;
  v_pos int;
  v_slot jsonb;
  v_best int;
  v_best_value numeric;
  v_value numeric;
  v_easy boolean := p_level = 'easy';
  v_foe text := public.pvp_other(p_side);
begin
  -- 1. Evolve what can be (Active first)
  if v_turn > 2 then
    for v_card in select (h #>> '{}')::int from jsonb_array_elements(g->p_side->'hand') h loop
      continue when g->p_side->'cards'->v_card->>'stage' <> 'evolution' or not (g->p_side->'hand' @> to_jsonb(array[v_card]));
      select p into v_pos from public.pvp_positions(g, p_side) p
      where public.pvp_top(g, p_side, public.pvp_slot(g, p_side, p))->>'name' = g->p_side->'cards'->v_card->>'evolves_from'
        and (public.pvp_slot(g, p_side, p)->>'turn_in')::int < v_turn
      order by p limit 1;
      if v_pos is not null then
        g := public.pvp_do(g, p_side, jsonb_build_object('type', 'evolve', 'card', v_card, 'pos', v_pos));
      end if;
    end loop;
  end if;

  -- 2. Basics to the Bench
  for v_card in select (h #>> '{}')::int from jsonb_array_elements(g->p_side->'hand') h
                order by case when v_easy then random() else -(g->p_side->'cards'->((h #>> '{}')::int)->>'hp')::numeric end loop
    exit when jsonb_array_length(g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int;
    continue when g->p_side->'cards'->v_card->>'stage' <> 'basic' or not (g->p_side->'hand' @> to_jsonb(array[v_card]));
    g := public.pvp_do(g, p_side, jsonb_build_object('type', 'bench', 'card', v_card));
  end loop;

  -- 3. Retreat (normal / hard): the Active can't hit for a while, or is
  -- about to fall, and a Benched one can attack right now
  v_slot := public.pvp_slot(g, p_side, 0);
  if not v_easy and v_slot is not null and not (g->p_side->>'retreated')::boolean
     and coalesce(v_slot->>'status', '') not in ('asleep', 'paralyzed') and (v_slot->>'no_retreat')::int is distinct from v_turn
     and (v_slot->>'energy')::int >= (public.pvp_top(g, p_side, v_slot)->>'retreat')::int then
    v_pos := public.pvp_ai_bench_pick(g, p_side);
    if v_pos is not null
       and exists (select 1 from jsonb_array_elements(public.pvp_top(g, p_side, public.pvp_slot(g, p_side, v_pos))->'attacks') a
                   where (a->>'usable')::boolean and public.pvp_can_pay(public.pvp_slot(g, p_side, v_pos), a))
       and (not exists (select 1 from jsonb_array_elements(public.pvp_top(g, p_side, v_slot)->'attacks') a
                        where (a->>'usable')::boolean
                          -- with this turn's energy
                          and public.pvp_missing(v_slot->'etypes' || case when jsonb_typeof(g->p_side->'zone') = 'string'
                                then jsonb_build_array(g->p_side->'zone') else '[]'::jsonb end, a->'energy', (a->>'cost')::int) = 0)
            or (p_level = 'hard' and public.pvp_hp_left(g, p_side, v_slot) * 3 < (public.pvp_top(g, p_side, v_slot)->>'hp')::int)) then
      g := public.pvp_do(g, p_side, jsonb_build_object('type', 'retreat', 'pos', v_pos));
    end if;
  end if;

  -- 4. Energy (typed since 0031): where the zone's energy brings an attack
  -- closer (the Active first, then the Benched Pokémon closest to its best
  -- attack), else the Active
  if v_turn > 1 and not (g->p_side->>'attached')::boolean and jsonb_typeof(g->p_side->'zone') = 'string' then
    if v_easy and random() < 0.4 then
      select p into v_pos from public.pvp_positions(g, p_side) p order by random() limit 1;
    else
      select p into v_pos from public.pvp_positions(g, p_side) p
      cross join lateral (select public.pvp_slot(g, p_side, p) as slot) s
      -- its best usable attack (the hardest hitting), energies missing before / after
      cross join lateral (
        select public.pvp_missing(s.slot->'etypes', a->'energy', (a->>'cost')::int) as before,
               public.pvp_missing(s.slot->'etypes' || (g->p_side->'zone'), a->'energy', (a->>'cost')::int) as after
        from jsonb_array_elements(public.pvp_top(g, p_side, s.slot)->'attacks') a
        where (a->>'usable')::boolean
        order by (a->>'base')::int desc, (a->>'cost')::int desc
        limit 1) need
      where need.after < need.before
      order by p = 0 desc, need.after, p
      limit 1;
      -- it helps no one: the Active (retreat costs, evolutions to come)
      v_pos := coalesce(v_pos, (select min(p) from public.pvp_positions(g, p_side) p));
    end if;
    if v_pos is not null then
      g := public.pvp_do(g, p_side, jsonb_build_object('type', 'attach', 'pos', v_pos));
    end if;
  end if;

  -- 5. Attack, or end the turn
  v_best := null;
  v_best_value := null;
  if public.pvp_slot(g, p_side, 0) is not null then
    for i in 0..coalesce(jsonb_array_length(public.pvp_top(g, p_side, public.pvp_slot(g, p_side, 0))->'attacks'), 0) - 1 loop
      continue when public.pvp_attack_block(g, p_side, i) is not null;
      v_value := case when v_easy then random() else public.pvp_ai_attack_value(g, p_side, i) + random() * case p_level when 'hard' then 2 else 15 end end;
      if v_best_value is null or v_value > v_best_value then
        v_best := i;
        v_best_value := v_value;
      end if;
    end loop;
  end if;
  if v_best is not null and (v_easy or v_best_value > 0) then
    return public.pvp_do(g, p_side, jsonb_build_object('type', 'attack', 'attack', v_best));
  end if;
  return public.pvp_do(g, p_side, jsonb_build_object('type', 'end'));
end;
$$;

-- A card's strength for deck building (autoDeck's attack weights): damage
-- per energy, its best hit, HP per point it gives
create or replace function public.pvp_card_value(p_card jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(max((a->>'base')::numeric / greatest((a->>'cost')::int, 1)), 0)
       + 0.5 * coalesce(max((a->>'base')::numeric), 0) / 10
       + 0.7 * coalesce((p_card->>'hp')::numeric, 0) / greatest(coalesce((p_card->>'prizes')::int, 1), 1) / 20
  from jsonb_array_elements(coalesce(p_card->'attacks', '[]')) a
  where (a->>'usable')::boolean
$$;

-- Whether a card can pay one of its usable attacks with these energy types
create or replace function public.pvp_fits_energy(p_card jsonb, p_energy jsonb)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_card->'attacks', '[]')) a
    where (a->>'usable')::boolean
      and not exists (select 1 from jsonb_array_elements_text(coalesce(a->'energy', '[]')) t
                      where t <> 'Colorless' and not (p_energy ? t)))
$$;

-- A bot's deck: { cards: 20 snapshots in evolution lines (a Stage 2 line,
-- Stage 1 lines, Basics; 2 copies each), energy: its 1 or 2 types }, or
-- null if the format can't fill one. Given my deck (0031): only my deck's
-- eras, and cards about as strong as mine (their percentile in the same
-- pool): easy 60% of it, normal 5 points below, hard 10 above. Without it,
-- the level's fixed spot in the ranking (0030). It tries a few energy picks
-- (hard first tries the Weakness most of my Pokémon share), then gives up
-- on the types (its energy then follows its cards).
create or replace function public.pvp_bot_deck(p_format text, p_level text, p_mine jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules jsonb := public.pvp_rules();
  v_size int := (v_rules->>'deck_size')::int;
  v_series text[];
  v_strength numeric;
  v_target numeric;
  v_types jsonb;
  v_first text;
  v_second text;
  v_deck jsonb;
  v_names text[];
  v_line record;
  v_card jsonb;
  v_pick jsonb;
  v_stage2_lines int;
  v_stage1_lines int;
begin
  create temp table if not exists pvp_bot_cards (card jsonb, name text, stage text, evolves_from text, value numeric, score numeric) on commit drop;

  -- My deck's eras
  if p_mine is not null then
    select array_agg(distinct s.series) into v_series
    from jsonb_array_elements(p_mine) m
    join public.cards c on c.id = m->>'id'
    join public.sets s on s.id = c.set_id
    where s.series is not null;
  end if;

  -- The pool: cards of the format (and of my eras, unless they're too few)
  for i in 1..2 loop
    truncate pvp_bot_cards;
    insert into pvp_bot_cards
    select x.card, x.card->>'name', x.card->>'stage', x.card->>'evolves_from', public.pvp_card_value(x.card), null
    from (
      select public.pvp_card(c.id) as card
      from public.cards c
      join public.sets s on s.id = c.set_id
      where c.supertype = 'Pokémon' and c.hp > 0 and case
        when p_format = 'all' then true
        when p_format like 'era:%' then s.series = substring(p_format from 5)
        when p_format like 'set:%' then coalesce(s.parent_set_id, s.id) = substring(p_format from 5)
        else false end
        and (v_series is null or s.series = any(v_series))
      order by random()
      limit 2000
    ) x
    where x.card is not null and x.card->>'stage' <> 'none'
      and exists (select 1 from jsonb_array_elements(x.card->'attacks') a where (a->>'usable')::boolean);
    exit when v_series is null or (select count(*) from pvp_bot_cards) >= 60;
    v_series := null;
  end loop;

  -- How strong my deck is in that pool, and where the bot aims
  if p_mine is not null and jsonb_array_length(p_mine) > 0 then
    select avg((select count(*) from pvp_bot_cards b where b.value < public.pvp_card_value(m))::numeric
               / greatest((select count(*) from pvp_bot_cards), 1))
    into v_strength
    from jsonb_array_elements(p_mine) m;
  end if;
  v_target := case
    when v_strength is null then case p_level when 'easy' then 0.25 when 'normal' then 0.55 else 0.95 end
    else least(greatest(case p_level when 'easy' then v_strength * 0.6 when 'normal' then v_strength - 0.05 else v_strength + 0.1 end, 0.05), 0.98) end;

  for v_try in 1..5 loop
    -- Its energy: a type drawn by how many cards of the pool have it, maybe a
    -- second one; no types on the last try
    v_first := null;
    v_second := null;
    if v_try = 1 and p_level = 'hard' and p_mine is not null then
      select w into v_first
      from jsonb_array_elements(p_mine) m, jsonb_array_elements_text(coalesce(m->'weaknesses', '[]')) w
      where v_rules->'energy_types' ? w
      group by w order by count(*) desc, w limit 1;
    end if;
    if v_try < 5 then
      if v_first is null then
        select t into v_first
        from (select t, count(*) as n from pvp_bot_cards b, jsonb_array_elements_text(b.card->'types') t
              where v_rules->'energy_types' ? t group by t) x
        order by -ln(1 - random()) / x.n limit 1;
      end if;
      if random() < 0.4 then
        select t into v_second
        from (select t, count(*) as n from pvp_bot_cards b, jsonb_array_elements_text(b.card->'types') t
              where v_rules->'energy_types' ? t and t <> v_first group by t) x
        order by -ln(1 - random()) / x.n limit 1;
      end if;
    end if;
    v_types := case when v_first is null then null
                    else jsonb_build_array(v_first) || case when v_second is null then '[]'::jsonb else jsonb_build_array(v_second) end end;
    continue when v_try < 5 and v_types is null;

    -- Scores: the strength percentile among the cards this energy can pay
    update pvp_bot_cards set score = null;
    update pvp_bot_cards p set score = r.pct
    from (
      select q.card->>'id' as id, percent_rank() over (order by q.value) as pct
      from pvp_bot_cards q
      where v_types is null or public.pvp_fits_energy(q.card, v_types)
    ) r
    where p.card->>'id' = r.id;

    -- Lines: a Stage 2 one, then Stage 1 ones, then Basics, closest to the target first
    v_deck := '[]';
    v_names := '{}';
    v_stage2_lines := 0;
    v_stage1_lines := 0;
    for v_line in
      select l.cards from (
        select jsonb_build_array(b.card, s1.card, s2.card) as cards, 1 as kind, abs((b.score + s1.score + s2.score) / 3 - v_target) as gap
        from pvp_bot_cards s2
        join pvp_bot_cards s1 on s1.name = s2.evolves_from and s1.stage = 'evolution' and s1.score is not null
        join pvp_bot_cards b on b.name = s1.evolves_from and b.stage = 'basic' and b.score is not null
        where s2.stage = 'evolution' and s2.score is not null
        union all
        select jsonb_build_array(b.card, s1.card), 2, abs((b.score + s1.score) / 2 - v_target)
        from pvp_bot_cards s1
        join pvp_bot_cards b on b.name = s1.evolves_from and b.stage = 'basic' and b.score is not null
        where s1.stage = 'evolution' and s1.score is not null
        union all
        select jsonb_build_array(b.card), 3, abs(b.score - v_target) from pvp_bot_cards b where b.stage = 'basic' and b.score is not null
      ) l
      order by l.kind, l.gap + random() * 0.15
    loop
      continue when exists (select 1 from jsonb_array_elements(v_line.cards) c where c->>'name' = any(v_names));
      continue when jsonb_array_length(v_deck) + 2 * jsonb_array_length(v_line.cards) > v_size;
      -- one Stage 2 line, two Stage 1 lines at most: the rest is Basics
      continue when jsonb_array_length(v_line.cards) = 3 and v_stage2_lines >= 1;
      continue when jsonb_array_length(v_line.cards) = 2 and v_stage1_lines >= 2;
      v_stage2_lines := v_stage2_lines + (jsonb_array_length(v_line.cards) = 3)::int;
      v_stage1_lines := v_stage1_lines + (jsonb_array_length(v_line.cards) = 2)::int;
      for v_card in select * from jsonb_array_elements(v_line.cards) loop
        v_deck := v_deck || jsonb_build_array(v_card, v_card);
        v_names := v_names || (v_card->>'name');
      end loop;
      exit when jsonb_array_length(v_deck) >= v_size;
    end loop;
    -- Too few different names: one copy fills the rest
    if jsonb_array_length(v_deck) < v_size then
      for v_pick in select p.card from pvp_bot_cards p where p.stage = 'basic' and p.score is not null order by abs(p.score - v_target) loop
        continue when (select count(*) from jsonb_array_elements(v_deck) c where c->>'name' = v_pick->>'name') >= 2;
        v_deck := v_deck || jsonb_build_array(v_pick);
        exit when jsonb_array_length(v_deck) >= v_size;
      end loop;
    end if;
    if jsonb_array_length(v_deck) >= v_size then
      return jsonb_build_object('cards', v_deck, 'energy', coalesce(v_types, public.pvp_deck_energy(v_deck)));
    end if;
  end loop;
  return null;
end;
$$;

-- ---------- 5. RPCs ----------

set local application_name = 'migration 0031: step 5/5 RPCs';

-- A saved deck's energy, or the one its cards ask for
create or replace function public.pvp_energy_of(p_energy text[], p_cards jsonb)
returns jsonb
language sql
immutable
as $$
  select case when public.pvp_valid_energy(p_energy) then to_jsonb(p_energy) else public.pvp_deck_energy(p_cards) end
$$;

-- The energy of my attack deck in a format
create or replace function public.pvp_my_energy(p_user uuid, p_format text, p_cards jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.pvp_energy_of((select d.energy from public.pvp_decks d
                               where d.user_id = p_user and d.format = p_format and d.role = 'attack'), p_cards)
$$;

-- What the attacker can do right now (the client draws its buttons from it)
create or replace function public.pvp_hints(p_g jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_my_turn boolean := p_g->>'phase' = 'play' and p_g->>'current' = 'a' and p_g->>'stage' = 'play';
  v_turn int := (p_g->>'turn')::int;
  v_active jsonb := public.pvp_slot(p_g, 'a', 0);
begin
  return jsonb_build_object(
    'my_turn', v_my_turn,
    'setup', p_g->>'phase' = 'setup',
    'promote', p_g->>'phase' = 'promote',
    'attach', v_my_turn and v_turn > 1 and not (p_g->'a'->>'attached')::boolean and jsonb_typeof(p_g->'a'->'zone') = 'string',
    -- hand card index -> { bench: bool, evolve: [positions] }
    'hand', coalesce((
      select jsonb_object_agg(h.c, jsonb_build_object(
        'bench', v_my_turn and p_g->'a'->'cards'->h.c->>'stage' = 'basic'
                 and jsonb_array_length(p_g->'a'->'bench') < (public.pvp_rules()->>'bench_size')::int,
        'evolve', coalesce((
          select jsonb_agg(p order by p) from public.pvp_positions(p_g, 'a') p
          where v_my_turn and v_turn > 2 and p_g->'a'->'cards'->h.c->>'stage' = 'evolution'
            and public.pvp_top(p_g, 'a', public.pvp_slot(p_g, 'a', p))->>'name' = p_g->'a'->'cards'->h.c->>'evolves_from'
            and (public.pvp_slot(p_g, 'a', p)->>'turn_in')::int < v_turn), '[]')))
      from (select distinct (x #>> '{}')::int as c from jsonb_array_elements(p_g->'a'->'hand') x) h), '{}'),
    'retreat', v_my_turn and v_active is not null and not (p_g->'a'->>'retreated')::boolean
               and jsonb_array_length(p_g->'a'->'bench') > 0
               and coalesce(v_active->>'status', '') not in ('asleep', 'paralyzed')
               and (v_active->>'no_retreat')::int is distinct from v_turn
               and (v_active->>'energy')::int >= (public.pvp_top(p_g, 'a', v_active)->>'retreat')::int,
    -- attack index -> null (can) or why not
    'attacks', case when v_active is null then '[]'::jsonb else coalesce((
      select jsonb_agg(case when v_my_turn then public.pvp_attack_block(p_g, 'a', i) else 'not_your_turn' end order by i)
      from generate_series(0, jsonb_array_length(public.pvp_top(p_g, 'a', v_active)->'attacks') - 1) i), '[]') end
  );
end;
$$;

-- A battle as its attacker sees it: my hand and field, their field, their
-- hand and deck as counts, both discard piles, what I can do now
create or replace function public.pvp_battle_view(p_battle public.pvp_battles)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g jsonb := p_battle.game;
  v_side text;
  v_sides jsonb := '{}';
begin
  if g is null then
    return null;
  end if;
  foreach v_side in array array['a', 'd'] loop
    v_sides := v_sides || jsonb_build_object(v_side, jsonb_build_object(
      'points', (g->v_side->>'points')::int,
      'deck', jsonb_array_length(g->v_side->'deck'),
      'hand_count', jsonb_array_length(g->v_side->'hand'),
      'discard', coalesce((select jsonb_agg(g->v_side->'cards'->((x #>> '{}')::int) order by n)
                           from jsonb_array_elements(g->v_side->'discard') with ordinality d(x, n)), '[]'),
      'active', public.pvp_slot_view(g, v_side, public.pvp_slot(g, v_side, 0)),
      'bench', coalesce((select jsonb_agg(public.pvp_slot_view(g, v_side, b) order by n)
                         from jsonb_array_elements(g->v_side->'bench') with ordinality x(b, n)), '[]'),
      'attached', (g->v_side->>'attached')::boolean,
      'retreated', (g->v_side->>'retreated')::boolean,
      'used_once', (g->v_side->>'used_once')::boolean,
      -- the energy zone (0031): my deck's types, this turn's energy, the next one
      'energy_types', g->v_side->'energy_types',
      'zone', g->v_side->'zone',
      'next', g->v_side->'next'));
  end loop;

  return jsonb_build_object(
    'id', p_battle.id,
    'engine', p_battle.engine,
    'format', p_battle.format,
    'status', p_battle.status,
    'turn', (g->>'turn')::int,
    'phase', g->>'phase',
    'current', g->>'current',
    'first', g->>'first',
    'winner', g->>'winner',
    'elo_change', p_battle.elo_change,
    'bot', p_battle.bot,
    'paid', p_battle.paid,
    'coins', p_battle.coins,
    'opponent', jsonb_build_object(
      'bot', p_battle.bot,
      'username', (select p.username from public.profiles p where p.id = p_battle.defender and p.is_public),
      'elo', (select r.elo from public.pvp_ratings r where r.user_id = p_battle.defender and r.format = p_battle.format)),
    'me', (v_sides->'a') || jsonb_build_object(
      'hand', coalesce((select jsonb_agg(jsonb_build_object('index', (x #>> '{}')::int, 'card', g->'a'->'cards'->((x #>> '{}')::int)) order by n)
                        from jsonb_array_elements(g->'a'->'hand') with ordinality h(x, n)), '[]')),
    -- once it's over, their whole deck
    'them', (v_sides->'d') || jsonb_build_object('cards', case when p_battle.status <> 'playing' then g->'d'->'cards' end),
    'my_cards', g->'a'->'cards',
    'hints', public.pvp_hints(g),
    'log', public.pvp_public_events((select coalesce(jsonb_agg(e order by n), '[]') from (
      select e, n from jsonb_array_elements(p_battle.log) with ordinality x(e, n) order by n desc limit 60) y))
  );
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
  v_wallet public.challenge_wallets;
  v_rules jsonb := public.pvp_rules();
  v_battle public.pvp_battles;
  v_bots_today int;
begin
  if not public.pvp_open_to(v_user) then
    return jsonb_build_object('ready', false);
  end if;
  v_wallet := public.lock_challenge_wallet(v_user);
  select * into v_battle from public.pvp_battles b where b.attacker = v_user and b.status = 'playing';
  select count(*) into v_bots_today from public.pvp_battles b
  where b.attacker = v_user and b.bot is not null and b.game_day = public.challenge_today();
  select * into v_wallet from public.challenge_wallets w where w.user_id = v_user;

  return v_rules || jsonb_build_object(
    -- a card sync that stored the attack effects (0029) and typed costs (0031) must have run
    'ready', exists (select 1 from public.cards c where c.attacks -> 0 ? 'fx')
             and exists (select 1 from public.cards c where c.attacks -> 0 ? 'energy')
             and exists (select 1 from public.sets s where s.series is not null),
    'battles_left', greatest((v_rules->>'battles_per_day')::int - (
      select count(*) from public.pvp_battles b
      where b.attacker = v_user and b.bot is null and b.game_day = public.challenge_today()), 0),
    'bot_battles_left', greatest((v_rules->>'bot_battles_per_day')::int - v_bots_today, 0),
    'bot_paid_left', greatest((v_rules->>'bot_paid_per_day')::int - v_bots_today, 0),
    'coins', v_wallet.coins,
    -- every format, with how many copies of my playable cards fit there
    'formats', (
      with mine as (
        select c.card_id, c.quantity, s.series, coalesce(s.parent_set_id, s.id) as set_id
        from public.collections c
        join public.cards k on k.id = c.card_id
        join public.sets s on s.id = k.set_id
        where c.user_id = v_user and c.mode = 'challenge' and k.supertype = 'Pokémon' and k.hp > 0
      )
      select jsonb_build_object(
        'all', (select coalesce(sum(m.quantity), 0) from mine m),
        'eras', coalesce((
          select jsonb_agg(jsonb_build_object('format', 'era:' || e.series, 'series', e.series,
                   'owned', (select coalesce(sum(m.quantity), 0) from mine m where m.series = e.series)) order by e.first)
          from (select s.series, min(s.release_date) as first from public.sets s where s.series is not null group by s.series) e), '[]'),
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object('format', 'set:' || s.id, 'set_id', s.id, 'name', s.name, 'name_fr', s.name_fr,
                   'series', s.series, 'owned', m.owned) order by s.release_date desc, s.id)
          from (select m.set_id, sum(m.quantity) as owned from mine m group by m.set_id) m
          join public.sets s on s.id = m.set_id), '[]'))
    ),
    -- { format: { attack: { ids, valid, energy, energy_auto }, defense: ... } }, a missing role = not saved;
    -- energy_auto = not picked, it follows the cards (pvp_deck_energy)
    'decks', coalesce((
      select jsonb_object_agg(f.format, f.roles)
      from (
        select d.format, jsonb_object_agg(d.role, jsonb_build_object(
          'ids', to_jsonb(d.card_ids),
          'valid', x.cards is not null,
          'energy', public.pvp_energy_of(d.energy, x.cards),
          'energy_auto', not public.pvp_valid_energy(d.energy))) as roles
        from public.pvp_decks d
        cross join lateral (select public.pvp_deck_cards(v_user, d.format, d.card_ids) as cards) x
        where d.user_id = v_user
        group by d.format) f), '{}'),
    'ratings', coalesce((
      select jsonb_object_agg(r.format, jsonb_build_object('elo', r.elo, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws,
        'def_wins', r.def_wins, 'def_losses', r.def_losses, 'def_draws', r.def_draws))
      from public.pvp_ratings r where r.user_id = v_user), '{}'),
    'battle', case when v_battle.id is null then null else public.pvp_battle_view(v_battle) end,
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
          'bot', b.bot,
          'coins', b.coins,
          'opponent', (select p.username from public.profiles p
                       where p.id = case when b.attacker = v_user then b.defender else b.attacker end and p.is_public)) h
        from public.pvp_battles b
        where (b.attacker = v_user or b.defender = v_user) and b.status <> 'playing'
        order by coalesce(b.ended_at, b.created_at) desc
        limit 10) x), '[]')
  );
end;
$$;

-- p_energy (0031): 1 or 2 types, null = follow the cards
create or replace function public.pvp_save_deck(p_format text, p_cards text[], p_role text default 'attack', p_energy text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets;
begin
  if not public.pvp_open_to(v_user) then
    raise exception 'pvp_closed';
  end if;
  v_wallet := public.lock_challenge_wallet(v_user);
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  if p_role is null or p_role not in ('attack', 'defense') then
    raise exception 'pvp_invalid_role';
  end if;
  if public.pvp_deck_cards(v_user, p_format, p_cards) is null then
    raise exception 'pvp_invalid_deck';
  end if;
  if p_energy is not null and not public.pvp_valid_energy(p_energy) then
    raise exception 'pvp_invalid_energy';
  end if;
  insert into public.pvp_decks (user_id, format, role, card_ids, energy) values (v_user, p_format, p_role, p_cards, p_energy)
  on conflict (user_id, format, role) do update set card_ids = excluded.card_ids, energy = excluded.energy, updated_at = now();
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
  v_wallet public.challenge_wallets;
  v_rules jsonb := public.pvp_rules();
  v_mine jsonb;
  v_me public.pvp_ratings;
  v_last uuid;
  v_foe record;
  v_game jsonb;
begin
  if not public.pvp_open_to(v_user) then
    raise exception 'pvp_closed';
  end if;
  v_wallet := public.lock_challenge_wallet(v_user);
  -- A battle in progress comes back: no escaping a bad one
  if exists (select 1 from public.pvp_battles b where b.attacker = v_user and b.status = 'playing') then
    return public.pvp_state();
  end if;
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  if (select count(*) from public.pvp_battles b
      where b.attacker = v_user and b.bot is null and b.game_day = public.challenge_today())
     >= (v_rules->>'battles_per_day')::int then
    raise exception 'pvp_no_battles_left';
  end if;

  v_mine := public.pvp_attack_deck(v_user, p_format);
  v_me := public.pvp_rating(v_user, p_format);
  select b.defender into v_last from public.pvp_battles b
  where b.attacker = v_user and b.defender is not null order by b.created_at desc limit 1;

  -- The 5 closest in Elo with a valid deck (their defense deck, else their
  -- attack deck), one of them at random (the last opponent only if nobody
  -- else is there)
  select f.user_id, f.cards, f.energy into v_foe
  from (
    select v.user_id, v.cards, v.energy, v.user_id = v_last as again
    from (
      select distinct on (d.user_id) d.user_id, x.cards, public.pvp_energy_of(d.energy, x.cards) as energy
      from public.pvp_decks d
      cross join lateral (select public.pvp_deck_cards(d.user_id, p_format, d.card_ids) as cards) x
      where d.format = p_format and d.user_id <> v_user and x.cards is not null
      order by d.user_id, d.role = 'defense' desc
    ) v
    left join public.pvp_ratings r on r.user_id = v.user_id and r.format = p_format
    order by v.user_id is not distinct from v_last, abs(coalesce(r.elo, (v_rules->>'start_elo')::int) - v_me.elo), random()
    limit 5
  ) f
  order by f.again, random()
  limit 1;
  if v_foe.user_id is null then
    raise exception 'pvp_no_opponent';
  end if;
  perform public.pvp_rating(v_foe.user_id, p_format);

  v_game := public.pvp_game_new(v_mine, public.pvp_my_energy(v_user, p_format, v_mine), v_foe.cards, v_foe.energy, 'hard');
  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, engine, game, log)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards, '{}', '{}', 3, v_game - 'events', '[]');

  return public.pvp_state();
end;
$$;


create or replace function public.pvp_bot_start(p_format text, p_level text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets;
  v_rules jsonb := public.pvp_rules();
  v_mine jsonb;
  v_bot jsonb;
  v_today int;
  v_game jsonb;
begin
  if not public.pvp_open_to(v_user) then
    raise exception 'pvp_closed';
  end if;
  v_wallet := public.lock_challenge_wallet(v_user);
  if exists (select 1 from public.pvp_battles b where b.attacker = v_user and b.status = 'playing') then
    return public.pvp_state();
  end if;
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  if p_level is null or not (v_rules->'bot_levels' ? p_level) then
    raise exception 'pvp_invalid_level';
  end if;
  select count(*) into v_today from public.pvp_battles b
  where b.attacker = v_user and b.bot is not null and b.game_day = public.challenge_today();
  if v_today >= (v_rules->>'bot_battles_per_day')::int then
    raise exception 'pvp_no_bot_battles_left';
  end if;

  v_mine := public.pvp_attack_deck(v_user, p_format);
  v_bot := public.pvp_bot_deck(p_format, p_level, v_mine);
  if v_bot is null then
    raise exception 'pvp_no_bot_deck';
  end if;

  v_game := public.pvp_game_new(v_mine, public.pvp_my_energy(v_user, p_format, v_mine), v_bot->'cards', v_bot->'energy', p_level);
  insert into public.pvp_battles (attacker, defender, bot, paid, format, a_deck, d_deck, a_hp, d_hp, engine, game, log)
  values (v_user, null, p_level, v_today < (v_rules->>'bot_paid_per_day')::int, p_format, v_mine, v_bot->'cards', '{}', '{}', 3,
    v_game - 'events', '[]');

  return public.pvp_state();
end;
$$;

-- One move of the attacker in the battle in progress, then the server plays
-- on (its own turn included) until it's my move again. Returns { battle,
-- events (what just happened, the defender's draws hidden), state }.
--   { type: 'setup', active: card index, bench: [card indexes] }   first move
--   { type: 'promote', pos }                                       after a knock out
--   and pvp_do()'s actions on my turn
create or replace function public.pvp_act(p_action jsonb)
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
  g jsonb;
  v_type text := p_action->>'type';
  v_card int;
  v_events jsonb;
  v_status text;
begin
  select * into v_b from public.pvp_battles b where b.attacker = v_user and b.status = 'playing' for update;
  if not found then
    raise exception 'no_game';
  end if;
  if v_b.engine <> 3 or v_b.game is null then
    raise exception 'pvp_invalid_action';
  end if;
  g := v_b.game || jsonb_build_object('events', '[]'::jsonb);

  if v_type = 'setup' then
    if g->>'phase' <> 'setup' then
      raise exception 'pvp_invalid_action';
    end if;
    v_card := (p_action->>'active')::int;
    if v_card is null or not (g->'a'->'hand' @> to_jsonb(array[v_card])) or g->'a'->'cards'->v_card->>'stage' <> 'basic' then
      raise exception 'pvp_invalid_action';
    end if;
    g := public.pvp_take_from_hand(g, 'a', v_card);
    g := jsonb_set(g, '{a,active}', public.pvp_new_slot(v_card, 0));
    for v_card in select (x #>> '{}')::int from jsonb_array_elements(coalesce(p_action->'bench', '[]')) x loop
      if not (g->'a'->'hand' @> to_jsonb(array[v_card])) or g->'a'->'cards'->v_card->>'stage' <> 'basic'
         or jsonb_array_length(g->'a'->'bench') >= (public.pvp_rules()->>'bench_size')::int then
        raise exception 'pvp_invalid_action';
      end if;
      g := public.pvp_take_from_hand(g, 'a', v_card);
      g := jsonb_set(g, '{a,bench}', (g->'a'->'bench') || jsonb_build_array(public.pvp_new_slot(v_card, 0)));
    end loop;
    g := g || jsonb_build_object('turn', 1, 'current', g->>'first', 'stage', 'start', 'phase', 'play');
    g := public.pvp_ev(g, jsonb_build_object('k', 'start', 'first', g->>'first'));
  elsif v_type = 'promote' then
    if g->>'phase' <> 'promote' or not (coalesce(g->'promote', '[]') ? 'a') then
      raise exception 'pvp_invalid_action';
    end if;
    g := public.pvp_promote(g, 'a', (p_action->>'pos')::int) || jsonb_build_object('phase', 'play');
  else
    g := public.pvp_do(g, 'a', p_action);
  end if;

  -- My move is done: the server plays until it's mine again
  if v_type <> 'setup' and v_type <> 'promote' and g->>'stage' = 'play' then
    null; -- still my turn (bench, evolve, attach, retreat)
  else
    g := public.pvp_run(g);
  end if;

  v_events := public.pvp_named_events(g, g->'events');
  update public.pvp_battles b
  set game = g - 'events', round = coalesce((g->>'turn')::int, 0),
      log = (select coalesce(jsonb_agg(e order by n), '[]') from (
               select e, n from jsonb_array_elements(b.log || v_events) with ordinality x(e, n) order by n desc limit 300) y)
  where b.id = v_b.id;

  if g->>'phase' = 'over' then
    v_status := case g->>'winner' when 'a' then 'won' when 'd' then 'lost' else 'draw' end;
    perform public.pvp_finish(v_b.id, v_status);
  end if;

  select * into v_b from public.pvp_battles b where b.id = v_b.id;
  return jsonb_build_object('battle', public.pvp_battle_view(v_b), 'events', public.pvp_public_events(v_events), 'state', public.pvp_state());
end;
$$;

-- Internal: not callable by clients
revoke execute on function public.pvp_missing(jsonb, jsonb, int) from public, anon, authenticated;
revoke execute on function public.pvp_valid_energy(text[]) from public, anon, authenticated;
revoke execute on function public.pvp_deck_energy(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_drop_energy(jsonb, jsonb, int, boolean) from public, anon, authenticated;
revoke execute on function public.pvp_add_energy(jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_random_energy(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_can_pay(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_new_side(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_game_new(jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_card_value(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_fits_energy(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_bot_deck(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_energy_of(text[], jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_my_energy(uuid, text, jsonb) from public, anon, authenticated;
-- Players
revoke execute on function public.pvp_save_deck(text, text[], text, text[]) from public, anon;
grant execute on function public.pvp_save_deck(text, text[], text, text[]) to authenticated;

set local application_name = 'migration 0031: done, committing';
