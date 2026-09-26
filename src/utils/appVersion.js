// The build's entry script (/assets/index-<hash>.js) identifies a deploy:
// a different one in the served index.html means a new version is live.
const ENTRY = /\/assets\/index-[\w-]+\.js/

/** The entry script path in an index.html, or null. */
export function entryScriptOf(html) {
  return String(html ?? '').match(ENTRY)?.[0] ?? null
}

/** True when the served build differs from the running one (unknowns never count). */
export function isNewBuild(running, served) {
  return Boolean(running && served && running !== served)
}
