/* Blackeyes 2 — mode DÉMONSTRATION.
   Sans compte ni connexion : une session de démonstration est ouverte automatiquement sur un plan fictif.
   On peut poser les matériels BLACKEYES, voir leurs champs de détection, lancer la Simulation 3D et imprimer.
   Rien n'est conservé : tout reste en mémoire et disparaît à la fermeture. Les impressions portent la mention « DÉMONSTRATION ». */
'use strict';

const DEMO = { login: 'demonstration', name: 'Démonstration', pw: 'Demo-Blackeyes-2026', plan: 'demo-plan.jpg', scale: 60 };

// pas de verrouillage par inactivité (aucun mot de passe à connaître) ni de premier réglage de la charte
window.lockSession = function () {};
window.charteFirstRun = async function () {};

/* ---------------------------------------------------------------- filigrane sur toutes les impressions (PDF) */
(function demoWatermark() {
  const NS = window.jspdf; if (!NS || NS.jsPDF.__bkDemo) return;
  const Orig = NS.jsPDF;
  const mark = (d) => {
    if (d.__bkDemoMarked) return; d.__bkDemoMarked = true;
    const n = d.getNumberOfPages(), k = d.internal.scaleFactor || 1, mm = 1 / (k * 0.3528);   // 1 mm en unités du document
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      const w = d.internal.pageSize.getWidth(), h = d.internal.pageSize.getHeight();
      d.saveGraphicsState();
      try { d.setGState(new d.GState({ opacity: 0.13 })); } catch {}
      d.setTextColor(200, 16, 46); d.setFont('helvetica', 'bold'); d.setFontSize(Math.min(w, h) / mm * 0.33);
      const ang = Math.atan2(h, w), tw = d.getTextWidth('DÉMONSTRATION'), fh = d.getFontSize() / k;
      d.text('DÉMONSTRATION', w / 2 - Math.cos(ang) * tw / 2 + Math.sin(ang) * fh * 0.35, h / 2 + Math.sin(ang) * tw / 2 + Math.cos(ang) * fh * 0.35, { angle: ang * 180 / Math.PI });
      d.restoreGraphicsState();
      d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(200, 16, 46);
      d.text('Version de démonstration Blackeyes 2 — plan fictif, document sans valeur.', w / 2, h - 1.3 * mm, { align: 'center' });
    }
  };
  function DemoPdf(...a) {
    const d = new Orig(...a); const out = d.output;
    d.output = function (...b) { try { mark(d); } catch (e) { console.error(e); } return out.apply(d, b); };
    return d;
  }
  Object.setPrototypeOf(DemoPdf, Orig); DemoPdf.prototype = Orig.prototype; DemoPdf.API = Orig.API; DemoPdf.__bkDemo = true;
  NS.jsPDF = DemoPdf;
})();

/* ---------------------------------------------------------------- démarrage */
async function demoStart() {
  try { S.info = await window.native.info(); } catch {}
  const A = window.native.auth;
  try {
    const st = await A.status(); S.permDefs = st.perms;
    let user;
    if (!st.hasAccounts) user = (await A.setup({ login: DEMO.login, name: DEMO.name, password: DEMO.pw })).user;
    else { const r = await A.login({ login: DEMO.login, password: DEMO.pw }); if (!r.ok) throw new Error(r.error || 'Session de démonstration impossible.'); user = r.user; }
    await window.native.charte.save({ version: 1, organisme: 'BLACKEYES', service: 'Version de démonstration', titre: 'Dossier d\'implantation du système de sûreté BLACKEYES', mention: 'Version de démonstration — plan fictif, document sans valeur contractuelle.', couleur: '#1D4FB8', logo: '' });
    await enterApp(user);
    { const t = $('#toast'); if (t) t.hidden = true; }
    demoUi();
    await demoProject(false);
    setTimeout(demoGuide, 300);
  } catch (e) {
    console.error(e);
    authShow(`<p class="err">Démarrage de la démonstration impossible : ${esc(e.message)}</p>`);
  }
}

/* ---------------------------------------------------------------- interface réduite */
const DEMO_HIDE = ['bOpen', 'bSave', 'bImport', 'bImportPhoto', 'bImport2', 'bImportPhoto2', 'bAddLevel', 'bDocx', 'bPptx', 'bMail', 'bPhone', 'bPartages', 'bCsv',
  'bClients', 'bAgenda', 'bCarte', 'bFact', 'bFiches', 'bBase', 'bAdmin', 'bUser', 'usbBadge'];
function demoUi() {
  document.body.classList.add('bk-demo');
  const st = document.createElement('style');
  st.textContent = DEMO_HIDE.map(id => `#${id}`).join(',') + '{display:none!important}';
  document.head.appendChild(st);
  // libellés
  const ex = $('#bExport'); if (ex) ex.innerHTML = '🖨️ Imprimer ▾';
  const pl = $('#bPlans'); if (pl) { const b = pl.querySelector('b, strong, .t') || pl; if (b !== pl) b.textContent = 'Plan avec matériels'; }
  const sim = $('#bSim'); if (sim) { sim.title = 'Simulation 3D du plan et des matériels'; }
  // bandeau
  const bar = document.createElement('div'); bar.id = 'demoBar';
  bar.innerHTML = `<b>VERSION DE DÉMONSTRATION</b><span>Plan fictif · rien n'est enregistré</span>
    <button type="button" data-a="guide">❓ Guide</button><button type="button" data-a="ex">✨ Exemple d'implantation</button><button type="button" data-a="raz">↺ Recommencer</button>`;
  document.body.appendChild(bar);
  bar.querySelector('[data-a=guide]').onclick = demoGuide;
  bar.querySelector('[data-a=ex]').onclick = async () => { if (level() && level().markers.length && !(await demoConfirm('Remplacer l\'implantation actuelle par l\'exemple ?'))) return; demoProject(true); };
  bar.querySelector('[data-a=raz]').onclick = async () => { if (await demoConfirm('Effacer tous les matériels et repartir du plan vierge ?')) demoProject(false); };
  // « Nouveau » : repartir du plan de démonstration
  const nw = $('#bNew'); if (nw) nw.onclick = () => bar.querySelector('[data-a=raz]').click();
}
async function demoConfirm(msg) {
  return modal({ title: 'Démonstration', size: 'sm', body: `<p style="margin:0">${esc(msg)}</p>`, buttons: [{ label: 'Annuler', value: false }, { label: 'Confirmer', cls: 'primary', value: true }] });
}

/* ---------------------------------------------------------------- projet de démonstration (plan fictif) */
let DEMO_PLAN = null;
async function demoPlanUrl() {
  if (DEMO_PLAN) return DEMO_PLAN;
  const b = await (await fetch(DEMO.plan)).blob();
  DEMO_PLAN = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  return DEMO_PLAN;
}
async function demoProject(exemple) {
  const url = await demoPlanUrl();
  S.project = newProject();
  Object.assign(S.project, { name: 'Démonstration — École', site: 'École (plan fictif)', client: 'Démonstration', reference: 'DEMO-001', author: 'Démonstration' });
  S.project.levels.push({ id: 'demo-rdc', name: 'Rez-de-chaussée', plan: { w: 2400, h: 1500, dataUrl: url }, markers: [], scale: DEMO.scale, notes: [] });
  S.levelId = 'demo-rdc'; S.selId = null;
  if (exemple) {
    const put = (t, x, y, rot) => { if (!S.db || !typeOf(t)) return; addMarker(t, x, y); const m = level().markers.at(-1); if (m && rot !== undefined) m.rot = rot; };
    put('hub', 420, 1150); put('mcam', 180, 220, 45); put('mcam', 1500, 700, 180); put('mcam', 1580, 220, 45);
    put('door', 150, 825, 0); put('siren', 1200, 300); put('push', 560, 1300); put('otus', 2200, 1300, 225); put('fog', 2230, 780, 180); put('vsint', 250, 760, 0);
    S.selId = null;
  }
  S.history = []; S.future = [];
  renderAll(); setDirty(false); requestAnimationFrame(fit);
  if (exemple) toast('Exemple chargé : touchez un matériel pour voir sa fiche et son champ de détection.');
}
// rien n'est enregistré : pas d'alerte « modifications non enregistrées »
setInterval(() => { try { if (S.dirty) setDirty(false); } catch {} }, 1000);

/* ---------------------------------------------------------------- guide */
function demoGuide() {
  return modal({ title: 'Bienvenue dans la démonstration Blackeyes 2', size: 'lg', body: `
    <p style="margin-top:0">Un plan d'école <b>fictif</b> est ouvert. Essayez les fonctions du logiciel, sans compte ni connexion. Rien n'est enregistré.</p>
    <ol class="demo-steps">
      <li><b>Installer les matériels.</b> Dans la liste de gauche, cliquez un matériel BLACKEYES puis cliquez sur le plan (ou faites-le glisser). Déplacez-le à la souris ; la poignée le fait pivoter ; <kbd>Suppr</kbd> l'enlève.</li>
      <li><b>Voir les champs de détection.</b> La case <b>Zones de détection</b> affiche la portée de chaque détecteur et caméra. Cliquez un matériel pour voir sa fiche à droite.</li>
      <li><b>Simulation 3D.</b> Le bouton <b>3D</b> ouvre le plan en relief : parcourez le bâtiment, lancez une intrusion et voyez les matériels se déclencher.</li>
      <li><b>Imprimer.</b> <b>🖨️ Imprimer › Plan avec matériels</b> (option « vue 3D ») ou <b>Planches A3</b> : le document s'ouvre, prêt à imprimer.</li>
    </ol>
    <p class="muted" style="margin-bottom:0">Pour gagner du temps : <b>✨ Exemple d'implantation</b> place une dizaine de matériels. <b>↺ Recommencer</b> efface tout.</p>`,
    buttons: [{ label: '✨ Voir un exemple', value: 'ex' }, { label: 'Commencer sur le plan vierge', cls: 'primary', value: true }] })
    .then(v => { if (v === 'ex') demoProject(true); });
}

demoStart();
