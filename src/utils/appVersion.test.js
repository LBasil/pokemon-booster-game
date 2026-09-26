import { describe, expect, it } from 'vitest'
import { entryScriptOf, isNewBuild } from './appVersion'

describe('entryScriptOf', () => {
  it('finds the entry script of a built index.html', () => {
    const html = '<head><script type="module" crossorigin src="/assets/index-pClUd9uT.js"></script>'
    expect(entryScriptOf(html)).toBe('/assets/index-pClUd9uT.js')
  })

  it('returns null for anything else', () => {
    expect(entryScriptOf('<script type="module" src="/src/main.js"></script>')).toBeNull()
    expect(entryScriptOf(null)).toBeNull()
  })
})

describe('isNewBuild', () => {
  it('only when both builds are known and differ', () => {
    expect(isNewBuild('/assets/index-a.js', '/assets/index-b.js')).toBe(true)
    expect(isNewBuild('/assets/index-a.js', '/assets/index-a.js')).toBe(false)
    expect(isNewBuild(null, '/assets/index-b.js')).toBe(false)
    expect(isNewBuild('/assets/index-a.js', null)).toBe(false)
  })
})
