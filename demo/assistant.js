/* Blackeyes 2 — assistant d'implantation
   1. Détection : le plan (image) est lu sur une grille ; les traits sombres épais sont les murs. Les ouvertures
      plus étroites qu'une porte sont refermées le temps de trouver le cœur de chaque pièce, puis chaque pièce
      reprend toute sa surface. Les frontières entre deux pièces (ou entre une pièce et l'extérieur) sont les accès.
   2. Qualification : l'utilisateur indique le type de chaque pièce et de chaque accès (proposé d'office).
   3. Propositions : les règles (modifiables dans Admin) donnent, pour chaque accès, pièce, niveau ou projet,
      le matériel à poser et la manière de le placer. Les détecteurs volumétriques sont placés là où ils couvrent
      le plus de surface de la pièce, en tenant compte des murs (visibilité), de leur portée et de leur angle.
      Chaque proposition est affichée en pointillés avec sa justification, puis acceptée ou refusée.
   Données : l.analyse = { v, G, H, k, cellM, rle, rooms[], acces[], opts } (enregistré avec le projet). */
'use strict';

/* ------------------------------------------------------------------------------------------------ référentiels */
const AS_PIECES = [
  ['hall', 'Hall / accueil', '#f59e0b'], ['circ', 'Couloir / circulation', '#0ea5e9'], ['bureau', 'Bureau', '#8b5cf6'],
  ['salle', 'Salle (classe, réunion…)', '#22c55e'], ['restau', 'Cuisine / réfectoire', '#14b8a6'], ['stock', 'Réserve / stockage', '#a8a29e'],
  ['sensible', 'Local sensible (serveur, archives, caisse…)', '#dc2626'], ['tech', 'Local technique', '#64748b'],
  ['sanit', 'Sanitaires', '#93c5fd'], ['escalier', 'Escalier', '#d946ef'], ['confinement', 'Pièce de confinement', '#334155'],
  ['ext', 'Extérieur / cour', '#86efac'], ['ignore', 'Non concernée', '#d1d5db']
];
const AS_ACCES = [
  ['principal', 'Entrée principale', '#c8102e'], ['secondaire', 'Porte extérieure secondaire', '#ea580c'], ['secours', 'Issue de secours', '#16a34a'],
  ['fenetre', 'Fenêtre accessible', '#0284c7'], ['interieur', 'Porte intérieure', '#64748b'], ['ignore', 'Non concerné', '#cbd5e1']
];
const AS_CIBLES = { acces: 'Chaque accès', piece: 'Chaque pièce', niveau: 'Une fois par niveau', site: 'Une fois par projet', portee: 'Selon la portée radio' };
const AS_PLACEMENTS = {
  ouverture: 'Sur l\'ouverture (contact)', 'vers-acces': 'Dans la pièce, orienté vers l\'accès', exterieur: 'En façade, à côté de l\'accès',
  couverture: 'Couverture de la pièce (angle, bout de couloir)', centre: 'Au centre de la pièce', 'oppose-acces': 'Côté opposé à l\'entrée (poste de travail)',
  central: 'Dans la pièce la plus centrale', relais: 'Entre la centrale et les matériels éloignés'
};
const AS_PLACE_BY_CIBLE = { acces: ['ouverture', 'vers-acces', 'exterieur'], piece: ['couverture', 'centre', 'oppose-acces'], niveau: ['central'], site: ['central', 'exterieur'], portee: ['relais'] };
const asPieceInfo = (id) => AS_PIECES.find(p => p[0] === id) || AS_PIECES[AS_PIECES.length - 1];
const asAccInfo = (id) => AS_ACCES.find(p => p[0] === id) || AS_ACCES[AS_ACCES.length - 1];
/* liste de types attendue par une règle : types d'accès ou types de pièces */
const asTypesKind = (r) => (r.cible === 'acces' || (r.cible === 'site' && r.placement === 'exterieur')) ? 'acces' : r.cible === 'portee' ? '' : 'piece';

const AS_DEFAULT_PARAMS = { porteeUtile: 35 };
const AS_DEFAULT_RULES = [
  { id: 'r01', cible: 'acces', types: ['principal'], materiel: 'door', placement: 'ouverture', protection: 'standard', raison: 'Contact d\'ouverture sur l\'entrée principale : premier niveau de détection.' },
  { id: 'r02', cible: 'acces', types: ['principal'], materiel: 'mcam', placement: 'vers-acces', protection: 'standard', raison: 'Levée de doute photo : l\'entrée principale est dans le champ du détecteur.' },
  { id: 'r03', cible: 'acces', types: ['secondaire'], materiel: 'door', placement: 'ouverture', protection: 'standard', raison: 'Contact d\'ouverture sur l\'accès extérieur secondaire.' },
  { id: 'r04', cible: 'acces', types: ['secours'], materiel: 'doorplus', placement: 'ouverture', protection: 'standard', raison: 'Issue de secours : ouverture, inclinaison et choc (tentative de forçage).' },
  { id: 'r05', cible: 'acces', types: ['fenetre'], materiel: 'doorplus', placement: 'ouverture', protection: 'renforce', rdc: true, raison: 'Fenêtre accessible de plain-pied : ouverture et choc.' },
  { id: 'r06', cible: 'piece', types: ['hall'], materiel: 'mcam', placement: 'couverture', max: 1, couverture: 70, protection: 'standard', raison: 'Hall d\'accueil : détection avec photo pour la levée de doute.' },
  { id: 'r07', cible: 'piece', types: ['circ'], materiel: 'mprot', placement: 'couverture', max: 3, couverture: 60, protection: 'standard', raison: 'Circulation : détecteur dans l\'axe du passage obligé.' },
  { id: 'r08', cible: 'piece', types: ['bureau', 'salle', 'restau', 'stock'], facade: true, rdc: true, materiel: 'combi', placement: 'couverture', max: 2, couverture: 60, protection: 'standard', raison: 'Pièce en façade de plain-pied : mouvement et bris de vitre.' },
  { id: 'r09', cible: 'piece', types: ['sensible'], materiel: 'mcam', placement: 'couverture', max: 2, couverture: 80, protection: 'standard', raison: 'Local sensible : détection avec photo.' },
  { id: 'r10', cible: 'acces', types: ['interieur'], dansPieces: ['sensible'], materiel: 'doorplus', placement: 'ouverture', protection: 'standard', raison: 'Porte du local sensible : ouverture et forçage.' },
  { id: 'r11', cible: 'piece', types: ['sensible'], materiel: 'fog', placement: 'couverture', max: 1, couverture: 0, protection: 'renforce', raison: 'Générateur de brouillard : l\'intrus ne voit plus rien dans le local.' },
  { id: 'r12', cible: 'piece', types: ['hall'], materiel: 'push', placement: 'oppose-acces', protection: 'standard', raison: 'Bouton d\'alerte au poste d\'accueil, hors de vue du public.' },
  { id: 'r13', cible: 'piece', types: ['bureau'], materiel: 'push', placement: 'oppose-acces', protection: 'renforce', raison: 'Bouton d\'alerte au poste de travail exposé.' },
  { id: 'r14', cible: 'piece', types: ['confinement'], materiel: 'pdc', placement: 'centre', protection: 'standard', raison: 'Pièce de confinement repérée sur le plan.' },
  { id: 'r15', cible: 'acces', types: ['interieur'], dansPieces: ['confinement'], materiel: 'lock', placement: 'ouverture', protection: 'standard', raison: 'Blocage de la porte de la pièce de confinement depuis l\'intérieur.' },
  { id: 'r16', cible: 'niveau', types: ['circ', 'hall'], materiel: 'siren', placement: 'central', protection: 'standard', raison: 'Sirène intérieure audible depuis les circulations du niveau.' },
  { id: 'r17', cible: 'site', types: ['tech', 'bureau', 'sensible', 'stock'], materiel: 'hub', placement: 'central', protection: 'standard', raison: 'Centrale au cœur du bâtiment, à l\'abri des accès.' },
  { id: 'r18', cible: 'site', types: ['principal'], materiel: 'ssiren', placement: 'exterieur', protection: 'renforce', raison: 'Sirène extérieure en façade, visible depuis l\'entrée.' },
  { id: 'r19', cible: 'portee', types: [], materiel: 'rep', placement: 'relais', protection: 'standard', raison: 'Répéteur : des matériels sont loin de la centrale.' }
].map(r => ({ actif: true, ...r }));

async function asLoadRules() {
  if (S.regles) return S.regles;
  let r = null; try { r = await window.native.regles.load(); } catch {}
  S.regles = r && Array.isArray(r.regles) ? { regles: r.regles, params: { ...AS_DEFAULT_PARAMS, ...(r.params || {}) }, perso: true }
    : { regles: JSON.parse(JSON.stringify(AS_DEFAULT_RULES)), params: { ...AS_DEFAULT_PARAMS }, perso: false };
  return S.regles;
}

/* ------------------------------------------------------------------------------------------------ détection */
const AS_DEFAULT_OPTS = { porte: 2.2, seuil: 165, traits: 'auto', minArea: 1.2 };
const asRLE = {
  enc(lab) { const out = []; let v = lab[0], n = 0; for (let i = 0; i < lab.length; i++) { if (lab[i] === v && n < 65535) n++; else { out.push(v, n); v = lab[i]; n = 1; } } out.push(v, n);
    const u = new Uint16Array(out); let s = ''; const b = new Uint8Array(u.buffer); for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); },
  dec(str, len) { const bin = atob(str); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); const u = new Uint16Array(b.buffer);
    const lab = new Int32Array(len); let p = 0; for (let i = 0; i < u.length; i += 2) { lab.fill(u[i], p, p + u[i + 1]); p += u[i + 1]; } return lab; }
};

/* lit l'image du plan : murs (cases sombres, traits fins retirés) et distance aux murs */
async function asReadPlan(l, opts) {
  const img = await loadImg(l.plan.dataUrl);
  const G = Math.max(300, Math.min(3000, l.plan.w, Math.round(l.plan.w / (0.025 * l.scale))));
  const k = l.plan.w / G, H = Math.max(1, Math.round(l.plan.h / k));
  const cv = document.createElement('canvas'); cv.width = G; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, G, H);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, G, H);
  const px = g.getImageData(0, 0, G, H).data; const N = G * H;
  const dark = new Uint8Array(N); let nd = 0;
  // murs : traits sombres ; aplats gris épais (murs « pochés » en gris sur de nombreux plans d'architecte)
  const grey = new Uint8Array(N); const lumGris = Math.min(210, opts.seuil + 40);
  for (let i = 0, j = 0; i < N; i++, j += 4) { const r = px[j], gg = px[j + 1], b = px[j + 2]; const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    if (lum < opts.seuil) { dark[i] = 1; nd++; } else if (opts.gris !== false && lum < lumGris && Math.max(r, gg, b) - Math.min(r, gg, b) < 28) grey[i] = 1; }
  // murs épais : traits sombres + aplats gris d'au moins ~8 cm d'épaisseur (les textes et les cotes, fins, sont écartés)
  let thickGrey = null;
  if (opts.gris !== false) { const u = new Uint8Array(N); let ng = 0; for (let i = 0; i < N; i++) if (grey[i]) { u[i] = 1; ng++; } else if (dark[i]) u[i] = 1;
    if (ng) thickGrey = asOpenBox(u, G, H, Math.max(1, Math.round(0.04 / (k / l.scale)))); }
  let wall = dark;
  if (opts.traits !== 'fins') {           // ouverture morphologique : enlève textes, cotes, arcs de portes, mobilier au trait
    const er = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < G - 1; x++) { const i = y * G + x; if (dark[i] && dark[i - 1] && dark[i + 1] && dark[i - G] && dark[i + G] && dark[i - G - 1] && dark[i - G + 1] && dark[i + G - 1] && dark[i + G + 1]) er[i] = 1; }
    const op = new Uint8Array(N); let no = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < G - 1; x++) { const i = y * G + x; if (er[i] || er[i - 1] || er[i + 1] || er[i - G] || er[i + G] || er[i - G - 1] || er[i - G + 1] || er[i + G - 1] || er[i + G + 1]) { op[i] = 1; no++; } }
    if (opts.traits === 'epais' || no >= nd * 0.35) wall = op;
  }
  if (thickGrey) { const w2 = new Uint8Array(N); for (let i = 0; i < N; i++) w2[i] = wall[i] | thickGrey[i]; wall = w2; }
  wall = asBuilding(wall, G, H, k / l.scale);
  return { G, H, k, cellM: k / l.scale, wall, dark, dist: asDistance(wall, G, H) };
}
/* zones hors du bâtiment : on referme les ouvertures (portes, baies jusqu'à ~2,4 m) en épaississant les murs, puis on
   remplit l'extérieur depuis les bords de la feuille. Une zone dont la majorité est hors de l'enveloppe ainsi obtenue
   (cour, parvis, espace entre le bâtiment et la légende) est rendue à l'extérieur. */
function asOutside(gr) {
  const { G, H, wall, lab, cellM } = gr; const N = G * H;
  const r = Math.max(2, Math.round(1.2 / cellM));
  const I = new Int32Array((G + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < G; x++) { row += wall[y * G + x]; I[(y + 1) * (G + 1) + x + 1] = I[y * (G + 1) + x + 1] + row; } }
  const any = (x0, y0, x1, y1) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(G - 1, x1); y1 = Math.min(H - 1, y1); return I[(y1 + 1) * (G + 1) + x1 + 1] - I[y0 * (G + 1) + x1 + 1] - I[(y1 + 1) * (G + 1) + x0] + I[y0 * (G + 1) + x0] > 0; };
  const thick = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < G; x++) if (any(x - r, y - r, x + r, y + r)) thick[y * G + x] = 1;
  const out = new Uint8Array(N); const q = new Int32Array(N); let qh = 0, qt = 0;
  const push = (i) => { if (!thick[i] && !out[i]) { out[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < G; x++) { push(x); push((H - 1) * G + x); } for (let y = 0; y < H; y++) { push(y * G); push(y * G + G - 1); }
  while (qh < qt) { const i = q[qh++]; const x = i % G; if (x > 0) push(i - 1); if (x < G - 1) push(i + 1); if (i >= G) push(i - G); if (i < N - G) push(i + G); }
  // les cases extérieures « mangées » par l'épaississement : rendues à l'extérieur si toutes leurs voisines le sont
  const tot = new Map(), ext = new Map();
  for (let i = 0; i < N; i++) { const v = lab[i]; if (v < 2) continue; tot.set(v, (tot.get(v) || 0) + 1);
    // case dehors : directement atteinte, ou dans la bande d'épaississement à côté d'une case atteinte
    if (out[i] || (thick[i] && !wall[i] && ((i % G > 0 && out[i - 1]) || (i % G < G - 1 && out[i + 1]) || (i >= G && out[i - G]) || (i < N - G && out[i + G])))) ext.set(v, (ext.get(v) || 0) + 1); }
  const gone = new Set(); for (const [v, n] of tot) if ((ext.get(v) || 0) > 0.5 * n) gone.add(v);
  if (gone.size) for (let i = 0; i < N; i++) if (gone.has(lab[i])) lab[i] = 1;
  return gone.size;
}
/* ouverture morphologique par un carré de côté 2r+1 (images intégrales) : ne garde que les aplats assez épais */
function asOpenBox(m, G, H, r) {
  let any = 0; for (let i = 0; i < m.length; i++) if (m[i]) { any = 1; break; } if (!any) return null;
  const sat = (a) => { const I = new Int32Array((G + 1) * (H + 1)); for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < G; x++) { row += a[y * G + x]; I[(y + 1) * (G + 1) + x + 1] = I[y * (G + 1) + x + 1] + row; } } return I; };
  const box = (I, x0, y0, x1, y1) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(G - 1, x1); y1 = Math.min(H - 1, y1); return I[(y1 + 1) * (G + 1) + x1 + 1] - I[y0 * (G + 1) + x1 + 1] - I[(y1 + 1) * (G + 1) + x0] + I[y0 * (G + 1) + x0]; };
  const I1 = sat(m), er = new Uint8Array(G * H), full = (2 * r + 1) * (2 * r + 1);
  for (let y = r; y < H - r; y++) for (let x = r; x < G - r; x++) if (box(I1, x - r, y - r, x + r, y + r) === full) er[y * G + x] = 1;
  const I2 = sat(er), out = new Uint8Array(G * H); let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < G; x++) if (m[y * G + x] && box(I2, x - r, y - r, x + r, y + r) > 0) { out[y * G + x] = 1; n++; }
  return n ? out : null;
}
/* ne garder que les murs du bâtiment : le cadre de la page, le cartouche, les légendes, les titres et tout ce qui est
   éloigné du bâtiment sont retirés, pour que l'espace autour du bâtiment soit bien reconnu comme l'extérieur. */
function asBuilding(wall, G, H, cellM) {
  const N = G * H, lab = new Int32Array(N), comps = [], st = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!wall[i] || lab[i]) continue;
    const c = { id: comps.length + 1, n: 0, x0: G, y0: H, x1: 0, y1: 0 }; comps.push(c);
    let sp = 0; st[sp++] = i; lab[i] = c.id;
    while (sp) { const j = st[--sp]; const x = j % G, y = (j - x) / G; c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= G || yy >= H) continue; const q = yy * G + xx; if (wall[q] && !lab[q]) { lab[q] = c.id; st[sp++] = q; } } }
  }
  if (!comps.length) return wall;
  // cadre de page : composante qui fait presque tout le tour de la feuille, peu remplie
  // (entier, ou morceaux de cadre coupés par le cartouche : traits le long d'un bord de la feuille)
  const bx = 0.07 * G, by = 0.07 * H;
  const frame = (c) => ((c.x1 - c.x0) >= 0.85 * G && (c.y1 - c.y0) >= 0.85 * H && c.n < 0.2 * (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1))
    || ((c.y1 < by || c.y0 > H - by) && (c.x1 - c.x0) >= 0.3 * G) || ((c.x1 < bx || c.x0 > G - bx) && (c.y1 - c.y0) >= 0.3 * H);
  const cand = comps.filter(c => !frame(c)); if (!cand.length) return wall;
  // bâtiment(s) : les murs sont regroupés de proche en proche (moins de 1 m) ; le groupe le plus fourni est le bâtiment
  // (un logo, un titre, une légende ou un cartouche forment des groupes bien plus petits). Les groupes d'au moins 30 %
  // de sa taille sont aussi gardés (autre bâtiment), puis tout ce qui se trouve dans leur emprise (à 1 m près).
  const m = Math.round(1.0 / cellM), L = Math.round(2.5 / cellM);      // 2,5 m : un couloir ne sépare pas le bâtiment en deux
  const near = (a, b) => a.x1 >= b.x0 - L && a.x0 <= b.x1 + L && a.y1 >= b.y0 - L && a.y0 <= b.y1 + L;
  const par = cand.map((_, i) => i); const fd = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  // seuls les éléments longs (≥ 2 m : pans de murs) font le lien ; les lettres d'un titre ou d'une légende, courtes,
  // ne rattachent pas ces textes au bâtiment
  const longC = (c) => ((c.x1 - c.x0) + (c.y1 - c.y0)) * cellM >= 2.0;
  const ord = cand.map((c, i) => i).filter(i => longC(cand[i])).sort((i, j) => cand[i].x0 - cand[j].x0);
  for (let a = 0; a < ord.length; a++) { const A = cand[ord[a]];
    for (let b = a + 1; b < ord.length; b++) { const Bc = cand[ord[b]]; if (Bc.x0 > A.x1 + L) break; if (near(A, Bc)) { const ra = fd(ord[a]), rb = fd(ord[b]); if (ra !== rb) par[ra] = rb; } } }
  const groups = new Map();
  cand.forEach((c, i) => { const r = fd(i); let g = groups.get(r); if (!g) { g = { n: 0, x0: G, y0: H, x1: 0, y1: 0 }; groups.set(r, g); } g.n += c.n; g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); });
  // murs = traits fins et étendus (taux de remplissage faible) ; logos, titres et légendes sont plus « pleins »
  const fill = (g) => g.n / ((g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1));
  const gl = [...groups.values()]; const pool = gl.filter(g => fill(g) < 0.16); const src = pool.length ? pool : gl;
  const gmain = src.reduce((a, b) => b.n > a.n ? b : a);
  const kept = src.filter(g => g === gmain || g.n >= 0.3 * gmain.n);
  const inside = (c) => kept.some(g => c.x0 >= g.x0 - m && c.y0 >= g.y0 - m && c.x1 <= g.x1 + m && c.y1 <= g.y1 + m);
  const keep = new Set(cand.filter(inside).map(c => c.id));
  if (keep.size === comps.length) return wall;
  const out = new Uint8Array(N); for (let i = 0; i < N; i++) if (lab[i] && keep.has(lab[i])) out[i] = 1;
  return out;
}
/* distance (en cases) au mur le plus proche — chanfrein 3-4 */
function asDistance(wall, G, H) {
  const N = G * H, d = new Float32Array(N), INF = 1e9;
  for (let i = 0; i < N; i++) d[i] = wall[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < G; x++) { const i = y * G + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 3); if (y > 0) { v = Math.min(v, d[i - G] + 3); if (x > 0) v = Math.min(v, d[i - G - 1] + 4); if (x < G - 1) v = Math.min(v, d[i - G + 1] + 4); } d[i] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) { const i = y * G + x; let v = d[i]; if (!v) continue;
    if (x < G - 1) v = Math.min(v, d[i + 1] + 3); if (y < H - 1) { v = Math.min(v, d[i + G] + 3); if (x < G - 1) v = Math.min(v, d[i + G + 1] + 4); if (x > 0) v = Math.min(v, d[i + G - 1] + 4); } d[i] = v; }
  for (let i = 0; i < N; i++) d[i] = d[i] >= INF ? 1e6 : d[i] / 3;
  return d;
}
/* pièces : « bassins » de la distance aux murs (ligne de partage des eaux avec persistance).
   Les cases sont traitées de la plus éloignée des murs à la plus proche. Deux bassins qui se rejoignent restent
   deux pièces si le passage qui les relie (porte) est nettement plus étroit que chacune d'elles ; ils sont réunis
   si la différence est faible (recoins d'une même pièce) ou si le passage est plus large qu'une porte. */
function asSegment(gr, opts) {
  const { G, H, wall, dist, cellM } = gr; const N = G * H;
  const Q = 2; let maxB = 0;                      // seaux de 0,5 case
  for (let i = 0; i < N; i++) if (!wall[i]) { const b = Math.min(65000, Math.floor(dist[i] * Q)); if (b > maxB) maxB = b; }
  const cnt = new Int32Array(maxB + 2);
  for (let i = 0; i < N; i++) if (!wall[i]) cnt[Math.min(65000, Math.floor(dist[i] * Q))]++;
  const start = new Int32Array(maxB + 2); let acc = 0; for (let b = maxB; b >= 0; b--) { start[b] = acc; acc += cnt[b]; }
  const order = new Int32Array(acc);
  for (let i = 0; i < N; i++) if (!wall[i]) order[start[Math.min(65000, Math.floor(dist[i] * Q))]++] = i;
  const parent = new Int32Array(N).fill(-1); const peak = new Float32Array(N); const border = new Uint8Array(N);
  const find = (x) => { let r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { const n = parent[x]; parent[x] = r; x = n; } return r; };
  const P = 0.22 / cellM, wide = (opts.porte / 2) / cellM;
  const roots = [0, 0, 0, 0];
  for (let o = 0; o < order.length; o++) {
    const i = order[o]; const d = dist[i]; const x = i % G, y = (i - x) / G;
    const isB = x === 0 || y === 0 || x === G - 1 || y === H - 1;
    let nr = 0;
    const nb0 = x > 0 ? i - 1 : -1, nb1 = x < G - 1 ? i + 1 : -1, nb2 = y > 0 ? i - G : -1, nb3 = y < H - 1 ? i + G : -1;
    let up = -1, upD = -1;              // voisin le plus éloigné des murs : la case rejoint son bassin (pente)
    for (const j of [nb0, nb1, nb2, nb3]) { if (j < 0 || parent[j] < 0) continue; if (dist[j] > upD) { upD = dist[j]; up = j; } const r = find(j); let dup = false; for (let k = 0; k < nr; k++) if (roots[k] === r) dup = true; if (!dup) roots[nr++] = r; }
    if (!nr) { parent[i] = i; peak[i] = d; border[i] = isB ? 1 : 0; continue; }
    // racine principale : la plus profonde
    let main = roots[0]; for (let k = 1; k < nr; k++) if (peak[roots[k]] > peak[main]) main = roots[k];
    for (let k = 0; k < nr; k++) { const r = roots[k]; if (r === main) continue;
      const pers = Math.min(peak[r], peak[main]) - d;
      // l'extérieur ne se fond jamais dans une pièce par une ouverture large (fenêtres, baies)
      const same = (border[r] && border[main]) || pers < P || (d >= wide && !border[r] && !border[main]);
      if (same) { parent[r] = main; border[main] = border[main] | border[r]; } }
    const own = find(up); parent[i] = own; if (isB) border[own] = 1;
  }
  const lab = new Int32Array(N); const id = new Map(); let next = 2;
  for (let i = 0; i < N; i++) { if (parent[i] < 0) continue; const r = find(i); if (border[r]) { lab[i] = 1; continue; } let v = id.get(r); if (v === undefined) { v = next++; id.set(r, v); } lab[i] = v; }
  return lab;
}
/* surface, point intérieur, axes, façade de chaque pièce */
function asStats(gr, prev = []) {
  const { G, H, lab, dist, cellM } = gr; const N = G * H;
  const m = new Map();
  for (let i = 0; i < N; i++) { const v = lab[i]; if (v < 2) continue; let r = m.get(v);
    if (!r) { r = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, best: -1, bi: i }; m.set(v, r); }
    const x = i % G, y = (i - x) / G; r.n++; r.sx += x; r.sy += y; r.sxx += x * x; r.syy += y * y; r.sxy += x * y;
    if (dist[i] > r.best) { r.best = dist[i]; r.bi = i; } }
  // façade : à moins de 1 m (murs compris) d'une case extérieure
  const extSet = new Set([1, ...prev.filter(p => p.type === 'ext').map(p => p.id)]);
  const R = Math.ceil(1.0 / cellM); const dd = new Uint16Array(N).fill(65535); const q = new Int32Array(N); let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (extSet.has(lab[i])) { dd[i] = 0; q[qt++] = i; }
  const facade = new Set();
  while (qh < qt) { const i = q[qh++]; const d = dd[i]; if (d >= R) continue; const x = i % G;
    const nb = [x > 0 ? i - 1 : -1, x < G - 1 ? i + 1 : -1, i - G, i + G];
    for (const j of nb) if (j >= 0 && j < N && dd[j] === 65535) { dd[j] = d + 1; if (lab[j] >= 2 && !extSet.has(lab[j])) facade.add(lab[j]); q[qt++] = j; } }
  const k = gr.k; const rooms = [];
  let num = Math.max(0, ...prev.map(p => +(String(p.nom).match(/^Pièce (\d+)$/) || [0, 0])[1]));
  for (const [id, r] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
    const area = r.n * cellM * cellM; if (area < 0.4) continue;
    const mx = r.sx / r.n, my = r.sy / r.n; const cxx = r.sxx / r.n - mx * mx, cyy = r.syy / r.n - my * my, cxy = r.sxy / r.n - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const L1 = Math.sqrt(12 * (tr / 2 + disc)) * cellM, L2 = Math.sqrt(12 * Math.max(0, tr / 2 - disc)) * cellM;
    const bx = r.bi % G, by = (r.bi - bx) / G; const old = prev.find(p => p.id === id);
    const ang = (Math.round(0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI) + 360) % 360;
    rooms.push({ id, ang, nom: old ? old.nom : `Pièce ${++num}`, type: old ? old.type : null, area: Math.round(area * 10) / 10,
      long: Math.round(L1 * 10) / 10, larg: Math.round(L2 * 10) / 10, ix: (bx + 0.5) * k, iy: (by + 0.5) * k, cx: (mx + 0.5) * k, cy: (my + 0.5) * k, facade: facade.has(id) });
  }
  return rooms;
}
/* accès : frontières entre deux zones différentes, regroupées en segments */
function asOpenings(gr) {
  const { G, H, lab, cellM, k } = gr; const N = G * H;
  const pairs = new Map();
  const add = (a, b, i) => { if (a === b || a < 1 || b < 1) return; const key = a < b ? a * 65536 + b : b * 65536 + a; let s = pairs.get(key); if (!s) pairs.set(key, s = []); s.push(i); };
  for (let y = 0; y < H; y++) for (let x = 0; x < G; x++) { const i = y * G + x; if (x < G - 1) add(lab[i], lab[i + 1], i); if (y < H - 1) add(lab[i], lab[i + G], i); }
  const out = [];
  for (const [key, cells] of pairs) {
    const a = Math.floor(key / 65536), b = key % 65536;
    const set = new Set(cells), seen = new Set();
    for (const s of cells) { if (seen.has(s)) continue;
      const cl = []; const st = [s]; seen.add(s);
      while (st.length) { const i = st.pop(); cl.push(i); const x = i % G, y = (i - x) / G;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * G + (x + dx); if (set.has(j) && !seen.has(j)) { seen.add(j); st.push(j); } } }
      let mx = 0, my = 0; for (const i of cl) { mx += i % G; my += Math.floor(i / G); } mx /= cl.length; my /= cl.length;
      let cxx = 0, cyy = 0, cxy = 0; for (const i of cl) { const dx = i % G - mx, dy = Math.floor(i / G) - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); const ux = Math.cos(th), uy = Math.sin(th);
      let lo = 1e9, hi = -1e9; for (const i of cl) { const p = (i % G - mx) * ux + (Math.floor(i / G) - my) * uy; lo = Math.min(lo, p); hi = Math.max(hi, p); }
      const w = (hi - lo + 1) * cellM; if (w < 0.45) continue;
      // vitrage : traits fins (retirés des murs) qui traversent l'ouverture dans le sens du mur
      let vit = 0; const R = Math.ceil(0.35 / cellM), nx = -uy, ny = ux;
      for (const i of cl) { const x0 = i % G, y0 = Math.floor(i / G); let hit = false;
        for (let t = -R; t <= R && !hit; t++) { const xx = Math.round(x0 + nx * t), yy = Math.round(y0 + ny * t); if (xx >= 0 && yy >= 0 && xx < G && yy < H) { const j = yy * G + xx; if (gr.dark[j] && !gr.wall[j]) hit = true; } }
        if (hit) vit++; }
      out.push({ bb: [Math.min(...cl.map(i => i % G)), Math.min(...cl.map(i => Math.floor(i / G))), Math.max(...cl.map(i => i % G)), Math.max(...cl.map(i => Math.floor(i / G)))], n: cl.length, a, b, x: (mx + 0.5) * k, y: (my + 0.5) * k, w: Math.round(w * 100) / 100, ang: Math.round(th * 1800 / Math.PI) / 10, vitre: vit / cl.length > 0.6 });
    }
  }
  return out;
}
function asGuessTypes(rooms, acces) {
  for (const r of rooms) {
    if (r.type) continue;
    const ratio = r.long / Math.max(r.larg, 0.1);
    if ((r.larg < 2.8 && ratio > 2.8) || ratio > 4.5 || (r.long > 15 && ratio > 3)) r.type = 'circ';
    else if (r.area < 4) r.type = 'stock';
    else if (r.area >= 40) r.type = 'salle';
    else r.type = 'bureau';
  }
  const ext = acces.filter(a => (a.b === 1 || a.a === 1) && !a.vitre).sort((p, q) => q.w - p.w || p.x - q.x);
  ext.forEach((a, i) => { a.type = i === 0 ? 'principal' : 'secondaire'; });
  acces.filter(a => (a.b === 1 || a.a === 1) && a.vitre).forEach(a => { a.type = 'fenetre'; });
  const main = ext[0]; if (main) { const r = rooms.find(x => x.id === (main.a === 1 ? main.b : main.a)); if (r && r.type !== 'circ') r.type = 'hall'; }
  for (const a of acces) if (!a.type) a.type = a.vitre ? 'ignore' : a.w > 3.5 ? 'ignore' : 'interieur';
}

/* ------------------------------------------------------------------------------------------------ état et grille */
S.assist = null;
const asLevel = () => { const l = level(); return l && S.assist && S.assist.levelId === l.id ? l : null; };
async function asGrid(l) {
  const A = S.assist; if (A.grid && A.gridVer === l.analyse.rle) return A.grid;
  const an = l.analyse; const gr = await asReadPlan(l, an.opts);
  if (gr.G !== an.G || gr.H !== an.H) throw new Error('Le plan a changé depuis l\'analyse : relancez la détection.');
  gr.lab = asRLE.dec(an.rle, an.G * an.H); A.grid = gr; A.gridVer = an.rle; A.coarse = null; return gr;
}
function asSave(l, gr) { l.analyse.rle = asRLE.enc(gr.lab); S.assist.gridVer = l.analyse.rle; S.assist.coarse = null; S.assist.img = null; setDirty(); }
const asRoom = (l, id) => (l.analyse.rooms || []).find(r => r.id === id) || null;
const asIsExt = (l, id) => id === 1 || (asRoom(l, id) || {}).type === 'ext';
function asLabelAt(gr, x, y) { const gx = Math.floor(x / gr.k), gy = Math.floor(y / gr.k); if (gx < 0 || gy < 0 || gx >= gr.G || gy >= gr.H) return 1; return gr.lab[gy * gr.G + gx]; }
/* zone située à une distance d (m) d'un point, dans une direction : on cherche la première case étiquetée */
function asLabelToward(gr, x, y, dx, dy, dmax = 1.2) {
  const s = gr.k; for (let t = 0.15; t <= dmax; t += 0.05) { const v = asLabelAt(gr, x + dx * t * s / gr.cellM, y + dy * t * s / gr.cellM); if (v > 0) return v; } return 0;
}
/* recalcule les deux zones d'un accès à partir de sa position */
function asRefreshAccess(l, gr) {
  for (const a of l.analyse.acces) {
    const r = a.ang * Math.PI / 180, nx = -Math.sin(r), ny = Math.cos(r);
    const p = asLabelToward(gr, a.x, a.y, nx, ny), q = asLabelToward(gr, a.x, a.y, -nx, -ny);
    if (p && q && p !== q) { a.a = p; a.b = q; } else if (p || q) { a.a = p || q; a.b = a.b === a.a ? 1 : (a.b || 1); }
  }
}

/* ---------------------------------------------------------------- lancer / relancer la détection */
async function asDetect(l, opts) {
  const t0 = Date.now(); const keepManual = (l.analyse && l.analyse.acces || []).filter(a => a.manuel);
  const gr = await asReadPlan(l, opts); gr.lab = asSegment(gr, opts);
  asOutside(gr);
  let rooms = asStats(gr, []);
  // pièces trop petites : rendues aux murs (bruit)
  const small = new Set(rooms.filter(r => r.area < opts.minArea).map(r => r.id));
  if (small.size) { for (let i = 0; i < gr.lab.length; i++) if (small.has(gr.lab[i])) gr.lab[i] = 0; rooms = rooms.filter(r => !small.has(r.id)); }
  const raw = asOpenings(gr);
  const acces = raw.map((o, i) => ({ id: uid(), ...o })).concat(keepManual);
  asGuessTypes(rooms, acces);
  l.analyse = { v: 1, G: gr.G, H: gr.H, k: gr.k, cellM: gr.cellM, rle: asRLE.enc(gr.lab), rooms, acces, opts: { ...opts }, rdc: l.analyse ? l.analyse.rdc : asDefaultRdc(l), protection: l.analyse ? l.analyse.protection : 'standard', date: today() };
  S.assist.grid = gr; S.assist.gridVer = l.analyse.rle; S.assist.coarse = null; S.assist.img = null; S.assist.props = [];
  setDirty(); return { ms: Date.now() - t0, rooms: rooms.length, acces: acces.length };
}
const asDefaultRdc = (l) => S.project.levels.indexOf(l) === 0 || /\b(rdc|rez|r\+?0|plain)/i.test(l.name || '');

/* ------------------------------------------------------------------------------------------------ propositions */
/* grille grossière (≈ 15 cm) pour la visibilité et la couverture */
function asCoarse(gr) {
  if (S.assist.coarse) return S.assist.coarse;
  const f = Math.max(1, Math.round(0.15 / gr.cellM)); const CW = Math.ceil(gr.G / f), CH = Math.ceil(gr.H / f);
  const wallC = new Uint8Array(CW * CH), labC = new Int32Array(CW * CH);
  for (let y = 0; y < gr.H; y++) for (let x = 0; x < gr.G; x++) { const i = y * gr.G + x; const c = Math.floor(y / f) * CW + Math.floor(x / f); if (gr.wall[i]) wallC[c] = 1; }
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) { const x = Math.min(gr.G - 1, cx * f + (f >> 1)), y = Math.min(gr.H - 1, cy * f + (f >> 1)); labC[cy * CW + cx] = wallC[cy * CW + cx] ? 0 : gr.lab[y * gr.G + x]; }
  const unit = f * gr.k;   // taille d'une case grossière en px du plan
  return (S.assist.coarse = { f, CW, CH, wallC, labC, unit, m: f * gr.cellM });
}
function asLos(C, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  for (let t = 1; t < n; t++) { const x = Math.round(ax + dx * t / n), y = Math.round(ay + dy * t / n); if (C.wallC[y * C.CW + x]) return false; }
  return true;
}
const asToC = (C, x, y) => [Math.min(C.CW - 1, Math.max(0, Math.floor(x / C.unit))), Math.min(C.CH - 1, Math.max(0, Math.floor(y / C.unit)))];
const asFromC = (C, cx, cy) => [(cx + 0.5) * C.unit, (cy + 0.5) * C.unit];
function asRoomCells(C, id) {
  const cells = []; const { CW, CH, labC, wallC } = C;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const i = y * CW + x; if (labC[i] !== id) continue;
    let nw = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= CW || yy >= CH || wallC[yy * CW + xx]) nw++; }
    cells.push({ x, y, nw }); }
  return cells;
}
const asIsDetector = (t) => !!(t && t.sys === 'Anti-intrusion' && t.detRange && t.detAngle && t.zone !== 'faisceau' && t.id !== 'fog');
/* couverture d'une cible par un détecteur placé en (px,py) plan, orienté rot */
function asCovers(C, det, tgt, range, ang, rot) {
  const dx = (tgt.x - det.x) * C.m, dy = (tgt.y - det.y) * C.m; const d = Math.hypot(dx, dy);
  if (d > range) return false; if (d > 0.3) { let a = Math.atan2(dy, dx) * 180 / Math.PI - rot; a = ((a + 540) % 360) - 180; if (Math.abs(a) > ang / 2) return false; }
  return asLos(C, det.x, det.y, tgt.x, tgt.y);
}
/* placement volumétrique : meilleurs emplacements le long des murs de la pièce */
function asPlaceCoverage(l, C, room, t, { max = 1, target = 60, focus = null, pre = [] } = {}) {
  const range = t.detRange || 10, ang = t.detAngle || 90;
  const all = asRoomCells(C, room.id); if (!all.length) return [];
  let stride = 3; let targets = all.filter(c => c.x % stride === 0 && c.y % stride === 0);
  while (targets.length > 450) { stride++; targets = all.filter(c => c.x % stride === 0 && c.y % stride === 0); }
  if (!targets.length) targets = all.slice(0, 50);
  const covered = new Uint8Array(targets.length);
  for (const p of pre) { const [x, y] = asToC(C, p.x, p.y); const tt = typeOf(p.typeId); targets.forEach((c, i) => { if (!covered[i] && asCovers(C, { x, y }, c, p.range ?? tt.detRange, p.angle ?? tt.detAngle, p.rot)) covered[i] = 1; }); }
  let cands = all.filter(c => c.nw >= 2); if (!cands.length) cands = all;
  while (cands.length > 160) cands = cands.filter((_, i) => i % 2 === 0);
  const [ix, iy] = asToC(C, room.ix, room.iy); const fc = focus ? asToC(C, focus.x, focus.y) : null;
  const out = [];
  for (let n = 0; n < max; n++) {
    const before = covered.reduce((s, v) => s + v, 0);
    if ((n > 0 || pre.length) && before / targets.length * 100 >= target) break;
    let best = null;
    for (const c of cands) {
      const toward = fc || [ix, iy]; const base = Math.atan2(toward[1] - c.y, toward[0] - c.x) * 180 / Math.PI;
      if (fc) { const df = Math.hypot((fc[0] - c.x) * C.m, (fc[1] - c.y) * C.m); if (df < 1.5 || df > range * 0.9 || !asLos(C, c.x, c.y, fc[0], fc[1])) continue; }
      for (const off of fc ? [0, -15, 15] : [0, -20, 20, -40, 40]) {
        const rot = base + off; let s = 0;
        for (let i = 0; i < targets.length; i++) if (!covered[i] && asCovers(C, c, targets[i], range, ang, rot)) s++;
        s += c.nw * 0.3;               // préférence pour les angles
        if (!best || s > best.s) best = { c, rot, s };
      }
    }
    if (!best) break;
    let gain = 0; targets.forEach((tg, i) => { if (!covered[i] && asCovers(C, best.c, tg, range, ang, best.rot)) { covered[i] = 1; gain++; } });
    if ((n > 0 || pre.length) && gain < targets.length * 0.08) break;
    const [x, y] = asFromC(C, best.c.x, best.c.y);
    out.push({ x, y, rot: Math.round(((best.rot % 360) + 360) % 360) });
  }
  const pct = Math.round(covered.reduce((s, v) => s + v, 0) / targets.length * 100);
  out.forEach(o => { o.pct = pct; });
  return out;
}
function asAccessGeom(l, a) {
  const r = a.ang * Math.PI / 180; const ux = Math.cos(r), uy = Math.sin(r);
  // normale orientée vers l'intérieur (zone non extérieure)
  let nx = -uy, ny = ux; const gr = S.assist.grid; const inner = asIsExt(l, a.a) ? a.b : a.a;
  const p = asLabelToward(gr, a.x, a.y, nx, ny); if (p !== inner) { nx = -nx; ny = -ny; }
  return { ux, uy, nx, ny, inner, outer: inner === a.a ? a.b : a.a, px: l.scale };
}
/* point libre d'une pièce : son centre, ou la case la plus proche du centre à plus de 1,2 m des autres propositions */
function asFreeSpot(l, C, room, props) {
  const taken = props.filter(p => p.roomId === room.id).concat(l.markers.filter(m => asLabelAt(S.assist.grid, m.x, m.y) === room.id));
  const free = (x, y) => taken.every(p => Math.hypot(p.x - x, p.y - y) / l.scale > 1.2);
  if (free(room.ix, room.iy)) return { x: room.ix, y: room.iy };
  let best = null; for (const c of asRoomCells(C, room.id)) { if (c.nw) continue; const [x, y] = asFromC(C, c.x, c.y); if (!free(x, y)) continue; const d = Math.hypot(x - room.ix, y - room.iy); if (!best || d < best.d) best = { x, y, d }; }
  return best || { x: room.ix, y: room.iy };
}
function asCentral(l, rooms) {
  if (!rooms.length) return null; const all = l.analyse.rooms.filter(r => !['ext', 'ignore'].includes(r.type));
  let best = null; for (const r of rooms) { const s = all.reduce((t, o) => t + Math.hypot(o.ix - r.ix, o.iy - r.iy), 0); if (!best || s < best.s) best = { r, s }; }
  return best.r;
}

async function asPropose(l) {
  const R = await asLoadRules(); const gr = await asGrid(l); const C = asCoarse(gr); const an = l.analyse;
  const props = []; const renf = an.protection === 'renforce';
  const rooms = an.rooms.filter(r => !['ext', 'ignore'].includes(r.type));
  const roomOfPoint = (x, y) => asLabelAt(gr, x, y);
  const inRoom = (id, typeId) => l.markers.filter(m => m.typeId === typeId && roomOfPoint(m.x, m.y) === id).length + props.filter(p => p.typeId === typeId && p.roomId === id).length;
  const near = (x, y, typeId, dm) => l.markers.some(m => m.typeId === typeId && Math.hypot(m.x - x, m.y - y) / l.scale < dm) || props.some(p => p.typeId === typeId && Math.hypot(p.x - x, p.y - y) / l.scale < dm);
  const push = (r, t, o) => props.push({ id: uid(), regle: r.id, typeId: t.id, rot: 0, ...o, raison: r.raison + (o.detail ? ` (${o.detail})` : '') });
  const accessTypes = (a) => a.type;
  for (const r of R.regles) {
    if (r.actif === false) continue;
    if (r.protection === 'renforce' && !renf) continue;
    if (r.rdc && !an.rdc) continue;
    const t = S.db.find(x => x.id === r.materiel); if (!t) continue;
    const types = r.types || [];
    if (r.cible === 'acces') {
      for (const a of an.acces) {
        if (!types.includes(accessTypes(a))) continue;
        const g = asAccessGeom(l, a); const room = asRoom(l, g.inner);
        if (r.dansPieces && r.dansPieces.length && !(asRoom(l, a.a) && r.dansPieces.includes(asRoom(l, a.a).type)) && !(asRoom(l, a.b) && r.dansPieces.includes(asRoom(l, a.b).type))) continue;
        // pièce de référence : celle qui correspond au filtre « dans les pièces », sinon la pièce intérieure
        let inner = g.inner; if (r.dansPieces && r.dansPieces.length) { const ra = asRoom(l, a.a), rb = asRoom(l, a.b); inner = ra && r.dansPieces.includes(ra.type) ? a.a : rb && r.dansPieces.includes(rb.type) ? a.b : g.inner; }
        const sgn = inner === g.inner ? 1 : -1; const nx = g.nx * sgn, ny = g.ny * sgn; const roomI = asRoom(l, inner);
        const where = roomI ? roomI.nom : '';
        if (r.placement === 'ouverture') {
          const x = a.x + (g.ux * a.w * 0.3 + nx * 0.3) * l.scale, y = a.y + (g.uy * a.w * 0.3 + ny * 0.3) * l.scale;
          if (near(x, y, t.id, 1.5)) continue;
          push(r, t, { x, y, rot: a.ang, roomId: inner, accId: a.id, local: where });
        } else if (r.placement === 'vers-acces') {
          if (!roomI) continue;
          if (props.some(p => p.typeId === t.id && p.accId === a.id) || inRoom(inner, t.id) && near(a.x, a.y, t.id, (t.detRange || 10))) continue;
          const pre = [...l.markers.filter(m => asIsDetector(typeOf(m.typeId)) && roomOfPoint(m.x, m.y) === inner), ...props.filter(p => asIsDetector(typeOf(p.typeId)) && p.roomId === inner)];
          const pl = asPlaceCoverage(l, C, roomI, t, { max: 1, focus: a, pre });
          if (pl[0]) push(r, t, { ...pl[0], roomId: inner, accId: a.id, local: where, detail: `couvre ${pl[0].pct} % de la pièce` });
        } else if (r.placement === 'exterieur') {
          const x = a.x + (-nx * 0.8 + g.ux * (a.w / 2 + 0.6)) * l.scale, y = a.y + (-ny * 0.8 + g.uy * (a.w / 2 + 0.6)) * l.scale;
          if (near(x, y, t.id, 3)) continue;
          push(r, t, { x, y, rot: (Math.atan2(-ny, -nx) * 180 / Math.PI + 360) % 360, roomId: 1, accId: a.id, local: 'Façade' });
        }
      }
    } else if (r.cible === 'piece') {
      for (const room of rooms) {
        if (!types.includes(room.type)) continue;
        if (r.facade && !room.facade) continue;
        if (r.placement === 'couverture') {
          const det = asIsDetector(t);
          const pre = [...l.markers.filter(m => (det ? asIsDetector(typeOf(m.typeId)) : m.typeId === t.id) && roomOfPoint(m.x, m.y) === room.id),
            ...props.filter(p => (det ? asIsDetector(typeOf(p.typeId)) : p.typeId === t.id) && p.roomId === room.id)];
          if (!det && pre.length >= (r.max || 1)) continue;
          if (det && pre.length >= (r.max || 1) + 1) continue;
          const pl = asPlaceCoverage(l, C, room, t, { max: Math.max(1, (r.max || 1) - (det ? 0 : pre.length)), target: r.couverture ?? 60, pre });
          pl.forEach((p, i) => push(r, t, { ...p, roomId: room.id, local: room.nom, detail: `${pl.length > 1 ? `${i + 1}/${pl.length}, ` : ''}couverture de la pièce ${p.pct} %` }));
        } else if (r.placement === 'centre') {
          if (inRoom(room.id, t.id)) continue;
          push(r, t, { ...asFreeSpot(l, C, room, props), rot: 0, roomId: room.id, local: room.nom });
        } else if (r.placement === 'oppose-acces') {
          if (inRoom(room.id, t.id)) continue;
          const acc = an.acces.filter(a => (a.a === room.id || a.b === room.id) && a.type !== 'ignore');
          if (!acc.length) { push(r, t, { x: room.ix, y: room.iy, rot: 0, roomId: room.id, local: room.nom }); continue; }
          const cells = asRoomCells(C, room.id).filter(c => c.nw >= 1); let best = null;
          for (const c of cells) { const [x, y] = asFromC(C, c.x, c.y); const d = Math.min(...acc.map(a => Math.hypot(a.x - x, a.y - y))); if (!best || d > best.d) best = { x, y, d }; }
          if (best) push(r, t, { x: best.x, y: best.y, rot: 0, roomId: room.id, local: room.nom, detail: 'à ajuster sous le plan de travail' });
        }
      }
    } else if (r.cible === 'niveau' || (r.cible === 'site' && r.placement === 'central')) {
      if (r.cible === 'site' ? S.project.levels.some(lv => lv.markers.some(m => m.typeId === t.id)) : l.markers.some(m => m.typeId === t.id)) continue;
      if (props.some(p => p.typeId === t.id)) continue;
      let room = null; for (const ty of types) { room = asCentral(l, rooms.filter(x => x.type === ty)); if (room) break; }
      if (!room) room = asCentral(l, rooms.filter(x => !['sanit', 'escalier', 'confinement'].includes(x.type)));
      if (room) push(r, t, { ...asFreeSpot(l, C, room, props), rot: 0, roomId: room.id, local: room.nom });
    } else if (r.cible === 'site' && r.placement === 'exterieur') {
      if (S.project.levels.some(lv => lv.markers.some(m => m.typeId === t.id)) || props.some(p => p.typeId === t.id)) continue;
      const a = an.acces.find(x => types.includes(x.type)); if (!a) continue;
      const g = asAccessGeom(l, a);
      push(r, t, { x: a.x + (-g.nx * 0.8 + g.ux * (a.w / 2 + 0.6)) * l.scale, y: a.y + (-g.ny * 0.8 + g.uy * (a.w / 2 + 0.6)) * l.scale, rot: 0, roomId: 1, accId: a.id, local: 'Façade' });
    } else if (r.cible === 'portee') {
      const portee = +R.params.porteeUtile || 35;
      const hub = l.markers.find(m => m.typeId === 'hub') || props.find(p => p.typeId === 'hub'); if (!hub) continue;
      if (l.markers.some(m => m.typeId === t.id) || props.some(p => p.typeId === t.id)) continue;
      const devs = [...l.markers, ...props].filter(m => m !== hub && !['pdc', 'lock', 'vpext', 'vsint', 'rep'].includes(m.typeId));
      let far = null; for (const m of devs) { const d = Math.hypot(m.x - hub.x, m.y - hub.y) / l.scale; if (!far || d > far.d) far = { m, d }; }
      if (!far || far.d <= portee) continue;
      const f = Math.min(0.85, portee * 0.75 / far.d); let x = hub.x + (far.m.x - hub.x) * f, y = hub.y + (far.m.y - hub.y) * f;
      // se recaler sur la pièce de circulation la plus proche
      const circ = rooms.filter(x2 => ['circ', 'hall'].includes(x2.type)); let room = null, bd = 1e12;
      for (const rm of circ.length ? circ : rooms) { const d = Math.hypot(rm.ix - x, rm.iy - y); if (d < bd) { bd = d; room = rm; } }
      if (room && bd / l.scale < portee * 0.4) { const lab = roomOfPoint(x, y); if (lab !== room.id) { x = room.ix; y = room.iy; } }
      push(r, t, { x, y, rot: 0, roomId: room ? room.id : 0, local: room ? room.nom : '', detail: `matériel le plus éloigné à ${Math.round(far.d)} m de la centrale, portée utile retenue ${portee} m` });
    }
  }
  props.forEach((p, i) => { p.n = i + 1; });
  return props;
}

/* ------------------------------------------------------------------------------------------------ ouverture / fermeture */
async function openAssistant() {
  const l = level(); if (!l) { toast('Importez d\'abord un plan.', true); return; }
  if (isPhoto(l)) { toast('L\'assistant fonctionne sur un plan, pas sur une photo du site.', true); return; }
  if (!need('implanter')) return;
  if (S.assist && S.assist.levelId === l.id) { closeAssistant(); return; }
  await asLoadRules();
  S.assist = { levelId: l.id, tab: l.analyse ? 'pieces' : 'pieces', sel: null, selAcc: null, selProp: null, mode: null, props: [], grid: null, busy: false };
  S.selId = null; setTool('select'); $('#tAssist').classList.add('on');
  if (l.analyse && l.scale) { try { S.assist.busy = true; renderAssistSide(); await asGrid(l); } catch (e) { toast(e.message, true); } finally { S.assist.busy = false; } }
  renderMarkers(); renderSide();
}
function closeAssistant() { S.assist = null; const b = $('#tAssist'); if (b) b.classList.remove('on'); renderMarkers(); renderSide(); }
/* changement de niveau : l'assistant suit le niveau affiché */
async function asFollowLevel() {
  if (!S.assist) return; const l = level(); if (!l || S.assist.levelId === l.id) return;
  if (isPhoto(l)) { closeAssistant(); return; }
  Object.assign(S.assist, { levelId: l.id, sel: null, selAcc: null, selProp: null, mode: null, props: [], grid: null, coarse: null, img: null });
  if (l.analyse && l.scale) { try { await asGrid(l); } catch (e) { toast(e.message, true); } }
  renderMarkers(); renderSide();
}
/* plan modifié (rotation, recadrage, masque) : l'analyse n'est plus valable */
function asInvalidate(l) { if (l && l.analyse) { delete l.analyse; if (S.assist && S.assist.levelId === l.id) Object.assign(S.assist, { grid: null, coarse: null, img: null, props: [] }); } }

/* ------------------------------------------------------------------------------------------------ dessin sur le plan */
function asRoomImage(l) {
  const A = S.assist; const key = `${l.analyse.rle.length}:${A.sel}:${A.tab}:${l.analyse.rooms.map(r => r.type).join(',')}`;
  if (A.img && A.img.key === key) return A.img.url;
  const gr = A.grid; const { G, H, lab } = gr;
  const col = new Map(); for (const r of l.analyse.rooms) { const h = asPieceInfo(r.type || 'ignore')[2]; col.set(r.id, [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), r.id === A.sel ? 150 : (A.tab === 'pieces' ? 78 : 40)]); }
  const cv = document.createElement('canvas'); cv.width = G; cv.height = H; const g = cv.getContext('2d'); const im = g.createImageData(G, H); const d = im.data;
  for (let i = 0; i < G * H; i++) { const c = col.get(lab[i]); if (!c) continue; const j = i * 4; d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = c[3]; }
  g.putImageData(im, 0, 0); A.img = { key, url: cv.toDataURL('image/png') }; return A.img.url;
}
function renderAssist() {
  const el = $('#gAssist'), bg = $('#gAssistBg'); if (!el) return; const l = asLevel();
  if (!l || !l.analyse || !S.assist.grid) { el.innerHTML = ''; if (bg) bg.innerHTML = ''; return; }
  const A = S.assist; const s = markerSize(l); const an = l.analyse; let h = '', hb = '';
  if (A.tab !== 'props') hb += `<image href="${asRoomImage(l)}" x="0" y="0" width="${l.plan.w}" height="${l.plan.h}" preserveAspectRatio="none" style="image-rendering:pixelated" pointer-events="none"/>`;
  if (A.tab === 'pieces') hb += an.rooms.filter(r => r.type !== 'ignore').map(r => `<text x="${r.ix}" y="${r.iy - s * 0.9}" font-size="${s * 0.42}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#0f1724" stroke="#fff" stroke-width="${s * 0.12}" paint-order="stroke" pointer-events="none">${esc(r.nom)}</text>`).join('');
  // accès
  an.acces.forEach((a, i) => {
    if (A.tab === 'props' && a.type === 'ignore') return;
    const c = asAccInfo(a.type)[2]; const r = a.ang * Math.PI / 180; const hw = a.w / 2 * l.scale;
    const sel = A.selAcc === a.id; const sz = A.tab === 'acces' ? 1 : 0.6;
    h += `<g class="as-acc" data-acc="${a.id}"><line x1="${a.x - Math.cos(r) * hw}" y1="${a.y - Math.sin(r) * hw}" x2="${a.x + Math.cos(r) * hw}" y2="${a.y + Math.sin(r) * hw}" stroke="${c}" stroke-width="${s * 0.22 * sz}" stroke-linecap="round" opacity="0.85"/>
      ${A.tab === 'acces' ? `<circle cx="${a.x}" cy="${a.y}" r="${s * 0.34}" fill="${c}" stroke="${sel ? '#1d4fb8' : '#fff'}" stroke-width="${s * (sel ? 0.12 : 0.06)}"/><text x="${a.x}" y="${a.y}" font-size="${s * 0.34}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#fff" pointer-events="none">${i + 1}</text>` : ''}</g>`;
  });
  // propositions
  if (A.tab === 'props') for (const p of A.props) {
    const m = { id: p.id, typeId: p.typeId, x: p.x, y: p.y, rot: p.rot, label: String(p.n), showZone: true, range: null, angle: null };
    const sel = A.selProp === p.id;
    h += `<g class="as-prop" data-prop="${p.id}" opacity="${sel ? 0.95 : 0.7}">${zonePath(m, l)}${markerMarkup(m, l, { live: false })}
      <circle cx="${p.x}" cy="${p.y}" r="${s * 0.62}" fill="none" stroke="${sel ? '#1d4fb8' : '#c8102e'}" stroke-width="${s * 0.06}" stroke-dasharray="${s * 0.16} ${s * 0.1}"/></g>`;
  }
  // rectangle en cours de tracé
  const d = S.drag; if (d && d.mode === 'a:rect') { const rr = normRect(d.a, d.b, l); h += `<rect x="${rr.x}" y="${rr.y}" width="${rr.w}" height="${rr.h}" fill="#1d4fb8" fill-opacity="0.15" stroke="#1d4fb8" stroke-width="${s * 0.06}" stroke-dasharray="${s * 0.2} ${s * 0.12}"/>`; }
  el.innerHTML = h; if (bg) bg.innerHTML = hb;
}

/* ------------------------------------------------------------------------------------------------ interactions sur le plan */
function assistPointerDown(e, p) {
  const l = asLevel(); if (!l || !l.analyse || !S.assist.grid) return false; const A = S.assist; const gr = A.grid;
  if (A.mode === 'addRoom') { S.drag = { mode: 'a:rect', a: p, b: p }; svg().setPointerCapture(e.pointerId); return true; }
  if (A.mode === 'addAcc') { asAddAccess(l, p); return true; }
  if (A.mode === 'merge') { const id = asLabelAt(gr, p.x, p.y); if (id >= 2 && id !== A.sel) asMerge(l, A.sel, id); else toast('Touchez une autre pièce, ou Échap pour annuler.'); return true; }
  if (A.tab === 'props') {
    const g = e.target.closest('.as-prop'); if (!g) return false;
    const pr = A.props.find(x => x.id === g.dataset.prop); if (!pr) return true;
    A.selProp = pr.id; renderAssist(); renderAssistSide(true);
    S.drag = { mode: 'a:prop', pr, dx: p.x - pr.x, dy: p.y - pr.y, started: false, x0: e.clientX, y0: e.clientY }; svg().setPointerCapture(e.pointerId); return true;
  }
  if (A.tab === 'acces') {
    const g = e.target.closest('.as-acc'); if (g) { A.selAcc = g.dataset.acc; renderAssist(); renderAssistSide(true);
      const ac = l.analyse.acces.find(x => x.id === A.selAcc); S.drag = { mode: 'a:acc', ac, dx: p.x - ac.x, dy: p.y - ac.y, started: false, x0: e.clientX, y0: e.clientY }; svg().setPointerCapture(e.pointerId); return true; }
    return false;
  }
  if (A.tab === 'pieces') {
    if (e.target.closest('.mk') || e.target.closest('.note') || e.target.closest('.ppin')) return false;
    const id = asLabelAt(gr, p.x, p.y);
    if (id >= 2 && asRoom(l, id)) { A.sel = id; renderAssist(); renderAssistSide(true); S.drag = { mode: 'a:tap', x0: e.clientX, y0: e.clientY, vb: { ...S.vb } }; svg().setPointerCapture(e.pointerId); return true; }
  }
  return false;
}
function assistPointerMove(e, p, d) {
  const l = asLevel(); if (!l) return;
  if (d.mode === 'a:rect') { d.b = p; renderAssist(); return; }
  if (d.mode === 'a:tap') { const k = S.vb.w / svg().clientWidth; S.vb.x = d.vb.x - (e.clientX - d.x0) * k; S.vb.y = d.vb.y - (e.clientY - d.y0) * k; applyVb(); return; }
  if (d.mode === 'a:prop' || d.mode === 'a:acc') {
    if (!d.started) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return; d.started = true; }
    const o = d.pr || d.ac; o.x = p.x - d.dx; o.y = p.y - d.dy; if (d.ac) setDirty(); renderAssist();
  }
}
function assistPointerUp(d) {
  const l = asLevel(); if (!l) return;
  if (d.mode === 'a:rect') { const r = normRect(d.a, d.b, l); S.assist.mode = null; asAddRoomRect(l, r); return; }
  if (d.mode === 'a:prop' && d.started) { const gr = S.assist.grid; const id = asLabelAt(gr, d.pr.x, d.pr.y); const rm = asRoom(l, id); if (rm) { d.pr.roomId = id; d.pr.local = rm.nom; } renderAssistSide(); }
  if (d.mode === 'a:acc' && d.started) { asRefreshAccess(l, S.assist.grid); renderAssistSide(); }
}

function asAddRoomRect(l, r) {
  const gr = S.assist.grid; if (r.w / l.scale < 0.8 || r.h / l.scale < 0.8) { toast('Rectangle trop petit.', true); renderAssistSide(); renderAssist(); return; }
  let id = 1; for (let i = 0; i < gr.lab.length; i++) if (gr.lab[i] > id) id = gr.lab[i]; id++;
  const x0 = Math.floor(r.x / gr.k), y0 = Math.floor(r.y / gr.k), x1 = Math.ceil((r.x + r.w) / gr.k), y1 = Math.ceil((r.y + r.h) / gr.k);
  for (let y = Math.max(0, y0); y < Math.min(gr.H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(gr.G, x1); x++) { const i = y * gr.G + x; if (!gr.wall[i]) gr.lab[i] = id; }
  l.analyse.rooms = asStats(gr, l.analyse.rooms); const nr = asRoom(l, id); if (nr && !nr.type) nr.type = 'bureau';
  for (const rm of l.analyse.rooms) if (!rm.type) rm.type = 'ignore';
  asRefreshAccess(l, gr); asSave(l, gr); S.assist.sel = id; S.assist.props = []; renderAssist(); renderAssistSide(); toast('Pièce ajoutée.');
}
function asMerge(l, a, b) {
  const gr = S.assist.grid; for (let i = 0; i < gr.lab.length; i++) if (gr.lab[i] === b) gr.lab[i] = a;
  l.analyse.acces = l.analyse.acces.filter(x => !((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  l.analyse.acces.forEach(x => { if (x.a === b) x.a = a; if (x.b === b) x.b = a; });
  l.analyse.rooms = asStats(gr, l.analyse.rooms.filter(r => r.id !== b));
  S.assist.mode = null; asSave(l, gr); S.assist.props = []; renderAssist(); renderAssistSide(); toast('Pièces fusionnées.');
}
function asAddAccess(l, p) {
  const gr = S.assist.grid; const R = Math.ceil(0.8 / gr.cellM); const gx = Math.floor(p.x / gr.k), gy = Math.floor(p.y / gr.k);
  // orientation du mur le plus proche (axe principal des cases de mur voisines)
  let n = 0, mx = 0, my = 0; const pts = [];
  for (let y = gy - R; y <= gy + R; y++) for (let x = gx - R; x <= gx + R; x++) { if (x < 0 || y < 0 || x >= gr.G || y >= gr.H) continue; if (gr.wall[y * gr.G + x]) { pts.push([x, y]); mx += x; my += y; n++; } }
  let ang = 0; if (n > 3) { mx /= n; my /= n; let cxx = 0, cyy = 0, cxy = 0; for (const [x, y] of pts) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); } ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI; }
  const a = { id: uid(), x: p.x, y: p.y, w: S.assist.addAccType === 'fenetre' ? 1.2 : 0.9, ang: Math.round(ang * 10) / 10, a: 0, b: 0, type: S.assist.addAccType || 'fenetre', manuel: true };
  l.analyse.acces.push(a); asRefreshAccess(l, gr);
  if (!a.a) { l.analyse.acces.pop(); toast('Touchez le plan sur un mur ou une ouverture d\'une pièce détectée.', true); return; }
  S.assist.selAcc = a.id; S.assist.props = []; setDirty(); renderAssist(); renderAssistSide(); toast('Accès ajouté. Continuez, ou Échap pour terminer.');
}

/* ------------------------------------------------------------------------------------------------ panneau latéral */
function renderAssistSide(soft = false) {
  const side = $('#side'); const l = asLevel(); if (!side || !l) return;
  const A = S.assist; const an = l.analyse;
  if (soft && an && A.grid) {  // simple mise en évidence de la ligne choisie
    $$('.as-row', side).forEach(r => r.classList.toggle('sel', r.dataset.room == A.sel || r.dataset.acc === A.selAcc || r.dataset.prop === A.selProp));
    const s = $('.as-row.sel', side); if (s) s.scrollIntoView({ block: 'nearest' }); return;
  }
  const head = `<section class="as-head"><div><div class="as-title">Assistant d'implantation</div><div class="muted" style="font-size:12px">${esc(lvLabel(l))}</div></div><button id="asClose" class="ghost small">Fermer</button></section>`;
  let body = '';
  if (!l.scale) body = `<section><div class="warnbox">L'assistant a besoin de l'échelle du plan pour mesurer les pièces et la portée des détecteurs.</div><button id="asScale" class="primary">Définir l'échelle</button></section>`;
  else if (A.busy) body = `<section><div class="info">Analyse du plan en cours…</div></section>`;
  else if (!an || !A.grid) body = asOptsMarkup(an ? an.opts : AS_DEFAULT_OPTS, false);
  else {
    const nR = an.rooms.filter(r => r.type !== 'ignore').length, nA = an.acces.filter(a => a.type !== 'ignore').length;
    body = `<section class="as-tabs"><button data-tab="pieces" class="${A.tab === 'pieces' ? 'on' : ''}">1. Pièces <b>${nR}</b></button><button data-tab="acces" class="${A.tab === 'acces' ? 'on' : ''}">2. Accès <b>${nA}</b></button><button data-tab="props" class="${A.tab === 'props' ? 'on' : ''}">3. Propositions <b>${A.props.length}</b></button></section>
      <section class="as-opts"><div class="row2"><label class="field"><span>Niveau de protection</span><select id="asProt"><option value="standard" ${an.protection !== 'renforce' ? 'selected' : ''}>Standard</option><option value="renforce" ${an.protection === 'renforce' ? 'selected' : ''}>Renforcé</option></select></label>
        <label class="chk" style="align-self:end;padding-bottom:6px"><input type="checkbox" id="asRdc" ${an.rdc ? 'checked' : ''}> Niveau de plain-pied</label></div></section>`;
    if (A.mode) body += `<section><div class="as-mode">${A.mode === 'addRoom' ? 'Tracez un rectangle sur le plan pour créer une pièce.' : A.mode === 'merge' ? `Touchez la pièce à fusionner avec « ${esc((asRoom(l, A.sel) || {}).nom || '')} ».` : 'Touchez le plan sur l\'ouverture à ajouter.'} <button id="asModeX" class="ghost small">Annuler (Échap)</button></div></section>`;
    if (A.tab === 'pieces') body += asPiecesMarkup(l);
    else if (A.tab === 'acces') body += asAccesMarkup(l);
    else body += asPropsMarkup(l);
    body += `<section class="as-foot"><button id="asRedo" class="ghost small">Relancer la détection…</button><button id="asRules" class="ghost small">Règles d'implantation…</button></section>`;
  }
  side.innerHTML = head + body;
  asBindSide(l);
}
function asOptsMarkup(o, again) {
  return `<section><p style="margin:0">L'assistant repère les pièces et les accès du plan, puis propose l'emplacement des matériels anti-intrusion et anti-agression selon les règles d'implantation.</p>
    <ol class="as-steps"><li>Détection des pièces et des accès</li><li>Vous indiquez le type de chaque pièce et de chaque accès</li><li>Propositions à accepter ou refuser</li></ol></section>
  <section><div class="row2"><label class="field"><span>Ouverture plus large : même pièce (m)</span> <input id="asPorte" type="number" min="0.8" max="6" step="0.1" value="${o.porte}"></label>
    <label class="field"><span>Surface mini d'une pièce (m²)</span><input id="asMin" type="number" min="0.5" max="20" step="0.5" value="${o.minArea}"></label></div>
    <div class="row2"><label class="field"><span>Murs du plan</span><select id="asTraits"><option value="auto" ${o.traits === 'auto' ? 'selected' : ''}>Automatique</option><option value="epais" ${o.traits === 'epais' ? 'selected' : ''}>Murs épais (pochés)</option><option value="fins" ${o.traits === 'fins' ? 'selected' : ''}>Plan au trait (murs fins)</option></select></label>
    <label class="field"><span>Sensibilité (gris pris pour un mur)</span><input id="asSeuil" type="range" min="90" max="230" step="5" value="${o.seuil}"></label></div>
    <div class="muted" style="font-size:12px">Conseil : masquez d'abord le cartouche et les légendes (Niveau › Masquer une zone). Si deux pièces sont réunies, diminuez la largeur d'ouverture ; utilisez ensuite « Fusionner » ou « + Pièce » pour corriger.</div>
    <div class="btnrow"><button id="asRun" class="primary">${again ? 'Relancer la détection' : 'Analyser le plan'}</button>${again ? '<button id="asRunX" class="ghost">Annuler</button>' : ''}</div></section>`;
}
function asPiecesMarkup(l) {
  const A = S.assist; const an = l.analyse; const sel = asRoom(l, A.sel);
  const rows = an.rooms.slice().sort((a, b) => (a.type === 'ignore') - (b.type === 'ignore') || b.area - a.area).map(r => `<div class="as-row ${r.id === A.sel ? 'sel' : ''}" data-room="${r.id}">
      <span class="as-sw" style="background:${asPieceInfo(r.type)[2]}"></span>
      <div class="as-main"><input class="as-nm" value="${esc(r.nom)}" aria-label="Nom de la pièce"><select class="as-ty">${AS_PIECES.map(p => `<option value="${p[0]}" ${p[0] === r.type ? 'selected' : ''}>${esc(p[1])}</option>`).join('')}</select>
      <div class="muted as-meta">${String(r.area).replace('.', ',')} m²${r.facade ? ' · en façade' : ''} · ${an.acces.filter(a => (a.a === r.id || a.b === r.id) && a.type !== 'ignore').length} accès</div></div></div>`).join('');
  return `<section><div class="muted" style="font-size:12px">Touchez une pièce sur le plan pour la retrouver dans la liste. Indiquez son type : il décide des matériels proposés.</div>
    <div class="btnrow"><button id="asAddRoom" class="small">+ Pièce (rectangle)</button>${sel ? '<button id="asMerge" class="small">Fusionner…</button><button id="asIgnore" class="small ghost">Ignorer</button>' : ''}</div></section>
    <section class="as-list">${rows || '<div class="muted">Aucune pièce détectée : relancez la détection avec d\'autres réglages.</div>'}</section>
    <section><button id="asNext" class="primary">Étape suivante : les accès</button></section>`;
}
function asAccesMarkup(l) {
  const A = S.assist; const an = l.analyse;
  const nm = (id) => id === 1 ? 'extérieur' : (asRoom(l, id) || {}).nom || '?';
  const rows = an.acces.map((a, i) => ({ a, i })).sort((p, q) => (p.a.type === 'ignore') - (q.a.type === 'ignore') || (asIsExt(l, q.a.a) || asIsExt(l, q.a.b)) - (asIsExt(l, p.a.a) || asIsExt(l, p.a.b)) || p.i - q.i)
    .map(({ a, i }) => `<div class="as-row ${a.id === A.selAcc ? 'sel' : ''}" data-acc="${a.id}"><span class="as-num" style="background:${asAccInfo(a.type)[2]}">${i + 1}</span>
      <div class="as-main"><select class="as-at">${AS_ACCES.map(p => `<option value="${p[0]}" ${p[0] === a.type ? 'selected' : ''}>${esc(p[1])}</option>`).join('')}</select>
      <div class="muted as-meta">${esc(nm(a.a))} ↔ ${esc(nm(a.b))} · ${String(a.w).replace('.', ',')} m${a.manuel ? ' · ajouté' : ''}</div></div><button class="ghost small as-del" title="Supprimer cet accès">✕</button></div>`).join('');
  return `<section><div class="muted" style="font-size:12px">Les numéros sont reportés sur le plan. Les accès vers l'extérieur sont en tête de liste. Ajoutez les fenêtres accessibles : elles ne sont pas détectées automatiquement.</div>
    <div class="btnrow"><button id="asAddWin" class="small">+ Fenêtre</button><button id="asAddDoor" class="small">+ Porte</button></div></section>
    <section class="as-list">${rows || '<div class="muted">Aucun accès détecté.</div>'}</section>
    <section><button id="asCalc" class="primary">Calculer les propositions</button></section>`;
}
function asPropsMarkup(l) {
  const A = S.assist;
  if (!A.props.length) return `<section><div class="info">${A.computed ? 'Aucune proposition : les matériels prévus par les règles sont déjà posés, ou aucune pièce ni aucun accès ne correspond aux règles.' : 'Touchez « Calculer » pour obtenir les propositions.'}</div><button id="asCalc" class="primary">Calculer les propositions</button></section>`;
  const counts = {}; A.props.forEach(p => { counts[p.typeId] = (counts[p.typeId] || 0) + 1; });
  const rows = A.props.map(p => { const t = typeOf(p.typeId); return `<div class="as-row ${p.id === A.selProp ? 'sel' : ''}" data-prop="${p.id}"><span class="as-num">${p.n}</span>
      <div class="as-main"><div class="as-pt">${t.img ? `<img src="${t.img}" alt="">` : ''}<b>${esc(t.nom)}</b>${p.local ? ` <span class="muted">· ${esc(p.local)}</span>` : ''}</div><div class="muted as-meta">${esc(p.raison)}</div></div>
      <div class="as-yn"><button class="small as-ok" title="Accepter">✓</button><button class="small ghost as-no" title="Refuser">✕</button></div></div>`; }).join('');
  return `<section><div class="as-sum">${Object.entries(counts).map(([id, n]) => `<span>${n} × ${esc(typeOf(id).nom)}</span>`).join('')}</div>
    <div class="muted" style="font-size:12px">Les propositions sont en pointillés sur le plan. Faites-les glisser pour les déplacer avant de les accepter.</div>
    <div class="btnrow"><button id="asAll" class="primary small">Tout accepter</button><button id="asNone" class="ghost small">Tout refuser</button><button id="asCalc" class="ghost small">Recalculer</button></div></section>
    <section class="as-list">${rows}</section>`;
}
function asBindSide(l) {
  const A = S.assist; const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('asClose', closeAssistant);
  on('asScale', () => setTool('calib'));
  const readOpts = () => ({ porte: Math.min(6, Math.max(0.8, parseFloat($('#asPorte').value) || 2.2)), minArea: Math.max(0.5, parseFloat($('#asMin').value) || 1.2), traits: $('#asTraits').value, seuil: +$('#asSeuil').value || 165 });
  on('asRun', async () => {
    const o = readOpts(); A.busy = true; A.again = false; renderAssistSide();
    try { const r = await asDetect(l, o); A.tab = 'pieces'; A.sel = null; toast(`${r.rooms} pièce(s) et ${r.acces} accès détectés.`); }
    catch (e) { console.error(e); toast('Analyse impossible : ' + e.message, true); }
    finally { A.busy = false; renderMarkers(); renderAssistSide(); }
  });
  on('asRunX', () => { A.again = false; renderAssistSide(); });
  on('asRedo', async () => {
    if (!(await confirmBox('Relancer la détection', 'Les pièces et les accès seront détectés à nouveau : les noms et types saisis seront perdus (les accès ajoutés à la main sont conservés).', 'Continuer'))) return;
    const side = $('#side'); side.innerHTML = `<section class="as-head"><div class="as-title">Relancer la détection</div><button id="asClose" class="ghost small">Fermer</button></section>` + asOptsMarkup(l.analyse.opts, true); asBindSide(l);
  });
  on('asRules', () => openReglesEditor());
  $$('.as-tabs button').forEach(b => b.onclick = async () => { A.tab = b.dataset.tab; A.mode = null; if (A.tab === 'props' && !A.props.length) await asCompute(l); renderMarkers(); renderAssistSide(); });
  const prot = $('#asProt'); if (prot) prot.onchange = () => { l.analyse.protection = prot.value; A.props = []; A.computed = false; setDirty(); renderMarkers(); renderAssistSide(); };
  const rdc = $('#asRdc'); if (rdc) rdc.onchange = () => { l.analyse.rdc = rdc.checked; A.props = []; A.computed = false; setDirty(); renderMarkers(); renderAssistSide(); };
  on('asModeX', () => { A.mode = null; renderAssistSide(); });
  // pièces
  on('asAddRoom', () => { A.mode = 'addRoom'; renderAssistSide(); });
  on('asMerge', () => { A.mode = 'merge'; renderAssistSide(); });
  on('asIgnore', () => { const r = asRoom(l, A.sel); if (r) { r.type = 'ignore'; A.props = []; setDirty(); renderAssist(); renderAssistSide(); } });
  on('asNext', () => { A.tab = 'acces'; renderMarkers(); renderAssistSide(); });
  $$('.as-row[data-room]').forEach(row => {
    const r = asRoom(l, +row.dataset.room); if (!r) return;
    row.addEventListener('click', (e) => { if (e.target.closest('input,select')) return; A.sel = r.id; renderAssist(); renderAssistSide(true); asFocus(r.ix, r.iy); });
    $('.as-nm', row).onchange = (e) => { r.nom = e.target.value.trim() || r.nom; setDirty(); renderAssist(); };
    $('.as-ty', row).onchange = (e) => { const was = r.type; r.type = e.target.value; A.sel = r.id; A.props = []; A.computed = false;
      if ((was === 'ext') !== (r.type === 'ext')) l.analyse.rooms = asStats(A.grid, l.analyse.rooms);
      setDirty(); renderAssist(); renderAssistSide(); };
  });
  // accès
  on('asAddWin', () => { A.mode = 'addAcc'; A.addAccType = 'fenetre'; renderAssistSide(); });
  on('asAddDoor', () => { A.mode = 'addAcc'; A.addAccType = 'secondaire'; renderAssistSide(); });
  $$('.as-row[data-acc]').forEach(row => {
    const a = l.analyse.acces.find(x => x.id === row.dataset.acc); if (!a) return;
    row.addEventListener('click', (e) => { if (e.target.closest('select,button')) return; A.selAcc = a.id; renderAssist(); renderAssistSide(true); asFocus(a.x, a.y); });
    $('.as-at', row).onchange = (e) => { a.type = e.target.value; A.selAcc = a.id; A.props = []; A.computed = false; setDirty(); renderAssist(); renderAssistSide(); };
    $('.as-del', row).onclick = () => { l.analyse.acces = l.analyse.acces.filter(x => x !== a); A.props = []; setDirty(); renderAssist(); renderAssistSide(); };
  });
  on('asCalc', async () => { await asCompute(l); A.tab = 'props'; renderMarkers(); renderAssistSide(); });
  // propositions
  on('asAll', () => asAccept(l, A.props.slice()));
  on('asNone', () => { A.props = []; A.selProp = null; renderAssist(); renderAssistSide(); });
  $$('.as-row[data-prop]').forEach(row => {
    const p = A.props.find(x => x.id === row.dataset.prop); if (!p) return;
    row.addEventListener('click', (e) => { if (e.target.closest('button')) return; A.selProp = p.id; renderAssist(); renderAssistSide(true); asFocus(p.x, p.y); });
    $('.as-ok', row).onclick = () => asAccept(l, [p]);
    $('.as-no', row).onclick = () => { A.props = A.props.filter(x => x !== p); renderAssist(); renderAssistSide(); };
  });
}
async function asCompute(l) {
  const A = S.assist; A.busy = true; renderAssistSide();
  try { A.props = await asPropose(l); A.computed = true; A.selProp = null; }
  catch (e) { console.error(e); toast('Calcul impossible : ' + e.message, true); }
  finally { A.busy = false; }
}
function asAccept(l, list) {
  if (!list.length || !need('implanter')) return; const A = S.assist;
  pushHistory();
  for (const p of list) {
    l.markers.push({ id: uid(), typeId: p.typeId, x: p.x, y: p.y, label: nextLabel(p.typeId), local: p.local || '', rot: Math.round(p.rot || 0), showZone: true, range: null, angle: null, note: '' });
    const t = typeOf(p.typeId); if (!S.project.typeCache) S.project.typeCache = {}; S.project.typeCache[t.id] = { ...t };
  }
  A.props = A.props.filter(x => !list.includes(x)); A.selProp = null;
  setDirty(); renderMarkers(); renderAssistSide(); renderStatus();
  toast(list.length > 1 ? `${list.length} matériels posés (Ctrl+Z pour annuler).` : `${typeOf(list[0].typeId).nom} posé.`);
}
/* centre la vue sur un point sans changer le zoom */
function asFocus(x, y) { const v = S.vb; if (!v) return; if (x > v.x + v.w * 0.1 && x < v.x + v.w * 0.9 && y > v.y + v.h * 0.1 && y < v.y + v.h * 0.9) return; v.x = x - v.w / 2; v.y = y - v.h / 2; applyVb(); }
function assistEscape() { if (!S.assist) return false; if (S.assist.mode) { S.assist.mode = null; S.drag = null; renderAssist(); renderAssistSide(); return true; } return false; }

/* ------------------------------------------------------------------------------------------------ éditeur des règles (Admin) */
async function openReglesEditor() {
  await asLoadRules(); const edit = can('base');
  let R = JSON.parse(JSON.stringify(S.regles));
  const typeLabel = (r) => { const k = asTypesKind(r); const info = k === 'acces' ? asAccInfo : asPieceInfo; return (r.types || []).map(x => info(x)[1]).join(', ') || '—'; };
  const body = document.createElement('div');
  const render = () => {
    body.innerHTML = `<p style="margin:0 0 8px">Chaque règle indique <b>quand</b> proposer un matériel et <b>comment</b> le placer. ${edit ? 'Touchez une règle pour la modifier.' : 'Votre compte ne permet pas de les modifier.'}</p>
      <div class="row2" style="max-width:420px"><label class="field"><span>Portée radio utile en intérieur (m)</span><input id="rgPortee" type="number" min="5" max="500" step="1" value="${R.params.porteeUtile}" ${edit ? '' : 'disabled'}></label></div>
      <div class="rg-wrap"><table class="rg"><thead><tr><th></th><th>Quand</th><th>Matériel</th><th>Placement</th><th>Protection</th><th>Justification</th></tr></thead><tbody>
      ${R.regles.map((r, i) => { const t = typeOf(r.materiel); return `<tr data-i="${i}" class="${r.actif === false ? 'off' : ''}"><td><input type="checkbox" class="rg-on" ${r.actif !== false ? 'checked' : ''} ${edit ? '' : 'disabled'} title="Règle active"></td>
        <td><b>${esc(AS_CIBLES[r.cible] || r.cible)}</b>${asTypesKind(r) ? `<div class="muted">${esc(typeLabel(r))}${r.dansPieces && r.dansPieces.length ? ` · dans : ${esc(r.dansPieces.map(x => asPieceInfo(x)[1]).join(', '))}` : ''}${r.facade ? ' · en façade' : ''}${r.rdc ? ' · plain-pied' : ''}</div>` : ''}</td>
        <td><div class="rg-mat">${t.img ? `<img src="${t.img}" alt="">` : ''}${esc(t.nom)}</div></td>
        <td>${esc(AS_PLACEMENTS[r.placement] || r.placement)}${r.placement === 'couverture' ? `<div class="muted">${r.max || 1} max · objectif ${r.couverture ?? 60} %</div>` : ''}</td>
        <td>${r.protection === 'renforce' ? 'Renforcée' : 'Standard'}</td><td class="muted">${esc(r.raison || '')}</td></tr>`; }).join('')}</tbody></table></div>`;
    $$('.rg tbody tr', body).forEach(tr => {
      const i = +tr.dataset.i; $('.rg-on', tr).onclick = (e) => { e.stopPropagation(); R.regles[i].actif = e.target.checked; tr.classList.toggle('off', !e.target.checked); };
      if (edit) tr.onclick = async (e) => { if (e.target.closest('input')) return; const res = await asRuleDialog(R.regles[i]); if (res === 'del') R.regles.splice(i, 1); else if (res) R.regles[i] = res; render(); };
    });
    const pt = $('#rgPortee', body); if (pt) pt.onchange = () => { R.params.porteeUtile = Math.max(5, +pt.value || 35); };
  };
  render();
  await modal({ title: 'Règles d\'implantation', size: 'lg', body,
    left: edit ? [{ label: '+ Ajouter une règle', action: async () => { const res = await asRuleDialog({ id: 'u' + uid(), actif: true, cible: 'piece', types: [], materiel: 'mprot', placement: 'couverture', max: 1, couverture: 60, protection: 'standard', raison: '' }, true); if (res && res !== 'del') { R.regles.push(res); render(); } return false; } },
      { label: 'Rétablir les règles d\'origine', action: async () => { if (await confirmBox('Règles d\'origine', 'Remplacer toutes les règles par celles livrées avec le logiciel ?', 'Rétablir', true)) { R = { regles: JSON.parse(JSON.stringify(AS_DEFAULT_RULES)), params: { ...AS_DEFAULT_PARAMS } }; render(); } return false; } }] : [],
    buttons: edit ? [{ label: 'Annuler', value: null }, { label: 'Enregistrer', cls: 'primary', action: async () => {
      try { await window.native.regles.save({ regles: R.regles, params: R.params }); S.regles = { ...R, perso: true }; if (S.assist) { S.assist.props = []; S.assist.computed = false; renderMarkers(); if (asLevel()) renderAssistSide(); } toast('Règles d\'implantation enregistrées.'); return true; }
      catch (e) { toast(e.message, true); return false; } } }] : [{ label: 'Fermer', cls: 'primary', value: null }] });
}
async function asRuleDialog(r0, isNew = false) {
  const r = JSON.parse(JSON.stringify(r0));
  const chk = (list, sel, cls) => `<div class="rg-chk">${list.map(p => `<label class="chk"><input type="checkbox" class="${cls}" value="${p[0]}" ${(sel || []).includes(p[0]) ? 'checked' : ''}> ${esc(p[1])}</label>`).join('')}</div>`;
  const mats = S.db.filter(t => t.sys !== 'Vidéoprotection');
  const form = (root) => {
    const kind = asTypesKind(r); const places = AS_PLACE_BY_CIBLE[r.cible] || [];
    if (!places.includes(r.placement)) r.placement = places[0];
    $('#rgForm', root).innerHTML = `<div class="row2"><label class="field"><span>Quand</span><select id="rgCible">${Object.entries(AS_CIBLES).map(([k, v]) => `<option value="${k}" ${k === r.cible ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>Placement</span><select id="rgPlace">${places.map(k => `<option value="${k}" ${k === r.placement ? 'selected' : ''}>${esc(AS_PLACEMENTS[k])}</option>`).join('')}</select></label></div>
      ${kind ? `<div class="field"><span>${kind === 'acces' ? 'Types d\'accès concernés' : (r.cible === 'piece' ? 'Types de pièces concernés' : 'Pièces préférées (par ordre)')}</span>${chk(kind === 'acces' ? AS_ACCES.filter(p => p[0] !== 'ignore') : AS_PIECES.filter(p => !['ignore', 'ext'].includes(p[0])), r.types, 'rgT')}</div>` : '<div class="info">Un répéteur est proposé quand un matériel du niveau est plus loin de la centrale que la portée utile (réglée dans la liste des règles).</div>'}
      ${r.cible === 'acces' ? `<div class="field"><span>Seulement pour les accès d'une pièce de type (facultatif)</span>${chk(AS_PIECES.filter(p => !['ignore', 'ext'].includes(p[0])), r.dansPieces, 'rgD')}</div>` : ''}
      ${r.cible === 'piece' ? `<label class="chk"><input type="checkbox" id="rgFac" ${r.facade ? 'checked' : ''}> Seulement les pièces en façade</label>` : ''}
      <label class="chk"><input type="checkbox" id="rgRdc" ${r.rdc ? 'checked' : ''}> Seulement sur un niveau de plain-pied</label>
      <div class="row2"><label class="field"><span>Matériel proposé</span><select id="rgMat">${mats.map(t => `<option value="${t.id}" ${t.id === r.materiel ? 'selected' : ''}>${esc(t.nom)}</option>`).join('')}</select></label>
        <label class="field"><span>Niveau de protection</span><select id="rgProt"><option value="standard" ${r.protection !== 'renforce' ? 'selected' : ''}>Standard et renforcé</option><option value="renforce" ${r.protection === 'renforce' ? 'selected' : ''}>Renforcé seulement</option></select></label></div>
      ${r.placement === 'couverture' ? `<div class="row2"><label class="field"><span>Nombre maximum par pièce</span><input id="rgMax" type="number" min="1" max="10" value="${r.max || 1}"></label><label class="field"><span>Couverture visée (%)</span><input id="rgCov" type="number" min="0" max="100" step="5" value="${r.couverture ?? 60}"></label></div>` : ''}
      <label class="field"><span>Justification affichée</span><textarea id="rgWhy" rows="2">${esc(r.raison || '')}</textarea></label>`;
    $('#rgCible', root).onchange = (e) => { read(root); r.cible = e.target.value; r.types = []; form(root); };
    $('#rgPlace', root).onchange = (e) => { read(root); r.placement = e.target.value; if (asTypesKind(r) !== asTypesKind({ ...r, placement: r0.placement })) r.types = []; form(root); };
  };
  const read = (root) => {
    r.types = $$('.rgT:checked', root).map(x => x.value); r.dansPieces = $$('.rgD:checked', root).map(x => x.value);
    const f = $('#rgFac', root); r.facade = f ? f.checked : false; r.rdc = $('#rgRdc', root).checked;
    r.materiel = $('#rgMat', root).value; r.protection = $('#rgProt', root).value; r.raison = $('#rgWhy', root).value.trim();
    const mx = $('#rgMax', root); if (mx) { r.max = Math.max(1, +mx.value || 1); r.couverture = Math.min(100, Math.max(0, +$('#rgCov', root).value || 0)); }
  };
  return modal({ title: isNew ? 'Nouvelle règle' : 'Modifier la règle', size: 'md', body: '<div id="rgForm"></div>', onMount: form,
    left: isNew ? [] : [{ label: 'Supprimer', cls: 'danger', value: 'del' }],
    buttons: [{ label: 'Annuler', value: null }, { label: 'OK', cls: 'primary', action: (root) => { read(root); if (asTypesKind(r) && !r.types.length) { toast('Cochez au moins un type.', true); return false; } return r; } }] });
}
