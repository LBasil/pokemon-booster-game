-- Pokémon Booster Game — base schema
-- Run this in the Supabase SQL editor of a fresh project, before 0002_functions.sql.
-- Auth is handled entirely by Supabase Auth (auth.users) — there is no custom
-- users table, and no plaintext password is ever stored or compared.

create table if not exists public.sets (
  id text primary key,
  name text not null,
  release_date date,
  printed_total int,
  total int
);

create table if not exists public.cards (
  id text primary key,
  name text not null,
  rarity text,
  value numeric,
  image_url text,
  image_small text,
  artist text,
  national_pokedex_number int,
  supertype text,
  subtypes text[],
  hp int,
  types text[],
  set_id text references public.sets (id) on delete cascade
);

create index if not exists cards_set_id_idx on public.cards (set_id);

create table if not exists public.collections (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.sets enable row level security;
alter table public.cards enable row level security;
alter table public.collections enable row level security;

-- Sets and cards are the shared card pool: readable by anyone (even signed
-- out visitors browsing booster types), writable only via the service role
-- (used by scripts/populate.mjs, which never ships to the client).
create policy "sets are publicly readable" on public.sets
  for select using (true);

create policy "cards are publicly readable" on public.cards
  for select using (true);

-- Collections are private per-user data.
create policy "users read their own collection" on public.collections
  for select using (auth.uid() = user_id);

create policy "users insert into their own collection" on public.collections
  for insert with check (auth.uid() = user_id);

create policy "users update their own collection" on public.collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
