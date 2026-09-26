// A lazy route's chunk failed to load. After a deploy, a tab opened on the
// previous build asks for chunk hashes that no longer exist: the navigation
// is aborted and nav links silently stop working until the page reloads.
// Messages per engine: Chromium, WebKit, Firefox, Vite's CSS preload.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String(error?.message ?? error ?? ''))
}
