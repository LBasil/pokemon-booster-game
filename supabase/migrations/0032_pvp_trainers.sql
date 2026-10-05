-- Pokémon Booster Game — Challenge: Trainer cards in PvP, like Pokémon TCG Pocket
-- Run after 0031_pvp_typed_energy.sql, then let a card sync run (it stores
-- what each Trainer does: cards.trainer, and its French text: effect_fr).
--
-- User, 2026-10-05: "pourquoi pas tous ? pourquoi pas juste faire comme
-- pocket ?", then "fonce, fais comme Pocket mais avec nos cartes bien sûr".
--
-- Rules (Pocket's):
--   - A deck's 20 cards may include Trainers of the challenge collection
--     (2 of a name, 1 ACE SPEC at most); at least 1 Basic Pokémon still.
--   - Items: as many as I like on my turn. Supporters: 1 a turn, not on the
--     very first turn of the battle (unless the card says I may). Pokémon
--     Tools: attached to one of my Pokémon without a Tool, they stay until
--     it's knocked out. Stadiums, Technical Machines and fossils aren't
--     played.
--   - A Trainer is playable when src/utils/trainerEffects.js understood its
--     whole text at import (cards.trainer.playable; 576 of 2,506 Items /
--     Supporters / Tools on 2026-10-05, the classics among them). The texts
--     that talk about Energy cards, Prize cards or Stadiums can't be played
--     here: our energy comes from the zone, points replace prizes.
--   - Choices: I pick the cards to discard, the cards found in my deck or
--     discard pile, my / their Pokémon; the server picks what I leave out
--     (and everything for the AI). Looking at the top cards of the deck: the
--     server takes the best match.
--
-- 1. cards.trainer (jsonb: kind, fx, coins, playable, text, ace_spec) and
--    cards.effect_fr (TCGdex), set_cards_fr writes it too.
-- 2. pvp_card() returns Trainers (stage 'trainer') and, for Stage 2 cards,
--    the Basic of their line (`base_name`, for Rare Candy); decks take them.
-- 3. The engine: pvp_trainer() (one Trainer played), Tools in HP, damage,
--    Weakness, retreat and checkups, the turn's boosts and shields;
--    pvp_act({ type: 'trainer', card, pos?, to?, target?, evolve?,
--    discard?, pick? }); hints say which Trainers I can play and why not.
-- 4. The AI plays its Trainers; bots' decks carry 2 (easy) / 4 / 6 (hard).
--
-- Battles in progress go on (the new state keys default to empty).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Cards ----------

set local application_name = 'migration 0032: step 1/5 cards';

alter table public.cards add column if not exists trainer jsonb;
alter table public.cards add column if not exists effect_fr text;

create or replace function public.set_cards_fr(p_rows jsonb)
returns int
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with updated as (
    update public.cards c
    set name_fr = coalesce(r.name_fr, c.name_fr),
        image_fr = coalesce(r.image_fr, c.image_fr),
        attacks_fr = coalesce(r.attacks_fr, c.attacks_fr),
        abilities_fr = coalesce(r.abilities_fr, c.abilities_fr),
        effect_fr = coalesce(r.effect_fr, c.effect_fr)
    from jsonb_to_recordset(p_rows) r(id text, name_fr text, image_fr text, attacks_fr jsonb, abilities_fr jsonb, effect_fr text)
    where c.id = r.id
    returning 1
  )
  select count(*)::int from updated
$$;

revoke execute on function public.set_cards_fr(jsonb) from public, anon, authenticated;
grant execute on function public.set_cards_fr(jsonb) to service_role;

-- ---------- 2. Card snapshots and decks ----------

set local application_name = 'migration 0032: step 2/5 cards and decks';

-- A playable Trainer as a battle sees it, or null
create or replace function public.pvp_trainer_card(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'name_fr', c.name_fr,
    'image_small', c.image_small, 'image_fr', c.image_fr,
    'stage', 'trainer', 'kind', c.trainer->>'kind', 'fx', coalesce(c.trainer->'fx', '[]'),
    'coins', c.trainer->'coins', 'text', coalesce(c.trainer->>'text', ''), 'text_fr', c.effect_fr,
    'ace_spec', coalesce((c.trainer->>'ace_spec')::boolean, false),
    'hp', 0, 'prizes', 0, 'types', '[]'::jsonb, 'weaknesses', '[]'::jsonb, 'resistances', '[]'::jsonb,
    'attacks', '[]'::jsonb, 'abilities', '[]'::jsonb, 'retreat', 0, 'evolves_from', null)
  from public.cards c
  where c.id = p_id and c.supertype = 'Trainer' and jsonb_typeof(c.trainer) = 'object'
    and coalesce((c.trainer->>'playable')::boolean, false)
    and c.trainer->>'kind' in ('item', 'supporter', 'tool')
$$;

-- A card as a battle sees it: a Pokémon with HP, a playable Trainer (0032:
-- pvp_trainer_card), or null.
-- base_name (0032): for a Stage 2, the Basic of its line (Rare Candy).
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
  union all
  select public.pvp_trainer_card(p_id) where public.pvp_trainer_card(p_id) is not null
$$;

-- A deck's card snapshots if it follows the rules (20 cards, 2 of a name at
-- most, every copy owned, all fit the format, at least 1 Basic; 0032:
-- playable Trainers too, 1 ACE SPEC at most); null otherwise
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
     or not exists (select 1 from jsonb_array_elements(v_cards) c where c->>'stage' = 'basic')
     or (select count(*) from jsonb_array_elements(v_cards) c where (c->>'ace_spec')::boolean) > 1 then
    return null;
  end if;
  return v_cards;
end;
$$;


-- ---------- 3. The engine ----------

set local application_name = 'migration 0032: step 3/5 engine';

-- A list of card indexes without one copy of a card
create or replace function public.pvp_without(p_list jsonb, p_card int)
returns jsonb
language sql
immutable
as $$
  select coalesce((
    select jsonb_agg(h order by n) from jsonb_array_elements(coalesce(p_list, '[]')) with ordinality x(h, n)
    where n <> coalesce((select min(n2) from jsonb_array_elements(coalesce(p_list, '[]')) with ordinality y(h2, n2) where h2 = to_jsonb(p_card)), 0)), '[]')
$$;

create or replace function public.pvp_shuffle(p_list jsonb)
returns jsonb
language sql
volatile
as $$
  select coalesce((select jsonb_agg(x order by random()) from jsonb_array_elements(coalesce(p_list, '[]')) x), '[]')
$$;

-- Whether a card snapshot matches a search filter (trainerEffects.js:
-- what, type, max_hp, no_rule_box)
create or replace function public.pvp_matches(p_card jsonb, p_op jsonb)
returns boolean
language sql
immutable
as $$
  select p_card is not null
    and case coalesce(p_op->>'what', 'card')
      when 'card' then true
      when 'basic' then p_card->>'stage' = 'basic'
      when 'evolution' then p_card->>'stage' = 'evolution'
      when 'pokemon' then p_card->>'stage' in ('basic', 'evolution')
      when 'trainer' then p_card->>'stage' = 'trainer'
      else p_card->>'stage' = 'trainer' and p_card->>'kind' = p_op->>'what' end
    and (p_op->>'type' is null or coalesce(p_card->'types', '[]') ? (p_op->>'type'))
    and (p_op->>'max_hp' is null or (p_card->>'stage' <> 'trainer' and (p_card->>'hp')::int <= (p_op->>'max_hp')::int))
    and (not coalesce((p_op->>'no_rule_box')::boolean, false) or (p_card->>'stage' <> 'trainer' and (p_card->>'prizes')::int = 1))
$$;

-- The Tool on a slot (its snapshot) and the sum of one of its ops ('all' = 999)
create or replace function public.pvp_tool(p_g jsonb, p_side text, p_slot jsonb)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(p_slot->'tool') = 'number' then p_g->p_side->'cards'->((p_slot->>'tool')::int) end
$$;

create or replace function public.pvp_tool_n(p_g jsonb, p_side text, p_slot jsonb, p_op text)
returns int
language sql
immutable
as $$
  select coalesce(sum(case when o->>'n' = 'all' then 999 when jsonb_typeof(o->'n') = 'number' then (o->>'n')::int else 1 end), 0)::int
  from jsonb_array_elements(coalesce(public.pvp_tool(p_g, p_side, p_slot)->'fx', '[]')) o
  where o->>'op' = p_op
$$;

-- HP left, with a Tool's extra HP (0032)
create or replace function public.pvp_hp_left(p_g jsonb, p_side text, p_slot jsonb)
returns int
language sql
immutable
as $$
  select (public.pvp_top(p_g, p_side, p_slot)->>'hp')::int + public.pvp_tool_n(p_g, p_side, p_slot, 'tool_hp') - (p_slot->>'damage')::int
$$;

-- A position's retreat cost now: printed, minus its Tool, minus this turn's
-- Trainers for the Active (0032)
create or replace function public.pvp_retreat_cost(p_g jsonb, p_side text, p_pos int)
returns int
language sql
immutable
as $$
  select greatest((public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p_pos))->>'retreat')::int
    - public.pvp_tool_n(p_g, p_side, public.pvp_slot(p_g, p_side, p_pos), 'tool_retreat')
    - case when p_pos = 0 and (p_g->p_side->'retreat_less'->>'turn')::int = (p_g->>'turn')::int
           then (p_g->p_side->'retreat_less'->>'n')::int else 0 end, 0)
$$;

-- AI: how much a side wants to keep a card of its hand (to discard the
-- others, to pick what a search finds)
create or replace function public.pvp_ai_keep(p_g jsonb, p_side text, p_card int)
returns numeric
language sql
immutable
as $$
  select case c->>'stage'
      when 'basic' then case when jsonb_array_length(p_g->p_side->'bench') < 3 or p_g->p_side->'active' = 'null' then 50 else 30 end
      when 'evolution' then case when exists (select 1 from public.pvp_positions(p_g, p_side) p
                                              where public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p))->>'name' in (c->>'evolves_from', c->>'base_name'))
                                 then 60 else 20 end
      when 'trainer' then case c->>'kind' when 'supporter' then 35 when 'item' then 25 else 15 end
      else 0 end
    + public.pvp_card_value(c) / 10
  from (select p_g->p_side->'cards'->p_card as c) x
$$;

-- Why a Trainer of my hand can't be played now, null if it can
create or replace function public.pvp_trainer_block(p_g jsonb, p_side text, p_card int)
returns text
language plpgsql
immutable
as $$
declare
  v_snap jsonb := p_g->p_side->'cards'->p_card;
  v_fx jsonb := coalesce(v_snap->'fx', '[]');
  v_turn int := (p_g->>'turn')::int;
  v_acts text[];
  v_cost int;
begin
  if v_snap is null or v_snap->>'stage' <> 'trainer' or not (coalesce(p_g->p_side->'hand', '[]') @> to_jsonb(array[p_card])) then
    return 'unknown';
  end if;
  if coalesce((p_g->p_side->>'no_trainers')::boolean, false) then
    return 'no_more';
  end if;
  if v_snap->>'kind' = 'supporter' then
    if coalesce((p_g->p_side->>'supporter_used')::boolean, false) then
      return 'supporter';
    end if;
    if v_turn = 1 and not v_fx @> '[{"op": "first_turn_ok"}]' then
      return 'first_turn';
    end if;
  end if;
  if v_snap->>'kind' = 'tool' then
    return case when exists (select 1 from public.pvp_positions(p_g, p_side) p where jsonb_typeof(public.pvp_slot(p_g, p_side, p)->'tool') is distinct from 'number')
      then null else 'no_target' end;
  end if;
  select coalesce(sum((o->>'n')::int), 0) into v_cost from jsonb_array_elements(v_fx) o where o->>'op' = 'discard_cost';
  if jsonb_array_length(p_g->p_side->'hand') - 1 < v_cost then
    return 'hand';
  end if;
  select array_agg(distinct o->>'op') into v_acts from jsonb_array_elements(v_fx) o
  where o->>'op' not in ('discard_cost', 'no_more_trainers', 'first_turn_ok', 'end_turn');
  -- Rare Candy: not on my first turn, a Basic in play since an earlier turn and its Stage 2 in my hand
  if 'rare_candy' = any(v_acts) and (v_turn <= 2 or not exists (
      select 1 from public.pvp_positions(p_g, p_side) p
      cross join lateral (select public.pvp_slot(p_g, p_side, p) as s) x
      cross join lateral jsonb_array_elements(p_g->p_side->'hand') h
      where public.pvp_top(p_g, p_side, x.s)->>'stage' = 'basic' and (x.s->>'turn_in')::int < v_turn
        and p_g->p_side->'cards'->((h #>> '{}')::int)->>'base_name' = public.pvp_top(p_g, p_side, x.s)->>'name')) then
    return 'no_target';
  end if;
  if v_acts <@ array['gust'] and jsonb_array_length(p_g->public.pvp_other(p_side)->'bench') = 0 then
    return 'no_target';
  end if;
  if v_acts <@ array['switch_self'] and jsonb_array_length(p_g->p_side->'bench') = 0 then
    return 'no_target';
  end if;
  if v_acts <@ array['search'] and v_fx @> '[{"op": "search", "to": "bench"}]'
     and jsonb_array_length(p_g->p_side->'bench') >= (public.pvp_rules()->>'bench_size')::int then
    return 'bench_full';
  end if;
  if 'scoop' = any(v_acts) and not exists (
      select 1 from public.pvp_positions(p_g, p_side) p
      where (p > 0 or jsonb_array_length(p_g->p_side->'bench') > 0)
        and (not coalesce((select bool_or((o->>'basic')::boolean) from jsonb_array_elements(v_fx) o where o->>'op' = 'scoop'), false)
             or public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p))->>'stage' = 'basic')) then
    return 'no_target';
  end if;
  return null;
end;
$$;

-- One card of a side's deck matching a filter, its pick first (if given:
-- the player's choice, only those), else the one the AI wants most; null if none
create or replace function public.pvp_pick(p_g jsonb, p_side text, p_from jsonb, p_op jsonb, p_picks jsonb, p_used jsonb)
returns int
language sql
immutable
as $$
  select (x #>> '{}')::int
  from jsonb_array_elements(coalesce(p_from, '[]')) with ordinality f(x, n)
  where public.pvp_matches(p_g->p_side->'cards'->((x #>> '{}')::int), p_op)
    and not (coalesce(p_used, '[]') @> jsonb_build_array(x))
    and (jsonb_typeof(p_picks) is distinct from 'array' or p_picks @> jsonb_build_array(x))
  order by public.pvp_ai_keep(p_g, p_side, (x #>> '{}')::int) desc, n
  limit 1
$$;

-- A valid position of mine / theirs from the options, else null
create or replace function public.pvp_opt_pos(p_g jsonb, p_side text, p_value jsonb, p_bench_only boolean)
returns int
language sql
immutable
as $$
  select case when jsonb_typeof(p_value) = 'number' and public.pvp_slot(p_g, p_side, (p_value #>> '{}')::int) is not null
               and (not p_bench_only or (p_value #>> '{}')::int > 0)
              then (p_value #>> '{}')::int end
$$;

-- One Trainer of my hand played. p_opts (all optional, the server picks
-- what's missing): pos = one of my Pokémon (heal, Tool, Rare Candy's Basic,
-- scoop, move energy from), to = one of my Benched Pokémon (switch, move
-- energy to, the new Active after a scoop), target = one of theirs (gust,
-- energy discard), evolve = the Stage 2 in my hand (Rare Candy), discard =
-- cards of my hand (a cost), pick = cards found in my deck / discard pile.
create or replace function public.pvp_trainer(p_g jsonb, p_side text, p_card int, p_opts jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_foe text := public.pvp_other(p_side);
  v_turn int := (g->>'turn')::int;
  v_snap jsonb := g->p_side->'cards'->p_card;
  v_block text := public.pvp_trainer_block(g, p_side, p_card);
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

  -- The cost: cards of my hand to the discard pile
  for v_op in select o from jsonb_array_elements(v_snap->'fx') o where o->>'op' = 'discard_cost' loop
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
  if jsonb_typeof(v_snap->'coins') = 'number' then
    for i in 1..least((v_snap->>'coins')::int, 10) loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      v_heads := v_heads + v_up::int;
    end loop;
    v_up := v_heads > 0;
  elsif v_snap->'coins' = '"until"'::jsonb then
    for i in 1..10 loop
      v_up := public.pvp_flip();
      v_flips := v_flips || to_jsonb(v_up);
      exit when not v_up;
      v_heads := v_heads + 1;
    end loop;
    v_up := v_heads > 0;
  end if;
  g := public.pvp_ev(g, jsonb_build_object('k', 'trainer', 's', p_side, 'c', p_card, 'flips', v_flips));

  for v_op in select * from jsonb_array_elements(v_snap->'fx') loop
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
      when 'no_more_trainers' then
        g := jsonb_set(g, array[p_side, 'no_trainers'], 'true');
      else
        null;
    end case;
  end loop;

  g := jsonb_set(g, array[p_side, 'discard'], (g->p_side->'discard') || to_jsonb(p_card));
  if v_snap->>'kind' = 'supporter' then
    g := jsonb_set(g, array[p_side, 'supporter_used'], 'true');
  end if;
  g := public.pvp_ko(g);
  if v_end and g->>'phase' <> 'over' then
    g := public.pvp_ev(jsonb_set(g, '{stage}', '"end"'), jsonb_build_object('k', 'end', 's', p_side));
  end if;
  return g;
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
      g := jsonb_set(g, array[v_side, 'discard'], (g->v_side->'discard') || (v_slot->'under') || jsonb_build_array(v_slot->'c')
        || case when jsonb_typeof(v_slot->'tool') = 'number' then jsonb_build_array(v_slot->'tool') else '[]'::jsonb end);
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
        g := jsonb_set(g, array[g->>'current', 'supporter_used'], 'false');
        g := jsonb_set(g, array[g->>'current', 'no_trainers'], 'false');
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
        -- Leftovers and co: the Active's Tool heals at the end of its owner's turn (0032)
        if public.pvp_slot(g, g->>'current', 0) is not null
           and public.pvp_tool_n(g, g->>'current', public.pvp_slot(g, g->>'current', 0), 'tool_heal_end') > 0 then
          g := public.pvp_heal(g, g->>'current', 0, public.pvp_tool_n(g, g->>'current', public.pvp_slot(g, g->>'current', 0), 'tool_heal_end'));
        end if;
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

-- ---------- 4. The AI ----------

set local application_name = 'migration 0032: step 4/5 AI';

-- Whether the AI plays a Trainer of its hand now. p_moment: 'main' (start
-- of its turn), 'tools', 'attack' (boosts and shields, just before it
-- attacks or ends its turn). Easy plays half of what it could.
create or replace function public.pvp_ai_wants(p_g jsonb, p_side text, p_card int, p_level text, p_moment text)
returns boolean
language plpgsql
volatile
as $$
declare
  v_snap jsonb := p_g->p_side->'cards'->p_card;
  v_foe text := public.pvp_other(p_side);
  v_ops text[];
  v_hand int := jsonb_array_length(p_g->p_side->'hand') - 1;
  v_active jsonb := public.pvp_slot(p_g, p_side, 0);
  v_op jsonb;
  v_best int;
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
  select array_agg(o->>'op') into v_ops from jsonb_array_elements(v_snap->'fx') o;
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
  if 'discard_cost' = any(v_ops) and v_hand - (select sum((o->>'n')::int) from jsonb_array_elements(v_snap->'fx') o where o->>'op' = 'discard_cost') < 1 then
    return false;
  end if;
  for v_op in select * from jsonb_array_elements(v_snap->'fx') loop
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
                               where (v_op->>'who' <> 'active' or p = 0) and (public.pvp_slot(p_g, p_side, p)->>'damage')::int >= 30)
      when 'cure' then v_active->>'status' is not null or (v_active->>'poisoned')::boolean or (v_active->>'burned')::boolean
      when 'switch_self' then v_best is null and exists (
        select 1 from public.pvp_positions(p_g, p_side) p
        cross join lateral jsonb_array_elements(public.pvp_top(p_g, p_side, public.pvp_slot(p_g, p_side, p))->'attacks') a
        where p > 0 and (a->>'usable')::boolean and public.pvp_can_pay(public.pvp_slot(p_g, p_side, p), a))
      when 'gust' then exists (select 1 from public.pvp_positions(p_g, v_foe) p
                               where p > 0 and public.pvp_hp_left(p_g, v_foe, public.pvp_slot(p_g, v_foe, p)) <= coalesce(v_best, 0))
      when 'discard_opp_energy' then (public.pvp_slot(p_g, v_foe, 0)->>'energy')::int > 0
      when 'status' then true
      when 'rare_candy' then true
      else false end) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The Trainers the AI plays at one moment of its turn (again after each
-- one: a draw can bring more)
create or replace function public.pvp_ai_trainers(p_g jsonb, p_side text, p_level text, p_moment text)
returns jsonb
language plpgsql
volatile
as $$
declare
  g jsonb := p_g;
  v_card int;
  v_played boolean;
begin
  for i in 1..12 loop
    exit when g->>'phase' = 'over' or g->>'stage' <> 'play';
    v_played := false;
    for v_card in select distinct (h #>> '{}')::int from jsonb_array_elements(g->p_side->'hand') h
                  where g->p_side->'cards'->((h #>> '{}')::int)->>'stage' = 'trainer' loop
      if public.pvp_ai_wants(g, p_side, v_card, p_level, p_moment) then
        g := public.pvp_do(g, p_side, jsonb_build_object('type', 'trainer', 'card', v_card));
        v_played := true;
        exit;
      end if;
    end loop;
    exit when not v_played;
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
  -- 0. Trainers (0032)
  g := public.pvp_ai_trainers(g, p_side, p_level, 'main');
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


-- 0032: 2 (easy), 4 (normal) or 6 (hard) Trainers of its eras, 2 of each,
-- the most useful first (search, draw, gust...; Rare Candy with a Stage 2 line).
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
  v_trainers int := case p_level when 'easy' then 2 when 'normal' then 4 else 6 end;
  v_pokemon int;
  v_tdeck jsonb;
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
    from jsonb_array_elements(p_mine) m
    where m->>'stage' <> 'trainer'; -- Trainers have no strength of their own (0032)
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
    v_pokemon := v_size - v_trainers;
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
      continue when jsonb_array_length(v_deck) + 2 * jsonb_array_length(v_line.cards) > v_pokemon;
      -- one Stage 2 line, two Stage 1 lines at most: the rest is Basics
      continue when jsonb_array_length(v_line.cards) = 3 and v_stage2_lines >= 1;
      continue when jsonb_array_length(v_line.cards) = 2 and v_stage1_lines >= 2;
      v_stage2_lines := v_stage2_lines + (jsonb_array_length(v_line.cards) = 3)::int;
      v_stage1_lines := v_stage1_lines + (jsonb_array_length(v_line.cards) = 2)::int;
      for v_card in select * from jsonb_array_elements(v_line.cards) loop
        v_deck := v_deck || jsonb_build_array(v_card, v_card);
        v_names := v_names || (v_card->>'name');
      end loop;
      exit when jsonb_array_length(v_deck) >= v_pokemon;
    end loop;
    -- Its Trainers (0032), 2 of each (1 ACE SPEC)
    v_tdeck := '[]';
    for v_pick in
      select t.card from (
        select distinct on (c.name) public.pvp_trainer_card(c.id) as card,
          (select coalesce(max(case o->>'op'
              when 'search' then 3 when 'draw' then 3 when 'discard_hand_draw' then 3 when 'shuffle_hand_draw' then 3
              when 'draw_until' then 3 when 'gust' then 3 when 'heal' then 2 when 'switch_self' then 2 when 'boost' then 2
              when 'tool_hp' then 2 when 'tool_reduce' then 2 when 'tool_boost' then 2 when 'tool_retaliate' then 2
              when 'rare_candy' then case when v_stage2_lines > 0 then 4 else -9 end
              else 1 end), 0)
             - case when c.trainer->'fx' @> '[{"op": "end_turn"}]' or c.trainer->'fx' @> '[{"op": "discard_cost"}]' then 9 else 0 end
           from jsonb_array_elements(c.trainer->'fx') o) as score
        from public.cards c
        join public.sets s on s.id = c.set_id
        where c.supertype = 'Trainer' and coalesce((c.trainer->>'playable')::boolean, false)
          and case
            when p_format = 'all' then true
            when p_format like 'era:%' then s.series = substring(p_format from 5)
            when p_format like 'set:%' then coalesce(s.parent_set_id, s.id) = substring(p_format from 5)
            else false end
          and (v_series is null or s.series = any(v_series))
        order by c.name, random()
      ) t
      where t.card is not null and t.score > 0
      order by t.score + random() * 1.5 desc
    loop
      exit when jsonb_array_length(v_tdeck) >= v_trainers;
      continue when (v_pick->>'ace_spec')::boolean and exists (select 1 from jsonb_array_elements(v_tdeck) c where (c->>'ace_spec')::boolean);
      v_tdeck := v_tdeck || case when (v_pick->>'ace_spec')::boolean or jsonb_array_length(v_tdeck) + 1 = v_trainers
                                 then jsonb_build_array(v_pick) else jsonb_build_array(v_pick, v_pick) end;
    end loop;
    v_deck := v_deck || v_tdeck;
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

set local application_name = 'migration 0032: step 5/5 RPCs';


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
          where v_my_turn and v_turn > 2 and p_g->'a'->'cards'->h.c->>'stage' = 'evolution'
            and public.pvp_top(p_g, 'a', public.pvp_slot(p_g, 'a', p))->>'name' = p_g->'a'->'cards'->h.c->>'evolves_from'
            and (public.pvp_slot(p_g, 'a', p)->>'turn_in')::int < v_turn), '[]')))
      from (select distinct (x #>> '{}')::int as c from jsonb_array_elements(p_g->'a'->'hand') x) h), '{}'),
    'retreat', v_my_turn and v_active is not null and not (p_g->'a'->>'retreated')::boolean
               and jsonb_array_length(p_g->'a'->'bench') > 0
               and coalesce(v_active->>'status', '') not in ('asleep', 'paralyzed')
               and (v_active->>'no_retreat')::int is distinct from v_turn
               and (v_active->>'energy')::int >= public.pvp_retreat_cost(p_g, 'a', 0),
    'retreat_cost', case when v_active is not null then public.pvp_retreat_cost(p_g, 'a', 0) end,
    -- attack index -> null (can) or why not
    'attacks', case when v_active is null then '[]'::jsonb else coalesce((
      select jsonb_agg(case when v_my_turn then public.pvp_attack_block(p_g, 'a', i) else 'not_your_turn' end order by i)
      from generate_series(0, jsonb_array_length(public.pvp_top(p_g, 'a', v_active)->'attacks') - 1) i), '[]') end
  );
end;
$$;

set local application_name = 'migration 0030: step 6/6 RPCs';

-- A slot as the client sees it: its card (and the ones under it) + HP left
create or replace function public.pvp_slot_view(p_g jsonb, p_side text, p_slot jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p_slot is null then null else p_slot || jsonb_build_object(
    'card', public.pvp_top(p_g, p_side, p_slot),
    'hp_left', public.pvp_hp_left(p_g, p_side, p_slot),
    -- its Tool and its HP with it (0032)
    'tool_card', public.pvp_tool(p_g, p_side, p_slot),
    'hp_max', (public.pvp_top(p_g, p_side, p_slot)->>'hp')::int + public.pvp_tool_n(p_g, p_side, p_slot, 'tool_hp')) end
$$;

-- Events with the names the log shows: the card (`c`) and the attack (`i`),

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
      'next', g->v_side->'next',
      -- this turn's Trainers (0032)
      'supporter_used', coalesce((g->v_side->>'supporter_used')::boolean, false),
      'boost', case when (g->v_side->'boost'->>'turn')::int = (g->>'turn')::int then (g->v_side->'boost'->>'n')::int else 0 end,
      'shield', case when (g->v_side->'shield'->>'turn')::int >= (g->>'turn')::int then (g->v_side->'shield'->>'n')::int else 0 end));
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
                        from jsonb_array_elements(g->'a'->'hand') with ordinality h(x, n)), '[]'),
      -- what my deck holds (sorted: not its order) and my discard pile, as card indexes, for my Trainers' picks (0032)
      'deck_ids', coalesce((select jsonb_agg(x order by (x #>> '{}')::int) from jsonb_array_elements(g->'a'->'deck') x), '[]'),
      'discard_ids', coalesce(g->'a'->'discard', '[]')),
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
        where c.user_id = v_user and c.mode = 'challenge'
          and ((k.supertype = 'Pokémon' and k.hp > 0) or (k.supertype = 'Trainer' and coalesce((k.trainer->>'playable')::boolean, false)))
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

-- Internal: not callable by clients
revoke execute on function public.pvp_trainer_card(text) from public, anon, authenticated;
revoke execute on function public.pvp_without(jsonb, int) from public, anon, authenticated;
revoke execute on function public.pvp_shuffle(jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_matches(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_tool(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_tool_n(jsonb, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.pvp_retreat_cost(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_ai_keep(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_trainer_block(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.pvp_pick(jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_opt_pos(jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.pvp_trainer(jsonb, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public.pvp_ai_wants(jsonb, text, int, text, text) from public, anon, authenticated;
revoke execute on function public.pvp_ai_trainers(jsonb, text, text, text) from public, anon, authenticated;

set local application_name = 'migration 0032: done, committing';
