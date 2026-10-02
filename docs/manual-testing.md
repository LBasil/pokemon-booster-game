# Manual test checklist

The automated tests mock Supabase entirely. This checklist covers what only
a real project, a real inbox and a real phone can prove. Run it after
applying a migration or before sharing the app. Use a **fresh email
address** for the sign-up part.

## Accounts

- [ ] Sign up with a new email and a username → "check your email" message.
- [ ] The confirmation email arrives; its link opens the app on the hub
      (`/game`), already signed in.
- [ ] The username chosen at sign-up shows in the hub greeting and profile.
- [ ] Log out, log back in with the same credentials.
- [ ] "Forgot password?" → the email arrives → its link opens
      `/reset-password` → a new password can be saved → log in with it.
- [ ] Log in with a second account in the same tab: none of the first
      account's cards, wishlist or profile shows up.

## Boosters (on a phone)

- [ ] Pick a set (bottom sheet), 1 booster: the pack shows the set logo and
      chase card; tapping it tears smoothly (strip peels, card rises).
- [ ] Cards flip one by one on tap; swiping the face-up card throws it in
      the swipe direction.
- [ ] A hit (ultra/secret) charges up, flashes, plays its fanfare and
      vibrates (Android); its name only appears once it's face-up.
- [ ] Sound can be muted from the booster screen and from the profile.
- [ ] 3 boosters → "Open all at once" → summary with 30 cards.
- [ ] "Share" on the best pull opens the phone's share sheet with an image.
- [ ] Leaving mid-reveal and coming back: the cards are in the collection.

## Collection

- [ ] Filters and tabs survive a reload and the back button.
- [ ] Sets tab → a set → binder: owned cards in color, missing ones greyed.
- [ ] Tap a missing card → "Add to wishlist" → it's in the Wishlist tab;
      pulling it later shows "Wanted!" and removes it from the list.
- [ ] Pokédex tab: caught species show sprites; tapping one filters the
      cards to that Pokémon.
- [ ] Card detail shows a price chart once `populate:cards` has run on at
      least two different days.
- [ ] Booster history lists the packs just opened.

## Social

- [ ] Profile: rename to a name another account already uses → "already
      taken"; rename to a free one → saved everywhere.
- [ ] Pick a showcase card; open `/u/<username>` in a private window
      (signed out) → profile, showcase and best cards are visible.
- [ ] Turn the profile private → the private window now says the trainer
      isn't found, and the account disappears from the leaderboards.
- [ ] With two accounts in two browsers, pulling a hit in one makes it
      appear live in the other's Community feed (Realtime).
- [ ] Leaderboards: "Luckiest" needs 20 boosters opened after migration
      0004 before an account shows up.

## Challenge mode (after migration 0005)

- [ ] Hub → "Take on the challenge": 1,000 coins, empty challenge
      collection; the unlimited collection is unchanged.
- [ ] Claim the daily reward (+200) → the button turns into a countdown;
      reloading doesn't let you claim it again.
- [ ] Open 3 challenge boosters → 300 coins spent, the cards are in the
      challenge collection only, "Open 3 boosters" mission claimable (+75).
- [ ] With less than 100 coins the open button is disabled and "Earn coins"
      leads back to the challenge.
- [ ] Recycle duplicates (challenge hub or collection) → one copy of each
      card is kept and the coins match the preview.
- [ ] After 0020: "Choose…", − / + on a card with 2+ extra copies → only
      that many are recycled (the rest stay), coins match the total.
      Same − / + on a card's detail. "Keep: 2 copies of each" → recycling
      leaves 2 of every card.
- [ ] In a challenge binder, a missing card shows its price and can be
      crafted when you have enough coins.
- [ ] A challenge hit shows up in the Community feed with the "Challenge"
      mark.
- [ ] Challenge packs keep the real rates: no "guaranteed hit" anywhere.
- [ ] Challenge → "Booster history" lists challenge packs only.
- [ ] Community → "Challenge: cards" / "Challenge: value" boards list
      public players with a challenge collection.

## Mini-game (after migration 0013)

- [ ] In the challenge, the "Mini-games" tab (tab bar on a phone) and the
      tile under the wallet lead to the games page; "Higher or lower" says
      "3 paid runs left today" → Play: two real cards with pictures, no
      price shown.
- [ ] Tap one → both prices show (green = pricier), "+5" and the header's
      coins go up on a right answer; a new pair comes by itself.
- [ ] A wrong answer (or letting the timer run out) ends the run with the
      coins won; "Play again" says how many paid runs are left.
- [ ] After 3 paid runs: "For the record" runs, no coins.
- [ ] Leave mid-question and come back within a few seconds → the same
      pair is still there (no escape from a hard pair by reloading).
- [ ] On a phone: question, both cards, prices and "Right!" fit above the
      tab bar.

## Shiny Electrode Flip (after migration 0014)

- [ ] The games page lists "Shiny Electrode Flip" with "300 coins left to
      win today · level 1" → Deal a level 1 board: 25 hidden tiles, a
      points + Electrode hint at the end of each row and column.
- [ ] Flip tiles: points multiply; "Cash out N points" keeps them (+N in
      the header's coins).
- [ ] Flip every 2 and 3 → "Board cleared!", coins, "Next board: level 2";
      the whole board shows, unflipped tiles dimmed.
- [ ] An Electrode → "Boom!", no coins, level drops to the tiles flipped.
- [ ] Reload mid-board → the same board comes back (no fresh deal).
- [ ] Memo marks (and right click) don't flip anything.
- [ ] On a 320px phone: the whole board and its hints fit, both themes.

## Super effective! (after migration 0015 + a card import)

- [ ] Right after 0015, before the import: the games page says "Coming
      soon" for "Super effective!" (no card has its weaknesses yet).
- [ ] After `npm run populate:cards` (or the "Sync cards" Action): "3 paid
      runs left today" → Play: the top half of a real card (name, HP,
      type, art; the printed weakness is cut off) and 3 types.
- [ ] Tap the right type → "It's super effective!", +5, next card; a
      wrong one → "Weak to: …" and the run ends. Check a couple of answers
      against the full card in the collection.
- [ ] From 5 right answers: 4 types, from 10: 6 types.
- [ ] Keys 1 to 3 (desktop) answer; 10 s without answering → "Too slow!".
- [ ] On a 320px phone: card, question, types and feedback fit above the
      tab bar, both themes.

## Evolution chain (after migration 0018 + a card import)

- [ ] Right after 0018, before the import: the games page says "Coming
      soon" for "Evolution chain" (no card has its `evolves_from` yet).
- [ ] After the sync (or `npm run populate:cards`): "3 paid runs left
      today" → Play: 3 cards of one line, art only (no name bar, no
      "Stage 1/2", no "Evolves from" visible on real cards, full arts
      included), names under them.
- [ ] Tap them Basic → Stage 1 → Stage 2: numbers 1, 2, 3 appear, the
      slots below fill; tapping a picked card takes it back. Right order →
      "Perfect evolution!", +3, next line; wrong → "The line: …" and the
      run ends.
- [ ] From 5 right lines: 4 cards (1 intruder, marked "Intruder" at the
      end), from 10: 5 cards. An intruder is never from the same line.
- [ ] After 0019: about 2 lines in 5 have only 2 stages (Pikachu →
      Raichu, Magikarp → Gyarados, Eevee → an Eeveelution): 2 boxes, the
      2nd tap sends; never a 3-stage line cut short (Charmander →
      Charmeleon alone).
- [ ] "Stop" mid-run → "Run stopped", the coins earned stay, the games
      page no longer says "Resume the run".
- [ ] Keys 1 to 5 and Backspace (desktop); 15 s without answering → "Too
      slow!".
- [ ] On a 320px phone: cards, slots and feedback fit, both themes.

## Trades (after migration 0007, two accounts A and B)

- [ ] On B's public profile, A taps "Propose a trade" → the trades page
      opens with B loaded; pick 1 card of each side and send.
- [ ] B sees a badge on Challenge (tab bar on a phone), then the offer
      under "Offers for you"; Accept → both challenge collections have
      swapped the cards, the offer shows "Done" for both.
- [ ] A sends another offer and cancels it; B no longer sees it.
- [ ] A offers a card, then recycles/trades it away before B answers →
      B's Accept ends as "Failed" and nothing moves.
- [ ] Offering to a private profile or an unknown name → friendly error.
- [ ] After 0021: B taps "Counter" on A's offer → the composer has it with
      sides swapped; B changes a card and sends → A gets it under "Offers
      for you" tagged "Counter-offer" (live toast), A's first offer shows
      "Countered" in B's and A's past trades.

## App & themes

- [ ] Install the app (profile → "Install", or the browser menu / iOS
      "Add to Home Screen"): it opens full screen with the PokéBooster icon.
- [ ] Offline (airplane mode) the installed app still opens; already-seen
      card art is there.
- [ ] Every page in both themes and both languages at phone width.

## Watching a migration run

The Supabase SQL editor only says "running". Migrations 0004+ name each step
in `application_name` and give up after 15s waiting for a lock. While one
runs, paste this in a **second** SQL editor tab (re-run it to refresh):

```sql
select m.application_name as step,
       now() - m.xact_start as running_for,
       m.wait_event_type,            -- null/CPU = working, 'Lock' = waiting
       b.pid as blocker_pid,
       b.application_name as blocker_app,
       b.state as blocker_state,
       now() - b.xact_start as blocker_open_for,
       left(b.query, 120) as blocker_query
from pg_stat_activity m
left join lateral unnest(pg_blocking_pids(m.pid)) as bp(pid) on true
left join pg_stat_activity b on b.pid = bp.pid
where m.application_name like 'migration%';
```

- The step changes → it's progressing. No row → it's finished (or was
  cancelled): check the first tab for the result.
- `wait_event_type = 'Lock'` → the `blocker_*` columns say who holds the
  table. A leftover run of a cancelled migration shows up there too; stop
  it with `select pg_cancel_backend(<blocker_pid>);`.
- A migration is one transaction: if it fails or is cancelled, nothing is
  applied, and it's safe to run again. Errors also land in the dashboard
  under **Logs > Postgres**.
