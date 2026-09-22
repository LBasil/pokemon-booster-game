-- Pokémon Booster Game — RPCs
-- Run after 0001_schema.sql.
--
-- None of these use SECURITY DEFINER: the RLS policies from 0001_schema.sql
-- already grant exactly the access each function needs (public read on
-- sets/cards, own-row read/insert/update on collections), so running as the
-- caller (the default, SECURITY INVOKER) keeps the functions no more
-- privileged than the user calling them.

create or replace function public.random_cards(num_cards int)
returns setof public.cards
language sql
stable
set search_path = public, pg_temp
as $$
  select *
  from public.cards
  order by random()
  limit num_cards;
$$;

create or replace function public.random_cards_by_set(num_cards int, p_set_id text)
returns setof public.cards
language sql
stable
set search_path = public, pg_temp
as $$
  select *
  from public.cards
  where set_id = p_set_id
  order by random()
  limit num_cards;
$$;

-- Atomically increments quantity for each card id the caller just drew,
-- inserting a new row at quantity 1 the first time a card is owned. This
-- replaces the original check-then-write client logic, which could corrupt
-- quantities if two booster openings raced each other.
create or replace function public.add_cards_to_collection(card_ids text[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'add_cards_to_collection requires an authenticated user';
  end if;

  insert into public.collections (user_id, card_id, quantity)
  select auth.uid(), card_id, count(*)
  from unnest(card_ids) as card_id
  group by card_id
  on conflict (user_id, card_id)
  do update set quantity = public.collections.quantity + excluded.quantity;
end;
$$;
