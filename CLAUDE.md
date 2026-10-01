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
                            trades, minigame, sets, wishlist (per-player, reset on account switch),
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
scripts/region-tools.mjs    dev helper for the regional achievements (PokéAPI data, card names, texts)
.github/workflows/          ci.yml (unit + build + e2e) and sync-cards.yml (populate:sync at 00:07 + 12:07 Paris)
docs/manual-testing.md      checklist for a real-account click-through
docs/technique/             technical doc (French, user choice): overview, front-end, database,
                            API reference (params/responses/errors), flows with diagrams, tooling
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
   **Also keep `docs/technique/` current** (French; code names stay
   English), in the same change: new table/column/RPC -> 03 base de
   données + 04 référence API; new route/store/composable -> 02 front-end;
   changed game behavior (packs, economy, profile, achievements, trades,
   mini-games) -> the matching section of 05 parcours; new tooling or
   deploy step -> 06 outillage; bump "Dernière mise à jour" in its README.
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
  count (1/3/5/10) is remembered too (`pb-last-count:<mode>`). The
  selected set and every started set in the picker show their completion
  in that mode (`setCompletion()`, floored, "Complete" badge at 100%),
  from the reactive `owned` map that also drives "New!".
- **Rarity**: 6 buckets (common, uncommon, rare, holo, ultra, secret)
  computed in SQL by `rarity_bucket()` (generated column
  `cards.rarity_bucket`) and mirrored in JS by `rarityBucket()` in
  `src/utils/rarity.js` — change both together. `rarityTier()` groups them
  into 3 visual tiers for halos. The pull feed takes ultra/secret, or
  the holos of a pack whose set has neither (Base, Neo, DP...:
  `feed_buckets()`, 0016); `booster_openings.hits` stays ultra/secret
  (holos come 1 pack in 3: the hit-rate board would be farmable).
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
  in `App.vue`) = a spark burst on click/tap. Page changes fade
  `.pb-page > main` in (opacity only). Both off under
  `prefers-reduced-motion` (so also in e2e, which forces it) or with
  Profile > Settings > Visual effects (`settings.effects` ->
  `html.pb-fx-off`).
- **Don't look AI-generated** (user, 2026-09-28: "est-ce que mon site fait
  IA ?"): removed the aurora + dot-grid backdrop, the cursor glow/ring,
  the route sweep, pill eyebrows above titles, gradient page titles, the
  landing's 3-stat strip and every em dash (—) in the locales. Don't
  bring them back: plain background, `.pb-eyebrow` only for real context
  (pack 2/5, set name), plain-spoken copy with commas/periods/parentheses
  instead of em dashes, holo gradients kept for cards and records.
- **Responsive**: a single-column grid must say `grid-template-columns:
  minmax(0, 1fr)` (and its items `min-width: 0`), or a nowrap/scrolling
  child (tabs, chips) widens the page — it made /community 628px wide on
  phones. `e2e/navigation.spec.js` > "no page scrolls sideways" checks every
  page at phone width; add new pages there. Check 320px too (narrowest
  supported): tab counts, the challenge wallet art and the mode strip
  icon hide below 375px.
- **Leaderboards** (Community): a Challenge | Unlimited switch
  (user, 2026-09-28: "ce serait plus propre"), then that mode's boards
  (`LEADERBOARDS[mode]` in `src/api/social.js`). Opens on `routeMode`,
  each mode remembers its last board.
- **Community on desktop** (>= 992px, two columns): the feed panel takes
  the leaderboard's height (`contain: size`) and scrolls inside; board
  rows share columns through `subgrid`; with a mouse (`hover: hover` +
  `pointer: fine`) the board tabs wrap — a hidden scroll row left the last
  tab unreachable on PC.
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
  works signed out, `props: true`). Its numbers (level, stats, rarity,
  best cards, achievements) follow one Challenge | Unlimited switch at the
  top of the main column, fed by `useModeAchievements` (`entries`,
  `server`; boosters = `packSummary`). Own: the mode you came from;
  someone else's: challenge first, unlimited if their challenge
  collection is empty. It used to read the unlimited collection only, so
  challenge players showed "1 booster, 0 €". Showcase stays unlimited.
  **Beta tester badge** (`BetaBadge.vue`, profile + hub tile): every
  account created before `BETA_END` (`src/utils/beta.js`, from
  `profiles.created_at`, no DB column). `null` while the beta runs; set
  the date when it ends and later accounts won't get it.
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
  **Trade news** (0017, user 2026-09-30: notify offers and answers):
  `trade_offers.answer_seen` (sender saw the end: accepted / declined /
  failed), `challenge_badge().answers`, `my_trades().unseen`,
  `mark_trade_answers_seen()` (called by `trades.markSeen()` when
  TradesView shows them in "New answers", kept on screen for the visit).
  `challenge.tradeNews` = offers + answers -> Trades links; phones have
  no Trades tab, so the `.mode-strip` has an icon shortcut (label only
  >= 576px: the strip overflowed at 412px). Live news (`tradeNews(row,
  userId)`) pops a toast in `AchievementToasts`' stack (`trades.toasts`).
  `?give=<id>` preselects my card; CardDetail has "Offer in a trade".
  **Recycling a pick** (0017 `recycle_cards(ids)`, fallback: one
  `recycle_duplicates` per card): RecycleDuplicates "Choose…" (checkbox
  per card, rarity chips, `duplicateGroups`).
  Public profiles list the collection of the mode picked in their
  Challenge | Unlimited switch (user, 2026-09-28: "faudrait pouvoir voir
  les deux"); the challenge one has "Ask for it" ->
  `/challenge/trades?to=<name>&want=<card id>`, the unlimited one is
  look-only. Every pull in the feed (community + hub "Live" row) says
  its mode (Unlimited | Challenge).
  **Mini-games** (user: "I'll add plenty"): `/challenge/games`
  (`GamesView`) lists every game of `src/utils/games.js` (id, route
  `challenge-game-<id>`, icon; EN/FR `games.items.<id>` — `games.test.js`
  checks them); `useGames()` gives each game's status (plug a new game's
  store there) to that page and to the `.ch-games` tile right under the
  wallet on `/challenge`. In the challenge, AppHeader has a "Mini-games"
  pill and phone tab (it replaced Home there: the mode strip's "Leave"
  goes home), and game pages light it up (`PARENTS`) and link back to it.
  **"Higher or lower"** (0013, `/challenge/games/higher-lower`; the old
  `/challenge/minigame` redirects, `MinigameView` + `useMinigameStore`):
  two cards, tap the pricier
  (`cards.value`) within 15 s (server allows 20). Rules in SQL
  (`minigame_rules()`, `minigame_min_ratio()`) mirrored in
  `src/utils/minigame.js`: 3 paid runs per game day, 5 coins per right
  answer for the first 20 of a run, then unlimited unpaid runs (best
  streak); price ratio x3 -> x2 -> x1.5 -> x1.25 as the streak grows.
  `minigame_runs` has no client access; `minigame_state/start/answer`
  lock the wallet, the question never carries prices, a late or null
  answer ends the run, the run in progress resumes after a reload.
  Ledger kind `minigame` (one row per paid answer, so `coins_earned`
  counts it). Accepted limit: prices are public, a script could look
  them up — the daily cap bounds it. The store sets `unavailable` on a
  missing RPC (PGRST202): the game shows "Coming soon". In the view, the card
  list is `v-for` over the constant `SIDES` keyed by side only — a key
  changing per pair made Vue patch detached nodes (prices vanished).
  **"Shiny Electrode Flip"** (0014, `/challenge/games/electrode-flip`,
  `ElectrodeFlipView` + `useElectrodeFlipStore`): Voltorb Flip with
  shiny Electrodes (CSS-drawn, `--pb-electrode-*` tokens). 5x5 board of
  1/2/3/Electrode, row + column hints (points, Electrodes); points =
  product of the flipped tiles; every 2 and 3 flipped = won, level + 1
  (5 levels, Voltorb Flip layouts in `electrode_flip_layout()`); an
  Electrode = lost (0 points); cash out keeps the points; after a loss or
  cash out the level drops to the tiles flipped if lower. Points = coins,
  300 per game day max (`electrode_flip_today()`), then boards play for
  the record. Mirror: `src/utils/electrodeFlip.js`. The board lives in
  `electrode_flip_boards` (no client access); the client only gets the
  hints and the flipped tiles (`electrode_flip_view()`), the whole board
  once it's over. `electrode_flip_start()` resumes the board in progress
  instead of dealing a new one (no escaping a bad board by reloading).
  Memo marks (and right click = Electrode mark) are client-only. Ledger
  kind `electrode_flip`, one row per paid board. Each game's hub line and
  record come from `statusOf` in `useGames()`.
  **"Super effective!"** (0015, `/challenge/games/super-effective`,
  `SuperEffectiveView` + `useSuperEffectiveStore`): a Pokémon card's top
  half (the weakness is printed at the bottom), tap the type it's weak to
  within 10 s (server allows 15); 3 types (streak 0-4), 4 (5-9), then 6;
  same pay as "Higher or lower" (3 paid runs, 5 coins x first 20). The
  answer is the card's **printed weakness**, `cards.weaknesses` (text[],
  new in 0015, filled by `populate.mjs`, which skips the column if 0015
  isn't applied), not a type chart. `super_effective_state().ready` =
  some card has weaknesses; false -> the store sets `unavailable`
  ("Coming soon"). Mirror: `src/utils/superEffective.js`. Type dots:
  `--pb-type-*` tokens (one set for both themes, never behind text).
  Ledger kind `super_effective`. Keys 1-6 answer on desktop.
  **"Evolution chain"** (0018 + 0019, `/challenge/games/evolution-chain`,
  `EvolutionChainView` + `useEvolutionChainStore`): the 2 or 3 cards of
  one line shuffled, tap them Basic -> Stage 1 (-> Stage 2) within 15 s
  (server allows 20); the last tap (`run.length`, `chainLength()`) sends
  `evolution_chain_answer(order)`, tapping a
  picked card takes it back (`togglePick`), keys 1-5 + Backspace. Lines
  come from `cards.evolves_from` (new in 0018, filled by `populate.mjs`,
  which skips the column if 0018 isn't applied: `OPTIONAL_COLUMNS`): a
  random Stage 2 -> a printing of the Stage 1 it names -> of the Basic
  that one names; since 0019 (user, 2026-09-30: "ça restreint beaucoup de
  se limiter à 3") ~2 lines in 5 are two-stage: a Stage 1 nothing evolves
  from + its Basic (Pikachu -> Raichu), never a 3-stage line cut short
  (`evolution_chain_line(stages)`). "Stop" (0019 `evolution_chain_stop()`,
  status `stopped`, user asked for it) ends the run, coins kept; without
  the RPC the store ends it on screen only. Intruders from other lines (never same name, dex number
  or evolving from a stage; same type first): 0 (streak 0-4), 1 (5-9),
  then 2. Cards reach the client as id + name + image only; the view crops
  the art window (x 10-90%, y 17-50%) so the printed stage / "Evolves
  from" don't show. **Pays the least** (user, 2026-09-30: it's the simple
  one): 3 paid runs, 3 coins x first 20 = 180 a day max vs 300 for the
  others. `ready` false -> "Coming soon". Mirror:
  `src/utils/evolutionChain.js`. Ledger kind `evolution_chain`.
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
- **Achievements** (`src/utils/achievements.js`): ~890 definitions in 20
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
  drops empty categories. Big categories have subcategories (`sub`,
  `achievements.subs.<sub>`, one heading each, kept contiguous) and
  definitions carry region `tags` (the "Region" filter, `?region=`).
  **Kanto focus** (user, 2026-09-30): `src/utils/kanto.js` = every Red/Blue
  line (+ `kantoLines` tiers), loners, babies, later evolutions, regional
  forms (by card name), routes and caves (walk/surf/Super Rod/one-offs of
  Red/Blue from PokéAPI; identical routes share one: "Routes 4 and 9"),
  Mt. Silver (Gold/Silver), cities with a card (Pallet Town has none) and
  trainers' cards (name patterns on `s.names`).
  **Other regions** (user, 2026-10-01: Johto, Hoenn, Sinnoh, Unova; the rest
  when asked): one file per region (`src/utils/johto.js`, `hoenn.js`,
  `sinnoh.js`, `unova.js`), a
  default-exported object of one shape (fields documented at the top of
  hoenn.js: lines, extras, forms, gyms, eliteFour, people, trainerCards,
  routes, landmarks, cities?, placeCards, sets), listed in `REGION_FOCUS`
  in achievements.js, whose loops add every region's achievements right
  after Kanto's in each category, under `<region>Lines/More/Gyms/
  TrainerCards/Routes/Landmarks/Cities` subcategories. Adding a region =
  its file + `REGION_FOCUS` + a partition test + texts. The region's
  lines/places that used to be in `FAMILIES` / `PLACES` move there with
  their ids (`PLACES` is gone; `nationalPark` kept its Bug-Catching
  Contest list, the Hoenn ones got their real wild Pokémon).
  `scripts/region-tools.mjs` (dev, PokéAPI cache in `scripts/.cache/`,
  gitignored): `lines <from> <to>` (evolution chains), `encounters
  <region id> <versions>` (wild Pokémon of the first games: walk, surf,
  Super Rod, one-offs, no Old/Good Rod / Headbutt / Rock Smash; same
  lists grouped), `cards <regex>` (DB card names, decides trainers' and
  places' cards: many leaders have none), `texts <region>` (writes the
  missing EN/FR line/route/place texts with PokéAPI's official names;
  gyms, trainers, sets by hand; rename branched lines after their first
  member). Official names: PokéAPI or Poképédia (WebFetch; Bulbapedia
  answers 403), never from memory (user, 2026-10-01): teams, FR trainer,
  badge and set names were all checked there; when a name can't be
  found, the FR text doesn't name it (Sinnoh's FR set texts). Unova's
  routes 1-18 would clash with Kanto's ids: they are `unovaRoute<n>`
  (titled "Unova Route n"; `texts` reads that prefix too). Each region's partition test checks every dex number of its
  range lands in exactly one group (lines, solos, legends, or an earlier
  region's babies/evolutions). No duplicates: the test
  fails when two groups ask for the same Pokémon (4 whitelisted pairs,
  incl. `lakeOfRage` = the Magikarp line; places equal to a line or a
  legend group, like Southern Island, are left out instead);
  removed as duplicates on 2026-09-30: `cards*` (= boosters x 10),
  `setsOpened*`, `days100`, `secretPulls1`, `hitPacks1`. `teams` became
  `starters` (lines -> families, legend groups -> legends); gyms, league
  and rivals are subcategories of `people`. "Own them all" groups
  (families, legends, gyms = one badge per leader, league =
  Elite Four + champions, rivals, places) are dex lists in
  `src/utils/pokemonGroups.js`, `kanto.js` and the region files; their
  EN/FR descriptions name the members (`desc.groups.<id>`, official FR
  names): change a list, change both texts. No Gen 9 trainers yet (unsure
  of the FR names). Add a
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
  shows the player's own (profile, achievements page, challenge hub), and
  right after any challenge action that can unlock one (daily reward,
  missions, recycle, craft, trades incl. one accepted live) — otherwise
  they surfaced at a random later reload. Ids the server already recorded
  (`player_achievements().unlocked`) count as seen: another device toasted
  them. `achievements.paused` (set by BoosterView while `phase === 'open'`)
  drops checks mid-reveal; the summary's check catches up. Max 3 toasts, rarest
  first, the last one "+N more". **Rates** ("12% of players", migrations
  0008 + 0009, per mode): the client reports unlocked ids
  (`record_achievements(ids, mode)`, retried until the server confirms)
  and reads `achievement_rates(mode)`; `src/api/achievements.js` falls
  back to the 0008 signatures and hides what a missing migration can't
  give. Deliberate, documented exception to rule 9:
  the ids are client-claimed (the server can't recheck ~890 JS
  definitions), acceptable because it only nudges an anonymous
  percentage that nothing ranks or rewards on.
- **Sounds/haptics**: `src/lib/sfx.js` synthesizes everything with Web Audio
  (no audio assets); every call takes `settings.sound` / `settings.vibration`
  from `useSettingsStore()`.
- **PWA**: `public/sw.js` — bump `VERSION` when changing it. It never caches
  Supabase; it caches only `no-cors` image loads (a cached opaque image
  served to the CORS load of `shareCard` would taint its canvas).
  Registered in production builds only (`src/lib/pwa.js`).
- **Deploys vs open tabs**: routes are lazy chunks; a tab opened before a
  deploy asks for hashes that no longer exist and the router silently
  aborts (nav links "stop working", new features missing). `router.onError`
  reloads onto the target once (`isChunkLoadError`, 10s loop guard) and
  `vercel.json` no longer rewrites `/assets/*` to `index.html` (a missing
  chunk is a 404, not HTML). E2e: navigation.spec.js > "after a deploy"
  (needs `serviceWorkers: 'block'` for `page.route` to see the chunk).
  Before that happens: `src/lib/appVersion.js` refetches `/` when the app
  returns to the foreground (5 min throttle, + every 30 min), compares the
  entry script (`/assets/index-<hash>.js`) and, once it changed, the router
  makes the next real page change (path, not query) a full load; fires
  `pb:update-ready` (the e2e waits on it). Prod builds only.
- **Charts**: load the `dataviz` skill first. Rarity buckets are ordinal, so
  charts use one violet ramp (`--pb-bucket-*`, validated with the skill's
  `validate_palette.js --ordinal` in both themes); single series use
  `--pb-series`, gridlines `--pb-grid`. See `PriceChart.vue`.

## Current state (updated 2026-09-27)

- **Live**: deployed on Vercel (`VITE_*` env vars set there; `vercel.json`
  has the SPA rewrite and serves `sw.js` uncached), used by the user on a
  real account ("tout fonctionne", 2026-09-26). **Migrations 0001-0013 are
  all applied** (checked 2026-09-27 through the REST API with the service
  role key). `cards` has 20,670 rows, `sets` 176 (9 subsets linked to
  their parent).
- Features: landing (auth, forgot password), hub, boosters (per-set packs,
  real pull rates, subsets inside their parent's packs, tear/flip/swipe,
  lite animations on touch screens, sounds, vibration, open all, share,
  last set + count remembered), collection (Cards / Sets / Pokédex /
  Wishlist, URL filters, card detail with price chart), set binders,
  history (exact totals, "With a hit" filter), community (live feed +
  leaderboards), profiles + public profiles (incl. the challenge
  collection with "Ask for it"), ~890 achievements per mode (collapsible, region filter, Kanto to Unova focus,
  categories, rates, unlock toasts), challenge mode (coins, daily reward,
  daily + weekly missions, recycle, craft, god packs, mini-games "Higher
  or lower", "Shiny Electrode Flip" (needs 0014), "Super effective!"
  (needs 0015 + a card import) and "Evolution chain" (needs 0018 + a
  card import), trades with live
  updates, opt-out and cards kept out of trades), PWA, EN/FR, both themes.
- What each migration does (details in each file's header comment):
  0001 schema · 0002 first RPCs (unused) · 0003 realistic packs + rarity
  buckets + set art URLs · 0004 server-side packs, profiles, history, feed,
  wishlist, prices, leaderboards · 0005 challenge mode · 0006 no pity
  timer · 0007 trades, challenge boards, badge · 0008 achievement rates ·
  0009 achievements per mode · 0010 subsets + pack stats · 0011 weekly
  missions + realtime trades · 0012 trade preferences · 0013 "Higher or
  lower" mini-game · 0014 "Shiny Electrode Flip" mini-game (**written
  2026-09-27, not applied yet**: hand it to the user) · 0015
  `cards.weaknesses` + "Super effective!" mini-game (**written
  2026-09-28, not applied yet**; after it, re-run the card import to
  fill the weaknesses) · 0016 feed holos for sets with no ultra/secret
  (**written 2026-09-29, not applied yet**) · 0017 trade answers seen +
  `recycle_cards` (**written 2026-09-30, not applied yet**) · 0018
  `cards.evolves_from` + "Evolution chain" mini-game (applied + synced
  2026-09-30, user: "ÇA MARCHE") · 0019 two-stage lines + Stop for
  "Evolution chain" (**written 2026-09-30, not applied yet**). Every one was
  verified locally with PGlite before being handed over; 0010-0019 have
  their suites in `supabase/tests/` (`npm run test:db`, also in CI) —
  the earlier checks lived in scratch scripts and are gone.
- Tests: `npm test` 184 unit tests, `npm run test:db` 291 database
  checks, `npm run test:e2e` 234 (desktop + Pixel 7, incl. "no page
  scrolls sideways" and "no page logs an error"), `npm run build` passes,
  0 npm audit vulnerabilities. Community's two tablists are named
  ("Game mode", "Leaderboards"): e2e picks tabs through them.
  `playwright.config.js` builds with `NODE_ENV=production`: this
  machine's `~/.zshrc` exports `NODE_ENV=development`, and Vite 8 then
  builds with `import.meta.env.PROD` false (no PWA, no version check, so
  "a new version deployed" failed locally only). A plain `npm run build`
  here has the same problem: use `NODE_ENV=production npm run build` to
  check a real production bundle.
- Not verified automatically: Realtime (feed and trades — no websocket
  mock in e2e) and anything needing two real accounts; the user checks
  those by hand.
- `.env` is not on this machine (screens are tested with mocks);
  `scripts/.env.local` is (service role + the old pokemontcg.io key).
- Legacy static files of the original prototype were deleted — recoverable
  from git history if ever needed.

## TODO

- `sync-cards.yml` runs twice a day since 2026-09-28 (user: midnight and
  noon): 4 UTC crons (summer + winter slot for each) and a "Paris time"
  step that lets through the one matching today's offset. The import
  takes ~4 min, but GitHub starts scheduled runs late (the Monday 04:00
  UTC run started at 13:55). Check runs on the Actions tab (public repo:
  `api.github.com/repos/LBasil/pokemon-booster-game/actions/workflows/
  sync-cards.yml/runs`, no auth).
  Confirmed 2026-09-27: the GitHub secrets work (manual run succeeded) and
  Supabase Auth allows `<site>/game` + `<site>/reset-password` (site =
  https://pokemon-booster-game.vercel.app). Check without sending an
  email: `GET /auth/v1/verify?type=recovery&token=fake&redirect_to=<url>`
  redirects to `<url>` if allowed, else to the site URL.
- **Next mini-game** (user picked it 2026-09-28; "Evolution chain"
  shipped 2026-09-30). Already teased on the games page and hub tile as a
  `soon: true` entry of `src/utils/games.js` (id `boss-raid`, EN/FR
  texts, "Coming soon", not clickable, user liked the teasing): to ship
  it, drop `soon`, add its route + store in `useGames()`.
  **Weekly boss raid**: a giant Pokémon with a shared HP bar, players
  attack with their challenge cards, everyone rewarded if it falls
  before Sunday. Rules to settle with the user first: attacks per day,
  card locked after attacking (day or week?), damage from value / HP /
  type vs the boss (could reuse `cards.weaknesses`), reward split
  (flat vs by contribution, a card for the top attacker), HP scaled to
  active players. Live HP bar through Realtime (not e2e-testable).
- **Regional achievements for every region** (user, 2026-09-30: noted,
  **don't start until asked**): repeat the Kanto focus (`src/utils/kanto.js`)
  (Johto, Hoenn, Sinnoh, Unova done 2026-10-01 on request, see "Other regions") for Kalos, Alola, Galar, Paldea: one
  achievement per evolution line + all of them, the Pokémon that don't
  evolve, routes and places with their wild Pokémon (PokéAPI, the region's
  first games), cities that have a card, trainers' cards (gym leaders,
  Elite Four, rivals, villain teams), all tagged with the region.
- Parked (user, 2026-09-26: "on s'en fiche pour l'instant"): counter-offers,
  real subset pull rates (Classic Collection guessed at 1 pack in 3). Not
  wanted: push notifications (it's a website, not really an app). Not
  urgent: rotating the pokemontcg.io key.

## Known gaps

- The hit-rate leaderboard only counts packs opened after 0004 (older
  packs were never logged).
- Card prices (`cards.value`, €): pokemontcg.io dropped Cardmarket for
  recent sets (Prismatic Evolutions, Mega Evolution...), so
  `cardPriceEur()` (`src/utils/cardPrice.js`, used by populate) falls
  back to TCGplayer USD x `USD_TO_EUR` (0.86). Without it whole
  collections showed "0 €" (fixed 2026-09-27). The newest sets (me2pt5,
  me3-me5, me55: ~980 cards) have no price at all yet: 0 until the
  sync finds one.
- Price charts need at least two `populate:cards` runs on different days
  (one snapshot per day: the noon run updates midnight's).
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
