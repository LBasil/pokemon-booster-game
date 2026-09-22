# Pokémon Booster Game

Open Pokémon boosters — any set, as many as you want — and build your own
collection. A Vue 3 single-page app backed by Supabase (Postgres + Auth).

## Features

- **Real authentication** via Supabase Auth (email/password) — no plaintext
  passwords, no homemade session logic.
- **Unlimited boosters, any type**: pick a specific Pokémon set or "any set
  (mixed)", and how many boosters to open in one go.
- **Collection**: every card you've pulled, with quantities, and how many
  unique cards you own out of the total card pool.
- **Profile**: account info and quick stats.
- **Dark/light theme** and **English/French** UI, both persisted locally.

## Tech stack

Vite, Vue 3 (Composition API), Vue Router, Pinia, vue-i18n, Bootstrap 5,
`@supabase/supabase-js`. Vitest for unit tests. Card data comes from the
[pokemontcg.io](https://pokemontcg.io) API, seeded into Supabase ahead of
time (see [Populating card data](#populating-card-data)).

## Project structure

```
src/
  views/          one component per route (Home, GameHub, Boosters, Collection, Profile)
  components/     shared UI (auth form, booster/card animations, theme & language toggles)
  stores/         Pinia: auth session, theme, collection cache
  api/            Supabase queries/RPC calls
  i18n/locales/   en.json / fr.json — all UI strings
supabase/migrations/   SQL to run in the Supabase SQL editor (schema, RLS, RPCs)
scripts/populate.mjs   admin script that seeds `sets` and `cards` from pokemontcg.io
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, then open
its **SQL editor** and run, in order:

1. `supabase/migrations/0001_schema.sql` — tables (`sets`, `cards`,
   `collections`) and Row Level Security policies.
2. `supabase/migrations/0002_functions.sql` — the RPCs used to draw random
   cards and to record a booster opening atomically.

In **Authentication > Providers**, email/password is enabled by default. For
easier local testing you can turn off "Confirm email" in **Authentication >
Settings** — otherwise new accounts need to click a confirmation link before
they get a session.

### 3. Configure the client app

Copy `.env.example` to `.env` and fill in your project's URL and anon key
(**Project Settings > API**):

```bash
cp .env.example .env
```

The anon key is safe to expose in the client — it's designed to be public;
access control is enforced entirely by the RLS policies from step 2.

### 4. Populating card data

The app needs `sets` and `cards` populated before boosters can be opened.
This runs as a one-off admin script (never shipped to the browser), using
the Supabase **service role key** (bypasses RLS for bulk writes) and a free
API key from [pokemontcg.io](https://pokemontcg.io/developers).

```bash
cp scripts/.env.local.example scripts/.env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POKEMONTCG_API_KEY

npm run populate:sets
npm run populate:cards
```

`scripts/.env.local` is gitignored — the service role key must never be
committed or used client-side.

### 5. Run it

```bash
npm run dev
```

## Scripts

| Command                | What it does                                   |
| ----------------------- | ----------------------------------------------- |
| `npm run dev`           | Start the Vite dev server                        |
| `npm run build`         | Production build                                 |
| `npm run preview`       | Preview the production build locally             |
| `npm test`              | Run unit tests (Vitest)                          |
| `npm run populate:sets` | Seed the `sets` table from pokemontcg.io         |
| `npm run populate:cards`| Seed the `cards` table from pokemontcg.io        |

## Status

The Vue app is fully built and verified in the browser (theme, language,
auth forms, route guarding). No Supabase project is connected yet, so the
end-to-end auth/booster/collection flow against a live backend is the next
step — see [CLAUDE.md](./CLAUDE.md) for the full project rules and current
state.
