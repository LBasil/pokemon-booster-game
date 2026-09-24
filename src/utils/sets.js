// Set artwork lives on the pokemontcg.io CDN at predictable URLs, so it
// doesn't need to be stored in the sets table.
const CDN = 'https://images.pokemontcg.io'

export const setLogoUrl = (setId) => `${CDN}/${setId}/logo.png`
export const setSymbolUrl = (setId) => `${CDN}/${setId}/symbol.png`

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
