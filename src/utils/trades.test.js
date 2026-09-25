import { describe, expect, it } from 'vitest'
import { TRADE_MAX_CARDS, groupTrades, searchEntries, toggleCard } from './trades'

describe('trades', () => {
  it('toggles cards in a selection, up to the limit', () => {
    let selection = []
    for (let i = 0; i < TRADE_MAX_CARDS + 2; i++) selection = toggleCard(selection, `c${i}`)
    expect(selection).toHaveLength(TRADE_MAX_CARDS)
    expect(toggleCard(selection, 'c0')).not.toContain('c0')
    expect(toggleCard(['a'], 'b', 1)).toEqual(['a'])
  })

  it('groups offers into received, sent and history', () => {
    const trades = [
      { id: 1, direction: 'received', status: 'pending' },
      { id: 2, direction: 'sent', status: 'pending' },
      { id: 3, direction: 'sent', status: 'accepted' },
      { id: 4, direction: 'received', status: 'expired' },
      { id: 5, direction: 'received', status: 'pending' },
    ]
    const { received, sent, history } = groupTrades(trades)
    expect(received.map((t) => t.id)).toEqual([1, 5])
    expect(sent.map((t) => t.id)).toEqual([2])
    expect(history.map((t) => t.id)).toEqual([3, 4])
  })

  it('searches card names ignoring case and accents', () => {
    const entries = [{ cards: { name: 'Flabébé' } }, { cards: { name: 'Pikachu' } }]
    expect(searchEntries(entries, 'flabebe')).toHaveLength(1)
    expect(searchEntries(entries, '  PIKA ')).toEqual([entries[1]])
    expect(searchEntries(entries, '')).toBe(entries)
  })
})
