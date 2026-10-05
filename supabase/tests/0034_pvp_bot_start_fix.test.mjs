// 0034: bot battles start again (no UPDATE without a WHERE: Supabase's pg-safeupdate refuses it)
import { addUsers, freshDb, helpers, migrationFiles, readMigration, unsafeFunctions, unsafeWrites } from './harness.mjs'

export default async function (check) {
  // The scanner: what failed live, what's fine
  check('flags an UPDATE without a WHERE', unsafeWrites('begin update pvp_bot_cards set score = null; end').length === 1)
  check('flags a DELETE without a WHERE', unsafeWrites('delete from public.pvp_decks;').length === 1)
  check('a WHERE, an ON CONFLICT DO UPDATE, a comment or a string are fine', unsafeWrites(`
    update public.pvp_battles b set game = g where b.id = v_id;
    insert into t (a) values (1) on conflict (a) do update set a = excluded.a;
    -- update t set a = 1;
    raise notice 'update t set a = 1;';
    delete from t where a = 1;`).length === 0)
  check("0032's pvp_bot_deck is flagged", unsafeWrites(readMigration(migrationFiles().find((f) => f.startsWith('0032')))).some((s) => s.includes('pvp_bot_cards')))

  const db = await freshDb('0034')
  const { q, as, asAdmin } = helpers(db)
  const unsafe = await unsafeFunctions(db)
  check(`no function writes without a WHERE${unsafe.length ? ` (${unsafe.map((f) => f.name).join(', ')})` : ''}`, unsafe.length === 0)

  // A bot battle starts, at every level
  const [bazouk] = await addUsers(db, 'Bazouk')
  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = { name: 'Hit', damage: '30', base: 30, cost: 1, energy: ['Colorless'], text: '', fx: [], coins: null, partial: false }
  for (let i = 0; i < 24; i++) {
    await q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
      values ($1, $2, 'Pokémon', '{Basic}', $3, '{Fire}', '{Water}', $4, 'img', 'base1')`, [`c${i}`, `Mon ${i}`, 50 + i * 5, JSON.stringify([attack])])
    await q(`insert into collections (user_id, card_id, quantity, mode) values ($1, $2, 2, 'challenge')`, [bazouk, `c${i}`])
  }
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]
  await as(bazouk)
  const deck = Array.from({ length: 10 }, (_, i) => [`c${i}`, `c${i}`]).flat()
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [deck])
  for (const level of ['easy', 'normal', 'hard']) {
    const state = await one(`select pvp_bot_start('all', $1)`, [level])
    check(`a ${level} bot battle starts`, state.battle?.status === 'playing' && state.battle.bot === level)
    await one(`select pvp_forfeit()`)
  }
  await asAdmin()
}
