# Pokémon Booster Game

Open Pokémon boosters — any set, as many as you want — and build your own
collection. A Vue 3 single-page app (installable as a PWA) backed by
Supabase (Postgres + Auth + Realtime).

## Features

- **Real authentication** via Supabase Auth (email/password), with email
  confirmation and a "forgot password" flow — no plaintext passwords, no
  homemade session logic.
- **Unlimited boosters, any type**: pick a specific Pokémon set (searchable,
  grouped by year, each pack shows the set's logo and chase card) or "any
  set" (one random set per pack), and how many boosters to open. Tear each
  pack open, flip or swipe the cards one by one (rarest last, with rarity,
  "New!" and "Wanted!" badges; hits charge up and flash), or open them all
  at once. Packs follow real pull rates: 10 cards, one guaranteed rare, a
  holo/ex about every 5 packs, a big hit now and then. Every pack is drawn
  and saved **server-side** in one call, so nobody can add cards to their
  own collection from the browser console.
- **Challenge mode** (`/challenge`): a second, separate collection built
  with coins. Start with 1,000 coins, pay 100 per booster, earn more with a
  daily reward that grows over a 7-day streak and three daily missions,
  recycle duplicates into coins and craft the cards you're missing. Packs
  keep the real pull rates (no pity timer), except that 1 booster in 500 is
  a "god pack" (holos and better only). Every coin moves
  server-side, and the unlimited collection is never touched.
- **Sound & haptics**: synthesized sound effects (tearing, flips, hit
  fanfares — no audio files) and a vibration on hits, both switchable.
- **Hub**: greeting, quick access to boosters, collection progress, profile
  summary, latest pulls, and a peek at the community's live pulls.
- **Collection**: every card you've pulled with completion stats and an
  estimated Cardmarket value; search, filter by set, rarity or duplicates,
  and sort — all kept in the URL. Tabs for:
  - **Sets**: per-set completion, each opening a **binder** with every card
    of the set in number order and the missing ones greyed out in their slot;
  - **Pokédex**: national Pokédex progress (caught species in color, the
    others as silhouettes);
  - **Wishlist**: cards you're hunting (pulling one takes it off the list).
- **Card detail**: full-size holo card, set and number, rarity, copies,
  first pull date, illustrator, **price history chart** (weekly Cardmarket
  snapshots), wishlist toggle for missing cards, and **sharing** a generated
  image of the card.
- **Booster history**: every pack you've opened, grouped by day.
- **Profile**: trainer card with a unique username and a rank that grows
  with the boosters you open, a showcase card, stats, rarity breakdown, 13
  achievements, public/private switch, sound/vibration settings, and an
  "install the app" button.
- **Community**: public profiles at `/u/<username>` (readable signed out,
  so the link can be shared), a **live feed** of the latest ultra/secret
  pulls (Supabase Realtime), and luck-based **leaderboards** (hit rate, best
  pull, complete sets).
- **Installable PWA**: manifest, icons, and a service worker that keeps the
  app and already-seen card art available offline.
- **Dark/light theme** (follows the OS until you pick one) and
  **English/French** UI, both persisted locally.
- **"Holo Collector" design** built on shared design tokens (`--pb-*` CSS
  variables in `src/assets/styles/global.css`). Mobile-first.

## Tech stack

Vite, Vue 3 (Composition API), Vue Router, Pinia, vue-i18n, Bootstrap 5,
`@supabase/supabase-js`. Vitest for unit tests, Playwright for end-to-end
tests. Card data comes from the [pokemontcg.io](https://pokemontcg.io) API,
imported into Supabase by a script (see [Card data](#4-card-data)).

## Project structure

```
src/
  views/          one component per route (Home, Hub, Boosters, Collection, SetBinder,
                  History, Community, Profile — also public profiles —, ResetPassword, 404)
  components/     shared UI (auth form, booster/card animations, card detail, charts…)
  stores/         Pinia: auth, profile, collection, sets, wishlist, theme, settings
  api/            Supabase queries/RPC calls
  lib/            Supabase client, sound effects, share image, PWA helpers
  utils/          pure helpers (rarity, collection, profile, time…) + their unit tests
  i18n/locales/   en.json / fr.json — all UI strings
public/           manifest, icons, service worker (sw.js)
e2e/              Playwright tests + a mocked Supabase backend
supabase/migrations/   SQL to run in the Supabase SQL editor (schema, RLS, RPCs)
scripts/populate.mjs   admin script importing sets, cards and prices from pokemontcg.io
.github/workflows/     CI (tests on every push) and the weekly card-data sync
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
2. `supabase/migrations/0002_functions.sql` — the original booster RPCs.
3. `supabase/migrations/0003_realistic_boosters.sql` — realistic packs
   (`open_booster`), rarity buckets, set logo/symbol URL columns.
4. `supabase/migrations/0004_collector_social.sql` — server-side pack
   opening (`open_my_booster`), game modes, public profiles, opening
   history, live pull feed (added to the Realtime publication), wishlist,
   price history and the leaderboards. Deploy the matching client right
   after: older clients can't save packs any more.
5. `supabase/migrations/0005_challenge_mode.sql` — the challenge mode:
   wallets, coin ledger, daily reward, missions, paid boosters with god
   packs, recycling and crafting. Run it after 0004.
6. `supabase/migrations/0006_challenge_no_pity.sql` — removes the
   challenge's pity timer (real pull rates only, god packs stay). Run it
   after 0005; the current client needs it.

Then in **Authentication**:

- **URL Configuration**: set the Site URL to your deployed app and add
  `https://<your-app>/game` and `https://<your-app>/reset-password` (plus
  `http://localhost:5173/...` for local dev) to the Redirect URLs, so the
  confirmation and password-reset emails bring players back to the app.
- Email confirmation is on by default; you can turn it off in
  **Authentication > Settings** for easier local testing.

### 3. Configure the client app

Copy `.env.example` to `.env` and fill in your project's URL and anon key
(**Project Settings > API**):

```bash
cp .env.example .env
```

The anon key is safe to expose in the client — it's designed to be public;
access control is enforced entirely by the RLS policies and RPCs.

### 4. Card data

The app needs `sets` and `cards` imported before boosters can be opened.
This runs as an admin script (never shipped to the browser), using the
Supabase **service role key** (bypasses RLS for bulk writes) and a free API
key from [pokemontcg.io](https://pokemontcg.io/developers).

```bash
cp scripts/.env.local.example scripts/.env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POKEMONTCG_API_KEY

npm run populate:sets
npm run populate:cards   # also records today's prices for the price charts
```

`scripts/.env.local` is gitignored — the service role key must never be
committed or used client-side. The pokemontcg.io API is flaky: the script
retries, and `node scripts/populate.mjs cards <page>` resumes a partial run.
Behind a network that intercepts HTTPS (Node fails with
`SELF_SIGNED_CERT_IN_CHAIN`), prefix the command with `NODE_USE_SYSTEM_CA=1`.

**Weekly sync.** `.github/workflows/sync-cards.yml` runs
`npm run populate:sync` (sets + cards + price snapshot) every Monday. Add
three repository secrets in **Settings > Secrets and variables > Actions**:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POKEMONTCG_API_KEY`. It can
also be run by hand from the Actions tab.

### 5. Run it

```bash
npm run dev
```

## Tests

```bash
npm test          # unit tests (Vitest) on the pure logic in src/utils
npm run test:e2e  # end-to-end tests (Playwright), desktop + mobile
```

The e2e tests build the app against a fake Supabase host and mock the whole
backend (`e2e/support/supabase.js`), so they need no account, secret or
network. Playwright's browser: `npx playwright install chromium` once — or,
if that download is blocked, `PW_CHANNEL=chrome npm run test:e2e` uses your
installed Google Chrome. CI (`.github/workflows/ci.yml`) runs unit tests,
the build and the e2e tests on every push.

Before a release, go through the [manual test checklist](./docs/manual-testing.md)
with a real account.

## Deploying (Vercel)

1. **Env vars.** Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
   **Project Settings > Environment Variables**, then redeploy (Vite bakes
   them in at build time).
2. **SPA routing & service worker.** `vercel.json` rewrites every path to
   `index.html` (Vue Router history mode) and serves `sw.js` uncached so
   updates reach players.

## Scripts

| Command                  | What it does                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server                                       |
| `npm run build`          | Production build                                                |
| `npm run preview`        | Preview the production build locally                            |
| `npm test`               | Unit tests (Vitest)                                             |
| `npm run test:e2e`       | End-to-end tests (Playwright, mocked Supabase)                  |
| `npm run populate:sets`  | Import the `sets` table from pokemontcg.io                      |
| `npm run populate:cards` | Import the `cards` table (+ today's price snapshot)             |
| `npm run populate:sync`  | Sets + cards + prices in one go (what the weekly Action runs)   |

See [CLAUDE.md](./CLAUDE.md) for the full project rules and current state.
