// The challenge mini-games, in the order the games page lists them. Adding a
// game = an entry here (route name + icon), its EN/FR `games.items.<id>`
// title/description, and its status in GamesView (`statusOf`).
export const GAMES = [
  {
    id: 'higher-lower',
    route: 'challenge-game-higher-lower',
    // Two cards, one arrow up
    icon: 'M3 6h7v12H3zM14 6h7v12h-7zM17.5 15V9M15.5 11l2-2 2 2',
  },
]

/** Route names of the game pages (they light up the games tab). */
export const GAME_ROUTES = GAMES.map((game) => game.route)
