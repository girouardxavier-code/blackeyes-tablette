/* Blackeyes DÉMONSTRATION : fonctionnement hors connexion (cache propre à la démo).
   Les fichiers de la démo sont gardés en cache à la première ouverture : ensuite, plus aucune connexion n'est nécessaire. */
const APP = 'bkdemo-app-1.0.0';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(APP).then(c => c.addAll(["./","./agenda.js","./annotations.js","./app.js","./assistant.js","./auth-ui.js","./banque.js","./carte.js","./clients.js","./default-batiments.json","./default-charte.json","./default-db.js","./demarrage.js","./demo-plan.jpg","./demo.css","./demo.js","./dossier.js","./facturation.js","./fiches.js","./icone-192.png","./icone-512.png","./index.html","./manifest.webmanifest","./native.js","./pds-images.js","./photos.js","./protocole.js","./sim3d/app.js","./sim3d/default-db.js","./sim3d/index.html","./sim3d/native-web.js","./sim3d/sim-app.css","./sim3d/sim3d.js","./sim3d/styles.css","./sim3d/tablette.css","./sim3d/vendor/jszip.min.js","./sim3d/vendor/pdf.min.js","./sim3d/vendor/pdf.worker.min.js","./sim3d/vendor/three.min.js","./styles.css","./tablette.css","./telephone.js","./vendor/aesgcm.min.js","./vendor/jspdf.umd.min.js","./vendor/jszip.min.js","./vendor/leaflet/leaflet.css","./vendor/leaflet/leaflet.js","./vendor/pdf.min.js","./vendor/pdf.worker.min.js","./vendor/qrcode.js","./vendor/three.min.js","./vue3d.js"]).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bkdemo-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const cl = r.clone(); caches.open(APP).then(c => c.put(e.request, cl)); } return r; })));
});
