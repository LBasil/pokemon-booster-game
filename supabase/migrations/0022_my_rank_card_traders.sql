-- Pokémon Booster Game — my place in the leaderboards, who has a card in double
-- Run after 0021_trade_counter_offers.sql.
--
-- User, 2026-10-02 (a walk through the site as a new player):
--
-- 1. my_leaderboard_rank(kind): the signed-in player's row on a board, even
--    below the 20 shown, or why they aren't on it yet. leaderboard() kept
--    its signature and results; its body moved to leaderboard_rows(kind)
--    (internal, every row + user_id) so both read the same ranking.
--    Returns { public, rank, score, packs, card_id, card_name,
--    image_small }: public = false (private profile: never ranked, the
--    rest null); rank null = not ranked yet (packs = unlimited packs
--    opened, for the 20 hit_rate needs).
-- 2. card_traders(card_id): who could trade me that card, for the "Who has
--    it in double?" button of a challenge card: public players who accept
--    trades, own at least 2 copies in their challenge collection and
--    haven't kept it out of trades. Never me; 20 at most, most copies
--    first. Nothing new is exposed: challenge_collection_of() already
--    shows those collections.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Leaderboards ----------

set local application_name = 'migration 0022: step 1/3 leaderboards';

-- Same boards as 0007, every row, with the player's id
create or replace function public.leaderboard_rows(p_kind text)
returns table (
  user_id uuid,
  rank int,
  username text,
  score numeric,
  packs int,
  card_id text,
  card_name text,
  image_small text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind = 'hit_rate' then
    return query
    select s.uid, (row_number() over (order by s.score desc, s.packs desc))::int, s.username, s.score, s.packs, null::text, null::text, null::text
    from (
      select p.id as uid, p.username, round(100.0 * sum(o.hits) / count(*), 1) as score, count(*)::int as packs
      from public.booster_openings o
      join public.profiles p on p.id = o.user_id and p.is_public
      where o.mode = 'unlimited'
      group by p.id, p.username
      having count(*) >= 20
    ) s;
  elsif p_kind = 'best_pull' then
    return query
    select s.uid, (row_number() over (order by s.value desc nulls last))::int, s.username, s.value, null::int, s.id, s.name, s.image_small
    from (
      select distinct on (p.id) p.id as uid, p.username, c.value, c.id, c.name, c.image_small
      from public.collections col
      join public.profiles p on p.id = col.user_id and p.is_public
      join public.cards c on c.id = col.card_id
      where col.mode = 'unlimited' and c.value > 0
      order by p.id, c.value desc
    ) s;
  elsif p_kind = 'complete_sets' then
    return query
    with set_sizes as (
      select c.set_id, count(*) as size from public.cards c group by c.set_id
    ), owned as (
      select col.user_id, c.set_id, count(*) as n
      from public.collections col
      join public.cards c on c.id = col.card_id
      where col.mode = 'unlimited'
      group by col.user_id, c.set_id
    )
    select p.id, (row_number() over (order by count(*) desc))::int, p.username, count(*)::numeric, null::int, null::text, null::text, null::text
    from owned o
    join set_sizes s on s.set_id = o.set_id and o.n >= s.size
    join public.profiles p on p.id = o.user_id and p.is_public
    group by p.id, p.username;
  elsif p_kind in ('challenge_unique', 'challenge_value') then
    return query
    select s.uid, (row_number() over (order by s.score desc, s.packs asc))::int, s.username, s.score, s.packs, null::text, null::text, null::text
    from (
      select p.id as uid, p.username,
        case when p_kind = 'challenge_unique' then count(*)::numeric else round(sum(coalesce(c.value, 0)), 2) end as score,
        (select count(*) from public.booster_openings o where o.user_id = p.id and o.mode = 'challenge')::int as packs
      from public.collections col
      join public.profiles p on p.id = col.user_id and p.is_public
      join public.cards c on c.id = col.card_id
      where col.mode = 'challenge'
      group by p.id, p.username
    ) s;
  else
    raise exception 'unknown leaderboard %', p_kind;
  end if;
end;
$$;

create or replace function public.leaderboard(p_kind text, p_limit int default 20)
returns table (
  rank int,
  username text,
  score numeric,
  packs int,
  card_id text,
  card_name text,
  image_small text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.rank, r.username, r.score, r.packs, r.card_id, r.card_name, r.image_small
  from public.leaderboard_rows(p_kind) r
  order by r.rank
  limit least(p_limit, 100)
$$;

create or replace function public.my_leaderboard_rank(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_public boolean;
  v_row record;
begin
  select p.is_public into v_public from public.profiles p where p.id = v_user;
  if not coalesce(v_public, false) then
    -- unknown boards still fail, like leaderboard()
    perform 1 from public.leaderboard_rows(p_kind) limit 0;
    return jsonb_build_object('public', false);
  end if;

  select * into v_row from public.leaderboard_rows(p_kind) r where r.user_id = v_user;
  if found then
    return jsonb_build_object('public', true, 'rank', v_row.rank, 'score', v_row.score, 'packs', v_row.packs,
      'card_id', v_row.card_id, 'card_name', v_row.card_name, 'image_small', v_row.image_small);
  end if;
  return jsonb_build_object('public', true, 'rank', null,
    'packs', (select count(*) from public.booster_openings o where o.user_id = v_user and o.mode = 'unlimited')::int);
end;
$$;

-- ---------- 2. Who has it in double ----------

set local application_name = 'migration 0022: step 2/3 card_traders';

create or replace function public.card_traders(p_card_id text)
returns table (username text, quantity int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.username, col.quantity
  from public.collections col
  join public.profiles p on p.id = col.user_id and p.is_public and p.accepts_trades
  where col.mode = 'challenge' and col.card_id = p_card_id and col.quantity >= 2
    and col.user_id <> public.require_player()
    and not exists (select 1 from public.trade_locks l where l.user_id = col.user_id and l.card_id = col.card_id)
  order by col.quantity desc, lower(p.username)
  limit 20
$$;

-- ---------- 3. Grants ----------

set local application_name = 'migration 0022: step 3/3 grants';

revoke execute on function public.leaderboard_rows(text) from public, anon, authenticated;
revoke execute on function public.my_leaderboard_rank(text) from public, anon;
revoke execute on function public.card_traders(text) from public, anon;
grant execute on function public.leaderboard(text, int) to anon, authenticated;
grant execute on function public.my_leaderboard_rank(text) to authenticated;
grant execute on function public.card_traders(text) to authenticated;

set local application_name = 'migration 0022: done, committing';
