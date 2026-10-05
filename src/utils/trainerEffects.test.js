import { describe, expect, it } from 'vitest'
import { parseTrainer, trainerData, trainerKind } from './trainerEffects'

const ITEM = 'You may play any number of Item cards during your turn.'
const SUPPORTER = 'You may play only 1 Supporter card during your turn (before your attack).'
const TOOL = "Attach a Pokémon Tool to 1 of your Pokémon that doesn't already have a Pokémon Tool attached."
const parse = (subtypes, ...rules) => parseTrainer({ subtypes, rules })

describe('trainerKind', () => {
  it('reads the subtypes, old Trainers are Items', () => {
    expect(trainerKind(['Supporter'])).toBe('supporter')
    expect(trainerKind(['Item', 'Pokémon Tool'])).toBe('tool')
    expect(trainerKind(['Stadium'])).toBe('stadium')
    expect(trainerKind(['Technical Machine'])).toBe('other')
    expect(trainerKind([])).toBe('item')
  })
})

describe('parseTrainer (real texts)', () => {
  it('draws', () => {
    expect(parse(['Supporter'], 'Discard your hand and draw 7 cards.', SUPPORTER).fx).toEqual([{ op: 'discard_hand_draw', n: 7 }])
    expect(parse(['Supporter'], 'Shuffle your hand into your deck. Then, draw 6 cards.', SUPPORTER).fx).toEqual([{ op: 'shuffle_hand_draw', n: 6 }])
    expect(parse(['Supporter'], 'Draw cards until you have 6 cards in your hand. If it\'s your first turn, draw cards until you have 8 cards in your hand.', SUPPORTER).fx)
      .toEqual([{ op: 'draw_until', n: 6, first: 8 }])
    expect(parse([], 'Discard your hand, then draw 7 cards.').fx).toEqual([{ op: 'discard_hand_draw', n: 7 }])
  })

  it('searches, with a coin and filters', () => {
    const ball = parse(['Item'], 'Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.', ITEM)
    expect(ball).toMatchObject({ playable: true, coins: 1, fx: [{ op: 'search', what: 'pokemon', n: 1, to: 'hand', if: 'heads' }] })
    expect(parse(['Item'], 'Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.', ITEM).fx)
      .toEqual([{ op: 'search', what: 'basic', max_hp: 70, n: 2, to: 'bench' }])
    expect(parse(['Supporter'], 'Search your deck for a Water Pokémon and an Item card, reveal them, and put them into your hand. Then, shuffle your deck.', SUPPORTER).fx)
      .toEqual([{ op: 'search', what: 'pokemon', type: 'Water', n: 1, to: 'hand' }, { op: 'search', what: 'item', n: 1, to: 'hand' }])
    // an Evolution can't go onto the Bench
    expect(parse(['Item'], 'Search your deck for an Evolution Pokémon and put it onto your Bench.', ITEM).playable).toBe(false)
  })

  it('costs, then effects', () => {
    expect(parse(['Item'], 'Discard 2 cards from your hand. If you do, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.', ITEM).fx)
      .toEqual([{ op: 'discard_cost', n: 2 }, { op: 'search', what: 'pokemon', n: 1, to: 'hand' }])
    expect(parse(['Item'], 'Look at the top 2 cards of your deck and put 1 of them into your hand. Discard the other card.', ITEM).fx)
      .toEqual([{ op: 'search_top', what: 'card', n: 1, top: 2, discard_rest: true }])
  })

  it('heals, switches, gusts', () => {
    expect(parse(['Item'], 'Remove 2 damage counters from 1 of your Pokémon (1 if that Pokémon has only 1).').fx).toEqual([{ op: 'heal', n: 20, who: 'one' }])
    expect(parse(['Item'], 'Heal all damage from 1 of your Pokémon. If you do, discard all Energy from that Pokémon.', ITEM).fx)
      .toEqual([{ op: 'heal', n: 'all', who: 'one' }, { op: 'discard_energy_healed', n: 'all' }])
    expect(parse(['Supporter'], "Switch 1 of your opponent's Benched Pokémon with their Active Pokémon. If you do, switch your Active Pokémon with 1 of your Benched Pokémon.", SUPPORTER).fx)
      .toEqual([{ op: 'gust' }, { op: 'switch_self' }])
    expect(parse([], "Choose 1 of your opponent's Benched Pokémon and switch it with his or her Active Pokémon.").fx).toEqual([{ op: 'gust' }])
  })

  it('Rare Candy and Tools', () => {
    expect(parse(['Item'], "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.", ITEM).fx)
      .toEqual([{ op: 'rare_candy' }])
    expect(parse(['Pokémon Tool'], TOOL, 'If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon.', ITEM))
      .toMatchObject({ kind: 'tool', playable: true, fx: [{ op: 'tool_retaliate', n: 20 }] })
    expect(parse(['Pokémon Tool'], TOOL, 'The Pokémon this card is attached to has no Retreat Cost.').fx).toEqual([{ op: 'tool_retreat', n: 'all' }])
  })

  it('never plays half a Trainer, nor a Stadium', () => {
    const marnie = parse(['Supporter'], 'Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards.')
    expect(marnie.playable).toBe(false)
    expect(marnie.unknown).toHaveLength(1)
    expect(parse(['Item'], 'Search your deck for a basic Energy card, reveal it, and put it into your hand.').playable).toBe(false)
    expect(parse(['Stadium'], 'Each player draws a card.').playable).toBe(false)
  })

  it('stores what populate needs', () => {
    expect(trainerData({ subtypes: ['Pokémon Tool', 'ACE SPEC'], rules: [TOOL, 'The Pokémon this card is attached to gets +100 HP.'] }))
      .toMatchObject({ kind: 'tool', playable: true, ace_spec: true, fx: [{ op: 'tool_hp', n: 100 }] })
  })
})
