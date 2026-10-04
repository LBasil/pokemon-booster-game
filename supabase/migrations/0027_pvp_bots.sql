-- Pokémon Booster Game — Challenge: PvP against bots, for coins
-- Run after 0026_pvp_attack_defense_decks.sql.
--
-- User, 2026-10-04: "met un pvp contre des bots, lui il donne des pièces au
-- pire, j'ai pas assez de joueurs". With few players, "Find an opponent"
-- often answered pvp_no_opponent. A bot battle is the same battle (same
-- rules, same pvp_play / pvp_forfeit, same defender AI), against a deck the
-- server deals from every card of the format, not from a player.
--
-- Rules (mirrored in src/utils/pvp.js — change both together):
--   - Levels: easy, normal, hard. The bot's deck = 5 cards with different
--     names, drawn from 400 random fighting cards of the format, ranked like
--     autoDeck() (damage per energy, best hit, HP per prize) into 5 tiers:
--     easy takes tier 2, normal tier 4, hard tier 5 (the closest tiers when
--     there aren't 5 names there).
--   - No Elo (a bot isn't a player: the ratings and the leaderboard stay
--     player against player), and bot battles don't use the 10 daily attacks.
--   - Coins: a win pays 10 / 25 / 50 (easy / normal / hard), a draw half
--     (rounded down), a loss or giving up nothing. Only the first 5 bot
--     battles started each game day pay (decided at the start: giving up
--     doesn't give the slot back); 20 bot battles a day in all. At most
--     250 coins a day, close to the other mini-games (180-300).
--   - One battle at a time, bot or player (the same "in progress" slot).
--
-- 1. pvp_battles: `defender` may be null (a bot battle), `bot` (its level),
--    `paid`, `coins` (paid at the end); one of defender / bot is set.
--    challenge_ledger.kind accepts 'pvp_bot' (one row per paying battle, so
--    coins_earned in player_achievements() counts it).
-- 2. Functions:
--      pvp_rules()                    + bot_levels, bot_coins, bot_paid_per_day,
--                                     bot_battles_per_day
--      pvp_bot_deck(format, level)    (internal) the bot's 5 card snapshots
--      pvp_finish                     a bot battle: coins instead of Elo
--      pvp_battle_view                + bot, paid, coins (opponent.bot)
--      pvp_state()                    battles_left = player battles only;
--                                     + bot_battles_left, bot_paid_left, coins
--                                     (wallet); history entries + bot, coins
--      pvp_start(format)              counts player battles only; the last
--                                     opponent is the last player
--      pvp_bot_start(format, level)   new: starts a bot battle with my attack
--                                     deck (or returns the battle in progress)
--    pvp_play and pvp_forfeit are unchanged (they call pvp_finish).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Battles, ledger ----------

set local application_name = 'migration 0027: step 1/2 bot battles';

alter table public.pvp_battles alter column defender drop not null;
alter table public.pvp_battles add column if not exists bot text;
alter table public.pvp_battles add column if not exists paid boolean not null default false;
alter table public.pvp_battles add column if not exists coins int;
alter table public.pvp_battles drop constraint if exists pvp_battles_bot_check;
alter table public.pvp_battles add constraint pvp_battles_bot_check check (bot is null or bot in ('easy', 'normal', 'hard'));
alter table public.pvp_battles drop constraint if exists pvp_battles_opponent_check;
alter table public.pvp_battles add constraint pvp_battles_opponent_check check ((defender is null) = (bot is not null));
create index if not exists pvp_battles_bot_day_idx on public.pvp_battles (attacker, game_day) where bot is not null;

alter table public.challenge_ledger drop constraint if exists challenge_ledger_kind_check;
alter table public.challenge_ledger add constraint challenge_ledger_kind_check
  check (kind in ('start', 'daily', 'booster', 'recycle', 'craft', 'mission', 'minigame', 'electrode_flip', 'super_effective',
                  'evolution_chain', 'pvp_bot'));

-- ---------- 2. Functions ----------

set local application_name = 'migration 0027: step 2/2 functions';

create or replace function public.pvp_rules()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('deck_size', 5, 'prizes_to_win', 3, 'max_rounds', 20, 'battles_per_day', 10,
    'start_energy', 1, 'energy_per_round', 1, 'max_energy', 5,
    'start_elo', 1000, 'k_factor', 32, 'weakness_multiplier', 2, 'resistance', 30, 'min_damage', 10,
    'bot_levels', jsonb_build_array('easy', 'normal', 'hard'),
    'bot_coins', jsonb_build_object('easy', 10, 'normal', 25, 'hard', 50),
    'bot_paid_per_day', 5, 'bot_battles_per_day', 20)
$$;

-- A bot's deck in a format: 5 card snapshots with different names, or null
-- if the format has fewer. 400 random cards that can fight, scored like
-- autoDeck() (src/utils/pvp.js, attack weights), cut in 5 tiers; the level
-- picks the tier, the closest ones fill in.
create or replace function public.pvp_bot_deck(p_format text, p_level text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with sample as (
    select c.id
    from public.cards c
    join public.sets s on s.id = c.set_id
    where c.supertype = 'Pokémon' and c.hp > 0 and case
      when p_format = 'all' then true
      when p_format like 'era:%' then s.series = substring(p_format from 5)
      when p_format like 'set:%' then coalesce(s.parent_set_id, s.id) = substring(p_format from 5)
      else false end
    order by random()
    limit 400
  ),
  pool as (
    select x.card from (select public.pvp_card(s.id) as card from sample s) x where x.card is not null
  ),
  stats as (
    select p.card, a.per_energy, a.burst, (p.card->>'hp')::numeric / greatest((p.card->>'prizes')::int, 1) as bulk
    from pool p
    cross join lateral (
      select max(e.dmg / greatest((t->>'cost')::int, 1)) as per_energy, max(e.dmg) as burst
      from jsonb_array_elements(p.card->'attacks') t
      cross join lateral (select (t->>'damage')::numeric * case when (t->>'times')::boolean then 2 else 1 end as dmg) e
    ) a
  ),
  scored as (
    select s.card,
      s.per_energy / nullif(max(s.per_energy) over (), 0)
        + 0.5 * s.burst / nullif(max(s.burst) over (), 0)
        + 0.7 * s.bulk / nullif(max(s.bulk) over (), 0) as score
    from stats s
  ),
  tiered as (
    select sc.card, ntile(5) over (order by sc.score, random()) as tier from scored sc
  ),
  -- one card per name, the closest to the level's tier
  named as (
    select distinct on (t.card->>'name') t.card, abs(t.tier - case p_level when 'easy' then 2 when 'normal' then 4 else 5 end) as gap
    from tiered t
    order by t.card->>'name', abs(t.tier - case p_level when 'easy' then 2 when 'normal' then 4 else 5 end), random()
  ),
  deck as (
    select n.card from named n order by n.gap, random() limit (public.pvp_rules()->>'deck_size')::int
  )
  select case when count(*) = (public.pvp_rules()->>'deck_size')::int then jsonb_agg(d.card) end from deck d
$$;

-- Ends a battle. Against a player: status + both ratings (locked in user id
-- order: two players attacking each other at once can't deadlock). Against
-- a bot: status + the coins of a paid battle, no Elo.
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
  v_coins int;
  v_score numeric := case p_status when 'won' then 1 when 'draw' then 0.5 else 0 end;
begin
  select * into v_battle from public.pvp_battles b where b.id = p_battle_id;

  if v_battle.bot is not null then
    v_coins := case when v_battle.paid
      then floor((public.pvp_rules()->'bot_coins'->>v_battle.bot)::int * case p_status when 'won' then 1 when 'draw' then 0.5 else 0 end)::int
      else 0 end;
    if v_coins > 0 then
      update public.challenge_wallets set coins = coins + v_coins where user_id = v_battle.attacker;
      insert into public.challenge_ledger (user_id, kind, amount, game_day)
      values (v_battle.attacker, 'pvp_bot', v_coins, v_battle.game_day);
    end if;
    update public.pvp_battles b set status = p_status, elo_change = 0, coins = v_coins, ended_at = now(), d_next = null, d_next_attack = null
    where b.id = p_battle_id;
    return;
  end if;

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
    'bot', p_battle.bot,
    'paid', p_battle.paid,
    'coins', p_battle.coins,
    'opponent', jsonb_build_object(
      'bot', p_battle.bot,
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
  v_bots_today int;
begin
  select * into v_battle from public.pvp_battles b where b.attacker = v_user and b.status = 'playing';
  select count(*) into v_bots_today from public.pvp_battles b
  where b.attacker = v_user and b.bot is not null and b.game_day = public.challenge_today();
  select * into v_wallet from public.challenge_wallets w where w.user_id = v_user;

  return v_rules || jsonb_build_object(
    'ready', exists (select 1 from public.cards c where c.attacks -> 0 ? 'cost')
             and exists (select 1 from public.sets s where s.series is not null),
    -- against players (bots don't use them)
    'battles_left', greatest((v_rules->>'battles_per_day')::int - (
      select count(*) from public.pvp_battles b
      where b.attacker = v_user and b.bot is null and b.game_day = public.challenge_today()), 0),
    'bot_battles_left', greatest((v_rules->>'bot_battles_per_day')::int - v_bots_today, 0),
    'bot_paid_left', greatest((v_rules->>'bot_paid_per_day')::int - v_bots_today, 0),
    'coins', v_wallet.coins,
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
    -- my last 10 battles, attacks, defenses and bots, from my side
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

-- The attack deck I fight with in a format (snapshots), or an error
create or replace function public.pvp_my_attack_deck(p_user uuid, p_format text)
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
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_rules jsonb := public.pvp_rules();
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
  if (select count(*) from public.pvp_battles b
      where b.attacker = v_user and b.bot is null and b.game_day = public.challenge_today())
     >= (v_rules->>'battles_per_day')::int then
    raise exception 'pvp_no_battles_left';
  end if;

  v_mine := public.pvp_my_attack_deck(v_user, p_format);
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

  v_hp := (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_foe.cards) with ordinality x(c, n));
  select * into v_pick from public.pvp_defender_pick(v_foe.cards, v_hp, (v_rules->>'start_energy')::int, null);

  insert into public.pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, a_energy, d_energy, d_next, d_next_attack)
  values (v_user, v_foe.user_id, p_format, v_mine, v_foe.cards,
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_mine) with ordinality x(c, n)),
    v_hp, (v_rules->>'start_energy')::int, (v_rules->>'start_energy')::int, v_pick.pick_slot, v_pick.pick_attack);

  return public.pvp_state();
end;
$$;

-- A battle against a bot of that level, with my attack deck
create or replace function public.pvp_bot_start(p_format text, p_level text)
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
  v_mine jsonb;
  v_bot jsonb;
  v_today int;
  v_hp int[];
  v_pick record;
begin
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

  v_mine := public.pvp_my_attack_deck(v_user, p_format);
  v_bot := public.pvp_bot_deck(p_format, p_level);
  if v_bot is null then
    raise exception 'pvp_no_bot_deck';
  end if;

  v_hp := (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_bot) with ordinality x(c, n));
  select * into v_pick from public.pvp_defender_pick(v_bot, v_hp, (v_rules->>'start_energy')::int, null);

  insert into public.pvp_battles (attacker, defender, bot, paid, format, a_deck, d_deck, a_hp, d_hp, a_energy, d_energy, d_next, d_next_attack)
  values (v_user, null, p_level, v_today < (v_rules->>'bot_paid_per_day')::int, p_format, v_mine, v_bot,
    (select array_agg((c->>'hp')::int order by n) from jsonb_array_elements(v_mine) with ordinality x(c, n)),
    v_hp, (v_rules->>'start_energy')::int, (v_rules->>'start_energy')::int, v_pick.pick_slot, v_pick.pick_attack);

  return public.pvp_state();
end;
$$;

revoke execute on function public.pvp_bot_deck(text, text) from public, anon, authenticated;
revoke execute on function public.pvp_my_attack_deck(uuid, text) from public, anon, authenticated;
revoke execute on function public.pvp_finish(bigint, text) from public, anon, authenticated;
revoke execute on function public.pvp_battle_view(public.pvp_battles) from public, anon, authenticated;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
revoke execute on function public.pvp_bot_start(text, text) from public, anon;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
grant execute on function public.pvp_bot_start(text, text) to authenticated;
