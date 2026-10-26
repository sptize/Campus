// Service worker: precache de la app (offline). La nueva versión espera hasta que el usuario acepte actualizar.
declare const __PRECACHE__: string[];
declare const __CACHE__: string;
const sw = self as any;

sw.addEventListener('install', (e: any) => {
  e.waitUntil(caches.open(__CACHE__).then((c) => c.addAll(__PRECACHE__)));
});
sw.addEventListener('message', (e: any) => { if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting(); });
sw.addEventListener('activate', (e: any) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('campuspocket-') && k !== __CACHE__).map((k) => caches.delete(k)))).then(() => sw.clients.claim()));
});
sw.addEventListener('fetch', (e: any) => {
  const req: Request = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(__CACHE__).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { if (req.mode === 'navigate') { const idx = await c.match('./index.html'); if (idx) return idx; } throw err; }
  }));
});
