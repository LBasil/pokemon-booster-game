// Supabase (PostgREST) returns 1,000 rows at most per request: a collection
// past that lost its oldest cards (Base, Fossil...) without any error.
export const PAGE_ROWS = 1000

/**
 * Every row of a query, page by page. `query()` builds a fresh query each
 * time and must be ordered on a unique key (or ties broken by one), or rows
 * shift between pages.
 * @param {() => { range: (from: number, to: number) => PromiseLike<{ data: any[] | null, error: any }> }} query
 */
export async function fetchAll(query, pageRows = PAGE_ROWS) {
  const rows = []
  for (let from = 0; ; from += pageRows) {
    const { data, error } = await query().range(from, from + pageRows - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < pageRows) return rows
  }
}
