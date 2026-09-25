-- Pokémon Booster Game — Achievements per game mode
-- Run after 0008_achievement_rates.sql.
--
-- Achievements now exist in both modes, each computed from its own
-- collection (the challenge one is the one that counts: every pack costs
-- coins). This migration:
--
-- 1. achievement_unlocks gains a mode ('unlimited' | 'challenge'); existing
--    rows are unlimited. Primary key (user_id, mode, achievement_id).
-- 2. record_achievements(ids, mode) and achievement_rates(mode): same as
--    0008, per mode (mode defaults to 'unlimited', so a 0008 client keeps
--    working).
-- 3. player_achievements(mode, username?): what the server knows that the
--    collection alone doesn't tell, as jsonb { unlocked: [...], packs: n }:
--      unlocked  ids already recorded: an achievement stays unlocked even
--                when the collection shrinks (challenge recycling, trades)
--      packs     boosters opened in that mode (booster_openings): the
--                challenge collection can't tell it (recycling, crafting)
--    Without a username: the caller's own. With one: a public profile's
--    (or your own), null when it doesn't exist or is private.
--
-- Same trust model as 0008 for the recorded ids (see there).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Mode column ----------

set local application_name = 'migration 0009: step 1/3 mode column';

alter table public.achievement_unlocks
  add column if not exists mode text not null default 'unlimited'
  check (mode in ('unlimited', 'challenge'));

do $$
begin
  -- 0008's key was (user_id, achievement_id): widen it once
  if (
    select i.indnatts
    from pg_index i
    where i.indrelid = 'public.achievement_unlocks'::regclass and i.indisprimary
  ) = 2 then
    alter table public.achievement_unlocks drop constraint achievement_unlocks_pkey;
    alter table public.achievement_unlocks add primary key (user_id, mode, achievement_id);
  end if;
end;
$$;

drop index if exists public.achievement_unlocks_id_idx;
create index if not exists achievement_unlocks_mode_id_idx on public.achievement_unlocks (mode, achievement_id);

-- ---------- 2. Recording and rates, per mode ----------

set local application_name = 'migration 0009: step 2/3 record + rates per mode';

drop function if exists public.record_achievements(text[]);
drop function if exists public.achievement_rates();

create or replace function public.record_achievements(p_ids text[], p_mode text default 'unlimited')
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
  if p_mode is null or p_mode not in ('unlimited', 'challenge') then
    raise exception 'invalid_mode';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'too_many_achievements';
  end if;

  insert into public.achievement_unlocks (user_id, mode, achievement_id)
  select distinct v_user, p_mode, id
  from unnest(coalesce(p_ids, '{}')) as id
  where id ~ '^[A-Za-z0-9_]{1,48}$'
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Players = accounts owning at least one card in that mode
create or replace function public.achievement_rates(p_mode text default 'unlimited')
returns table (achievement_id text, holders int, players int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with players as (
    select distinct user_id from public.collections where mode = p_mode
  ),
  total as (
    select count(*)::int as n from players
  )
  select a.achievement_id, count(*)::int, (select n from total)
  from public.achievement_unlocks a
  join players p on p.user_id = a.user_id
  where a.mode = p_mode
  group by a.achievement_id;
$$;

-- ---------- 3. What the server knows ----------

set local application_name = 'migration 0009: step 3/3 player_achievements';

create or replace function public.player_achievements(p_mode text, p_username text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_mode is null or p_mode not in ('unlimited', 'challenge') then
    raise exception 'invalid_mode';
  end if;

  if p_username is null then
    v_user := auth.uid();
    if v_user is null then
      raise exception 'not_authenticated';
    end if;
  else
    select p.id into v_user
    from public.profiles p
    where lower(p.username) = lower(btrim(p_username)) and (p.is_public or p.id = auth.uid());
    if v_user is null then
      return null;
    end if;
  end if;

  return jsonb_build_object(
    'unlocked', coalesce((
      select jsonb_agg(a.achievement_id order by a.achievement_id)
      from public.achievement_unlocks a
      where a.user_id = v_user and a.mode = p_mode
    ), '[]'::jsonb),
    'packs', (
      select count(*)::int from public.booster_openings o where o.user_id = v_user and o.mode = p_mode
    )
  );
end;
$$;

revoke execute on function public.record_achievements(text[], text) from public, anon;
revoke execute on function public.achievement_rates(text) from public;
revoke execute on function public.player_achievements(text, text) from public;
grant execute on function public.record_achievements(text[], text) to authenticated;
grant execute on function public.achievement_rates(text) to anon, authenticated;
grant execute on function public.player_achievements(text, text) to anon, authenticated;

set local application_name = 'migration 0009: done, committing';
