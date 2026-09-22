/**
 * Groups a flat list of cards (which may contain duplicates, e.g. pulling
 * the same card across several boosters in one session) into
 * { card, quantity } entries, preserving first-seen order.
 */
export function groupCardsByQuantity(cards) {
  const order = []
  const byId = new Map()

  for (const card of cards) {
    const existing = byId.get(card.id)
    if (existing) {
      existing.quantity++
    } else {
      byId.set(card.id, { card, quantity: 1 })
      order.push(card.id)
    }
  }

  return order.map((id) => byId.get(id))
}
