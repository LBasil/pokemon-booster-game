import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from './chunkError'

describe('isChunkLoadError', () => {
  it('recognises a missing lazy chunk in every engine', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/A-1.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/A-1.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/A-1.css'))).toBe(true)
  })

  it('ignores any other error', () => {
    expect(isChunkLoadError(new Error('not_authenticated'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
