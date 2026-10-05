-- Pokémon Booster Game — Challenge: Pokémon abilities in PvP, like Pokémon TCG Pocket
-- Run after 0032_pvp_trainers.sql, then let a card sync run (it stores what
-- each ability does: cards.abilities[i].kind / fx / playable).
--
-- User, 2026-10-05: "ajoute les talents stp".
--
-- src/utils/abilityEffects.js reads each ability's English text at import
-- (Abilities, Poké-Powers, Poké-Bodies, Pokémon Powers): playable only when
-- the whole text is understood (489 of 4,106 on 2026-10-05, 187 names). Kinds:
--   - active ("Once during your turn, you may ..."): I use it from the board,
--     once a turn per Pokémon (or as often as I like), some only from the
--     Active Spot or the Bench, some not under a Special Condition, VSTAR
--     Powers once a game; pvp_act({ type: 'ability', at, ability, ... the
--     Trainers' choices: pos/to/target/discard/pick }).
--   - passive: always on, like a Tool (less damage, more damage, no retreat
--     cost, damage back, no Weakness, no Special Conditions, Bench
--     protection, Sturdy, evolving on the first turn, Basics without retreat
--     cost).
--   - on_bench / on_evolve: played as I put the Pokémon on my Bench / evolve
--     with it from my hand ("you may": always, the server picks the choices).
-- Their effects are the Trainers' (draw, search, heal, gust, switch...) plus
-- damage counters, switching in from the Bench, self knock out.
--
-- 1. pvp_card(): abilities carry kind, fx, coins, playable, active_only,
--    bench_only, many.
-- 2. pvp_effects(): the effect engine, shared by pvp_trainer() and
--    pvp_ability(); pvp_trigger() for on_bench / on_evolve.
-- 3. Passive abilities count with the Tools (pvp_tool_n: tool_x + body_x).
-- 4. Hints: hints.abilities[pos][i] = null (usable) or why not; the AI uses
--    its abilities.
--
-- Battles in progress go on.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Cards ----------

set local application_name = 'migration 0033: step 1/4 cards';

-- A card as a battle sees it: a Pokémon with HP, a playable Trainer (0032:
-- pvp_trainer_card), or null.
-- base_name (0032): for a Stage 2, the Basic of its line (Rare Candy).
-- abilities (0033): { name, text, name_fr, text_fr, kind, fx, coins, playable, active_only, bench_only, many }.
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
    'base_name', (select e.evolves_from from public.cards e
                  where c.evolves_from is not null and e.name = c.evolves_from and e.supertype = 'Pokémon' and e.evolves_from is not null
                  limit 1),
    'retreat', coalesce(c.retreat_cost, 0),
    'attacks', coalesce(a.attacks, '[]'),
    'abilities', coalesce((
      select jsonb_agg(jsonb_build_object('name', y->>'name', 'text', y->>'text',
               'name_fr', c.abilities_fr->(n::int - 1)->>'name', 'text_fr', c.abilities_fr->(n::int - 1)->>'effect',
               -- what the battles play of it (0033, abilityEffects.js)
               'kind', y->>'kind', 'fx', case when jsonb_typeof(y->'fx') = 'array' then y->'fx' else '[]' end,
               'coins', y->'coins', 'playable', coalesce((y->>'playable')::boolean, false),
               'active_only', coalesce((y->>'active_only')::boolean, false), 'bench_only', coalesce((y->>'bench_only')::boolean, false),
               'many', coalesce((y->>'many')::boolean, false)) order by n)
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
  union all
  select public.pvp_trainer_card(p_id) where public.pvp_trainer_card(p_id) is not null
$$;

-- ---------- 2. Passive abilities, with the Tools ----------

set local application_name = 'migration 0033: step 2/4 passive';

-- The sum of one mod on a slot ('all' = 999): its Tool's tool_x ops and its
-- passive abilities' body_x ops (0033)
create or replace function public.pvp_tool_n(p_g jsonb, p_side text, p_slot jsonb, p_op text)
returns int
language sql
immutable
as $$
  select coalesce(sum(case when o->>'n' = 'all' then 999 when jsonb_typeof(o->'n') = 'number' then (o->>'n')::int else 1 end), 0)::int
  from (
    select o from jsonb_array_elements(coalesce(public.pvp_tool(p_g, p_side, p_slot)->'fx', '[]')) o
    where o->>'op' = p_op
    union all
    select o
    from jsonb_array_elements(coalesce(public.pvp_top(p_g, p_side, p_slot)->'abilities', '[]')) a,
         jsonb_array_elements(coalesce(a->'fx', '[]')) o
    where p_slot is not null and a->>'kind' = 'passive' and coalesce((a->>'playable')::boolean, false)
      and o->>'op' = 'body_' || substring(p_op from 6)
  ) x
$$;

-- Whether one of a side's Pokémon in play has a passive ability op (team-wide effects)
create or replace function public.pvp_team_has(p_g jsonb, p_side text, p_op text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1 from public.pvp_positions(p_g, p_side) p
    cross join lateral jsonb_array_elements(coalesce(public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p))->'abilities', '[]')) a
    cross join lateral jsonb_array_elements(coalesce(a->'fx', '[]')) o
    where a->>'kind' = 'passive' and coalesce((a->>'playable')::boolean, false) and o->>'op' = p_op)
$$;

-- A position's retreat cost now: printed, minus its Tool, minus this turn's
-- Trainers for the Active (0032), minus team abilities (0033)
create or replace function public.pvp_retreat_cost(p_g jsonb, p_side text, p_pos int)
returns int
language sql
immutable
as $$
  select greatest((public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p_pos))->>'retreat')::int
    - public.pvp_tool_n(p_g, p_side, public.pvp_slot(p_g, p_side, p_pos), 'tool_retreat')
    - case when p_pos = 0 and (p_g->p_side->'retreat_less'->>'turn')::int = (p_g->>'turn')::int
           then (p_g->p_side->'retreat_less'->>'n')::int else 0 end
    -- "Your Basic Pokémon in play have no Retreat Cost" (0033)
    - case when public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p_pos))->>'stage' = 'basic'
                and public.pvp_team_has(p_g, p_side, 'body_team_basic_retreat') then 999 else 0 end, 0)
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
  -- "As long as this Pokémon is on your Bench, prevent all damage done to it by attacks" (0033)
  if p_pos > 0 and public.pvp_tool_n(p_g, p_side, v_slot, 'tool_bench_protect') > 0 then
    return p_g;
  end if;
  return public.pvp_ev(public.pvp_set(p_g, p_side, p_pos, 'damage', to_jsonb((v_slot->>'damage')::int + p_damage)),
    jsonb_build_object('k', 'damage', 's', p_side, 'pos', p_pos, 'c', v_slot->'c', 'n', p_damage));
end;
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
  if public.pvp_slot(g, p_side, p_pos) is null
     -- "can't be affected by any Special Conditions" (0033)
     or public.pvp_tool_n(g, p_side, public.pvp_slot(g, p_side, p_pos), 'tool_no_status') > 0 then
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

-- ---------- 3. Effects, Trainers, abilities ----------

set local application_name = 'migration 0033: step 3/4 effects';

-- The effect engine (0033, taken out of 0032's pvp_trainer): a cost, coins,
-- then each op of p_fx (trainerEffects.js / abilityEffects.js) for p_side,
-- then knock outs and the end of the turn if an op says so. p_self = the
-- Pokémon whose ability it is (null for a Trainer); p_event = the log line
-- ('trainer' / 'ability'), sent with the coins' results.
create or replace function public.pvp_effects(p_g jsonb, p_side text, p_fx jsonb, p_coins jsonb, p_opts jsonb, p_self int, p_event jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_foe text := public.pvp_other(p_side);
  v_turn int := (g->>'turn')::int;
  v_op jsonb;
  v_n int;
  v_pos int;
  v_to int;
  v_c int;
  v_slot jsonb;
  v_flips jsonb := '[]';
  v_heads int := 0;
  v_up boolean;
  v_healed int;
  v_healed_n int := 0;
  v_picks jsonb := case when jsonb_typeof(p_opts->'pick') = 'array' then p_opts->'pick' end;
  v_used jsonb := '[]';
  v_found jsonb;
  v_list jsonb;
  v_end boolean := false;
  v_side text;
  v_type text;
begin
  -- The cost: cards of my hand to the discard pile
  for v_op in select o from jsonb_array_elements(p_fx) o where o->>'op' = 'discard_cost' loop
    v_n := (v_op->>'n')::int;
    if jsonb_typeof(p_opts->'discard') = 'array' then
      if jsonb_array_length(p_opts->'discard') <> v_n then
        raise exception 'pvp_invalid_action';
      end if;
      v_list := p_opts->'discard';
    else
      select coalesce(jsonb_agg(h), '[]') into v_list from (
        select h from jsonb_array_elements(g->p_side->'hand') h
        order by public.pvp_ai_keep(g, p_side, (h #>> '{}')::int) limit v_n) x;
    end if;
    for v_c in select (x #>> '{}')::int from jsonb_array_elements(v_list) x loop
      if not (g->p_side->'hand' @> to_jsonb(array[v_c])) then
        raise exception 'pvp_invalid_action';
      end if;
      g := public.pvp_take_from_hand(g, p_side, v_c);
      g := jsonb_set(g, array[p_side, 'discard'], (g->p_side->'discard') || to_jsonb(v_c));
    end loop;
  end loop;

  -- Coins
  if jsonb_typeof(p_coins) = 'number' then
    for i in 1..least(((p_coins #>> '{}'))::int, 10) loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      v_heads := v_heads + v_up::int;
    end loop;
    v_up := v_heads > 0;
  elsif p_coins = '"until"'::jsonb then
    for i in 1..10 loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      exit when not v_up;
      v_heads := v_heads + 1;
    end loop;
    v_up := v_heads > 0;
  end if;
  g := public.pvp_ev(g, p_event || jsonb_build_object('flips', v_flips));

  for v_op in select * from jsonb_array_elements(p_fx) loop
    continue when v_op->>'if' = 'heads' and not coalesce(v_up, false);
    v_n := case when jsonb_typeof(v_op->'n') = 'number' then (v_op->>'n')::int end;
    case v_op->>'op'
      when 'draw' then
        g := public.pvp_draw(g, p_side, v_n);
      when 'draw_heads' then
        g := public.pvp_draw(g, p_side, v_heads);
      when 'draw_until' then
        g := public.pvp_draw(g, p_side, greatest(case when v_op ? 'first' and v_turn <= 2 then (v_op->>'first')::int else v_n end
          - jsonb_array_length(g->p_side->'hand'), 0));
      when 'discard_hand_draw' then
        g := jsonb_set(g, array[p_side, 'discard'], (g->p_side->'discard') || (g->p_side->'hand'));
        g := jsonb_set(g, array[p_side, 'hand'], '[]');
        g := public.pvp_draw(g, p_side, v_n);
      when 'shuffle_hand_draw', 'opp_shuffle_draw', 'each_shuffle_draw' then
        foreach v_side in array case v_op->>'op' when 'shuffle_hand_draw' then array[p_side] when 'opp_shuffle_draw' then array[v_foe] else array[p_side, v_foe] end loop
          v_c := case when v_op->>'n' = 'opp_hand' then jsonb_array_length(g->v_foe->'hand') else v_n end;
          g := jsonb_set(g, array[v_side, 'deck'], public.pvp_shuffle((g->v_side->'deck') || (g->v_side->'hand')));
          g := jsonb_set(g, array[v_side, 'hand'], '[]');
          g := public.pvp_draw(g, v_side, v_c);
        end loop;
      when 'each_bottom_draw' then
        if jsonb_array_length(g->p_side->'hand') + jsonb_array_length(g->v_foe->'hand') > 0 then
          foreach v_side in array array[p_side, v_foe] loop
            g := jsonb_set(g, array[v_side, 'deck'], (g->v_side->'deck') || public.pvp_shuffle(g->v_side->'hand'));
            g := jsonb_set(g, array[v_side, 'hand'], '[]');
          end loop;
          g := public.pvp_draw(g, p_side, v_n);
          g := public.pvp_draw(g, v_foe, (v_op->>'opp')::int);
        end if;
      when 'search' then
        v_found := '[]';
        for i in 1..coalesce(v_n, 1) loop
          exit when v_op->>'to' = 'bench' and jsonb_array_length(g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int;
          v_c := public.pvp_pick(g, p_side, g->p_side->'deck', v_op, v_picks, v_used);
          exit when v_c is null;
          v_used := v_used || to_jsonb(v_c);
          v_found := v_found || to_jsonb(v_c);
          g := jsonb_set(g, array[p_side, 'deck'], public.pvp_without(g->p_side->'deck', v_c));
          if v_op->>'to' = 'bench' then
            g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') || jsonb_build_array(public.pvp_new_slot(v_c, v_turn)));
          else
            g := jsonb_set(g, array[p_side, 'hand'], (g->p_side->'hand') || to_jsonb(v_c));
          end if;
        end loop;
        g := jsonb_set(g, array[p_side, 'deck'], public.pvp_shuffle(g->p_side->'deck'));
        g := public.pvp_ev(g, jsonb_build_object('k', 'search', 's', p_side, 'cards', v_found, 'to', v_op->>'to'));
      when 'search_top' then
        v_list := coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(g->p_side->'deck') with ordinality d(x, n)
                            where n <= (v_op->>'top')::int), '[]');
        v_found := '[]';
        for i in 1..coalesce(v_n, 1) loop
          v_c := public.pvp_pick(g, p_side, v_list, v_op, null, v_found);
          exit when v_c is null;
          v_found := v_found || to_jsonb(v_c);
          g := jsonb_set(g, array[p_side, 'deck'], public.pvp_without(g->p_side->'deck', v_c));
          g := jsonb_set(g, array[p_side, 'hand'], (g->p_side->'hand') || to_jsonb(v_c));
        end loop;
        if coalesce((v_op->>'discard_rest')::boolean, false) then
          for v_c in select (x #>> '{}')::int from jsonb_array_elements(v_list) x where not (v_found @> jsonb_build_array(x)) loop
            g := jsonb_set(g, array[p_side, 'deck'], public.pvp_without(g->p_side->'deck', v_c));
            g := jsonb_set(g, array[p_side, 'discard'], (g->p_side->'discard') || to_jsonb(v_c));
          end loop;
        end if;
        g := jsonb_set(g, array[p_side, 'deck'], public.pvp_shuffle(g->p_side->'deck'));
        g := public.pvp_ev(g, jsonb_build_object('k', 'search', 's', p_side, 'cards', v_found, 'to', 'hand'));
      when 'recover' then
        v_found := '[]';
        for i in 1..coalesce(v_n, 1) loop
          v_c := public.pvp_pick(g, p_side, g->p_side->'discard', v_op, v_picks, v_used);
          exit when v_c is null;
          v_used := v_used || to_jsonb(v_c);
          v_found := v_found || to_jsonb(v_c);
          g := jsonb_set(g, array[p_side, 'discard'], public.pvp_without(g->p_side->'discard', v_c));
          g := jsonb_set(g, array[p_side, case when v_op->>'to' = 'deck' then 'deck' else 'hand' end],
            (g->p_side->(case when v_op->>'to' = 'deck' then 'deck' else 'hand' end)) || to_jsonb(v_c));
        end loop;
        if v_op->>'to' = 'deck' then
          g := jsonb_set(g, array[p_side, 'deck'], public.pvp_shuffle(g->p_side->'deck'));
        end if;
        g := public.pvp_ev(g, jsonb_build_object('k', 'recover', 's', p_side, 'cards', v_found, 'to', v_op->>'to'));
      when 'heal' then
        for v_pos in
          select p from public.pvp_positions(g, p_side) p
          where case v_op->>'who'
            when 'all' then true
            when 'active' then p = 0
            when 'self' then p = p_self
            else p = coalesce(public.pvp_opt_pos(g, p_side, p_opts->'pos', false),
                              (select q from public.pvp_positions(g, p_side) q
                               order by (public.pvp_slot(g, p_side, q)->>'damage')::int desc, q limit 1)) end
        loop
          v_slot := public.pvp_slot(g, p_side, v_pos);
          v_c := least(case when v_op->>'n' = 'all' then (v_slot->>'damage')::int else v_n end, (v_slot->>'damage')::int);
          v_healed := v_pos;
          v_healed_n := v_healed_n + v_c;
          g := public.pvp_heal(g, p_side, v_pos, v_c);
        end loop;
      when 'cure' then
        v_pos := case when v_op->>'who' = 'healed' then coalesce(v_healed, 0) else 0 end;
        v_slot := public.pvp_slot(g, p_side, v_pos);
        if v_slot is not null and (v_slot->>'status' is not null or (v_slot->>'poisoned')::boolean or (v_slot->>'burned')::boolean) then
          g := public.pvp_set(g, p_side, v_pos, 'status', null);
          g := public.pvp_set(g, p_side, v_pos, 'poisoned', 'false');
          g := public.pvp_set(g, p_side, v_pos, 'burned', 'false');
          g := public.pvp_ev(g, jsonb_build_object('k', 'cured', 's', p_side, 'c', v_slot->'c', 'status', 'all'));
        end if;
      when 'discard_energy_healed' then
        if v_healed_n > 0 and v_healed is not null then
          v_slot := public.pvp_slot(g, p_side, v_healed);
          g := jsonb_set(g, public.pvp_path(p_side, v_healed), public.pvp_drop_energy(public.pvp_top(g, p_side, v_slot), v_slot,
            case when v_op->>'n' = 'all' then 999 else coalesce(v_n, 1) end));
        end if;
      when 'switch_self' then
        v_to := coalesce(public.pvp_opt_pos(g, p_side, p_opts->'to', true), public.pvp_ai_bench_pick(g, p_side));
        if v_to is not null then g := public.pvp_switch(g, p_side, v_to); end if;
      when 'gust' then
        v_to := coalesce(public.pvp_opt_pos(g, v_foe, p_opts->'target', true), public.pvp_ai_weakest(g, v_foe, false));
        if v_to is not null then g := public.pvp_switch(g, v_foe, v_to); end if;
      when 'opp_switch' then
        v_to := public.pvp_ai_bench_pick(g, v_foe);
        if v_to is not null then g := public.pvp_switch(g, v_foe, v_to); end if;
      when 'boost' then
        g := jsonb_set(g, array[p_side, 'boost'], jsonb_build_object('turn', v_turn, 'n',
          v_n + case when (g->p_side->'boost'->>'turn')::int = v_turn then (g->p_side->'boost'->>'n')::int else 0 end));
      when 'shield' then
        g := jsonb_set(g, array[p_side, 'shield'], jsonb_build_object('turn', v_turn + 1, 'n',
          v_n + case when (g->p_side->'shield'->>'turn')::int = v_turn + 1 then (g->p_side->'shield'->>'n')::int else 0 end));
      when 'retreat_less' then
        g := jsonb_set(g, array[p_side, 'retreat_less'], jsonb_build_object('turn', v_turn, 'n', case when v_op->>'n' = 'all' then 999 else v_n end));
      when 'discard_opp_energy' then
        v_pos := case when v_op->>'who' = 'one' then coalesce(public.pvp_opt_pos(g, v_foe, p_opts->'target', false), 0) else 0 end;
        v_slot := public.pvp_slot(g, v_foe, v_pos);
        if v_slot is not null and (v_slot->>'energy')::int > 0 then
          g := jsonb_set(g, public.pvp_path(v_foe, v_pos), public.pvp_drop_energy(public.pvp_top(g, v_foe, v_slot), v_slot, coalesce(v_n, 1), true));
          g := public.pvp_ev(g, jsonb_build_object('k', 'discard_energy', 's', v_foe, 'c', v_slot->'c', 'n', least(coalesce(v_n, 1), (v_slot->>'energy')::int)));
        end if;
      when 'move_energy_own' then
        v_pos := coalesce(public.pvp_opt_pos(g, p_side, p_opts->'pos', false),
                          (select p from public.pvp_positions(g, p_side) p where p > 0 and (public.pvp_slot(g, p_side, p)->>'energy')::int > 0 order by p limit 1));
        v_to := coalesce(public.pvp_opt_pos(g, p_side, p_opts->'to', false), case when v_pos = 0 then public.pvp_ai_bench_pick(g, p_side) else 0 end);
        if v_pos is not null and v_to is not null and v_pos <> v_to and (public.pvp_slot(g, p_side, v_pos)->>'energy')::int > 0 then
          v_slot := public.pvp_slot(g, p_side, v_pos);
          v_type := v_slot->'etypes'->>-1;
          g := jsonb_set(g, public.pvp_path(p_side, v_pos), v_slot || jsonb_build_object('etypes', (v_slot->'etypes') - -1, 'energy', (v_slot->>'energy')::int - 1));
          g := jsonb_set(g, public.pvp_path(p_side, v_to), public.pvp_add_energy(public.pvp_slot(g, p_side, v_to), coalesce(v_type, 'Colorless')));
          g := public.pvp_ev(g, jsonb_build_object('k', 'move_energy', 's', p_side, 'c', public.pvp_slot(g, p_side, v_to)->'c', 'type', v_type));
        end if;
      when 'status' then
        g := public.pvp_condition(g, v_foe, 0, v_op->>'status');
      when 'rare_candy' then
        v_pos := public.pvp_opt_pos(g, p_side, p_opts->'pos', false);
        v_c := case when jsonb_typeof(p_opts->'evolve') = 'number' then (p_opts->>'evolve')::int end;
        if v_pos is null or v_c is null then
          select p, (h #>> '{}')::int into v_pos, v_c
          from public.pvp_positions(g, p_side) p
          cross join lateral jsonb_array_elements(g->p_side->'hand') h
          where public.pvp_top(g, p_side, public.pvp_slot(g, p_side, p))->>'stage' = 'basic'
            and (public.pvp_slot(g, p_side, p)->>'turn_in')::int < v_turn
            and g->p_side->'cards'->((h #>> '{}')::int)->>'base_name' = public.pvp_top(g, p_side, public.pvp_slot(g, p_side, p))->>'name'
          order by p limit 1;
        end if;
        v_slot := public.pvp_slot(g, p_side, v_pos);
        if v_slot is null or v_c is null or not (g->p_side->'hand' @> to_jsonb(array[v_c]))
           or public.pvp_top(g, p_side, v_slot)->>'stage' <> 'basic' or (v_slot->>'turn_in')::int >= v_turn
           or g->p_side->'cards'->v_c->>'base_name' is distinct from public.pvp_top(g, p_side, v_slot)->>'name' then
          raise exception 'pvp_invalid_action';
        end if;
        g := public.pvp_take_from_hand(g, p_side, v_c);
        g := jsonb_set(g, public.pvp_path(p_side, v_pos),
          public.pvp_cleared(v_slot) || jsonb_build_object('c', v_c, 'under', (v_slot->'under') || (v_slot->'c'), 'turn_in', v_turn));
        g := public.pvp_ev(g, jsonb_build_object('k', 'evolve', 's', p_side, 'pos', v_pos, 'c', v_c));
        g := public.pvp_trigger(g, p_side, v_pos, 'on_evolve');
      when 'scoop' then
        v_pos := public.pvp_opt_pos(g, p_side, p_opts->'pos', false);
        if v_pos is null then
          select p into v_pos from public.pvp_positions(g, p_side) p
          where p > 0 and (not coalesce((v_op->>'basic')::boolean, false) or public.pvp_top(g, p_side, public.pvp_slot(g, p_side, p))->>'stage' = 'basic')
          order by (public.pvp_slot(g, p_side, p)->>'damage')::int desc limit 1;
        end if;
        v_slot := public.pvp_slot(g, p_side, v_pos);
        if v_slot is null or (v_pos = 0 and jsonb_array_length(g->p_side->'bench') = 0)
           or (coalesce((v_op->>'basic')::boolean, false) and public.pvp_top(g, p_side, v_slot)->>'stage' <> 'basic') then
          raise exception 'pvp_invalid_action';
        end if;
        g := jsonb_set(g, array[p_side, 'hand'], (g->p_side->'hand') || (v_slot->'under') || jsonb_build_array(v_slot->'c')
          || case when jsonb_typeof(v_slot->'tool') = 'number' then jsonb_build_array(v_slot->'tool') else '[]'::jsonb end);
        g := public.pvp_ev(g, jsonb_build_object('k', 'scoop', 's', p_side, 'c', v_slot->'c'));
        if v_pos = 0 then
          v_to := coalesce(public.pvp_opt_pos(g, p_side, p_opts->'to', true), public.pvp_ai_bench_pick(g, p_side));
          g := jsonb_set(g, array[p_side, 'active'], 'null');
          g := public.pvp_promote(g, p_side, v_to);
        else
          g := jsonb_set(g, array[p_side, 'bench'], (g->p_side->'bench') - (v_pos - 1));
        end if;
      when 'end_turn' then
        v_end := true;
      -- abilities (0033)
      when 'switch_in' then
        if p_self > 0 and public.pvp_slot(g, p_side, p_self) is not null then
          g := public.pvp_switch(g, p_side, p_self);
        end if;
      when 'counters' then
        v_pos := case when v_op->>'who' = 'active' then 0
                      else coalesce(public.pvp_opt_pos(g, v_foe, p_opts->'target', false), public.pvp_ai_weakest(g, v_foe, true)) end;
        v_slot := public.pvp_slot(g, v_foe, v_pos);
        if v_slot is not null then
          g := public.pvp_set(g, v_foe, v_pos, 'damage', to_jsonb((v_slot->>'damage')::int + v_n));
          g := public.pvp_ev(g, jsonb_build_object('k', 'damage', 's', v_foe, 'pos', v_pos, 'c', v_slot->'c', 'n', v_n));
        end if;
      when 'self_ko' then
        v_slot := public.pvp_slot(g, p_side, p_self);
        if v_slot is not null then
          g := public.pvp_set(g, p_side, p_self, 'damage', to_jsonb((v_slot->>'damage')::int + public.pvp_hp_left(g, p_side, v_slot)));
        end if;
      when 'once' then
        g := jsonb_set(g, array[p_side, 'used_once'], 'true');
      when 'no_more_trainers' then
        g := jsonb_set(g, array[p_side, 'no_trainers'], 'true');
      else
        null;
    end case;
  end loop;

  g := public.pvp_ko(g);
  if v_end and g->>'phase' <> 'over' then
    g := public.pvp_ev(jsonb_set(g, '{stage}', '"end"'), jsonb_build_object('k', 'end', 's', p_side));
  end if;
  return g;
end;
$$;

-- A Pokémon just benched / evolved from my hand: its on_bench / on_evolve
-- abilities ("you may": always; the server picks the choices)
create or replace function public.pvp_trigger(p_g jsonb, p_side text, p_pos int, p_kind text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_slot jsonb := public.pvp_slot(p_g, p_side, p_pos);
  v_ab jsonb;
  v_i int;
begin
  if v_slot is null then
    return g;
  end if;
  for v_ab, v_i in
    select a, (n - 1)::int from jsonb_array_elements(coalesce(public.pvp_top(g, p_side, v_slot)->'abilities', '[]')) with ordinality x(a, n)
    where a->>'kind' = p_kind and coalesce((a->>'playable')::boolean, false)
  loop
    exit when g->>'phase' = 'over';
    g := public.pvp_effects(g, p_side, v_ab->'fx', v_ab->'coins', '{}'::jsonb, p_pos,
      jsonb_build_object('k', 'ability', 's', p_side, 'c', v_slot->'c', 'pos', p_pos, 'ab', v_i,
        'ability', v_ab->>'name', 'ability_fr', v_ab->>'name_fr'));
  end loop;
  return g;
end;
$$;

-- One Trainer of my hand played (0032; its effects in pvp_effects since 0033).
-- p_opts: see pvp_effects (pos, to, target, evolve, discard, pick).
create or replace function public.pvp_trainer(p_g jsonb, p_side text, p_card int, p_opts jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_snap jsonb := g->p_side->'cards'->p_card;
  v_block text := public.pvp_trainer_block(g, p_side, p_card);
  v_pos int;
  v_stage text;
begin
  if v_block is not null then
    raise exception 'pvp_cannot_play: %', v_block;
  end if;
  g := public.pvp_take_from_hand(g, p_side, p_card);

  -- A Tool goes on one of my Pokémon without one, and stays there
  if v_snap->>'kind' = 'tool' then
    v_pos := public.pvp_opt_pos(g, p_side, p_opts->'pos', false);
    if v_pos is not null and jsonb_typeof(public.pvp_slot(g, p_side, v_pos)->'tool') = 'number' then
      raise exception 'pvp_invalid_action';
    end if;
    v_pos := coalesce(v_pos, (select p from public.pvp_positions(g, p_side) p
                              where jsonb_typeof(public.pvp_slot(g, p_side, p)->'tool') is distinct from 'number' order by p limit 1));
    g := public.pvp_set(g, p_side, v_pos, 'tool', to_jsonb(p_card));
    return public.pvp_ev(g, jsonb_build_object('k', 'trainer', 's', p_side, 'c', p_card, 'pos', v_pos,
      'on', public.pvp_slot(g, p_side, v_pos)->'c'));
  end if;

  g := public.pvp_effects(g, p_side, v_snap->'fx', v_snap->'coins', p_opts, null,
    jsonb_build_object('k', 'trainer', 's', p_side, 'c', p_card));
  g := jsonb_set(g, array[p_side, 'discard'], (g->p_side->'discard') || to_jsonb(p_card));
  if v_snap->>'kind' = 'supporter' then
    g := jsonb_set(g, array[p_side, 'supporter_used'], 'true');
  end if;
  return g;
end;
$$;

-- Why ability i of my Pokémon at p_pos can't be used now, null if it can:
-- 'unknown' (not a usable one), 'used' (this turn already), 'not_active' /
-- 'not_bench', 'status', 'once', 'hand', 'no_target', 'bench_full'
create or replace function public.pvp_ability_block(p_g jsonb, p_side text, p_pos int, p_i int)
returns text
language plpgsql
immutable
as $$
declare
  v_slot jsonb := public.pvp_slot(p_g, p_side, p_pos);
  v_ab jsonb := public.pvp_top(p_g, p_side, v_slot)->'abilities'->p_i;
  v_fx jsonb := coalesce(v_ab->'fx', '[]');
  v_turn int := (p_g->>'turn')::int;
  v_acts text[];
  v_cost int;
begin
  if v_slot is null or v_ab is null or not coalesce((v_ab->>'playable')::boolean, false) or v_ab->>'kind' <> 'active' then
    return 'unknown';
  end if;
  if not coalesce((v_ab->>'many')::boolean, false) and (v_slot->>'ab_turn')::int = v_turn and coalesce(v_slot->'ab_used', '[]') @> to_jsonb(array[p_i]) then
    return 'used';
  end if;
  if coalesce((v_ab->>'active_only')::boolean, false) and p_pos <> 0 then
    return 'not_active';
  end if;
  if coalesce((v_ab->>'bench_only')::boolean, false) and p_pos = 0 then
    return 'not_bench';
  end if;
  if v_fx @> '[{"op": "needs_no_status"}]'
     and (v_slot->>'status' is not null or (v_slot->>'poisoned')::boolean or (v_slot->>'burned')::boolean) then
    return 'status';
  end if;
  if v_fx @> '[{"op": "once"}]' and coalesce((p_g->p_side->>'used_once')::boolean, false) then
    return 'once';
  end if;
  select coalesce(sum((o->>'n')::int), 0) into v_cost from jsonb_array_elements(v_fx) o where o->>'op' = 'discard_cost';
  if jsonb_array_length(p_g->p_side->'hand') < v_cost then
    return 'hand';
  end if;
  select array_agg(distinct o->>'op') into v_acts from jsonb_array_elements(v_fx) o
  where o->>'op' not in ('discard_cost', 'needs_no_status', 'once', 'end_turn');
  if v_acts <@ array['gust'] and jsonb_array_length(p_g->public.pvp_other(p_side)->'bench') = 0 then
    return 'no_target';
  end if;
  if v_acts <@ array['switch_self'] and jsonb_array_length(p_g->p_side->'bench') = 0 then
    return 'no_target';
  end if;
  if v_acts <@ array['switch_in'] and p_pos = 0 then
    return 'no_target';
  end if;
  if v_acts <@ array['search'] and v_fx @> '[{"op": "search", "to": "bench"}]'
     and jsonb_array_length(p_g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int then
    return 'bench_full';
  end if;
  return null;
end;
$$;

-- Ability i of my Pokémon at p_pos used (0033). p_opts: the Trainers' choices.
create or replace function public.pvp_ability(p_g jsonb, p_side text, p_pos int, p_i int, p_opts jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_turn int := (g->>'turn')::int;
  v_slot jsonb := public.pvp_slot(g, p_side, p_pos);
  v_ab jsonb := public.pvp_top(g, p_side, v_slot)->'abilities'->p_i;
  v_block text := public.pvp_ability_block(g, p_side, p_pos, p_i);
begin
  if v_block is not null then
    raise exception 'pvp_cannot_use: %', v_block;
  end if;
  g := public.pvp_set(g, p_side, p_pos, 'ab_used', case when (v_slot->>'ab_turn')::int = v_turn
    then coalesce(v_slot->'ab_used', '[]') || to_jsonb(p_i) else jsonb_build_array(p_i) end);
  g := public.pvp_set(g, p_side, p_pos, 'ab_turn', to_jsonb(v_turn));
  return public.pvp_effects(g, p_side, v_ab->'fx', v_ab->'coins', p_opts, p_pos,
    jsonb_build_object('k', 'ability', 's', p_side, 'c', v_slot->'c', 'pos', p_pos, 'ab', p_i,
      'ability', v_ab->>'name', 'ability_fr', v_ab->>'name_fr'));
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
  -- Trainers (0032): this turn's boosts and my Tool's, on their Active
  if v_damage > 0 then
    v_damage := v_damage + public.pvp_tool_n(g, p_side, v_me, 'tool_boost')
      + case when (g->p_side->'boost'->>'turn')::int = v_turn then (g->p_side->'boost'->>'n')::int else 0 end;
  end if;

  if v_them is not null then
    v_prevented := coalesce((v_them->>'prevent')::int = v_turn, false);
    if v_damage > 0 and not v_prevented then
      if not v_fx @> '[{"op": "no_weakness"}]' and public.pvp_tool_n(g, v_foe, v_them, 'tool_no_weakness') = 0
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
      -- their Tool, their Trainer's shield (0032)
      v_damage := v_damage - public.pvp_tool_n(g, v_foe, v_them, 'tool_reduce')
        - case when (g->v_foe->'shield'->>'turn')::int = v_turn then (g->v_foe->'shield'->>'n')::int else 0 end;
      v_dealt := greatest(v_damage, 0);
      -- Sturdy (0033): full HP, it keeps n HP
      if public.pvp_tool_n(g, v_foe, v_them, 'tool_sturdy') > 0 and (v_them->>'damage')::int = 0
         and v_dealt >= public.pvp_hp_left(g, v_foe, v_them) then
        v_dealt := greatest(public.pvp_hp_left(g, v_foe, v_them) - public.pvp_tool_n(g, v_foe, v_them, 'tool_sturdy'), 0);
      end if;
    end if;
  end if;
  g := public.pvp_ev(g, jsonb_build_object('k', 'attack', 's', p_side, 'c', v_me->'c', 'i', p_attack,
    'damage', v_dealt, 'flips', v_flips, 'prevented', v_prevented));
  g := public.pvp_hurt(g, v_foe, 0, v_dealt);
  -- Rocky Helmet and co: damage back on my Active (0032)
  if v_dealt > 0 and public.pvp_tool_n(g, v_foe, v_them, 'tool_retaliate') > 0 then
    g := public.pvp_hurt(g, p_side, 0, public.pvp_tool_n(g, v_foe, v_them, 'tool_retaliate'));
  end if;

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
--   { type: 'trainer', card, pos?, to?, target?, evolve?, discard?, pick? }   (0032, pvp_trainer)
--   { type: 'ability', at, ability, pos?, to?, target?, discard?, pick? }     (0033, pvp_ability: `at` = my Pokémon using it)
-- Benching / evolving from my hand plays its on_bench / on_evolve abilities (0033).
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
    g := public.pvp_ev(g, jsonb_build_object('k', 'bench', 's', p_side, 'c', v_card));
    return public.pvp_trigger(g, p_side, jsonb_array_length(g->p_side->'bench'), 'on_bench');

  elsif v_type = 'evolve' then
    v_snap := g->p_side->'cards'->v_card;
    v_slot := public.pvp_slot(g, p_side, v_pos);
    if v_card is null or v_slot is null or not (g->p_side->'hand' @> to_jsonb(array[v_card]))
       or v_snap->>'stage' <> 'evolution' or v_snap->>'evolves_from' is distinct from public.pvp_top(g, p_side, v_slot)->>'name' then
      raise exception 'pvp_invalid_action';
    end if;
    if (v_turn <= 2 or (v_slot->>'turn_in')::int >= v_turn)
       and public.pvp_tool_n(g, p_side, v_slot, 'tool_fast_evolve') = 0 then
      raise exception 'pvp_cannot_evolve_yet';
    end if;
    g := public.pvp_take_from_hand(g, p_side, v_card);
    v_slot := public.pvp_cleared(v_slot) || jsonb_build_object('c', v_card, 'under', (v_slot->'under') || (v_slot->'c'), 'turn_in', v_turn);
    g := jsonb_set(g, public.pvp_path(p_side, v_pos), v_slot);
    g := public.pvp_ev(g, jsonb_build_object('k', 'evolve', 's', p_side, 'pos', v_pos, 'c', v_card));
    return public.pvp_trigger(g, p_side, v_pos, 'on_evolve');

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
       or (v_slot->>'energy')::int < public.pvp_retreat_cost(g, p_side, 0) then
      raise exception 'pvp_cannot_retreat';
    end if;
    g := jsonb_set(g, public.pvp_path(p_side, 0),
      public.pvp_drop_energy(public.pvp_top(g, p_side, v_slot), v_slot, public.pvp_retreat_cost(g, p_side, 0)));
    g := jsonb_set(g, array[p_side, 'retreated'], 'true');
    return public.pvp_switch(g, p_side, v_pos);

  elsif v_type = 'attack' then
    v_block := public.pvp_attack_block(g, p_side, (p_action->>'attack')::int);
    if v_block is not null then
      raise exception 'pvp_cannot_attack: %', v_block;
    end if;
    g := public.pvp_attack(g, p_side, (p_action->>'attack')::int, p_action);
    return jsonb_set(g, '{stage}', '"end"');

  elsif v_type = 'trainer' then
    if v_card is null then
      raise exception 'pvp_invalid_action';
    end if;
    return public.pvp_trainer(g, p_side, v_card, p_action);

  elsif v_type = 'ability' then
    if (p_action->>'at') is null or (p_action->>'ability') is null then
      raise exception 'pvp_invalid_action';
    end if;
    return public.pvp_ability(g, p_side, (p_action->>'at')::int, (p_action->>'ability')::int, p_action);

  elsif v_type = 'end' then
    return public.pvp_ev(jsonb_set(g, '{stage}', '"end"'), jsonb_build_object('k', 'end', 's', p_side));
  end if;
  raise exception 'pvp_invalid_action';
end;
$$;

-- ---------- 4. Hints and the AI ----------

set local application_name = 'migration 0033: step 4/4 hints and AI';

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
    'supporter_used', coalesce((p_g->'a'->>'supporter_used')::boolean, false),
    -- hand card index -> { bench, evolve: [positions], play: a Trainer: null = playable, else why not (0032) }
    'hand', coalesce((
      select jsonb_object_agg(h.c, jsonb_build_object(
        'play', case when p_g->'a'->'cards'->h.c->>'stage' <> 'trainer' then null
                     when not v_my_turn then 'not_your_turn'
                     else public.pvp_trainer_block(p_g, 'a', h.c) end,
        'bench', v_my_turn and p_g->'a'->'cards'->h.c->>'stage' = 'basic'
                 and jsonb_array_length(p_g->'a'->'bench') < (public.pvp_rules()->>'bench_size')::int,
        'evolve', coalesce((
          select jsonb_agg(p order by p) from public.pvp_positions(p_g, 'a') p
          where v_my_turn and p_g->'a'->'cards'->h.c->>'stage' = 'evolution'
            and public.pvp_top(p_g, 'a', public.pvp_slot(p_g, 'a', p))->>'name' = p_g->'a'->'cards'->h.c->>'evolves_from'
            and ((v_turn > 2 and (public.pvp_slot(p_g, 'a', p)->>'turn_in')::int < v_turn)
                 or public.pvp_tool_n(p_g, 'a', public.pvp_slot(p_g, 'a', p), 'tool_fast_evolve') > 0)), '[]')))
      from (select distinct (x #>> '{}')::int as c from jsonb_array_elements(p_g->'a'->'hand') x) h), '{}'),
    'retreat', v_my_turn and v_active is not null and not (p_g->'a'->>'retreated')::boolean
               and jsonb_array_length(p_g->'a'->'bench') > 0
               and coalesce(v_active->>'status', '') not in ('asleep', 'paralyzed')
               and (v_active->>'no_retreat')::int is distinct from v_turn
               and (v_active->>'energy')::int >= public.pvp_retreat_cost(p_g, 'a', 0),
    'retreat_cost', case when v_active is not null then public.pvp_retreat_cost(p_g, 'a', 0) end,
    -- position -> per ability: null = usable now, else why not, or its kind
    -- ('passive', 'on_bench', 'on_evolve') / 'unknown' (not played) (0033)
    'abilities', coalesce((
      select jsonb_object_agg(p, (
        select coalesce(jsonb_agg(case
            when not coalesce((a->>'playable')::boolean, false) then 'unknown'
            when a->>'kind' <> 'active' then a->>'kind'
            when not v_my_turn then 'not_your_turn'
            else public.pvp_ability_block(p_g, 'a', p, (n - 1)::int) end order by n), '[]')
        from jsonb_array_elements(coalesce(public.pvp_top(p_g, 'a', public.pvp_slot(p_g, 'a', p))->'abilities', '[]')) with ordinality x(a, n)))
      from public.pvp_positions(p_g, 'a') p), '{}'),
    -- attack index -> null (can) or why not
    'attacks', case when v_active is null then '[]'::jsonb else coalesce((
      select jsonb_agg(case when v_my_turn then public.pvp_attack_block(p_g, 'a', i) else 'not_your_turn' end order by i)
      from generate_series(0, jsonb_array_length(public.pvp_top(p_g, 'a', v_active)->'attacks') - 1) i), '[]') end
  );
end;
$$;

-- Whether the AI wants an effect (a Trainer's or an ability's fx) now; p_self:
-- the Pokémon whose ability it is (0033, out of 0032's pvp_ai_wants)
create or replace function public.pvp_ai_wants_fx(p_g jsonb, p_side text, p_fx jsonb, p_level text, p_moment text, p_self int)
returns boolean
language plpgsql
volatile
as $$
declare
  v_foe text := public.pvp_other(p_side);
  v_ops text[];
  v_hand int := jsonb_array_length(p_g->p_side->'hand') - case when p_self is null then 1 else 0 end;
  v_active jsonb := public.pvp_slot(p_g, p_side, 0);
  v_op jsonb;
  v_best int;
begin
  select array_agg(o->>'op') into v_ops from jsonb_array_elements(p_fx) o;
  if 'end_turn' = any(v_ops) then
    return false;
  end if;
  -- the hardest hit my Active can pay now
  select max((a->>'base')::int) into v_best from jsonb_array_elements(public.pvp_top(p_g, p_side, v_active)->'attacks') a
  where (a->>'usable')::boolean and public.pvp_can_pay(v_active, a);
  if v_ops && array['boost', 'shield'] then
    return p_moment = 'attack' and (not 'boost' = any(v_ops) or v_best is not null);
  end if;
  if p_moment <> 'main' then
    return false;
  end if;
  -- A cost: something must stay in hand
  if 'discard_cost' = any(v_ops) and v_hand - (select sum((o->>'n')::int) from jsonb_array_elements(p_fx) o where o->>'op' = 'discard_cost') < 1 then
    return false;
  end if;
  for v_op in select * from jsonb_array_elements(p_fx) loop
    if (case v_op->>'op'
      when 'draw' then v_hand <= 5 and jsonb_array_length(p_g->p_side->'deck') > 0
      when 'draw_heads' then v_hand <= 5 and jsonb_array_length(p_g->p_side->'deck') > 0
      when 'draw_until' then v_hand < (v_op->>'n')::int - 1 and jsonb_array_length(p_g->p_side->'deck') > 0
      when 'discard_hand_draw' then v_hand <= 2 and jsonb_array_length(p_g->p_side->'deck') > 0
      when 'shuffle_hand_draw' then v_hand <= 2
      when 'each_shuffle_draw' then v_hand <= 2
      when 'each_bottom_draw' then v_hand <= 2
      when 'opp_shuffle_draw' then jsonb_array_length(p_g->v_foe->'hand') >= 5
      when 'search' then public.pvp_pick(p_g, p_side, p_g->p_side->'deck', v_op, null, '[]') is not null
        and (v_op->>'to' <> 'bench' or jsonb_array_length(p_g->p_side->'bench') < (public.pvp_rules()->>'bench_size')::int)
      when 'search_top' then jsonb_array_length(p_g->p_side->'deck') > 0
      when 'recover' then public.pvp_pick(p_g, p_side, p_g->p_side->'discard', v_op, null, '[]') is not null
      when 'heal' then exists (select 1 from public.pvp_positions(p_g, p_side) p
                               where (v_op->>'who' <> 'active' or p = 0) and (v_op->>'who' <> 'self' or p = p_self) and (public.pvp_slot(p_g, p_side, p)->>'damage')::int >= 30)
      when 'cure' then v_active->>'status' is not null or (v_active->>'poisoned')::boolean or (v_active->>'burned')::boolean
      when 'switch_self' then v_best is null and exists (
        select 1 from public.pvp_positions(p_g, p_side) p
        cross join lateral jsonb_array_elements(public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p))->'attacks') a
        where p > 0 and (a->>'usable')::boolean and public.pvp_can_pay(public.pvp_slot(p_g, p_side, p), a))
      when 'gust' then exists (select 1 from public.pvp_positions(p_g, v_foe) p
                               where p > 0 and public.pvp_hp_left(p_g, v_foe, public.pvp_slot(p_g, v_foe, p)) <= coalesce(v_best, 0))
      when 'discard_opp_energy' then (public.pvp_slot(p_g, v_foe, 0)->>'energy')::int > 0
      when 'status' then true
      when 'counters' then true
      when 'switch_in' then v_best is null and p_self > 0 and exists (
        select 1 from jsonb_array_elements(public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p_self))->'attacks') a
        where (a->>'usable')::boolean and public.pvp_can_pay(public.pvp_slot(p_g, p_side, p_self), a))
      when 'rare_candy' then true
      else false end) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Whether the AI plays a Trainer of its hand now (its effects: pvp_ai_wants_fx).
-- p_moment: 'main', 'tools', 'attack'. Easy plays half of what it could.
create or replace function public.pvp_ai_wants(p_g jsonb, p_side text, p_card int, p_level text, p_moment text)
returns boolean
language plpgsql
volatile
as $$
declare
  v_snap jsonb := p_g->p_side->'cards'->p_card;
begin
  if public.pvp_trainer_block(p_g, p_side, p_card) is not null then
    return false;
  end if;
  if p_level = 'easy' and random() < 0.5 then
    return false;
  end if;
  if v_snap->>'kind' = 'tool' then
    return p_moment = 'tools';
  end if;
  return public.pvp_ai_wants_fx(p_g, p_side, v_snap->'fx', p_level, p_moment, null);
end;
$$;

-- The abilities the AI uses at the start of its turn (0033)
create or replace function public.pvp_ai_abilities(p_g jsonb, p_side text, p_level text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_pos int;
  v_ab jsonb;
  v_i int;
begin
  for v_pos in select p from public.pvp_positions(g, p_side) p loop
    for v_ab, v_i in
      select a, (n - 1)::int from jsonb_array_elements(coalesce(public.pvp_top(g, p_side, public.pvp_slot(g, p_side, v_pos))->'abilities', '[]')) with ordinality x(a, n)
    loop
      exit when g->>'phase' = 'over' or g->>'stage' <> 'play';
      continue when public.pvp_ability_block(g, p_side, v_pos, v_i) is not null;
      continue when p_level = 'easy' and random() < 0.5;
      continue when v_ab->'fx' @> '[{"op": "end_turn"}]' or v_ab->'fx' @> '[{"op": "self_ko"}]';
      if public.pvp_ai_wants_fx(g, p_side, v_ab->'fx', p_level, 'main', v_pos) then
        g := public.pvp_do(g, p_side, jsonb_build_object('type', 'ability', 'at', v_pos, 'ability', v_i));
      end if;
    end loop;
  end loop;
  return g;
end;
$$;

-- A whole turn of the server's side (Trainers since 0032: first the ones
-- it wants, Tools after the Bench, boosts and shields before attacking):
-- evolve, fill the Bench, retreat when
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
  -- 0. Trainers (0032), abilities (0033)
  g := public.pvp_ai_trainers(g, p_side, p_level, 'main');
  if g->>'phase' = 'play' and g->>'stage' = 'play' then
    g := public.pvp_ai_abilities(g, p_side, p_level);
  end if;
  if g->>'phase' = 'over' or g->>'stage' <> 'play' then
    return g;
  end if;
  v_turn := (g->>'turn')::int;

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
  g := public.pvp_ai_trainers(g, p_side, p_level, 'tools');

  -- 3. Retreat (normal / hard): the Active can't hit for a while, or is
  -- about to fall, and a Benched one can attack right now
  v_slot := public.pvp_slot(g, p_side, 0);
  if not v_easy and v_slot is not null and not (g->p_side->>'retreated')::boolean
     and coalesce(v_slot->>'status', '') not in ('asleep', 'paralyzed') and (v_slot->>'no_retreat')::int is distinct from v_turn
     and (v_slot->>'energy')::int >= public.pvp_retreat_cost(g, p_side, 0) then
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

  -- 5. Attack, or end the turn (boosts and shields first)
  g := public.pvp_ai_trainers(g, p_side, p_level, 'attack');
  if g->>'phase' = 'over' or g->>'stage' <> 'play' then
    return g;
  end if;
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

-- Internal: not callable by clients
revoke execute on function public.pvp_team_has(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.pvp_effects(jsonb, text, jsonb, jsonb, jsonb, int, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_trigger(jsonb, text, int, text) from public, anon, authenticated;
revoke execute on function public.pvp_ability_block(jsonb, text, int, int) from public, anon, authenticated;
revoke execute on function public.pvp_ability(jsonb, text, int, int, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_ai_wants_fx(jsonb, text, jsonb, text, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_ai_abilities(jsonb, text, text) from public, anon, authenticated;

set local application_name = 'migration 0033: done, committing';
