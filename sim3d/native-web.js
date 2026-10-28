/* Blackeyes Simulation 3D — version tablette : remplace les fonctions du logiciel PC (fichiers, fermeture).
   - Ouvrir : sélecteur de fichiers de la tablette (sur une touche, comme l'exige l'iPad).
   - Enregistrer / exporter : partage (« Enregistrer dans Fichiers ») ou téléchargement.
   - Scène transmise par Blackeyes 2 (export « Simulation 3D ») : lue directement, sans passer par un fichier.
   - Deux doigts : pincer pour zoomer (plan et vue 3D). */
'use strict';
(function () {
  const VERSION = '1.0.9';
  const files = new Map(); let seq = 0;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sheet(html) { const el = document.createElement('div'); el.className = 'tb-sheet'; el.innerHTML = `<div class="tb-box">${html}</div>`; document.body.appendChild(el); return el; }
  const accept = (filters) => { const ex = (filters || []).flatMap(f => f.extensions || []).filter(e => e !== '*'); return ex.length ? ex.map(e => '.' + e).join(',') : ''; };
  const keep = (name, data) => { const p = `/tablette/${++seq}/${name}`; files.set(p, { name, data }); return p; };

  // scène envoyée par Blackeyes 2 (même site, fenêtre parente)
  let handoff = null;
  try { if (location.hash === '#scene' && window.parent && window.parent.__BK3D_SCENE__) { const s = window.parent.__BK3D_SCENE__; handoff = keep(s.name, s.data); window.parent.__BK3D_SCENE__ = null; } } catch {}

  function deliver(name, data) {
    const ext = name.split('.').pop().toLowerCase();
    const type = { zip: 'application/zip', png: 'image/png', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
    const file = new File([data], name, { type });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    return new Promise((resolve) => {
      const el = sheet(`<h3>Fichier prêt</h3><p><b>${esc(name)}</b> (${Math.max(1, Math.round(data.byteLength / 1024))} Ko)</p>
        ${canShare ? '<button type="button" class="tb-btn tb-primary" data-s>Partager / Enregistrer dans Fichiers…</button>' : ''}
        <button type="button" class="tb-btn ${canShare ? '' : 'tb-primary'}" data-d>Télécharger</button>
        <button type="button" class="tb-btn" data-x>Fermer</button>`);
      const close = (ok) => { el.remove(); resolve(ok); };
      const s = el.querySelector('[data-s]');
      if (s) s.onclick = async () => { try { await navigator.share({ files: [file], title: name }); close(true); } catch (e) { if (e && e.name !== 'AbortError') alert('Partage impossible : ' + e.message); } };
      el.querySelector('[data-d]').onclick = () => { const u = URL.createObjectURL(file); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); close(true); };
      el.querySelector('[data-x]').onclick = () => close(false);
    });
  }
  function pick(o = {}) {
    return new Promise((resolve) => {
      const el = sheet(`<h3>${esc(o.title || 'Choisir un fichier')}</h3><p>Touchez le bouton pour choisir le fichier sur la tablette.</p>
        <label class="tb-btn tb-primary">Choisir…<input type="file" accept="${esc(accept(o.filters))}" hidden></label>
        <button type="button" class="tb-btn" data-x>Annuler</button>`);
      const inp = el.querySelector('input');
      inp.onchange = async () => { const f = inp.files[0]; el.remove(); if (!f) return resolve(null); const data = new Uint8Array(await f.arrayBuffer()); const p = keep(f.name, data); resolve({ path: p, name: f.name, data }); };
      el.querySelector('[data-x]').onclick = () => { el.remove(); resolve(null); };
    });
  }
  const dropped = new Map();
  window.native = {
    info: async () => ({ version: VERSION, argv: handoff ? [handoff] : [] }),
    openFile: (o) => pick(o),
    async readFile(p) {
      if (files.has(p)) { const f = files.get(p); return { path: p, name: f.name, data: f.data }; }
      if (dropped.has(p)) { const f = dropped.get(p); const data = new Uint8Array(await f.arrayBuffer()); return { path: keep(f.name, data), name: f.name, data }; }
      throw new Error('Fichier introuvable.');
    },
    async saveFile(o = {}) { const name = String(o.defaultPath || 'scene.bk3d').split(/[\\/]/).pop(); const data = o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data); return (await deliver(name, data)) ? keep(name, data) : null; },
    async writeFile(p, d) { const name = String(p).split('/').pop(); const data = d instanceof Uint8Array ? d : new Uint8Array(d); await deliver(name, data); return p; },
    pathOf: (file) => { const p = `/depose/${++seq}/${file.name}`; dropped.set(p, file); return p; },
    onBeforeClose() {}, confirmClose() {}
  };

  // pincer à deux doigts -> molette (zoom du plan et de la vue 3D)
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  document.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), target: e.target }; }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return; e.preventDefault();
    const d = dist(e.touches), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const k = d / pinch.d; if (Math.abs(k - 1) < 0.03) return;
    pinch.target.dispatchEvent(new WheelEvent('wheel', { deltaY: (1 - k) * 400, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    pinch.d = d;
  }, { passive: false, capture: true });
  document.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; }, { capture: true });
})();
