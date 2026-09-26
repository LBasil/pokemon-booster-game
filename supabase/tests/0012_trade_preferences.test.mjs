// 0012: opting out of trades, and cards kept out of trades
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0012')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 6; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c','Common','s1')`, [`s1-${i}`])
  const [ash, misty, brock] = await addUsers(db, 'Ash', 'Misty', 'Brock')
  for (const [user, cards] of [[ash, ['s1-0', 's1-1']], [misty, ['s1-2', 's1-3']], [brock, ['s1-4']]]) {
    for (const card of cards) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'challenge',$2,1)`, [user, card])
  }
  check('accepts_trades defaults to true', (await q(`select bool_and(accepts_trades) v from profiles`))[0].v === true)

  // ---------- Opting out ----------
  await as(misty)
  await q(`update profiles set accepts_trades = false where id = $1`, [misty])
  await as(ash)
  check('nobody else can change it', (await q(`update profiles set accepts_trades = true where id = $1 returning id`, [misty])).length === 0)
  await as(null)
  check('anyone sees it on a public profile', (await q(`select accepts_trades from profiles where id = $1`, [misty]))[0].accepts_trades === false)
  await as(ash)
  check('an offer to a player who refuses trades -> trades_closed', (await errorOf(`select propose_trade('Misty', '{s1-0}', '{s1-2}')`)).includes('trades_closed'))
  await as(misty)
  await q(`update profiles set accepts_trades = true where id = $1`, [misty])

  // ---------- Locks ----------
  await q(`insert into trade_locks (card_id) values ('s1-2')`) // user_id defaults to auth.uid()
  check('locking a card for someone else is refused', (await errorOf(`insert into trade_locks (user_id, card_id) values ($1, 's1-0')`, [ash])) !== '')
  check('the owner reads their locks', (await q(`select * from trade_locks`)).length === 1)
  await as(ash)
  check('other players cannot read them', (await q(`select * from trade_locks`)).length === 0)
  await as(null)
  check('anon cannot read them', (await errorOf(`select * from trade_locks`)) !== '')

  await as(ash)
  const theirs = await q(`select card_id, tradable from challenge_collection_of('Misty') order by card_id`)
  check('challenge_collection_of flags locked cards', theirs.length === 2 && theirs[0].tradable === false && theirs[1].tradable === true)
  check('asking for a locked card -> card_not_for_trade', (await errorOf(`select propose_trade('Misty', '{s1-0}', '{s1-2}')`)).includes('card_not_for_trade'))
  const okId = (await q(`select propose_trade('Misty', '{s1-0}', '{s1-3}') id`))[0].id
  check('asking for an unlocked card works', Number(okId) > 0)

  await q(`insert into trade_locks (card_id) values ('s1-1')`)
  check('offering your own locked card -> card_not_for_trade', (await errorOf(`select propose_trade('Brock', '{s1-1}', '{}')`)).includes('card_not_for_trade'))
  await q(`delete from trade_locks where card_id = 's1-1'`)
  const giftId = (await q(`select propose_trade('Brock', '{s1-1}', '{}') id`))[0].id
  await q(`insert into trade_locks (card_id) values ('s1-1')`)
  await as(brock)
  check('a card the sender locked since fails the trade', (await q(`select respond_trade($1, true) r`, [giftId]))[0].r.status === 'failed')

  await as(misty)
  await q(`insert into trade_locks (card_id) values ('s1-3')`)
  check('the receiver can still accept an offer on their own locked card', (await q(`select respond_trade($1, true) r`, [okId]))[0].r.status === 'accepted')
  await asAdmin()
  const moved = await q(`select user_id, card_id from collections where card_id in ('s1-0', 's1-3') and mode = 'challenge' order by card_id`)
  check('and the cards are swapped', moved[0].user_id === misty && moved[1].user_id === ash)

  await as(brock)
  const lateId = (await q(`select propose_trade('Misty', '{s1-4}', '{}') id`))[0].id
  await as(misty)
  await q(`update profiles set accepts_trades = false where id = $1`, [misty])
  check('offers already waiting stay answerable after opting out', (await q(`select respond_trade($1, false) r`, [lateId]))[0].r.status === 'declined')

  await as(ash)
  check('players cannot call has_trade_lock', (await errorOf(`select has_trade_lock($1, '{s1-0}')`, [ash])) !== '')
  check('locks cannot be updated, only added or removed', (await errorOf(`update trade_locks set card_id = 's1-5'`)) !== '')
  await asAdmin()
  await q(`delete from auth.users where id = $1`, [misty])
  check('locks go with a deleted account', (await q(`select count(*)::int n from trade_locks where user_id = $1`, [misty]))[0].n === 0)
}
