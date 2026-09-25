-- Pokémon Booster Game — Challenge mode: trades, leaderboards, notifications
-- Run after 0006_challenge_no_pity.sql.
--
-- 1. Trades between players, on the challenge collection only (the
--    unlimited collection has nothing to trade: every card is one pack
--    away). A trade offer gives 1-5 of your cards (one copy each) for 0-5
--    of the other player's cards (0 = a gift). The other player accepts or
--    declines; the sender can cancel; offers expire after 7 days. Accepting
--    swaps the copies atomically after checking both sides still own them
--    (otherwise the offer ends as 'failed'). You can only send offers to
--    public profiles, and have at most 10 pending offers at once.
--      trade_offers                         private to its two players, no client writes
--      propose_trade(username, offer, request)
--      respond_trade(id, accept)            receiver only
--      cancel_trade(id)                     sender only
--      my_trades()                          both directions, with cards and usernames
--      challenge_collection_of(username)    a public player's challenge collection
--
-- 2. leaderboard() gains two challenge boards (public profiles only):
--      challenge_unique  distinct cards in the challenge collection
--                        (ties: fewer challenge packs opened ranks higher)
--      challenge_value   market value of those distinct cards
--
-- 3. challenge_badge(): what's waiting for the player (daily reward,
--    finished missions, incoming offers), for the badge in the navigation.
--    Read-only: unlike challenge_state() it never creates a wallet.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Trade offers ----------

set local application_name = 'migration 0007: step 1/5 trade offers';

create table if not exists public.trade_offers (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  offer_cards text[] not null,    -- card ids, one copy each
  request_cards text[] not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint trade_offers_not_self check (from_user <> to_user),
  constraint trade_offers_size check (
    cardinality(offer_cards) between 1 and 5 and cardinality(request_cards) between 0 and 5
  )
);

create index if not exists trade_offers_to_idx on public.trade_offers (to_user, status, created_at desc);
create index if not exists trade_offers_from_idx on public.trade_offers (from_user, status, created_at desc);

alter table public.trade_offers enable row level security;

drop policy if exists "players read their own trades" on public.trade_offers;
create policy "players read their own trades" on public.trade_offers
  for select using (auth.uid() in (from_user, to_user));

-- Pending offers older than this are expired (checked on read and on accept)
create or replace function public.trade_ttl()
returns interval
language sql
immutable
as $$
  select interval '7 days'
$$;

-- True when `p_user` owns at least one challenge copy of every card
create or replace function public.owns_challenge_cards(p_user uuid, p_cards text[])
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select (
    select count(*) from public.collections col
    where col.user_id = p_user and col.mode = 'challenge' and col.card_id = any (p_cards)
  ) = cardinality(p_cards)
$$;

-- ---------- 2. Trade RPCs ----------

set local application_name = 'migration 0007: step 2/5 trade rpcs';

create or replace function public.propose_trade(p_username text, p_offer text[], p_request text[] default '{}')
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_offer text[] := coalesce(p_offer, '{}');
  v_request text[] := coalesce(p_request, '{}');
  v_target uuid;
  v_id bigint;
begin
  select p.id into v_target from public.profiles p
  where lower(p.username) = lower(btrim(p_username)) and p.is_public;
  if v_target is null then
    raise exception 'trainer_not_found';
  end if;
  if v_target = v_user then
    raise exception 'cannot_trade_with_yourself';
  end if;

  if cardinality(v_offer) not between 1 and 5 or cardinality(v_request) > 5
     or cardinality(array(select distinct unnest(v_offer))) <> cardinality(v_offer)
     or cardinality(array(select distinct unnest(v_request))) <> cardinality(v_request) then
    raise exception 'invalid_trade';
  end if;

  if not public.owns_challenge_cards(v_user, v_offer) or not public.owns_challenge_cards(v_target, v_request) then
    raise exception 'cards_not_owned';
  end if;

  if (select count(*) from public.trade_offers t
      where t.from_user = v_user and t.status = 'pending' and t.created_at > now() - public.trade_ttl()) >= 10 then
    raise exception 'too_many_trades';
  end if;

  insert into public.trade_offers (from_user, to_user, offer_cards, request_cards)
  values (v_user, v_target, v_offer, v_request)
  returning id into v_id;
  return v_id;
end;
$$;

-- Moves one copy of each card from one challenge collection to another
create or replace function public.move_challenge_cards(p_from uuid, p_to uuid, p_cards text[])
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  if cardinality(p_cards) = 0 then
    return;
  end if;
  -- quantity > 0 is a check constraint: last copies go, the others go down by one
  delete from public.collections col
  where col.user_id = p_from and col.mode = 'challenge' and col.card_id = any (p_cards) and col.quantity = 1;
  update public.collections col
  set quantity = col.quantity - 1
  where col.user_id = p_from and col.mode = 'challenge' and col.card_id = any (p_cards);

  insert into public.collections (user_id, mode, card_id, quantity)
  select p_to, 'challenge', card_id, 1 from unnest(p_cards) as card_id
  on conflict (user_id, mode, card_id)
  do update set quantity = public.collections.quantity + 1;
end;
$$;

-- Returns { status }: 'accepted' | 'declined' | 'failed' (a card is gone)
create or replace function public.respond_trade(p_trade_id bigint, p_accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_trade public.trade_offers;
  v_status text;
begin
  select * into v_trade from public.trade_offers t
  where t.id = p_trade_id and t.to_user = v_user
  for update;
  if not found then
    raise exception 'trade_not_found';
  end if;
  if v_trade.status <> 'pending' then
    raise exception 'trade_closed';
  end if;
  if v_trade.created_at <= now() - public.trade_ttl() then
    raise exception 'trade_expired';
  end if;

  if not p_accept then
    v_status := 'declined';
  else
    -- Both players' economy mutexes, always in the same order (no deadlock)
    perform public.lock_challenge_wallet(least(v_trade.from_user, v_trade.to_user));
    perform public.lock_challenge_wallet(greatest(v_trade.from_user, v_trade.to_user));

    if public.owns_challenge_cards(v_trade.from_user, v_trade.offer_cards)
       and public.owns_challenge_cards(v_trade.to_user, v_trade.request_cards) then
      perform public.move_challenge_cards(v_trade.from_user, v_trade.to_user, v_trade.offer_cards);
      perform public.move_challenge_cards(v_trade.to_user, v_trade.from_user, v_trade.request_cards);
      v_status := 'accepted';
    else
      v_status := 'failed';
    end if;
  end if;

  update public.trade_offers set status = v_status, resolved_at = now() where id = v_trade.id;
  return jsonb_build_object('status', v_status);
end;
$$;

create or replace function public.cancel_trade(p_trade_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
begin
  update public.trade_offers
  set status = 'cancelled', resolved_at = now()
  where id = p_trade_id and from_user = v_user and status = 'pending';
  if not found then
    raise exception 'trade_not_found';
  end if;
end;
$$;

-- The player's 50 latest offers, both directions. Expired pending offers
-- are reported as 'expired'. Cards keep the order they were picked in.
create or replace function public.my_trades()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(latest.row order by latest.created_at desc, latest.id desc), '[]'::jsonb)
  from (
    select t.id, t.created_at, jsonb_build_object(
      'id', t.id,
      'direction', case when t.from_user = auth.uid() then 'sent' else 'received' end,
      'partner', p.username,
      'offer', (
        select coalesce(jsonb_agg(to_jsonb(c) order by array_position(t.offer_cards, c.id)), '[]'::jsonb)
        from public.cards c where c.id = any (t.offer_cards)
      ),
      'request', (
        select coalesce(jsonb_agg(to_jsonb(c) order by array_position(t.request_cards, c.id)), '[]'::jsonb)
        from public.cards c where c.id = any (t.request_cards)
      ),
      'status', case
        when t.status = 'pending' and t.created_at <= now() - public.trade_ttl() then 'expired'
        else t.status
      end,
      'created_at', t.created_at,
      'resolved_at', t.resolved_at
    ) as row
    from public.trade_offers t
    join public.profiles p on p.id = case when t.from_user = auth.uid() then t.to_user else t.from_user end
    where auth.uid() in (t.from_user, t.to_user)
    order by t.created_at desc
    limit 50
  ) latest
$$;

-- A public player's challenge collection (or your own), shaped like
-- public_collection() rows. Empty if the profile is private or unknown.
create or replace function public.challenge_collection_of(p_username text)
returns table (card_id text, quantity int, acquired_at timestamptz, cards jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select col.card_id, col.quantity, col.acquired_at, to_jsonb(c.*)
  from public.profiles p
  join public.collections col on col.user_id = p.id and col.mode = 'challenge'
  join public.cards c on c.id = col.card_id
  where lower(p.username) = lower(btrim(p_username)) and (p.is_public or p.id = auth.uid())
  order by col.acquired_at desc;
$$;

-- ---------- 3. Notifications badge ----------

set local application_name = 'migration 0007: step 3/5 challenge badge';

create or replace function public.challenge_badge()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets;
  v_rewards int := 0;
  v_trades int;
begin
  select * into v_wallet from public.challenge_wallets w where w.user_id = v_user;
  if found then
    v_rewards := (v_wallet.last_daily_on is distinct from public.challenge_today())::int
      + (select count(*) from public.challenge_missions(v_user) m where not m.claimed and m.progress >= m.target)::int;
  end if;

  select count(*) into v_trades from public.trade_offers t
  where t.to_user = v_user and t.status = 'pending' and t.created_at > now() - public.trade_ttl();

  return jsonb_build_object('rewards', v_rewards, 'trades', v_trades);
end;
$$;

-- ---------- 4. Leaderboards ----------

set local application_name = 'migration 0007: step 4/5 leaderboards';

-- Same boards as 0004, plus challenge_unique and challenge_value
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
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind = 'hit_rate' then
    return query
    select (row_number() over (order by s.score desc, s.packs desc))::int, s.username, s.score, s.packs, null::text, null::text, null::text
    from (
      select p.username, round(100.0 * sum(o.hits) / count(*), 1) as score, count(*)::int as packs
      from public.booster_openings o
      join public.profiles p on p.id = o.user_id and p.is_public
      where o.mode = 'unlimited'
      group by p.id, p.username
      having count(*) >= 20
    ) s
    order by 1
    limit least(p_limit, 100);
  elsif p_kind = 'best_pull' then
    return query
    select (row_number() over (order by s.value desc nulls last))::int, s.username, s.value, null::int, s.id, s.name, s.image_small
    from (
      select distinct on (p.id) p.username, c.value, c.id, c.name, c.image_small
      from public.collections col
      join public.profiles p on p.id = col.user_id and p.is_public
      join public.cards c on c.id = col.card_id
      where col.mode = 'unlimited' and c.value > 0
      order by p.id, c.value desc
    ) s
    order by 1
    limit least(p_limit, 100);
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
    select (row_number() over (order by count(*) desc))::int, p.username, count(*)::numeric, null::int, null::text, null::text, null::text
    from owned o
    join set_sizes s on s.set_id = o.set_id and o.n >= s.size
    join public.profiles p on p.id = o.user_id and p.is_public
    group by p.id, p.username
    order by 1
    limit least(p_limit, 100);
  elsif p_kind in ('challenge_unique', 'challenge_value') then
    return query
    select (row_number() over (order by s.score desc, s.packs asc))::int, s.username, s.score, s.packs, null::text, null::text, null::text
    from (
      select p.username,
        case when p_kind = 'challenge_unique' then count(*)::numeric else round(sum(coalesce(c.value, 0)), 2) end as score,
        (select count(*) from public.booster_openings o where o.user_id = p.id and o.mode = 'challenge')::int as packs
      from public.collections col
      join public.profiles p on p.id = col.user_id and p.is_public
      join public.cards c on c.id = col.card_id
      where col.mode = 'challenge'
      group by p.id, p.username
    ) s
    order by 1
    limit least(p_limit, 100);
  else
    raise exception 'unknown leaderboard %', p_kind;
  end if;
end;
$$;

-- ---------- 5. Grants ----------

set local application_name = 'migration 0007: step 5/5 grants';

revoke execute on function public.owns_challenge_cards(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.move_challenge_cards(uuid, uuid, text[]) from public, anon, authenticated;

revoke execute on function public.propose_trade(text, text[], text[]) from public, anon;
revoke execute on function public.respond_trade(bigint, boolean) from public, anon;
revoke execute on function public.cancel_trade(bigint) from public, anon;
revoke execute on function public.my_trades() from public, anon;
revoke execute on function public.challenge_badge() from public, anon;
grant execute on function public.propose_trade(text, text[], text[]) to authenticated;
grant execute on function public.respond_trade(bigint, boolean) to authenticated;
grant execute on function public.cancel_trade(bigint) to authenticated;
grant execute on function public.my_trades() to authenticated;
grant execute on function public.challenge_badge() to authenticated;
grant execute on function public.challenge_collection_of(text) to anon, authenticated;
grant execute on function public.leaderboard(text, int) to anon, authenticated;

set local application_name = 'migration 0007: done, committing';
