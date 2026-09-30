// 0017: answers to my trade offers (badge, unseen, mark seen); recycling a pick
import { addUsers, freshDb, helpers, readMigration } from './harness.mjs'

export default async function (check) {
  // Built up to 0016 first, so offers finished before 0017 exist when it runs
  const db = await freshDb('0016')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 10; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c',$2,'s1')`, [`s1-${i}`, i < 6 ? 'Common' : 'Rare'])
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')
  for (const [user, cards] of [[ash, ['s1-0', 's1-1', 's1-2', 's1-3']], [misty, ['s1-4', 's1-5']]]) {
    for (const card of cards) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'challenge',$2,1)`, [user, card])
  }

  await as(ash)
  const oldId = (await q(`select propose_trade('Misty', '{s1-0}', '{}') id`))[0].id
  const pendingId = (await q(`select propose_trade('Misty', '{s1-1}', '{s1-4}') id`))[0].id
  await as(misty)
  await q(`select respond_trade($1, false)`, [oldId])

  await asAdmin()
  const migration = readMigration('0017_trade_answers_recycle_picks.sql')
  await db.exec(migration)
  await db.exec(migration)
  check('an offer answered before 0017 counts as seen', (await q(`select answer_seen from trade_offers where id = $1`, [oldId]))[0].answer_seen === true)
  check('a pending one does not', (await q(`select answer_seen from trade_offers where id = $1`, [pendingId]))[0].answer_seen === false)

  await as(ash)
  check('no answer waiting at first', (await q(`select challenge_badge() b`))[0].b.answers === 0)

  // ---------- Answers ----------
  await as(misty)
  check('accepting works as before', (await q(`select respond_trade($1, true) r`, [pendingId]))[0].r.status === 'accepted')
  check('the receiver has no answer to see', (await q(`select challenge_badge() b`))[0].b.answers === 0)
  const received = (await q(`select my_trades() t`))[0].t.find((t) => t.id === Number(pendingId))
  check('nor an unseen row', received.unseen === false)

  await as(ash)
  const gift = (await q(`select propose_trade('Misty', '{s1-2}', '{}') id`))[0].id
  const cancelled = (await q(`select propose_trade('Misty', '{s1-3}', '{}') id`))[0].id
  await q(`select cancel_trade($1)`, [cancelled])
  await as(misty)
  await q(`select respond_trade($1, false)`, [gift])

  await as(ash)
  let badge = (await q(`select challenge_badge() b`))[0].b
  check('the sender sees 2 answers (accepted + declined, not cancelled)', badge.answers === 2)
  let mine = (await q(`select my_trades() t`))[0].t
  const unseen = mine.filter((t) => t.unseen).map((t) => t.id).sort()
  check('my_trades flags those two', unseen.length === 2 && unseen.includes(Number(pendingId)) && unseen.includes(Number(gift)))

  await as(misty)
  check('the receiver cannot mark them seen for the sender', (await q(`select mark_trade_answers_seen() n`))[0].n === 0)
  await as(ash)
  check('the sender marks them seen (2 new)', (await q(`select mark_trade_answers_seen() n`))[0].n === 2)
  badge = (await q(`select challenge_badge() b`))[0].b
  mine = (await q(`select my_trades() t`))[0].t
  check('then the badge and the rows are clear', badge.answers === 0 && mine.every((t) => !t.unseen))
  await errorOf(`update trade_offers set answer_seen = false`)
  await asAdmin()
  check('players cannot write answer_seen themselves', (await q(`select bool_and(answer_seen) v from trade_offers where status in ('accepted', 'declined')`))[0].v === true)
  await as(ash)
  await as(null)
  check('anon cannot call mark_trade_answers_seen', (await errorOf(`select mark_trade_answers_seen()`)) !== '')

  // ---------- Recycling a pick ----------
  await asAdmin()
  await q(`update collections set quantity = 4 where user_id = $1 and card_id = 's1-4'`, [ash]) // common, from the trade
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'challenge','s1-6',3), ($1,'challenge','s1-7',2)`, [ash]) // rares
  await as(ash)
  const coins = (await q(`select challenge_state() s`))[0].s.coins
  const values = (await q(`select challenge_recycle_value('common') c, challenge_recycle_value('rare') r`))[0]

  let result = (await q(`select recycle_cards('{s1-4,s1-6,s1-6,s1-9}') r`))[0].r
  check('recycles the picked duplicates only (3 + 2, unknown/unowned ignored)', result.recycled === 5)
  check('at the recycle prices', result.gained === 3 * values.c + 2 * values.r && result.coins === coins + result.gained)
  await asAdmin()
  const left = Object.fromEntries((await q(`select card_id, quantity from collections where user_id = $1 and card_id in ('s1-4','s1-6','s1-7')`, [ash])).map((r) => [r.card_id, r.quantity]))
  check('one copy of each pick is kept, the rest untouched', left['s1-4'] === 1 && left['s1-6'] === 1 && left['s1-7'] === 2)
  let ledger = await q(`select card_id, quantity from challenge_ledger where user_id = $1 and kind = 'recycle'`, [ash])
  check('one ledger row for the batch (no card id)', ledger.length === 1 && ledger[0].quantity === 5 && ledger[0].card_id === null)

  await as(ash)
  result = (await q(`select recycle_cards('{s1-7}') r`))[0].r
  await asAdmin()
  ledger = await q(`select card_id from challenge_ledger where user_id = $1 and kind = 'recycle' order by id`, [ash])
  check('a single pick keeps its card id in the ledger', result.recycled === 1 && ledger[1].card_id === 's1-7')
  await as(ash)
  result = (await q(`select recycle_cards('{}') r`))[0].r
  check('an empty pick recycles nothing', result.recycled === 0 && result.gained === 0)
  result = (await q(`select recycle_cards(null) r`))[0].r
  check('a null pick recycles nothing (it is not "everything")', result.recycled === 0)
  check('recycled cards count in the achievement stats', (await q(`select player_achievements('challenge') r`))[0].r.stats.recycled === 6)
  await as(misty)
  check('another player cannot touch my duplicates', (await q(`select recycle_cards('{s1-7}') r`))[0].r.recycled === 0)
  await as(null)
  check('anon cannot call recycle_cards', (await errorOf(`select recycle_cards('{s1-7}')`)) !== '')
}
