/* Vacuula service worker.
 *
 * Deliberately small: it only makes the app shell (HTML, JS, CSS, icons) load
 * from cache when the network is slow or the server is briefly unreachable.
 * Everything under /app (the robot API, including the SSE event stream) is
 * never intercepted, so robot state is always live.
 *
 * Registered only in production builds (see src/main.tsx) and only where the
 * browser allows it (HTTPS or localhost).
 */
const CACHE = 'vacuula-shell-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/app')) return // API + event stream: always network

  // Navigations: network first, cached index as fallback (offline shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Static assets: cache first (Vite hashes file names, so cached = current)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
        }
        return res
      })
    })
  )
})
