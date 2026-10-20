/* Blackeyes Implantation — onglet « Clients » : tout ce qui concerne un client, au même endroit.
   Regroupe par client : bâtiments de la carte, projets enregistrés sur la clé, devis et factures,
   rendez-vous de l'agenda. Recherche globale dans tous ces éléments. */
'use strict';

const CL = { list: [], sel: null, q: '', loading: false, projets: [] };
const clNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SANS = '__sans__';

async function clCollect() {
  CL.loading = true;
  const map = new Map();
  const get = (nom) => {
    const k = clNorm(nom) || SANS;
    if (!map.has(k)) map.set(k, { key: k, nom: k === SANS ? 'Sans client indiqué' : String(nom).trim(), terr: [], fiche: null, projets: [], docs: [], events: [] });
    return map.get(k);
  };
  // carte
  try { await loadBatiments(true); } catch {}
  for (const t of (C.store || [])) get(t.nom).terr.push(t);
  // projets enregistrés
  try { CL.projets = await window.native.projets.index(); } catch (e) { CL.projets = []; toast('Liste des projets indisponible : ' + e.message, true); }
  for (const p of CL.projets) {
    let nom = p.client; if (!nom && p.batimentId) { const f = batFind(p.batimentId); if (f) nom = f.t.nom; }
    get(nom || '').projets.push(p);
  }
  // devis et factures
  if (can('facturation')) {
    try { if (await fxLoad()) {
      for (const c of FX.data.clients || []) get(c.nom).fiche = c;
      for (const d of FX.data.docs || []) get(d.client && d.client.nom).docs.push(d);
    } } catch {}
  }
  // agenda
  try { await agLoad(true); for (const e of AG.data.events) get(e.client).events.push(e); } catch {}
  await pdsRefreshList(); await bkRefreshList();
  CL.list = [...map.values()].sort((a, b) => (a.key === SANS) - (b.key === SANS) || a.nom.localeCompare(b.nom, 'fr'));
  CL.loading = false;
}

/* tous les éléments d'un client, pour la recherche */
function clItems(c) {
  const out = [];
  out.push({ kind: 'client', label: c.nom, txt: [c.nom, c.fiche && [c.fiche.attention, c.fiche.adresse, c.fiche.cp, c.fiche.ville, c.fiche.email, c.fiche.tel].join(' ')].join(' ') });
  for (const t of c.terr) { out.push({ kind: 'commune', label: t.commune && t.commune.nom, txt: t.commune && t.commune.nom });
    for (const b of t.batiments) out.push({ kind: 'bat', id: b.id, label: b.nom, sub: b.adresse, txt: `${b.nom} ${b.type} ${b.adresse} ${b.alarme || ''} ${b.notes || ''}` }); }
  for (const p of c.projets) out.push({ kind: 'projet', id: p.path, label: p.name || p.fichier, sub: [p.site, p.reference && `réf. ${p.reference}`].filter(Boolean).join(' · '), txt: `${p.name} ${p.site} ${p.reference} ${p.fichier} ${(p.niveaux || []).join(' ')}` });
  for (const d of c.docs) out.push({ kind: d.type, id: d.id, label: `${d.type === 'devis' ? 'Devis' : 'Facture'} ${d.numero || '(brouillon)'}`, sub: d.objet, txt: `${d.numero} ${d.objet} ${d.type}` });
  for (const e of c.events) out.push({ kind: 'rdv', id: e.id, label: e.titre || AG_TYPES[e.type]?.label, sub: `${frDate(e.date)} ${e.journee ? '' : e.debut || ''}`, txt: `${e.titre} ${e.lieu} ${e.contact} ${e.tel} ${e.email} ${e.projet} ${e.notes}` });
  return out;
}
const KIND = { client: 'Client', commune: 'Commune', bat: 'Bâtiment', projet: 'Projet', devis: 'Devis', facture: 'Facture', rdv: 'Agenda' };
function clMatches(c) { if (!CL.q) return []; const q = clNorm(CL.q); return clItems(c).filter(it => clNorm(it.txt).includes(q)); }

/* ---------------------------------------------------------------- ouverture */
async function openClients(selKey) {
  if (!S.user) return;
  $('#clientsView').hidden = false; $('#clMain').innerHTML = '<p class="muted" style="padding:20px">Chargement des clients…</p>'; $('#clList').innerHTML = '';
  await clCollect();
  if (selKey) CL.sel = selKey;
  if (!CL.sel || !CL.list.some(c => c.key === CL.sel)) CL.sel = (CL.list.find(c => c.key !== SANS) || CL.list[0] || {}).key || null;
  clRender(); setTimeout(() => $('#clQ').focus(), 50);
}
function closeClients() { $('#clientsView').hidden = true; }

function clRender() { clRenderList(); clRenderMain(); }
function clRenderList() {
  const shown = CL.q ? CL.list.filter(c => clMatches(c).length) : CL.list;
  const n = (c) => ({ b: c.terr.reduce((a, t) => a + t.batiments.length, 0), p: c.projets.length, d: c.docs.length, e: c.events.filter(e => e.date >= agToday() && e.statut === 'prevu').length });
  $('#clList').innerHTML = shown.map(c => { const k = n(c); const m = CL.q ? clMatches(c).length : 0;
    return `<button type="button" class="cl-it${c.key === CL.sel ? ' on' : ''}${c.key === SANS ? ' sans' : ''}" data-k="${esc(c.key)}">
      <b>${esc(c.nom)}</b><small>${esc([...new Set(c.terr.map(t => t.commune && t.commune.nom).filter(Boolean))].join(', ') || (c.fiche && c.fiche.ville) || '')}</small>
      <span class="cl-cnt">${k.b ? `<i title="Bâtiments">🏢 ${k.b}</i>` : ''}${k.p ? `<i title="Projets">📁 ${k.p}</i>` : ''}${k.d ? `<i title="Devis et factures">€ ${k.d}</i>` : ''}${k.e ? `<i title="Rendez-vous à venir">📅 ${k.e}</i>` : ''}${m ? `<i class="m" title="Éléments trouvés">🔎 ${m}</i>` : ''}</span></button>`; }).join('')
    || `<p class="muted" style="padding:12px">${CL.q ? 'Aucun résultat.' : 'Aucun client. Ajoutez-en depuis la carte (« + Client »), un projet, un devis ou l\'agenda.'}</p>`;
  $('#clCount').textContent = `${CL.list.filter(c => c.key !== SANS).length} client(s)`;
}
function clRenderMain() {
  const main = $('#clMain'); const c = CL.list.find(x => x.key === CL.sel);
  if (CL.q) {
    const res = CL.list.flatMap(cl => clMatches(cl).map(it => ({ ...it, c: cl })));
    const showFiche = c && clMatches(c).length;
    main.innerHTML = `<div class="cl-fiche"><section class="cl-sec"><h3>Résultats pour « ${esc(CL.q)} » (${res.length})</h3>
      ${res.length ? `<div class="cl-res">${res.slice(0, 200).map(it => `<button type="button" class="cl-r" data-go="${esc(it.c.key)}" data-kind="${it.kind}" data-id="${esc(it.id || '')}">
        <span class="kd ${it.kind}">${KIND[it.kind]}</span><span class="tx"><b>${esc(it.label || '—')}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span><span class="cn">${esc(it.c.nom)}</span></button>`).join('')}</div>` : '<p class="muted">Rien trouvé dans les clients, bâtiments, projets, devis, factures et rendez-vous.</p>'}</section></div>
      ${showFiche ? clFiche(c) : ''}`;
  } else main.innerHTML = c ? clFiche(c) : '<p class="muted" style="padding:20px">Sélectionnez un client.</p>';
  clBindMain(c);
}
const clStat = (s) => (typeof STAT !== 'undefined' && STAT[s]) || { label: s || '—', color: '#64748b' };
function clFiche(c) {
  const f = c.fiche; const td = agToday();
  const bats = c.terr.flatMap(t => t.batiments.map(b => ({ b, t })));
  const evNext = c.events.filter(e => e.date >= td).sort((a, b) => a.date.localeCompare(b.date) || agMin(a.debut) - agMin(b.debut));
  const evPast = c.events.filter(e => e.date < td).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const projs = c.projets.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  const docs = c.docs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<div class="cl-fiche">
    <header class="cl-head"><div><h2>${esc(c.nom)}</h2>
      <p class="muted">${esc([...new Set(c.terr.map(t => t.commune && t.commune.nom).filter(Boolean))].join(', ')) || (c.key === SANS ? 'Éléments enregistrés sans nom de client' : 'Commune non renseignée sur la carte')}</p>
      ${f ? `<p class="cl-coord">${esc([f.attention, f.adresse, [f.cp, f.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}${f.tel ? ` · ☎ ${esc(f.tel)}` : ''}${f.email ? ` · ${esc(f.email)}` : ''}</p>` : ''}</div>
      <div class="btnrow">${c.key !== SANS ? `<button type="button" class="primary" data-a="newproj">+ Projet pour ce client</button><button type="button" data-a="newrdv">+ Rendez-vous</button>` : ''}
        ${c.terr.length ? `<button type="button" data-a="carte">Voir sur la carte</button><button type="button" data-a="bank" title="Photos, documents et notes communs au client">🗂 Banque du client${bkCount(c.terr[0].id) ? ` (${bkCount(c.terr[0].id)})` : ''}</button>${can('batiments') ? '<button type="button" data-a="export" title="Client, bâtiments, projets, protocoles et banques dans un seul fichier (.bkdossier)">Exporter le dossier…</button>' : ''}` : ''}${can('facturation') ? '<button type="button" data-a="fact">Devis & factures</button>' : ''}
        ${c.key !== SANS ? '<button type="button" class="danger" data-a="del">Supprimer ce client…</button>' : ''}</div></header>
    <div class="cl-kpis"><div><b>${bats.length}</b><span>bâtiment(s)</span></div><div><b>${projs.length}</b><span>projet(s)</span></div>
      ${can('facturation') ? `<div><b>${docs.filter(d => d.type === 'devis').length}</b><span>devis</span></div><div><b>${docs.filter(d => d.type === 'facture').length}</b><span>facture(s)</span></div>` : ''}
      <div><b>${evNext.filter(e => e.statut === 'prevu').length}</b><span>rendez-vous à venir</span></div></div>

    <section class="cl-sec"><h3>Bâtiments ${c.terr.length > 1 ? '' : c.terr[0] ? `— ${esc(c.terr[0].commune?.nom || '')}` : ''}</h3>
      ${bats.length ? `<table class="cl-t"><thead><tr><th>Bâtiment</th><th>Adresse</th><th>Statut</th><th>Projet rattaché</th><th>Protocole de sûreté</th><th>Banque de données</th></tr></thead><tbody>${bats.map(({ b }) => `<tr>
        <td><b>${esc(b.nom)}</b><div class="muted">${esc(b.type || '')}</div></td><td>${esc(b.adresse || '—')}</td>
        <td><span class="cl-st" style="--c:${clStat(b.statut).color}">${esc(clStat(b.statut).label)}</span></td>
        <td>${b.projet ? `<button type="button" class="small" data-bat="${esc(b.id)}">Ouvrir ${esc(b.projet.fichier || 'le projet')}</button><div class="muted">${b.projet.total || 0} matériel(s)</div>` : '<span class="muted">—</span>'}</td>
        <td>${PDS.list[b.id] ? `<button type="button" class="small primary" data-pds="${esc(b.id)}">🛡 Ouvrir</button><div class="muted">modifié le ${new Date(PDS.list[b.id]).toLocaleDateString('fr-FR')}</div>` : can('batiments') ? `<button type="button" class="small" data-pds="${esc(b.id)}">🛡 Créer</button>` : '<span class="muted">—</span>'}</td>
        <td><button type="button" class="small" data-bank="${esc(b.id)}">🗂 ${bkCount(b.id) ? `Ouvrir (${bkCount(b.id)})` : 'Ouvrir'}</button>${BK.list[b.id] && BK.list[b.id].photos ? `<div class="muted">${BK.list[b.id].photos} photo(s)</div>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<p class="muted">${c.terr.length ? 'Aucun bâtiment : ajoutez-les depuis la carte.' : 'Ce client n\'est pas sur la carte. Ajoutez-le avec « Carte » > « + Client » sous le même nom.'}</p>`}</section>

    <section class="cl-sec"><h3>Projets enregistrés sur la clé</h3>
      ${projs.length ? `<table class="cl-t"><thead><tr><th>Projet</th><th>Référence</th><th>Niveaux</th><th class="n">Matériels</th><th>Enregistré</th><th></th></tr></thead><tbody>${projs.map(p => `<tr>
        <td><b>${esc(p.name || p.fichier)}</b><div class="muted">${esc(p.site || '')}${p.illisible ? ' · illisible' : ''}</div></td><td>${esc(p.reference ? `${p.reference} ind. ${p.indice || 'A'}` : '—')}</td>
        <td>${esc((p.niveaux || []).join(', ') || '—')}</td><td class="n">${p.materiels ?? '—'}</td><td>${p.savedAt ? esc(new Date(p.savedAt).toLocaleDateString('fr-FR')) : '—'}</td>
        <td>${p.illisible ? '' : `<button type="button" class="small primary" data-proj="${esc(p.path)}">Ouvrir</button>`}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Aucun projet enregistré pour ce client (dossier « Projets » de la clé). Renseignez le champ « Client » du projet avant de l\'enregistrer.</p>'}</section>

    ${can('facturation') ? `<section class="cl-sec"><h3>Devis et factures</h3>
      ${docs.length ? `<table class="cl-t"><thead><tr><th>Numéro</th><th>Date</th><th>Objet</th><th class="n">Total TTC</th><th>Statut</th></tr></thead><tbody>${docs.map(d => { const st = fxStatus(d); return `<tr class="clk" data-doc="${esc(d.type)}">
        <td><b>${esc(d.type === 'devis' ? 'Devis' : 'Facture')} ${esc(d.numero || '(brouillon)')}</b></td><td>${esc(frDate(d.date))}</td><td>${esc(d.objet || '')}</td>
        <td class="n">${euro(totaux(d).ttc)}</td><td><span class="chipp ${statusCls(st)}">${esc(st)}</span></td></tr>`; }).join('')}</tbody></table>`
        : '<p class="muted">Aucun devis ni facture pour ce client.</p>'}</section>` : ''}

    <section class="cl-sec"><h3>Agenda</h3>
      ${evNext.length || evPast.length ? `${evNext.length ? `<h4>À venir</h4>${evNext.map(e => `<div class="cl-ev">${esc(agLongDate(e.date))}</div>${agRow(e)}`).join('')}` : ''}
        ${evPast.length ? `<h4>Derniers rendez-vous</h4>${evPast.map(e => `<div class="cl-ev">${esc(agLongDate(e.date))}</div>${agRow(e)}`).join('')}` : ''}`
        : '<p class="muted">Aucun rendez-vous avec ce client.</p>'}</section>
  </div>`;
}
function clBindMain(c) {
  const main = $('#clMain');
  main.onclick = async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const cl = CL.list.find(x => x.key === go.dataset.go); const kind = go.dataset.kind, id = go.dataset.id;
      if (kind === 'projet') return clOpenProject(id);
      if (kind === 'rdv') { const ev = AG.data.events.find(x => x.id === id); if (ev) { await agEdit(ev); await clCollect(); clRender(); } return; }
      if (kind === 'devis' || kind === 'facture') { closeClients(); return openFacturation(kind); }
      CL.sel = cl.key; CL.q = ''; $('#clQ').value = ''; clRender(); return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'newproj') {
      if (!(await guardUnsaved())) return;
      S.project = newProject(); S.project.client = c.nom; S.project.name = `Nouveau projet — ${c.nom}`; S.levelId = null; S.selId = null; S.history = []; S.future = [];
      setDirty(false); renderAll(); closeClients(); toast(`Projet créé pour ${c.nom} : importez maintenant un plan.`); return;
    }
    if (a === 'newrdv') { await agEdit(null, { client: c.nom, lieu: c.fiche ? [c.fiche.adresse, c.fiche.ville].filter(Boolean).join(', ') : '' }); await clCollect(); clRender(); return; }
    if (a === 'carte') { const t = c.terr[0]; closeClients(); await openCarte(); if (t && C.tId !== t.id) await showTerritoire(t.id); return; }
    if (a === 'fact') { closeClients(); return openFacturation('devis'); }
    if (a === 'del') return clDelete(c);
    if (a === 'bank') { closeClients(); return openBank(c.terr[0].id); }
    if (a === 'export') { for (const t of c.terr) await exportDossier(t.id); return; }
    const bk = e.target.closest('[data-bank]'); if (bk) { closeClients(); return openBank(bk.dataset.bank); }
    const pd = e.target.closest('[data-pds]'); if (pd) { closeClients(); return openPds(pd.dataset.pds); }
    const pj = e.target.closest('[data-proj]'); if (pj) return clOpenProject(pj.dataset.proj);
    const bt = e.target.closest('[data-bat]'); if (bt) { const f = batFind(bt.dataset.bat); if (f) { closeClients(); return openProjectOfBat(f.b); } }
    const dc = e.target.closest('[data-doc]'); if (dc) { closeClients(); return openFacturation(dc.dataset.doc); }
    const ev = e.target.closest('[data-ev]'); if (ev) { const x = AG.data.events.find(y => y.id === ev.dataset.ev); if (x) { await agEdit(x); await clCollect(); clRender(); } }
  };
}
/* suppression d'un client : l'utilisateur choisit ce qui est supprimé */
async function clDelete(c) {
  const bats = c.terr.reduce((n, t) => n + t.batiments.length, 0);
  const devis = c.docs.filter(d => d.type === 'devis'), factE = c.docs.filter(d => d.type === 'facture' && d.numero), factB = c.docs.filter(d => d.type === 'facture' && !d.numero);
  const opts = [
    { k: 'carte', ok: c.terr.length && can('batiments'), on: true, label: `Le retirer de la carte, avec ses ${bats} bâtiment(s)`, why: !can('batiments') && c.terr.length ? 'droit « Bâtiments de la carte » nécessaire' : '' },
    { k: 'fiche', ok: !!c.fiche && can('facturation'), on: true, label: 'Sa fiche dans le fichier clients (coordonnées)' },
    { k: 'devis', ok: (devis.length + factB.length) > 0 && can('facturation'), on: false, label: `Ses devis (${devis.length})${factB.length ? ` et factures non émises (${factB.length})` : ''}` },
    { k: 'rdv', ok: c.events.length > 0, on: false, label: `Ses rendez-vous dans l'agenda (${c.events.length})` },
    { k: 'bank', ok: c.terr.length > 0 && can('batiments') && c.terr.some(t => bkCount(t.id) || t.batiments.some(b => bkCount(b.id))), on: false, label: 'Ses banques de données (photos, documents et notes du client et de ses bâtiments)' },
    { k: 'proj', ok: c.projets.length > 0 && can('projets'), on: false, label: `Ses projets (${c.projets.length}) : déplacés dans le dossier BlackeyesData\\Corbeille de la clé, récupérables` }
  ].filter(o => o.ok || o.why);
  if (!opts.length && !factE.length) { toast('Rien à supprimer pour ce client.', true); return; }
  const r = await modal({ title: `Supprimer le client « ${c.nom} »`, size: 'md', body: `<p style="margin:0">Choisissez ce qui doit être supprimé :</p>
      <div class="cl-delopts">${opts.map(o => `<label class="chk${o.ok ? '' : ' off'}"><input type="checkbox" data-del="${o.k}" ${o.ok && o.on ? 'checked' : ''} ${o.ok ? '' : 'disabled'}> ${esc(o.label)}${o.why ? ` <small class="muted">(${esc(o.why)})</small>` : ''}</label>`).join('')}</div>
      ${factE.length ? `<div class="info">${factE.length} facture(s) émise(s) (${esc(factE.map(d => d.numero).join(', '))}) : conservée(s), comme l'exige la loi (numérotation continue et conservation 10 ans).</div>` : ''}
      <p class="muted" style="margin:0;font-size:12px">Ce qui n'est pas coché est conservé. La suppression est définitive, sauf pour les projets placés dans la corbeille.</p>`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Supprimer', cls: 'danger', action: (root) => { const set = new Set($$('[data-del]:checked', root).map(x => x.dataset.del)); if (!set.size) { toast('Cochez au moins un élément.', true); return false; } return set; } }] });
  if (!r) return;
  if (!await confirmBox('Confirmer la suppression', `Supprimer définitivement les éléments cochés pour « ${c.nom} » ?`, 'Supprimer', true)) return;
  const done = [], errs = [];
  if (r.has('carte')) { for (const t of c.terr) { try { await window.native.carte.territoire('supprimer', t.id); } catch (e) { errs.push(e.message); } } C.store = null; C.data = null; C.tId = null; done.push('carte'); }
  if (r.has('fiche') || r.has('devis')) {
    try { await fxLoad(); const k = c.key;
      if (r.has('fiche')) FX.data.clients = FX.data.clients.filter(x => clNorm(x.nom) !== k);
      if (r.has('devis')) FX.data.docs = FX.data.docs.filter(d => !(clNorm(d.client && d.client.nom) === k && (d.type === 'devis' || !d.numero)));
      await fxSave('Suppression du client', c.nom); if (r.has('fiche')) done.push('fiche client'); if (r.has('devis')) done.push('devis');
    } catch (e) { errs.push(e.message); }
  }
  if (r.has('bank')) { try { await window.native.bank.remove(c.terr.flatMap(t => [t.id, ...t.batiments.map(b => b.id)])); done.push('banques de données'); } catch (e) { errs.push(e.message); } }
  if (r.has('rdv')) { try { await agLoad(true); AG.data.events = AG.data.events.filter(e => clNorm(e.client) !== c.key); await agSave(); done.push('rendez-vous'); } catch (e) { errs.push(e.message); } }
  if (r.has('proj')) {
    try { const moved = await window.native.projets.trash(c.projets.map(p => p.path)); done.push(`${moved.length} projet(s) à la corbeille`);
      if (S.project && S.project.path && c.projets.some(p => p.path === S.project.path)) { S.project.path = null; setDirty(true); }
    } catch (e) { errs.push(e.message); }
  }
  if (errs.length) toast('Suppression partielle : ' + errs.join(' · '), true); else toast(`Client « ${c.nom} » : ${done.join(', ')} supprimé(s).`);
  CL.sel = null; await clCollect(); if (!CL.list.some(x => x.key === c.key)) CL.sel = null; clRender();
}
async function clOpenProject(p) {
  if (!(await guardUnsaved())) return;
  try { const f = await window.native.projets.open(p); closeClients(); loadProjectFile(f); }
  catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- liaisons */
(function bindClients() {
  $('#bClients').onclick = () => openClients();
  $('#clClose').onclick = closeClients;
  $('#clImport').onclick = async () => { const r = await importDossier(); if (r) { await clCollect(); const c = CL.list.find(x => x.terr.some(t => t.id === r.id)); if (c) CL.sel = c.key; clRender(); } };
  $('#clRefresh').onclick = async () => { await clCollect(); clRender(); toast('Liste des clients actualisée'); };
  $('#clList').onclick = (e) => { const it = e.target.closest('[data-k]'); if (!it) return; CL.sel = it.dataset.k; clRender(); };
  const q = $('#clQ'); q.oninput = () => { CL.q = q.value.trim(); clRender(); };
  document.addEventListener('keydown', (e) => {
    if ($('#clientsView').hidden || $('#modalRoot').children.length || !$('#authScreen').hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); if (CL.q) { CL.q = ''; $('#clQ').value = ''; clRender(); } else closeClients(); }
  }, true);
})();
