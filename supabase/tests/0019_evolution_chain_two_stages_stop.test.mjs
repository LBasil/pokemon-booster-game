// 0019: "Evolution chain" two-stage lines + Stop
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0019')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  await db.exec(`insert into sets (id, name) values ('s1','Set One');`)
  const card = (id, name, stage, from, dex, type) =>
    q(`insert into cards (id, name, supertype, subtypes, evolves_from, national_pokedex_number, types, image_small, set_id)
       values ($1, $2, 'Pokémon', $3, $4, $5, $6, 'img', 's1')`, [id, name, [stage], from, dex, [type]])

  // Only a two-stage line at first: the game is ready with it alone
  await card('pika', 'Pikachu', 'Basic', null, 25, 'Lightning')
  await card('rai', 'Raichu', 'Stage 1', 'Pikachu', 26, 'Lightning')
  await as(ash)
  check('a two-stage line is enough to be ready', (await q(`select evolution_chain_state() s`))[0].s.ready === true)
  let state = (await q(`select evolution_chain_start() s`))[0].s
  check('with no three-stage line, the two-stage one is drawn', state.run.length === 2 && state.run.cards.length === 2)
  await q(`select evolution_chain_stop()`)

  await asAdmin()
  await card('karp', 'Magikarp', 'Basic', null, 129, 'Water')
  await card('gyara', 'Gyarados', 'Stage 1', 'Magikarp', 130, 'Water')
  await card('char', 'Charmander', 'Basic', null, 4, 'Fire')
  await card('meleon', 'Charmeleon', 'Stage 1', 'Charmander', 5, 'Fire')
  await card('zard', 'Charizard ex', 'Stage 2', 'Charmeleon', 6, 'Fire')
  await card('squirt', 'Squirtle', 'Basic', null, 7, 'Water')
  await card('wart', 'Wartortle', 'Stage 1', 'Squirtle', 8, 'Water')
  await card('blast', 'Blastoise', 'Stage 2', 'Wartortle', 9, 'Water')
  await card('mew', 'Mewtwo', 'Basic', null, 150, 'Psychic')

  // Draws, checked as the admin
  const TWO = { pika: 'rai', karp: 'gyara' }
  const THREE = { char: ['meleon', 'zard'], squirt: ['wart', 'blast'] }
  let twos = 0
  let threes = 0
  let linesOk = true
  for (let i = 0; i < 100; i++) {
    const [row] = await q(`select * from evolution_chain_question(0)`)
    const [base, ...rest] = row.q_chain
    if (rest.length === 1 && TWO[base] === rest[0]) twos++
    else if (rest.length === 2 && THREE[base]?.join() === rest.join()) threes++
    else linesOk = false
    if (row.q_cards.length !== row.q_chain.length) linesOk = false
  }
  check('lines have 2 or 3 stages, Basic first', linesOk)
  check('both kinds come up (about 2 in 5 are two-stage)', twos >= 15 && twos <= 70 && threes >= 30)
  check('a three-stage line is never cut short', (await q(`select count(*)::int n from generate_series(1, 60) g, lateral evolution_chain_line(2) l where l = array['char','meleon'] or l = array['squirt','wart']`))[0].n === 0)
  const [late] = await q(`select * from evolution_chain_question(10)`)
  check('intruders come on top of a line', late.q_cards.length === late.q_chain.length + 2)

  // A two-stage run: pick exactly 2
  await as(ash)
  await q(`select evolution_chain_start()`)
  await asAdmin()
  await q(`update evolution_chain_runs set chain = '{pika,rai}', cards = '{rai,mew,pika}' where user_id = $1 and status = 'playing'`, [ash])
  await as(ash)
  state = (await q(`select evolution_chain_state() s`))[0].s
  check('the run says how many cards to pick', state.run.length === 2 && state.run.cards.length === 3)
  check('3 picks for a two-stage line are refused', (await errorOf(`select evolution_chain_answer(array['pika','rai','mew'])`)).includes('invalid_pick'))
  check('the same card twice is refused', (await errorOf(`select evolution_chain_answer(array['pika','pika'])`)).includes('invalid_pick'))
  let answer = (await q(`select evolution_chain_answer(array['pika','rai']) a`))[0].a
  check('the right order of a two-stage line pays', answer.correct && answer.earned === 3 && JSON.stringify(answer.chain) === '["pika","rai"]')

  // Stop: coins stay, the streak counts for the best
  const coinsBefore = answer.state.coins
  const stopped = (await q(`select evolution_chain_stop() s`))[0].s
  check('stopping ends the run', stopped.state.run === null && stopped.streak === 1 && stopped.run_coins === 3)
  check('the coins earned stay', stopped.state.coins === coinsBefore && stopped.state.today_coins === 3)
  check('the streak counts for the best', stopped.state.best === 1)
  check('stopping with no run is refused', (await errorOf(`select evolution_chain_stop()`)).includes('no_game'))
  await asAdmin()
  check('the run is kept as stopped', (await q(`select count(*)::int n from evolution_chain_runs where user_id = $1 and status = 'stopped'`, [ash]))[0].n === 2)
  await as(ash)
  check('a stopped run still used a paid run', (await q(`select evolution_chain_state() s`))[0].s.paid_left === 1)

  // Stopping only touches my own run
  await q(`select evolution_chain_start()`)
  await as(misty)
  check('another player cannot stop it', (await errorOf(`select evolution_chain_stop()`)).includes('no_game'))
  await as(ash)
  check('it is still mine to play', (await q(`select evolution_chain_state() s`))[0].s.run !== null)

  await as(null)
  check('signed out: no stop', (await errorOf(`select evolution_chain_stop()`)) !== '')
  await as(ash)
  check('players cannot draw lines themselves', (await errorOf(`select evolution_chain_line(2)`)) !== '')
}
