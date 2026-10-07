-- Pokémon Booster Game — Challenge: PvP battles open to every player (alpha)
-- Run after 0036_pvp_bot_speed_energy.sql.
--
-- User, 2026-10-07: "Ouvre le PvP à tout le monde mais précise avec un badge
-- que c'est en bêta voire alpha et que ça peut changer".
-- pvp_open_to(user), 0028's switch (every PvP RPC checks it inline since
-- 0030), now answers true for any signed-in player. Mirrored in
-- src/utils/pvp.js (PVP_TESTERS = null): change both together. The client
-- shows an "Alpha" tag on the PvP page and its game tiles.
-- To close it to testers again: list their usernames here, as in 0028.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

set local application_name = 'migration 0037: step 1/1 pvp_open_to';

create or replace function public.pvp_open_to(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
$$;

-- Internal: not callable by clients (as in 0028)
revoke execute on function public.pvp_open_to(uuid) from public, anon, authenticated;
set local application_name = 'migration 0037: done, committing';
