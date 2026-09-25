import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import { CATEGORIES, DEFINITIONS, achievementProgress, achievements, collectorStats, filterAchievements, MAX_TOASTS, newlyUnlocked, rateOf, sortForToasts, toastBatch } from './achievements'

const card = (id, fields = {}) => ({
  id,
  name: 'Card',
  rarity: 'Common',
  value: 0,
  set_id: id.split('-')[0],
  supertype: 'Pokémon',
  ...fields,
})
const entry = (id, fields = {}, quantity = 1, acquired_at = '2026-09-20T10:00:00Z') => ({
  card_id: id,
  quantity,
  acquired_at,
  cards: card(id, fields),
})

const sets = [
  { id: 'base1', total: 2, release_date: '1999-01-09' },
  { id: 'ex1', total: 100, release_date: '2003-06-18' },
  { id: 'xy1', total: 146, release_date: '2014-02-05' },
  { id: 'sv3pt5', total: 207, release_date: '2023-09-22' },
]
const byId = (list) => Object.fromEntries(list.map((a) => [a.id, a]))

describe('definitions', () => {
  it('have unique ids and known categories', () => {
    const ids = DEFINITIONS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(DEFINITIONS.every((d) => CATEGORIES.includes(d.category))).toBe(true)
    expect(ids.length).toBeGreaterThan(150)
  })

  it('every category has achievements', () => {
    for (const category of CATEGORIES) expect(DEFINITIONS.some((d) => d.category === category), category).toBe(true)
  })

  // Every title / description exists in both languages
  it.each([
    ['en', en],
    ['fr', fr],
  ])('are all translated in %s', (_, messages) => {
    const lookup = (path) => path.split('.').reduce((node, key) => node?.[key], messages.achievements)
    for (const item of achievements([], sets)) {
      expect(typeof lookup(item.title) === 'string' || typeof lookup(`${item.title}.title`) === 'string', item.id).toBe(true)
      expect(typeof lookup(`desc.${item.desc}`), item.id).toBe('string')
    }
    for (const category of CATEGORIES) expect(typeof messages.achievements.categories[category]).toBe('string')
  })
})

describe('collectorStats', () => {
  it('reads everything in one pass', () => {
    const entries = [
      entry('base1-4', { name: 'Charizard', rarity: 'Rare Holo', national_pokedex_number: 6, types: ['Fire'], hp: 120, value: 300, artist: 'Mitsuhiro Arita' }, 3),
      entry('base1-58', { name: 'Pikachu', national_pokedex_number: 25, types: ['Lightning'], hp: 40, artist: 'Mitsuhiro Arita' }, 1, '2026-09-21T10:00:00Z'),
      entry('sv3pt5-190', { name: "Giovanni's Charisma", supertype: 'Trainer', subtypes: ['Supporter'], rarity: 'Special Illustration Rare' }),
    ]
    const s = collectorStats(entries, sets)
    expect(s).toMatchObject({ unique: 3, total: 5, value: 900, bestCard: 300, maxQuantity: 3, maxHp: 120, minHp: 40, setsComplete: 1 })
    expect(s.buckets).toMatchObject({ common: 1, holo: 1, secret: 1 })
    expect([...s.dex]).toEqual([6, 25])
    expect(s.perType.get('Fire')).toBe(1)
    expect(s.subtypes.get('Supporter')).toBe(1)
    expect(s.artists.get('Mitsuhiro Arita')).toBe(2)
    expect([...s.letters].sort()).toEqual(['C', 'G', 'P'])
    expect(s.days.size).toBe(2)
    expect([...s.decades].sort()).toEqual([1990, 2020])
  })
})

describe('achievements', () => {
  it('is all locked (and at zero) for an empty collection', () => {
    const list = achievements([], sets)
    expect(list.every((a) => !a.unlocked && a.current === 0)).toBe(true)
  })

  it('unlocks from the collection, with capped progress', () => {
    const entries = [
      entry('base1-4', { name: 'Charizard', rarity: 'Rare Holo', national_pokedex_number: 6, types: ['Fire'], value: 400 }, 6),
      entry('base1-2', { name: 'Blastoise', national_pokedex_number: 9, types: ['Water'], value: 1 }, 5),
      entry('sv3pt5-199', { name: 'Charizard ex', rarity: 'Special Illustration Rare', national_pokedex_number: 6, subtypes: ['Stage 2', 'ex', 'Tera'], value: 700 }),
    ]
    const a = byId(achievements(entries, sets))
    expect(a.boosters1.unlocked).toBe(true) // 12 cards = 1 booster
    expect(a.boosters10).toMatchObject({ unlocked: false, current: 1, target: 10, ratio: 0.1 })
    expect(a.secret1.unlocked).toBe(true)
    expect(a.setsComplete1.unlocked).toBe(true) // base1: 2/2 in this fixture
    expect(a.wotc.unlocked).toBe(true)
    expect(a.baseSet.unlocked).toBe(true)
    expect(a.charizard.unlocked).toBe(true)
    expect(a.mech_svEx.unlocked).toBe(true)
    expect(a.mech_tera.unlocked).toBe(true)
    expect(a.mech_pokemonEx.unlocked).toBe(false) // "EX" is not "ex"
    expect(a.value1000).toMatchObject({ unlocked: true, current: 1000 }) // 2400 + 5 + 700, capped
    expect(a.charizardLine).toMatchObject({ current: 1, target: 3 })
    expect(a.region_kanto).toMatchObject({ current: 2, target: 151, params: { region: 'kanto', from: 1, to: 151 } })
    expect(a.type_Fire).toMatchObject({ current: 1, target: 25, params: { type: 'Fire' } })
  })

  it('completes a team or a region only with every member', () => {
    const starters = [1, 4, 7].map((dex) => entry(`xy1-${dex}`, { national_pokedex_number: dex }))
    expect(byId(achievements(starters, sets)).kantoStarters.unlocked).toBe(true)
    expect(byId(achievements(starters.slice(1), sets)).kantoStarters.unlocked).toBe(false)
  })
})

describe('achievementProgress', () => {
  it('counts overall and per category', () => {
    const list = achievements([entry('base1-4', { national_pokedex_number: 6 })], sets)
    const progress = achievementProgress(list)
    expect(progress.total).toBe(list.length)
    expect(progress.categories.map((c) => c.category)).toEqual(CATEGORIES)
    expect(progress.categories.reduce((sum, c) => sum + c.total, 0)).toBe(list.length)
    expect(progress.unlocked).toBe(list.filter((a) => a.unlocked).length)
  })
})

describe('filterAchievements', () => {
  const list = achievements([entry('base1-4', { national_pokedex_number: 6 }, 12)], sets)
  const text = (item) => item.id

  it('filters by category and status', () => {
    expect(filterAchievements(list, { category: 'packs' }).every((a) => a.category === 'packs')).toBe(true)
    expect(filterAchievements(list, { status: 'unlocked' }).every((a) => a.unlocked)).toBe(true)
    const inProgress = filterAchievements(list, { status: 'progress' })
    expect(inProgress.length).toBeGreaterThan(0)
    expect(inProgress.every((a) => !a.unlocked && a.current > 0)).toBe(true)
    expect(filterAchievements(list, { status: 'locked' }).every((a) => !a.unlocked)).toBe(true)
  })

  it('searches the visible text, ignoring case and accents', () => {
    const found = filterAchievements(list, { query: 'CHARIZARD' }, text)
    expect(found.map((a) => a.id)).toEqual(['charizardLine', 'charizard', 'charizardHunter'])
    expect(filterAchievements([{ ...list[0] }], { query: 'pokemon' }, () => 'Pokémon')).toHaveLength(1)
  })
})

describe('rateOf', () => {
  const rates = { players: 8, holders: { boosters1: 8, secret1: 1, bogus: 20 } }
  const item = (id, unlocked = false) => ({ id, unlocked })
  it('is the share of players, capped at 100%', () => {
    expect(rateOf(item('secret1'), rates)).toBe(12.5)
    expect(rateOf(item('boosters1'), rates)).toBe(100)
    expect(rateOf(item('bogus'), rates)).toBe(100)
    expect(rateOf(item('ultra150'), rates)).toBe(0)
  })
  it('counts the viewer for their own unlocks', () => {
    expect(rateOf(item('ultra150', true), rates, true)).toBe(12.5)
    expect(rateOf(item('ultra150', true), rates)).toBe(0) // someone else's profile
  })
  it('is unknown without rates or players', () => {
    expect(rateOf(item('secret1'), null)).toBeNull()
    expect(rateOf(item('secret1'), { players: 0, holders: {} })).toBeNull()
  })
})

describe('toastBatch', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }))
  it('shows up to MAX_TOASTS one by one', () => {
    expect(toastBatch(items(MAX_TOASTS))).toHaveLength(MAX_TOASTS)
  })
  it('sums up the rest beyond that', () => {
    const batch = toastBatch(items(7))
    expect(batch).toHaveLength(MAX_TOASTS)
    expect(batch.at(-1)).toEqual({ more: 7 - (MAX_TOASTS - 1) })
  })
})

describe('newlyUnlocked', () => {
  const list = [
    { id: 'a', unlocked: true },
    { id: 'b', unlocked: true },
    { id: 'c', unlocked: false },
  ]
  it('lists unlocked achievements not seen before', () => {
    expect(newlyUnlocked(list, new Set(['a'])).map((item) => item.id)).toEqual(['b'])
    expect(newlyUnlocked(list, new Set(['a', 'b']))).toEqual([])
  })
  it('treats a first check as the baseline', () => {
    expect(newlyUnlocked(list, null)).toEqual([])
  })
})

describe('sortForToasts', () => {
  const items = [
    { id: 'boosters1', category: 'packs', unlocked: true },
    { id: 'unique10', category: 'collection', unlocked: true },
    { id: 'secret1', category: 'pulls', unlocked: true },
    { id: 'ditto', category: 'fun', unlocked: true },
  ]
  it('puts the most exciting categories first without rates', () => {
    expect(sortForToasts(items, null).map((i) => i.id)).toEqual(['ditto', 'secret1', 'unique10', 'boosters1'])
  })
  it('puts the rarest first with rates', () => {
    const rates = { players: 100, holders: { boosters1: 2, unique10: 50, secret1: 30, ditto: 40 } }
    expect(sortForToasts(items, rates).map((i) => i.id)).toEqual(['boosters1', 'secret1', 'ditto', 'unique10'])
  })
})
