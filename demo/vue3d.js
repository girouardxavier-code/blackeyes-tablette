/* Blackeyes 2 — vue 3D d'un niveau pour les documents (PDF) : vue de dessus légèrement inclinée.
   Les murs sont déduits du plan (même détection que l'assistant : seul le bâtiment, sans cadre, cartouche ni légende),
   montés en relief ; au sol, le plan avec ses matériels et leurs zones ; chaque matériel est repéré par un jalon de sa
   couleur. Rendu hors écran (WebGL), renvoyé en JPEG. */
'use strict';

let V3D_THREE = null;
function v3dLoadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (V3D_THREE) return V3D_THREE;
  V3D_THREE = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/three.min.js'; s.onload = () => res(window.THREE); s.onerror = () => rej(new Error('Moteur 3D indisponible.')); document.head.append(s); });
  return V3D_THREE;
}

/* murs : grille de 10 cm, cases regroupées en segments horizontaux */
async function v3dWalls(l) {
  const gr = await asReadPlan(l, { ...AS_DEFAULT_OPTS, ...(l.analyse && l.analyse.opts ? l.analyse.opts : {}) });
  const f = Math.max(1, Math.round(0.1 / gr.cellM)); const G2 = Math.ceil(gr.G / f), H2 = Math.ceil(gr.H / f); const m = new Uint8Array(G2 * H2);
  for (let y = 0; y < gr.H; y++) for (let x = 0; x < gr.G; x++) if (gr.wall[y * gr.G + x]) m[Math.floor(y / f) * G2 + Math.floor(x / f)]++;
  const thr = Math.max(1, Math.round(f * f * 0.25));
  // écarte les petits éléments isolés (textes, symboles, cotes) : un mur fait au moins 0,8 m de long
  const on = new Uint8Array(G2 * H2); for (let i = 0; i < on.length; i++) on[i] = m[i] >= thr ? 1 : 0;
  const seen = new Uint8Array(G2 * H2), st = [], comp = [], minLen = Math.max(4, Math.round(0.8 / (gr.cellM * f)));
  for (let s0 = 0; s0 < on.length; s0++) { if (!on[s0] || seen[s0]) continue; st.length = 0; comp.length = 0; st.push(s0); seen[s0] = 1; let ax = G2, bx = -1, ay = H2, by = -1;
    while (st.length) { const i = st.pop(); comp.push(i); const x = i % G2, y = (i / G2) | 0; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= G2 || yy >= H2) continue; const j = yy * G2 + xx; if (on[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    if (Math.max(bx - ax, by - ay) + 1 < minLen) for (const i of comp) m[i] = 0; }
  const runs = []; let x0 = 0, x1 = 0, y0 = 0, y1 = 0, any = false;
  for (let y = 0; y < H2; y++) { let x = 0; while (x < G2) { if (m[y * G2 + x] >= thr) { let x2 = x; while (x2 + 1 < G2 && m[y * G2 + x2 + 1] >= thr) x2++; runs.push([x, x2, y]);
    if (!any) { x0 = x; x1 = x2; y0 = y1 = y; any = true; } else { x0 = Math.min(x0, x); x1 = Math.max(x1, x2); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } x = x2 + 1; } else x++; } }
  const cellPx = gr.k * f;      // côté d'une case, en pixels du plan
  return { runs, cellPx, box: any ? { x0: x0 * cellPx, y0: y0 * cellPx, x1: (x1 + 1) * cellPx, y1: (y1 + 1) * cellPx } : null };
}

async function render3dLevel(l, { W = 2400, H = 1500, zones = true } = {}) {
  if (!l.scale) throw new Error(`${lvLabel(l)} : échelle non définie (outil Échelle), vue 3D impossible.`);
  const THREE = await v3dLoadThree();
  const sc = l.scale; const Wm = l.plan.w / sc, Hm = l.plan.h / sc; const hW = 1.4;   // murs coupés à 1,40 m (vue en maquette)
  const P = (x, y) => new THREE.Vector3(x / sc - Wm / 2, 0, y / sc - Hm / 2);
  const walls = await v3dWalls(l);
  const keep = S.exp; S.exp = { zones, notes: true, photos: false };
  let floor; try { floor = await rasterLevel(l, 4096); } finally { S.exp = keep; }

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  R.setPixelRatio(1); R.setSize(W, H, false); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in R) R.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef1f5);
  const disposeList = [];
  try {
    // sol : le plan avec ses matériels et zones
    const tex = new THREE.Texture(await loadImg(floor.url)); tex.needsUpdate = true; if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = R.capabilities.getMaxAnisotropy();
    const fg = new THREE.PlaneGeometry(Wm, Hm), fm = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const fl = new THREE.Mesh(fg, fm); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; scene.add(fl); disposeList.push(fg, fm, tex);
    // murs
    if (walls.runs.length) {
      const bg = new THREE.BoxGeometry(1, 1, 1), bm = new THREE.MeshStandardMaterial({ color: 0xf1f3f7, roughness: 0.9 });
      const im = new THREE.InstancedMesh(bg, bm, walls.runs.length); const mx = new THREE.Matrix4(); const c = walls.cellPx / sc;
      walls.runs.forEach(([x1, x2, y], i) => { const w = (x2 - x1 + 1) * c; mx.compose(new THREE.Vector3(x1 * c + w / 2 - Wm / 2, hW / 2, y * c + c / 2 - Hm / 2), new THREE.Quaternion(), new THREE.Vector3(w, hW, c)); im.setMatrixAt(i, mx); });
      im.castShadow = true; im.receiveShadow = true; scene.add(im); disposeList.push(bg, bm);
      // arêtes hautes plus sombres : lecture des murs en vue de dessus
      const tg = new THREE.BoxGeometry(1, 0.04, 1), tm = new THREE.MeshBasicMaterial({ color: 0x5b6475 }); const top = new THREE.InstancedMesh(tg, tm, walls.runs.length);
      walls.runs.forEach(([x1, x2, y], i) => { const w = (x2 - x1 + 1) * c; mx.compose(new THREE.Vector3(x1 * c + w / 2 - Wm / 2, hW + 0.02, y * c + c / 2 - Hm / 2), new THREE.Quaternion(), new THREE.Vector3(w, 1, c)); top.setMatrixAt(i, mx); });
      scene.add(top); disposeList.push(tg, tm);
    }
    // jalons des matériels
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 1, 8), head = new THREE.SphereGeometry(0.22, 18, 12); disposeList.push(pole, head);
    for (const mk of l.markers) {
      const t = typeOf(mk.typeId); const col = new THREE.Color(t.couleur || '#64748b'); const p = P(mk.x, mk.y); const h = 1.9;
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, emissive: col, emissiveIntensity: 0.25 }); disposeList.push(mat);
      const a = new THREE.Mesh(pole, mat); a.scale.y = h; a.position.set(p.x, h / 2, p.z); a.castShadow = true; scene.add(a);
      const b = new THREE.Mesh(head, mat); b.position.set(p.x, h, p.z); b.castShadow = true; scene.add(b);
    }
    // lumières
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8892a6, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); const span = Math.max(Wm, Hm);
    sun.position.set(-span * 0.25, span * 1.2, -span * 0.15); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -span * 0.7, right: span * 0.7, top: span * 0.7, bottom: -span * 0.7, near: 0.5, far: span * 3 }); sun.shadow.bias = -0.0005; scene.add(sun);
    // caméra : au-dessus du bâtiment, inclinée de 16° depuis le bas du plan
    const bx = walls.box || { x0: 0, y0: 0, x1: l.plan.w, y1: l.plan.h };
    const c0 = P((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2), bw = (bx.x1 - bx.x0) / sc, bh = (bx.y1 - bx.y0) / sc;
    const cam = new THREE.PerspectiveCamera(16, W / H, 0.1, span * 40);
    const tilt = 16 * Math.PI / 180, az = 0;      // vue de dessus, légèrement inclinée (depuis le bas du plan)
    const dir = new THREE.Vector3(Math.sin(az) * Math.sin(tilt), Math.cos(tilt), Math.cos(az) * Math.sin(tilt));
    const corners = []; for (const x of [c0.x - bw / 2, c0.x + bw / 2]) for (const z of [c0.z - bh / 2, c0.z + bh / 2]) for (const y of [0, hW]) corners.push(new THREE.Vector3(x, y, z));
    let d = Math.max(bw, bh) * 2;
    for (let it = 0; it < 12; it++) {   // ajuste la distance pour que tout le bâtiment tienne dans l'image (marge 10 %)
      cam.position.copy(new THREE.Vector3(c0.x, 0, c0.z).addScaledVector(dir, d)); cam.lookAt(c0.x, hW * 0.3, c0.z); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      let m = 0; for (const c of corners) { const q = c.clone().project(cam); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); }
      d *= m / 0.9; if (Math.abs(m - 0.9) < 0.005) break;
    }
    R.render(scene, cam);
    return { url: canvas.toDataURL('image/jpeg', 0.9), w: W, h: H };
  } finally {
    disposeList.forEach(o => { try { o.dispose(); } catch {} }); try { R.dispose(); R.forceContextLoss && R.forceContextLoss(); } catch {}
  }
}
