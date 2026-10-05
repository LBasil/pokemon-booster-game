// 0029: French card data (TCGdex) + retreat costs and abilities
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0029')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash] = await addUsers(db, 'Ash')

  await db.exec(`insert into sets (id, name, tcgdex_id, name_fr) values ('base1', 'Base', 'base1', 'Set de Base')`)
  await q(`insert into cards (id, name, supertype, subtypes, hp, set_id, name_fr, image_fr, retreat_cost, abilities, attacks_fr, abilities_fr)
           values ('base1-4', 'Charizard', 'Pokémon', '{Stage 2}', 120, 'base1', 'Dracaufeu', 'https://assets.tcgdex.net/fr/base/base1/4', 3,
                   '[{"name":"Energy Burn","text":"...","type":"Pokémon Power"}]', '[{"name":"Tornade de feu","effect":"..."}]',
                   '[{"name":"Brûlure d''énergie","effect":"..."}]')`)

  for (const [who, setAs] of [['anyone', () => as(null)], ['a player', () => as(ash)]]) {
    await setAs()
    const [card] = await q(`select name_fr, image_fr, retreat_cost, abilities, attacks_fr, abilities_fr from cards where id = 'base1-4'`)
    check(`${who} reads the French card data`, card.name_fr === 'Dracaufeu' && card.retreat_cost === 3
      && card.attacks_fr[0].name === 'Tornade de feu' && card.abilities[0].type === 'Pokémon Power' && card.abilities_fr.length === 1)
    const [set] = await q(`select tcgdex_id, name_fr from sets where id = 'base1'`)
    check(`${who} reads the set's TCGdex id and French name`, set.tcgdex_id === 'base1' && set.name_fr === 'Set de Base')
  }
  await as(ash)
  await errorOf(`update cards set name_fr = 'x' where id = 'base1-4'`)
  check('players cannot call the bulk writer', (await errorOf(`select set_cards_fr('[]')`)) !== '')
  await asAdmin()
  check('cards unchanged by a player', (await q(`select name_fr from cards where id = 'base1-4'`))[0].name_fr === 'Dracaufeu')

  // populate (service role): a missing field keeps the stored value
  await db.exec(`reset role; set role service_role;`)
  const n = (await q(`select set_cards_fr($1) n`, [JSON.stringify([
    { id: 'base1-4', name_fr: 'Dracaufeu (FR)' },
    { id: 'nope', name_fr: 'x' },
  ])]))[0].n
  await asAdmin()
  const [after] = await q(`select name_fr, image_fr, attacks_fr from cards where id = 'base1-4'`)
  check('set_cards_fr updates the known cards only', n === 1 && after.name_fr === 'Dracaufeu (FR)')
  check('and keeps the fields it was not given', after.image_fr.endsWith('/4') && after.attacks_fr[0].name === 'Tornade de feu')
}
