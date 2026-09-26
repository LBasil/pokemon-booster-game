// npm run test:db [filter] — runs every supabase/tests/*.test.mjs (or those
// whose name contains `filter`) against fresh PGlite databases.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2] ?? ''
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort()

let failed = 0
let passed = 0
for (const file of files) {
  console.log(`\n${file}`)
  const { default: suite } = await import(pathToFileURL(path.join(DIR, file)))
  const check = (name, ok) => {
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`)
    if (ok) passed++
    else failed++
  }
  try {
    await suite(check)
  } catch (err) {
    failed++
    console.log(`  FAIL  crashed: ${err.stack}`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
