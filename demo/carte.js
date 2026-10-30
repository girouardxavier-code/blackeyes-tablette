/* Blackeyes Implantation — fenêtre Carte : plan de la commune et bâtiments couverts */
'use strict';

const STAT = {
  equipe:    { label: 'Équipé', color: '#1f7a45', desc: 'Système Blackeyes installé' },
  en_cours:  { label: 'Implantation établie', color: '#1d4fb8', desc: 'Plan d\'implantation réalisé, installation à venir' },
  a_equiper: { label: 'À équiper', color: '#c2410c', desc: 'Programmé, implantation à réaliser' },
  autre:     { label: 'Hors programme', color: '#64748b', desc: 'Bâtiment suivi, non programmé' }
};
const BTYPES = ['École', 'Crèche', 'Enfance / loisirs', 'Jeunesse', 'Gymnase', 'Culture', 'Santé', 'Administratif', 'Autre'];
const C = { map: null, base: {}, cur: 'plan', markers: new Map(), data: null, geocache: {}, filter: new Set(Object.keys(STAT)), q: '', sel: null, view: 'list', contour: null, placing: null, locating: false, offline: false };
const NC = () => window.native.carte;
const canBat = () => can('batiments');
const geoKey = (b) => `${C.data.commune.code}|${(b.adresse || '').trim().toLowerCase()}`;
function posOf(b) {
  if (Number.isFinite(b.lat) && Number.isFinite(b.lon)) return { lat: b.lat, lon: b.lon, src: 'manuel' };
  const g = b.adresse && C.geocache[geoKey(b)]; return g ? { lat: g.lat, lon: g.lon, src: 'auto', label: g.label } : null;
}

/* plusieurs clients : chaque « territoire » = un client, sa commune et ses bâtiments */
async function loadBatiments(force = false) {
  if (C.store && !force) return C.data;
  const r = await NC().load(); C.store = r.territoires || []; C.geocache = r.geocache || {};
  if (!C.tId || !C.store.some(t => t.id === C.tId)) C.tId = r.actif || (C.store[0] || {}).id || null;
  C.data = C.store.find(t => t.id === C.tId) || null;
  return C.data;
}
function batFind(id) { for (const t of (C.store || [])) { const b = (t.batiments || []).find(x => x.id === id); if (b) return { t, b }; } return null; }
const clientNames = () => [...new Set((C.store || []).map(t => t.nom).filter(Boolean))];
const terrLabel = (t) => t ? `${t.nom}${t.commune && t.commune.nom && t.commune.nom !== t.nom ? ' · ' + t.commune.nom : ''}` : '';
function renderTerrBar() {
  const sel = $('#cTerr'); if (!sel) return;
  sel.innerHTML = (C.store || []).slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(t => `<option value="${esc(t.id)}" ${t.id === C.tId ? 'selected' : ''}>${esc(terrLabel(t))} (${t.batiments.length})</option>`).join('');
  $('#cTerrNew').hidden = !canBat(); $('#cTerrDel').hidden = !canBat() || !C.data;
  $('#cTitle').textContent = C.data ? `Carte — ${terrLabel(C.data)}` : 'Carte';
}
async function showTerritoire(id) {
  C.tId = id; C.data = C.store.find(t => t.id === id) || null; C.sel = null; C.view = 'list'; C.q = '';
  try { await NC().territoire('actif', id); } catch {}
  renderTerrBar(); await pdsRefreshList(); await bkRefreshList(); if (!C.data) return;
  await drawContour(); renderPins(); renderCarteSide(); autoLocate();
}
async function pickCommune(initial = '') {
  let found = [];
  return modal({
    title: 'Commune', size: 'md',
    body: `<label class="field"><span>Nom de la commune</span><div class="pwrow"><input id="cmQ" type="text" value="${esc(initial)}"><button type="button" id="cmGo">Rechercher</button></div></label><div id="cmRes" class="sug"></div>
      <p class="muted" style="margin:0;font-size:12px">La recherche nécessite une connexion Internet (limite communale et localisation des adresses). Sans connexion, « Garder ce nom » enregistre la commune sans contour.</p>`,
    onMount: (root, close) => {
      const go = async () => {
        const box = $('#cmRes', root); box.innerHTML = '<span class="muted">Recherche…</span>';
        try { found = await NC().communeSearch($('#cmQ', root).value); box.innerHTML = found.map((c, i) => `<button type="button" data-i="${i}">${esc(c.nom)} <small>${esc(c.cp)} · INSEE ${esc(c.code)}</small></button>`).join('') || '<span class="muted">Aucune commune trouvée.</span>';
          box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => close(found[+b.dataset.i])); }
        catch (e) { box.innerHTML = `<span class="warnbox">${esc(e.message)}</span>`; }
      };
      $('#cmGo', root).onclick = go; $('#cmQ', root).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } };
    },
    buttons: [{ label: 'Annuler', value: null }, { label: 'Garder ce nom', action: (root) => { const n = $('#cmQ', root).value.trim(); if (!n) return false; return { code: '', nom: n, centre: null }; } }]
  });
}
async function newTerritoire() {
  if (!canBat()) return null;
  const nom = await modal({ title: 'Nouveau client sur la carte', body: `<p style="margin:0">Un client (mairie, bailleur, entreprise, particulier…) avec sa commune et ses bâtiments. Les projets peuvent ensuite être rattachés à ses bâtiments.</p>
      <label class="field"><span>Nom du client</span><input id="tNom" type="text" placeholder="ex. Mairie de Clamart, Résidence Les Tilleuls…"></label>`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Choisir la commune…', cls: 'primary', action: (root) => { const v = $('#tNom', root).value.trim(); if (!v) { toast('Indiquez le nom du client.', true); return false; } return v; } }] });
  if (!nom) return null;
  const pick = await pickCommune(''); if (!pick) return null;
  try {
    const t = await NC().territoire('creer', { nom, commune: { code: pick.code || '', nom: pick.nom, centre: pick.centre || null } });
    C.store.push(t); toast(`Client « ${nom} » ajouté à la carte`); return t;
  } catch (e) { toast(e.message, true); return null; }
}
async function deleteTerritoire() {
  if (!C.data || !canBat()) return;
  const t = C.data;
  if (!await confirmBox('Supprimer ce client', `Retirer « ${t.nom} » et ses ${t.batiments.length} bâtiment(s) de la carte ? Les projets enregistrés ne sont pas supprimés.`, 'Supprimer', true)) return;
  try { await NC().territoire('supprimer', t.id); C.store = C.store.filter(x => x.id !== t.id); toast(`« ${t.nom} » retiré de la carte`);
    if (C.store.length) await showTerritoire(C.store[0].id); else { C.tId = null; C.data = null; closeCarte(); } }
  catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- ouverture */
async function openCarte() {
  if (!S.user) return;
  $('#carteView').hidden = false;
  C.sel = null; C.view = 'list';
  try { await loadBatiments(true); } catch (e) { toast('Bâtiments illisibles : ' + e.message, true); $('#carteView').hidden = true; return; }
  if (!C.data) {
    if (!canBat()) { toast('Aucun client sur la carte : demandez à l\'administrateur d\'en ajouter.', true); $('#carteView').hidden = true; return; }
    const t = await newTerritoire(); if (!t) { $('#carteView').hidden = true; return; }
    C.tId = t.id; C.data = t;
  }
  renderTerrBar(); await pdsRefreshList(); await bkRefreshList();
  $('#cPrefetch').hidden = !canBat();
  $('#cLegend').innerHTML = Object.values(STAT).map(v => `<span><i style="background:${v.color}"></i>${v.label}</span>`).join('') + '<span><i class="line"></i>Limite communale</span><span><i style="background:#0e7490"></i>Caméra vidéoprotection</span><span><i style="background:#7c3aed"></i>Caméra vidéosurveillance</span>';
  if (!C.map) initMap(); else C.map.invalidateSize();
  await drawContour();
  renderPins(); renderCarteSide();
  autoLocate();
}
function closeCarte() { $('#carteView').hidden = true; stopPlacing(); }

function initMap() {
  const c = C.data.commune.centre || [46.6, 2.4];
  C.map = L.map('map', { zoomControl: true, attributionControl: true, minZoom: 10, maxZoom: 20 }).setView(c, 14);
  const tu = (l) => (window.native.tileUrl ? window.native.tileUrl(l) : `tuile://${l}/{z}/{x}/{y}`);
  C.base.plan = L.tileLayer(tu('plan'), { maxZoom: 20, maxNativeZoom: 19, attribution: '© IGN – Géoplateforme · Plan IGN' });
  C.base.photo = L.tileLayer(tu('photo'), { maxZoom: 20, maxNativeZoom: 19, attribution: '© IGN – Géoplateforme · Photographies aériennes' });
  C.base.plan.addTo(C.map);
  let errs = 0; const onErr = () => { if (++errs === 6) { C.offline = true; renderCarteSide(); } };
  C.base.plan.on('tileerror', onErr); C.base.photo.on('tileerror', onErr);
  L.control.scale({ imperial: false }).addTo(C.map);
  C.map.on('click', onMapClick);
}
function setBase(name) {
  if (C.cur === name) return;
  C.map.removeLayer(C.base[C.cur]); C.base[name].addTo(C.map); C.cur = name;
  $$('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === name));
}
async function drawContour() {
  if (C.contour) { C.map.removeLayer(C.contour); C.contour = null; }
  try {
    if (!C.data.commune || !/^[0-9AB]{5}$/.test(C.data.commune.code || '')) { fitCommune(); return; }
    const f = await NC().commune(C.data.commune.code);
    C.contour = L.geoJSON(f, { style: { color: '#c8102e', weight: 2.5, dashArray: '6 5', fill: true, fillOpacity: 0.03, interactive: false } }).addTo(C.map);
    fitCommune();
  } catch { C.offline = true; fitCommune(); }
}
function fitCommune() {
  const pts = C.data.batiments.map(posOf).filter(Boolean).map(p => [p.lat, p.lon]);
  if (C.contour) C.map.fitBounds(C.contour.getBounds(), { padding: [20, 20] });
  else if (pts.length) C.map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 });
  else C.map.setView(C.data.commune.centre || [46.6, 2.4], 14);
}

/* ---------------------------------------------------------------- marqueurs */
function pinIcon(b, selected) {
  const st = STAT[b.statut] || STAT.autre; const s = selected ? 34 : 26;
  const total = b.projet?.total;
  return L.divIcon({
    className: 'bpin' + (selected ? ' sel' : ''), iconSize: [s, s + 10], iconAnchor: [s / 2, s + 8], popupAnchor: [0, -s],
    html: `<svg viewBox="0 0 26 36" width="${s}" height="${s + 10}" aria-hidden="true"><path d="M13 35s11-12.2 11-21A11 11 0 0 0 2 14c0 8.8 11 21 11 21z" fill="${st.color}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13.5" r="5.2" fill="#fff"/></svg>${total ? `<b>${total}</b>` : ''}`
  });
}
function renderPins() {
  C.markers.forEach(m => C.map.removeLayer(m)); C.markers.clear();
  for (const b of C.data.batiments) {
    const p = posOf(b); if (!p || !C.filter.has(b.statut)) continue;
    const m = L.marker([p.lat, p.lon], { icon: pinIcon(b, b.id === C.sel), draggable: canBat() && b.id === C.sel, title: b.nom, keyboard: true, zIndexOffset: b.id === C.sel ? 1000 : 0 });
    m.bindTooltip(`<b>${esc(b.nom)}</b><br>${esc((STAT[b.statut] || STAT.autre).label)}`, { direction: 'top', offset: [0, -28] });
    m.on('click', () => selectBat(b.id, false));
    m.on('dragend', async () => { const ll = m.getLatLng(); b.lat = +ll.lat.toFixed(6); b.lon = +ll.lng.toFixed(6); await saveBat(`Position de « ${b.nom} » ajustée`); renderCarteSide(); });
    m.addTo(C.map); C.markers.set(b.id, m);
  }
  renderCams();
}
function selectBat(id, fly = true) {
  C.sel = id; C.view = id ? 'detail' : 'list';
  renderPins(); renderCarteSide();
  const b = C.data.batiments.find(x => x.id === id); const p = b && posOf(b);
  if (fly && p) C.map.flyTo([p.lat, p.lon], Math.max(C.map.getZoom(), 17), { duration: 0.6 });
}

/* ---------------------------------------------------------------- localisation automatique */
async function autoLocate() {
  if (C.locating) return;
  const todo = C.data.batiments.filter(b => b.adresse && !posOf(b));
  if (!todo.length) return;
  C.locating = true; let ok = 0, ko = 0; renderCarteSide(`Localisation automatique : 0 / ${todo.length}`);
  for (const b of todo) {
    try {
      const r = await NC().search(b.adresse, C.data.commune.code);
      const best = r.find(x => x.score >= 0.4);
      if (best) { await NC().geocache(geoKey(b), best); C.geocache[geoKey(b)] = best; ok++; renderPins(); } else ko++;
    } catch (e) { C.offline = true; ko = todo.length - ok; break; }
    renderCarteSide(`Localisation automatique : ${ok + ko} / ${todo.length}`);
  }
  C.locating = false; renderCarteSide();
  if (ok) { toast(`${ok} bâtiment(s) localisé(s) automatiquement d'après leur adresse`); if (!C.sel) fitCommune(); }
  if (ko && !C.offline) toast(`${ko} adresse(s) introuvable(s) : vérifiez-les ou positionnez ces bâtiments à la main.`, true);
}

async function saveBat(msg) {
  try { await NC().save(C.data); if (msg) toast(msg); return true; }
  catch (e) { toast(e.message, true); await loadBatiments(true); renderPins(); renderCarteSide(); return false; }
}

/* ---------------------------------------------------------------- placement manuel */
function startPlacing(id) {
  C.placing = id; $('#map').classList.add('placing');
  const b = C.data.batiments.find(x => x.id === id);
  $('#cBanner').innerHTML = `Cliquez sur la carte à l'emplacement de « ${esc(b.nom)} » <button type="button" id="cStop">Annuler</button>`; $('#cBanner').hidden = false;
  $('#cStop').onclick = stopPlacing;
}
function stopPlacing() { C.placing = null; $('#map')?.classList.remove('placing'); const bn = $('#cBanner'); if (bn) bn.hidden = true; }
async function onMapClick(e) {
  if (C.camPlacing) { const tp = C.camPlacing; stopCamPlacing(); return camEdit(null, { type: tp, lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) }); }
  if (!C.placing) return;
  const b = C.data.batiments.find(x => x.id === C.placing); stopPlacing(); if (!b) return;
  b.lat = +e.latlng.lat.toFixed(6); b.lon = +e.latlng.lng.toFixed(6);
  await saveBat(`« ${b.nom} » positionné sur la carte`); selectBat(b.id, false);
}

/* ---------------------------------------------------------------- panneau latéral */
function counts() { const c = {}; Object.keys(STAT).forEach(k => c[k] = 0); C.data.batiments.forEach(b => c[b.statut] = (c[b.statut] || 0) + 1); return c; }
/* coordonnées GPS : décimal (48.78125 / 48,78125), degrés-minutes-secondes (48°46'52.5"N), ou « lat, lon » collé depuis Google Maps */
function parseCoord(str, isLat) {
  let t = String(str || '').trim().toUpperCase().replace(/[’′]/g, '\'').replace(/[”″]/g, '"').replace(/,(?=\d)/g, '.'); if (!t) return null;
  let neg = /^[-−]/.test(t) || /[SWO]$/.test(t) || /^[SWO]/.test(t); t = t.replace(/^[-−+]/, '').replace(/[NSEWO]/g, ' ').trim();
  const n = t.split(/[^\d.]+/).filter(Boolean).map(Number); if (!n.length || n.some(x => !Number.isFinite(x))) return null;
  let v = n[0] + (n[1] || 0) / 60 + (n[2] || 0) / 3600; if (neg) v = -v;
  return Math.abs(v) <= (isLat ? 90 : 180) ? Math.round(v * 1e6) / 1e6 : null;
}
function splitLatLon(str) { const m = String(str || '').trim().match(/^\s*([-−]?\d+(?:[.,]\d+)?)\s*[,; ]\s*([-−]?\d+(?:[.,]\d+)?)\s*$/); return m ? [parseCoord(m[1], true), parseCoord(m[2], false)] : null; }
function toDms(v, isLat) { const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60; return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'O' : 'E')}`; }
const gpsText = (p) => p ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : '';
function locLine(b) {
  const p = posOf(b);
  if (!p) return b.adresse ? (C.offline ? 'Non localisé (hors connexion)' : 'Adresse introuvable : positionnez-le à la main') : 'Sans adresse : positionnez-le à la main';
  return p.src === 'manuel' ? 'Position ajustée à la main' : `Localisé d'après l'adresse${p.label ? ` (${p.label})` : ''}`;
}
function renderCarteSide(progress) {
  const side = $('#cSide'); if (!side || !C.data) return;
  if (C.view === 'detail' && C.sel) return renderDetail(side);
  const cnt = counts();
  const q = C.q.toLowerCase();
  const list = C.data.batiments.filter(b => C.filter.has(b.statut) && (!q || `${b.nom} ${b.type} ${b.adresse}`.toLowerCase().includes(q)));
  const order = Object.keys(STAT);
  list.sort((a, b) => order.indexOf(a.statut) - order.indexOf(b.statut) || a.nom.localeCompare(b.nom, 'fr'));
  const unloc = C.data.batiments.filter(b => !posOf(b)).length;
  side.innerHTML = `
    <section class="c-sum">
      <div class="c-kpis">${order.map(k => `<button type="button" class="c-kpi ${C.filter.has(k) ? 'on' : ''}" data-f="${k}" title="${esc(STAT[k].desc)} — cliquer pour afficher ou masquer">
        <i style="background:${STAT[k].color}"></i><b>${cnt[k] || 0}</b><span>${STAT[k].label}</span></button>`).join('')}</div>
      ${progress ? `<div class="info">${esc(progress)}</div>` : ''}
      ${C.offline ? '<div class="warnbox">Hors connexion : le plan s\'affiche depuis le cache de la clé (zones déjà consultées) et les nouvelles adresses seront localisées à la prochaine connexion.</div>' : ''}
      ${unloc && !progress ? `<div class="warnbox">${unloc} bâtiment(s) sans position sur la carte.</div>` : ''}
    </section>
    <section class="c-list-head">
      <input id="cQ" type="search" placeholder="Rechercher un bâtiment…" value="${esc(C.q)}">
      ${canBat() ? '<button type="button" class="primary small" id="cAdd">+ Bâtiment</button>' : ''}
    </section>
    <div class="c-list">${list.map(b => `<button type="button" class="c-item" data-id="${b.id}">
        <i style="background:${(STAT[b.statut] || STAT.autre).color}"></i>
        <span class="t"><b>${esc(b.nom)}</b><small>${esc(b.type)}${b.adresse ? ' · ' + esc(b.adresse) : ''}</small>
        ${b.projet?.total ? `<small class="eq">${b.projet.total} matériel(s) implanté(s)</small>` : ''}${!posOf(b) ? '<small class="nl">Non localisé</small>' : ''}</span></button>`).join('') || '<p class="muted" style="padding:12px">Aucun bâtiment.</p>'}</div>
    ${camListHtml()}
    <section class="c-foot"><span>Client : <b>${esc(C.data.nom)}</b>${canBat() ? ' <button type="button" class="linkbtn" id="cRename">Renommer</button>' : ''}<br>Commune : <b>${esc(C.data.commune.nom || 'non précisée')}</b>${canBat() ? ' <button type="button" class="linkbtn" id="cCommune">Changer</button>' : ''}</span></section>`;
  side.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const k = b.dataset.f; C.filter.has(k) ? C.filter.delete(k) : C.filter.add(k); if (!C.filter.size) Object.keys(STAT).forEach(x => C.filter.add(x)); renderPins(); renderCarteSide(); });
  const qi = $('#cQ'); qi.oninput = () => { C.q = qi.value; const pos = qi.selectionStart; renderCarteSide(); const n = $('#cQ'); n.focus(); n.setSelectionRange(pos, pos); };
  side.querySelectorAll('.c-item').forEach(it => it.onclick = () => selectBat(it.dataset.id));
  const add = $('#cAdd'); if (add) add.onclick = () => editBat(null);
  const cc = $('#cCommune'); if (cc) cc.onclick = changeCommune;
  bindCamList(side);
  const rn = $('#cRename'); if (rn) rn.onclick = async () => { const v = await askText('Renommer le client', 'Nom du client', C.data.nom); if (!v || !v.trim()) return; C.data.nom = v.trim(); await saveBat('Client renommé'); renderTerrBar(); renderCarteSide(); };
}

function renderDetail(side) {
  const b = C.data.batiments.find(x => x.id === C.sel); if (!b) { C.view = 'list'; return renderCarteSide(); }
  const st = STAT[b.statut] || STAT.autre; const p = posOf(b); const pj = b.projet;
  side.innerHTML = `
    <section class="c-detail">
      <button type="button" class="linkbtn" id="cBack">← Tous les bâtiments</button>
      <div><span class="c-chip" style="background:${st.color}">${st.label}</span></div>
      <h3>${esc(b.nom)}</h3>
      <dl class="kv">
        <dt>Type</dt><dd>${esc(b.type) || '—'}</dd>
        <dt>Adresse</dt><dd>${esc(b.adresse) || '—'}</dd>
        <dt>Position</dt><dd>${esc(locLine(b))}</dd>
        ${p ? `<dt>GPS</dt><dd><span class="mono">${gpsText(p)}</span> <button type="button" class="linkbtn" id="cCopyGps" title="Copier les coordonnées">Copier</button><br><span class="muted" style="font-size:11.5px">${toDms(p.lat, true)} · ${toDms(p.lon, false)}</span></dd>` : ''}
        <dt>Alarme existante</dt><dd>${esc(b.alarme) || '—'}</dd>
      </dl>
      ${b.notes ? `<p class="info" style="margin:0">${esc(b.notes)}</p>` : ''}
    </section>
    <section class="c-detail">
      <h2>Implantation Blackeyes</h2>
      ${pj ? `<p style="margin:0;font-size:12.5px" class="muted">Projet <b style="color:var(--ink)">${esc(pj.fichier || 'sans nom')}</b>, enregistré le ${new Date(pj.date).toLocaleDateString('fr-FR')}${pj.par ? ` par ${esc(pj.par)}` : ''}${pj.niveaux?.length ? ` · ${pj.niveaux.length} niveau(x) : ${esc(pj.niveaux.join(', '))}` : ''}</p>
        <table class="qty"><tbody>${(pj.parType || []).map(t => `<tr><td>${esc(t.nom)}</td><td class="n">${t.n}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="n">${pj.total}</td></tr></tfoot></table>
        <button type="button" id="cOpenProj">Ouvrir le projet</button>`
      : `<p style="margin:0;font-size:12.5px" class="muted">Aucun projet rattaché. Dans un projet, choisissez ce bâtiment dans le panneau « Projet » puis enregistrez : la carte se met à jour automatiquement.</p>`}
    </section>
    <section class="c-detail"><h2>Banque de données</h2>
      <p style="margin:0;font-size:12.5px" class="muted">${bkCount(b.id) ? `${bkCount(b.id)} élément(s) : photos, documents et notes du bâtiment.` : 'Photos, documents et notes du bâtiment.'}</p>
      <div class="btnrow"><button type="button" id="cBank">🗂 Ouvrir la banque</button><button type="button" id="cBankC" title="Éléments communs au client">Banque du client${bkCount(C.data.id) ? ` (${bkCount(C.data.id)})` : ''}</button></div></section>
    ${camNearHtml(b)}
    <section class="c-detail"><h2>Protocole de sûreté</h2>
      <p style="margin:0;font-size:12.5px" class="muted">${PDS.list && PDS.list[b.id] ? `Renseigné · modifié le ${new Date(PDS.list[b.id]).toLocaleDateString('fr-FR')}` : 'Non renseigné pour ce bâtiment.'}</p>
      <button type="button" id="cPds">🛡 ${PDS.list && PDS.list[b.id] ? 'Ouvrir le protocole' : (canBat() ? 'Créer le protocole' : 'Protocole')}</button></section>
    ${canBat() ? `<section class="c-detail"><div class="btnrow">
      <button type="button" id="cEdit">Modifier</button>
      <button type="button" id="cPlace">${p ? 'Repositionner' : 'Positionner sur la carte'}</button>
      ${p && p.src === 'manuel' && b.adresse ? '<button type="button" id="cAuto" class="ghost">Revenir à l\'adresse</button>' : ''}
      <button type="button" id="cDel" class="danger">Supprimer</button></div>
      ${p ? '<p class="muted" style="margin:0;font-size:11.5px">Vous pouvez aussi faire glisser le marqueur sélectionné.</p>' : ''}</section>` : ''}`;
  $('#cBack').onclick = () => { C.sel = null; C.view = 'list'; renderPins(); renderCarteSide(); };
  const op = $('#cOpenProj'); if (op) op.onclick = () => openProjectOfBat(b);
  side.querySelectorAll('[data-cam]').forEach(x => x.onclick = () => { const c = (C.data.cameras || []).find(k => k.id === x.dataset.cam); if (c) { C.map.flyTo([c.lat, c.lon], Math.max(C.map.getZoom(), 18), { duration: 0.5 }); camEdit(c); } });
  const bk1 = $('#cBank'); if (bk1) bk1.onclick = () => openBank(b.id);
  const bk2 = $('#cBankC'); if (bk2) bk2.onclick = () => openBank(C.data.id);
  const cgN = $('#cCamNear'); if (cgN) cgN.onclick = () => startCamPlacing('vp', b.id);
  const cg = $('#cCopyGps'); if (cg) cg.onclick = () => { try { navigator.clipboard.writeText(gpsText(p)); toast('Coordonnées copiées : ' + gpsText(p)); } catch { toast(gpsText(p)); } };
  const pd = $('#cPds'); if (pd) pd.onclick = () => { if (!PDS.list[b.id] && !canBat()) { toast('Aucun protocole pour ce bâtiment.', true); return; } openPds(b.id); };
  const ed = $('#cEdit'); if (ed) ed.onclick = () => editBat(b);
  const pl = $('#cPlace'); if (pl) pl.onclick = () => startPlacing(b.id);
  const au = $('#cAuto'); if (au) au.onclick = async () => { delete b.lat; delete b.lon; await saveBat('Position recalculée d\'après l\'adresse'); renderPins(); renderCarteSide(); autoLocate(); };
  const de = $('#cDel'); if (de) de.onclick = async () => {
    if (!(await confirmBox('Supprimer le bâtiment', `Retirer « ${b.nom} » de la carte ? Les projets enregistrés ne sont pas supprimés.`, 'Supprimer', true))) return;
    C.data.batiments = C.data.batiments.filter(x => x.id !== b.id); C.sel = null; C.view = 'list';
    await saveBat('Bâtiment supprimé'); renderPins(); renderCarteSide();
  };
}

/* ---------------------------------------------------------------- édition */
async function editBat(b) {
  const isNew = !b; const d = b ? { ...b } : { id: 'b-' + uid(), nom: '', type: 'École', adresse: '', statut: 'a_equiper', alarme: '', notes: '' };
  let picked = null;
  const body = `
    <label class="field"><span>Nom du bâtiment</span><input id="eNom" type="text" value="${esc(d.nom)}" placeholder="ex. École Joliot-Curie"></label>
    <div class="row2">
      <label class="field"><span>Type</span><select id="eType">${BTYPES.map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Statut Blackeyes</span><select id="eStat">${Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === d.statut ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Adresse (dans la commune de ${esc(C.data.commune.nom)})</span>
      <div class="pwrow"><input id="eAdr" type="text" value="${esc(d.adresse)}" placeholder="ex. 3 allée Robert Debré"><button type="button" id="eChk">Vérifier</button></div></label>
    <div id="eSug" class="sug"></div>
    <div class="row2">
      <label class="field"><span>Latitude</span><input id="eLat" type="text" value="${Number.isFinite(d.lat) ? d.lat : ''}" placeholder="${(() => { const p = posOf(d); return p ? p.lat.toFixed(6) : 'ex. 48.781250 ou 48°46\'52.5&quot;N'; })()}"></label>
      <label class="field"><span>Longitude</span><input id="eLon" type="text" value="${Number.isFinite(d.lon) ? d.lon : ''}" placeholder="${(() => { const p = posOf(d); return p ? p.lon.toFixed(6) : 'ex. 2.263180 ou 2°15\'47.4&quot;E'; })()}"></label>
    </div>
    <p class="muted" style="margin:-4px 0 0;font-size:11.5px">Facultatif : prioritaire sur l'adresse. Degrés décimaux ou degrés-minutes-secondes ; vous pouvez coller « 48.781250, 2.263180 » (Google Maps, GPS) dans la latitude. Laissez vide pour localiser d'après l'adresse.</p>
    <label class="field"><span>Alarme existante</span><input id="eAlarm" type="text" value="${esc(d.alarme)}" placeholder="ex. Aucun système d'alarme"></label>
    <label class="field"><span>Notes</span><textarea id="eNotes">${esc(d.notes)}</textarea></label>`;
  const ok = await modal({
    title: isNew ? 'Nouveau bâtiment' : `Modifier « ${b.nom} »`, size: 'md', body,
    onMount: (root) => {
      const run = async () => {
        const box = $('#eSug', root); box.innerHTML = '<span class="muted">Recherche…</span>';
        try {
          const r = await NC().search($('#eAdr', root).value, C.data.commune.code);
          box.innerHTML = r.length ? r.map((x, i) => `<button type="button" data-i="${i}">${esc(x.label)} <small>${Math.round(x.score * 100)} %</small></button>`).join('') : '<span class="warnbox">Adresse introuvable dans la commune. Vous pourrez positionner le bâtiment à la main.</span>';
          box.querySelectorAll('[data-i]').forEach(btn => btn.onclick = () => { picked = r[+btn.dataset.i]; $('#eAdr', root).value = picked.label.replace(/\s+\d{5}\s.*$/, ''); box.innerHTML = `<span class="okbox">Adresse retenue : ${esc(picked.label)}</span>`; });
        } catch (e) { box.innerHTML = `<span class="warnbox">${esc(e.message)}</span>`; }
      };
      $('#eChk', root).onclick = run;
      const la = $('#eLat', root); la.addEventListener('input', () => { const pr = splitLatLon(la.value); if (pr && pr[0] != null && pr[1] != null) { la.value = pr[0]; $('#eLon', root).value = pr[1]; } });
    },
    buttons: [{ label: 'Annuler', value: false }, {
      label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'primary', action: (root) => {
        const nom = $('#eNom', root).value.trim(); if (!nom) { toast('Saisissez le nom du bâtiment.', true); return false; }
        const adr = $('#eAdr', root).value.trim();
        Object.assign(d, { nom, type: $('#eType', root).value, statut: $('#eStat', root).value, adresse: adr, alarme: $('#eAlarm', root).value.trim(), notes: $('#eNotes', root).value.trim() });
        if (!isNew && adr !== (b.adresse || '')) { delete d.lat; delete d.lon; }
        const sLa = $('#eLat', root).value.trim(), sLo = $('#eLon', root).value.trim();
        if (sLa || sLo) {
          const la = parseCoord(sLa, true), lo = parseCoord(sLo, false);
          if (la === null || lo === null) { toast('Coordonnées invalides : latitude entre -90 et 90, longitude entre -180 et 180 (ex. 48.781250 et 2.263180).', true); return false; }
          d.lat = la; d.lon = lo;
        } else { delete d.lat; delete d.lon; }
        return true;
      }
    }]
  });
  if (!ok) return;
  if (picked) { C.geocache[geoKey(d)] = picked; try { await NC().geocache(geoKey(d), picked); } catch {} }
  if (isNew) C.data.batiments.push(d); else Object.keys(b).forEach(k => delete b[k]), Object.assign(b, d);
  await saveBat(isNew ? 'Bâtiment ajouté' : 'Bâtiment mis à jour');
  C.sel = d.id; C.view = 'detail'; renderPins(); renderCarteSide();
  if (!posOf(d) && d.adresse) autoLocate();
  const p = posOf(d); if (p) C.map.flyTo([p.lat, p.lon], 17, { duration: 0.6 });
}

async function changeCommune() {
  const pick = await pickCommune(C.data.commune.nom || ''); if (!pick) return;
  C.data.commune = { code: pick.code || '', nom: pick.nom, centre: pick.centre || C.data.commune.centre };
  await saveBat(`Commune : ${pick.nom}`); renderTerrBar();
  await drawContour(); renderPins(); renderCarteSide(); autoLocate();
}

async function prefetchDialog() {
  if (!canBat()) return;
  const bnds = C.contour ? C.contour.getBounds().pad(0.05) : C.map.getBounds();
  const bbox = [bnds.getSouth(), bnds.getWest(), bnds.getNorth(), bnds.getEast()];
  let off = null;
  const r = await modal({
    title: 'Préparer la carte hors ligne', size: 'md',
    body: `<p style="margin:0">Télécharge sur la clé les tuiles de ${C.contour ? 'la commune' : 'la zone affichée'}, pour consulter la carte sans connexion Internet.</p>
      <label class="chk"><input id="pfPlan" type="checkbox" checked> Plan IGN</label>
      <label class="chk"><input id="pfPhoto" type="checkbox"> Photographies aériennes (plus volumineux)</label>
      <label class="field"><span>Détail maximal</span><select id="pfZ"><option value="17">Quartier (zoom 17)</option><option value="18" selected>Rue (zoom 18)</option></select></label>
      <div class="bar" style="height:8px;background:var(--accent-soft);border-radius:4px;overflow:hidden"><i id="pfBar" style="display:block;height:100%;width:0;background:var(--accent)"></i></div>
      <p id="pfTxt" class="muted" style="margin:0;font-size:12px">Prêt.</p>`,
    buttons: [{ label: 'Fermer', value: null }, {
      label: 'Télécharger', cls: 'primary', action: async (root) => {
        const layers = [$('#pfPlan', root).checked && 'plan', $('#pfPhoto', root).checked && 'photo'].filter(Boolean);
        if (!layers.length) { toast('Cochez au moins une couche.', true); return false; }
        $$('footer button', root).forEach(b => b.disabled = true);
        off = (p) => { $('#pfBar', root).style.width = Math.round(p.done / p.total * 100) + '%'; $('#pfTxt', root).textContent = `${p.done} / ${p.total} tuiles${p.fail ? ` · ${p.fail} échec(s)` : ''}`; };
        try { const res = await NC().prefetch(bbox, layers, 12, +$('#pfZ', root).value); $('#pfTxt', root).textContent = `Terminé : ${res.total - res.fail} tuiles enregistrées sur la clé${res.fail ? `, ${res.fail} échec(s)` : ''}.`; }
        catch (e) { $('#pfTxt', root).textContent = e.message; }
        $$('footer button', root).forEach(b => b.disabled = false); off = null; return false;
      }
    }]
  });
  return r;
}
window.native?.carte?.onProgress?.((p) => { const f = $('#pfBar'); if (f) { f.style.width = Math.round(p.done / p.total * 100) + '%'; $('#pfTxt').textContent = `${p.done} / ${p.total} tuiles${p.fail ? ` · ${p.fail} échec(s)` : ''}`; } });

/* ---------------------------------------------------------------- liens avec les projets */
async function openProjectOfBat(b) {
  if (!(await guardUnsaved())) return;
  try { const f = await NC().openProject(b.id); closeCarte(); loadProjectFile(f); }
  catch (e) { toast(e.message, true); }
}
function projectSummary() {
  const parType = usedTypes().map(t => ({ nom: t.nom, code: t.code, n: allMarkers().filter(m => m.typeId === t.id).length }));
  return { niveaux: S.project.levels.map(l => l.name), total: allMarkers().length, parType };
}
async function syncProjectToMap() {
  if (!S.project.batimentId) return;
  try {
    const b = await NC().linkProject(S.project.batimentId, projectSummary(), S.project.path);
    for (const t of (C.store || [])) { const i = t.batiments.findIndex(x => x.id === b.id); if (i >= 0) t.batiments[i] = b; }
    toast(`Projet enregistré · « ${b.nom} » mis à jour sur la carte`);
  } catch (e) { toast('Projet enregistré, mais la carte n\'a pas pu être mise à jour : ' + e.message, true); }
}
function batOptions() {
  if (!C.store) { loadBatiments().then(() => renderSide()).catch(() => {}); return '<option value="">Chargement…</option>'; }
  const cur = S.project.batimentId || '';
  const opt = (b) => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.nom)}</option>`;
  const sorted = (t) => t.batiments.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (C.store.length === 1) return '<option value="">— Aucun —</option>' + sorted(C.store[0]).map(opt).join('');
  return '<option value="">— Aucun —</option>' + C.store.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(t => `<optgroup label="${esc(terrLabel(t))}">${sorted(t).map(opt).join('')}</optgroup>`).join('');
}


/* ---------------------------------------------------------------- liaisons */
$('#bCarte').onclick = openCarte;
$('#cClose').onclick = closeCarte;
$('#cFit').onclick = () => fitCommune();
$('#cPrefetch').onclick = prefetchDialog;
$('#cTerr').onchange = (e) => showTerritoire(e.target.value);
$('#cTerrNew').onclick = async () => { const t = await newTerritoire(); if (t) await showTerritoire(t.id); };
$('#cTerrDel').onclick = deleteTerritoire;
$$('[data-base]').forEach(b => b.onclick = () => setBase(b.dataset.base));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#carteView').hidden && !$('#modalRoot').children.length && $('#authScreen').hidden) { e.stopPropagation(); if (C.placing) stopPlacing(); else if (C.sel) { C.sel = null; C.view = 'list'; renderPins(); renderCarteSide(); } else closeCarte(); } }, true);

/* ---------------------------------------------------------------- caméras de vidéoprotection (extérieur) et de vidéosurveillance (intérieur)
   Stockées par client : territoire.cameras = [{ id, type: 'vp'|'vs', nom, lat, lon, dir (° depuis le nord), angle, portee (m), exploitant, notes, batId }] */
const CAM_T = { vp: { label: 'Vidéoprotection (extérieur)', color: '#0e7490', code: 'VP', portee: 25, angle: 90 }, vs: { label: 'Vidéosurveillance (intérieur)', color: '#7c3aed', code: 'VS', portee: 10, angle: 100 } };
const camsOf = () => (C.data ? (C.data.cameras = C.data.cameras || []) : []);
function geoDist(a, b) { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function geoBearing(a, b) { const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r); return (Math.atan2(y, x) / r + 360) % 360; }
const dirText = (deg) => ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'][Math.round(deg / 45) % 8];
function geoOffset(p, distM, bearDeg) { const r = Math.PI / 180; return [p.lat + distM * Math.cos(bearDeg * r) / 111320, p.lon + distM * Math.sin(bearDeg * r) / (111320 * Math.cos(p.lat * r))]; }
function camCone(c) {
  const a = Math.min(359, Math.max(5, +c.angle || 90)), n = 18, pts = [[c.lat, c.lon]];
  for (let i = 0; i <= n; i++) pts.push(geoOffset(c, +c.portee || 20, (+c.dir || 0) - a / 2 + a * i / n));
  return pts;
}
function camIcon(c) {
  const t = CAM_T[c.type] || CAM_T.vp;
  return L.divIcon({ className: 'campin', iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="11.5" fill="${t.color}" stroke="#fff" stroke-width="2"/><g transform="rotate(${(+c.dir || 0) - 90} 13 13)"><rect x="6.5" y="9.5" width="10" height="7" rx="1.6" fill="#fff"/><path d="M16.5 11.2l4-2.2v8l-4-2.2z" fill="#fff"/></g></svg>` });
}
function renderCams() {
  if (!C.map) return;
  if (!C.camLayer) C.camLayer = L.layerGroup().addTo(C.map);
  C.camLayer.clearLayers(); if (C.hideCams || !C.data) return;
  for (const c of camsOf()) {
    const t = CAM_T[c.type] || CAM_T.vp;
    L.polygon(camCone(c), { color: t.color, weight: 1, fillColor: t.color, fillOpacity: 0.16, interactive: false }).addTo(C.camLayer);
    const m = L.marker([c.lat, c.lon], { icon: camIcon(c), draggable: canBat(), title: c.nom || t.label, zIndexOffset: 500 });
    m.bindTooltip(`<b>${esc(c.nom || t.code)}</b> · ${esc(t.label)}${c.exploitant ? `<br>${esc(c.exploitant)}` : ''}`, { direction: 'top', offset: [0, -12] });
    m.on('click', () => camEdit(c));
    m.on('dragend', async () => { const ll = m.getLatLng(); c.lat = +ll.lat.toFixed(6); c.lon = +ll.lng.toFixed(6); await saveBat(`Caméra ${c.nom || ''} déplacée`); renderCams(); renderCarteSide(); });
    m.addTo(C.camLayer);
  }
}
function nextCamName(type) { const code = (CAM_T[type] || CAM_T.vp).code; const used = new Set(camsOf().map(c => c.nom)); let n = camsOf().filter(c => c.type === type).length + 1; while (used.has(`${code}${n}`)) n++; return `${code}${n}`; }
function startCamPlacing(type, batId = null) {
  if (!canBat()) return; C.camPlacing = type; C.camBat = batId; $('#map').classList.add('placing');
  $('#cBanner').innerHTML = `Cliquez sur la carte à l'emplacement de la caméra <span class="seg"><button type="button" data-ct="vp" class="${type === 'vp' ? 'on' : ''}">Extérieur (vidéoprotection)</button><button type="button" data-ct="vs" class="${type === 'vs' ? 'on' : ''}">Intérieur (vidéosurveillance)</button></span> <button type="button" id="cStop">Annuler</button>`;
  $('#cBanner').hidden = false; $('#cStop').onclick = stopCamPlacing;
  $$('#cBanner [data-ct]').forEach(b => b.onclick = () => startCamPlacing(b.dataset.ct, batId));
}
function stopCamPlacing() { C.camPlacing = null; $('#map')?.classList.remove('placing'); const bn = $('#cBanner'); if (bn) bn.hidden = true; }
async function camEdit(c, pre = {}) {
  const isNew = !c; const ro = !canBat();
  const d = c ? { ...c } : { id: 'cam-' + uid(), type: pre.type || 'vp', nom: '', lat: pre.lat, lon: pre.lon, dir: 0, angle: CAM_T[pre.type || 'vp'].angle, portee: CAM_T[pre.type || 'vp'].portee, exploitant: '', notes: '', batId: C.camBat || null };
  if (isNew) { d.nom = nextCamName(d.type); if (!d.batId) { const near = C.data.batiments.map(b => ({ b, p: posOf(b) })).filter(x => x.p).map(x => ({ ...x, dd: geoDist(x.p, d) })).sort((a, b) => a.dd - b.dd)[0]; if (near && near.dd < 150) d.batId = near.b.id; } }
  const dis = ro ? 'disabled' : '';
  const body = `<div class="row2"><label class="field"><span>Type</span><select id="kType" ${dis}>${Object.entries(CAM_T).map(([k, t]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="field"><span>Repère</span><input id="kNom" type="text" value="${esc(d.nom)}" ${dis}></label></div>
    <div class="row3"><label class="field"><span>Orientation (° depuis le nord)</span><input id="kDir" type="number" min="0" max="359" value="${d.dir}" ${dis}></label>
      <label class="field"><span>Angle de vue (°)</span><input id="kAng" type="number" min="5" max="360" value="${d.angle}" ${dis}></label>
      <label class="field"><span>Portée (m)</span><input id="kPor" type="number" min="1" max="500" value="${d.portee}" ${dis}></label></div>
    <div class="ag-dirs">${['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].map((x, i) => `<button type="button" class="small" data-dir="${i * 45}" ${dis}>${x}</button>`).join('')}</div>
    <label class="field"><span>Bâtiment associé</span><select id="kBat" ${dis}><option value="">— Aucun (voie publique) —</option>${C.data.batiments.map(b => `<option value="${esc(b.id)}" ${b.id === d.batId ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></label>
    <label class="field"><span>Exploitant</span><input id="kExp" type="text" value="${esc(d.exploitant)}" placeholder="ex. CSU de la ville, établissement, bailleur" ${dis}></label>
    <div class="row2"><label class="field"><span>Latitude</span><input id="kLat" type="text" value="${d.lat ?? ''}" ${dis}></label><label class="field"><span>Longitude</span><input id="kLon" type="text" value="${d.lon ?? ''}" ${dis}></label></div>
    <label class="field"><span>Notes</span><textarea id="kNotes" placeholder="Fixe ou dôme PTZ, zone filmée, enregistrement, durée de conservation, accès aux images…" ${dis}>${esc(d.notes)}</textarea></label>`;
  const left = [];
  if (!isNew && !ro) left.push({ label: 'Supprimer', cls: 'danger', action: async () => { if (!await confirmBox('Supprimer la caméra', `Supprimer la caméra « ${d.nom} » de la carte ?`, 'Supprimer', true)) return false; C.data.cameras = camsOf().filter(x => x.id !== d.id); await saveBat('Caméra supprimée'); renderCams(); renderCarteSide(); return null; } });
  const r = await modal({ title: isNew ? 'Nouvelle caméra' : `Caméra ${d.nom}`, size: 'md', body, left,
    onMount: (root) => { $$('[data-dir]', root).forEach(b => b.onclick = () => { $('#kDir', root).value = b.dataset.dir; });
      $('#kType', root).onchange = (e) => { const t = CAM_T[e.target.value]; if (isNew) { $('#kAng', root).value = t.angle; $('#kPor', root).value = t.portee; $('#kNom', root).value = nextCamName(e.target.value); } };
      const la = $('#kLat', root); la.addEventListener('input', () => { const pr = splitLatLon(la.value); if (pr && pr[0] != null && pr[1] != null) { la.value = pr[0]; $('#kLon', root).value = pr[1]; } }); },
    buttons: ro ? [{ label: 'Fermer', cls: 'primary', value: null }] : [{ label: 'Annuler', value: null }, { label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'primary', action: (root) => {
      const lat = parseCoord($('#kLat', root).value, true), lon = parseCoord($('#kLon', root).value, false);
      if (lat === null || lon === null) { toast('Coordonnées invalides.', true); return false; }
      return { ...d, type: $('#kType', root).value, nom: $('#kNom', root).value.trim() || nextCamName($('#kType', root).value), dir: ((+$('#kDir', root).value || 0) % 360 + 360) % 360,
        angle: Math.min(360, Math.max(5, +$('#kAng', root).value || 90)), portee: Math.min(500, Math.max(1, +$('#kPor', root).value || 20)), batId: $('#kBat', root).value || null,
        exploitant: $('#kExp', root).value.trim(), notes: $('#kNotes', root).value.trim(), lat, lon }; } }] });
  if (!r) return;
  const arr = camsOf(); const i = arr.findIndex(x => x.id === r.id); if (i >= 0) arr[i] = r; else arr.push(r);
  await saveBat(isNew ? `Caméra ${r.nom} ajoutée` : `Caméra ${r.nom} enregistrée`); renderCams(); renderCarteSide();
}
function camListHtml() {
  const cams = camsOf(); const nb = (t) => cams.filter(c => c.type === t).length;
  return `<section class="c-cams"><div class="c-cams-h"><h2>Caméras (${cams.length})</h2><label class="chk"><input type="checkbox" id="cCamShow" ${C.hideCams ? '' : 'checked'}> Afficher</label></div>
    <p class="muted" style="margin:0;font-size:12px">${nb('vp')} de vidéoprotection (extérieur) · ${nb('vs')} de vidéosurveillance (intérieur)</p>
    ${canBat() ? '<div class="btnrow"><button type="button" class="small" id="cCamVp">+ Caméra extérieure</button><button type="button" class="small" id="cCamVs">+ Caméra intérieure</button></div>' : ''}
    ${cams.length ? `<div class="c-camlist">${cams.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true })).map(c => { const t = CAM_T[c.type] || CAM_T.vp; const b = c.batId && C.data.batiments.find(x => x.id === c.batId);
      return `<button type="button" class="c-cam" data-cam="${esc(c.id)}"><i style="background:${t.color}"></i><span><b>${esc(c.nom)}</b> <small>${esc(t.label)}${b ? ' · ' + esc(b.nom) : ''}${c.exploitant ? ' · ' + esc(c.exploitant) : ''}</small></span></button>`; }).join('')}</div>` : ''}</section>`;
}
function bindCamList(side) {
  const sh = $('#cCamShow', side); if (sh) sh.onchange = () => { C.hideCams = !sh.checked; renderCams(); };
  const a = $('#cCamVp', side); if (a) a.onclick = () => startCamPlacing('vp');
  const b = $('#cCamVs', side); if (b) b.onclick = () => startCamPlacing('vs');
  side.querySelectorAll('.c-cam[data-cam]').forEach(x => x.onclick = () => { const c = camsOf().find(k => k.id === x.dataset.cam); if (c) { C.map.flyTo([c.lat, c.lon], Math.max(C.map.getZoom(), 18), { duration: 0.5 }); camEdit(c); } });
}
/* caméras d'un bâtiment : associées, ou à moins de « rayon » mètres */
function camsNear(terr, b, rayon = 150) {
  const p = (typeof posOf === 'function') ? posOf(b) : null;
  return (terr.cameras || []).map(c => ({ c, d: p ? geoDist(p, c) : null, dir: p ? dirText(geoBearing(p, c)) : '' })).filter(x => x.c.batId === b.id || (x.d !== null && x.d <= rayon)).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
}
function camNearHtml(b) {
  const list = camsNear(C.data, b);
  return `<section class="c-detail"><h2>Caméras à proximité (${list.length})</h2>
    ${list.length ? `<div class="c-camlist">${list.map(({ c, d, dir }) => { const t = CAM_T[c.type] || CAM_T.vp; return `<button type="button" class="c-cam" data-cam="${esc(c.id)}"><i style="background:${t.color}"></i><span><b>${esc(c.nom)}</b> <small>${esc(t.label)}${d !== null ? ` · ${Math.round(d)} m au ${dir}` : ''}</small></span></button>`; }).join('')}</div>` : '<p class="muted" style="margin:0;font-size:12.5px">Aucune caméra associée ou à moins de 150 m.</p>'}
    ${canBat() ? '<button type="button" class="small" id="cCamNear">+ Caméra pour ce bâtiment</button>' : ''}</section>`;
}
