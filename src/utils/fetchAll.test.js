import { describe, expect, it } from 'vitest'
import { fetchAll } from './fetchAll'

const table = (n) => Array.from({ length: n }, (_, i) => i)
const fake = (rows, error = null) => {
  const ranges = []
  const query = () => ({
    range: async (from, to) => {
      ranges.push([from, to])
      return error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null }
    },
  })
  return { query, ranges }
}

describe('fetchAll', () => {
  it('reads page after page until a short one', async () => {
    const { query, ranges } = fake(table(25))
    expect(await fetchAll(query, 10)).toEqual(table(25))
    expect(ranges).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('stops on an empty page when the count is a multiple of the page', async () => {
    const { query, ranges } = fake(table(20))
    expect(await fetchAll(query, 10)).toHaveLength(20)
    expect(ranges).toHaveLength(3)
  })

  it('throws the error', async () => {
    const { query } = fake([], { code: '42501' })
    await expect(fetchAll(query, 10)).rejects.toEqual({ code: '42501' })
  })
})
