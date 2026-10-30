/* Photos du site : reportage photographique du projet
   - S.project.photos = [{ id, url (JPEG redimensionné), w, h, legende, markerId, rapport, date, fichier }]
   - Chaque photo peut être rattachée à un repère (matériel posé) : pastille 📷 sur le plan.
   - Les photos cochées « Dans le rapport » forment le chapitre « Reportage photographique » du dossier
     (Word et PDF) et des diapositives du PowerPoint. Elles sont enregistrées (chiffrées) avec le projet. */
'use strict';

const PHOTO_MAX = 1600;
const projectPhotos = () => (S.project.photos = S.project.photos || []);
const photosOfMarker = (id) => projectPhotos().filter(p => p.markerId === id);
const markerById = (id) => { for (const l of S.project.levels) { const m = l.markers.find(x => x.id === id); if (m) return { m, l }; } return null; };
const markerRef = (id) => { const r = markerById(id); if (!r) return ''; const t = typeOf(r.m.typeId); return `${r.m.label} — ${t.nom}${S.project.levels.length > 1 ? ` (${r.l.name})` : ''}`; };
const reportPhotos = () => projectPhotos().filter(p => p.rapport !== false);
const photoCaption = (p, i) => `Photo ${i + 1}${p.legende ? ` — ${p.legende}` : ''}${p.markerId && markerById(p.markerId) ? ` (repère ${markerRef(p.markerId)})` : ''}${p.pos && typeof photoPlaceTxt === 'function' && photoPlaceTxt(p) ? ` [${photoPlaceTxt(p)}, pastille ${photoNum(p)}]` : ''}`;

async function shrinkSitePhoto(url) {
  const img = await loadImg(url); const k = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}
async function addSitePhotos(markerId = null) {
  if (!need('implanter')) return 0;
  const r = await window.native.openFile({ purpose: 'sitephoto', multi: true, title: 'Ajouter des photos du site', filters: [{ name: 'Photos (JPG, PNG, WebP)', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  const files = Array.isArray(r) ? r : r ? [r] : []; if (!files.length) return 0;
  toast(`Préparation de ${files.length} photo(s)…`);
  let n = 0;
  for (const f of files) {
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      const raw = await bytesToDataUrl(f.data, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      const ph = await shrinkSitePhoto(raw);
      projectPhotos().push({ id: uid(), ...ph, legende: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), markerId, rapport: true, date: today(), fichier: f.name }); n++;
    } catch (e) { toast(`Photo illisible : ${f.name}`, true); }
  }
  if (n) { setDirty(); renderMarkers(); renderSide(); toast(`${n} photo(s) ajoutée(s)`); }
  return n;
}

/* fenêtre de gestion : légende, repère, inclusion dans le rapport, ordre */
async function openPhotos(filterMarker = null) {
  const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-height:360px';
  const edit = can('implanter');
  const markers = S.project.levels.flatMap(l => sortedMarkers(l).map(m => ({ id: m.id, txt: markerRef(m.id) })));
  const render = () => {
    const list = projectPhotos().filter(p => !filterMarker || p.markerId === filterMarker);
    body.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        ${edit ? `<button class="primary" data-a="add">+ Ajouter des photos…</button>` : ''}
        ${edit && S.project.levels.length && projectPhotos().some(p => !p.pos) ? `<button data-a="placeAll">📍 Placer les photos non placées (${projectPhotos().filter(p => !p.pos).length})</button>` : ''}
        ${S.project.batimentId && typeof openBankForProject === 'function' ? '<button data-a="bank">🗂 Banque du bâtiment</button>' : ''}
        ${filterMarker ? `<span class="muted">Photos du repère <b>${esc(markerRef(filterMarker))}</b></span><button class="ghost small" data-a="all">Voir toutes les photos du site</button>` : `<span class="muted">${projectPhotos().length} photo(s) · ${reportPhotos().length} dans le rapport</span>`}</div>
      <div class="ph-grid">${list.map(p => { const i = projectPhotos().indexOf(p); return `<div class="ph-card" data-id="${p.id}">
          <div class="ph-img" data-a="zoom" title="Agrandir"><img src="${p.url}" alt=""></div>
          <label class="field"><span>Légende</span><input data-f="legende" type="text" value="${esc(p.legende || '')}" ${edit ? '' : 'disabled'} placeholder="ex. Accès principal, vue depuis la rue"></label>
          <label class="field"><span>Repère du matériel</span><select data-f="markerId" ${edit ? '' : 'disabled'}><option value="">— Vue générale du site —</option>${markers.map(m => `<option value="${m.id}" ${m.id === p.markerId ? 'selected' : ''}>${esc(m.txt)}</option>`).join('')}</select></label>
          <div class="ph-foot"><label class="chk"><input data-f="rapport" type="checkbox" ${p.rapport !== false ? 'checked' : ''} ${edit ? '' : 'disabled'}> Dans le rapport</label>
            ${edit ? `<span class="btnrow"><button class="ghost small" data-a="up" title="Avancer">↑</button><button class="ghost small" data-a="down" title="Reculer">↓</button><button class="ghost small danger" data-a="del" title="Supprimer">✕</button></span>` : ''}</div>
          <div class="ph-pos">${p.pos ? `📍 ${esc(photoPlaceTxt(p))}` : '<span class="muted">Non placée sur le plan</span>'}${edit && S.project.levels.length ? ` <button class="ghost small" data-a="place">${p.pos ? 'Déplacer' : 'Placer sur le plan'}</button>${p.pos ? ' <button class="ghost small" data-a="unplace">Retirer</button>' : ''}` : ''}${p.pos ? ' <button class="ghost small" data-a="show">Voir sur le plan</button>' : ''}</div>
          <div class="muted" style="font-size:11px">Photo ${i + 1} · ${esc(frDate(p.date))}${p.fichier ? ` · ${esc(p.fichier)}` : ''}${p.ref ? ` · réf. ${esc(p.ref)}` : ''}</div></div>`; }).join('') || `<p class="muted">Aucune photo${filterMarker ? ' pour ce repère' : ''}. ${edit ? 'Ajoutez les photos prises sur place : vues générales, emplacements de pose, accès, points sensibles.' : ''}</p>`}</div>`;
  };
  body.addEventListener('input', (e) => {
    const c = e.target.closest('.ph-card'); const f = e.target.dataset.f; if (!c || !f) return;
    const p = projectPhotos().find(x => x.id === c.dataset.id);
    p[f] = f === 'rapport' ? e.target.checked : f === 'markerId' ? (e.target.value || null) : e.target.value; setDirty();
    if (f === 'markerId') renderMarkers();
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    const c = b.closest('.ph-card'); const ph = c && projectPhotos().find(x => x.id === c.dataset.id); const arr = projectPhotos(); const i = ph ? arr.indexOf(ph) : -1;
    if (a === 'add') { if (await addSitePhotos(filterMarker)) render(); }
    if (a === 'all') { filterMarker = null; render(); }
    if (a === 'place') { closeFn && closeFn('place:' + ph.id); return; }
    if (a === 'show') { closeFn && closeFn('show:' + ph.id); return; }
    if (a === 'unplace') { ph.pos = null; setDirty(); render(); renderPhotoLayer(); }
    if (a === 'placeAll') { closeFn && closeFn('placeAll'); return; }
    if (a === 'bank') { closeFn && closeFn('bank'); return; }
    if (a === 'zoom') await modal({ title: ph.legende || 'Photo', size: '', body: `<div style="text-align:center"><img src="${ph.url}" style="max-width:100%;max-height:72vh;border-radius:6px" alt=""></div><p class="muted" style="margin:0;text-align:center">${esc(photoCaption(ph, i))}</p>`, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
    if (a === 'up' && i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; setDirty(); render(); }
    if (a === 'down' && i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; setDirty(); render(); }
    if (a === 'del' && await confirmBox('Supprimer la photo', `Supprimer la photo « ${ph.legende || 'sans légende'} » du projet ?`, 'Supprimer', true)) { arr.splice(i, 1); setDirty(); render(); renderMarkers(); }
  });
  render(); let closeFn = null;
  const res = await modal({ title: 'Photos du site', size: '', body, onMount: (root, close) => { closeFn = close; }, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
  renderSide(); renderMarkers();
  if (typeof res === 'string') {
    if (res.startsWith('place:')) startPhotoPlacing(res.slice(6));
    if (res.startsWith('show:')) showPhotoOnPlan(res.slice(5));
    if (res === 'placeAll') placeUnplaced();
    if (res === 'bank' && typeof openBankForProject === 'function') openBankForProject();
  }
}

/* bloc du panneau « Projet » */
function photosSideHtml() {
  const ps = projectPhotos();
  return `<section><h2>Photos du site</h2>
    ${ps.length ? `<div class="ph-strip">${ps.slice(0, 6).map(p => `<img src="${p.url}" alt="" title="${esc(p.legende || '')}">`).join('')}${ps.length > 6 ? `<span class="more">+${ps.length - 6}</span>` : ''}</div>` : '<p class="muted" style="margin:0">Aucune photo. Ajoutez les photos prises sur place : elles peuvent figurer dans le rapport.</p>'}
    ${ps.length ? `<p class="muted" style="margin:0;font-size:12px">${ps.filter(p => p.pos).length} placée(s) sur les plans${level() ? ` · ${levelPhotos(level()).length} sur ce niveau` : ''}. Cliquez sur une pastille 📷 du plan pour voir la photo.</p>` : ''}
    <div class="btnrow">${can('implanter') ? '<button id="phAdd">+ Ajouter</button>' : ''}<button id="phOpen" ${ps.length ? '' : 'disabled'}>Gérer les photos (${ps.length})</button>${can('implanter') && ps.some(p => !p.pos) && S.project.levels.length ? `<button id="phPlace">📍 Placer (${ps.filter(p => !p.pos).length})</button>` : ''}</div>
    ${S.project.batimentId && typeof openBankForProject === 'function' ? '<div class="btnrow"><button id="phBank">🗂 Banque de données du bâtiment</button></div>' : ''}</section>`;
}
function bindPhotosSide() {
  const a = $('#phAdd'); if (a) a.onclick = () => addSitePhotos();
  const o = $('#phOpen'); if (o) o.onclick = () => openPhotos();
  const pl = $('#phPlace'); if (pl) pl.onclick = placeUnplaced;
  const bk = $('#phBank'); if (bk) bk.onclick = () => openBankForProject();
}
/* bouton du panneau d'un matériel */
function markerPhotosHtml(m) {
  const n = photosOfMarker(m.id).length;
  return `<div class="field"><span>Photos de l'emplacement</span><div class="btnrow">${can('implanter') ? '<button id="pPhAdd">+ Photo</button>' : ''}<button id="pPhOpen" ${n ? '' : 'disabled'}>📷 Voir (${n})</button></div></div>`;
}
function bindMarkerPhotos(m) {
  const a = $('#pPhAdd'); if (a) a.onclick = () => addSitePhotos(m.id);
  const o = $('#pPhOpen'); if (o) o.onclick = () => openPhotos(m.id);
}

/* ---------------------------------------------------------------- photos repérées sur le plan (1.14)
   p.pos = { levelId, x, y } : pastille 📷 numérotée sur le niveau ; un clic ouvre la photo.
   Quadrillage de repérage (l.grille) : colonnes A à T, lignes 01 à 14 (références « RDC D.11 »). */
const GRID_COLS = 'ABCDEFGHIJKLMNOPQRST', GRID_ROWS = 14;
const PIN_COLOR = '#ea580c';
/* zone du quadrillage dans l'image : tout le plan, ou l.grilleZone {x, y, w, h} (plan = page entière d'un document) */
const gridZone = (l) => l.grilleZone || { x: 0, y: 0, w: l.plan.w, h: l.plan.h };
function gridRef(l, x, y) {
  if (!l || !l.plan) return '';
  const z = gridZone(l); x -= z.x; y -= z.y;
  if (l.grilleZone && (x < 0 || y < 0 || x > z.w || y > z.h)) return '';
  const c = Math.min(19, Math.max(0, Math.floor(x / z.w * 20))), r = Math.min(GRID_ROWS, Math.max(1, Math.floor(y / z.h * GRID_ROWS) + 1));
  return `${GRID_COLS[c]}.${String(r).padStart(2, '0')}`;
}
function gridCenter(l, col, row) { const z = gridZone(l), c = GRID_COLS.indexOf(String(col).toUpperCase()); return { x: z.x + (c + 0.5) / 20 * z.w, y: z.y + (Math.min(GRID_ROWS, Math.max(1, +row)) - 0.5) / GRID_ROWS * z.h }; }
const levelPhotos = (l) => projectPhotos().filter(p => p.pos && p.pos.levelId === l.id);
const photoLevel = (p) => p.pos && S.project.levels.find(l => l.id === p.pos.levelId);
function photoPlaceTxt(p) { const l = photoLevel(p); const g = l && (l.grille || l.grilleZone) ? gridRef(l, p.pos.x, p.pos.y) : ''; return l ? `${l.name}${g ? ' ' + g : ''}` : ''; }
function photoNum(p) { const l = photoLevel(p); return l ? levelPhotos(l).indexOf(p) + 1 : 0; }

function gridMarkup(l) {
  if (!l || !l.grille) return '';
  const z = gridZone(l), W = z.w, H = z.h, u = Math.max(l.plan.w, l.plan.h) * 0.012, sw = Math.max(l.plan.w, l.plan.h) * 0.0009;
  // l.grille === 'labels' : le plan porte déjà son propre quadrillage (plan importé d'un protocole) — seuls les repères sont ajoutés
  let s = `<g class="grid" pointer-events="none" transform="translate(${z.x} ${z.y})"><g stroke="#0e7490" stroke-opacity="0.45" stroke-width="${sw}">`;
  if (l.grille !== 'labels') {
    for (let i = 0; i <= 20; i++) s += `<line x1="${i * W / 20}" y1="0" x2="${i * W / 20}" y2="${H}"/>`;
    for (let j = 0; j <= GRID_ROWS; j++) s += `<line x1="0" y1="${j * H / GRID_ROWS}" x2="${W}" y2="${j * H / GRID_ROWS}"/>`;
  }
  s += `</g><g font-family="Segoe UI, Arial, sans-serif" font-size="${u}" font-weight="700" fill="#0e7490" text-anchor="middle" dominant-baseline="central">`;
  for (let i = 0; i < 20; i++) s += `<text x="${(i + 0.5) * W / 20}" y="${-u * 0.9}">${GRID_COLS[i]}</text><text x="${(i + 0.5) * W / 20}" y="${H + u * 0.9}">${GRID_COLS[i]}</text>`;
  for (let j = 0; j < GRID_ROWS; j++) { const t = String(j + 1).padStart(2, '0'); s += `<text x="${-u * 1.1}" y="${(j + 0.5) * H / GRID_ROWS}">${t}</text><text x="${W + u * 1.1}" y="${(j + 0.5) * H / GRID_ROWS}">${t}</text>`; }
  return s + '</g></g>';
}
function photoPinsMarkup(l, live = true) {
  if (!l || !S.project.photos) return '';
  const s = markerSize(l) * 1.0;
  return levelPhotos(l).map((p, i) => `<g class="ppin${live && S.photoSel === p.id ? ' sel' : ''}" ${live ? `data-ph="${p.id}"` : ''} transform="translate(${p.pos.x} ${p.pos.y}) scale(${s})">
    ${live ? `<title>Photo ${i + 1}${p.legende ? ' — ' + esc(p.legende) : ''}</title>` : ''}
    <path d="M0 0.62 L-0.2 0.36 A0.46 0.46 0 1 1 0.2 0.36 Z" fill="${PIN_COLOR}" stroke="#fff" stroke-width="0.06"/>
    <rect x="-0.24" y="-0.16" width="0.48" height="0.32" rx="0.06" fill="#fff"/><rect x="-0.1" y="-0.22" width="0.2" height="0.08" rx="0.02" fill="#fff"/>
    <circle r="0.1" fill="${PIN_COLOR}"/><circle r="0.05" fill="#fff"/>
    <g transform="translate(0.48 -0.42)"><circle r="0.2" fill="#0f1724" stroke="#fff" stroke-width="0.04"/><text font-family="Segoe UI, Arial, sans-serif" font-size="0.22" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#fff">${i + 1}</text></g>
    ${live && S.photoSel === p.id ? '<circle r="0.75" fill="none" stroke="#1d4fb8" stroke-width="0.06" stroke-dasharray="0.14 0.09"/>' : ''}
  </g>`).join('');
}
function renderPhotoLayer() {
  const l = level(); const gp = $('#gPhotos'), gg = $('#gGrid'); if (!gp) return;
  gg.innerHTML = gridMarkup(l);
  gp.innerHTML = l && $('#optPhotos').checked ? photoPinsMarkup(l, true) : '';
}
function startPhotoPlacing(id) {
  if (!need('implanter')) return;
  const p = projectPhotos().find(x => x.id === id); if (!p) return;
  if (!level()) { toast('Importez d\'abord un plan.', true); return; }
  S.placePhoto = id; $('#optPhotos').checked = true; setTool('photo');
}
function placePhotoAt(pt) {
  const p = projectPhotos().find(x => x.id === S.placePhoto); const l = level();
  if (p && l) { p.pos = { levelId: l.id, x: Math.round(pt.x), y: Math.round(pt.y) }; S.photoSel = p.id; setDirty(); const g = l.grille || l.grilleZone ? gridRef(l, pt.x, pt.y) : ''; toast(`Photo placée sur ${lvLabel(l, true)}${g ? ' — ' + g : ''}`); }
  const next = S.photoQueue && S.photoQueue.shift();
  if (next) { S.placePhoto = next; renderTool(); renderPhotoLayer(); return; }
  S.placePhoto = null; setTool('select'); renderSide();
}
async function openPhotoView(id) {
  let p = projectPhotos().find(x => x.id === id); if (!p) return;
  S.photoSel = id; renderPhotoLayer();
  const edit = can('implanter');
  const r = await modal({ title: 'Photo', size: '', body: '<div id="pvBox"></div>',
    onMount: (root, close) => {
      const draw = () => {
        const l = photoLevel(p); const list = l ? levelPhotos(l) : [p]; const i = list.indexOf(p);
        $('#pvBox', root).innerHTML = `<div class="pv">
          <div class="pv-img" tabindex="-1">${list.length > 1 ? `<button type="button" class="pv-nav" data-n="-1" title="Photo précédente (←)">‹</button>` : ''}<img src="${p.url}" alt="">${list.length > 1 ? `<button type="button" class="pv-nav r" data-n="1" title="Photo suivante (→)">›</button>` : ''}</div>
          <div class="pv-info"><b>${l ? `Photo ${i + 1} / ${list.length} · ${esc(photoPlaceTxt(p))}` : 'Photo non placée sur le plan'}</b>
            ${edit ? `<input type="text" id="pvLeg" value="${esc(p.legende || '')}" placeholder="Légende">` : `<span>${esc(p.legende || '')}</span>`}
            ${p.ref ? `<span class="muted">Réf. d'origine : ${esc(p.ref)}</span>` : ''}</div>
          ${edit ? `<div class="btnrow"><button type="button" data-a="move">📍 Déplacer sur le plan</button>${p.pos ? '<button type="button" data-a="unplace">Retirer du plan</button>' : ''}<label class="chk"><input type="checkbox" id="pvRap" ${p.rapport !== false ? 'checked' : ''}> Dans le rapport</label><button type="button" class="danger ghost" data-a="del">Supprimer la photo</button></div>` : ''}</div>`;
        const lg = $('#pvLeg', root); if (lg) lg.oninput = () => { p.legende = lg.value; setDirty(); };
        const rp = $('#pvRap', root); if (rp) rp.onchange = () => { p.rapport = rp.checked; setDirty(); };
        $$('[data-n]', root).forEach(b => b.onclick = () => go(+b.dataset.n));
        $$('[data-a]', root).forEach(b => b.onclick = async () => {
          const a = b.dataset.a;
          if (a === 'move') close('move');
          if (a === 'unplace') { p.pos = null; setDirty(); renderPhotoLayer(); draw(); }
          if (a === 'del' && await confirmBox('Supprimer la photo', `Supprimer la photo « ${p.legende || 'sans légende'} » du projet ?`, 'Supprimer', true)) { projectPhotos().splice(projectPhotos().indexOf(p), 1); setDirty(); close('del'); }
        });
      };
      const go = (n) => { const l = photoLevel(p); if (!l) return; const list = levelPhotos(l); p = list[(list.indexOf(p) + n + list.length) % list.length]; S.photoSel = p.id; renderPhotoLayer(); draw(); const im = $('.pv-img', root); if (im) im.focus(); };
      root.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); });
      draw(); setTimeout(() => { const im = $('.pv-img', root); if (im) im.focus(); }, 80);
    },
    buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
  if (r === 'move') return startPhotoPlacing(p.id);
  renderPhotoLayer(); renderSide();
}

function placeUnplaced() {
  const ids = projectPhotos().filter(p => !p.pos).map(p => p.id); if (!ids.length) return;
  S.photoQueue = ids.slice(1); startPhotoPlacing(ids[0]);
}
function showPhotoOnPlan(id) {
  const p = projectPhotos().find(x => x.id === id); if (!p || !p.pos) return;
  if (S.levelId !== p.pos.levelId) selectLevel(p.pos.levelId);
  $('#optPhotos').checked = true; S.photoSel = id;
  requestAnimationFrame(() => { const l = level(); const w = Math.max(l.plan.w, l.plan.h) * 0.35; const el = svg(); const h = w * el.clientHeight / Math.max(1, el.clientWidth); S.vb = { x: p.pos.x - w / 2, y: p.pos.y - h / 2, w, h }; applyVb(); renderPhotoLayer(); });
}
