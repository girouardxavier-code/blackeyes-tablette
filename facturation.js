/* Blackeyes Implantation — devis et factures (1.7)
   Données chiffrées dans BlackeyesData\facturation.json (droit « Devis et factures »).
   - Devis : numérotés à la création (DEV-AAAA-NNNN), statut brouillon / envoyé / accepté / refusé.
   - Factures : brouillon puis « Émettre » : numéro continu (FAC-AAAA-NNNN), ensuite non modifiable
     et non supprimable (contrôlé aussi par le processus principal). Statut payé / en retard.
   - Lignes : matériels de la base (avec tarif), prestations, lignes libres, titres de section ;
     import du quantitatif du projet ouvert. Édition PDF A4. */
'use strict';

const FX = { data: null };
const TVA_DEF = 20;
const STATUTS_DEVIS = { brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé' };
const PRESTA_DEF = () => [
  { id: 'p-m2m', nom: 'Abonnement M2M 12 mois', desc: 'Reconduction possible. Permet le nomadisme de l\'ensemble des dispositifs BLACKEYES.', prix: 199, unite: 'unité' },
  { id: 'p-inst', nom: 'Installation et configuration des dispositifs', desc: '', prix: 1000, unite: 'forfait' },
  { id: 'p-conf', nom: 'Configuration des dispositifs et ajout du premier utilisateur', desc: '', prix: 200, unite: 'forfait' },
  { id: 'p-liv', nom: 'Livraison', desc: '', prix: 80, unite: 'forfait' }
];
const fxDefault = () => ({
  v: 1,
  emetteur: { nom: '', service: '', adresse: '', cp: '', ville: '', tel: '', email: '', web: '', contact: '', siret: '', tvaIntra: '', rcs: '', capital: '', forme: '', banque: '', iban: '', bic: '' },
  conditions: {
    validiteJours: 30, echeanceJours: 30, reglement: 'Virement bancaire', delai: 'À réception de facture',
    penalites: 'En cas de retard de paiement : pénalités au taux d\'intérêt légal majoré de 10 points (art. L441-10 du Code de commerce) et indemnité forfaitaire pour frais de recouvrement de 40 € (art. D441-5). Pas d\'escompte pour paiement anticipé.',
    mentionDevis: '', mentionFacture: ''
  },
  prefixes: { devis: 'DEV', facture: 'FAC' }, compteurs: {},
  prestations: PRESTA_DEF(),
  clients: [],
  docs: []
});

/* ---------------------------------------------------------------- calculs */
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const num0 = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const ligneHT = (l) => l.kind === 'titre' ? 0 : r2(num0(l.qte) * num0(l.pu) * (1 - num0(l.remise) / 100));
function totaux(doc) {
  const tva = {}; let ht = 0;
  for (const l of doc.lignes) { if (l.kind === 'titre') continue; const h = ligneHT(l); ht += h; const t = num0(l.tva); tva[t] = r2((tva[t] || 0) + h * t / 100); }
  ht = r2(ht); const tt = r2(Object.values(tva).reduce((a, b) => a + b, 0));
  return { ht, tva, totalTva: tt, ttc: r2(ht + tt) };
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fxStatus = (d) => {
  if (d.type === 'devis') return STATUTS_DEVIS[d.statut || 'brouillon'];
  if (!d.numero) return 'Brouillon';
  if (d.paiement) return 'Payée';
  return d.echeance && d.echeance < today() ? 'En retard' : 'Émise';
};
const statusCls = (s) => ({ 'Payée': 'ok', 'Accepté': 'ok', 'En retard': 'dis', 'Refusé': 'dis', 'Brouillon': 'off' }[s] || '');
function nextNumber(type, iso) {
  const y = (iso || today()).slice(0, 4); const p = (FX.data.prefixes[type] || (type === 'devis' ? 'DEV' : 'FAC')).trim();
  const k = `${p}-${y}`; FX.data.compteurs[k] = (FX.data.compteurs[k] || 0) + 1;
  return `${k}-${String(FX.data.compteurs[k]).padStart(4, '0')}`;
}

/* ---------------------------------------------------------------- stockage */
async function fxLoad() {
  let d = null; try { d = await window.native.fact.load(); } catch (e) { toast(e.message, true); return false; }
  FX.data = d && Array.isArray(d.docs) ? { ...fxDefault(), ...d } : fxDefault();
  if (!d) { try { const ch = await window.native.charte.load(); FX.data.emetteur.nom = ch.organisme || ''; FX.data.emetteur.service = ch.service || ''; } catch {} }
  return true;
}
async function fxSave(action, detail) {
  try { await window.native.fact.save(FX.data, action ? { action, detail } : null); return true; }
  catch (e) { toast(e.message, true); await fxLoad(); return false; }
}

/* ---------------------------------------------------------------- lignes depuis la base / le projet */
const lineFromType = (t, qte = 1) => ({ id: uid(), kind: 'materiel', typeId: t.id, designation: t.nom, description: [t.type, t.fn].filter(Boolean).join(' — '), qte, unite: 'unité', pu: t.prix ?? 0, remise: 0, tva: TVA_DEF });
const lineFromPresta = (p) => ({ id: uid(), kind: 'presta', prestaId: p.id, designation: p.nom, description: p.desc || '', qte: 1, unite: p.unite || 'forfait', pu: p.prix ?? 0, remise: 0, tva: TVA_DEF });
function linesFromProject() {
  const out = []; const by = {};
  for (const l of S.project.levels) for (const m of l.markers) by[m.typeId] = (by[m.typeId] || 0) + 1;
  for (const sys of SYSTEMS) {
    const ts = Object.keys(by).map(typeOf).filter(t => t && !t.horsDevis && (SYSTEMS.includes(t.sys) ? t.sys : 'Autre') === sys);
    if (!ts.length) continue;
    out.push({ id: uid(), kind: 'titre', designation: sys });
    ts.forEach(t => out.push(lineFromType(t, by[t.id])));
  }
  return out;
}
const projectRef = () => S.project && S.project.levels.length ? { nom: S.project.name, site: S.project.site || '' } : null;

/* ---------------------------------------------------------------- fenêtre principale */
async function openFacturation(tab = 'devis') {
  if (!need('facturation')) return;
  if (!(await fxLoad())) return;
  const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-height:440px';
  let q = '';
  const tabs = [['devis', 'Devis'], ['facture', 'Factures'], ['clients', 'Clients'], ['prestations', 'Prestations'], ['params', 'Paramètres']];
  const render = () => {
    const head = `<div class="tabsbar">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'devis' || k === 'facture' ? ` (${FX.data.docs.filter(d => d.type === k).length})` : ''}</button>`).join('')}</div>`;
    if (tab === 'devis' || tab === 'facture') {
      const docs = FX.data.docs.filter(d => d.type === tab && (!q || `${d.numero} ${d.client?.nom} ${d.objet}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.numero || '').localeCompare(a.numero || ''));
      const totTTC = docs.reduce((a, d) => a + totaux(d).ttc, 0);
      body.innerHTML = head + `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="primary" data-a="new">+ ${tab === 'devis' ? 'Nouveau devis' : 'Nouvelle facture'}</button>
          ${projectRef() ? `<button data-a="newProj">+ ${tab === 'devis' ? 'Devis' : 'Facture'} depuis le projet ouvert</button>` : ''}
          <input id="fxQ" type="search" placeholder="Rechercher (numéro, client, objet)" value="${esc(q)}" style="flex:1;min-width:200px"></div>
        <div style="overflow:auto;max-height:58vh"><table class="users"><thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th>Objet</th><th class="n">Total HT</th><th class="n">Total TTC</th><th>Statut</th><th></th></tr></thead><tbody>
        ${docs.map(d => { const t = totaux(d), st = fxStatus(d); return `<tr>
          <td><b>${esc(d.numero || '—')}</b>${d.devisRef ? `<div class="muted" style="font-size:11px">devis ${esc(d.devisRef)}</div>` : ''}</td><td>${esc(frDate(d.date))}</td><td>${esc(d.client?.nom || '')}</td><td>${esc(d.objet || '')}</td>
          <td class="n">${euro(t.ht)}</td><td class="n"><b>${euro(t.ttc)}</b></td>
          <td><span class="chipp ${statusCls(st)}">${esc(st)}</span>${d.type === 'facture' && d.echeance && d.numero && !d.paiement ? `<div class="muted" style="font-size:11px">échéance ${esc(frDate(d.echeance))}</div>` : ''}</td>
          <td><div class="btnrow" style="justify-content:flex-end;flex-wrap:nowrap">
            <button class="small" data-a="open" data-id="${d.id}">${d.type === 'facture' && d.numero ? 'Voir' : 'Modifier'}</button>
            <button class="small" data-a="pdf" data-id="${d.id}">PDF</button>
            <button class="small" data-a="dup" data-id="${d.id}" title="Créer une copie">Dupliquer</button>
            ${d.type === 'devis' ? `<button class="small" data-a="bill" data-id="${d.id}" title="Créer la facture de ce devis">Facturer</button>` : ''}
            ${d.type === 'facture' && d.numero && !d.paiement ? `<button class="small" data-a="paid" data-id="${d.id}">Payée</button>` : ''}
            ${!(d.type === 'facture' && d.numero) ? `<button class="small danger" data-a="del" data-id="${d.id}">Supprimer</button>` : ''}</div></td></tr>`; }).join('') || `<tr><td colspan="8" class="muted">Aucun ${tab === 'devis' ? 'devis' : 'facture'}.</td></tr>`}
        </tbody>${docs.length ? `<tfoot><tr><td colspan="5">Total (${docs.length})</td><td class="n">${euro(totTTC)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div>`;
      const qi = $('#fxQ', body); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; render(); const n = $('#fxQ', body); n.focus(); n.setSelectionRange(p, p); };
    } else if (tab === 'clients') {
      body.innerHTML = head + `<div><button class="primary" data-a="newClient">+ Nouveau client</button></div>
        <div style="overflow:auto;max-height:58vh"><table class="users"><thead><tr><th>Client</th><th>À l'attention de</th><th>Adresse</th><th>Contact</th><th></th></tr></thead><tbody>
        ${FX.data.clients.map(c => `<tr><td><b>${esc(c.nom)}</b></td><td>${esc(c.attention || '')}</td><td>${esc([c.adresse, `${c.cp || ''} ${c.ville || ''}`.trim()].filter(Boolean).join(', '))}</td><td>${esc([c.email, c.tel].filter(Boolean).join(' · '))}</td>
          <td><div class="btnrow" style="justify-content:flex-end"><button class="small" data-a="editClient" data-id="${c.id}">Modifier</button><button class="small danger" data-a="delClient" data-id="${c.id}">Supprimer</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun client.</td></tr>'}
        </tbody></table></div>`;
    } else if (tab === 'prestations') {
      body.innerHTML = head + `<p class="muted" style="margin:0">Services facturables hors matériel (installation, abonnement, livraison…). Les tarifs des matériels se règlent plus bas : ils n'apparaissent que dans les devis et factures.</p>
        <div><button class="primary" data-a="newPresta">+ Nouvelle prestation</button></div>
        <div style="overflow:auto;max-height:52vh"><table class="users"><thead><tr><th>Prestation</th><th>Description</th><th>Unité</th><th class="n">Prix HT</th><th></th></tr></thead><tbody>
        ${FX.data.prestations.map(p => `<tr><td><b>${esc(p.nom)}</b></td><td>${esc(p.desc || '')}</td><td>${esc(p.unite || '')}</td><td class="n">${p.prix != null ? euro(p.prix) : '—'}</td>
          <td><div class="btnrow" style="justify-content:flex-end"><button class="small" data-a="editPresta" data-id="${p.id}">Modifier</button><button class="small danger" data-a="delPresta" data-id="${p.id}">Supprimer</button></div></td></tr>`).join('')}
        </tbody></table></div>
        ${can('tarifs') ? `<h4 style="margin:6px 0 0">Tarifs des matériels (base)</h4>
        <div style="overflow:auto;max-height:30vh"><table class="users"><thead><tr><th>Matériel</th><th>Code</th><th class="n">Prix HT</th></tr></thead><tbody>
        ${S.db.map(t => `<tr><td>${esc(t.nom)}</td><td>${esc(t.code)}</td><td class="n">${can('base') ? `<input data-prix="${esc(t.id)}" type="number" min="0" step="0.01" value="${t.prix ?? ''}" placeholder="non renseigné" style="width:120px;text-align:right">` : t.prix != null ? euro(t.prix) : '<span class="muted">non renseigné</span>'}</td></tr>`).join('')}</tbody></table></div>
        ${can('base') ? '<p class="muted" style="margin:0;font-size:12px">Prix unitaires HT, enregistrés dans la base des matériels dès la saisie.</p>' : ''}` : ''}`;
    } else {
      const e = FX.data.emetteur, c = FX.data.conditions, pf = FX.data.prefixes;
      const f = (k, label, v, ph = '', type = 'text') => `<label class="field"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph)}"></label>`;
      body.innerHTML = head + `<div style="overflow:auto;max-height:62vh;display:flex;flex-direction:column;gap:10px;padding-right:6px">
        <p class="muted" style="margin:0">Coordonnées de l'émetteur des devis et factures (en-tête et pied de page). Le logo est celui de la charte des documents.</p>
        <div class="row2">${f('e.nom', 'Raison sociale / organisme', e.nom)}${f('e.service', 'Service', e.service)}</div>
        <div class="row2">${f('e.adresse', 'Adresse', e.adresse)}<div class="row2">${f('e.cp', 'Code postal', e.cp)}${f('e.ville', 'Ville', e.ville)}</div></div>
        <div class="row2">${f('e.tel', 'Téléphone', e.tel)}${f('e.email', 'E-mail', e.email)}</div>
        <div class="row2">${f('e.contact', 'Votre contact (nom affiché)', e.contact)}${f('e.web', 'Site internet', e.web)}</div>
        <div class="row2">${f('e.siret', 'SIRET', e.siret)}${f('e.tvaIntra', 'N° TVA intracommunautaire', e.tvaIntra)}</div>
        <div class="row2">${f('e.forme', 'Forme juridique', e.forme, 'ex. SAS')}${f('e.capital', 'Capital', e.capital, 'ex. 8 000 €')}</div>
        <div class="row2">${f('e.rcs', 'RCS', e.rcs)}${f('e.banque', 'Banque', e.banque)}</div>
        <div class="row2">${f('e.iban', 'IBAN', e.iban)}${f('e.bic', 'BIC', e.bic)}</div>
        <h4 style="margin:6px 0 0">Conditions</h4>
        <div class="row2">${f('c.validiteJours', 'Validité des devis (jours)', c.validiteJours, '', 'number')}${f('c.echeanceJours', 'Échéance des factures (jours)', c.echeanceJours, '', 'number')}</div>
        <div class="row2">${f('c.reglement', 'Moyen de règlement', c.reglement)}${f('c.delai', 'Délai de règlement', c.delai)}</div>
        <label class="field"><span>Mentions de retard de paiement (factures)</span><textarea data-k="c.penalites">${esc(c.penalites || '')}</textarea></label>
        <label class="field"><span>Mention complémentaire des devis</span><textarea data-k="c.mentionDevis">${esc(c.mentionDevis || '')}</textarea></label>
        <label class="field"><span>Mention complémentaire des factures (ex. « TVA non applicable, art. 293 B du CGI »)</span><textarea data-k="c.mentionFacture">${esc(c.mentionFacture || '')}</textarea></label>
        <div class="row2">${f('p.devis', 'Préfixe des devis', pf.devis)}${f('p.facture', 'Préfixe des factures', pf.facture)}</div>
        <p class="muted" style="margin:0;font-size:11.5px">Numérotation : préfixe-année-numéro (ex. FAC-2026-0001), continue et sans trou pour les factures. Tenez la facturation sur une seule clé (celle de l'administrateur) : chaque clé a sa propre numérotation.</p></div>
        <div class="btnrow"><button class="primary" data-a="saveParams">Enregistrer les paramètres</button></div>`;
    }
  };
  body.addEventListener('change', async (ev) => {
    const el = ev.target; if (!el.dataset || el.dataset.prix === undefined || !can('base')) return;
    const t = S.db.find(x => x.id === el.dataset.prix); if (!t) return;
    const v = el.value.trim() === '' ? null : parseFloat(el.value.replace(',', '.'));
    if (v !== null && !(v >= 0)) { toast('Prix invalide.', true); return; }
    t.prix = v; await saveDb(); toast(`Tarif enregistré : ${t.nom}`);
  });
  body.addEventListener('click', async (ev) => {
    const tb = ev.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; q = ''; render(); return; }
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, d = FX.data.docs.find(x => x.id === b.dataset.id);
    if (a === 'new' || a === 'newProj') { if (await editDoc(newDoc(tab, a === 'newProj'))) render(); }
    if (a === 'open') { if (await editDoc(d)) render(); }
    if (a === 'pdf') await pdfDocument(d);
    if (a === 'dup') { const c = JSON.parse(JSON.stringify(d)); Object.assign(c, { id: uid(), date: today(), statut: 'brouillon', paiement: null, emisLe: null, totaux: null, numero: d.type === 'devis' ? nextNumber('devis') : '' }); delete c.devisRef;
      if (c.type === 'devis') c.validite = addDays(today(), +FX.data.conditions.validiteJours || 30); else c.echeance = '';
      FX.data.docs.push(c); if (await fxSave('Duplication ' + (c.type === 'devis' ? 'du devis' : 'de la facture'), d.numero)) { toast(`Copie créée${c.numero ? ' : ' + c.numero : ''}`); render(); } }
    if (a === 'bill') {
      if (d.statut !== 'accepte' && !(await confirmBox('Facturer ce devis', `Le devis ${d.numero} n'est pas marqué « Accepté ». Créer quand même la facture ?`, 'Créer la facture'))) return;
      const f = { ...JSON.parse(JSON.stringify(d)), id: uid(), type: 'facture', numero: '', date: today(), devisRef: d.numero, statut: null, paiement: null, echeance: '', validite: undefined };
      FX.data.docs.push(f); if (d.statut !== 'accepte') d.statut = 'accepte';
      if (await fxSave('Facture créée depuis le devis', d.numero)) { tab = 'facture'; render(); if (await editDoc(f)) render(); }
    }
    if (a === 'paid') {
      const v = await modal({ title: `Paiement de la facture ${d.numero}`, size: 'sm', body: `<label class="field"><span>Date du paiement</span><input id="pyD" type="date" value="${today()}"></label><label class="field"><span>Mode</span><input id="pyM" type="text" value="${esc(FX.data.conditions.reglement || 'Virement bancaire')}"></label>`,
        buttons: [{ label: 'Annuler', value: null }, { label: 'Enregistrer', cls: 'primary', action: (r) => ({ date: $('#pyD', r).value || today(), mode: $('#pyM', r).value }) }] });
      if (v) { d.paiement = v; if (await fxSave('Facture payée', d.numero)) render(); }
    }
    if (a === 'del' && await confirmBox('Supprimer', `Supprimer ${d.type === 'devis' ? 'le devis' : 'la facture brouillon'} ${d.numero || ''} (${d.client?.nom || ''}) ?`, 'Supprimer', true)) {
      FX.data.docs = FX.data.docs.filter(x => x !== d); if (await fxSave('Suppression ' + (d.type === 'devis' ? 'du devis' : 'de la facture brouillon'), d.numero || '')) render();
    }
    if (a === 'newClient' || a === 'editClient') { const c = a === 'newClient' ? null : FX.data.clients.find(x => x.id === b.dataset.id); const r = await clientDialog(c); if (r) { if (!c) FX.data.clients.push(r); if (await fxSave()) render(); } }
    if (a === 'delClient') { const c = FX.data.clients.find(x => x.id === b.dataset.id); if (await confirmBox('Supprimer le client', `Supprimer « ${c.nom} » de la liste ? Les devis et factures existants conservent ses coordonnées.`, 'Supprimer', true)) { FX.data.clients = FX.data.clients.filter(x => x !== c); if (await fxSave()) render(); } }
    if (a === 'newPresta' || a === 'editPresta') { const p = a === 'newPresta' ? null : FX.data.prestations.find(x => x.id === b.dataset.id); const r = await prestaDialog(p); if (r) { if (!p) FX.data.prestations.push(r); if (await fxSave()) render(); } }
    if (a === 'delPresta') { const p = FX.data.prestations.find(x => x.id === b.dataset.id); if (await confirmBox('Supprimer la prestation', `Supprimer « ${p.nom} » ?`, 'Supprimer', true)) { FX.data.prestations = FX.data.prestations.filter(x => x !== p); if (await fxSave()) render(); } }
    if (a === 'saveParams') {
      $$('[data-k]', body).forEach(i => { const [g, k] = i.dataset.k.split('.'); const obj = g === 'e' ? FX.data.emetteur : g === 'c' ? FX.data.conditions : FX.data.prefixes; obj[k] = i.type === 'number' ? (num0(i.value) || 0) : i.value.trim(); });
      if (!FX.data.prefixes.devis) FX.data.prefixes.devis = 'DEV'; if (!FX.data.prefixes.facture) FX.data.prefixes.facture = 'FAC';
      if (await fxSave('Paramètres de facturation modifiés')) toast('Paramètres enregistrés');
    }
  });
  render();
  await modal({ title: 'Devis et factures', size: '', body, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

function newDoc(type, fromProject) {
  const c0 = FX.data.clients[0];
  const d = { id: uid(), type, numero: type === 'devis' ? nextNumber('devis') : '', date: today(), statut: type === 'devis' ? 'brouillon' : null,
    client: c0 ? { ...c0 } : { nom: '' }, objet: '', projet: null, lignes: [], notes: '', creePar: S.user?.login || '' };
  if (type === 'devis') d.validite = addDays(today(), +FX.data.conditions.validiteJours || 30); else d.echeance = '';
  if (fromProject && projectRef()) { d.projet = projectRef(); d.objet = `Sécurisation ${S.project.site || S.project.name}`; d.lignes = linesFromProject(); }
  d._new = true; return d;
}

async function clientDialog(c) {
  const v = c || { id: uid(), nom: '', attention: '', adresse: '', cp: '', ville: '', email: '', tel: '' };
  const f = (k, l) => `<label class="field"><span>${l}</span><input data-k="${k}" type="text" value="${esc(v[k] || '')}"></label>`;
  const ok = await modal({ title: c ? 'Modifier le client' : 'Nouveau client', size: 'md',
    body: `${f('nom', 'Nom / raison sociale')}${f('attention', 'À l\'attention de')}${f('adresse', 'Adresse')}<div class="row2">${f('cp', 'Code postal')}${f('ville', 'Ville')}</div><div class="row2">${f('email', 'E-mail')}${f('tel', 'Téléphone')}</div>`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', cls: 'primary', action: (r) => { if (!$('[data-k=nom]', r).value.trim()) { toast('Saisissez le nom du client.', true); return false; } $$('[data-k]', r).forEach(i => (v[i.dataset.k] = i.value.trim())); return true; } }] });
  return ok ? v : null;
}
async function prestaDialog(p) {
  const v = p || { id: 'p-' + uid(), nom: '', desc: '', prix: null, unite: 'forfait' };
  const ok = await modal({ title: p ? 'Modifier la prestation' : 'Nouvelle prestation', size: 'md',
    body: `<label class="field"><span>Intitulé</span><input id="psN" type="text" value="${esc(v.nom)}"></label><label class="field"><span>Description</span><textarea id="psD">${esc(v.desc || '')}</textarea></label>
      <div class="row2"><label class="field"><span>Prix unitaire HT (€)</span><input id="psP" type="number" min="0" step="0.01" value="${v.prix ?? ''}"></label><label class="field"><span>Unité</span><input id="psU" type="text" value="${esc(v.unite || '')}" placeholder="forfait, unité, heure…"></label></div>`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', cls: 'primary', action: (r) => { if (!$('#psN', r).value.trim()) { toast('Saisissez l\'intitulé.', true); return false; } v.nom = $('#psN', r).value.trim(); v.desc = $('#psD', r).value.trim(); v.prix = $('#psP', r).value === '' ? null : num0($('#psP', r).value); v.unite = $('#psU', r).value.trim(); return true; } }] });
  return ok ? v : null;
}

/* ---------------------------------------------------------------- édition d'un devis / d'une facture */
async function editDoc(src) {
  const locked = src.type === 'facture' && !!src.numero;
  const d = JSON.parse(JSON.stringify(src)); const isNew = !!src._new; delete d._new;
  const body = document.createElement('div'); body.className = 'fx-edit';
  const dis = locked ? 'disabled' : '';
  const render = () => {
    const t = totaux(d);
    body.innerHTML = `
      ${locked ? `<div class="warnbox">Facture émise le ${esc(frDate(d.emisLe || d.date))} : elle ne peut plus être modifiée. Pour la corriger, établissez un avoir (facture négative).</div>` : ''}
      <div class="fx-head">
        <div class="field"><span>Client</span>
          <div class="pwrow"><select id="fxCl" ${dis}><option value="">— Choisir dans la liste —</option>${FX.data.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join('')}</select><button type="button" id="fxClNew" ${dis}>Nouveau…</button></div>
          <input data-c="nom" type="text" placeholder="Nom / raison sociale" value="${esc(d.client?.nom || '')}" ${dis}>
          <input data-c="attention" type="text" placeholder="À l'attention de" value="${esc(d.client?.attention || '')}" ${dis}>
          <input data-c="adresse" type="text" placeholder="Adresse" value="${esc(d.client?.adresse || '')}" ${dis}>
          <div class="row2"><input data-c="cp" type="text" placeholder="Code postal" value="${esc(d.client?.cp || '')}" ${dis}><input data-c="ville" type="text" placeholder="Ville" value="${esc(d.client?.ville || '')}" ${dis}></div></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="row2"><label class="field"><span>${d.type === 'devis' ? 'Devis n°' : 'Facture n°'}</span><input type="text" value="${esc(d.numero || 'attribué à l\'émission')}" disabled></label>
            <label class="field"><span>Date</span><input data-d="date" type="date" value="${esc(d.date)}" ${dis}></label></div>
          <div class="row2">${d.type === 'devis' ? `<label class="field"><span>Valable jusqu'au</span><input data-d="validite" type="date" value="${esc(d.validite || '')}"></label>
            <label class="field"><span>Statut</span><select data-d="statut">${Object.entries(STATUTS_DEVIS).map(([k, l]) => `<option value="${k}" ${d.statut === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
            : `<label class="field"><span>Échéance</span><input data-d="echeance" type="date" value="${esc(d.echeance || '')}" ${dis} placeholder="à l'émission"></label><label class="field"><span>Devis d'origine</span><input data-d="devisRef" type="text" value="${esc(d.devisRef || '')}" ${dis}></label>`}</div>
          <label class="field"><span>Objet</span><input data-d="objet" type="text" value="${esc(d.objet || '')}" placeholder="ex. Sécurisation bâtiment PMI" ${dis}></label>
        </div></div>
      ${!locked ? `<div class="fx-add">
        <select id="fxAddM"><option value="">+ Matériel…</option>${S.db.map(t => `<option value="${esc(t.id)}">${esc(t.nom)}${t.prix != null ? ` — ${euro(t.prix)}` : ' — prix non renseigné'}</option>`).join('')}</select>
        <select id="fxAddP"><option value="">+ Prestation…</option>${FX.data.prestations.map(p => `<option value="${esc(p.id)}">${esc(p.nom)}${p.prix != null ? ` — ${euro(p.prix)}` : ''}</option>`).join('')}</select>
        <button type="button" data-l="libre">+ Ligne libre</button><button type="button" data-l="titre">+ Titre de section</button>
        ${projectRef() ? '<button type="button" data-l="projet" title="Ajoute le quantitatif du projet ouvert, valorisé aux tarifs de la base">Importer le projet ouvert</button>' : ''}</div>` : ''}
      <div class="fx-lines"><table><thead><tr><th style="width:44%">Désignation</th><th class="n">Qté</th><th>Unité</th><th class="n">PU HT €</th><th class="n">Remise %</th><th class="n">TVA %</th><th class="n">Total HT</th><th></th></tr></thead><tbody>
      ${d.lignes.map((l, i) => l.kind === 'titre' ? `<tr class="fx-title"><td colspan="7"><input data-i="${i}" data-f="designation" type="text" value="${esc(l.designation)}" ${dis}></td><td>${rowBtns(i)}</td></tr>` : `<tr>
        <td><div class="fx-des">${l.typeId && typeOf(l.typeId)?.img ? `<img src="${typeOf(l.typeId).img}" alt="">` : ''}<div style="flex:1"><input data-i="${i}" data-f="designation" type="text" value="${esc(l.designation)}" ${dis}><textarea data-i="${i}" data-f="description" rows="1" placeholder="Description (facultatif)" ${dis}>${esc(l.description || '')}</textarea></div></div></td>
        <td><input class="n" data-i="${i}" data-f="qte" type="text" inputmode="decimal" value="${esc(String(l.qte).replace('.', ','))}" ${dis}></td>
        <td><input data-i="${i}" data-f="unite" type="text" value="${esc(l.unite || '')}" ${dis}></td>
        <td><input class="n" data-i="${i}" data-f="pu" type="text" inputmode="decimal" value="${esc(String(l.pu).replace('.', ','))}" ${dis}></td>
        <td><input class="n" data-i="${i}" data-f="remise" type="text" inputmode="decimal" value="${esc(String(l.remise || 0).replace('.', ','))}" ${dis}></td>
        <td><input class="n" data-i="${i}" data-f="tva" type="text" inputmode="decimal" value="${esc(String(l.tva).replace('.', ','))}" ${dis}></td>
        <td class="n" data-tot="${i}"><b>${euro(ligneHT(l))}</b></td><td>${rowBtns(i)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucune ligne : ajoutez des matériels, des prestations ou importez le projet ouvert.</td></tr>'}
      </tbody></table></div>
      <div class="fx-foot">
        <label class="field" style="flex:1"><span>Notes / conditions particulières (imprimées sur le document)</span><textarea data-d="notes" ${dis}>${esc(d.notes || '')}</textarea></label>
        <table class="fx-tot" id="fxTot">${totRows(t)}</table></div>`;
    if (!locked) $('#fxCl', body).value = '';
  };
  const rowBtns = (i) => locked ? '' : `<div class="fx-rb"><button type="button" class="ghost small" data-mv="-1" data-i="${i}" title="Monter">↑</button><button type="button" class="ghost small" data-mv="1" data-i="${i}" title="Descendre">↓</button><button type="button" class="ghost small" data-rm="${i}" title="Supprimer la ligne">✕</button></div>`;
  const totRows = (t) => `<tr><td>Total HT</td><td class="n">${euro(t.ht)}</td></tr>${Object.entries(t.tva).map(([r, v]) => `<tr><td>TVA ${String(r).replace('.', ',')} %</td><td class="n">${euro(v)}</td></tr>`).join('')}<tr class="ttc"><td>Total TTC</td><td class="n">${euro(t.ttc)}</td></tr>`;
  const refreshTotals = () => { d.lignes.forEach((l, i) => { const c = $(`[data-tot="${i}"]`, body); if (c) c.innerHTML = `<b>${euro(ligneHT(l))}</b>`; }); $('#fxTot', body).innerHTML = totRows(totaux(d)); };
  body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.i !== undefined && el.dataset.f) { const l = d.lignes[+el.dataset.i]; l[el.dataset.f] = ['qte', 'pu', 'remise', 'tva'].includes(el.dataset.f) ? num0(el.value) : el.value; refreshTotals(); }
    else if (el.dataset.c) { d.client = d.client || {}; d.client[el.dataset.c] = el.value; }
    else if (el.dataset.d) d[el.dataset.d] = el.value;
  });
  body.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'fxCl' && el.value) { const c = FX.data.clients.find(x => x.id === el.value); d.client = { ...c }; delete d.client.id; render(); }
    if (el.id === 'fxAddM' && el.value) { d.lignes.push(lineFromType(typeOf(el.value))); render(); }
    if (el.id === 'fxAddP' && el.value) { d.lignes.push(lineFromPresta(FX.data.prestations.find(p => p.id === el.value))); render(); }
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'fxClNew') { const c = await clientDialog(null); if (c) { FX.data.clients.push(c); await fxSave(); d.client = { ...c }; delete d.client.id; render(); } }
    if (b.dataset.l === 'libre') { d.lignes.push({ id: uid(), kind: 'libre', designation: '', description: '', qte: 1, unite: 'unité', pu: 0, remise: 0, tva: TVA_DEF }); render(); }
    if (b.dataset.l === 'titre') { d.lignes.push({ id: uid(), kind: 'titre', designation: 'Section' }); render(); }
    if (b.dataset.l === 'projet') { d.lignes.push(...linesFromProject()); d.projet = projectRef(); if (!d.objet) d.objet = `Sécurisation ${S.project.site || S.project.name}`; render(); toast('Quantitatif du projet importé'); }
    if (b.dataset.rm !== undefined) { d.lignes.splice(+b.dataset.rm, 1); render(); }
    if (b.dataset.mv) { const i = +b.dataset.i, j = i + +b.dataset.mv; if (j >= 0 && j < d.lignes.length) { [d.lignes[i], d.lignes[j]] = [d.lignes[j], d.lignes[i]]; render(); } }
  });
  render();
  const commit = async (label) => {
    if (!d.client || !String(d.client.nom || '').trim()) { toast('Indiquez le client.', true); return false; }
    const i = FX.data.docs.findIndex(x => x.id === d.id);
    if (i >= 0) FX.data.docs[i] = d; else FX.data.docs.push(d);
    return fxSave(label, d.numero || 'brouillon');
  };
  const missing = () => d.lignes.filter(l => l.kind !== 'titre' && !num0(l.pu)).length;
  const buttons = locked ? [
    { label: 'Fermer', value: false },
    { label: 'Éditer le PDF', cls: 'primary', action: async () => { await pdfDocument(d); return false; } }
  ] : [
    { label: 'Annuler', value: false },
    { label: 'Enregistrer', action: async () => (await commit(isNew ? `Création ${d.type === 'devis' ? 'du devis' : 'de la facture'}` : 'Modification ' + (d.type === 'devis' ? 'du devis' : 'de la facture'))) ? true : false },
    d.type === 'devis'
      ? { label: 'Enregistrer et éditer le PDF', cls: 'primary', action: async () => { if (missing() && !(await confirmBox('Prix manquants', `${missing()} ligne(s) ont un prix à 0 €. Éditer quand même ?`, 'Éditer'))) return false; if (!(await commit('Édition du devis'))) return false; await pdfDocument(d); return true; } }
      : { label: 'Émettre la facture…', cls: 'primary', action: async () => {
          if (!d.lignes.some(l => l.kind !== 'titre')) { toast('La facture ne contient aucune ligne.', true); return false; }
          if (!(await confirmBox('Émettre la facture', 'Un numéro définitif lui sera attribué. Une fois émise, la facture ne pourra plus être modifiée ni supprimée (correction par avoir).', 'Émettre'))) return false;
          d.numero = nextNumber('facture', d.date); d.emisLe = today(); if (!d.echeance) d.echeance = addDays(d.date, +FX.data.conditions.echeanceJours || 30); d.totaux = totaux(d);
          if (!(await commit('Émission de la facture'))) { d.numero = ''; return false; }
          toast(`Facture ${d.numero} émise`); await pdfDocument(d); return true; } }
  ];
  if (!locked && d.type === 'facture') buttons.splice(2, 0, { label: 'Aperçu PDF', action: async () => { await pdfDocument(d); return false; } });
  return modal({ title: `${d.type === 'devis' ? 'Devis' : 'Facture'} ${d.numero || '(brouillon)'}`, size: '', body, buttons });
}

/* ---------------------------------------------------------------- PDF A4 */
async function pdfDocument(d) {
  if (!d) return;
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let ch = {}; try { ch = await window.native.charte.load(); } catch {}
  const A = rgb(ch.couleur || '#1D4FB8'); const E = FX.data.emetteur, C = FX.data.conditions;
  const W = 210, H = 297, MG = 15, CW = W - 2 * MG; let y = 0;
  const font = (sz, st = 'normal') => { doc.setFont('helvetica', st); doc.setFontSize(sz); };
  const ink = () => doc.setTextColor(18, 26, 38), mut = () => doc.setTextColor(95, 106, 124);
  const txt = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/[’]/g, '\'').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=');
  const isFac = d.type === 'facture', draft = isFac && !d.numero;
  const title = isFac ? (draft ? 'FACTURE (brouillon)' : 'FACTURE') : 'DEVIS';
  const t = d.totaux && d.numero ? d.totaux : totaux(d);
  const legal = [E.nom, [E.adresse, `${E.cp || ''} ${E.ville || ''}`.trim()].filter(Boolean).join(' - '), E.siret && `SIRET : ${E.siret}`, E.tvaIntra && `TVA : ${E.tvaIntra}`, E.rcs && `RCS ${E.rcs}`, E.forme && E.capital ? `${E.forme} au capital de ${E.capital}` : E.forme].filter(Boolean).map(txt);
  const footer = () => {
    font(7); mut(); const l1 = legal.join(' - '); doc.splitTextToSize(l1, CW - 20).forEach((ln, i) => doc.text(ln, W / 2, H - 12 + i * 3, { align: 'center' }));
    if (E.tel || E.email || E.web) doc.text(txt([E.tel && `Tél. : ${E.tel}`, E.email, E.web].filter(Boolean).join(' - ')), W / 2, H - 5.5, { align: 'center' });
    doc.setDrawColor(214, 220, 229); doc.setLineWidth(0.2); doc.line(MG, H - 16, W - MG, H - 16);
  };
  const head2 = () => { font(8); mut(); doc.text(txt(`${E.nom || ''} - ${title} ${d.numero || ''}`), MG, 10); };
  const newPage = () => { footer(); doc.addPage(); head2(); y = 18; };
  let inTable = true;
  const ensure = (h) => { if (y + h > H - 22) { newPage(); if (inTable) tableHead(); } };

  // en-tête
  let logoH = 0;
  if (ch.logo) { try { const im = await imgSize(ch.logo); const h = 20, w = Math.min(48, im.w / im.h * h); doc.addImage(ch.logo, ch.logo.includes('image/png') ? 'PNG' : 'JPEG', MG, 12, w, w / (im.w / im.h)); logoH = w / (im.w / im.h); } catch {} }
  y = 14 + logoH + 3;
  font(10.5, 'bold'); ink(); doc.text(txt(E.nom || 'Émetteur (à renseigner dans Paramètres)'), MG, y); y += 4.6;
  font(8.6); mut();
  [E.service, E.adresse, `${E.cp || ''} ${E.ville || ''}`.trim(), E.tel && `Tél. : ${E.tel}`, E.email && `E-mail : ${E.email}`, E.contact && `Votre contact : ${E.contact}`].filter(Boolean).forEach(l => { doc.text(txt(l), MG, y); y += 3.9; });
  const leftEnd = y;
  // titre et références
  const RX = 112; let ry = 16;
  doc.setFillColor(...A); doc.rect(RX, ry - 6, W - MG - RX, 11, 'F');
  font(15, 'bold'); doc.setTextColor(255, 255, 255); doc.text(title, RX + 4, ry + 1.6);
  font(10, 'bold'); doc.text(txt(d.numero || ''), W - MG - 4, ry + 1.4, { align: 'right' });
  ry += 10; font(9); ink();
  const kv = (k, v) => { mut(); doc.text(k, RX, ry); ink(); doc.text(txt(v), RX + 30, ry); ry += 4.4; };
  kv('Date :', frDate(d.date));
  if (!isFac && d.validite) kv('Valable jusqu\'au :', frDate(d.validite));
  if (isFac && d.echeance) kv('Échéance :', frDate(d.echeance));
  if (isFac && d.devisRef) kv('Devis d\'origine :', d.devisRef);
  // client
  ry += 2; const cl = d.client || {};
  const clLines = [cl.attention && `À l'attention de ${cl.attention}`, cl.adresse, `${cl.cp || ''} ${cl.ville || ''}`.trim(), cl.email].filter(Boolean).map(txt);
  const boxH = 9 + clLines.length * 4.2;
  doc.setFillColor(244, 246, 249); doc.setDrawColor(214, 220, 229); doc.roundedRect(RX, ry, W - MG - RX, boxH, 1.5, 1.5, 'FD');
  font(7.5, 'bold'); mut(); doc.text('CLIENT', RX + 4, ry + 4.4);
  font(10, 'bold'); ink(); doc.text(txt(cl.nom || ''), RX + 4, ry + 9);
  font(9); clLines.forEach((l, i) => doc.text(l, RX + 4, ry + 13.2 + i * 4.2));
  y = Math.max(leftEnd, ry + boxH) + 7;
  if (d.objet) { font(9.5, 'bold'); ink(); doc.text('Objet : ', MG, y); const ow = doc.getTextWidth('Objet : '); font(9.5); doc.text(doc.splitTextToSize(txt(d.objet), CW - ow), MG + ow, y); y += 6; }
  if (d.projet && (d.projet.site || d.projet.nom)) { font(8.5); mut(); doc.text(txt(`Site : ${d.projet.site || d.projet.nom}`), MG, y); y += 5; }

  // tableau
  const cols = [{ k: 'img', w: 15, l: '' }, { k: 'des', w: 77, l: 'Désignation' }, { k: 'qte', w: 15, l: 'Qté', a: 'r' }, { k: 'pu', w: 21, l: 'PU HT', a: 'r' }, { k: 'rem', w: 13, l: 'Remise', a: 'r' }, { k: 'tva', w: 12, l: 'TVA', a: 'r' }, { k: 'tot', w: 27, l: 'Total HT', a: 'r' }];
  const tableHead = () => {
    doc.setFillColor(...A); doc.rect(MG, y, CW, 7, 'F'); font(8.4, 'bold'); doc.setTextColor(255, 255, 255);
    let x = MG; cols.forEach(c => { if (c.l) doc.text(c.l, c.a === 'r' ? x + c.w - 2 : x + 2, y + 4.7, { align: c.a === 'r' ? 'right' : 'left' }); x += c.w; }); y += 7;
  };
  tableHead();
  const fmtN = (v) => txt(String(r2(v)).replace('.', ','));
  for (const l of d.lignes) {
    if (l.kind === 'titre') { ensure(8); doc.setFillColor(236, 240, 247); doc.rect(MG, y, CW, 6.5, 'F'); font(9, 'bold'); doc.setTextColor(...A); doc.text(txt(l.designation), MG + 2, y + 4.4); y += 6.5; continue; }
    const tp = l.typeId ? typeOf(l.typeId) : null;
    font(9, 'bold'); const dl = doc.splitTextToSize(txt(l.designation || ''), cols[1].w - 4);
    font(7.8); const ds = l.description ? doc.splitTextToSize(txt(l.description), cols[1].w - 4) : [];
    const rh = Math.max(tp && tp.img ? 14 : 0, 3 + dl.length * 4 + ds.length * 3.3 + 2);
    ensure(rh);
    doc.setDrawColor(226, 231, 238); doc.setLineWidth(0.2); doc.line(MG, y + rh, MG + CW, y + rh);
    if (tp && tp.img) { try { const im = await imgSize(tp.img); const s = 11, k = Math.min(s / im.w, s / im.h); doc.addImage(tp.img, tp.img.includes('image/png') ? 'PNG' : 'JPEG', MG + 2 + (s - im.w * k) / 2, y + 1.5 + (s - im.h * k) / 2, im.w * k, im.h * k); } catch {} }
    let x = MG + cols[0].w; font(9, 'bold'); ink(); dl.forEach((ln, i) => doc.text(ln, x + 2, y + 4.6 + i * 4));
    font(7.8); mut(); ds.forEach((ln, i) => doc.text(ln, x + 2, y + 4.6 + dl.length * 4 + i * 3.3));
    x += cols[1].w; font(9); ink();
    const vals = [`${fmtN(l.qte)}${l.unite && l.unite !== 'unité' ? '' : ''}`, euro(l.pu), num0(l.remise) ? `${fmtN(l.remise)} %` : '-', `${fmtN(l.tva)} %`, euro(ligneHT(l))];
    vals.forEach((v, i) => { const c = cols[i + 2]; if (i === 4) font(9, 'bold'); doc.text(txt(v), x + c.w - 2, y + 4.6, { align: 'right' }); x += c.w; });
    if (l.unite) { font(7); mut(); doc.text(txt(l.unite), MG + cols[0].w + cols[1].w + cols[2].w - 2, y + 8, { align: 'right' }); }
    y += rh;
  }
  // totaux
  inTable = false;
  const tvaRows = Object.entries(t.tva);
  ensure(16 + tvaRows.length * 5.5);
  y += 4; const TX = W - MG - 72;
  const trow = (k, v, strong) => { if (strong) { doc.setFillColor(...A); doc.rect(TX, y - 4.4, 72, 7, 'F'); doc.setTextColor(255, 255, 255); font(10.5, 'bold'); } else { font(9.2); ink(); } doc.text(k, TX + 3, y); doc.text(txt(v), W - MG - 3, y, { align: 'right' }); y += strong ? 8 : 5.5; };
  trow('Total net HT', euro(t.ht)); tvaRows.forEach(([r, v]) => trow(`TVA ${String(r).replace('.', ',')} %`, euro(v))); trow('Total TTC', euro(t.ttc), true);
  if (isFac && d.paiement) { font(9, 'bold'); doc.setTextColor(21, 128, 61); doc.text(txt(`Payée le ${frDate(d.paiement.date)}${d.paiement.mode ? ` (${d.paiement.mode})` : ''}`), W - MG, y + 1, { align: 'right' }); y += 6; }

  // conditions et mentions
  const block = (lines) => { font(8.6); for (const [k, v] of lines) { if (!v) continue; const ls = doc.splitTextToSize(txt(v), CW - 46); ensure(ls.length * 4 + 1); mut(); doc.text(k, MG, y); ink(); doc.text(ls, MG + 46, y); y += ls.length * 4 + 0.6; } };
  y += 4; ensure(20);
  if (d.notes) { font(8.6, 'bold'); ink(); doc.text('Notes', MG, y); y += 4.4; font(8.6); const ls = doc.splitTextToSize(txt(d.notes), CW); ensure(ls.length * 4); doc.text(ls, MG, y); y += ls.length * 4 + 3; }
  if (!isFac) block([['Date de validité :', d.validite ? frDate(d.validite) : ''], ['Moyen de règlement :', C.reglement], ['Délai de règlement :', C.delai], ['', C.mentionDevis]]);
  else block([['Date d\'échéance :', d.echeance ? frDate(d.echeance) : 'à l\'émission'], ['Moyen de règlement :', C.reglement], ['Délai de règlement :', C.delai], ['Banque :', E.banque], ['IBAN :', E.iban], ['BIC :', E.bic], ['', C.mentionFacture]]);
  if (isFac && C.penalites) { font(7.4); mut(); const ls = doc.splitTextToSize(txt(C.penalites), CW); ensure(ls.length * 3.2 + 2); y += 2; doc.text(ls, MG, y); y += ls.length * 3.2; }
  if (!isFac) {
    ensure(36); y += 5; const bx = W - MG - 86;
    doc.setDrawColor(190, 198, 210); doc.setLineWidth(0.3); doc.rect(bx, y, 86, 30);
    font(8.2); ink(); doc.text(doc.splitTextToSize('Bon pour accord : date, signature et cachet du client, précédés de la mention « Lu et approuvé, bon pour accord ».', 80), bx + 3, y + 5);
    y += 32;
  }
  if (draft) { doc.setTextColor(220, 38, 38); doc.setFontSize(60); doc.setFont('helvetica', 'bold'); for (let p = 1; p <= doc.getNumberOfPages(); p++) { doc.setPage(p); doc.setGState && doc.setGState(new doc.GState({ opacity: 0.12 })); doc.text('BROUILLON', W / 2, H / 2, { align: 'center', angle: 30 }); doc.setGState && doc.setGState(new doc.GState({ opacity: 1 })); } doc.setPage(doc.getNumberOfPages()); }
  footer();
  const n = doc.getNumberOfPages(); for (let p = 1; p <= n; p++) { doc.setPage(p); font(7.5); mut(); doc.text(`Page ${p}/${n}`, W - MG, H - 5.5, { align: 'right' }); }
  const data = new Uint8Array(doc.output('arraybuffer'));
  const name = `${isFac ? 'Facture' : 'Devis'} ${d.numero || 'brouillon'} ${safeName(cl.nom || '')}.pdf`.replace(/\s+/g, ' ').trim();
  const p = await window.native.saveFile({ purpose: 'devis', title: `Enregistrer ${isFac ? 'la facture' : 'le devis'} (PDF)`, defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }], data });
  if (p) toast(`${isFac ? 'Facture' : 'Devis'} enregistré${isFac ? 'e' : ''} : ${p.split(/[\\/]/).pop()}`);
  return p;
}
