import { rarityBucket } from '@/utils/rarity'
import { CARDS_PER_BOOSTER } from '@/utils/profile'
import { subsetKind } from '@/utils/sets'
import {
  CHAMPIONS,
  ELITE_FOUR,
  KANTO_GYMS,
  LEGENDARIES,
  LEGENDS,
  MYTHICALS,
  PSEUDO_LEGENDS,
  RIVALS,
  STARTER_FINALS,
  STARTER_TRIOS,
  STARTERS,
  ULTRA_BEASTS,
} from '@/utils/pokemonGroups'
import {
  BILL_CARDS,
  ELITE_FOUR_CARDS,
  GYM_LEADER_CARDS,
  IMPOSTOR_OAK,
  KANTO_CITIES,
  KANTO_EXTRAS,
  KANTO_LANDMARKS,
  KANTO_LINES,
  KANTO_PLACE_CARDS,
  KANTO_ROUTES,
  OAK_CARDS,
  ORIGINAL_SETS,
  REGIONAL_FORMS,
  RIVAL_CARDS,
  TEAM_ROCKET_CARDS,
} from '@/utils/kanto'
import johto from '@/utils/johto'
import hoenn from '@/utils/hoenn'
import sinnoh from '@/utils/sinnoh'
import unova from '@/utils/unova'
import kalos from '@/utils/kalos'
import alola from '@/utils/alola'
import galar from '@/utils/galar'
import paldea from '@/utils/paldea'

// Achievements are computed from the (unlimited) collection alone, so they
// work on public profiles too, and a newly added achievement unlocks at once
// for everyone who already qualifies — nothing is stored server side.
//
// Each definition: { id, category, metric(stats) -> number, target,
// title?/desc? i18n keys under achievements.* (default items.<id>.title and
// desc.<family>), params? for those messages, hidden? (shown as "???" until
// unlocked), modes? (only in those game modes), sub? (subcategory: a heading
// inside the category, achievements.subs.<sub>), tags? (regions it belongs
// to: the region filter), icon? (AchievementTile icon, default the
// category's) }. Messages get { count: target } unless params says otherwise.
//
// Pack-based achievements (luck, streaks, best day...) read the server's
// stats (player_achievements().stats, migration 0010): they stay locked
// until it's applied, and only count packs logged since 0004.

export const CATEGORIES = [
  'packs',
  'luck',
  'collection',
  'pulls',
  'sets',
  'pokedex',
  'starters',
  'families',
  'legends',
  'people',
  'places',
  'types',
  'trainers',
  'mechanics',
  'treasure',
  'history',
  'artists',
  'fun',
  'dedication',
  'economy',
]

// Server pack stats (0010), all 0 when unknown
const PACK_STATS = ['packs', 'hit_packs', 'hits', 'secrets', 'max_hits', 'god_packs', 'sets', 'days', 'best_day', 'best_streak', 'top_set_packs']
const CHALLENGE_STATS = ['trades', 'gifts', 'coins_earned', 'missions', 'crafted', 'recycled', 'best_daily_streak']
const serverStats = (stats) => Object.fromEntries([...PACK_STATS, ...CHALLENGE_STATS].map((key) => [key, Number(stats?.[key]) || 0]))

export const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless']

// National Pokédex ranges per region (games' generations), also the tags of the region filter
export const REGIONS = [
  ['kanto', 1, 151],
  ['johto', 152, 251],
  ['hoenn', 252, 386],
  ['sinnoh', 387, 493],
  ['unova', 494, 649],
  ['kalos', 650, 721],
  ['alola', 722, 809],
  ['galar', 810, 905],
  ['paldea', 906, 1025],
]


// Card subtypes from pokemontcg.io, as printed on the cards (not translated)
export const MECHANICS = {
  pokemonEx: 'EX',
  gx: 'GX',
  v: 'V',
  vmax: 'VMAX',
  vstar: 'VSTAR',
  svEx: 'ex',
  tera: 'Tera',
  radiant: 'Radiant',
  mega: 'MEGA',
  break: 'BREAK',
  aceSpec: 'ACE SPEC',
  prismStar: 'Prism Star',
  legend: 'LEGEND',
  tagTeam: 'TAG TEAM',
  baby: 'Baby',
  restored: 'Restored',
  levelUp: 'Level-Up',
  ancient: 'Ancient',
  future: 'Future',
  singleStrike: 'Single Strike',
  rapidStrike: 'Rapid Strike',
  fusionStrike: 'Fusion Strike',
}

const DEX = { pikachu: 25, charizard: 6, magikarp: 129, ditto: 132, unown: 201, arceus: 493 }

const inc = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by)
const max = (map) => Math.max(0, ...map.values())

/**
 * Everything the achievements look at, in one pass over the collection.
 * @param {object[]} entries - collection entries ({ quantity, acquired_at, cards })
 * @param {object[]} sets - all sets ({ id, total, release_date })
 * @param {{ mode?: string, packs?: number|null }} [server] - boosters opened in
 *   that mode (player_achievements, migration 0009). The unlimited collection
 *   only grows, and its oldest packs were never logged: cards / 10 is the
 *   better count there. The challenge one shrinks (recycling, trades) and
 *   grows without packs (crafting): the server's count is the truth.
 *   `stats` = the server's pack stats (migration 0010), see PACK_STATS.
 */
export function collectorStats(entries, sets, { mode = 'unlimited', packs = null, stats = null } = {}) {
  const setsById = new Map(sets.map((set) => [set.id, set]))
  const s = {
    server: serverStats(stats),
    subsets: new Map(), // unique cards per subset kind (gallery, vault, classic)
    unique: entries.length,
    total: 0,
    value: 0,
    bestCard: 0,
    buckets: { common: 0, uncommon: 0, rare: 0, holo: 0, ultra: 0, secret: 0 },
    perSet: new Map(),
    dex: new Set(),
    perDex: new Map(),
    perType: new Map(),
    dualType: 0,
    supertypes: new Map(),
    subtypes: new Map(),
    artists: new Map(),
    names: new Map(), // unique cards per card name (trainers', cities' cards...)
    maxQuantity: 0,
    maxHp: 0,
    minHp: Infinity,
    letters: new Set(),
    years: new Set(),
    days: new Set(),
  }

  for (const entry of entries) {
    const card = entry.cards
    s.total += entry.quantity
    s.value += (card.value ?? 0) * entry.quantity
    s.bestCard = Math.max(s.bestCard, card.value ?? 0)
    s.buckets[card.rarity_bucket ?? rarityBucket(card.rarity)]++
    s.maxQuantity = Math.max(s.maxQuantity, entry.quantity)
    inc(s.perSet, card.set_id)
    const kind = subsetKind(setsById.get(card.set_id))
    if (kind) inc(s.subsets, kind)
    if (card.supertype) inc(s.supertypes, card.supertype)
    for (const subtype of card.subtypes ?? []) inc(s.subtypes, subtype)
    if (card.artist) inc(s.artists, card.artist)
    if (card.name) inc(s.names, card.name)
    const letter = card.name?.normalize('NFD')[0]?.toUpperCase()
    if (letter >= 'A' && letter <= 'Z') s.letters.add(letter)
    if (entry.acquired_at) s.days.add(entry.acquired_at.slice(0, 10))
    const year = setsById.get(card.set_id)?.release_date?.slice(0, 4)
    if (year) s.years.add(Number(year))

    if (card.supertype === 'Pokémon') {
      for (const type of card.types ?? []) inc(s.perType, type)
      if ((card.types?.length ?? 0) > 1) s.dualType++
      if (card.hp) {
        s.maxHp = Math.max(s.maxHp, card.hp)
        s.minHp = Math.min(s.minHp, card.hp)
      }
    }
    if (card.national_pokedex_number) {
      s.dex.add(card.national_pokedex_number)
      inc(s.perDex, card.national_pokedex_number)
    }
  }

  const percents = [...s.perSet].map(([id, owned]) => {
    const total = Math.max(setsById.get(id)?.total ?? 0, owned)
    return (owned / total) * 100
  })
  s.bestSetPercent = Math.max(0, ...percents)
  s.setsComplete = percents.filter((percent) => percent >= 100).length
  s.decades = new Set([...s.years].map((year) => Math.floor(year / 10) * 10))
  s.oldestYear = Math.min(Infinity, ...s.years)
  s.hits = s.buckets.holo + s.buckets.ultra + s.buckets.secret
  s.ultraPlus = s.buckets.ultra + s.buckets.secret
  const fromCards = Math.floor(s.total / CARDS_PER_BOOSTER)
  if (mode === 'challenge' && packs !== null) {
    s.boosters = packs
  } else {
    s.boosters = Math.max(fromCards, packs ?? 0)
  }
  return s
}

// ---------- Definitions ----------

const DEFINITIONS = []

/** One achievement per target, sharing a description ("Open {count} boosters"). */
function tiers(category, family, metric, targets, extra = {}) {
  for (const target of targets) {
    DEFINITIONS.push({ id: `${family}${target}`, category, metric, target, desc: family, ...extra })
  }
}

function one(category, id, metric, target = 1, extra = {}) {
  DEFINITIONS.push({ id, category, metric, target, desc: id, ...extra })
}

const owns = (list) => (s) => list.filter((number) => s.dex.has(number)).length
const sub = (name) => (s) => s.subtypes.get(name) ?? 0
const superOf = (name) => (s) => s.supertypes.get(name) ?? 0

// Card names (for trainers', cities' and regional forms' cards)
const namedCount = (pattern) => (s) => {
  let count = 0
  for (const [name, cards] of s.names) if (pattern.test(name)) count += cards
  return count
}
const hasNamed = (s, pattern) => [...s.names.keys()].some((name) => pattern.test(name))
/** How many of `patterns` at least one owned card matches. */
const covered = (patterns) => (s) => patterns.filter((pattern) => hasNamed(s, pattern)).length
// "Alolan Vulpix" also covers "Alolan Vulpix-GX" and "Alolan Vulpix VSTAR"
const formsOwned = (forms) => (s) =>
  forms.filter((form) => [...s.names.keys()].some((name) => name === form || name.startsWith(`${form} `) || name.startsWith(`${form}-`))).length

/** The region a Pokédex number belongs to (its generation). */
const regionOf = (number) => REGIONS.find(([, from, to]) => number >= from && number <= to)?.[0]

/**
 * "Own them all" groups of pokemonGroups.js / kanto.js (texts:
 * desc.groups.<id>). Tagged with the region of their first member unless
 * `tags` says otherwise; `perId` adds fields to single groups.
 */
function groups(category, map, { perId = {}, ...extra } = {}) {
  for (const [id, list] of Object.entries(map)) {
    const tags = extra.tags ?? [regionOf(list[0])]
    DEFINITIONS.push({ id, category, metric: owns(list), target: list.length, desc: `groups.${id}`, ...extra, tags, ...perId[id] })
  }
}
/** How many groups of `map` are complete. */
const complete = (map) => (s) => Object.values(map).filter((list) => list.every((number) => s.dex.has(number))).length

const kanto = { tags: ['kanto'] }

// Regions after Kanto, each in a file of the same shape (fields: hoenn.js).
// Their achievements sit right after Kanto's in each category, region by
// region, under subcategories named after the region (<region>Lines,
// <region>More, <region>Gyms, <region>TrainerCards, <region>Routes,
// <region>Landmarks, <region>Cities).
const REGION_FOCUS = [johto, hoenn, sinnoh, unova, kalos, alola, galar, paldea]
const lineIds = (focus) => Object.keys(focus.lines)
const placesOf = (focus) => ({ ...focus.routes, ...focus.landmarks })
const setsOwned = (ids) => (s) => ids.filter((id) => s.perSet.has(id)).length

// Packs
tiers('packs', 'boosters', (s) => s.boosters, [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000])
tiers('packs', 'bigDay', (s) => s.server.best_day, [10, 25, 50, 100])
tiers('packs', 'loyal', (s) => s.server.top_set_packs, [25, 100, 250])

// Luck (packs, not unique cards: duplicates count here). No first tier:
// the first hit / secret is already pulls' ultra1 / secret1
tiers('luck', 'hitPacks', (s) => s.server.hit_packs, [10, 50, 150])
tiers('luck', 'secretPulls', (s) => s.server.secrets, [5, 20])
one('luck', 'doubleHit', (s) => s.server.max_hits, 2)
one('luck', 'tripleHit', (s) => s.server.max_hits, 3, { hidden: true })
one('luck', 'godPack', (s) => s.server.god_packs, 1, { hidden: true, modes: ['challenge'] })

// Collection (cards pulled in total = boosters x 10: the boosters tiers already say it)
tiers('collection', 'unique', (s) => s.unique, [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000])

// Pulls (unique cards per rarity)
tiers('pulls', 'holo', (s) => s.hits, [1, 10, 50, 200])
tiers('pulls', 'ultra', (s) => s.ultraPlus, [1, 10, 50, 150])
tiers('pulls', 'secret', (s) => s.buckets.secret, [1, 5, 25, 75])
one('pulls', 'rainbow', (s) => Object.values(s.buckets).filter(Boolean).length, 6)

// Sets (sets opened ~ sets started: only the started ones are counted)
tiers('sets', 'setsStarted', (s) => s.perSet.size, [5, 10, 25, 50, 100])
one('sets', 'setHalf', (s) => Math.floor(s.bestSetPercent), 50, { percent: true })
one('sets', 'setThreeQuarters', (s) => Math.floor(s.bestSetPercent), 75, { percent: true })
tiers('sets', 'setsComplete', (s) => s.setsComplete, [1, 3, 10, 25])
// Subsets hidden inside other sets' packs
const subsetCards = (s) => [...s.subsets.values()].reduce((sum, n) => sum + n, 0)
tiers('sets', 'subsetCards', subsetCards, [1, 10, 50])
one('sets', 'gallery', (s) => s.subsets.get('gallery') ?? 0)
one('sets', 'vault', (s) => s.subsets.get('vault') ?? 0)
one('sets', 'classic', (s) => s.subsets.get('classic') ?? 0)

// Pokédex
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
tiers('pokedex', 'dex', (s) => s.dex.size, [10, 50, 151, 251, 386, 500, 750, 1025])
tiers('pokedex', 'kantoDex', owns(range(1, 151)), [25, 50, 100], kanto)
for (const { region, dex: [from, to], dexTiers } of REGION_FOCUS) tiers('pokedex', `${region}Dex`, owns(range(from, to)), dexTiers, { tags: [region] })
for (const [region, from, to] of REGIONS) {
  DEFINITIONS.push({
    id: `region_${region}`,
    category: 'pokedex',
    metric: owns(range(from, to)),
    target: to - from + 1,
    title: 'regionTitle',
    desc: 'region',
    params: { region, from, to },
    tags: [region],
  })
}

// Starters
groups('starters', STARTER_TRIOS)
one('starters', 'allStarters', owns(STARTERS), STARTERS.length)
one('starters', 'starterFinals', owns(STARTER_FINALS), STARTER_FINALS.length)

// Evolution lines: all regions, then Kanto's (every line of Red and Blue and
// what surrounds them), then the other regions' (same way)
const ALL_LINES = { ...KANTO_LINES, ...Object.assign({}, ...REGION_FOCUS.map((focus) => focus.lines)) }
tiers('families', 'families', complete(ALL_LINES), [5, 15, 30, 60], { sub: 'allLines' })
DEFINITIONS.push({ id: 'pseudoLegends', category: 'families', metric: owns(PSEUDO_LEGENDS), target: PSEUDO_LEGENDS.length, desc: 'groups.pseudoLegends', sub: 'allLines' })
groups('families', KANTO_LINES, { sub: 'kantoLines', ...kanto })
tiers('families', 'kantoLines', complete(KANTO_LINES), [10, 25, Object.keys(KANTO_LINES).length], { sub: 'kantoLines', ...kanto })
groups('families', KANTO_EXTRAS, { sub: 'kantoMore', ...kanto })
const formTags = { alolanForms: ['kanto', 'alola'], galarianForms: ['kanto', 'galar'], hisuiPaldeaForms: ['kanto', 'paldea'] }
for (const [id, forms] of Object.entries(REGIONAL_FORMS)) {
  one('families', id, formsOwned(forms), forms.length, { sub: 'kantoMore', tags: formTags[id] })
}
for (const focus of REGION_FOCUS) {
  const { region } = focus
  const tags = [region]
  groups('families', focus.lines, { sub: `${region}Lines`, tags })
  tiers('families', `${region}Lines`, complete(focus.lines), [...focus.lineTiers, lineIds(focus).length], { sub: `${region}Lines`, tags })
  groups('families', focus.extras, { sub: `${region}More`, tags })
  for (const [id, form] of Object.entries(focus.forms ?? {})) one('families', id, formsOwned(form.names), form.names.length, { sub: `${region}More`, tags: form.tags })
}

// Legends
tiers('legends', 'legendaries', owns(LEGENDARIES), [3, 10, 25, 50])
tiers('legends', 'mythicals', owns(MYTHICALS), [1, 5, 10, 20])
groups('legends', LEGENDS)
one('legends', 'ultraBeasts', owns(ULTRA_BEASTS), ULTRA_BEASTS.length, { tags: ['alola'] })

// Famous trainers: gym leaders (one badge per team, then the region), the
// League, rivals, then Kanto's trainers on their own cards
groups('people', KANTO_GYMS, { sub: 'kantoGyms', icon: 'gyms', ...kanto })
one('people', 'kantoBadges', complete(KANTO_GYMS), Object.keys(KANTO_GYMS).length, { sub: 'kantoGyms', icon: 'gyms', ...kanto })
for (const { region, gyms } of REGION_FOCUS) {
  if (!gyms) continue
  groups('people', gyms, { sub: `${region}Gyms`, icon: 'gyms', tags: [region] })
  one('people', `${region}Badges`, complete(gyms), Object.keys(gyms).length, { sub: `${region}Gyms`, icon: 'gyms', tags: [region] })
}
const league = { sub: 'league', icon: 'league' }
groups('people', ELITE_FOUR, { ...league, ...kanto })
one('people', 'eliteFour', complete(ELITE_FOUR), Object.keys(ELITE_FOUR).length, { ...league, ...kanto })
for (const { region, eliteFour } of REGION_FOCUS) {
  if (!eliteFour) continue
  groups('people', eliteFour, { ...league, tags: [region] })
  one('people', `${region}EliteFour`, complete(eliteFour), Object.keys(eliteFour).length, { ...league, tags: [region] })
}
const championRegions = { blue: 'kanto', lanceJohto: 'johto', steven: 'hoenn', wallace: 'hoenn', cynthia: 'sinnoh', alder: 'unova', iris: 'unova', diantha: 'kalos', leon: 'galar', geeta: 'paldea' }
groups('people', CHAMPIONS, { ...league, perId: Object.fromEntries(Object.entries(championRegions).map(([id, region]) => [id, { tags: [region] }])) })
tiers('people', 'champions', complete(CHAMPIONS), [1, 4, 8], league)
groups('people', RIVALS, { sub: 'rivals', icon: 'rivals', perId: { teamRocket: { hidden: true }, ashChampion: { tags: [] } } })
for (const { region, people } of REGION_FOCUS) if (people) groups('people', people, { sub: 'rivals', icon: 'rivals', tags: [region] })
const trainerCards = { sub: 'trainerCards', icon: 'trainers', ...kanto }
one('people', 'tc_gymLeaders', covered(Object.values(GYM_LEADER_CARDS)), Object.keys(GYM_LEADER_CARDS).length, trainerCards)
for (const [leader, pattern] of Object.entries(GYM_LEADER_CARDS)) one('people', `tc_${leader}`, namedCount(pattern), 10, trainerCards)
one('people', 'tc_eliteFour', covered(ELITE_FOUR_CARDS), ELITE_FOUR_CARDS.length, trainerCards)
one('people', 'tc_redBlue', covered(RIVAL_CARDS), RIVAL_CARDS.length, trainerCards)
one('people', 'tc_oak', namedCount(OAK_CARDS), 3, trainerCards)
one('people', 'tc_bill', namedCount(BILL_CARDS), 1, trainerCards)
one('people', 'tc_teamRocket', namedCount(TEAM_ROCKET_CARDS), 25, trainerCards)
for (const { region, trainerCards } of REGION_FOCUS) {
  const extra = { sub: `${region}TrainerCards`, icon: 'trainers', tags: [region] }
  for (const [id, { patterns, pattern, target }] of Object.entries(trainerCards)) {
    if (patterns) one('people', id, covered(patterns), patterns.length, extra)
    else one('people', id, namedCount(pattern), target, extra)
  }
}

// Places and their wild Pokémon: all of them, Kanto (routes, caves and
// buildings, cities on cards), then the other regions with a file (same way)
const ALL_PLACES = { ...KANTO_ROUTES, ...KANTO_LANDMARKS, ...Object.assign({}, ...REGION_FOCUS.map(placesOf)) }
tiers('places', 'places', complete(ALL_PLACES), [3, 7, 14, 25], { sub: 'allPlaces' })
groups('places', KANTO_ROUTES, { sub: 'kantoRoutes', ...kanto })
one('places', 'kantoRoutes', complete(KANTO_ROUTES), Object.keys(KANTO_ROUTES).length, { sub: 'kantoRoutes', ...kanto })
groups('places', KANTO_LANDMARKS, { sub: 'kantoLandmarks', ...kanto, perId: { mtSilver: { tags: ['kanto', 'johto'] } } })
one('places', 'kantoLandmarks', complete(KANTO_LANDMARKS), Object.keys(KANTO_LANDMARKS).length, { sub: 'kantoLandmarks', ...kanto })
const cityCards = { sub: 'kantoCities', ...kanto }
for (const [city, pattern] of Object.entries(KANTO_CITIES)) one('places', city, namedCount(pattern), 1, cityCards)
one('places', 'kantoCities', covered(Object.values(KANTO_CITIES)), Object.keys(KANTO_CITIES).length, cityCards)
one('places', 'kantoPlaceCards', covered(KANTO_PLACE_CARDS), KANTO_PLACE_CARDS.length, cityCards)
for (const focus of REGION_FOCUS) {
  const { region, routes, landmarks, cities, placeCards } = focus
  const tags = [region]
  // No routes or landmarks when the wild Pokémon aren't known (Paldea)
  if (routes) {
    groups('places', routes, { sub: `${region}Routes`, tags })
    one('places', `${region}Routes`, complete(routes), Object.keys(routes).length, { sub: `${region}Routes`, tags })
  }
  if (landmarks) {
    groups('places', landmarks, { sub: `${region}Landmarks`, tags })
    one('places', `${region}Landmarks`, complete(landmarks), Object.keys(landmarks).length, { sub: `${region}Landmarks`, tags })
  }
  // Places on cards: with the cities when some have a card, else with the landmarks
  const cardsSub = cities ? `${region}Cities` : `${region}Landmarks`
  for (const [city, pattern] of Object.entries(cities ?? {})) one('places', city, namedCount(pattern), 1, { sub: cardsSub, tags })
  if (cities) one('places', `${region}Cities`, covered(Object.values(cities)), Object.keys(cities).length, { sub: cardsSub, tags })
  one('places', `${region}PlaceCards`, covered(placeCards), placeCards.length, { sub: cardsSub, tags })
}

// Types
one('types', 'allTypes', (s) => TYPES.filter((type) => s.perType.has(type)).length, TYPES.length)
one('types', 'dualType', (s) => s.dualType)
for (const type of TYPES) {
  DEFINITIONS.push({
    id: `type_${type}`,
    category: 'types',
    metric: (s) => s.perType.get(type) ?? 0,
    target: 25,
    title: 'typeTitle',
    desc: 'typeCards',
    params: { type },
  })
}

// Trainer cards & energy
tiers('trainers', 'trainers', superOf('Trainer'), [10, 50, 150])
tiers('trainers', 'supporters', sub('Supporter'), [10, 50])
tiers('trainers', 'items', sub('Item'), [10, 50])
tiers('trainers', 'stadiums', sub('Stadium'), [5, 20])
tiers('trainers', 'tools', sub('Pokémon Tool'), [5])
tiers('trainers', 'energy', superOf('Energy'), [5])
tiers('trainers', 'specialEnergy', sub('Special'), [5])

// Mechanics (card subtypes)
for (const [id, name] of Object.entries(MECHANICS)) {
  DEFINITIONS.push({ id: `mech_${id}`, category: 'mechanics', metric: sub(name), target: 1, desc: 'mechanic', params: { mechanic: name } })
}
const mechanicsOwned = (s) => Object.values(MECHANICS).filter((name) => s.subtypes.has(name)).length
tiers('mechanics', 'mechanics', mechanicsOwned, [5, 10, 15])

// Treasure (euros, Cardmarket average)
tiers('treasure', 'value', (s) => Math.floor(s.value), [10, 100, 500, 1000, 5000, 10000, 50000], { money: true })
tiers('treasure', 'bestCard', (s) => Math.floor(s.bestCard), [20, 100, 250, 500, 1000], { money: true, single: true })

// History (set release dates)
one('history', 'baseSet', (s) => s.perSet.get('base1') ?? 0, 1, kanto)
one('history', 'originalSets', (s) => ORIGINAL_SETS.filter((id) => s.perSet.has(id)).length, ORIGINAL_SETS.length, kanto)
for (const { region, sets } of REGION_FOCUS) {
  for (const [id, ids] of Object.entries(sets)) one('history', id, setsOwned(ids), ids.length, { tags: [region] })
}
one('history', 'wotc', (s) => (s.oldestYear < 2003 ? 1 : 0))
one('history', 'decade2000', (s) => (s.decades.has(2000) ? 1 : 0))
one('history', 'decade2010', (s) => (s.decades.has(2010) ? 1 : 0))
one('history', 'decade2020', (s) => (s.decades.has(2020) ? 1 : 0))
one('history', 'allDecades', (s) => [1990, 2000, 2010, 2020].filter((decade) => s.decades.has(decade)).length, 4)
tiers('history', 'years', (s) => s.years.size, [5, 10, 20, 25])

// Artists
tiers('artists', 'artists', (s) => s.artists.size, [5, 25, 100, 250])
tiers('artists', 'artistFan', (s) => max(s.artists), [10, 50])

// Fun (some hidden until unlocked)
tiers('fun', 'copies', (s) => s.maxQuantity, [10, 50, 200])
tiers('fun', 'sameDex', (s) => max(s.perDex), [10, 25])
one('fun', 'pikachu', (s) => s.perDex.get(DEX.pikachu) ?? 0, 10, kanto)
one('fun', 'charizard', (s) => s.perDex.get(DEX.charizard) ?? 0, 1, kanto)
one('fun', 'charizardHunter', (s) => s.perDex.get(DEX.charizard) ?? 0, 10, kanto)
one('fun', 'heavyweight', (s) => (s.maxHp >= 300 ? 1 : 0))
one('fun', 'alphabet', (s) => s.letters.size, 26)
one('fun', 'magikarp', (s) => s.perDex.get(DEX.magikarp) ?? 0, 5, { hidden: true, ...kanto })
one('fun', 'ditto', (s) => s.perDex.get(DEX.ditto) ?? 0, 1, { hidden: true, ...kanto })
one('fun', 'impostor', namedCount(IMPOSTOR_OAK), 1, { hidden: true, ...kanto })
one('fun', 'unown', (s) => s.perDex.get(DEX.unown) ?? 0, 5, { hidden: true, tags: ['johto'] })
one('fun', 'arceus', (s) => s.perDex.get(DEX.arceus) ?? 0, 1, { hidden: true, tags: ['sinnoh'] })
one('fun', 'featherweight', (s) => (s.minHp <= 30 ? 1 : 0), 1, { hidden: true })

// Dedication (days with new cards: acquired_at is each card's first pull;
// from 100 days on, packDays says the same)
tiers('dedication', 'days', (s) => s.days.size, [3, 7, 30])
tiers('dedication', 'packStreak', (s) => s.server.best_streak, [3, 7, 14, 30])
tiers('dedication', 'packDays', (s) => s.server.days, [10, 50, 100, 365])

// Economy: the challenge's coins, missions and trades
const challengeOnly = { modes: ['challenge'] }
tiers('economy', 'coinsEarned', (s) => s.server.coins_earned, [1000, 5000, 25000, 100000], challengeOnly)
tiers('economy', 'missions', (s) => s.server.missions, [5, 25, 100], challengeOnly)
tiers('economy', 'dailyStreak', (s) => s.server.best_daily_streak, [3, 7, 30], challengeOnly)
tiers('economy', 'trades', (s) => s.server.trades, [1, 10, 25], challengeOnly)
tiers('economy', 'gifts', (s) => s.server.gifts, [1, 5], challengeOnly)
tiers('economy', 'crafted', (s) => s.server.crafted, [1, 10, 50], challengeOnly)
tiers('economy', 'recycled', (s) => s.server.recycled, [25, 250, 1000], challengeOnly)

export { DEFINITIONS }

/** The definitions of one game mode. */
export const definitionsFor = (mode) => DEFINITIONS.filter((definition) => !definition.modes || definition.modes.includes(mode))

/**
 * @param {object[]} entries
 * @param {object[]} sets
 * @param {{ mode?: string, packs?: number|null, unlocked?: Iterable<string> }} [server] -
 *   see collectorStats; `unlocked` = ids the server already recorded: once
 *   unlocked, an achievement stays unlocked even if the collection shrinks
 * @returns {{ id, category, sub, tags, icon, title, desc, params, money, single, hidden, current, target, unlocked, ratio }[]}
 *   in display order (category, then definition order)
 */
export function achievements(entries, sets, server = {}) {
  const stats = collectorStats(entries, sets, server)
  const kept = new Set(server.unlocked ?? [])
  const mode = server.mode ?? 'unlimited'
  return definitionsFor(mode).map(({ metric, modes: _modes, ...definition }) => {
    const value = kept.has(definition.id) ? Math.max(metric(stats), definition.target) : metric(stats)
    const current = Math.min(value, definition.target)
    return {
      title: `items.${definition.id}`,
      params: {},
      money: false,
      percent: false,
      single: false,
      hidden: false,
      sub: null,
      tags: [],
      icon: definition.category,
      ...definition,
      current,
      unlocked: value >= definition.target,
      ratio: current / definition.target,
    }
  })
}

/** The `count` locked achievements closest to unlocking (secret ones stay out of it). */
export function nextUp(list, count = 4) {
  return list
    .filter((item) => !item.unlocked && !item.hidden)
    .sort((a, b) => b.ratio - a.ratio || a.target - b.target)
    .slice(0, count)
}

/** Unlocked / total, overall and per category (in CATEGORIES order). */
export function achievementProgress(list) {
  const count = (items) => ({ unlocked: items.filter((item) => item.unlocked).length, total: items.length })
  return {
    ...count(list),
    // Categories of another mode only (e.g. economy in unlimited) are left out
    categories: CATEGORIES.map((category) => ({ category, ...count(list.filter((item) => item.category === category)) })).filter(
      (summary) => summary.total > 0,
    ),
  }
}

export const STATUSES = ['all', 'unlocked', 'progress', 'locked']

// Region filter: the regions that some achievement of `list` is tagged with, in Pokédex order
export const TAGS = REGIONS.map(([region]) => region)
export const tagsOf = (list) => TAGS.filter((tag) => list.some((item) => item.tags.includes(tag)))

// Lowercase, no accents: "pokemon" finds "Pokémon"
const normalize = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/**
 * @param {object[]} list - from achievements()
 * @param {{ category?: string, status?: string, tag?: string, query?: string }} filters
 * @param {(item) => string} [textOf] - the item's visible title + description,
 *   for the search (hidden, locked items have none: they never match a search)
 */
export function filterAchievements(list, { category = 'all', status = 'all', tag = 'all', query = '' } = {}, textOf = () => '') {
  const needle = normalize(query)
  return list.filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    if (tag !== 'all' && !item.tags?.includes(tag)) return false
    if (status === 'unlocked' && !item.unlocked) return false
    if (status === 'locked' && item.unlocked) return false
    // In progress: started but not there yet
    if (status === 'progress' && (item.unlocked || item.current === 0)) return false
    if (needle && !normalize(textOf(item)).includes(needle)) return false
    return true
  })
}

/**
 * Share of players holding an achievement, in % (0-100), or null when
 * unknown (rates not loaded, migration 0008 missing, no players yet).
 * An achievement the viewer holds counts at least them, even before the
 * server has their report.
 * @param {{ id: string, unlocked?: boolean }} item
 * @param {{ players: number, holders: Record<string, number> } | null} rates
 * @param {boolean} [mine] - item.unlocked is the viewer's own
 */
export function rateOf(item, rates, mine = false) {
  if (!rates?.players) return null
  const holders = Math.max(rates.holders[item.id] ?? 0, mine && item.unlocked ? 1 : 0)
  return Math.min(100, (holders / rates.players) * 100)
}

// Most exciting first when rates don't say which is rarer
const TOAST_PRIORITY = [
  'luck',
  'pulls',
  'fun',
  'legends',
  'people',
  'starters',
  'families',
  'places',
  'treasure',
  'sets',
  'pokedex',
  'mechanics',
  'types',
  'history',
  'artists',
  'economy',
  'trainers',
  'collection',
  'packs',
  'dedication',
]

/**
 * Order for a batch of unlock toasts: rarest first, then TOAST_PRIORITY, then
 * the hardest of a category first (later definitions = bigger tiers).
 */
export function sortForToasts(items, rates) {
  const rate = (item) => rateOf(item, rates, true) ?? 100
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        rate(a.item) - rate(b.item) ||
        TOAST_PRIORITY.indexOf(a.item.category) - TOAST_PRIORITY.indexOf(b.item.category) ||
        b.index - a.index,
    )
    .map(({ item }) => item)
}

// Toasts shown for one check; beyond that, the last one sums up the rest
export const MAX_TOASTS = 3

/**
 * The toasts for a batch of new unlocks: all of them up to `max`, otherwise
 * the first `max` - 1 and a "+N more" one. Phones pass max = 1: a single
 * toast (the first item, `extra` = how many more), since a stack of them
 * hid half the pack summary.
 * @returns {({ item: object, extra?: number } | { more: number })[]}
 */
export function toastBatch(items, max = MAX_TOASTS) {
  if (items.length <= max) return items.map((item) => ({ item }))
  if (max <= 1) return [{ item: items[0], extra: items.length - 1 }]
  const shown = items.slice(0, max - 1)
  return [...shown.map((item) => ({ item })), { more: items.length - shown.length }]
}

/**
 * Achievements unlocked now but not in `seen` (ids), in display order.
 * `seen` null = never checked on this device: nothing is new, the current
 * state just becomes the baseline (no burst of old unlocks).
 */
export function newlyUnlocked(list, seen) {
  if (!seen) return []
  return list.filter((item) => item.unlocked && !seen.has(item.id))
}
