// 0010: subsets come inside their parent's packs; pack stats in player_achievements
import { addUsers, freshDb, helpers, migrationFiles, readMigration } from './harness.mjs'
import { PGlite } from '@electric-sql/pglite'

export default async function (check) {
  const db = await freshDb('0010')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values
    ('swsh9','Brilliant Stars'),('swsh9tg','BS TG'),('cel25','Celebrations'),('cel25c','Classic'),('fakec','Fake C'),('xyc','XY C'),('xy','XY');`)
  let n = 0
  const add = async (set, rarity, count) => {
    for (let i = 0; i < count; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c',$2,$3)`, [`${set}-${n++}`, rarity, set])
  }
  await add('swsh9', 'Common', 40); await add('swsh9', 'Uncommon', 30); await add('swsh9', 'Rare', 15)
  await add('swsh9', 'Rare Holo', 10); await add('swsh9', 'Ultra Rare', 8); await add('swsh9', 'Rare Secret', 4)
  await add('swsh9tg', 'Rare Holo V', 11); await add('swsh9tg', 'Ultra Rare', 17); await add('swsh9tg', 'Rare Secret', 2)
  await add('cel25', 'Rare', 12); await add('cel25', 'Rare Holo', 12)
  await add('cel25c', 'Classic Collection', 25)
  await add('xy', 'Common', 20); await add('xy', 'Uncommon', 10); await add('xy', 'Rare', 5)
  await add('xyc', 'Common', 20); await add('xyc', 'Rare', 5)

  // ---------- Linking ----------
  check('link_subsets links the gallery and the classic collection', (await q(`select link_subsets() n`))[0].n === 2)
  const sets = Object.fromEntries((await q(`select id, parent_set_id, subset_rate from sets`)).map((r) => [r.id, r]))
  check('swsh9tg -> swsh9 at 25%', sets.swsh9tg.parent_set_id === 'swsh9' && Number(sets.swsh9tg.subset_rate) === 0.25)
  check('cel25c -> cel25 at 33%', sets.cel25c.parent_set_id === 'cel25' && Number(sets.cel25c.subset_rate) === 0.33)
  check('a real set ending in c stays a set', sets.xyc.parent_set_id === null)
  check('a set without cards stays unlinked', sets.fakec.parent_set_id === null)
  check('link_subsets is idempotent', (await q(`select link_subsets() n`))[0].n === 0)

  // ---------- Packs ----------
  const PACKS = 2000
  let subsetPacks = 0, repeats = 0, slot10 = 0, outside = 0, wrongSize = 0
  for (let i = 0; i < PACKS; i++) {
    const cards = await q(`select id, set_id, rarity_bucket from open_booster('swsh9')`)
    if (cards.length !== 10) wrongSize++
    if (new Set(cards.map((c) => c.id)).size !== cards.length) repeats++
    if (cards.some((c) => c.set_id === 'swsh9tg')) subsetPacks++
    if (cards.some((c, idx) => c.set_id === 'swsh9tg' && idx !== 7)) outside++
    if (['ultra', 'secret'].includes(cards[9].rarity_bucket)) slot10++
  }
  check('packs have 10 cards', wrongSize === 0)
  check('no card twice in a pack', repeats === 0)
  check(`a subset card in ~25% of packs (${((subsetPacks / PACKS) * 100).toFixed(1)}%)`, Math.abs(subsetPacks / PACKS - 0.25) < 0.035)
  check('the subset card only replaces slot 8', outside === 0)
  check(`slot 10 odds unchanged, ~9% ultra+ (${((slot10 / PACKS) * 100).toFixed(1)}%)`, Math.abs(slot10 / PACKS - 0.09) < 0.025)
  check('open_booster(subset) opens the parent pack', (await q(`select set_id from open_booster('swsh9tg')`))[0].set_id === 'swsh9')
  check('the classic collection opens a Celebrations pack', (await q(`select set_id from open_booster('cel25c')`))[0].set_id === 'cel25')
  let anySubset = 0
  for (let i = 0; i < 200; i++) if (['swsh9tg', 'cel25c'].includes((await q(`select set_id from open_booster(null) limit 1`))[0].set_id)) anySubset++
  check('"any set" never picks a subset', anySubset === 0)
  check('an unknown set still errors', (await errorOf(`select * from open_booster('nope')`)).includes('no cards'))
  const buckets = {}
  for (let i = 0; i < 1000; i++) {
    const b = (await q(`select (pick_subset_card('swsh9tg', '{}')).rarity_bucket b`))[0].b
    buckets[b] = (buckets[b] ?? 0) + 1
  }
  check(`subset cards: mostly holo, some ultra, few secret (${JSON.stringify(buckets)})`, buckets.holo > buckets.ultra && buckets.ultra > (buckets.secret ?? 0) && buckets.secret > 0)

  // ---------- Stats ----------
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')
  await q(`update profiles set is_public = false where id = $1`, [ash])
  const open = (user, mode, set, at, hits = 0, god = false) =>
    q(`insert into booster_openings (user_id, mode, set_id, card_ids, hits, secrets, god_pack, opened_at) values ($1,$2,$3,'{}',$4,$5,$6,$7)`, [user, mode, set, hits, hits > 1 ? 1 : 0, god, at])
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05']) await open(ash, 'unlimited', 'swsh9', `${d}T10:00:00Z`)
  await open(ash, 'unlimited', 'swsh9', '2026-09-05T11:00:00Z', 2)
  await open(ash, 'unlimited', 'xy', '2026-09-05T12:00:00Z', 1)
  await open(ash, 'challenge', 'xy', '2026-09-05T12:00:00Z', 0, true)
  await db.exec(`insert into challenge_ledger (user_id, kind, amount, game_day) values
    ('${ash}','start',1000,'2026-09-01'),('${ash}','daily',200,'2026-09-01'),('${ash}','daily',250,'2026-09-02'),
    ('${ash}','daily',300,'2026-09-03'),('${ash}','daily',200,'2026-09-06'),('${ash}','booster',-100,'2026-09-06');
    insert into challenge_ledger (user_id, kind, amount, quantity, game_day) values ('${ash}','recycle',30,6,'2026-09-06'),('${ash}','craft',-200,1,'2026-09-06');
    insert into challenge_ledger (user_id, kind, amount, mission, game_day) values ('${ash}','mission',100,'open_packs','2026-09-06');
    insert into trade_offers (from_user, to_user, offer_cards, request_cards, status) values
      ('${ash}','${misty}','{a}','{b}','accepted'),('${ash}','${misty}','{a}','{}','accepted'),('${misty}','${ash}','{a}','{b}','declined');`)

  await as(ash)
  const mine = (await q(`select player_achievements('unlimited') r`))[0].r
  const s = mine.stats
  check('packs 6', mine.packs === 6 && s.packs === 6)
  check('hit packs 2, hits 3, max 2 in one pack', s.hit_packs === 2 && s.hits === 3 && s.max_hits === 2)
  check('best day 3, 4 days, longest streak 3', s.best_day === 3 && s.days === 4 && s.best_streak === 3)
  check('2 sets, most opened swsh9 x5', s.sets === 2 && s.top_set_id === 'swsh9' && s.top_set_packs === 5)
  check('no challenge fields in unlimited', !('trades' in s))
  const ch = (await q(`select player_achievements('challenge') r`))[0].r.stats
  check('challenge: 1 pack, 1 god pack', ch.packs === 1 && ch.god_packs === 1)
  check('challenge: 1 trade, 1 gift', ch.trades === 1 && ch.gifts === 1)
  check('challenge: coins earned without the start bonus', ch.coins_earned === 1080)
  check('challenge: 1 mission, 1 craft, 6 recycled', ch.missions === 1 && ch.crafted === 1 && ch.recycled === 6)
  check('challenge: best daily streak 3', ch.best_daily_streak === 3)

  await as(misty)
  check('a private profile gives null', (await q(`select player_achievements('unlimited', 'Ash') r`))[0].r === null)
  await asAdmin()
  await q(`update profiles set is_public = true where id = $1`, [ash])
  await as(null)
  check('anon reads a public profile\'s stats', (await q(`select player_achievements('challenge', 'Ash') r`))[0].r.stats.trades === 1)
  check('anon cannot run link_subsets', (await errorOf(`select link_subsets()`)) !== '')
  await as(ash)
  check('players cannot run link_subsets', (await errorOf(`select link_subsets()`)) !== '')

  // ---------- Refuses to run without 0009 ----------
  const bare = new PGlite()
  await bare.exec(`create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon; create role authenticated; create role service_role; create publication supabase_realtime;`)
  for (const file of migrationFiles().filter((f) => f < '0009')) await bare.exec(readMigration(file))
  let refused = ''
  try {
    await bare.exec(readMigration(migrationFiles().find((f) => f.startsWith('0010'))))
  } catch (err) {
    refused = err.message
  }
  check('refuses to run before 0009, and applies nothing', refused.includes('0009') && !(await bare.query(`select 1 from information_schema.columns where table_name = 'sets' and column_name = 'parent_set_id'`)).rows.length)
}
