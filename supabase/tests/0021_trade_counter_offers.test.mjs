// 0021: counter-offers (counter_trade, status 'countered', my_trades counter_of)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0021')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 8; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c','Common','s1')`, [`s1-${i}`])
  const [ash, misty, brock] = await addUsers(db, 'Ash', 'Misty', 'Brock')
  for (const [user, cards] of [[ash, ['s1-0', 's1-1']], [misty, ['s1-2', 's1-3', 's1-4']], [brock, ['s1-5']]]) {
    for (const card of cards) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'challenge',$2,1)`, [user, card])
  }

  await as(ash)
  const firstId = (await q(`select propose_trade('Misty', '{s1-0}', '{s1-2}') id`))[0].id

  await as(ash)
  check('the sender cannot counter their own offer', (await errorOf(`select counter_trade($1, '{s1-1}', '{s1-3}')`, [firstId])).includes('trade_not_found'))
  await as(brock)
  check('a stranger cannot counter it', (await errorOf(`select counter_trade($1, '{s1-5}', '{}')`, [firstId])).includes('trade_not_found'))

  await as(misty)
  check('countering with no card offered -> invalid_trade', (await errorOf(`select counter_trade($1, '{}', '{s1-0}')`, [firstId])).includes('invalid_trade'))
  check('offering cards I do not own -> cards_not_owned', (await errorOf(`select counter_trade($1, '{s1-0}', '{}')`, [firstId])).includes('cards_not_owned'))
  check('asking for cards they do not own -> cards_not_owned', (await errorOf(`select counter_trade($1, '{s1-3}', '{s1-5}')`, [firstId])).includes('cards_not_owned'))
  await as(ash)
  await q(`insert into trade_locks (card_id) values ('s1-1')`)
  await as(misty)
  check('asking for a card they keep out of trades -> card_not_for_trade', (await errorOf(`select counter_trade($1, '{s1-3}', '{s1-1}')`, [firstId])).includes('card_not_for_trade'))
  await as(ash)
  await q(`delete from trade_locks where card_id = 's1-1'`)
  await q(`update profiles set accepts_trades = false where id = $1`, [ash])

  await as(misty)
  check('a failed counter leaves the offer pending', (await q(`select my_trades() t`))[0].t.find((t) => t.id === Number(firstId)).status === 'pending')
  const counterId = (await q(`select counter_trade($1, '{s1-3,s1-4}', '{s1-0,s1-1}') id`, [firstId]))[0].id
  check('countering works, even if the first sender closed their trades', Number(counterId) > Number(firstId))
  let mine = (await q(`select my_trades() t`))[0].t
  check('the first offer is now countered', mine.find((t) => t.id === Number(firstId)).status === 'countered')
  const counter = mine.find((t) => t.id === Number(counterId))
  check('the counter-offer is mine, pending, linked to it', counter.direction === 'sent' && counter.status === 'pending' && counter.counter_of === Number(firstId))
  check('a first offer has counter_of null', mine.find((t) => t.id === Number(firstId)).counter_of === null)
  check('a countered offer cannot be countered again', (await errorOf(`select counter_trade($1, '{s1-3}', '{}')`, [firstId])).includes('trade_closed'))
  check('nor accepted', (await errorOf(`select respond_trade($1, true)`, [firstId])).includes('trade_closed'))

  await as(ash)
  let badge = (await q(`select challenge_badge() b`))[0].b
  check('the first sender sees one new offer, not an extra answer', badge.trades === 1 && badge.answers === 0)
  mine = (await q(`select my_trades() t`))[0].t
  check('received as a counter-offer', mine.find((t) => t.id === Number(counterId)).direction === 'received')
  check('their countered offer is not an unseen answer', mine.find((t) => t.id === Number(firstId)).unseen === false)
  check('Ash cannot cancel a counter-offer made to him', (await errorOf(`select cancel_trade($1)`, [counterId])).includes('trade_not_found'))

  // A counter of a counter
  const backId = (await q(`select counter_trade($1, '{s1-0}', '{s1-3}') id`, [counterId]))[0].id
  await as(misty)
  check('the accept swaps the cards as usual', (await q(`select respond_trade($1, true) r`, [backId]))[0].r.status === 'accepted')
  await asAdmin()
  const owners = Object.fromEntries((await q(`select card_id, user_id from collections where card_id in ('s1-0','s1-3') and mode = 'challenge'`)).map((r) => [r.card_id, r.user_id]))
  check('cards moved', owners['s1-0'] === misty && owners['s1-3'] === ash)
  check('the chain is countered, countered, accepted', (await q(`select status from trade_offers order by id`)).map((r) => r.status).join() === 'countered,countered,accepted')

  // Expired offers can't be countered
  await as(brock)
  const oldId = (await q(`select propose_trade('Misty', '{s1-5}', '{}') id`))[0].id
  await asAdmin()
  await q(`update trade_offers set created_at = now() - interval '30 days' where id = $1`, [oldId])
  await as(misty)
  check('an expired offer -> trade_expired', (await errorOf(`select counter_trade($1, '{s1-2}', '{}')`, [oldId])).includes('trade_expired'))

  await as(null)
  check('anon cannot call counter_trade', (await errorOf(`select counter_trade(1, '{s1-0}', '{}')`)) !== '')
  await as(misty)
  check('players still cannot write trade_offers', (await errorOf(`update trade_offers set status = 'pending'`)) !== '' || (await q(`select count(*)::int n from trade_offers where status = 'pending'`))[0].n === 1)
}
