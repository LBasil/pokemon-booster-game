import { describe, expect, it } from 'vitest'
import { attackUsable, parseAttack, sentences } from './attackEffects'

describe('sentences', () => {
  it('splits sentences and keeps reminders apart', () => {
    expect(sentences('Flip a coin. If heads, this attack does 20 more damage. (Don’t apply Weakness.)')).toEqual([
      'Flip a coin.',
      'If heads, this attack does 20 more damage.',
      '(Don’t apply Weakness.)',
    ])
    expect(sentences(undefined)).toEqual([])
  })
})

describe('parseAttack', () => {
  it('reads plain damage', () => {
    expect(parseAttack({ damage: '30', text: '' })).toEqual({ damage: 30, fx: [], coins: null, partial: false, unknown: [] })
  })

  it('reads coin flips', () => {
    const times = parseAttack({ damage: '20×', text: 'Flip 3 coins. This attack does 20 damage for each heads.' })
    expect(times).toMatchObject({ damage: 0, coins: 3, fx: [{ op: 'times', n: 20 }], partial: false })
    expect(parseAttack({ damage: '10+', text: 'Flip a coin. If heads, this attack does 20 more damage.' })).toMatchObject({
      damage: 10,
      coins: 1,
      fx: [{ op: 'plus', n: 20, if: 'heads' }],
    })
    expect(parseAttack({ damage: '30', text: 'Flip a coin. If tails, this attack does nothing.' }).fx).toEqual([{ op: 'nothing', if: 'tails' }])
    expect(parseAttack({ damage: '20×', text: 'Flip a coin until you get tails. This attack does 20 damage for each heads.' })).toMatchObject({
      damage: 0,
      coins: 'until',
    })
  })

  it('reads special conditions, on either side, with or without a coin', () => {
    expect(parseAttack({ damage: '10', text: 'Flip a coin. If heads, the Defending Pokémon is now Paralyzed.' }).fx).toEqual([
      { op: 'status', status: 'paralyzed', target: 'opp', if: 'heads' },
    ])
    expect(parseAttack({ damage: '', text: "Your opponent's Active Pokémon is now Confused and Poisoned." }).fx).toEqual([
      { op: 'status', status: 'confused', target: 'opp' },
      { op: 'status', status: 'poisoned', target: 'opp' },
    ])
    expect(parseAttack({ damage: '50', text: 'This Pokémon is now Asleep.' }).fx).toEqual([{ op: 'status', status: 'asleep', target: 'self' }])
  })

  it('reads healing, recoil, bench damage and energy', () => {
    const fx = (text, damage = '30') => parseAttack({ damage, text }).fx
    expect(fx('Heal 30 damage from this Pokémon.')).toEqual([{ op: 'heal_self', n: 30 }])
    expect(fx('This Pokémon also does 20 damage to itself.')).toEqual([{ op: 'self_damage', n: 20 }])
    expect(fx("This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"))
      .toEqual([{ op: 'bench_each', n: 10 }])
    expect(fx("Choose 1 of your opponent's Pokémon. This attack does 30 damage to that Pokémon.", '')).toEqual([{ op: 'snipe', n: 30 }])
    expect(fx('Discard 2 Energy from this Pokémon.')).toEqual([{ op: 'discard_self', n: 2 }])
    expect(fx('Discard all Energy from this Pokémon.')).toEqual([{ op: 'discard_self', n: 'all' }])
    expect(fx("Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.")).toEqual([{ op: 'discard_opp', n: 1, if: 'heads' }])
  })

  it('reads damage that depends on the board', () => {
    expect(parseAttack({ damage: '20×', text: 'This attack does 20 damage for each Energy attached to this Pokémon.' })).toMatchObject({
      damage: 0,
      fx: [{ op: 'per_energy_self', n: 20 }],
    })
    expect(parseAttack({ damage: '60+', text: 'If this Pokémon has any damage counters on it, this attack does 100 more damage.' })).toMatchObject({
      damage: 60,
      fx: [{ op: 'if_damaged_self', n: 100 }],
    })
  })

  it('marks what it does not know, keeping the rest', () => {
    const parsed = parseAttack({ damage: '30', text: 'Discard the top 2 cards of your deck. Heal 10 damage from this Pokémon.' })
    expect(parsed.partial).toBe(true)
    expect(parsed.unknown).toEqual(['Discard the top 2 cards of your deck.'])
    expect(parsed.fx).toEqual([{ op: 'heal_self', n: 10 }])
  })

  it('keeps GX attacks to once a game', () => {
    expect(parseAttack({ damage: '200', text: "(You can't use more than 1 GX attack in a game.)" }).fx).toEqual([{ op: 'once' }])
  })
})

describe('attackUsable', () => {
  it('needs damage or a known effect', () => {
    expect(attackUsable(parseAttack({ damage: '', text: 'Draw a card.' }))).toBe(true)
    expect(attackUsable(parseAttack({ damage: '', text: 'Your opponent reveals their hand.' }))).toBe(false)
    expect(attackUsable(parseAttack({ damage: '10', text: '' }))).toBe(true)
  })
})
