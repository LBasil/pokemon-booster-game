// 0011: weekly challenge missions; trade_offers in the realtime publication
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0011')
  const { q, as, asAdmin, errorOf } = helpers(db)

  const week = (await q(`select challenge_week_start()::text d, extract(isodow from challenge_week_start())::int dow, challenge_today()::text t`))[0]
  check('the week starts on a Monday, on or before today', week.dow === 1 && week.d <= week.t)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 30; i++) await db.query(`insert into cards (id, name, rarity, set_id) values ($1,'c',$2,'s1')`, [`s1-${i}`, i < 20 ? 'Common' : i < 26 ? 'Uncommon' : 'Rare'])
  const [ash] = await addUsers(db, 'Ash')

  await as(ash)
  let state = (await q(`select challenge_state() s`))[0].s
  check('challenge_state has 4 weekly missions and week_start', state.weekly?.length === 4 && state.week_start === week.d)
  check('all at 0 and unclaimed', state.weekly.every((m) => m.progress === 0 && !m.claimed))
  check('an unfinished weekly mission is refused', (await errorOf(`select claim_mission('week_open_packs')`)).includes('mission_incomplete'))
  check('an unknown mission is refused', (await errorOf(`select claim_mission('nope')`)).includes('unknown_mission'))

  // 25 challenge packs this week (2 with a hit), one last week, one unlimited;
  // 50 recycled; 5 daily rewards this week and one last week
  await asAdmin()
  for (let i = 0; i < 25; i++) await q(`insert into booster_openings (user_id, mode, set_id, card_ids, hits) values ($1,'challenge','s1','{}',$2)`, [ash, i < 2 ? 1 : 0])
  await q(`insert into booster_openings (user_id, mode, set_id, card_ids, hits, opened_at) values ($1,'challenge','s1','{}',3, challenge_week_start()::timestamp at time zone 'utc' - interval '1 hour')`, [ash])
  await q(`insert into booster_openings (user_id, mode, set_id, card_ids, hits) values ($1,'unlimited','s1','{}',3)`, [ash])
  await q(`insert into challenge_ledger (user_id, kind, amount, quantity) values ($1,'recycle',50,50)`, [ash])
  for (let i = 0; i < 5; i++) await q(`insert into challenge_ledger (user_id, kind, amount, game_day) values ($1,'daily',200, challenge_week_start() + $2::int)`, [ash, i])
  await q(`insert into challenge_ledger (user_id, kind, amount, game_day) values ($1,'daily',200, challenge_week_start() - 1)`, [ash])

  await as(ash)
  state = (await q(`select challenge_state() s`))[0].s
  const w = Object.fromEntries(state.weekly.map((m) => [m.mission, m]))
  check('25/25 packs (last week and unlimited left out)', w.week_open_packs.progress === 25)
  check('2/2 ultra+ (this week\'s challenge hits only)', w.week_pull_ultra.progress === 2)
  check('50/50 recycled', w.week_recycle.progress === 50)
  check('5/5 daily rewards (last week left out)', w.week_daily.progress === 5)
  const badge = (await q(`select challenge_badge() b`))[0].b
  check('the badge counts the 4 finished weekly missions', badge.rewards >= 4)

  const claimed = (await q(`select claim_mission('week_open_packs') r`))[0].r
  check('claiming pays 400 coins', claimed.reward === 400 && claimed.coins === state.coins + 400)
  check('and marks it claimed', claimed.weekly.find((m) => m.mission === 'week_open_packs').claimed)
  check('a second claim this week is refused', (await errorOf(`select claim_mission('week_open_packs')`)).includes('already_claimed'))
  await asAdmin()
  const rows = await q(`select game_day::text d from challenge_ledger where kind = 'mission' and mission = 'week_open_packs'`)
  check('the ledger row is dated on the Monday', rows.length === 1 && rows[0].d === week.d)
  await as(ash)
  check('the badge drops the claimed mission', (await q(`select challenge_badge() b`))[0].b.rewards === badge.rewards - 1)
  check('daily missions are untouched', state.missions.find((m) => m.mission === 'open_packs').progress === 3)
  check('and still pay on the game day', (await q(`select claim_mission('open_packs') r`))[0].r.reward === 75)

  await asAdmin()
  await q(`insert into challenge_ledger (user_id, kind, amount, mission, game_day) values ($1,'mission',250,'week_recycle', challenge_week_start() - 7)`, [ash])
  await as(ash)
  state = (await q(`select challenge_state() s`))[0].s
  check('last week\'s claim does not count for this week', !state.weekly.find((m) => m.mission === 'week_recycle').claimed)
  check('players cannot call challenge_weekly_missions directly', (await errorOf(`select * from challenge_weekly_missions($1)`, [ash])) !== '')

  await asAdmin()
  check('trade_offers is in the realtime publication', (await q(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trade_offers'`)).length === 1)
  await as(ash)
  check('weekly claims count as missions in the stats (2 this week + 1 last week)', (await q(`select player_achievements('challenge') r`))[0].r.stats.missions === 3)
}
