// 0024: PvP battles (challenge mode, asynchronous)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0024')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty, brock, gary] = await addUsers(db, 'Ash', 'Misty', 'Brock', 'Gary')

  // Before populate fills attacks / series: not ready
  await as(ash)
  check('no attacks yet: not ready', (await q(`select pvp_state() s`))[0].s.ready === false)

  await asAdmin()
  await db.exec(`
    insert into sets (id, name, release_date, series) values
      ('base1', 'Base', '1999-01-09', 'Base'), ('jungle', 'Jungle', '1999-06-16', 'Base'),
      ('sv1', 'Scarlet & Violet', '2023-03-31', 'Scarlet & Violet');
    insert into sets (id, name, release_date, series, parent_set_id) values ('sv1tg', 'SV Gallery', '2023-03-31', 'Scarlet & Violet', 'sv1');
  `)
  const card = (id, set, hp, type, attacks, weak = null, resist = null, supertype = 'Pokémon') =>
    q(`insert into cards (id, name, supertype, hp, types, weaknesses, resistances, attacks, image_small, set_id)
       values ($1, $1, $2, $3, $4, $5, $6, $7, 'img', $8)`,
      [id, supertype, hp, type && [type], weak, resist, attacks && JSON.stringify(attacks), set])
  const hit = (damage, name = 'Hit') => [{ name, damage }]
  for (let i = 1; i <= 6; i++) await card(`b${i}`, 'base1', 60, 'Fire', hit('30'), ['Water'])
  for (let i = 1; i <= 5; i++) await card(`w${i}`, 'jungle', 70, 'Water', hit('20'), ['Lightning'], ['Fire'])
  for (let i = 1; i <= 5; i++) await card(`s${i}`, 'sv1', 200, 'Grass', hit('100'))
  await card('gallery', 'sv1tg', 190, 'Psychic', hit('90'))
  await card('effect', 'base1', 50, 'Psychic', [{ name: 'Sleep', damage: '' }])
  await card('noatk', 'base1', 50, 'Colorless', null)
  await card('trainer', 'base1', null, null, null, null, null, 'Trainer')
  await card('multi', 'base1', 80, 'Lightning', [{ name: 'Small', damage: '40' }, { name: 'Flips', damage: '30×' }, { name: 'Plus', damage: '50+' }])

  // Card snapshots and damage
  const [multi] = await q(`select pvp_card('multi') c`)
  check('best attack: "30×" counts 60 when choosing, beats 50+ and 40', multi.c.attack === 'Flips' && multi.c.damage === 30 && multi.c.times === true)
  check('a plain attack counts as printed', (await q(`select pvp_card('b1') c`))[0].c.damage === 30)
  check('effect-only, no attack or Trainer: cannot fight', (await q(`select pvp_card('effect') a, pvp_card('noatk') b, pvp_card('trainer') c`)).every((r) => r.a === null && r.b === null && r.c === null))
  const dmg = async (a, b, roll = 1) => (await q(`select pvp_damage(pvp_card($1), pvp_card($2), $3) d`, [a, b, roll]))[0].d
  check('plain damage', (await dmg('b1', 's1')) === 30)
  check('weakness doubles', (await dmg('w1', 'b1')) === 40)
  check('resistance takes 30 off, never under 10', (await dmg('b1', 'w1')) === 10)
  check('"30×" multiplies by the roll', (await dmg('multi', 's1', 3)) === 90 && (await dmg('multi', 's1', 1)) === 30)
  check('formats: era, set (gallery counts for its parent)', (await q(`select pvp_fits('b1', 'era:Base') a, pvp_fits('w1', 'set:base1') b, pvp_fits('gallery', 'set:sv1') c, pvp_fits('gallery', 'era:Scarlet & Violet') d, pvp_fits('s1', 'era:Base') e`))
    .every((r) => r.a && !r.b && r.c && r.d && !r.e))

  // Collections
  const give = (user, ids) => Promise.all(ids.map((id) => q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 2)`, [user, id])))
  await give(ash, ['b1', 'b2', 'b3', 'b4', 'b5', 'effect', 's1', 'gallery'])
  await give(misty, ['w1', 'w2', 'w3', 'w4', 'w5'])
  await give(brock, ['b2', 'b3', 'b4', 'b5', 'b6'])
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'unlimited', 'w1', 1)`, [gary])

  await as(null)
  check('signed out: no state', (await errorOf(`select pvp_state()`)) !== '')
  await as(ash)
  let state = (await q(`select pvp_state() s`))[0].s
  check('ready, rules sent', state.ready === true && state.deck_size === 5 && state.kos_to_win === 3 && state.battles_per_day === 10)
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

  // A battle
  await as(ash)
  state = (await q(`select pvp_start('era:Base') s`))[0].s
  let battle = state.battle
  check('battle started against the only deck', battle.status === 'playing' && battle.opponent.username === 'Misty' && battle.opponent.elo === 1000)
  check('their deck is hidden', battle.theirs.left === 5 && battle.theirs.seen.length === 0 && battle.theirs.deck === null && !JSON.stringify(battle).includes('w1'))
  check('my cards with their HP', battle.mine.length === 5 && battle.mine.every((c) => c.hp_left === 60))
  check('starting again resumes it', (await q(`select pvp_start('era:Base') s`))[0].s.battle.id === battle.id)
  check('a knocked out or unknown slot is refused', (await errorOf(`select pvp_play(7)`)).includes('pvp_invalid_card'))
  check('one battle left less today', state.battles_left === 9)

  let played = (await q(`select pvp_play(0) p`))[0].p
  check('a round: weakness hits me for 40, my Fire hits Water for 10', played.round.dealt === 10 && played.round.taken === 40)
  check('the card played is revealed', played.battle.theirs.seen.length === 1 && played.battle.theirs.seen[0].hp_left === 60)
  check('HP stays damaged', played.battle.mine[0].hp_left === 20)
  await asAdmin()
  check('the defender pick is stored before my next card', (await q(`select d_next from pvp_battles where attacker = $1`, [ash]))[0].d_next !== null)
  await as(ash)
  played = (await q(`select pvp_play(0) p`))[0].p
  check('a KO counts for them', played.battle.their_kos === 1 && played.round.ko_mine === true)
  check('a knocked out card cannot play again', (await errorOf(`select pvp_play(0)`)).includes('pvp_invalid_card'))
  // Water beats Fire: play on until it ends
  for (let slot = 1; slot < 5 && played.battle.status === 'playing'; slot++) {
    while (played.battle.status === 'playing' && played.battle.mine[slot].hp_left > 0) played = (await q(`select pvp_play($1) p`, [slot]))[0].p
  }
  battle = played.battle
  check('Water wins against Fire: I lose', battle.status === 'lost' && battle.their_kos === 3)
  check('Elo: -16 between equals', battle.elo_change === -16)
  check('the whole deck shows once it is over', battle.theirs.deck.length === 5)
  state = played.state
  check('no battle in progress, history from my side', state.battle === null && state.history[0].result === 'lost' && state.history[0].role === 'attack' && state.history[0].elo_change === -16)
  check('my rating: 984, 1 loss', state.ratings['era:Base'].elo === 984 && state.ratings['era:Base'].losses === 1)
  check('playing with no battle is refused', (await errorOf(`select pvp_play(0)`)).includes('no_game'))
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
  await q(`update collections set quantity = 1`)
  await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', 'b6', 1)`, [brock])
  await as(ash)
  check('10 battles a day', (await q(`select pvp_state() s`))[0].s.battles_left === 0 && (await errorOf(`select pvp_start('era:Base')`)).includes('pvp_no_battles_left'))

  // A draw after 15 rounds, and Elo for a win
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
  while (played.battle.status === 'playing' && n++ < 30) {
    const slot = played.battle.mine.find((c) => c.hp_left > 0).slot
    played = (await q(`select pvp_play($1) p`, [slot]))[0].p
  }
  check('a battle ends within 15 rounds', played.battle.status !== 'playing' && played.battle.round <= 15)
  check('the result follows the KOs', ({ won: played.battle.my_kos > played.battle.their_kos, lost: played.battle.my_kos < played.battle.their_kos, draw: played.battle.my_kos === played.battle.their_kos })[played.battle.status])
  check('Elo moves both ways by the same amount', await (async () => {
    await asAdmin()
    const rows = await q(`select sum(elo)::int s from pvp_ratings where format = 'set:sv1'`)
    return rows[0].s === 2000
  })())
}
