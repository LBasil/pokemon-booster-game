-- Pokémon Booster Game — Challenge: PvP attack and defense decks, no free attacks
-- Run after 0025_pvp_energy_prizes.sql.
--
-- User, 2026-10-04: "certaines cartes semblent encore avoir des coûts nuls
-- alors que c'est faux, genre une attaque à trois énergies marquée 0" and
-- "on doit séparer le deck d'attaque et de défense".
--
-- 1. No free attacks by mistake. cards.attacks entries only get a `cost`
--    from a sync run after 0025, and the 2026-10-04 midnight sync stopped
--    halfway (scripts/populate.mjs now goes on past a failing page): ~7,400
--    cards still had attacks without a cost, read as 0. pvp_card() now
--    drops an attack without a `cost` (a card left with none can't fight)
--    instead of making it free. A printed cost of 0 stays 0.
-- 2. Two decks per format: `pvp_decks.role` ('attack' | 'defense'). The
--    attack deck is the one I play with (pvp_start); the defense deck is
--    the one the server plays when someone attacks me. Until I save a
--    defense deck (or while it's no longer valid), my attack deck defends,
--    like before. The same card can be in both.
-- 3. Functions:
--      pvp_card                          (1.)
--      pvp_save_deck(format, cards, role) role defaults to 'attack' (the
--                                        0024 signature is replaced)
--      pvp_state()                       decks: { format: { attack, defense } },
--                                        each { cards, valid } or absent
--      pvp_start(format)                 attacks with my attack deck, draws
--                                        opponents' defense decks
--    The other PvP functions are unchanged.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Decks: a role ----------

set local application_name = 'migration 0026: step 1/2 deck roles';

alter table public.pvp_decks add column if not exists role text not null default 'attack';
alter table public.pvp_decks drop constraint if exists pvp_decks_role_check;
alter table public.pvp_decks add constraint pvp_decks_role_check check (role in ('attack', 'defense'));
alter table public.pvp_decks drop constraint if exists pvp_decks_pkey;
alter table public.pvp_decks add primary key (user_id, format, role);

-- ---------- 2. Functions ----------

set local application_name = 'migration 0026: step 2/2 functions';

drop function if exists public.pvp_save_deck(text, text[]);

-- A card as a battle sees it, or null if it can't fight (not a Pokémon,
-- no HP, no attack that deals damage with a known cost). `attacks` = the
-- damaging ones, cheapest first: { name, damage, times ("20×"), cost }
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
        least(greatest((y->>'cost')::int, 0), (public.pvp_rules()->>'max_energy')::int) as cost, n
      from jsonb_array_elements(case when jsonb_typeof(c.attacks) = 'array' then c.attacks else '[]' end) with ordinality z(y, n)
      -- imported before 0025 (no cost yet): unknown, never free
      where jsonb_typeof(y->'cost') = 'number'
    ) x
    where coalesce(x.damage, 0) > 0
  ) a
  where c.id = p_id and c.supertype = 'Pokémon' and c.hp > 0 and a.attacks is not null
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
    -- { format: { attack: { cards, valid }, defense: { cards, valid } } }, a missing role = not saved
    'decks', coalesce((
      select jsonb_object_agg(f.format, f.roles)
      from (
        select d.format, jsonb_object_agg(d.role, jsonb_build_object(
          'cards', (select jsonb_agg(public.pvp_card(i.id) order by i.n) from unnest(d.card_ids) with ordinality i(id, n)),
          'valid', public.pvp_deck_cards(v_user, d.format, d.card_ids) is not null)) as roles
        from public.pvp_decks d where d.user_id = v_user
        group by d.format) f), '{}'),
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

create or replace function public.pvp_save_deck(p_format text, p_cards text[], p_role text default 'attack')
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

  select * into v_deck from public.pvp_decks d where d.user_id = v_user and d.format = p_format and d.role = 'attack';
  if not found then
    raise exception 'pvp_no_deck';
  end if;
  v_mine := public.pvp_deck_cards(v_user, p_format, v_deck.card_ids);
  if v_mine is null then
    raise exception 'pvp_invalid_deck';
  end if;
  v_me := public.pvp_rating(v_user, p_format);
  select b.defender into v_last from public.pvp_battles b where b.attacker = v_user order by b.created_at desc limit 1;

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

  v_hp := (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_foe.cards) with ordinality x(c, n));
  select * into v_pick from public.pvp_defender_pick(v_foe.cards, v_hp, (v_rules->>'start_energy')::int, null);

  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, a_energy, d_energy, d_next, d_next_attack)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards,
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_mine) with ordinality x(c, n)),
    v_hp, (v_rules->>'start_energy')::int, (v_rules->>'start_energy')::int, v_pick.pick_slot, v_pick.pick_attack);

  return public.pvp_state();
end;
$$;

revoke execute on function public.pvp_card(text) from public, anon, authenticated;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_save_deck(text, text[], text) from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_save_deck(text, text[], text) to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
