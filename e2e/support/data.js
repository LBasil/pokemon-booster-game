// Small, deterministic card pool for the mocked backend.
const img = (id) => `https://images.e2e.test/${id}.png`

const card = (id, name, rarity, rarity_bucket, value, dex) => ({
  id,
  name,
  rarity,
  rarity_bucket,
  value,
  set_id: id.split('-')[0],
  image_small: img(id),
  image_url: img(`${id}_hires`),
  national_pokedex_number: dex,
  supertype: dex ? 'Pokémon' : 'Trainer',
  hp: dex ? 60 : null,
  types: dex ? ['Fire'] : null,
  artist: 'E2E Artist',
})

export const CARDS = [
  card('sv3pt5-4', 'Charmander', 'Common', 'common', 0.2, 4),
  card('sv3pt5-7', 'Squirtle', 'Common', 'common', 0.2, 7),
  card('sv3pt5-1', 'Bulbasaur', 'Common', 'common', 0.2, 1),
  card('sv3pt5-25', 'Pikachu', 'Common', 'common', 0.3, 25),
  card('sv3pt5-5', 'Charmeleon', 'Uncommon', 'uncommon', 0.4, 5),
  card('sv3pt5-8', 'Wartortle', 'Uncommon', 'uncommon', 0.4, 8),
  card('sv3pt5-2', 'Ivysaur', 'Uncommon', 'uncommon', 0.4, 2),
  card('sv3pt5-150', 'Mewtwo', 'Rare', 'rare', 2, 150),
  card('sv3pt5-6', 'Charizard ex', 'Double Rare', 'holo', 12, 6),
  card('sv3pt5-199', 'Charizard ex', 'Special Illustration Rare', 'secret', 180, 6),
  card('sv3pt5-190', "Giovanni's Charisma", 'Special Illustration Rare', 'secret', 20, null),
  card('base1-4', 'Charizard', 'Rare Holo', 'holo', 300, 6),
  card('base1-58', 'Pikachu', 'Common', 'common', 2, 25),
]

export const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]))

// The pack open_my_booster returns: 9 regular cards + a secret rare
export const PACK = ['sv3pt5-4', 'sv3pt5-7', 'sv3pt5-1', 'sv3pt5-25', 'sv3pt5-5', 'sv3pt5-8', 'sv3pt5-2', 'sv3pt5-150', 'sv3pt5-6', 'sv3pt5-199'].map(
  (id) => byId[id],
)

export const SETS = [
  { id: 'sv3pt5', name: '151', release_date: '2023-09-22', printed_total: 165, total: 11, logo_url: img('sv3pt5-logo'), symbol_url: img('sv3pt5-symbol') },
  { id: 'base1', name: 'Base', release_date: '1999-01-09', printed_total: 102, total: 2, logo_url: img('base1-logo'), symbol_url: img('base1-symbol') },
]

export const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ash@example.com',
  created_at: '2026-09-01T10:00:00Z',
  user_metadata: { username: 'Ash' },
  app_metadata: { provider: 'email' },
}

export const collectionEntry = (id, quantity = 1, acquired_at = '2026-09-20T10:00:00Z') => ({
  card_id: id,
  quantity,
  acquired_at,
  cards: byId[id],
})
