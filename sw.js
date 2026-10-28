/* Service worker de la démo : l'app reste utilisable sans réseau, et reçoit les captures partagées depuis WhatsApp, Instagram ou la galerie.
   Réseau d'abord (la démo publiée est toujours à jour), cache en secours. Rien n'est envoyé à un serveur : la capture partagée reste sur le téléphone. */
const CACHE = 'etiket-app-v4';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/app.css', 'assets/app.js', 'assets/engine.js', 'assets/data.js', 'assets/i18n.js', 'assets/i18n-octo.js',
  'assets/i18n-guide.js', 'assets/i18n-scan.js', 'assets/i18n-tour.js', 'assets/icons.js', 'assets/theme.js', 'assets/icon.svg', 'assets/icon-192.png', 'assets/fonts/archivo-wdth.woff2', 'assets/fonts/stencil-800.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('etiket-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;  // jsDelivr (lecteur OCR) et Instagram passent directement
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then(c => c.match(e.request).then(r => r || c.match('index.html')))));  // jamais le cache des partages
});
// Partage reçu : seulement une image PNG, JPEG ou WebP de 15 Mo au plus et un texte court ; toujours redirigé vers l'écran Scanner.
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const box = await caches.open('etiket-share');
    const shot = form.getAll('shot').find(f => f && typeof f !== 'string' && /^image\/(png|jpeg|webp)$/.test(f.type) && f.size <= 15 * 1024 * 1024);
    if (shot) await box.put('shared-shot', new Response(shot, { headers: { 'content-type': shot.type } }));
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(v => typeof v === 'string' && v.trim()).join('\n').slice(0, 5000);
    if (text) await box.put('shared-text', new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  } catch { /* partage illisible : on ouvre quand même l'écran Scanner */ }
  return Response.redirect(new URL('./#/scan', request.url).href, 303);
}
