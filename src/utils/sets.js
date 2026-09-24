// Set artwork URLs come from the pokemontcg.io API (stored by
// scripts/populate.mjs, migration 0003). Rows populated before that fall back
// to the CDN's historical pattern, which works for sets up to late 2025.
const CDN = 'https://images.pokemontcg.io'

export const setLogoUrl = (set) => set.logo_url || `${CDN}/${set.id}/logo.png`
export const setSymbolUrl = (set) => set.symbol_url || `${CDN}/${set.id}/symbol.png`

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
