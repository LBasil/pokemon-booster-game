-- Pokémon Booster Game — Challenge: PvP closed to everyone but its testers
-- Run after 0027_pvp_bots.sql.
--
-- User, 2026-10-05: "bloque le PvP uniquement pour le joueur Bazouk" (only
-- Bazouk keeps it): a bot battle was won in two rounds by always picking the
-- biggest affordable attack, no real choice to make. PvP stays playable for
-- its testers while the rules are reworked; everyone else sees "Coming soon".
--
-- 1. pvp_open_to(user): the one switch. True for the usernames listed here
--    (case-insensitive). Mirrored in src/utils/pvp.js (PVP_TESTERS) —
--    change both together. To open PvP to everyone again: make it return
--    true (and empty PVP_TESTERS).
-- 2. The entry points are renamed to *_impl (bodies untouched, no longer
--    callable by clients) and replaced by a wrapper that checks first:
--      pvp_state()        not a tester -> { ready: false } ("Coming soon")
--      pvp_save_deck, pvp_start, pvp_bot_start -> error pvp_closed
--    pvp_play / pvp_forfeit stay open: a battle started before this
--    migration can still end. pvp_eligible / pvp_leaderboard only read.
--    Players who built a defense deck before can still be drawn as
--    opponents by a tester (their Elo moves, as before).
--    A later migration that redefines one of these 4 functions must
--    redefine its *_impl (or drop the wrapper on purpose): re-running
--    0024-0027 after this one would silently reopen PvP.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. The switch ----------

set local application_name = 'migration 0028: step 1/3 pvp_open_to';

create or replace function public.pvp_open_to(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and lower(p.username) in ('bazouk')
  )
$$;

-- ---------- 2. Wrappers ----------

set local application_name = 'migration 0028: step 2/3 wrappers';

-- Rename once (a second run finds the *_impl already there)
do $$
begin
  if to_regprocedure('public.pvp_state_impl()') is null then
    alter function public.pvp_state() rename to pvp_state_impl;
  end if;
  if to_regprocedure('public.pvp_save_deck_impl(text, text[], text)') is null then
    alter function public.pvp_save_deck(text, text[], text) rename to pvp_save_deck_impl;
  end if;
  if to_regprocedure('public.pvp_start_impl(text)') is null then
    alter function public.pvp_start(text) rename to pvp_start_impl;
  end if;
  if to_regprocedure('public.pvp_bot_start_impl(text, text)') is null then
    alter function public.pvp_bot_start(text, text) rename to pvp_bot_start_impl;
  end if;
end;
$$;

create or replace function public.pvp_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pvp_open_to(public.require_player()) then
    return jsonb_build_object('ready', false);
  end if;
  return public.pvp_state_impl();
end;
$$;

create or replace function public.pvp_save_deck(p_format text, p_cards text[], p_role text default 'attack')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pvp_open_to(public.require_player()) then
    raise exception 'pvp_closed';
  end if;
  return public.pvp_save_deck_impl(p_format, p_cards, p_role);
end;
$$;

create or replace function public.pvp_start(p_format text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pvp_open_to(public.require_player()) then
    raise exception 'pvp_closed';
  end if;
  return public.pvp_start_impl(p_format);
end;
$$;

create or replace function public.pvp_bot_start(p_format text, p_level text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pvp_open_to(public.require_player()) then
    raise exception 'pvp_closed';
  end if;
  return public.pvp_bot_start_impl(p_format, p_level);
end;
$$;

-- ---------- 3. Grants ----------

set local application_name = 'migration 0028: step 3/3 grants';

revoke execute on function public.pvp_open_to(uuid) from public, anon, authenticated;
revoke execute on function public.pvp_state_impl() from public, anon, authenticated;
revoke execute on function public.pvp_save_deck_impl(text, text[], text) from public, anon, authenticated;
revoke execute on function public.pvp_start_impl(text) from public, anon, authenticated;
revoke execute on function public.pvp_bot_start_impl(text, text) from public, anon, authenticated;
revoke execute on function public.pvp_state() from public, anon;
revoke execute on function public.pvp_save_deck(text, text[], text) from public, anon;
revoke execute on function public.pvp_start(text) from public, anon;
revoke execute on function public.pvp_bot_start(text, text) from public, anon;
grant execute on function public.pvp_state() to authenticated;
grant execute on function public.pvp_save_deck(text, text[], text) to authenticated;
grant execute on function public.pvp_start(text) to authenticated;
grant execute on function public.pvp_bot_start(text, text) to authenticated;

set local application_name = 'migration 0028: done, committing';
