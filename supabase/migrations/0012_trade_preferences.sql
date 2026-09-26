-- Pokémon Booster Game — Challenge trades: opting out, and cards not for trade
-- Run after 0011_weekly_missions_live_trades.sql.
--
-- 1. profiles.accepts_trades (default true, editable by its owner like
--    is_public). Off = nobody can send you an offer ('trades_closed'); your
--    public profile says so. Offers already waiting stay answerable: you
--    can still accept or decline them yourself.
--
-- 2. trade_locks (user_id, card_id): challenge cards the player keeps out of
--    trades. Personal data, written by its owner (like the wishlist).
--    propose_trade() refuses a locked card on either side
--    ('card_not_for_trade'), and accepting an offer fails ('failed') if the
--    sender locked one of the cards they offered in the meantime — the
--    receiver's own locks don't block an offer they accept themselves.
--
-- 3. challenge_collection_of(username) gains `tradable` (false = locked), so
--    other players see "Not for trade" before asking. Its return type
--    changes, so it's dropped and recreated (same grants).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Opting out ----------

set local application_name = 'migration 0012: step 1/4 accepts_trades';

alter table public.profiles add column if not exists accepts_trades boolean not null default true;
grant update (accepts_trades) on public.profiles to authenticated;

-- ---------- 2. Cards not for trade ----------

set local application_name = 'migration 0012: step 2/4 trade_locks';

create table if not exists public.trade_locks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
-- Like the wishlist: the client only sends the card id
alter table public.trade_locks alter column user_id set default auth.uid();

alter table public.trade_locks enable row level security;

drop policy if exists "players read their own locks" on public.trade_locks;
create policy "players read their own locks" on public.trade_locks
  for select using (auth.uid() = user_id);

drop policy if exists "players add their own locks" on public.trade_locks;
create policy "players add their own locks" on public.trade_locks
  for insert with check (auth.uid() = user_id);

drop policy if exists "players remove their own locks" on public.trade_locks;
create policy "players remove their own locks" on public.trade_locks
  for delete using (auth.uid() = user_id);

revoke all on public.trade_locks from anon;
revoke update on public.trade_locks from authenticated;
grant select, insert, delete on public.trade_locks to authenticated;

create or replace function public.has_trade_lock(p_user uuid, p_cards text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.trade_locks l where l.user_id = p_user and l.card_id = any (p_cards))
$$;

revoke execute on function public.has_trade_lock(uuid, text[]) from public, anon, authenticated;

-- ---------- 3. Trades that respect them ----------

set local application_name = 'migration 0012: step 3/4 propose_trade + respond_trade';

-- Same as 0007, plus accepts_trades and the locks
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
  v_accepts boolean;
  v_id bigint;
begin
  select p.id, p.accepts_trades into v_target, v_accepts from public.profiles p
  where lower(p.username) = lower(btrim(p_username)) and p.is_public;
  if v_target is null then
    raise exception 'trainer_not_found';
  end if;
  if v_target = v_user then
    raise exception 'cannot_trade_with_yourself';
  end if;
  if not v_accepts then
    raise exception 'trades_closed';
  end if;

  if cardinality(v_offer) not between 1 and 5 or cardinality(v_request) > 5
     or cardinality(array(select distinct unnest(v_offer))) <> cardinality(v_offer)
     or cardinality(array(select distinct unnest(v_request))) <> cardinality(v_request) then
    raise exception 'invalid_trade';
  end if;

  if not public.owns_challenge_cards(v_user, v_offer) or not public.owns_challenge_cards(v_target, v_request) then
    raise exception 'cards_not_owned';
  end if;

  if public.has_trade_lock(v_user, v_offer) or public.has_trade_lock(v_target, v_request) then
    raise exception 'card_not_for_trade';
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

-- Same as 0007; an offered card the sender locked since then fails the trade
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
       and public.owns_challenge_cards(v_trade.to_user, v_trade.request_cards)
       and not public.has_trade_lock(v_trade.from_user, v_trade.offer_cards) then
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

-- ---------- 4. Tradable flag on public challenge collections ----------

set local application_name = 'migration 0012: step 4/4 challenge_collection_of';

drop function if exists public.challenge_collection_of(text);

create function public.challenge_collection_of(p_username text)
returns table (card_id text, quantity int, acquired_at timestamptz, cards jsonb, tradable boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select col.card_id, col.quantity, col.acquired_at, to_jsonb(c.*),
    not exists (select 1 from public.trade_locks l where l.user_id = p.id and l.card_id = col.card_id)
  from public.profiles p
  join public.collections col on col.user_id = p.id and col.mode = 'challenge'
  join public.cards c on c.id = col.card_id
  where lower(p.username) = lower(btrim(p_username)) and (p.is_public or p.id = auth.uid())
  order by col.acquired_at desc;
$$;

revoke execute on function public.challenge_collection_of(text) from public;
grant execute on function public.challenge_collection_of(text) to anon, authenticated;

set local application_name = 'migration 0012: done, committing';
