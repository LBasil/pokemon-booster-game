import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import { CATEGORIES, DEFINITIONS, achievementProgress, achievements, collectorStats, filterAchievements, MAX_TOASTS, newlyUnlocked, nextUp, rateOf, sortForToasts, tagsOf, TAGS, toastBatch } from './achievements'
import { KANTO_EXTRAS, KANTO_LINES } from './kanto'
import johto from './johto'
import hoenn from './hoenn'
import sinnoh from './sinnoh'
import unova from './unova'
import kalos from './kalos'
import alola from './alola'
import galar from './galar'
import paldea from './paldea'
import { LEGENDARIES, LEGENDS, MYTHICALS, ULTRA_BEASTS } from './pokemonGroups'

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
    for (const item of [...achievements([], sets), ...achievements([], sets, { mode: 'challenge' })]) {
      expect(typeof lookup(item.title) === 'string' || typeof lookup(`${item.title}.title`) === 'string', item.id).toBe(true)
      expect(typeof lookup(`desc.${item.desc}`), item.id).toBe('string')
    }
    for (const category of CATEGORIES) expect(typeof messages.achievements.categories[category]).toBe('string')
    for (const sub of new Set(DEFINITIONS.map((d) => d.sub).filter(Boolean))) expect(typeof messages.achievements.subs[sub], sub).toBe('string')
  })

  it('have known region tags', () => {
    expect(DEFINITIONS.every((d) => (d.tags ?? []).every((tag) => TAGS.includes(tag))), 'tags').toBe(true)
  })

  it('keep each subcategory in one block (one heading per subcategory)', () => {
    for (const category of CATEGORIES) {
      const subs = DEFINITIONS.filter((d) => d.category === category).map((d) => d.sub ?? null)
      const blocks = subs.filter((sub, i) => sub !== subs[i - 1])
      expect(new Set(blocks).size, category).toBe(blocks.length)
    }
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
    // economy is challenge-only
    expect(progress.categories.map((c) => c.category)).toEqual(CATEGORIES.filter((c) => c !== 'economy'))
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
  it('folds everything into one toast when max is 1 (phones)', () => {
    expect(toastBatch(items(1), 1)).toEqual([{ item: { id: 'a0' } }])
    expect(toastBatch(items(4), 1)).toEqual([{ item: { id: 'a0' }, extra: 3 }])
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
    expect(sortForToasts(items, null).map((i) => i.id)).toEqual(['secret1', 'ditto', 'unique10', 'boosters1'])
    const tiers = [{ id: 'holo1', category: 'pulls' }, { id: 'secret1', category: 'pulls' }]
    expect(sortForToasts(tiers, null).map((i) => i.id)).toEqual(['secret1', 'holo1'])
  })
  it('puts the rarest first with rates', () => {
    const rates = { players: 100, holders: { boosters1: 2, unique10: 50, secret1: 30, ditto: 40 } }
    expect(sortForToasts(items, rates).map((i) => i.id)).toEqual(['boosters1', 'secret1', 'ditto', 'unique10'])
  })
})

describe('achievements per mode', () => {
  const entries = Array.from({ length: 3 }, (_, i) => entry(`xy1-${i}`, {}, 10)) // 30 cards
  const byIdOf = (list) => Object.fromEntries(list.map((a) => [a.id, a]))

  it('unlimited: cards / 10, or more when the server logged more packs', () => {
    expect(collectorStats(entries, sets).boosters).toBe(3)
    expect(collectorStats(entries, sets, { mode: 'unlimited', packs: 1 }).boosters).toBe(3) // old packs unlogged
    expect(collectorStats(entries, sets, { mode: 'unlimited', packs: 5 }).boosters).toBe(5)
  })

  it('challenge: the server count wins (recycling, crafting)', () => {
    const s = collectorStats(entries, sets, { mode: 'challenge', packs: 12 })
    expect([s.boosters, s.total]).toEqual([12, 30])
    expect(collectorStats(entries, sets, { mode: 'challenge' }).boosters).toBe(3) // unknown: fallback
  })

  it('keeps achievements the server already recorded', () => {
    const a = byIdOf(achievements([], sets, { mode: 'challenge', packs: 0, unlocked: ['boosters10', 'secret1'] }))
    expect(a.boosters10).toMatchObject({ unlocked: true, current: 10, ratio: 1 })
    expect(a.secret1.unlocked).toBe(true)
    expect(a.boosters25.unlocked).toBe(false)
  })
})

describe('pack stats and subsets (migration 0010)', () => {
  const subsetSets = [...sets, { id: 'swsh9', total: 186 }, { id: 'swsh9tg', total: 30, parent_set_id: 'swsh9' }, { id: 'cel25c', total: 25, parent_set_id: 'cel25' }]
  const stats = { packs: 40, hit_packs: 10, secrets: 1, max_hits: 2, god_packs: 1, sets: 5, days: 10, best_day: 25, best_streak: 7, top_set_packs: 25 }

  it('reads the server stats, all locked without them', () => {
    const a = byId(achievements([], sets, { mode: 'challenge', packs: 40, stats: { ...stats, secrets: 5 } }))
    expect(a.hitPacks10.unlocked).toBe(true)
    expect(a.secretPulls5.unlocked).toBe(true)
    expect(a.hitPacks50).toMatchObject({ unlocked: false, current: 10 })
    expect(a.doubleHit.unlocked).toBe(true)
    expect(a.tripleHit.unlocked).toBe(false)
    expect(a.godPack.unlocked).toBe(true)
    expect(a.bigDay25.unlocked).toBe(true)
    expect(a.packStreak7.unlocked).toBe(true)
    expect(a.loyal25.unlocked).toBe(true)
    expect(a.packDays10.unlocked).toBe(true)
    const none = byId(achievements([], sets, { mode: 'challenge' }))
    expect(['hitPacks10', 'doubleHit', 'bigDay10', 'packStreak3'].every((id) => !none[id].unlocked)).toBe(true)
  })

  it('keeps challenge-only achievements out of the unlimited mode', () => {
    const unlimited = byId(achievements([], sets, { mode: 'unlimited', stats }))
    const challenge = byId(achievements([], sets, { mode: 'challenge', stats: { ...stats, trades: 1, coins_earned: 1200 } }))
    expect(unlimited.godPack).toBeUndefined()
    expect(unlimited.trades1).toBeUndefined()
    expect(challenge.trades1.unlocked).toBe(true)
    expect(challenge.coinsEarned1000.unlocked).toBe(true)
    expect(challenge.coinsEarned5000.unlocked).toBe(false)
    expect(unlimited.hitPacks10.unlocked).toBe(true) // luck exists in both
  })

  it('counts cards from subsets by kind', () => {
    const entries = [entry('swsh9tg-TG01'), entry('swsh9tg-TG02'), entry('cel25c-4_A'), entry('swsh9-1')]
    const s = collectorStats(entries, subsetSets)
    expect(Object.fromEntries(s.subsets)).toEqual({ gallery: 2, classic: 1 })
    const a = byId(achievements(entries, subsetSets))
    expect(a.subsetCards1.unlocked).toBe(true)
    expect(a.subsetCards10.current).toBe(3)
    expect(a.gallery.unlocked).toBe(true)
    expect(a.classic.unlocked).toBe(true)
    expect(a.vault.unlocked).toBe(false)
  })
})

describe('nextUp', () => {
  it('lists the locked ones closest to unlocking, secrets excluded', () => {
    const list = [
      { id: 'a', unlocked: true, ratio: 1, target: 1 },
      { id: 'b', unlocked: false, ratio: 0.5, target: 10 },
      { id: 'c', unlocked: false, ratio: 0.9, target: 10, hidden: true },
      { id: 'd', unlocked: false, ratio: 0.5, target: 2 },
      { id: 'e', unlocked: false, ratio: 0.1, target: 2 },
    ]
    expect(nextUp(list, 2).map((i) => i.id)).toEqual(['d', 'b'])
  })
})

describe('Pokémon groups', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`base1-${n}`, { national_pokedex_number: n }))

  it('unlocks a gym badge once its whole team is owned', () => {
    const list = byId(achievements(dex(74), sets))
    expect(list.boulderBadge).toMatchObject({ unlocked: false, current: 1, target: 2, category: 'people', sub: 'kantoGyms', icon: 'gyms' })
    expect(byId(achievements(dex(74, 95), sets)).boulderBadge.unlocked).toBe(true)
  })

  it('counts complete groups (badge case, places, evolution lines)', () => {
    const kanto = [74, 95, 120, 121, 100, 25, 26, 71, 114, 45, 109, 89, 110, 64, 122, 49, 65, 58, 77, 78, 59, 111, 51, 31, 34, 112]
    const list = byId(achievements(dex(...kanto), sets))
    expect(list.kantoBadges).toMatchObject({ unlocked: true, target: 8 })
    expect(list.johtoBadges.current).toBe(0)
    const lines = byId(achievements(dex(1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 60, 61), sets))
    expect(lines.families5.unlocked).toBe(true)
    expect(lines.families15.current).toBe(5) // Poliwag without Poliwrath
    expect(lines.route1.current).toBe(1) // Pidgey without Rattata
  })

  it('keeps Team Rocket a secret until unlocked', () => {
    expect(byId(achievements([], sets)).teamRocket.hidden).toBe(true)
  })
})

describe('no duplicates', () => {
  // The same Pokémon behind two achievements of different meaning, kept on
  // purpose: Morty's, Misty's and Milo's teams are one evolution line each,
  // Diglett's Cave only has the Diglett line and the Lake of Rage the
  // Magikarp line (its red Gyarados)
  const SAME_MEMBERS_OK = [
    ['ghostLine', 'fogBadge'],
    ['staryuLine', 'cascadeBadge'],
    ['gossifleurLine', 'galarGrassBadge'],
    ['diglettLine', 'diglettsCave'],
    ['magikarpLine', 'lakeOfRage'],
  ].map((pair) => pair.sort().join('+'))

  it('no two "own them all" groups ask for the same Pokémon', () => {
    const groups = DEFINITIONS.filter((d) => d.desc.startsWith('groups.') || d.desc.startsWith('teams.'))
    const byMembers = new Map()
    for (const d of groups) {
      const s = collectorStats([], sets) // members are what the metric counts: probe them one by one
      const members = []
      for (let dex = 1; dex <= 1025; dex++) {
        s.dex = new Set([dex])
        if (d.metric(s) > 0) members.push(dex)
      }
      const key = members.join(',')
      if (byMembers.has(key)) {
        const pair = [byMembers.get(key), d.id].sort().join('+')
        expect(SAME_MEMBERS_OK, pair).toContain(pair)
      } else byMembers.set(key, d.id)
    }
  })

  it('split every Kanto Pokémon into lines, loners and legends', () => {
    const lines = Object.values(KANTO_LINES).flat()
    const kantoLegends = [...LEGENDS.legendaryBirds, ...LEGENDS.mewDuo]
    const all = [...lines, ...KANTO_EXTRAS.kantoSolos, ...kantoLegends].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 151 }, (_, i) => i + 1))
  })

  it('split every Johto Pokémon into lines, loners, legends and Kanto’s groups', () => {
    const lines = Object.values(johto.lines).flat()
    const johtoLegends = [...LEGENDS.legendaryBeasts, ...LEGENDS.towerDuo, ...MYTHICALS.filter((n) => n >= 152 && n <= 251)]
    // Babies and new evolutions of Kanto Pokémon (Pichu, Crobat, Espeon...)
    const kantos = [...KANTO_EXTRAS.kantoBabies, ...KANTO_EXTRAS.kantoNewEvolutions, ...KANTO_EXTRAS.eeveelutions].filter((n) => n >= 152 && n <= 251)
    const all = [...lines, ...johto.extras.johtoSolos, ...johtoLegends, ...kantos].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 100 }, (_, i) => i + 152))
  })

  it('split every Hoenn Pokémon into lines, loners, legends and Johto’s babies', () => {
    const lines = Object.values(hoenn.lines).flat()
    const legends = [...LEGENDS.regiTrio, ...LEGENDS.eonDuo, ...LEGENDS.weatherTrio, 385, 386]
    const johtos = johto.extras.johtoBabies.filter((n) => n >= 252 && n <= 386) // Azurill, Wynaut
    const all = [...lines, ...hoenn.extras.hoennSolos, ...legends, ...johtos].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 135 }, (_, i) => i + 252))
  })

  it('split every Sinnoh Pokémon into lines, loners, legends and older regions’ groups', () => {
    const inSinnoh = (n) => n >= 387 && n <= 493
    const lines = Object.values(sinnoh.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS].filter(inSinnoh)
    // Babies and evolutions of older Pokémon (Budew, Magnezone, Togekiss...)
    const older = [...Object.values(KANTO_EXTRAS), ...Object.values(johto.extras), ...Object.values(hoenn.extras)].flat().filter(inSinnoh)
    const all = [...new Set([...lines, ...sinnoh.extras.sinnohSolos, ...legends, ...older])].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 107 }, (_, i) => i + 387))
    expect(lines.length + sinnoh.extras.sinnohSolos.length + legends.length + new Set(older).size).toBe(107) // no Pokémon in two of them
  })

  it('split every Unova Pokémon into lines, loners and legends', () => {
    const lines = Object.values(unova.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS].filter((n) => n >= 494 && n <= 649)
    const all = [...lines, ...unova.extras.unovaSolos, ...legends].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 156 }, (_, i) => i + 494))
  })

  it('split every Kalos Pokémon into lines, loners, legends and Sylveon', () => {
    const lines = Object.values(kalos.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS].filter((n) => n >= 650 && n <= 721)
    const sylveon = KANTO_EXTRAS.eeveelutions.filter((n) => n >= 650 && n <= 721)
    const all = [...lines, ...kalos.extras.kalosSolos, ...legends, ...sylveon].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 72 }, (_, i) => i + 650))
  })

  it('split every Alola Pokémon into lines, loners, legends and Ultra Beasts', () => {
    const lines = Object.values(alola.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS, ...ULTRA_BEASTS].filter((n) => n >= 722 && n <= 809)
    const all = [...lines, ...alola.extras.alolaSolos, ...legends].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 88 }, (_, i) => i + 722))
  })

  it('split every Galar Pokémon into lines, loners, legends and older regions’ groups', () => {
    const inGalar = (n) => n >= 810 && n <= 905
    const lines = Object.values(galar.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS].filter(inGalar)
    // New evolutions of older Pokémon (Obstagoon, Sirfetch'd...) and Hisui's
    const older = [...Object.values(KANTO_EXTRAS), ...[johto, hoenn, sinnoh, unova].flatMap((r) => Object.values(r.extras))].flat().filter(inGalar)
    const all = [...new Set([...lines, ...galar.extras.galarSolos, ...legends, ...older])].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 96 }, (_, i) => i + 810))
    expect(lines.length + galar.extras.galarSolos.length + new Set([...legends, ...older]).size).toBe(96) // lines and loners stay apart
  })

  it('split every Paldea Pokémon into lines, loners, legends, Paradox Pokémon and older regions’ groups', () => {
    const inPaldea = (n) => n >= 906 && n <= 1025
    const lines = Object.values(paldea.lines).flat()
    const legends = [...LEGENDARIES, ...MYTHICALS].filter(inPaldea)
    const paradox = [...paldea.extras.ancientParadox, ...paldea.extras.futureParadox]
    // New evolutions of older Pokémon (Annihilape, Clodsire, Archaludon...)
    const older = [...Object.values(KANTO_EXTRAS), ...[johto, unova, galar].flatMap((r) => Object.values(r.extras))].flat().filter(inPaldea)
    const all = [...lines, ...paldea.extras.paldeaSolos, ...legends, ...paradox, ...older].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 120 }, (_, i) => i + 906))
  })
})

describe('Kanto', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`base1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`gym1-${i}`, { name }))

  it('counts complete Kanto lines and routes', () => {
    const a = byId(achievements(dex(19, 20, 21, 22, 16), sets))
    expect(a.rattataLine.unlocked).toBe(true)
    expect(a.kantoLines10.current).toBe(2)
    expect(a.route1.unlocked).toBe(true)
    expect(a.route3.current).toBe(2) // no Jigglypuff
    expect(a.kantoDex25.current).toBe(5)
    expect(a.families5.current).toBe(2)
  })

  it('reads trainers’ and cities’ cards from their names', () => {
    const cards = named(
      "Brock's Onix",
      "Brock's Grit",
      'Brock',
      "Brock's Pewter City Gym",
      'Misty & Lorelei',
      "Team Rocket's Giovanni",
      'Lavender Town',
      'Loudred', // not Red
      'Red & Blue',
      'Imposter Professor Oak', // not Oak himself
      'Professor Oak',
    )
    const a = byId(achievements(cards, sets))
    expect(a.tc_brock.current).toBe(4)
    expect(a.tc_gymLeaders.current).toBe(3) // Brock, Misty, Giovanni
    expect(a.tc_eliteFour.current).toBe(1) // Lorelei
    expect(a.tc_redBlue.unlocked).toBe(true)
    expect(a.tc_oak.current).toBe(1)
    expect(a.tc_teamRocket.current).toBe(1)
    expect(a.impostor).toMatchObject({ unlocked: true, hidden: true })
    expect(a.pewterCity.unlocked).toBe(true)
    expect(a.lavenderTown.unlocked).toBe(true)
    expect(a.ceruleanCity.unlocked).toBe(false)
    expect(a.kantoCities.current).toBe(2)
  })

  it('counts regional forms whatever the card’s mechanic', () => {
    const a = byId(achievements(named('Alolan Vulpix', 'Alolan Ninetales-GX', 'Alolan Raichu V', 'Alolan Exeggutor'), sets))
    expect(a.alolanForms).toMatchObject({ current: 4, target: 18 })
  })

  it('filters by region tag', () => {
    const list = achievements([], sets)
    expect(tagsOf(list)[0]).toBe('kanto')
    const kanto = filterAchievements(list, { tag: 'kanto' })
    expect(kanto.length).toBeGreaterThan(100)
    expect(kanto.every((a) => a.tags.includes('kanto'))).toBe(true)
    expect(kanto.some((a) => a.category === 'people' && a.sub === 'trainerCards')).toBe(true)
    expect(filterAchievements(list, { tag: 'johto' }).map((a) => a.id)).toContain('mtSilver')
  })
})

describe('Johto', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`neo1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`hgss1-${i}`, { name }))

  it('counts complete Johto lines, routes and the League', () => {
    const a = byId(achievements(dex(16, 19, 161, 162, 163, 178, 124, 103, 80), sets))
    expect(a.sentretLine).toMatchObject({ unlocked: true, sub: 'johtoLines', tags: ['johto'] })
    expect(a.chikoritaLine.sub).toBe('johtoLines') // moved from the other regions' lines
    expect(a.johtoLines10.current).toBe(1)
    expect(a.route29.unlocked).toBe(true)
    expect(a.johtoRoutes).toMatchObject({ current: 1, target: 18 })
    expect(a.will.unlocked).toBe(true)
    expect(a.johtoEliteFour).toMatchObject({ current: 1, target: 4, sub: 'league' })
    expect(a.johtoDex25.current).toBe(4) // Sentret, Furret, Hoothoot, Xatu
    expect(a.nationalPark.sub).toBe('johtoLandmarks')
  })

  it('reads Johto trainers’ and places’ cards from their names', () => {
    const cards = named('Falkner', "Morty's Conviction", 'Will', 'Willow', "Ethan's Typhlosion", "Ethan's Ho-Oh ex", 'Professor Elm', "Team Rocket's Archer", 'Ruins of Alph', 'Paldean Wooper', 'Hisuian Typhlosion VSTAR')
    const a = byId(achievements(cards, sets))
    expect(a.tc_johtoGymLeaders.current).toBe(2) // Falkner, Morty
    expect(a.tc_johtoEliteFour.current).toBe(1) // Will, not Willow
    expect(a.tc_ethan.current).toBe(2)
    expect(a.tc_elm.current).toBe(1)
    expect(a.tc_rocketExecutives.current).toBe(1)
    expect(a.johtoPlaceCards.current).toBe(1)
    expect(a.johtoForms).toMatchObject({ current: 2, target: 5 })
  })

  it('counts the Neo and HeartGold & SoulSilver sets', () => {
    const a = byId(achievements([entry('neo1-1'), entry('neo4-1'), entry('col1-1')], sets))
    expect(a.neoSets.current).toBe(2)
    expect(a.hgssSets.current).toBe(1)
  })

  it('tags Johto’s achievements', () => {
    const johto = filterAchievements(achievements([], sets), { tag: 'johto' })
    expect(johto.length).toBeGreaterThan(80)
    expect(johto.some((a) => a.sub === 'johtoTrainerCards')).toBe(true)
  })
})

describe('Hoenn', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`ex1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`ex4-${i}`, { name }))

  it('counts complete Hoenn lines, routes, gyms and rivals', () => {
    const a = byId(achievements(dex(261, 262, 263, 265, 74, 299, 334, 301, 315, 82, 282), sets))
    expect(a.poochyenaLine).toMatchObject({ unlocked: true, sub: 'hoennLines', tags: ['hoenn'] })
    expect(a.treeckoLine.sub).toBe('hoennLines') // moved from the other regions' lines
    expect(a.route101.unlocked).toBe(true)
    expect(a.hoennRoutes.target).toBe(Object.keys(hoenn.routes).length)
    expect(a.stoneBadge).toMatchObject({ unlocked: true, sub: 'hoennGyms' })
    expect(a.hoennBadges.current).toBe(1)
    expect(a.wally).toMatchObject({ unlocked: true, sub: 'rivals', tags: ['hoenn'] })
    expect(a.hoennDex25.current).toBe(9) // Geodude and Magneton are Kanto's
  })

  it('reads Hoenn trainers’ and places’ cards from their names', () => {
    const cards = named('Roxanne', 'Tate & Liza', "Drake's Stadium", 'Drakloak', "Steven's Beldum", "Team Magma's Groudon", 'Maxie', 'Team Aqua Hideout', 'Galarian Linoone')
    const a = byId(achievements(cards, sets))
    expect(a.tc_hoennGymLeaders.current).toBe(2)
    expect(a.tc_hoennEliteFour.current).toBe(1) // Drake, not Drakloak
    expect(a.tc_steven.current).toBe(1)
    expect(a.tc_teamMagma.current).toBe(2)
    expect(a.hoennPlaceCards.current).toBe(1)
    expect(a.hoennForms).toMatchObject({ current: 1, target: 2 })
  })

  it('counts the Hoenn sets', () => {
    const a = byId(achievements([entry('ex1-1'), entry('ex4-1'), entry('xy5-1')], sets))
    expect(a.exHoennSets.current).toBe(2)
    expect(a.orasSets.current).toBe(1)
  })
})

describe('Sinnoh', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`dp1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`pl1-${i}`, { name }))

  it('counts complete Sinnoh lines, gyms, the League and Cyrus', () => {
    const a = byId(achievements(dex(399, 400, 74, 95, 408, 430, 130, 169, 461), sets))
    expect(a.bidoofLine).toMatchObject({ unlocked: true, sub: 'sinnohLines', tags: ['sinnoh'] })
    expect(a.gibleLine.sub).toBe('sinnohLines') // moved from the other regions' lines
    expect(a.coalBadge).toMatchObject({ unlocked: true, sub: 'sinnohGyms' })
    expect(a.cyrus.unlocked).toBe(true)
    expect(a.sinnohEvolutionBoom.current).toBe(2) // Honchkrow, Weavile
    expect(a.sinnohDex25.current).toBe(5) // Bidoof, Bibarel, Cranidos, Honchkrow, Weavile
  })

  it('reads Sinnoh trainers’ and places’ cards from their names', () => {
    const cards = named('Roark', "Gardenia's Vigor", "Flint's Willpower", 'Fiery Flint', "Cynthia's Garchomp ex", 'Cynthia & Caitlin', 'Mars', 'Marshadow', "Team Galactic's Wager", 'Mt. Coronet', 'Hisuian Zoroark VSTAR')
    const a = byId(achievements(cards, sets))
    expect(a.tc_sinnohGymLeaders.current).toBe(2)
    expect(a.tc_sinnohEliteFour.current).toBe(1) // Flint, not Fiery Flint
    expect(a.tc_cynthia.current).toBe(2)
    expect(a.tc_teamGalactic.current).toBe(2) // Mars and the Wager, not Marshadow
    expect(a.sinnohPlaceCards.current).toBe(1)
    expect(a.hisuianForms).toMatchObject({ current: 1, target: 17 })
  })

  it('counts the Sinnoh sets', () => {
    const a = byId(achievements([entry('dp1-1'), entry('pl4-1'), entry('swsh10-1')], sets))
    expect(a.dpSets.current).toBe(1)
    expect(a.platinumSets.current).toBe(1)
    expect(a.sinnohReturnSets.current).toBe(1)
  })
})

describe('Unova', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`bw1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`bw8-${i}`, { name }))

  it('counts complete Unova lines, gyms, the League, N and Ghetsis', () => {
    const a = byId(achievements(dex(504, 505, 507, 563, 609, 593, 623, 567, 565, 571, 584, 601), sets))
    expect(a.patratLine).toMatchObject({ unlocked: true, sub: 'unovaLines', tags: ['unova'] })
    expect(a.snivyLine.sub).toBe('unovaLines') // moved from the other regions' lines
    expect(a.basicBadge).toMatchObject({ unlocked: true, sub: 'unovaGyms' })
    expect(a.shauntal.unlocked).toBe(true)
    expect(a.n.unlocked).toBe(true)
    expect(a.ghetsis.current).toBe(1) // Cofagrigus
    expect(a.unovaFossils.current).toBe(2) // Carracosta, Archeops
    expect(a.unovaDex25.current).toBe(12)
  })

  it('reads Unova trainers’ and places’ cards from their names', () => {
    const cards = named('Chili & Cilan & Cress', 'Clay', 'Claydol', 'Caitlin', 'Cynthia & Caitlin', 'N', "N's Zoroark ex", 'Nidoking', 'Team Plasma Ball', 'Plasma Frigate', 'Colress Machine', 'Galarian Darmanitan V')
    const a = byId(achievements(cards, sets))
    expect(a.tc_unovaGymLeaders.current).toBe(2) // the trio and Clay, not Claydol
    expect(a.tc_unovaEliteFour.current).toBe(1) // Caitlin, not Cynthia & Caitlin
    expect(a.tc_n.current).toBe(2) // not Nidoking
    expect(a.tc_teamPlasma.current).toBe(3)
    expect(a.unovaPlaceCards.current).toBe(1)
    expect(a.unovaForms).toMatchObject({ current: 1, target: 4 })
  })

  it('counts the Unova sets', () => {
    const a = byId(achievements([entry('bw1-1'), entry('bw11-1'), entry('bw9-1'), entry('zsv10pt5-1')], sets))
    expect(a.bwSets.current).toBe(2)
    expect(a.plasmaSets.current).toBe(1)
    expect(a.unovaReturnSets.current).toBe(1)
  })
})

describe('Kalos', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`xy1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`xy4-${i}`, { name }))

  it('counts complete Kalos lines, gyms, the League, Lysandre and AZ', () => {
    const a = byId(achievements(dex(659, 660, 283, 666, 707, 681, 476, 212, 324, 623, 561), sets))
    expect(a.bunnelbyLine).toMatchObject({ unlocked: true, sub: 'kalosLines', tags: ['kalos'] })
    expect(a.goomyLine.sub).toBe('kalosLines') // moved from the other regions' lines
    expect(a.bugBadge).toMatchObject({ unlocked: true, sub: 'kalosGyms' })
    expect(a.wikstrom.unlocked).toBe(true)
    expect(a.az.unlocked).toBe(true)
    expect(a.kalosSolos.current).toBe(1) // Klefki
    expect(a.kalosDex25.current).toBe(5)
  })

  it('reads Kalos trainers’ and places’ cards from their names', () => {
    const cards = named('Grant', "Clemont's Quick Wit", 'Siebold', 'Shauna', 'AZ', "AZ's Tranquility", 'Lysandre', 'Lysandre Labs', 'Head Ringer Team Flare Hyper Gear', 'Team Flare Grunt', 'Lumiose Galette')
    const a = byId(achievements(cards, sets))
    expect(a.tc_kalosGymLeaders.current).toBe(2)
    expect(a.tc_kalosEliteFour.current).toBe(1)
    expect(a.tc_kalosFriends.current).toBe(1)
    expect(a.tc_az.unlocked).toBe(true)
    expect(a.tc_teamFlare.current).toBe(4) // Lysandre, his Labs, the gear, the grunt
    expect(a.kalosPlaceCards.current).toBe(1) // the Labs, not the Galette
  })

  it('counts the Kalos sets', () => {
    const a = byId(achievements([entry('xy1-1'), entry('xy5-1'), entry('xy11-1'), entry('me3-1')], sets))
    expect(a.xySets.current).toBe(2) // Primal Clash is Hoenn's
    expect(a.megaSets.current).toBe(1)
  })
})

describe('Alola', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`sm1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`sm3-${i}`, { name }))

  it('counts complete Alola lines, grand trials, the League and the villains', () => {
    const a = byId(achievements(dex(731, 732, 733, 56, 296, 739, 227, 733, 630, 169, 741, 768, 168, 284, 212, 127), sets))
    expect(a.pikipekLine).toMatchObject({ unlocked: true, sub: 'alolaLines', tags: ['alola'] })
    expect(a.rowletLine.sub).toBe('alolaLines') // moved from the other regions' lines
    expect(a.melemeleTrial).toMatchObject({ unlocked: true, sub: 'alolaGyms' })
    expect(a.kahili.unlocked).toBe(true)
    expect(a.guzma.unlocked).toBe(true)
    expect(a.alolaSolos.current).toBe(1) // Oricorio
    expect(a.alolaDex25.current).toBe(6)
  })

  it('reads Alola trainers’ and places’ cards from their names', () => {
    const cards = named('Hala', 'Guzma & Hala', 'Olivia', 'Mallow & Lana', "Lillie's Full Force", "Lillie's Clefairy ex", 'Gladion', 'Faba', 'Aether Paradise Conservation Area', 'Po Town', 'Team Skull Grunt', 'Halan Candy')
    const a = byId(achievements(cards, sets))
    expect(a.tc_alolaKahunas.current).toBe(2) // Hala (twice) and Olivia
    expect(a.tc_alolaCaptains.current).toBe(2) // Mallow and Lana on one card
    expect(a.tc_lillie.current).toBe(2)
    expect(a.tc_alolaFriends.current).toBe(1)
    expect(a.tc_aether.current).toBe(2) // Faba, Aether Paradise
    expect(a.tc_teamSkull.current).toBe(3) // Guzma & Hala, Po Town, the grunt
    expect(a.alolaPlaceCards.current).toBe(2)
  })

  it('counts the Sun & Moon sets', () => {
    const a = byId(achievements([entry('sm1-1'), entry('sm12-1'), entry('sm115-1'), entry('sm35-1')], sets))
    expect(a.smSets.current).toBe(2) // Hidden Fates and Shining Legends aside
  })
})

describe('Galar', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`swsh1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`swsh3-${i}`, { name }))

  it('counts complete Galar lines, gyms and the rivals', () => {
    const a = byId(achievements(dex(819, 820, 237, 865, 675, 68, 303, 78, 282, 858, 845), sets))
    expect(a.skwovetLine).toMatchObject({ unlocked: true, sub: 'galarLines', tags: ['galar'] })
    expect(a.grookeyLine.sub).toBe('galarLines') // moved from the other regions' lines
    expect(a.galarFightingBadge).toMatchObject({ unlocked: true, sub: 'galarGyms' })
    expect(a.bede.unlocked).toBe(true)
    expect(a.galarSolos.current).toBe(1) // Cramorant
    expect(a.galarDex25.current).toBe(5) // Sirfetch’d too
  })

  it('reads Galar trainers’, towns’ and places’ cards from their names', () => {
    const cards = named('Milo', 'Bea', "Hop's Wooloo", 'Hoppip', "Marnie's Pride", 'Team Yell Grunt', 'Team Yell Towel', 'Spikemuth Gym', 'Wyndon Stadium', 'Rose Tower', 'Rose', 'Roselia')
    const a = byId(achievements(cards, sets))
    expect(a.tc_galarGymLeaders.current).toBe(2)
    expect(a.tc_galarRivals.current).toBe(2) // Hop's Wooloo, not Hoppip
    expect(a.tc_teamYell.current).toBe(2)
    expect(a.tc_macroCosmos.current).toBe(1) // Rose, not Roselia
    expect(a.spikemuth.unlocked).toBe(true)
    expect(a.galarCities).toMatchObject({ current: 2, sub: 'galarCities' })
    expect(a.galarPlaceCards).toMatchObject({ current: 1, sub: 'galarCities' })
  })

  it('counts the Galar sets', () => {
    const a = byId(achievements([entry('swsh1-1'), entry('swsh8-1'), entry('swsh9-1'), entry('swsh35-1')], sets))
    expect(a.galarSets.current).toBe(2) // Brilliant Stars is Hisui's
    expect(a.galarSpecialSets.current).toBe(1)
  })
})

describe('Paldea', () => {
  const dex = (...numbers) => numbers.map((n) => entry(`sv1-${n}`, { national_pokedex_number: n }))
  const named = (...names) => names.map((name, i) => entry(`sv2-${i}`, { name }))

  it('counts complete Paldea lines, gyms, the League, Geeta and the professors', () => {
    const a = byId(achievements(dex(915, 916, 919, 917, 216, 956, 983, 673, 976, 713, 970, 988, 986, 985, 989, 987, 1005), sets))
    expect(a.lechonkLine).toMatchObject({ unlocked: true, sub: 'paldeaLines', tags: ['paldea'] })
    expect(a.sprigatitoLine.sub).toBe('paldeaLines') // moved from the other regions' lines
    expect(a.cortondoGym).toMatchObject({ unlocked: true, sub: 'paldeaGyms' })
    expect(a.geeta).toMatchObject({ unlocked: true, tags: ['paldea'] })
    expect(a.sada.unlocked).toBe(true)
    expect(a.ancientParadox.current).toBe(6)
    expect(a.paldeaRoutes).toBeUndefined() // no wild Pokémon known
  })

  it('reads Paldea trainers’, towns’ and places’ cards from their names', () => {
    const cards = named('Katy', "Iono's Bellibolt ex", "Larry's Skill", "Arven's Sandwich", 'Penny', 'Professor Sada’s Vitality', "Professor Turo's Scenario", 'Giacomo', 'Jacq', 'Mesagoza', 'Area Zero Underdepths', 'Erika')
    const a = byId(achievements(cards, sets))
    expect(a.tc_paldeaGymLeaders.current).toBe(3) // Katy, Iono, Larry
    expect(a.tc_paldeaEliteFour.current).toBe(1) // Larry
    expect(a.tc_paldeaFriends.current).toBe(2)
    expect(a.tc_paldeaProfessors.current).toBe(2)
    expect(a.tc_teamStar.current).toBe(1) // Giacomo, not Erika
    expect(a.tc_academy.current).toBe(1)
    expect(a.paldeaCities).toMatchObject({ current: 1, sub: 'paldeaCities' })
    expect(a.paldeaPlaceCards.current).toBe(1)
  })

  it('counts the Paldea sets', () => {
    const a = byId(achievements([entry('sv1-1'), entry('sv10-1'), entry('sv3pt5-1'), entry('sv8pt5-1'), entry('zsv10pt5-1')], sets))
    expect(a.paldeaSets.current).toBe(2) // 151 is Kanto's, Black Bolt Unova's
    expect(a.paldeaSpecialSets.current).toBe(1)
  })
})
