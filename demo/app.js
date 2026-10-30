/* Blackeyes Implantation — logique de l'application (processus de rendu) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
/* montant en euros, format français (espaces simples : compatibles PDF) */
const euro = (v) => (Math.round((+v || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, ' ') + ' €';
const frDate = (iso) => { const [y, m, d] = (iso || today()).split('-'); return `${d}/${m}/${y}`; };
const SYSTEMS = ['Anti-intrusion', 'Anti-agression', 'Vidéoprotection', 'Commun', 'Autre'];
const MAX_PLAN = 5000;      // côté max d'un plan en pixels
const PDF_RENDER = 3200;    // côté max du rendu d'une page PDF
const SVGNS = 'http://www.w3.org/2000/svg';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const S = {
  db: [], project: null, levelId: null, selId: null,
  tool: 'select', placeType: null, vb: null,
  history: [], future: [], dirty: false, calib: null, drag: null
};

/* ---------------------------------------------------------------- utilitaires UI */
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3200);
}

function modal({ title, body, buttons = [], size = 'sm', left = [], onMount }) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'backdrop';
    root.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
      <header><h3>${esc(title)}</h3><button class="ghost small" data-x aria-label="Fermer">✕</button></header>
      <div class="body"></div>
      <footer><div class="left"></div></footer></div>`;
    const bodyEl = $('.body', root);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const close = (v) => { root.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const mk = (b, parent) => {
      const el = document.createElement('button');
      el.textContent = b.label; if (b.cls) el.className = b.cls;
      el.onclick = async () => {
        if (!b.action) { close(b.value); return; }
        const v = await b.action(root, el); if (v === false) return; close(v === undefined ? b.value : v);
      };
      parent.append(el); return el;
    };
    left.forEach(b => mk(b, $('.left', root)));
    buttons.forEach(b => mk(b, $('footer', root)));
    $('[data-x]', root).onclick = () => close(null);
    const onKey = (e) => {
      if ($('#modalRoot').lastElementChild !== root) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find(b => b.cls && b.cls.includes('primary'));
        if (p) { e.preventDefault(); e.stopPropagation(); $$('footer button', root).find(x => x.textContent === p.label).click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('#modalRoot').append(root);
    if (onMount) onMount(root, close);
    const f = $('input,select,textarea', bodyEl); if (f) setTimeout(() => f.focus(), 30);
  });
}
const confirmBox = (title, text, okLabel = 'Confirmer', danger = false) =>
  modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, buttons: [{ label: 'Annuler', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });

async function askText(title, label, value = '', type = 'text') {
  const r = await modal({
    title, body: `<label class="field"><span>${esc(label)}</span><input id="mAsk" type="${type}" step="any" value="${esc(value)}"></label>`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Valider', cls: 'primary', action: (root) => $('#mAsk', root).value }]
  });
  return r;
}

const bytesToDataUrl = (bytes, mime) => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(new Blob([bytes], { type: mime })); });
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const dataUrlToBytes = (u) => { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const strToBytes = (s) => new TextEncoder().encode(s);

async function normalizePlan(dataUrl) {
  const img = await loadImg(dataUrl);
  let w = img.naturalWidth, h = img.naturalHeight;
  const k = Math.min(1, MAX_PLAN / Math.max(w, h));
  const isPng = dataUrl.startsWith('data:image/png'), isJpg = dataUrl.startsWith('data:image/jpeg');
  if (k === 1 && (isPng || isJpg)) return { dataUrl, w, h };
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  return { dataUrl: c.toDataURL('image/png'), w, h };
}

/* ---------------------------------------------------------------- base de données */
async function loadDb() {
  let db = null;
  try { db = await window.native.loadDb(); } catch {}
  S.db = Array.isArray(db) && db.length ? db : JSON.parse(JSON.stringify(window.DEFAULT_DB));
  migrateDb(S.db);
}
/* 1.5.3 : le Curtain est une barrière laser de franchissement (détection en ligne droite) */
function migrateDb(db) {
  const c = db.find(t => t.id === 'curt'); const ref = (window.DEFAULT_DB || []).find(t => t.id === 'curt');
  if (c && ref && c.zone === undefined && /confirmer/i.test(c.fn || '')) {
    for (const k of ['type', 'fn', 'det', 'zone']) c[k] = ref[k];
    if (c.detRange == null) c.detRange = ref.detRange;
    c.detAngle = null;
  }
  const o = db.find(t => t.id === 'otus'); const oref = (window.DEFAULT_DB || []).find(t => t.id === 'otus');
  if (o && oref && o.detRange == null && o.detAngle == null) { o.detRange = oref.detRange; o.detAngle = oref.detAngle; if (!o.det) o.det = oref.det; }
  // 1.7 : tarifs et compléments issus des devis BLACKEYES (appliqué une fois : base sans aucun champ « prix »)
  if (!db.some(t => 'prix' in t)) {
    for (const ref of (window.DEFAULT_DB || [])) {
      const t = db.find(x => x.id === ref.id);
      if (!t) { if (['ssiren', 'combi', 'doorplus'].includes(ref.id)) db.push(JSON.parse(JSON.stringify(ref))); continue; }
      t.prix = ref.prix ?? null;
      for (const k of ['radio', 'det', 'auto', 'notes']) if (ref[k] && (!t[k] || /non précisé|à vérifier/i.test(t[k]))) t[k] = ref[k];
      for (const k of ['detRange', 'detAngle']) if (t[k] == null && ref[k] != null && !(t.zone === 'faisceau' && k === 'detAngle')) t[k] = ref[k];
    }
    const o2 = db.find(t => t.id === 'otus'); if (o2 && o2.detAngle === 90) o2.detAngle = 88.5;
    const c2 = db.find(t => t.id === 'curt'); if (c2 && c2.detRange === 5) c2.detRange = 11;
  }
  for (const id of ['door', 'lock', 'otus', 'push', 'doorplus']) { const d = db.find(t => t.id === id); if (d && d.iconRot === undefined) d.iconRot = true; }
  // 1.16 : générateur de brouillard
  if (!db.some(t => t.id === 'fog')) { const ref = (window.DEFAULT_DB || []).find(t => t.id === 'fog'); if (ref) { const i = db.findIndex(t => t.sys !== 'Anti-intrusion'); db.splice(i < 0 ? db.length : i, 0, JSON.parse(JSON.stringify(ref))); } }
  // 1.17 : pictogramme « Pièce de confinement » (après les matériels anti-agression)
  if (!db.some(t => t.id === 'pdc')) { const ref = (window.DEFAULT_DB || []).find(t => t.id === 'pdc'); if (ref) { let i = -1; db.forEach((t, k) => { if (t.sys === 'Anti-agression') i = k; }); db.splice(i < 0 ? db.length : i + 1, 0, JSON.parse(JSON.stringify(ref))); } }
  // 1.13 : caméras de vidéoprotection (extérieur) et de vidéosurveillance (intérieur), hors devis
  if (!db.some(t => t.id === 'vpext' || t.id === 'vsint' || t.sys === 'Vidéoprotection'))
    for (const id of ['vpext', 'vsint']) { const ref = (window.DEFAULT_DB || []).find(t => t.id === id); if (ref) db.push(JSON.parse(JSON.stringify(ref))); }
}
/* forme de la zone de détection : 'faisceau' (ligne droite), 'secteur', 'cercle' ou '' */
function zoneKind(m) {
  const t = typeOf(m.typeId);
  if (t.zone === 'faisceau') return 'faisceau';
  const ang = m.angle ?? t.detAngle;
  return ang && ang < 360 ? 'secteur' : 'cercle';
}
const hasZoneDir = (m) => { const t = typeOf(m.typeId); return zoneKind(m) !== 'cercle' && !!(t.zone === 'faisceau' || (m.angle ?? t.detAngle)); };
/* icône qui pivote avec l'orientation (ex. DoorProtect, à aligner sur la porte) */
const iconTurns = (m) => !!typeOf(m.typeId).iconRot;
const hasDirection = (m) => zoneKind(m) !== 'cercle' || iconTurns(m);
/* géométrie d'un faisceau en unités du plan : longueur, largeur visible, direction */
function beamGeom(m, l) {
  const t = typeOf(m.typeId); const L = (m.range ?? t.detRange ?? 0) * l.scale;
  const a = m.rot * Math.PI / 180;
  return { L, w: Math.max(0.35 * l.scale, L * 0.025), dx: Math.cos(a), dy: Math.sin(a) };
}
async function saveDb() { try { await window.native.saveDb(S.db); } catch (e) { toast('Impossible d\'enregistrer la base : ' + e.message, true); } }
const typeOf = (id) => S.db.find(t => t.id === id) || (S.project && S.project.typeCache && S.project.typeCache[id]) ||
  { id, code: '?', nom: 'Matériel inconnu', sys: 'Autre', type: '', couleur: '#64748b', img: '' };

/* ---------------------------------------------------------------- droits */
const can = (p) => !!S.user && (S.user.role === 'admin' || !!(S.user.perms && S.user.perms[p]));
const PERM_MSG = {
  tarifs: 'Votre compte ne permet pas de voir les tarifs.',
  facturation: 'Votre compte ne permet pas d\'accéder aux devis et factures.',
  plans: 'Votre compte ne permet pas d\'importer des plans ni de modifier les niveaux.',
  implanter: 'Votre compte est en consultation : il ne permet pas de modifier l\'implantation.',
  projets: 'Votre compte ne permet pas d\'enregistrer les projets.',
  exportPptx: 'Votre compte ne permet pas l\'export PowerPoint.', exportPdf: 'Votre compte ne permet pas l\'export PDF.', exportDocx: 'Votre compte ne permet pas l\'export du dossier Word.',
  exportCsv: 'Votre compte ne permet pas l\'export du quantitatif.', base: 'Votre compte ne permet pas de modifier la base des matériels.'
};
function need(p) { if (can(p)) return true; toast(PERM_MSG[p] + ' Demandez ce droit à l\'administrateur.', true); return false; }

/* ---------------------------------------------------------------- projet */
function newProject() {
  return { app: 'blackeyes-implantation', version: 1, name: 'Nouveau projet', site: '', author: '', date: today(), markerScale: 1, levels: [], typeCache: {} };
}
const level = () => S.project.levels.find(l => l.id === S.levelId) || null;
const marker = () => { const l = level(); return l ? l.markers.find(m => m.id === S.selId) || null : null; };
const markerSize = (l) => Math.max(l.plan.w, l.plan.h) * 0.024 * (S.project.markerScale || 1);
const allMarkers = () => S.project.levels.flatMap(l => l.markers.map(m => ({ ...m, levelName: l.name })));

function setDirty(v = true) { S.dirty = v; $('#dirty').hidden = !v; document.title = `${S.project.name}${v ? ' •' : ''} — Blackeyes 2`; }

function snapshot() { return JSON.stringify(S.project.levels.map(l => ({ id: l.id, scale: l.scale, markers: l.markers, notes: l.notes || [], planRot: l.planRot || 0, planVer: l.planVer || null, kind: l.kind || null }))); }
function pushHistory() { S.history.push(snapshot()); if (S.history.length > 80) S.history.shift(); S.future = []; updateUndo(); }
function restore(snap) {
  const data = JSON.parse(snap);
  const rot = [];
  data.forEach(d => { const l = S.project.levels.find(x => x.id === d.id); if (!l) return; l.markers = d.markers; l.scale = d.scale; l.notes = d.notes || [];
    if (d.kind) l.kind = d.kind; else delete l.kind;
    // image du plan modifiée (masque, recadrage) : on reprend la version enregistrée
    if (d.planVer && d.planVer !== l.planVer && PLAN_VERS.has(d.planVer)) { const v = PLAN_VERS.get(d.planVer); l.plan = v.plan; if (v.planOrig) l.planOrig = v.planOrig; else delete l.planOrig; if (v.planRot) l.planRot = v.planRot; else delete l.planRot; l.planVer = d.planVer; return; }
    if ((l.planRot || 0) !== (d.planRot || 0)) rot.push([l, d.planRot || 0]); });
  if (rot.length) Promise.all(rot.map(([l, a]) => setPlanRotation(l, a, false))).then(() => { renderPlan(); renderMarkers(); requestAnimationFrame(fit); });
  if (!marker()) S.selId = null;
  setDirty(); renderAll();
}
function undo() { if (!S.history.length || !can('implanter')) return; S.future.push(snapshot()); restore(S.history.pop()); updateUndo(); }
function redo() { if (!S.future.length || !can('implanter')) return; S.history.push(snapshot()); restore(S.future.pop()); updateUndo(); }
function updateUndo() { $('#bUndo').disabled = !S.history.length || !can('implanter'); $('#bRedo').disabled = !S.future.length || !can('implanter'); }

function nextLabel(typeId) {
  const t = typeOf(typeId);
  const used = new Set(allMarkers().map(m => m.label));
  let n = 1; while (used.has(`${t.code}${n}`)) n++;
  return `${t.code}${n}`;
}

function addMarker(typeId, x, y) {
  const l = level(); if (!l || !need('implanter')) return;
  const t = typeOf(typeId);
  pushHistory();
  const m = { id: uid(), typeId, x, y, label: nextLabel(typeId), local: '', rot: 0, showZone: true, range: null, angle: null, note: '' };
  l.markers.push(m);
  S.selId = m.id; setDirty();
  if (t.detRange && !l.scale && !isPhoto(l)) toast('Définissez l\'échelle du plan (bouton Échelle) pour afficher la zone de détection.');
  renderMarkers(); renderSide(); renderStatus();
}

function deleteSelected() {
  const l = level(); const m = marker(); if (!l || !m || !need('implanter')) return;
  pushHistory(); l.markers = l.markers.filter(x => x.id !== m.id); S.selId = null; setDirty(); renderMarkers(); renderSide(); renderStatus();
}
function flipSelected(axis) {
  const l = level(); const m = marker(); if (!l || !m || !need('implanter')) return;
  pushHistory(); const k = axis === 'H' ? 'flipH' : 'flipV'; m[k] = !m[k]; if (!m[k]) delete m[k];
  setDirty(); renderMarkers(); renderSide();
}
function duplicateSelected() {
  const l = level(); const m = marker(); if (!l || !m || !need('implanter')) return;
  pushHistory();
  const s = markerSize(l);
  const c = { ...m, id: uid(), x: m.x + s * 1.6, y: m.y, label: nextLabel(m.typeId) };
  l.markers.push(c); S.selId = c.id; setDirty(); renderMarkers(); renderSide(); renderStatus();
}

/* ---------------------------------------------------------------- rotation du plan
   Le plan d'origine est conservé (planOrig) : chaque rotation repart de l'original, sans perte de qualité.
   Les matériels tournent avec le plan (position et orientation). */
async function renderRotatedPlan(orig, angle) {
  const a = ((angle % 360) + 360) % 360;
  if (!a) return { dataUrl: orig.dataUrl, w: orig.w, h: orig.h };
  const img = await loadImg(orig.dataUrl); const r = a * Math.PI / 180;
  const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
  const W = Math.round(orig.w * c + orig.h * sn), H = Math.round(orig.w * sn + orig.h * c);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(r); g.drawImage(img, -orig.w / 2, -orig.h / 2, orig.w, orig.h);
  return { dataUrl: cv.toDataURL(a % 90 ? 'image/jpeg' : 'image/png', 0.92), w: W, h: H };
}
async function setPlanRotation(l, total, moveMarkers = true) {
  total = Math.round((((total % 360) + 360) % 360) * 10) / 10;
  const prev = l.planRot || 0; const d = total - prev; if (!d) return;
  if (!l.planOrig) l.planOrig = { ...l.plan };
  const old = { w: l.plan.w, h: l.plan.h };
  const np = await renderRotatedPlan(l.planOrig, total);
  if (moveMarkers) {
    const r = d * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    l.markers.forEach(m => {
      const dx = m.x - old.w / 2, dy = m.y - old.h / 2;
      m.x = np.w / 2 + dx * cs - dy * sn; m.y = np.h / 2 + dx * sn + dy * cs;
      m.rot = Math.round(((m.rot + d) % 360 + 360) % 360);
    });
    (l.notes || []).forEach(n => { const dx = n.x - old.w / 2, dy = n.y - old.h / 2; n.x = Math.round(np.w / 2 + dx * cs - dy * sn); n.y = Math.round(np.h / 2 + dx * sn + dy * cs); });
    (S.project.photos || []).filter(p => p.pos && p.pos.levelId === l.id).forEach(p => { const dx = p.pos.x - old.w / 2, dy = p.pos.y - old.h / 2; p.pos.x = Math.round(np.w / 2 + dx * cs - dy * sn); p.pos.y = Math.round(np.h / 2 + dx * sn + dy * cs); });
  }
  if (typeof asInvalidate === 'function') asInvalidate(l);
  if (total === 0) { l.plan = l.planOrig; delete l.planOrig; delete l.planRot; }
  else { l.plan = np; l.planRot = total; }
}
async function rotatePlan(delta, absolute = null) {
  const l = level(); if (!l || !need('plans')) return;
  const target = absolute ?? ((l.planRot || 0) + delta);
  toast('Rotation du plan…');
  pushHistory();
  try { await setPlanRotation(l, target); } catch (e) { toast('Rotation impossible : ' + e.message, true); return; }
  setDirty(); renderPlan(); renderMarkers(); renderSide(); requestAnimationFrame(fit);
  toast(l.planRot ? `Plan pivoté : ${String(l.planRot).replace('.', ',')}°` : 'Orientation d\'origine du plan rétablie');
}
async function rotatePlanDialog() {
  const l = level(); if (!l || !need('plans')) return;
  const cur = l.planRot || 0; const shown = cur > 180 ? cur - 360 : cur;
  const v = await modal({
    title: 'Pivoter le plan', size: 'sm',
    body: `<p style="margin:0" class="muted">Angle par rapport au plan d'origine, en degrés. Positif = sens des aiguilles d'une montre. Utile pour redresser un plan scanné légèrement de travers.</p>
      <div class="rot"><input id="rpR" type="range" min="-180" max="180" step="0.5" value="${shown}"><input id="rpN" type="number" min="-180" max="180" step="0.5" value="${shown}"></div>`,
    onMount: (root) => { const r = $('#rpR', root), n = $('#rpN', root); r.oninput = () => (n.value = r.value); n.oninput = () => (r.value = n.value); },
    buttons: [{ label: 'Annuler', value: null }, { label: 'Appliquer', cls: 'primary', action: (root) => { const x = parseFloat(String($('#rpN', root).value).replace(',', '.')); if (!Number.isFinite(x)) { toast('Saisissez un angle.', true); return false; } return x; } }]
  });
  if (v !== null && v !== undefined) await rotatePlan(0, v);
}

/* ---------------------------------------------------------------- nettoyage du plan : masquer une zone, recadrer
   L'image du plan est modifiée (les exports en héritent). Chaque version est gardée en mémoire pour Ctrl+Z. */
const PLAN_VERS = new Map();
const keepVer = (l) => { if (!l.planVer) l.planVer = uid(); if (!PLAN_VERS.has(l.planVer)) PLAN_VERS.set(l.planVer, { plan: l.plan, planOrig: l.planOrig, planRot: l.planRot }); };
const normRect = (a, b, l) => { const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y)); return { x, y, w: Math.min(l.plan.w, Math.max(a.x, b.x)) - x, h: Math.min(l.plan.h, Math.max(a.y, b.y)) - y }; };
async function editPlanImage(l, W, H, draw) {
  const img = await loadImg(l.plan.dataUrl);
  const cv = document.createElement('canvas'); cv.width = Math.round(W); cv.height = Math.round(H);
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); draw(g, img);
  const jpeg = /^data:image\/jpe?g/i.test(l.plan.dataUrl);
  keepVer(l); pushHistory();
  l.plan = { ...l.plan, dataUrl: cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92), w: cv.width, h: cv.height };
  delete l.planOrig; delete l.planRot;                       // l'orientation en cours est conservée telle quelle
  l.planVer = uid(); PLAN_VERS.set(l.planVer, { plan: l.plan });
  if (typeof asInvalidate === 'function') asInvalidate(l);
  setDirty();
}
async function maskZone(r) {
  const l = level(); if (!l || !need('plans')) return;
  if (r.w < 3 || r.h < 3) return;
  await editPlanImage(l, l.plan.w, l.plan.h, (g, img) => { g.drawImage(img, 0, 0, l.plan.w, l.plan.h); g.fillStyle = '#fff'; g.fillRect(r.x, r.y, r.w, r.h); });
  renderPlan(); renderMarkers(); toast('Zone masquée. Tracez-en une autre, ou Échap pour terminer (Ctrl+Z pour annuler).');
}
async function cropPlan(r) {
  const l = level(); if (!l || !need('plans')) return;
  if (r.w < 20 || r.h < 20) { toast('Cadre trop petit.', true); return; }
  const out = l.markers.filter(m => m.x < r.x || m.y < r.y || m.x > r.x + r.w || m.y > r.y + r.h);
  if (out.length && !(await confirmBox('Recadrer le plan', `${out.length} matériel(s) (${out.map(m => m.label).join(', ')}) se trouvent hors du cadre et seront supprimés. Continuer ?`, 'Recadrer', true))) { S.drag = null; renderOverlay(); return; }
  await editPlanImage(l, r.w, r.h, (g, img) => g.drawImage(img, -r.x, -r.y, l.plan.w, l.plan.h));
  l.markers = l.markers.filter(m => !out.includes(m)).map(m => ({ ...m, x: m.x - r.x, y: m.y - r.y }));
  l.notes = (l.notes || []).map(n => ({ ...n, x: n.x - r.x, y: n.y - r.y })).filter(n => n.x >= 0 && n.y >= 0 && n.x <= r.w && n.y <= r.h);
  (S.project.photos || []).filter(p => p.pos && p.pos.levelId === l.id).forEach(p => { p.pos.x -= r.x; p.pos.y -= r.y; if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > r.w || p.pos.y > r.h) p.pos = null; });
  if (out.some(m => m.id === S.selId)) S.selId = null;
  setTool('select'); renderAll(); requestAnimationFrame(fit); toast('Plan recadré (Ctrl+Z pour annuler).');
}

/* ---------------------------------------------------------------- dessin SVG */
function defsMarkup(types) {
  return types.map(t => t.img ? `<image id="ti-${esc(t.id)}" href="${t.img}" x="-0.36" y="-0.36" width="0.72" height="0.72" preserveAspectRatio="xMidYMid meet"/>` : '').join('');
}

function zonePath(m, l) {
  const t = typeOf(m.typeId);
  const range = m.range ?? t.detRange, ang = m.angle ?? t.detAngle;
  if (!range || !l.scale || m.showZone === false) return '';
  const R = range * l.scale;
  if (zoneKind(m) === 'faisceau') {
    const { L, w } = beamGeom(m, l); const c = t.couleur, sw = Math.max(w * 0.12, 0.6);
    return `<g transform="translate(${m.x} ${m.y}) rotate(${m.rot})">
      <rect x="0" y="${-w / 2}" width="${L}" height="${w}" fill="${c}" fill-opacity="0.16" stroke="none"/>
      <line x1="0" y1="0" x2="${L}" y2="0" stroke="#dc2626" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 2.5}"/>
      <line x1="${L}" y1="${-w * 1.1}" x2="${L}" y2="${w * 1.1}" stroke="${c}" stroke-width="${sw * 2.2}" stroke-linecap="round"/></g>`;
  }
  if (!ang || ang >= 360) return `<circle cx="${m.x}" cy="${m.y}" r="${R}" fill="${t.couleur}" fill-opacity="0.14" stroke="${t.couleur}" stroke-opacity="0.6" stroke-width="${R * 0.006}"/>`;
  const a1 = (m.rot - ang / 2) * Math.PI / 180, a2 = (m.rot + ang / 2) * Math.PI / 180;
  const p1 = [m.x + R * Math.cos(a1), m.y + R * Math.sin(a1)], p2 = [m.x + R * Math.cos(a2), m.y + R * Math.sin(a2)];
  return `<path d="M${m.x} ${m.y} L${p1[0]} ${p1[1]} A${R} ${R} 0 ${ang > 180 ? 1 : 0} 1 ${p2[0]} ${p2[1]} Z" fill="${t.couleur}" fill-opacity="0.16" stroke="${t.couleur}" stroke-opacity="0.65" stroke-width="${Math.max(R * 0.006, 1)}"/>`;
}

function markerMarkup(m, l, { selected = false, live = true } = {}) {
  const t = typeOf(m.typeId); const s = markerSize(l);
  const label = m.label || t.code; const lw = Math.max(0.6, label.length * 0.2 + 0.22);
  const hasDir = hasDirection(m), tick = hasZoneDir(m);
  const iconTf = [iconTurns(m) && m.rot ? `rotate(${m.rot})` : '', m.flipH || m.flipV ? `scale(${m.flipH ? -1 : 1} ${m.flipV ? -1 : 1})` : ''].filter(Boolean).join(' ');
  return `<g class="mk" ${live ? `data-id="${m.id}"` : ''} transform="translate(${m.x} ${m.y}) scale(${s})">
    ${tick ? `<path d="M0.52 -0.13 L0.8 0 L0.52 0.13 Z" fill="${t.couleur}" transform="rotate(${m.rot})"/>` : ''}
    <circle r="0.5" fill="#fff" stroke="${t.couleur}" stroke-width="0.07"/>
    ${t.img ? `<use href="#ti-${esc(t.id)}"${iconTf ? ` transform="${iconTf}"` : ''}/>` : `<text font-size="0.32" text-anchor="middle" dominant-baseline="central" fill="${t.couleur}" font-weight="700">${esc(t.code)}</text>`}
    <g transform="translate(0 0.8)"><rect x="${-lw / 2}" y="-0.2" width="${lw}" height="0.4" rx="0.08" fill="${t.couleur}"/>
    <text font-family="Segoe UI, Arial, sans-serif" font-size="0.29" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#fff">${esc(label)}</text></g>
    ${live && S.project.photos && photosOfMarker(m.id).length ? `<g transform="translate(0.44 -0.44)"><title>${photosOfMarker(m.id).length} photo(s)</title><circle r="0.21" fill="#0f1724" stroke="#fff" stroke-width="0.04"/><rect x="-0.11" y="-0.06" width="0.22" height="0.14" rx="0.02" fill="#fff"/><circle r="0.045" cy="0.01" fill="#0f1724"/></g>` : ''}
    ${selected ? `<circle r="0.7" fill="none" stroke="#1d4fb8" stroke-width="0.06" stroke-dasharray="0.14 0.09"/>` : ''}
    ${selected && hasDir ? `<g transform="rotate(${m.rot})"><line x1="0.8" y1="0" x2="1.3" y2="0" stroke="#1d4fb8" stroke-width="0.05"/><circle class="rot-handle" cx="1.42" cy="0" r="0.16" fill="#1d4fb8" stroke="#fff" stroke-width="0.04"/></g>` : ''}
  </g>`;
}

const svg = () => $('#stage');
function renderDefs() { $('#defs').innerHTML = defsMarkup(S.db.concat(Object.values(S.project.typeCache || {}).filter(t => !S.db.find(d => d.id === t.id)))); }
function renderPlan() {
  const l = level();
  $('#empty').hidden = !!l;
  $('#gPlan').innerHTML = l ? `<rect x="0" y="0" width="${l.plan.w}" height="${l.plan.h}" fill="#fff"/><image href="${l.plan.dataUrl}" x="0" y="0" width="${l.plan.w}" height="${l.plan.h}"/>` : '';
}
function renderMarkers() {
  const l = level();
  if (!l) { if ($('#gAssist')) $('#gAssist').innerHTML = $('#gAssistBg').innerHTML = ''; $('#gZones').innerHTML = $('#gMarkers').innerHTML = $('#gOverlay').innerHTML = $('#gPhotos').innerHTML = $('#gGrid').innerHTML = $('#gNotes').innerHTML = ''; return; }
  $('#gZones').innerHTML = $('#optZones').checked ? l.markers.map(m => zonePath(m, l)).join('') : '';
  const sorted = [...l.markers].sort((a, b) => (a.id === S.selId) - (b.id === S.selId));
  $('#gMarkers').innerHTML = sorted.map(m => markerMarkup(m, l, { selected: m.id === S.selId })).join('');
  if (typeof renderPhotoLayer === 'function') renderPhotoLayer(); if (typeof renderNotes === 'function') renderNotes(); if (typeof renderAssist === 'function') renderAssist(); renderOverlay();
}
function renderOverlay() {
  const l0 = level(); const d = S.drag;
  if (l0 && d && d.mode === 'rect') {
    const r = normRect(d.a, d.b, l0), w = Math.max(l0.plan.w, l0.plan.h) * 0.002;
    $('#gOverlay').innerHTML = S.tool === 'crop'
      ? `<path d="M0 0H${l0.plan.w}V${l0.plan.h}H0Z M${r.x} ${r.y}v${r.h}h${r.w}v${-r.h}Z" fill="#0f1724" fill-opacity="0.45" fill-rule="evenodd"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#1d4fb8" stroke-width="${w * 1.5}" stroke-dasharray="${w * 5} ${w * 3}"/>`
      : `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#fff" fill-opacity="0.85" stroke="#c8102e" stroke-width="${w * 1.5}" stroke-dasharray="${w * 5} ${w * 3}"/>`;
    return;
  }
  const l = level(); const c = S.calib;
  if (!l || !c || !c.a) { $('#gOverlay').innerHTML = ''; return; }
  const w = Math.max(l.plan.w, l.plan.h) * 0.002, b = c.b || c.hover || c.a;
  $('#gOverlay').innerHTML = `<line x1="${c.a.x}" y1="${c.a.y}" x2="${b.x}" y2="${b.y}" stroke="#c8102e" stroke-width="${w}" stroke-dasharray="${w * 4} ${w * 2}"/>
    <circle cx="${c.a.x}" cy="${c.a.y}" r="${w * 3}" fill="#c8102e"/>${c.b ? `<circle cx="${c.b.x}" cy="${c.b.y}" r="${w * 3}" fill="#c8102e"/>` : ''}`;
}

/* vue (zoom / déplacement) */
function applyVb() { const v = S.vb; if (!v) return; svg().setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); const l = level(); if (l) $('#zoomVal').textContent = Math.round(svg().clientWidth / v.w * 100) + ' %'; }
function fit() {
  const l = level(); if (!l) return;
  const el = svg(); const W = el.clientWidth || 800, H = el.clientHeight || 600;
  const pad = 0.04; const pw = l.plan.w * (1 + pad * 2), ph = l.plan.h * (1 + pad * 2);
  const k = Math.max(pw / W, ph / H);
  const w = W * k, h = H * k;
  S.vb = { x: l.plan.w / 2 - w / 2, y: l.plan.h / 2 - h / 2, w, h }; applyVb();
}
function zoomAt(f, cx, cy) {
  const v = S.vb; if (!v) return;
  const nw = v.w * f; const scale = svg().clientWidth / nw; if (scale > 20 || scale < 0.01) return;
  const nh = v.h * f;
  S.vb = { x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w: nw, h: nh }; applyVb();
}
function toPlan(evt) {
  const el = svg(); const pt = el.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(el.getScreenCTM().inverse()); return { x: p.x, y: p.y };
}
new ResizeObserver(() => {
  const el = svg(); if (!S.vb || !el.clientWidth) return;
  S.vb.h = S.vb.w * el.clientHeight / el.clientWidth; applyVb();
}).observe(document.getElementById('stageWrap'));

/* ---------------------------------------------------------------- panneaux */
function renderCatalog() {
  const q = $('#catSearch').value.trim().toLowerCase();
  const items = S.db.filter(t => !q || `${t.nom} ${t.code} ${t.type} ${t.sys} ${t.fn}`.toLowerCase().includes(q));
  const groups = SYSTEMS.map(s => [s, items.filter(t => (SYSTEMS.includes(t.sys) ? t.sys : 'Autre') === s)]).filter(g => g[1].length);
  $('#catList').innerHTML = groups.map(([s, arr]) => `<div class="cat-sys">${esc(s)}</div>` + arr.map(t => `
    <div class="cat-item ${S.tool === 'place' && S.placeType === t.id ? 'active' : ''}" data-type="${esc(t.id)}" draggable="true" title="${esc(t.fn)}">
      <div class="ph">${t.img ? `<img src="${t.img}" alt="">` : ''}</div>
      <div class="tx"><div class="nm">${esc(t.nom)}</div><div class="ty">${esc(t.type)}</div></div>
      <span class="code" style="background:${esc(t.couleur)}">${esc(t.code)}</span>
    </div>`).join('')).join('') || '<p class="muted" style="padding:8px">Aucun matériel trouvé.</p>';
}

function renderLevels() {
  $('#levelTabs').innerHTML = S.project.levels.map(l => `
    <div class="tab ${l.id === S.levelId ? 'active' : ''}" data-level="${l.id}" role="tab" title="Double-cliquez pour renommer">
      <span>${isPhoto(l) ? '<span title="Photo du site">📷 </span>' : ''}${esc(l.name)}</span><span class="n">${l.markers.length}</span>
      <button class="x" data-del-level="${l.id}" title="Supprimer ce niveau">×</button></div>`).join('');
}

function qtyRows(scopeLevels) {
  const counts = {};
  scopeLevels.forEach(l => l.markers.forEach(m => counts[m.typeId] = (counts[m.typeId] || 0) + 1));
  return Object.entries(counts).map(([id, n]) => ({ t: typeOf(id), n })).sort((a, b) => S.db.indexOf(a.t) - S.db.indexOf(b.t));
}

function renderSide() {
  const side = $('#side'); const l = level(); const m = marker();
  if (!m && S.assist && l && S.assist.levelId === l.id && typeof renderAssistSide === 'function') { renderAssistSide(); return; }
  if (m && l) {
    const t = typeOf(m.typeId);
    const hasZone = !!(t.detRange || m.range); const beam = zoneKind(m) === 'faisceau';
    side.innerHTML = `
    <section>
      <div class="prop-head"><div class="ph">${t.img ? `<img src="${t.img}" alt="">` : ''}</div>
        <div><div class="nm">${esc(t.nom)}</div><div class="ty">${esc(t.type)} · ${esc(t.sys)}</div></div></div>
      <div class="row2">
        <label class="field"><span>Repère</span><input id="pLabel" type="text" value="${esc(m.label)}"></label>
        <label class="field"><span>Local / pièce</span><input id="pLocal" type="text" value="${esc(m.local)}" placeholder="ex. Hall"></label>
      </div>
      <div class="field"><span>Orientation</span>
        <div class="rot"><input id="pRotR" type="range" min="0" max="359" value="${Math.round(m.rot)}"><input id="pRot" type="number" min="0" max="359" value="${Math.round(m.rot)}"></div></div>
      <label class="chk"><input id="pZone" type="checkbox" ${m.showZone !== false ? 'checked' : ''}> Afficher la zone de détection</label>
      ${beam ? `<div class="row2">
        <label class="field"><span>Longueur du faisceau (m)</span><input id="pRange" type="number" min="0" step="0.1" value="${m.range ?? ''}" placeholder="${t.detRange ?? 'non définie'}"></label>
        <div class="field"><span>Détection</span><div class="muted" style="padding-top:6px">Ligne droite (franchissement)</div></div>
      </div>
      <div class="muted" style="font-size:12px;margin:-2px 0 8px">Orientez le faisceau avec la poignée bleue et réglez sa longueur sur la largeur de l'ouverture protégée.</div>` : `<div class="row2">
        <label class="field"><span>Portée (m)</span><input id="pRange" type="number" min="0" step="0.5" value="${m.range ?? ''}" placeholder="${t.detRange ?? 'non définie'}"></label>
        <label class="field"><span>Angle (°)</span><input id="pAngle" type="number" min="0" max="360" step="0.5" value="${m.angle ?? ''}" placeholder="${t.detAngle ?? '360'}"></label>
      </div>`}
      ${hasZone && !l.scale ? (isPhoto(l) ? '<div class="info">Photo du site : pose indicative. La zone de détection n\'est pas tracée (perspective) ; la flèche indique l\'orientation.</div>' : '<div class="warnbox">Échelle non définie : la zone de détection n\'est pas affichée. Utilisez l\'outil Échelle.</div>') : ''}
      ${/siren/.test(t.id) ? `<label class="field"><span>Signal à l'alarme</span><select id="pSig"><option value="les2" ${(m.signal || 'les2') === 'les2' ? 'selected' : ''}>Alarme sonore et flashs lumineux</option><option value="son" ${m.signal === 'son' ? 'selected' : ''}>Alarme sonore seulement</option><option value="flash" ${m.signal === 'flash' ? 'selected' : ''}>Flashs lumineux seulement (alarme silencieuse)</option></select></label>` : ''}
      <label class="field"><span>Note</span><textarea id="pNote" placeholder="Hauteur de pose, remarque…">${esc(m.note)}</textarea></label>
      <div class="field"><span>Retourner l'icône</span>
        <div class="btnrow"><button id="pFlipH" class="${m.flipH ? 'on' : ''}" aria-pressed="${!!m.flipH}" title="Retourner horizontalement (H)">↔ Horizontalement</button><button id="pFlipV" class="${m.flipV ? 'on' : ''}" aria-pressed="${!!m.flipV}" title="Retourner verticalement (Maj+H)">↕ Verticalement</button></div></div>
      ${markerPhotosHtml(m)}
      <div class="btnrow"><button id="pFiche">📄 Fiche</button><button id="pDup">Dupliquer</button><button id="pDel" class="danger">Supprimer</button></div>
    </section>
    <section>
      <h2>Caractéristiques</h2>
      <dl class="kv">
        <dt>Fonction</dt><dd>${esc(t.fn) || '—'}</dd>
        <dt>Portée radio</dt><dd>${esc(t.radio) || '—'}</dd>
        <dt>Détection</dt><dd>${esc(t.det) || '—'}</dd>
        <dt>Autonomie</dt><dd>${esc(t.auto) || '—'}</dd>
      </dl>
      ${t.notes ? `<p class="info" style="margin:0">${esc(t.notes)}</p>` : ''}
    </section>`;
    bindProps(m, l);
    if (!can('implanter')) $$('#side section:first-child input, #side section:first-child textarea, #side section:first-child button').forEach(el => el.disabled = true);
    return;
  }
  const rowsL = l ? qtyRows([l]) : []; const rowsT = qtyRows(S.project.levels);
  side.innerHTML = `
    <section>
      <h2>Projet</h2>
      <label class="field"><span>Client (maître d'ouvrage)</span><input id="prClient" type="text" list="prClientList" value="${esc(S.project.client || '')}" placeholder="ex. Mairie de …, bailleur, société…"><datalist id="prClientList">${typeof clientNames === 'function' ? clientNames().map(n => `<option value="${esc(n)}"></option>`).join('') : ''}</datalist></label>
      <label class="field"><span>Bâtiment sur la carte</span><select id="prBat">${typeof batOptions === 'function' ? batOptions() : ''}</select></label>
      <label class="field"><span>Site / bâtiment (texte des exports)</span><input id="prSite" type="text" value="${esc(S.project.site)}" placeholder="ex. École Anatole France"></label>
      <div class="row2">
        <label class="field"><span>Référence du dossier</span><input id="prRef" type="text" value="${esc(S.project.reference || '')}" placeholder="ex. BKE-2026-001"></label>
        <label class="field"><span>Indice</span><input id="prInd" type="text" maxlength="3" value="${esc(S.project.indice || 'A')}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Établi par</span><input id="prAuthor" type="text" value="${esc(S.project.author)}"></label>
        <label class="field"><span>Vérifié par</span><input id="prVerif" type="text" value="${esc(S.project.verificateur || '')}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Date</span><input id="prDate" type="text" value="${esc(frDate(S.project.date))}"></label>
        <span></span>
      </div>
      <label class="field"><span>Objet / observations (dossier Word)</span><textarea id="prObjet" placeholder="ex. Mise en sûreté de l'école avant la rentrée ; points d'attention…">${esc(S.project.objet || '')}</textarea></label>
    </section>
    ${photosSideHtml()}
    ${l ? `<section>
      <h2>Niveau « ${esc(l.name)} »</h2>
      ${can('plans') ? `<div class="field"><span>Orientation du plan${l.planRot ? ` : ${String(l.planRot).replace('.', ',')}°` : ''}</span>
        <div class="btnrow"><button id="lvRotL" title="Pivoter de 90° vers la gauche">↺ 90°</button><button id="lvRotR" title="Pivoter de 90° vers la droite">↻ 90°</button><button id="lvRot180">180°</button><button id="lvRotA" title="Angle libre">Angle…</button>${l.planRot ? '<button id="lvRot0" class="ghost">Origine</button>' : ''}</div></div>
        <div class="field"><span>Nettoyer le plan (cartouche, légendes, encadrés)</span>
        <div class="btnrow"><button id="lvMask" class="${S.tool === 'mask' ? 'on' : ''}" title="Effacer une zone du plan en la recouvrant de blanc">▭ Masquer une zone</button><button id="lvCrop" class="${S.tool === 'crop' ? 'on' : ''}" title="Ne garder qu'une partie du plan">⌗ Recadrer</button></div></div>` : ''}
      <div class="field"><span>Quadrillage de repérage (A à T, 01 à 14)</span><div class="btnrow"><button id="lvGrid" class="${l.grille ? 'on' : ''}" ${can('plans') || can('implanter') ? '' : 'disabled'}>${l.grille ? '▦ Masquer le quadrillage' : '▦ Afficher le quadrillage'}</button></div></div>
      <div class="field"><span>Type de fond</span><div class="btnrow"><button id="lvKindPlan" class="${!isPhoto(l) ? 'on' : ''}" ${can('plans') ? '' : 'disabled'}>Plan à l'échelle</button><button id="lvKindPhoto" class="${isPhoto(l) ? 'on' : ''}" ${can('plans') ? '' : 'disabled'}>📷 Photo du site</button></div></div>
      <div class="info">${isPhoto(l) ? 'Photo du site : les matériels sont posés à leur emplacement réel sur l\'image. Pas d\'échelle ni de zones de détection (perspective) ; l\'orientation reste indiquée.' : l.scale ? `Échelle : 1 m = ${l.scale.toFixed(1)} px du plan` : 'Échelle non définie. Cliquez sur Échelle puis sur deux points dont vous connaissez la distance.'}</div>
      ${qtyTable(rowsL, 'Ce niveau')}
    </section>` : ''}
    <section>
      <h2>Quantitatif du projet</h2>
      ${S.project.levels.length ? qtyTable(rowsT, 'Total') : '<p class="muted" style="margin:0">Aucun niveau.</p>'}
    </section>
    <section><p class="muted" style="margin:0;font-size:12px">Sélectionnez un matériel sur le plan pour modifier son repère, son local, son orientation ou sa zone de détection. <kbd>Suppr</kbd> supprime, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplique, <kbd>R</kbd> pivote de 15°, <kbd>H</kbd> / <kbd>Maj</kbd>+<kbd>H</kbd> retourne l'icône.</p></section>`;
  const rb = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  rb('lvRotL', () => rotatePlan(-90)); rb('lvRotR', () => rotatePlan(90)); rb('lvRot180', () => rotatePlan(180)); rb('lvRotA', rotatePlanDialog); rb('lvRot0', () => rotatePlan(0, 0));
  rb('lvKindPlan', () => { if (isPhoto(l)) { pushHistory(); delete l.kind; setDirty(); renderAll(); } });
  rb('lvKindPhoto', () => { if (!isPhoto(l)) { pushHistory(); l.kind = 'photo'; l.scale = null; setDirty(); renderAll(); toast('Fond défini comme photo du site : zones et échelle masquées.'); } });
  rb('lvGrid', () => { l.grille = !l.grille; setDirty(); renderMarkers(); renderSide(); });
  rb('lvMask', () => setTool(S.tool === 'mask' ? 'select' : 'mask')); rb('lvCrop', () => setTool(S.tool === 'crop' ? 'select' : 'crop'));
  const bindP = (id, key, fn = v => v) => { const el = $('#' + id); if (el) el.onchange = () => { S.project[key] = fn(el.value); setDirty(); }; };
  bindP('prClient', 'client'); bindP('prSite', 'site'); bindP('prAuthor', 'author'); bindP('prRef', 'reference'); bindP('prVerif', 'verificateur'); bindP('prObjet', 'objet');
  bindP('prInd', 'indice', v => (v.trim() || 'A').toUpperCase()); bindPhotosSide();
  const pb = $('#prBat'); if (pb) pb.onchange = () => {
    S.project.batimentId = pb.value || null;
    const f = typeof batFind === 'function' ? batFind(pb.value) : null; const b = f && f.b;
    if (f && !S.project.client) { S.project.client = f.t.nom; $('#prClient').value = f.t.nom; }
    if (b && !S.project.site) { S.project.site = b.nom; $('#prSite').value = b.nom; }
    if (b && (!S.project.name || S.project.name === 'Nouveau projet')) { S.project.name = b.nom; $('#projName').value = b.nom; }
    setDirty();
  };
  if (!can('implanter') && !can('plans')) $$('#prClient, #prBat, #prSite, #prAuthor, #prDate, #prRef, #prInd, #prVerif, #prObjet').forEach(el => el.disabled = true);
  bindP('prDate', 'date', v => { const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m2 ? `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}` : S.project.date; });
}
function qtyTable(rows, totalLabel) {
  if (!rows.length) return '<p class="muted" style="margin:0">Aucun matériel placé.</p>';
  const tar = false; /* tarifs : uniquement dans « Devis & factures » */ const ht = rows.reduce((a, r) => a + (r.t.prix || 0) * r.n, 0); const miss = rows.filter(r => r.t.prix == null).length;
  return `<table class="qty"><thead><tr><th></th><th>Matériel</th><th class="n">Qté</th>${tar ? '<th class="n">Total HT</th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td><div class="ph">${r.t.img ? `<img src="${r.t.img}" alt="">` : ''}</div></td><td>${esc(r.t.nom)}${tar && r.t.prix != null ? `<div class="muted" style="font-size:11px">${euro(r.t.prix)} HT l'unité</div>` : ''}</td><td class="n">${r.n}</td>${tar ? `<td class="n">${r.t.prix != null ? euro(r.t.prix * r.n) : '<span class="muted" title="Prix non renseigné dans la base">—</span>'}</td>` : ''}</tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>${esc(totalLabel)}</td><td class="n">${rows.reduce((a, r) => a + r.n, 0)}</td>${tar ? `<td class="n">${euro(ht)}</td>` : ''}</tr>
    ${tar ? `<tr><td></td><td colspan="2" class="muted" style="font-weight:400">Matériel TTC (TVA 20 %)${miss ? ` · ${miss} prix manquant(s)` : ''}</td><td class="n">${euro(ht * 1.2)}</td></tr>` : ''}</tfoot></table>`;
}

function bindProps(m, l) {
  const commit = (fn) => { pushHistory(); fn(); setDirty(); renderMarkers(); renderStatus(); };
  $('#pLabel').onchange = (e) => commit(() => (m.label = e.target.value.trim() || m.label));
  $('#pLocal').onchange = (e) => commit(() => (m.local = e.target.value));
  $('#pNote').onchange = (e) => commit(() => (m.note = e.target.value));
  if ($('#pSig')) $('#pSig').onchange = (e) => commit(() => { if (e.target.value === 'les2') delete m.signal; else m.signal = e.target.value; });
  $('#pZone').onchange = (e) => commit(() => (m.showZone = e.target.checked));
  const num = (v) => v === '' ? null : Math.max(0, parseFloat(v));
  $('#pRange').onchange = (e) => { commit(() => (m.range = num(e.target.value))); renderSide(); };
  if ($('#pAngle')) $('#pAngle').onchange = (e) => { commit(() => (m.angle = num(e.target.value))); renderSide(); };
  let rotStarted = false;
  $('#pRotR').oninput = (e) => { if (!rotStarted) { pushHistory(); rotStarted = true; } m.rot = +e.target.value; $('#pRot').value = m.rot; setDirty(); renderMarkers(); };
  $('#pRotR').onchange = () => (rotStarted = false);
  $('#pRot').onchange = (e) => commit(() => { m.rot = ((+e.target.value % 360) + 360) % 360; $('#pRotR').value = m.rot; });
  $('#pDup').onclick = duplicateSelected; bindMarkerPhotos(m);
  $('#pFlipH').onclick = () => flipSelected('H');
  $('#pFlipV').onclick = () => flipSelected('V');
  $('#pDel').onclick = deleteSelected;
  if ($('#pFiche')) $('#pFiche').onclick = () => (window.native.fiches ? openFiches(m.typeId) : toast('Fiches : disponibles sur PC et Mac.', true));
}

function renderStatus() {
  const l = level();
  $('#stScale').textContent = l ? (isPhoto(l) ? 'Photo du site (sans échelle)' : l.scale ? `Échelle : 1 m = ${l.scale.toFixed(1)} px` : 'Échelle non définie') : '';
  $('#stCount').textContent = l ? `${l.markers.length} matériel(s) sur ce niveau · ${allMarkers().length} au total` : '';
  renderLevels();
}

function renderTool() {
  $$('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  svg().classList.toggle('place', S.tool === 'place' || S.tool === 'photo' || S.tool === 'texte'); svg().classList.toggle('calib', S.tool === 'calib' || S.tool === 'mask' || S.tool === 'crop');
  const bn = $('#modeBanner');
  if (S.tool === 'place') { const t = typeOf(S.placeType); bn.innerHTML = `Placement : <b>${esc(t.nom)}</b> — cliquez sur le plan <button id="bnStop">Terminer (Échap)</button>`; bn.hidden = false; }
  else if (S.tool === 'photo') { const ph = projectPhotos().find(x => x.id === S.placePhoto); bn.innerHTML = `${ph ? `<img class="bn-th" src="${ph.url}" alt="">` : ''}Photo${ph && ph.legende ? ` « ${esc(ph.legende)} »` : ''} : cliquez sur le plan à l'endroit de la prise de vue${S.photoQueue && S.photoQueue.length ? ` (encore ${S.photoQueue.length} ensuite)` : ''} — changez de niveau si besoin <button id="bnStop">Terminer (Échap)</button>`; bn.hidden = false; }
  else if (S.tool === 'texte') { bn.innerHTML = `Annotation : cliquez sur le plan à l'endroit du texte (cliquez sur une annotation pour la modifier) <button id="bnStop">Terminer (Échap)</button>`; bn.hidden = false; }
  else if (S.tool === 'calib') { bn.innerHTML = `Échelle : cliquez sur ${S.calib && S.calib.a ? 'le second point' : 'le premier point'} d'une cote connue <button id="bnStop">Annuler (Échap)</button>`; bn.hidden = false; }
  else if (S.tool === 'mask') { bn.innerHTML = `Masquer : tracez un rectangle sur la zone à effacer (cartouche, légende, encadré…), plusieurs si besoin <button id="bnStop">Terminer (Échap)</button>`; bn.hidden = false; }
  else if (S.tool === 'crop') { bn.innerHTML = `Recadrer : tracez le cadre de la partie du plan à conserver <button id="bnStop">Annuler (Échap)</button>`; bn.hidden = false; }
  else bn.hidden = true;
  const st = $('#bnStop'); if (st) st.onclick = () => { S.photoQueue = null; setTool('select'); };
  renderCatalog();
}
function setTool(tool, typeId = null) {
  S.tool = tool; S.placeType = typeId; if (tool !== 'calib') S.calib = null; else S.calib = {};
  if (tool !== 'select') S.selId = S.selId && tool === 'place' ? null : S.selId;
  renderTool(); renderMarkers(); renderSide();
}

function renderAll() {
  if (S.assist && !S.project.levels.some(l => l.id === S.assist.levelId) && typeof closeAssistant === 'function') { S.assist = null; const b = $('#tAssist'); if (b) b.classList.remove('on'); }
  renderDefs(); renderLevels(); renderPlan(); renderMarkers(); renderSide(); renderStatus(); renderTool(); updateUndo();
  $('#projName').value = S.project.name; $('#optSize').value = S.project.markerScale || 1;
  document.title = `${S.project.name}${S.dirty ? ' •' : ''} — Blackeyes 2`;
}
function selectLevel(id) { S.levelId = id; S.selId = null; if (S.tool === 'calib') setTool('select'); if (S.assist && typeof asFollowLevel === 'function') asFollowLevel(); renderPlan(); renderMarkers(); renderSide(); renderStatus(); requestAnimationFrame(fit); }

/* ---------------------------------------------------------------- interactions plan */
function onPointerDown(e) {
  const l = level(); if (!l || e.button === 2) return;
  const p = toPlan(e);
  if (e.button === 1) { startPan(e); return; }
  if (S.assist && S.tool === 'select' && typeof assistPointerDown === 'function' && assistPointerDown(e, p)) return;
  if (S.tool === 'place') { addMarker(S.placeType, p.x, p.y); return; }
  if (S.tool === 'photo') { placePhotoAt(p); return; }
  if (S.tool === 'texte') { const hit = e.target.closest('.note'); if (hit) { editNote(hit.dataset.note); return; } addNoteAt(p); return; }
  const nt = e.target.closest('.note');
  if (nt) {
    const n = levelNotes(l).find(x => x.id === nt.dataset.note); if (!n) return;
    if (S.selId) { S.selId = null; renderMarkers(); renderSide(); }
    S.noteSel = n.id; renderNotes();
    S.drag = { mode: 'nmove', n, dx: p.x - n.x, dy: p.y - n.y, started: false, x0: e.clientX, y0: e.clientY };
    svg().setPointerCapture(e.pointerId); return;
  }
  const pp = e.target.closest('.ppin');
  if (pp) {
    const ph = projectPhotos().find(x => x.id === pp.dataset.ph); if (!ph) return;
    S.photoSel = ph.id; if (S.selId) { S.selId = null; renderMarkers(); renderSide(); } else renderPhotoLayer();
    S.drag = { mode: 'pmove', ph, dx: p.x - ph.pos.x, dy: p.y - ph.pos.y, started: false, x0: e.clientX, y0: e.clientY };
    svg().setPointerCapture(e.pointerId); return;
  }
  if (S.tool === 'calib') { calibClick(p); return; }
  if (S.tool === 'mask' || S.tool === 'crop') { S.drag = { mode: 'rect', a: p, b: p }; svg().setPointerCapture(e.pointerId); return; }
  const rh = e.target.closest('.rot-handle');
  const mk = e.target.closest('.mk');
  if (rh && marker() && can('implanter')) {
    S.drag = { mode: 'rot', m: marker(), started: false }; svg().setPointerCapture(e.pointerId); return;
  }
  if (mk) {
    const m = l.markers.find(x => x.id === mk.dataset.id);
    if (S.selId !== m.id) { S.selId = m.id; renderMarkers(); renderSide(); }
    if (!can('implanter')) return;
    S.drag = { mode: 'move', m, dx: p.x - m.x, dy: p.y - m.y, started: false, x0: e.clientX, y0: e.clientY };
    svg().setPointerCapture(e.pointerId); return;
  }
  if (S.selId) { S.selId = null; renderMarkers(); renderSide(); }
  if (S.noteSel) { S.noteSel = null; renderNotes(); }
  startPan(e);
}
function startPan(e) { S.drag = { mode: 'pan', x0: e.clientX, y0: e.clientY, vb: { ...S.vb } }; svg().classList.add('panning'); svg().setPointerCapture(e.pointerId); }
function onPointerMove(e) {
  const l = level(); if (!l) return;
  const p = toPlan(e);
  $('#stCoords').textContent = l.scale ? `x ${(p.x / l.scale).toFixed(1)} m · y ${(p.y / l.scale).toFixed(1)} m` : `x ${Math.round(p.x)} · y ${Math.round(p.y)} px`;
  if (S.tool === 'calib' && S.calib && S.calib.a && !S.calib.b) { S.calib.hover = p; renderOverlay(); }
  const d = S.drag; if (!d) return;
  if (d.mode.startsWith('a:')) { assistPointerMove(e, p, d); return; }
  if (d.mode === 'rect') { d.b = p; renderOverlay(); return; }
  if (d.mode === 'pan') {
    const k = S.vb.w / svg().clientWidth;
    S.vb.x = d.vb.x - (e.clientX - d.x0) * k; S.vb.y = d.vb.y - (e.clientY - d.y0) * k; applyVb();
  } else if (d.mode === 'nmove') {
    if (!can('implanter')) return;
    if (!d.started) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return; pushHistory(); d.started = true; }
    d.n.x = Math.round(p.x - d.dx); d.n.y = Math.round(p.y - d.dy); setDirty(); renderNotes();
  } else if (d.mode === 'pmove') {
    if (!can('implanter')) return;
    if (!d.started) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return; d.started = true; }
    d.ph.pos.x = Math.round(p.x - d.dx); d.ph.pos.y = Math.round(p.y - d.dy); setDirty(); renderPhotoLayer();
  } else if (d.mode === 'move') {
    if (!d.started) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return; pushHistory(); d.started = true; }
    d.m.x = p.x - d.dx; d.m.y = p.y - d.dy; setDirty(); renderMarkers();
  } else if (d.mode === 'rot') {
    if (!d.started) { pushHistory(); d.started = true; }
    let a = Math.atan2(p.y - d.m.y, p.x - d.m.x) * 180 / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    d.m.rot = Math.round((a + 360) % 360); setDirty(); renderMarkers();
    const r = $('#pRot'), rr = $('#pRotR'); if (r) { r.value = d.m.rot; rr.value = d.m.rot; }
  }
}
function onPointerUp() {
  const d = S.drag; S.drag = null; svg().classList.remove('panning');
  if (d && d.mode.startsWith('a:')) { assistPointerUp(d); return; }
  if (d && d.mode === 'pmove' && !d.started) { openPhotoView(d.ph.id); return; }
  if (d && d.mode === 'nmove' && !d.started) { editNote(d.n.id); return; }
  if (d && d.mode === 'rect') { const l = level(); if (!l) return; const r = normRect(d.a, d.b, l); $('#gOverlay').innerHTML = ''; (S.tool === 'crop' ? cropPlan(r) : maskZone(r)).catch(e => toast(e.message, true)); }
}

async function calibClick(p) {
  const l = level();
  if (!S.calib.a) { S.calib.a = p; renderTool(); renderOverlay(); return; }
  S.calib.b = p; renderOverlay();
  const px = Math.hypot(p.x - S.calib.a.x, p.y - S.calib.a.y);
  const v = await askText('Définir l\'échelle', 'Distance réelle entre les deux points (en mètres)', '', 'number');
  const meters = parseFloat(String(v || '').replace(',', '.'));
  if (meters > 0 && px > 0) {
    pushHistory(); l.scale = px / meters; setDirty();
    toast(`Échelle définie : 1 m = ${l.scale.toFixed(1)} px`);
  } else if (v !== null) toast('Distance invalide : saisissez un nombre de mètres supérieur à 0.', true);
  setTool('select'); renderStatus(); renderSide();
}

/* ---------------------------------------------------------------- import de plans */
/* fond d'implantation : plan à l'échelle ou photo du site (pose indicative, sans échelle) */
const isPhoto = (l) => !!l && l.kind === 'photo';
const lvLabel = (l, low = false) => `${isPhoto(l) ? (low ? 'photo' : 'Photo') : (low ? 'niveau' : 'Niveau')} ${l.name}`;
async function importPhoto() { return importPlan('photo'); }
async function importPlan(kind) {
  if (!need('plans')) return;
  const photo = kind === 'photo';
  const f = await window.native.openFile(photo
    ? { purpose: 'plan', title: 'Importer une photo du site', filters: [{ name: 'Photos (JPG, PNG, WebP)', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] }
    : { purpose: 'plan', title: 'Importer un plan', filters: [{ name: 'Plans (PDF, PowerPoint, images)', extensions: ['pdf', 'pptx', 'png', 'jpg', 'jpeg'] }] });
  if (!f) return;
  const ext = f.name.split('.').pop().toLowerCase();
  const base = f.name.replace(/\.[^.]+$/, '');
  try {
    let cands;
    if (ext === 'pdf') cands = await pdfCandidates(f.data);
    else if (ext === 'pptx') cands = await pptxCandidates(f.data);
    else {
      const url = await bytesToDataUrl(f.data, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      cands = [{ name: base, thumb: url, get: async () => url }];
    }
    if (!cands.length) { toast(ext === 'pptx' ? 'Aucune image de plan trouvée dans ce PowerPoint (formats PNG/JPG).' : 'Aucune page trouvée.', true); return; }
    const chosen = cands.length === 1 ? cands : await pickPages(cands, f.name);
    if (!chosen || !chosen.length) return;
    toast(photo ? 'Préparation de la photo…' : 'Préparation du plan…');
    for (const c of chosen) {
      const plan = await normalizePlan(await c.get());
      const lv = { id: uid(), name: c.name, plan, scale: null, markers: [], source: f.name };
      if (photo) lv.kind = 'photo';
      S.project.levels.push(lv); S.levelId = lv.id;
    }
    S.selId = null; setDirty(); renderAll(); requestAnimationFrame(fit);
    toast(photo ? `Photo « ${chosen[0].name} » ajoutée : placez les matériels directement sur l'image.` : `${chosen.length} niveau(x) ajouté(s) depuis ${f.name}`);
  } catch (e) { console.error(e); toast('Import impossible : ' + (e.message || e), true); }
}

async function pdfCandidates(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const thumb = await renderPdfPage(page, 260, 'image/jpeg');
    out.push({ name: pdf.numPages > 1 ? `Page ${i}` : 'Niveau 1', thumb, get: () => renderPdfPage(page, PDF_RENDER, 'image/png') });
  }
  return out;
}
async function renderPdfPage(page, maxSide, mime) {
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: maxSide / Math.max(v1.width, v1.height) });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return c.toDataURL(mime, 0.85);
}

async function pptxCandidates(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const presRels = parse(await zip.file('ppt/_rels/presentation.xml.rels').async('string'));
  const relMap = {}; [...presRels.getElementsByTagName('Relationship')].forEach(r => relMap[r.getAttribute('Id')] = r.getAttribute('Target'));
  const pres = parse(await zip.file('ppt/presentation.xml').async('string'));
  const slides = [...pres.getElementsByTagName('p:sldId')].map(s => 'ppt/' + relMap[s.getAttribute('r:id')].replace(/^\/?ppt\//, ''));
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    const sp = slides[i]; const sf = zip.file(sp); if (!sf) continue;
    const xml = parse(await sf.async('string'));
    const relsPath = sp.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const rf = zip.file(relsPath); if (!rf) continue;
    const rels = {}; [...parse(await rf.async('string')).getElementsByTagName('Relationship')].forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target'));
    let best = null;
    for (const pic of xml.getElementsByTagName('p:pic')) {
      const blip = pic.getElementsByTagName('a:blip')[0]; const ext = pic.getElementsByTagName('a:ext')[0];
      if (!blip || !ext) continue;
      const target = rels[blip.getAttribute('r:embed')]; if (!target) continue;
      const mp = 'ppt/' + target.replace(/^\.\.\//, '');
      const e = mp.split('.').pop().toLowerCase();
      if (!['png', 'jpg', 'jpeg'].includes(e)) continue;
      const area = (+ext.getAttribute('cx')) * (+ext.getAttribute('cy'));
      if (!best || area > best.area) best = { area, mp, mime: e === 'png' ? 'image/png' : 'image/jpeg' };
    }
    if (!best) continue;
    const texts = [...xml.getElementsByTagName('a:t')].map(t => t.textContent.trim()).filter(Boolean);
    const nm = texts.find(t => t.length <= 24 && !/^\d+$/.test(t)) || `Diapositive ${i + 1}`;
    const data = await zip.file(best.mp).async('uint8array');
    const url = await bytesToDataUrl(data, best.mime);
    out.push({ name: nm, thumb: url, get: async () => url, slide: i + 1 });
  }
  return out;
}

async function pickPages(cands, fileName) {
  const sel = new Set(cands.length <= 4 ? cands.map((_, i) => i) : []);
  const body = document.createElement('div');
  body.innerHTML = `<p style="margin:0" class="muted">Cochez les pages ou diapositives à importer et nommez chaque niveau (RDC, R+1…).</p>
   <div class="pick-grid">${cands.map((c, i) => `<div class="pick ${sel.has(i) ? 'on' : ''}" data-i="${i}">
      <div class="thumb"><img src="${c.thumb}" alt=""></div>
      <label><input type="checkbox" data-c="${i}" ${sel.has(i) ? 'checked' : ''}> ${c.slide ? `Diapo ${c.slide}` : esc(c.name)}</label>
      <input type="text" data-n="${i}" value="${esc(c.name)}" aria-label="Nom du niveau"></div>`).join('')}</div>`;
  body.addEventListener('change', (e) => {
    const i = e.target.dataset.c; if (i === undefined) return;
    e.target.checked ? sel.add(+i) : sel.delete(+i); e.target.closest('.pick').classList.toggle('on', e.target.checked);
  });
  body.addEventListener('click', (e) => { const th = e.target.closest('.thumb'); if (th) { const cb = $('input[type=checkbox]', th.parentElement); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
  return modal({
    title: `Importer depuis ${fileName}`, size: '', body,
    buttons: [{ label: 'Annuler', value: null }, {
      label: 'Importer', cls: 'primary', action: (root) => {
        const out = [...sel].sort((a, b) => a - b).map(i => ({ ...cands[i], name: $(`[data-n="${i}"]`, root).value.trim() || cands[i].name }));
        if (!out.length) { toast('Cochez au moins une page.', true); return false; }
        return out;
      }
    }]
  });
}

/* ---------------------------------------------------------------- fichiers projet */
function projectPayload() {
  const used = new Set(allMarkers().map(m => m.typeId));
  const typeCache = {}; used.forEach(id => typeCache[id] = typeOf(id));
  const { path, ...rest } = S.project;
  return JSON.stringify({ ...rest, typeCache, savedAt: new Date().toISOString() });
}
async function saveProject(saveAs = false) {
  if (!need('projets')) return false;
  const data = strToBytes(projectPayload());
  let p = S.project.path;
  if (!p || saveAs) {
    p = await window.native.saveFile({ purpose: 'project', title: 'Enregistrer le projet', defaultPath: `${S.project.name}.bkimp`, filters: [{ name: 'Projet Blackeyes Implantation', extensions: ['bkimp'] }], data });
    if (!p) return false;
    S.project.path = p;
  } else await window.native.writeFile(p, data);
  setDirty(false); toast('Projet enregistré');
  if (S.project.batimentId && typeof syncProjectToMap === 'function') syncProjectToMap();
  return true;
}
async function guardUnsaved() {
  if (!S.dirty) return true;
  if (!can('projets')) return !!(await confirmBox('Modifications non enregistrées', 'Votre compte ne permet pas d\'enregistrer : les modifications seront perdues. Continuer ?', 'Continuer', true));
  const r = await modal({
    title: 'Modifications non enregistrées', body: `<p style="margin:0">Voulez-vous enregistrer le projet « ${esc(S.project.name)} » ?</p>`,
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ne pas enregistrer', value: 'discard' }, { label: 'Enregistrer', cls: 'primary', value: 'save' }]
  });
  if (r === 'save') return await saveProject();
  return r === 'discard';
}
async function openProject() {
  if (!(await guardUnsaved())) return;
  const f = await window.native.openFile({ purpose: 'project', title: 'Ouvrir un projet', filters: [{ name: 'Projet Blackeyes Implantation', extensions: ['bkimp', 'json'] }] });
  if (!f) return;
  loadProjectFile(f);
}
function loadProjectFile(f) {
  try {
    const p = JSON.parse(new TextDecoder().decode(f.data));
    if (p.app !== 'blackeyes-implantation' || !Array.isArray(p.levels)) throw new Error('ce fichier n\'est pas un projet Blackeyes Implantation');
    p.path = f.path; p.typeCache = p.typeCache || {};
    S.project = p; S.levelId = p.levels[0]?.id || null; S.selId = null; S.history = []; S.future = [];
    setDirty(false); setTool('select'); renderAll(); requestAnimationFrame(fit);
    const missing = Object.keys(p.typeCache).filter(id => !S.db.find(t => t.id === id));
    if (missing.length) toast(`${missing.length} matériel(s) de ce projet absent(s) de votre base : affiché(s) depuis le fichier projet.`);
  } catch (e) { toast('Ouverture impossible : ' + e.message, true); }
}
async function newProj() {
  if (!(await guardUnsaved())) return;
  S.project = newProject(); S.levelId = null; S.selId = null; S.history = []; S.future = []; setDirty(false); setTool('select'); renderAll();
}

/* ---------------------------------------------------------------- exports */
const safeName = (s) => (s || 'projet').replace(/[\\/:*?"<>|]+/g, '-').trim();
const hex = (c) => (c || '#64748b').replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
function requireMarkers() {
  if (!S.project.levels.length) { toast('Importez d\'abord un plan.', true); return false; }
  return true;
}
const usedTypes = () => { const ids = [...new Set(allMarkers().map(m => m.typeId))]; return ids.map(typeOf).sort((a, b) => S.db.indexOf(a) - S.db.indexOf(b)); };

/* exportPptx, exportPdf et exportDocx : voir dossier.js (charte et cartouche communs) */
const sizeCache = new Map();
async function imgSize(url) { if (sizeCache.has(url)) return sizeCache.get(url); const i = await loadImg(url); const s = { w: i.naturalWidth || 1, h: i.naturalHeight || 1 }; sizeCache.set(url, s); return s; }

function scaleBarSpec(l) {
  if (!l.scale) return null;
  const target = l.plan.w * 0.16 / l.scale; const nice = [1, 2, 5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 500];
  let m = nice[0]; for (const n of nice) if (n <= target) m = n;
  return { m, px: m * l.scale };
}
function scaleBarSvg(l) {
  if (isPhoto(l)) return '';
  const sb = scaleBarSpec(l); if (!sb) return '';
  const u = Math.max(l.plan.w, l.plan.h) * 0.0055, x0 = l.plan.w * 0.025, y0 = l.plan.h - u * 5.2, seg = sb.px / 4;
  const fmt = (v) => String(+v.toFixed(1)).replace('.', ',');
  return `<g font-family="Segoe UI, Arial, sans-serif" font-size="${u * 2}" fill="#121a26">
    <rect x="${x0 - u}" y="${y0 - u * 3}" width="${sb.px + u * 7}" height="${u * 5.6}" rx="${u * 0.6}" fill="#fff" fill-opacity="0.9"/>
    ${[0, 1, 2, 3].map(i => `<rect x="${x0 + i * seg}" y="${y0}" width="${seg}" height="${u}" fill="${i % 2 ? '#fff' : '#121a26'}" stroke="#121a26" stroke-width="${u * 0.15}"/>`).join('')}
    <text x="${x0}" y="${y0 - u * 0.6}" text-anchor="middle">0</text><text x="${x0 + sb.px / 2}" y="${y0 - u * 0.6}" text-anchor="middle">${fmt(sb.m / 2)}</text>
    <text x="${x0 + sb.px}" y="${y0 - u * 0.6}" text-anchor="middle">${fmt(sb.m)} m</text></g>`;
}
async function rasterLevel(l, maxSide = 3600) {
  const types = [...new Set(l.markers.map(m => m.typeId))].map(typeOf);
  const zones = (S.exp ? S.exp.zones : $('#optZones').checked) ? l.markers.map(m => zonePath(m, l)).join('') : '';
  const svgStr = `<svg xmlns="${SVGNS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${l.plan.w}" height="${l.plan.h}" viewBox="0 0 ${l.plan.w} ${l.plan.h}">
    <defs>${defsMarkup(types)}</defs><rect width="100%" height="100%" fill="#fff"/>
    <image href="${l.plan.dataUrl}" x="0" y="0" width="${l.plan.w}" height="${l.plan.h}"/>${gridMarkup(l)}${zones}${l.markers.map(m => markerMarkup(m, l, { live: false })).join('')}${(S.exp ? S.exp.photos : $('#optPhotos').checked) ? photoPinsMarkup(l, false) : ''}${(S.exp ? S.exp.notes : $('#optNotes').checked) && typeof notesMarkup === 'function' ? notesMarkup(l, false) : ''}${scaleBarSvg(l)}</svg>`;
  const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
  try {
    const img = await loadImg(url);
    const k = Math.min(1, maxSide / Math.max(l.plan.w, l.plan.h));
    const c = document.createElement('canvas'); c.width = Math.round(l.plan.w * k); c.height = Math.round(l.plan.h * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

async function exportCsv() {
  if (!need('exportCsv') || !requireMarkers()) return;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Niveau', 'Repère', 'Code', 'Matériel', 'Système', 'Type', 'Local', 'Orientation (°)', 'Note'].map(q).join(';')];
  S.project.levels.forEach(l => l.markers.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true })).forEach(m => {
    const t = typeOf(m.typeId); lines.push([l.name, m.label, t.code, t.nom, t.sys, t.type, m.local, hasDirection(m) ? m.rot : '', m.note].map(q).join(';'));
  }));
  lines.push('', [q('Quantitatif'), q('Matériel'), ...S.project.levels.map(l => q(l.name)), q('Total')].join(';'));
  const tar = false; /* tarifs : uniquement dans « Devis & factures » */ if (tar) lines[lines.length - 1] += ';' + [q('PU HT (€)'), q('Total HT (€)')].join(';');
  let tot = 0;
  usedTypes().forEach(t => { const per = S.project.levels.map(l => l.markers.filter(m => m.typeId === t.id).length); const n = per.reduce((a, b) => a + b, 0); const row = ['', t.nom, ...per, n]; if (tar) { row.push(t.prix != null ? String(t.prix).replace('.', ',') : '', t.prix != null ? String(Math.round(t.prix * n * 100) / 100).replace('.', ',') : ''); tot += (t.prix || 0) * n; } lines.push(row.map(q).join(';')); });
  if (tar) lines.push(['', 'Total matériel HT', ...S.project.levels.map(() => ''), '', '', String(Math.round(tot * 100) / 100).replace('.', ',')].map(q).join(';'));
  const data = strToBytes('﻿' + lines.join('\r\n'));
  const p = await window.native.saveFile({ purpose: 'csv', title: 'Exporter le quantitatif', defaultPath: `Quantitatif ${safeName(S.project.name)}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }], data });
  if (p) toast('Quantitatif exporté');
}

/* ---------------------------------------------------------------- administration de la base */
async function openDbEditor() {
  if (!need('base')) return;
  let draft = JSON.parse(JSON.stringify(S.db)); let cur = draft[0]?.id || null; let changed = false;
  const body = document.createElement('div');
  const render = () => {
    const t = draft.find(x => x.id === cur);
    body.innerHTML = `<div class="admin-grid">
      <div class="admin-list">${draft.map(x => `<div class="cat-item ${x.id === cur ? 'active' : ''}" data-aid="${esc(x.id)}">
        <div class="ph">${x.img ? `<img src="${x.img}" alt="">` : ''}</div><div class="tx"><div class="nm">${esc(x.nom)}</div><div class="ty">${esc(x.sys)}</div></div>
        <span class="code" style="background:${esc(x.couleur)}">${esc(x.code)}</span></div>`).join('')}</div>
      ${t ? `<div class="admin-form">
        <div class="photo-edit"><div class="ph">${t.img ? `<img src="${t.img}" alt="">` : '<span class="muted">Aucune photo</span>'}</div>
          <div class="btnrow"><button data-act="photo">Changer la photo…</button>${t.img ? '<button data-act="nophoto" class="ghost">Retirer</button>' : ''}</div></div>
        <div class="row2"><label class="field"><span>Nom</span><input data-f="nom" type="text" value="${esc(t.nom)}"></label>
          <div class="row2"><label class="field"><span>Code repère</span><input data-f="code" type="text" maxlength="5" value="${esc(t.code)}"></label>
          <label class="field"><span>Couleur</span><input data-f="couleur" type="color" value="${esc(t.couleur)}"></label></div></div>
        <div class="row2"><label class="field"><span>Système</span><select data-f="sys">${SYSTEMS.map(s => `<option ${s === t.sys ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="field"><span>Type</span><input data-f="type" type="text" value="${esc(t.type)}"></label></div>
        <label class="field"><span>Fonction principale</span><textarea data-f="fn">${esc(t.fn)}</textarea></label>
        <div class="row2"><label class="field"><span>Portée radio</span><input data-f="radio" type="text" value="${esc(t.radio)}"></label>
          <label class="field"><span>Autonomie</span><input data-f="auto" type="text" value="${esc(t.auto)}"></label></div>
        
        <div class="row2"><label class="field"><span>Portée de détection (texte)</span><input data-f="det" type="text" value="${esc(t.det)}"></label>
          <label class="field"><span>Forme de la zone</span><select data-f="zone"><option value="" ${t.zone !== 'faisceau' ? 'selected' : ''}>Cercle / secteur (selon l'angle)</option><option value="faisceau" ${t.zone === 'faisceau' ? 'selected' : ''}>Faisceau laser en ligne droite</option></select></label></div>
        <div class="row2"><label class="field"><span>${t.zone === 'faisceau' ? 'Longueur du faisceau (m)' : 'Zone : portée (m)'}</span><input data-f="detRange" type="number" min="0" step="0.5" value="${t.detRange ?? ''}"></label>
          ${t.zone === 'faisceau' ? '<div></div>' : `<label class="field"><span>Zone : angle (°)</span><input data-f="detAngle" type="number" min="0" max="360" step="0.5" value="${t.detAngle ?? ''}"></label>`}</div>
        <label class="chk"><input data-f="iconRot" type="checkbox" ${t.iconRot ? 'checked' : ''}> Icône orientable (pivote avec l'orientation du matériel sur le plan)</label>
        <label class="field"><span>Notes</span><textarea data-f="notes">${esc(t.notes)}</textarea></label>
        <div class="btnrow"><button data-act="del" class="danger">Supprimer ce matériel</button></div>
      </div>` : '<p class="muted">Aucun matériel. Ajoutez-en un.</p>'}</div>`;
  };
  body.addEventListener('click', async (e) => {
    const it = e.target.closest('[data-aid]'); if (it) { cur = it.dataset.aid; render(); return; }
    const act = e.target.dataset.act; const t = draft.find(x => x.id === cur); if (!act || !t) return;
    if (act === 'photo') {
      const f = await window.native.openFile({ purpose: 'photo', title: 'Choisir une photo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] });
      if (!f) return;
      const url = await bytesToDataUrl(f.data, /png$/i.test(f.name) ? 'image/png' : 'image/jpeg');
      t.img = await shrinkPhoto(url); changed = true; render();
    }
    if (act === 'nophoto') { t.img = ''; changed = true; render(); }
    if (act === 'del') {
      const used = allMarkers().filter(m => m.typeId === t.id).length;
      if (!(await confirmBox('Supprimer ce matériel', `Supprimer « ${t.nom} » de la base ?${used ? ` Il est placé ${used} fois dans le projet ouvert : ces pictogrammes resteront affichés depuis le projet.` : ''}`, 'Supprimer', true))) return;
      if (used) S.project.typeCache[t.id] = JSON.parse(JSON.stringify(t));
      draft = draft.filter(x => x.id !== t.id); cur = draft[0]?.id || null; changed = true; render();
    }
  });
  body.addEventListener('input', (e) => {
    const f = e.target.dataset.f; const t = draft.find(x => x.id === cur); if (!f || !t) return;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (f === 'detRange' || f === 'detAngle' || f === 'prix') v = v === '' ? null : parseFloat(String(v).replace(',', '.')); if (f === 'code') v = v.toUpperCase();
    t[f] = v; changed = true;
    if (f === 'zone') { if (v === 'faisceau') t.detAngle = null; render(); return; }
    if (['nom', 'code', 'couleur', 'sys'].includes(f)) { const li = $(`[data-aid="${CSS.escape(t.id)}"]`, body); if (li) { $('.nm', li).textContent = t.nom; $('.ty', li).textContent = t.sys; const c = $('.code', li); c.textContent = t.code; c.style.background = t.couleur; } }
  });
  render();
  const r = await modal({
    title: 'Base de données des matériels' + (S.info && S.info.usb ? ' (sur la clé USB)' : ''), size: '', body,
    left: [
      { label: '+ Ajouter un matériel', action: () => { const n = { id: 'm' + uid(), code: 'NEW', nom: 'Nouveau matériel', sys: 'Anti-intrusion', type: '', couleur: '#334155', fn: '', radio: '', det: '', auto: '', detRange: null, detAngle: null, notes: '', img: '' }; draft.push(n); cur = n.id; changed = true; render(); return false; } },
      { label: 'Exporter la base', action: async () => { await window.native.saveFile({ purpose: 'db', title: 'Exporter la base', defaultPath: 'base-materiels-blackeyes.json', filters: [{ name: 'JSON', extensions: ['json'] }], data: strToBytes(JSON.stringify(draft, null, 1)) }); return false; } },
      { label: 'Importer une base', action: async () => {
          const f = await window.native.openFile({ purpose: 'db', title: 'Importer une base', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!f) return false;
          try { const d = JSON.parse(new TextDecoder().decode(f.data)); if (!Array.isArray(d) || !d.every(x => x.id && x.nom)) throw new Error('format non reconnu');
            draft = d; cur = d[0]?.id; changed = true; render(); toast(`${d.length} matériels chargés. Cliquez sur Enregistrer pour valider.`); } catch (e) { toast('Import impossible : ' + e.message, true); }
          return false; } },
      { label: 'Rétablir la base d\'origine', cls: 'ghost', action: async () => { if (await confirmBox('Rétablir la base d\'origine', 'Remplacer la base actuelle par les 10 matériels issus de la présentation BLACKEYES ?', 'Rétablir', true)) { draft = JSON.parse(JSON.stringify(window.DEFAULT_DB)); cur = draft[0].id; changed = true; render(); } return false; } }
    ],
    buttons: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', cls: 'primary', value: true }]
  });
  if (r && changed) {
    const codes = draft.map(d => d.code); const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    S.db = draft; await saveDb(); renderAll();
    toast(dup ? `Base enregistrée. Attention : le code « ${dup} » est utilisé par plusieurs matériels.` : 'Base de données enregistrée');
  }
}
async function shrinkPhoto(url) {
  const img = await loadImg(url); const k = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png');
}

/* ---------------------------------------------------------------- niveaux */
async function renameLevel(id) {
  if (!need('plans')) return;
  const l = S.project.levels.find(x => x.id === id); if (!l) return;
  const v = await askText('Renommer le niveau', 'Nom du niveau', l.name);
  if (v && v.trim()) { l.name = v.trim(); setDirty(); renderLevels(); renderSide(); }
}
async function deleteLevel(id) {
  if (!need('plans')) return;
  const l = S.project.levels.find(x => x.id === id); if (!l) return;
  if (!(await confirmBox('Supprimer le niveau', `Supprimer le niveau « ${l.name} » et ses ${l.markers.length} matériel(s) ?`, 'Supprimer', true))) return;
  S.project.levels = S.project.levels.filter(x => x.id !== id); S.history = []; S.future = [];
  (S.project.photos || []).forEach(p => { if (p.pos && p.pos.levelId === id) p.pos = null; });
  if (S.levelId === id) S.levelId = S.project.levels[0]?.id || null;
  S.selId = null; setDirty(); renderAll(); requestAnimationFrame(fit);
}

/* ---------------------------------------------------------------- liaisons */
function bind() {
  $('#bNew').onclick = newProj; $('#bOpen').onclick = openProject; $('#bSave').onclick = () => saveProject();
  $('#bImport').onclick = $('#bImport2').onclick = $('#bAddLevel').onclick = () => importPlan('plan');
  $('#bImportPhoto').onclick = $('#bImportPhoto2').onclick = importPhoto;
  const dd = $('#ddExport');
  $('#bExport').onclick = (e) => { e.stopPropagation(); const o = !dd.classList.contains('open'); dd.classList.toggle('open', o); $('#bExport').setAttribute('aria-expanded', o); };
  dd.querySelector('.dd').addEventListener('click', () => { dd.classList.remove('open'); $('#bExport').setAttribute('aria-expanded', false); });
  document.addEventListener('pointerdown', (e) => { if (!dd.contains(e.target)) dd.classList.remove('open'); });
  $('#bPptx').onclick = () => exportPptx(); $('#bPdf').onclick = () => exportPdf(); $('#bPlans').onclick = () => exportPlans(); $('#bMail').onclick = () => emailPlans(); if (!window.native.mail) $('#bMail').remove(); $('#bPhone').onclick = () => shareToPhone(); $('#bPartages').onclick = () => openPartages(); $('#bFiches').onclick = () => openFiches(marker() ? marker().typeId : undefined); if (!window.native.fiches) $('#bFiches').remove(); if (!window.native.partages) { $('#bPhone').remove(); $('#bPartages').remove(); } $('#bDocx').onclick = () => exportDocx(); $('#bCsv').onclick = exportCsv; $('#bAdmin').onclick = openAdminConsole; $('#bBase').onclick = openDbEditor; $('#bSim').onclick = () => exportSim3d(); $('#bFact').onclick = () => openFacturation(); $('#bUser').onclick = openUserMenu;
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
  $('#projName').onchange = (e) => { if (!can('implanter') && !can('plans')) { e.target.value = S.project.name; return; } S.project.name = e.target.value.trim() || 'Projet sans nom'; setDirty(); };
  $('#catSearch').oninput = renderCatalog;
  $('#catList').addEventListener('click', (e) => {
    const it = e.target.closest('[data-type]'); if (!it) return;
    if (!level()) { toast('Importez d\'abord un plan.', true); return; }
    if (!need('implanter')) return;
    S.tool === 'place' && S.placeType === it.dataset.type ? setTool('select') : setTool('place', it.dataset.type);
  });
  $('#catList').addEventListener('dragstart', (e) => { const it = e.target.closest('[data-type]'); if (it) e.dataTransfer.setData('text/x-blackeyes', it.dataset.type); });
  const sw = $('#stageWrap');
  sw.addEventListener('dragover', (e) => { if (level() && e.dataTransfer.types.includes('text/x-blackeyes')) e.preventDefault(); });
  sw.addEventListener('drop', (e) => { if (!can('implanter')) return; const id = e.dataTransfer.getData('text/x-blackeyes'); if (!id || !level()) return; e.preventDefault(); const p = toPlan(e); addMarker(id, p.x, p.y); });
  $('#tAssist').onclick = () => openAssistant().catch(e => toast(e.message, true));
  $$('.tool').forEach(b => b.onclick = () => { if (!level()) { toast('Importez d\'abord un plan.', true); return; } if ((b.dataset.tool === 'calib' || b.dataset.tool === 'texte') && !need('implanter')) return; setTool(b.dataset.tool); });
  $('#optZones').onchange = renderMarkers; $('#optPhotos').onchange = () => renderPhotoLayer(); $('#optNotes').onchange = () => renderNotes();
  $('#optSize').oninput = (e) => { if (!can('implanter')) { e.target.value = S.project.markerScale || 1; return; } S.project.markerScale = +e.target.value; setDirty(); renderMarkers(); };
  $('#zIn').onclick = () => { const v = S.vb; if (v) zoomAt(0.8, v.x + v.w / 2, v.y + v.h / 2); };
  $('#zOut').onclick = () => { const v = S.vb; if (v) zoomAt(1.25, v.x + v.w / 2, v.y + v.h / 2); };
  $('#zFit').onclick = fit;
  const st = svg();
  /* tablette : deux doigts pour zoomer et déplacer le plan (pincer) */
  const touches = new Map(); let pinch = null;
  const pinchInfo = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };
  st.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && S.vb) { e.stopImmediatePropagation(); S.drag = null; st.classList.remove('panning'); const i = pinchInfo(); pinch = { ...i, vb: { ...S.vb } }; }
  }, true);
  st.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      e.stopImmediatePropagation(); const i = pinchInfo(); const r = st.getBoundingClientRect(); const v0 = pinch.vb;
      const f = Math.min(20, Math.max(0.05, pinch.d / Math.max(1, i.d))); const k0 = v0.w / r.width;
      const px = v0.x + (pinch.cx - r.left) * k0, py = v0.y + (pinch.cy - r.top) * k0; const w = v0.w * f, h = v0.h * f, k = w / r.width;
      S.vb = { x: px - (i.cx - r.left) * k, y: py - (i.cy - r.top) * k, w, h }; applyVb();
    }
  }, true);
  const endTouch = (e) => { if (!touches.delete(e.pointerId)) return; if (pinch) { e.stopImmediatePropagation(); if (touches.size < 2) { pinch = null; touches.clear(); } } };
  st.addEventListener('pointerup', endTouch, true); st.addEventListener('pointercancel', endTouch, true);
  st.addEventListener('pointerdown', onPointerDown); st.addEventListener('pointermove', onPointerMove);
  st.addEventListener('pointerup', onPointerUp); st.addEventListener('pointercancel', onPointerUp);
  st.addEventListener('wheel', (e) => { if (!level()) return; e.preventDefault(); const p = toPlan(e); zoomAt(Math.pow(1.0015, e.deltaY), p.x, p.y); }, { passive: false });
  st.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#levelTabs').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del-level]'); if (d) { e.stopPropagation(); deleteLevel(d.dataset.delLevel); return; }
    const t = e.target.closest('[data-level]'); if (t && t.dataset.level !== S.levelId) selectLevel(t.dataset.level);
  });
  $('#levelTabs').addEventListener('dblclick', (e) => { const t = e.target.closest('[data-level]'); if (t) renameLevel(t.dataset.level); });

  document.addEventListener('keydown', (e) => {
    if ($('#modalRoot').children.length || !$('#carteView').hidden || !$('#authScreen').hidden) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
    if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newProj(); return; }
    if (typing) return;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (e.key === 'Escape' && typeof assistEscape === 'function' && assistEscape()) return;
    if (e.key === 'Escape') { if (S.tool !== 'select') { S.photoQueue = null; setTool('select'); } else if (S.selId) { S.selId = null; renderMarkers(); renderSide(); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.noteSel && !S.selId) { deleteSelectedNote(); return; } deleteSelected(); return; }
    if (e.key.toLowerCase() === 'a' && !ctrl && level() && can('implanter')) { openAssistant().catch(err => toast(err.message, true)); return; }
    if (e.key.toLowerCase() === 't' && level() && can('implanter')) setTool(S.tool === 'texte' ? 'select' : 'texte');
    if (e.key.toLowerCase() === 'v') setTool('select');
    if (e.key.toLowerCase() === 'e' && level() && can('implanter')) setTool('calib');
    if (e.key.toLowerCase() === 'f') fit();
    const m = marker(), l = level();
    if (m && !can('implanter')) return;
    if (m && e.key.toLowerCase() === 'h') { flipSelected(e.shiftKey ? 'V' : 'H'); return; }
    if (m && e.key.toLowerCase() === 'r') { pushHistory(); m.rot = (m.rot + (e.shiftKey ? 345 : 15)) % 360; setDirty(); renderMarkers(); renderSide(); }
    if (m && l && e.key.startsWith('Arrow')) {
      e.preventDefault(); const step = markerSize(l) * (e.shiftKey ? 1 : 0.1);
      pushHistory(); if (e.key === 'ArrowLeft') m.x -= step; if (e.key === 'ArrowRight') m.x += step; if (e.key === 'ArrowUp') m.y -= step; if (e.key === 'ArrowDown') m.y += step;
      setDirty(); renderMarkers();
    }
  });
  window.native.onBeforeClose(async () => { if (await guardUnsaved()) window.native.confirmClose(); });
}

(function init() {
  S.project = newProject();
  bind();
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, bumpActivity, true));
  setInterval(checkIdle, 20000);
  if (!window.__BK_DEMO__) startAuth();
})();

/* ---------------------------------------------------------------- export vers le logiciel Blackeyes Simulation 3D */
/* portes, fenêtres et escaliers repérés par l'assistant d'implantation, transmis à la Simulation 3D */
function archFromAnalyse(l) {
  const an = l.analyse; if (!an || !l.scale) return [];
  const out = []; let np = 0, nf = 0, ne = 0;
  for (const a of an.acces || []) {
    if (a.type === 'ignore') continue;
    if (a.type === 'fenetre') out.push({ id: 'af-' + a.id, typeId: 'arch-fenetre', x: a.x, y: a.y, rot: Math.round(((a.ang % 360) + 360) % 360), w: Math.max(0.6, a.w), label: `F${++nf}` });
    else out.push({ id: 'ap-' + a.id, typeId: 'arch-porte', x: a.x, y: a.y, rot: Math.round(((a.ang % 360) + 360) % 360), w: Math.max(0.7, Math.min(a.w, 2.4)), label: `P${++np}` });
  }
  for (const r of (an.rooms || []).filter(r => r.type === 'escalier')) out.push({ id: 'ae-' + r.id, typeId: 'arch-escalier', x: r.cx, y: r.cy, rot: Math.round(r.ang || 0), w: Math.max(0.9, Math.min(r.larg * 0.9, 3)), d: Math.max(2, Math.min(r.long * 0.9, 8)), label: `E${++ne}` });
  return out;
}
async function exportSim3d() {
  if (!need('projets')) return;
  const lvs = S.project.levels.filter(l => l.kind !== 'photo');
  if (!lvs.length) { toast('Aucun plan à exporter : la simulation 3D s\'appuie sur un plan (pas une photo).', true); return; }
  const sans = lvs.filter(l => !l.scale).map(l => l.name);
  const nArch = lvs.reduce((n, l) => n + archFromAnalyse(l).length, 0);
  const ok = window.__BK_DEMO__ ? true : await modal({ title: 'Exporter vers la Simulation 3D', size: 'sm', body: `<p style="margin:0">Le projet est exporté en scène <b>.bk3d</b> (${lvs.length} plan(s), ${lvs.reduce((n, l) => n + l.markers.length, 0)} matériel(s)), à ouvrir dans le logiciel <b>Blackeyes Simulation 3D</b>.</p>
    ${nArch ? `<p style="margin:0">${nArch} porte(s), fenêtre(s) et escalier(s) repérés par l'assistant d'implantation sont transmis et rendus en 3D.</p>` : '<p class="muted" style="margin:0">Astuce : lancez l\'assistant d\'implantation pour transmettre aussi les portes, fenêtres et escaliers.</p>'}
    ${sans.length ? `<p class="muted" style="margin:0">Échelle non réglée : ${esc(sans.join(', '))}. Elle pourra être réglée dans la Simulation 3D.</p>` : ''}
    <p class="muted" style="margin:0">Le fichier n'est pas chiffré : conservez-le sur un support maîtrisé.</p>`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Exporter', cls: 'primary', value: true }] });
  if (!ok) return;
  const used = new Set(lvs.flatMap(l => l.markers.map(m => m.typeId))); const typeCache = {};
  used.forEach(id => { const { prix, ...t } = typeOf(id); typeCache[id] = t; });
  const scene = { app: 'blackeyes-sim3d', format: 1, source: 'blackeyes-implantation', name: S.project.name, site: S.project.site || '', date: today(), markerScale: S.project.markerScale || 1,
    levels: lvs.map(l => ({ id: l.id, name: l.name, kind: 'plan', plan: l.plan, scale: l.scale || null, markers: l.markers.map(m => ({ id: m.id, typeId: m.typeId, x: m.x, y: m.y, rot: m.rot || 0, label: m.label, local: m.local || '', ...(m.range != null ? { range: m.range } : {}), ...(m.angle != null ? { angle: m.angle } : {}), ...(m.signal ? { signal: m.signal } : {}) })).concat(archFromAnalyse(l)) })),
    typeCache, savedAt: new Date().toISOString() };
  try {
    const p = await window.native.saveFile({ purpose: 'sim3d', title: 'Exporter vers Blackeyes Simulation 3D', defaultPath: `${S.project.name}.bk3d`, filters: [{ name: 'Scène Blackeyes Simulation 3D', extensions: ['bk3d'] }], data: strToBytes(JSON.stringify(scene)) });
    if (p && !window.__BK_DEMO__) toast('Scène .bk3d exportée : ouvrez-la dans Blackeyes Simulation 3D.');
  } catch (e) { toast('Export impossible : ' + e.message, true); }
}
