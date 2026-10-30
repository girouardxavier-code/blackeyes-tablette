/* Simulation 3D — scénarios d'intrusion et de confinement sur le plan du projet
   - Le niveau courant devient une maquette 3D : sol = plan à l'échelle, murs déduits automatiquement
     des traits sombres du plan, matériels BLACKEYES posés à leurs repères avec leurs zones de détection.
   - Un individu vêtu de noir suit un parcours (départ + points de passage, ou parcours automatique).
   - Détecteurs : traversée d'une zone = détection ; MotionCam = série de photos rendues depuis le
     capteur ; la centrale et les sirènes clignotent.
   - lockOFF : la porte résiste aux tentatives d'effraction. Dans la salle, un occupant tire la
     languette rouge du blackOTUS, qui photographie la salle et ses occupants (sans le mis en cause).
   Le personnage suit des lignes droites entre les points : placez les points de passage par les portes. */
'use strict';

const SIM = { on: false };
const SIM_SCEN = {
  intrusion: { nom: 'Intrusion de nuit', desc: 'Un individu vêtu de noir pénètre dans le bâtiment, traverse les zones de détection puis prend la fuite.' },
  confinement: { nom: 'Intrusion et confinement', desc: 'Les occupants d\'une salle équipée d\'un lockOFF se confinent ; l\'individu tente de forcer la porte ; le blackOTUS photographie la salle.' },
  ronde: { nom: 'Ronde de test des détecteurs', desc: 'Parcours automatique devant chaque détecteur pour vérifier la couverture.' },
  libre: { nom: 'Parcours libre', desc: 'Vous tracez le parcours : toutes les règles s\'appliquent automatiquement.' }
};
const H_POSE = { fog: 2.3, pdc: 1.7, vpext: 3.6, vsint: 2.6, mcam: 2.3, mprot: 2.3, combi: 2.3, curt: 2.2, door: 2.05, doorplus: 2.05, hub: 1.6, rep: 2.2, siren: 2.5, ssiren: 2.6, push: 1.1, otus: 1.3, lock: 0.08, det: 2.5, sentinel: 3.2, lpr: 2.8, bridge: 2.4, bridgeio: 2.2, sirene: 2.6, clavier: 1.4 };
const role = (t) => {
  const id = t.id;
  if (id === 'lock') return 'lock';
  if (id === 'otus') return 'otus';
  if (['hub', 'bridge', 'bridgeio'].includes(id)) return 'hub';
  if (/siren|sirene/.test(id)) return 'siren';
  if (['door', 'doorplus'].includes(id)) return 'door';
  if (id === 'push') return 'push';
  if (id === 'fog') return 'fog';
  if (id === 'pdc') return 'pdc';
  if (id === 'rep') return 'rep';
  if (['mcam', 'det', 'sentinel', 'lpr'].includes(id)) return 'photo';
  if (t.sys === 'Vidéoprotection' || ['vpext', 'vsint'].includes(id)) return 'video';
  if (t.detRange) return 'motion';
  return 'autre';
};

/* ---------------------------------------------------------------- ouverture / fermeture */
async function openSim() {
  const l = level();
  if (!l) { toast('Ouvrez d\'abord un plan.', true); return; }
  if (isPhotoLv(l)) { toast('La simulation 3D nécessite un plan à l\'échelle (pas une photo).', true); return; }
  if (!l.scale) { toast('Définissez d\'abord l\'échelle du plan (bouton Échelle) : la maquette 3D est construite en mètres.', true); return; }
  if (typeof THREE === 'undefined') { toast('Moteur 3D indisponible.', true); return; }
  $('#simView').hidden = false; SIM.on = true;
  $('#sTitle').textContent = `Simulation 3D — ${S.project.site || S.project.name} · ${l.name}`;
  try { await buildScene(l); } catch (e) { console.error(e); toast('Construction 3D impossible : ' + e.message, true); closeSim(); return; }
  resetRun(); renderSimSide(); loop();
}
const isPhotoLv = (l) => !!l && l.kind === 'photo';
function closeSim() {
  SIM.on = false; $('#simView').hidden = true; stopSound();
  if (SIM.renderer) { SIM.renderer.dispose(); SIM.renderer.forceContextLoss && SIM.renderer.forceContextLoss(); $('#s3d').innerHTML = ''; }
  SIM.renderer = null; SIM.scene = null;
}

/* ---------------------------------------------------------------- construction de la scène */
async function buildScene(l) {
  const box = $('#s3d'); box.innerHTML = '';
  const W = box.clientWidth || 900, H = box.clientHeight || 600;
  const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); R.setSize(W, H); R.shadowMap.enabled = true; R.outputEncoding = THREE.sRGBEncoding;
  box.append(R.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1220); scene.fog = new THREE.Fog(0x0b1220, 60, 220);
  const sc = l.scale, Wm = l.plan.w / sc, Hm = l.plan.h / sc;
  Object.assign(SIM, { renderer: R, scene, l, sc, Wm, Hm, W, H, objs: [], markers: [], night: SIM.night ?? true, wallsOn: SIM.wallsOn ?? true, wallsBat: SIM.wallsBat ?? true, wallSens: SIM.wallSens ?? 0.5, zonesOn: SIM.zonesOn ?? true, speed: SIM.speed || 1, nOcc: SIM.nOcc || 3, scen: SIM.scen || 'confinement', sound: SIM.sound ?? true, mode: null, waypoints: SIM.waypoints && SIM.lvId === l.id ? SIM.waypoints : [], start: SIM.lvId === l.id ? SIM.start : null, photos: [], log: [] });
  SIM.lvId = l.id;
  // caméras
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 500); SIM.cam = cam;
  SIM.orbit = { tx: 0, tz: 0, ty: 0, dist: Math.max(Wm, Hm) * 0.85, theta: -Math.PI / 2.6, phi: 0.95 };
  SIM.camMode = 'orbit';
  // lumières
  SIM.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x30343c, 0.9); scene.add(SIM.hemi);
  SIM.sun = new THREE.DirectionalLight(0xffffff, 0.8); SIM.sun.position.set(-Wm * 0.3, 40, -Hm * 0.4); SIM.sun.castShadow = true;
  SIM.sun.shadow.mapSize.set(2048, 2048); const d = Math.max(Wm, Hm) * 0.7; Object.assign(SIM.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, far: 150 }); scene.add(SIM.sun);
  // sol : le plan
  const tex = await new Promise((res, rej) => new THREE.TextureLoader().load(l.plan.dataUrl, res, undefined, rej));
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = R.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wm, Hm), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); SIM.floor = floor;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Wm * 4, Hm * 4), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; scene.add(ground);
  // murs
  SIM.wallImg = await loadImg(l.plan.dataUrl);
  buildWalls();
  // architecture (portes, fenêtres, escaliers)
  buildArchi(); lockRooms();
  // matériels
  SIM.zones = new THREE.Group(); scene.add(SIM.zones); SIM.labels = new THREE.Group(); scene.add(SIM.labels);
  for (const m of l.markers) if (!isArch(m)) addDevice(m);
  // personnages
  SIM.intruder = makePerson({ intrus: true }); scene.add(SIM.intruder.g);
  SIM.pathLine = new THREE.Group(); scene.add(SIM.pathLine);
  applyAmbiance();
  // interactions
  bindSimInput(R.domElement);
  SIM.ro && SIM.ro.disconnect(); SIM.ro = new ResizeObserver(() => resizeSim()); SIM.ro.observe(box);
}
const P2W = (x, y) => new THREE.Vector3(x / SIM.sc - SIM.Wm / 2, 0, y / SIM.sc - SIM.Hm / 2);     // pixels du plan → monde (m)
const W2M = (v) => ({ x: (v.x + SIM.Wm / 2), y: (v.z + SIM.Hm / 2) });                          // monde → mètres « plan »
const dirOf = (deg) => new THREE.Vector3(Math.cos(deg * Math.PI / 180), 0, Math.sin(deg * Math.PI / 180));

function resizeSim() {
  if (!SIM.renderer) return; const box = $('#s3d'); const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
  SIM.renderer.setSize(W, H); SIM.cam.aspect = W / H; SIM.cam.updateProjectionMatrix();
}

/* murs : traits sombres du plan extrudés (approximation) */
function buildWalls() {
  if (SIM.walls) { SIM.scene.remove(SIM.walls); SIM.walls.geometry.dispose(); SIM.walls = null; }
  SIM.wgrid = null;
  if (!SIM.wallsOn) return;
  const cell = 0.15, gw = Math.ceil(SIM.Wm / cell), gh = Math.ceil(SIM.Hm / cell), k = Math.max(2, Math.min(8, Math.round(cell * SIM.sc)));
  const c = document.createElement('canvas'); c.width = gw * k; c.height = gh * k;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(SIM.wallImg, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const lumMax = 100 + SIM.wallSens * 20, lumGris = 170 + SIM.wallSens * 30, need = Math.max(1, Math.round(k * k * (0.22 - SIM.wallSens * 0.16)));
  // 1. pixels de mur : sombres (noir, rouge, magenta, bleu foncé…) ou gris (murs pochés) ; le blanc et les aplats
  //    clairs des pièces (vert, jaune, cyan…) n'en sont pas
  const CW = c.width, CH = c.height, N = CW * CH; let dark = new Uint8Array(N), thick = null;
  const lumD = 110 + SIM.wallSens * 30, lumG = 200 + SIM.wallSens * 30;
  for (let i = 0, o = 0; i < N; i++, o += 4) { const r = px[o], gg = px[o + 1], b = px[o + 2];
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    if (lum < lumD || (sat < 40 && lum < lumG)) dark[i] = 1; }
  if (SIM.wallsBat !== false) {
    // 2. fermeture : deux traits parallèles proches (cloison dessinée en double trait) deviennent un mur plein
    // 3. ouverture : les traits restés fins (textes, cotes, arcs de portes, hachures, cadres) disparaissent
    const pxm = k / cell;                                   // pixels par mètre dans ce calque
    const rc = Math.max(1, Math.min(6, Math.round(0.06 * pxm))), ro = Math.max(1, Math.min(4, Math.round(0.025 * pxm))), rt = Math.max(1, Math.min(4, Math.floor(0.045 * pxm)));
    const box = (m, r, full) => {                           // dilatation (full=false) ou érosion (full=true) carrée, par somme glissante
      const W = CW, H = CH, I = new Int32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { run += m[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + run; } }
      const out = new Uint8Array(N), need2 = (2 * r + 1) * (2 * r + 1);
      for (let y = 0; y < H; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1); for (let x = 0; x < W; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        out[y * W + x] = full ? (sum >= (y1 - y0) * (x1 - x0) && (y1 - y0) * (x1 - x0) === need2 ? 1 : 0) : (sum > 0 ? 1 : 0); } }
      return out;
    };
    thick = box(box(dark, rt, true), rt, false);            // traits épais d'origine (murs pleins), avant fermeture
    const closed = box(box(dark, rc, false), rc, true);
    const opened = box(box(closed, ro, true), ro, false);
    let nd = 0, no = 0; for (let i = 0; i < N; i++) { nd += dark[i]; no += opened[i]; }
    if (no >= nd * 0.25) dark = opened;                    // plan entièrement au trait fin : on garde tout
  }
  const grid = new Uint8Array(gw * gh), fill = new Float32Array(gw * gh), thk = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let n = 0; for (let j = 0; j < k; j++) { const row = (y * k + j) * CW + x * k; for (let i = 0; i < k; i++) n += dark[row + i]; }
    fill[y * gw + x] = n / (k * k); if (n >= need) grid[y * gw + x] = 1;
    if (thick) { let t = 0; for (let j = 0; j < k; j++) { const row = (y * k + j) * CW + x * k; for (let i = 0; i < k; i++) t += thick[row + i]; } thk[y * gw + x] = t / Math.max(1, n); }
  }
  // nettoyage : cellules isolées (texte, hachures fines) supprimées
  const cl = new Uint8Array(grid);
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) if (grid[y * gw + x]) {
    let nb = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && grid[(y + j) * gw + x + i]) nb++;
    if (nb < 2) cl[y * gw + x] = 0;
  }
  // 2. seulement les murs du bâtiment : ensembles de murs proches les uns des autres ; le plus grand est le bâtiment.
  //    Sont écartés les éléments hors de son emprise (cartouche, légende, cotes, nord, textes extérieurs)
  //    et les petits éléments isolés à l'intérieur (textes des pièces, mobilier).
  SIM.wallsOut = 0;
  if (SIM.wallsBat !== false) {
    const lab = new Int32Array(gw * gh), comps = [null]; const st = []; const LR = 2;
    for (let s = 0; s < gw * gh; s++) {
      if (!cl[s] || lab[s]) continue; const id = comps.length; const cp = { n: 0, f: 0, t: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; comps.push(cp);
      lab[s] = id; st.push(s);
      while (st.length) { const i = st.pop(); const x = i % gw, y = (i - x) / gw; cp.n++; cp.f += fill[i]; cp.t += thk[i]; if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
        for (let j = -LR; j <= LR; j++) for (let ii = -LR; ii <= LR; ii++) { const xx = x + ii, yy = y + j; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const q = yy * gw + xx; if (cl[q] && !lab[q]) { lab[q] = id; st.push(q); } } }
    }
    let max = 0; for (let i = 1; i < comps.length; i++) max = Math.max(max, comps[i].n);
    if (max) {
      // emprise du bâtiment : réunion des grands ensembles de murs (séparés entre eux par les portes et fenêtres)
      const dens = (cp) => cp.n / ((cp.x1 - cp.x0 + 1) * (cp.y1 - cp.y0 + 1));
      const frame = (cp) => (cp.x1 - cp.x0) > gw * 0.8 && (cp.y1 - cp.y0) > gh * 0.8 && dens(cp) < 0.06;   // cadre de la planche
      comps.forEach(cp => { if (cp && frame(cp)) cp.frame = true; });
      max = 0; for (let i = 1; i < comps.length; i++) if (!comps[i].frame) max = Math.max(max, comps[i].n);
      const big = comps.map(cp => !!cp && !cp.frame && cp.n >= max * 0.15 && Math.max(cp.x1 - cp.x0, cp.y1 - cp.y0) * cell >= 2 && dens(cp) >= 0.03);
      // regroupement : murs distants de moins de 1,8 m (portes, fenêtres) = même bâtiment ; titres, légendes, logos
      // et cartouches sont plus loin et forment des groupes à part
      const grp = new Int32Array(gw * gh), gsz = [0]; const LR2 = Math.max(3, Math.round(0.9 / cell));
      for (let s0 = 0; s0 < gw * gh; s0++) {
        if (!cl[s0] || grp[s0] || comps[lab[s0]].frame) continue; const id = gsz.length; gsz.push(0); grp[s0] = id; st.push(s0);
        while (st.length) { const i = st.pop(); gsz[id]++; const x = i % gw, y = (i - x) / gw;
          for (let j = -LR2; j <= LR2; j++) for (let ii = -LR2; ii <= LR2; ii++) { const xx = x + ii, yy = y + j; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const q = yy * gw + xx; if (cl[q] && !grp[q] && !comps[lab[q]].frame) { grp[q] = id; st.push(q); } } }
      }
      let gmax = 0; for (let g = 1; g < gsz.length; g++) gmax = Math.max(gmax, gsz[g]);
      const compGrp = comps.map(() => 0); for (let i = 0; i < gw * gh; i++) if (cl[i] && grp[i]) compGrp[lab[i]] = grp[i];
      const gbb = gsz.map(() => [1e9, 1e9, -1, -1]); for (let i = 0; i < gw * gh; i++) if (grp[i]) { const b = gbb[grp[i]], x = i % gw, y = (i - x) / gw; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
      // groupes « structurels » : contiennent un pan de mur rectiligne d'au moins 3 m (un texte, un logo, une légende n'en ont pas)
      const RUN = Math.ceil(3 / cell), struct = new Uint8Array(gsz.length);
      for (let y = 0; y < gh; y++) { let run = 0, g = 0; for (let x = 0; x < gw; x++) { const q = grp[y * gw + x]; if (q && q === g) run++; else { run = q ? 1 : 0; g = q; } if (run >= RUN) struct[q] = 1; } }
      for (let x = 0; x < gw; x++) { let run = 0, g = 0; for (let y = 0; y < gh; y++) { const q = grp[y * gw + x]; if (q && q === g) run++; else { run = q ? 1 : 0; g = q; } if (run >= RUN) struct[q] = 1; } }
      // emprise du bâtiment : réunion des groupes structurels (le plus grand d'abord ; les autres seulement s'ils en sont proches)
      let g0 = 0; for (let g = 1; g < gsz.length; g++) if (struct[g] && (!g0 || gsz[g] > gsz[g0])) g0 = g;
      const M = Math.round(0.5 / cell), near = Math.round(1 / cell);
      const B = g0 ? gbb[g0].slice() : [0, 0, gw - 1, gh - 1];
      for (let changed = true; changed;) { changed = false;
        for (let g = 1; g < gsz.length; g++) { if (!struct[g] || g === g0) continue; const b = gbb[g];
          const inside = b[0] >= B[0] - M && b[1] >= B[1] - M && b[2] <= B[2] + M && b[3] <= B[3] + M; if (inside) continue;
          const close = !(b[0] > B[2] + near || b[2] < B[0] - near || b[1] > B[3] + near || b[3] < B[1] - near);
          if (close) { B[0] = Math.min(B[0], b[0]); B[1] = Math.min(B[1], b[1]); B[2] = Math.max(B[2], b[2]); B[3] = Math.max(B[3], b[3]); changed = true; } } }
      const okGrp = (g) => g > 0 && gbb[g][0] >= B[0] - M && gbb[g][1] >= B[1] - M && gbb[g][2] <= B[2] + M && gbb[g][3] <= B[3] + M;
      const keep = comps.map((cp, i) => {
        if (!cp || cp.frame || !okGrp(compGrp[i])) return false;
        if (big[i]) return true;
        const wx = (cp.x1 - cp.x0 + 1) * cell, wy = (cp.y1 - cp.y0 + 1) * cell, ext = Math.max(wx, wy);
        const area = (cp.x1 - cp.x0 + 1) * (cp.y1 - cp.y0 + 1);
        if (ext >= 1.2 && Math.min(wx, wy) >= 0.9) {                                // petit local fermé (gaine, ascenseur, placard) : contour continu
          let per = 0, on = 0; const L = cp.x0, T = cp.y0, R = cp.x1, Bo = cp.y1;
          for (let x = L; x <= R; x++) for (const y of [T, Bo]) { per++; let hit = 0; for (let t = 0; t <= 1; t++) { const yy = y === T ? y + t : y - t; if (lab[yy * gw + x] === i) hit = 1; } on += hit; }
          for (let y = T + 1; y < Bo; y++) for (const x of [L, R]) { per++; let hit = 0; for (let t = 0; t <= 1; t++) { const xx = x === L ? x + t : x - t; if (lab[y * gw + xx] === i) hit = 1; } on += hit; }
          if (on / per >= 0.75) return true;
        }
        if (cp.f / cp.n < 0.42) return false;                                       // texte : ne noircit qu'une partie des cases
        if (ext >= 3) return true;                                                  // pan de mur isolé
        // amorce de mur, trumeau, poteau : dessiné en trait épais à l'origine (les lettres d'un texte sont en traits fins)
        if (ext >= 0.4 && (!thick || cp.t / cp.n >= 0.6) && cp.n / area >= 0.5) return true;
        return false;                                                               // nom de pièce, mobilier, symbole
      });
      for (let i = 0; i < gw * gh; i++) if (cl[i] && !keep[lab[i]]) { cl[i] = 0; SIM.wallsOut++; }
    }
  }
  // zones sélectionnées : rien n'est monté en dehors
  const zs = (SIM.l.zones || []).map(z => ({ x0: Math.floor(z.x / SIM.sc / cell), y0: Math.floor(z.y / SIM.sc / cell), x1: Math.ceil((z.x + z.w) / SIM.sc / cell), y1: Math.ceil((z.y + z.h) / SIM.sc / cell) }));
  if (zs.length) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; if (cl[i] && !zs.some(z => x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1)) cl[i] = 0; }
  // portes et fenêtres posées : le mur est remplacé par l'ouvrant
  // murs effacés à la main (outil « Effacer un mur »)
  for (const e of SIM.l.effacements || []) {
    const x0 = Math.floor(e.x / SIM.sc / cell), y0 = Math.floor(e.y / SIM.sc / cell), x1 = Math.ceil((e.x + e.w) / SIM.sc / cell), y1 = Math.ceil((e.y + e.h) / SIM.sc / cell);
    for (let y = Math.max(0, y0); y < Math.min(gh, y1); y++) for (let x = Math.max(0, x0); x < Math.min(gw, x1); x++) cl[y * gw + x] = 0;
  }
  SIM.wgrid = { bar: cl.slice(), gw, gh, cell };
  stampBarriers(SIM.wgrid);
  for (const a of (SIM.l.markers || []).filter(m => /^arch-(porte|entree|vitree|double|fenetre)$/.test(m.typeId))) {
    const c0 = { x: a.x / SIM.sc, y: a.y / SIM.sc }, r = (a.rot || 0) * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
    const hw = (a.w || 0.9) / 2, hd = 0.45;
    const x0 = Math.floor((c0.x - hw - hd) / cell), x1 = Math.ceil((c0.x + hw + hd) / cell), y0 = Math.floor((c0.y - hw - hd) / cell), y1 = Math.ceil((c0.y + hw + hd) / cell);
    for (let y = Math.max(0, y0); y <= Math.min(gh - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(gw - 1, x1); x++) {
      const dx = (x + 0.5) * cell - c0.x, dy = (y + 0.5) * cell - c0.y; const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
      if (Math.abs(along) <= hw && Math.abs(across) <= hd) cl[y * gw + x] = 0;
    }
  }
  // fusion par segments horizontaux
  const runs = [];
  for (let y = 0; y < gh; y++) { let x = 0; while (x < gw) { if (cl[y * gw + x]) { let x2 = x; while (x2 + 1 < gw && cl[y * gw + x2 + 1]) x2++; runs.push([x, x2, y]); x = x2 + 1; } else x++; } }
  const hW = 2.5;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.85, transparent: true, opacity: 0.93 }), Math.max(1, runs.length));
  const mtx = new THREE.Matrix4();
  runs.forEach(([x1, x2, y], i) => {
    const w = (x2 - x1 + 1) * cell, cx = (x1 * cell + w / 2) - SIM.Wm / 2, cz = (y * cell + cell / 2) - SIM.Hm / 2;
    mtx.compose(new THREE.Vector3(cx, hW / 2, cz), new THREE.Quaternion(), new THREE.Vector3(w, hW, cell)); mesh.setMatrixAt(i, mtx);
  });
  SIM.wallBoxes = runs.map(([x1, x2, y]) => { const w = (x2 - x1 + 1) * cell, cx = (x1 * cell + w / 2) - SIM.Wm / 2, cz = (y * cell + cell / 2) - SIM.Hm / 2; return [cx - w / 2, cx + w / 2, cz - cell / 2, cz + cell / 2]; });
  mesh.count = runs.length; mesh.castShadow = true; mesh.receiveShadow = true;
  SIM.walls = mesh; SIM.scene.add(mesh); SIM.wallCount = runs.length;
  // murs ajoutés à la main (outil « Ajouter un mur »)
  if (SIM.wallsAdd) { SIM.scene.remove(SIM.wallsAdd); SIM.wallsAdd = null; }
  const zsA = SIM.l.zones || []; const inZA = (x, y) => !zsA.length || zsA.some(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
  const add = (SIM.l.murs || []).filter(w => inZA((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2));
  if (add.length) {
    const G = new THREE.Group(); const matW = mesh.material;
    for (const w of add) { const a = P2W(w.x1, w.y1), b = P2W(w.x2, w.y2); const L = a.distanceTo(b); if (L < 0.05) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, hW, w.ep || 0.2), matW); m.position.set((a.x + b.x) / 2, hW / 2, (a.z + b.z) / 2); m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); m.castShadow = m.receiveShadow = true; G.add(m);
      SIM.wallBoxes.push([Math.min(a.x, b.x) - 0.1, Math.max(a.x, b.x) + 0.1, Math.min(a.z, b.z) - 0.1, Math.max(a.z, b.z) + 0.1]); }
    SIM.wallsAdd = G; SIM.scene.add(G); SIM.wallCount += add.length;
  }
}

/* matériel 3D */
function textSprite(txt, color = '#1d4fb8') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.roundRect(8, 16, 240, 64, 14); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 40px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 50);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sp.scale.set(0.9, 0.34, 1); sp.renderOrder = 10; return sp;
}
function addDevice(m) {
  const t = typeOf(m.typeId); const r = role(t); const col = new THREE.Color(t.couleur || '#64748b');
  const p = P2W(m.x, m.y); const h = H_POSE[t.id] ?? 1.8; const dir = dirOf(m.rot || 0);
  const g = new THREE.Group(); g.position.set(p.x, h, p.z); g.rotation.y = -(m.rot || 0) * Math.PI / 180;
  const dev = { m, t, role: r, g, pos: p.clone(), h, dir, fired: false };
  const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.1, emissive: c, emissiveIntensity: e });
  if (r === 'lock') {
    // porte + barre lockOFF (côté intérieur = sens de l'orientation)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.95), mat(0x8b6a43)); door.position.set(-0.05, 1.05 - h, 0); door.castShadow = true;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 1.1), new THREE.MeshStandardMaterial({ color: 0x5b6472, transparent: true, opacity: 0.35 })); frame.position.set(-0.05, 1.1 - h, 0);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.12), mat(0xb8c0cc)); bar.position.set(0.28, 0.0, 0); bar.rotation.z = -0.35; bar.castShadow = true;
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.05), mat(0xdc2626, 0.3)); tag.position.set(-0.12, -0.06, 0); // languette visible sous la porte
    g.add(frame, door, bar, tag); dev.door = door; dev.bar = bar; dev.inside = dir.clone();
  } else if (r === 'otus') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07), mat(0x1f2329)); body.castShadow = true;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), mat(0x0a0a0a, 0.1)); lens.position.set(0.037, 0.03, 0);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.11, 0.035), mat(0xdc2626, 0.25)); tab.position.set(0.04, -0.02, 0);
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, h, 6), mat(0x374151)); tri.position.y = -h / 2;
    g.add(body, lens, tab, tri); dev.tab = tab; dev.lens = lens;
  } else if (r === 'pdc') {
    pdcPlaque(dev, t);
  } else if (r === 'fog') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.42), mat(0x1f2937)); body.castShadow = true;
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.08, 16), mat(0x9ca3af)); noz.rotation.z = Math.PI / 2; noz.position.set(0.12, 0.02, 0);
    const acc = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.03, 0.425), mat(col, 0.35)); acc.position.y = 0.08;
    g.add(body, noz, acc); dev.acc = acc;
  } else {
    const size = r === 'hub' ? [0.16, 0.16, 0.04] : r === 'siren' ? [0.2, 0.2, 0.06] : r === 'push' ? [0.06, 0.05, 0.06] : r === 'door' ? [0.03, 0.09, 0.02] : [0.07, 0.11, 0.06];
    const body = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(r === 'push' ? 0x111111 : 0xf3f4f6)); body.castShadow = true;
    const acc = new THREE.Mesh(new THREE.BoxGeometry(size[0] * 1.02, size[1] * 0.18, size[2] * 1.02), mat(col, 0.35)); acc.position.y = size[1] * 0.25;
    g.add(body, acc); dev.acc = acc;
    if (r === 'rep') { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), mat(0x111827)); ant.position.set(0, size[1] / 2 + 0.08, 0); g.add(ant); }
    if (r === 'push') { const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), mat(0xdc2626, 0.2)); btn.position.y = 0.04; g.add(btn); dev.btn = btn; }
    if (r === 'hub' || r === 'siren') { const led = new THREE.PointLight(0xff2020, 0, 6); led.position.set(0.15, 0, 0); g.add(led); dev.light = led; }
    if (r === 'photo' || r === 'otus' || r === 'video') { const lens = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), mat(0x111111)); lens.position.set(size[0] / 2, 0, 0); g.add(lens); }
  }
  // image du matériel (photo du produit) à l'emplacement de pose, toujours tournée vers la caméra
  if (t.img && r !== 'pdc' && SIM.imgOn !== false) {
    const tex = matTexture(t);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: true }));
    const big = r === 'hub' || r === 'siren' || r === 'fog' || r === 'video' ? 0.75 : r === 'lock' ? 0.6 : 0.6;   // agrandies pour rester lisibles
    sp.scale.set(big, big, 1); sp.position.set(0, r === 'lock' ? 1.2 : 0.02, 0); sp.renderOrder = 4; sp.userData.devImg = true;
    // socle coloré à la couleur du matériel (clignote à la détection)
    g.add(sp); dev.sprite = sp;
    if (dev.acc && !['lock', 'otus'].includes(r)) { dev.g.children.forEach(ch => { if (ch !== dev.acc && ch.isMesh && ch.geometry && ch.geometry.type === 'BoxGeometry') ch.visible = false; }); dev.acc.scale.set(1.6, 0.5, 1.6); dev.acc.position.y = -big / 2 - 0.02; }
  }
  if (r === 'photo' || r === 'otus') { const fl = new THREE.PointLight(0xffffff, 0, 9); fl.position.set(0.3, 0, 0); g.add(fl); dev.flash = fl; }
  SIM.scene.add(g); SIM.markers.push(dev);
  const lab = textSprite(m.label || t.code, t.couleur || '#1d4fb8'); lab.position.set(p.x, Math.max(h, 0.3) + 0.45, p.z); SIM.labels.add(lab);
  // zone au sol
  const z = zoneMesh(m, t, p); if (z) { SIM.zones.add(z); dev.zoneMesh = z; }
}
function zoneMesh(m, t, p) {
  const range = m.range ?? t.detRange; if (!range || m.showZone === false) return null;
  const k = zoneKind(m); const col = new THREE.Color(t.couleur); const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  let geo;
  if (k === 'faisceau') { geo = new THREE.PlaneGeometry(range, 0.35); geo.translate(range / 2, 0, 0); }
  else if (k === 'profil' && typeof profilLocal === 'function') { const pts = profilLocal(m).map(([x, y]) => new THREE.Vector2(x, -y)); geo = new THREE.ShapeGeometry(new THREE.Shape(pts)); }
  else { const ang = m.angle ?? t.detAngle; const a = ang && ang < 360 ? ang * Math.PI / 180 : Math.PI * 2; geo = new THREE.CircleGeometry(range, 48, -a / 2, a); }
  const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = -(m.rot || 0) * Math.PI / 180 * (k === 'cercle' ? 0 : 1);
  if (k === 'profil') mesh.rotation.z = -(m.rot || 0) * Math.PI / 180;
  mesh.position.set(p.x, 0.03, p.z); mesh.renderOrder = 2; return mesh;
}

/* textures des photos de matériels (une par type) */
const MAT_TEX = new Map();
function matTexture(t) {
  if (MAT_TEX.has(t.id)) return MAT_TEX.get(t.id);
  const tex = new THREE.TextureLoader().load(t.img); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; MAT_TEX.set(t.id, tex); return tex;
}
/* ---------------------------------------------------------------- spécificités des matériels dans la simulation */
/* texte de détection propre à chaque matériel */
function detText(d) {
  const where = `${d.m.label}${d.m.local ? ` (${d.m.local})` : ''}`;
  switch (d.t.id) {
    case 'mcam': return `MotionCam ${where} : mouvement détecté (infrarouge passif), série de photos de levée de doute.`;
    case 'mprot': return `MotionProtect ${where} : mouvement détecté (infrarouge passif, sans photo).`;
    case 'combi': return `CombiProtect ${where} : mouvement détecté ; la surveillance du bris de vitre reste active.`;
    case 'curt': return `Curtain ${where} : franchissement du faisceau laser.`;
    case 'door': return `DoorProtect ${where} : ouverture de la porte détectée.`;
    case 'doorplus': return `DoorProtect Plus ${where} : ouverture de la porte détectée (capteur d'inclinaison et de choc actifs).`;
    default: return `Détection — ${d.t.nom} ${where}.`;
  }
}
/* liaison radio du matériel vers la centrale, par le répéteur le plus utile s'il y en a un */
function radioRoute(d) {
  const hubs = SIM.markers.filter(x => x.role === 'hub'); if (!hubs.length || d.role === 'hub') return null;
  const hub = hubs.sort((a, b) => a.pos.distanceTo(d.pos) - b.pos.distanceTo(d.pos))[0];
  const reps = SIM.markers.filter(x => x.role === 'rep');
  const direct = d.pos.distanceTo(hub.pos);
  const rep = reps.filter(r => r.pos.distanceTo(d.pos) < direct && r.pos.distanceTo(hub.pos) < direct).sort((a, b) => a.pos.distanceTo(d.pos) - b.pos.distanceTo(d.pos))[0];
  return rep && direct > 20 ? [d, rep, hub] : [d, hub];
}
function radioLink(d) {
  const r = radioRoute(d); if (!r) return;
  const pts = r.map(x => x.g.getWorldPosition(new THREE.Vector3()));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.95 }));
  line.computeLineDistances(); SIM.scene.add(line);
  r.slice(1).forEach(x => { if (x.acc) { x.acc.material.emissive.set(0x38bdf8); x.acc.material.emissiveIntensity = 2.5; } });
  let t = 0; const iv = setInterval(() => { t += 0.05; line.material.opacity = Math.max(0, 0.95 - t * 0.6); if (t >= 1.6 || !SIM.on) { clearInterval(iv); SIM.scene.remove(line); geo.dispose(); r.slice(1).forEach(x => { if (x.acc && !x.blink) { x.acc.material.emissive.set(new THREE.Color(x.t.couleur || '#64748b')); x.acc.material.emissiveIntensity = 0.35; } }); } }, 50);
  if (r.length === 3 && !d.relayLogged) { d.relayLogged = true; logEv(`Signal de ${d.m.label} relayé par le répéteur ${r[1].m.label} jusqu'à la centrale ${r[2].m.label}.`, 'info'); }
}
/* générateur de brouillard : à l'alarme, le volume protégé se remplit d'un brouillard opaque */
function startFog() {
  SIM.fogs = SIM.fogs || [];
  for (const d of SIM.markers.filter(x => x.role === "fog")) {
    const range = d.m.range ?? d.t.detRange ?? 8, R = Math.max(2.5, range * 0.6);
    const c = d.pos.clone().setY(0).add(d.dir.clone().multiplyScalar(R * 0.8)).setY(1.2);
    const g = new THREE.Group(); g.position.copy(c); SIM.scene.add(g);
    // nappes de brouillard : vignettes douces (dégradé radial) qui se superposent
    if (!SIM.fogTex) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(240,242,245,1)'); gr.addColorStop(0.45, 'rgba(232,235,240,0.55)'); gr.addColorStop(1, 'rgba(225,228,234,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); SIM.fogTex = new THREE.CanvasTexture(cv); }
    const mat = new THREE.SpriteMaterial({ map: SIM.fogTex, transparent: true, opacity: 0.0, depthWrite: false });
    for (let i = 0; i < 70; i++) { const sp = new THREE.Sprite(mat); const sz = 1.8 + Math.random() * 2.2; sp.scale.set(sz, sz, 1); sp.position.set((Math.random() - 0.5) * 2 * R, Math.random() * 2.2 - 0.9, (Math.random() - 0.5) * 2 * R); g.add(sp); }
    g.scale.setScalar(0.05);
    SIM.fogs.push({ d, g, mat, c: c.clone().setY(0), R, t: 0 });
    logEv(`Générateur de brouillard ${d.m.label}${d.m.local ? ` (${d.m.local})` : ''} : brouillard opaque diffusé ; la pièce devient invisible en quelques secondes.`, 'alarm');
  }
}
function animFog(dt) {
  for (const f of SIM.fogs || []) {
    f.t += dt; const k = Math.min(1, f.t / 4); f.g.scale.setScalar(0.05 + k * 0.95); f.mat.opacity = 0.5 * k;
    f.g.children.forEach((s, i) => { s.position.y += Math.sin(SIM.t * 0.7 + i) * 0.002; });
    const I = SIM.intruder;
    if (k > 0.6 && !f.blinded && SIM.state === 'walk' && I.g.visible && I.g.position.distanceTo(f.c) < f.R) {
      f.blinded = true; logEv(`L'individu, aveuglé par le brouillard de ${f.d.m.label}, renonce et prend la fuite.`, 'ok');
      SIM.path = [I.g.position.clone(), ...(SIM.path.slice(0, SIM.seg + 1).reverse())]; SIM.seg = 0; SIM.segT = 0; SIM.state = 'flee'; drawPath();
    }
  }
}
function clearFogs() { (SIM.fogs || []).forEach(f => SIM.scene.remove(f.g)); SIM.fogs = []; }
/* pictogramme de pièce de confinement : plaque au mur, éclairée en vert */
function pdcPlaque(dev, t) {
  const g = dev.g; const tex = t.img ? new THREE.TextureLoader().load(t.img) : null; if (tex) tex.encoding = THREE.sRGBEncoding;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x334155, emissive: 0x1f6f3a, emissiveIntensity: 0.15, side: THREE.DoubleSide }));
  plate.rotation.y = -Math.PI / 2; plate.position.x = 0.02; g.add(plate);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.46, 0.46), new THREE.MeshStandardMaterial({ color: 0x111827 })); g.add(back);
  const led = new THREE.PointLight(0x22c55e, 0.6, 3); led.position.set(0.25, 0, 0); g.add(led); dev.light2 = led;
}

/* ---------------------------------------------------------------- architecture : portes, fenêtres, escaliers */
/* isArch() : défini dans app.js */
function buildArchi() {
  if (SIM.archi) { SIM.scene.remove(SIM.archi); SIM.archi = null; }
  const G = new THREE.Group(); SIM.archi = G; SIM.doors = [];
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o });
  const hW = 2.5, T = 0.2;
  const zs = SIM.l.zones || []; const inZ = (a) => !zs.length || zs.some(z => a.x >= z.x && a.x <= z.x + z.w && a.y >= z.y && a.y <= z.y + z.h);
  for (const a of SIM.l.markers.filter(m => isArch(m) && inZ(m))) {
    const p = P2W(a.x, a.y); const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -(a.rot || 0) * Math.PI / 180; G.add(g);
    const DOORW = { 'arch-porte': 0.9, 'arch-entree': 1.0, 'arch-vitree': 0.9, 'arch-double': 1.6 };
    const w = a.w || DOORW[a.typeId] || 1.2;
    const box = (sx, sy, sz, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    if (DOORW[a.typeId] && a.typeId !== 'arch-porte') {
      const ent = a.typeId === 'arch-entree', vit = a.typeId === 'arch-vitree', dbl = a.typeId === 'arch-double';
      const frame = M(ent ? 0x1f2937 : vit ? 0x9ca3af : 0x6b7280), fw = ent ? 0.1 : 0.06;
      box(fw, 2.15, T + (ent ? 0.06 : 0), frame, -w / 2 - fw / 2, 1.075, 0); box(fw, 2.15, T + (ent ? 0.06 : 0), frame, w / 2 + fw / 2, 1.075, 0);
      box(w + 2 * fw, hW - 2.15, T, M(0xe9edf3, { transparent: true, opacity: 0.93 }), 0, 2.15 + (hW - 2.15) / 2, 0);   // imposte
      if (ent) box(w + 2 * fw + 0.2, 0.06, 0.6, M(0x334155), 0, 2.32, -0.25 * ((a.sens === -1) ? -1 : 1));               // auvent côté extérieur
      const sens = a.sens === -1 ? -1 : 1; const hinges = [];
      const mkLeaf = (hx, side, lw) => {
        const hinge = new THREE.Group(); hinge.position.set(hx, 0, 0); g.add(hinge);
        if (vit) {
          const al = M(0xcbd5e1, { metalness: 0.5, roughness: 0.4 }); const bar = (sx, sy, x, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.05), al); b.position.set(x, y, 0); b.castShadow = true; hinge.add(b); };
          bar(lw - 0.02, 0.06, side * (lw - 0.02) / 2, 0.03); bar(lw - 0.02, 0.06, side * (lw - 0.02) / 2, 2.03); bar(0.06, 2.06, side * 0.03, 1.03); bar(0.06, 2.06, side * (lw - 0.05), 1.03);
          const gl = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.14, 1.94, 0.015), new THREE.MeshStandardMaterial({ color: 0x9cc9e8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false }));
          gl.position.set(side * (lw - 0.02) / 2, 1.03, 0); gl.renderOrder = 3; hinge.add(gl);
        } else {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.02, 2.1, ent ? 0.07 : 0.045), M(ent ? 0x374151 : 0x9a7148, ent ? { metalness: 0.3 } : {})); leaf.position.set(side * (lw - 0.02) / 2, 1.05, 0); leaf.castShadow = true; hinge.add(leaf);
          if (ent) { const ocu = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.075), new THREE.MeshStandardMaterial({ color: 0x9cc9e8, transparent: true, opacity: 0.5 })); ocu.position.set(side * (lw / 2), 1.55, 0); hinge.add(ocu); }
        }
        const knob = new THREE.Mesh(ent ? new THREE.BoxGeometry(0.03, 0.4, 0.04) : new THREE.SphereGeometry(0.03, 10, 8), M(0xd1d5db, { metalness: 0.7 })); knob.position.set(side * (lw - 0.1), 1.0, 0.06); hinge.add(knob);
        hinges.push({ hinge, side });
      };
      if (dbl) { mkLeaf(-w / 2, 1, w / 2); mkLeaf(w / 2, -1, w / 2); } else { const side = a.flip ? -1 : 1; mkLeaf(-side * w / 2, side, w); }
      SIM.doors.push({ a, hinges, pos: p.clone(), open: 0, sens });
    } else if (a.typeId === 'arch-porte') {
      const frame = M(0x6b7280); box(0.06, 2.1, T, frame, -w / 2 - 0.03, 1.05, 0); box(0.06, 2.1, T, frame, w / 2 + 0.03, 1.05, 0);
      box(w + 0.12, hW - 2.1, T, M(0xe9edf3, { transparent: true, opacity: 0.93 }), 0, 2.1 + (hW - 2.1) / 2, 0);   // imposte
      const side = a.flip ? -1 : 1; const hinge = new THREE.Group(); hinge.position.set(-side * w / 2, 0, 0); g.add(hinge);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 2.06, 0.045), M(0x9a7148)); leaf.position.set(side * (w - 0.02) / 2, 1.03, 0); leaf.castShadow = true; hinge.add(leaf);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M(0xd1d5db, { metalness: 0.6 })); knob.position.set(side * (w - 0.12), 1.0, 0.05); hinge.add(knob);
      SIM.doors.push({ a, hinge, pos: p.clone(), open: 0, side, sens: a.sens === -1 ? -1 : 1 });
    } else if (a.typeId === 'arch-fenetre') {
      const allege = a.allege ?? 0.9, haut = Math.min(a.hauteur ?? 1.25, hW - allege - 0.1);
      const wall = M(0xe9edf3, { transparent: true, opacity: 0.93 });
      box(w, allege, T, wall, 0, allege / 2, 0);                                        // allège
      const top = allege + haut; box(w, hW - top, T, wall, 0, top + (hW - top) / 2, 0);  // linteau
      const fr = M(0xf8fafc); box(w, 0.05, T * 0.6, fr, 0, allege + 0.025, 0); box(w, 0.05, T * 0.6, fr, 0, top - 0.025, 0);
      box(0.05, haut, T * 0.6, fr, -w / 2 + 0.025, allege + haut / 2, 0); box(0.05, haut, T * 0.6, fr, w / 2 - 0.025, allege + haut / 2, 0);
      if (w > 1) box(0.04, haut, T * 0.5, fr, 0, allege + haut / 2, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, haut - 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x9cc9e8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false }));
      glass.position.set(0, allege + haut / 2, 0); glass.renderOrder = 3; g.add(glass);
    } else if (a.typeId === 'arch-escalier') {
      // marches montant dans le sens de la flèche ; longueur = a.d (m), largeur = a.w (m)
      const L = a.d || 3.6, nb = Math.max(4, Math.round(L / 0.28)), hm = Math.min(2.5, nb * 0.17), rise = hm / nb, run = L / nb;
      const st = M(0xcbd5e1), nose = M(0x94a3b8);
      for (let i = 0; i < nb; i++) { const sy = rise * (i + 1); box(run, sy, w, st, -L / 2 + run * (i + 0.5), sy / 2, 0); box(0.03, 0.02, w, nose, -L / 2 + run * (i + 1) - 0.015, sy + 0.01, 0); }
      const rail = M(0x475569); const len = Math.hypot(L, hm), ang = Math.atan2(hm, L);
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), rail); r.position.set(0, hm / 2 + 0.95, w / 2 - 0.03); r.rotation.z = ang; g.add(r);
      for (let i = 0; i <= 4; i++) { const x = -L / 2 + L * i / 4, y = hm * i / 4; box(0.03, 0.95, 0.03, rail, x, y + 0.475, w / 2 - 0.03); }
    }
  }
  SIM.scene.add(G);
}
/* --- pièces équipées d'un lockOFF : leurs portes restent fermées --- */
// trace un segment (mètres « plan ») comme cloison dans la grille
function stampSeg(G, x1, y1, x2, y2, ep = 0.2) {
  const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / (G.cell / 2))), r = Math.max(1, Math.round(ep / 2 / G.cell));
  for (let i = 0; i <= n; i++) { const cx = Math.floor((x1 + (x2 - x1) * i / n) / G.cell), cy = Math.floor((y1 + (y2 - y1) * i / n) / G.cell);
    for (let dy = -r + 1; dy < r; dy++) for (let dx = -r + 1; dx < r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < G.gw && y < G.gh) G.bar[y * G.gw + x] = 1; } }
}
function stampBarriers(G) {
  for (const m of SIM.l.markers || []) {
    const r = (m.rot || 0) * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r), cx = m.x / SIM.sc, cy = m.y / SIM.sc;
    if (/^arch-(porte|entree|vitree|double|fenetre)$/.test(m.typeId)) { const hw = (m.w || ({ 'arch-entree': 1.0, 'arch-double': 1.6, 'arch-fenetre': 1.2 }[m.typeId] || 0.9)) / 2 + 0.1; stampSeg(G, cx - ux * hw, cy - uy * hw, cx + ux * hw, cy + uy * hw, 0.3); }
    else if (m.typeId === 'lock') { const hw = 0.6; stampSeg(G, cx + uy * hw, cy - ux * hw, cx - uy * hw, cy + ux * hw, 0.3); }   // porte du lockOFF : perpendiculaire à son orientation
  }
  for (const w of SIM.l.murs || []) stampSeg(G, w.x1 / SIM.sc, w.y1 / SIM.sc, w.x2 / SIM.sc, w.y2 / SIM.sc, Math.max(0.2, w.ep || 0.2));
}
function lockRooms() {
  (SIM.doors || []).forEach(d => { d.locked = null; });
  SIM.lockRoomsInfo = [];
  const locks = (SIM.l.markers || []).filter(m => m.typeId === 'lock'); if (!locks.length || !SIM.doors || !SIM.doors.length) return;
  const G = SIM.wgrid; const MAXC = G ? Math.round(300 / (G.cell * G.cell)) : 0;     // pièce de 300 m² au plus
  for (const lk of locks) {
    const r = (lk.rot || 0) * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r), cx = lk.x / SIM.sc, cy = lk.y / SIM.sc;
    let room = null;
    if (G) for (const off of [0.6, 1.0, 1.5]) {
      const sx = Math.floor((cx + ux * off) / G.cell), sy = Math.floor((cy + uy * off) / G.cell); if (sx < 0 || sy < 0 || sx >= G.gw || sy >= G.gh || G.bar[sy * G.gw + sx]) continue;
      const seen = new Uint8Array(G.gw * G.gh), st = [sy * G.gw + sx]; seen[st[0]] = 1; let n = 0, leak = false;
      while (st.length) { const i = st.pop(); n++; if (n > MAXC) { leak = true; break; } const x = i % G.gw, y = (i - x) / G.gw;
        if (x === 0 || y === 0 || x === G.gw - 1 || y === G.gh - 1) { leak = true; break; }
        for (const j of [i - 1, i + 1, i - G.gw, i + G.gw]) if (!seen[j] && !G.bar[j]) { seen[j] = 1; st.push(j); } }
      if (!leak) { room = seen; break; }
    }
    const lockDoors = [];
    for (const d of SIM.doors) {
      if (d.locked) continue; const a = d.a, ar = (a.rot || 0) * Math.PI / 180, ax = Math.cos(ar), ay = Math.sin(ar), px = a.x / SIM.sc, py = a.y / SIM.sc, hw = (a.w || 0.9) / 2;
      let hit = Math.hypot(px - cx, py - cy) < 1.6;                                   // porte équipée du lockOFF lui-même
      if (!hit && room) for (let t = -hw; t <= hw && !hit; t += G.cell) for (const sd of [-0.4, 0.4]) {   // un côté de la porte donne dans la pièce
        const x = Math.floor((px + ax * t - ay * sd) / G.cell), y = Math.floor((py + ay * t + ax * sd) / G.cell);
        if (x >= 0 && y >= 0 && x < G.gw && y < G.gh && room[y * G.gw + x]) { hit = true; break; } }
      if (hit) { d.locked = lk; lockDoors.push(d); }
    }
    SIM.lockRoomsInfo.push({ lock: lk, doors: lockDoors.length, closed: !!room });
  }
}
// l'individu bute sur une porte fermée d'une pièce équipée d'un lockOFF
function closedDoorAhead(p) {
  return (SIM.doors || []).find(d => d.locked && !d.forced && Math.hypot(p.x - d.pos.x, p.z - d.pos.z) < 1.0);
}
/* portes : elles s'ouvrent à l'approche d'un personnage et se referment ensuite (sauf pièces équipées d'un lockOFF) */
function animDoors(dt) {
  if (!SIM.doors || !SIM.doors.length) return;
  const people = [SIM.intruder, ...(SIM.occ || [])].filter(p => p && p.g.visible).map(p => p.g.position);
  for (const d of SIM.doors) {
    const near = people.some(q => Math.hypot(q.x - d.pos.x, q.z - d.pos.z) < 1.6);
    if (SIM.state === 'force' && SIM.forceLock && SIM.forceLock.archDoor === d) { const k = Math.max(0, Math.sin(SIM.forceT * 6)); (d.hinges ? d.hinges.map(h => h.hinge) : [d.hinge]).forEach(h => { h.rotation.y = (Math.random() - 0.5) * 0.04 * k; }); continue; }   // la porte vibre sous les coups
    const target = near && !d.locked ? 1 : 0; d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.2);
    if (d.hinges) d.hinges.forEach(h => { h.hinge.rotation.y = h.side * d.sens * d.open * Math.PI * 0.48; });
    else d.hinge.rotation.y = d.side * d.sens * d.open * Math.PI * 0.48;
  }
}

/* personnages */
function makePerson({ intrus = false, color = 0x2563eb } = {}) {
  const g = new THREE.Group(); const dark = intrus ? 0x050506 : color;
  const m = (c, r = 0.8) => intrus ? new THREE.MeshLambertMaterial({ color: c }) : new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const skin = intrus ? 0x08080a : 0xe0b89a;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.6, 0.42), m(dark)); torso.position.y = 1.18; torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), m(skin)); head.position.y = 1.62; head.castShadow = true;
  g.add(torso, head);
  if (intrus) {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), m(0x0d0e10)); hood.position.y = 1.64; g.add(hood);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.12), m(0xd9c2a8)); eyes.position.set(0.115, 1.64, 0); g.add(eyes);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.32), m(0x0b0c0e)); bag.position.set(-0.2, 1.2, 0); g.add(bag);
  } else { const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m(0x3b2a20)); hair.position.y = 1.64; hair.rotation.z = 0.3; g.add(hair); }
  const limb = (w, hh, c, y, z) => { const piv = new THREE.Group(); piv.position.set(0, y, z); const mm = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), m(c)); mm.position.y = -hh / 2; mm.castShadow = true; piv.add(mm); g.add(piv); return piv; };
  const legC = intrus ? 0x060607 : 0x334155;
  const legL = limb(0.13, 0.86, legC, 0.88, -0.1), legR = limb(0.13, 0.86, legC, 0.88, 0.1);
  const armL = limb(0.09, 0.62, dark, 1.46, -0.27), armR = limb(0.09, 0.62, dark, 1.46, 0.27);
  return { g, legL, legR, armL, armR, torso, phase: 0, intrus };
}
function animWalk(p, dt, moving) {
  p.phase += dt * (moving ? 7 : 0); const s = moving ? Math.sin(p.phase) * 0.6 : 0;
  p.legL.rotation.z = s; p.legR.rotation.z = -s; p.armL.rotation.z = -s * 0.8; p.armR.rotation.z = s * 0.8;
}
const faceTo = (p, dx, dz) => { p.g.rotation.y = -Math.atan2(dz, dx); };

/* ---------------------------------------------------------------- détection */
function inZone(dev, w) {
  const { m, t } = dev; const range = m.range ?? t.detRange; if (!range) return false;
  const a = W2M(w), o = { x: m.x / SIM.sc, y: m.y / SIM.sc };
  const dx = a.x - o.x, dy = a.y - o.y, dist = Math.hypot(dx, dy); const k = zoneKind(m);
  if (k === 'faisceau') { const d = dirOf(m.rot || 0); const along = dx * d.x + dy * d.z, perp = Math.abs(-dx * d.z + dy * d.x); return along >= 0 && along <= range && perp < 0.35; }
  if (k === 'profil' && typeof profilLocal === 'function') {
    const r = -(m.rot || 0) * Math.PI / 180, lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    const poly = profilLocal(m); let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > ly) !== (yj > ly) && lx < (xj - xi) * (ly - yi) / (yj - yi) + xi) ins = !ins; } return ins;
  }
  if (dist > range) return false;
  const ang = m.angle ?? t.detAngle; if (!ang || ang >= 360) return true;
  let diff = Math.atan2(dy, dx) * 180 / Math.PI - (m.rot || 0); diff = ((diff + 540) % 360) - 180; return Math.abs(diff) <= ang / 2;
}

/* ---------------------------------------------------------------- scénario : préparation */
function resetRun() {
  stopSound(); (SIM.doors || []).forEach(d => { d.forced = false; });
  const I = SIM.intruder; SIM.t = 0; SIM.clock = SIM.night ? 2 * 3600 + 13 * 60 : 10 * 3600 + 42 * 60; SIM.playing = false; SIM.done = false;
  SIM.alarm = false; SIM.photos = []; SIM.log = []; SIM.queue = []; SIM.state = 'idle';
  (SIM.lockRoomsInfo || []).filter(r => r.doors).forEach(r => logEv(`Pièce équipée du lockOFF ${r.lock.label || ''}${r.lock.local ? ` (${r.lock.local})` : ''} : ${r.doors} porte${r.doors > 1 ? 's' : ''} fermée${r.doors > 1 ? 's' : ''}.`, 'ok'));
  SIM.markers.forEach(d => { d.fired = false; d.inside = d.role === 'lock' ? dirOf(d.m.rot || 0) : d.inside; if (d.tab) { d.tab.position.set(0.04, -0.02, 0); d.tab.rotation.set(0, 0, 0); d.tab.visible = true; if (d.tab.parent !== d.g) d.g.add(d.tab); } if (d.door) d.door.rotation.set(0, 0, 0); if (d.bar) d.bar.rotation.z = -0.35; if (d.light) d.light.intensity = 0; if (d.acc) d.acc.material.emissiveIntensity = 0.35; });
  (SIM.occ || []).forEach(o => SIM.scene.remove(o.g)); SIM.occ = [];
  SIM.falling = []; clearFogs();
  const path = buildPath();
  SIM.path = path; SIM.seg = 0; SIM.segT = 0;
  if (path.length) { I.g.position.copy(path[0]); I.g.visible = true; if (path[1]) faceTo(I, path[1].x - path[0].x, path[1].z - path[0].z); } else I.g.visible = false;
  // salle confinée : occupants autour du blackOTUS, côté intérieur du lockOFF
  SIM.room = null;
  const lock = SIM.markers.find(d => d.role === 'lock');
  if (lock && (SIM.scen === 'confinement' || SIM.scen === 'libre')) {
    let otus = SIM.markers.filter(d => d.role === 'otus').sort((a, b) => a.pos.distanceTo(lock.pos) - b.pos.distanceTo(lock.pos))[0];
    if (otus && otus.pos.distanceTo(lock.pos) > 12) otus = null;
    const center = otus ? otus.pos.clone() : lock.pos.clone().add(lock.inside.clone().multiplyScalar(3));
    const pdc = SIM.markers.filter(d => d.role === 'pdc').sort((a, b) => a.pos.distanceTo(lock.pos) - b.pos.distanceTo(lock.pos))[0];
    const pdcOk = pdc && pdc.pos.distanceTo(lock.pos) < 15 ? pdc : null;
    if (!otus && pdcOk) center.copy(pdcOk.pos).setY(0).add(pdcOk.dir.clone().multiplyScalar(1.6));
    SIM.room = { lock, otus, center, pdc: pdcOk };
    const cols = [0x2563eb, 0x059669, 0xd97706, 0x9333ea];
    for (let i = 0; i < SIM.nOcc; i++) {
      const p = makePerson({ color: cols[i % 4] }); const a = (i / SIM.nOcc) * Math.PI * 2 + 0.6, rr = 1.2 + (i % 2) * 0.6;
      p.g.position.copy(center).add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)); faceTo(p, center.x - p.g.position.x, center.z - p.g.position.z);
      SIM.scene.add(p.g); SIM.occ.push(p);
    }
  }
  drawPath(); renderSimSide(); hud();
}
/* parcours automatique selon le scénario, ou parcours tracé par l'utilisateur */
function buildPath() {
  const dets = SIM.markers.filter(d => ['photo', 'motion', 'door'].includes(d.role));
  const lock = SIM.markers.find(d => d.role === 'lock');
  const start = SIM.start ? SIM.start.clone() : defaultStart();
  if (SIM.scen === 'libre') return SIM.start ? [start, ...SIM.waypoints.map(v => v.clone())] : [];
  if (SIM.waypoints.length && SIM.start) return [start, ...SIM.waypoints.map(v => v.clone())];
  const visit = (pts) => { const out = [start]; let cur = start; const left = [...pts]; while (left.length) { left.sort((a, b) => a.distanceTo(cur) - b.distanceTo(cur)); cur = left.shift(); out.push(cur); } return out; };
  const zonePt = (d) => { const r = Math.min((d.m.range ?? d.t.detRange ?? 3) * 0.45, 4.5); return d.role === 'door' ? d.pos.clone().add(d.dir.clone().multiplyScalar(-0.8)).setY(0) : d.pos.clone().add(d.dir.clone().multiplyScalar(r)).setY(0); };
  if (SIM.scen === 'ronde') return [...visit(dets.map(zonePt)), start.clone()];
  if (SIM.scen === 'confinement' && lock) {
    const outside = lock.pos.clone().add(lock.inside.clone().multiplyScalar(-0.75)).setY(0);
    const near = dets.filter(d => d.role !== 'door').sort((a, b) => a.pos.distanceTo(start) - b.pos.distanceTo(start)).slice(0, 2).map(zonePt);
    return [...visit(near), outside];
  }
  return [...visit(dets.filter(d => d.role !== 'door').map(zonePt).slice(0, 6)), start.clone()];
}
function defaultStart() {
  const door = SIM.markers.find(d => d.role === 'door');
  if (door) return door.pos.clone().add(door.dir.clone().multiplyScalar(-2.5)).setY(0);
  return new THREE.Vector3(-SIM.Wm / 2 + 1.5, 0, 0);
}
function drawPath() {
  const G = SIM.pathLine; while (G.children.length) G.remove(G.children[0]);
  const pts = SIM.path || []; if (pts.length < 1) return;
  if (pts.length > 1) { const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => p.clone().setY(0.06))); G.add(new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 0.4, gapSize: 0.25 })).computeLineDistances()); }
  pts.forEach((p, i) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(i ? 0.14 : 0.28, i ? 0.14 : 0.28, 0.04, 20), new THREE.MeshBasicMaterial({ color: i ? 0xf59e0b : 0x16a34a })); s.position.copy(p).setY(0.05); G.add(s); });
}

/* ---------------------------------------------------------------- moteur du scénario */
const hhmmss = (s) => { s = Math.floor(s) % 86400; return [s / 3600, (s % 3600) / 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':'); };
function logEv(txt, kind = 'info') { SIM.log.unshift({ t: hhmmss(SIM.clock), txt, kind }); renderLog(); }
function after(sec, fn) { SIM.queue.push({ at: SIM.t + sec, fn }); }
function step(dt) {
  if (!SIM.playing) return;
  dt *= SIM.speed; SIM.t += dt; SIM.clock += dt;
  // tâches programmées
  const due = SIM.queue.filter(q => q.at <= SIM.t); SIM.queue = SIM.queue.filter(q => q.at > SIM.t); due.forEach(q => q.fn());
  const I = SIM.intruder;
  if (SIM.state === 'walk' || SIM.state === 'flee') {
    const a = SIM.path[SIM.seg], b = SIM.path[SIM.seg + 1];
    if (!b) { SIM.state = SIM.state === 'flee' ? 'gone' : 'end'; animWalk(I, dt, false); if (SIM.state === 'gone') { I.g.visible = false; logEv('L\'individu a quitté le bâtiment.'); } finish(); return; }
    const L = a.distanceTo(b), v = SIM.state === 'flee' ? 2.6 : 1.35; SIM.segT += dt * v / Math.max(L, 0.01);
    const p = a.clone().lerp(b, Math.min(1, SIM.segT)); I.g.position.copy(p); faceTo(I, b.x - a.x, b.z - a.z); animWalk(I, dt * (v / 1.35), true);
    if (SIM.segT >= 1) { SIM.seg++; SIM.segT = 0; }
    checkSensors(p);
    // porte équipée d'un lockOFF devant soi ?
    const lock = SIM.markers.find(d => d.role === 'lock' && !d.forced && d.pos.clone().setY(0).distanceTo(p) < 1.05 && SIM.state === 'walk');
    if (lock) startForcing(lock);
    else if (SIM.state === 'walk') { const cd = closedDoorAhead(p); if (cd) { cd.forced = true; startForcing({ m: { label: cd.a.label || 'de la pièce', local: cd.locked.local }, pos: cd.pos.clone().setY(0), door: cd.hinges ? cd.hinges[0].hinge : cd.hinge, viaLock: cd.locked, archDoor: cd }); } }
  } else if (SIM.state === 'force') { forceAnim(dt); } else animWalk(I, dt, false);
  animDoors(dt); animFog(dt);
  // occupants : agitation légère
  (SIM.occ || []).forEach((o, i) => { if (!o.busy) o.torso.rotation.x = Math.sin(SIM.t * 1.3 + i) * 0.03; });
  // objets qui tombent (languette)
  SIM.falling.forEach(f => { f.v.y -= 9.8 * dt; f.o.position.addScaledVector(f.v, dt); f.o.rotation.x += dt * 6; f.o.rotation.z += dt * 4; if (f.o.position.y < 0.01) { f.o.position.y = 0.01; f.v.set(0, 0, 0); } });
  hud();
}
function checkSensors(p) {
  for (const d of SIM.markers) {
    if (d.fired) continue;
    if (d.role === 'door') { if (d.pos.clone().setY(0).distanceTo(p) < 0.9) { d.fired = true; pulse(d); logEv(detText(d), 'warn'); radioLink(d); triggerAlarm(d); } continue; }
    if (d.role === 'video') { if (inZone(d, p)) { d.fired = true; pulse(d); logEv(`${d.t.nom} ${d.m.label}${d.m.local ? ` (${d.m.local})` : ''} : l'individu est filmé et enregistré.`, 'photo'); takeSeries(d, 2, { quiet: true, noFlash: true, ir: false }); } continue; }
    if (!['photo', 'motion'].includes(d.role)) continue;
    if (inZone(d, p)) {
      d.fired = true; pulse(d);
      logEv(detText(d), 'warn'); radioLink(d);
      if (d.role === 'photo') takeSeries(d, 3);
      triggerAlarm(d);
    }
  }
}
function pulse(d) { if (d.acc) { d.acc.material.emissiveIntensity = 2.5; after(0.6, () => (d.acc.material.emissiveIntensity = 0.35)); } if (d.zoneMesh) { d.zoneMesh.material.opacity = 0.45; after(1.2, () => (d.zoneMesh.material.opacity = 0.18)); } }
function triggerAlarm(src) {
  if (SIM.alarm) return; SIM.alarm = true;
  after(0.15, () => {
    logEv(`ALARME — la centrale déclenche les sirènes et transmet l'alerte au centre de vidéoprotection et à la Police municipale (${src.m.label}).`, 'alarm');
    SIM.markers.filter(d => d.role === 'siren').forEach(d => logEv(`Sirène ${d.m.label} : ${SIGTXT[sigOf(d)]}.`, 'alarm'));
    startSound();
    if (SIM.markers.some(d => d.role === 'fog')) after(0.6, () => startFog());
    if (SIM.scen === 'confinement' && SIM.room) after(1.2, () => startConfinement());
  });
}

/* --- photos rendues depuis un capteur --- */
/* segment 2D [a,b] contre boîte [x1,x2,z1,z2] (méthode des dalles) */
function segHitsBox(a, b, bx, m = 0.12) {
  let t0 = 0, t1 = 1; const d = [b.x - a.x, b.z - a.z], o = [a.x, a.z], lo = [bx[0] - m, bx[2] - m], hi = [bx[1] + m, bx[3] + m];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
  }
  return true;
}
/* les murs déduits du plan sont approximatifs : on dégage la ligne de vue réelle de l'appareil vers ce qu'il photographie */
function clearSight(eye, pts, wedge = null) {
  if (!SIM.walls || !SIM.wallBoxes) return () => {};
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), saved = [];
  SIM.wallBoxes.forEach((bx, i) => {
    const nx = Math.max(bx[0], Math.min(eye.x, bx[1])), nz = Math.max(bx[2], Math.min(eye.z, bx[3])), near = Math.hypot(nx - eye.x, nz - eye.z) < 0.9;
    let inW = false;
    if (wedge) { const dx = nx - eye.x, dz = nz - eye.z, dd = Math.hypot(dx, dz); inW = dd < wedge.range && (dd < 0.01 || (dx * wedge.dx + dz * wedge.dz) / dd > Math.cos(wedge.half)); }
    if (near || inW || pts.some(p => segHitsBox(eye, p, bx))) { const m = new THREE.Matrix4(); SIM.walls.getMatrixAt(i, m); saved.push([i, m]); SIM.walls.setMatrixAt(i, zero); }
  });
  SIM.walls.instanceMatrix.needsUpdate = true;
  return () => { saved.forEach(([i, m]) => SIM.walls.setMatrixAt(i, m)); SIM.walls.instanceMatrix.needsUpdate = true; };
}
function capture(eye, target, { ir = false, hide = [], label = '', fov = 63, sight = [] } = {}) {
  const w = 640, h = 480; const R = SIM.renderer;
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.05, 80); cam.position.copy(eye); cam.lookAt(target);
  const rt = new THREE.WebGLRenderTarget(w, h, { encoding: THREE.sRGBEncoding });
  const hidden = [SIM.zones, SIM.labels, SIM.pathLine, ...hide, ...SIM.markers.filter(x => x.sprite).map(x => x.sprite)]; const vis = hidden.map(o => o.visible); hidden.forEach(o => (o.visible = false));   // photos réalistes : sans les vignettes des matériels
  // exposition « caméra » : sol et murs assombris pour que le plan blanc ne brûle pas l'image
  const amb = SIM.hemi.intensity, sun = SIM.sun.intensity, fc = SIM.floor.material.color.getHex();
  const wm = SIM.walls && SIM.walls.material, wc = wm && wm.color.getHex();
  const fl = SIM.markers.filter(x => x.flash).map(x => [x.flash, x.flash.intensity]); fl.forEach(([f]) => (f.intensity = 0));
  SIM.hemi.intensity = ir ? 0.75 : 0.9; SIM.sun.intensity = ir ? 0.25 : 0.55;
  SIM.floor.material.color.setHex(ir ? 0x8a8a8a : 0x9a9a9a); if (wm) { wm.color.setHex(ir ? 0x9c9c9c : 0xb8b4ac); wm.opacity = 1; }
  let wedge = null;
  if (sight.length) { const v = new THREE.Vector3(target.x - eye.x, 0, target.z - eye.z).normalize(); wedge = { dx: v.x, dz: v.z, half: fov * 0.62 * Math.PI / 180, range: Math.max(...sight.map(p => Math.hypot(p.x - eye.x, p.z - eye.z))) + 0.6 }; }
  const restore = clearSight(eye, [target, ...sight], wedge);
  R.setRenderTarget(rt); R.render(SIM.scene, cam); restore(); const buf = new Uint8Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, buf); R.setRenderTarget(null);
  SIM.hemi.intensity = amb; SIM.sun.intensity = sun; fl.forEach(([f, v]) => (f.intensity = v)); SIM.floor.material.color.setHex(fc); if (wm) { wm.color.setHex(wc); wm.opacity = 0.93; }
  hidden.forEach((o, i) => (o.visible = vis[i])); rt.dispose();
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, o = (y * w + x) * 4; let r = buf[s], gg = buf[s + 1], b = buf[s + 2];
    if (ir) { const v = (0.3 * r + 0.59 * gg + 0.11 * b) / 255; const l = Math.max(0, Math.min(255, 255 * Math.pow(v, 1.6) * 1.05 + 6 + (Math.random() - 0.5) * 18)); r = gg = b = l; }
    else { r = Math.min(255, Math.pow(r / 255, 1.25) * 262); gg = Math.min(255, Math.pow(gg / 255, 1.25) * 262); b = Math.min(255, Math.pow(b / 255, 1.25) * 262); }
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h - 30, w, 30); g.fillStyle = '#fff'; g.font = '16px Consolas, monospace'; g.fillText(label, 10, h - 10);
  g.textAlign = 'right'; g.fillText(hhmmss(SIM.clock), w - 10, h - 10);
  return c.toDataURL('image/jpeg', 0.86);
}
function takeSeries(d, n, opts = {}) {
  for (let i = 0; i < n; i++) after(0.35 + i * 0.55, () => {
    let eye = d.pos.clone().setY(opts.high ? Math.max(d.h, 2.25) : d.h).add(d.dir.clone().multiplyScalar(opts.high ? 0.2 : 0.35));
    eye = clearOfWall(d.pos.clone().setY(eye.y), d.dir) || eye;
    const target = opts.target ? opts.target() : SIM.intruder.g.position.clone().setY(1.2);
    if (!opts.target && !SIM.intruder.g.visible) return;
    if (!opts.noFlash) flash(d);
    const url = capture(eye, target, { ir: opts.ir ?? SIM.night, fov: opts.fov || 63, sight: opts.sight ? opts.sight() : [], hide: [d.g, ...(opts.hide || [])], label: `${d.t.nom} ${d.m.label} — photo ${i + 1}/${n}` });
    SIM.photos.unshift({ url, label: `${d.m.label} · photo ${i + 1}/${n}`, t: hhmmss(SIM.clock), src: d.t.nom });
    showPhoto(SIM.photos[0]); renderGallery();
    if (i === 0 && !opts.quiet) logEv(`${d.t.nom} ${d.m.label} : photos de levée de doute envoyées (${n})`, 'photo');
  });
}
/* l'objectif ne doit pas se trouver dans l'épaisseur d'un mur déduit du plan : on remonte du champ vers l'appareil */
function clearOfWall(base, dir) {
  if (!SIM.walls || !SIM.walls.visible) return null;
  const from = base.clone().add(dir.clone().multiplyScalar(1.2)); const rc = new THREE.Raycaster(from, dir.clone().negate(), 0, 1.2);
  const hit = rc.intersectObject(SIM.walls)[0]; if (!hit) return null;
  return hit.point.clone().add(dir.clone().multiplyScalar(0.12));
}
function flash(d) {
  if (d.flash) { d.flash.intensity = 6; setTimeout(() => d.flash && (d.flash.intensity = 0), 120); }
  const f = $('#sFlash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}
function showPhoto(p) {
  const pop = $('#sPop'); pop.innerHTML = `<img src="${p.url}" alt=""><div>${esc(p.label)} · ${esc(p.t)}</div>`;
  pop.classList.remove('on'); void pop.offsetWidth; pop.classList.add('on');
  clearTimeout(SIM.popT); SIM.popT = setTimeout(() => pop.classList.remove('on'), 2600);
}

/* --- lockOFF : tentative d'effraction --- */
function startForcing(lock) {
  lock.forced = true; lock.chocLogged = false; SIM.state = 'force'; SIM.forceT = 0; SIM.forceLock = lock;
  const I = SIM.intruder; const toDoor = lock.pos.clone().setY(0).sub(I.g.position); faceTo(I, toDoor.x, toDoor.z);
  SIM.forceBase = I.g.position.clone(); SIM.forceDir = toDoor.normalize();
  logEv(`Tentative d'effraction sur la porte ${lock.m.label}${lock.m.local ? ` (${lock.m.local})` : ''} : coups d'épaule et de pied`, 'alarm');
  if (!SIM.alarm) triggerAlarm(lock);
}
function forceAnim(dt) {
  const I = SIM.intruder, lock = SIM.forceLock; SIM.forceT += dt;
  const k = Math.max(0, Math.sin(SIM.forceT * 6)); I.g.position.copy(SIM.forceBase).addScaledVector(SIM.forceDir, k * 0.28);
  I.armL.rotation.z = I.armR.rotation.z = -1.3 * k; I.torso.rotation.z = -0.25 * k;
  if (lock.door) lock.door.rotation.y = (Math.random() - 0.5) * 0.03 * k; // la porte vibre mais ne s'ouvre pas
  if (SIM.forceT > 0.6 && !lock.chocLogged) { const dp = SIM.markers.find(x => x.t.id === 'doorplus' && x.pos.distanceTo(lock.pos) < 2);
    if (dp) { lock.chocLogged = true; pulse(dp); logEv(`DoorProtect Plus ${dp.m.label} : chocs et inclinaison détectés sur la porte (tentative de forçage).`, 'warn'); radioLink(dp); } }
  if (SIM.forceT > 4.5) {
    I.armL.rotation.z = I.armR.rotation.z = 0; I.torso.rotation.z = 0; if (lock.door) lock.door.rotation.y = 0;
    if (lock.archDoor) { lock.door.rotation.y = 0; logEv(`La porte ${lock.m.label} reste fermée : la pièce est protégée par le lockOFF ${lock.viaLock.label || ''}, l'intrusion échoue.`, 'ok'); }
    else logEv(`La porte ${lock.m.label} résiste : le lockOFF bloque le vantail, l'intrusion échoue.`, 'ok');
    // fuite : retour au point de départ
    SIM.path = [I.g.position.clone(), ...(SIM.path.slice(0, SIM.seg + 1).reverse())]; SIM.seg = 0; SIM.segT = 0; SIM.state = 'flee'; drawPath();
    after(0.5, () => logEv('L\'individu prend la fuite.', 'info'));
  }
}

/* --- confinement : lockOFF, languette du blackOTUS, photos de la salle, pushPANIC --- */
function startConfinement() {
  const R0 = SIM.room; if (!R0 || R0.started) return; R0.started = true;
  logEv(`Confinement de la salle ${R0.lock.m.local || R0.lock.m.label} : le lockOFF ${R0.lock.m.label} est mis en place.`, 'ok');
  if (R0.pdc) { logEv(`Les occupants se regroupent dans la pièce de confinement signalée par ${R0.pdc.m.label}.`, 'ok'); if (R0.pdc.light2) R0.pdc.light2.intensity = 2.5; }
  // pose du lockOFF : la barre s'abaisse contre la porte
  const bar = R0.lock.bar; let t = 0; const iv = setInterval(() => { t += 0.05; if (bar) bar.rotation.z = -0.35 + Math.min(1, t) * 0.33; if (t >= 1) clearInterval(iv); }, 30);
  // un occupant va au blackOTUS et tire la languette rouge
  const otus = R0.otus; const o = SIM.occ[0];
  if (otus && o) {
    o.busy = true; const to = otus.pos.clone().setY(0).add(otus.dir.clone().multiplyScalar(-0.45)); const from = o.g.position.clone();
    const dur = Math.max(0.6, from.distanceTo(to) / 1.4); let tt = 0;
    const walk = setInterval(() => {
      if (!SIM.on) return clearInterval(walk);
      tt += 0.03 * SIM.speed; const k = Math.min(1, tt / dur); o.g.position.copy(from).lerp(to, k); faceTo(o, to.x - from.x, to.z - from.z); animWalk(o, 0.03 * SIM.speed, k < 1);
      if (k >= 1) { clearInterval(walk); faceTo(o, otus.pos.x - to.x, otus.pos.z - to.z); pullTab(o, otus); }
    }, 30);
  } else if (!otus) logEv('Aucun blackOTUS dans la salle confinée : ajoutez-en un sur le plan pour la levée de doute photographique.', 'info');
  // les autres occupants s'éloignent de la porte et s'accroupissent
  SIM.occ.slice(1).forEach((p, i) => { const away = R0.center.clone().add(R0.lock.inside.clone().multiplyScalar(1.5 + i * 0.5)).add(new THREE.Vector3((i - 1) * 0.7, 0, (i % 2) * 0.8)); const from = p.g.position.clone(); let k = 0;
    const iv2 = setInterval(() => { if (!SIM.on) return clearInterval(iv2); k = Math.min(1, k + 0.02 * SIM.speed); p.g.position.copy(from).lerp(away, k); animWalk(p, 0.03, k < 1); if (k >= 1) { clearInterval(iv2); p.g.scale.y = 0.72; } }, 30); });
  // pushPANIC
  const push = SIM.markers.filter(d => d.role === 'push').sort((a, b) => a.pos.distanceTo(R0.center) - b.pos.distanceTo(R0.center))[0];
  if (push) after(2.5, () => { if (push.btn) { push.btn.position.y = 0.025; push.btn.material.emissiveIntensity = 1.5; } logEv(`pushPANIC ${push.m.label} actionné : alerte transmise aux contacts d'urgence en moins de 0,15 s.`, 'alarm'); });
}
function pullTab(o, otus) {
  o.armR.rotation.z = -1.4; o.armR.rotation.x = 0.2;
  logEv(`Un occupant tire la languette rouge du blackOTUS ${otus.m.label} : déclenchement de la levée de doute.`, 'alarm');
  const tab = otus.tab; let t = 0;
  const iv = setInterval(() => {
    if (!SIM.on) return clearInterval(iv);
    t += 0.04; tab.position.x = 0.04 + t * 0.12; tab.position.y = -0.02 - t * 0.04;
    if (t >= 1) {
      clearInterval(iv); const wp = new THREE.Vector3(); tab.getWorldPosition(wp); SIM.scene.attach(tab); tab.position.copy(wp);
      SIM.falling.push({ o: tab, v: otus.dir.clone().multiplyScalar(0.6).setY(0.8) }); o.armR.rotation.set(0, 0, 0);
      // photos de la salle et des occupants, sans le mis en cause (resté hors de la salle)
      { const pp = new THREE.Vector3(-otus.dir.z, 0, otus.dir.x); o.g.position.copy(otus.pos).setY(0).add(otus.dir.clone().multiplyScalar(2.6)).add(pp.multiplyScalar(1.3)); faceTo(o, -otus.dir.x, -otus.dir.z); } // l'occupant s'écarte du champ
      const occPts = () => SIM.occ.map(p => p.g.position.clone().setY(1.0));
      const aim = () => { const pts = occPts(); const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
        return pts.length && c.distanceTo(otus.pos.clone().setY(1)) > 1 ? c.setY(1.15) : otus.pos.clone().add(otus.dir.clone().multiplyScalar(3.5)).setY(1.1); };
      takeSeries(otus, 3, { ir: false, quiet: true, high: true, fov: 82, hide: [SIM.intruder.g], target: aim, sight: occPts });
      after(2.2, () => logEv(`blackOTUS ${otus.m.label} : 3 clichés de la salle transmis (occupants visibles, mis en cause hors champ).`, 'photo'));
    }
  }, 30);
}
function finish() { if (SIM.done) return; SIM.done = true; SIM.playing = false; logEv('Fin de la simulation.', 'info'); stopSound(); renderSimSide(); }

/* --- son de sirène (WebAudio, coupable) --- */
/* signal d'une sirène : 'son' (alarme sonore), 'flash' (flashs lumineux) ou 'les2' (par défaut) */
const sigOf = (d) => d.m.signal || 'les2';
function startSound() {
  SIM.markers.forEach(d => { if (d.role === 'hub' || (d.role === 'siren' && sigOf(d) !== 'son')) d.blink = true; });
  const sirens = SIM.markers.filter(d => d.role === 'siren');
  const anySound = !sirens.length || sirens.some(d => sigOf(d) !== 'flash');
  if (!SIM.sound || SIM.osc || !anySound) return;
  try { const A = SIM.ac || (SIM.ac = new AudioContext()); const o = A.createOscillator(), gn = A.createGain(); o.type = 'square'; gn.gain.value = 0.035; o.connect(gn).connect(A.destination); o.start(); SIM.osc = o;
    let hi = false; SIM.sirenIv = setInterval(() => { hi = !hi; o.frequency.setValueAtTime(hi ? 1450 : 980, A.currentTime); }, 350); } catch {}
}
/* applique en direct le signal choisi (pendant l'alarme ou le test) */
function applySignals() {
  if (!(SIM.alarm || SIM.testSig)) return;
  try { SIM.osc && SIM.osc.stop(); } catch {} SIM.osc = null; clearInterval(SIM.sirenIv);
  SIM.markers.forEach(d => { if (d.role === 'siren') { d.blink = false; if (d.light) d.light.intensity = 0; if (d.acc) { d.acc.material.emissive.set(0xff1a1a); d.acc.material.emissiveIntensity = 0.35; } } });
  startSound();
}
function setSignal(d, v) {
  if (v === 'les2') delete d.m.signal; else d.m.signal = v;
  if (typeof setDirty === 'function') setDirty();
  applySignals();
}
function testSirens() {
  if (SIM.alarm) { toast('L\'alarme est déjà en cours.'); return; }
  clearTimeout(SIM.testTo); SIM.testSig = true; startSound();
  logEv('Test des sirènes : ' + SIM.markers.filter(d => d.role === 'siren').map(d => `${d.m.label} (${SIGTXT[sigOf(d)]})`).join(', ') + '.', 'ok');
  SIM.testTo = setTimeout(() => { SIM.testSig = false; if (!SIM.alarm) stopSound(); }, 4000);
}
const SIGTXT = { son: 'alarme sonore', flash: 'flashs lumineux', les2: 'alarme sonore et flashs lumineux' };
function stopSound() { clearTimeout(SIM.testTo); SIM.testSig = false; clearInterval(SIM.sirenIv); try { SIM.osc && SIM.osc.stop(); } catch {} SIM.osc = null; (SIM.markers || []).forEach(d => { d.blink = false; if (d.light) d.light.intensity = 0; }); }

/* ---------------------------------------------------------------- rendu / caméra */
function loop() {
  if (!SIM.on || !SIM.renderer) return;
  const now = performance.now(); const dt = Math.min(0.05, ((now - (SIM.last || now)) / 1000)); SIM.last = now;
  step(dt);
  // clignotements
  const on = Math.floor(performance.now() / 250) % 2 === 0;
  const strobe = Math.floor(performance.now() / 90) % 6 < 1;          // flash bref et intense, 1 fois toutes les 0,54 s
  SIM.markers.forEach(d => { if (!d.blink) return;
    if (d.role === 'siren') { if (d.light) { d.light.color.set(0xffffff); d.light.intensity = strobe ? 14 : 0; d.light.distance = 14; } if (d.acc) { d.acc.material.emissive.set(strobe ? 0xffffff : 0xff1a1a); d.acc.material.emissiveIntensity = strobe ? 5 : 0.3; } return; }
    if (d.light) d.light.intensity = on ? 4 : 0; if (d.acc) { d.acc.material.emissive.set(0xff1a1a); d.acc.material.emissiveIntensity = on ? 3 : 0.2; } });
  updateCam();
  SIM.renderer.render(SIM.scene, SIM.cam);
  requestAnimationFrame(loop);
}
function updateCam() {
  const c = SIM.cam, o = SIM.orbit;
  if (SIM.camMode === 'follow' && SIM.intruder.g.visible) {
    const p = SIM.intruder.g.position, back = new THREE.Vector3(-Math.cos(-SIM.intruder.g.rotation.y), 0, -Math.sin(-SIM.intruder.g.rotation.y));
    const want = p.clone().add(back.multiplyScalar(4.5)).setY(3.2); c.position.lerp(want, 0.08); c.lookAt(p.x, 1.2, p.z); return;
  }
  if (SIM.camMode === 'top') { c.position.set(o.tx, Math.max(SIM.Wm, SIM.Hm) * 0.95, o.tz + 0.01); c.lookAt(o.tx, 0, o.tz); return; }
  c.position.set(o.tx + o.dist * Math.sin(o.phi) * Math.cos(o.theta), o.dist * Math.cos(o.phi), o.tz + o.dist * Math.sin(o.phi) * Math.sin(o.theta)); c.lookAt(o.tx, 0, o.tz);
}
function bindSimInput(el) {
  let drag = null;
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (SIM.mode && e.button === 0) { const p = pickFloor(e); if (p) placePoint(p); return; }
    drag = { x: e.clientX, y: e.clientY, b: e.button, o: { ...SIM.orbit } }; el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, o = SIM.orbit;
    if (drag.b === 0 && !e.shiftKey) { o.theta = drag.o.theta + dx * 0.006; o.phi = Math.min(1.45, Math.max(0.15, drag.o.phi - dy * 0.005)); }
    else { const k = o.dist / 600; o.tx = drag.o.tx - (dx * Math.sin(o.theta) + dy * Math.cos(o.theta)) * k * -1; o.tz = drag.o.tz - (-dx * Math.cos(o.theta) + dy * Math.sin(o.theta)) * k * -1; }
    if (SIM.camMode !== 'orbit') setCam('orbit');
  });
  el.addEventListener('pointerup', () => (drag = null));
  el.addEventListener('wheel', (e) => { e.preventDefault(); SIM.orbit.dist = Math.min(400, Math.max(3, SIM.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });
}
function pickFloor(e) {
  const r = SIM.renderer.domElement.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(v, SIM.cam); const hit = rc.intersectObject(SIM.floor)[0]; return hit ? hit.point.setY(0) : null;
}
function placePoint(p) {
  if (SIM.mode === 'start') { SIM.start = p; SIM.mode = 'way'; SIM.waypoints = []; banner(); }
  else if (SIM.mode === 'way') SIM.waypoints.push(p);
  if (SIM.scen !== 'libre' && SIM.waypoints.length) SIM.scen = 'libre';
  resetRun();
}
function setCam(m) { SIM.camMode = m; $$('#sCamSeg button').forEach(b => b.classList.toggle('on', b.dataset.cam === m)); }
function banner() {
  const bn = $('#sBanner');
  if (SIM.mode === 'start') { bn.innerHTML = 'Cliquez sur le plan à l\'endroit où l\'individu commence son cheminement <button id="sbStop">Annuler</button>'; bn.hidden = false; }
  else if (SIM.mode === 'way') { bn.innerHTML = 'Cliquez les points de passage successifs (passez par les portes) <button id="sbStop">Terminer le parcours</button>'; bn.hidden = false; }
  else bn.hidden = true;
  const s = $('#sbStop'); if (s) s.onclick = () => { SIM.mode = null; banner(); renderSimSide(); };
}
function applyAmbiance() {
  SIM.hemi.intensity = SIM.night ? 0.35 : 0.95; SIM.sun.intensity = SIM.night ? 0.15 : 0.8;
  SIM.scene.background.set(SIM.night ? 0x070b14 : 0x9fb3cc); SIM.scene.fog.color.set(SIM.night ? 0x070b14 : 0x9fb3cc);
  if (SIM.zones) SIM.zones.visible = SIM.zonesOn;
}

/* ---------------------------------------------------------------- panneau latéral */
function hud() {
  const h = $('#sHud'); if (!h) return;
  h.innerHTML = `<div class="clk">${hhmmss(SIM.clock || 0)}</div><div class="st ${SIM.alarm ? 'alarm' : 'arm'}">${SIM.alarm ? 'ALARME' : 'Système armé'}</div><div class="ph">📷 ${SIM.photos ? SIM.photos.length : 0}</div>`;
}
function renderLog() { const el = $('#sLog'); if (el) el.innerHTML = SIM.log.map(e => `<div class="ev ${e.kind}"><b>${e.t}</b> ${esc(e.txt)}</div>`).join('') || '<p class="muted">Le journal des événements s\'affichera ici.</p>'; }
function renderGallery() { const el = $('#sGal'); if (el) el.innerHTML = SIM.photos.map((p, i) => `<img src="${p.url}" title="${esc(p.label)} · ${p.t}" data-ph="${i}">`).join('') || '<p class="muted">Aucune photo pour l\'instant.</p>'; const x = $('#sExport'); if (x && SIM.photos.length) x.disabled = false; }
function renderSimSide() {
  const side = $('#sSide'); if (!side) return;
  const nb = (r) => SIM.markers.filter(d => d.role === r).length;
  side.innerHTML = `
    <section><h2>Scénario</h2>
      <select id="sScen">${Object.entries(SIM_SCEN).map(([k, v]) => `<option value="${k}" ${SIM.scen === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select>
      <p class="muted" style="margin:6px 0 0;font-size:12px">${esc(SIM_SCEN[SIM.scen].desc)}</p>
      ${SIM.scen === 'confinement' && !nb('lock') ? '<div class="warnbox">Aucun lockOFF sur ce niveau : placez-en un devant la porte de la salle à confiner (orientation vers l\'intérieur).</div>' : ''}
    </section>
    <section><h2>Parcours de l'individu</h2>
      <div class="btnrow"><button id="sStart" class="${SIM.mode === 'start' ? 'on' : ''}">📍 Choisir le départ</button><button id="sWay" class="${SIM.mode === 'way' ? 'on' : ''}" ${SIM.start ? '' : 'disabled'}>+ Points de passage</button><button id="sClear" class="ghost">Effacer</button></div>
      <p class="muted" style="margin:6px 0 0;font-size:12px">${SIM.start ? `Départ choisi · ${SIM.waypoints.length} point(s) de passage.` : 'Sans départ choisi, un parcours automatique est calculé selon le scénario.'}</p>
    </section>
    <section><h2>Lecture</h2>
      <div class="btnrow"><button id="sPlay" class="primary">${SIM.playing ? '⏸ Pause' : SIM.done ? '↺ Rejouer' : '▶ Lancer'}</button><button id="sReset">↺ Recommencer</button></div>
      <div class="btnrow" style="margin-top:6px">Vitesse ${[0.5, 1, 2, 4].map(v => `<button class="small ${SIM.speed === v ? 'on' : ''}" data-speed="${v}">×${String(v).replace('.', ',')}</button>`).join('')}</div>
    </section>
    ${nb('siren') ? `<section><h2>Sirènes à l'alarme</h2>
      ${nb('siren') > 1 ? `<label class="field"><span>Toutes les sirènes</span><select id="sSigAll"><option value="">— au cas par cas —</option><option value="les2">Alarme sonore et flashs lumineux</option><option value="son">Alarme sonore seulement</option><option value="flash">Flashs lumineux seulement</option></select></label>` : ''}
      ${SIM.markers.map((d, i) => d.role !== 'siren' ? '' : `<label class="field"><span>${esc(d.m.label || d.t.nom)}</span><select data-sig="${i}">${['les2', 'son', 'flash'].map(v => `<option value="${v}" ${sigOf(d) === v ? 'selected' : ''}>${v === 'les2' ? 'Alarme sonore et flashs lumineux' : v === 'son' ? 'Alarme sonore seulement' : 'Flashs lumineux seulement'}</option>`).join('')}</select></label>`).join('')}
      <button id="sSigTest" class="wide">🔔 Tester les sirènes (4 s)</button>
      <p class="muted" style="margin:6px 0 0;font-size:11.5px">Le choix s'applique tout de suite, même pendant l'alarme, et il est enregistré avec le plan.</p>
    </section>` : ''}
    <section><h2>Photos prises</h2><div id="sGal" class="sim-gal"></div>
      ${typeof exportSimReport === 'function' ? `<button id="sExport" class="wide" ${SIM.photos && (SIM.photos.length || SIM.log.length) ? '' : 'disabled'}>💾 Exporter le rapport (photos + journal)</button>` : ''}</section>
    <section><h2>Journal</h2><div id="sLog" class="sim-log"></div></section>
    <section><h2>Affichage</h2>
      <label class="chk"><input id="sNight" type="checkbox" ${SIM.night ? 'checked' : ''}> Nuit (photos infrarouges)</label>
      <label class="chk"><input id="sZones" type="checkbox" ${SIM.zonesOn ? 'checked' : ''}> Zones de détection</label>
      <label class="chk"><input id="sWalls" type="checkbox" ${SIM.wallsOn ? 'checked' : ''}> Murs déduits du plan${SIM.wallCount ? ` (${SIM.wallCount} segments)` : ''}</label>
      <label class="chk"><input id="sImg" type="checkbox" ${SIM.imgOn !== false ? 'checked' : ''}> Images des matériels</label>
      <label class="chk"><input id="sWallsBat" type="checkbox" ${SIM.wallsBat !== false ? 'checked' : ''} ${SIM.wallsOn ? '' : 'disabled'}> Murs du bâtiment seulement (sans cartouche, légendes, cotes ni textes)</label>
      <label class="field"><span>Sensibilité des murs</span><input id="sSens" type="range" min="0" max="1" step="0.05" value="${SIM.wallSens}"></label>
      <label class="field"><span>Occupants de la salle confinée : ${SIM.nOcc}</span><input id="sOcc" type="range" min="1" max="4" step="1" value="${SIM.nOcc}"></label>
      <label class="chk"><input id="sSound" type="checkbox" ${SIM.sound ? 'checked' : ''}> Son de la sirène</label>
      <p class="muted" style="margin:6px 0 0;font-size:11.5px">Souris : glisser = tourner, Maj + glisser ou clic droit = déplacer, molette = zoom.</p>
    </section>`;
  renderLog(); renderGallery();
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el[ev] = fn; };
  on('sScen', 'onchange', (e) => { SIM.scen = e.target.value; if (SIM.scen !== 'libre') { SIM.start = null; SIM.waypoints = []; } resetRun(); });
  on('sStart', 'onclick', () => { SIM.mode = SIM.mode === 'start' ? null : 'start'; banner(); renderSimSide(); });
  on('sWay', 'onclick', () => { SIM.mode = SIM.mode === 'way' ? null : 'way'; banner(); renderSimSide(); });
  on('sClear', 'onclick', () => { SIM.start = null; SIM.waypoints = []; SIM.mode = null; banner(); resetRun(); });
  on('sPlay', 'onclick', () => { if (SIM.done) resetRun(); if (!SIM.path || SIM.path.length < 2) { toast('Parcours vide : choisissez un départ et des points de passage, ou un autre scénario.', true); return; } SIM.playing = !SIM.playing; if (SIM.playing && SIM.state === 'idle') { SIM.state = 'walk'; logEv(`Début du scénario « ${SIM_SCEN[SIM.scen].nom} ».`); } SIM.mode = null; banner(); renderSimSide(); });
  on('sReset', 'onclick', () => resetRun());
  $$('[data-sig]', side).forEach(el => el.onchange = () => setSignal(SIM.markers[+el.dataset.sig], el.value));
  on('sSigAll', 'onchange', (e) => { const v = e.target.value; if (!v) return; SIM.markers.forEach(d => { if (d.role === 'siren') { if (v === 'les2') delete d.m.signal; else d.m.signal = v; } }); if (typeof setDirty === 'function') setDirty(); applySignals(); renderSimSide(); });
  on('sSigTest', 'onclick', () => testSirens());
  on('sExport', 'onclick', () => exportSimReport());
  $$('[data-speed]', side).forEach(b => b.onclick = () => { SIM.speed = +b.dataset.speed; renderSimSide(); });
  on('sNight', 'onchange', (e) => { SIM.night = e.target.checked; applyAmbiance(); });
  on('sZones', 'onchange', (e) => { SIM.zonesOn = e.target.checked; applyAmbiance(); });
  on('sWalls', 'onchange', (e) => { SIM.wallsOn = e.target.checked; buildWalls(); lockRooms(); renderSimSide(); });
  on('sImg', 'onchange', (e) => { SIM.imgOn = e.target.checked; SIM.markers.forEach(d => { if (d.sprite) d.sprite.visible = SIM.imgOn; }); });
  on('sWallsBat', 'onchange', (e) => { SIM.wallsBat = e.target.checked; buildWalls(); lockRooms(); renderSimSide(); });
  on('sSens', 'onchange', (e) => { SIM.wallSens = +e.target.value; buildWalls(); lockRooms(); renderSimSide(); });
  on('sOcc', 'onchange', (e) => { SIM.nOcc = +e.target.value; resetRun(); });
  on('sSound', 'onchange', (e) => { SIM.sound = e.target.checked; if (SIM.sound) applySignals(); if (!SIM.sound) { try { SIM.osc && SIM.osc.stop(); } catch {} SIM.osc = null; clearInterval(SIM.sirenIv); } });
  const gal = $('#sGal'); gal.onclick = (e) => { const i = e.target.dataset.ph; if (i === undefined) return; const p = SIM.photos[+i]; modal({ title: `${p.src} — ${p.label}`, size: '', body: `<div style="text-align:center"><img src="${p.url}" style="max-width:100%;border-radius:6px"></div><p class="muted" style="text-align:center;margin:0">${esc(p.t)}</p>`, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] }); };
}

/* boutons de l'en-tête */
(function bindSimHeader() {
  const c = $('#sClose'); if (c) c.onclick = closeSim;
  $$('#sCamSeg button').forEach(b => b.onclick = () => setCam(b.dataset.cam));
})();
