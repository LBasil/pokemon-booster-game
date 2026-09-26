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
supabase/tests/             PGlite suites for the migrations (npm run test:db)
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
   from 0002 are unused leftovers. **Subsets are never opened on their own**
   (0010): Trainer/Galarian Gallery, Shiny Vault, Classic Collection have
   `sets.parent_set_id` + `subset_rate`; `open_booster(subset)` opens the
   parent pack, "any set" skips them, and a parent pack's slot 8 becomes a
   subset card with that chance (slots 9/10 untouched). Opened alone they
   gave 10-holo packs (no commons -> every slot fell back to "any card").
   The client hides them from the picker (`boosterSets`) and maps
   `?set=<subset>` to the parent (`packSetId`).
7. **I have no direct access to the Supabase database** (no MCP/CLI
   connection). Any schema change ships as a new
   `supabase/migrations/000N_*.sql` file with a comment explaining what it
   does — I hand it to the user to run in the SQL editor, I never claim to
   have run it myself. The editor only shows "running": start migrations
   with `set local lock_timeout = '15s';` and put a `set local
   application_name = 'migration 000N: step i/n ...';` before each section,
   so the user can follow them live (query in `docs/manual-testing.md` >
   "Watching a migration run"). Every new migration comes with a
   `supabase/tests/000N_*.test.mjs` suite (`npm run test:db`, PGlite: RLS,
   grants, RPCs, runs twice) that passes before it's handed over.
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
  badges compare against the collection loaded on page mount. The picker
  preselects `?set=`, else the last set opened in that mode on this device
  (localStorage `pb-last-set:<mode>`, '' = any set), else the set of the
  last pack `booster_openings` logged in that mode (new device). The pack
  count (1/3/5/10) is remembered too (`pb-last-count:<mode>`).
- **Rarity**: 6 buckets (common, uncommon, rare, holo, ultra, secret)
  computed in SQL by `rarity_bucket()` (generated column
  `cards.rarity_bucket`) and mirrored in JS by `rarityBucket()` in
  `src/utils/rarity.js` — change both together. `rarityTier()` groups them
  into 3 visual tiers for halos.
- **Lite animations** (`settings.animations`: auto | full | light,
  `settings.liteAnimations`; auto = light on `(pointer: coarse)`): the full
  tear/flip stuttered on phones (3D flip + preserve-3d, 10 will-change
  layers, blur halos, blend-mode sheen). Lite = one copy of the pack that
  squeezes/pops in `TEAR_MS_LITE`, flat cards whose front pops over the
  back, only ~5 cards in the DOM, static rings instead of blurred halos.
  Both live in `BoosterPack.vue` / `CardStack.vue` (`lite` prop). The
  Pixel 7 e2e project runs the lite path.
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
- **Responsive**: a single-column grid must say `grid-template-columns:
  minmax(0, 1fr)` (and its items `min-width: 0`), or a nowrap/scrolling
  child (tabs, chips) widens the page — it made /community 628px wide on
  phones. `e2e/navigation.spec.js` > "no page scrolls sideways" checks every
  page at phone width; add new pages there. Check 320px too (narrowest
  supported): tab counts, the challenge wallet art and the mode strip
  icon hide below 375px.
- Long pages (collection, binder, achievements, history) mount
  `ScrollTopButton.vue` after `</main>` (sits above the phone tab bar).
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
  **Weekly missions** (0011): ISO week in UTC (Monday 00:00), ids
  `week_*`, claimed through the same `claim_mission` with the ledger row
  dated on the Monday (so the existing unique index = once a week);
  `challenge_state()` returns `weekly` + `week_start`; the client only
  mirrors the reset time (`msUntilWeeklyReset`).
  **Trades**: `trade_offers` is in `supabase_realtime` (0011) and
  `App.vue` runs `useTradesStore().live(userId)` while signed in (badge,
  list, challenge collection after a swap). Preferences (0012):
  `profiles.accepts_trades` (off -> `trades_closed`, waiting offers stay
  answerable) and `trade_locks` (personal, client-written like the
  wishlist): a locked card can't be asked for or offered
  (`card_not_for_trade`), and an accept fails if the sender locked an
  offered card since; `challenge_collection_of` returns `tradable`.
  Public profiles list the challenge collection with "Ask for it" ->
  `/challenge/trades?to=<name>&want=<card id>`.
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
- **Achievements** (`src/utils/achievements.js`): ~240 definitions in 16
  categories, **per game mode** (user decision: separate, the challenge
  put first — it's the one that counts). Computed client side from that
  mode's collection + sets in one pass (`collectorStats`), plus the
  server's `player_achievements(mode, username?)` (0009): ids already
  recorded stay unlocked (the challenge collection shrinks: recycling,
  trades) and packs opened per mode (challenge: the server count is the
  truth; unlimited: max with cards / 10, old packs were never logged).
  Adding a definition unlocks it retroactively; public profiles get
  them too. Since 0010 `player_achievements` also returns `stats` (exact
  pack counts from `booster_openings`: hit packs, best day, streaks, sets,
  top set; challenge: trades, gifts, coins earned, missions, crafts,
  recycling, best daily streak) — read as `s.server.*` by the luck /
  streak / economy definitions. `modes: [...]` restricts a definition to
  a mode (economy + god pack = challenge only); `achievementProgress`
  drops empty categories. Add a
  definition + its EN/FR title/description (`achievements.items.<id>.title`,
  `achievements.desc.<family>`); `achievements.test.js` fails on any
  missing translation. `hidden` ones show "???" until unlocked. UI:
  `AchievementTile.vue`; `useModeAchievements(mode, username?)`
  (composable: own or public, per mode) feeds the profile summary
  (Challenge | Unlimited tabs, "Next up"), the challenge hub tile and
  `AchievementsView` (`/challenge/achievements` + `/achievements`, `mode`
  prop; `/u/:username/achievements?mode=`; Challenge | Unlimited switch
  keeping the filters; search + category/status filters synced to
  `?cat=&status=&q=`). Categories collapse (header button, "Collapse /
  Expand all"), remembered per device in `pb-achievements-collapsed`; a
  search or a picked category always shows what it matches.
  **Unlock toasts** (`useAchievementsStore().check()`, `AchievementToasts`
  in App.vue): `check(mode)` compares with the ids already seen on this
  device (localStorage per account and mode; the first check is a silent
  baseline) — called on BoosterView mount + at the summary in both modes
  (never mid-reveal: no spoilers), and wherever `useModeAchievements`
  shows the player's own (profile, achievements page, challenge hub). Max 3 toasts, rarest
  first, the last one "+N more". **Rates** ("12% of players", migrations
  0008 + 0009, per mode): the client reports unlocked ids
  (`record_achievements(ids, mode)`, retried until the server confirms)
  and reads `achievement_rates(mode)`; `src/api/achievements.js` falls
  back to the 0008 signatures and hides what a missing migration can't
  give. Deliberate, documented exception to rule 9:
  the ids are client-claimed (the server can't recheck ~240 JS
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

## Current state (updated 2026-09-26)

- **Live**: deployed on Vercel (`VITE_*` env vars set there; `vercel.json`
  has the SPA rewrite and serves `sw.js` uncached), used by the user on a
  real account ("tout fonctionne", 2026-09-26). **Migrations 0001-0012 are
  all applied** (checked 2026-09-26 through the REST API with the service
  role key). `cards` has 20,670 rows, `sets` 176 (9 subsets linked to
  their parent).
- Features: landing (auth, forgot password), hub, boosters (per-set packs,
  real pull rates, subsets inside their parent's packs, tear/flip/swipe,
  lite animations on touch screens, sounds, vibration, open all, share,
  last set + count remembered), collection (Cards / Sets / Pokédex /
  Wishlist, URL filters, card detail with price chart), set binders,
  history (exact totals, "With a hit" filter), community (live feed +
  leaderboards), profiles + public profiles (incl. the challenge
  collection with "Ask for it"), ~240 achievements per mode (collapsible
  categories, rates, unlock toasts), challenge mode (coins, daily reward,
  daily + weekly missions, recycle, craft, god packs, trades with live
  updates, opt-out and cards kept out of trades), PWA, EN/FR, both themes.
- What each migration does (details in each file's header comment):
  0001 schema · 0002 first RPCs (unused) · 0003 realistic packs + rarity
  buckets + set art URLs · 0004 server-side packs, profiles, history, feed,
  wishlist, prices, leaderboards · 0005 challenge mode · 0006 no pity
  timer · 0007 trades, challenge boards, badge · 0008 achievement rates ·
  0009 achievements per mode · 0010 subsets + pack stats · 0011 weekly
  missions + realtime trades · 0012 trade preferences. Every one was
  verified locally with PGlite before being handed over; 0010-0012 have
  their suites in `supabase/tests/` (`npm run test:db`, also in CI) —
  the earlier checks lived in scratch scripts and are gone.
- Tests: `npm test` 113 unit tests, `npm run test:db` 71 database
  checks, `npm run test:e2e` 123 (desktop + Pixel 7, incl. "no page
  scrolls sideways" and "no page logs an error"), `npm run build` passes,
  0 npm audit vulnerabilities.
- Not verified automatically: Realtime (feed and trades — no websocket
  mock in e2e) and anything needing two real accounts; the user checks
  those by hand.
- `.env` is not on this machine (screens are tested with mocks);
  `scripts/.env.local` is (service role + the old pokemontcg.io key).
- Legacy static files of the original prototype were deleted — recoverable
  from git history if ever needed.

## TODO

- Dashboard steps never confirmed (user): Supabase Auth > URL
  Configuration redirect URLs (`<site>/game`, `<site>/reset-password`);
  the three GitHub secrets for `sync-cards.yml` (weekly card/price sync).
- Parked (user, 2026-09-26: "on s'en fiche pour l'instant"): counter-offers,
  real subset pull rates (Classic Collection guessed at 1 pack in 3). Not
  wanted: push notifications (it's a website, not really an app). Not
  urgent: rotating the pokemontcg.io key.

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
- Migrations are checked locally with PGlite (`@electric-sql/pglite`,
  dev dependency): `supabase/tests/harness.mjs` stubs `auth.users`,
  `auth.uid()` (from `request.jwt.claim.sub`), the anon / authenticated /
  service_role roles and the realtime publication, then `freshDb('000N')`
  runs 0001..000N (the last one twice); `helpers(db).as(userId)` switches
  roles. Querying as a player applies RLS — read other players' rows with
  `asAdmin()`.
- To check what's applied on the real project: REST calls with the
  service role key from `scripts/.env.local` (a missing table answers 404,
  an existing RPC called without a user answers `not_authenticated`).
