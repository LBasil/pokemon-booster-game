// 0027: PvP against bots, for coins (no Elo)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0027')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  await db.exec(`insert into sets (id, name, release_date, series) values
    ('base1', 'Base', '1999-01-09', 'Base'), ('tiny', 'Tiny', '2000-01-01', 'Base')`)
  const card = (id, set, hp, type, attacks, subtypes = ['Basic']) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
       values ($1, $1, 'Pokémon', $2, $3, $4, '{Water}', $5, 'img', $6)`,
      [id, subtypes, hp, [type], JSON.stringify(attacks), set])
  // 30 weak cards, 10 strong ones: tiers are easy to tell apart
  for (let i = 1; i <= 30; i++) await card(`weak${i}`, 'base1', 40, 'Grass', [{ name: 'Tackle', damage: '10', cost: 2 }])
  for (let i = 1; i <= 10; i++) await card(`strong${i}`, 'base1', 180, 'Fire', [{ name: 'Blaze', damage: '90', cost: 1 }])
  // A set with 3 fighting cards: no bot there
  for (let i = 1; i <= 3; i++) await card(`tiny${i}`, 'tiny', 60, 'Water', [{ name: 'Splash', damage: '20', cost: 1 }])

  const give = async (user, ids) => {
    for (const id of ids) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 1)`, [user, id])
  }
  const MY_DECK = ['strong1', 'strong2', 'strong3', 'strong4', 'strong5']
  await give(ash, [...MY_DECK, 'tiny1', 'tiny2', 'tiny3'])

  // Rules
  await asAdmin()
  const rules = (await q(`select pvp_rules() r`))[0].r
  check('rules: bot levels, coins, daily limits', rules.bot_levels.join() === 'easy,normal,hard'
    && rules.bot_coins.easy === 10 && rules.bot_coins.normal === 25 && rules.bot_coins.hard === 50
    && rules.bot_paid_per_day === 5 && rules.bot_battles_per_day === 20 && rules.battles_per_day === 10)

  // Bot decks
  const botDeck = async (format, level) => (await q(`select pvp_bot_deck($1, $2) d`, [format, level]))[0].d
  const easy = await botDeck('all', 'easy')
  const hard = await botDeck('all', 'hard')
  check('a bot deck has 5 cards that can fight', easy.length === 5 && easy.every((c) => c.attacks.length > 0 && c.hp > 0))
  check('different names', new Set(hard.map((c) => c.name)).size === 5)
  check('hard draws the strong cards, easy the weak ones', hard.every((c) => c.id.startsWith('strong')) && easy.every((c) => c.id.startsWith('weak')))
  check('format: a set with 3 fighters has no bot', (await botDeck('set:tiny', 'normal')) === null)
  check('format: an era only deals its cards', (await botDeck('era:Base', 'normal')).length === 5)

  // Starting
  await as(ash)
  check('no attack deck: no bot battle', (await errorOf(`select pvp_bot_start('all', 'easy')`)).includes('pvp_no_deck'))
  await q(`select pvp_save_deck('all', $1)`, [MY_DECK])
  check('an unknown level is refused', (await errorOf(`select pvp_bot_start('all', 'legendary')`)).includes('pvp_invalid_level'))
  check('an unknown format is refused', (await errorOf(`select pvp_bot_start('era:Nope', 'easy')`)).includes('pvp_invalid_format'))
  check('no opponent among players', (await errorOf(`select pvp_start('all')`)).includes('pvp_no_opponent'))

  let state = (await q(`select pvp_bot_start('all', 'hard') s`))[0].s
  check('a bot battle starts with my attack deck', state.battle.status === 'playing' && state.battle.mine.map((c) => c.id).join() === MY_DECK.join())
  check('it says it is a bot, no name or Elo', state.battle.bot === 'hard' && state.battle.opponent.bot === 'hard'
    && state.battle.opponent.username === null && state.battle.opponent.elo === null && state.battle.paid === true)
  check('the bot deck stays hidden', state.battle.theirs.seen.length === 0 && state.battle.theirs.deck === null)
  check('bot battles left / paid left', state.bot_battles_left === 19 && state.bot_paid_left === 4)
  check('player battles untouched', state.battles_left === 10)
  const again = (await q(`select pvp_bot_start('all', 'easy') s`))[0].s
  check('a battle in progress comes back', again.battle.id === state.battle.id && again.battle.bot === 'hard')
  check('one battle at a time, bot or player', (await q(`select pvp_start('all') s`))[0].s.battle.id === state.battle.id)

  // Playing it out (pvp_play is the same): win it by hand, then check the pay
  await asAdmin()
  const coinsBefore = (await q(`select coins from challenge_wallets where user_id = $1`, [ash]))[0].coins
  await q(`update pvp_battles set a_prizes = 2 where attacker = $1 and status = 'playing'`, [ash])
  await q(`update pvp_battles set d_hp = '{1,1,1,1,1}' where attacker = $1 and status = 'playing'`, [ash])
  await as(ash)
  const result = (await q(`select pvp_play(0, 0) r`))[0].r
  check('a knockout wins', result.battle.status === 'won')
  check('a paid hard win pays 50 coins, no Elo', result.battle.coins === 50 && result.battle.elo_change === 0)
  await asAdmin()
  check('wallet credited', (await q(`select coins from challenge_wallets where user_id = $1`, [ash]))[0].coins === coinsBefore + 50)
  check('ledger row pvp_bot', (await q(`select amount from challenge_ledger where user_id = $1 and kind = 'pvp_bot'`, [ash])).map((r) => r.amount).join() === '50')
  check('no rating moved', (await q(`select count(*)::int n from pvp_ratings where wins + losses + draws > 0`))[0].n === 0)
  check('the state carries the new wallet', result.state.coins === coinsBefore + 50)
  const [entry] = result.state.history
  check('history: a bot battle with its coins', entry.bot === 'hard' && entry.coins === 50 && entry.result === 'won' && entry.opponent === null)
  check('coins_earned counts it', (await q(`select player_achievements('challenge', 'Ash') a`))[0].a.stats.coins_earned >= 50)

  // A draw pays half (rounded down), a forfeit nothing
  await as(ash)
  await q(`select pvp_bot_start('all', 'easy')`)
  await asAdmin()
  await q(`update pvp_battles set round = 19, a_prizes = 1, d_prizes = 1, d_hp = '{500,500,500,500,500}', a_hp = '{500,500,500,500,500}'
           where attacker = $1 and status = 'playing'`, [ash])
  await as(ash)
  const draw = (await q(`select pvp_play(0, null) r`))[0].r
  check('a paid easy draw pays 5', draw.battle.status === 'draw' && draw.battle.coins === 5)
  await q(`select pvp_bot_start('all', 'normal')`)
  const gaveUp = (await q(`select pvp_forfeit() r`))[0].r
  check('giving up pays nothing, no Elo', gaveUp.battle.status === 'forfeit' && gaveUp.battle.coins === 0 && gaveUp.battle.elo_change === 0)
  check('giving up still uses the paid slot', gaveUp.state.bot_paid_left === 2)

  // Past 5 a day: unpaid; past 20: none
  for (let i = 0; i < 2; i++) {
    await q(`select pvp_bot_start('all', 'easy')`)
    await q(`select pvp_forfeit()`)
  }
  state = (await q(`select pvp_bot_start('all', 'hard') s`))[0].s
  check('the 6th battle of the day is unpaid', state.battle.paid === false && state.bot_paid_left === 0)
  await asAdmin()
  await q(`update pvp_battles set a_prizes = 2, d_hp = '{1,1,1,1,1}' where attacker = $1 and status = 'playing'`, [ash])
  await as(ash)
  const unpaid = (await q(`select pvp_play(0, 0) r`))[0].r
  check('an unpaid win pays nothing', unpaid.battle.status === 'won' && unpaid.battle.coins === 0)
  await asAdmin()
  check('only paying battles leave a ledger row', (await q(`select count(*)::int n from challenge_ledger where user_id = $1 and kind = 'pvp_bot'`, [ash]))[0].n === 2)
  await q(`insert into pvp_battles (attacker, bot, format, a_deck, d_deck, a_hp, d_hp, status)
           select $1, 'easy', 'all', '[]', '[]', '{}', '{}', 'lost' from generate_series(1, 14)`, [ash])
  await as(ash)
  check('20 bot battles a day, then no more', (await errorOf(`select pvp_bot_start('all', 'easy')`)).includes('pvp_no_bot_battles_left'))
  check('player battles still left', (await q(`select pvp_state() s`))[0].s.battles_left === 10)

  // A player battle still works and counts apart; the last opponent is a player
  await asAdmin()
  await give(misty, MY_DECK)
  await as(misty)
  await q(`select pvp_save_deck('all', $1)`, [MY_DECK])
  await as(ash)
  state = (await q(`select pvp_start('all') s`))[0].s
  check('a player battle after bot ones', state.battle.opponent.username === 'Misty' && state.battle.bot === null && state.battles_left === 9)
  const elo = (await q(`select pvp_forfeit() r`))[0].r
  check('players still move Elo', elo.battle.elo_change < 0 && elo.battle.coins === null)

  // Table rules
  await asAdmin()
  check('a battle is against a player or a bot, never both or neither',
    (await errorOf(`insert into pvp_battles (attacker, format, a_deck, d_deck, a_hp, d_hp) values ('${ash}', 'all', '[]', '[]', '{}', '{}')`)) !== ''
    && (await errorOf(`insert into pvp_battles (attacker, defender, bot, format, a_deck, d_deck, a_hp, d_hp) values ('${ash}', '${misty}', 'easy', 'all', '[]', '[]', '{}', '{}')`)) !== '')
  await as(ash)
  check('players cannot call the bot deck dealer', (await errorOf(`select pvp_bot_deck('all', 'hard')`)) !== '')
  await as(null)
  check('signed out: no bot battle', (await errorOf(`select pvp_bot_start('all', 'easy')`)) !== '')
}
