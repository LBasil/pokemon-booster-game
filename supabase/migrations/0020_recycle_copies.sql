-- Pokémon Booster Game — recycling some copies of a card, not all of them
-- Run after 0019_evolution_chain_two_stages_stop.sql.
--
-- User, 2026-10-02: "je devrais pouvoir choisir si je recycle 1, 2, etc
-- exemplaire de ma carte et pas tout ou rien".
--
-- recycle_card_copies(picks): picks is a JSON object { card id: copies },
-- e.g. {"sv3pt5-4": 2}. Each card loses that many copies, capped at its
-- duplicates (one copy of each card always stays); counts <= 0, unknown or
-- unowned cards are ignored. Same prices, same wallet lock and one ledger
-- row as recycle_cards (0017: card_id set when a single card was picked),
-- so the "recycle" missions and the recycling achievements count it as
-- before. recycle_duplicates / recycle_cards stay (all extra copies).
--
-- Safe to run twice.
--
-- Progress: see docs/manual-testing.md > "Watching a migration run".

set local lock_timeout = '15s';

set local application_name = 'migration 0020: step 1/2 recycle_card_copies';

create or replace function public.recycle_card_copies(p_picks jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_player();
  v_wallet public.challenge_wallets := public.lock_challenge_wallet(v_user);
  v_count int;
  v_gained int;
  v_cards text[];
begin
  if jsonb_typeof(p_picks) is distinct from 'object' then
    return jsonb_build_object('recycled', 0, 'gained', 0, 'coins', v_wallet.coins);
  end if;

  -- What each pick really takes: at most the card's duplicates
  with picks as (
    select col.card_id, least(col.quantity - 1, floor((p.value #>> '{}')::numeric)::int) as copies
    from jsonb_each(p_picks) p
    join public.collections col
      on col.user_id = v_user and col.mode = 'challenge' and col.card_id = p.key
    where jsonb_typeof(p.value) = 'number' and (p.value #>> '{}')::numeric >= 1 and col.quantity > 1
  ), done as (
    update public.collections col
    set quantity = col.quantity - picks.copies
    from picks
    where col.user_id = v_user and col.mode = 'challenge' and col.card_id = picks.card_id
    returning picks.card_id, picks.copies
  )
  select coalesce(sum(done.copies), 0), coalesce(sum(done.copies * public.challenge_recycle_value(c.rarity_bucket)), 0), array_agg(done.card_id)
  into v_count, v_gained, v_cards
  from done
  join public.cards c on c.id = done.card_id;

  if v_count > 0 then
    update public.challenge_wallets set coins = coins + v_gained where user_id = v_user
    returning * into v_wallet;
    insert into public.challenge_ledger (user_id, kind, amount, card_id, quantity)
    values (v_user, 'recycle', v_gained, case when cardinality(v_cards) = 1 then v_cards[1] end, v_count);
  end if;

  return jsonb_build_object('recycled', v_count, 'gained', v_gained, 'coins', v_wallet.coins);
end;
$$;

set local application_name = 'migration 0020: step 2/2 grants';

revoke execute on function public.recycle_card_copies(jsonb) from public, anon;
grant execute on function public.recycle_card_copies(jsonb) to authenticated;

set local application_name = 'migration 0020: done, committing';
