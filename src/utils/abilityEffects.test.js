import { describe, expect, it } from 'vitest'
import { abilityData, parseAbility } from './abilityEffects'

const parse = (text, name) => parseAbility({ name: 'Test', text }, name)

describe('parseAbility (real texts)', () => {
  it('reads abilities used from the board', () => {
    expect(parse('Once during your turn (before your attack), you may draw cards until you have 3 cards in your hand.'))
      .toMatchObject({ kind: 'active', playable: true, fx: [{ op: 'draw_until', n: 3 }] })
    expect(parse('Once during your turn, if this Pokémon is in the Active Spot, you may draw cards until you have 7 cards in your hand. If you use this Ability, your turn ends.'))
      .toMatchObject({ kind: 'active', active_only: true, fx: [{ op: 'draw_until', n: 7 }, { op: 'end_turn' }] })
    expect(parse('You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.'))
      .toMatchObject({ kind: 'active', playable: true, fx: [{ op: 'discard_cost', n: 1 }, { op: 'draw', n: 2 }] })
    expect(parse("Once during your turn, you may put 1 damage counter on 1 of your opponent's Pokémon.").fx).toEqual([{ op: 'counters', n: 10, who: 'one' }])
  })

  it("reads old Poké-Powers that name the Pokémon", () => {
    const hypno = parse('Once during your turn (before your attack), you may flip a coin. If heads, the Defending Pokémon is now Asleep. This power can\'t be used if Hypno is affected by a Special Condition.', 'Hypno')
    expect(hypno).toMatchObject({ kind: 'active', playable: true, coins: 1 })
    expect(hypno.fx).toEqual([{ op: 'status', status: 'asleep', if: 'heads' }, { op: 'needs_no_status' }])
  })

  it('reads passive abilities', () => {
    expect(parse('This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).')).toMatchObject({ kind: 'passive', playable: true, fx: [{ op: 'body_reduce', n: 30 }] })
    expect(parse("If this Pokémon is your Active Pokémon and is damaged by an opponent's attack (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon.").fx)
      .toEqual([{ op: 'body_retaliate', n: 20 }])
    expect(parse('If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.').fx).toEqual([{ op: 'body_sturdy', n: 10 }])
    expect(parse('Your Basic Pokémon in play have no Retreat Cost.').fx).toEqual([{ op: 'body_team_basic_retreat' }])
  })

  it('reads abilities played as the Pokémon comes in', () => {
    expect(parse('When you play this Pokémon from your hand onto your Bench, you may draw cards until you have 6 cards in your hand.')).toMatchObject({ kind: 'on_bench', playable: true })
    expect(parse("When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch 1 of your opponent's Benched Pokémon with their Active Pokémon."))
      .toMatchObject({ kind: 'on_evolve', fx: [{ op: 'gust' }] })
  })

  it('never plays half an ability', () => {
    const energy = parse('Once during your turn, you may attach a Basic Lightning Energy card from your hand to 1 of your Benched Pokémon.')
    expect(energy.playable).toBe(false)
    expect(energy.unknown).toHaveLength(1)
    expect(parse('Prevent all effects of attacks from your opponent\'s Pokémon done to this Pokémon.').playable).toBe(false)
  })

  it('stores what populate needs', () => {
    expect(abilityData({ name: 'Instruct', text: 'Once during your turn (before your attack), you may draw a card.', type: 'Ability' }))
      .toEqual({ name: 'Instruct', text: 'Once during your turn (before your attack), you may draw a card.', type: 'Ability', kind: 'active', fx: [{ op: 'draw', n: 1 }], coins: null, playable: true })
  })
})
