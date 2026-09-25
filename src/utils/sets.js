// Set artwork URLs come from the pokemontcg.io API (stored by
// scripts/populate.mjs, migration 0003). Rows populated before that fall back
// to the CDN's historical pattern, which works for sets up to late 2025.
const CDN = 'https://images.pokemontcg.io'

export const setLogoUrl = (set) => set.logo_url || `${CDN}/${set.id}/logo.png`
export const setSymbolUrl = (set) => set.symbol_url || `${CDN}/${set.id}/symbol.png`

// Subsets (Trainer Gallery, Shiny Vault, Classic Collection...) were never
// sold as boosters: their cards come inside the parent set's packs
// (sets.parent_set_id, migration 0010).
export const isSubset = (set) => Boolean(set?.parent_set_id)

/** Sets you can open a booster of (subsets hidden). */
export const boosterSets = (sets) => sets.filter((set) => !isSubset(set))

/** The set whose booster carries this set's cards (itself for a real set). */
export const packSetId = (setId, byId) => byId[setId]?.parent_set_id || setId

/** 'gallery' (Trainer / Galarian Gallery), 'vault' (Shiny Vault), 'classic' (Classic Collection), or null. */
export function subsetKind(set) {
  if (!isSubset(set)) return null
  if (/(tg|gg)$/.test(set.id)) return 'gallery'
  if (/sv$/.test(set.id) || set.id === 'sma') return 'vault'
  if (/c$/.test(set.id)) return 'classic'
  return 'other'
}

/** The subsets found inside a set's packs. */
export const subsetsOf = (setId, sets) => sets.filter((set) => set.parent_set_id === setId)

// Lowercase and strip accents so "pokemon" matches "Pokémon"
const normalize = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/**
 * Filters sets by name and groups them by release year, newest first.
 * @param {{ id: string, name: string, release_date: string|null }[]} sets
 * @param {string} [query]
 * @returns {{ year: string|null, sets: object[] }[]}
 */
export function groupSetsByYear(sets, query = '') {
  const needle = normalize(query)
  const groups = new Map()

  const sorted = [...sets].sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
  for (const set of sorted) {
    if (needle && !normalize(set.name).includes(needle) && !normalize(set.id).includes(needle)) continue
    const year = set.release_date ? set.release_date.slice(0, 4) : null
    if (!groups.has(year)) groups.set(year, [])
    groups.get(year).push(set)
  }

  return [...groups].map(([year, list]) => ({ year, sets: list }))
}
