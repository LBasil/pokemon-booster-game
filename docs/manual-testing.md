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

## App & themes

- [ ] Install the app (profile → "Install", or the browser menu / iOS
      "Add to Home Screen"): it opens full screen with the PokéBooster icon.
- [ ] Offline (airplane mode) the installed app still opens; already-seen
      card art is there.
- [ ] Every page in both themes and both languages at phone width.
