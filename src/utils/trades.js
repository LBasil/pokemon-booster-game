// Trades between players (challenge mode, migration 0007): limits mirrored
// from propose_trade() — change both together.
export const TRADE_MAX_CARDS = 5
export const TRADE_MAX_PENDING = 10

/**
 * Adds or removes a card id from a selection, never past `max` cards.
 * @returns {string[]} a new array
 */
export function toggleCard(selection, cardId, max = TRADE_MAX_CARDS) {
  if (selection.includes(cardId)) return selection.filter((id) => id !== cardId)
  if (selection.length >= max) return selection
  return [...selection, cardId]
}

/**
 * Splits my_trades() rows into what needs an answer, what's waiting on the
 * other player, and the finished ones (accepted, declined, cancelled,
 * failed, expired), each keeping the server's newest-first order.
 */
export function groupTrades(trades) {
  const received = []
  const sent = []
  const history = []
  for (const trade of trades) {
    if (trade.status !== 'pending') history.push(trade)
    else if (trade.direction === 'received') received.push(trade)
    else sent.push(trade)
  }
  return { received, sent, history }
}

/** Collection rows whose card name contains `query` (case/accent-insensitive). */
export function searchEntries(entries, query) {
  const normalize = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const needle = normalize(query.trim())
  if (!needle) return entries
  return entries.filter((entry) => normalize(entry.cards.name).includes(needle))
}

// How an offer I sent can end that I should hear about (cancelled is my own
// doing, expired is silent)
export const ANSWERED = ['accepted', 'declined', 'failed']

/**
 * What a live trade_offers row means for the signed-in player: 'offer' (a new
 * offer for me), 'accepted' / 'declined' / 'failed' (an answer to my offer I
 * haven't seen, migration 0017's answer_seen), or null (nothing to tell).
 */
export function tradeNews(row, userId) {
  if (!row?.id || !userId) return null
  if (row.to_user === userId && row.status === 'pending') return 'offer'
  if (row.from_user === userId && ANSWERED.includes(row.status) && !row.answer_seen) return row.status
  return null
}
