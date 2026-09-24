// PokéBooster service worker: makes the app installable and keeps it (and
// already-seen card art) available offline. Supabase requests are never
// cached — collections and openings always come live from the server.
// Bump VERSION to drop old caches after a change to this file.
const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const IMAGES = `images-${VERSION}`
const MAX_IMAGES = 400

const IMAGE_HOSTS = ['images.pokemontcg.io', 'images.scrydex.com', 'raw.githubusercontent.com']
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL, IMAGES].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)))
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
    if (cacheName === IMAGES) trim(IMAGES, MAX_IMAGES)
  }
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(SHELL)
    cache.put('/', response.clone())
    return response
  } catch {
    return (await caches.match('/')) ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // SPA navigations: fresh when online, the cached shell when offline
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  // Hashed build assets never change: cache forever
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL))
    return
  }
  // Only plain <img> loads (opaque). CORS loads (the share image canvas) go
  // to the network: serving them a cached opaque response would taint it.
  if (IMAGE_HOSTS.includes(url.hostname) && request.mode === 'no-cors') {
    event.respondWith(cacheFirst(request, IMAGES))
    return
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, SHELL))
  }
  // Everything else (Supabase included) goes straight to the network
})
