-- Pokémon Booster Game — a new account is never named after its email
-- Run after 0022_my_rank_card_traders.sql.
--
-- User, 2026-10-02 (a new player's walk through the site): the sign-up
-- username was optional, and handle_new_user() (0004) then used the part of
-- the email before the @ ("jean.dupont"). Profiles are public by default, so
-- that name showed in the live feed and the leaderboards. The form now
-- requires a username; this is the server side for any other sign-up path:
-- no username -> "Trainer-1234" (unique_username() keeps it unique).
--
-- Existing accounts are not renamed (the profile page offers to change a
-- username that matches the email). Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

set local application_name = 'migration 0023: step 1/2 handle_new_user';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username, created_at)
  values (
    new.id,
    public.unique_username(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
      'Trainer-' || (1000 + floor(random() * 9000))::int
    )),
    coalesce(new.created_at, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

set local application_name = 'migration 0023: step 2/2 grants';

revoke execute on function public.handle_new_user() from public, anon, authenticated;

set local application_name = 'migration 0023: done, committing';
