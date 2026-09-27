import { describe, expect, it } from 'vitest'
import { coinsFor, lineKind, nextLevel, pointsAfter, tileIndex } from './electrodeFlip'

describe('electrode flip rules', () => {
  it('numbers tiles row by row', () => {
    expect(tileIndex(0, 0)).toBe(0)
    expect(tileIndex(1, 2)).toBe(7)
    expect(tileIndex(4, 4)).toBe(24)
  })

  it('multiplies the points, from the first tile flipped', () => {
    expect(pointsAfter(0, 1)).toBe(1)
    expect(pointsAfter(0, 3)).toBe(3)
    expect(pointsAfter(3, 2)).toBe(6)
    expect(pointsAfter(6, 1)).toBe(6)
    expect(pointsAfter(6, 0)).toBe(0)
  })

  it('pays the points within what is left today', () => {
    expect(coinsFor(48, 300)).toBe(48)
    expect(coinsFor(48, 20)).toBe(20)
    expect(coinsFor(48, 0)).toBe(0)
  })

  it('moves up a level on a win, down to the tiles flipped otherwise', () => {
    expect(nextLevel(1, 4, 'won')).toBe(2)
    expect(nextLevel(5, 9, 'won')).toBe(5)
    expect(nextLevel(4, 2, 'lost')).toBe(2)
    expect(nextLevel(3, 7, 'cashed')).toBe(3)
    expect(nextLevel(2, 0, 'lost')).toBe(1)
  })

  it('spots safe and pointless lines', () => {
    expect(lineKind({ points: 7, electrodes: 0 })).toBe('safe')
    expect(lineKind({ points: 3, electrodes: 2 })).toBe('dud')
    expect(lineKind({ points: 5, electrodes: 1 })).toBe(null)
  })
})
