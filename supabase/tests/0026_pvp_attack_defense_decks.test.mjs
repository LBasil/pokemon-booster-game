// 0026: PvP attack and defense decks, attacks without a cost never free
import { addUsers, freshDb, helpers, readMigration } from './harness.mjs'

export default async function (check) {
  // 0025 first, with a deck saved the old way, then 0026 (twice)
  const db = await freshDb('0025')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty, brock] = await addUsers(db, 'Ash', 'Misty', 'Brock')

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const card = (id, hp, type, attacks, weak = null) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
       values ($1, $1, 'Pokémon', '{Basic}', $2, $3, $4, $5, 'img', 'base1')`,
      [id, hp, [type], weak, JSON.stringify(attacks)])
  const FIRE = [{ name: 'Ember', damage: '30', cost: 1 }, { name: 'Fire Blast', damage: '90', cost: 3 }]
  const WATER = [{ name: 'Bubble', damage: '20', cost: 1 }]
  const GRASS = [{ name: 'Vine', damage: '20', cost: 1 }]
  for (let i = 1; i <= 6; i++) await card(`f${i}`, 60, 'Fire', FIRE, ['Water'])
  for (let i = 1; i <= 5; i++) await card(`w${i}`, 70, 'Water', WATER, ['Grass'])
  for (let i = 1; i <= 5; i++) await card(`g${i}`, 70, 'Grass', GRASS, ['Fire'])
  // A 0024-era import: the big attack has no cost yet, the small one is free on the card
  await card('half', 80, 'Lightning', [{ name: 'Zap', damage: '10', cost: 0 }, { name: 'Thunder', damage: '120' }])
  await card('nocost', 80, 'Lightning', [{ name: 'Thunder', damage: '120' }])

  const give = async (user, ids) => {
    for (const id of ids) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 1)`, [user, id])
  }
  await give(ash, ['f1', 'f2', 'f3', 'f4', 'f5', 'w1', 'w2', 'w3', 'w4', 'w5', 'half', 'nocost'])
  await give(misty, ['w1', 'w2', 'w3', 'w4', 'w5', 'g1', 'g2', 'g3', 'g4', 'g5'])
  await give(brock, ['f2', 'f3', 'f4', 'f5', 'f6'])

  await as(misty)
  await q(`select pvp_save_deck('all', '{w1,w2,w3,w4,w5}')`)
  await asAdmin()
  check('0025: "nocost" could fight with a free 120', (await q(`select pvp_card('nocost') c`))[0].c.attacks[0].cost === 0)

  await db.exec(readMigration('0026_pvp_attack_defense_decks.sql'))
  await db.exec(readMigration('0026_pvp_attack_defense_decks.sql'))

  // 1. No free attacks by mistake
  const [half] = await q(`select pvp_card('half') c`)
  check('an attack without a cost is dropped, a printed 0 stays', half.c.attacks.length === 1 && half.c.attacks[0].name === 'Zap' && half.c.attacks[0].cost === 0)
  check('a card whose only attack has no cost cannot fight', (await q(`select pvp_card('nocost') c`))[0].c === null)
  check('costs still read as before', (await q(`select pvp_card('f1') c`))[0].c.attacks.map((a) => a.cost).join() === '1,3')

  // 2. Deck roles
  const old = await q(`select role, card_ids from pvp_decks where user_id = $1`, [misty])
  check('a deck saved before 0026 is an attack deck', old.length === 1 && old[0].role === 'attack')
  check('the old signature is gone', (await q(`select to_regprocedure('pvp_save_deck(text,text[])') is null as ok`))[0].ok)

  await as(misty)
  let state = (await q(`select pvp_state() s`))[0].s
  check('state: decks per role', state.decks.all.attack.valid === true && state.decks.all.attack.cards.length === 5 && !('defense' in state.decks.all))
  check('an unknown role is refused', (await errorOf(`select pvp_save_deck('all', '{g1,g2,g3,g4,g5}', 'support')`)).includes('pvp_invalid_role'))
  check('an invalid defense deck is refused', (await errorOf(`select pvp_save_deck('all', '{g1,g2,g3,g4}', 'defense')`)).includes('pvp_invalid_deck'))
  state = (await q(`select pvp_save_deck('all', '{g1,g2,g3,g4,g5}', 'defense') s`))[0].s
  check('defense deck saved beside the attack deck', state.decks.all.defense.cards.map((c) => c.id).join() === 'g1,g2,g3,g4,g5'
    && state.decks.all.attack.cards.map((c) => c.id).join() === 'w1,w2,w3,w4,w5')
  state = (await q(`select pvp_save_deck('all', '{w1,w2,w3,w4,g1}', 'defense') s`))[0].s
  check('a card can be in both decks, saving again replaces it', state.decks.all.defense.cards.map((c) => c.id).join() === 'w1,w2,w3,w4,g1')
  await q(`select pvp_save_deck('all', '{g1,g2,g3,g4,g5}', 'defense')`)

  await as(ash)
  check('a defense deck alone cannot attack', await (async () => {
    await q(`select pvp_save_deck('all', '{f1,f2,f3,f4,f5}', 'defense')`)
    return (await errorOf(`select pvp_start('all')`)).includes('pvp_no_deck')
  })())
  state = (await q(`select pvp_save_deck('all', '{f1,f2,f3,f4,f5}') s`))[0].s
  check('no role = attack deck (the 0025 call still works)', state.decks.all.attack.valid && state.decks.all.defense.valid)

  // 3. Matchmaking plays the opponent's defense deck
  state = (await q(`select pvp_start('all') s`))[0].s
  await asAdmin()
  let [battle] = await q(`select a_deck, d_deck, defender from pvp_battles where attacker = $1 and status = 'playing'`, [ash])
  check('I attack with my attack deck', battle.a_deck.map((c) => c.id).join() === 'f1,f2,f3,f4,f5')
  check("Misty defends with her defense deck", battle.defender === misty && battle.d_deck.map((c) => c.id).join() === 'g1,g2,g3,g4,g5')
  await as(ash)
  await q(`select pvp_forfeit()`)

  // No defense deck: the attack deck defends
  await as(brock)
  await q(`select pvp_save_deck('all', '{f2,f3,f4,f5,f6}')`)
  await as(ash)
  await q(`select pvp_start('all')`)
  await asAdmin()
  ;[battle] = await q(`select d_deck, defender from pvp_battles where attacker = $1 and status = 'playing'`, [ash])
  check('without a defense deck, the attack deck defends', battle.defender === brock && battle.d_deck.map((c) => c.id).join() === 'f2,f3,f4,f5,f6')
  await as(ash)
  await q(`select pvp_forfeit()`)

  // A defense deck no longer valid: the attack deck takes over
  await asAdmin()
  await q(`delete from collections where user_id = $1 and card_id = 'g5'`, [misty])
  await q(`delete from collections where user_id = $1 and card_id = 'f6'`, [brock])
  await as(misty)
  state = (await q(`select pvp_state() s`))[0].s
  check('my defense deck says it is no longer valid', state.decks.all.defense.valid === false && state.decks.all.attack.valid === true)
  await as(ash)
  await q(`select pvp_start('all')`)
  await asAdmin()
  ;[battle] = await q(`select d_deck, defender from pvp_battles where attacker = $1 and status = 'playing'`, [ash])
  check('an invalid defense deck falls back to the attack deck', battle.defender === misty && battle.d_deck.map((c) => c.id).join() === 'w1,w2,w3,w4,w5')

  await as(null)
  check('signed out: no deck saving', (await errorOf(`select pvp_save_deck('all', '{f1,f2,f3,f4,f5}', 'attack')`)) !== '')
  await as(ash)
  check('players still cannot read decks', (await errorOf(`select * from pvp_decks`)) !== '')
}
