// Dev helper for the regional achievements (src/utils/<region>.js), never
// bundled. Network calls need NODE_USE_SYSTEM_CA=1 on this machine.
//
//   node scripts/region-tools.mjs lines <from> <to>
//     Evolution chains of the Pokémon #from..#to (PokéAPI), to write `lines`,
//     solos, babies and later evolutions.
//   node scripts/region-tools.mjs encounters <pokeapi region id> <version,version>
//     Wild Pokémon of the region's first games per location (every area of a
//     location together): walk, surf, Super Rod and one-off encounters; Old
//     and Good Rods, Headbutt, Rock Smash, gifts, trades and roamers are left
//     out (the Kanto rules). Locations with the same Pokémon are grouped.
//   node scripts/region-tools.mjs cards <regex>
//     Card names of the database matching <regex> (scripts/.env.local).
//   node scripts/region-tools.mjs texts <region>
//     Writes the EN/FR texts the region's dex lists are missing (titles of
//     lines, routes and places, "own the whole line" / "found there"
//     descriptions) into src/i18n/locales, with official names from PokéAPI
//     (a place's id in kebab case is its PokéAPI location: mtPyre ->
//     mt-pyre). Everything else (trainers, sets...) is written by hand; a
//     branched line (Wurmple) is better named after its first member.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheFile = path.join(root, 'scripts/.cache/pokeapi.json')
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
const saveCache = () => {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify(cache))
}

async function get(url) {
  url = url.startsWith('http') ? url : `https://pokeapi.co/api/v2/${url}`
  if (cache[url]) return cache[url]
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      return (cache[url] = await response.json())
    } catch (error) {
      if (attempt === 3) throw error
    }
  }
}
const idOf = (url) => Number(url.match(/\/(\d+)\/$/)[1])
const inBatches = async (items, fn, size = 20) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

async function names(numbers) {
  const species = await inBatches(numbers, (n) => get(`pokemon-species/${n}/`))
  return Object.fromEntries(
    species.map((s) => [s.id, { en: s.names.find((x) => x.language.name === 'en').name, fr: s.names.find((x) => x.language.name === 'fr').name }]),
  )
}

async function lines(from, to) {
  const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const species = await inBatches(numbers, (n) => get(`pokemon-species/${n}/`))
  const chains = new Map()
  for (const s of species) chains.set(s.evolution_chain.url, null)
  for (const url of chains.keys()) chains.set(url, await get(url))
  const all = []
  const walk = (link, depth, out) => {
    out.push([depth, idOf(link.species.url), link.species.name])
    for (const next of link.evolves_to) walk(next, depth + 1, out)
  }
  for (const chain of chains.values()) {
    const members = []
    walk(chain.chain, 0, members)
    all.push(members)
  }
  all.sort((a, b) => Math.min(...a.map((m) => m[1])) - Math.min(...b.map((m) => m[1])))
  for (const members of all) {
    const text = members.map(([depth, id, name]) => `${'>'.repeat(depth)}${name} ${id}${id < from || id > to ? '*' : ''}`).join('  ')
    console.log(members.length === 1 ? `solo  ${text}` : `chain ${text}`)
  }
  console.log('(* = outside the range)')
  saveCache()
}

const KEPT_METHODS = ['walk', 'surf', 'super-rod', 'static', 'only-one', 'squirt-bottle', 'wailmer-pail', 'devon-scope', 'seaweed', 'feebas-tile-fishing']

async function encounters(regionId, versions) {
  const region = await get(`region/${regionId}/`)
  const byLocation = new Map()
  const methods = new Set()
  for (const { url } of region.locations) {
    const location = await get(url)
    const found = new Set()
    for (const area of await inBatches(location.areas, (a) => get(a.url))) {
      for (const encounter of area.pokemon_encounters) {
        for (const detail of encounter.version_details) {
          if (!versions.includes(detail.version.name)) continue
          for (const { method } of detail.encounter_details) {
            methods.add(method.name)
            if (KEPT_METHODS.includes(method.name)) found.add(idOf(encounter.pokemon.url))
          }
        }
      }
    }
    if (found.size) byLocation.set(location.name, [...found].sort((a, b) => a - b))
  }
  const byList = new Map()
  for (const [name, list] of byLocation) {
    const key = list.join(', ')
    byList.set(key, [...(byList.get(key) ?? []), name])
  }
  for (const [list, places] of byList) console.log(`${places.join(' + ')}: [${list}]`)
  console.log(`methods seen: ${[...methods].join(', ')} (kept: ${KEPT_METHODS.join(', ')})`)
  saveCache()
}

async function cards(pattern) {
  const { config } = await import('dotenv')
  const { createClient } = await import('@supabase/supabase-js')
  config({ path: path.join(root, 'scripts/.env.local') })
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const regex = new RegExp(pattern)
  const found = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('cards').select('name, set_id').order('id').range(from, from + 999)
    if (error) throw error
    for (const card of data) if (regex.test(card.name)) found.set(card.name, [...(found.get(card.name) ?? []), card.set_id])
    if (data.length < 1000) break
  }
  for (const [name, sets] of [...found].sort()) console.log(`${name}  (${sets.join(', ')})`)
}

const join = (list, lang) => (list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')}${lang === 'en' ? ' and ' : ' et '}${list.at(-1)}`)
const startsWithVowel = (name) => /^[AEIOUYÉÈÊH]/i.test(name)

async function texts(regionName) {
  const { default: region } = await import(path.join(root, `src/utils/${regionName}.js`))
  const numbers = new Set()
  const groups = { lines: region.lines, places: { ...region.routes, ...region.landmarks } }
  for (const map of Object.values(groups)) for (const list of Object.values(map)) list.forEach((n) => numbers.add(n))
  const named = await names([...numbers])
  const kebab = (id) => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  const placeNames = {}
  for (const id of Object.keys(groups.places)) {
    const location = await get(`location/${kebab(id)}/`).catch(() => null)
    if (location) placeNames[id] = Object.fromEntries(location.names.filter((n) => ['en', 'fr'].includes(n.language.name)).map((n) => [n.language.name, n.name]))
  }
  const nameList = (list, lang) => join(list.map((n) => named[n][lang]), lang)
  for (const lang of ['en', 'fr']) {
    const file = path.join(root, `src/i18n/locales/${lang}.json`)
    const locale = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { items, desc } = locale.achievements
    let added = 0
    const add = (id, title, text) => {
      if (title && !items[id]) (items[id] = { title }), added++
      if (text && !desc.groups[id]) (desc.groups[id] = text), added++
    }
    for (const [id, list] of Object.entries(region.lines)) {
      const last = named[list.at(-1)][lang]
      add(
        id,
        lang === 'en' ? `${last} line` : startsWithVowel(last) ? `Lignée d’${last}` : `Lignée de ${last}`,
        lang === 'en' ? `Own the whole line: ${nameList(list, lang)}` : `Possède toute la lignée : ${nameList(list, lang)}`,
      )
    }
    for (const [id, list] of Object.entries(groups.places)) {
      const route = id.match(/^route(\d+)(?:(and|to)(\d+))?$/)
      const link = { and: { en: 'and', fr: 'et' }, to: { en: 'to', fr: 'à' } }[route?.[2]]?.[lang]
      const title = route ? (link ? `Routes ${route[1]} ${link} ${route[3]}` : `Route ${route[1]}`) : placeNames[id]?.[lang]
      const games = region.games[lang]
      add(id, title, lang === 'en' ? `Own the Pokémon found there in ${games}: ${nameList(list, lang)}` : `Possède les Pokémon qu’on y trouve dans ${games} : ${nameList(list, lang)}`)
    }
    fs.writeFileSync(file, JSON.stringify(locale, null, 2) + '\n')
    console.log(`${lang}: ${added} texts added`)
  }
  const missing = Object.keys({ ...region.lines, ...groups.places }).filter((id) => !JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/en.json'), 'utf8')).achievements.items[id])
  if (missing.length) console.log(`still without a title (write them by hand): ${missing.join(', ')}`)
  saveCache()
}

const [command, ...args] = process.argv.slice(2)
const commands = {
  lines: () => lines(Number(args[0]), Number(args[1])),
  encounters: () => encounters(args[0], args[1].split(',')),
  cards: () => cards(args[0]),
  texts: () => texts(args[0]),
}
if (!commands[command]) {
  console.error('Usage: node scripts/region-tools.mjs lines <from> <to> | encounters <region id> <versions> | cards <regex> | texts <region>')
  process.exit(1)
}
await commands[command]()
