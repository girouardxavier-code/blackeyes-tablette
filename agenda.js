/* Blackeyes Implantation — Agenda : rendez-vous, visites, poses, relances et informations.
   Données chiffrées sur la clé (BlackeyesData/agenda.json), propres à chaque clé.
   Vues Mois / Semaine / Liste, recherche, filtres par type, lien avec le projet ouvert, export .ics. */
'use strict';

const AG_TYPES = {
  rdv:         { label: 'Rendez-vous', color: '#1d4fb8' },
  visite:      { label: 'Visite de site', color: '#0f766e' },
  pose:        { label: 'Pose / installation', color: '#c2410c' },
  maintenance: { label: 'Maintenance / SAV', color: '#7c3aed' },
  reunion:     { label: 'Réunion', color: '#0369a1' },
  relance:     { label: 'Relance / à faire', color: '#b45309' },
  info:        { label: 'Information / note', color: '#64748b' }
};
const AG_STATUTS = { prevu: 'Prévu', fait: 'Fait', annule: 'Annulé' };
const AG_JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const AG_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const AG_H0 = 7, AG_H1 = 21, AG_PX = 44; // vue semaine : 7 h → 21 h, 44 px par heure
const AG = { data: null, view: 'mois', cur: new Date(), sel: null, q: '', off: new Set(), past: false };

/* ---------------------------------------------------------------- dates (heure locale) */
const agIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const agParse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const agAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const agMonday = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const k = (x.getDay() + 6) % 7; return agAdd(x, -k); };
const agToday = () => agIso(new Date());
const agMin = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
const agLongDate = (iso) => { const d = agParse(iso); return `${['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d.getDay()]} ${d.getDate()} ${AG_MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const agHours = (e) => e.journee ? 'Journée' : `${e.debut || ''}${e.fin ? '–' + e.fin : ''}`;

/* ---------------------------------------------------------------- données */
async function agLoad(force = false) {
  if (AG.data && !force) return AG.data;
  AG.data = await window.native.agenda.load(); return AG.data;
}
async function agSave() {
  try { await window.native.agenda.save(AG.data); agBadge(); return true; }
  catch (e) { toast('Agenda non enregistré : ' + e.message, true); return false; }
}
const agMatch = (e) => {
  if (AG.off.has(e.type)) return false;
  if (!AG.q) return true;
  return `${e.titre} ${e.lieu} ${e.client} ${e.contact} ${e.tel} ${e.email} ${e.projet} ${e.notes}`.toLowerCase().includes(AG.q.toLowerCase());
};
const agOfDay = (iso) => AG.data.events.filter(e => e.date === iso && agMatch(e)).sort((a, b) => (b.journee - a.journee) || agMin(a.debut) - agMin(b.debut));
async function agBadge() {
  const b = $('#agBadge'); if (!b) return;
  try { await agLoad(); } catch { b.hidden = true; return; }
  const n = AG.data.events.filter(e => e.date === agToday() && e.statut !== 'annule' && e.statut !== 'fait').length;
  b.textContent = n; b.hidden = !n; b.title = `${n} rendez-vous aujourd'hui`;
}
async function agOnLogin() {
  AG.data = null;
  try {
    await agLoad(); agBadge();
    const rem = agReminders().sort((a, b) => a.date.localeCompare(b.date) || agMin(a.debut) - agMin(b.debut));
    if (rem.length) setTimeout(async () => {
      if (!S.user || $('#modalRoot').children.length) return;
      const go = await modal({ title: `Rappels de l'agenda (${rem.length})`, size: 'md', body: `<div class="ag-list">${rem.map(e => `<div class="ag-nx"><span>${esc(agLongDate(e.date))}</span>${agRow(e)}</div>`).join('')}</div>`,
        buttons: [{ label: 'Fermer', value: false }, { label: 'Ouvrir l\'agenda', cls: 'primary', value: true }] });
      if (go) { AG.sel = rem[0].date; AG.cur = agParse(rem[0].date); openAgenda(); }
    }, 1800);
    else { const n = AG.data.events.filter(e => e.date === agToday() && e.statut === 'prevu').length; if (n) setTimeout(() => toast(`Agenda : ${n} rendez-vous aujourd'hui.`), 2600); }
  } catch {}
}

/* ---------------------------------------------------------------- ouverture */
async function openAgenda() {
  if (!S.user) return;
  try { await agLoad(true); } catch (e) { toast('Agenda illisible : ' + e.message, true); return; }
  $('#agendaView').hidden = false; AG.sel = AG.sel || agToday(); agRender();
}
function closeAgenda() { $('#agendaView').hidden = true; agBadge(); }

function agRender() {
  $$('#agViews button').forEach(b => b.classList.toggle('on', b.dataset.v === AG.view));
  const d = AG.cur;
  if (AG.view === 'mois') { $('#agTitle').textContent = `${AG_MOIS[d.getMonth()][0].toUpperCase()}${AG_MOIS[d.getMonth()].slice(1)} ${d.getFullYear()}`; agMonth(); }
  else if (AG.view === 'semaine') { const m = agMonday(d), s = agAdd(m, 6); $('#agTitle').textContent = `Semaine du ${m.getDate()} ${m.getMonth() !== s.getMonth() ? AG_MOIS[m.getMonth()] + ' ' : ''}au ${s.getDate()} ${AG_MOIS[s.getMonth()]} ${s.getFullYear()}`; agWeek(); }
  else { $('#agTitle').textContent = AG.past ? 'Tous les rendez-vous' : 'À venir'; agList(); }
  agSide();
}
const agChip = (e) => { const t = AG_TYPES[e.type] || AG_TYPES.info;
  return `<button type="button" class="ag-chip ${e.statut}" data-ev="${e.id}" style="--c:${t.color}" title="${esc(`${agHours(e)} · ${e.titre}${e.lieu ? ' — ' + e.lieu : ''}`)}">${e.journee ? '' : `<b>${esc(e.debut || '')}</b> `}${esc(e.titre || t.label)}</button>`; };

function agMonth() {
  const d = AG.cur, first = new Date(d.getFullYear(), d.getMonth(), 1), start = agMonday(first), td = agToday();
  let h = `<div class="ag-month"><div class="ag-dow">${AG_JOURS.map(j => `<span>${j}</span>`).join('')}</div><div class="ag-grid">`;
  for (let i = 0; i < 42; i++) {
    const day = agAdd(start, i), iso = agIso(day), evs = agOfDay(iso), out = day.getMonth() !== d.getMonth();
    h += `<div class="ag-cell${out ? ' out' : ''}${iso === td ? ' today' : ''}${iso === AG.sel ? ' sel' : ''}${day.getDay() % 6 === 0 ? ' we' : ''}" data-day="${iso}">
      <div class="ag-num">${day.getDate()}${day.getDate() === 1 ? ' ' + AG_MOIS[day.getMonth()].slice(0, 4) + '.' : ''}<span class="ag-add" data-new="${iso}" title="Ajouter ce jour">+</span></div>
      ${evs.slice(0, 4).map(agChip).join('')}${evs.length > 4 ? `<span class="ag-more">+ ${evs.length - 4} autre(s)</span>` : ''}</div>`;
  }
  $('#agMain').innerHTML = h + '</div></div>';
}
function agWeek() {
  const m = agMonday(AG.cur), td = agToday(), days = Array.from({ length: 7 }, (_, i) => agAdd(m, i));
  const H = (AG_H1 - AG_H0) * AG_PX;
  let h = `<div class="ag-week"><div class="ag-wh"><span></span>${days.map(x => { const iso = agIso(x); return `<span class="${iso === td ? 'today' : ''}${iso === AG.sel ? ' sel' : ''}" data-day="${iso}">${AG_JOURS[(x.getDay() + 6) % 7]} <b>${x.getDate()}</b></span>`; }).join('')}</div>
    <div class="ag-wa"><span class="lab">Journée</span>${days.map(x => `<div data-day="${agIso(x)}">${agOfDay(agIso(x)).filter(e => e.journee).map(agChip).join('')}</div>`).join('')}</div>
    <div class="ag-wb"><div class="ag-hours" style="height:${H}px">${Array.from({ length: AG_H1 - AG_H0 }, (_, i) => `<span style="top:${i * AG_PX}px">${AG_H0 + i} h</span>`).join('')}</div>`;
  for (const x of days) {
    const iso = agIso(x);
    h += `<div class="ag-col${iso === td ? ' today' : ''}" data-col="${iso}" style="height:${H}px">${Array.from({ length: AG_H1 - AG_H0 }, (_, i) => `<i style="top:${i * AG_PX}px"></i>`).join('')}`;
    const evs = agOfDay(iso).filter(e => !e.journee);
    // chevauchements : répartition en colonnes
    const lanes = []; evs.forEach(e => { const s = agMin(e.debut), f = Math.max(s + 20, e.fin ? agMin(e.fin) : s + 60); let k = lanes.findIndex(end => end <= s); if (k < 0) { k = lanes.length; lanes.push(f); } else lanes[k] = f; e._lane = k; e._s = s; e._f = f; });
    const nl = Math.max(1, lanes.length);
    for (const e of evs) {
      const t = AG_TYPES[e.type] || AG_TYPES.info; const top = Math.max(0, (e._s - AG_H0 * 60) / 60 * AG_PX), ht = Math.max(20, (e._f - e._s) / 60 * AG_PX);
      h += `<button type="button" class="ag-blk ${e.statut}" data-ev="${e.id}" style="--c:${t.color};top:${top}px;height:${ht}px;left:calc(${e._lane * 100 / nl}% + 2px);width:calc(${100 / nl}% - 4px)"><b>${esc(agHours(e))}</b> ${esc(e.titre || t.label)}${e.lieu ? `<small>${esc(e.lieu)}</small>` : ''}</button>`;
    }
    h += '</div>';
  }
  $('#agMain').innerHTML = h + '</div></div>';
  const wb = $('.ag-wb'); if (wb && !AG._scrolled) { wb.scrollTop = (8 - AG_H0) * AG_PX; }
}
function agList() {
  const td = agToday();
  const evs = AG.data.events.filter(e => agMatch(e) && (AG.past || e.date >= td)).sort((a, b) => a.date.localeCompare(b.date) || (b.journee - a.journee) || agMin(a.debut) - agMin(b.debut));
  const byDay = new Map(); evs.forEach(e => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
  $('#agMain').innerHTML = `<div class="ag-list"><label class="chk"><input id="agPast" type="checkbox" ${AG.past ? 'checked' : ''}> Afficher aussi les rendez-vous passés</label>
    ${[...byDay].map(([iso, arr]) => `<section><h4 class="${iso === td ? 'today' : ''}">${esc(agLongDate(iso))}${iso === td ? ' · aujourd\'hui' : ''}</h4>${arr.map(agRow).join('')}</section>`).join('') || `<p class="muted">Aucun rendez-vous${AG.q ? ' pour cette recherche' : ' à venir'}.</p>`}</div>`;
  $('#agPast').onchange = (e) => { AG.past = e.target.checked; agRender(); };
}
const agRow = (e) => { const t = AG_TYPES[e.type] || AG_TYPES.info;
  return `<button type="button" class="ag-row ${e.statut}" data-ev="${e.id}" style="--c:${t.color}"><span class="h">${esc(agHours(e))}</span><span class="tx"><b>${esc(e.titre || t.label)}</b>
    <small>${esc([t.label, e.lieu, e.client, e.contact && `${e.contact}${e.tel ? ' · ' + e.tel : ''}`, e.projet && `projet ${e.projet}`].filter(Boolean).join(' · '))}</small>${e.notes ? `<small class="nt">${esc(e.notes.slice(0, 160))}${e.notes.length > 160 ? '…' : ''}</small>` : ''}</span>
    ${e.statut !== 'prevu' ? `<span class="st">${AG_STATUTS[e.statut]}</span>` : ''}</button>`; };

function agSide() {
  const iso = AG.sel || agToday(); const evs = agOfDay(iso); const td = agToday();
  const next = AG.data.events.filter(e => e.date > td && e.date <= agIso(agAdd(new Date(), 7)) && e.statut === 'prevu' && agMatch(e)).sort((a, b) => a.date.localeCompare(b.date) || agMin(a.debut) - agMin(b.debut));
  const todo = AG.data.events.filter(e => e.type === 'relance' && e.statut === 'prevu' && e.date < td);
  $('#agSide').innerHTML = `<section><input id="agQ" type="search" placeholder="Rechercher (client, lieu, contact, notes…)" value="${esc(AG.q)}"></section>
    <section><h2>${esc(agLongDate(iso))}</h2>${evs.map(agRow).join('') || '<p class="muted" style="margin:0">Rien de prévu ce jour.</p>'}
      <button type="button" id="agAddDay" class="wide">+ Ajouter le ${agParse(iso).getDate()} ${AG_MOIS[agParse(iso).getMonth()]}</button></section>
    ${todo.length ? `<section><h2>Relances en retard (${todo.length})</h2>${todo.map(agRow).join('')}</section>` : ''}
    <section><h2>Les 7 prochains jours (${next.length})</h2>${next.map(e => `<div class="ag-nx"><span>${esc(agLongDate(e.date).replace(/ \d{4}$/, ''))}</span>${agRow(e)}</div>`).join('') || '<p class="muted" style="margin:0">Aucun rendez-vous prévu.</p>'}</section>
    <section><h2>Types</h2><div class="ag-types">${Object.entries(AG_TYPES).map(([k, t]) => `<label class="chk"><input type="checkbox" data-ty="${k}" ${AG.off.has(k) ? '' : 'checked'}><i style="background:${t.color}"></i>${t.label}</label>`).join('')}</div></section>`;
  const q = $('#agQ'); q.oninput = () => { AG.q = q.value; const p = q.selectionStart; agRender(); const n = $('#agQ'); n.focus(); n.setSelectionRange(p, p); };
  $('#agAddDay').onclick = () => agEdit(null, { date: iso });
  $$('[data-ty]', $('#agSide')).forEach(c => c.onchange = () => { c.checked ? AG.off.delete(c.dataset.ty) : AG.off.add(c.dataset.ty); agRender(); });
}

/* ---------------------------------------------------------------- saisie d'un rendez-vous */
function agNewEvent(pre = {}) {
  const now = new Date(); const h = Math.min(18, Math.max(8, now.getHours() + 1));
  return { id: uid(), type: 'rdv', titre: '', date: AG.sel || agToday(), debut: `${String(h).padStart(2, '0')}:00`, fin: `${String(h + 1).padStart(2, '0')}:00`, journee: false,
    lieu: '', client: '', contact: '', tel: '', email: '', projet: '', notes: '', statut: 'prevu', rappel: '', creePar: S.user ? S.user.name : '', ...pre };
}
async function agEdit(ev, pre = {}) {
  const isNew = !ev; const e = ev ? { ...ev } : agNewEvent(pre);
  const f = (k, label, type = 'text', ph = '') => `<label class="field"><span>${label}</span><input id="ag_${k}" type="${type}" value="${esc(e[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  const body = `<div class="ag-form">
    <div class="row2"><label class="field"><span>Type</span><select id="ag_type">${Object.entries(AG_TYPES).map(([k, t]) => `<option value="${k}" ${e.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="field"><span>Statut</span><select id="ag_statut">${Object.entries(AG_STATUTS).map(([k, l]) => `<option value="${k}" ${e.statut === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${f('titre', 'Objet', 'text', 'ex. Visite de l\'école avec la directrice')}
    <div class="row3">${f('date', 'Date', 'date')}${f('debut', 'Début', 'time')}${f('fin', 'Fin', 'time')}</div>
    <label class="chk"><input id="ag_journee" type="checkbox" ${e.journee ? 'checked' : ''}> Toute la journée</label>
    ${f('lieu', 'Lieu / adresse', 'text', 'ex. 5 bis rue de la Ferme')}
    <div class="row2">${f('client', 'Client / organisme', 'text', 'ex. Mairie, société…')}${f('contact', 'Contact sur place', 'text', 'Nom, fonction')}</div>
    <div class="row2">${f('tel', 'Téléphone', 'tel')}${f('email', 'E-mail', 'email')}</div>
    <div class="row2">${f('projet', 'Projet / dossier', 'text', 'Nom du projet Blackeyes')}<label class="field"><span>Rappel à la connexion</span><select id="ag_rappel">
      ${[['', 'Aucun'], ['0', 'Le jour même'], ['1', 'La veille'], ['7', 'Une semaine avant']].map(([v, l]) => `<option value="${v}" ${String(e.rappel ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="field"><span>Renseignements / notes</span><textarea id="ag_notes" rows="5" placeholder="Accès, code portail, matériel à prévoir, points abordés, suites à donner…">${esc(e.notes || '')}</textarea></label>
    ${e.creePar ? `<p class="muted" style="margin:0;font-size:11.5px">Saisi par ${esc(e.creePar)}${e.maj ? ` · modifié le ${esc(new Date(e.maj).toLocaleString('fr-FR'))}` : ''}</p>` : ''}</div>`;
  const read = (root) => {
    const g = (k) => $('#ag_' + k, root); const out = { ...e };
    for (const k of ['type', 'statut', 'titre', 'date', 'debut', 'fin', 'lieu', 'client', 'contact', 'tel', 'email', 'projet', 'rappel', 'notes']) out[k] = g(k).value.trim();
    out.journee = g('journee').checked; out.maj = new Date().toISOString();
    return out;
  };
  const left = [];
  if (S.project && (S.project.levels.length || S.project.site)) left.push({ label: 'Lier au projet ouvert', cls: 'ghost', action: (root) => {
    const b = typeof C !== 'undefined' && C.data && S.project.batimentId ? C.data.batiments.find(x => x.id === S.project.batimentId) : null;
    $('#ag_projet', root).value = S.project.name || ''; if (!$('#ag_lieu', root).value) $('#ag_lieu', root).value = b && b.adresse ? b.adresse : (S.project.site || '');
    if (!$('#ag_titre', root).value) $('#ag_titre', root).value = S.project.site || S.project.name || ''; toast('Projet ouvert lié au rendez-vous'); return false; } });
  if (!isNew) {
    left.push({ label: 'Dupliquer', cls: 'ghost', action: async () => { const c = { ...e, id: uid(), statut: 'prevu', creePar: S.user.name, maj: '' }; AG.data.events.push(c); await agSave(); agRender(); toast('Rendez-vous dupliqué'); setTimeout(() => agEdit(c), 50); return true; } });
    left.push({ label: 'Supprimer', cls: 'danger', action: async () => { if (!await confirmBox('Supprimer', `Supprimer « ${e.titre || AG_TYPES[e.type].label} » du ${agLongDate(e.date)} ?`, 'Supprimer', true)) return false; AG.data.events = AG.data.events.filter(x => x.id !== e.id); await agSave(); agRender(); toast('Rendez-vous supprimé'); return true; } });
  }
  const r = await modal({ title: isNew ? 'Nouveau rendez-vous' : 'Rendez-vous', size: 'md', body, left,
    onMount: (root) => { const j = $('#ag_journee', root); const tog = () => { $('#ag_debut', root).disabled = $('#ag_fin', root).disabled = j.checked; }; j.onchange = tog; tog();
      $('#ag_debut', root).onchange = () => { const s = agMin($('#ag_debut', root).value), fi = $('#ag_fin', root); if (!fi.value || agMin(fi.value) <= s) { const t = Math.min(23 * 60 + 59, s + 60); fi.value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; } }; },
    buttons: [{ label: 'Annuler', value: null }, { label: 'Enregistrer', cls: 'primary', action: (root) => {
      const o = read(root);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) { toast('Indiquez la date.', true); return false; }
      if (!o.titre && !o.client && !o.lieu) { toast('Indiquez au moins l\'objet, le client ou le lieu.', true); return false; }
      if (!o.journee && o.fin && agMin(o.fin) < agMin(o.debut)) { toast('L\'heure de fin précède l\'heure de début.', true); return false; }
      return o; } }]
  });
  if (!r) return;
  const i = AG.data.events.findIndex(x => x.id === r.id); if (i >= 0) AG.data.events[i] = r; else AG.data.events.push(r);
  if (await agSave()) { AG.sel = r.date; agRender(); toast(isNew ? 'Rendez-vous ajouté' : 'Rendez-vous enregistré'); }
}

/* ---------------------------------------------------------------- export .ics (Outlook, Google Agenda, téléphone) */
function agIcs(events) {
  const escT = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const fold = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
  const dt = (iso, hm) => iso.replace(/-/g, '') + (hm ? 'T' + hm.replace(':', '') + '00' : '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blackeyes Implantation//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Agenda Blackeyes'];
  for (const e of events) {
    const t = AG_TYPES[e.type] || AG_TYPES.info;
    L.push('BEGIN:VEVENT', `UID:${e.id}@blackeyes-implantation`, `DTSTAMP:${stamp}`);
    if (e.journee) { L.push(`DTSTART;VALUE=DATE:${dt(e.date)}`, `DTEND;VALUE=DATE:${dt(agIso(agAdd(agParse(e.date), 1)))}`); }
    else { L.push(`DTSTART:${dt(e.date, e.debut || '09:00')}`, `DTEND:${dt(e.date, e.fin || e.debut || '10:00')}`); }
    L.push(`SUMMARY:${escT(e.titre || t.label)}`, `CATEGORIES:${escT(t.label)}`);
    if (e.lieu) L.push(`LOCATION:${escT(e.lieu)}`);
    const desc = [e.client && `Client : ${e.client}`, e.contact && `Contact : ${e.contact}`, e.tel && `Tél. : ${e.tel}`, e.email && `E-mail : ${e.email}`, e.projet && `Projet : ${e.projet}`, e.notes].filter(Boolean).join('\n');
    if (desc) L.push(`DESCRIPTION:${escT(desc)}`);
    L.push(`STATUS:${e.statut === 'annule' ? 'CANCELLED' : 'CONFIRMED'}`);
    if (e.rappel !== '' && e.rappel != null && !e.journee) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escT(e.titre || t.label)}`, `TRIGGER:-P${+e.rappel ? e.rappel + 'D' : 'T30M'}`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
async function agExport() {
  const r = await modal({ title: 'Exporter l\'agenda', body: `<p style="margin:0">Fichier .ics à importer dans Outlook, Google Agenda ou un téléphone.</p>
    <label class="field"><span>Rendez-vous à exporter</span><select id="agXs"><option value="futur">À venir (à partir d'aujourd'hui)</option><option value="mois">Le mois affiché</option><option value="tout">Tout l'agenda</option></select></label>
    <p class="muted" style="margin:0">Le fichier n'est pas chiffré : il contient les lieux, contacts et notes des rendez-vous.</p>`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Exporter', cls: 'primary', action: (root) => $('#agXs', root).value }] });
  if (!r) return;
  const td = agToday(), ym = agIso(AG.cur).slice(0, 7);
  const evs = AG.data.events.filter(e => e.statut !== 'annule' && (r === 'tout' || (r === 'futur' ? e.date >= td : e.date.startsWith(ym))));
  if (!evs.length) { toast('Aucun rendez-vous à exporter.', true); return; }
  try {
    const p = await window.native.saveFile({ purpose: 'ics', title: 'Exporter l\'agenda', defaultPath: `Agenda Blackeyes ${r === 'mois' ? ym : td}.ics`, filters: [{ name: 'Calendrier (.ics)', extensions: ['ics'] }], data: strToBytes(agIcs(evs)) });
    if (p) toast(`${evs.length} rendez-vous exporté(s)`);
  } catch (e) { toast('Export impossible : ' + e.message, true); }
}

/* rappels affichés à la connexion (la veille, une semaine avant, le jour même) */
function agReminders() {
  const td = agParse(agToday());
  return (AG.data ? AG.data.events : []).filter(e => e.statut === 'prevu' && e.rappel !== '' && e.rappel != null && (() => { const d = agParse(e.date); const k = Math.round((d - td) / 86400000); return k >= 0 && k <= +e.rappel; })());
}

/* ---------------------------------------------------------------- liaisons */
(function bindAgenda() {
  $('#bAgenda').onclick = openAgenda;
  $('#agClose').onclick = closeAgenda;
  $('#agNew').onclick = () => agEdit(null);
  $('#agIcs').onclick = agExport;
  $('#agToday').onclick = () => { AG.cur = new Date(); AG.sel = agToday(); agRender(); };
  const step = (k) => { const d = AG.cur; AG.cur = AG.view === 'mois' ? new Date(d.getFullYear(), d.getMonth() + k, 1) : agAdd(d, 7 * k); agRender(); };
  $('#agPrev').onclick = () => step(-1); $('#agNext').onclick = () => step(1);
  $$('#agViews button').forEach(b => b.onclick = () => { AG.view = b.dataset.v; if (AG.sel) AG.cur = agParse(AG.sel); agRender(); });
  $('#agendaView').addEventListener('click', (e) => {
    const ev = e.target.closest('[data-ev]'); if (ev) { const x = AG.data.events.find(y => y.id === ev.dataset.ev); if (x) agEdit(x); return; }
    const nw = e.target.closest('[data-new]'); if (nw) { AG.sel = nw.dataset.new; agEdit(null, { date: nw.dataset.new }); return; }
    const col = e.target.closest('[data-col]');
    if (col && e.target === col || (col && e.target.tagName === 'I')) {
      const r = col.getBoundingClientRect(); const mins = AG_H0 * 60 + Math.floor((e.clientY - r.top) / AG_PX * 2) * 30;
      const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      AG.sel = col.dataset.col; agEdit(null, { date: col.dataset.col, debut: hh(mins), fin: hh(Math.min(mins + 60, 23 * 60 + 30)) }); return;
    }
    const day = e.target.closest('[data-day]'); if (day && $('#agMain').contains(day)) { AG.sel = day.dataset.day; agRender(); }
  });
  $('#agMain').addEventListener('dblclick', (e) => { const day = e.target.closest('.ag-cell'); if (day && !e.target.closest('[data-ev]')) agEdit(null, { date: day.dataset.day }); });
  document.addEventListener('keydown', (e) => {
    if ($('#agendaView').hidden || $('#modalRoot').children.length || !$('#authScreen').hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeAgenda(); }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') $('#agPrev').click(); if (e.key === 'ArrowRight') $('#agNext').click();
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); agEdit(null); }
  }, true);
})();
