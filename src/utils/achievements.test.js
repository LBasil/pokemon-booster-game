import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import { CATEGORIES, DEFINITIONS, achievementProgress, achievements, collectorStats, filterAchievements, MAX_TOASTS, newlyUnlocked, nextUp, rateOf, sortForToasts, tagsOf, TAGS, toastBatch } from './achievements'
import { KANTO_EXTRAS, KANTO_LINES } from './kanto'
import { JOHTO_EXTRAS, JOHTO_LINES } from './johto'
import { LEGENDS, MYTHICALS } from './pokemonGroups'

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
  // purpose: Morty's and Misty's teams are one evolution line each,
  // Diglett's Cave only has the Diglett line and the Lake of Rage the
  // Magikarp line (its red Gyarados)
  const SAME_MEMBERS_OK = [
    ['ghostLine', 'fogBadge'],
    ['staryuLine', 'cascadeBadge'],
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
    const lines = Object.values(JOHTO_LINES).flat()
    const johtoLegends = [...LEGENDS.legendaryBeasts, ...LEGENDS.towerDuo, ...MYTHICALS.filter((n) => n >= 152 && n <= 251)]
    // Babies and new evolutions of Kanto Pokémon (Pichu, Crobat, Espeon...)
    const kantos = [...KANTO_EXTRAS.kantoBabies, ...KANTO_EXTRAS.kantoNewEvolutions, ...KANTO_EXTRAS.eeveelutions].filter((n) => n >= 152 && n <= 251)
    const all = [...lines, ...JOHTO_EXTRAS.johtoSolos, ...johtoLegends, ...kantos].sort((a, b) => a - b)
    expect(all).toEqual(Array.from({ length: 100 }, (_, i) => i + 152))
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
