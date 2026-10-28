/* Blackeyes Implantation — Protocole de sûreté, renseigné pour chaque bâtiment de chaque client.
   Données : BlackeyesData/Protocoles/<id du bâtiment>.json (chiffré). Export PDF et PowerPoint au format
   « BLACKEYES — L'indispensable complément » (pages A4 paysage sur fond sombre). */
'use strict';

const PDS = { batId: null, bat: null, terr: null, d: null, sec: 'garde', dirty: false, list: {} };

/* ---------------------------------------------------------------- contenu par défaut (aucun lieu) */
const PDS_DEF = {
  avertissement: [
    'Un protocole de sûreté est un dispositif spécifique élaboré pour fournir des informations cruciales afin d\'aider les forces de l\'ordre à faire face à des situations de crises graves causées par des actes malveillants. C\'est un outil important pour renforcer la sécurité publique et la capacité de réaction des autorités.',
    'Le protocole de sûreté met en lumière les vulnérabilités de l\'établissement, tant au niveau de son organisation que de ses structures. De plus, il propose des stratégies à adopter et des systèmes à mettre en place pour renforcer la sûreté dans la plupart des scénarios.',
    'Mis entre de mauvaises mains, ce rapport devient une arme à double tranchant. Il est impératif de sécuriser ces informations et de contrôler leur diffusion.',
    'Toutefois, le protocole de sûreté n\'est qu\'une source de propositions et ne peut être une forme d\'obligation.'
  ].join('\n\n'),
  devise: '« Une organisation reste efficace tant qu\'elle demeure secrète »',
  menacesIntro: 'Les menaces anticipées dans un établissement accueillant du public se concentrent autour du terrorisme, des individus perturbés et du banditisme.',
  menaces: [
    'L\'usage d\'engins explosifs ou incendiaires, qu\'ils soient déposés, transportés, véhiculés, ou utilisés pour des actes de destruction et d\'incendie.',
    'Les prises d\'otages de masse lors d\'un événement, impliquant des armes à feu et des explosifs, souvent perpétrées par de petits groupes.',
    'Les attaques meurtrières au moyen d\'armes blanches ou à feu, par des individus agissant seuls ou en groupe.',
    'Les extorsions assorties de menaces, qu\'il s\'agisse de chantage ou de prises d\'otages à des fins patronales ou familiales.'
  ],
  scenIntro: 'Voici trois scénarios d\'attaques possibles dans le cadre de l\'établissement.',
  scenarios: [
    'A/ Les assaillants arrivent par le hall d\'entrée principal, repoussant le public vers l\'intérieur de l\'établissement. Ils utilisent des armes à feu pour intimider et contrôler les personnes présentes, tout en bloquant les issues principales pour empêcher toute fuite.',
    'B/ Les assaillants choisissent de pénétrer par les sorties de secours, s\'infiltrant discrètement au cœur de l\'établissement. Ils pourraient se déplacer de local en local, prenant les occupants par surprise et créant un sentiment d\'insécurité généralisé.',
    'C/ Une attaque simultanée est lancée, avec des assaillants arrivant à la fois par l\'entrée principale et les sorties de secours. Cette tactique de tenaille complique la réaction du public et du personnel, les laissant vulnérables et désorientés face à la menace.'
  ],
  action: {
    connaitre: 'Sensibilisation adaptée en fonction de l\'implication du personnel face aux situations d\'urgence.\nVouée à la direction.',
    preparer: 'Comprendre l\'arbre de décision pour guider les actions.\nOrganiser des formations pour préparer l\'évacuation, le confinement et le retranchement.\nPrévoir des zones de confinement sécurisées dans l\'établissement.',
    identifier: 'Observation des signes précurseurs.\nUtilisation de méthodes de détection humaines ou techniques.\nDéclenchement rapide de l\'alerte pour une réaction plus efficace face à la menace.',
    reagir: 'Prendre les mesures appropriées en fonction de la situation :\nDiffusion de messages d\'alerte pour informer le personnel.\nUtilisation de l\'arbre de décision.\nApplication des instructions déjà élaborées.\nMise en œuvre de l\'évacuation si nécessaire, du confinement, du retranchement pour assurer la sécurité des personnes dans un lieu isolé et sécurisé.'
  },
  diffusionAvant: ['Protocole de sûreté', 'Direction de l\'établissement', 'Organisation interne', 'Commissariat de secteur', 'Unité d\'intervention (BRI / RAID / GIGN)', 'Police municipale'],
  diffusionCrise: ['Direction de l\'établissement', 'Clés, codes et badges', 'Commissariat de secteur', 'Unité d\'intervention', 'Préfecture', 'Prise des mesures conservatoires'],
  conclusion: 'Avoir un protocole de sûreté définit les mesures à mettre en place qui permettent d\'anticiper et de répondre de manière organisée aux situations d\'urgence, assurant la sécurité des usagers, des occupants et des biens.\n\nDe plus, il favorise la coordination efficace entre les différentes entités impliquées, renforçant ainsi la réactivité face aux incidents.',
  locaux: [['Énergie électrique', 'Coupure générale de l\'installation électrique', '', '', 'Badge / clé'], ['Caméras d\'observation', 'Nombre de caméras fixes et orientables, intérieur et extérieur', '', 'Poste d\'observation', 'Badge'], ['Alarmes', 'Système volumétrique', '', 'Clavier', 'Code'], ['Contrôle d\'accès', 'Badge magnétique, ouverture commandée', '', 'Gestion : / Accès :', 'Couplage avec la vidéoprotection : '], ['Serrures', 'Serrures mécaniques', '', 'Accès : locaux techniques et portes d\'entrée', 'Détention : ']],
  portes: [['Portes en verre anti-panique', 'Double vitrage anti-effraction', '', 'Poussante, fermeture multipoints', ''], ['Portes en verre coupe-feu', 'Porte de cloisonnement simple vitrage', '', 'Battante, sans point de fermeture', ''], ['Portes de cloisonnement', 'Porte coupe-feu', '', 'Tirante, barre anti-panique', ''], ['Portes métalliques', 'Porte métallique en extérieur', '', 'Ouverture par clé', '']]
};
function pdsNew(b, t) {
  const D = PDS_DEF;
  return {
    v: 1, batId: b.id, batNom: b.nom, client: t ? t.nom : '', inc: {},
    garde: { titre: 'Protocole de sûreté', type: b.type || '', nom: b.nom || '', adresse: [b.adresse, t && t.commune && t.commune.nom].filter(Boolean).join('\n'), date: String(new Date().getFullYear()), photo: '',
      contacts: [['Direction', '', '', '', ''], ['Direction adjointe', '', '', '', ''], ['Responsable technique', '', '', '', '']] },
    avert: { texte: D.avertissement, devise: D.devise },
    env: { texte: '', image: '' },
    gen: { type: '', descriptif: '', entree: '', sorties: '', nbLocaux: '', repartition: '', nbPersonnes: '', personnelJour: '', personnelSurete: '', personnelArme: 'Non', horaires: '', influence: '', photos: [] },
    loc: { texte: '', images: [], arrivee: '', parking: '' },
    conserv: { distance: '250', image: '', points: [['1', ''], ['2', ''], ['3', '']], legende: 'Zone d\'exclusion\nFermeture des accès de transports en commun\nParking' },
    bapteme: { texte: 'Cet édifice dispose de plusieurs façades, réparties de la manière suivante :', faces: [['Alpha', ''], ['Bravo', ''], ['Charlie', ''], ['Delta', '']], image: '', photos: [] },
    visuels: [],
    sorties: [],
    salles: { rows: [], note: '' },
    plans: { projet: true, grille: true, vues: [] },
    video: { auto: true, carte: true, rayon: '150', schema: true, rows: [], note: '' },
    locaux: { rows: D.locaux.map(r => [...r]) },
    portes: { rows: D.portes.map(r => [...r]) },
    menaces: { intro: D.menacesIntro, items: [...D.menaces] },
    scen: { intro: D.scenIntro, items: [...D.scenarios] },
    analyse: { forts: [], faibles: [] },
    action: { ...D.action },
    arbre: {},
    diffusion: { avant: [...D.diffusionAvant], crise: [...D.diffusionCrise] },
    conclusion: { texte: D.conclusion }
  };
}

/* ---------------------------------------------------------------- schéma de l'éditeur */
const PDS_SEC = [
  { k: 'garde', t: 'Page de titre et contacts', f: [['titre', 'Titre', 'text'], ['type', 'Type d\'établissement (ex. Cinéma, École, Mairie)', 'text'], ['nom', 'Nom de l\'établissement', 'text'], ['adresse', 'Adresse (une ligne par ligne)', 'textarea'], ['date', 'Date', 'text'], ['photo', 'Photo de la façade', 'image'],
    ['contacts', 'Contacts', 'table', [['Fonction', 'text'], ['Nom', 'text'], ['Prénom', 'text'], ['Téléphone', 'text'], ['E-mail', 'text']]]] },
  { k: 'avert', t: 'Avertissements', f: [['texte', 'Texte', 'textarea', 10], ['devise', 'Devise', 'text']] },
  { k: 'env', t: 'Environnement', f: [['texte', 'Description du quartier et des lieux remarquables', 'textarea', 5], ['image', 'Vue aérienne / plan du quartier', 'image']] },
  { k: 'gen', t: 'Éléments généraux', f: [['type', 'Type d\'établissement', 'text'], ['descriptif', 'Descriptif (niveaux…)', 'textarea', 2], ['entree', 'Entrée principale', 'textarea', 2], ['sorties', 'Sorties de secours', 'textarea', 2], ['nbLocaux', 'Nombre de salles / locaux', 'text'], ['repartition', 'Répartition par niveau', 'textarea', 4],
    ['nbPersonnes', 'Nombre de personnes (capacité)', 'text'], ['personnelJour', 'Personnel par jour', 'text'], ['personnelSurete', 'Personnel de sûreté', 'text'], ['personnelArme', 'Personnel armé', 'text'], ['horaires', 'Horaires d\'ouverture au public', 'text'], ['influence', 'Périodes de forte affluence', 'text'], ['photos', 'Photos (3 au plus)', 'images', 3]] },
  { k: 'loc', t: 'Localisation', f: [['texte', 'Commentaire', 'textarea', 3], ['images', 'Plan de situation et vues (2 au plus)', 'images', 2], ['arrivee', 'Arrivée sous protection visuelle et balistique', 'textarea', 2], ['parking', 'Stationnement des véhicules d\'intervention', 'text']] },
  { k: 'conserv', t: 'Mesures conservatoires', f: [['distance', 'Zone d\'exclusion balles / explosifs (mètres)', 'text'], ['image', 'Plan des points de bouclage', 'image'], ['points', 'Points de bouclage', 'table', [['N°', 'text', 1], ['Carrefour / voie', 'text', 6]]], ['legende', 'Légende (une ligne par élément)', 'textarea', 3]] },
  { k: 'bapteme', t: 'Baptême terrain', f: [['texte', 'Présentation', 'textarea', 3], ['faces', 'Façades (dénomination opérationnelle)', 'table', [['Face', 'text', 1], ['Description', 'textarea', 5]]], ['image', 'Plan des façades', 'image'], ['photos', 'Photos des façades (4 au plus)', 'images', 4]] },
  { k: 'visuels', t: 'Vues extérieures', hint: 'Une page par ligne : visuel général, points hauts, terrasse, toits…', f: [['', '', 'pages', [['Titre', 'text'], ['Sous-titre', 'text'], ['Commentaire', 'textarea'], ['Image 1', 'image'], ['Image 2', 'image']]]] },
  { k: 'sorties', t: 'Sorties de secours', hint: 'Les sorties sont regroupées par façade (3 par page).', f: [['', '', 'rows', [['Façade / voie', 'text'], ['Réf.', 'text'], ['Lieux', 'textarea'], ['Vue extérieure', 'image'], ['Zones desservies', 'textarea'], ['Observation', 'textarea']]]] },
  { k: 'salles', t: 'Salles et locaux', f: [['rows', 'Salles', 'table', [['N°', 'text', 1], ['Entrée (niveau)', 'text', 2], ['Places', 'text', 2], ['Accès à la salle', 'textarea', 4], ['Sortie de secours / escalier', 'textarea', 4]]], ['note', 'Points remarquables', 'textarea', 2]] },
  { k: 'plans', t: 'Plans des étages et vues', f: [['projet', 'Inclure les plans du projet rattaché au bâtiment (matériels posés)', 'check'], ['grille', 'Quadrillage de repérage (A à T, 01 à 14)', 'check'],
    ['vues', 'Vues intérieures (Réf. = niveau + case du quadrillage, ex. « RDC D.11 »)', 'table', [['Niveau', 'text', 2], ['Réf.', 'text', 2], ['Vue', 'image', 3], ['Légende', 'text', 4]]]] },
  { k: 'video', t: 'Vidéoprotection et vidéosurveillance', hint: 'Caméras extérieures (vidéoprotection) et intérieures (vidéosurveillance) : leur emplacement figure sur les plans.', f: [['auto', 'Reprendre automatiquement les caméras posées dans le projet rattaché', 'check'], ['carte', 'Reprendre les caméras de la carte (associées au bâtiment ou dans le rayon ci-dessous)', 'check'], ['rayon', 'Rayon autour du bâtiment (mètres)', 'text'], ['schema', 'Schéma de situation des caméras de la carte autour du bâtiment', 'check'],
    ['rows', 'Caméras supplémentaires (non posées sur le plan)', 'table', [['Repère', 'text', 1], ['Type', 'text', 2], ['Emplacement (niveau, case)', 'text', 2], ['Zone filmée', 'textarea', 3], ['Exploitant / observations', 'textarea', 3], ['Visuel', 'image', 2]]], ['note', 'Poste de visualisation, enregistrement, accès à distance', 'textarea', 3]] },
  { k: 'locaux', t: 'Locaux techniques sensibles', f: [['rows', '', 'table', [['Thème', 'text', 2], ['Descriptif', 'textarea', 3], ['Visuel', 'image', 2], ['Lieux', 'textarea', 3], ['Clé / observations', 'textarea', 2]]]] },
  { k: 'portes', t: 'Accès : les portes', f: [['rows', '', 'table', [['Type', 'text', 2], ['Descriptif', 'textarea', 3], ['Visuel', 'image', 2], ['Ouverture int./ext.', 'textarea', 3], ['Observations', 'textarea', 2]]]] },
  { k: 'menaces', t: 'Les menaces', f: [['intro', 'Introduction', 'textarea', 3], ['items', 'Menaces (une par ligne)', 'list']] },
  { k: 'scen', t: 'Scénarios possibles', f: [['intro', 'Introduction', 'textarea', 2], ['items', 'Scénarios (un par ligne)', 'list']] },
  { k: 'analyse', t: 'Analyse : points forts et faibles', f: [['forts', 'Points forts (un par ligne)', 'list'], ['faibles', 'Points faibles (un par ligne)', 'list']] },
  { k: 'action', t: 'Plan d\'action', f: [['connaitre', 'Avant — Connaître', 'textarea', 3], ['preparer', 'Avant — Se préparer', 'textarea', 4], ['identifier', 'Pendant — Identifier le danger', 'textarea', 4], ['reagir', 'Pendant — Réagir', 'textarea', 5]] },
  { k: 'arbre', t: 'Arbre de décision', hint: 'Schéma type : alerte, fuite, confinement ou retranchement, prévenir.', f: [] },
  { k: 'diffusion', t: 'Diffusion', f: [['avant', 'Avant la crise : destinataires (un par ligne)', 'list'], ['crise', 'Situation de crise : intervenants (un par ligne)', 'list']] },
  { k: 'conclusion', t: 'Conclusion', f: [['texte', 'Texte', 'textarea', 5]] }
];
const pdsInc = (k) => PDS.d && PDS.d.inc[k] !== false;

/* ---------------------------------------------------------------- ouverture */
async function openPds(batId) {
  if (!S.user) return;
  try { await loadBatiments(true); } catch {}
  const f = batFind(batId); if (!f) { toast('Bâtiment introuvable.', true); return; }
  let d = null; try { d = await window.native.pds.load(batId); } catch (e) { toast(e.message, true); return; }
  PDS.batId = batId; PDS.bat = f.b; PDS.terr = f.t; PDS.d = d || pdsNew(f.b, f.t); PDS.isNew = !d; PDS.dirty = !d; PDS.sec = 'garde';
  PDS.d.batNom = f.b.nom; PDS.d.client = f.t.nom;
  if (!PDS.d.video) PDS.d.video = { auto: true, carte: true, rayon: '150', schema: true, rows: [], note: '' };
  if (PDS.d.video.carte === undefined) Object.assign(PDS.d.video, { carte: true, rayon: '150', schema: true });
  $('#pdsView').hidden = false; $('#pdsTitle').textContent = `Protocole de sûreté — ${f.b.nom}`; $('#pdsSub').textContent = `${f.t.nom}${f.t.commune && f.t.commune.nom ? ' · ' + f.t.commune.nom : ''}${d && d.maj ? ` · modifié le ${new Date(d.maj).toLocaleDateString('fr-FR')}${d.majPar ? ' par ' + d.majPar : ''}` : ' · nouveau protocole'}`;
  $('#pdsSave').hidden = !can('batiments'); $('#pdsDel').hidden = !can('batiments') || !d;
  pdsRender();
}
async function closePds() {
  if (PDS.dirty && can('batiments')) {
    const r = await modal({ title: 'Protocole non enregistré', body: '<p style="margin:0">Enregistrer les modifications du protocole de sûreté ?</p>', buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ne pas enregistrer', value: 'no' }, { label: 'Enregistrer', cls: 'primary', value: 'yes' }] });
    if (r === 'cancel' || r === null) return; if (r === 'yes' && !(await pdsSave())) return;
  }
  $('#pdsView').hidden = true; PDS.d = null; PDS.dirty = false;
  pdsRefreshList();
}
async function pdsSave() {
  try { await window.native.pds.save(PDS.batId, PDS.d); PDS.dirty = false; PDS.isNew = false; $('#pdsDel').hidden = false; toast('Protocole de sûreté enregistré'); pdsRefreshList(); return true; }
  catch (e) { toast('Enregistrement impossible : ' + e.message, true); return false; }
}
async function pdsRefreshList() { try { PDS.list = await window.native.pds.list(); } catch { PDS.list = {}; } }
const pdsMark = () => { PDS.dirty = true; };

/* ---------------------------------------------------------------- éditeur */
function pdsRender() {
  $('#pdsNav').innerHTML = PDS_SEC.map(s => `<div class="pds-nv${s.k === PDS.sec ? ' on' : ''}"><input type="checkbox" data-inc="${s.k}" ${pdsInc(s.k) ? 'checked' : ''} title="Inclure dans le document"><button type="button" data-sec="${s.k}">${esc(s.t)}</button></div>`).join('');
  const s = PDS_SEC.find(x => x.k === PDS.sec); const o = PDS.d[s.k] = PDS.d[s.k] || {};
  const ro = !can('batiments') ? 'disabled' : '';
  let h = `<h2>${esc(s.t)}</h2>${s.hint ? `<p class="muted" style="margin:0">${esc(s.hint)}</p>` : ''}${pdsInc(s.k) ? '' : '<div class="warnbox">Cette rubrique n\'est pas incluse dans le document (case décochée à gauche).</div>'}`;
  for (const [k, label, type, extra] of s.f) {
    if (type === 'text') h += `<label class="field"><span>${esc(label)}</span><input type="text" data-f="${k}" value="${esc(o[k] ?? '')}" ${ro}></label>`;
    else if (type === 'textarea') h += `<label class="field"><span>${esc(label)}</span><textarea data-f="${k}" rows="${extra || 3}" ${ro}>${esc(o[k] ?? '')}</textarea></label>`;
    else if (type === 'check') h += `<label class="chk"><input type="checkbox" data-f="${k}" ${o[k] ? 'checked' : ''} ${ro}> ${esc(label)}</label>`;
    else if (type === 'list') h += `<label class="field"><span>${esc(label)}</span><textarea data-list="${k}" rows="${Math.max(4, (o[k] || []).length + 1)}" ${ro}>${esc((o[k] || []).join('\n'))}</textarea></label>`;
    else if (type === 'image') h += `<div class="field"><span>${esc(label)}</span>${pdsImgCell(o[k], `f:${k}`)}</div>`;
    else if (type === 'images') { const arr = o[k] = o[k] || []; h += `<div class="field"><span>${esc(label)}</span><div class="pds-imgs">${arr.map((u, i) => pdsImgCell(u, `fa:${k}:${i}`)).join('')}${arr.length < extra && !ro ? `<button type="button" class="pds-addimg" data-addimg="${k}">+ Image</button>` : ''}</div></div>`; }
    else if (type === 'table' || type === 'rows' || type === 'pages') {
      const key = k || 'rows'; const rows = type === 'table' ? (o[key] = o[key] || []) : (PDS.d[s.k] = Array.isArray(PDS.d[s.k]) ? PDS.d[s.k] : []);
      const cols = extra; const tw = cols.reduce((a, c) => a + (c[2] || 3), 0);
      h += `${label ? `<div class="field"><span>${esc(label)}</span></div>` : ''}<div class="pds-tw"><table class="pds-t"><thead><tr>${cols.map(c => `<th style="width:${(c[2] || 3) * 100 / tw}%">${esc(c[0])}</th>`).join('')}<th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr>${cols.map((c, j) => `<td>${c[1] === 'image' ? pdsImgCell(r[j], `t:${type === 'table' ? key : ''}:${i}:${j}`, true) : c[1] === 'textarea' ? `<textarea rows="2" data-t="${type === 'table' ? key : ''}" data-r="${i}" data-c="${j}" ${ro}>${esc(r[j] ?? '')}</textarea>` : `<input type="text" data-t="${type === 'table' ? key : ''}" data-r="${i}" data-c="${j}" value="${esc(r[j] ?? '')}" ${ro}>`}</td>`).join('')}
          <td class="act">${ro ? '' : `<button type="button" class="ghost small" data-up="${type === 'table' ? key : ''}" data-r="${i}" title="Monter">↑</button><button type="button" class="ghost small danger" data-rm="${type === 'table' ? key : ''}" data-r="${i}" title="Supprimer la ligne">✕</button>`}</td></tr>`).join('')}</tbody></table>
        ${ro ? '' : `<button type="button" data-add="${type === 'table' ? key : ''}" data-n="${cols.length}">+ Ajouter une ligne</button>`}</div>`;
      if (s.k === 'plans' && !ro) h += `<div class="btnrow"><button type="button" id="pdsVuesProj">Reprendre les photos du projet rattaché</button></div><p class="muted" style="margin:0;font-size:12px">${PDS.bat.projet ? `Projet rattaché : <b>${esc(PDS.bat.projet.fichier || '')}</b> (${PDS.bat.projet.niveaux?.length || 0} niveau(x)). Ses plans, avec les matériels posés, sont insérés dans le document.` : 'Aucun projet rattaché à ce bâtiment : rattachez-en un depuis le panneau « Projet » pour insérer les plans.'}</p>`;
    }
  }
  if (s.k === 'arbre') h += '<div class="info">Le schéma est généré automatiquement : Alerte → position de la situation connue (fuite à l\'opposé, prévenir les alentours et les secours) ou non connue → dans un local : confinement (lieu connu), sinon retranchement (lieu inconnu) → prévenir.</div>';
  h += `<div class="btnrow pds-nav2">${PDS_SEC.findIndex(x => x.k === s.k) > 0 ? '<button type="button" data-step="-1">← Rubrique précédente</button>' : ''}${PDS_SEC.findIndex(x => x.k === s.k) < PDS_SEC.length - 1 ? '<button type="button" class="primary" data-step="1">Rubrique suivante →</button>' : ''}</div>`;
  $('#pdsForm').innerHTML = h; $('#pdsForm').scrollTop = 0;
}
function pdsImgCell(u, ref, small = false) {
  const ro = !can('batiments');
  return `<div class="pds-img${small ? ' sm' : ''}">${u ? `<img src="${u}" alt="">` : '<span class="muted">Aucune image</span>'}
    ${ro ? '' : `<div class="btnrow"><button type="button" class="small" data-img="${ref}">${u ? 'Changer' : 'Choisir'}…</button>${u ? `<button type="button" class="small ghost danger" data-noimg="${ref}">✕</button>` : ''}</div>`}</div>`;
}
/* choix d'une image : fichier ou photos du projet ouvert */
async function pdsPickImage() {
  const photos = (S.project && S.project.photos) || [];
  let pick = 'file';
  if (photos.length) {
    pick = await modal({ title: 'Choisir une image', size: 'md', body: `<p style="margin:0">Une photo du projet ouvert, ou une image de votre ordinateur.</p><div class="pds-pick">${photos.map((p, i) => `<button type="button" data-i="${i}" title="${esc(p.legende || '')}"><img src="${p.url}" alt=""><small>${esc(p.legende || '')}</small></button>`).join('')}</div>`,
      onMount: (root, close) => $$('[data-i]', root).forEach(b => b.onclick = () => close(+b.dataset.i)),
      buttons: [{ label: 'Annuler', value: null }, { label: 'Depuis un fichier…', cls: 'primary', value: 'file' }] });
    if (pick === null || pick === undefined) return null;
    if (pick !== 'file') return photos[pick].url;
  }
  const f = await window.native.openFile({ purpose: 'logo', title: 'Choisir une image', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (!f) return null;
  const ext = f.name.split('.').pop().toLowerCase();
  const url = await bytesToDataUrl(f.data, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  const img = await loadImg(url); const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
function pdsSetRef(ref, val) {
  const s = PDS.sec; const o = PDS.d[s]; const p = ref.split(':');
  if (p[0] === 'f') o[p[1]] = val;
  else if (p[0] === 'fa') { if (val) o[p[1]][+p[2]] = val; else o[p[1]].splice(+p[2], 1); }
  else if (p[0] === 't') { const rows = p[1] ? o[p[1]] : PDS.d[s]; rows[+p[2]][+p[3]] = val; }
  pdsMark();
}
function pdsRows(key) { const s = PDS.sec; return key ? PDS.d[s][key] : PDS.d[s]; }
(function bindPds() {
  $('#pdsClose').onclick = closePds;
  $('#pdsSave').onclick = pdsSave;
  $('#pdsPdf').onclick = () => pdsExport('pdf');
  $('#pdsPptx').onclick = () => pdsExport('pptx');
  $('#pdsDel').onclick = async () => {
    if (!await confirmBox('Supprimer le protocole', `Supprimer le protocole de sûreté de « ${PDS.bat.nom} » ? Cette action est définitive.`, 'Supprimer', true)) return;
    try { await window.native.pds.remove(PDS.batId); PDS.dirty = false; toast('Protocole supprimé'); $('#pdsView').hidden = true; PDS.d = null; pdsRefreshList(); } catch (e) { toast(e.message, true); }
  };
  const nav = $('#pdsNav');
  nav.onclick = (e) => { const b = e.target.closest('[data-sec]'); if (b) { PDS.sec = b.dataset.sec; pdsRender(); } };
  nav.onchange = (e) => { const c = e.target.closest('[data-inc]'); if (c) { PDS.d.inc[c.dataset.inc] = c.checked; pdsMark(); pdsRender(); } };
  const form = $('#pdsForm');
  form.addEventListener('input', (e) => {
    const el = e.target; const o = PDS.d[PDS.sec];
    if (el.dataset.f) { o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; pdsMark(); }
    else if (el.dataset.list) { o[el.dataset.list] = el.value.split('\n').map(x => x.trim()).filter(Boolean); pdsMark(); }
    else if (el.dataset.r !== undefined && el.dataset.c !== undefined) { pdsRows(el.dataset.t)[+el.dataset.r][+el.dataset.c] = el.value; pdsMark(); }
  });
  form.addEventListener('change', (e) => { if (e.target.dataset.f && e.target.type === 'checkbox') { PDS.d[PDS.sec][e.target.dataset.f] = e.target.checked; pdsMark(); } });
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step) { const i = PDS_SEC.findIndex(x => x.k === PDS.sec) + +b.dataset.step; PDS.sec = PDS_SEC[i].k; pdsRender(); return; }
    if (b.dataset.img) { const u = await pdsPickImage(); if (u) { pdsSetRef(b.dataset.img, u); pdsRender(); } return; }
    if (b.dataset.noimg) { pdsSetRef(b.dataset.noimg, b.dataset.noimg.startsWith('fa:') ? null : ''); pdsRender(); return; }
    if (b.dataset.addimg) { const u = await pdsPickImage(); if (u) { PDS.d[PDS.sec][b.dataset.addimg].push(u); pdsMark(); pdsRender(); } return; }
    if (b.dataset.add !== undefined) { pdsRows(b.dataset.add).push(Array.from({ length: +b.dataset.n }, () => '')); pdsMark(); pdsRender(); return; }
    if (b.dataset.rm !== undefined) { pdsRows(b.dataset.rm).splice(+b.dataset.r, 1); pdsMark(); pdsRender(); return; }
    if (b.dataset.up !== undefined) { const rows = pdsRows(b.dataset.up), i = +b.dataset.r; if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; pdsMark(); pdsRender(); } return; }
    if (b.id === 'pdsVuesProj') return pdsVuesFromProject();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#pdsView').hidden || $('#modalRoot').children.length) return;
    if (e.key === 'Escape') { e.stopPropagation(); closePds(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); if (can('batiments')) pdsSave(); }
  }, true);
})();

/* ---------------------------------------------------------------- plans du projet rattaché */
async function pdsLinkedProject() {
  if (!PDS.bat || !PDS.bat.projet) return null;
  try { const f = await window.native.carte.openProject(PDS.batId); const p = JSON.parse(new TextDecoder().decode(f.data)); return Array.isArray(p.levels) ? p : null; }
  catch (e) { toast('Projet rattaché illisible : ' + e.message, true); return null; }
}
const PDS_COLS = 'ABCDEFGHIJKLMNOPQRST', PDS_ROWS = 14;
const pdsCell = (l, x, y) => typeof gridRef === 'function' ? gridRef(l, x, y) : `${PDS_COLS[Math.min(19, Math.max(0, Math.floor(x / l.plan.w * 20)))]}.${String(Math.min(PDS_ROWS, Math.max(1, Math.floor(y / l.plan.h * PDS_ROWS) + 1))).padStart(2, '0')}`;
async function pdsVuesFromProject() {
  const p = await pdsLinkedProject(); if (!p) { toast('Aucun projet rattaché à ce bâtiment.', true); return; }
  const rows = PDS.d.plans.vues = PDS.d.plans.vues || []; let n = 0;
  for (const ph of (p.photos || [])) {
    let lvl = '', ref = '';
    if (ph.pos) { const l = p.levels.find(x => x.id === ph.pos.levelId); if (l) { lvl = l.name; ref = `${l.name} ${pdsCell(l, ph.pos.x, ph.pos.y)}`; } }
    else if (ph.markerId) for (const l of p.levels) { const m = l.markers.find(x => x.id === ph.markerId); if (m) { lvl = l.name; ref = `${l.name} ${pdsCell(l, m.x, m.y)}`; } }
    if (rows.some(r => r[2] === ph.url)) continue;
    rows.push([lvl, ref, ph.url, ph.legende || '']); n++;
  }
  pdsMark(); pdsRender(); toast(n ? `${n} photo(s) reprise(s) du projet` : 'Aucune nouvelle photo dans le projet rattaché.');
}
/* plan d'un niveau avec matériels, quadrillage de repérage A–T / 01–14 */
async function pdsPlanImage(proj, l, grid) {
  const keep = S.project; let r;
  try { S.project = { ...proj, typeCache: proj.typeCache || {} }; r = await rasterLevel(l, 2400); } finally { S.project = keep; }
  if (!grid) return r;
  const img = await loadImg(r.url); const m = Math.round(Math.max(r.w, r.h) * 0.03);
  const c = document.createElement('canvas'); c.width = r.w + 2 * m; c.height = r.h + 2 * m; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, m, m, r.w, r.h);
  g.strokeStyle = 'rgba(56,160,200,.55)'; g.lineWidth = Math.max(1, r.w / 1600);
  const cw = r.w / 20, ch = r.h / PDS_ROWS;
  for (let i = 0; i <= 20; i++) { g.beginPath(); g.moveTo(m + i * cw, m); g.lineTo(m + i * cw, m + r.h); g.stroke(); }
  for (let j = 0; j <= PDS_ROWS; j++) { g.beginPath(); g.moveTo(m, m + j * ch); g.lineTo(m + r.w, m + j * ch); g.stroke(); }
  g.fillStyle = '#12304a'; g.font = `bold ${Math.round(m * 0.55)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 20; i++) { g.fillText(PDS_COLS[i], m + (i + 0.5) * cw, m / 2); g.fillText(PDS_COLS[i], m + (i + 0.5) * cw, c.height - m / 2); }
  for (let j = 0; j < PDS_ROWS; j++) { const t = String(j + 1).padStart(2, '0'); g.fillText(t, m / 2, m + (j + 0.5) * ch); g.fillText(t, c.width - m / 2, m + (j + 0.5) * ch); }
  return { url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
}

/* ---------------------------------------------------------------- mise en page (mm, A4 paysage 297 × 210) */
const PW = 297, PH = 210;
const pdsTxt = (s) => String(s ?? '').replace(/[‘’ʼ]/g, '\'').replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[   ]/g, ' ').replace(/œ/g, 'oe').replace(/Œ/g, 'OE');
async function pdsBuild(meas) {
  const d = PDS.d, g = d.garde || {}, pages = [];
  const nomEtab = g.nom || PDS.bat.nom;
  const lines = (s, w, size, bold) => { meas.setFont('helvetica', bold ? 'bold' : 'normal'); meas.setFontSize(size); return meas.splitTextToSize(pdsTxt(s), w); };
  const th = (s, w, size, bold, lh = 1.25) => lines(s, w, size, bold).length * size * 0.3528 * lh;
  const P = (titre, sous, opts = {}) => { const p = { titre, sous, el: [], toc: opts.toc, plain: opts.plain }; pages.push(p); return p; };
  const T = (p, s, x, y, w, h, o = {}) => p.el.push({ t: 'text', s: pdsTxt(s), x, y, w, h, size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: o.color || 'FFFFFF', align: o.align || 'left', valign: o.valign || 'top', fill: o.fill });
  const R = (p, x, y, w, h, o = {}) => p.el.push({ t: 'rect', x, y, w, h, fill: o.fill, line: o.line, lw: o.lw || 0.3, r: o.r });
  const E = (p, x, y, w, h, o = {}) => p.el.push({ t: 'ell', x, y, w, h, fill: o.fill, line: o.line });
  const I = (p, url, x, y, w, h) => { if (url) p.el.push({ t: 'img', url, x, y, w, h }); };
  const L = (p, x1, y1, x2, y2, o = {}) => p.el.push({ t: 'line', x1, y1, x2, y2, color: o.color || 'FFFFFF', lw: o.lw || 0.5, arrow: !!o.arrow });
  const Y0 = 34, Y1 = 196, X0 = 14, X1 = PW - 14, CW = X1 - X0;
  // tableau générique (en-tête gris clair, cellules sombres bordées de blanc)
  const table = (p, x, y, cols, rows, o = {}) => {
    const size = o.size || 8.5, head = o.head !== false, ws = cols.map(c => c.w), imgH = o.imgH || 26;
    let yy = y;
    if (head) { let xx = x; cols.forEach((c, i) => { R(p, xx, yy, ws[i], 7, { fill: 'D9D9D9', line: 'FFFFFF' }); T(p, c.h, xx + 1, yy, ws[i] - 2, 7, { size: 8, bold: true, color: '1F1F1F', align: 'center', valign: 'middle' }); xx += ws[i]; }); yy += 7; }
    for (const r of rows) {
      const hh = Math.max(o.minH || 9, ...cols.map((c, i) => c.img ? (r[i] ? imgH + 2 : 9) : th(r[i], ws[i] - 3, size, c.bold) + 3));
      let xx = x;
      cols.forEach((c, i) => {
        R(p, xx, yy, ws[i], hh, { line: 'BFBFBF', fill: c.fill });
        if (c.img) { if (r[i]) I(p, r[i], xx + 1, yy + 1, ws[i] - 2, hh - 2); }
        else T(p, r[i], xx + 1.5, yy + 1.2, ws[i] - 3, hh - 2, { size, bold: c.bold, align: c.align || 'left', valign: c.valign || 'middle', color: c.color });
        xx += ws[i];
      });
      yy += hh;
    }
    return yy;
  };
  const rowH = (cols, r, o = {}) => Math.max(o.minH || 9, ...cols.map((c, i) => c.img ? (r[i] ? (o.imgH || 26) + 2 : 9) : th(r[i], c.w - 3, o.size || 8.5, c.bold) + 3));
  const paginate = (rows, cols, o = {}, avail = Y1 - Y0 - 8) => { const out = []; let cur = [], h = 0; for (const r of rows) { const rh = rowH(cols, r, o); if (cur.length && h + rh > avail) { out.push(cur); cur = []; h = 0; } cur.push(r); h += rh; } if (cur.length) out.push(cur); return out; };
  const bullets = (p, items, x, y, w, size = 10.5, gap = 3) => { let yy = y; for (const it of items) { const h = th(it, w - 6, size); T(p, '•', x, yy, 4, h, { size }); T(p, it, x + 5, yy, w - 6, h + 1, { size }); yy += h + gap; } return yy; };
  const imgRow = async (p, urls, x, y, w, h, gap = 4) => { const u = urls.filter(Boolean); const n = u.length; if (!n) return; const iw = (w - gap * (n - 1)) / n; u.forEach((url, i) => I(p, url, x + i * (iw + gap), y, iw, h)); };

  // 1. couverture
  const cov = P('', '', { plain: true }); cov.cover = true;
  // 2. avertissements
  if (pdsInc('avert')) { const p = P('Avertissements', ''); const av = d.avert || {};
    T(p, av.texte, 30, Y0 + 4, PW - 60, 120, { size: 11, align: 'center' });
    T(p, av.devise, 30, Y1 - 22, PW - 60, 12, { size: 12, bold: true, align: 'center' }); }
  // 3. page de titre et contacts
  if (pdsInc('garde')) { const p = P('', '', { toc: 'Contacts' }); p.titleBlock = true;
    T(p, g.titre || 'Protocole de sûreté', 16, 32, 140, 12, { size: 20, bold: true, align: 'center' });
    T(p, [g.type, nomEtab].filter(Boolean).join('\n'), 16, 48, 140, 22, { size: 14, bold: true, italic: true, align: 'center' });
    T(p, g.adresse, 16, 72, 140, 22, { size: 10.5, bold: true, align: 'center' });
    const gp = typeof posOf === 'function' ? posOf(PDS.bat) : null; if (gp && g.gps !== false) T(p, `GPS : ${gpsText(gp)}  (${toDms(gp.lat, true)} ${toDms(gp.lon, false)})`, 16, 95, 140, 6, { size: 8.5, align: 'center', color: 'D9D9D9' });
    I(p, g.photo, 165, 30, 118, 74);
    const cw = [30, 40, 30, 34, 50], ct = cw.reduce((a, b) => a + b, 0), k = 236 / ct;
    table(p, 30, 112, ['Fonction', 'Nom', 'Prénom', 'Téléphone', 'E-mail'].map((h, i) => ({ h, w: cw[i] * k })), (g.contacts || []).filter(r => r.some(Boolean)).slice(0, 8), { size: 9 });
    T(p, `Date : ${g.date || ''}`, 16, 192, 80, 6, { size: 8 }); }
  const tocAt = pages.length; P('Table des matières', nomEtab, {}); // sommaire (rempli à la fin)
  // environnement
  if (pdsInc('env')) { const e = d.env || {}; const p = P('Environnement', nomEtab, { toc: 'Environnement' });
    const h = e.texte ? th(e.texte, CW - 20, 10.5) + 4 : 0; if (e.texte) T(p, e.texte, X0 + 10, Y0, CW - 20, h, { size: 10.5, align: 'center' });
    I(p, e.image, X0 + 20, Y0 + h + 2, CW - 40, Y1 - Y0 - h - 2); }
  // éléments généraux
  if (pdsInc('gen')) { const e = d.gen || {}; const p = P('Éléments généraux', nomEtab, { toc: 'Éléments généraux' });
    const rows = [['Bâtiment', 'Type', e.type], ['Bâtiment', 'Descriptif', e.descriptif], ['Bâtiment', 'Entrée principale', e.entree], ['Bâtiment', 'Sorties de secours', e.sorties], ['Bâtiment', 'Nombre de salles / locaux', e.nbLocaux], ['Bâtiment', 'Répartition', e.repartition],
      ['Personnes', 'Nombre de personnes', e.nbPersonnes], ['Personnes', 'Personnel / jour', e.personnelJour], ['Personnes', 'Personnel sûreté', e.personnelSurete], ['Personnes', 'Personnel armé', e.personnelArme], ['Divers', 'Horaires public', e.horaires], ['Divers', 'Affluence', e.influence]].filter(r => r[2]);
    const hasPh = (e.photos || []).filter(Boolean).length; const tw = hasPh ? 200 : CW;
    let yy = Y0; let grp = null, gy = yy;
    for (const r of rows) {
      const h = Math.max(8, th(r[2], tw - 71, 9, true) + 3);
      if (grp !== r[0]) { if (grp) { R(p, X0, gy, 17, yy - gy, { line: 'BFBFBF' }); T(p, grp, X0, gy, 17, yy - gy, { size: 7.5, bold: true, align: 'center', valign: 'middle' }); } grp = r[0]; gy = yy; }
      R(p, X0 + 17, yy, 50, h, { line: 'BFBFBF' }); T(p, r[1], X0 + 18, yy, 48, h, { size: 8.5, align: 'center', valign: 'middle' });
      R(p, X0 + 67, yy, tw - 67, h, { line: 'BFBFBF' }); T(p, r[2], X0 + 69, yy + 1, tw - 71, h - 1, { size: 9, bold: true, align: 'center', valign: 'middle' });
      yy += h; if (yy > Y1) break;
    }
    if (grp) { R(p, X0, gy, 17, yy - gy, { line: 'BFBFBF' }); T(p, grp, X0, gy, 17, yy - gy, { size: 7.5, bold: true, align: 'center', valign: 'middle' }); }
    if (hasPh) { const ph = e.photos.filter(Boolean).slice(0, 3); const hh = (Y1 - Y0 - 8) / ph.length; ph.forEach((u, i) => I(p, u, X0 + 206, Y0 + i * (hh + 4), CW - 206, hh)); } }
  // localisation
  if (pdsInc('loc')) { const e = d.loc || {}; const p = P('Extérieurs', 'Localisation', { toc: 'Localisation' });
    let yy = Y0; if (e.texte) { const h = th(e.texte, CW, 10); T(p, e.texte, X0, yy, CW, h, { size: 10 }); yy += h + 3; }
    const foot = (e.arrivee ? 14 : 0) + (e.parking ? 8 : 0);
    await imgRow(p, e.images || [], X0, yy, CW, Y1 - yy - foot - 3);
    let fy = Y1 - foot; if (e.arrivee) { T(p, 'Arrivée sous protection visuelle et balistique : ' + e.arrivee, X0, fy, CW, 13, { size: 10, bold: true, color: 'FFD966' }); fy += 14; }
    if (e.parking) T(p, 'Stationnement : ' + e.parking, X0, fy, CW, 8, { size: 10, bold: true, color: '7FB2F0' });
    const gp = typeof posOf === 'function' ? posOf(PDS.bat) : null; if (gp) T(p, `Coordonnées GPS : ${gpsText(gp)}  —  ${toDms(gp.lat, true)}  ${toDms(gp.lon, false)}`, X0, Y0 - 6, CW, 6, { size: 9, bold: true, align: 'right', color: 'FFD966' }); }
  // mesures conservatoires
  if (pdsInc('conserv')) { const e = d.conserv || {}; const p = P('Extérieurs', 'Mesures conservatoires', { toc: 'Mesures conservatoires' });
    T(p, 'Ratio des dangers', X0, Y0, CW, 7, { size: 11, align: 'center' });
    T(p, `Balles / Explosif : zone d'exclusion de ${e.distance || '250'} m minimum`, X0, Y0 + 7, CW, 9, { size: 13, bold: true, align: 'center' });
    I(p, e.image, X0, Y0 + 20, 140, 120);
    const pts = (e.points || []).filter(r => r[1]); let yy = Y0 + 22;
    for (const r of pts) { E(p, 160, yy, 6, 6, { fill: 'F28C28' }); T(p, r[0], 160, yy, 6, 6, { size: 7.5, bold: true, align: 'center', valign: 'middle' }); const h = Math.max(6.5, th(r[1], 118, 9.5)); T(p, r[1], 169, yy + 0.3, 118, h, { size: 9.5 }); yy += h + 2; if (yy > Y1 - 10) break; }
    let ly = Y1 - 22; for (const lg of String(e.legende || '').split('\n').filter(Boolean).slice(0, 3)) { R(p, X0, ly + 1, 4, 4, { fill: '6AA84F' }); T(p, lg, X0 + 6, ly, 130, 6, { size: 8.5 }); ly += 7; } }
  // baptême terrain
  if (pdsInc('bapteme')) { const e = d.bapteme || {}; const p = P('Extérieurs', 'Baptême terrain', { toc: 'Baptême terrain' });
    I(p, e.image, X0, Y0, 130, 150);
    let yy = Y0; if (e.texte) { const h = th(e.texte, 135, 10); T(p, e.texte, 150, yy, 135, h, { size: 10, align: 'center' }); yy += h + 4; }
    yy = bullets(p, (e.faces || []).filter(r => r[1]).map(r => `${r[0]} : ${r[1]}`), 150, yy, 135, 10, 2.5);
    const ph = (e.photos || []).filter(Boolean);
    if (ph.length) { const p2 = P('Extérieurs', 'Baptême terrain — façades'); const n = ph.length, cols = n > 2 ? 2 : n, rws = Math.ceil(n / cols), w = (CW - (cols - 1) * 5) / cols, h = (Y1 - Y0 - (rws - 1) * 5) / rws; ph.forEach((u, i) => I(p2, u, X0 + (i % cols) * (w + 5), Y0 + Math.floor(i / cols) * (h + 5), w, h)); } }
  // vues extérieures
  if (pdsInc('visuels')) for (const [i, r] of (d.visuels || []).entries()) { if (!r.some(Boolean)) continue;
    const p = P('Extérieurs', r[0] || 'Visuel', { toc: i === 0 ? 'Vues extérieures' : null }); if (r[1]) T(p, r[1], X0, Y0 - 2, CW, 7, { size: 10, bold: true, align: 'right', color: 'FFD966' });
    let yy = Y0 + 6, xw = CW; if (r[2]) { T(p, r[2], X0, yy, 80, Y1 - yy, { size: 9.5 }); }
    const x = r[2] ? X0 + 86 : X0; xw = r[2] ? CW - 86 : CW; await imgRow(p, [r[3], r[4]], x, yy, xw, Y1 - yy); }
  // sorties de secours
  if (pdsInc('sorties')) { const groups = new Map(); for (const r of (d.sorties || [])) { if (!r.some(Boolean)) continue; const k = r[0] || 'Sorties de secours'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    let first = true;
    const cols = [{ h: 'Réf', w: 20, align: 'center' }, { h: 'Lieux', w: 52, align: 'center' }, { h: 'Vue extérieure', w: 64, img: true }, { h: 'Zones desservies', w: 50, align: 'center' }, { h: 'Observation', w: CW - 12 - 186, align: 'center' }];
    for (const [fac, rows] of groups) for (const chunk of paginate(rows.map(r => [r[1], r[2], r[3], r[4], r[5]]), cols, { size: 8.5, imgH: 40 }, Y1 - Y0 - 18)) {
      const p = P('Extérieurs', 'Les sorties de secours', { toc: first ? 'Sorties de secours' : null }); first = false;
      T(p, fac, X0, Y0 - 2, CW, 9, { size: 13, bold: true, align: 'center' });
      table(p, X0 + 6, Y0 + 9, cols, chunk, { size: 8.5, imgH: 40 });
    } }
  // salles
  if (pdsInc('salles')) { const e = d.salles || {}; const rows = (e.rows || []).filter(r => r.some(Boolean));
    const cols = [{ h: 'N°', w: 16, align: 'center' }, { h: 'Entrée', w: 34, align: 'center' }, { h: 'Places', w: 34, align: 'center' }, { h: 'Accès à la salle', w: 92, align: 'center' }, { h: 'Sortie de secours / escalier', w: CW - 8 - 176 }];
    const pg = paginate(rows, cols, { size: 8.5 }, Y1 - Y0 - 22);
    pg.forEach((chunk, i) => { const p = P('Intérieur', 'Les salles', { toc: i === 0 ? 'Salles et locaux' : null });
      const yy = table(p, X0 + 4, Y0, cols, chunk, { size: 8.5 });
      if (e.note && i === pg.length - 1) T(p, e.note, X0 + 4, Math.min(yy + 4, Y1 - 10), CW - 8, 10, { size: 9, italic: true }); }); }
  // plans et vues
  if (pdsInc('plans')) { const e = d.plans || {}; let firstP = true;
    const proj = e.projet ? await pdsLinkedProject() : null;
    if (proj) for (const l of proj.levels) { if (!l.plan || !l.plan.dataUrl) continue;
      const im = await pdsPlanImage(proj, l, e.grille !== false && !l.grilleZone);
      const p = P('Intérieur Plans', `${nomEtab} — ${l.name}`, { toc: firstP ? 'Plans des étages et vues' : null }); firstP = false;
      R(p, X0, Y0 - 2, CW, Y1 - Y0 + 4, { fill: 'FFFFFF' }); I(p, im.url, X0 + 1, Y0 - 1, CW - 2, Y1 - Y0 + 2); }
    const vues = (e.vues || []).filter(r => r[2]); const byLvl = new Map(); vues.forEach(r => { const k = r[0] || ''; if (!byLvl.has(k)) byLvl.set(k, []); byLvl.get(k).push(r); });
    for (const [lv, arr] of byLvl) for (let i = 0; i < arr.length; i += 4) {
      const p = P('Intérieur', [nomEtab, lv].filter(Boolean).join(' — '), { toc: firstP ? 'Plans des étages et vues' : null }); firstP = false;
      const ch = arr.slice(i, i + 4); const cw = [22, CW / 2 - 22 - 4]; const rh = (Y1 - Y0 - 8) / 2;
      [0, 1].forEach(c => { const x = X0 + c * CW / 2; R(p, x, Y0, cw[0], 7, { fill: 'D9D9D9', line: 'FFFFFF' }); T(p, 'Réf', x, Y0, cw[0], 7, { size: 8, bold: true, color: '1F1F1F', align: 'center', valign: 'middle' }); R(p, x + cw[0], Y0, cw[1], 7, { fill: 'D9D9D9', line: 'FFFFFF' }); T(p, 'Vue', x + cw[0], Y0, cw[1], 7, { size: 8, bold: true, color: '1F1F1F', align: 'center', valign: 'middle' }); });
      ch.forEach((r, k) => { const c = k % 2, rr = Math.floor(k / 2); const x = X0 + c * CW / 2, y = Y0 + 7 + rr * rh;
        R(p, x, y, cw[0], rh, { line: 'BFBFBF' }); T(p, r[1] || r[0], x + 1, y, cw[0] - 2, rh, { size: 8, align: 'center', valign: 'middle' });
        R(p, x + cw[0], y, cw[1], rh, { line: 'BFBFBF' }); I(p, r[2], x + cw[0] + 1.5, y + 1.5, cw[1] - 3, rh - (r[3] ? 9 : 3)); if (r[3]) T(p, r[3], x + cw[0] + 1, y + rh - 7.5, cw[1] - 2, 6, { size: 8, align: 'center', valign: 'middle' }); });
    } }
  // vidéoprotection et vidéosurveillance
  if (pdsInc('video')) { const e = d.video || {}; const rows = [];
    if (e.auto !== false) { const proj = await pdsLinkedProject(); if (proj) for (const l of proj.levels) for (const m of l.markers) {
      const t = (proj.typeCache && proj.typeCache[m.typeId]) || S.db.find(x => x.id === m.typeId) || {}; if (t.sys !== 'Vidéoprotection' && !['vpext', 'vsint'].includes(m.typeId)) continue;
      rows.push([m.label || '', m.typeId === 'vpext' ? 'Vidéoprotection (extérieur)' : m.typeId === 'vsint' ? 'Vidéosurveillance (intérieur)' : (t.nom || 'Caméra'), `${l.name} ${pdsCell(l, m.x, m.y)}`, m.local || '', m.note || '', '']); } }
    let near = [];
    if (e.carte !== false && typeof camsNear === 'function' && PDS.terr) { near = camsNear(PDS.terr, PDS.bat, +e.rayon || 150);
      for (const { c, d: dist, dir } of near) { const t = CAM_T[c.type] || CAM_T.vp;
        rows.push([c.nom || t.code, t.label, dist !== null ? `Carte : ${Math.round(dist)} m au ${dir}` : 'Carte', `Orientée ${dirText(c.dir || 0)} (${Math.round(c.dir || 0)}°), ${c.portee || '?'} m, ${c.angle || '?'}°`, [c.exploitant, c.notes].filter(Boolean).join(' — '), '']); } }
    for (const r of (e.rows || [])) if (r.some(Boolean)) rows.push(r);
    if (e.schema !== false && near.length) { const img = pdsCamSchema(PDS.bat, near, +e.rayon || 150); if (img) { const p = P('Extérieurs', 'Caméras autour du bâtiment', { toc: 'Caméras autour du bâtiment' });
      R(p, X0 + 40, Y0 - 2, CW - 80, Y1 - Y0 + 4, { fill: 'FFFFFF' }); I(p, img, X0 + 41, Y0 - 1, CW - 82, Y1 - Y0 + 2); } }
    if (rows.length || e.note) { const cols = [{ h: 'Repère', w: 20, bold: true, align: 'center' }, { h: 'Type', w: 46, align: 'center' }, { h: 'Emplacement', w: 32, align: 'center' }, { h: 'Zone filmée', w: 60 }, { h: 'Exploitant / observations', w: 58 }, { h: 'Visuel', w: CW - 216, img: true }];
      const pg = paginate(rows, cols, { size: 8.5, imgH: 26 }, Y1 - Y0 - (e.note ? 30 : 10)); if (!pg.length) pg.push([]);
      pg.forEach((chunk, i) => { const p = P('Intérieur / Extérieurs', 'Vidéoprotection et vidéosurveillance', { toc: i === 0 ? 'Vidéoprotection et vidéosurveillance' : null });
        const nx = rows.filter(r => /extérieur/i.test(r[1])).length, ni = rows.filter(r => /intérieur/i.test(r[1])).length;
        T(p, `${rows.length} caméra(s) : ${nx} extérieure(s) de vidéoprotection, ${ni} intérieure(s) de vidéosurveillance. Emplacements reportés sur les plans des étages.`, X0, Y0 - 2, CW, 7, { size: 9.5, italic: true, align: 'center' });
        const yy = chunk.length ? table(p, X0, Y0 + 7, cols, chunk, { size: 8.5, imgH: 26 }) : Y0 + 7;
        if (e.note && i === pg.length - 1) { T(p, 'Poste de visualisation, enregistrement, accès à distance :', X0, Math.min(yy + 4, Y1 - 22), CW, 6, { size: 9.5, bold: true, color: 'FFD966' }); T(p, e.note, X0, Math.min(yy + 11, Y1 - 15), CW, 15, { size: 9.5 }); } }); } }
  // locaux techniques
  if (pdsInc('locaux')) { const rows = ((d.locaux || {}).rows || []).filter(r => r.some(Boolean)); const cols = [{ h: 'Thème', w: 34, bold: true, align: 'center' }, { h: 'Descriptif', w: 56 }, { h: 'Visuel', w: 56, img: true }, { h: 'Lieux', w: 70 }, { h: 'Clé / observations', w: CW - 216 }];
    paginate(rows, cols, { size: 8.5, imgH: 30 }).forEach((chunk, i) => { const p = P('Intérieur', 'Locaux techniques sensibles', { toc: i === 0 ? 'Locaux techniques sensibles' : null }); table(p, X0, Y0, cols, chunk, { size: 8.5, imgH: 30 }); }); }
  // portes
  if (pdsInc('portes')) { const rows = ((d.portes || {}).rows || []).filter(r => r.some(Boolean)); const cols = [{ h: 'Type', w: 38, bold: true, align: 'center' }, { h: 'Descriptif', w: 56 }, { h: 'Visuel', w: 50, img: true }, { h: 'Ouverture int./ext.', w: 60 }, { h: 'Observations', w: CW - 204 }];
    paginate(rows, cols, { size: 8.5, imgH: 30 }).forEach((chunk, i) => { const p = P('Accès', 'Les portes', { toc: i === 0 ? 'Les différents types de portes' : null }); table(p, X0, Y0, cols, chunk, { size: 8.5, imgH: 30 }); }); }
  // menaces
  if (pdsInc('menaces')) { const e = d.menaces || {}; const p = P('Les menaces', '', { toc: 'Les menaces spécifiques' });
    let yy = Y0 + 2; if (e.intro) { const h = th(e.intro, CW - 40, 11.5); T(p, e.intro, X0 + 20, yy, CW - 40, h, { size: 11.5, align: 'center' }); yy += h + 6; }
    bullets(p, e.items || [], X0 + 14, yy, CW - 28, 11, 4); }
  if (pdsInc('scen')) { const e = d.scen || {}; const p = P('Les menaces', 'Scénarios possibles', { toc: 'Les scénarios' });
    let yy = Y0 + 2; if (e.intro) { const h = th(e.intro, CW - 40, 12); T(p, e.intro, X0 + 20, yy, CW - 40, h, { size: 12, align: 'center' }); yy += h + 6; }
    for (const it of (e.items || [])) { const h = th(it, CW - 20, 10.5); T(p, it, X0 + 10, yy, CW - 20, h, { size: 10.5 }); yy += h + 5; } }
  // analyse
  if (pdsInc('analyse')) { const e = d.analyse || {}; const p = P('Analyse', nomEtab, { toc: 'Analyse' });
    let yy = Y0; T(p, 'Points forts :', X0 + 6, yy, 80, 7, { size: 11, bold: true }); yy += 8; yy = bullets(p, e.forts || [], X0 + 10, yy, CW - 20, 10, 1.5) + 4;
    R(p, X0 + 6, yy, CW - 12, 7, { fill: '6B6B23' }); T(p, 'Points faibles :', X0 + 7, yy, 80, 7, { size: 11, bold: true, valign: 'middle', color: 'FFFF66' }); yy += 9;
    bullets(p, e.faibles || [], X0 + 10, yy, CW - 20, 10, 1.5); }
  // plan d'action (schéma)
  if (pdsInc('action')) { const e = d.action || {}; const p = P('Analyse', 'Plan d\'action', { toc: 'Plan de lutte' });
    const bx = (t, x, y, w = 40, h = 9) => { R(p, x, y, w, h, { fill: 'F2F2F2', line: 'FFFFFF' }); T(p, t, x, y, w, h, { size: 9, color: '1F1F1F', align: 'center', valign: 'middle' }); };
    bx('La menace', 128, Y0, 42); const cols = [['Connaître', e.connaitre], ['Se préparer', e.preparer], ['Identifier le danger', e.identifier], ['Réagir', e.reagir]];
    const cw = (CW - 18) / 4;
    cols.forEach(([t, txt], i) => { const x = X0 + i * (cw + 6); bx(t, x + 4, Y0 + 28, cw - 8);
      L(p, 149, Y0 + 9, x + cw / 2, Y0 + 28, { color: i < 2 ? '6AA84F' : 'CC0000', lw: 0.8, arrow: true });
      bullets(p, String(txt || '').split('\n').filter(Boolean), x, Y0 + 42, cw, 8.5, 1.5); });
    T(p, 'Avant', 98, Y0 + 14, 30, 6, { size: 10, bold: true, color: '93C47D', align: 'center' }); T(p, 'Pendant', 170, Y0 + 14, 30, 6, { size: 10, bold: true, color: 'E06666', align: 'center' }); }
  // arbre de décision (schéma type)
  if (pdsInc('arbre')) { const p = P('Attaque', 'Arbre de décision', { toc: 'Arbre de décision' });
    const bx = (t, x, y, w, h, fill = 'F2F2F2', color = '1F1F1F', sub) => { R(p, x, y, w, h, { fill, line: 'FFFFFF' }); T(p, t, x, y + (sub ? 0.5 : 0), w, sub ? h - 4 : h, { size: 10, bold: true, color, align: 'center', valign: 'middle' }); if (sub) T(p, sub, x, y + h - 5, w, 4.5, { size: 7.5, italic: true, color, align: 'center' }); };
    const ov = (t, x, y, w, h, fill, color = '1F1F1F') => { E(p, x, y, w, h, { fill, line: 'FFFFFF' }); T(p, t, x, y, w, h, { size: 9.5, bold: true, color, align: 'center', valign: 'middle' }); };
    const G = '6AA84F';
    bx('Alerte', 128, Y0, 30, 10, 'CC0000', 'FFFFFF'); L(p, 143, Y0 + 10, 143, Y0 + 17, { color: G, lw: 1, arrow: true });
    bx('Position de la situation', 113, Y0 + 17, 60, 10);
    ov('Connue', 70, Y0 + 18, 26, 9, 'D9EAD3'); L(p, 113, Y0 + 22, 96, Y0 + 22, { color: G, lw: 1, arrow: true });
    ov('Non connue', 190, Y0 + 18, 30, 9, 'F4CCCC', 'CC0000'); L(p, 173, Y0 + 22, 190, Y0 + 22, { color: G, lw: 1, arrow: true });
    L(p, 83, Y0 + 27, 83, Y0 + 36, { color: G, lw: 1, arrow: true }); bx('Fuite à l\'opposé de la situation', 58, Y0 + 36, 50, 13);
    L(p, 83, Y0 + 49, 83, Y0 + 58, { color: G, lw: 1, arrow: true }); bx('Prévenir', 68, Y0 + 58, 30, 10);
    L(p, 73, Y0 + 68, 50, Y0 + 80, { color: G, lw: 1, arrow: true }); L(p, 93, Y0 + 68, 112, Y0 + 80, { color: G, lw: 1, arrow: true });
    bx('Alentours', 32, Y0 + 80, 34, 10); bx('Secours', 96, Y0 + 80, 34, 10);
    L(p, 205, Y0 + 27, 205, Y0 + 36, { color: G, lw: 1, arrow: true }); bx('Je suis dans un local', 182, Y0 + 36, 46, 12);
    ov('Oui', 152, Y0 + 37, 18, 9, 'FFE599'); L(p, 182, Y0 + 42, 170, Y0 + 42, { color: G, lw: 1, arrow: true });
    ov('Non', 240, Y0 + 37, 18, 9, 'F4CCCC', 'CC0000'); L(p, 228, Y0 + 42, 240, Y0 + 42, { color: G, lw: 1, arrow: true });
    L(p, 161, Y0 + 46, 161, Y0 + 56, { color: G, lw: 1, arrow: true }); bx('Confinement', 140, Y0 + 56, 42, 13, 'FFF2CC', '1F1F1F', 'lieu connu');
    L(p, 249, Y0 + 46, 249, Y0 + 56, { color: G, lw: 1, arrow: true }); bx('Retranchement', 226, Y0 + 56, 46, 13, 'CC0000', 'FFFFFF', 'lieu inconnu');
    L(p, 161, Y0 + 69, 190, Y0 + 82, { color: G, lw: 1, arrow: true }); L(p, 249, Y0 + 69, 222, Y0 + 82, { color: G, lw: 1, arrow: true });
    bx('Prévenir', 190, Y0 + 82, 32, 10);
    T(p, 'Confinement : s\'enfermer dans un local connu, verrouiller, éteindre, se taire, s\'éloigner des portes. Retranchement : se barricader dans le premier local disponible. Fuite : s\'éloigner à l\'opposé du danger et prévenir.', X0 + 10, Y1 - 22, CW - 20, 16, { size: 9, italic: true, align: 'center' }); }
  // diffusion (schéma)
  if (pdsInc('diffusion')) { const e = d.diffusion || {}; const p = P('Diffusion', 'Le protocole de sûreté', { toc: 'Plan de diffusion' });
    T(p, 'Avant la crise', X0, Y0, CW / 2, 8, { size: 12, bold: true, color: '93C47D', align: 'center' }); T(p, 'Situation de crise', X0 + CW / 2, Y0, CW / 2, 8, { size: 12, bold: true, color: 'E06666', align: 'center' });
    L(p, PW / 2, Y0 + 2, PW / 2, Y1, { color: 'BFBFBF', lw: 0.4 });
    const ring = (items, cx, cy, center, col) => { const n = items.length; E(p, cx - 24, cy - 8, 48, 16, { fill: col, line: 'FFFFFF' }); T(p, center, cx - 24, cy - 8, 48, 16, { size: 8.5, bold: true, color: '1F1F1F', align: 'center', valign: 'middle' });
      items.forEach((t, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; const x = cx + Math.cos(a) * 46, y = cy + Math.sin(a) * 52; L(p, cx + Math.cos(a) * 24, cy + Math.sin(a) * 8, x - Math.cos(a) * 15, y - Math.sin(a) * 6, { color: 'D9D9D9', lw: 0.5, arrow: true });
        E(p, x - 21, y - 7, 42, 14, { fill: 'F2F2F2', line: 'FFFFFF' }); T(p, t, x - 20, y - 7, 40, 14, { size: 7.5, color: '1F1F1F', align: 'center', valign: 'middle' }); }); };
    ring((e.avant || []).slice(0, 8), X0 + CW / 4, Y0 + 82, 'Direction / référent sûreté', 'D9EAD3');
    ring((e.crise || []).slice(0, 8), X0 + 3 * CW / 4, Y0 + 82, 'Alerte', 'F4CCCC'); }
  // conclusion
  if (pdsInc('conclusion')) { const p = P('', '', { plain: true }); p.conclusion = true; T(p, (d.conclusion || {}).texte, 50, 110, PW - 100, 70, { size: 12, align: 'center' }); }
  // sommaire
  const toc = pages.map((p, i) => p.toc ? [String(i + 1).padStart(2, '0'), p.toc] : null).filter(Boolean);
  const tp = pages[tocAt]; tp.toc = null; const half = Math.ceil(toc.length / 2);
  const tcol = [{ h: 'Page', w: 18, align: 'center' }, { h: 'Titres', w: 110 }];
  table(tp, X0 + 4, Y0 + 4, tcol, toc.slice(0, half), { size: 9.5, minH: 8 }); if (toc.length > half) table(tp, X0 + 4 + 134, Y0 + 4, tcol, toc.slice(half), { size: 9.5, minH: 8 });
  return pages;
}

/* ---------------------------------------------------------------- rendu PDF et PowerPoint */
async function pdsAsset(path, mime = 'image/jpeg') { const img = await loadImg(path); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return { url: c.toDataURL(mime, 0.9), w: c.width, h: c.height }; }
const pdsHex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
async function pdsFit(url, x, y, w, h) { const im = await loadImg(url); const k = Math.min(w / im.naturalWidth, h / im.naturalHeight); const iw = im.naturalWidth * k, ih = im.naturalHeight * k; return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih }; }
async function pdsExport(kind) {
  if (!need(kind === 'pdf' ? 'exportPdf' : 'exportPptx')) return;
  const nom = (PDS.d.garde && PDS.d.garde.nom) || PDS.bat.nom;
  toast(`Génération du protocole de sûreté (${kind === 'pdf' ? 'PDF' : 'PowerPoint'})…`);
  try {
    const { jsPDF } = window.jspdf; const meas = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const pages = await pdsBuild(meas);
    const bg = await pdsAsset(PDS_IMG.fond), logo = await pdsAsset(PDS_IMG.logo);
    const foot = pdsTxt(`Protocole de sûreté ${nom}  CONFIDENTIEL`);
    let data;
    if (kind === 'pdf') {
      const doc = meas;
      for (const [i, p] of pages.entries()) {
        if (i) doc.addPage('a4', 'landscape');
        doc.addImage(bg.url, 'JPEG', 0, 0, PW, PH, 'fond', 'FAST');
        if (p.cover) { doc.addImage(logo.url, 'JPEG', 58, 72, 181, 46, 'logo', 'FAST'); }
        else if (p.conclusion) { doc.addImage(logo.url, 'JPEG', 98, 62, 101, 26, 'logo', 'FAST'); }
        else {
          doc.addImage(logo.url, 'JPEG', 10, 7, 62, 15.7, 'logo', 'FAST');
          if (p.titre) { doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.text(pdsTxt(p.titre), 178, 15, { align: 'center' }); if (p.sous) { doc.setFontSize(11.5); doc.text(doc.splitTextToSize(pdsTxt(p.sous), 150).slice(0, 2), 178, 22, { align: 'center' }); } }
        }
        doc.setFillColor(217, 217, 217); doc.rect(PW - 17, 0, 11, 17, 'F'); doc.setTextColor(110, 110, 110); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(i + 1), PW - 11.5, 12, { align: 'center' });
        for (const e of p.el) {
          if (e.t === 'rect') { if (e.fill) doc.setFillColor(...pdsHex(e.fill)); if (e.line) { doc.setDrawColor(...pdsHex(e.line)); doc.setLineWidth(e.lw); } doc.rect(e.x, e.y, e.w, e.h, e.fill && e.line ? 'FD' : e.fill ? 'F' : 'S'); }
          else if (e.t === 'ell') { if (e.fill) doc.setFillColor(...pdsHex(e.fill)); doc.setDrawColor(...pdsHex(e.line || e.fill || 'FFFFFF')); doc.setLineWidth(0.3); doc.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, e.fill ? 'FD' : 'S'); }
          else if (e.t === 'line') { doc.setDrawColor(...pdsHex(e.color)); doc.setLineWidth(e.lw); doc.line(e.x1, e.y1, e.x2, e.y2);
            if (e.arrow) { const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1), s = 2.2; doc.setFillColor(...pdsHex(e.color)); doc.triangle(e.x2, e.y2, e.x2 - s * Math.cos(a - 0.45), e.y2 - s * Math.sin(a - 0.45), e.x2 - s * Math.cos(a + 0.45), e.y2 - s * Math.sin(a + 0.45), 'F'); } }
          else if (e.t === 'img') { try { const f = await pdsFit(e.url, e.x, e.y, e.w, e.h); doc.addImage(e.url, /^data:image\/png/.test(e.url) ? 'PNG' : 'JPEG', f.x, f.y, f.w, f.h, undefined, 'FAST'); } catch {} }
          else if (e.t === 'text') {
            doc.setFont('helvetica', e.bold && e.italic ? 'bolditalic' : e.bold ? 'bold' : e.italic ? 'italic' : 'normal'); doc.setFontSize(e.size); doc.setTextColor(...pdsHex(e.color));
            const lh = e.size * 0.3528 * 1.25; let ls = doc.splitTextToSize(e.s, e.w); const max = Math.max(1, Math.floor(e.h / lh + 0.15)); if (ls.length > max) { ls = ls.slice(0, max); ls[max - 1] = ls[max - 1].replace(/\s*\S*$/, '...'); }
            const tot = ls.length * lh; let y = e.y + (e.valign === 'middle' ? (e.h - tot) / 2 : 0) + e.size * 0.3528 * 0.95;
            const x = e.align === 'center' ? e.x + e.w / 2 : e.align === 'right' ? e.x + e.w : e.x;
            ls.forEach(t => { doc.text(t, x, y, { align: e.align }); y += lh; });
          }
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(150, 150, 150); doc.text(foot, PW - 22, PH - 6, { align: 'right' });
      }
      data = new Uint8Array(doc.output('arraybuffer'));
    } else {
      const P = new PptxGenJS(); P.defineLayout({ name: 'A4P', width: PW / 25.4, height: PH / 25.4 }); P.layout = 'A4P'; P.title = `Protocole de sûreté — ${nom}`;
      const i_ = (v) => v / 25.4;
      for (const [i, p] of pages.entries()) {
        const sl = P.addSlide(); sl.background = { data: bg.url.replace(/^data:/, '') };
        if (p.cover) sl.addImage({ data: logo.url, x: i_(58), y: i_(72), w: i_(181), h: i_(46) });
        else if (p.conclusion) sl.addImage({ data: logo.url, x: i_(98), y: i_(62), w: i_(101), h: i_(26) });
        else { sl.addImage({ data: logo.url, x: i_(10), y: i_(7), w: i_(62), h: i_(15.7) });
          if (p.titre) sl.addText([{ text: p.titre, options: { fontSize: 19, bold: true, breakLine: !!p.sous } }, ...(p.sous ? [{ text: p.sous, options: { fontSize: 11.5, bold: true } }] : [])], { x: i_(98), y: i_(5), w: i_(160), h: i_(22), align: 'center', valign: 'middle', color: 'FFFFFF', fontFace: 'Arial', margin: 0 }); }
        sl.addShape(P.ShapeType.rect, { x: i_(PW - 17), y: 0, w: i_(11), h: i_(17), fill: { color: 'D9D9D9' }, line: { color: 'D9D9D9' } });
        sl.addText(String(i + 1), { x: i_(PW - 17), y: i_(7), w: i_(11), h: i_(8), align: 'center', fontSize: 10, bold: true, color: '6E6E6E', margin: 0 });
        for (const e of p.el) {
          if (e.t === 'rect') sl.addShape(P.ShapeType.rect, { x: i_(e.x), y: i_(e.y), w: i_(e.w), h: i_(e.h), fill: e.fill ? { color: e.fill } : { type: 'none' }, line: e.line ? { color: e.line, width: Math.max(0.5, e.lw * 2.8) } : { type: 'none' } });
          else if (e.t === 'ell') sl.addShape(P.ShapeType.ellipse, { x: i_(e.x), y: i_(e.y), w: i_(e.w), h: i_(e.h), fill: e.fill ? { color: e.fill } : { type: 'none' }, line: { color: e.line || e.fill || 'FFFFFF', width: 0.75 } });
          else if (e.t === 'line') { const x = Math.min(e.x1, e.x2), y = Math.min(e.y1, e.y2); sl.addShape(P.ShapeType.line, { x: i_(x), y: i_(y), w: i_(Math.max(0.01, Math.abs(e.x2 - e.x1))), h: i_(Math.max(0.01, Math.abs(e.y2 - e.y1))), flipH: e.x2 < e.x1, flipV: e.y2 < e.y1, line: { color: e.color, width: e.lw * 2.8, endArrowType: e.arrow ? 'triangle' : undefined } }); }
          else if (e.t === 'img') { try { const f = await pdsFit(e.url, e.x, e.y, e.w, e.h); sl.addImage({ data: e.url, x: i_(f.x), y: i_(f.y), w: i_(f.w), h: i_(f.h) }); } catch {} }
          else if (e.t === 'text' && e.s) sl.addText(e.s, { x: i_(e.x), y: i_(e.y), w: i_(e.w), h: i_(Math.max(e.h, 3)), fontSize: e.size, bold: e.bold, italic: e.italic, color: e.color, align: e.align, valign: e.valign, fontFace: 'Arial', margin: 0, fit: 'shrink', paraSpaceAfter: 0 });
        }
        sl.addText(foot, { x: i_(120), y: i_(PH - 9), w: i_(PW - 142), h: i_(5), align: 'right', fontSize: 6.5, color: '969696', margin: 0 });
      }
      data = await P.write({ outputType: 'uint8array' });
    }
    const base = `Protocole de sûreté ${safeName(nom)}`;
    const p = await window.native.saveFile({ purpose: kind, title: 'Exporter le protocole de sûreté', defaultPath: `${base}.${kind}`, filters: [kind === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PowerPoint', extensions: ['pptx'] }], data });
    if (p) toast(`Protocole de sûreté exporté (${pages.length} pages)`);
  } catch (e) { console.error(e); toast('Export impossible : ' + e.message, true); }
}

/* schéma de situation : bâtiment au centre, caméras de la carte à l'échelle, nord en haut */
function pdsCamSchema(b, near, rayon) {
  const p = posOf(b); if (!p) return null;
  const W = 1600, H = 1100, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#f7f9fb'; g.fillRect(0, 0, W, H);
  const maxD = Math.max(rayon, ...near.map(x => (x.d || 0) + (+x.c.portee || 20))); const k = (Math.min(W, H) / 2 - 90) / maxD; const cx = W / 2, cy = H / 2 + 20;
  const xy = (q) => { const d = geoDist(p, q), br = geoBearing(p, q) * Math.PI / 180; return [cx + Math.sin(br) * d * k, cy - Math.cos(br) * d * k]; };
  // cercles de distance
  g.strokeStyle = '#c9d3df'; g.lineWidth = 2; g.setLineDash([10, 8]); g.font = '22px Arial'; g.fillStyle = '#7b8798';
  const step = maxD > 300 ? 100 : maxD > 120 ? 50 : 25;
  for (let r = step; r <= maxD; r += step) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); g.fillText(`${r} m`, cx + 6, cy - r * k - 6); }
  g.setLineDash([]);
  // cônes et caméras
  for (const { c: cam } of near) {
    const t = CAM_T[cam.type] || CAM_T.vp; const [x, y] = xy(cam); const a = (+cam.dir || 0) * Math.PI / 180, half = (Math.min(359, +cam.angle || 90) / 2) * Math.PI / 180, R = (+cam.portee || 20) * k;
    g.fillStyle = t.color + '33'; g.strokeStyle = t.color; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a - half - Math.PI / 2, a + half - Math.PI / 2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = t.color; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#12304a'; g.font = 'bold 26px Arial'; g.fillText(cam.nom || t.code, x + 20, y - 14);
  }
  // bâtiment
  g.fillStyle = '#c8102e'; g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#12304a'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText(b.nom, cx, cy + 56); g.textAlign = 'left';
  // nord et légende
  g.fillStyle = '#12304a'; g.beginPath(); g.moveTo(W - 80, 40); g.lineTo(W - 100, 100); g.lineTo(W - 80, 88); g.lineTo(W - 60, 100); g.closePath(); g.fill(); g.font = 'bold 30px Arial'; g.fillText('N', W - 91, 132);
  let ly = H - 80; for (const [k2, t] of Object.entries(CAM_T)) { g.fillStyle = t.color; g.beginPath(); g.arc(50, ly, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = '#12304a'; g.font = '24px Arial'; g.fillText(t.label, 72, ly + 8); ly += 36; }
  g.fillStyle = '#7b8798'; g.font = 'italic 20px Arial'; g.fillText('Positions et champs de vision indicatifs, d\'après la carte du logiciel.', 40, 40);
  return c.toDataURL('image/jpeg', 0.9);
}
