/* Blackeyes 2 — fiches des matériels Blackeyes.
   Une fiche par matériel de la base : description, caractéristiques techniques, pose, entretien, notes et documents
   joints (fiches constructeur scannées, notices PDF, photos). Données chiffrées sur la clé ; consultation pour tous,
   modification avec le droit « Base des matériels ». Export PDF d'une fiche ou de toutes les fiches. */
'use strict';

const FI = { data: null };
const FI_CARAC = ['Référence', 'Fabricant / marque', 'Alimentation', 'Autonomie', 'Communication', 'Portée radio', 'Portée de détection', 'Angle de détection',
  'Hauteur de pose', 'Indice de protection (IP)', 'Températures de fonctionnement', 'Dimensions', 'Poids', 'Couleurs', 'Certifications / normes'];
const fiAvailable = () => !!(window.native && window.native.fiches);
async function fiLoad(force = false) { if (!FI.data || force) { try { FI.data = await window.native.fiches.load(); } catch { FI.data = { version: 1, fiches: {} }; } } return FI.data; }

/* fiche d'un matériel : celle enregistrée, complétée par ce que la base des matériels connaît déjà */
function ficheOf(t) {
  const saved = (FI.data && FI.data.fiches[t.id]) || {};
  const base = { 'Portée radio': t.radio || '', 'Autonomie': t.auto || '', 'Portée de détection': t.det || (t.detRange ? `${t.detRange} m` : ''), 'Angle de détection': t.detAngle ? `${t.detAngle}°` : '' };
  const caracs = FI_CARAC.map(l => ({ l, v: '' }));
  for (const c of saved.caracs || []) { const x = caracs.find(y => y.l === c.l); if (x) x.v = c.v; else caracs.push({ l: c.l, v: c.v }); }
  for (const c of caracs) if (!c.v && base[c.l]) c.v = base[c.l];
  return { description: saved.description ?? (t.fn || ''), caracs, pose: saved.pose || '', entretien: saved.entretien || '', notes: saved.notes ?? (t.notes || ''), docs: saved.docs || [], maj: saved.maj || null, par: saved.par || '' };
}
const fiFilled = (f) => f.caracs.filter(c => c.v).length;

async function openFiches(typeId) {
  if (!fiAvailable()) { toast('Fiches des matériels : disponibles sur le logiciel PC et Mac.', true); return; }
  await fiLoad(true);
  let cur = typeId || (S.db[0] && S.db[0].id), edit = false, q = '';
  const body = document.createElement('div'); body.className = 'fi-wrap';
  const render = () => {
    const list = S.db.filter(t => !q || `${t.nom} ${t.code} ${t.sys}`.toLowerCase().includes(q.toLowerCase()));
    const t = S.db.find(x => x.id === cur); const f = t ? ficheOf(t) : null;
    body.innerHTML = `<div class="fi-list"><input class="fi-q" type="search" placeholder="Rechercher…" value="${esc(q)}">
        ${list.map(x => { const fx = ficheOf(x); return `<div class="cat-item ${x.id === cur ? 'active' : ''}" data-fid="${esc(x.id)}">
          <div class="ph">${x.img ? `<img src="${x.img}" alt="">` : ''}</div><div class="tx"><div class="nm">${esc(x.nom)}</div><div class="ty">${fiFilled(fx)} caractéristique(s)${fx.docs.length ? ` · ${fx.docs.length} doc.` : ''}</div></div>
          <span class="code" style="background:${esc(x.couleur)}">${esc(x.code)}</span></div>`; }).join('')}</div>
      <div class="fi-main">${!t ? '<p class="muted">Aucun matériel.</p>' : `
        <div class="fi-head"><div class="fi-ph">${t.img ? `<img src="${t.img}" alt="">` : ''}</div>
          <div><h2>${esc(t.nom)} <span class="code" style="background:${esc(t.couleur)}">${esc(t.code)}</span></h2><p class="muted" style="margin:2px 0 0">${esc(t.sys)} · ${esc(t.type || '')}</p>
          ${f.maj ? `<p class="muted" style="margin:2px 0 0;font-size:12px">Fiche mise à jour le ${esc(new Date(f.maj).toLocaleDateString('fr-FR'))}${f.par ? ' par ' + esc(f.par) : ''}</p>` : ''}</div></div>
        ${edit ? `
          <label class="field"><span>Description / fonction</span><textarea data-k="description" rows="3">${esc(f.description)}</textarea></label>
          <div class="fi-sec">Caractéristiques techniques</div>
          <div class="fi-grid">${f.caracs.map((c, i) => `<label class="field"><span>${esc(c.l)}</span><input data-c="${i}" type="text" value="${esc(c.v)}"></label>`).join('')}</div>
          <div class="btnrow"><button type="button" class="small ghost" data-a="addc">+ Autre caractéristique</button></div>
          <label class="field"><span>Pose et paramétrage (hauteur, orientation, précautions)</span><textarea data-k="pose" rows="3">${esc(f.pose)}</textarea></label>
          <label class="field"><span>Entretien / maintenance</span><textarea data-k="entretien" rows="2">${esc(f.entretien)}</textarea></label>
          <label class="field"><span>Notes</span><textarea data-k="notes" rows="2">${esc(f.notes)}</textarea></label>`
        : `${f.description ? `<p class="fi-desc">${esc(f.description)}</p>` : ''}
          <div class="fi-sec">Caractéristiques techniques</div>
          ${fiFilled(f) ? `<table class="fi-tab">${f.caracs.filter(c => c.v).map(c => `<tr><th>${esc(c.l)}</th><td>${esc(c.v)}</td></tr>`).join('')}</table>` : '<p class="muted">Pas encore renseignées. Joignez la fiche constructeur scannée, ou complétez avec « Modifier ».</p>'}
          ${f.pose ? `<div class="fi-sec">Pose et paramétrage</div><p class="fi-txt">${esc(f.pose)}</p>` : ''}
          ${f.entretien ? `<div class="fi-sec">Entretien</div><p class="fi-txt">${esc(f.entretien)}</p>` : ''}
          ${f.notes ? `<div class="fi-sec">Notes</div><p class="fi-txt">${esc(f.notes)}</p>` : ''}`}
        <div class="fi-sec">Documents joints (fiches scannées, notices)</div>
        ${f.docs.length ? `<div class="fi-docs">${f.docs.map(d => `<div class="fi-doc"><span class="fi-ic">${d.type === 'application/pdf' ? '📄' : '🖼'}</span><span class="fi-dn">${esc(d.nom)}<small>${Math.max(1, Math.round(d.taille / 1024))} Ko · ${esc(new Date(d.ajoute).toLocaleDateString('fr-FR'))}</small></span>
          <button class="small" data-a="view" data-d="${d.id}">Voir</button><button class="small ghost" data-a="save" data-d="${d.id}">Copie…</button>${can('base') ? `<button class="small danger" data-a="rm" data-d="${d.id}">Retirer</button>` : ''}</div>`).join('')}</div>` : '<p class="muted" style="margin:0">Aucun document.</p>'}
        <div class="btnrow" style="margin-top:12px">
          ${can('base') ? (edit ? '<button class="primary" data-a="save-f">Enregistrer la fiche</button><button data-a="cancel">Annuler</button>' : '<button data-a="edit">Modifier</button><button data-a="docs">Joindre des scans / documents…</button>') : ''}
          <button class="ghost" data-a="pdf">Exporter la fiche (PDF)</button></div>`}
      </div>`;
    const qi = $('.fi-q', body); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; render(); const n = $('.fi-q', body); n.focus(); n.setSelectionRange(pos, pos); };
  };
  const readForm = (t) => {
    const f = ficheOf(t);
    $$('[data-k]', body).forEach(el => { f[el.dataset.k] = el.value.trim(); });
    $$('[data-c]', body).forEach(el => { f.caracs[+el.dataset.c].v = el.value.trim(); });
    $$('[data-cl]', body).forEach(el => { const i = +el.dataset.cl; if (el.value.trim()) f.caracs[i].l = el.value.trim(); });
    return f;
  };
  const store = async (t, f) => { FI.data.fiches[t.id] = { description: f.description, caracs: f.caracs.filter(c => c.v), pose: f.pose, entretien: f.entretien, notes: f.notes, docs: f.docs, maj: new Date().toISOString(), par: S.user ? S.user.login : '' }; await window.native.fiches.save(FI.data); };
  body.addEventListener('click', async (e) => {
    const it = e.target.closest('[data-fid]'); if (it) { if (edit && !(await confirmBox('Fiche modifiée', 'Quitter sans enregistrer les modifications ?', 'Quitter'))) return; cur = it.dataset.fid; edit = false; render(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const t = S.db.find(x => x.id === cur); if (!t) return;
    try {
      switch (b.dataset.a) {
        case 'edit': edit = true; render(); break;
        case 'cancel': edit = false; render(); break;
        case 'addc': { const l = await askText('Nouvelle caractéristique', 'Nom de la caractéristique (ex. « Sensibilité », « Fréquence radio »)'); if (!l) return;
          const f = readForm(t); f.caracs.push({ l: l.trim(), v: '' }); FI.data.fiches[t.id] = { ...(FI.data.fiches[t.id] || {}), ...f, caracs: f.caracs }; render(); break; }
        case 'save-f': { const f = readForm(t); await store(t, f); edit = false; toast('Fiche enregistrée'); render(); break; }
        case 'docs': { const docs = await window.native.fiches.addDocs(); if (!docs.length) return; const f = ficheOf(t); f.docs = [...f.docs, ...docs]; await store(t, f); toast(`${docs.length} document(s) joint(s)`); render(); break; }
        case 'rm': { const f = ficheOf(t); const d = f.docs.find(x => x.id === b.dataset.d); if (!d || !(await confirmBox('Retirer le document', `Retirer « ${d.nom} » de la fiche ?`, 'Retirer', true))) return;
          f.docs = f.docs.filter(x => x.id !== d.id); await store(t, f); await window.native.fiches.removeDoc(d.id); render(); break; }
        case 'view': { const d = ficheOf(t).docs.find(x => x.id === b.dataset.d); if (d) await fiViewDoc(d); break; }
        case 'save': { const d = ficheOf(t).docs.find(x => x.id === b.dataset.d); if (d) { const p = await window.native.fiches.exportDoc(d.id, d.nom); if (p) toast('Copie enregistrée'); } break; }
        case 'pdf': await fiExportPdf([t]); break;
      }
    } catch (err) { console.error(err); toast(err.message, true); }
  });
  render();
  await modal({ title: '📄 Fiches des matériels Blackeyes', size: 'xl', body, left: [{ label: 'Exporter toutes les fiches (PDF)', action: async () => { await fiExportPdf(S.db); return false; } }],
    buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

async function fiDocBytes(d) { const b = await window.native.fiches.readDoc(d.id); return b instanceof Uint8Array ? b : new Uint8Array(b); }
async function fiViewDoc(d) {
  const bytes = await fiDocBytes(d); const box = document.createElement('div'); box.className = 'fi-view';
  if (d.type === 'application/pdf') {
    box.innerHTML = '<p class="muted">Chargement…</p>';
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; box.innerHTML = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) { const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 1.6 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; box.append(c); }
  } else { const u = URL.createObjectURL(new Blob([bytes], { type: d.type })); box.innerHTML = `<img src="${u}" alt="">`; }
  await modal({ title: d.nom, size: 'xl', body: box, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

/* export PDF : une fiche par page (A4), puis les documents image joints en pleine page */
async function fiExportPdf(types) {
  await fiLoad();
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const W = 210, Hh = 297, M = 14;
  const x = typeof docCtx === 'function' ? await docCtx() : { ch: {} }; const A = rgb(x.ch.couleur || '#c8102e');
  let first = true;
  for (const t of types) {
    const f = ficheOf(t); if (!first) doc.addPage(); first = false;
    doc.setFillColor(15, 23, 36); doc.rect(0, 0, W, 22, 'F'); doc.setFillColor(...A); doc.rect(0, 22, W, 1.2, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(t.nom, M, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Fiche matériel · ${t.code} · ${t.sys}`, W - M, 14, { align: 'right' });
    let y = 32;
    if (t.img) { try { const s = await imgSize(t.img); const b = 42, k = Math.min(b / s.w, b / s.h); doc.addImage(t.img, 'PNG', W - M - s.w * k, y, s.w * k, s.h * k); } catch {} }
    doc.setTextColor(18, 26, 38);
    const para = (txt, w = W - 2 * M - 48) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); const ls = doc.splitTextToSize(txt, w); doc.text(ls, M, y); y += ls.length * 4.6 + 2; };
    const sec = (s) => { y += 2; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...A); doc.text(s, M, y); doc.setDrawColor(...A); doc.line(M, y + 1.5, W - M, y + 1.5); y += 7; doc.setTextColor(18, 26, 38); };
    if (f.description) para(f.description);
    y = Math.max(y, 78); sec('Caractéristiques techniques');
    const rows = f.caracs.filter(c => c.v);
    if (rows.length) for (const c of rows) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(c.l, M, y); doc.setFont('helvetica', 'normal'); const ls = doc.splitTextToSize(c.v, W - 2 * M - 62); doc.text(ls, M + 62, y); y += Math.max(1, ls.length) * 4.4 + 1.6; if (y > Hh - 30) { doc.addPage(); y = 20; } }
    else { doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.text('À compléter (fiche constructeur).', M, y); y += 6; }
    for (const [s, v] of [['Pose et paramétrage', f.pose], ['Entretien', f.entretien], ['Notes', f.notes]]) if (v) { sec(s); para(v, W - 2 * M); if (y > Hh - 30) { doc.addPage(); y = 20; } }
    if (f.docs.length) { sec('Documents joints'); for (const d of f.docs) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(`• ${d.nom}`, M, y); y += 5; } }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`${x.ch.organisme || 'Blackeyes 2'} — ${f.maj ? 'mise à jour le ' + new Date(f.maj).toLocaleDateString('fr-FR') : 'fiche non renseignée'}`, M, Hh - 8);
    for (const d of f.docs.filter(d => d.type !== 'application/pdf')) {
      try { const u = 'data:' + d.type + ';base64,' + bytesToB64(await fiDocBytes(d)); const s = await imgSize(u); doc.addPage(); const k = Math.min((W - 2 * M) / s.w, (Hh - 2 * M - 8) / s.h);
        doc.setFontSize(8); doc.setTextColor(90); doc.text(`${t.nom} — ${d.nom}`, M, M - 4); doc.addImage(u, d.type === 'image/png' ? 'PNG' : 'JPEG', M, M, s.w * k, s.h * k); } catch {}
    }
  }
  const data = new Uint8Array(doc.output('arraybuffer'));
  const name = types.length === 1 ? `Fiche ${safeName(types[0].nom)}.pdf` : 'Fiches des matériels Blackeyes.pdf';
  const p = await window.native.saveFile({ purpose: 'pdf', title: 'Exporter les fiches', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }], data });
  if (p) toast('Fiches exportées');
}
function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
