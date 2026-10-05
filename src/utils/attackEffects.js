// Attack texts (pokemontcg.io, English) -> effects the PvP engine applies
// (migration 0030, `pvp_attack` in SQL). scripts/populate.mjs stores the
// result in cards.attacks[i].fx / .coins / .partial; the battle view shows
// the printed text (French from TCGdex when there is one).
//
// An attack is a printed damage + a list of ops. Ops that depend on a coin
// carry `if: 'heads' | 'tails'` (one coin per attack: "Flip a coin."), or
// count heads (`coins`: N coins, or 'until' = until tails). A sentence the
// parser doesn't know makes the attack `partial`: its damage and the known
// ops still apply, the rest of the text is shown as "not applied".
//
// Ops (n = an amount of damage, a number of cards or of energies):
//   times           base damage x heads (printed "20×")
//   plus_heads      + n per heads
//   plus            + n (with `if`: "If heads, this attack does 30 more damage")
//   nothing         the attack does nothing (if: 'tails')
//   status          `status` on `target` ('opp' | 'self'): asleep, paralyzed,
//                   confused, poisoned, burned
//   heal_self       heal n from this Pokémon
//   heal_all        heal n from each of my Pokémon
//   drain           heal this Pokémon as much as the damage dealt
//   self_damage     n to this Pokémon
//   bench_one       n to 1 of the opponent's Benched Pokémon (attacker picks)
//   bench_each      n to each of the opponent's Benched Pokémon
//   own_bench_each  n to each of my Benched Pokémon
//   snipe           n to 1 of the opponent's Pokémon (attacker picks, Active included)
//   spread          n to each of the opponent's Pokémon
//   discard_self    discard n energies (or 'all') from this Pokémon
//   discard_opp     discard n energies from the opponent's Active Pokémon
//   lock_self       this Pokémon can't attack during my next turn
//   no_retreat      the opponent's Active Pokémon can't retreat next turn
//   reduce_next     this Pokémon takes n less damage next turn
//   prevent_next    prevent all damage and effects done to this Pokémon next turn
//   smokescreen     the opponent's Active Pokémon flips before attacking next turn
//   draw            draw n cards
//   call_basic      put up to n Basic Pokémon from my deck onto my Bench
//   switch_self     switch this Pokémon with 1 of my Benched Pokémon
//   opp_switch      the opponent switches their Active Pokémon with a Benched one
//   move_energy     move an energy from this Pokémon to 1 of my Benched Pokémon
//   per_energy_self / per_energy_opp    + n per energy (on this / the opponent's Active)
//   per_counter_self / per_counter_opp  + n per damage counter (10 damage)
//   minus_counter_self                  - n per damage counter on this Pokémon
//   per_bench_opp / per_bench_self      + n per Benched Pokémon
//   per_points_self / per_points_opp    + n per point I / the opponent have
//   per_hand_self / per_hand_opp        + n per card in my / the opponent's hand
//   lock_opp        the opponent's Active Pokémon can't attack next turn
//   weaken_opp      the opponent's Active Pokémon's attacks do n less next turn
//   if_damaged_self / if_damaged_opp    + n if any damage on it
//   if_status_opp   + n if the opponent's Active Pokémon has `status`
//   no_weakness / no_resistance         skip them for this attack
//   once            once per game (GX attacks, VSTAR powers)

const STATUSES = ['asleep', 'paralyzed', 'confused', 'poisoned', 'burned']
const NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }
const count = (word) => NUMBER[word?.toLowerCase()] ?? Number(word)

// Reminders and deck bookkeeping that change nothing in our battles
const IGNORED = [
  /^\(?don't apply weakness and resistance for benched pokémon\.\)?$/,
  /^\(any other effects (?:of attacks|that would happen after applying weakness and resistance) still happen\.\)$/,
  /^(?:then, )?shuffle your deck(?: afterward)?\.$/,
  /^this attack's damage isn't affected by any effects on opp\.$/,
  /^\(do the damage before switching the pokémon\.\)$/,
  /^\(your opponent chooses the new active pokémon\.\)$/,
  /^\(you can't add more than \d+ damage in this way\.\)$/,
]

/**
 * Splits a text into sentences, keeping parenthesized reminders apart.
 * @param {string} text
 */
export function sentences(text) {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.)])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// "the Defending Pokémon" / "your opponent's Active Pokémon" -> OPP, "this Pokémon" -> SELF
function normalize(sentence) {
  return sentence
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/the defending pokémon|your opponent's active pokémon|the opponent's active pokémon/g, 'opp')
    .replace(/this pokémon/g, 'self')
}

/** One sentence (lowercased, normalized) -> ops, null if unknown. `ctx` holds the coins. */
function parseSentence(s, ctx) {
  let m
  if (IGNORED.some((re) => re.test(s))) return []
  if (/^\(you can't use more than 1 (?:gx attack|vstar power) in a game\.\)$/.test(s)) return [{ op: 'once' }]

  // Coins
  if (s === 'flip a coin.') return (ctx.coins = 1), []
  if ((m = s.match(/^flip (\w+) coins\.$/))) return (ctx.coins = count(m[1])), []
  if (s === 'flip a coin until you get tails.') return (ctx.coins = 'until'), []
  if ((m = s.match(/^flip (\w+) coins?\. this attack does (\d+) damage (?:times the number of|for each) heads\.$/))) {
    ctx.coins = count(m[1])
    return [{ op: 'times', n: Number(m[2]) }]
  }
  if ((m = s.match(/^this attack does (\d+) damage (?:times the number of|for each) heads\.$/))) return [{ op: 'times', n: Number(m[1]) }]
  if ((m = s.match(/^this attack does (?:\d+ damage plus )?(\d+) more damage for each heads\.$/))) return [{ op: 'plus_heads', n: Number(m[1]) }]

  // "If heads, ..." / "If tails, ..."
  if ((m = s.match(/^if (heads|tails), (.+)$/))) {
    const side = m[1]
    let rest = m[2]
    // "If heads, this attack does 10 damage plus 20 more damage; if tails, this attack does 10 damage."
    rest = rest.replace(/; if (?:heads|tails), this attack does \d+ damage\.$/, '.')
    if (/^this attack does nothing\.$|^that attack does nothing\.$/.test(rest) && side === 'tails') return [{ op: 'nothing', if: 'tails' }]
    if ((m = rest.match(/^this attack does (?:\d+ damage plus )?(\d+) more damage\.$/))) return [{ op: 'plus', n: Number(m[1]), if: side }]
    const inner = parseSentence(rest.charAt(0).toLowerCase() + rest.slice(1), ctx)
    return inner && inner.map((op) => ({ ...op, if: side }))
  }

  // Special conditions
  if ((m = s.match(/^(opp|self) is now (\w+)(?: and (\w+))?\.$/))) {
    const statuses = [m[2], m[3]].filter(Boolean)
    if (!statuses.every((x) => STATUSES.includes(x))) return null
    return statuses.map((status) => ({ op: 'status', status, target: m[1] === 'opp' ? 'opp' : 'self' }))
  }

  // Healing, recoil
  if ((m = s.match(/^heal (\d+) damage from self\.$/))) return [{ op: 'heal_self', n: Number(m[1]) }]
  if ((m = s.match(/^heal (\d+) damage from each of your pokémon\.$/))) return [{ op: 'heal_all', n: Number(m[1]) }]
  if (/^heal from self the same amount of damage you did to opp\.$/.test(s)) return [{ op: 'drain' }]
  if ((m = s.match(/^self (?:also )?does (\d+) damage to itself\.$/))) return [{ op: 'self_damage', n: Number(m[1]) }]

  // Other Pokémon
  if ((m = s.match(/^(?:this attack )?(?:also )?does (\d+) damage to (?:1|one) of your opponent's benched pokémon\.$/)))
    return [{ op: 'bench_one', n: Number(m[1]) }]
  if ((m = s.match(/^this attack (?:also )?does (\d+) damage to each of your opponent's benched pokémon\.$/)))
    return [{ op: 'bench_each', n: Number(m[1]) }]
  if ((m = s.match(/^this attack (?:also )?does (\d+) damage to each of your benched pokémon\.$/)))
    return [{ op: 'own_bench_each', n: Number(m[1]) }]
  if ((m = s.match(/^(?:this attack )?(?:also )?does (\d+) damage to (?:1|one) of your opponent's pokémon\.$/)))
    return [{ op: 'snipe', n: Number(m[1]) }]
  if (/^choose (?:1|one) of your opponent's pokémon\.$/.test(s)) return (ctx.choose = 'snipe'), []
  if (/^choose (?:1|one) of your opponent's benched pokémon\.$/.test(s)) return (ctx.choose = 'bench_one'), []
  if ((m = s.match(/^this attack does (\d+) damage to that pokémon\.$/)) && ctx.choose) return [{ op: ctx.choose, n: Number(m[1]) }]
  if ((m = s.match(/^this attack (?:also )?does (\d+) damage to each of your opponent's pokémon\.$/)))
    return [{ op: 'spread', n: Number(m[1]) }]

  // Energy
  if ((m = s.match(/^discard (an|\d+|all|two|three) energy (?:cards? )?(?:from|attached to) self\.$/)))
    return [{ op: 'discard_self', n: m[1] === 'all' ? 'all' : count(m[1]) }]
  if ((m = s.match(/^discard (an|\d+) energy (?:card )?(?:from|attached to) opp\.$/)))
    return [{ op: 'discard_opp', n: count(m[1]) }]
  if (/^move an energy from self to (?:1|one) of your benched pokémon\.$/.test(s)) return [{ op: 'move_energy' }]

  // Next turn
  if (/^during your next turn, self can't (?:attack|use attacks)\.$|^self can't attack during your next turn\.$/.test(s)) return [{ op: 'lock_self' }]
  if (/^opp can't attack during your opponent's next turn\.$|^during your opponent's next turn, opp can't attack\.$/.test(s)) return [{ op: 'lock_opp' }]
  if ((m = s.match(/^during your opponent's next turn, (?:opp's attacks do (\d+) less damage|any damage done by attacks from opp is reduced by (\d+))/)))
    return [{ op: 'weaken_opp', n: Number(m[1] ?? m[2]) }]
  if (/^opp can't retreat during your opponent's next turn\.$|^during your opponent's next turn, opp can't retreat\.$/.test(s))
    return [{ op: 'no_retreat' }]
  if ((m = s.match(/^during your opponent's next turn, (?:self takes (\d+) less damage from attacks|any damage done to self by attacks is reduced by (\d+))/)))
    return [{ op: 'reduce_next', n: Number(m[1] ?? m[2]) }]
  if (/^(?:during your opponent's next turn, )?prevent all (?:damage from and effects of attacks|effects of attacks, including damage,|damage) done to self(?: by attacks)?(?: during your opponent's next turn)?\.$/.test(s))
    return [{ op: 'prevent_next' }]
  if (/^if opp tries to attack during your opponent's next turn, your opponent flips a coin\.$/.test(s)) return (ctx.smoke = true), []
  if (ctx.smoke && /^if tails, that attack (?:does nothing|doesn't happen)\.$/.test(s)) return [{ op: 'smokescreen' }]

  // Cards
  if ((m = s.match(/^(?:then, )?draw (a card|(\w+) cards)\.$/))) return [{ op: 'draw', n: m[2] ? count(m[2]) : 1 }]
  if ((m = s.match(/^search your deck for (?:up to (\w+)|a) basic pokémon and put (?:it|them) onto your bench\.$/)))
    return [{ op: 'call_basic', n: m[1] ? count(m[1]) : 1 }]
  if (/^(?:you may )?switch self with (?:1|one) of your benched pokémon\.$/.test(s)) return [{ op: 'switch_self' }]
  if (/^your opponent switches (?:opp|their active pokémon) with (?:1|one) of (?:their|his or her) benched pokémon(?:, if any)?\.$/.test(s))
    return [{ op: 'opp_switch' }]

  // Damage that depends on the board
  if ((m = s.match(/^(?:this attack )?does (\d+) (?:more )?damage (?:for each|times the amount of) (?:\w+ )?energy attached to (self|opp)\.$/)))
    return [{ op: m[2] === 'self' ? 'per_energy_self' : 'per_energy_opp', n: Number(m[1]) }]
  if ((m = s.match(/^(?:this attack )?does (\d+) (?:more )?damage (?:for each|times the number of) damage counters? on (self|opp)\.$/)))
    return [{ op: m[2] === 'self' ? 'per_counter_self' : 'per_counter_opp', n: Number(m[1]) }]
  if ((m = s.match(/^this attack does (\d+) (?:more )?damage for each prize card (you have|your opponent has) taken\.$/)))
    return [{ op: m[2] === 'you have' ? 'per_points_self' : 'per_points_opp', n: Number(m[1]) }]
  if ((m = s.match(/^this attack does (\d+) (?:more )?damage for each card in (your|your opponent's) hand\.$/)))
    return [{ op: m[2] === 'your' ? 'per_hand_self' : 'per_hand_opp', n: Number(m[1]) }]
  if ((m = s.match(/^(?:this attack )?does (\d+) (more )?damage for each damage counter on (self|opp)\.$/)))
    return [{ op: m[3] === 'self' ? 'per_counter_self' : 'per_counter_opp', n: Number(m[1]) }]
  if ((m = s.match(/^this attack does (\d+) less damage for each damage counter on self\.$/)))
    return [{ op: 'minus_counter_self', n: Number(m[1]) }]
  if ((m = s.match(/^this attack does (\d+) (?:more )?damage for each of (your opponent's|your) benched pokémon\.$/)))
    return [{ op: m[2] === 'your' ? 'per_bench_self' : 'per_bench_opp', n: Number(m[1]) }]
  if ((m = s.match(/^if (self|opp) (?:already )?has any damage counters on it, this attack does (\d+) more damage\.$/)))
    return [{ op: m[1] === 'self' ? 'if_damaged_self' : 'if_damaged_opp', n: Number(m[2]) }]
  if ((m = s.match(/^if opp is (\w+), this attack does (\d+) more damage\.$/)) && STATUSES.includes(m[1]))
    return [{ op: 'if_status_opp', status: m[1], n: Number(m[2]) }]

  // Weakness / Resistance
  if (/^(?:this attack's damage isn't affected by weakness or resistance|this damage isn't affected by weakness or resistance|don't apply weakness and resistance(?: for this attack)?)\.$/.test(s))
    return [{ op: 'no_weakness' }, { op: 'no_resistance' }]
  if (/^this attack's damage isn't affected by resistance\.$/.test(s)) return [{ op: 'no_resistance' }]

  return null
}

/**
 * Parses one attack.
 * @param {{ damage?: string, text?: string }} attack - as printed ("30", "30+", "20×", "50-", "")
 * @returns {{ damage: number, fx: object[], coins: number | 'until' | null, partial: boolean, unknown: string[] }}
 */
export function parseAttack(attack) {
  const printed = String(attack.damage ?? '')
  const ctx = { coins: null, choose: false, smoke: false }
  const fx = []
  const unknown = []
  for (const sentence of sentences(attack.text)) {
    const ops = parseSentence(normalize(sentence), ctx)
    if (ops) fx.push(...ops)
    else unknown.push(sentence)
  }
  let damage = Number(printed.match(/^\d+/)?.[0] ?? 0)
  // "20×" with a "for each" op: the op carries the amount, the base is 0
  const perOps = ['times', 'per_energy_self', 'per_energy_opp', 'per_counter_self', 'per_counter_opp', 'per_bench_opp', 'per_bench_self',
    'per_points_self', 'per_points_opp', 'per_hand_self', 'per_hand_opp']
  if (/[×x]$/i.test(printed)) {
    const per = fx.find((op) => perOps.includes(op.op))
    if (per) damage = 0
    // "Flip 2 coins. This attack does 20 damage times the number of heads." printed "20×" but worded otherwise
    else if (ctx.coins) fx.push({ op: 'times', n: damage }), (damage = 0)
    else unknown.push(printed)
  }
  return { damage, fx, coins: ctx.coins, partial: unknown.length > 0, unknown }
}

/** Whether an attack can do anything in a battle (damage or a known effect). */
export const attackUsable = (parsed) => parsed.damage > 0 || parsed.fx.some((op) => op.op !== 'once')
