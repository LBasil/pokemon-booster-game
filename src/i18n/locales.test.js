import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import fr from './locales/fr.json'

// Every string of a locale file, with its key path
function strings(node, path = '') {
  if (typeof node === 'string') return [[path, node]]
  return Object.entries(node).flatMap(([key, value]) => strings(value, path ? `${path}.${key}` : key))
}

describe('locales', () => {
  // French puts a space before : ; ! ? » and after «: a plain one lets the
  // sign wrap alone to the next line (" : récompenses quotidiennes")
  it('French punctuation is glued with non-breaking spaces', () => {
    const loose = strings(fr).filter(([, text]) => / [:;!?»]|« /.test(text))
    expect(loose.map(([key]) => key)).toEqual([])
  })

  it('has no em dash (they read as machine-written)', () => {
    const dashes = [...strings(en), ...strings(fr)].filter(([, text]) => text.includes('—'))
    expect(dashes.map(([key]) => key)).toEqual([])
  })
})
