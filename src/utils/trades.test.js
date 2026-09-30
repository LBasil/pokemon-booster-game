import { describe, expect, it } from 'vitest'
import { TRADE_MAX_CARDS, groupTrades, searchEntries, toggleCard, tradeNews } from './trades'

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

  it('tells a new offer for me and unseen answers to mine, nothing else', () => {
    const me = 'u1'
    const row = (fields) => ({ id: 7, from_user: 'u2', to_user: me, status: 'pending', answer_seen: false, ...fields })
    expect(tradeNews(row({}), me)).toBe('offer')
    expect(tradeNews(row({ status: 'accepted' }), me)).toBe(null) // I answered it myself
    const mine = (fields) => row({ from_user: me, to_user: 'u2', ...fields })
    expect(tradeNews(mine({}), me)).toBe(null) // my own offer, still waiting
    expect(tradeNews(mine({ status: 'accepted' }), me)).toBe('accepted')
    expect(tradeNews(mine({ status: 'declined' }), me)).toBe('declined')
    expect(tradeNews(mine({ status: 'failed' }), me)).toBe('failed')
    expect(tradeNews(mine({ status: 'declined', answer_seen: true }), me)).toBe(null) // already seen
    expect(tradeNews(mine({ status: 'accepted', answer_seen: undefined }), me)).toBe('accepted') // before 0017
    expect(tradeNews(mine({ status: 'cancelled' }), me)).toBe(null)
    expect(tradeNews(null, me)).toBe(null)
    expect(tradeNews(row({}), null)).toBe(null)
  })
})
