// 0016: sets without ultra/secret cards post their holos to the live feed
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0016')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  // base1: nothing above holo. sv1: real hits. cel25c: an all-holo subset of cel25.
  await db.exec(`
    insert into sets (id, name) values ('base1', 'Base'), ('sv1', 'Scarlet & Violet'), ('cel25', 'Celebrations');
    insert into sets (id, name, parent_set_id) values ('cel25c', 'Classic Collection', 'cel25');
  `)
  const cards = [
    ['base1-c', 'Common', 'base1'], ['base1-r', 'Rare', 'base1'], ['base1-h', 'Rare Holo', 'base1'],
    ['sv1-c', 'Common', 'sv1'], ['sv1-h', 'Rare Holo', 'sv1'], ['sv1-u', 'Ultra Rare', 'sv1'], ['sv1-s', 'Hyper Rare', 'sv1'],
    ['cel25-c', 'Common', 'cel25'], ['cel25-u', 'Rare Holo V', 'cel25'], ['cel25-x', 'Ultra Rare', 'cel25'],
    ['cel25c-h', 'Classic Collection', 'cel25c'],
  ]
  for (const [id, rarity, set] of cards) await q(`insert into cards (id, name, rarity, set_id) values ($1, $1, $2, $3)`, [id, rarity, set])

  check('feed_buckets: a set with hits keeps ultra/secret', (await q(`select feed_buckets('sv1') b`))[0].b.join() === 'ultra,secret')
  check('feed_buckets: a set without adds holo', (await q(`select feed_buckets('base1') b`))[0].b.join() === 'holo,ultra,secret')

  const save = (user, mode, ids) =>
    q(`select save_booster_opening($1, $2, array(select c from cards c join unnest($3::text[]) with ordinality i(id, n) on i.id = c.id order by i.n))`, [user, mode, ids])
  const feed = async (user) => (await q(`select card_id, bucket, mode from pull_feed where user_id = $1 order by card_id`, [user]))

  await save(ash, 'unlimited', ['base1-c', 'base1-r', 'base1-h'])
  let rows = await feed(ash)
  check('a Base holo goes to the feed', rows.length === 1 && rows[0].card_id === 'base1-h' && rows[0].bucket === 'holo')

  await q(`delete from pull_feed`)
  await save(ash, 'challenge', ['base1-c', 'base1-h'])
  rows = await feed(ash)
  check('in the challenge too', rows.length === 1 && rows[0].mode === 'challenge')

  await q(`delete from pull_feed`)
  await save(ash, 'unlimited', ['sv1-c', 'sv1-h', 'sv1-u', 'sv1-s'])
  rows = await feed(ash)
  check('a set with hits still posts only ultra/secret', rows.map((r) => r.card_id).join() === 'sv1-s,sv1-u')

  await q(`delete from pull_feed`)
  await save(ash, 'unlimited', ['cel25-c', 'cel25c-h'])
  check('a holo subset card in a parent pack with hits is not posted', (await feed(ash)).length === 0)

  check('booster_openings.hits still counts ultra/secret only', await (async () => {
    const o = await q(`select set_id, hits from booster_openings where user_id = $1 order by id`, [ash])
    return o.map((r) => `${r.set_id}:${r.hits}`).join() === 'base1:0,base1:0,sv1:2,cel25:0'
  })())

  await q(`update profiles set is_public = false where id = $1`, [misty])
  await save(misty, 'unlimited', ['base1-c', 'base1-h'])
  check('a private profile posts nothing', (await feed(misty)).length === 0)

  await as(ash)
  check('players cannot call feed_buckets', (await errorOf(`select feed_buckets('base1')`)) !== '')
  check('players still cannot call save_booster_opening', (await errorOf(`select save_booster_opening($1, 'unlimited', array[]::cards[])`, [ash])) !== '')
  await asAdmin()
}
