import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import { GAMES, GAME_ROUTES } from './games'

describe('GAMES', () => {
  it('each game has a unique id, a route under the challenge and an icon', () => {
    expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAMES.length)
    for (const game of GAMES) {
      if (game.soon) expect(game.route).toBeUndefined()
      else expect(game.route).toMatch(/^challenge-game-/)
      expect(game.icon).toBeTruthy()
    }
    expect(GAME_ROUTES).toEqual(GAMES.filter((game) => !game.soon).map((game) => game.route))
  })

  it('each game has its title and description in both languages', () => {
    for (const locale of [en, fr]) {
      for (const game of GAMES) {
        expect(locale.games.items[game.id]?.title, game.id).toBeTruthy()
        expect(locale.games.items[game.id]?.desc, game.id).toBeTruthy()
      }
    }
  })
})
