-- Pokémon Booster Game — answers to your trade offers, recycling a pick
-- Run after 0016_feed_top_rarity.sql.
--
-- 1. The sender of an offer is told when it's answered. Incoming offers
--    already had a badge; an offer accepted, declined or failed (a card was
--    gone) went silently to "Past trades". trade_offers gets answer_seen
--    (the sender saw how it ended), false for new answers; the offers that
--    were already over when the column is added count as seen (no burst of
--    old news).
--      challenge_badge()            also returns answers: unseen answers to my offers
--      my_trades()                  rows get unseen (true on those answers)
--      mark_trade_answers_seen()    the sender opened the trades page -> all seen,
--                                   returns how many were new
--    Cancelled (by the sender) and expired offers aren't answers.
--
-- 2. recycle_cards(card_ids): recycles every duplicate of the chosen cards
--    only (one copy of each is kept), where recycle_duplicates() took one
--    card or all of them. Same prices, same wallet lock, one ledger row
--    (card_id set when a single card was picked), so the "recycle" missions
--    and the recycling achievements count it as before.
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

-- ---------- 1. Answers to my offers ----------

set local application_name = 'migration 0017: step 1/3 trade answers';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trade_offers' and column_name = 'answer_seen'
  ) then
    alter table public.trade_offers add column answer_seen boolean not null default false;
    -- Offers already over are old news
    update public.trade_offers set answer_seen = true where status <> 'pending';
  end if;
end;
$$;

-- The badge's query: my offers answered since I last looked
create index if not exists trade_offers_unseen_idx on public.trade_offers (from_user)
  where not answer_seen and status in ('accepted', 'declined', 'failed');

-- Same as 0011, plus answers
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
  v_answers int;
begin
  select * into v_wallet from public.challenge_wallets w where w.user_id = v_user;
  if found then
    v_rewards := (v_wallet.last_daily_on is distinct from public.challenge_today())::int
      + (select count(*) from public.challenge_missions(v_user) m where not m.claimed and m.progress >= m.target)::int
      + (select count(*) from public.challenge_weekly_missions(v_user) m where not m.claimed and m.progress >= m.target)::int;
  end if;

  select count(*) into v_trades from public.trade_offers t
  where t.to_user = v_user and t.status = 'pending' and t.created_at > now() - public.trade_ttl();

  select count(*) into v_answers from public.trade_offers t
  where t.from_user = v_user and not t.answer_seen and t.status in ('accepted', 'declined', 'failed');

  return jsonb_build_object('rewards', v_rewards, 'trades', v_trades, 'answers', v_answers);
end;
$$;

-- Same as 0007, plus unseen
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

create or replace function public.mark_trade_answers_seen()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_count int;
begin
  update public.trade_offers t set answer_seen = true
  where t.from_user = v_user and not t.answer_seen and t.status in ('accepted', 'declined', 'failed');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- 2. Recycling a pick ----------

set local application_name = 'migration 0017: step 2/3 recycle_cards';

create or replace function public.recycle_cards(p_card_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_ids text[] := array(select distinct unnest(coalesce(p_card_ids, '{}')));
  v_count int;
  v_gained int;
begin
  select coalesce(sum(col.quantity - 1), 0), coalesce(sum((col.quantity - 1) * public.challenge_recycle_value(c.rarity_bucket)), 0)
  into v_count, v_gained
  from public.collections col
  join public.cards c on c.id = col.card_id
  where col.user_id = v_user and col.mode = 'challenge' and col.quantity > 1 and col.card_id = any (v_ids);

  if v_count > 0 then
    update public.collections col
    set quantity = 1
    where col.user_id = v_user and col.mode = 'challenge' and col.quantity > 1 and col.card_id = any (v_ids);

    update public.challenge_wallets set coins = coins + v_gained where user_id = v_user
    returning * into v_wallet;
    insert into public.challenge_ledger (user_id, kind, amount, card_id, quantity)
    values (v_user, 'recycle', v_gained, case when cardinality(v_ids) = 1 then v_ids[1] end, v_count);
  end if;

  return jsonb_build_object('recycled', v_count, 'gained', v_gained, 'coins', v_wallet.coins);
end;
$$;

-- ---------- 3. Grants ----------

set local application_name = 'migration 0017: step 3/3 grants';

revoke execute on function public.challenge_badge() from public, anon;
revoke execute on function public.my_trades() from public, anon;
revoke execute on function public.mark_trade_answers_seen() from public, anon;
revoke execute on function public.recycle_cards(text[]) from public, anon;
grant execute on function public.challenge_badge() to authenticated;
grant execute on function public.my_trades() to authenticated;
grant execute on function public.mark_trade_answers_seen() to authenticated;
grant execute on function public.recycle_cards(text[]) to authenticated;

set local application_name = 'migration 0017: done, committing';
