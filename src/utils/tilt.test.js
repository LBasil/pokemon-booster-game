import { describe, expect, it } from 'vitest'
import { tiltFromPointer } from './tilt'

describe('tiltFromPointer', () => {
  it('is flat with a centered highlight when the pointer is in the middle', () => {
    expect(tiltFromPointer(100, 150, 200, 300)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 })
  })

  it('reaches the max tilt in the corners', () => {
    expect(tiltFromPointer(0, 0, 200, 300, 10)).toEqual({ rx: 10, ry: -10, mx: 0, my: 0 })
    expect(tiltFromPointer(200, 300, 200, 300, 10)).toEqual({ rx: -10, ry: 10, mx: 100, my: 100 })
  })

  it('clamps pointer positions outside the element', () => {
    expect(tiltFromPointer(-50, 999, 200, 300, 10)).toEqual({ rx: -10, ry: -10, mx: 0, my: 100 })
  })

  it('stays flat for a zero-sized element instead of dividing by zero', () => {
    expect(tiltFromPointer(10, 10, 0, 0)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 })
  })
})
