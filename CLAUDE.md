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
6. **Booster "type" = a Pokémon set.** `random_cards_by_set(num_cards,
   p_set_id)` draws from one set; `random_cards(num_cards)` (no set id) draws
   from everything — that's the "any type" option, not a separate code path.
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
- Keep the animations from the original prototype (booster tear-open, card
  reveal) — they're one of the few things that already worked well. They live
  as scoped styles on `BoosterPack.vue` / `CardStack.vue`.
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
- `npm test` (5 tests) and `npm run build` both pass. Zero npm audit
  vulnerabilities.
- **Not yet manually tested through the actual browser UI with a real
  account** (the E2E check above used the admin API to bypass email
  confirmation, which is still ON on the Supabase project — real signups
  need to click the confirmation email). Worth a manual click-through pass
  when convenient.
- Legacy static files (`index.html`/`booster.html`/`game.html`,
  `js/*.js`, `*.css`, `en.json`/`fr.json` at the repo root) were deleted —
  fully superseded by `src/`. Recoverable from git history if ever needed.
- `scripts/populate.mjs` has retry-with-backoff built in — the pokemontcg.io
  free-tier API (especially under the old, publicly-leaked key still in git
  history, now reused) returns frequent transient 500/502s. It also accepts
  an optional resume page: `node scripts/populate.mjs cards <startPage>`.

## TODO / known gaps

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
