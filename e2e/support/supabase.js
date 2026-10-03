// Mocked Supabase (Auth + PostgREST) for the e2e build, which points at
// https://e2e.supabase.test. Each test gets its own in-memory state and can
// inspect `backend.calls` afterwards.
import { CARDS, PACK, SETS, USER, byId, collectionEntry } from './data.js'

const HOST = 'https://e2e.supabase.test'
const STORAGE_KEY = 'sb-e2e-auth-token' // supabase-js: sb-<first host label>-auth-token

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function makeSession(user = USER) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600 * 24
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: expiresAt, role: 'authenticated' })}.sig`,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600 * 24,
    expires_at: expiresAt,
    user,
  }
}

/** Starts the page signed in (session in localStorage, as supabase-js stores it). */
export async function signIn(page) {
  await page.addInitScript(([key, session]) => localStorage.setItem(key, session), [STORAGE_KEY, JSON.stringify(makeSession())])
}

// Challenge economy, same numbers as migrations 0005/0006
const RECYCLE = { common: 1, uncommon: 2, rare: 5, holo: 15, ultra: 60, secret: 200 }
const CRAFT = { common: 20, uncommon: 40, rare: 100, holo: 300, ultra: 1500, secret: 5000 }
const MISSIONS = [
  { mission: 'open_packs', target: 3, reward: 75 },
  { mission: 'pull_holo', target: 1, reward: 100 },
  { mission: 'recycle', target: 5, reward: 50 },
]
// Weekly missions (migration 0011)
const WEEKLY = [
  { mission: 'week_open_packs', target: 25, reward: 400 },
  { mission: 'week_pull_ultra', target: 2, reward: 400 },
  { mission: 'week_recycle', target: 50, reward: 250 },
  { mission: 'week_daily', target: 5, reward: 300 },
]

// The mini-game's pairs, in order: [left, right] (which one is pricier alternates)
export const MINIGAME_PAIRS = [
  ['sv3pt5-150', 'base1-4'], // right (2 vs 300)
  ['sv3pt5-6', 'sv3pt5-4'], // left (12 vs 0.2)
  ['sv3pt5-199', 'base1-58'], // left (180 vs 2)
  ['sv3pt5-25', 'sv3pt5-190'], // right (0.3 vs 20)
]

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ collection?: object[], challengeCollection?: object[], challenge?: object, godPack?: boolean,
 *   trades?: object[], partners?: Record<string, object[]>, badge?: { rewards: number, trades: number },
 *   profile?: object, feed?: object[], leaderboard?: object[], takenUsernames?: string[],
 *   achievementRates?: object[] | 'missing', sets?: object[], stats?: Record<string, object>, counterTrade?: 'missing', myRank?: object, traders?: Record<string, object[]> }} [options] - rates rows may carry a `mode` (default unlimited);
 *   sets replaces SETS; stats = player_achievements().stats per mode (migration 0010)
 */
// "Shiny Electrode Flip" (migration 0014): every board the mock deals, row
// by row (0 = Electrode). The 2s are tiles 2 and 18, the 3 is tile 5, the
// Electrodes are tiles 3, 9, 11 and 20: clearing it scores 2 x 3 x 2 = 12.
export const ELECTRODE_BOARD = [
  1, 1, 2, 0, 1,
  3, 1, 1, 1, 0,
  1, 0, 1, 1, 1,
  1, 1, 1, 2, 1,
  0, 1, 1, 1, 1,
]

// "Super effective!" (migration 0015): the questions the mock asks, in order
export const SUPER_EFFECTIVE_QUESTIONS = [
  { card: 'sv3pt5-4', answer: 'Water', options: ['Grass', 'Water', 'Psychic'] }, // Charmander
  { card: 'sv3pt5-7', answer: 'Lightning', options: ['Lightning', 'Fire', 'Fighting'] }, // Squirtle
  { card: 'sv3pt5-1', answer: 'Fire', options: ['Water', 'Darkness', 'Fire'] }, // Bulbasaur
]

// "Evolution chain" (migrations 0018 + 0019): the lines the mock asks, in order.
// `cards` = the order on screen, `chain` = the right order (Basic first).
const evoCard = (id, name) => ({ id, name, image_small: `https://images.e2e.test/${id}.png` })
export const EVOLUTION_QUESTIONS = [
  { cards: [evoCard('sv3pt5-6', 'Charizard ex'), evoCard('sv3pt5-4', 'Charmander'), evoCard('sv3pt5-5', 'Charmeleon')], chain: ['sv3pt5-4', 'sv3pt5-5', 'sv3pt5-6'] },
  { cards: [evoCard('sv3pt5-8', 'Wartortle'), evoCard('sv3pt5-9', 'Blastoise'), evoCard('sv3pt5-7', 'Squirtle')], chain: ['sv3pt5-7', 'sv3pt5-8', 'sv3pt5-9'] },
  { cards: [evoCard('sv3pt5-1', 'Bulbasaur'), evoCard('sv3pt5-3', 'Venusaur ex'), evoCard('sv3pt5-2', 'Ivysaur')], chain: ['sv3pt5-1', 'sv3pt5-2', 'sv3pt5-3'] },
  // A two-stage line (0019)
  { cards: [evoCard('sv3pt5-26', 'Raichu'), evoCard('sv3pt5-25', 'Pikachu')], chain: ['sv3pt5-25', 'sv3pt5-26'] },
]

// PvP battles (migration 0024): every card of the mock fights with 30
// damage (Fire), 60 HP, weak to Water. The opponent's deck: 5 Grass cards
// weak to Fire (one hit each) that deal 20, in this order.
const SERIES = { sv3pt5: 'Scarlet & Violet', base1: 'Base' }
const pvpCard = (id) => {
  const card = byId[id]
  return card?.national_pokedex_number
    ? { id, name: card.name, image_small: card.image_small, hp: 60, types: ['Fire'], weaknesses: ['Water'], resistances: [], attack: 'Ember', damage: 30, times: false }
    : null
}
export const PVP_OPPONENT_DECK = ['Oddish', 'Bellsprout', 'Tangela', 'Exeggcute', 'Paras'].map((name, i) => ({
  id: `foe-${i}`,
  name,
  image_small: `https://images.e2e.test/foe-${i}.png`,
  hp: 60,
  types: ['Grass'],
  weaknesses: ['Fire'],
  resistances: [],
  attack: 'Vine Whip',
  damage: 20,
  times: false,
}))

export async function mockSupabase(page, options = {}) {
  const state = {
    collection: options.collection ?? [collectionEntry('sv3pt5-4', 2), collectionEntry('base1-4')],
    profile: options.profile ?? { id: USER.id, username: 'Ash', is_public: true, showcase_card_id: null, created_at: USER.created_at, accepts_trades: true },
    wishlist: [],
    openings: [],
    feed: options.feed ?? [
      { id: 1, username: 'Misty', card_id: 'sv3pt5-199', card_name: 'Charizard ex', image_small: byId['sv3pt5-199'].image_small, bucket: 'secret', set_id: 'sv3pt5', mode: 'unlimited', pulled_at: new Date().toISOString() },
    ],
    leaderboard: options.leaderboard ?? [
      { rank: 1, username: 'Misty', score: 24.5, packs: 40, card_id: null, card_name: null, image_small: null },
      { rank: 2, username: 'Ash', score: 18, packs: 25, card_id: null, card_name: null, image_small: null },
    ],
    taken: new Set((options.takenUsernames ?? ['brock']).map((name) => name.toLowerCase())),
    challengeCollection: options.challengeCollection ?? [],
    challenge: {
      coins: 1000,
      daily_streak: 0,
      daily_available: true,
      daily_reward: 200,
      progress: { open_packs: 0, pull_holo: 0, recycle: 0, week_open_packs: 0, week_pull_ultra: 0, week_recycle: 0, week_daily: 0 },
      claimed: [],
      ...options.challenge,
    },
    // Trades (migration 0007): my_trades() rows, and challenge collections by lowercased username
    trades: options.trades ?? [],
    partners: options.partners ?? { misty: [collectionEntry('base1-4'), collectionEntry('sv3pt5-150')] },
    badge: { rewards: 0, trades: 0, answers: 0, ...options.badge },
    // Trades page views that marked answers as seen (migration 0017)
    answersMarked: 0,
    nextTradeId: 100,
    // counter_trade() (migration 0021), or 'missing'
    counterTrade: options.counterTrade ?? 'ok',
    // my_leaderboard_rank() answer (default: from the leaderboard rows), card_traders() rows by card id
    myRank: options.myRank ?? null,
    traders: options.traders ?? {},
    // Achievements (migrations 0008 + 0009): achievement_rates() rows (with an
    // optional mode), or 'missing' = not applied; recorded ids and packs per mode
    achievementRates: options.achievementRates ?? [],
    recorded: { unlimited: new Set(), challenge: new Set() },
    packs: { unlimited: 0, challenge: 0 },
    // Packs left before check_booster_rate() refuses (60 per minute)
    packsBeforeLimit: options.packsBeforeLimit ?? Infinity,
    stats: options.stats ?? {},
    // Trade preferences (migration 0012): my locked card ids, Misty's
    // locked card ids and whether she accepts trades
    locks: options.locks ?? [],
    mistyLocks: options.mistyLocks ?? [],
    mistyAcceptsTrades: options.mistyAcceptsTrades ?? true,
    sets: options.sets ?? SETS,
    // "Higher or lower" (migration 0013): 'missing' = not applied; the pairs
    // come in MINIGAME_PAIRS order, so tests know the right answer
    minigame: options.minigame === 'missing' ? 'missing' : { paidUsed: 0, best: 0, todayCoins: 0, run: null, next: 0, ...options.minigame },
    electrodeFlip:
      options.electrodeFlip === 'missing' ? 'missing' : { level: 1, todayCoins: 0, bestPoints: 0, bestLevel: 0, board: null, ...options.electrodeFlip },
    // "Super effective!" (migration 0015): 'missing' = not applied; ready:
    // false = no weaknesses loaded yet; questions in SUPER_EFFECTIVE_QUESTIONS order
    superEffective:
      options.superEffective === 'missing' ? 'missing' : { ready: true, paidUsed: 0, best: 0, todayCoins: 0, run: null, next: 0, ...options.superEffective },
    // "Evolution chain" (migration 0018): 'missing' = not applied; ready:
    // false = no evolves_from loaded yet; lines in EVOLUTION_QUESTIONS order
    // (`next` = the first one); noStop: true = before 0019 (no stop RPC)
    evolutionChain:
      options.evolutionChain === 'missing' ? 'missing' : { ready: true, paidUsed: 0, best: 0, todayCoins: 0, run: null, next: 0, ...options.evolutionChain },
    // PvP battles (migration 0024): 'missing' = not applied; opponent: false =
    // nobody else has a deck; decks / ratings by format; board = leaderboard rows
    pvp:
      options.pvp === 'missing'
        ? 'missing'
        : { ready: true, battlesLeft: 10, opponent: true, decks: {}, ratings: {}, battle: null, history: [], board: [], ...options.pvp },
  }
  const challengeState = () => {
    const c = state.challenge
    return {
      coins: c.coins,
      daily_streak: c.daily_streak,
      daily_available: c.daily_available,
      daily_reward: c.daily_reward,
      today: new Date().toISOString().slice(0, 10),
      missions: MISSIONS.map((m) => ({ ...m, progress: Math.min(c.progress[m.mission], m.target), claimed: c.claimed.includes(m.mission) })),
      weekly: WEEKLY.map((m) => ({ ...m, progress: Math.min(c.progress[m.mission] ?? 0, m.target), claimed: c.claimed.includes(m.mission) })),
      week_start: '2026-09-21',
    }
  }
  const calls = []

  // Card art and sprites: tiny transparent PNG, no real network
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  await page.route(/images\.e2e\.test|raw\.githubusercontent\.com|images\.pokemontcg\.io/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  )
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, body: '' }))

  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    const wantsObject = (req.headers().accept ?? '').includes('vnd.pgrst.object')
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-expose-headers': 'content-range', ...headers } })
    const rows = (list) => (wantsObject ? json(list[0] ?? null) : json(list))
    const count = (n) => route.fulfill({ status: 200, body: '', headers: { 'content-range': `*/${n}`, 'access-control-expose-headers': 'content-range' } })
    calls.push({ method, path, search: url.search, body: req.postData() })

    // ---- Auth ----
    if (path === '/auth/v1/token') return json(makeSession())
    if (path === '/auth/v1/recover') return json({})
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (path === '/auth/v1/user') return json(USER)
    if (path.startsWith('/auth/v1/')) return json({})

    // ---- RPCs ----
    if (path === '/rest/v1/rpc/open_my_booster') {
      if (state.packsBeforeLimit-- <= 0) return json({ code: 'P0001', message: 'too many boosters opened, slow down a little', details: null, hint: null }, 400)
      for (const c of PACK) {
        const owned = state.collection.find((e) => e.card_id === c.id)
        if (owned) owned.quantity++
        else state.collection.unshift(collectionEntry(c.id, 1, new Date().toISOString()))
      }
      state.wishlist = state.wishlist.filter((w) => !PACK.some((c) => c.id === w.card_id))
      state.packs.unlimited++
      return json(PACK)
    }
    // ---- Challenge RPCs (migration 0005) ----
    const args = JSON.parse(req.postData() || '{}')
    const raise = (message) => json({ code: 'P0001', message, details: null, hint: null }, 400)
    const c = state.challenge
    if (path === '/rest/v1/rpc/challenge_state') return json(challengeState())
    // ---- Mini-game (migration 0013) ----
    if (path.startsWith('/rest/v1/rpc/minigame_')) {
      const mg = state.minigame
      if (mg === 'missing') return json({ code: 'PGRST202', message: `Could not find the function public.${path.split('/').pop()} in the schema cache` }, 404)
      const mgCard = (id) => {
        const card = byId[id]
        return { id, name: card.name, rarity: card.rarity, image_small: card.image_small, image_url: card.image_url, set_id: card.set_id, set_name: SETS.find((set) => set.id === card.set_id)?.name }
      }
      const drawPair = () => MINIGAME_PAIRS[mg.next++ % MINIGAME_PAIRS.length]
      const mgState = () => ({
        paid_runs: 3,
        coins_per_answer: 5,
        max_paid_answers: 20,
        answer_seconds: 15,
        coins: c.coins,
        paid_left: Math.max(0, 3 - mg.paidUsed),
        today_coins: mg.todayCoins,
        best: mg.best,
        run: mg.run && { paid: mg.run.paid, streak: mg.run.streak, coins: mg.run.coins, left: mgCard(mg.run.pair[0]), right: mgCard(mg.run.pair[1]), seconds_left: 15 },
      })
      if (path === '/rest/v1/rpc/minigame_state') return json(mgState())
      if (path === '/rest/v1/rpc/minigame_start') {
        const paid = mg.paidUsed < 3
        if (paid) mg.paidUsed++
        mg.run = { paid, streak: 0, coins: 0, pair: drawPair() }
        return json(mgState())
      }
      if (path === '/rest/v1/rpc/minigame_answer') {
        const run = mg.run
        if (!run) return raise('no_game')
        const pair = run.pair
        const [left, right] = pair.map((id) => byId[id].value)
        const correct = args.p_pick !== null && (args.p_pick === 'left' ? left >= right : right >= left)
        let earned = 0
        if (correct) {
          earned = run.paid && run.streak < 20 ? 5 : 0
          run.streak++
          run.coins += earned
          c.coins += earned
          mg.todayCoins += earned
          mg.best = Math.max(mg.best, run.streak)
          run.pair = drawPair()
        } else {
          mg.run = null
        }
        return json({
          correct,
          late: args.p_pick === null,
          earned,
          streak: run.streak,
          run_coins: run.coins,
          left: { id: pair[0], value: left },
          right: { id: pair[1], value: right },
          state: mgState(),
        })
      }
    }
    // ---- Shiny Electrode Flip (migration 0014) ----
    if (path.startsWith('/rest/v1/rpc/electrode_flip_')) {
      const ef = state.electrodeFlip
      if (ef === 'missing') return json({ code: 'PGRST202', message: `Could not find the function public.${path.split('/').pop()} in the schema cache` }, 404)
      const line = (indexes) => ({
        points: indexes.reduce((sum, i) => sum + ef.board.tiles[i], 0),
        electrodes: indexes.filter((i) => ef.board.tiles[i] === 0).length,
      })
      const five = [0, 1, 2, 3, 4]
      const efView = () => {
        const b = ef.board
        return {
          level: b.level,
          points: b.points,
          flips: b.flips,
          status: b.status,
          rows: five.map((r) => line(five.map((c) => r * 5 + c))),
          cols: five.map((c) => line(five.map((r) => r * 5 + c))),
          tiles: b.tiles.map((v, i) => (b.flipped[i] || b.status !== 'playing' ? v : null)),
          flipped: [...b.flipped],
        }
      }
      const efState = () => ({
        levels: 5,
        daily_coins: 300,
        coins: c.coins,
        level: ef.board?.status === 'playing' ? ef.board.level : ef.level,
        today_coins: ef.todayCoins,
        coins_left: Math.max(0, 300 - ef.todayCoins),
        best_points: ef.bestPoints,
        best_level: ef.bestLevel,
        board: ef.board?.status === 'playing' ? efView() : null,
      })
      const end = (status) => {
        const b = ef.board
        if (status === 'lost') b.points = 0
        const earned = Math.max(0, Math.min(b.points, 300 - ef.todayCoins))
        c.coins += earned
        ef.todayCoins += earned
        b.status = status
        if (status !== 'lost') ef.bestPoints = Math.max(ef.bestPoints, b.points)
        if (status === 'won') ef.bestLevel = Math.max(ef.bestLevel, b.level)
        ef.level = status === 'won' ? Math.min(b.level + 1, 5) : Math.max(1, Math.min(b.level, b.flips))
        return earned
      }
      if (path === '/rest/v1/rpc/electrode_flip_state') return json(efState())
      if (path === '/rest/v1/rpc/electrode_flip_start') {
        if (ef.board?.status !== 'playing') {
          ef.board = { level: ef.level, tiles: [...ELECTRODE_BOARD], flipped: Array(25).fill(false), flips: 0, points: 0, status: 'playing' }
        }
        return json(efState())
      }
      if (path === '/rest/v1/rpc/electrode_flip_flip') {
        const b = ef.board
        if (b?.status !== 'playing') return raise('no_game')
        const i = args.p_index
        if (b.flipped[i]) return raise('already_flipped')
        const value = b.tiles[i]
        b.flipped[i] = true
        if (value > 0) {
          b.flips++
          b.points = b.points === 0 ? value : b.points * value
        }
        let earned = 0
        if (value === 0) earned = end('lost')
        else if (b.tiles.every((v, j) => v < 2 || b.flipped[j])) earned = end('won')
        return json({ index: i, value, earned, result: efView(), state: efState() })
      }
      if (path === '/rest/v1/rpc/electrode_flip_cash_out') {
        if (ef.board?.status !== 'playing') return raise('no_game')
        if (!ef.board.flips) return raise('nothing_to_cash')
        const earned = end('cashed')
        return json({ earned, result: efView(), state: efState() })
      }
    }
    // ---- Evolution chain (migration 0018) ----
    if (path.startsWith('/rest/v1/rpc/evolution_chain_')) {
      const ec = state.evolutionChain
      if (ec === 'missing') return json({ code: 'PGRST202', message: `Could not find the function public.${path.split('/').pop()} in the schema cache` }, 404)
      const draw = () => EVOLUTION_QUESTIONS[ec.next++ % EVOLUTION_QUESTIONS.length]
      const ecState = () => ({
        paid_runs: 3,
        coins_per_answer: 3,
        max_paid_answers: 20,
        answer_seconds: 15,
        ready: ec.ready,
        coins: c.coins,
        paid_left: Math.max(0, 3 - ec.paidUsed),
        today_coins: ec.todayCoins,
        best: ec.best,
        run: ec.run && {
          paid: ec.run.paid,
          streak: ec.run.streak,
          coins: ec.run.coins,
          length: ec.run.question.chain.length,
          cards: ec.run.question.cards,
          seconds_left: 15,
        },
      })
      if (path === '/rest/v1/rpc/evolution_chain_state') return json(ecState())
      if (path === '/rest/v1/rpc/evolution_chain_start') {
        if (!ec.ready) return raise('evolution_chain_unavailable')
        const paid = ec.paidUsed < 3
        if (paid) ec.paidUsed++
        ec.run = { paid, streak: 0, coins: 0, question: draw() }
        return json(ecState())
      }
      if (path === '/rest/v1/rpc/evolution_chain_answer') {
        const run = ec.run
        if (!run) return raise('no_game')
        const question = run.question
        const correct = args.p_order !== null && args.p_order.join() === question.chain.join()
        let earned = 0
        if (correct) {
          earned = run.paid && run.streak < 20 ? 3 : 0
          run.streak++
          run.coins += earned
          c.coins += earned
          ec.todayCoins += earned
          ec.best = Math.max(ec.best, run.streak)
          run.question = draw()
        } else {
          ec.run = null
        }
        return json({ correct, late: args.p_order === null, earned, streak: run.streak, run_coins: run.coins, chain: question.chain, state: ecState() })
      }
      if (path === '/rest/v1/rpc/evolution_chain_stop') {
        if (ec.noStop) return json({ code: 'PGRST202', message: 'Could not find the function public.evolution_chain_stop in the schema cache' }, 404)
        const run = ec.run
        if (!run) return raise('no_game')
        ec.run = null
        return json({ streak: run.streak, run_coins: run.coins, state: ecState() })
      }
    }
    // ---- PvP battles (migration 0024) ----
    if (path.startsWith('/rest/v1/rpc/pvp_')) {
      const pv = state.pvp
      if (pv === 'missing') return json({ code: 'PGRST202', message: `Could not find the function public.${path.split('/').pop()} in the schema cache` }, 404)
      const fighters = () => state.challengeCollection.map((e) => pvpCard(e.card_id)).filter(Boolean)
      const fits = (card, format) =>
        format === 'all' || format === `era:${SERIES[card.id.split('-')[0]]}` || format === `set:${card.id.split('-')[0]}`
      const rating = (format) => (pv.ratings[format] ??= { elo: 1000, wins: 0, losses: 0, draws: 0, def_wins: 0, def_losses: 0, def_draws: 0 })
      const view = (b) => ({
        id: b.id,
        format: b.format,
        status: b.status,
        round: b.round,
        my_kos: b.my_kos,
        their_kos: b.their_kos,
        elo_change: b.elo_change,
        opponent: b.opponent,
        log: b.log,
        mine: b.mine.map((card, slot) => ({ ...card, slot, hp_left: b.myHp[slot] })),
        theirs: {
          left: b.theirHp.filter((hp) => hp > 0).length,
          seen: b.seen.map((slot) => ({ ...PVP_OPPONENT_DECK[slot], slot, hp_left: b.theirHp[slot] })),
          deck: b.status === 'playing' ? null : PVP_OPPONENT_DECK.map((card, slot) => ({ ...card, slot, hp_left: b.theirHp[slot] })),
        },
      })
      const pvState = () => {
        const owned = fighters()
        const sets = [...new Set(owned.map((card) => card.id.split('-')[0]))]
        return {
          deck_size: 5, kos_to_win: 3, max_rounds: 15, battles_per_day: 10, start_elo: 1000, k_factor: 32, weakness_multiplier: 2, resistance: 30, min_damage: 10,
          ready: pv.ready,
          battles_left: pv.battlesLeft,
          formats: {
            all: owned.length,
            eras: ['Base', 'Scarlet & Violet'].map((series) => ({ format: `era:${series}`, series, owned: owned.filter((card) => fits(card, `era:${series}`)).length })),
            sets: sets.map((id) => ({ format: `set:${id}`, set_id: id, name: SETS.find((set) => set.id === id)?.name ?? id, series: SERIES[id], owned: owned.filter((card) => fits(card, `set:${id}`)).length })),
          },
          decks: pv.decks,
          ratings: pv.ratings,
          battle: pv.battle && pv.battle.status === 'playing' ? view(pv.battle) : null,
          history: pv.history,
        }
      }
      if (path === '/rest/v1/rpc/pvp_state') return json(pvState())
      if (path === '/rest/v1/rpc/pvp_eligible') return json(fighters().filter((card) => fits(card, args.p_format)))
      if (path === '/rest/v1/rpc/pvp_save_deck') {
        const cards = (args.p_cards ?? []).map(pvpCard)
        if (cards.length !== 5 || new Set(args.p_cards).size !== 5 || cards.some((card) => !card || !fits(card, args.p_format))) return raise('pvp_invalid_deck')
        pv.decks[args.p_format] = { cards, valid: true }
        rating(args.p_format)
        return json(pvState())
      }
      if (path === '/rest/v1/rpc/pvp_start') {
        if (pv.battle?.status === 'playing') return json(pvState())
        if (!pv.battlesLeft) return raise('pvp_no_battles_left')
        const deck = pv.decks[args.p_format]
        if (!deck) return raise('pvp_no_deck')
        if (!pv.opponent) return raise('pvp_no_opponent')
        pv.battlesLeft--
        pv.battle = {
          id: Date.now(), format: args.p_format, status: 'playing', round: 0, my_kos: 0, their_kos: 0, elo_change: null,
          opponent: { username: 'Misty', elo: 1000 }, log: [], mine: deck.cards, myHp: deck.cards.map((card) => card.hp),
          theirHp: PVP_OPPONENT_DECK.map((card) => card.hp), seen: [], next: 0,
        }
        return json(pvState())
      }
      const finish = (b, status) => {
        b.status = status
        b.elo_change = status === 'won' ? 16 : status === 'draw' ? 0 : -16
        const r = rating(b.format)
        r.elo += b.elo_change
        if (status === 'won') r.wins++
        else if (status === 'draw') r.draws++
        else r.losses++
        pv.history.unshift({ id: b.id, format: b.format, at: new Date().toISOString(), role: 'attack', result: status === 'forfeit' ? 'lost' : status, elo_change: b.elo_change, opponent: 'Misty' })
      }
      if (path === '/rest/v1/rpc/pvp_play') {
        const b = pv.battle
        if (!b || b.status !== 'playing') return raise('no_game')
        const slot = args.p_slot
        if (!(b.myHp[slot] > 0)) return raise('pvp_invalid_card')
        const d = b.next
        const mine = b.mine[slot]
        const theirs = PVP_OPPONENT_DECK[d]
        const hit = (from, to) => Math.max(10, from.damage * (from.types.some((type) => to.weaknesses.includes(type)) ? 2 : 1))
        const dealt = hit(mine, theirs)
        const taken = hit(theirs, mine)
        b.theirHp[d] = Math.max(0, b.theirHp[d] - dealt)
        b.myHp[slot] = Math.max(0, b.myHp[slot] - taken)
        if (!b.seen.includes(d)) b.seen.push(d)
        const round = { a: slot, d, dealt, taken, roll_a: null, roll_d: null, ko_theirs: b.theirHp[d] === 0, ko_mine: b.myHp[slot] === 0 }
        b.my_kos += round.ko_theirs ? 1 : 0
        b.their_kos += round.ko_mine ? 1 : 0
        b.round++
        b.log.push(round)
        b.next = b.theirHp.findIndex((hp) => hp > 0)
        if (b.my_kos >= 3 || b.their_kos >= 3 || b.round >= 15) finish(b, b.my_kos > b.their_kos ? 'won' : b.my_kos < b.their_kos ? 'lost' : 'draw')
        return json({ round, battle: view(b), state: pvState() })
      }
      if (path === '/rest/v1/rpc/pvp_forfeit') {
        const b = pv.battle
        if (!b || b.status !== 'playing') return raise('no_game')
        finish(b, 'forfeit')
        return json({ battle: view(b), state: pvState() })
      }
      if (path === '/rest/v1/rpc/pvp_leaderboard') {
        const me = pv.board.find((row) => row.username === 'Ash')
        return json({ rows: pv.board, me: me ? { rank: me.rank, elo: me.elo, wins: me.wins, losses: me.losses, draws: me.draws } : null })
      }
    }
    // ---- Super effective! (migration 0015) ----
    if (path.startsWith('/rest/v1/rpc/super_effective_')) {
      const se = state.superEffective
      if (se === 'missing') return json({ code: 'PGRST202', message: `Could not find the function public.${path.split('/').pop()} in the schema cache` }, 404)
      const seCard = (id) => {
        const card = byId[id]
        return { id, name: card.name, types: card.types, hp: card.hp, image_small: card.image_small, image_url: card.image_url, set_id: card.set_id, set_name: SETS.find((set) => set.id === card.set_id)?.name }
      }
      const draw = () => SUPER_EFFECTIVE_QUESTIONS[se.next++ % SUPER_EFFECTIVE_QUESTIONS.length]
      const seState = () => ({
        paid_runs: 3,
        coins_per_answer: 5,
        max_paid_answers: 20,
        answer_seconds: 10,
        ready: se.ready,
        coins: c.coins,
        paid_left: Math.max(0, 3 - se.paidUsed),
        today_coins: se.todayCoins,
        best: se.best,
        run: se.run && { paid: se.run.paid, streak: se.run.streak, coins: se.run.coins, card: seCard(se.run.question.card), options: se.run.question.options, seconds_left: 10 },
      })
      if (path === '/rest/v1/rpc/super_effective_state') return json(seState())
      if (path === '/rest/v1/rpc/super_effective_start') {
        if (!se.ready) return raise('super_effective_unavailable')
        const paid = se.paidUsed < 3
        if (paid) se.paidUsed++
        se.run = { paid, streak: 0, coins: 0, question: draw() }
        return json(seState())
      }
      if (path === '/rest/v1/rpc/super_effective_answer') {
        const run = se.run
        if (!run) return raise('no_game')
        const question = run.question
        const correct = args.p_pick !== null && args.p_pick === question.answer
        let earned = 0
        if (correct) {
          earned = run.paid && run.streak < 20 ? 5 : 0
          run.streak++
          run.coins += earned
          c.coins += earned
          se.todayCoins += earned
          se.best = Math.max(se.best, run.streak)
          run.question = draw()
        } else {
          se.run = null
        }
        return json({
          correct,
          late: args.p_pick === null,
          earned,
          streak: run.streak,
          run_coins: run.coins,
          answer: question.answer,
          weaknesses: [question.answer],
          state: seState(),
        })
      }
    }
    if (path === '/rest/v1/rpc/claim_daily_reward') {
      if (!c.daily_available) return raise('already_claimed')
      const reward = c.daily_reward
      Object.assign(c, { coins: c.coins + reward, daily_available: false, daily_streak: c.daily_streak + 1, daily_reward: reward + 50 })
      return json({ ...challengeState(), reward })
    }
    if (path === '/rest/v1/rpc/claim_mission') {
      const m = [...MISSIONS, ...WEEKLY].find((x) => x.mission === args.p_mission)
      if (c.claimed.includes(m.mission)) return raise('already_claimed')
      if (c.progress[m.mission] < m.target) return raise('mission_incomplete')
      c.claimed.push(m.mission)
      c.coins += m.reward
      const stats = (state.stats.challenge ??= {})
      stats.missions = (stats.missions ?? 0) + 1
      return json({ ...challengeState(), reward: m.reward })
    }
    if (path === '/rest/v1/rpc/open_challenge_booster') {
      if (c.coins < 100) return raise('not_enough_coins')
      c.coins -= 100
      c.progress.open_packs++
      c.progress.week_open_packs++
      c.progress.pull_holo++
      state.packs.challenge++
      for (const card of PACK) {
        const owned = state.challengeCollection.find((e) => e.card_id === card.id)
        if (owned) owned.quantity++
        else state.challengeCollection.unshift(collectionEntry(card.id, 1, new Date().toISOString()))
      }
      return json({ cards: PACK, coins: c.coins, god_pack: Boolean(options.godPack) })
    }
    if (path === '/rest/v1/rpc/recycle_duplicates') {
      let recycled = 0
      let gained = 0
      for (const entry of state.challengeCollection) {
        if (entry.quantity > 1 && (!args.p_card_id || entry.card_id === args.p_card_id)) {
          recycled += entry.quantity - 1
          gained += (entry.quantity - 1) * RECYCLE[entry.cards.rarity_bucket]
          entry.quantity = 1
        }
      }
      c.coins += gained
      c.progress.recycle += recycled
      return json({ recycled, gained, coins: c.coins })
    }
    if (path === '/rest/v1/rpc/recycle_cards') {
      let recycled = 0
      let gained = 0
      for (const entry of state.challengeCollection) {
        if (entry.quantity > 1 && args.p_card_ids.includes(entry.card_id)) {
          recycled += entry.quantity - 1
          gained += (entry.quantity - 1) * RECYCLE[entry.cards.rarity_bucket]
          entry.quantity = 1
        }
      }
      c.coins += gained
      c.progress.recycle += recycled
      return json({ recycled, gained, coins: c.coins })
    }
    if (path === '/rest/v1/rpc/recycle_card_copies') {
      let recycled = 0
      let gained = 0
      for (const entry of state.challengeCollection) {
        const copies = Math.min(entry.quantity - 1, Math.floor(args.p_picks[entry.card_id] ?? 0))
        if (copies > 0) {
          recycled += copies
          gained += copies * RECYCLE[entry.cards.rarity_bucket]
          entry.quantity -= copies
        }
      }
      c.coins += gained
      c.progress.recycle += recycled
      return json({ recycled, gained, coins: c.coins })
    }
    if (path === '/rest/v1/rpc/craft_card') {
      const card = byId[args.p_card_id]
      const price = CRAFT[card.rarity_bucket]
      if (c.coins < price) return raise('not_enough_coins')
      c.coins -= price
      const owned = state.challengeCollection.find((e) => e.card_id === card.id)
      if (owned) owned.quantity++
      else state.challengeCollection.unshift(collectionEntry(card.id, 1, new Date().toISOString()))
      return json({ card_id: card.id, quantity: owned?.quantity ?? 1, price, coins: c.coins })
    }

    if (path === '/rest/v1/rpc/challenge_badge') return json(state.badge)
    if (path === '/rest/v1/rpc/my_trades') return json(state.trades)
    if (path === '/rest/v1/rpc/mark_trade_answers_seen') {
      const unseen = state.trades.filter((x) => x.unseen)
      for (const trade of unseen) trade.unseen = false
      state.badge.answers = 0
      state.answersMarked++
      return json(unseen.length)
    }
    if (path === '/rest/v1/rpc/challenge_collection_of') {
      const name = args.p_username.trim().toLowerCase()
      const locked = name === 'misty' ? state.mistyLocks : []
      return json((state.partners[name] ?? []).map((entry) => ({ ...entry, tradable: !locked.includes(entry.card_id) })))
    }
    if (path === '/rest/v1/rpc/propose_trade') {
      const partner = state.partners[args.p_username.trim().toLowerCase()]
      if (!partner) return raise('trainer_not_found')
      if (args.p_username.trim().toLowerCase() === 'misty' && !state.mistyAcceptsTrades) return raise('trades_closed')
      if (args.p_offer.some((id) => state.locks.includes(id)) || args.p_request.some((id) => state.mistyLocks.includes(id))) {
        return raise('card_not_for_trade')
      }
      const id = state.nextTradeId++
      state.trades.unshift({
        id,
        direction: 'sent',
        partner: args.p_username.trim(),
        offer: args.p_offer.map((cardId) => byId[cardId]),
        request: args.p_request.map((cardId) => byId[cardId]),
        status: 'pending',
        created_at: new Date().toISOString(),
        resolved_at: null,
      })
      return json(id)
    }
    if (path === '/rest/v1/rpc/counter_trade') {
      if (state.counterTrade === 'missing') return json({ code: 'PGRST202', message: 'Could not find the function', details: null, hint: null }, 404)
      const first = state.trades.find((x) => x.id === args.p_trade_id && x.direction === 'received')
      if (!first) return raise('trade_not_found')
      if (first.status !== 'pending') return raise('trade_closed')
      Object.assign(first, { status: 'countered', resolved_at: new Date().toISOString() })
      const id = state.nextTradeId++
      state.trades.unshift({
        id,
        direction: 'sent',
        partner: first.partner,
        offer: args.p_offer.map((cardId) => byId[cardId]),
        request: args.p_request.map((cardId) => byId[cardId]),
        status: 'pending',
        counter_of: first.id,
        created_at: new Date().toISOString(),
        resolved_at: null,
      })
      state.badge.trades = state.trades.filter((x) => x.direction === 'received' && x.status === 'pending').length
      return json(id)
    }
    if (path === '/rest/v1/rpc/respond_trade') {
      const trade = state.trades.find((x) => x.id === args.p_trade_id)
      if (!trade || trade.status !== 'pending') return raise('trade_closed')
      trade.status = args.p_accept ? 'accepted' : 'declined'
      trade.resolved_at = new Date().toISOString()
      if (args.p_accept) {
        for (const card of trade.offer) {
          const owned = state.challengeCollection.find((e) => e.card_id === card.id)
          if (owned) owned.quantity++
          else state.challengeCollection.unshift(collectionEntry(card.id, 1, new Date().toISOString()))
        }
        state.challengeCollection = state.challengeCollection.filter((e) => !trade.request.some((card) => card.id === e.card_id))
      }
      state.badge.trades = state.trades.filter((x) => x.direction === 'received' && x.status === 'pending').length
      return json({ status: trade.status })
    }
    if (path === '/rest/v1/rpc/cancel_trade') {
      const trade = state.trades.find((x) => x.id === args.p_trade_id)
      Object.assign(trade, { status: 'cancelled', resolved_at: new Date().toISOString() })
      return json(null)
    }

    if (path === '/rest/v1/rpc/leaderboard') return json(state.leaderboard)
    // Migration 0022: my place on a board, who has a card in double
    if (path === '/rest/v1/rpc/my_leaderboard_rank') {
      if (state.myRank) return json(state.myRank)
      if (!state.profile.is_public) return json({ public: false })
      const mine = state.leaderboard.find((row) => row.username.toLowerCase() === state.profile.username.toLowerCase())
      return json(mine ? { public: true, ...mine } : { public: true, rank: null, packs: state.packs.unlimited })
    }
    if (path === '/rest/v1/rpc/card_traders') return json(state.traders[args.p_card_id] ?? [])
    // ---- Achievements (migration 0008) ----
    const missingFunction = () => json({ code: 'PGRST202', message: 'Could not find the function', details: null, hint: null }, 404)
    if (path === '/rest/v1/rpc/achievement_rates') {
      if (state.achievementRates === 'missing') return missingFunction()
      const mode = args.p_mode ?? 'unlimited'
      return json(state.achievementRates.filter((row) => (row.mode ?? 'unlimited') === mode).map(({ mode: _mode, ...row }) => row))
    }
    if (path === '/rest/v1/rpc/record_achievements') {
      if (state.achievementRates === 'missing') return missingFunction()
      const recorded = state.recorded[args.p_mode ?? 'unlimited']
      const before = recorded.size
      for (const id of args.p_ids ?? []) recorded.add(id)
      return json(recorded.size - before)
    }
    if (path === '/rest/v1/rpc/player_achievements') {
      if (state.achievementRates === 'missing') return missingFunction()
      const name = args.p_username?.toLowerCase()
      if (!name) return json({ unlocked: [...state.recorded[args.p_mode]], packs: state.packs[args.p_mode], stats: state.stats[args.p_mode] })
      return json(name === 'misty' ? { unlocked: [], packs: 4 } : null)
    }
    if (path === '/rest/v1/rpc/public_collection') {
      const { p_username: name } = JSON.parse(req.postData() || '{}')
      return json(name?.toLowerCase() === 'misty' ? [collectionEntry('sv3pt5-199'), collectionEntry('base1-4')] : [])
    }

    // ---- Tables ----
    const table = path.replace('/rest/v1/', '')
    if (table === 'sets') return json(state.sets)
    if (table === 'cards') {
      if (method === 'HEAD') return count(20670)
      const setId = url.searchParams.get('set_id')?.replace('eq.', '')
      if (url.searchParams.get('order')?.startsWith('national_pokedex_number')) return json([{ national_pokedex_number: 151 }])
      if (url.searchParams.get('id')?.startsWith('in.')) {
        const ids = url.searchParams.get('id').slice(4, -1).split(',').map((id) => id.replaceAll('"', ''))
        return json(ids.map((id) => byId[id]).filter(Boolean))
      }
      const list = CARDS.filter((c) => !setId || c.set_id === setId)
      return json(url.searchParams.get('limit') === '1' ? list.slice(-1) : list)
    }
    if (table === 'collections') {
      const list = url.searchParams.get('mode') === 'eq.challenge' ? state.challengeCollection : state.collection
      if (method === 'HEAD') return count(list.length)
      return json(list)
    }
    if (table === 'profiles') {
      if (method === 'PATCH') {
        const fields = JSON.parse(req.postData() || '{}')
        if (fields.username && state.taken.has(fields.username.toLowerCase())) {
          return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409)
        }
        Object.assign(state.profile, fields)
        return rows([state.profile])
      }
      const ilike = url.searchParams.get('username')
      if (ilike) {
        const name = ilike.replace('ilike.', '').replaceAll('\\', '').toLowerCase()
        // Username autocomplete: prefix search over public trainers
        if (name.endsWith('%')) {
          const trainers = [
            { username: 'Misty', accepts_trades: state.mistyAcceptsTrades },
            { username: 'Mistral', accepts_trades: false },
          ]
          return rows(trainers.filter((row) => row.username.toLowerCase().startsWith(name.slice(0, -1))))
        }
        if (name === 'misty') {
          return rows([{ id: 'misty-id', username: 'Misty', is_public: true, showcase_card_id: 'sv3pt5-199', created_at: '2026-08-01T00:00:00Z', accepts_trades: state.mistyAcceptsTrades }])
        }
        if (name === state.profile.username.toLowerCase()) return rows([state.profile])
        return rows([])
      }
      return rows([state.profile])
    }
    if (table === 'trade_locks') {
      if (method === 'POST') {
        const { card_id: id } = JSON.parse(req.postData() || '{}')
        if (!state.locks.includes(id)) state.locks.push(id)
        return route.fulfill({ status: 201, body: '' })
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('card_id')?.replace('eq.', '')
        state.locks = state.locks.filter((x) => x !== id)
        return route.fulfill({ status: 204, body: '' })
      }
      return json(state.locks.map((id) => ({ card_id: id })))
    }
    if (table === 'wishlist') {
      if (method === 'POST') {
        const { card_id: id } = JSON.parse(req.postData() || '{}')
        state.wishlist.unshift({ card_id: id, created_at: new Date().toISOString(), cards: byId[id] })
        return route.fulfill({ status: 201, body: '' })
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('card_id')?.replace('eq.', '')
        state.wishlist = state.wishlist.filter((w) => w.card_id !== id)
        return route.fulfill({ status: 204, body: '' })
      }
      return json(state.wishlist)
    }
    if (table === 'booster_openings') {
      const mode = url.searchParams.get('mode')?.replace('eq.', '') ?? 'unlimited'
      const hitsOnly = url.searchParams.get('hits') === 'gt.0'
      return json(state.openings.filter((o) => (o.mode ?? 'unlimited') === mode && (!hitsOnly || o.hits > 0)))
    }
    if (table === 'card_price_history') {
      return json([
        { recorded_on: '2026-09-01', value: 150 },
        { recorded_on: '2026-09-08', value: 165 },
        { recorded_on: '2026-09-15', value: 172 },
        { recorded_on: '2026-09-22', value: 180 },
      ])
    }
    if (table === 'pull_feed') {
      const mode = url.searchParams.get('mode')?.replace('eq.', '')
      return json(mode ? state.feed.filter((f) => (f.mode ?? 'unlimited') === mode) : state.feed)
    }

    return json({ message: `e2e mock: unhandled ${method} ${path}` }, 404)
  })

  return { state, calls }
}
