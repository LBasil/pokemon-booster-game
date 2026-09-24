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
- **Dark/light theme** (follows the OS preference until you pick one) and
  **English/French** UI, both persisted locally.
- **"Holo Collector" design**: a landing page with holographic, tilt-on-hover
  showcase cards, built on shared design tokens (`--pb-*` CSS variables in
  `src/assets/styles/global.css`) that the rest of the app reuses. Mobile-first.

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

Requires Node 20+ (Vite 8). An `.nvmrc` pins Node 22 — run `nvm use` first.

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

## Deploying (Vercel)

Two things a static-file host doesn't give you for free:

1. **Env vars.** `.env` is gitignored and never pushed, so Vite has nothing
   to inline at build time unless you set them in the host itself. On
   Vercel: **Project Settings > Environment Variables**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy (Vite
   bakes them in at build time, not runtime — a redeploy is required after
   adding/changing them).
2. **SPA routing.** Vue Router runs in `history` mode, so a direct hit or
   refresh on `/boosters`, `/collection`, etc. must fall back to
   `index.html` instead of 404ing. `vercel.json` in the repo root already
   handles this with a catch-all rewrite.

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

Fully built and working end to end against a live Supabase project: auth,
booster opening (any set or a specific one, unlimited count), atomic
collection writes, RLS-isolated per-user collections. `sets` (176) and
`cards` (20,670) are populated. Still worth a manual click-through with a
real account through the actual UI (the automated check used an
admin-created test account to bypass email confirmation) — see
[CLAUDE.md](./CLAUDE.md) for the full project rules and current state.
