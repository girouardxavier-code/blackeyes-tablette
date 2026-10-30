/* Blackeyes Implantation — annotations écrites sur les plans (1.16)
   l.notes = [{ id, x, y, text, taille: 'p'|'m'|'g', couleur, fond: bool, cadre: bool }]
   Outil « ✎ Texte » : un clic sur le plan crée une annotation ; un clic sur une annotation la modifie ;
   on la déplace en la faisant glisser. Les annotations figurent dans tous les exports (cases à cocher). */
'use strict';

const NOTE_TAILLES = { p: { label: 'Petite', k: 0.36 }, m: { label: 'Moyenne', k: 0.55 }, g: { label: 'Grande', k: 0.85 } };
const NOTE_COULEURS = [['#c8102e', 'Rouge'], ['#1d4fb8', 'Bleu'], ['#0f1724', 'Noir'], ['#15803d', 'Vert'], ['#ea580c', 'Orange'], ['#7c3aed', 'Violet']];
const levelNotes = (l) => (l.notes = l.notes || []);
const noteFont = (l, n) => markerSize(l) * (NOTE_TAILLES[n.taille] || NOTE_TAILLES.m).k;

function noteMarkup(l, n, { selected = false, live = true } = {}) {
  const fs = noteFont(l, n), lh = fs * 1.22, pad = fs * 0.35;
  const lines = String(n.text || '').split('\n');
  const w = Math.max(...lines.map(s => s.length), 1) * fs * 0.56 + pad * 2, h = lines.length * lh + pad * 2;
  const col = n.couleur || '#c8102e';
  return `<g class="note${selected ? ' sel' : ''}" ${live ? `data-note="${n.id}"` : ''} transform="translate(${n.x} ${n.y})">
    ${n.fond !== false ? `<rect x="0" y="0" width="${w}" height="${h}" rx="${fs * 0.2}" fill="#fff" fill-opacity="0.9" stroke="${n.cadre !== false ? col : 'none'}" stroke-width="${fs * 0.07}"/>` : ''}
    <text font-family="Segoe UI, Arial, sans-serif" font-size="${fs}" font-weight="600" fill="${col}">${lines.map((s, i) => `<tspan x="${pad}" y="${pad + fs * 0.92 + i * lh}">${esc(s) || ' '}</tspan>`).join('')}</text>
    ${selected ? `<rect x="${-fs * 0.15}" y="${-fs * 0.15}" width="${w + fs * 0.3}" height="${h + fs * 0.3}" fill="none" stroke="#1d4fb8" stroke-width="${fs * 0.06}" stroke-dasharray="${fs * 0.25} ${fs * 0.15}"/>` : ''}
  </g>`;
}
const notesMarkup = (l, live = true) => levelNotes(l).map(n => noteMarkup(l, n, { selected: live && S.noteSel === n.id, live })).join('');
function renderNotes() {
  const g = $('#gNotes'); if (!g) return; const l = level();
  g.innerHTML = l && $('#optNotes').checked ? notesMarkup(l, true) : '';
}

async function noteDialog(n, isNew) {
  const edit = can('implanter');
  const r = await modal({ title: isNew ? 'Nouvelle annotation' : 'Annotation', size: 'md',
    body: `<label class="field"><span>Texte (Entrée pour aller à la ligne)</span><textarea id="ntText" rows="4" ${edit ? '' : 'disabled'} placeholder="ex. Porte condamnée, accès par la cour">${esc(n.text || '')}</textarea></label>
      <div class="row2"><label class="field"><span>Taille</span><select id="ntSize" ${edit ? '' : 'disabled'}>${Object.entries(NOTE_TAILLES).map(([k, t]) => `<option value="${k}" ${k === (n.taille || 'm') ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="field"><span>Couleur</span><select id="ntCol" ${edit ? '' : 'disabled'}>${NOTE_COULEURS.map(([c, lbl]) => `<option value="${c}" ${c === (n.couleur || '#c8102e') ? 'selected' : ''}>${lbl}</option>`).join('')}</select></label></div>
      <label class="chk"><input type="checkbox" id="ntFond" ${n.fond !== false ? 'checked' : ''} ${edit ? '' : 'disabled'}> Fond blanc</label>
      <label class="chk"><input type="checkbox" id="ntCadre" ${n.cadre !== false ? 'checked' : ''} ${edit ? '' : 'disabled'}> Encadré</label>`,
    left: !isNew && edit ? [{ label: 'Supprimer', cls: 'danger', value: 'del' }] : [],
    onMount: (root) => {
      const ta = $('#ntText', root); setTimeout(() => ta.focus(), 60);
      // Entrée = nouvelle ligne (et non validation) ; Ctrl + Entrée valide
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $$('footer button.primary', root)[0]?.click(); } else if (e.key === 'Enter') e.stopPropagation(); });
    },
    buttons: edit ? [{ label: 'Annuler', value: null }, { label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'primary', action: (root) => {
      const text = $('#ntText', root).value.replace(/\s+$/, ''); if (!text.trim()) { toast('Saisissez un texte.', true); return false; }
      return { text, taille: $('#ntSize', root).value, couleur: $('#ntCol', root).value, fond: $('#ntFond', root).checked, cadre: $('#ntCadre', root).checked };
    } }] : [{ label: 'Fermer', cls: 'primary', value: null }] });
  return r;
}
async function addNoteAt(p) {
  const l = level(); if (!l || !need('implanter')) return;
  const last = S.noteStyle || { taille: 'm', couleur: '#c8102e', fond: true, cadre: true };
  const r = await noteDialog({ ...last, text: '' }, true); if (!r || r === 'del') return;
  pushHistory();
  const n = { id: uid(), x: Math.round(p.x), y: Math.round(p.y), ...r }; levelNotes(l).push(n);
  S.noteStyle = { taille: r.taille, couleur: r.couleur, fond: r.fond, cadre: r.cadre };
  S.noteSel = n.id; setDirty(); renderNotes();
}
async function editNote(id) {
  const l = level(); const n = l && levelNotes(l).find(x => x.id === id); if (!n) return;
  const r = await noteDialog(n, false); if (!r) return;
  pushHistory();
  if (r === 'del') { l.notes = levelNotes(l).filter(x => x.id !== id); S.noteSel = null; }
  else Object.assign(n, r);
  setDirty(); renderNotes();
}
function deleteSelectedNote() {
  const l = level(); if (!l || !S.noteSel || !can('implanter')) return false;
  pushHistory(); l.notes = levelNotes(l).filter(x => x.id !== S.noteSel); S.noteSel = null; setDirty(); renderNotes(); return true;
}
