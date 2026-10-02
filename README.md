# Pokémon Booster Game

Open Pokémon boosters — any set, as many as you want — and build your own
collection. A Vue 3 single-page app (installable as a PWA) backed by
Supabase (Postgres + Auth + Realtime).

How it works inside (every table, RPC and flow, in French):
[technical documentation](./docs/technique/README.md).

## Features

- **Real authentication** via Supabase Auth (email/password), with email
  confirmation and a "forgot password" flow — no plaintext passwords, no
  homemade session logic. The landing opens on "Sign up" for a newcomer
  ("Log in" on a device that had an account), and a username is required
  (public profiles used to show the start of the email).
- **Unlimited boosters, any type**: pick a specific Pokémon set (searchable,
  grouped by year, each pack shows the set's logo and chase card, and how
  much of it you've collected in that mode, with a "Complete" badge) or "any
  set" (one random set per pack), and how many boosters to open (a first
  visit suggests Base, 151 and the newest set; on phones the count and the
  open button stay together above the tab bar, and short phones show the
  pack next to its name). Tear each
  pack open, flip or swipe the cards one by one (rarest last, with rarity,
  "New!" and "Wanted!" badges; hits charge up and flash), or open them all
  at once. Packs follow real pull rates: 10 cards, one guaranteed rare, a
  holo/ex about every 5 packs, a big hit now and then. Every pack is drawn
  and saved **server-side** in one call, so nobody can add cards to their
  own collection from the browser console.
- **Challenge mode** (`/challenge`): a second, separate collection built
  with coins. Start with 1,000 coins, pay 100 per booster, earn more with a
  daily reward that grows over a 7-day streak, three daily missions and
  four **weekly missions** (reset Monday 00:00 UTC, bigger rewards),
  recycle duplicates into coins (all of them, or **pick which ones**, card by
  card or a whole rarity at once, and how many copies of each with − / +,
  also from a card's detail; "Keep" 1 to 4 copies of each card) and craft the cards you're missing. Earn
  coins with the **mini-games** (`/challenge/games`, their own tab in the
  challenge and a tile near the top of its hub), starting with
  **"Higher or lower"**:
  two cards, tap the pricier one within 15 seconds; 3 paid runs a day at
  5 coins per right answer (100 per run at most), then unlimited runs for
  the record — and **"Shiny Electrode Flip"** (Voltorb Flip): a 5x5 board
  of 1s, 2s, 3s and shiny Electrodes with row/column hints; flip every 2
  and 3 to clear it and move up a level (5 levels), an Electrode loses the
  board, cash out any time; points = coins, up to 300 a day — and
  **"Super effective!"**: a Pokémon card shows up (its top half), tap the
  type it's weak to within 10 seconds (the weakness printed on the card;
  3, then 4, then 6 types to pick from), same pay as "Higher or lower", and
  **"Evolution chain"**: the cards of one evolution line (3 stages, or 2
  like Pikachu and Raichu) show up shuffled (art and names only, the printed
  stage is hidden), tap them from the Basic to the last stage within 15
  seconds; intruders from other lines slip in as the streak grows, and
  "Stop" ends a run keeping its coins. The simplest game, so it pays the least: 3 coins per
  right line (60 per run, 180 a day at most). One more is teased as
  "Coming soon" (**Boss raid**). Packs
  keep the real pull rates (no pity timer), except that 1 booster in 500 is
  a "god pack" (holos and better only). **Trade cards** with other
  trainers (up to 5 for 5, or as a gift; the trainer field suggests
  usernames as you type, and every card in the pickers says how many
  copies you own, 60 at a time with "Show more"; answer an offer with a
  **counter-offer**; a missing card's detail lists **who has it in
  double**, one tap from an offer; public profiles show their
  **challenge collection** with an "Ask for it" button per card; offers
  and answers show up **live**, no reload, with a pop-up for a new offer and
  for an answer to yours (accepted, declined or failed); answers you haven't
  seen yet get a badge and open the trades page; any card's detail has
  "Offer in a trade"; you can turn trade offers off,
  or keep chosen cards **out of trades** from their detail), follow your challenge booster history, and climb the two
  challenge leaderboards. Badges in the navigation show rewards to claim,
  offers to answer and answers to read; on phones the challenge strip has a
  Trades shortcut. A first visit gets "The challenge in short" (three
  lines) under the wallet, the full rules stay folded at the bottom, and
  resets are given in your own time ("02:00"), not "midnight UTC"; the
  daily reward has one claim button (the callout at the top). A new player's trades page says to open challenge
  boosters first and suggests trainers with big collections. Every coin
  and card moves server-side, and the unlimited collection is never
  touched.
- **Two modes, never mixed up**: an "Unlimited | Challenge" switch on both
  hubs, and a "Challenge mode" strip (coins + "Leave") on every challenge
  page.
- **Sound & haptics**: synthesized sound effects (tearing, flips, hit
  fanfares — no audio files) and a vibration on hits, both switchable.
- **Hub**: greeting, quick access to boosters, collection progress, profile
  summary, latest pulls, and a peek at the community's live pulls.
- **Collection**: every card you've pulled with completion stats and an
  estimated value (Cardmarket, or TCGplayer converted to euros for recent
  sets that have no Cardmarket price); search, filter by set, rarity or duplicates,
  and sort — all kept in the URL. The search knows the **French Pokémon
  names** too ("Dracaufeu" finds Charizard; card names are English only),
  the card detail says the French name, and the Pokédex names species in
  French. The detail's rarity is the site's own (translated), with the
  one printed on the card as a note. Next to the overall progress,
  the **most advanced set** ("Base: 1 / 102") is a goal within reach (also
  on both hubs). Tabs for:
  - **Sets**: per-set completion, each opening a **binder** with every card
    of the set in number order and the missing ones greyed out in their slot;
  - **Pokédex**: national Pokédex progress (caught species in color, the
    others as silhouettes);
  - **Wishlist**: cards you're hunting (pulling one takes it off the list).
- **Card detail**: full-size holo card, set and number, rarity, copies,
  first pull date, illustrator, **price history chart** (daily Cardmarket
  snapshots), wishlist toggle for missing cards, and **sharing** a generated
  image of the card.
- **Last set remembered**: the booster page preselects the set (and the
  number of packs) you opened last, separately in each mode (on a new
  device: your last logged pack).
- **Booster history**: every pack you've opened, grouped by day, under
  your totals: the **exact number of boosters opened**, today, best day,
  packs with a hit (and the rate), longest daily streak, most opened set,
  and an "All | With a hit" filter to find your big pulls.
- **Subsets inside their parent's packs**: Trainer Gallery, Galarian
  Gallery, Shiny Vault and Classic Collection were never sold as boosters,
  so they aren't in the set list: their cards turn up in the parent set's
  packs (about 1 pack in 3-4), like in real life.
- **Profile**: trainer card with a unique username and a rank that grows
  with the boosters you open, a holo **Beta tester** badge (every account
  created before the beta ends — `BETA_END` in `src/utils/beta.js`), a showcase card, stats, rarity breakdown
  (level, stats, rarity and achievements per game mode: Challenge | Unlimited),
  public/private switch, sound / vibration / visual effects / **larger
  text** (bigger letters, darker secondary text) settings (one tap away
  from the top of the profile), a
  **booster animations** setting (Auto / Full / Light — Light, the default on
  touch screens, drops the 3D flip and the glow layers that stuttered on
  phones), and an
  "install the app" button.
- **Achievements**: ~1210 of them in 20 categories (boosters, luck, pulls, sets,
  Pokédex regions, starters, evolution lines, legends and mythicals,
  famous trainers (gym badges = each Kanto to Kalos gym leader's team, Alola's grand trials, Galar's and Paldea's gym leaders, the
  Pokémon League, rivals & heroes, Kanto's trainers on their own cards),
  places, types, mechanics, treasure, illustrators,
  subsets, daily streaks, a challenge-only "coins & trades" one, a few
  secret ones…), **in each game mode** — the challenge ones are the
  ones that count (every pack costs coins), and stay unlocked even after
  recycling or trading. At `/challenge/achievements` and `/achievements`
  (and `/u/<username>/achievements?mode=…`), with an Unlimited | Challenge
  switch,
  with search, category/status/**region** filters, subcategories inside the
  big categories, progress bars per category and
  overall, and **collapsible categories** (remembered on the device). Computed from the collection, so new ones unlock retroactively.
  **Kanto (Gen 1) in depth**: every Red/Blue evolution line (and all of
  them), the Pokémon that don't evolve, babies, later evolutions and
  regional forms of Kanto Pokémon, every route and cave (Pokémon found
  there in Red/Blue, Mt. Silver in Gold/Silver), the cities that have a
  card, and cards of Kanto's trainers (gym leaders, Elite Four, Red & Blue,
  Oak, Bill, Team Rocket).
  **Johto (Gen 2) the same way**: every Gold/Silver line, loners, babies,
  later evolutions and regional forms of Johto Pokémon, Routes 29 to 46
  and every cave, tower and building (Pokémon found there in Gold/Silver),
  Johto's Elite Four and champion Lance, Johto places and trainers on
  cards (gym leaders, Elite Four, Ethan, Professor Elm, Team Rocket's
  executives), the Neo and HeartGold & SoulSilver sets. **Hoenn (Gen 3)**
  too: Ruby/Sapphire lines and more, Routes 101 to 134, caves and peaks,
  gym badges, Elite Four, Wally, Maxie and Archie, Steven, Team Magma and
  Team Aqua on cards, the first EX sets and the ORAS era. **Sinnoh
  (Gen 4)** as well: Diamond/Pearl lines, fossils, the babies and the
  evolution boom of DP, Hisui's forms and newcomers, Routes 201 to 230, the
  lakes, Mt. Coronet and every cave, gym badges, Elite Four, Cyrus,
  Cynthia and Team Galactic on cards, the DP, Platinum and 2022 sets. **Unova
  (Gen 5)** too: Black/White lines, loners, fossils, the Striaton monkeys,
  Routes 1 to 18, Dragonspiral Tower, Giant Chasm and the other caves, gym
  badges, Elite Four, N and Ghetsis, N and Team Plasma on cards, the Black &
  White and Plasma sets, Black Bolt and White Flare. **Kalos (Gen 6)** as
  well: X/Y lines, loners, fossils, Routes 2 to 22, Santalune Forest,
  Terminus Cave and the other caves, gym badges, Elite Four, Lysandre and
  AZ, Diantha and Team Flare on cards, the XY sets and the Mega Evolution
  series. **Alola (Gen 7)** too: Sun/Moon lines, loners, the trials' totems,
  Routes 1 to 17, Ten Carat Hill, Vast Poni Canyon and the other places, the
  kahunas' grand trials, Elite Four, Lusamine, Guzma and Kukui, kahunas,
  captains, Lillie, the Aether Foundation and Team Skull on cards, the Sun &
  Moon sets. **Galar (Gen 8)** as well: Sword/Shield lines, loners, fossils,
  Routes 1 to 10, the Slumbering Weald, the mines and Glimwood Tangle, all 10
  gym badges (both versions), Marnie, Bede, Rose and Oleana, gym leaders,
  Leon, rivals, Team Yell and five towns on cards, the Sword & Shield sets.
  And **Paldea (Gen 9)**: Scarlet/Violet lines, loners, the Titans, the
  Paradox Pokémon, gym leaders, Elite Four, Geeta, Arven, Penny and both AI
  professors, the League, friends, Team Star and Academy staff on cards,
  Mesagoza, Artazon and Levincia, the Scarlet & Violet sets (no routes:
  the wild Pokémon of Scarlet/Violet aren't in PokéAPI). Data for a new
  region: `node scripts/region-tools.mjs` (PokéAPI, dev only; `fr-names`
  rewrites `src/utils/pokemonNamesFr.js`, the French names the collection
  search uses).
  A Steam-style **"Achievement unlocked" pop-up** (with a chime) shows at the
  end of an opening — never mid-reveal, so nothing is spoiled, and only
  after a moment so the best pull is seen first; two pop-ups at most, the
  second saying "+14 more achievements" — and each
  achievement shows the **share of players** who have it.
- **Community**: public profiles at `/u/<username>` (readable signed out,
  so the link can be shared), a **live feed** of the latest ultra/secret
  pulls (holos for old sets that have nothing rarer, like Base Set;
  Supabase Realtime; Challenge | Unlimited switch), and luck-based **leaderboards** (hit rate, best
  pull, complete sets), which also show **your own rank** past the top 20,
  or what gets you on the board.
- **Installable PWA**: manifest, icons, and a service worker that keeps the
  app and already-seen card art available offline.
- **Always the latest version**: a tab left open picks up a new deploy by
  itself at the next page change (and a page whose files a deploy removed
  still opens).
- **Dark/light theme** (follows the OS until you pick one) and
  **English/French** UI, both persisted locally.
- **"Holo Collector" design** built on shared design tokens (`--pb-*` CSS
  variables in `src/assets/styles/global.css`). Mobile-first. Light touches
  everywhere: foil scrollbars, a glow and holo ring following the mouse,
  sparks on tap, page transitions (all can be turned off, and respect
  "reduce motion").

## Tech stack

Vite, Vue 3 (Composition API), Vue Router, Pinia, vue-i18n, Bootstrap 5,
`@supabase/supabase-js`. Vitest for unit tests, Playwright for end-to-end
tests. Card data comes from the [pokemontcg.io](https://pokemontcg.io) API,
imported into Supabase by a script (see [Card data](#4-card-data)).

## Project structure

```
src/
  views/          one component per route (Home, Hub, Boosters, Collection, SetBinder,
                  History, Community, Profile — also public profiles —, Achievements, ResetPassword, 404)
  components/     shared UI (auth form, booster/card animations, card detail, charts…)
  stores/         Pinia: auth, profile, collection, sets, wishlist, theme, settings
  api/            Supabase queries/RPC calls
  lib/            Supabase client, sound effects, share image, PWA helpers
  composables/    shared Composition API helpers (achievement texts)
  utils/          pure helpers (rarity, collection, profile, achievements, time…) + their unit tests
  i18n/locales/   en.json / fr.json — all UI strings
public/           manifest, icons, service worker (sw.js)
e2e/              Playwright tests + a mocked Supabase backend
supabase/migrations/   SQL to run in the Supabase SQL editor (schema, RLS, RPCs)
supabase/tests/        migration tests in PGlite (npm run test:db)
scripts/populate.mjs   admin script importing sets, cards and prices from pokemontcg.io
.github/workflows/     CI (tests on every push) and the card-data sync (twice a day)
docs/technique/        technical documentation (French): architecture, database, API, flows, tooling
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
   after 0005.
7. `supabase/migrations/0007_challenge_trades.sql` — trades between
   players, challenge leaderboards and the navigation badge. Run it after
   0006; the current client needs it.
8. `supabase/migrations/0008_achievement_rates.sql` — "X% of players"
   under each achievement: clients report their unlocks, anyone reads the
   anonymous counts. Run it after 0007; until then the achievements work
   without percentages.
9. `supabase/migrations/0009_achievements_by_mode.sql` — achievements per
   game mode (rates, recorded unlocks, packs opened per mode). Run it after
   0008; until then the challenge achievements work without percentages,
   and unlocks aren't kept if the challenge collection shrinks.
10. `supabase/migrations/0010_subsets_and_pack_stats.sql` — subsets
   (Trainer Gallery, Shiny Vault, Classic Collection…) come inside their
   parent set's packs instead of being opened on their own (they gave packs
   of 10 holos), and the server returns exact pack stats (history totals,
   luck / streak / economy achievements). Run it after 0009 (it refuses to
   run otherwise); until then
   those totals and achievements stay empty. New subsets get linked by
   `npm run populate:sync` (`link_subsets()`).
11. `supabase/migrations/0011_weekly_missions_live_trades.sql` — weekly
   challenge missions, and trade offers pushed live (adds `trade_offers` to
   the Realtime publication). Run it after 0010; until then no weekly
   missions, and trades refresh on reload only.
12. `supabase/migrations/0012_trade_preferences.sql` — "Accept trade
   offers" switch and cards kept out of trades, enforced by the server. Run
   it after 0011; until then everyone accepts trades.
13. `supabase/migrations/0013_minigame_higher_lower.sql` — the "Higher or
   lower" mini-game (server-drawn pairs, answers checked and paid by the
   server, 3 paid runs a day). Run it after 0012; until then the challenge
   hub simply doesn't show the mini-game.
14. `supabase/migrations/0014_minigame_electrode_flip.sql` — the "Shiny
   Electrode Flip" mini-game (boards dealt and kept by the server, 300
   coins a day at most). Run it after 0013; until then the game says
   "Coming soon".
15. `supabase/migrations/0015_minigame_super_effective.sql` — the cards'
   weaknesses (`cards.weaknesses`) and the "Super effective!" mini-game.
   Run it after 0014, then re-run the card import (`npm run populate:cards`,
   or the "Sync cards" Action) to fill the weaknesses; until both are done
   the game says "Coming soon".
16. `supabase/migrations/0016_feed_top_rarity.sql` — sets with no
   ultra/secret card at all (Base, Jungle, Fossil, Neo, Gym, DP...) post
   their holos to the live feed. Run it after 0015; until then those sets
   never show up in the feed.
17. `supabase/migrations/0017_trade_answers_recycle_picks.sql` — answers to
   your trade offers get a badge until you open the trades page, and
   recycling a pick of duplicates in one call. Run it after 0016; until
   then answers only pop up live (no badge) and a pick is recycled one
   card at a time.
18. `supabase/migrations/0018_minigame_evolution_chain.sql` — the cards'
   previous stage (`cards.evolves_from`) and the "Evolution chain"
   mini-game. Run it after 0017; the next card sync (twice a day, or run the
   "Sync cards" Action / `npm run populate:cards`) fills `evolves_from`;
   until both are done the game says "Coming soon".
19. `supabase/migrations/0019_evolution_chain_two_stages_stop.sql` —
   "Evolution chain" also asks two-stage lines (Pikachu, Raichu) and gets
   a Stop button. Run it after 0018; until then every line has 3 stages
   and Stop just ends the run on screen.
20. `supabase/migrations/0020_recycle_copies.sql` — recycling only some
   copies of a card (the − / + in "Choose…"). Run it after 0017; until
   then only "every extra copy" works and a partial pick shows an error.
21. `supabase/migrations/0021_trade_counter_offers.sql` — counter-offers
   (answer a trade offer with another one). Run it after 0020; until then
   "Counter" shows an error.
22. `supabase/migrations/0022_my_rank_card_traders.sql` — your own rank
   under each leaderboard, and "Who has it in double?" on a missing
   challenge card. Run it after 0021; until then the leaderboards show the
   top 20 only and the search says it isn't available yet.
23. `supabase/migrations/0023_username_not_from_email.sql` — an account
   created without a username is named `Trainer-1234`, never after its
   email (the sign-up form requires one anyway). Run it after 0022.

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

**Card sync.** `.github/workflows/sync-cards.yml` runs
`npm run populate:sync` (sets + cards + price snapshot) every day at
midnight and noon, Paris time (GitHub can start scheduled runs late). Add
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
npm run test:db   # the SQL migrations in an in-memory Postgres (PGlite): RLS, grants, RPCs
npm run test:e2e  # end-to-end tests (Playwright), desktop + mobile
```

The e2e tests build the app against a fake Supabase host and mock the whole
backend (`e2e/support/supabase.js`), so they need no account, secret or
network. Playwright's browser: `npx playwright install chromium` once — or,
if that download is blocked, `PW_CHANNEL=chrome npm run test:e2e` uses your
installed Google Chrome. `test:db` needs nothing either: PGlite runs
Postgres in-process, with Supabase's auth and roles stubbed
(`supabase/tests/harness.mjs`). CI (`.github/workflows/ci.yml`) runs unit
tests, database tests, the build and the e2e tests on every push.

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
| `npm run test:db`        | Migration tests in PGlite (optional filter: `npm run test:db 0012`) |
| `npm run test:e2e`       | End-to-end tests (Playwright, mocked Supabase)                  |
| `npm run populate:sets`  | Import the `sets` table from pokemontcg.io                      |
| `npm run populate:cards` | Import the `cards` table (+ today's price snapshot)             |
| `npm run populate:sync`  | Sets + cards + prices in one go (what the sync Action runs)     |

See [CLAUDE.md](./CLAUDE.md) for the full project rules and current state.
