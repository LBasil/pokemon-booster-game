-- Pokémon Booster Game — counter-offers
-- Run after 0020_recycle_copies.sql.
--
-- User, 2026-10-02 (parked since 2026-09-26, now wanted): instead of only
-- accepting or declining an offer, answer it with another one.
--
-- 1. trade_offers.counter_of: the offer a counter-offer answers. The answered
--    offer ends with the new status 'countered' (answer_seen = true: the
--    counter-offer itself, pending for the first sender, is the news, so
--    the badge and the toasts count it once, as an offer).
-- 2. counter_trade(trade_id, offer, request): only the receiver of a pending,
--    unexpired offer. Same checks as propose_trade (1 to 5 cards offered,
--    up to 5 asked, no duplicates, both sides own them, no card kept out
--    of trades, 10 pending offers max), except the partner's "accepts
--    trades" switch and public profile: they made the first offer. Returns
--    the new offer's id; the old one and the new one change together.
-- 3. my_trades() rows get counter_of (null for a first offer).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Columns ----------

set local application_name = 'migration 0021: step 1/4 counter_of + countered';

alter table public.trade_offers add column if not exists counter_of bigint references public.trade_offers (id) on delete set null;

alter table public.trade_offers drop constraint if exists trade_offers_status_check;
alter table public.trade_offers add constraint trade_offers_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'failed', 'countered'));

-- ---------- 2. counter_trade ----------

set local application_name = 'migration 0021: step 2/4 counter_trade';

create or replace function public.counter_trade(p_trade_id bigint, p_offer text[], p_request text[] default '{}')
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_trade public.trade_offers;
  v_offer text[] := coalesce(p_offer, '{}');
  v_request text[] := coalesce(p_request, '{}');
  v_id bigint;
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

  if cardinality(v_offer) not between 1 and 5 or cardinality(v_request) > 5
     or cardinality(array(select distinct unnest(v_offer))) <> cardinality(v_offer)
     or cardinality(array(select distinct unnest(v_request))) <> cardinality(v_request) then
    raise exception 'invalid_trade';
  end if;

  if not public.owns_challenge_cards(v_user, v_offer) or not public.owns_challenge_cards(v_trade.from_user, v_request) then
    raise exception 'cards_not_owned';
  end if;

  if public.has_trade_lock(v_user, v_offer) or public.has_trade_lock(v_trade.from_user, v_request) then
    raise exception 'card_not_for_trade';
  end if;

  if (select count(*) from public.trade_offers t
      where t.from_user = v_user and t.status = 'pending' and t.created_at > now() - public.trade_ttl()) >= 10 then
    raise exception 'too_many_trades';
  end if;

  update public.trade_offers set status = 'countered', resolved_at = now(), answer_seen = true where id = v_trade.id;

  insert into public.trade_offers (from_user, to_user, offer_cards, request_cards, counter_of)
  values (v_user, v_trade.from_user, v_offer, v_request, v_trade.id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 3. my_trades ----------

set local application_name = 'migration 0021: step 3/4 my_trades';

-- Same as 0017, plus counter_of
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
      'unseen', t.from_user = auth.uid() and not t.answer_seen and t.status in ('accepted', 'declined', 'failed'),
      'counter_of', t.counter_of,
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

-- ---------- 4. Grants ----------

set local application_name = 'migration 0021: step 4/4 grants';

revoke execute on function public.counter_trade(bigint, text[], text[]) from public, anon;
revoke execute on function public.my_trades() from public, anon;
grant execute on function public.counter_trade(bigint, text[], text[]) to authenticated;
grant execute on function public.my_trades() to authenticated;

set local application_name = 'migration 0021: done, committing';
