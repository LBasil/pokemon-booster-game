-- Pokémon Booster Game — Challenge: bot battles start again
-- Run after 0033_pvp_abilities.sql.
--
-- User, 2026-10-05: starting a bot battle showed "challenge.errors.21000".
-- Postgres error 21000 here is "UPDATE requires a WHERE clause": the API
-- (PostgREST) runs with Supabase's pg-safeupdate extension, which refuses an
-- UPDATE or DELETE without a WHERE, even on a temporary table inside a
-- function. pvp_bot_deck() (0031, again in 0032) reset its scores with
-- `update pvp_bot_cards set score = null;`, so every pvp_bot_start() failed,
-- at every level. PGlite (npm run test:db) has no pg-safeupdate, so the
-- suites passed; the 0034 suite now scans every function for such a
-- statement.
--
-- 1. pvp_bot_deck(format, level, my cards): 0032's body, the reset gets a
--    WHERE. Nothing else changes.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Bots' decks ----------

set local application_name = 'migration 0034: step 1/1 pvp_bot_deck';

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

set local application_name = 'migration 0034: done, committing';
