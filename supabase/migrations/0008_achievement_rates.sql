-- Pokémon Booster Game — Achievement rates ("12% of players have it")
-- Run after 0007_challenge_trades.sql.
--
-- Achievements are computed in the browser from the unlimited collection
-- (src/utils/achievements.js), so new ones need no migration. To show how
-- rare each one is, players' clients report what they've unlocked:
--
--   achievement_unlocks                 (user, achievement id, first seen)
--                                       no client access at all
--   record_achievements(ids text[])     adds the caller's unlocked ids
--                                       (never removes: the unlimited
--                                       collection only grows)
--   achievement_rates()                 per achievement: holders + players,
--                                       anonymous counts, readable by anyone
--
-- Trust: the ids are reported by the client, which the server can't
-- re-check without duplicating every achievement in SQL. A player tampering
-- with their client could only nudge an anonymous percentage — nothing
-- ranks or rewards on it. To limit that, only players who own unlimited
-- cards count (holders and players alike), ids must look like ids, and one
-- call records at most 500 of them.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Table ----------

set local application_name = 'migration 0008: step 1/3 achievement_unlocks';

create table if not exists public.achievement_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null check (achievement_id ~ '^[A-Za-z0-9_]{1,48}$'),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create index if not exists achievement_unlocks_id_idx on public.achievement_unlocks (achievement_id);

-- RLS on and no policy: clients go through the two functions below only
alter table public.achievement_unlocks enable row level security;
revoke all on public.achievement_unlocks from anon, authenticated;

-- ---------- 2. Recording ----------

set local application_name = 'migration 0008: step 2/3 record_achievements';

create or replace function public.record_achievements(p_ids text[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_added int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'too_many_achievements';
  end if;

  insert into public.achievement_unlocks (user_id, achievement_id)
  select distinct v_user, id
  from unnest(coalesce(p_ids, '{}')) as id
  where id ~ '^[A-Za-z0-9_]{1,48}$'
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- ---------- 3. Rates ----------

set local application_name = 'migration 0008: step 3/3 achievement_rates';

-- Players = accounts owning at least one unlimited card. Every achievement
-- held by someone gets a row; the others are at 0%.
create or replace function public.achievement_rates()
returns table (achievement_id text, holders int, players int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with players as (
    select distinct user_id from public.collections where mode = 'unlimited'
  ),
  total as (
    select count(*)::int as n from players
  )
  select a.achievement_id, count(*)::int, (select n from total)
  from public.achievement_unlocks a
  join players p on p.user_id = a.user_id
  group by a.achievement_id;
$$;

revoke execute on function public.record_achievements(text[]) from public, anon;
revoke execute on function public.achievement_rates() from public;
grant execute on function public.record_achievements(text[]) to authenticated;
grant execute on function public.achievement_rates() to anon, authenticated;

set local application_name = 'migration 0008: done, committing';
