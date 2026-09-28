// The challenge mini-games, in the order the games page lists them. Adding a
// game = an entry here (route name + icon), its EN/FR `games.items.<id>`
// title/description, and its status in useGames() (`statusOf`).
// `soon: true` = a teaser: listed as "Coming soon", no route or store yet
// (drop the flag and add the route once the game exists).
export const GAMES = [
  {
    id: 'higher-lower',
    route: 'challenge-game-higher-lower',
    // Two cards, one arrow up
    icon: 'M3 6h7v12H3zM14 6h7v12h-7zM17.5 15V9M15.5 11l2-2 2 2',
  },
  {
    id: 'electrode-flip',
    route: 'challenge-game-electrode-flip',
    // An Electrode: a ball split in two, angry eyes
    icon: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M7.5 8.5l3 1.5M16.5 8.5l-3 1.5',
  },
  {
    id: 'super-effective',
    route: 'challenge-game-super-effective',
    // A lightning bolt
    icon: 'M13 2 4 14h7l-1 8 9-12h-7z',
  },
  {
    id: 'evolution-chain',
    soon: true,
    // Three growing stages, linked
    icon: 'M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15.5 5.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6.5 16.5l3.3-2.8M14.2 10.2l2.2-2.2',
  },
  {
    id: 'boss-raid',
    soon: true,
    // A sword
    icon: 'M20 4 9 15M20 4h-5M20 4v5M7 13l4 4M8 16l-4 4',
  },
]

/** Route names of the game pages (they light up the games tab). */
export const GAME_ROUTES = GAMES.filter((game) => !game.soon).map((game) => game.route)
