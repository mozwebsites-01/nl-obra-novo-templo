// Service worker: permite instalar a app e abri-la mesmo sem rede.
// Estratégia: rede primeiro (sempre a versão mais recente), cache como recurso.
const CACHE = 'nl-obra-v8';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/tokens.css', 'styles/base.css', 'styles/login.css', 'styles/admin.css',
  'src/main.js', 'src/store.js', 'src/seed.js', 'src/format.js', 'src/ui.js', 'src/icons.js', 'src/install.js',
  'src/views/login.js', 'src/views/admin.js',
  'assets/brand/logo-lockup-navy.svg', 'assets/brand/logo-lockup-white.svg',
  'assets/brand/mark-navy.svg', 'assets/brand/mark-white.svg',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const sameOrigin = new URL(event.request.url).origin === self.location.origin;
  event.respondWith(
    fetch(event.request, sameOrigin ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
