# Pokémon Booster Game — Project Rules

Read this file before touching anything in this repo. It's the persistent memory
of the project: what it is, why it's built this way, and what must never regress.

## What this is

A Vue 3 SPA where a logged-in user opens Pokémon boosters — any set, as many
as they want — and builds a personal card collection. Originally a vanilla
HTML/CSS/JS prototype with no build tooling; rebuilt from scratch in Vue 3 +
Vite in September 2026 after the original was abandoned.

## Stack

Vite + Vue 3 (`<script setup>`, Composition API) + Vue Router + Pinia +
vue-i18n (v11) + `@supabase/supabase-js` v2 + Bootstrap 5. Vitest for unit
tests on pure logic. No custom backend — Supabase (Postgres + Auth) is the
entire backend.

## Architecture map

```
src/
  main.js, App.vue          entry point, mounts pinia/router/i18n, applies saved theme
  router/index.js           routes + auth guard (requiresAuth meta -> redirect to "/")
  stores/                   pinia: auth, profile, collection (one store per mode), challenge,
                            trades, sets, wishlist (per-player, reset on account switch),
                            theme + settings (per-device, localStorage)
  lib/supabaseClient.js     the one Supabase client instance, reads VITE_ env vars
  lib/                      also sfx.js (synthesized sounds), shareCard.js (share image), pwa.js
  api/                      thin wrappers around supabase-js calls (one file per domain)
  views/                    one per route
  components/               shared UI (auth form, theme toggle, language switch, booster/card visuals)
  i18n/locales/{en,fr}.json full UI coverage — every user-facing string goes here, none hardcoded
  utils/                    pure, testable helpers (e.g. groupCardsByQuantity)
  composables/              i18n-aware helpers shared by components (useAchievementText)
public/sw.js, manifest      PWA service worker + manifest + icons
e2e/                        Playwright tests; e2e/support/supabase.js mocks the whole backend
supabase/migrations/        SQL run manually in the Supabase SQL editor (no CLI/MCP access to the DB)
scripts/populate.mjs        admin-only Node script: sets/cards/prices from pokemontcg.io — never bundled to the client
.github/workflows/          ci.yml (unit + build + e2e) and sync-cards.yml (weekly populate:sync)
docs/manual-testing.md      checklist for a real-account click-through
```

## Golden rules (do not violate these)

1. **No custom password auth.** Authentication is Supabase Auth
   (`supabase.auth.*`) exclusively. Never add a hand-rolled `users` table or
   compare passwords in application code — the original project did this in
   plaintext and it was the single worst issue found in the audit.
2. **RLS is the only access boundary.** Every table gets Row Level Security
   enabled. `collections` rows are only readable by `auth.uid() = user_id`
   and, since 0004, **not writable by clients at all**. If a query needs
   broader access, it's either an admin job for `scripts/populate.mjs`
   (service role) or a narrow `SECURITY DEFINER` RPC that checks
   `auth.uid()` itself (see rule 9).
3. **No service role key in client code.** `VITE_*` env vars (client, safe to
   expose — access control is RLS, not secrecy of the anon key) are strictly
   separate from `scripts/.env.local` (service role key + pokemontcg.io key,
   gitignored, Node-only, never imported by anything under `src/`).
4. **Mutations that touch `quantity` must be atomic.** Use a Postgres RPC with
   `ON CONFLICT ... DO UPDATE` (see `open_my_booster` in
   `supabase/migrations/0004_collector_social.sql`; the 0002
   `add_cards_to_collection` was dropped). The original check-then-write
   client logic was a race condition; don't reintroduce that pattern.
5. **Every user-facing string goes through vue-i18n.** Add the key to both
   `src/i18n/locales/en.json` and `fr.json` in the same change — no bare
   strings in templates.
6. **Booster "type" = a Pokémon set, and packs follow real pull rates.**
   Packs come from `open_booster(p_set_id)` (migration 0003): 10 cards built
   slot by slot (4 common, 3 uncommon, 2 reverse slots, 1 rare slot) with
   weighted rarity buckets. `p_set_id = null` ("any set") = one random real
   set per pack, never a mix. Never go back to a uniform random draw (it gave
   ~4 rares and 1-2 hits per pack). The client calls `open_my_booster`
   (0004), which wraps `open_booster` and saves the pack; `random_cards*`
   from 0002 are unused leftovers.
7. **I have no direct access to the Supabase database** (no MCP/CLI
   connection). Any schema change ships as a new
   `supabase/migrations/000N_*.sql` file with a comment explaining what it
   does — I hand it to the user to run in the SQL editor, I never claim to
   have run it myself. The editor only shows "running": start migrations
   with `set local lock_timeout = '15s';` and put a `set local
   application_name = 'migration 000N: step i/n ...';` before each section,
   so the user can follow them live (query in `docs/manual-testing.md` >
   "Watching a migration run").
8. **Keep `README.md` current.** Update it in the same change whenever setup
   steps, npm scripts, or the feature list change — it's the user-facing
   counterpart to this file.
9. **Game state that others can see is written by the server only.**
   Collections, booster openings and the pull feed feed public profiles and
   leaderboards, so clients never insert/update them: they go through
   `SECURITY DEFINER` RPCs that only ever touch `auth.uid()`'s rows (and are
   rate limited, e.g. 60 packs/minute). Client writes are fine for purely
   personal data (wishlist, own profile columns via column grants).

## Conventions

- Composition API + `<script setup>` everywhere, no Options API.
- Pinia stores own async state + the loading/error flags for it; views stay
  thin and call store actions / `api/*` functions.
- Booster opening animations (the one thing the original prototype did
  well) were rebuilt in the design system, keeping their spirit: the pack
  pulses while drawing, then tears along a zigzag (`BoosterPack.vue`, two
  clipped copies of `BoosterArt`; `TEAR_MS` is exported for the view), and
  cards flip face-up one by one from a face-down pile (`CardStack.vue`).
  Keep them as scoped styles on those two components.
- **Booster art per set**: pokemontcg.io has no booster-wrapper images, so
  packs are generated: set logo + symbol and the set's chase card
  (`fetchSetCover`: most valuable Pokémon among its holo+ hits) cropped into
  a window. "Any set" = the generic foil pack (a mystery until torn open).
  Logo/symbol URLs are stored in `sets.logo_url` / `symbol_url` (0003):
  **since 2026 new sets' images live on images.scrydex.com** with another
  URL scheme, so never derive them from the set id again —
  `setLogoUrl(set)` only falls back to the old pattern for unfilled rows.
- **Opening flow** (`BoosterView.vue`): select (set picker inline on
  desktop, `<dialog>` bottom sheet on phones) -> per pack: draw + save
  immediately (so leaving mid-reveal never loses cards) -> tap to tear ->
  tap (or swipe, on the face-up card) to flip each card (sorted commons
  first, best last via `sortForReveal`) -> summary with best pull. Hits
  (ultra/secret) charge up ~0.55s face-down before flipping with a flash;
  their name/badges are delayed until then so nothing is spoiled. "New!"
  badges compare against the collection loaded on page mount.
- **Rarity**: 6 buckets (common, uncommon, rare, holo, ultra, secret)
  computed in SQL by `rarity_bucket()` (generated column
  `cards.rarity_bucket`) and mirrored in JS by `rarityBucket()` in
  `src/utils/rarity.js` — change both together. `rarityTier()` groups them
  into 3 visual tiers for halos.
- Animation checks: headless Chrome's GPU hides mobile jank (60 fps even
  with 4x CPU throttle), so judge choreography frame by frame instead: CDP
  `Animation.setPlaybackRate(0.1)` + scaling `setTimeout` by 10 in the page,
  then screenshot every second (= 100ms of animation).
- Touch screens keep `:hover` after a tap: wrap hover-only effects in
  `@media (hover: hover)` (see `.glow-button`).
- **Design system ("Holo Collector")**: dark-first, night-blue background,
  holographic foil accents, yellow primary actions. Fonts: Unbounded
  (display/headings) + Manrope (body), loaded from Google Fonts in
  `index.html`. All colors/radii/shadows are `--pb-*` tokens in
  `src/assets/styles/global.css`, redefined under `[data-bs-theme='light']`;
  the theme store sets `data-bs-theme` on `<html>` so Bootstrap follows too.
  Never hardcode colors in components — use the tokens. Shared building
  blocks: `.pb-glass`, `.pb-holo-text`, `.pb-eyebrow`, `.glow-button`,
  `HoloCard.vue` (tilt + foil shine, reuse it for rare cards),
  `BrandLogo.vue`, `ThemeToggle`,
  `LanguageSwitcher` (EN/FR segmented), `BoosterArt.vue` (CSS foil booster
  pack, size via `--booster-w`), `.pb-skeleton` (loading placeholder),
  `--pb-selected` (current item in navs), `--pb-ring` (selection ring),
  `--pb-bucket-*` (one color per rarity bucket, darker in light theme).
  Site-wide touches: foil scrollbars (`--pb-scroll-thumb`), `::selection`,
  `accent-color`/`caret-color` in `global.css`; `PointerFx.vue` (mounted
  in `App.vue`) = aurora glow behind the content + holo ring trailing the
  (kept) native cursor, mouse only, and a spark burst on click/tap. Page
  changes fade `.pb-page > main` in (opacity only) and sweep a foil line
  (`.route-sweep`, App.vue). All off under `prefers-reduced-motion` (so
  also in e2e, which forces it) or with Profile > Settings > Visual
  effects (`settings.effects` -> `html.pb-fx-off`).
- Don't name classes after Bootstrap components (`.badge`, `.card`,
  `.alert`...): Bootstrap's styles leak in (e.g. `.badge` centers text).
- **Signed-in page shell**: wrap the view in `<div class="pb-page">` and put
  `<AppHeader />` first. AppHeader = brand (links to the hub) + nav pills
  (desktop) + language/theme (log out is a labeled button on the Profile
  page only: a header icon got tapped by mistake), and a fixed bottom tab bar on phones
  and tablets (< 992px); `.pb-page` reserves the space for that bar. Don't put a
  `transform`/animation on a wrapper around AppHeader — it would break the
  tab bar's `position: fixed`. Legibility beats effects: anything
  sitting over imagery must be near-opaque. Check both themes at phone width.
- vue-i18n treats `@` as special: write `{'@'}` in locale strings (e.g. email
  placeholders) or the message fails to compile at runtime.
- New pure logic (sampling, grouping, formatting) goes in `src/utils/` with a
  co-located `*.test.js` (Vitest only runs `src/**/*.test.js`).
- **E2E**: `npm run test:e2e` (Playwright, desktop + Pixel 7) builds into
  `dist-e2e/` against the fake host `https://e2e.supabase.test` and mocks
  every Supabase call in `e2e/support/supabase.js` — **add new endpoints
  there** when a feature calls something new. On this machine the browser
  download is blocked: run with `PW_CHANNEL=chrome`. For animated elements
  use `click({ force: true })`, and wait for the pack to be enabled (it's
  disabled while the server draws).
- **Profiles**: `public.profiles` (0004) holds the unique, case-insensitive
  username (2-24 chars), `is_public` and `showcase_card_id`; a trigger
  creates it at sign-up (from the sign-up username or the email). Auth
  metadata is no longer read for the username — use `useProfileStore()`
  (`displayName` falls back to auth until loaded). `ProfileView.vue` serves
  both `/profile` (own, editable) and `/u/:username` (public, read-only,
  works signed out, `props: true`).
- **Game modes**: `collections.mode` / `booster_openings.mode`
  ('unlimited' | 'challenge'). The **challenge mode** (migrations 0005 + 0006) has
  its **own separate collection** (user decision) and a coin economy:
  `challenge_wallets` + `challenge_ledger` (read-only for clients), RPCs
  `challenge_state`, `claim_daily_reward`, `claim_mission`,
  `open_challenge_booster` (returns jsonb: cards, coins, god_pack),
  `recycle_duplicates`, `craft_card`. Each RPC locks the player's wallet row
  first (per-player mutex). Economy numbers live in SQL and are mirrored in
  `src/utils/challenge.js` — change both together. Game day = UTC.
  Client: `/challenge` (ChallengeView) + BoosterView / CollectionView /
  SetBinderView reused with a `mode` prop (`/challenge/boosters`,
  `/challenge/collection[/set/:setId]`, route `meta.mode`), links via
  `modeRoutes(mode)` (`src/router/modes.js`), collection store via
  `useModeCollectionStore(mode)`. `App.vue` keys `RouterView` by route name
  so both modes never share a view instance. The wishlist, showcase, public
  collection and leaderboards stay unlimited-only; the pull feed has both
  (`pull_feed.mode`). Coins render with `CoinAmount.vue` (`--pb-coin`).
- **Never let a player lose track of the mode** (user priority): every
  challenge page shows AppHeader's `.mode-strip` ("Challenge mode", coins,
  "Leave" → `/game`, phones included); Community and profiles
  (route `meta.sharedMode`) keep the mode the player came from
  (`routeMode(route)` in `src/router/modes.js`, remembered per tab in
  sessionStorage) instead of dropping them out of it; both hubs start with `ModeSwitch`
  (Unlimited | Challenge); challenge pages use explicit titles
  ("Challenge collection"); the empty challenge collection says the
  unlimited cards are safe. Every badge must come with its reason on the
  page it leads to (hub tile on phones, `.ch-waiting` callout at the top of
  `/challenge`). Pages without their own nav link light up their parent
  (`PARENTS` in AppHeader) and have a back link. `e2e/navigation.spec.js`
  guards all of this — extend it with any new page.
- Store "needs refresh" ≠ "not loaded": views show skeletons while
  `loaded` is false, so never reset it to mark data stale (use `stale` +
  a background `load({ force: true })`). Resetting it once hid the whole
  challenge hub — and unmounted the component that was supposed to
  trigger the reload (Vue drops `emit` from unmounted components).
- **Achievements** (`src/utils/achievements.js`): ~185 definitions in 14
  categories, all computed client side from the unlimited collection +
  sets in one pass (`collectorStats`) — nothing stored, so adding one
  unlocks it retroactively and public profiles get them too. Add a
  definition + its EN/FR title/description (`achievements.items.<id>.title`,
  `achievements.desc.<family>`); `achievements.test.js` fails on any
  missing translation. `hidden` ones show "???" until unlocked. UI:
  `AchievementTile.vue`, summary on the profile ("Next up"), full page
  `AchievementsView` (`/achievements`, `/u/:username/achievements`;
  search + category/status filters synced to `?cat=&status=&q=`).
  **Unlock toasts** (`useAchievementsStore().check()`, `AchievementToasts`
  in App.vue): compares with the ids already seen on this device
  (localStorage per account; the first check is a silent baseline) —
  called on BoosterView mount + at the summary (never mid-reveal: no
  spoilers), and on own profile / achievements page. Max 3 toasts, rarest
  first, the last one "+N more". **Rates** ("12% of players", migration
  0008): the client reports unlocked ids (`record_achievements`, retried
  until the server confirms) and reads `achievement_rates()`; a missing
  0008 just hides the rates. Deliberate, documented exception to rule 9:
  the ids are client-claimed (the server can't recheck ~185 JS
  definitions), acceptable because it only nudges an anonymous
  percentage that nothing ranks or rewards on.
- **Sounds/haptics**: `src/lib/sfx.js` synthesizes everything with Web Audio
  (no audio assets); every call takes `settings.sound` / `settings.vibration`
  from `useSettingsStore()`.
- **PWA**: `public/sw.js` — bump `VERSION` when changing it. It never caches
  Supabase; it caches only `no-cors` image loads (a cached opaque image
  served to the CORS load of `shareCard` would taint its canvas).
  Registered in production builds only (`src/lib/pwa.js`).
- **Charts**: load the `dataviz` skill first. Rarity buckets are ordinal, so
  charts use one violet ramp (`--pb-bucket-*`, validated with the skill's
  `validate_palette.js --ordinal` in both themes); single series use
  `--pb-series`, gridlines `--pb-grid`. See `PriceChart.vue`.

## Current state (updated 2026-09-25)

- Every view is redesigned in the "Holo Collector" design system: landing
  (auth incl. forgot password), hub (with a live-pull teaser), boosters
  (per-set generated packs, tear/flip/swipe, hit charge-up, sounds,
  vibration, "open all at once", share best pull), collection (Cards /
  Sets / Pokédex / Wishlist tabs, URL-synced filters, card detail with
  price chart, wishlist toggle and share), set binder
  (`/collection/set/:setId`), booster history (`/history`), community
  (`/community`: live feed + leaderboards), profile + public profiles
  (`/u/:username`), `/reset-password`, 404. PWA installable.
- **Challenge mode** built 2026-09-25: migration
  `0005_challenge_mode.sql` **applied 2026-09-25** (after 0004);
  verified with PGlite (65 checks: RLS, grants, start bonus, daily streak,
  missions, pity, god pack, recycle, craft, rate limit, feed, wishlist).
  **The pity timer was then removed (user decision: nothing costs real
  money, keep real-life pull rates; god packs stay)**:
  `0006_challenge_no_pity.sql` **applied 2026-09-25** — verified with
  PGlite on a 0005 database (28 checks: columns dropped, god pack kept and
  still drawn, 17-18% hit rate over 1,000 packs, 27+ pack dry streaks
  possible). Never reintroduce a pity timer or anything that bends the
  rates in either mode.
- **Challenge trades, history, leaderboards, badge** built 2026-09-25:
  `0007_challenge_trades.sql` **written but NOT applied** (run after
  0006). Trades: `trade_offers` (read-only for clients), 1-5 of your cards
  for 0-5 of theirs (0 = gift), public profiles only, 10 pending max,
  7-day expiry, accept swaps atomically under both wallet locks (ordered)
  or ends 'failed'. RPCs `propose_trade`, `respond_trade`, `cancel_trade`,
  `my_trades`, `challenge_collection_of`; `challenge_badge()` (rewards +
  incoming offers, never creates a wallet) drives the nav badges
  (`useChallengeStore().loadBadge`, 60s throttle); `leaderboard()` gains
  `challenge_unique` / `challenge_value`. Client: `/challenge/trades`
  (TradesView, `?to=<username>` prefill, "Propose a trade" on public
  profiles), `/challenge/history` (HistoryView `mode` prop, god packs
  flagged). Verified with PGlite (49 checks). The desktop nav now starts
  at 992px (6 links in the challenge); the tab bar covers phones and
  tablets.
- **Supabase**: migrations 0001-0003 applied (0003 on 2026-09-24, then
  `populate:sets` re-run: 176 sets with logo/symbol URLs). `cards` has
  20,670 rows. **Migration 0004 (`0004_collector_social.sql`) applied
  2026-09-25** (checked through the REST API with the service role key:
  tables and RPCs answer) — the current client depends on it (it calls
  `open_my_booster`, reads `profiles`, `wishlist`, `booster_openings`,
  `pull_feed`, `card_price_history`, filters `collections.mode`). 0004 was verified locally with PGlite
  (35 checks as the anon/authenticated roles: RLS, column grants, unique
  usernames, owned-only showcase, rate limit, backfill of existing users,
  private profiles hidden everywhere, idempotent).
- **Achievement rates** built 2026-09-25: `0008_achievement_rates.sql`
  **written but NOT applied** (run after 0007). Verified with PGlite
  (15 checks: no client access to `achievement_unlocks`, anon can't
  record, malformed/duplicate ids skipped, 500 ids max, only players with
  unlimited cards count, anon reads rates, cascade on user delete, runs
  twice). The client works without it (no percentages).
- `npm test`: 99 unit tests. `npm run test:e2e`: 88 tests (44 x desktop +
  mobile). `npm run build` passes, 0 npm audit
  vulnerabilities. Screens were also reviewed in headless Chrome with
  realistic mocks (both themes, phone width) — not yet on a real phone.
- `.env` is not on this machine (screens were tested with mocks);
  `scripts/.env.local` is (service role + the old pokemontcg.io key).
- Deployed to Vercel for manual testing (`VITE_*` env vars set there;
  `vercel.json` has the SPA rewrite and serves `sw.js` uncached).
- Legacy static files of the original prototype were deleted — recoverable
  from git history if ever needed.

## TODO

- **Apply `0007_challenge_trades.sql`** in the SQL editor (user), then
  deploy right away: the current client calls the 0007 RPCs (badge,
  trades, challenge leaderboards). 0001-0006 are applied. Then
  `0008_achievement_rates.sql` (optional for the client: without it,
  achievements just show no percentages).
- Post-migration dashboard steps (user): Supabase Auth > URL Configuration
  redirect URLs (`<site>/game`, `<site>/reset-password`); check that
  `pull_feed` is in the `supabase_realtime` publication; the three GitHub
  secrets for `sync-cards.yml`.
- Go through `docs/manual-testing.md` with real accounts (never done so
  far — real sign-ups need the confirmation email, which is ON; trades
  need two accounts).
- Push notifications when the app is closed (daily reward ready, trade
  offer received): needs Web Push — VAPID keys, a subscriptions table, and
  a Supabase Edge Function + scheduled job to send them, which I can't
  deploy without CLI access. In-app badges cover the app-open case.
- Live trade updates: subscribe to `trade_offers` changes (Realtime) so an
  incoming offer or an answer shows up without a reload.
- Counter-offers: answer a trade with a modified offer instead of only
  accept/decline.
- Show the challenge collection on public profiles (a tab next to the
  unlimited one), so partners can browse before offering.
- Challenge achievements and stats on the profile (packs bought, coins
  earned, trades done, god packs pulled).
- Weekly missions (bigger goals, bigger rewards) on top of the daily ones.

## Known gaps

- The hit-rate leaderboard only counts packs opened after 0004 (older
  packs were never logged).
- Price charts need at least two `populate:cards` runs on different days;
  the weekly Action provides that once its secrets are set.
- The pokemontcg.io API key in use is the one exposed in this repo's git
  history — rotate it if the repo is ever made public.
- The collection is fetched in one query; the grids render progressively.
  Revisit with server-side paging past tens of thousands of distinct cards.
  Trade pickers show 60 matches at most (search narrows them).

## Machine notes

- nvm default is Node 6 here — use `nvm use` (`.nvmrc` = 22).
- The network intercepts HTTPS: Node scripts need `NODE_USE_SYSTEM_CA=1`
  (never `NODE_TLS_REJECT_UNAUTHORIZED=0`), and Playwright can't download
  browsers (use `PW_CHANNEL=chrome`).
- PGlite (`@electric-sql/pglite`, installed in a scratch dir, not the
  repo) is how migrations get checked locally: stub `auth.users`,
  `auth.uid()` from `request.jwt.claim.sub`, and the anon/authenticated
  roles, then run 0001..000N.
- To check what's applied on the real project: REST calls with the
  service role key from `scripts/.env.local` (a missing table answers 404,
  an existing RPC called without a user answers `not_authenticated`).
