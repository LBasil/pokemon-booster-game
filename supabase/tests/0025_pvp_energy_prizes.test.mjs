// 0025: PvP energy and prize cards (on top of 0024's battles)
import { addUsers, freshDb, helpers, readMigration } from './harness.mjs'

export default async function (check) {
  // 0024 first, with a battle in progress, then 0025 (twice)
  const db = await freshDb('0024')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty, brock, gary] = await addUsers(db, 'Ash', 'Misty', 'Brock', 'Gary')
  await q(`insert into pvp_ratings (user_id, format, elo) values ($1, 'all', 1000), ($2, 'all', 1000)`, [ash, misty])
  await q(`insert into pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, d_next, a_kos, d_kos)
           values ($1, $2, 'all', '[{"id":"x","damage":30}]', '[{"id":"y","damage":30}]', '{60}', '{0}', 0, 1, 0)`, [ash, misty])
  await q(`insert into pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, a_kos, d_kos, status)
           values ($1, $2, 'all', '[]', '[]', '{}', '{}', 3, 1, 'won')`, [ash, misty])
  await db.exec(readMigration('0025_pvp_energy_prizes.sql'))
  await db.exec(readMigration('0025_pvp_energy_prizes.sql'))
  const old = await q(`select status, a_prizes, d_prizes, elo_change from pvp_battles order by id`)
  check('a 0024 battle in progress ends as a draw, Elo untouched', old[0].status === 'draw' && old[0].elo_change === 0
    && (await q(`select sum(elo)::int s from pvp_ratings`))[0].s === 2000)
  check('0024 KOs become prizes', old[0].a_prizes === 1 && old[1].a_prizes === 3 && old[1].d_prizes === 1 && old[1].status === 'won')
  check('the KO columns are gone', (await q(`select count(*)::int n from information_schema.columns where table_name = 'pvp_battles' and column_name like '%_kos'`))[0].n === 0)
  check('the old signatures are gone', (await q(`select to_regprocedure('pvp_play(int)') is null and to_regprocedure('pvp_damage(jsonb,jsonb,int)') is null
    and to_regprocedure('pvp_defender_pick(jsonb,int[],jsonb)') is null and to_regprocedure('pvp_play(int,int)') is not null as ok`))[0].ok)
  await asAdmin()
  await q(`delete from pvp_battles`)

  // Before populate fills attacks with their cost / series: not ready
  await as(ash)
  check('no attacks yet: not ready', (await q(`select pvp_state() s`))[0].s.ready === false)
  await asAdmin()
  await db.exec(`insert into sets (id, name, series) values ('old', 'Old', 'Old'); insert into cards (id, name, supertype, hp, attacks, set_id) values ('nocost', 'No cost', 'Pokémon', 60, '[{"name":"Hit","damage":"30"}]', 'old')`)
  await as(ash)
  check('attacks imported without their cost (a 0024 sync): still not ready', (await q(`select pvp_state() s`))[0].s.ready === false)
  await asAdmin()
  await db.exec(`delete from cards where id = 'nocost'; delete from sets where id = 'old'`)

  await asAdmin()
  await db.exec(`
    insert into sets (id, name, release_date, series) values
      ('base1', 'Base', '1999-01-09', 'Base'), ('jungle', 'Jungle', '1999-06-16', 'Base'),
      ('sv1', 'Scarlet & Violet', '2023-03-31', 'Scarlet & Violet');
    insert into sets (id, name, release_date, series, parent_set_id) values ('sv1tg', 'SV Gallery', '2023-03-31', 'Scarlet & Violet', 'sv1');
  `)
  const card = (id, set, hp, type, attacks, { weak = null, resist = null, subtypes = ['Basic'], supertype = 'Pokémon' } = {}) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, resistances, attacks, image_small, set_id)
       values ($1, $1, $2, $3, $4, $5, $6, $7, $8, 'img', $9)`,
      [id, supertype, subtypes, hp, type && [type], weak, resist, attacks && JSON.stringify(attacks), set])
  const FIRE = [{ name: 'Ember', damage: '30', cost: 1 }, { name: 'Fire Blast', damage: '90', cost: 3 }]
  for (let i = 1; i <= 6; i++) await card(`b${i}`, 'base1', 60, 'Fire', FIRE, { weak: ['Water'] })
  for (let i = 1; i <= 5; i++) await card(`w${i}`, 'jungle', 70, 'Water', [{ name: 'Bubble', damage: '20', cost: 1 }], { weak: ['Lightning'], resist: ['Fire'] })
  for (let i = 1; i <= 5; i++) await card(`s${i}`, 'sv1', 200, 'Grass', [{ name: 'Leaf', damage: '60', cost: 2 }, { name: 'Solar', damage: '180', cost: 4 }], { subtypes: ['Basic', 'ex'] })
  await card('gallery', 'sv1tg', 190, 'Psychic', [{ name: 'Psy', damage: '90', cost: 2 }])
  await card('effect', 'base1', 50, 'Psychic', [{ name: 'Sleep', damage: '', cost: 1 }])
  await card('noatk', 'base1', 50, 'Colorless', null)
  await card('trainer', 'base1', null, null, null, { supertype: 'Trainer', subtypes: ['Item'] })
  await card('multi', 'base1', 80, 'Lightning', [{ name: 'Flips', damage: '30×', cost: 2 }, { name: 'Sleepy', damage: '', cost: 0 }, { name: 'Big', damage: '50+', cost: 7 }, { name: 'Free', damage: '10' }])

  // Prizes (the real rule boxes)
  const prizes = async (subtypes) => (await q(`select pvp_prizes($1) p`, [subtypes]))[0].p
  check('a plain Pokémon gives 1 prize', (await prizes(['Stage 2'])) === 1)
  check('ex, EX, GX, V, VSTAR give 2', (await Promise.all([['Basic', 'ex'], ['EX'], ['GX'], ['V'], ['VSTAR'], ['MEGA', 'EX']].map(prizes))).every((p) => p === 2))
  check('VMAX, TAG TEAM, V-UNION and Mega ex give 3', (await Promise.all([['VMAX'], ['Basic', 'TAG TEAM', 'GX'], ['V-UNION'], ['Stage 1', 'MEGA', 'ex']].map(prizes))).every((p) => p === 3))

  // Card snapshots: damaging attacks, cheapest first, cost capped at 5
  const [multi] = await q(`select pvp_card('multi') c`)
  check('only damaging attacks, cheapest first', multi.c.attacks.map((a) => a.name).join() === 'Free,Flips,Big')
  check('"30×" is flagged, "50+" counts 50, a missing cost is 0, 7 is capped at 5',
    multi.c.attacks[1].times === true && multi.c.attacks[1].damage === 30 && multi.c.attacks[2].damage === 50
    && multi.c.attacks[0].cost === 0 && multi.c.attacks[2].cost === 5)
  check('an ex snapshot says 2 prizes', (await q(`select pvp_card('s1') c`))[0].c.prizes === 2)
  check('effect-only, no attack or Trainer: cannot fight', (await q(`select pvp_card('effect') a, pvp_card('noatk') b, pvp_card('trainer') c`)).every((r) => r.a === null && r.b === null && r.c === null))
  const dmg = async (a, i, b, roll = 1) => (await q(`select pvp_damage(pvp_card($1), pvp_card($1)->'attacks'->$2::int, pvp_card($3), $4) d`, [a, i, b, roll]))[0].d
  check('plain damage', (await dmg('b1', 0, 's1')) === 30 && (await dmg('b1', 1, 's1')) === 90)
  check('weakness doubles', (await dmg('w1', 0, 'b1')) === 40)
  check('resistance takes 30 off, never under 10', (await dmg('b1', 0, 'w1')) === 10)
  check('"30×" multiplies by the roll', (await dmg('multi', 1, 's1', 3)) === 90)
  check('no attack deals 0', (await q(`select pvp_damage(pvp_card('b1'), null, pvp_card('s1'), 1) d`))[0].d === 0)
  check('formats: era, set (gallery counts for its parent)', (await q(`select pvp_fits('b1', 'era:Base') a, pvp_fits('w1', 'set:base1') b, pvp_fits('gallery', 'set:sv1') c, pvp_fits('gallery', 'era:Scarlet & Violet') d, pvp_fits('s1', 'era:Base') e`))
    .every((r) => r.a && !r.b && r.c && r.d && !r.e))

  // Defender AI: always an affordable attack (or none) of a living card
  let aiOk = true
  for (let i = 0; i < 40; i++) {
    const energy = i % 6
    const [pick] = await q(`select * from pvp_defender_pick(jsonb_build_array(pvp_card('b1'), pvp_card('b2'), pvp_card('s1')), '{0,60,200}', $1, pvp_card('w1'))`, [energy])
    const deck = ['b1', 'b2', 's1']
    if (pick.pick_slot === 0) aiOk = false
    if (pick.pick_attack !== null) {
      const [c] = await q(`select pvp_card($1) c`, [deck[pick.pick_slot]])
      if (c.c.attacks[pick.pick_attack].cost > energy) aiOk = false
    }
  }
  check('the AI never plays a knocked out card or an attack it cannot pay for', aiOk)
  const [rich] = await q(`select * from pvp_defender_pick(jsonb_build_array(pvp_card('s1')), '{200}', 5, null)`)
  check('with energy to spare, the AI goes for its big attack', rich.pick_attack === 1)

  // Collections
  const give = async (user, ids) => {
    for (const id of ids) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 2)`, [user, id])
  }
  await give(ash, ['b1', 'b2', 'b3', 'b4', 'b5', 'effect', 's1', 'gallery'])
  await give(misty, ['w1', 'w2', 'w3', 'w4', 'w5'])
  await give(brock, ['b2', 'b3', 'b4', 'b5', 'b6'])
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'unlimited', 'w1', 1)`, [gary])

  await as(null)
  check('signed out: no state', (await errorOf(`select pvp_state()`)) !== '')
  await as(ash)
  let state = (await q(`select pvp_state() s`))[0].s
  check('ready, rules sent', state.ready === true && state.deck_size === 5 && state.prizes_to_win === 3 && state.max_energy === 5 && state.battles_per_day === 10)
  check('formats count my cards that can fight', state.formats.all === 7
    && state.formats.eras.map((e) => `${e.series}:${e.owned}`).join() === 'Base:5,Scarlet & Violet:2'
    && state.formats.sets.find((s) => s.set_id === 'sv1')?.owned === 2 && !state.formats.sets.some((s) => s.set_id === 'sv1tg'))
  const eligible = (await q(`select pvp_eligible('era:Base') e`))[0].e
  check('eligible cards: owned, fitting, able to fight', eligible.length === 5 && !eligible.some((c) => c.id === 'effect'))
  check('a subset is not a format', (await errorOf(`select pvp_eligible('set:sv1tg')`)).includes('pvp_invalid_format'))
  check('players cannot read decks, ratings or battles', (await Promise.all(['pvp_decks', 'pvp_ratings', 'pvp_battles'].map((t) => errorOf(`select * from ${t}`)))).every((e) => e !== ''))
  check('internal functions are closed', (await errorOf(`select pvp_finish(1, 'won')`)) !== '' && (await errorOf(`select pvp_card('b1')`)) !== '')

  // Decks
  check('4 cards: refused', (await errorOf(`select pvp_save_deck('era:Base', '{b1,b2,b3,b4}')`)).includes('pvp_invalid_deck'))
  check('the same card twice: refused', (await errorOf(`select pvp_save_deck('era:Base', '{b1,b1,b2,b3,b4}')`)).includes('pvp_invalid_deck'))
  check('a card that cannot fight: refused', (await errorOf(`select pvp_save_deck('era:Base', '{b1,b2,b3,b4,effect}')`)).includes('pvp_invalid_deck'))
  check('a card from another era: refused', (await errorOf(`select pvp_save_deck('era:Base', '{b1,b2,b3,b4,s1}')`)).includes('pvp_invalid_deck'))
  check('a card I do not own: refused', (await errorOf(`select pvp_save_deck('era:Base', '{b1,b2,b3,b4,b6}')`)).includes('pvp_invalid_deck'))
  check('no deck: cannot attack', (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_no_deck'))
  state = (await q(`select pvp_save_deck('era:Base', '{b1,b2,b3,b4,b5}') s`))[0].s
  check('deck saved, rating at 1000', state.decks['era:Base'].valid && state.decks['era:Base'].cards.length === 5 && state.ratings['era:Base'].elo === 1000)
  check('nobody else has a deck: no opponent', (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_no_opponent'))

  await as(gary)
  check('unlimited cards do not count', (await errorOf(`select pvp_save_deck('all', '{w1,w2,w3,w4,w5}')`)).includes('pvp_invalid_deck'))
  await as(misty)
  await q(`select pvp_save_deck('era:Base', '{w1,w2,w3,w4,w5}')`)

  // A battle. The defender's next move is forced as the admin when a check needs it
  const force = async (slot, attack) => {
    await asAdmin()
    await q(`update pvp_battles set d_next = $2, d_next_attack = $3 where attacker = $1 and status = 'playing'`, [ash, slot, attack])
    await as(ash)
  }
  await as(ash)
  state = (await q(`select pvp_start('era:Base') s`))[0].s
  let battle = state.battle
  check('battle started against the only deck', battle.status === 'playing' && battle.opponent.username === 'Misty' && battle.opponent.elo === 1000)
  check('their deck is hidden, and so is their next move', battle.theirs.left === 5 && battle.theirs.seen.length === 0 && battle.theirs.deck === null
    && !JSON.stringify(battle).includes('w1') && !('d_next' in battle))
  check('both start with 1 energy and 0 prizes', battle.my_energy === 1 && battle.their_energy === 1 && battle.my_prizes === 0 && battle.their_prizes === 0)
  check('my cards come with their attacks', battle.mine.length === 5 && battle.mine.every((c) => c.hp_left === 60 && c.attacks.length === 2))
  check('starting again resumes it', (await q(`select pvp_start('era:Base') s`))[0].s.battle.id === battle.id)
  check('an unknown slot is refused', (await errorOf(`select pvp_play(7, 0)`)).includes('pvp_invalid_card'))
  check('an unknown attack is refused', (await errorOf(`select pvp_play(0, 5)`)).includes('pvp_invalid_attack'))
  check('an attack I cannot pay for is refused', (await errorOf(`select pvp_play(0, 1)`)).includes('pvp_not_enough_energy'))
  check('one battle left less today', state.battles_left === 9)

  await force(0, 0)
  let played = (await q(`select pvp_play(0, 0) p`))[0].p
  check('a round: Ember on Water is resisted (10), Bubble hits my weakness (40)', played.round.dealt === 10 && played.round.taken === 40)
  check('energy: both paid 1 and got 1 back', played.battle.my_energy === 1 && played.battle.their_energy === 1)
  check('the card played is revealed', played.battle.theirs.seen.length === 1 && played.battle.theirs.seen[0].hp_left === 60)
  await asAdmin()
  check('the defender pick is stored before my next card', (await q(`select d_next from pvp_battles where attacker = $1`, [ash]))[0].d_next !== null)
  await as(ash)

  // Saving up: no attack = the hit is taken, the energy kept
  await force(1, null)
  played = (await q(`select pvp_play(1, null) p`))[0].p
  check('no attack on either side: nothing happens, energy grows', played.round.dealt === 0 && played.round.taken === 0 && played.battle.my_energy === 2 && played.battle.their_energy === 2)
  await force(1, null)
  played = (await q(`select pvp_play(1, null) p`))[0].p
  check('3 energies: the big attack is affordable', played.battle.my_energy === 3)
  await force(1, null)
  played = (await q(`select pvp_play(1, 1) p`))[0].p
  check('Fire Blast: 90, minus 30 resisted, costs 3', played.round.dealt === 60 && played.battle.my_energy === 1)
  await force(1, 0)
  played = (await q(`select pvp_play(1, 0) p`))[0].p
  check('a KO takes 1 prize for a plain Pokémon', played.round.ko_theirs === true && played.battle.my_prizes === 1)

  await force(2, 0)
  played = (await q(`select pvp_play(0, 0) p`))[0].p
  check('a knocked out card of mine gives them a prize', played.round.ko_mine === true && played.battle.their_prizes === 1)
  check('a knocked out card cannot play again', (await errorOf(`select pvp_play(0, 0)`)).includes('pvp_invalid_card'))
  // Water beats Fire: play on with the cheap attack until it ends
  for (let slot = 1; slot < 5 && played.battle.status === 'playing'; slot++) {
    while (played.battle.status === 'playing' && played.battle.mine[slot].hp_left > 0) played = (await q(`select pvp_play($1, 0) p`, [slot]))[0].p
  }
  battle = played.battle
  check('3 prizes end it: I lose', battle.status === 'lost' && battle.their_prizes >= 3)
  check('Elo: -16 between equals', battle.elo_change === -16)
  check('the whole deck shows once it is over', battle.theirs.deck.length === 5)
  state = played.state
  check('no battle in progress, history from my side', state.battle === null && state.history[0].result === 'lost' && state.history[0].role === 'attack' && state.history[0].elo_change === -16)
  check('my rating: 984, 1 loss', state.ratings['era:Base'].elo === 984 && state.ratings['era:Base'].losses === 1)
  check('playing with no battle is refused', (await errorOf(`select pvp_play(0, 0)`)).includes('no_game'))
  await as(misty)
  state = (await q(`select pvp_state() s`))[0].s
  check('the defender sees the defense won, +16', state.ratings['era:Base'].elo === 1016 && state.ratings['era:Base'].def_wins === 1 && state.history[0].role === 'defense' && state.history[0].result === 'won' && state.history[0].elo_change === 16)

  // Leaderboard: public only
  let board = (await q(`select pvp_leaderboard('era:Base') b`))[0].b
  check('leaderboard by Elo with my row', board.rows.map((r) => r.username).join() === 'Misty,Ash' && board.me.rank === 1 && board.rows[0].wins === 1)
  await asAdmin()
  await q(`update profiles set is_public = false where id = $1`, [misty])
  await as(ash)
  board = (await q(`select pvp_leaderboard('era:Base') b`))[0].b
  check('private profiles are not ranked', board.rows.map((r) => r.username).join() === 'Ash')

  // Matchmaking: close Elo, private name hidden, last opponent last
  await as(brock)
  await q(`select pvp_save_deck('era:Base', '{b2,b3,b4,b5,b6}')`)
  await as(ash)
  state = (await q(`select pvp_start('era:Base') s`))[0].s
  check('the last opponent comes last: Brock now', state.battle.opponent.username === 'Brock')
  const forfeit = (await q(`select pvp_forfeit() f`))[0].f
  check('giving up is a loss', forfeit.battle.status === 'forfeit' && forfeit.state.history[0].result === 'lost' && forfeit.battle.elo_change < 0)
  check('giving up with no battle is refused', (await errorOf(`select pvp_forfeit()`)).includes('no_game'))
  state = (await q(`select pvp_start('era:Base') s`))[0].s
  check('a private player can be drawn, without their name', state.battle.opponent.username === null)
  await q(`select pvp_forfeit()`)

  // A deck whose cards left the collection is skipped (and says so)
  await asAdmin()
  await q(`delete from collections where user_id = $1 and card_id = 'b6'`, [brock])
  await q(`delete from collections where user_id = $1 and card_id = 'w5'`, [misty])
  await as(ash)
  check('opponents without their cards are skipped', (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_no_opponent'))
  await as(misty)
  check('my deck says it is no longer valid', (await q(`select pvp_state() s`))[0].s.decks['era:Base'].valid === false)
  check('and cannot attack', (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_invalid_deck'))

  // Daily limit
  await asAdmin()
  await q(`update pvp_battles set game_day = challenge_today()`)
  await q(`insert into pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, status)
           select $1, $2, 'era:Base', '[]', '[]', '{}', '{}', 'lost' from generate_series(1, 7)`, [ash, misty])
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', 'b6', 1)`, [brock])
  await as(ash)
  check('10 battles a day', (await q(`select pvp_state() s`))[0].s.battles_left === 0 && (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_no_battles_left'))

  // ex decks: a KO is worth 2 prizes, and every battle ends
  await asAdmin()
  await q(`delete from pvp_battles`)
  await q(`update pvp_ratings set elo = 1000`)
  await give(ash, ['s2', 's3', 's4', 's5'])
  await give(gary, ['s1', 's2', 's3', 's4', 's5'])
  await as(gary)
  await q(`select pvp_save_deck('set:sv1', '{s1,s2,s3,s4,s5}')`)
  await as(ash)
  await q(`select pvp_save_deck('set:sv1', '{s1,s2,s3,s4,gallery}')`)
  state = (await q(`select pvp_start('set:sv1') s`))[0].s
  let n = 0
  played = { battle: state.battle }
  let exKo = null
  while (played.battle.status === 'playing' && n++ < 40) {
    const card = played.battle.mine.find((c) => c.hp_left > 0)
    // The strongest attack I can pay for
    const attack = card.attacks.map((a, i) => ({ ...a, i })).filter((a) => a.cost <= played.battle.my_energy).at(-1)
    const before = played.battle.my_prizes
    played = (await q(`select pvp_play($1, $2) p`, [card.slot, attack?.i ?? null]))[0].p
    if (played.round.ko_theirs && exKo === null) exKo = played.battle.my_prizes - before
  }
  check('knocking out an ex takes 2 prizes', exKo === null || exKo === 2)
  check('a battle ends within 20 rounds', played.battle.status !== 'playing' && played.battle.round <= 20)
  check('the result follows the prizes', ({ won: played.battle.my_prizes > played.battle.their_prizes, lost: played.battle.my_prizes < played.battle.their_prizes, draw: played.battle.my_prizes === played.battle.their_prizes })[played.battle.status])
  check('Elo moves both ways by the same amount', await (async () => {
    await asAdmin()
    const rows = await q(`select sum(elo)::int s from pvp_ratings where format = 'set:sv1'`)
    return rows[0].s === 2000
  })())
}
