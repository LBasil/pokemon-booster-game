-- Pokémon Booster Game — Challenge: bot battles start fast, bots attach their energy better
-- Run after 0035_pvp_easy_bot.sql.
--
-- 1. User, 2026-10-06: "ça prend 4s quand je demande à affronter un bot".
--    Timed live through REST (service role): pvp_bot_deck('all', ...) took
--    4.5 s, the Sword & Shield era 1.2 s, the Base era 0.5 s. The same
--    function on a PGlite copy of the real cards: 0.4 s, 0.35 s, 0.08 s.
--    Live is slower everywhere, but 11x for 'all' against 3-6x for the
--    others: the pool's query is estimated at pvp_card() (cost 100) x every
--    Pokémon of the format (17,464 for 'all'), past the thresholds where
--    Postgres JIT-compiles and optimizes a query, which PGlite never does.
--    pvp_bot_deck(format, level, my cards): 0035's body, same deck, plus
--    - `set jit = off` on the function (the pool's cards were already built
--      after the ORDER BY random() LIMIT 2000: EXPLAIN shows it);
--    - my deck's strength values each of my cards once: pvp_card_value()
--      sat inside the count over the pool, 2000 times per card (0.85 s ->
--      0.4 s with a 20-card deck, PGlite with the real cards).
-- 2. Same day: "je suis pas sûr de comment j'ai battu le bot". The log: the
--    easy bot's Raichu-GX stayed Active 4 turns without attacking. The AI
--    gave the zone's energy to the Pokémon it brought closest to its
--    hardest-hitting attack only: a Fire can't help Thunder (2 Lightning),
--    so it went to the Bench, though it opened Powerful Spark (2 Colorless).
--    pvp_ai_turn(game, side, level): 0035's body, the energy now goes where
--    it helps any usable attack (the Active first, the attack it makes
--    payable now first), and 'easy''s 1-in-4 random attach no longer
--    happens when the energy lets its Active attack this turn.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Bots' decks ----------

set local application_name = 'migration 0036: step 1/2 pvp_bot_deck';

create or replace function public.pvp_bot_deck(p_format text, p_level text, p_mine jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
-- no JIT: the estimated cost of the pool (pvp_card() x every Pokémon of the
-- format) set off a JIT compile that took seconds live, not in PGlite (0036)
set jit = off
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
    -- each of my cards valued once: inside the count it was valued once per
    -- card of the pool, 40,000 times for a 20-card deck (0036)
    select avg((select count(*) from pvp_bot_cards b where b.value < mine.value)::numeric
               / greatest((select count(*) from pvp_bot_cards), 1))
    into v_strength
    from (
      select public.pvp_card_value(m) as value
      from jsonb_array_elements(p_mine) m
      where m->>'stage' <> 'trainer' -- Trainers have no strength of their own (0032)
      offset 0 -- keeps pvp_card_value() here, out of the count
    ) mine;
  end if;
  v_target := case
    when v_strength is null then case p_level when 'easy' then 0.4 when 'normal' then 0.55 else 0.95 end
    else least(greatest(case p_level when 'easy' then v_strength * 0.85 when 'normal' then v_strength - 0.05 else v_strength + 0.1 end, 0.05), 0.98) end;

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
    -- with a WHERE: Supabase refuses an UPDATE without one (pg-safeupdate, 0034)
    update pvp_bot_cards set score = null where score is not null;
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

-- Internal: not callable by clients (as in 0031)
revoke execute on function public.pvp_bot_deck(text, text, jsonb) from public, anon, authenticated;


-- ---------- 2. The AI's energy ----------

set local application_name = 'migration 0036: step 2/2 pvp_ai_turn';

-- A whole turn of the server's side (0035's, 0036 changes the energy):
-- Trainers, abilities, evolve, fill the Bench, retreat when it pays, attach
-- the energy where it's needed most, attack (the best expected hit) or end
-- the turn. 'easy' never retreats, attaches anywhere 1 time in 4 and
-- hesitates a lot between attacks; 'normal' a little, 'hard' barely.
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
  v_after int;
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
  -- closer (the Active first, then the Benched Pokémon closest to one), else
  -- the Active. Since 0036 every usable attack counts, the one it makes
  -- payable now first: it only looked at the hardest-hitting one, so a
  -- Raichu-GX waiting for 2 Lightning sent its Fire to the Bench for 4 turns
  -- instead of using the 2-Colorless attack it opened (live, 2026-10-06).
  -- 'easy' attaches anywhere 1 time in 4, unless the energy lets its Active
  -- attack this turn.
  if v_turn > 1 and not (g->p_side->>'attached')::boolean and jsonb_typeof(g->p_side->'zone') = 'string' then
    select p, need.after into v_pos, v_after from public.pvp_positions(g, p_side) p
    cross join lateral (select public.pvp_slot(g, p_side, p) as slot) s
    -- the attack this energy helps most: payable after it, then the hardest hitting
    cross join lateral (
      select m.after from (
        select public.pvp_missing(s.slot->'etypes', a->'energy', (a->>'cost')::int) as before,
               public.pvp_missing(s.slot->'etypes' || (g->p_side->'zone'), a->'energy', (a->>'cost')::int) as after,
               (a->>'base')::int as base, (a->>'cost')::int as cost
        from jsonb_array_elements(public.pvp_top(g, p_side, s.slot)->'attacks') a
        where (a->>'usable')::boolean) m
      where m.after < m.before
      order by m.after = 0 desc, m.base desc, m.cost desc
      limit 1) need
    order by p = 0 desc, need.after, p
    limit 1;
    if v_easy and random() < 0.25 and not coalesce(v_pos = 0 and v_after = 0, false) then
      select p into v_pos from public.pvp_positions(g, p_side) p order by random() limit 1;
    end if;
    -- it helps no one: the Active (retreat costs, evolutions to come)
    v_pos := coalesce(v_pos, (select min(p) from public.pvp_positions(g, p_side) p));
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
      v_value := public.pvp_ai_attack_value(g, p_side, i) + random() * case p_level when 'hard' then 2 when 'normal' then 15 else 40 end;
      if v_best_value is null or v_value > v_best_value then
        v_best := i;
        v_best_value := v_value;
      end if;
    end loop;
  end if;
  if v_best is not null and v_best_value > 0 then
    return public.pvp_do(g, p_side, jsonb_build_object('type', 'attack', 'attack', v_best));
  end if;
  return public.pvp_do(g, p_side, jsonb_build_object('type', 'end'));
end;
$$;

-- Internal: not callable by clients (as in 0030)
revoke execute on function public.pvp_ai_turn(jsonb, text, text) from public, anon, authenticated;
set local application_name = 'migration 0036: done, committing';
