// Route names per game mode: views shared by both modes (boosters,
// collection, binder) link within the mode they're showing.
export const MODE_ROUTES = {
  unlimited: { hub: 'game', boosters: 'boosters', collection: 'collection', binder: 'binder', history: 'history' },
  challenge: {
    hub: 'challenge',
    boosters: 'challenge-boosters',
    collection: 'challenge-collection',
    binder: 'challenge-binder',
    history: 'challenge-history',
  },
}

export const modeRoutes = (mode) => MODE_ROUTES[mode] ?? MODE_ROUTES.unlimited
