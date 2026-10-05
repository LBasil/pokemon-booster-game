// Ability texts (pokemontcg.io, English: Abilities, Poké-Powers, Poké-Bodies,
// Pokémon Powers) -> what the PvP engine plays (migration 0033, `pvp_ability`
// and the passive mods in SQL). scripts/populate.mjs stores the result in
// cards.abilities[i] = { name, text, type, kind, fx, coins, playable }.
//
// Like Pokémon TCG Pocket (user, 2026-10-05: "ajoute les talents stp"):
//   kind 'active'    "Once during your turn, you may ...": I use it from the
//                    board, once a turn per Pokémon (`many`: as often as I
//                    like), `active_only`: only from the Active Spot.
//   kind 'passive'   always on: body_* ops (like a Tool's tool_* ops).
//   kind 'on_bench'  "When you play this Pokémon from your hand onto your
//                    Bench, you may ...": played as I bench it.
//   kind 'on_evolve' "When you play this Pokémon from your hand to evolve
//                    ...": played as I evolve with it.
// An ability is playable only when every sentence is understood. Its
// effects are the Trainers' ops (trainerEffects.js), plus:
//   heal (who 'self')   heal n from this Pokémon
//   switch_in           this Pokémon (Benched) becomes the Active (`bench_only`:
//                       only usable from the Bench)
//   switch_self         also "switch this Pokémon with 1 of your Benched"
//   counters            n damage (counters x 10) on 1 of their Pokémon (`who`
//                       'one': I pick, 'active'), no Weakness / Resistance
//   self_ko             this Pokémon is knocked out
//   once                once a game (VSTAR Powers)
//   needs_no_status     not while this Pokémon has a Special Condition
//   end_turn            my turn ends
// Passive (body_*): body_reduce (n less damage from attacks), body_boost
// (its attacks n more on their Active), body_retreat (retreat cost n less,
// 'all' = none), body_retaliate (n on the attacker when damaged as Active),
// body_no_weakness, body_no_status (no Special Conditions), body_heal_end,
// body_bench_protect (no damage from attacks while Benched), body_sturdy
// (full HP: survives a knock out with n HP), body_fast_evolve (evolves on
// my first turn or the turn it's played), body_team_basic_retreat (my Basic
// Pokémon in play have no retreat cost).

import { sentences } from './attackEffects.js'
import { parseEffectSentence } from './trainerEffects.js'

const NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
const count = (word) => NUMBER[word?.toLowerCase()] ?? Number(word)

// Bookkeeping that changes nothing here
const IGNORED = [
  /^\(you still need the necessary energy to use each attack\.\)$/,
  /^\(damage is not an effect\.\)$/,
  /^\(don't apply weakness and resistance\.\)$/,
  /^\(any other effects of attacks still happen\.\)$/,
  /^\(your opponent chooses the new active pokémon\.\)$/,
  /^(?:then, )?shuffle your deck(?: afterward)?\.$/,
  /^you can't use more than 1 .+ (?:ability|poké-power|pokémon power) each turn\.$/,
]

function normalize(sentence, name) {
  let s = sentence.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
  // "Pikachu" in its own text = this Pokémon
  if (name) s = s.split(name.toLowerCase()).join('this pokémon')
  return s
    .replace(/your opponent's active pokémon|the defending pokémon/g, 'opp')
    .replace(/this pokémon/g, 'self')
    .replace(/\bone of\b/g, '1 of')
}

/** Ability-only sentences (normalized) -> ops, null if unknown; else the Trainers' parser. */
function parseSentence(s, ctx) {
  let m
  if (IGNORED.some((re) => re.test(s))) return []
  if (/^\(you can't use more than 1 vstar power in a game\.\)$/.test(s)) return [{ op: 'once' }]
  if (/^if you use this (?:ability|power), your turn ends\.$/.test(s)) return [{ op: 'end_turn' }]
  if (/^if you use this ability, self is knocked out\.$/.test(s)) return [{ op: 'self_ko' }]
  if (/^(?:this power|you) can't (?:be used|use this power) if self is (?:affected by a special condition|asleep, confused, or paralyzed)\.$/.test(s))
    return [{ op: 'needs_no_status' }]
  if ((m = s.match(/^you must discard (a card|(\w+) cards) from your hand in order to use this ability\.$/))) return [{ op: 'discard_cost', n: m[2] ? count(m[2]) : 1 }]
  if (/^your basic pokémon in play have no retreat cost\.$/.test(s)) return [{ op: 'body_team_basic_retreat' }]

  // Self
  if ((m = s.match(/^heal (\d+) damage from self\.$/))) return [{ op: 'heal', n: Number(m[1]), who: 'self' }]
  if (/^heal all damage from self\.$/.test(s)) return [{ op: 'heal', n: 'all', who: 'self' }]
  if (/^switch self with (?:1|one) of your benched pokémon\.$/.test(s)) return [{ op: 'switch_self' }]
  if (/^(?:you may )?switch it with your active pokémon\.$/.test(s) && ctx.kind === 'on_bench') return [{ op: 'switch_in' }]
  if (/^switch self with your active pokémon\.$/.test(s)) return [{ op: 'switch_in' }]

  // Damage counters
  if ((m = s.match(/^put (\w+) damage counters? on (1 of your opponent's pokémon|opp)\.$/)))
    return [{ op: 'counters', n: 10 * count(m[1]), who: m[2] === 'opp' ? 'active' : 'one' }]

  // Passive
  if ((m = s.match(/^self takes (\d+) less damage from (?:your opponent's )?attacks(?: \(after applying weakness and resistance\))?\.$/)))
    return [{ op: 'body_reduce', n: Number(m[1]) }]
  if ((m = s.match(/^any damage done to self by (?:your opponent's )?attacks is reduced by (\d+)(?: \(after applying weakness and resistance\))?\.$/)))
    return [{ op: 'body_reduce', n: Number(m[1]) }]
  if ((m = s.match(/^self's attacks do (\d+) more damage to opp(?: \(before applying weakness and resistance\))?\.$/)))
    return [{ op: 'body_boost', n: Number(m[1]) }]
  if (/^self has no retreat cost\.$/.test(s)) return [{ op: 'body_retreat', n: 'all' }]
  if ((m = s.match(/^self's retreat cost is (\w+)(?: colorless)?(?: energy)? less\.$/))) return [{ op: 'body_retreat', n: count(m[1]) || 1 }]
  if (/^self has no weakness\.$/.test(s)) return [{ op: 'body_no_weakness' }]
  if (/^self can't be affected by any special conditions\.$/.test(s)) return [{ op: 'body_no_status' }]
  if ((m = s.match(/^if self is (?:your active pokémon|in the active spot) and is damaged by (?:an opponent's attack|an attack from your opponent's pokémon) \(even if self is knocked out\), put (\w+) damage counters? on the attacking pokémon\.$/)))
    return [{ op: 'body_retaliate', n: 10 * count(m[1]) }]
  if ((m = s.match(/^at any time between turns, heal (\d+) damage from self\.$/))) return [{ op: 'body_heal_end', n: Number(m[1]) }]
  if (/^as long as self is on your bench, prevent all damage done to self by attacks \(both yours and your opponent's\)\.$/.test(s))
    return [{ op: 'body_bench_protect' }]
  if ((m = s.match(/^if self has full hp and would be knocked out by damage from an attack, it is not knocked out, and its remaining hp becomes (\d+)\.$/)))
    return [{ op: 'body_sturdy', n: Number(m[1]) }]
  if (/^self can evolve during your first turn or the turn you play it\.$/.test(s)) return [{ op: 'body_fast_evolve' }]

  // Anything a Trainer could do (draw, search, heal 1 of your Pokémon, gust...)
  return parseEffectSentence(s, ctx)
}

/** Where the ability starts: its kind and the rest of the first sentence. */
function opening(s) {
  let m
  if ((m = s.match(/^once during your turn(?: \(before your attack\))?, (?:if self is (in the active spot|your active pokémon|on your bench), )?you may (.+)$/)))
    return { kind: 'active', rest: m[2], active_only: !!m[1] && !m[1].includes('bench'), bench_only: !!m[1]?.includes('bench') }
  if ((m = s.match(/^as often as you like during your turn(?: \(before your attack\))?, you may (.+)$/))) return { kind: 'active', rest: m[1], many: true }
  if ((m = s.match(/^when you play self from your hand onto your bench(?: during your turn)?, you may (.+)$/))) return { kind: 'on_bench', rest: m[1] }
  if ((m = s.match(/^when you play self from your hand to evolve (?:1|one) of your pokémon(?: during your turn)?, you may (.+)$/))) return { kind: 'on_evolve', rest: m[1] }
  return null
}

/**
 * Parses one ability.
 * @param {{ name?: string, text?: string }} ability
 * @param {string} [cardName] - the Pokémon's name (old texts say "Pikachu" for "this Pokémon")
 * @returns {{ kind: string | null, fx: object[], coins: number | 'until' | null, playable: boolean, active_only?: boolean, many?: boolean, unknown: string[] }}
 */
export function parseAbility(ability, cardName) {
  const fx = []
  const unknown = []
  const ctx = { coins: null, fx, kind: null }
  let kind = null
  const extra = {}
  for (const raw of sentences(ability?.text)) {
    let s = normalize(raw, cardName)
    if (!kind) {
      const open = opening(s)
      if (open) {
        kind = ctx.kind = open.kind
        if (open.active_only) extra.active_only = true
        if (open.bench_only) extra.bench_only = true
        if (open.many) extra.many = true
        if (/^use this (?:ability|power)\.$/.test(open.rest)) continue
        s = open.rest
      }
    }
    const ops = parseSentence(s, ctx)
    if (ops?.some((op) => op.op === 'discard_cost')) ctx.lastCost = true
    if (ops) fx.push(...ops)
    else unknown.push(raw)
  }
  if (!kind && fx.length && fx.every((op) => op.op.startsWith('body_'))) kind = 'passive'
  const acts = fx.filter((op) => !['once', 'needs_no_status', 'end_turn', 'discard_cost', 'self_ko'].includes(op.op))
  const body = fx.some((op) => op.op.startsWith('body_'))
  const fits = kind === 'passive' ? acts.length > 0 : kind !== null && acts.length > 0 && !body
  return { kind, fx, coins: ctx.coins, playable: fits && unknown.length === 0, unknown, ...extra }
}

/** What populate.mjs stores for each ability of a card. */
export function abilityData(ability, cardName) {
  const { kind, fx, coins, playable, active_only, bench_only, many } = parseAbility(ability, cardName)
  return {
    name: ability.name, text: ability.text ?? '', type: ability.type ?? '', kind, fx, coins, playable,
    ...(active_only && { active_only }), ...(bench_only && { bench_only }), ...(many && { many }),
  }
}
