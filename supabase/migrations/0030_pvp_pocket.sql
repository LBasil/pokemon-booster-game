-- Pokémon Booster Game — Challenge: PvP rebuilt like Pokémon TCG Pocket
-- Run after 0029_cards_fr_battle_data.sql (and a card sync, see below).
--
-- User, 2026-10-05: a bot battle was won in two rounds by always hitting
-- with the biggest affordable attack ("aucun choix tactique"), then "je
-- crois qu'on est obligé de faire comme le TCG classique (genre pocket)",
-- "taille de deck de 20 avec 2x la même carte", "on reste en différé".
--
-- The game (mirrored in src/utils/pvp.js for labels and the deck builder —
-- the server stays the authority and sends what each card can do):
--   - Deck: 20 Pokémon of the challenge collection, at most 2 with the same
--     name, at least 1 Basic; each copy must be owned (collections.quantity).
--     No Trainer cards yet.
--   - Setup: 5 cards in hand, always with a Basic; each side puts a Basic
--     Active and up to 3 Basics on its Bench. A coin decides who goes first.
--   - A turn: draw 1 (an empty deck draws nothing), then in any order:
--     attach 1 energy from the energy zone to any of my Pokémon (not on the
--     first player's first turn), put Basics on the Bench (3 at most),
--     evolve (a card whose "evolves from" names the Pokémon, not on a
--     player's first turn, not a Pokémon played or evolved this turn),
--     retreat once (pay its retreat cost in energies), then attack (ends
--     the turn; not on the first player's first turn) or end the turn.
--     Energy is colorless: an attack costs its number of energies.
--   - Damage: the attack's base damage and its effects
--     (src/utils/attackEffects.js turned the printed text into ops at
--     import: coins, special conditions, healing, bench damage, energy
--     discards, damage per energy / counter...; a text it can't read is
--     shown as "not applied"). Weakness x2, Resistance -30 (Active only).
--   - Special conditions: Asleep (can't attack or retreat; a coin between
--     turns wakes it), Paralyzed (same, wears off after its owner's next
--     turn), Confused (a coin when attacking, tails: the attack fails),
--     Poisoned (10 between turns), Burned (20 between turns, then a coin
--     cures it). Retreating or evolving cures them.
--   - Knock out: the attacker takes points (ex/V/GX... 2, VMAX/TAG TEAM 3,
--     pvp_prizes()); its owner promotes a Benched Pokémon. 3 points win,
--     so does leaving the other side with no Pokémon in play. After 30
--     turns, the most points win, else a draw.
--   - Asynchronous: the attacker plays every turn; the defender (a
--     player's defense deck, else attack deck) or a bot is played by the
--     server (pvp_ai_turn). Elo, daily limits, bots and their coins: as in
--     0024-0027. Still testers only (0028's pvp_open_to(), checked inline
--     now: 0028's *_impl wrappers are dropped).
--
-- 1. pvp_battles: `game` (the whole state, jsonb), `engine` (2 = this);
--    battles still in progress from the old engine end as draws, no Elo,
--    no coins. Decks of 5 cards are no longer valid: players build 20.
-- 2. Cards: pvp_card() snapshots carry stage, evolves_from, retreat, the
--    attacks with their effects, French texts (0029). `ready` waits for a
--    card sync that stored the effects (attacks[].fx).
-- 3. The engine (internal): pvp_game_new, pvp_do (one action, validated),
--    pvp_attack, pvp_checkup, pvp_ko, pvp_ai_*, pvp_run (turns go on until
--    it's the attacker's move), pvp_hints (what I can do now).
-- 4. RPCs: pvp_state, pvp_eligible (+ copies owned), pvp_save_deck,
--    pvp_start, pvp_bot_start, pvp_act(action) (new: setup, bench, evolve,
--    attach, retreat, attack, end, promote), pvp_forfeit, pvp_leaderboard.
--    pvp_play(slot, attack) is dropped.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Battles ----------

set local application_name = 'migration 0030: step 1/6 battles';

alter table public.pvp_battles add column if not exists game jsonb;
alter table public.pvp_battles add column if not exists engine int not null default 1;

-- In progress on the old engine: no way to go on, a draw that changes nothing
update public.pvp_battles b
set status = 'draw', elo_change = 0, coins = case when b.bot is not null then 0 end, ended_at = now(), d_next = null, d_next_attack = null
where b.status = 'playing' and b.engine = 1;

-- ---------- 2. Old functions ----------

set local application_name = 'migration 0030: step 2/6 old functions';

drop function if exists public.pvp_state_impl();
drop function if exists public.pvp_save_deck_impl(text, text[], text);
drop function if exists public.pvp_start_impl(text);
drop function if exists public.pvp_bot_start_impl(text, text);
drop function if exists public.pvp_play(int, int);
drop function if exists public.pvp_defender_pick(jsonb, int[], int, jsonb);
drop function if exists public.pvp_damage(jsonb, jsonb, jsonb, int);
drop function if exists public.pvp_my_attack_deck(uuid, text);

-- ---------- 3. Rules, cards, decks ----------

set local application_name = 'migration 0030: step 3/6 cards and decks';

create or replace function public.pvp_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('engine', 2, 'deck_size', 20, 'max_copies', 2, 'hand_size', 5, 'bench_size', 3,
    'points_to_win', 3, 'max_turns', 30, 'battles_per_day', 10,
    'start_elo', 1000, 'k_factor', 32, 'weakness_multiplier', 2, 'resistance', 30, 'poison', 10, 'burn', 20,
    'bot_levels', jsonb_build_array('easy', 'normal', 'hard'),
    'bot_coins', jsonb_build_object('easy', 10, 'normal', 25, 'hard', 50),
    'bot_paid_per_day', 5, 'bot_battles_per_day', 20)
$$;

-- A card as a battle sees it, or null if it isn't a Pokémon with HP.
-- stage: 'basic' | 'evolution' | 'none' (can't be played: LEGEND halves...)
-- attacks: every printed attack with a known cost, in printed order:
--   { name, name_fr, printed, base, cost, text, text_fr, fx, coins, partial, usable }
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
          'cost', greatest((y->>'cost')::int, 0),
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

-- A deck's card snapshots if it follows the rules (20 cards, 2 of a name at
-- most, every copy owned, all fit the format, at least 1 Basic); null otherwise
create or replace function public.pvp_deck_cards(p_user uuid, p_format text, p_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules jsonb := public.pvp_rules();
  v_cards jsonb;
begin
  if cardinality(p_ids) is distinct from (v_rules->>'deck_size')::int then
    return null;
  end if;
  if exists (
    select 1 from (select i.id, count(*) as n from unnest(p_ids) i(id) group by i.id) x
    where not exists (select 1 from public.collections c
                      where c.user_id = p_user and c.mode = 'challenge' and c.card_id = x.id and c.quantity >= x.n)
       or not public.pvp_fits(x.id, p_format)) then
    return null;
  end if;
  select jsonb_agg(coalesce(public.pvp_card(i.id), 'null'::jsonb) order by i.n) into v_cards
  from unnest(p_ids) with ordinality i(id, n);
  if exists (select 1 from jsonb_array_elements(v_cards) c where jsonb_typeof(c) <> 'object' or c->>'stage' = 'none')
     or exists (select 1 from jsonb_array_elements(v_cards) c group by c->>'name' having count(*) > (v_rules->>'max_copies')::int)
     or not exists (select 1 from jsonb_array_elements(v_cards) c where c->>'stage' = 'basic') then
    return null;
  end if;
  return v_cards;
end;
$$;

-- ---------- 4. The engine ----------

set local application_name = 'migration 0030: step 4/6 engine';

create or replace function public.pvp_flip()
returns boolean
language sql
volatile
as $$
  select random() < 0.5
$$;

create or replace function public.pvp_other(p_side text)
returns text
language sql
immutable
as $$
  select case p_side when 'a' then 'd' else 'a' end
$$;

-- Where a slot lives: position 0 = Active, 1-3 = Bench
create or replace function public.pvp_path(p_side text, p_pos int)
returns text[]
language sql
immutable
as $$
  select case when p_pos = 0 then array[p_side, 'active'] else array[p_side, 'bench', (p_pos - 1)::text] end
$$;

create or replace function public.pvp_slot(p_g jsonb, p_side text, p_pos int)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(p_g #> public.pvp_path(p_side, p_pos)) = 'object' then p_g #> public.pvp_path(p_side, p_pos) end
$$;

-- The card on top of a slot
create or replace function public.pvp_top(p_g jsonb, p_side text, p_slot jsonb)
returns jsonb
language sql
immutable
as $$
  select p_g->p_side->'cards'->((p_slot->>'c')::int)
$$;

create or replace function public.pvp_hp_left(p_g jsonb, p_side text, p_slot jsonb)
returns int
language sql
immutable
as $$
  select ((public.pvp_top(p_g, p_side, p_slot)->>'hp')::int - (p_slot->>'damage')::int)
$$;

-- Positions in play: 0 if there is an Active, then 1..bench
create or replace function public.pvp_positions(p_g jsonb, p_side text)
returns setof int
language sql
immutable
as $$
  select 0 where jsonb_typeof(p_g->p_side->'active') = 'object'
  union all
  select n::int from generate_series(1, jsonb_array_length(coalesce(p_g->p_side->'bench', '[]'))) n
$$;

create or replace function public.pvp_set(p_g jsonb, p_side text, p_pos int, p_key text, p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_g, public.pvp_path(p_side, p_pos) || p_key, coalesce(p_value, 'null'::jsonb))
$$;

create or replace function public.pvp_ev(p_g jsonb, p_event jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_g, '{events}', coalesce(p_g->'events', '[]') || jsonb_build_array(p_event || jsonb_build_object('t', (p_g->>'turn')::int)))
$$;

create or replace function public.pvp_new_slot(p_card int, p_turn int)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('c', p_card, 'under', '[]'::jsonb, 'damage', 0, 'energy', 0, 'turn_in', p_turn,
    'status', null, 'status_turn', null, 'poisoned', false, 'burned', false,
    'lock_attack', null, 'no_retreat', null, 'reduce', null, 'prevent', null, 'smoke', null, 'weaken', null)
$$;

-- Special conditions and attack effects go away (retreat, evolution)
create or replace function public.pvp_cleared(p_slot jsonb)
returns jsonb
language sql
immutable
as $$
  select p_slot || jsonb_build_object('status', null, 'status_turn', null, 'poisoned', false, 'burned', false,
    'lock_attack', null, 'no_retreat', null, 'reduce', null, 'prevent', null, 'smoke', null, 'weaken', null)
$$;

-- Removes one copy of a card index from a side's hand
create or replace function public.pvp_take_from_hand(p_g jsonb, p_side text, p_card int)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_g, array[p_side, 'hand'], coalesce((
    select jsonb_agg(h order by n) from jsonb_array_elements(p_g->p_side->'hand') with ordinality x(h, n)
    where n <> (select min(n2) from jsonb_array_elements(p_g->p_side->'hand') with ordinality y(h2, n2) where h2 = to_jsonb(p_card))), '[]'))
$$;

create or replace function public.pvp_draw(p_g jsonb, p_side text, p_count int)
returns jsonb
language plpgsql
immutable
as $$
declare
  g jsonb := p_g;
  v_drawn jsonb := '[]';
begin
  for i in 1..greatest(p_count, 0) loop
    exit when jsonb_array_length(g->p_side->'deck') = 0;
    v_drawn := v_drawn || jsonb_build_array(g->p_side->'deck'->0);
    g := jsonb_set(g, array[p_side, 'hand'], (g->p_side->'hand') || jsonb_build_array(g->p_side->'deck'->0));
    g := jsonb_set(g, array[p_side, 'deck'], (g->p_side->'deck') - 0);
  end loop;
  return public.pvp_ev(g, jsonb_build_object('k', 'draw', 's', p_side, 'cards', v_drawn));
end;
$$;

-- A side at the start: deck shuffled, 5 cards in hand with at least 1 Basic
create or replace function public.pvp_new_side(p_cards jsonb)
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
    'active', null, 'bench', '[]'::jsonb, 'points', 0, 'attached', false, 'retreated', false, 'used_once', false);
end;
$$;

-- Knock outs (both sides), points, who has to promote, the winner
create or replace function public.pvp_ko(p_g jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  g jsonb := p_g;
  v_side text;
  v_slot jsonb;
  v_card jsonb;
  v_rules jsonb := public.pvp_rules();
  v_out jsonb := '{}';
  v_a_wins boolean;
  v_d_wins boolean;
begin
  if g->>'phase' = 'over' then
    return g;
  end if;
  foreach v_side in array array['a', 'd'] loop
    for v_pos in reverse coalesce(jsonb_array_length(g->v_side->'bench'), 0)..0 loop
      v_slot := public.pvp_slot(g, v_side, v_pos);
      continue when v_slot is null or public.pvp_hp_left(g, v_side, v_slot) > 0;
      v_card := public.pvp_top(g, v_side, v_slot);
      g := jsonb_set(g, array[v_side, 'discard'], (g->v_side->'discard') || (v_slot->'under') || jsonb_build_array(v_slot->'c'));
      if v_pos = 0 then
        g := jsonb_set(g, array[v_side, 'active'], 'null');
      else
        g := jsonb_set(g, array[v_side, 'bench'], (g->v_side->'bench') - (v_pos - 1));
      end if;
      g := jsonb_set(g, array[public.pvp_other(v_side), 'points'],
        to_jsonb((g->public.pvp_other(v_side)->>'points')::int + (v_card->>'prizes')::int));
      g := public.pvp_ev(g, jsonb_build_object('k', 'ko', 's', v_side, 'pos', v_pos, 'c', v_slot->'c', 'points', (v_card->>'prizes')::int));
    end loop;
    -- No Active: promote a Benched Pokémon (or nothing left in play)
    if jsonb_typeof(g->v_side->'active') <> 'object' then
      if jsonb_array_length(g->v_side->'bench') > 0 then
        if not coalesce(g->'promote', '[]') ? v_side then
          g := jsonb_set(g, '{promote}', coalesce(g->'promote', '[]') || to_jsonb(v_side));
        end if;
      else
        v_out := v_out || jsonb_build_object(v_side, true);
      end if;
    end if;
  end loop;

  v_a_wins := (g->'a'->>'points')::int >= (v_rules->>'points_to_win')::int or v_out ? 'd';
  v_d_wins := (g->'d'->>'points')::int >= (v_rules->>'points_to_win')::int or v_out ? 'a';
  if v_a_wins or v_d_wins then
    g := g || jsonb_build_object('phase', 'over', 'winner', case
      when v_a_wins and v_d_wins then case
        when (g->'a'->>'points')::int > (g->'d'->>'points')::int then 'a'
        when (g->'a'->>'points')::int < (g->'d'->>'points')::int then 'd'
        else 'draw' end
      when v_a_wins then 'a' else 'd' end);
    g := public.pvp_ev(g, jsonb_build_object('k', 'over', 'winner', g->'winner'));
  end if;
  return g;
end;
$$;

-- Damage on a slot (no Weakness / Resistance: those are for the attack on
-- the Active, in pvp_attack)
create or replace function public.pvp_hurt(p_g jsonb, p_side text, p_pos int, p_damage int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_slot jsonb := public.pvp_slot(p_g, p_side, p_pos);
begin
  if v_slot is null or p_damage <= 0 then
    return p_g;
  end if;
  return public.pvp_ev(public.pvp_set(p_g, p_side, p_pos, 'damage', to_jsonb((v_slot->>'damage')::int + p_damage)),
    jsonb_build_object('k', 'damage', 's', p_side, 'pos', p_pos, 'c', v_slot->'c', 'n', p_damage));
end;
$$;

create or replace function public.pvp_heal(p_g jsonb, p_side text, p_pos int, p_amount int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_slot jsonb := public.pvp_slot(p_g, p_side, p_pos);
  v_healed int;
begin
  if v_slot is null then
    return p_g;
  end if;
  v_healed := least(p_amount, (v_slot->>'damage')::int);
  if v_healed <= 0 then
    return p_g;
  end if;
  return public.pvp_ev(public.pvp_set(p_g, p_side, p_pos, 'damage', to_jsonb((v_slot->>'damage')::int - v_healed)),
    jsonb_build_object('k', 'heal', 's', p_side, 'pos', p_pos, 'c', v_slot->'c', 'n', v_healed));
end;
$$;

-- Active <-> a Benched Pokémon; the one going to the Bench is cured
create or replace function public.pvp_switch(p_g jsonb, p_side text, p_pos int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_active jsonb := public.pvp_slot(p_g, p_side, 0);
  v_bench jsonb := public.pvp_slot(p_g, p_side, p_pos);
  g jsonb := p_g;
begin
  if v_active is null or v_bench is null or p_pos < 1 then
    return p_g;
  end if;
  g := jsonb_set(g, array[p_side, 'active'], v_bench);
  g := jsonb_set(g, array[p_side, 'bench', (p_pos - 1)::text], public.pvp_cleared(v_active));
  return public.pvp_ev(g, jsonb_build_object('k', 'switch', 's', p_side, 'pos', p_pos, 'c', v_bench->'c'));
end;
$$;

-- A Benched Pokémon becomes the Active (after a knock out)
create or replace function public.pvp_promote(p_g jsonb, p_side text, p_pos int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_slot jsonb := public.pvp_slot(p_g, p_side, p_pos);
  g jsonb := p_g;
begin
  if v_slot is null or p_pos < 1 or jsonb_typeof(g->p_side->'active') = 'object' then
    raise exception 'pvp_invalid_action';
  end if;
  g := jsonb_set(g, array[p_side, 'active'], v_slot);
  g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') - (p_pos - 1));
  g := jsonb_set(g, '{promote}', coalesce(g->'promote', '[]') - p_side);
  return public.pvp_ev(g, jsonb_build_object('k', 'promote', 's', p_side, 'c', v_slot->'c'));
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
  elsif (v_attack->>'cost')::int > (v_slot->>'energy')::int then
    return 'energy';
  elsif (p_g->p_side->>'used_once')::boolean and v_attack->'fx' @> '[{"op": "once"}]' then
    return 'once';
  end if;
  return null;
end;
$$;

-- Whether a coin-dependent op happens
create or replace function public.pvp_cond(p_op jsonb, p_heads boolean)
returns boolean
language sql
immutable
as $$
  select case p_op->>'if' when 'heads' then coalesce(p_heads, false) when 'tails' then not coalesce(p_heads, true) else true end
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
                     where (a->>'usable')::boolean and (a->>'cost')::int <= (s.slot->>'energy')::int), 0)
           + public.pvp_hp_left(p_g, p_side, s.slot) / 2 desc, p.pos
  limit 1
$$;

-- AI: the opponent's position with the fewest HP left (optionally the Active too)
create or replace function public.pvp_ai_weakest(p_g jsonb, p_side text, p_with_active boolean)
returns int
language sql
immutable
as $$
  select p.pos
  from public.pvp_positions(p_g, p_side) p(pos)
  where p_with_active or p.pos > 0
  order by public.pvp_hp_left(p_g, p_side, public.pvp_slot(p_g, p_side, p.pos)), p.pos
  limit 1
$$;

-- Applies a special condition to a slot
create or replace function public.pvp_condition(p_g jsonb, p_side text, p_pos int, p_status text)
returns jsonb
language plpgsql
immutable
as $$
declare
  g jsonb := p_g;
begin
  if public.pvp_slot(g, p_side, p_pos) is null then
    return g;
  end if;
  if p_status in ('poisoned', 'burned') then
    g := public.pvp_set(g, p_side, p_pos, p_status, 'true');
  else
    g := public.pvp_set(g, p_side, p_pos, 'status', to_jsonb(p_status));
    g := public.pvp_set(g, p_side, p_pos, 'status_turn', g->'turn');
  end if;
  return public.pvp_ev(g, jsonb_build_object('k', 'status', 's', p_side, 'pos', p_pos, 'c', public.pvp_slot(g, p_side, p_pos)->'c', 'status', p_status));
end;
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
        g := public.pvp_set(g, p_side, 0, 'energy', to_jsonb(case when v_op->>'n' = 'all' then 0
          else greatest((public.pvp_slot(g, p_side, 0)->>'energy')::int - v_n, 0) end));
      when 'discard_opp' then
        if public.pvp_slot(g, v_foe, 0) is not null and not v_prevented then
          g := public.pvp_set(g, v_foe, 0, 'energy', to_jsonb(greatest((public.pvp_slot(g, v_foe, 0)->>'energy')::int - v_n, 0)));
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
          g := public.pvp_set(g, p_side, 0, 'energy', to_jsonb((public.pvp_slot(g, p_side, 0)->>'energy')::int - 1));
          g := public.pvp_set(g, p_side, v_pos, 'energy', to_jsonb((public.pvp_slot(g, p_side, v_pos)->>'energy')::int + 1));
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
    if (g->p_side->>'attached')::boolean or v_turn = 1 then
      raise exception 'pvp_no_energy';
    end if;
    g := public.pvp_set(g, p_side, v_pos, 'energy', to_jsonb((v_slot->>'energy')::int + 1));
    g := jsonb_set(g, array[p_side, 'attached'], 'true');
    return public.pvp_ev(g, jsonb_build_object('k', 'attach', 's', p_side, 'pos', v_pos, 'c', v_slot->'c'));

  elsif v_type = 'retreat' then
    v_slot := public.pvp_slot(g, p_side, 0);
    if v_slot is null or v_pos is null or v_pos < 1 or public.pvp_slot(g, p_side, v_pos) is null then
      raise exception 'pvp_invalid_action';
    end if;
    if (g->p_side->>'retreated')::boolean or v_slot->>'status' in ('asleep', 'paralyzed') or (v_slot->>'no_retreat')::int = v_turn
       or (v_slot->>'energy')::int < (public.pvp_top(g, p_side, v_slot)->>'retreat')::int then
      raise exception 'pvp_cannot_retreat';
    end if;
    g := public.pvp_set(g, p_side, 0, 'energy', to_jsonb((v_slot->>'energy')::int - (public.pvp_top(g, p_side, v_slot)->>'retreat')::int));
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

-- Between turns: Poison, Burn, Sleep, Paralysis on both Active Pokémon
create or replace function public.pvp_checkup(p_g jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_side text;
  v_slot jsonb;
  v_rules jsonb := public.pvp_rules();
begin
  foreach v_side in array array['a', 'd'] loop
    v_slot := public.pvp_slot(g, v_side, 0);
    continue when v_slot is null;
    if (v_slot->>'poisoned')::boolean then
      g := public.pvp_hurt(g, v_side, 0, (v_rules->>'poison')::int);
    end if;
    if (v_slot->>'burned')::boolean then
      g := public.pvp_hurt(g, v_side, 0, (v_rules->>'burn')::int);
      if public.pvp_flip() then
        g := public.pvp_ev(public.pvp_set(g, v_side, 0, 'burned', 'false'), jsonb_build_object('k', 'cured', 's', v_side, 'c', v_slot->'c', 'status', 'burned'));
      end if;
    end if;
    if v_slot->>'status' = 'asleep' and public.pvp_flip() then
      g := public.pvp_ev(public.pvp_set(g, v_side, 0, 'status', null), jsonb_build_object('k', 'cured', 's', v_side, 'c', v_slot->'c', 'status', 'asleep'));
    elsif v_slot->>'status' = 'paralyzed' and (v_slot->>'status_turn')::int < (g->>'turn')::int then
      g := public.pvp_ev(public.pvp_set(g, v_side, 0, 'status', null), jsonb_build_object('k', 'cured', 's', v_side, 'c', v_slot->'c', 'status', 'paralyzed'));
    end if;
  end loop;
  return public.pvp_ko(g);
end;
$$;

-- ---------- 5. The AI ----------

set local application_name = 'migration 0030: step 5/6 AI';

-- How good an attack of my Active looks right now (expected damage on the
-- opponent's Active, a knock out above all)
create or replace function public.pvp_ai_attack_value(p_g jsonb, p_side text, p_attack int)
returns numeric
language plpgsql
immutable
as $$
declare
  v_foe text := public.pvp_other(p_side);
  v_me jsonb := public.pvp_slot(p_g, p_side, 0);
  v_card jsonb := public.pvp_top(p_g, p_side, v_me);
  v_attack jsonb := v_card->'attacks'->p_attack;
  v_them jsonb := public.pvp_slot(p_g, v_foe, 0);
  v_target jsonb;
  v_coins numeric := case when jsonb_typeof(v_attack->'coins') = 'number' then (v_attack->>'coins')::numeric
                          when v_attack->'coins' = '"until"'::jsonb then 1 else 0 end;
  v_damage numeric := (v_attack->>'base')::int;
  v_bonus numeric := 0;
  v_op jsonb;
  v_n numeric;
  v_odds numeric;
begin
  for v_op in select * from jsonb_array_elements(v_attack->'fx') loop
    v_n := case when jsonb_typeof(v_op->'n') = 'number' then (v_op->>'n')::numeric else 0 end;
    v_odds := case when v_op ? 'if' then 0.5 else 1 end;
    case v_op->>'op'
      when 'times' then v_damage := v_damage + v_n * v_coins / 2;
      when 'plus_heads' then v_damage := v_damage + v_n * v_coins / 2;
      when 'plus' then v_damage := v_damage + v_n * v_odds;
      when 'nothing' then v_damage := v_damage / 2;
      when 'per_energy_self' then v_damage := v_damage + v_n * (v_me->>'energy')::int;
      when 'per_counter_self' then v_damage := v_damage + v_n * ((v_me->>'damage')::int / 10);
      when 'if_damaged_self' then v_damage := v_damage + case when (v_me->>'damage')::int > 0 then v_n else 0 end;
      when 'status' then v_bonus := v_bonus + 15 * v_odds;
      when 'heal_self' then v_bonus := v_bonus + least(v_n, (v_me->>'damage')::int) / 2;
      when 'self_damage' then v_bonus := v_bonus - case when v_n >= public.pvp_hp_left(p_g, p_side, v_me) then 200 else v_n / 2 end;
      when 'discard_self' then v_bonus := v_bonus - 10 * case when v_op->>'n' = 'all' then (v_me->>'energy')::int else v_n end;
      when 'bench_one' then v_bonus := v_bonus + v_n * 0.6;
      when 'bench_each' then v_bonus := v_bonus + v_n * 0.5 * jsonb_array_length(p_g->v_foe->'bench');
      when 'draw' then v_bonus := v_bonus + 5 * v_n;
      else null;
    end case;
  end loop;
  if v_them is not null then
    v_target := public.pvp_top(p_g, v_foe, v_them);
    if v_damage > 0 and exists (select 1 from jsonb_array_elements_text(v_card->'types') t where v_target->'weaknesses' ? t) then
      v_damage := v_damage * 2;
    end if;
    if v_damage > 0 and exists (select 1 from jsonb_array_elements_text(v_card->'types') t where v_target->'resistances' ? t) then
      v_damage := greatest(v_damage - 30, 0);
    end if;
    if v_damage >= public.pvp_hp_left(p_g, v_foe, v_them) then
      v_bonus := v_bonus + 500 + 100 * (v_target->>'prizes')::int;
    end if;
  end if;
  return v_damage + v_bonus;
end;
$$;

-- Setup: the sturdiest Basic as Active, the other Basics on the Bench
create or replace function public.pvp_ai_setup(p_g jsonb, p_side text, p_level text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_basics int[];
  v_card int;
begin
  select array_agg(h order by case when p_level = 'easy' then random()
    else -((g->p_side->'cards'->h->>'hp')::numeric
           + coalesce((select max((a->>'base')::int) from jsonb_array_elements(g->p_side->'cards'->h->'attacks') a where (a->>'cost')::int <= 2), 0)) end)
  into v_basics
  from (select (x #>> '{}')::int as h from jsonb_array_elements(g->p_side->'hand') x) hand
  where g->p_side->'cards'->h->>'stage' = 'basic';
  g := public.pvp_take_from_hand(g, p_side, v_basics[1]);
  g := jsonb_set(g, array[p_side, 'active'], public.pvp_new_slot(v_basics[1], 0));
  foreach v_card in array coalesce(v_basics[2:(1 + (public.pvp_rules()->>'bench_size')::int)], '{}') loop
    g := public.pvp_take_from_hand(g, p_side, v_card);
    g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') || jsonb_build_array(public.pvp_new_slot(v_card, 0)));
  end loop;
  return g;
end;
$$;

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
                   where (a->>'usable')::boolean and (a->>'cost')::int <= (public.pvp_slot(g, p_side, v_pos)->>'energy')::int)
       and (not exists (select 1 from jsonb_array_elements(public.pvp_top(g, p_side, v_slot)->'attacks') a
                        where (a->>'usable')::boolean and (a->>'cost')::int <= (v_slot->>'energy')::int + 1)
            or (p_level = 'hard' and public.pvp_hp_left(g, p_side, v_slot) * 3 < (public.pvp_top(g, p_side, v_slot)->>'hp')::int)) then
      g := public.pvp_do(g, p_side, jsonb_build_object('type', 'retreat', 'pos', v_pos));
    end if;
  end if;

  -- 4. Energy: the Active until its best attack is paid, else the Benched
  -- Pokémon closest to paying its best attack
  if v_turn > 1 and not (g->p_side->>'attached')::boolean then
    if v_easy and random() < 0.4 then
      select p into v_pos from public.pvp_positions(g, p_side) p order by random() limit 1;
    else
      select p into v_pos from public.pvp_positions(g, p_side) p
      cross join lateral (select public.pvp_slot(g, p_side, p) as slot) s
      cross join lateral (select coalesce(max((a->>'cost')::int), 0) as cost from jsonb_array_elements(public.pvp_top(g, p_side, s.slot)->'attacks') a
                          where (a->>'usable')::boolean) need
      where need.cost > (s.slot->>'energy')::int
      order by p = 0 desc, need.cost - (s.slot->>'energy')::int, p
      limit 1;
      -- everyone is paid: the Active (bigger attacks may come with an evolution)
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

-- A new game: both sides dealt, the server's side set up, a coin for who
-- goes first; the attacker ('a') sets up next (pvp_act setup).
create or replace function public.pvp_game_new(p_mine jsonb, p_theirs jsonb, p_level text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb;
begin
  g := jsonb_build_object('turn', 0, 'phase', 'setup', 'stage', 'setup', 'current', null,
    'first', case when public.pvp_flip() then 'a' else 'd' end, 'level', p_level, 'promote', '[]'::jsonb, 'winner', null,
    'events', '[]'::jsonb, 'a', public.pvp_new_side(p_mine), 'd', public.pvp_new_side(p_theirs));
  return public.pvp_ai_setup(g, 'd', p_level);
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
        g := g || jsonb_build_object('stage', 'play', 'phase', 'play');
      when 'play' then
        if g->>'current' = 'a' then
          return g || jsonb_build_object('phase', 'play');
        end if;
        g := public.pvp_ai_turn(g || jsonb_build_object('phase', 'play'), 'd', g->>'level');
      when 'end' then
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
    'attach', v_my_turn and v_turn > 1 and not (p_g->'a'->>'attached')::boolean,
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

-- ---------- 6. RPCs ----------

set local application_name = 'migration 0030: step 6/6 RPCs';

-- A slot as the client sees it: its card (and the ones under it) + HP left
create or replace function public.pvp_slot_view(p_g jsonb, p_side text, p_slot jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p_slot is null then null else p_slot || jsonb_build_object(
    'card', public.pvp_top(p_g, p_side, p_slot),
    'hp_left', public.pvp_hp_left(p_g, p_side, p_slot)) end
$$;

-- Events with the names the log shows: the card (`c`) and the attack (`i`),
-- in English and French
create or replace function public.pvp_named_events(p_g jsonb, p_events jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(e || case when e ? 'c' and e->>'s' in ('a', 'd') then jsonb_strip_nulls(jsonb_build_object(
      'name', p_g->(e->>'s')->'cards'->((e->>'c')::int)->>'name',
      'name_fr', p_g->(e->>'s')->'cards'->((e->>'c')::int)->>'name_fr',
      'attack', case when e ? 'i' then p_g->(e->>'s')->'cards'->((e->>'c')::int)->'attacks'->((e->>'i')::int)->>'name' end,
      'attack_fr', case when e ? 'i' then p_g->(e->>'s')->'cards'->((e->>'c')::int)->'attacks'->((e->>'i')::int)->>'name_fr' end))
    else '{}'::jsonb end order by n), '[]')
  from jsonb_array_elements(coalesce(p_events, '[]')) with ordinality x(e, n)
$$;

-- Events as the attacker may see them: the defender's draws without the cards
create or replace function public.pvp_public_events(p_events jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(case when e->>'k' = 'draw' and e->>'s' = 'd'
    then (e - 'cards') || jsonb_build_object('n', jsonb_array_length(e->'cards')) else e end order by n), '[]')
  from jsonb_array_elements(coalesce(p_events, '[]')) with ordinality x(e, n)
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
      'used_once', (g->v_side->>'used_once')::boolean));
  end loop;

  return jsonb_build_object(
    'id', p_battle.id,
    'engine', 2,
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

-- My cards that can be in a deck of that format, with the copies I own
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
  if not public.pvp_open_to(v_user) then
    raise exception 'pvp_closed';
  end if;
  if not public.pvp_valid_format(p_format) then
    raise exception 'pvp_invalid_format';
  end if;
  return coalesce((
    select jsonb_agg(x.card || jsonb_build_object('owned', x.quantity)
                     order by x.card->>'stage' = 'basic' desc, (x.card->>'hp')::int desc, x.card->>'name')
    from (select public.pvp_card(c.card_id) as card, c.quantity
          from public.collections c
          where c.user_id = v_user and c.mode = 'challenge' and public.pvp_fits(c.card_id, p_format)) x
    where x.card is not null and x.card->>'stage' <> 'none'), '[]');
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
    -- a card sync that stored the attack effects (0029) must have run
    'ready', exists (select 1 from public.cards c where c.attacks -> 0 ? 'fx')
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
    -- { format: { attack: { ids, valid }, defense: { ids, valid } } }, a missing role = not saved
    'decks', coalesce((
      select jsonb_object_agg(f.format, f.roles)
      from (
        select d.format, jsonb_object_agg(d.role, jsonb_build_object(
          'ids', to_jsonb(d.card_ids),
          'valid', public.pvp_deck_cards(v_user, d.format, d.card_ids) is not null)) as roles
        from public.pvp_decks d where d.user_id = v_user
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

create or replace function public.pvp_save_deck(p_format text, p_cards text[], p_role text default 'attack')
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
  insert into public.pvp_decks (user_id, format, role, card_ids) values (v_user, p_format, p_role, p_cards)
  on conflict (user_id, format, role) do update set card_ids = excluded.card_ids, updated_at = now();
  perform public.pvp_rating(v_user, p_format);
  return public.pvp_state();
end;
$$;

-- My attack deck in a format (snapshots), or an error
create or replace function public.pvp_attack_deck(p_user uuid, p_format text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_deck public.pvp_decks;
  v_cards jsonb;
begin
  select * into v_deck from public.pvp_decks d where d.user_id = p_user and d.format = p_format and d.role = 'attack';
  if not found then
    raise exception 'pvp_no_deck';
  end if;
  v_cards := public.pvp_deck_cards(p_user, p_format, v_deck.card_ids);
  if v_cards is null then
    raise exception 'pvp_invalid_deck';
  end if;
  return v_cards;
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
  select f.user_id, f.cards into v_foe
  from (
    select v.user_id, v.cards, v.user_id = v_last as again
    from (
      select distinct on (d.user_id) d.user_id, x.cards
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

  v_game := public.pvp_game_new(v_mine, v_foe.cards, 'hard');
  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, engine, game, log)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards, '{}', '{}', 2, v_game - 'events', '[]');

  return public.pvp_state();
end;
$$;

-- A bot's deck in a format: 20 cards in evolution lines like a player's
-- (a Stage 2 line, Stage 1 lines, Basics; 2 copies each), or null if the
-- format can't fill one. The level picks stronger cards (autoDeck scores).
create or replace function public.pvp_bot_deck(p_format text, p_level text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_size int := (public.pvp_rules()->>'deck_size')::int;
  v_target numeric := case p_level when 'easy' then 0.25 when 'normal' then 0.55 else 0.95 end;
  v_deck jsonb := '[]';
  v_names text[] := '{}';
  v_line record;
  v_card jsonb;
  v_pick jsonb;
  v_stage2_lines int := 0;
  v_stage1_lines int := 0;
begin
  create temp table if not exists pvp_bot_pool (card jsonb, name text, stage text, evolves_from text, score numeric) on commit drop;
  truncate pvp_bot_pool;
  insert into pvp_bot_pool
  select x.card, x.card->>'name', x.card->>'stage', x.card->>'evolves_from', 0
  from (
    select public.pvp_card(c.id) as card
    from public.cards c
    join public.sets s on s.id = c.set_id
    where c.supertype = 'Pokémon' and c.hp > 0 and case
      when p_format = 'all' then true
      when p_format like 'era:%' then s.series = substring(p_format from 5)
      when p_format like 'set:%' then coalesce(s.parent_set_id, s.id) = substring(p_format from 5)
      else false end
    order by random()
    limit 1500
  ) x
  where x.card is not null and x.card->>'stage' <> 'none'
    and exists (select 1 from jsonb_array_elements(x.card->'attacks') a where (a->>'usable')::boolean);
  -- Score like autoDeck(): damage per energy, best hit, HP per point; as a
  -- percentile, so the level picks a place in the ranking
  update pvp_bot_pool p set score = r.pct
  from (
    select q.card->>'id' as id, percent_rank() over (order by st.value) as pct
    from pvp_bot_pool q
    cross join lateral (
      select coalesce(max((a->>'base')::numeric / greatest((a->>'cost')::int, 1)), 0)
             + 0.5 * coalesce(max((a->>'base')::numeric), 0) / 10
             + 0.7 * (q.card->>'hp')::numeric / greatest((q.card->>'prizes')::int, 1) / 20 as value
      from jsonb_array_elements(q.card->'attacks') a where (a->>'usable')::boolean
    ) st
  ) r
  where p.card->>'id' = r.id;

  -- Lines: a Stage 2 one, then Stage 1 ones, then Basics, closest to the level first
  for v_line in
    select l.cards from (
      -- Basic -> Stage 1 -> Stage 2
      select jsonb_build_array(b.card, s1.card, s2.card) as cards, 1 as kind, abs((b.score + s1.score + s2.score) / 3 - v_target) as gap
      from pvp_bot_pool s2
      join pvp_bot_pool s1 on s1.name = s2.evolves_from and s1.stage = 'evolution'
      join pvp_bot_pool b on b.name = s1.evolves_from and b.stage = 'basic'
      where s2.stage = 'evolution'
      union all
      select jsonb_build_array(b.card, s1.card), 2, abs((b.score + s1.score) / 2 - v_target)
      from pvp_bot_pool s1
      join pvp_bot_pool b on b.name = s1.evolves_from and b.stage = 'basic'
      where s1.stage = 'evolution'
      union all
      select jsonb_build_array(b.card), 3, abs(b.score - v_target) from pvp_bot_pool b where b.stage = 'basic'
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
  -- A format too small for 10 different names: one copy fills the rest
  if jsonb_array_length(v_deck) < v_size then
    for v_pick in select p.card from pvp_bot_pool p where p.stage = 'basic' order by abs(p.score - v_target) loop
      continue when (select count(*) from jsonb_array_elements(v_deck) c where c->>'name' = v_pick->>'name') >= 2;
      v_deck := v_deck || jsonb_build_array(v_pick);
      exit when jsonb_array_length(v_deck) >= v_size;
    end loop;
  end if;
  if jsonb_array_length(v_deck) < v_size then
    return null;
  end if;
  return v_deck;
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
  v_bot := public.pvp_bot_deck(p_format, p_level);
  if v_bot is null then
    raise exception 'pvp_no_bot_deck';
  end if;

  v_game := public.pvp_game_new(v_mine, v_bot, p_level);
  insert into public.pvp_battles (attacker, defender, bot, paid, format, a_deck, d_deck, a_hp, d_hp, engine, game, log)
  values (v_user, null, p_level, v_today < (v_rules->>'bot_paid_per_day')::int, p_format, v_mine, v_bot, '{}', '{}', 2,
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
  if v_b.engine <> 2 or v_b.game is null then
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
revoke execute on function public.pvp_card(text) from public, anon, authenticated;
revoke execute on function public.pvp_deck_cards(uuid, text, text[]) from public, anon, authenticated;
revoke execute on function public.pvp_flip() from public, anon, authenticated;
revoke execute on function public.pvp_other(text) from public, anon, authenticated;
revoke execute on function public.pvp_path(text, int) from public, anon, authenticated;
revoke execute on function public.pvp_slot(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_top(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_hp_left(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_positions(jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_set(jsonb, text, int, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_ev(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_new_slot(int, int) from public, anon, authenticated;
revoke execute on function public.pvp_cleared(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_take_from_hand(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_draw(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_new_side(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_ko(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_hurt(jsonb, text, int, int) from public, anon, authenticated;
revoke execute on function public.pvp_heal(jsonb, text, int, int) from public, anon, authenticated;
revoke execute on function public.pvp_switch(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_promote(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_attack_block(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_cond(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.pvp_ai_bench_pick(jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_ai_weakest(jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public.pvp_condition(jsonb, text, int, text) from public, anon, authenticated;
revoke execute on function public.pvp_attack(jsonb, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_do(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_checkup(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_ai_attack_value(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_ai_setup(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.pvp_ai_turn(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.pvp_game_new(jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_run(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_hints(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_slot_view(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_public_events(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_named_events(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_battle_view(public.pvp_battles) from public, anon, authenticated;
revoke execute on function public.pvp_attack_deck(uuid, text) from public, anon, authenticated;
revoke execute on function public.pvp_bot_deck(text, text) from public, anon, authenticated;
-- Players
revoke execute on function public.pvp_eligible(text) from public, anon;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_save_deck(text, text[], text) from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
revoke execute on function public.pvp_bot_start(text, text) from public, anon;
revoke execute on function public.pvp_act(jsonb) from public, anon;
grant execute on function public.pvp_eligible(text) to authenticated;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_save_deck(text, text[], text) to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
grant execute on function public.pvp_bot_start(text, text) to authenticated;
grant execute on function public.pvp_act(jsonb) to authenticated;

set local application_name = 'migration 0030: done, committing';
