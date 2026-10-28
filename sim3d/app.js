/* Blackeyes Simulation 3D — éditeur de scène (plan, échelle, pose du matériel)
   Programme créé par Xavier GIROUARD. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const bytesToDataUrl = (bytes, mime) => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(new Blob([bytes], { type: mime })); });
const strToBytes = (s) => new TextEncoder().encode(s);
const MAX_PLAN = 5000, PDF_RENDER = 3200;
const SVGNS = 'http://www.w3.org/2000/svg';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const S = { db: (window.DEFAULT_DB || []).map(t => ({ ...t })), project: null, levelId: null, selId: null, tool: 'select', placeType: null, vb: null, dirty: false, calib: null, drag: null };

/* ---------------------------------------------------------------- utilitaires UI */
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3200);
}
function modal({ title, body, buttons = [], size = 'sm', left = [], onMount }) {
  return new Promise(resolve => {
    const root = document.createElement('div'); root.className = 'backdrop';
    root.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
      <header><h3>${esc(title)}</h3><button class="ghost small" data-x aria-label="Fermer">✕</button></header>
      <div class="body"></div><footer><div class="left"></div></footer></div>`;
    const bodyEl = $('.body', root);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const close = (v) => { root.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const mk = (b, parent) => {
      const el = document.createElement('button'); el.textContent = b.label; if (b.cls) el.className = b.cls;
      el.onclick = async () => { if (!b.action) { close(b.value); return; } const v = await b.action(root, el); if (v === false) return; close(v === undefined ? b.value : v); };
      parent.append(el); return el;
    };
    left.forEach(b => mk(b, $('.left', root))); buttons.forEach(b => mk(b, $('footer', root)));
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
    const f = $('input,select,textarea', bodyEl); if (f) setTimeout(() => { f.focus(); f.select && f.select(); }, 30);
  });
}
const confirmBox = (title, text, okLabel = 'Confirmer', danger = false) =>
  modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, buttons: [{ label: 'Annuler', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });
const askText = (title, label, value = '', type = 'text') => modal({
  title, body: `<label class="field"><span>${esc(label)}</span><input id="mAsk" type="${type}" step="any" value="${esc(value)}"></label>`,
  buttons: [{ label: 'Annuler', value: null }, { label: 'Valider', cls: 'primary', action: (root) => $('#mAsk', root).value }]
});

/* ---------------------------------------------------------------- matériels */
/* éléments d'architecture posés sur le plan (rendus en 3D) */
const ARCH = {
  'arch-porte': { id: 'arch-porte', code: 'P', nom: 'Porte', sys: 'Architecture', type: 'Porte battante (s\'ouvre au passage)', couleur: '#9a7148', img: '', w: 0.9 },
  'arch-entree': { id: 'arch-entree', code: 'PE', nom: 'Porte d\'entrée', sys: 'Architecture', type: 'Porte pleine renforcée (s\'ouvre au passage)', couleur: '#374151', img: '', w: 1.0 },
  'arch-vitree': { id: 'arch-vitree', code: 'PV', nom: 'Porte vitrée', sys: 'Architecture', type: 'Porte à vantail vitré (s\'ouvre au passage)', couleur: '#0ea5e9', img: '', w: 0.9 },
  'arch-double': { id: 'arch-double', code: 'PD', nom: 'Double porte', sys: 'Architecture', type: 'Deux vantaux (s\'ouvrent au passage)', couleur: '#9a7148', img: '', w: 1.6 },
  'arch-fenetre': { id: 'arch-fenetre', code: 'F', nom: 'Fenêtre', sys: 'Architecture', type: 'Fenêtre (allège, vitrage, linteau)', couleur: '#0284c7', img: '', w: 1.2 },
  'arch-escalier': { id: 'arch-escalier', code: 'E', nom: 'Escalier', sys: 'Architecture', type: 'Escalier (monte dans le sens de la flèche)', couleur: '#64748b', img: '', w: 1.2, d: 3.6 }
};
const DOOR_IDS = ['arch-porte', 'arch-entree', 'arch-vitree', 'arch-double'];
const isDoor = (m) => DOOR_IDS.includes(m.typeId);
const isArch = (m) => /^arch-/.test(m.typeId || m.id || '');
const typeOf = (id) => ARCH[id] || S.db.find(t => t.id === id) || (S.project && S.project.typeCache && S.project.typeCache[id]) ||
  { id, code: '?', nom: 'Matériel inconnu', sys: 'Autre', type: '', couleur: '#64748b', img: '' };
function zoneKind(m) {
  const t = typeOf(m.typeId);
  if (t.zone === 'faisceau') return 'faisceau';
  const ang = m.angle ?? t.detAngle;
  return ang && ang < 360 ? 'secteur' : 'cercle';
}
const rangeOf = (m) => m.range ?? typeOf(m.typeId).detRange ?? 0;
const PAL_ORDER = ['lock', 'otus', 'push', 'pdc', 'mcam', 'mprot', 'combi', 'curt', 'door', 'doorplus', 'fog', 'hub', 'siren', 'ssiren', 'rep', 'vsint', 'vpext'];
const ROLE_TIP = {
  lock: 'lockOFF : placez-le sur la porte de la salle à confiner, flèche orientée vers l\'intérieur de la salle. Pendant la simulation, toutes les portes de cette pièce restent fermées et ne peuvent pas être forcées.',
  otus: 'blackOTUS : à placer dans la salle protégée par le lockOFF (moins de 12 m). Un occupant tire la languette rouge et l\'appareil photographie la salle.',
  push: 'pushPANIC : bouton d\'alerte de la salle confinée.',
  mcam: 'MotionCam : détecteur avec photos de levée de doute. La flèche indique la direction de détection.',
  door: 'DoorProtect : contact d\'ouverture. Déclenche quand l\'individu passe à moins d\'un mètre.',
  doorplus: 'DoorProtect Plus : contact d\'ouverture et de choc.',
  hub: 'Centrale : clignote lors du déclenchement de l\'alarme.',
  siren: 'Sirène : alarme sonore et/ou flashs lumineux lors de l\'alarme (au choix, sur le plan ou pendant la simulation).', ssiren: 'Sirène extérieure : alarme sonore et/ou flashs lumineux lors de l\'alarme (au choix).',
  fog: 'Générateur de brouillard : orientez la flèche vers la pièce à protéger. À l\'alarme, il la remplit de brouillard ; l\'individu qui y entre ne voit plus rien et renonce.',
  pdc: 'Pièce de confinement : placez le pictogramme sur le mur de la pièce de mise à l\'abri, flèche vers l\'intérieur. Lors du confinement, les occupants s\'y regroupent.',
  rep: 'Répéteur : relaie le signal radio des matériels éloignés jusqu\'à la centrale (liaison visible pendant la simulation).',
  mprot: 'MotionProtect : détecteur de mouvement sans photo. La flèche indique la direction de détection.',
  combi: 'CombiProtect : mouvement et bris de vitre. Placez-le face aux vitrages.',
  curt: 'Curtain : barrière laser ; orientez le faisceau à travers l\'ouverture à protéger.',
  vsint: 'Caméra intérieure : filme l\'individu (images dans la galerie) sans déclencher l\'alarme.', vpext: 'Caméra extérieure : filme les abords sans déclencher l\'alarme.'
};
/* comportement de chaque matériel pendant la simulation 3D */
const SIM_BEHAV = {
  hub: 'Reçoit les alertes, clignote à l\'alarme et transmet l\'alerte (centre de vidéoprotection, Police municipale).',
  mcam: 'Détecte le mouvement dans sa zone et prend une série de photos de levée de doute (infrarouge la nuit).',
  mprot: 'Détecte le mouvement dans sa zone et déclenche l\'alarme, sans photo.',
  combi: 'Détecte le mouvement dans sa zone ; la surveillance du bris de vitre reste active.',
  door: 'Déclenche quand la porte s\'ouvre (passage à moins d\'un mètre).',
  doorplus: 'Déclenche à l\'ouverture ; signale aussi les chocs et l\'inclinaison lors d\'une tentative de forçage.',
  curt: 'Déclenche au franchissement du faisceau laser (ligne droite).',
  rep: 'Relaie le signal des matériels plus proches de lui que de la centrale (liaison radio affichée).',
  fog: 'À l\'alarme, remplit sa zone d\'un brouillard opaque ; l\'individu qui y entre renonce et s\'enfuit.',
  siren: 'À l\'alarme : alarme sonore et/ou flashs lumineux selon le signal choisi.', ssiren: 'À l\'alarme : alarme sonore et/ou flashs lumineux selon le signal choisi.',
  push: 'Actionné par un occupant de la salle confinée : alerte aux contacts d\'urgence.',
  otus: 'Un occupant tire la languette : photos de la salle et des occupants.',
  lock: 'Toutes les portes de la pièce restent fermées : la tentative d\'effraction échoue.',
  pdc: 'Signale la pièce de confinement : les occupants s\'y regroupent, le pictogramme s\'éclaire.',
  vsint: 'Filme l\'individu dans son champ, sans déclencher l\'alarme.', vpext: 'Filme les abords, sans déclencher l\'alarme.'
};
function specMarkup(t, m) {
  const rows = [['Fonction', t.fn], ['Portée radio', t.radio], ['Détection', t.det], ['Autonomie', t.auto],
    ['Zone', (m.range ?? t.detRange) ? `${String(m.range ?? t.detRange).replace('.', ',')} m${zoneKind(m) === 'faisceau' ? ' (faisceau)' : (m.angle ?? t.detAngle) ? ` · ${String(m.angle ?? t.detAngle).replace('.', ',')}°` : ''}` : ''],
    ['Notes', t.notes]].filter(r => r[1]);
  return `<section class="spec"><h2>Caractéristiques</h2>${rows.map(r => `<div class="spec-r"><span>${esc(r[0])}</span><div>${esc(r[1])}</div></div>`).join('')}
    ${SIM_BEHAV[t.id] ? `<div class="spec-sim"><b>Dans la simulation</b><br>${esc(SIM_BEHAV[t.id])}</div>` : ''}</section>`;
}
function paletteTypes() {
  const extra = Object.values((S.project && S.project.typeCache) || {}).filter(t => !S.db.find(d => d.id === t.id) && !ARCH[t.id]);
  const all = S.db.concat(extra);
  return all.sort((a, b) => { const ia = PAL_ORDER.indexOf(a.id), ib = PAL_ORDER.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nom.localeCompare(b.nom); });
}

/* ---------------------------------------------------------------- scène */
const level = () => (S.project ? S.project.levels.find(l => l.id === S.levelId) : null) || null;
const marker = () => { const l = level(); return l ? l.markers.find(m => m.id === S.selId) || null : null; };
const markerSize = (l) => Math.max(l.plan.w, l.plan.h) * 0.018 * (S.project.markerScale || 1);
const newProject = () => ({ app: 'blackeyes-sim3d', format: 1, name: 'Nouvelle scène', site: '', date: today(), markerScale: 1, levels: [], typeCache: {} });
function setDirty(v = true) { S.dirty = v; $('#dirty').hidden = !v; }

function showHome(on) { $('#home').hidden = !on; }
function renderAll() {
  const p = S.project; showHome(!p || !p.levels.length);
  if (!p) return;
  $('#projName').value = p.name || '';
  $('#lvSel').innerHTML = p.levels.map(l => `<option value="${l.id}" ${l.id === S.levelId ? 'selected' : ''}>${esc(l.name)}${l.kind === 'photo' ? ' (photo)' : ''}</option>`).join('');
  renderPalette(); renderStage(true); renderSide(); banner();
}

/* ---------------------------------------------------------------- palette */
function renderPalette() {
  $('#pal').innerHTML = `<h2>Matériel</h2><p class="muted pal-tip">Cliquez un matériel puis sur le plan (plusieurs clics = plusieurs poses). Échap pour terminer.</p>
    <div class="pal-list">${paletteTypes().map(t => `<button class="pal-it ${S.placeType === t.id ? 'on' : ''}" data-t="${esc(t.id)}" title="${esc(t.fn || t.nom)}">
      <span class="ic" style="border-color:${esc(t.couleur)}">${t.img ? `<img src="${t.img}" alt="">` : `<b style="color:${esc(t.couleur)}">${esc(t.code)}</b>`}</span>
      <span class="nm">${esc(t.nom)}<small>${esc(t.code)}${t.detRange ? ` · ${String(t.detRange).replace('.', ',')} m` : ''}</small></span></button>`).join('')}</div>`;
  const ico = { 'arch-porte': '<svg viewBox="0 0 40 40"><rect x="4" y="18" width="8" height="4" fill="#475569"/><rect x="28" y="18" width="8" height="4" fill="#475569"/><path d="M12 20 L12 4 A16 16 0 0 1 28 20" fill="none" stroke="#9a7148" stroke-width="2.5"/></svg>',
    'arch-fenetre': '<svg viewBox="0 0 40 40"><rect x="2" y="16" width="8" height="8" fill="#475569"/><rect x="30" y="16" width="8" height="8" fill="#475569"/><line x1="10" y1="18" x2="30" y2="18" stroke="#0284c7" stroke-width="2"/><line x1="10" y1="22" x2="30" y2="22" stroke="#0284c7" stroke-width="2"/></svg>',
    'arch-entree': '<svg viewBox="0 0 40 40"><rect x="2" y="17" width="9" height="6" fill="#374151"/><rect x="29" y="17" width="9" height="6" fill="#374151"/><path d="M11 20 L11 3 A18 18 0 0 1 29 20" fill="none" stroke="#374151" stroke-width="3.5"/></svg>', 'arch-vitree': '<svg viewBox="0 0 40 40"><rect x="4" y="18" width="8" height="4" fill="#475569"/><rect x="28" y="18" width="8" height="4" fill="#475569"/><path d="M12 20 L12 4 A16 16 0 0 1 28 20" fill="none" stroke="#0ea5e9" stroke-width="2.5"/><line x1="12" y1="6" x2="12" y2="19" stroke="#7dd3fc" stroke-width="4"/></svg>', 'arch-double': '<svg viewBox="0 0 40 40"><rect x="1" y="18" width="5" height="4" fill="#475569"/><rect x="34" y="18" width="5" height="4" fill="#475569"/><path d="M6 20 L6 6 A14 14 0 0 1 20 20 A14 14 0 0 1 34 6 L34 20" fill="none" stroke="#9a7148" stroke-width="2.5"/></svg>',
    'arch-escalier': '<svg viewBox="0 0 40 40"><rect x="6" y="8" width="28" height="24" fill="none" stroke="#475569" stroke-width="2"/><g stroke="#475569" stroke-width="1.6"><line x1="11" y1="8" x2="11" y2="32"/><line x1="15" y1="8" x2="15" y2="32"/><line x1="19" y1="8" x2="19" y2="32"/><line x1="23" y1="8" x2="23" y2="32"/><line x1="27" y1="8" x2="27" y2="32"/><line x1="31" y1="8" x2="31" y2="32"/></g><path d="M8 20 H31 M27 16 L31 20 L27 24" fill="none" stroke="#dc2626" stroke-width="2"/></svg>' };
  $('#pal').insertAdjacentHTML('beforeend', `<h2 id="palInt" style="margin-top:14px">Intégrer</h2><p class="muted pal-tip">Portes, fenêtres, escaliers et murs à intégrer au plan pour la 3D. Les portes et fenêtres s'alignent sur le mur le plus proche.</p>
    <div class="pal-list">${Object.values(ARCH).map(t => `<button class="pal-it ${S.placeType === t.id ? 'on' : ''}" data-t="${t.id}" title="${esc(t.type)}"><span class="ic" style="border-color:${t.couleur}">${ico[t.id]}</span><span class="nm">${esc(t.nom)}<small>${esc(t.type)}</small></span></button>`).join('')}
      <button class="pal-it pal-tool ${S.tool === 'erase' ? 'on' : ''}" data-tool="erase" title="Tracez un rectangle sur la partie de mur à supprimer de la 3D"><span class="ic" style="border-color:#dc2626"><svg viewBox="0 0 40 40"><rect x="3" y="16" width="34" height="8" fill="#475569"/><rect x="13" y="13" width="14" height="14" fill="#fff" stroke="#dc2626" stroke-width="2" stroke-dasharray="3 2"/></svg></span><span class="nm">Effacer un mur<small>Retire une partie de mur de la 3D</small></span></button>
      <button class="pal-it pal-tool ${S.tool === 'wall' ? 'on' : ''}" data-tool="wall" title="Cliquez le début puis la fin du mur (Maj = horizontal ou vertical)"><span class="ic" style="border-color:#475569"><svg viewBox="0 0 40 40"><line x1="6" y1="30" x2="34" y2="10" stroke="#334155" stroke-width="6" stroke-linecap="square"/></svg></span><span class="nm">Ajouter un mur<small>Mur absent du plan</small></span></button></div>`);
  $$('.pal-tool').forEach(b => b.onclick = () => { if (!level()) return; setTool(S.tool === b.dataset.tool ? 'select' : b.dataset.tool); });
  $$('.pal-it:not(.pal-tool)').forEach(b => b.onclick = () => {
    if (!level()) return;
    if (S.placeType === b.dataset.t) setTool('select'); else { S.placeType = b.dataset.t; setTool('place'); }
  });
}
function setTool(t) {
  S.tool = t; if (t !== 'place') S.placeType = null; if (t !== 'scale') S.calib = null;
  $('#stageWrap').dataset.tool = t; const bz = $('#bZone'); if (bz) bz.classList.toggle('on', t === 'zone');
  if (t === 'erase' || t === 'wall') S.selId = null;
  if (t !== 'zone') S.selZone = null; if (t !== 'wall') S.wallA = null; if (['place', 'zone', 'scale'].includes(t)) S.selEdit = null;
  renderPalette(); renderZones(); renderEdits(); renderOverlay(); banner();
}
function banner() {
  const b = $('#banner');
  if (S.tool === 'place') { b.innerHTML = ARCH[S.placeType] ? `Intégrer : <b>${esc(typeOf(S.placeType).nom)}</b> — cliquez sur le plan à l'endroit voulu (un élément ; vous pourrez ensuite régler son angle et sa taille) <button id="bnStop">Annuler (Échap)</button>` : `Pose : <b>${esc(typeOf(S.placeType).nom)}</b> — cliquez sur le plan <button id="bnStop">Terminer (Échap)</button>`; b.hidden = false; }
  else if (S.tool === 'erase') { b.innerHTML = `Effacer un mur : tracez un rectangle sur la partie de mur à retirer de la 3D · cliquez un effacement puis Suppr pour l'annuler <button id="bnStop">Terminer (Échap)</button>`; b.hidden = false; }
  else if (S.tool === 'wall') { b.innerHTML = `Ajouter un mur : cliquez ${S.wallA ? '<b>la fin</b>' : '<b>le début</b>'} du mur (Maj = horizontal ou vertical) · cliquez un mur ajouté puis Suppr pour le retirer <button id="bnStop">Terminer (Échap)</button>`; b.hidden = false; }
  else if (S.tool === 'zone') { const n = (level() && level().zones || []).length; b.innerHTML = `Sélection : tracez un rectangle autour de la partie du plan à monter en 3D (plusieurs zones possibles). ${n ? `<b>${n} zone(s)</b> · cliquez une zone puis Suppr pour la retirer · <button id="bnClear">Tout effacer</button>` : 'Sans zone, tout le plan est monté.'} <button id="bnStop">Terminer (Échap)</button>`; b.hidden = false; const c = $('#bnClear'); if (c) c.onclick = () => { level().zones = []; S.selZone = null; setDirty(); renderZones(); banner(); renderSide(); }; }
  else if (S.tool === 'scale') { b.innerHTML = `Échelle : cliquez sur le ${S.calib && S.calib.a ? 'second' : 'premier'} point d'une cote connue <button id="bnStop">Annuler (Échap)</button>`; b.hidden = false; }
  else b.hidden = true;
  const s = $('#bnStop'); if (s) s.onclick = () => setTool('select');
  const l = level();
  $('#hint').textContent = !l ? '' : !l.scale ? '⚠ Échelle non réglée : bouton « 📏 Échelle » (touche E). Elle est indispensable à la 3D.' : `Échelle : 1 m = ${Math.round(l.scale * 10) / 10} px · Molette = zoom · glisser le fond = déplacer · F = ajuster`;
  $('#hint').classList.toggle('warn', !!l && !l.scale);
}

/* ---------------------------------------------------------------- plan (SVG) */
function fit() {
  const l = level(); if (!l) return; const W = $('#stageWrap').clientWidth || 1000, H = $('#stageWrap').clientHeight || 700;
  const k = Math.max(l.plan.w / W, l.plan.h / H) * 1.04; const vw = W * k, vh = H * k;
  S.vb = [(l.plan.w - vw) / 2, (l.plan.h - vh) / 2, vw, vh]; applyVb();
}
const applyVb = () => $('#stage').setAttribute('viewBox', S.vb.map(v => v.toFixed(2)).join(' '));
let shownPlan = null;
function renderStage(full = false) {
  const svg = $('#stage'); const l = level();
  if (!l) { svg.innerHTML = ''; shownPlan = null; return; }
  if (full || shownPlan !== l.id) {
    const types = paletteTypes().filter(t => t.img);
    svg.innerHTML = `<defs>${types.map(t => `<symbol id="ic-${esc(t.id)}" viewBox="0 0 100 100"><image href="${t.img}" x="8" y="8" width="84" height="84" preserveAspectRatio="xMidYMid meet"/></symbol>`).join('')}</defs>
      <image id="planImg" href="${l.plan.dataUrl}" x="0" y="0" width="${l.plan.w}" height="${l.plan.h}"/>
      <g id="gSel"></g><g id="gEdit"></g><g id="gZones"></g><g id="gMarks"></g><g id="gHdl"></g><g id="gOver"></g>`;
    shownPlan = l.id; if (full || !S.vb) fit();
  }
  renderZones(); renderEdits(); renderMarks();
}
/* murs effacés et murs ajoutés */
function renderEdits() {
  const g = $('#gEdit'); const l = level(); if (!g || !l) return; const ms = markerSize(l); const k = l.scale || 50;
  const H = $('#gHdl'); if (H) { const s0 = S.selEdit; let h = '';
    if (s0 && s0.k === 'eff' && l.effacements && l.effacements[s0.i]) { const e = l.effacements[s0.i]; h = `<rect x="${e.x + e.w - ms * 0.25}" y="${e.y + e.h - ms * 0.25}" width="${ms * 0.5}" height="${ms * 0.5}" fill="#1d4fb8" stroke="#fff" stroke-width="${ms * 0.06}" data-h="ec" class="hdl" style="cursor:nwse-resize"/>`; }
    if (s0 && s0.k === 'mur' && l.murs && l.murs[s0.i]) { const w = l.murs[s0.i]; h = ['1', '2'].map(n => `<circle cx="${w['x' + n]}" cy="${w['y' + n]}" r="${ms * 0.3}" fill="#1d4fb8" stroke="#fff" stroke-width="${ms * 0.06}" data-h="m${n}" class="hdl" style="cursor:move"/>`).join(''); }
    H.innerHTML = h; }
  const effs = l.effacements || [], murs = l.murs || []; const sel = S.selEdit;
  g.innerHTML = effs.map((e, i) => { const on = sel && sel.k === 'eff' && sel.i === i;
      return `<g><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="#fff" fill-opacity="0.92" stroke="#dc2626" stroke-width="${ms * (on ? 0.14 : 0.07)}" stroke-dasharray="${ms * 0.3} ${ms * 0.18}"/>
        <text x="${e.x + e.w / 2}" y="${e.y + e.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(ms * 0.5, e.h * 0.8)}" fill="#dc2626" font-weight="700" pointer-events="none">mur effacé</text></g>`; }).join('')
    + murs.map((w, i) => { const on = sel && sel.k === 'mur' && sel.i === i;
      return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${on ? '#dc2626' : '#1f2937'}" stroke-width="${(w.ep || 0.2) * k}" stroke-linecap="square" opacity="0.9"/>
        <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#facc15" stroke-width="${ms * 0.06}" stroke-dasharray="${ms * 0.3} ${ms * 0.2}" pointer-events="none"/>`; }).join('');
}
const editAt = (l, p) => {
  const effs = l.effacements || []; for (let i = effs.length - 1; i >= 0; i--) { const e = effs[i]; if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h) return { k: 'eff', i }; }
  const murs = l.murs || []; const tol = (l.scale || 50) * 0.4;
  for (let i = murs.length - 1; i >= 0; i--) { const w = murs[i]; const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / L2));
    if (Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy)) < tol) return { k: 'mur', i }; }
  return null;
};
function removeEdit() { const l = level(); const s2 = S.selEdit; if (!l || !s2) return; (s2.k === 'eff' ? l.effacements : l.murs).splice(s2.i, 1); S.selEdit = null; setDirty(); renderEdits(); renderSide(); }
/* zones sélectionnées pour la 3D : le reste du plan est grisé */
function renderZones() {
  const g = $('#gSel'); const l = level(); if (!g || !l) return; const zs = l.zones || []; const ms = markerSize(l);
  if (!zs.length) { g.innerHTML = ''; return; }
  const W = l.plan.w, H = l.plan.h, edit = S.tool === 'zone';
  g.innerHTML = `<path d="M0 0H${W}V${H}H0Z ${zs.map(z => `M${z.x} ${z.y}v${z.h}h${z.w}v${-z.h}Z`).join(' ')}" fill="#0f1724" fill-opacity="${edit ? 0.42 : 0.28}" fill-rule="evenodd" pointer-events="none"/>
    ${zs.map((z, i) => `<g class="zsel" data-z="${i}"><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="${edit ? '#1d4fb8' : 'none'}" fill-opacity="${S.selZone === i ? 0.12 : 0.02}" stroke="${S.selZone === i ? '#dc2626' : '#1d4fb8'}" stroke-width="${ms * (S.selZone === i ? 0.14 : 0.09)}" stroke-dasharray="${ms * 0.4} ${ms * 0.22}" ${edit ? '' : 'pointer-events="none"'}/>
      <text x="${z.x + ms * 0.3}" y="${z.y + ms * 0.75}" font-size="${ms * 0.6}" font-weight="700" fill="#1d4fb8" stroke="#fff" stroke-width="${ms * 0.15}" paint-order="stroke" pointer-events="none">Zone 3D ${i + 1}</text></g>`).join('')}`;
}
/* « Intégrer » : affiche la rubrique dans la colonne de gauche */
function showIntegrer() { if (!level()) return; const h = $('#palInt'); if (!h) return; h.scrollIntoView({ behavior: 'smooth', block: 'start' }); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
function removeZone(i) { const l = level(); if (!l || !l.zones) return; l.zones.splice(i, 1); S.selZone = null; setDirty(); renderZones(); banner(); renderSide(); }
function zonePathD(m, l) {
  const r = rangeOf(m) * (l.scale || 0); if (!r) return '';
  const k = zoneKind(m), a = (m.rot || 0) * Math.PI / 180;
  if (k === 'cercle') return `M${m.x - r} ${m.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  if (k === 'faisceau') { const w = Math.max(0.35 * l.scale, r * 0.025), dx = Math.cos(a), dy = Math.sin(a), nx = -dy * w / 2, ny = dx * w / 2;
    return `M${m.x + nx} ${m.y + ny}L${m.x + dx * r + nx} ${m.y + dy * r + ny}L${m.x + dx * r - nx} ${m.y + dy * r - ny}L${m.x - nx} ${m.y - ny}z`; }
  const half = ((m.angle ?? typeOf(m.typeId).detAngle) || 90) * Math.PI / 360;
  const p1 = [m.x + r * Math.cos(a - half), m.y + r * Math.sin(a - half)], p2 = [m.x + r * Math.cos(a + half), m.y + r * Math.sin(a + half)];
  return `M${m.x} ${m.y}L${p1[0]} ${p1[1]}A${r} ${r} 0 ${half * 2 > Math.PI ? 1 : 0} 1 ${p2[0]} ${p2[1]}z`;
}
function renderMarks() {
  const l = level(); if (!l || !$('#gMarks')) return; const ms = markerSize(l);
  $('#gZones').innerHTML = l.markers.map(m => { const d = zonePathD(m, l); const c = typeOf(m.typeId).couleur || '#64748b';
    return d ? `<path d="${d}" fill="${esc(c)}" fill-opacity="${m.id === S.selId ? 0.26 : 0.15}" stroke="${esc(c)}" stroke-opacity=".6" stroke-width="${ms * 0.05}"/>` : ''; }).join('');
  $('#gMarks').innerHTML = l.markers.map(m => {
    if (isArch(m)) return archMarkup(m, l, ms);
    const t = typeOf(m.typeId); const c = esc(t.couleur || '#64748b'); const sel = m.id === S.selId; const a = m.rot || 0;
    const ax = Math.cos(a * Math.PI / 180) * ms * 1.25, ay = Math.sin(a * Math.PI / 180) * ms * 1.25;
    return `<g class="mk${sel ? ' sel' : ''}" data-id="${m.id}" transform="translate(${m.x} ${m.y})">
      ${sel ? `<circle r="${ms * 0.9}" fill="none" stroke="#1d4fb8" stroke-width="${ms * 0.08}" stroke-dasharray="${ms * 0.2} ${ms * 0.12}"/>` : ''}
      <line x1="0" y1="0" x2="${ax}" y2="${ay}" stroke="${c}" stroke-width="${ms * 0.1}"/><circle cx="${ax}" cy="${ay}" r="${ms * (sel ? 0.24 : 0.14)}" fill="${sel ? '#1d4fb8' : c}" stroke="#fff" stroke-width="${ms * 0.05}" ${sel ? 'data-h="rot" class="hrot"' : ''}/>
      <circle r="${ms * 0.62}" fill="#fff" stroke="${c}" stroke-width="${ms * 0.1}"/>
      ${t.img ? `<use href="#ic-${esc(t.id)}" x="${-ms * 0.55}" y="${-ms * 0.55}" width="${ms * 1.1}" height="${ms * 1.1}" ${t.iconRot ? `transform="rotate(${a})"` : ''}/>` : `<text text-anchor="middle" dy=".35em" font-size="${ms * 0.5}" font-weight="700" fill="${c}">${esc(t.code)}</text>`}
      <text class="lbl" y="${ms * 1.15}" text-anchor="middle" font-size="${ms * 0.46}" stroke-width="${ms * 0.14}">${esc(m.label || '')}</text></g>`;
  }).join('');
  renderOverlay();
}
function archMarkup(m, l, ms) {
  const k = l.scale || ms / 0.5; const sel = m.id === S.selId; const w = (m.w || 1) * k, T = 0.22 * k, a = m.rot || 0;
  let body = '';
  if (isDoor(m) && m.typeId !== 'arch-porte') {
    const sens = m.sens === -1 ? -1 : 1, col = { 'arch-entree': '#374151', 'arch-vitree': '#0ea5e9', 'arch-double': '#9a7148' }[m.typeId];
    const lw = m.typeId === 'arch-entree' ? 0.16 : 0.1;
    const leaf = (hx, side, len) => `<line x1="${hx}" y1="0" x2="${hx}" y2="${-sens * len}" stroke="${col}" stroke-width="${ms * lw}"/>${m.typeId === 'arch-vitree' ? `<line x1="${hx}" y1="${-sens * len * 0.15}" x2="${hx}" y2="${-sens * len * 0.85}" stroke="#bae6fd" stroke-width="${ms * 0.05}"/>` : ''}
      <path d="M${hx} ${-sens * len} A${len} ${len} 0 0 ${(side * sens) > 0 ? 1 : 0} ${hx + side * len} 0" fill="none" stroke="${col}" stroke-width="${ms * 0.05}" stroke-dasharray="${ms * 0.15} ${ms * 0.1}"/>`;
    const side = m.flip ? -1 : 1;
    body = `<rect x="${-w / 2}" y="${-T / 2}" width="${w}" height="${T}" fill="${m.typeId === 'arch-vitree' ? '#e0f2fe' : '#fff'}" stroke="${col}" stroke-width="${ms * (m.typeId === 'arch-entree' ? 0.12 : 0.06)}"/>`
      + (m.typeId === 'arch-double' ? leaf(-w / 2, 1, w / 2) + leaf(w / 2, -1, w / 2) : leaf(-side * w / 2, side, w)); }
  else if (m.typeId === 'arch-porte') { const side = m.flip ? -1 : 1, sens = m.sens === -1 ? -1 : 1, hx = -side * w / 2, ex = hx + side * w, ey = sens * side * w * 0;
    body = `<rect x="${-w / 2}" y="${-T / 2}" width="${w}" height="${T}" fill="#fff" stroke="#9a7148" stroke-width="${ms * 0.06}"/>
      <line x1="${hx}" y1="0" x2="${hx}" y2="${-sens * w}" stroke="#9a7148" stroke-width="${ms * 0.1}"/>
      <path d="M${hx} ${-sens * w} A${w} ${w} 0 0 ${(side * sens) > 0 ? 1 : 0} ${ex} 0" fill="none" stroke="#9a7148" stroke-width="${ms * 0.05}" stroke-dasharray="${ms * 0.15} ${ms * 0.1}"/>`; }
  else if (m.typeId === 'arch-fenetre') body = `<rect x="${-w / 2}" y="${-T / 2}" width="${w}" height="${T}" fill="#e0f2fe" stroke="#0284c7" stroke-width="${ms * 0.06}"/><line x1="${-w / 2}" y1="0" x2="${w / 2}" y2="0" stroke="#0284c7" stroke-width="${ms * 0.06}"/>`;
  else { const L = (m.d || 3.6) * k, nb = Math.max(4, Math.round((m.d || 3.6) / 0.28));
    body = `<rect x="${-L / 2}" y="${-w / 2}" width="${L}" height="${w}" fill="#f1f5f9" stroke="#475569" stroke-width="${ms * 0.06}"/>${Array.from({ length: nb - 1 }, (_, i) => `<line x1="${-L / 2 + L * (i + 1) / nb}" y1="${-w / 2}" x2="${-L / 2 + L * (i + 1) / nb}" y2="${w / 2}" stroke="#94a3b8" stroke-width="${ms * 0.04}"/>`).join('')}
      <path d="M${-L / 2 + ms * 0.3} 0 H${L / 2 - ms * 0.3} M${L / 2 - ms * 0.8} ${-ms * 0.45} L${L / 2 - ms * 0.3} 0 L${L / 2 - ms * 0.8} ${ms * 0.45}" fill="none" stroke="#dc2626" stroke-width="${ms * 0.1}"/>`; }
  const hx = (m.typeId === 'arch-escalier' ? (m.d || 3.6) * k / 2 : w / 2) + ms * 0.6;
  return `<g class="mk arch${sel ? ' sel' : ''}" data-id="${m.id}" transform="translate(${m.x} ${m.y}) rotate(${a})">
    <rect x="${-Math.max(w, hx * 2) / 2 - ms * 0.2}" y="${-Math.max(T, w) / 2 - ms * 0.2}" width="${Math.max(w, hx * 2) + ms * 0.4}" height="${Math.max(T, w) + ms * 0.4}" fill="transparent"/>
    ${body}${sel ? `<rect x="${-hx + ms * 0.4}" y="${-(m.typeId === 'arch-escalier' ? w : T) / 2 - ms * 0.25}" width="${2 * hx - ms * 0.8}" height="${(m.typeId === 'arch-escalier' ? w : T) + ms * 0.5}" fill="none" stroke="#1d4fb8" stroke-width="${ms * 0.07}" stroke-dasharray="${ms * 0.2} ${ms * 0.12}"/>
    <line x1="${hx - ms * 0.4}" y1="0" x2="${hx}" y2="0" stroke="#1d4fb8" stroke-width="${ms * 0.07}"/><circle cx="${hx}" cy="0" r="${ms * 0.24}" fill="#1d4fb8" stroke="#fff" stroke-width="${ms * 0.05}" data-h="rot" class="hrot"><title>Tourner (Maj = pas de 15°)</title></circle>
    ${m.typeId === 'arch-escalier' ? [1, -1].map(sg => `<rect x="${sg * (m.d || 3.6) * k / 2 - ms * 0.2}" y="${-ms * 0.2}" width="${ms * 0.4}" height="${ms * 0.4}" fill="#fff" stroke="#1d4fb8" stroke-width="${ms * 0.08}" data-h="slen" style="cursor:ew-resize"><title>Longueur</title></rect><rect x="${-ms * 0.2}" y="${sg * w / 2 - ms * 0.2}" width="${ms * 0.4}" height="${ms * 0.4}" fill="#fff" stroke="#1d4fb8" stroke-width="${ms * 0.08}" data-h="swid" style="cursor:ns-resize"><title>Largeur</title></rect>`).join('')
      : [1, -1].map(sg => `<rect x="${sg * w / 2 - ms * 0.2}" y="${-ms * 0.2}" width="${ms * 0.4}" height="${ms * 0.4}" fill="#fff" stroke="#1d4fb8" stroke-width="${ms * 0.08}" data-h="size" style="cursor:ew-resize"><title>Largeur</title></rect>`).join('')}` : ''}
    <text class="lbl" y="${-(m.typeId === 'arch-escalier' ? w / 2 : T) - ms * 0.35}" text-anchor="middle" font-size="${ms * 0.42}" stroke-width="${ms * 0.12}" transform="rotate(${-a})">${esc(m.label || '')}</text></g>`;
}
function renderOverlay() {
  const g = $('#gOver'); if (!g) return; const l = level(); const ms = l ? markerSize(l) : 10;
  if (S.tool === 'scale' && S.calib && S.calib.a) {
    const a = S.calib.a, b = S.calib.b || S.calib.hover || a;
    g.innerHTML = `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#dc2626" stroke-width="${ms * 0.12}" stroke-dasharray="${ms * 0.4} ${ms * 0.2}"/>
      <circle cx="${a.x}" cy="${a.y}" r="${ms * 0.22}" fill="#dc2626"/><circle cx="${b.x}" cy="${b.y}" r="${ms * 0.22}" fill="#dc2626"/>`;
  } else g.innerHTML = '';
}
function toPlan(e) {
  const svg = $('#stage'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const r = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: r.x, y: r.y };
}
function nextLabel(typeId) {
  const t = typeOf(typeId); const all = S.project.levels.flatMap(l => l.markers).filter(m => m.typeId === typeId);
  let n = all.length + 1; const used = new Set(all.map(m => m.label)); while (used.has(`${t.code}${n}`)) n++; return `${t.code}${n}`;
}
function addMarker(typeId, x, y) {
  const l = level(); const t = typeOf(typeId);
  const m = { id: uid(), typeId, x: Math.round(x), y: Math.round(y), rot: 0, label: nextLabel(typeId), local: '' };
  if (ARCH[typeId]) { m.w = t.w; if (t.d) m.d = t.d; if (typeId !== 'arch-escalier') wallAngleAt(l, m.x, m.y).then(a => { if (a !== null) { m.rot = a; renderMarks(); if (S.selId === m.id) renderSide(); } }); }
  l.markers.push(m); if (!ARCH[typeId] && !S.project.typeCache[typeId] && !S.db.find(d => d.id === typeId)) S.project.typeCache[typeId] = t;
  S.selId = m.id; setDirty(); return m;
}
/* orientation du mur le plus proche d'un point (axe principal des pixels sombres voisins) */
const planPix = new Map();
async function wallAngleAt(l, x, y) {
  try {
    let P = planPix.get(l.id);
    if (!P || P.url !== l.plan.dataUrl) { const img = await loadImg(l.plan.dataUrl); const f = Math.min(1, 2400 / Math.max(l.plan.w, l.plan.h)); const c = document.createElement('canvas'); c.width = Math.round(l.plan.w * f); c.height = Math.round(l.plan.h * f);
      const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      P = { url: l.plan.dataUrl, f, W: c.width, H: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; planPix.set(l.id, P); }
    // direction du mur : la droite passant par le point qui traverse le plus de pixels sombres (de part et d'autre d'une ouverture)
    const R = Math.max(6, Math.round((l.scale ? 1.4 * l.scale : 70) * P.f)), cx = Math.round(x * P.f), cy = Math.round(y * P.f);
    const dark = (xx, yy) => { if (xx < 0 || yy < 0 || xx >= P.W || yy >= P.H) return 0; const o = (yy * P.W + xx) * 4; const r = P.d[o], g = P.d[o + 1], b = P.d[o + 2]; const lum = 0.3 * r + 0.59 * g + 0.11 * b, sat = Math.max(r, g, b) - Math.min(r, g, b); return lum < 140 || (sat < 40 && lum < 215) ? 1 : 0; };
    let best = -1, bestA = null;
    for (let deg = 0; deg < 180; deg += 3) {
      const ux = Math.cos(deg * Math.PI / 180), uy = Math.sin(deg * Math.PI / 180); let n = 0;
      for (let t = -R; t <= R; t++) for (let o = -2; o <= 2; o++) n += dark(Math.round(cx + ux * t - uy * o), Math.round(cy + uy * t + ux * o));
      const bonus = (deg % 90 === 0) ? 1.04 : 1;                                 // les plans sont presque toujours orthogonaux
      if (n * bonus > best) { best = n * bonus; bestA = deg; }
    }
    if (best < R * 0.6) return null;
    return bestA;
  } catch { return null; }
}
function bindStage() {
  const svg = $('#stage'), wrap = $('#stageWrap');
  svg.addEventListener('pointerdown', (e) => {
    const l = level(); if (!l || e.button === 1) return; const p = toPlan(e);
    if (e.button === 2) { S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vb: [...S.vb] }; svg.setPointerCapture(e.pointerId); return; }
    if (S.tool === 'scale') {
      if (!S.calib || !S.calib.a) { S.calib = { a: p }; banner(); renderOverlay(); return; }
      S.calib.b = p; renderOverlay(); finishScale(); return;
    }
    if (S.tool === 'erase' || S.tool === 'wall') {
      const hit = editAt(l, p);
      if (hit && hit.k === (S.tool === 'erase' ? 'eff' : 'mur') && !S.wallA) { S.selEdit = hit; renderEdits(); return; }
      S.selEdit = null;
      if (S.tool === 'erase') { S.drag = { kind: 'erase', a: p, b: p }; svg.setPointerCapture(e.pointerId); return; }
      let q = p; if (S.wallA && e.shiftKey) q = Math.abs(p.x - S.wallA.x) > Math.abs(p.y - S.wallA.y) ? { x: p.x, y: S.wallA.y } : { x: S.wallA.x, y: p.y };
      if (!S.wallA) { S.wallA = q; banner(); renderOverlay(); return; }
      const L = Math.hypot(q.x - S.wallA.x, q.y - S.wallA.y); if (L < (l.scale || 50) * 0.3) { toast('Mur trop court (30 cm minimum).', true); return; }
      (l.murs = l.murs || []).push({ x1: Math.round(S.wallA.x), y1: Math.round(S.wallA.y), x2: Math.round(q.x), y2: Math.round(q.y), ep: 0.2 });
      S.selEdit = { k: 'mur', i: l.murs.length - 1 }; S.selId = null; S.wallA = null; setDirty(); setTool('select'); renderSide(); toast('Mur ajouté : ajustez ses extrémités, son angle et son épaisseur, puis choisissez l\'élément suivant.'); return;
    }
    if (S.tool === 'zone') {
      const zl = l.zones || []; let zi = -1; for (let i = zl.length - 1; i >= 0; i--) { const z = zl[i]; if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) { zi = i; break; } }
      if (zi >= 0 && S.selZone !== zi) { S.selZone = zi; renderZones(); return; }   // 1er clic : sélection ; dans une zone déjà choisie : nouvelle zone
      if (zi < 0 && S.selZone != null) { S.selZone = null; renderZones(); }
      S.drag = { kind: 'zone', a: p, b: p }; svg.setPointerCapture(e.pointerId); return;
    }
    if (S.tool === 'place') {
      if (p.x < 0 || p.y < 0 || p.x > l.plan.w || p.y > l.plan.h) return;
      const placed = S.placeType; addMarker(placed, p.x, p.y);
      if (ARCH[placed]) { setTool('select'); toast('Élément intégré : ajustez son angle et sa taille avec les poignées bleues ou le panneau de droite, puis choisissez l\'élément suivant.'); }
      renderMarks(); renderSide(); return;
    }
    const hd = e.target.closest('[data-h]'); const g = e.target.closest('.mk');
    if (hd && ['ec', 'm1', 'm2'].includes(hd.dataset.h) && S.selEdit) { S.drag = { kind: hd.dataset.h }; }
    else if (hd && marker()) { S.drag = { kind: hd.dataset.h, id: S.selId }; }
    else if (g) { S.selId = g.dataset.id; S.selEdit = null; renderEdits(); const m = marker(); S.drag = { kind: 'move', id: m.id, dx: p.x - m.x, dy: p.y - m.y, moved: false }; renderMarks(); renderSide(); }
    else {
      const hit = editAt(l, p);
      if (hit) { S.selEdit = hit; S.selId = null; const o = hit.k === 'eff' ? { ...l.effacements[hit.i] } : { ...l.murs[hit.i] }; S.drag = { kind: 'emove', p0: p, o }; renderMarks(); renderEdits(); renderSide(); }
      else { if (S.selId || S.selEdit) { S.selId = null; S.selEdit = null; renderMarks(); renderEdits(); renderSide(); } S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vb: [...S.vb] }; }
    }
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (S.tool === 'scale' && S.calib && S.calib.a && !S.calib.b) { S.calib.hover = toPlan(e); renderOverlay(); }
    if (S.tool === 'wall' && S.wallA) { let q = toPlan(e); if (e.shiftKey) q = Math.abs(q.x - S.wallA.x) > Math.abs(q.y - S.wallA.y) ? { x: q.x, y: S.wallA.y } : { x: S.wallA.x, y: q.y };
      const l = level(); $('#gOver').innerHTML = `<line x1="${S.wallA.x}" y1="${S.wallA.y}" x2="${q.x}" y2="${q.y}" stroke="#1f2937" stroke-opacity="0.7" stroke-width="${0.2 * (l.scale || 50)}"/><text x="${q.x}" y="${q.y - markerSize(l) * 0.6}" font-size="${markerSize(l) * 0.5}" fill="#1d4fb8" font-weight="700">${l.scale ? (Math.hypot(q.x - S.wallA.x, q.y - S.wallA.y) / l.scale).toFixed(2).replace('.', ',') + ' m' : ''}</text>`; }
    if (!d) return;
    if (d.kind === 'erase') {
      d.b = toPlan(e); const ms = markerSize(level());
      $('#gOver').innerHTML = `<rect x="${Math.min(d.a.x, d.b.x)}" y="${Math.min(d.a.y, d.b.y)}" width="${Math.abs(d.b.x - d.a.x)}" height="${Math.abs(d.b.y - d.a.y)}" fill="#fff" fill-opacity="0.7" stroke="#dc2626" stroke-width="${ms * 0.1}" stroke-dasharray="${ms * 0.3} ${ms * 0.18}"/>`; return;
    }
    if (d.kind === 'zone') {
      d.b = toPlan(e); const l = level(); const ms = markerSize(l);
      const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
      $('#gOver').innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1d4fb8" fill-opacity="0.12" stroke="#1d4fb8" stroke-width="${ms * 0.1}" stroke-dasharray="${ms * 0.4} ${ms * 0.22}"/>`; return;
    }
    if (d.kind === 'pan') {
      const r = svg.getBoundingClientRect(); const k = S.vb[2] / r.width;
      S.vb[0] = d.vb[0] - (e.clientX - d.sx) * k; S.vb[1] = d.vb[1] - (e.clientY - d.sy) * k; applyVb(); return;
    }
    if (['ec', 'm1', 'm2', 'emove'].includes(d.kind)) {
      const l = level(), s0 = S.selEdit; if (!s0) return; const p = toPlan(e); const k = l.scale || 50;
      if (s0.k === 'eff') { const ef = l.effacements[s0.i];
        if (d.kind === 'ec') { ef.w = Math.round(Math.max(k * 0.1, p.x - ef.x)); ef.h = Math.round(Math.max(k * 0.1, p.y - ef.y)); }
        else { ef.x = Math.round(d.o.x + p.x - d.p0.x); ef.y = Math.round(d.o.y + p.y - d.p0.y); } }
      else { const w = l.murs[s0.i];
        if (d.kind === 'emove') { const dx = p.x - d.p0.x, dy = p.y - d.p0.y; w.x1 = Math.round(d.o.x1 + dx); w.y1 = Math.round(d.o.y1 + dy); w.x2 = Math.round(d.o.x2 + dx); w.y2 = Math.round(d.o.y2 + dy); }
        else { const n = d.kind === 'm1' ? '1' : '2', o = n === '1' ? '2' : '1'; let q = p; if (e.shiftKey) q = Math.abs(p.x - w['x' + o]) > Math.abs(p.y - w['y' + o]) ? { x: p.x, y: w['y' + o] } : { x: w['x' + o], y: p.y }; w['x' + n] = Math.round(q.x); w['y' + n] = Math.round(q.y); } }
      d.moved = true; setDirty(); renderEdits(); return;
    }
    const m = marker(); if (!m) return; const p = toPlan(e);
    if (['size', 'slen', 'swid'].includes(d.kind)) {
      const l = level(); const k = l.scale || markerSize(l) / 0.5; const a = (m.rot || 0) * Math.PI / 180, dx = p.x - m.x, dy = p.y - m.y;
      const along = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)), across = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      const r2 = (v) => Math.round(v * 100) / 100;
      if (d.kind === 'size') m.w = r2(Math.max(0.4, Math.min(8, 2 * along / k)));
      if (d.kind === 'slen') m.d = r2(Math.max(1, Math.min(12, 2 * along / k)));
      if (d.kind === 'swid') m.w = r2(Math.max(0.6, Math.min(6, 2 * across / k)));
      setDirty(); renderMarks(); const f = $('#aW'), f2 = $('#aD'); if (f) f.value = m.w; if (f2 && m.d) f2.value = m.d; return;
    }
    if (d.kind === 'move') { m.x = Math.round(p.x - d.dx); m.y = Math.round(p.y - d.dy); d.moved = true; setDirty(); renderMarks(); }
    if (d.kind === 'rot') { let a = Math.atan2(p.y - m.y, p.x - m.x) * 180 / Math.PI; if (e.shiftKey) a = Math.round(a / 15) * 15; m.rot = Math.round((a + 360) % 360); setDirty(); renderMarks(); syncRotField(); }
  });
  const end = () => {
    const d = S.drag;
    if (d && d.kind === 'erase') {
      S.drag = null; $('#gOver').innerHTML = ''; const l = level();
      const x = Math.max(0, Math.min(d.a.x, d.b.x)), y = Math.max(0, Math.min(d.a.y, d.b.y)), w = Math.min(l.plan.w, Math.max(d.a.x, d.b.x)) - x, h = Math.min(l.plan.h, Math.max(d.a.y, d.b.y)) - y;
      if (w < (l.scale || 50) * 0.1 || h < (l.scale || 50) * 0.1) return;
      (l.effacements = l.effacements || []).push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      S.selEdit = { k: 'eff', i: l.effacements.length - 1 }; S.selId = null; setDirty(); setTool('select'); renderMarks(); renderSide(); toast('Partie de mur effacée : ajustez le rectangle avec sa poignée, puis choisissez l\'élément suivant.'); return;
    }
    if (d && d.kind === 'zone') {
      S.drag = null; $('#gOver').innerHTML = ''; const l = level();
      const x = Math.max(0, Math.min(d.a.x, d.b.x)), y = Math.max(0, Math.min(d.a.y, d.b.y));
      const w = Math.min(l.plan.w, Math.max(d.a.x, d.b.x)) - x, h = Math.min(l.plan.h, Math.max(d.a.y, d.b.y)) - y;
      const min = l.scale ? l.scale * 1 : 20;
      if (w < min || h < min) { if (w > 2 || h > 2) toast('Zone trop petite (1 m minimum).', true); return; }
      (l.zones = l.zones || []).push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      S.selZone = l.zones.length - 1; setDirty(); renderZones(); banner(); renderSide(); return;
    }
    if (d && d.kind !== 'pan') renderSide(); S.drag = null; };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  wrap.addEventListener('wheel', (e) => {
    if (!level()) return; e.preventDefault();
    const p = toPlan(e); const k = Math.exp(e.deltaY * 0.0012); const vb = S.vb;
    const nw = Math.min(Math.max(vb[2] * k, 80), Math.max(level().plan.w, level().plan.h) * 6); const f = nw / vb[2];
    S.vb = [p.x - (p.x - vb[0]) * f, p.y - (p.y - vb[1]) * f, nw, vb[3] * f]; applyVb();
  }, { passive: false });
  window.addEventListener('resize', () => { if (level() && S.vb) { const W = wrap.clientWidth, H = wrap.clientHeight; S.vb[3] = S.vb[2] * H / W; applyVb(); } });
}
async function finishScale() {
  const l = level(); const { a, b } = S.calib; const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (px < 5) { toast('Les deux points sont trop proches.', true); S.calib = null; banner(); renderOverlay(); return; }
  const v = await askText('Échelle du plan', 'Distance réelle entre les deux points (en mètres)', '');
  const m = parseFloat(String(v || '').replace(',', '.'));
  if (!(m > 0)) { setTool('select'); return; }
  l.scale = px / m; setDirty(); setTool('select'); renderMarks(); renderSide();
  toast(`Échelle réglée : 1 m = ${Math.round(l.scale * 10) / 10} px`);
}
function syncRotField() { const m = marker(); const f = $('#pRot'), n = $('#pRotN'); if (m && f) { f.value = m.rot; n.value = m.rot; } }

/* ---------------------------------------------------------------- panneau de droite */
function renderSide() {
  const side = $('#side'); const l = level(); const m = marker();
  if (!S.project || !l) { side.innerHTML = ''; return; }
  if (!m && S.selEdit && ((S.selEdit.k === 'eff' && (l.effacements || [])[S.selEdit.i]) || (S.selEdit.k === 'mur' && (l.murs || [])[S.selEdit.i]))) {
    const k = l.scale || 50, s0 = S.selEdit, r2 = (v) => Math.round(v * 100) / 100;
    if (s0.k === 'eff') { const ef = l.effacements[s0.i];
      side.innerHTML = `<section><div class="sel-head"><span class="ic" style="border-color:#dc2626"><b style="color:#dc2626">✂</b></span><div><b>Mur effacé</b><small>Partie de mur retirée de la 3D</small></div></div>
        <div class="grid2"><label class="field"><span>Largeur (m)</span><input id="eW" type="number" min="0.1" step="0.05" value="${r2(ef.w / k)}"></label><label class="field"><span>Hauteur (m)</span><input id="eH" type="number" min="0.1" step="0.05" value="${r2(ef.h / k)}"></label></div>
        <div class="btnrow"><button id="eDel" class="danger">Supprimer (rétablir le mur)</button></div>
        <p class="muted" style="font-size:11.5px;margin:0">Glissez le rectangle pour le déplacer ; la poignée bleue en bas à droite change sa taille.</p></section>`;
      $('#eW').oninput = (ev) => { ef.w = Math.round(Math.max(0.1, +ev.target.value || 0.1) * k); setDirty(); renderEdits(); };
      $('#eH').oninput = (ev) => { ef.h = Math.round(Math.max(0.1, +ev.target.value || 0.1) * k); setDirty(); renderEdits(); };
    } else { const w = l.murs[s0.i]; const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / k, ang = ((Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI) + 360) % 180;
      side.innerHTML = `<section><div class="sel-head"><span class="ic" style="border-color:#334155"><b style="color:#334155">▬</b></span><div><b>Mur ajouté</b><small>Mur absent du plan, monté en 3D</small></div></div>
        <div class="grid2"><label class="field"><span>Longueur (m)</span><input id="wL" type="number" min="0.3" step="0.05" value="${r2(L)}"></label><label class="field"><span>Épaisseur (m)</span><input id="wE" type="number" min="0.05" max="1" step="0.01" value="${w.ep || 0.2}"></label></div>
        <label class="field"><span>Angle (°)</span><div class="rowin"><input id="wAr" type="range" min="0" max="179" value="${Math.round(ang)}"><input id="wA" type="number" min="0" max="179" value="${Math.round(ang)}"></div></label>
        <div class="btnrow"><button id="wDel" class="danger">Supprimer</button></div>
        <p class="muted" style="font-size:11.5px;margin:0">Glissez le mur pour le déplacer ; les poignées bleues déplacent ses extrémités (Maj = horizontal ou vertical).</p></section>`;
      const apply = (len, deg) => { const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2, h = len * k / 2, a = deg * Math.PI / 180; w.x1 = Math.round(cx - Math.cos(a) * h); w.y1 = Math.round(cy - Math.sin(a) * h); w.x2 = Math.round(cx + Math.cos(a) * h); w.y2 = Math.round(cy + Math.sin(a) * h); setDirty(); renderEdits(); };
      const cur = () => [Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / k, ((Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI) + 360) % 180];
      $('#wL').oninput = (ev) => apply(Math.max(0.3, +ev.target.value || 0.3), cur()[1]);
      $('#wA').oninput = (ev) => { $('#wAr').value = ev.target.value; apply(cur()[0], +ev.target.value || 0); };
      $('#wAr').oninput = (ev) => { $('#wA').value = ev.target.value; apply(cur()[0], +ev.target.value); };
      $('#wE').oninput = (ev) => { w.ep = Math.min(1, Math.max(0.05, +ev.target.value || 0.2)); setDirty(); renderEdits(); };
    }
    const del = $('#eDel') || $('#wDel'); del.onclick = removeEdit;
    return;
  }
  if (m && isArch(m)) {
    const t = typeOf(m.typeId); const esc2 = m.typeId === 'arch-escalier';
    side.innerHTML = `<section><div class="sel-head"><span class="ic" style="border-color:${t.couleur}"><b style="color:${t.couleur}">${t.code}</b></span><div><b>${esc(t.nom)}</b><small>${esc(t.type)}</small></div></div>
      <label class="field"><span>Repère</span><input id="pLbl" type="text" value="${esc(m.label)}"></label>
      <div class="grid2"><label class="field"><span>${esc2 ? 'Largeur de passage (m)' : 'Largeur (m)'}</span><input id="aW" type="number" min="0.5" max="8" step="0.05" value="${m.w || t.w}"></label>
      ${esc2 ? `<label class="field"><span>Longueur (m)</span><input id="aD" type="number" min="1" max="12" step="0.1" value="${m.d || t.d}"></label>` : ''}
      ${m.typeId === 'arch-fenetre' ? `<label class="field"><span>Hauteur d'allège (m)</span><input id="aAl" type="number" min="0" max="2" step="0.05" value="${m.allege ?? 0.9}"></label>` : ''}</div>
      <label class="field"><span>Orientation (°) — ${esc2 ? 'sens de la montée' : 'le long du mur'}</span><div class="rowin"><input id="pRot" type="range" min="0" max="359" value="${m.rot || 0}"><input id="pRotN" type="number" min="0" max="359" value="${m.rot || 0}"></div></label>
      ${isDoor(m) ? `<div class="btnrow">${m.typeId !== 'arch-double' ? `<button id="aFlip">⇆ Gonds de l'autre côté</button>` : ''}<button id="aSens">⇅ Ouvrir de l'autre côté</button></div>` : ''}
      <div class="btnrow"><button id="aAlign">📐 Aligner sur le mur</button><button id="pR90">↻ 90°</button><button id="pDup">Dupliquer</button><button id="pDel" class="danger">Supprimer</button></div>
      <p class="muted" style="font-size:11.5px;margin:0">${isDoor(m) ? 'Placez la porte dans l\'ouverture du mur : dans la simulation, elle s\'ouvre quand quelqu\'un s\'en approche.' : m.typeId === 'arch-fenetre' ? 'Le mur est remplacé par une allège, un vitrage et un linteau.' : 'La flèche rouge indique le sens de la montée.'}</p></section>`;
    const upd = (fn) => (e) => { fn(e.target.value); setDirty(); renderMarks(); };
    $('#pLbl').oninput = upd(v => (m.label = v));
    $('#aW').oninput = upd(v => (m.w = Math.max(0.5, +v || t.w)));
    if ($('#aD')) $('#aD').oninput = upd(v => (m.d = Math.max(1, +v || t.d)));
    if ($('#aAl')) $('#aAl').oninput = upd(v => (m.allege = Math.max(0, Math.min(2, +v))));
    $('#pRot').oninput = upd(v => { m.rot = +v; $('#pRotN').value = v; }); $('#pRotN').oninput = upd(v => { m.rot = ((+v % 360) + 360) % 360; $('#pRot').value = m.rot; });
    if ($('#aFlip')) $('#aFlip').onclick = () => { m.flip = !m.flip; setDirty(); renderMarks(); };
    if ($('#aSens')) $('#aSens').onclick = () => { m.sens = m.sens === -1 ? 1 : -1; setDirty(); renderMarks(); };
    $('#aAlign').onclick = async () => { const a = await wallAngleAt(l, m.x, m.y); if (a === null) { toast('Aucun mur trouvé à proximité.', true); return; } m.rot = esc2 ? (a + 90) % 360 : a; setDirty(); renderMarks(); syncRotField(); };
    $('#pR90').onclick = () => { m.rot = ((m.rot || 0) + 90) % 360; setDirty(); renderMarks(); syncRotField(); };
    $('#pDup').onclick = duplicate; $('#pDel').onclick = removeSel;
    return;
  }
  if (m) {
    const t = typeOf(m.typeId); const k = zoneKind(m); const hasZ = !!(t.detRange || m.range);
    const isSiren = /siren|sirene/.test(t.id);
    side.innerHTML = `<section><div class="sel-head"><span class="ic" style="border-color:${esc(t.couleur)}">${t.img ? `<img src="${t.img}" alt="">` : esc(t.code)}</span><div><b>${esc(t.nom)}</b><small>${esc(t.type || t.sys || '')}</small></div></div>
      ${ROLE_TIP[t.id] ? `<p class="tip">${esc(ROLE_TIP[t.id])}</p>` : ''}
      <label class="field"><span>Repère</span><input id="pLbl" type="text" value="${esc(m.label)}"></label>
      <label class="field"><span>Local</span><input id="pLoc" type="text" value="${esc(m.local || '')}" placeholder="ex. Salle de classe 3"></label>
      <label class="field"><span>Orientation (°) — ${t.id === 'lock' ? 'vers l\'intérieur de la salle' : 'direction de la flèche'}</span><div class="rowin"><input id="pRot" type="range" min="0" max="359" value="${m.rot || 0}"><input id="pRotN" type="number" min="0" max="359" value="${m.rot || 0}"></div></label>
      ${hasZ ? `<div class="grid2"><label class="field"><span>Portée (m)</span><input id="pRange" type="number" min="0" step="0.5" value="${rangeOf(m)}"></label>
        ${k === 'secteur' ? `<label class="field"><span>Angle (°)</span><input id="pAng" type="number" min="10" max="360" step="0.5" value="${m.angle ?? t.detAngle ?? 90}"></label>` : ''}</div>` : ''}
      ${isSiren ? `<label class="field"><span>Signal à l'alarme</span><select id="pSig"><option value="les2" ${(m.signal || 'les2') === 'les2' ? 'selected' : ''}>Alarme sonore et flashs lumineux</option><option value="son" ${m.signal === 'son' ? 'selected' : ''}>Alarme sonore seulement</option><option value="flash" ${m.signal === 'flash' ? 'selected' : ''}>Flashs lumineux seulement (alarme silencieuse)</option></select></label>` : ''}
      <div class="btnrow"><button id="pR90">↻ 90°</button><button id="pDup">Dupliquer</button><button id="pDel" class="danger">Supprimer</button></div>
      <p class="muted" style="font-size:11.5px;margin:0">Raccourcis : glisser = déplacer, poignée bleue = orienter (Maj = pas de 15°), R = pivoter, Suppr = supprimer, Ctrl+D = dupliquer.</p></section>${specMarkup(t, m)}`;
    const upd = (fn) => (e) => { fn(e.target.value); setDirty(); renderMarks(); };
    $('#pLbl').oninput = upd(v => (m.label = v)); $('#pLoc').oninput = upd(v => (m.local = v));
    $('#pRot').oninput = upd(v => { m.rot = +v; $('#pRotN').value = v; }); $('#pRotN').oninput = upd(v => { m.rot = ((+v % 360) + 360) % 360; $('#pRot').value = m.rot; });
    if ($('#pRange')) $('#pRange').oninput = upd(v => (m.range = Math.max(0, +v)));
    if ($('#pAng')) $('#pAng').oninput = upd(v => (m.angle = Math.min(360, Math.max(10, +v))));
    if ($('#pSig')) $('#pSig').onchange = (e) => { m.signal = e.target.value; if (m.signal === 'les2') delete m.signal; setDirty(); };
    $('#pR90').onclick = () => { m.rot = ((m.rot || 0) + 90) % 360; setDirty(); renderMarks(); syncRotField(); };
    $('#pDup').onclick = duplicate; $('#pDel').onclick = removeSel;
    return;
  }
  const cnt = {}; l.markers.filter(x => !isArch(x)).forEach(x => (cnt[x.typeId] = (cnt[x.typeId] || 0) + 1));
  const nArch = (id) => l.markers.filter(x => x.typeId === id).length;
  const has = (id) => l.markers.some(x => x.typeId === id);
  const det = l.markers.some(x => typeOf(x.typeId).detRange || ['door', 'doorplus'].includes(x.typeId));
  const step = (ok, txt) => `<li class="${ok ? 'ok' : ''}">${ok ? '✔' : '○'} ${txt}</li>`;
  side.innerHTML = `<section><h2>Niveau</h2>
      <label class="field"><span>Nom du niveau</span><input id="lvName" type="text" value="${esc(l.name)}"></label>
      <p class="muted" style="margin:0">${l.scale ? `Échelle : 1 m = ${Math.round(l.scale * 10) / 10} px · plan de ${Math.round(l.plan.w / l.scale)} × ${Math.round(l.plan.h / l.scale)} m` : '<b class="warnt">Échelle non réglée</b>'}</p>
      <div class="btnrow"><button id="lvScale">📏 ${l.scale ? 'Refaire l\'échelle' : 'Régler l\'échelle'}</button><button id="lvDel" class="danger ghost">Supprimer le niveau</button></div></section>
    <section><h2>Préparer la simulation</h2><ul class="steps">
      ${step(true, 'Plan importé')}
      ${step(!!l.scale, 'Échelle réglée (deux clics sur une cote connue)')}
      ${step(det, 'Au moins un détecteur ou un contact de porte')}
      ${step(has('hub') || has('siren'), 'Centrale et/ou sirène (clignotent à l\'alarme)')}
      ${step(has('lock'), 'lockOFF sur la porte d\'une salle (scénario de confinement)')}
      ${step(has('otus'), 'blackOTUS dans cette salle (photos de la salle)')}</ul>
      <button id="lvSim" class="primary wide" ${l.scale && l.kind !== 'photo' ? '' : 'disabled'}>🎬 Lancer la simulation 3D</button></section>
    <section><h2>Zones 3D</h2><p class="muted" style="margin:0 0 6px">${(l.zones || []).length ? `${l.zones.length} zone(s) sélectionnée(s) : seuls les murs, portes, fenêtres et escaliers qu'elles contiennent apparaissent en 3D.` : 'Tout le plan est monté en 3D. Utilisez « Sélectionner » pour n\'en garder qu\'une ou plusieurs parties.'}</p>
      <div class="btnrow"><button id="lvZone">▭ Sélectionner${(l.zones || []).length ? ' (modifier)' : ''}</button>${(l.zones || []).length ? '<button id="lvZoneClr" class="ghost">Tout le plan</button>' : ''}</div></section>
    <section><h2>Intégrer</h2><p class="muted" style="margin:0 0 6px">${DOOR_IDS.reduce((n, id) => n + nArch(id), 0)} porte(s) · ${nArch('arch-fenetre')} fenêtre(s) · ${nArch('arch-escalier')} escalier(s) · ${(l.effacements || []).length} mur(s) effacé(s) · ${(l.murs || []).length} mur(s) ajouté(s)</p>
      <div class="btnrow"><button id="lvInt">➕ Intégrer…</button></div></section>
    <section><h2>Matériels posés (${l.markers.filter(x => !isArch(x)).length})</h2>
      ${l.markers.length ? `<div class="cnt">${Object.entries(cnt).map(([id, n]) => `<div><span class="dot" style="background:${esc(typeOf(id).couleur)}"></span>${esc(typeOf(id).nom)}<b>${n}</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">Aucun matériel. Choisissez-les dans la colonne de gauche.</p>'}
      <label class="field"><span>Taille des pictogrammes</span><input id="mkScale" type="range" min="0.5" max="2" step="0.1" value="${S.project.markerScale || 1}"></label></section>`;
  $('#lvName').oninput = (e) => { l.name = e.target.value; setDirty(); $('#lvSel').selectedOptions[0].textContent = l.name; };
  $('#lvScale').onclick = () => setTool('scale');
  $('#lvZone').onclick = () => setTool('zone');
  $('#lvInt').onclick = () => showIntegrer();
  if ($('#lvZoneClr')) $('#lvZoneClr').onclick = () => { l.zones = []; S.selZone = null; setDirty(); renderZones(); banner(); renderSide(); };
  $('#lvDel').onclick = async () => {
    if (!await confirmBox('Supprimer le niveau', `Supprimer le niveau « ${l.name} » et ses ${l.markers.length} matériel(s) ?`, 'Supprimer', true)) return;
    S.project.levels = S.project.levels.filter(x => x !== l); S.levelId = S.project.levels[0] ? S.project.levels[0].id : null; S.selId = null; setDirty(); renderAll();
  };
  $('#lvSim').onclick = () => openSim();
  $('#mkScale').oninput = (e) => { S.project.markerScale = +e.target.value; setDirty(); renderMarks(); };
}
function duplicate() {
  const m = marker(); if (!m) return; const l = level(); const ms = markerSize(l);
  const c = { ...m, id: uid(), x: m.x + ms * 1.5, y: m.y + ms * 1.5, label: nextLabel(m.typeId) }; l.markers.push(c); S.selId = c.id; setDirty(); renderMarks(); renderSide();
}
function removeSel() {
  const l = level(); const m = marker(); if (!m) return; l.markers = l.markers.filter(x => x !== m); S.selId = null; setDirty(); renderMarks(); renderSide();
}

/* ---------------------------------------------------------------- fichiers */
async function guardUnsaved() {
  if (!S.dirty || !S.project) return true;
  const r = await modal({
    title: 'Modifications non enregistrées', body: `<p style="margin:0">Enregistrer la scène « ${esc(S.project.name)} » ?</p>`,
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ne pas enregistrer', value: 'discard' }, { label: 'Enregistrer', cls: 'primary', value: 'save' }]
  });
  if (r === 'save') return await saveScene();
  return r === 'discard';
}
function scenePayload() {
  const p = S.project; const used = new Set(p.levels.flatMap(l => l.markers.map(m => m.typeId)));
  const typeCache = {}; used.forEach(id => { if (!ARCH[id]) typeCache[id] = typeOf(id); });
  return JSON.stringify({ app: 'blackeyes-sim3d', format: 1, name: p.name, site: p.site || '', date: p.date || today(), markerScale: p.markerScale || 1,
    levels: p.levels.map(l => ({ id: l.id, name: l.name, kind: l.kind || 'plan', plan: l.plan, scale: l.scale || null, markers: l.markers, ...(l.zones && l.zones.length ? { zones: l.zones } : {}), ...(l.effacements && l.effacements.length ? { effacements: l.effacements } : {}), ...(l.murs && l.murs.length ? { murs: l.murs } : {}) })), typeCache, savedAt: new Date().toISOString() });
}
async function saveScene(saveAs = false) {
  if (!S.project) return false; const data = strToBytes(scenePayload());
  try {
    let p = S.project.path;
    if (!p || saveAs) { p = await window.native.saveFile({ title: 'Enregistrer la scène', defaultPath: `${S.project.name || 'scene'}.bk3d`, filters: [{ name: 'Scène Simulation 3D', extensions: ['bk3d'] }], data }); if (!p) return false; S.project.path = p; }
    else await window.native.writeFile(p, data);
    setDirty(false); toast('Scène enregistrée'); return true;
  } catch (e) { toast('Enregistrement impossible : ' + e.message, true); return false; }
}
function loadScene(bytes, name, filePath) {
  const u8 = new Uint8Array(bytes);
  if (new TextDecoder('latin1').decode(u8.slice(0, 10)) === 'BKCHIFFRE1') throw new Error('ce projet Blackeyes est chiffré. Ouvrez-le dans Blackeyes Implantation puis cliquez sur « 🎬 3D » : la scène .bk3d exportée s\'ouvre ici.');
  let d; try { d = JSON.parse(new TextDecoder().decode(u8)); } catch { throw new Error('fichier illisible (scène .bk3d attendue).'); }
  if (!d || !Array.isArray(d.levels)) throw new Error('ce fichier ne contient pas de plan.');
  const levels = d.levels.filter(l => l && l.plan && l.plan.dataUrl).map(l => ({ id: l.id || uid(), name: l.name || 'Niveau', kind: l.kind || 'plan', plan: { w: l.plan.w, h: l.plan.h, dataUrl: l.plan.dataUrl }, scale: l.scale || null,
    zones: (Array.isArray(l.zones) ? l.zones : []).filter(z => z && +z.w > 0 && +z.h > 0).map(z => ({ x: +z.x, y: +z.y, w: +z.w, h: +z.h })),
    effacements: (Array.isArray(l.effacements) ? l.effacements : []).filter(z => z && +z.w > 0 && +z.h > 0).map(z => ({ x: +z.x, y: +z.y, w: +z.w, h: +z.h })),
    murs: (Array.isArray(l.murs) ? l.murs : []).filter(w => w && isFinite(w.x1) && isFinite(w.y2)).map(w => ({ x1: +w.x1, y1: +w.y1, x2: +w.x2, y2: +w.y2, ep: Math.min(1, Math.max(0.05, +w.ep || 0.2)) })),
    markers: (l.markers || []).map(m => ({ id: m.id || uid(), typeId: m.typeId, x: +m.x, y: +m.y, rot: +m.rot || 0, label: m.label || '', local: m.local || '', ...(m.range != null ? { range: m.range } : {}), ...(m.angle != null ? { angle: m.angle } : {}),
      ...(['son', 'flash'].includes(m.signal) ? { signal: m.signal } : {}), ...(+m.w > 0 ? { w: +m.w } : {}), ...(+m.d > 0 ? { d: +m.d } : {}), ...(m.allege != null ? { allege: +m.allege } : {}), ...(m.flip ? { flip: true } : {}), ...(m.sens === -1 ? { sens: -1 } : {}) })) }));
  if (!levels.length) throw new Error('aucun plan dans ce fichier.');
  S.project = { ...newProject(), name: d.name || name.replace(/\.[^.]+$/, ''), site: d.site || '', date: d.date || today(), markerScale: d.markerScale || 1, levels, typeCache: d.typeCache || {}, path: /\.bk3d$/i.test(filePath || '') ? filePath : null };
  const best = levels.find(l => l.kind !== 'photo' && l.scale && l.markers.length) || levels.find(l => l.kind !== 'photo') || levels[0];
  S.levelId = best.id; S.selId = null; S.vb = null; setTool('select'); setDirty(false); renderAll();
  toast(`Scène « ${S.project.name} » ouverte : ${levels.length} niveau(x).`);
}
async function openScene() {
  if (!await guardUnsaved()) return;
  const f = await window.native.openFile({ title: 'Ouvrir une scène', filters: [{ name: 'Scène Simulation 3D (.bk3d)', extensions: ['bk3d', 'json', 'bkimp'] }] });
  if (!f) return; try { loadScene(f.data, f.name, f.path); } catch (e) { toast('Ouverture impossible : ' + e.message, true); }
}
async function newScene() {
  if (!await guardUnsaved()) return;
  const keep = S.project; S.project = newProject(); S.levelId = null; S.selId = null;
  const ok = await importPlan();
  if (!ok) { S.project = keep; if (keep) S.levelId = keep.levels[0] && keep.levels[0].id; renderAll(); return; }
  setDirty(false); renderAll();
}
async function importPlan(file = null) {
  const f = file || await window.native.openFile({ title: 'Importer un plan', filters: [{ name: 'Plans (PDF, PNG, JPG)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }] });
  if (!f) return false;
  try {
    const ext = f.name.split('.').pop().toLowerCase(); let plan;
    if (ext === 'pdf') plan = await pdfToPlan(f.data); else plan = await imageToPlan(f.data, ext);
    if (!plan) return false;
    const base = f.name.replace(/\.[^.]+$/, '');
    const nm = await askText('Nom du niveau', 'Nom du niveau (ex. RDC, R+1)', S.project.levels.length ? `Niveau ${S.project.levels.length + 1}` : 'RDC');
    if (nm === null) return false;
    if (!S.project.levels.length && S.project.name === 'Nouvelle scène') S.project.name = base;
    const l = { id: uid(), name: nm || 'Niveau', kind: 'plan', plan, scale: null, markers: [] };
    S.project.levels.push(l); S.levelId = l.id; S.selId = null; S.vb = null; setDirty(); renderAll();
    setTool('scale'); toast('Plan importé. Réglez maintenant l\'échelle : cliquez sur les deux extrémités d\'une cote connue.');
    return true;
  } catch (e) { toast('Import impossible : ' + e.message, true); return false; }
}
async function imageToPlan(bytes, ext) {
  const url = await bytesToDataUrl(bytes, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  const img = await loadImg(url); const k = Math.min(1, MAX_PLAN / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { w: c.width, h: c.height, dataUrl: c.toDataURL('image/jpeg', 0.9) };
}
async function pdfToPlan(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise; let n = 1;
  if (pdf.numPages > 1) {
    const r = await modal({ title: 'Choisir la page du plan', body: `<label class="field"><span>Ce PDF contient ${pdf.numPages} pages. Page à utiliser :</span><select id="mPg">${Array.from({ length: pdf.numPages }, (_, i) => `<option value="${i + 1}">Page ${i + 1}</option>`).join('')}</select></label>`,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Importer', cls: 'primary', action: (root) => +$('#mPg', root).value }] });
    if (!r) return null; n = r;
  }
  const page = await pdf.getPage(n); const v1 = page.getViewport({ scale: 1 }); const k = PDF_RENDER / Math.max(v1.width, v1.height);
  const vp = page.getViewport({ scale: k }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return { w: c.width, h: c.height, dataUrl: c.toDataURL('image/jpeg', 0.9) };
}
async function openAnyFile(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) { if (!S.project) S.project = newProject(); await importPlan(f); return; }
  if (!await guardUnsaved()) return;
  try { loadScene(f.data, f.name, f.path); } catch (e) { toast('Ouverture impossible : ' + e.message, true); }
}

/* ---------------------------------------------------------------- rapport de simulation (photos + journal) */
async function exportSimReport() {
  if (!SIM.photos || (!SIM.photos.length && !SIM.log.length)) { toast('Lancez d\'abord une simulation.', true); return; }
  const zip = new JSZip(); const l = level();
  const head = `RAPPORT DE SIMULATION 3D — BLACKEYES\nScène : ${S.project.name}${S.project.site ? ` (${S.project.site})` : ''}\nNiveau : ${l.name}\nScénario : ${SIM_SCEN[SIM.scen].nom}\nÉdité le ${new Date().toLocaleString('fr-FR')}\n\nJOURNAL DES ÉVÉNEMENTS\n`;
  zip.file('journal.txt', '﻿' + head + [...SIM.log].reverse().map(e => `${e.t}  ${e.txt}`).join('\r\n') + `\r\n\r\nPHOTOS (${SIM.photos.length})\r\n` + [...SIM.photos].reverse().map((p, i) => `${String(i + 1).padStart(2, '0')}  ${p.t}  ${p.src} ${p.label}`).join('\r\n'));
  [...SIM.photos].reverse().forEach((p, i) => zip.file(`photos/${String(i + 1).padStart(2, '0')} - ${p.label.replace(/[\\/:*?"<>|·]+/g, '-')}.jpg`, p.url.split(',')[1], { base64: true }));
  try { if (SIM.renderer) zip.file('vue-3d.jpg', SIM.renderer.domElement.toDataURL('image/jpeg', 0.9).split(',')[1], { base64: true }); } catch {}
  const data = await zip.generateAsync({ type: 'uint8array' });
  try { const p = await window.native.saveFile({ title: 'Exporter le rapport de simulation', defaultPath: `Simulation 3D - ${S.project.name} - ${l.name}.zip`, filters: [{ name: 'Archive ZIP', extensions: ['zip'] }], data }); if (p) toast('Rapport exporté (photos + journal).'); }
  catch (e) { toast('Export impossible : ' + e.message, true); }
}

function help() {
  modal({ title: 'Blackeyes Simulation 3D — mode d\'emploi', size: 'md', body: `<ol class="help">
    <li><b>Ouvrir une scène</b> exportée de Blackeyes Implantation (bouton « 🎬 3D » dans Blackeyes), ou <b>Nouveau</b> pour partir d'un plan PDF, PNG ou JPG.</li>
    <li><b>Échelle</b> (touche E) : cliquez sur les deux extrémités d'une cote connue et saisissez la distance en mètres. La maquette 3D est construite en mètres.</li>
    <li><b>Poser le matériel</b> : choisissez-le à gauche puis cliquez sur le plan. Glissez pour déplacer ; la poignée bleue oriente l'appareil. Le <b>lockOFF</b> se place sur la porte, flèche vers l'intérieur de la salle ; le <b>blackOTUS</b> dans cette salle.</li>
    <li><b>Lancer la simulation 3D</b> : choisissez le scénario, le point de départ de l'individu (clic sur le sol) et d'éventuels points de passage, puis « Lancer ».</li>
    <li>Pendant la simulation : photos de levée de doute à chaque détection, centrale et sirène qui clignotent, confinement de la salle, tirage de la languette du blackOTUS, tentative d'effraction sur le lockOFF. « Exporter le rapport » enregistre les photos et le journal (ZIP).</li></ol>
    <p class="muted" style="margin:0">Raccourcis : Ctrl+O ouvrir · Ctrl+S enregistrer · E échelle · F ajuster le plan · R pivoter · Suppr supprimer · Ctrl+D dupliquer · Échap terminer.</p>
    <p class="muted" style="margin:0">Les murs sont déduits des traits sombres du plan ; l'individu se déplace en ligne droite entre les points. Outil de démonstration et de sensibilisation.</p>
    <p style="margin:0;text-align:center;font-weight:600">Programme créé par Xavier GIROUARD</p>`, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

/* ---------------------------------------------------------------- démarrage */
function bindUi() {
  $('#bNew').onclick = newScene; $('#hNew').onclick = newScene;
  $('#bOpen').onclick = openScene; $('#hOpen').onclick = openScene;
  $('#bSave').onclick = () => saveScene(false);
  $('#bAddLv').onclick = () => { if (S.project) importPlan(); };
  $('#bScale').onclick = () => { if (level()) setTool(S.tool === 'scale' ? 'select' : 'scale'); };
  $('#bZone').onclick = () => { if (level()) setTool(S.tool === 'zone' ? 'select' : 'zone'); };
  $('#bInt').onclick = () => showIntegrer();
  $('#bSim').onclick = () => openSim();
  $('#bHelp').onclick = help;
  $('#projName').oninput = (e) => { if (S.project) { S.project.name = e.target.value; setDirty(); } };
  $('#lvSel').onchange = (e) => { S.levelId = e.target.value; S.selId = null; S.vb = null; setTool('select'); renderStage(true); renderSide(); banner(); };
  document.addEventListener('keydown', (e) => {
    if ($('#modalRoot').children.length) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveScene(e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openScene(); return; }
    if (!$('#simView').hidden || typing || !level()) return;
    const m = marker();
    if (e.key === 'Escape') setTool('select');
    else if (e.key.toLowerCase() === 'e' && !(e.ctrlKey || e.metaKey)) setTool('scale');
    else if (e.key.toLowerCase() === 's' && !(e.ctrlKey || e.metaKey)) setTool(S.tool === 'zone' ? 'select' : 'zone');
    else if (S.selZone != null && (e.key === 'Delete' || e.key === 'Backspace')) removeZone(S.selZone);
    else if (S.selEdit && (e.key === 'Delete' || e.key === 'Backspace')) removeEdit();
    else if (e.key.toLowerCase() === 'f') fit();
    else if (m && (e.key === 'Delete' || e.key === 'Backspace')) removeSel();
    else if (m && e.key.toLowerCase() === 'r' && !(e.ctrlKey || e.metaKey)) { m.rot = ((m.rot || 0) + (e.shiftKey ? -15 : 15) + 360) % 360; setDirty(); renderMarks(); syncRotField(); }
    else if (m && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (m && e.key.startsWith('Arrow')) { e.preventDefault(); const s = e.shiftKey ? 10 : 2; if (e.key === 'ArrowLeft') m.x -= s; if (e.key === 'ArrowRight') m.x += s; if (e.key === 'ArrowUp') m.y -= s; if (e.key === 'ArrowDown') m.y += s; setDirty(); renderMarks(); }
  });
  // glisser-déposer d'un fichier sur la fenêtre
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); const file = e.dataTransfer.files[0]; if (!file) return;
    const p = window.native.pathOf(file); if (!p) return;
    try { await openAnyFile(await window.native.readFile(p)); } catch (err) { toast(err.message, true); }
  });
  window.native.onBeforeClose(async () => { if (await guardUnsaved()) window.native.confirmClose(); });
  bindStage();
}
(async function start() {
  bindUi(); setTool('select'); renderAll();
  try {
    const info = await window.native.info(); document.title = `Blackeyes Simulation 3D ${info.version}`;
    $('#credit').innerHTML = `Programme créé par Xavier GIROUARD<small>Version ${esc(info.version)}</small>`;
    if (info.argv && info.argv[0]) await openAnyFile(await window.native.readFile(info.argv[0]));
  } catch (e) { toast(e.message, true); }
})();
