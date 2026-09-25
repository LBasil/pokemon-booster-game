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

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ collection?: object[], challengeCollection?: object[], challenge?: object, godPack?: boolean,
 *   trades?: object[], partners?: Record<string, object[]>, badge?: { rewards: number, trades: number },
 *   profile?: object, feed?: object[], leaderboard?: object[], takenUsernames?: string[],
 *   achievementRates?: object[] | 'missing' }} [options] - rates rows may carry a `mode` (default unlimited)
 */
export async function mockSupabase(page, options = {}) {
  const state = {
    collection: options.collection ?? [collectionEntry('sv3pt5-4', 2), collectionEntry('base1-4')],
    profile: options.profile ?? { id: USER.id, username: 'Ash', is_public: true, showcase_card_id: null, created_at: USER.created_at },
    wishlist: [],
    openings: [],
    feed: options.feed ?? [
      { id: 1, username: 'Misty', card_id: 'sv3pt5-199', card_name: 'Charizard ex', image_small: byId['sv3pt5-199'].image_small, bucket: 'secret', set_id: 'sv3pt5', pulled_at: new Date().toISOString() },
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
      progress: { open_packs: 0, pull_holo: 0, recycle: 0 },
      claimed: [],
      ...options.challenge,
    },
    // Trades (migration 0007): my_trades() rows, and challenge collections by lowercased username
    trades: options.trades ?? [],
    partners: options.partners ?? { misty: [collectionEntry('base1-4'), collectionEntry('sv3pt5-150')] },
    badge: options.badge ?? { rewards: 0, trades: 0 },
    nextTradeId: 100,
    // Achievements (migrations 0008 + 0009): achievement_rates() rows (with an
    // optional mode), or 'missing' = not applied; recorded ids and packs per mode
    achievementRates: options.achievementRates ?? [],
    recorded: { unlimited: new Set(), challenge: new Set() },
    packs: { unlimited: 0, challenge: 0 },
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
    if (path === '/rest/v1/rpc/claim_daily_reward') {
      if (!c.daily_available) return raise('already_claimed')
      const reward = c.daily_reward
      Object.assign(c, { coins: c.coins + reward, daily_available: false, daily_streak: c.daily_streak + 1, daily_reward: reward + 50 })
      return json({ ...challengeState(), reward })
    }
    if (path === '/rest/v1/rpc/claim_mission') {
      const m = MISSIONS.find((x) => x.mission === args.p_mission)
      if (c.claimed.includes(m.mission)) return raise('already_claimed')
      if (c.progress[m.mission] < m.target) return raise('mission_incomplete')
      c.claimed.push(m.mission)
      c.coins += m.reward
      return json({ ...challengeState(), reward: m.reward })
    }
    if (path === '/rest/v1/rpc/open_challenge_booster') {
      if (c.coins < 100) return raise('not_enough_coins')
      c.coins -= 100
      c.progress.open_packs++
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
    if (path === '/rest/v1/rpc/challenge_collection_of') {
      return json(state.partners[args.p_username.trim().toLowerCase()] ?? [])
    }
    if (path === '/rest/v1/rpc/propose_trade') {
      const partner = state.partners[args.p_username.trim().toLowerCase()]
      if (!partner) return raise('trainer_not_found')
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
      if (!name) return json({ unlocked: [...state.recorded[args.p_mode]], packs: state.packs[args.p_mode] })
      return json(name === 'misty' ? { unlocked: [], packs: 4 } : null)
    }
    if (path === '/rest/v1/rpc/public_collection') {
      const { p_username: name } = JSON.parse(req.postData() || '{}')
      return json(name?.toLowerCase() === 'misty' ? [collectionEntry('sv3pt5-199'), collectionEntry('base1-4')] : [])
    }

    // ---- Tables ----
    const table = path.replace('/rest/v1/', '')
    if (table === 'sets') return json(SETS)
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
        const name = decodeURIComponent(ilike.replace('ilike.', '')).replaceAll('\\', '').toLowerCase()
        if (name === 'misty') return rows([{ id: 'misty-id', username: 'Misty', is_public: true, showcase_card_id: 'sv3pt5-199', created_at: '2026-08-01T00:00:00Z' }])
        if (name === state.profile.username.toLowerCase()) return rows([state.profile])
        return rows([])
      }
      return rows([state.profile])
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
      return json(state.openings.filter((o) => (o.mode ?? 'unlimited') === mode))
    }
    if (table === 'card_price_history') {
      return json([
        { recorded_on: '2026-09-01', value: 150 },
        { recorded_on: '2026-09-08', value: 165 },
        { recorded_on: '2026-09-15', value: 172 },
        { recorded_on: '2026-09-22', value: 180 },
      ])
    }
    if (table === 'pull_feed') return json(state.feed)

    return json({ message: `e2e mock: unhandled ${method} ${path}` }, 404)
  })

  return { state, calls }
}
