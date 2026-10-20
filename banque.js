/* Blackeyes Implantation — banque de données par client et par bâtiment (1.14)
   Photos, documents (PDF, Word, Excel, plans…) et notes, rangés par catégorie et par niveau.
   Données chiffrées sur la clé : BlackeyesData/Banque/<id du client ou du bâtiment>.json.
   Les photos d'un bâtiment se placent sur les plans de son projet (pastilles 📷 cliquables). */
'use strict';

const BK = { scope: null, kind: null, terr: null, bat: null, data: null, list: {}, sel: null, checked: new Set(), q: '', fType: '', fCat: '', fLvl: '', fTodo: false, timer: null, dirty: false };
const BK_CATS = ['Extérieur', 'Façades', 'Accès et sorties de secours', 'Intérieur', 'Salles', 'Locaux techniques', 'Portes', 'Vidéoprotection', 'Plans', 'Schémas', 'Documents administratifs', 'Contacts', 'Autre'];
const bkCanEdit = () => can('batiments') || can('implanter');
const bkNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+-]+/g, '');
const bkExt = (n) => (String(n || '').split('.').pop() || '').toLowerCase();
const bkSize = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
const bkB64 = (u8) => { let s = ''; const b = new Uint8Array(u8); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
async function bkRefreshList() { try { BK.list = await window.native.bank.list(); } catch { BK.list = {}; } }
const bkCount = (id) => (BK.list && BK.list[id] && BK.list[id].n) || 0;

/* ---------------------------------------------------------------- ouverture */
async function openBank(scopeId, opts = {}) {
  if (!S.user) return;
  try { await loadBatiments(true); } catch {}
  let terr = null, bat = null;
  const f = batFind(scopeId);
  if (f) { terr = f.t; bat = f.b; } else terr = (C.store || []).find(t => t.id === scopeId);
  if (!terr) { toast('Client ou bâtiment introuvable.', true); return; }
  let d; try { d = await window.native.bank.load(scopeId); } catch (e) { toast(e.message, true); return; }
  Object.assign(BK, { scope: scopeId, kind: bat ? 'bat' : 'client', terr, bat, data: d, sel: null, checked: new Set(), q: '', fType: '', fCat: '', fLvl: '', fTodo: false, dirty: false });
  $('#bankView').hidden = false; $('#bkQ').value = '';
  bkRender();
}
function openBankForProject() {
  if (!S.project.batimentId) { toast('Rattachez d\'abord le projet à un bâtiment de la carte (panneau « Projet »).', true); return; }
  openBank(S.project.batimentId);
}
async function closeBank() { await bkFlush(); $('#bankView').hidden = true; BK.data = null; bkRefreshList(); }
function bkMark() {
  BK.dirty = true; clearTimeout(BK.timer); BK.timer = setTimeout(bkFlush, 700);
}
async function bkFlush() {
  clearTimeout(BK.timer); if (!BK.dirty || !BK.data) return true;
  try { await window.native.bank.save(BK.scope, { items: BK.data.items, nom: BK.bat ? BK.bat.nom : BK.terr.nom }); BK.dirty = false; $('#bkSaved').textContent = 'Enregistré'; return true; }
  catch (e) { toast('Enregistrement de la banque impossible : ' + e.message, true); return false; }
}

/* ---------------------------------------------------------------- liste */
const bkItems = () => (BK.data ? BK.data.items : []);
const bkInProject = (it) => S.project && S.project.batimentId === BK.scope && projectPhotos().find(p => p.bankId === it.id);
function bkFiltered() {
  const q = bkNorm(BK.q);
  return bkItems().filter(it => (!BK.fType || it.type === BK.fType) && (!BK.fCat || (it.cat || 'Autre') === BK.fCat) && (!BK.fLvl || (it.niveau || '') === BK.fLvl)
    && (!BK.fTodo || (it.type === 'photo' && !(bkInProject(it) || {}).pos))
    && (!q || bkNorm([it.titre, it.cat, it.niveau, it.ref, it.notes, it.nom, it.texte, (it.tags || []).join(' ')].join(' ')).includes(q)));
}
function bkRender() {
  const it0 = bkItems(); const ed = bkCanEdit();
  $('#bkTitle').textContent = `Banque de données — ${BK.bat ? BK.bat.nom : BK.terr.nom}`;
  $('#bkSub').textContent = BK.bat ? `Bâtiment du client ${BK.terr.nom}` : `Client${BK.terr.commune && BK.terr.commune.nom ? ' · ' + BK.terr.commune.nom : ''} (éléments communs à tous ses bâtiments)`;
  $('#bkSaved').textContent = '';
  $$('#bkAddPh, #bkAddDoc, #bkAddNote').forEach(b => b.hidden = !ed);
  // portée : client / bâtiments du client
  const scopes = [{ id: BK.terr.id, label: `Client : ${BK.terr.nom}` }, ...BK.terr.batiments.map(b => ({ id: b.id, label: `Bâtiment : ${b.nom}` }))];
  $('#bkScope').innerHTML = scopes.map(s => `<option value="${esc(s.id)}" ${s.id === BK.scope ? 'selected' : ''}>${esc(s.label)}${bkCount(s.id) ? ` (${bkCount(s.id)})` : ''}</option>`).join('');
  const cats = [...new Set([...BK_CATS, ...it0.map(i => i.cat).filter(Boolean)])];
  const lvls = [...new Set(it0.map(i => i.niveau).filter(Boolean))];
  $('#bkFilters').innerHTML = `<select id="bkfType"><option value="">Tout (${it0.length})</option><option value="photo" ${BK.fType === 'photo' ? 'selected' : ''}>Photos (${it0.filter(i => i.type === 'photo').length})</option><option value="doc" ${BK.fType === 'doc' ? 'selected' : ''}>Documents (${it0.filter(i => i.type === 'doc').length})</option><option value="note" ${BK.fType === 'note' ? 'selected' : ''}>Notes (${it0.filter(i => i.type === 'note').length})</option></select>
    <select id="bkfCat"><option value="">Toutes catégories</option>${cats.filter(c => it0.some(i => (i.cat || 'Autre') === c)).map(c => `<option ${c === BK.fCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    ${lvls.length ? `<select id="bkfLvl"><option value="">Tous niveaux</option>${lvls.map(c => `<option ${c === BK.fLvl ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    ${BK.kind === 'bat' ? `<label class="chk"><input type="checkbox" id="bkfTodo" ${BK.fTodo ? 'checked' : ''}> Photos à placer sur le plan</label>` : ''}`;
  const list = bkFiltered();
  const proj = BK.kind === 'bat' && S.project && S.project.batimentId === BK.scope;
  $('#bkInfo').innerHTML = BK.kind === 'bat' ? (proj ? `<span class="ok">Projet ouvert : « ${esc(S.project.name)} » — les photos peuvent être placées sur ses plans.</span>` : BK.bat.projet ? `Pour placer des photos sur les plans, ouvrez le projet du bâtiment. <button type="button" class="small" id="bkOpenProj">Ouvrir ${esc(BK.bat.projet.fichier || 'le projet')}</button>` : 'Aucun projet rattaché à ce bâtiment : les photos restent dans la banque.') : '';
  const sel = $$('#bkGrid .bk-card input:checked').length;
  $('#bkGrid').innerHTML = list.length ? list.map(it => {
    const ip = it.type === 'photo' && bkInProject(it);
    const th = it.type === 'photo' ? `<img src="${it.url}" alt="" loading="lazy">` : it.type === 'doc' ? `<span class="bk-doc">${esc(bkExt(it.nom).toUpperCase() || 'DOC')}</span>` : `<span class="bk-note">${esc(String(it.texte || '').slice(0, 160))}</span>`;
    return `<div class="bk-card${it.id === BK.sel ? ' on' : ''}" data-id="${esc(it.id)}">
      ${ed ? `<input type="checkbox" class="bk-ck" data-ck="${esc(it.id)}" ${BK.checked.has(it.id) ? 'checked' : ''} title="Sélectionner">` : ''}
      <div class="bk-th">${th}</div>
      <div class="bk-tx"><b>${esc(it.titre || it.nom || 'Sans titre')}</b><small>${esc([it.cat, it.niveau, it.ref].filter(Boolean).join(' · '))}</small>
      ${ip ? `<span class="bk-badge ${ip.pos ? 'ok' : ''}">${ip.pos ? `📍 ${esc(photoPlaceTxt(ip))}` : 'Dans le projet, non placée'}</span>` : it.type === 'photo' && it.aPlacer ? '<span class="bk-badge todo">À placer</span>' : ''}</div></div>`;
  }).join('') : `<p class="muted" style="padding:20px">${it0.length ? 'Aucun élément ne correspond aux filtres.' : `Banque vide. ${ed ? 'Ajoutez des photos, des documents (plans, PV, contrats, fiches…) ou des notes.' : ''}`}</p>`;
  $('#bkSelBar').innerHTML = BK.checked.size ? `<b>${BK.checked.size} sélectionné(s)</b>${proj ? '<button type="button" class="primary small" data-b="placeSel">📍 Placer sur le plan</button>' : ''}<button type="button" class="small" data-b="catSel">Catégorie…</button><button type="button" class="small" data-b="lvlSel">Niveau…</button><button type="button" class="small danger" data-b="delSel">Supprimer</button><button type="button" class="small ghost" data-b="none">Désélectionner</button>` : '';
  $('#bkSelBar').hidden = !BK.checked.size;
  bkRenderDetail();
}
function bkRenderDetail() {
  const box = $('#bkDetail'); const it = bkItems().find(i => i.id === BK.sel);
  if (!it) { box.innerHTML = `<div class="bk-help"><h3>Banque de données</h3><p>Rassemblez ici tout ce qui concerne ${BK.kind === 'bat' ? 'ce bâtiment' : 'ce client'} : photos, plans, documents, contacts, notes.</p>
    <ul><li>Les photos d'un bâtiment se placent sur les plans du projet : une pastille 📷 numérotée apparaît, un clic l'affiche.</li><li>Classez par catégorie et par niveau ; la recherche porte sur les titres, références et notes.</li><li>Cochez plusieurs éléments pour les traiter ensemble.</li><li>Tout est chiffré sur la clé.</li></ul>
    <p class="muted">${bkItems().length} élément(s) · ${bkItems().filter(i => i.type === 'photo').length} photo(s)</p></div>`; return; }
  const ed = bkCanEdit(); const dis = ed ? '' : 'disabled';
  const proj = BK.kind === 'bat' && S.project && S.project.batimentId === BK.scope;
  const ip = it.type === 'photo' && bkInProject(it);
  const lvlNames = [...new Set([...(proj ? S.project.levels.map(l => l.name) : []), ...(BK.bat && BK.bat.projet ? BK.bat.projet.niveaux || [] : []), ...bkItems().map(i => i.niveau).filter(Boolean)])];
  const hint = it.type === 'photo' && proj ? bkTarget(it) : null;
  box.innerHTML = `<div class="bk-det">
    ${it.type === 'photo' ? `<div class="bk-big" data-b="zoom" title="Agrandir"><img src="${it.url}" alt=""></div>` : it.type === 'doc' ? `<div class="bk-docbig"><span class="bk-doc">${esc(bkExt(it.nom).toUpperCase())}</span><div><b>${esc(it.nom)}</b><div class="muted">${bkSize(it.taille || 0)}</div></div></div>` : ''}
    <label class="field"><span>Titre</span><input type="text" data-f="titre" value="${esc(it.titre || '')}" ${dis}></label>
    <div class="row2"><label class="field"><span>Catégorie</span><input type="text" data-f="cat" list="bkCatList" value="${esc(it.cat || '')}" ${dis}><datalist id="bkCatList">${BK_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label>
      <label class="field"><span>Niveau</span><input type="text" data-f="niveau" list="bkLvlList" value="${esc(it.niveau || '')}" placeholder="ex. RDC" ${dis}><datalist id="bkLvlList">${lvlNames.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label></div>
    <label class="field"><span>Référence / emplacement</span><input type="text" data-f="ref" value="${esc(it.ref || '')}" placeholder="ex. RDC D.11 (case du quadrillage), façade Alpha…" ${dis}></label>
    ${it.type === 'note' ? `<label class="field"><span>Texte</span><textarea data-f="texte" rows="9" ${dis}>${esc(it.texte || '')}</textarea></label>` : `<label class="field"><span>Notes</span><textarea data-f="notes" rows="3" ${dis}>${esc(it.notes || '')}</textarea></label>`}
    <p class="muted" style="margin:0;font-size:11.5px">Ajouté le ${esc(frDate(it.date))}${it.auteur ? ` par ${esc(it.auteur)}` : ''}${it.source ? ` · ${esc(it.source)}` : ''}</p>
    ${ip ? `<div class="info">${ip.pos ? `Placée sur le plan : <b>${esc(photoPlaceTxt(ip))}</b> (pastille ${photoNum(ip)}).` : 'Ajoutée au projet, pas encore placée sur un plan.'}</div>` : ''}
    <div class="btnrow">
      ${it.type === 'photo' && proj && ed ? `<button type="button" class="primary" data-b="place">📍 ${ip && ip.pos ? 'Déplacer sur le plan' : 'Placer sur le plan'}</button>${hint ? `<button type="button" data-b="placeAt">Placer à ${esc(hint.txt)}</button>` : ''}` : ''}
      ${ip && ip.pos ? '<button type="button" data-b="show">Voir sur le plan</button>' : ''}
      ${it.type !== 'note' ? '<button type="button" data-b="copy">Enregistrer une copie…</button>' : ''}
      ${ed ? '<button type="button" class="danger ghost" data-b="del">Supprimer</button>' : ''}
    </div></div>`;
}
/* emplacement suggéré : niveau du même nom + case « X.nn » de la référence (quadrillage) */
function bkTarget(it) {
  const m = String(it.ref || '').match(/\b([A-T])\s*\.\s*(\d{1,2})\b/i); if (!m) return null;
  const l = S.project.levels.find(x => bkNorm(x.name) === bkNorm(it.niveau)); if (!l) return null;
  return { l, ...gridCenter(l, m[1], m[2]), txt: `${l.name} ${m[1].toUpperCase()}.${String(m[2]).padStart(2, '0')}` };
}
function bkToProject(it) {
  let p = projectPhotos().find(x => x.bankId === it.id);
  if (!p) { p = { id: uid(), url: it.url, w: it.w, h: it.h, legende: it.titre || '', ref: it.ref || '', bankId: it.id, markerId: null, rapport: true, date: it.date || today(), fichier: it.nom || '' }; projectPhotos().push(p); setDirty(); }
  return p;
}
async function bkPlace(ids, auto = false) {
  const items = ids.map(id => bkItems().find(i => i.id === id)).filter(i => i && i.type === 'photo');
  if (!items.length) { toast('Sélectionnez des photos.', true); return; }
  if (!S.project.levels.length) { toast('Le projet n\'a pas encore de plan.', true); return; }
  const queue = [];
  for (const it of items) {
    const p = bkToProject(it); const tg = bkTarget(it);
    if (auto && tg) { p.pos = { levelId: tg.l.id, x: Math.round(tg.x), y: Math.round(tg.y) }; setDirty(); continue; }
    queue.push({ p, it });
  }
  await closeBank();
  if (!queue.length) { const it = items[0]; const p = projectPhotos().find(x => x.bankId === it.id); renderSide(); if (p) showPhotoOnPlan(p.id); toast(`${items.length} photo(s) placée(s) à l'emplacement indiqué`); return; }
  const first = queue[0]; const l = S.project.levels.find(x => bkNorm(x.name) === bkNorm(first.it.niveau)); if (l && S.levelId !== l.id) selectLevel(l.id);
  S.photoQueue = queue.slice(1).map(q => q.p.id); startPhotoPlacing(first.p.id);
}

/* ---------------------------------------------------------------- ajouts */
async function bkAdd(kind) {
  if (!bkCanEdit()) return;
  if (kind === 'note') {
    const it = { id: uid(), type: 'note', titre: 'Nouvelle note', cat: 'Autre', texte: '', date: today(), auteur: S.user.name || '' };
    bkItems().unshift(it); BK.sel = it.id; bkMark(); bkRender(); setTimeout(() => { const t = $('#bkDetail [data-f="titre"]'); if (t) { t.focus(); t.select(); } }, 30); return;
  }
  let files; try { files = await window.native.bank.addFiles(kind); } catch (e) { toast(e.message, true); return; }
  if (!files || !files.length) return;
  toast(`Ajout de ${files.length} fichier(s)…`); let n = 0;
  const base = { cat: BK.fCat || (kind === 'photo' ? (BK.kind === 'bat' ? 'Intérieur' : 'Extérieur') : 'Documents administratifs'), niveau: BK.fLvl || '', date: today(), auteur: S.user.name || '' };
  for (const f of files) {
    try {
      const ext = bkExt(f.name); const titre = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      if (kind === 'photo') {
        const raw = await bytesToDataUrl(f.data, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
        const ph = await shrinkSitePhoto(raw);
        bkItems().unshift({ id: uid(), type: 'photo', titre, ...base, ...ph, nom: f.name, aPlacer: BK.kind === 'bat' });
      } else bkItems().unshift({ id: uid(), type: 'doc', titre, ...base, nom: f.name, taille: f.data.byteLength || f.data.length, data: bkB64(f.data) });
      n++;
    } catch { toast(`Fichier illisible : ${f.name}`, true); }
  }
  bkMark(); await bkFlush(); bkRender(); toast(`${n} élément(s) ajouté(s) à la banque`);
}

/* ---------------------------------------------------------------- liaisons */
(function bindBank() {
  $('#bkClose').onclick = closeBank;
  $('#bkAddPh').onclick = () => bkAdd('photo'); $('#bkAddDoc').onclick = () => bkAdd('doc'); $('#bkAddNote').onclick = () => bkAdd('note');
  $('#bkScope').onchange = async (e) => { await bkFlush(); openBank(e.target.value); };
  $('#bkQ').oninput = (e) => { BK.q = e.target.value; bkRender(); };
  $('#bkFilters').onchange = (e) => {
    if (e.target.id === 'bkfType') BK.fType = e.target.value; if (e.target.id === 'bkfCat') BK.fCat = e.target.value;
    if (e.target.id === 'bkfLvl') BK.fLvl = e.target.value; if (e.target.id === 'bkfTodo') BK.fTodo = e.target.checked; bkRender();
  };
  $('#bkInfo').onclick = async (e) => { if (e.target.id === 'bkOpenProj') { await closeBank(); openProjectOfBat(BK.bat); } };
  $('#bkGrid').onclick = (e) => {
    const ck = e.target.closest('[data-ck]'); if (ck) { if (ck.checked) BK.checked.add(ck.dataset.ck); else BK.checked.delete(ck.dataset.ck); bkRender(); return; }
    const c = e.target.closest('.bk-card'); if (c) { BK.sel = c.dataset.id; $$('#bkGrid .bk-card').forEach(x => x.classList.toggle('on', x === c)); bkRenderDetail(); }
  };
  $('#bkGrid').ondblclick = (e) => { const c = e.target.closest('.bk-card'); const it = c && bkItems().find(i => i.id === c.dataset.id); if (it && it.type === 'photo') bkZoom(it); };
  $('#bkDetail').addEventListener('input', (e) => {
    const f = e.target.dataset.f; const it = bkItems().find(i => i.id === BK.sel); if (!f || !it) return;
    it[f] = e.target.value; if (f === 'niveau' || f === 'ref') it.aPlacer = it.aPlacer; bkMark();
    const card = $(`#bkGrid .bk-card[data-id="${CSS.escape(it.id)}"] .bk-tx`); if (card) { card.querySelector('b').textContent = it.titre || it.nom || 'Sans titre'; card.querySelector('small').textContent = [it.cat, it.niveau, it.ref].filter(Boolean).join(' · '); }
  });
  $('#bkDetail').addEventListener('change', (e) => { if (['cat', 'niveau'].includes(e.target.dataset.f)) bkRender(); });
  $('#bkDetail').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return; const it = bkItems().find(i => i.id === BK.sel); if (!it) return;
    const a = b.dataset.b;
    if (a === 'zoom') return bkZoom(it);
    if (a === 'place') return bkPlace([it.id]);
    if (a === 'placeAt') return bkPlace([it.id], true);
    if (a === 'show') { const p = bkInProject(it); await closeBank(); return showPhotoOnPlan(p.id); }
    if (a === 'copy') { const b64 = it.type === 'doc' ? it.data : String(it.url).split(',')[1]; const nm = it.type === 'doc' ? it.nom : `${safeName(it.titre || 'photo')}.jpg`; try { const p = await window.native.bank.saveCopy(nm, b64); if (p) toast('Copie enregistrée : ' + p); } catch (er) { toast(er.message, true); } return; }
    if (a === 'del') { if (!await confirmBox('Supprimer de la banque', `Supprimer « ${it.titre || it.nom} » de la banque de données ?`, 'Supprimer', true)) return; BK.data.items = bkItems().filter(i => i.id !== it.id); BK.sel = null; BK.checked.delete(it.id); bkMark(); bkRender(); }
  });
  $('#bkSelBar').onclick = async (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return; const ids = [...BK.checked];
    if (b.dataset.b === 'none') { BK.checked.clear(); return bkRender(); }
    if (b.dataset.b === 'placeSel') { const auto = ids.some(id => { const it = bkItems().find(i => i.id === id); return it && bkTarget(it); }); return bkPlace(ids, auto && await confirmBox('Placer sur le plan', 'Placer automatiquement les photos dont la référence indique le niveau et la case du quadrillage (ex. « RDC D.11 ») ? Les autres seront placées une à une, par un clic sur le plan.', 'Placer', false)); }
    if (b.dataset.b === 'catSel' || b.dataset.b === 'lvlSel') {
      const k = b.dataset.b === 'catSel' ? 'cat' : 'niveau'; const v = await askText(k === 'cat' ? 'Catégorie' : 'Niveau', `${k === 'cat' ? 'Catégorie' : 'Niveau'} des ${ids.length} élément(s)`, '');
      if (v === null) return; bkItems().forEach(i => { if (BK.checked.has(i.id)) i[k] = v.trim(); }); bkMark(); return bkRender();
    }
    if (b.dataset.b === 'delSel') { if (!await confirmBox('Supprimer de la banque', `Supprimer ${ids.length} élément(s) de la banque de données ?`, 'Supprimer', true)) return; BK.data.items = bkItems().filter(i => !BK.checked.has(i.id)); BK.checked.clear(); BK.sel = null; bkMark(); bkRender(); }
  };
  document.addEventListener('keydown', (e) => {
    if ($('#bankView').hidden || $('#modalRoot').children.length) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeBank(); }
  }, true);
})();
async function bkZoom(it) {
  await modal({ title: it.titre || 'Photo', size: '', body: `<div class="pv-img"><img src="${it.url}" alt=""></div>${it.ref || it.notes ? `<p class="muted" style="margin:6px 0 0">${esc([it.ref, it.notes].filter(Boolean).join(' — '))}</p>` : ''}`, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

/* ---------------------------------------------------------------- dossier client (.bkdossier) */
async function askDossierPassword(exporting) {
  const web = !!(window.native && window.native.web);
  const r = await modal({ title: exporting ? 'Protéger le dossier client' : 'Dossier protégé', size: 'md',
    body: exporting ? `<p style="margin:0">Choisissez un mot de passe de transfert : il sera demandé pour importer ce dossier ${web ? 'sur le PC' : 'sur une tablette ou une autre clé'}.</p>
      <label class="field"><span>Mot de passe (8 caractères au moins)</span><input id="dpA" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Confirmation</span><input id="dpB" type="password" autocomplete="new-password"></label>
      ${web ? '' : '<p class="muted" style="margin:0;font-size:12px">Laissez vide pour un dossier lisible uniquement par les clés USB de votre organisation (pas par la tablette).</p>'}`
      : `<p style="margin:0">Saisissez le mot de passe choisi lors de l'export de ce dossier.</p><label class="field"><span>Mot de passe du dossier</span><input id="dpA" type="password" autocomplete="off"></label>`,
    buttons: [{ label: 'Annuler', value: null }, { label: exporting ? 'Exporter' : 'Ouvrir', cls: 'primary', action: (root) => {
      const a = $('#dpA', root).value, b = exporting ? $('#dpB', root).value : a;
      if (!a && exporting && !web) return '';
      if (a.length < 8) { toast('Mot de passe : 8 caractères au moins.', true); return false; }
      if (a !== b) { toast('Les deux mots de passe sont différents.', true); return false; }
      return a; } }] });
  return r;
}
async function exportDossier(terrId) {
  if (!need('batiments')) return;
  if (S.dirty && S.project.batimentId && batFind(S.project.batimentId)?.t.id === terrId) toast('Le projet ouvert a des modifications non enregistrées : enregistrez-le pour les inclure.', true);
  const mdp = await askDossierPassword(true); if (mdp === null) return;
  try { const r = await window.native.dossier.exporter(terrId, mdp || null); if (r) toast(`Dossier client exporté${mdp ? ' (protégé par mot de passe)' : ''} : ${r.batiments} bâtiment(s), ${r.projets} projet(s), ${r.protocoles} protocole(s), ${r.banques} banque(s)`); }
  catch (e) { toast('Export impossible : ' + e.message, true); }
}
async function importDossier() {
  if (!need('batiments')) return;
  let mdp = null, reprise = false;
  for (;;) {
    try {
      const r = await window.native.dossier.importer(mdp, reprise); if (!r) return null;
      C.store = null; await loadBatiments(true); await bkRefreshList(); if (typeof pdsRefreshList === 'function') await pdsRefreshList();
      toast(`Client « ${r.nom} » importé : ${r.batiments} bâtiment(s), ${r.projets} projet(s), ${r.protocoles} protocole(s), ${r.banques} banque(s) de données`);
      return r;
    } catch (e) {
      if (/protégé par un mot de passe|Mot de passe du dossier incorrect/.test(e.message)) {
        if (/incorrect/.test(e.message)) toast(e.message, true);
        mdp = await askDossierPassword(false); if (!mdp) return null; reprise = true; continue;
      }
      toast('Import impossible : ' + e.message, true); return null;
    }
  }
}
