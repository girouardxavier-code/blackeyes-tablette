/* Blackeyes tablette : fonctionnement hors connexion.
   - application : réseau d'abord (mises à jour immédiates), copie de secours en cache ;
   - tuiles de carte IGN : cache d'abord (carte hors ligne). */
const APP = 'bk-app-2.0.2', TUILES = 'bk-tuiles';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(APP).then(c => c.addAll(["./","./agenda.js","./annotations.js","./app.js","./assistant.js","./auth-ui.js","./banque.js","./carte.js","./clients.js","./default-batiments.json","./default-charte.json","./default-db.js","./demarrage.js","./dossier.js","./facturation.js","./icone-192.png","./icone-512.png","./index.html","./manifest.webmanifest","./native.js","./pds-images.js","./photos.js","./protocole.js","./sim3d/app.js","./sim3d/default-db.js","./sim3d/index.html","./sim3d/native-web.js","./sim3d/sim-app.css","./sim3d/sim3d.js","./sim3d/styles.css","./sim3d/tablette.css","./sim3d/vendor/jszip.min.js","./sim3d/vendor/pdf.min.js","./sim3d/vendor/pdf.worker.min.js","./sim3d/vendor/three.min.js","./styles.css","./tablette.css","./vendor/docx.umd.js","./vendor/jspdf.umd.min.js","./vendor/jszip.min.js","./vendor/leaflet/leaflet.css","./vendor/leaflet/leaflet.js","./vendor/pdf.min.js","./vendor/pdf.worker.min.js","./vendor/pptxgen.bundle.js"]).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bk-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'data.geopf.fr' && u.searchParams.get('REQUEST') === 'GetTile') {
    e.respondWith(caches.open(TUILES).then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cl = r.clone(); caches.open(APP).then(c => c.put(e.request, cl)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
