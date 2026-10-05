// Trainer card texts (pokemontcg.io `rules`, English) -> effects the PvP
// engine plays (migration 0032, `pvp_trainer` in SQL). scripts/populate.mjs
// stores the result in cards.trainer = { kind, fx, coins, playable }.
//
// Like Pokémon TCG Pocket (user, 2026-10-05: "fais comme Pocket mais avec
// nos cartes bien sûr"): Items as many as I like, 1 Supporter a turn,
// Pokémon Tools attached (1 per Pokémon). Stadiums, Technical Machines,
// fossils played as Pokémon... aren't played. A Trainer is playable only when
// every sentence of its text is understood (`unknown` empty) and it does
// something: half a Trainer would be a lie (attacks are kept when partial,
// their damage still counts; a Trainer has nothing else).
//
// Ops (n = an amount of damage, a number of cards or of energies):
//   draw              draw n cards
//   draw_until        draw until I have n cards in hand
//   discard_hand_draw discard my hand, draw n
//   shuffle_hand_draw shuffle my hand into my deck, draw n
//   opp_shuffle_draw  my opponent shuffles their hand into their deck, draws n
//   each_shuffle_draw both players shuffle their hand into their deck, draw n
//   search            put n cards of my deck into my hand or onto my Bench:
//                     `what` 'basic' | 'pokemon' | 'evolution' | 'card',
//                     `to` 'hand' | 'bench'
//   heal              heal n from `who`: 'one' (I pick) | 'active' | 'all';
//                     n = 'all' = all damage
//   discard_energy_healed  discard all energy from the healed Pokémon (Max Potion)
//   cure              remove all special conditions from my Active Pokémon
//   switch_self       switch my Active Pokémon with 1 of my Benched (I pick)
//   gust              switch 1 of their Benched (I pick) with their Active
//   opp_switch        they switch their Active with 1 of their Benched (they pick)
//   boost             this turn, my attacks do n more to their Active
//   shield            during their next turn, my Pokémon take n less damage
//   retreat_less      this turn, my Active's retreat cost is n less ('all' = free)
//   discard_opp_energy  discard n energy from their Active Pokémon
//   move_energy_own   move an energy from 1 of my Pokémon to another (I pick both)
//   status            their Active Pokémon is now `status`
//   rare_candy        a Stage 2 from my hand onto its Basic (skipping the Stage 1)
//   draw_heads        draw 1 card per heads (`coins` N or 'until')
//   each_bottom_draw  both hands to the bottom of their deck, I draw n, they draw `opp`
//   search_top        look at the top `top` cards, take n matching (`discard_rest`: the others are discarded)
//   recover           n cards of my discard pile (`what`) into my hand or deck (`to`)
//   scoop             1 of my Pokémon (`basic`: a Basic one) and its cards back to my hand
//   discard_cost      first discard n cards from my hand (I pick)
//   no_more_trainers  no more Trainers this turn
//   end_turn          my turn ends
//   first_turn_ok     a Supporter I may play on my first turn even going first
//   tool_hp / tool_reduce / tool_retaliate / tool_retreat / tool_boost /
//   tool_no_weakness / tool_heal_end
//                     a Tool on that Pokémon: +n HP, n less damage taken,
//                     n to the attacker when hit while Active, retreat cost n
//                     less ('all' = none), its attacks n more on their Active,
//                     no Weakness, heal n at the end of my turn when Active
//
// Search filters (search, search_top, recover): `what` 'basic' | 'pokemon' |
// 'evolution' | 'card' | 'supporter' | 'item' | 'tool' | 'trainer', `type`,
// `max_hp`, `no_rule_box`.
//
// A coin before an op: `if: 'heads'` ("Flip a coin. If heads, ...").

import { sentences } from './attackEffects.js'

const STATUSES = ['asleep', 'paralyzed', 'confused', 'poisoned', 'burned']
const NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
const count = (word) => NUMBER[word?.toLowerCase()] ?? Number(word)

// Rule reminders and deck bookkeeping that change nothing in our battles
const IGNORED = [
  /^you may play (?:only (?:1|one)|as many|any number of) (?:supporter|item|stadium)(?: cards?)?.*$/,
  /^you can play only one supporter card each turn\.$/,
  /^you may attach (?:any number of|only (?:1|one)) pokémon tools?.*$/,
  /^attach a pokémon tool to (?:1|one) of your pokémon that doesn't already have a pokémon tool attached(?: to it)?\.$/,
  /^attach (?:1|one) pokémon tool to (?:1|one) of your pokémon.*$/,
  /^(?:then, )?shuffle your deck(?: afterward)?\.$/,
  /^(?:then, )?that player shuffles (?:their|his or her) deck\.$/,
  /^\(pokémon ex, pokémon v, etc\. have rule boxes\.\)$/,
  /^\(this counts as evolving that pokémon\.\)$/,
  /^you can't have more than 1 ace spec card in your deck\.$/,
  /^ace spec: you can't have more than 1 ace spec card in your deck\.$/,
  /^this card stays attached to.*$/,
  /^if this card is attached to.*knocked out.*discard this card\.$/,
  /^reveal (?:it|them)(?:,| and)? (?:and )?put (?:it|them) into your hand\.$/,
  /^\(you can't (?:use|play) more than 1 ace spec.*\)$/,
  // Supporters of the EX / DP era: "put it next to your Active Pokémon"
  /^when you play this card, put it next to your active pokémon\.$/,
  /^when your turn ends, discard this card\.$/,
  /^\(if you can't discard \w+ cards?, you can't play this card\.\)$/,
  /^\(you must discard at least \w+ cards?\.\)$/,
  /^shuffle the other cards (?:back )?into your deck\.$/,
]

// Not played in our battles: Stadiums, Technical Machines, Rocket's Secret
// Machines, fossils played as a Pokémon...
const KINDS = { Item: 'item', Supporter: 'supporter', 'Pokémon Tool': 'tool', Stadium: 'stadium' }

/** A Trainer's kind from its subtypes: 'tool' | 'supporter' | 'item' | 'stadium' | 'other'. */
export function trainerKind(subtypes = []) {
  if (subtypes.includes('Pokémon Tool')) return 'tool'
  if (subtypes.includes('Technical Machine') || subtypes.includes("Rocket's Secret Machine")) return 'other'
  for (const [subtype, kind] of Object.entries(KINDS)) if (subtypes.includes(subtype)) return kind
  // Base Set to Neo: Trainers had no subtype, they played like Items
  return subtypes.length ? 'other' : 'item'
}

const TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'fairy', 'dragon', 'colorless']

/**
 * What a search looks for, from its words: "Basic Pokémon", "Water Pokémon",
 * "Pokémon with 90 HP or less", "Pokémon that doesn't have a Rule Box",
 * "Supporter card", "Evolution Pokémon", "card"... null if unknown.
 */
function parseWhat(phrase) {
  let m
  const p = phrase.replace(/ cards?$/, ' card').trim()
  if (/^cards?$/.test(p)) return { what: 'card' }
  if (/^evolution card$/.test(p)) return { what: 'evolution' }
  if ((m = p.match(/^(supporter|item|trainer|pokémon tool) card$/))) return { what: { supporter: 'supporter', item: 'item', trainer: 'trainer', 'pokémon tool': 'tool' }[m[1]] }
  m = p.match(/^(basic |evolution |stage (?:1|2) )?(?:(\w+) )?pokémon( card)?(?: with (\d+) hp or less)?( that doesn't have a rule box)?$/)
  if (!m) return null
  if (m[2] && !TYPES.includes(m[2])) return null
  const stage = m[1]?.trim()
  const filter = { what: stage === 'basic' ? 'basic' : stage === 'evolution' || stage?.startsWith('stage') ? 'evolution' : 'pokemon' }
  if (m[2]) filter.type = m[2].charAt(0).toUpperCase() + m[2].slice(1)
  if (m[4]) filter.max_hp = Number(m[4])
  if (m[5]) filter.no_rule_box = true
  return filter
}

function normalize(sentence) {
  return sentence
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/your opponent's active pokémon|the defending pokémon/g, 'opp')
    .replace(/\bone of\b/g, '1 of')
    .replace(/\bup to one\b/g, 'up to 1')
    .replace(/the pokémon this card is attached to/g, 'holder')
    .replace(/\bhis or her\b/g, 'their')
    .replace(/(\d+) of your active pokémon/g, 'your active pokémon')
}

/** One normalized sentence -> ops, null if unknown. `ctx` holds the coin and what was healed. */
function parseSentence(s, ctx) {
  let m
  if (IGNORED.some((re) => re.test(s))) return []

  // Coins
  if (s === 'flip a coin.') return (ctx.coins = 1), []
  if ((m = s.match(/^flip a coin\. if heads, (.+)$/))) s = `if heads, ${m[1]}`
  if ((m = s.match(/^then, draw a card for each card in your opponent's hand\.$/)) && ctx.shuffled === 'self') return (ctx.shuffled = null), [{ op: 'shuffle_hand_draw', n: 'opp_hand' }]
  // Pokémon Breeder-like: a Stage 1 or 2 from my hand straight onto its Basic
  if (ctx.candy && /^if you have a stage 1 or stage 2 card that evolves from that pokémon in your hand, put that card on the basic pokémon\.$/.test(s))
    return [{ op: 'rare_candy' }]
  if ((m = s.match(/^if heads, (.+)$/))) {
    ctx.coins = 1
    const inner = parseSentence(m[1], ctx)
    return inner && inner.map((op) => ({ ...op, if: 'heads' }))
  }

  // A cost: discard cards from my hand first (I pick them)
  if ((m = s.match(/^(?:you can (?:play|use) this card only if you discard (\w+) other cards? from your hand|discard (\w+) cards? from your hand|discard (\w+) of the other cards in your hand in order to play this card)\.$/)))
    return [{ op: 'discard_cost', n: count(m[1] ?? m[2] ?? m[3]) }]
  if (/^you can (?:play|use) this card only if you discard another card from your hand\.$/.test(s)) return [{ op: 'discard_cost', n: 1 }]
  if ((m = s.match(/^if you do, (.+)$/)) && ctx.lastCost !== undefined) return parseSentence(m[1], ctx)

  // Drawing
  if ((m = s.match(/^(?:then, )?draw (\w+) cards\.$/)) && ctx.shuffled === 'self') return (ctx.shuffled = null), [{ op: 'shuffle_hand_draw', n: count(m[1]) }]
  if ((m = s.match(/^(?:then, )?draw (a card|(\w+) cards)\.$/))) return [{ op: 'draw', n: m[2] ? count(m[2]) : 1 }]
  if ((m = s.match(/^(?:if you do, |then, )?draw cards (?:from your deck )?until you have (\w+) cards in your hand\.$/))) return [{ op: 'draw_until', n: count(m[1]) }]
  if ((m = s.match(/^if it's your first turn, draw cards until you have (\w+) cards in your hand\.$/))) {
    const until = [...ctx.fx].reverse().find((op) => op.op === 'draw_until')
    return until ? ((until.first = count(m[1])), []) : null
  }
  if ((m = s.match(/^discard your hand(?: and|, then) draw (\w+) cards\.$/))) return [{ op: 'discard_hand_draw', n: count(m[1]) }]
  if (/^shuffle your hand into your deck\.$/.test(s)) return (ctx.shuffled = 'self'), []
  if (s === 'flip a coin until you get tails.') return (ctx.coins = 'until'), []
  if ((m = s.match(/^flip (\w+) coins\.$/))) return (ctx.coins = count(m[1])), []
  if (ctx.coins && /^for each heads, draw a card\.$/.test(s)) return [{ op: 'draw_heads' }]
  if (/^each player shuffles their hand and puts it on the bottom of their deck\.$/.test(s)) return (ctx.bottom = true), []
  if (ctx.bottom && (m = s.match(/^if either player put any cards on the bottom of their deck in this way, you draw (\w+) cards, and your opponent draws (\w+) cards\.$/)))
    return [{ op: 'each_bottom_draw', n: count(m[1]), opp: count(m[2]) }]
  if (/^you can't play any more trainer cards this turn\.$/.test(s)) return [{ op: 'no_more_trainers' }]
  if (/^your turn ends\.$/.test(s)) return [{ op: 'end_turn' }]
  if ((m = s.match(/^shuffle your hand into your deck(?:\.|,)? (?:then |and )draw (\w+) cards\.$/))) return [{ op: 'shuffle_hand_draw', n: count(m[1]) }]
  if ((m = s.match(/^your opponent shuffles (?:their|his or her) hand into (?:their|his or her) deck and draws (\w+) cards\.$/)))
    return [{ op: 'opp_shuffle_draw', n: count(m[1]) }]
  if ((m = s.match(/^each player shuffles (?:their|his or her) hand into (?:their|his or her) deck and draws (\w+) cards\.$/)))
    return [{ op: 'each_shuffle_draw', n: count(m[1]) }]

  // Searching the deck ("a Water Pokémon and an Item card" = two searches)
  if ((m = s.match(/^search your deck for (.+?)(?:,? (?:reveal|show) (?:it|them)(?: to your opponent)?,)? and put (?:it|them) (into your hand|onto your bench)\.$/))) {
    const to = m[2] === 'into your hand' ? 'hand' : 'bench'
    const ops = []
    for (const part of m[1].split(/ and (?=an? |up to )/)) {
      const one = part.match(/^(?:up to (\w+)|a|an) (.+)$/)
      const filter = one && parseWhat(one[2])
      if (!filter || (to === 'bench' && filter.what !== 'basic')) return null
      ops.push({ op: 'search', ...filter, n: one[1] ? count(one[1]) : 1, to })
    }
    return ops
  }
  if ((m = s.match(/^search your deck for (?:up to (\w+)|a|an) (.+?)\.$/)) && parseWhat(m[2])) {
    ctx.search = { ...parseWhat(m[2]), n: m[1] ? count(m[1]) : 1 }
    return []
  }
  // Looking at the top of the deck
  if ((m = s.match(/^look at the top (\w+) cards of your deck\.$/))) return (ctx.top = count(m[1])), []
  if (ctx.top && (m = s.match(/^you may reveal (?:a|an) (.+?) you find there and put it into your hand\.$/)) && parseWhat(m[1]))
    return [{ op: 'search_top', ...parseWhat(m[1]), n: 1, top: ctx.top }]
  if ((m = s.match(/^look at the top (\w+) cards of your deck and put (\w+) of them into your hand\.$/)))
    return [{ op: 'search_top', what: 'card', n: count(m[2]), top: count(m[1]) }]
  if (/^discard the other cards?\.$/.test(s)) {
    const top = [...ctx.fx].reverse().find((op) => op.op === 'search_top')
    return top ? ((top.discard_rest = true), []) : null
  }
  if (/^if you go first, you may (?:use|play) this card during your first turn\.$/.test(s)) return [{ op: 'first_turn_ok' }]
  // The discard pile
  if ((m = s.match(/^(put|shuffle) (?:up to (\w+)|a|an|(\w+)) (pokémon|supporter cards?|basic pokémon) from your discard pile into your (hand|deck)\.$/))) {
    const what = m[4].startsWith('supporter') ? 'supporter' : m[4] === 'basic pokémon' ? 'basic' : 'pokemon'
    return [{ op: 'recover', what, n: count(m[2] ?? m[3] ?? 'a'), to: m[5] }]
  }
  if ((m = s.match(/^shuffle (\w+) in any combination of pokémon and basic energy cards from your discard pile into your deck\.$/)))
    return [{ op: 'recover', what: 'pokemon', n: count(m[1]), to: 'deck' }]
  if (ctx.search && /^(?:reveal (?:it|them),? and )?put (?:it|them) (?:into your hand|onto your bench)\.$/.test(s)) {
    const to = s.includes('bench') ? 'bench' : 'hand'
    if (to === 'bench' && ctx.search.what !== 'basic') return null
    const op = { op: 'search', ...ctx.search, to }
    ctx.search = null
    return [op]
  }

  // Healing
  if ((m = s.match(/^heal (\d+|all) damage from (1 of your pokémon|your active pokémon|each of your pokémon)\.$/))) {
    const who = m[2].startsWith('1 of') ? 'one' : m[2].startsWith('your active') ? 'active' : 'all'
    return [{ op: 'heal', n: m[1] === 'all' ? 'all' : Number(m[1]), who }]
  }
  if ((m = s.match(/^remove (\w+) damage counters? from (1 of your pokémon|each of your pokémon(?: that has any damage counters on it)?)(?: \(.*\))?\.$/)))
    return [{ op: 'heal', n: 10 * count(m[1]), who: m[2].startsWith('1 of') ? 'one' : 'all' }]
  if ((m = s.match(/^heal (\d+) damage from 1 of your pokémon, and it recovers from all special conditions\.$/)))
    return [{ op: 'heal', n: Number(m[1]), who: 'one' }, { op: 'cure', who: 'healed' }]
  if ((m = s.match(/^(?:if you do|if you healed any damage in this way|then), discard (an|all) energy (?:cards? )?(?:attached to|from) (?:that|the healed) pokémon\.$/)))
    return [{ op: 'discard_energy_healed', n: m[1] === 'all' ? 'all' : 1 }]
  if (/^remove all special conditions from (?:your active pokémon|each of your active pokémon)\.$/.test(s)) return [{ op: 'cure' }]
  if ((m = s.match(/^heal (\d+) damage and remove all special conditions from 1 of your pokémon\.$/)))
    return [{ op: 'heal', n: Number(m[1]), who: 'one' }, { op: 'cure', who: 'healed' }]
  // Scoop up: a Pokémon in play and its cards back to my hand
  if ((m = s.match(/^(?:return|put) 1 of your (basic )?pokémon and all (?:cards attached to it|attached cards) (?:to|into) your hand\.$/)))
    return [{ op: 'scoop', basic: !!m[1] }]
  if ((m = s.match(/^your active pokémon (?:recovers from all special conditions|is no longer \w+)\.$/))) return [{ op: 'cure' }]

  // Switching
  if (/^(?:if you do, )?switch your active pokémon with (?:1|one) of your benched pokémon\.$/.test(s)) return [{ op: 'switch_self' }]
  if (/^switch in (?:1|one) of your opponent's benched pokémon to the active spot\.$/.test(s)) return [{ op: 'gust' }]
  if (/^each player switches their active pokémon with 1 of their benched pokémon\.$/.test(s)) return [{ op: 'opp_switch' }, { op: 'switch_self' }]
  if (/^your opponent switches first\.$|^\(if a player does not have a benched pokémon, that player doesn't switch pokémon\.\)$/.test(s)) return []
  if (/^switch (?:1|one) of your opponent's benched pokémon with (?:their|his or her|your opponent's) active pokémon\.$/.test(s))
    return [{ op: 'gust' }]
  if (/^choose (?:1|one) of your opponent's benched pokémon and switch it with (?:their|his or her|your opponent's) active pokémon\.$/.test(s))
    return [{ op: 'gust' }]
  if (/^your opponent switches (?:opp|their active pokémon|his or her active pokémon) with (?:1|one) of (?:their|his or her) benched pokémon\.$/.test(s))
    return [{ op: 'opp_switch' }]

  // This turn / their next turn
  if ((m = s.match(/^during this turn, your pokémon's attacks do (\d+) more damage to opp(?: \(before applying weakness and resistance\))?\.$/)))
    return [{ op: 'boost', n: Number(m[1]) }]
  if ((m = s.match(/^during your opponent's next turn, (?:all of your pokémon take|damage done to (?:all of )?your pokémon by attacks is reduced by) (\d+)(?: less damage from attacks| less damage)?(?: \(after applying weakness and resistance\))?\.$/)))
    return [{ op: 'shield', n: Number(m[1]) }]
  if ((m = s.match(/^during this turn, the retreat cost of your active pokémon is (\d+|colorless|\w+) less\.$/)))
    return [{ op: 'retreat_less', n: count(m[1]) || 1 }]
  if (/^during this turn, your active pokémon has no retreat cost\.$/.test(s)) return [{ op: 'retreat_less', n: 'all' }]

  // Energy
  if ((m = s.match(/^discard (an|\d+) energy (?:card )?(?:from|attached to) opp\.$/))) return [{ op: 'discard_opp_energy', n: count(m[1]) }]
  if (/^(?:choose (?:1|one) energy card attached to (?:1|one) of your opponent's pokémon and discard it|discard an energy (?:card )?(?:from|attached to) (?:1|one) of your opponent's pokémon)\.$/.test(s))
    return [{ op: 'discard_opp_energy', n: 1, who: 'one' }]
  if (/^move (?:a basic energy(?: card)?|an energy(?: card)?) (?:from|attached to) (?:1|one) of your pokémon to another of your pokémon\.$/.test(s)) return [{ op: 'move_energy_own' }]

  // Their Active Pokémon
  if ((m = s.match(/^opp is now (\w+)\.$/)) && STATUSES.includes(m[1])) return [{ op: 'status', status: m[1] }]

  // Rare Candy
  if (/^choose (?:1|one) of your basic pokémon in play\.$/.test(s)) return (ctx.candy = true), []
  if (ctx.candy && /^if you have a stage 2 card in your hand that evolves from that pokémon, put that card onto the basic pokémon to evolve it(?:, skipping the stage 1)?\.$/.test(s))
    return [{ op: 'rare_candy' }]
  if (ctx.candy && /^you can't use this card during your first turn or on a basic pokémon that was put into play this turn\.$/.test(s)) return []

  // Pokémon Tools
  if ((m = s.match(/^holder gets \+(\d+) hp\.$/))) return [{ op: 'tool_hp', n: Number(m[1]) }]
  if ((m = s.match(/^holder takes (\d+) less damage from (?:your opponent's )?attacks(?: \(after applying weakness and resistance\))?\.$/)))
    return [{ op: 'tool_reduce', n: Number(m[1]) }]
  if ((m = s.match(/^any damage done to holder by (?:your opponent's )?attacks is reduced by (\d+)(?: \(after applying weakness and resistance\))?\.$/)))
    return [{ op: 'tool_reduce', n: Number(m[1]) }]
  if ((m = s.match(/^if holder is (?:in the active spot|(?:your )?active pokémon) and is damaged by an attack (?:from|of) your opponent's pokémon \(even if (?:holder|it) is knocked out\), put (\d+) damage counters? on the attacking pokémon\.$/)))
    return [{ op: 'tool_retaliate', n: 10 * Number(m[1]) }]
  if (/^holder has no retreat cost\.$/.test(s)) return [{ op: 'tool_retreat', n: 'all' }]
  if (/^holder has no weakness\.$/.test(s)) return [{ op: 'tool_no_weakness' }]
  if ((m = s.match(/^at the end of your turn, if holder is (?:in the active spot|your active pokémon), heal (\d+) damage from it\.$/)))
    return [{ op: 'tool_heal_end', n: Number(m[1]) }]
  // PlusPower (Base Set): attached for this turn, +n on my attack
  if (/^attach pluspower to (?:1|one) of your pokémon\.$|^discard this card at the end of your turn\.$/.test(s)) return []
  if ((m = s.match(/^if the pokémon pluspower is attached to attacks, the attack does (\d+) more damage to opp(?: \(before applying weakness and resistance\))?\.$/)))
    return [{ op: 'boost', n: Number(m[1]) }]
  if ((m = s.match(/^the retreat cost of holder is (\w+)(?: colorless)?(?: energy)? less\.$/))) return [{ op: 'tool_retreat', n: count(m[1]) || 1 }]
  if ((m = s.match(/^the attacks of holder do (\d+) more damage to opp(?: \(before applying weakness and resistance\))?\.$/)))
    return [{ op: 'tool_boost', n: Number(m[1]) }]

  return null
}

/**
 * One sentence of an effect text -> ops, null if unknown (shared with
 * abilityEffects.js). `ctx` carries the coins and what earlier sentences set up.
 */
export const parseEffectSentence = (sentence, ctx) => parseSentence(normalize(sentence), ctx)

/**
 * Parses a Trainer card.
 * @param {{ subtypes?: string[], rules?: string[] }} card - pokemontcg.io
 * @returns {{ kind: string, fx: object[], coins: number | null, playable: boolean, unknown: string[] }}
 */
export function parseTrainer(card) {
  const kind = trainerKind(card.subtypes ?? [])
  const fx = []
  const ctx = { coins: null, fx }
  const unknown = []
  for (const rule of card.rules ?? []) {
    for (const sentence of sentences(rule)) {
      const ops = parseSentence(normalize(sentence), ctx)
      if (ops?.some((op) => op.op === 'discard_cost')) ctx.lastCost = true
      if (ops) fx.push(...ops)
      else unknown.push(sentence)
    }
  }
  const isTool = (op) => op.op.startsWith('tool_')
  const acts = fx.filter((op) => !['discard_cost', 'no_more_trainers', 'first_turn_ok', 'end_turn'].includes(op.op))
  const fits = kind === 'tool' ? fx.length > 0 && fx.every(isTool) : (kind === 'item' || kind === 'supporter') && acts.length > 0 && !fx.some(isTool)
  return { kind, fx, coins: ctx.coins, playable: fits && unknown.length === 0, unknown }
}

/**
 * What populate.mjs stores in cards.trainer for a Trainer card.
 * @param {{ subtypes?: string[], rules?: string[] }} card - pokemontcg.io
 */
export function trainerData(card) {
  const { kind, fx, coins, playable } = parseTrainer(card)
  return { kind, fx, coins, playable, text: (card.rules ?? []).join('\n'), ace_spec: (card.subtypes ?? []).includes('ACE SPEC') }
}
