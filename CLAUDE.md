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
  stores/                   pinia: auth (session), theme (persisted), collection (cache)
  lib/supabaseClient.js     the one Supabase client instance, reads VITE_ env vars
  api/                      thin wrappers around supabase-js calls (sets, boosters, collection)
  views/                    one per route
  components/               shared UI (auth form, theme toggle, language switch, booster/card visuals)
  i18n/locales/{en,fr}.json full UI coverage — every user-facing string goes here, none hardcoded
  utils/                    pure, testable helpers (e.g. groupCardsByQuantity)
supabase/migrations/        SQL run manually in the Supabase SQL editor (no CLI/MCP access to the DB)
scripts/populate.mjs        admin-only Node script to seed sets/cards from pokemontcg.io — never bundled to the client
```

## Golden rules (do not violate these)

1. **No custom password auth.** Authentication is Supabase Auth
   (`supabase.auth.*`) exclusively. Never add a hand-rolled `users` table or
   compare passwords in application code — the original project did this in
   plaintext and it was the single worst issue found in the audit.
2. **RLS is the only access boundary.** Every table gets Row Level Security
   enabled. `collections` rows are only ever readable/writable by
   `auth.uid() = user_id`. If a query needs broader access, that's a sign it
   belongs in `scripts/populate.mjs` with the service role key, not in the
   client.
3. **No service role key in client code.** `VITE_*` env vars (client, safe to
   expose — access control is RLS, not secrecy of the anon key) are strictly
   separate from `scripts/.env.local` (service role key + pokemontcg.io key,
   gitignored, Node-only, never imported by anything under `src/`).
4. **Mutations that touch `quantity` must be atomic.** Use a Postgres RPC with
   `ON CONFLICT ... DO UPDATE` (see `add_cards_to_collection` in
   `supabase/migrations/0002_functions.sql`). The original check-then-write
   client logic was a race condition; don't reintroduce that pattern.
5. **Every user-facing string goes through vue-i18n.** Add the key to both
   `src/i18n/locales/en.json` and `fr.json` in the same change — no bare
   strings in templates.
6. **Booster "type" = a Pokémon set, and packs follow real pull rates.**
   Packs come from `open_booster(p_set_id)` (migration 0003): 10 cards built
   slot by slot (4 common, 3 uncommon, 2 reverse slots, 1 rare slot) with
   weighted rarity buckets. `p_set_id = null` ("any set") = one random real
   set per pack, never a mix. Never go back to a uniform random draw (it gave
   ~4 rares and 1-2 hits per pack). `random_cards*` from 0002 only remain as
   the client's fallback while 0003 isn't applied.
7. **I have no direct access to the Supabase database** (no MCP/CLI
   connection). Any schema change ships as a new
   `supabase/migrations/000N_*.sql` file with a comment explaining what it
   does — I hand it to the user to run in the SQL editor, I never claim to
   have run it myself.
8. **Keep `README.md` current.** Update it in the same change whenever setup
   steps, npm scripts, or the feature list change — it's the user-facing
   counterpart to this file.

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
  `BrandLogo.vue`, `ThemeToggle` (`:floating="false"` to place it inline),
  `LanguageSwitcher` (EN/FR segmented), `BoosterArt.vue` (CSS foil booster
  pack, size via `--booster-w`), `.pb-skeleton` (loading placeholder),
  `--pb-selected` (current item in navs).
- **Signed-in page shell**: wrap the view in `<div class="pb-page">` and put
  `<AppHeader />` first. AppHeader = brand (links to the hub) + nav pills
  (desktop) + language/theme/logout, and a fixed bottom tab bar on phones
  (< 768px); `.pb-page` reserves the space for that bar. Don't put a
  `transform`/animation on a wrapper around AppHeader — it would break the
  tab bar's `position: fixed`. Legibility beats effects: anything
  sitting over imagery must be near-opaque. Check both themes at phone width.
- vue-i18n treats `@` as special: write `{'@'}` in locale strings (e.g. email
  placeholders) or the message fails to compile at runtime.
- New pure logic (sampling, grouping, formatting) goes in `src/utils/` with a
  co-located `*.test.js` — these are the only tests that don't need a live
  Supabase project to run.

## Current state (updated 2026-09-22)

- Full Vue rewrite in place: auth (login/signup via Supabase Auth), game hub,
  booster opening (set selector + quantity, unlimited), collection view,
  profile view, i18n (en/fr), persisted theme toggle.
- **Supabase project is live and fully wired up.** Both migrations
  (`0001_schema.sql`, `0002_functions.sql`) are applied. `sets` (176 rows)
  and `cards` (20,670 rows) are populated via `scripts/populate.mjs`.
  `.env` and `scripts/.env.local` are filled in locally (gitignored, not
  committed).
- End-to-end flow verified directly against the live backend (via a
  throwaway admin-created test user, cleaned up after): signup ->
  sign-in -> draw booster (any-set RPC) -> draw booster (by-set RPC) ->
  atomic collection upsert (incl. duplicate increments) -> collection
  fetch -> confirmed RLS blocks one user from reading another's
  collection. Also verified in a headless browser: dark/light theme
  toggle + persistence, language switching, signup form, and the
  `requiresAuth` route guard redirect.
- Landing/login page and game hub redesigned (2026-09-24) with the "Holo
  Collector" design system. Hub = greeting, "open boosters" feature tile,
  collection progress tile (`completionPercent` in `src/utils/progress.js`),
  profile tile, and a "latest additions" row of `HoloCard`s. Booster
  opening page redesigned too (see Conventions). Collection and profile
  views still only inherit the tokens (next in line, in that order) and
  still use the old floating `ThemeToggle`.
- WCAG contrast of the token pairs was checked numerically (text >= 16:1,
  muted >= 6.6:1, primary button 12:1, holo title stops >= 4.6:1 in light).
  Re-check if you change a color token.
- The hub was verified in headless Chrome with a faked session in
  localStorage + mocked PostgREST responses (no `.env` on that machine).
  If you mock count queries, the response needs
  `Access-Control-Expose-Headers: content-range` or counts read as 0.
- `collection` store now has an `error` flag (load() no longer throws) and
  `totalDrawn` / `recentEntries` getters. `auth.displayName` = username,
  else the email's local part.
- Username ("pseudo") is stored only in Supabase Auth user metadata
  (`raw_user_meta_data.username`), set at signup: not unique, not editable
  in the UI, only readable by its owner. A public `profiles` table would be
  needed for leaderboards/trading/unique pseudos.
- `npm test` (9 tests) and `npm run build` both pass. Zero npm audit
  vulnerabilities.
- **Not yet manually tested through the actual browser UI with a real
  account** (the E2E check above used the admin API to bypass email
  confirmation, which is still ON on the Supabase project — real signups
  need to click the confirmation email). Worth a manual click-through pass
  when convenient.
- Legacy static files (`index.html`/`booster.html`/`game.html`,
  `js/*.js`, `*.css`, `en.json`/`fr.json` at the repo root) were deleted —
  fully superseded by `src/`. Recoverable from git history if ever needed.
- Deployed to Vercel for manual testing. Needed two things not obvious from
  a plain `vite build`: the `VITE_*` env vars set in the Vercel dashboard
  (Vite inlines them at build time — a redeploy is required after
  setting/changing them), and `vercel.json` (catch-all rewrite to
  `index.html`, since Vue Router's `history` mode 404s on a direct hit to
  `/boosters` etc. without it). Both are now in place.
- `scripts/populate.mjs` has retry-with-backoff built in — the pokemontcg.io
  free-tier API (especially under the old, publicly-leaked key still in git
  history, now reused) returns frequent transient 500/502s. It also accepts
  an optional resume page: `node scripts/populate.mjs cards <startPage>`.

## TODO / known gaps

- **Migration 0003 written, NOT yet applied** (as of 2026-09-24): the user
  must run `supabase/migrations/0003_realistic_boosters.sql` in the SQL
  editor, then `npm run populate:sets` to fill `logo_url` / `symbol_url`.
  Until then the app works but draws uniformly and 2026 sets have no logo.
  The SQL was verified locally with PGlite (Postgres 18 in WASM, npm
  `@electric-sql/pglite`): idempotent, 10 cards/pack, no duplicates, no
  set mixing, promo-only sets excluded, and over 3000 simulated packs per
  set (151, Evolving Skies, Perfect Order, Base) ~1 ex/holo in 5 packs,
  ~1 ultra+ in 5.5, ~1 secret in 50.
- Redesign the remaining views (collection, profile) with the design
  system + AppHeader shell. Ideas: `HoloCard` grid in the collection with
  rarity/set filters, an "edit username" field on the profile.
  `CardTile.vue` is then probably dead code.
- Node: this machine's nvm default was Node 6; the project needs Node 20+
  (`.nvmrc` = 22). `.env` must be recreated on each new machine.
- This machine's network intercepts HTTPS with its own root CA (curl is fine,
  Node fails with SELF_SIGNED_CERT_IN_CHAIN). Run Node scripts with
  `NODE_USE_SYSTEM_CA=1` (uses the macOS keychain), e.g.
  `NODE_USE_SYSTEM_CA=1 npm run populate:sets`. Never use
  `NODE_TLS_REJECT_UNAUTHORIZED=0`: populate.mjs carries the service role key.
- No manual browser click-through with a real (non-admin-created) account yet.
- No automated E2E tests (Playwright etc.) — only Vitest unit tests on pure logic.
- No password reset UX beyond Supabase's default flow; email confirmation is
  still ON for the project (not disabled per the user's preference) — real
  signups require clicking the confirmation email.
- No pagination on the collection view — fine at current data volumes (20k
  cards in the pool), revisit if it grows.
- The pokemontcg.io API key in use is the one already exposed in this repo's
  git history — works, but consider rotating to a fresh key if the repo is
  ever made public.
