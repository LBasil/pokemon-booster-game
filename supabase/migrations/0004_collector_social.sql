-- Pokémon Booster Game — server-authoritative openings, public profiles,
-- live pull feed, leaderboards, wishlist, price history.
-- Run after 0003_realistic_boosters.sql. Deploy the matching client right
-- after: older clients save packs with add_cards_to_collection, removed here.
--
-- 1. Game modes. Collections get a `mode` column ('unlimited' today,
--    'challenge' reserved for the future limited mode, which will have its
--    own separate collection). The primary key becomes (user_id, mode, card_id).
--
-- 2. Only the server writes collections. Until now a player could insert any
--    card into their own collection straight from the browser console (the
--    RLS policies allowed it). Harmless alone, but public leaderboards would
--    make it plain cheating. Client insert/update policies are dropped and
--    add_cards_to_collection() is removed; packs are now drawn, saved and
--    logged in one call: open_my_booster(), which runs as SECURITY DEFINER
--    and only ever writes rows for auth.uid(). It is rate limited (60 packs
--    per minute) so a script can't flood the tables.
--
-- 3. profiles: one public row per user (unique case-insensitive username,
--    public/private switch, showcase card). Created by a trigger on sign-up
--    and backfilled for existing users from their Auth metadata. Clients
--    may only update username / is_public / showcase_card_id, and the
--    showcase must be a card they own.
--
-- 4. booster_openings: every pack opened (cards, best card, hit counts),
--    private to its owner. Feeds the opening history and the hit-rate
--    leaderboard (which therefore only counts packs opened from now on).
--
-- 5. pull_feed: public, denormalized log of ultra/secret pulls by public
--    profiles, published to Supabase Realtime for the live feed. Rows older
--    than 30 days are pruned as new pulls come in.
--
-- 6. wishlist: cards a player is hunting. Private; pulling a card removes it.
--
-- 7. card_price_history: weekly Cardmarket price snapshots written by
--    `npm run populate:prices` (service role), publicly readable.
--
-- 8. Read-only RPCs for public pages (also callable signed out):
--    public_collection(username) and leaderboard(kind).
--
-- Safe to run twice.

-- ---------- 1. Game modes on collections ----------

alter table public.collections add column if not exists mode text not null default 'unlimited';

do $$
begin
  alter table public.collections
    add constraint collections_mode_check check (mode in ('unlimited', 'challenge'));
exception when duplicate_object then null;
end $$;

do $$
begin
  -- Old key was (user_id, card_id): a card can now be owned once per mode
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass and conname = 'collections_pkey' and cardinality(conkey) = 2
  ) then
    alter table public.collections drop constraint collections_pkey;
    alter table public.collections add constraint collections_pkey primary key (user_id, mode, card_id);
  end if;
end $$;

-- ---------- 2. Collections are written by the server only ----------

drop policy if exists "users insert into their own collection" on public.collections;
drop policy if exists "users update their own collection" on public.collections;
drop function if exists public.add_cards_to_collection(text[]);

-- ---------- 3. Profiles ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  is_public boolean not null default true,
  showcase_card_id text references public.cards (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 2 and 24),
  constraint profiles_username_clean check (username = btrim(username) and username !~ '[[:cntrl:]]')
);

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "public profiles are readable" on public.profiles;
create policy "public profiles are readable" on public.profiles
  for select using (is_public or id = auth.uid());

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Only these columns are editable from the client
revoke update on public.profiles from anon, authenticated;
grant update (username, is_public, showcase_card_id) on public.profiles to authenticated;

-- A free username derived from `base` (trimmed, 2-20 chars), with a numeric
-- suffix if it's taken. Used for new sign-ups and the backfill.
create or replace function public.unique_username(base text)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  candidate text := left(regexp_replace(btrim(coalesce(base, '')), '[[:cntrl:]]', '', 'g'), 20);
  attempt int := 0;
begin
  candidate := btrim(candidate);
  if char_length(candidate) < 2 then
    candidate := 'Trainer';
  end if;
  while exists (select 1 from public.profiles p where lower(p.username) = lower(candidate)) loop
    attempt := attempt + 1;
    candidate := left(candidate, 19) || '-' || (1000 + floor(random() * 9000))::int;
    if attempt > 20 then
      candidate := 'Trainer-' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    end if;
  end loop;
  return candidate;
end;
$$;

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
    public.unique_username(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''), split_part(new.email, '@', 1))),
    coalesce(new.created_at, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users (username and showcase from their Auth metadata)
do $$
declare
  u record;
begin
  for u in
    select id, email, created_at, raw_user_meta_data as meta
    from auth.users
    where not exists (select 1 from public.profiles p where p.id = auth.users.id)
    order by created_at
  loop
    insert into public.profiles (id, username, created_at, showcase_card_id)
    values (
      u.id,
      public.unique_username(coalesce(nullif(btrim(u.meta ->> 'username'), ''), split_part(u.email, '@', 1))),
      coalesce(u.created_at, now()),
      (select c.id from public.cards c where c.id = u.meta ->> 'showcase_card_id')
    );
  end loop;
end $$;

create or replace function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.showcase_card_id is not null
     and new.showcase_card_id is distinct from old.showcase_card_id
     and not exists (
       select 1 from public.collections c
       where c.user_id = new.id and c.card_id = new.showcase_card_id and c.mode = 'unlimited'
     ) then
    raise exception 'showcase card must be one you own';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------- 4. Booster openings ----------

create table if not exists public.booster_openings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'unlimited' check (mode in ('unlimited', 'challenge')),
  set_id text not null references public.sets (id) on delete cascade,
  card_ids text[] not null,
  best_card_id text references public.cards (id) on delete set null,
  hits int not null default 0,      -- ultra + secret cards in the pack
  secrets int not null default 0,   -- secret cards in the pack
  opened_at timestamptz not null default now()
);

create index if not exists booster_openings_user_idx on public.booster_openings (user_id, opened_at desc);

alter table public.booster_openings enable row level security;

drop policy if exists "users read their own openings" on public.booster_openings;
create policy "users read their own openings" on public.booster_openings
  for select using (auth.uid() = user_id);

-- ---------- 5. Public pull feed ----------

create table if not exists public.pull_feed (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  username text not null,
  card_id text not null references public.cards (id) on delete cascade,
  card_name text not null,
  image_small text,
  bucket text not null,
  set_id text not null,
  pulled_at timestamptz not null default now()
);

create index if not exists pull_feed_recent_idx on public.pull_feed (pulled_at desc);

alter table public.pull_feed enable row level security;

drop policy if exists "feed shows public profiles" on public.pull_feed;
create policy "feed shows public profiles" on public.pull_feed
  for select using (exists (select 1 from public.profiles p where p.id = user_id and p.is_public));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pull_feed'
     ) then
    alter publication supabase_realtime add table public.pull_feed;
  end if;
end $$;

-- ---------- 6. Wishlist ----------

create table if not exists public.wishlist (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.wishlist enable row level security;

drop policy if exists "users read their own wishlist" on public.wishlist;
create policy "users read their own wishlist" on public.wishlist
  for select using (auth.uid() = user_id);

drop policy if exists "users add to their own wishlist" on public.wishlist;
create policy "users add to their own wishlist" on public.wishlist
  for insert with check (auth.uid() = user_id);

drop policy if exists "users remove from their own wishlist" on public.wishlist;
create policy "users remove from their own wishlist" on public.wishlist
  for delete using (auth.uid() = user_id);

-- ---------- 7. Price history ----------

create table if not exists public.card_price_history (
  card_id text not null references public.cards (id) on delete cascade,
  recorded_on date not null default current_date,
  value numeric not null,
  primary key (card_id, recorded_on)
);

alter table public.card_price_history enable row level security;

drop policy if exists "price history is publicly readable" on public.card_price_history;
create policy "price history is publicly readable" on public.card_price_history
  for select using (true);

-- ---------- The one way to open a pack ----------

create or replace function public.open_my_booster(p_set_id text default null, p_mode text default 'unlimited')
returns setof public.cards
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cards public.cards[];
  v_best public.cards;
  v_username text;
  v_is_public boolean;
  ranks constant text[] := array['common', 'uncommon', 'rare', 'holo', 'ultra', 'secret'];
begin
  if v_user is null then
    raise exception 'open_my_booster requires an authenticated user';
  end if;
  if p_mode <> 'unlimited' then
    raise exception 'mode % is not available yet', p_mode;
  end if;
  if (select count(*) from public.booster_openings o
      where o.user_id = v_user and o.opened_at > now() - interval '1 minute') >= 60 then
    raise exception 'too many boosters opened, slow down a little';
  end if;

  select array_agg(b) into v_cards from public.open_booster(p_set_id) b;

  insert into public.collections (user_id, mode, card_id, quantity)
  select v_user, p_mode, c.id, count(*)
  from unnest(v_cards) c
  group by c.id
  on conflict (user_id, mode, card_id)
  do update set quantity = public.collections.quantity + excluded.quantity;

  select * into v_best
  from unnest(v_cards) c
  order by array_position(ranks, c.rarity_bucket) desc, c.value desc nulls last
  limit 1;

  insert into public.booster_openings (user_id, mode, set_id, card_ids, best_card_id, hits, secrets)
  values (
    v_user,
    p_mode,
    v_cards[1].set_id,
    array(select c.id from unnest(v_cards) c),
    v_best.id,
    (select count(*) from unnest(v_cards) c where c.rarity_bucket in ('ultra', 'secret')),
    (select count(*) from unnest(v_cards) c where c.rarity_bucket = 'secret')
  );

  delete from public.wishlist w where w.user_id = v_user and w.card_id = any (array(select c.id from unnest(v_cards) c));

  select p.username, p.is_public into v_username, v_is_public from public.profiles p where p.id = v_user;
  if coalesce(v_is_public, false) then
    insert into public.pull_feed (user_id, username, card_id, card_name, image_small, bucket, set_id)
    select v_user, v_username, c.id, c.name, c.image_small, c.rarity_bucket, c.set_id
    from unnest(v_cards) c
    where c.rarity_bucket in ('ultra', 'secret');
  end if;

  -- Keep the feed small (cheap thanks to the pulled_at index)
  if random() < 0.02 then
    delete from public.pull_feed where pulled_at < now() - interval '30 days';
  end if;

  return query select * from unnest(v_cards);
end;
$$;

-- ---------- 8. Public read-only RPCs ----------

-- A public profile's collection, shaped like the client's fetchCollection()
-- rows ({ card_id, quantity, acquired_at, cards }), or nothing if the
-- profile is private or unknown.
create or replace function public.public_collection(p_username text)
returns table (card_id text, quantity int, acquired_at timestamptz, cards jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select col.card_id, col.quantity, col.acquired_at, to_jsonb(c.*)
  from public.profiles p
  join public.collections col on col.user_id = p.id and col.mode = 'unlimited'
  join public.cards c on c.id = col.card_id
  where lower(p.username) = lower(p_username) and (p.is_public or p.id = auth.uid());
$$;

-- Luck-based leaderboards over public profiles (volume would be too easy to
-- farm in unlimited mode):
--   hit_rate       ultra+secret cards per 100 packs (min 20 packs)
--   best_pull      most valuable single card owned
--   complete_sets  sets fully collected (against the cards in the database)
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
  else
    raise exception 'unknown leaderboard %', p_kind;
  end if;
end;
$$;

-- ---------- Grants ----------

revoke execute on function public.unique_username(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_before_update() from public, anon, authenticated;
revoke execute on function public.open_my_booster(text, text) from public, anon;
grant execute on function public.open_my_booster(text, text) to authenticated;
grant execute on function public.public_collection(text) to anon, authenticated;
grant execute on function public.leaderboard(text, int) to anon, authenticated;
