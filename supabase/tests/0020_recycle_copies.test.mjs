// 0020: recycling some copies of a card (recycle_card_copies)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0020')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 6; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c',$2,'s1')`, [`s1-${i}`, i < 3 ? 'Common' : 'Rare'])
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')
  for (const [card, quantity] of [['s1-0', 5], ['s1-1', 3], ['s1-3', 4], ['s1-4', 1]]) {
    await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'challenge',$2,$3)`, [ash, card, quantity])
  }
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1,'unlimited','s1-0',9)`, [ash])

  await as(ash)
  const coins = (await q(`select challenge_state() s`))[0].s.coins
  const values = (await q(`select challenge_recycle_value('common') c, challenge_recycle_value('rare') r`))[0]
  const quantities = async () => {
    await asAdmin()
    const rows = await q(`select card_id, mode, quantity from collections where user_id = $1`, [ash])
    await as(ash)
    return Object.fromEntries(rows.map((r) => [`${r.mode === 'unlimited' ? 'u:' : ''}${r.card_id}`, r.quantity]))
  }

  let result = (await q(`select recycle_card_copies('{"s1-0": 2, "s1-3": 1}') r`))[0].r
  check('recycles the asked copies only (2 + 1)', result.recycled === 3)
  check('at the recycle prices', result.gained === 2 * values.c + values.r && result.coins === coins + result.gained)
  let left = await quantities()
  check('the rest stays', left['s1-0'] === 3 && left['s1-3'] === 3 && left['s1-1'] === 3)
  check('the unlimited collection is untouched', left['u:s1-0'] === 9)

  result = (await q(`select recycle_card_copies('{"s1-1": 10}') r`))[0].r
  left = await quantities()
  check('asking for more than the duplicates keeps one copy', result.recycled === 2 && left['s1-1'] === 1)

  result = (await q(`select recycle_card_copies('{"s1-0": 0, "s1-3": -2, "s1-4": 1, "s1-5": 1, "s1-1": 1, "nope": 3, "s1-0x": "2"}') r`))[0].r
  left = await quantities()
  check('zero, negative, single copies, unowned, unknown and non-numbers are ignored', result.recycled === 0 && result.gained === 0 && left['s1-0'] === 3 && left['s1-3'] === 3)
  check('a null or non-object pick recycles nothing', (await q(`select recycle_card_copies(null) r`))[0].r.recycled === 0 && (await q(`select recycle_card_copies('["s1-0"]') r`))[0].r.recycled === 0)

  const ledger = await q(`select card_id, quantity from challenge_ledger where user_id = $1 and kind = 'recycle' order by id`, [ash])
  check('one ledger row per call that recycled something', ledger.length === 2)
  check('several cards: no card id, total quantity', ledger[0].card_id === null && ledger[0].quantity === 3)
  check('a single card keeps its id', ledger[1].card_id === 's1-1' && ledger[1].quantity === 2)
  check('recycled copies count in the achievement stats', (await q(`select player_achievements('challenge') r`))[0].r.stats.recycled === 5)

  await as(misty)
  check('another player cannot touch my duplicates', (await q(`select recycle_card_copies('{"s1-0": 1}') r`))[0].r.recycled === 0)
  await as(null)
  check('anon cannot call recycle_card_copies', (await errorOf(`select recycle_card_copies('{"s1-0": 1}')`)) !== '')
  await as(ash)
  check('players still cannot write their collection', (await errorOf(`update collections set quantity = 99 where card_id = 's1-0'`)) !== '' || (await quantities())['s1-0'] === 3)
}
