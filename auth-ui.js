/* Blackeyes Implantation — connexion, comptes et administration (interface) */
'use strict';

const IDLE_MS = 15 * 60 * 1000;
let lastActivity = Date.now(), locked = false;
function bumpActivity() { lastActivity = Date.now(); }
function checkIdle() { if (S.user && !locked && Date.now() - lastActivity > IDLE_MS) lockSession(); }

const A = () => window.native.auth;
const frDateTime = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const pwField = (id, label, auto = 'current-password') => `<label class="field"><span>${label}</span><input id="${id}" type="password" autocomplete="${auto}"></label>`;
const PRESETS = {
  'Consultation seule': [],
  'Implanteur': ['plans', 'implanter', 'projets', 'exportPptx', 'exportPdf', 'exportDocx', 'exportCsv'],
  'Tous les droits': ['plans', 'implanter', 'projets', 'exportPptx', 'exportPdf', 'exportDocx', 'exportCsv', 'base', 'batiments', 'tarifs', 'facturation']
};

function authShow(html) {
  $('#authBody').innerHTML = html;
  $('#authFoot').innerHTML = `<div>${esc(`Blackeyes 2 · version ${S.info?.version || ''}${S.info?.usb ? ' · données sur la clé USB' : ''}`)}</div><div class="credit">Programme créé par Xavier GIROUARD</div>`;
  $('#authScreen').hidden = false;
  const f = $('#authBody input:not([value]), #authBody input[value=""]') || $('#authBody input'); if (f) f.focus();
}
function authErr(msg) { const e = $('#authBody .err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }
function busy(form, on) { $$('button', form).forEach(b => b.disabled = on); }

async function startAuth() {
  try { S.info = await window.native.info(); } catch {}
  if (S.info?.usb) { const b = $('#usbBadge'); b.hidden = false; b.title = `Données enregistrées sur la clé : ${S.info.dataDir}`; }
  let st;
  try { st = await A().status(); } catch (e) { authShow(`<p class="err">Impossible de lire les comptes : ${esc(e.message)}</p>`); return; }
  S.permDefs = st.perms;
  st.hasAccounts ? showLogin() : showSetup();
}

function showSetup() {
  authShow(`<form id="fSetup" autocomplete="off"><h3>Création du compte administrateur</h3>
    <p>Premier lancement : créez le compte qui gère les éditeurs et leurs droits.</p>
    <label class="field"><span>Identifiant</span><input id="sLogin" type="text" autocomplete="username" placeholder="ex. admin.surete"></label>
    <label class="field"><span>Nom affiché</span><input id="sName" type="text" placeholder="ex. Cellule Sûreté"></label>
    ${pwField('sPw', 'Mot de passe (8 caractères minimum, lettres et chiffres)', 'new-password')}
    ${pwField('sPw2', 'Confirmer le mot de passe', 'new-password')}
    <p class="err" hidden></p>
    <button class="primary" type="submit">Créer le compte administrateur</button>
    <p style="font-size:12.5px;border-top:1px solid var(--line2);padding-top:12px"><b>Vous êtes éditeur ?</b> Ne créez pas de compte : votre clé doit être préparée par l'administrateur (Administration &gt; « Clé USB » sur votre compte). Elle s'ouvre alors directement sur l'écran de connexion.</p>
    <button type="button" id="sImport" class="linkbtn">Importer une ancienne configuration (.bkcfg)</button></form>`);
  $('#sImport').onclick = importConfigFlow;
  $('#fSetup').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#sPw').value !== $('#sPw2').value) return authErr('Les deux mots de passe ne correspondent pas.');
    busy(e.target, true);
    try { const r = await A().setup({ login: $('#sLogin').value, name: $('#sName').value, password: $('#sPw').value }); showRecoveryCode(r.recoveryCode, () => enterApp(r.user)); }
    catch (err) { authErr(err.message); busy(e.target, false); }
  };
}

function showRecoveryCode(code, next, chiffrement = false) {
  authShow(`<form id="fCode"><h3>${chiffrement ? 'Chiffrement des données activé' : 'Code de secours administrateur'}</h3>
    ${chiffrement ? `<p>Les données de cette clé (comptes, journal, base des matériels, charte, carte des bâtiments, projets) sont désormais <b>chiffrées en AES-256</b> : sans mot de passe, elles sont illisibles.</p>
    <p>Votre code de secours a été <b>renouvelé</b> (l'ancien ne fonctionne plus) : c'est lui qui permet de rouvrir les données si vous oubliez votre mot de passe.</p>` : ''}
    <p>Notez ce code et conservez-le à part, pas sur la clé. Il permet de redéfinir le mot de passe administrateur en cas d'oubli. Il ne sera plus affiché.</p>
    <div class="code-box">${esc(code)}</div>
    <label class="chk"><input id="cOk" type="checkbox"> J'ai noté le code de secours</label>
    <button class="primary" type="submit" id="cGo" disabled>Continuer</button></form>`);
  $('#cOk').onchange = (e) => ($('#cGo').disabled = !e.target.checked);
  $('#fCode').onsubmit = (e) => { e.preventDefault(); next(); };
}

async function showLogin(prefill = '') {
  let mm = {}; try { mm = await A().memo(); } catch {}
  const login0 = prefill || mm.login || '';
  authShow(`<form id="fLogin"><h3>Connexion</h3>
    <label class="field"><span>Identifiant</span><input id="lLogin" type="text" autocomplete="username" value="${esc(login0)}"></label>
    <label class="field"><span>Mot de passe</span><input id="lPw" type="password" autocomplete="current-password" ${mm.pwUsable ? 'placeholder="Mémorisé sur ce poste : laissez vide"' : ''}></label>
    <div class="memo-opts">
      <label class="chk"><input id="lRemL" type="checkbox" ${mm.rememberLogin ? 'checked' : ''}> Mémoriser mon identifiant</label>
      <label class="chk" title="${mm.pwSupported ? 'Le mot de passe est chiffré par le système (Windows ou trousseau du Mac) et ne fonctionne que sur ce poste, avec votre session.' : 'Mémorisation du mot de passe non disponible sur ce poste.'}"><input id="lRemP" type="checkbox" ${mm.rememberPw && mm.pwSupported ? 'checked' : ''} ${mm.pwSupported ? '' : 'disabled'}> Mémoriser mon mot de passe sur ce poste</label>
      ${mm.rememberLogin || mm.rememberPw ? '<button class="linkbtn" type="button" id="lForget">Oublier les informations mémorisées</button>' : ''}
    </div>
    <p class="err" hidden></p>
    <button class="primary" type="submit">Se connecter</button>
    <button class="linkbtn" type="button" id="lForgot">Mot de passe oublié ?</button>
    <button class="linkbtn" type="button" id="lCfg">Mettre à jour la configuration (fichier .bkcfg de l'administrateur)</button></form>`);
  $('#lCfg').onclick = importConfigFlow;
  if (login0) $('#lPw').focus();
  $('#lRemP').onchange = (e) => { if (e.target.checked) $('#lRemL').checked = true; };
  $('#lRemL').onchange = (e) => { if (!e.target.checked) $('#lRemP').checked = false; };
  const fg = $('#lForget'); if (fg) fg.onclick = async () => { try { await A().forget(); } catch {} showLogin(); setTimeout(() => toast('Informations de connexion oubliées sur ce poste.'), 50); };
  $('#fLogin').onsubmit = async (e) => {
    e.preventDefault(); busy(e.target, true);
    const pw = $('#lPw').value;
    try {
      const lg = $('#lLogin').value;
      const useMemo = !pw && mm.pwUsable && lg.trim().toLowerCase() === (mm.login || '').toLowerCase();
      if (!pw && !useMemo) { authErr('Saisissez votre mot de passe.'); busy(e.target, false); $('#lPw').focus(); return; }
      const r = await A().login({ login: lg, password: pw, useMemo, remember: { login: $('#lRemL').checked, pw: $('#lRemP').checked } });
      if (!r.ok) { authErr(r.error); $('#lPw').value = ''; if (/mémorisé/.test(r.error)) { mm.pwUsable = false; $('#lPw').placeholder = ''; } $('#lPw').focus(); busy(e.target, false); return; }
      const go = () => r.user.mustChange ? showForceChange(r.user, pw, !!r.memoPwPending) : enterApp(r.user, r);
      r.recoveryCode ? showRecoveryCode(r.recoveryCode, go, true) : go();
    } catch (err) { authErr(err.message); busy(e.target, false); }
  };
  $('#lForgot').onclick = showRecover;
}

function showForceChange(user, oldPw, rememberPw = false) {
  authShow(`<form id="fForce"><h3>Choisissez votre mot de passe</h3>
    <p>Bonjour ${esc(user.name)}. Votre mot de passe actuel est provisoire : remplacez-le par un mot de passe personnel.</p>
    ${pwField('fPw', 'Nouveau mot de passe (8 caractères minimum, lettres et chiffres)', 'new-password')}
    ${pwField('fPw2', 'Confirmer le mot de passe', 'new-password')}
    <p class="err" hidden></p><button class="primary" type="submit">Enregistrer et continuer</button></form>`);
  $('#fForce').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#fPw').value !== $('#fPw2').value) return authErr('Les deux mots de passe ne correspondent pas.');
    busy(e.target, true);
    try { const u = await A().changePassword({ oldPassword: oldPw, newPassword: $('#fPw').value, rememberPw }); enterApp(u); }
    catch (err) { authErr(err.message); busy(e.target, false); }
  };
}

function showRecover() {
  authShow(`<form id="fRec"><h3>Mot de passe oublié</h3>
    <p><b>Éditeur :</b> demandez à l'administrateur de réinitialiser votre mot de passe.</p>
    <p><b>Administrateur :</b> saisissez le code de secours obtenu lors de la création du compte.</p>
    <label class="field"><span>Identifiant administrateur</span><input id="rLogin" type="text" autocomplete="username"></label>
    <label class="field"><span>Code de secours</span><input id="rCode" type="text" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off"></label>
    ${pwField('rPw', 'Nouveau mot de passe', 'new-password')}
    ${pwField('rPw2', 'Confirmer le mot de passe', 'new-password')}
    <p class="err" hidden></p>
    <button class="primary" type="submit">Redéfinir le mot de passe</button>
    <button class="linkbtn" type="button" id="rBack">Retour à la connexion</button></form>`);
  $('#rBack').onclick = () => showLogin();
  $('#fRec').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#rPw').value !== $('#rPw2').value) return authErr('Les deux mots de passe ne correspondent pas.');
    busy(e.target, true);
    try { const r = await A().recover({ login: $('#rLogin').value, code: $('#rCode').value, newPassword: $('#rPw').value }); showRecoveryCode(r.recoveryCode, () => enterApp(r.user)); }
    catch (err) { authErr(err.message); busy(e.target, false); }
  };
}

async function importConfigFlow() {
  try {
    const r = await A().importConfig(); if (!r) return;
    const d = r.exportedAt ? new Date(r.exportedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    showLogin(); setTimeout(() => toast(`Configuration importée : ${r.users} compte(s), ${r.db} matériel(s)${d ? ` — version du ${d}` : ''}. Connectez-vous avec l'identifiant reçu.`), 50);
  } catch (e) { authErr(e.message); }
}

/* mise à jour de la configuration depuis une session ouverte (clés chiffrées) */
async function importConfigLogged() {
  try {
    const r = await A().importConfig(); if (!r) return;
    const st = await A().status(); if (st.user) { S.user = st.user; applyUser(); }
    await loadDb(); renderAll();
    toast(`Configuration mise à jour : ${r.db} matériel(s), droits et charte actualisés.`);
  } catch (e) { toast(e.message, true); }
}

async function enterApp(user, extra = {}) {
  S.user = user; locked = false; bumpActivity();
  if (extra.nonChiffre && user.role !== 'admin') setTimeout(() => toast('Attention : les données de cette clé ne sont pas chiffrées. Demandez à l\'administrateur de préparer à nouveau votre clé.', true), 1600);
  $('#authScreen').hidden = true; $('#authBody').innerHTML = '';
  await loadDb();
  S.project = newProject(); S.levelId = null; S.selId = null; S.history = []; S.future = [];
  if (typeof C !== 'undefined') { C.data = null; C.store = null; C.tId = null; }
  applyUser(); setTool('select'); renderAll(); setDirty(false);
  toast(`Connecté : ${user.name} (${user.role === 'admin' ? 'administrateur' : 'éditeur'})`);
  setTimeout(checkDroppedUpdate, 800);
  if (typeof agOnLogin === 'function') agOnLogin();
  if (typeof charteFirstRun === 'function') setTimeout(charteFirstRun, 1200);
}

function applyUser() {
  const u = S.user; if (!u) return;
  $('#uName').textContent = u.name; $('#uRole').textContent = u.role === 'admin' ? 'Administrateur' : 'Éditeur';
  $('#bAdmin').hidden = u.role !== 'admin';
  $('#bBase').hidden = !can('base');
  const bf = $('#bFact'); if (bf) bf.hidden = !can('facturation');
  const map = { bImport: 'plans', bImport2: 'plans', bImportPhoto: 'plans', bImportPhoto2: 'plans', bAddLevel: 'plans', bSave: 'projets', bPptx: 'exportPptx', bPdf: 'exportPdf', bCsv: 'exportCsv', tCalib: 'implanter', bUndo: 'implanter', bRedo: 'implanter' };
  for (const [id, p] of Object.entries(map)) { const el = $('#' + id); if (el) el.hidden = !can(p); }
  $('#optSize').disabled = !can('implanter');
  $('#bDocx').hidden = !(can('exportDocx') || can('exportPdf'));
  $('#ddExport').hidden = !['exportDocx', 'exportPdf', 'exportPptx', 'exportCsv'].some(can);
  if (typeof CHARTE !== 'undefined') CHARTE = null;
  let rb = $('#roBanner');
  if (!can('implanter')) {
    if (!rb) { rb = document.createElement('div'); rb.id = 'roBanner'; rb.className = 'ro-banner'; $('.workspace').prepend(rb); }
    rb.textContent = 'Consultation seule : votre compte ne permet pas de modifier l\'implantation.';
  } else if (rb) rb.remove();
  const emptyP = $('#empty p');
  if (emptyP) emptyP.textContent = can('plans') ? 'Importez un plan d\'architecte (PDF, PowerPoint ou image) pour commencer l\'implantation. Chaque page ou diapositive choisie devient un niveau.' : 'Ouvrez un projet existant pour le consulter.';
  updateUndo();
}

async function logout() {
  closeMenu();
  if (!(await guardUnsaved())) return;
  try { await A().logout(); } catch {}
  $$('#modalRoot > *').forEach(m => m.remove());
  if (typeof closeCarte === 'function') { closeCarte(); C.data = null; C.store = null; C.tId = null; C.sel = null; C.view = 'list'; }
  if (typeof BK !== 'undefined') { $('#bankView').hidden = true; BK.data = null; BK.list = {}; }
  if (typeof PDS !== 'undefined') { $('#pdsView').hidden = true; PDS.d = null; PDS.dirty = false; PDS.list = {}; }
  if (typeof CL !== 'undefined') { $('#clientsView').hidden = true; CL.list = []; CL.q = ''; CL.sel = null; $('#clQ').value = ''; }
  if (typeof AG !== 'undefined') { $('#agendaView').hidden = true; AG.data = null; AG.q = ''; $('#agBadge').hidden = true; }
  S.user = null; S.project = newProject(); S.levelId = null; S.selId = null; S.history = []; S.future = [];
  setDirty(false); renderAll(); showLogin();
}

function lockSession() {
  if (!S.user) return;
  locked = true; closeMenu();
  authShow(`<form id="fUnlock"><h3>Session verrouillée</h3>
    <p>${esc(S.user.name)} (${esc(S.user.login)}) : saisissez votre mot de passe pour reprendre votre travail.</p>
    ${pwField('uPw', 'Mot de passe')}<p class="err" hidden></p>
    <button class="primary" type="submit">Déverrouiller</button>
    <button class="linkbtn" type="button" id="uSwitch">Changer d'utilisateur</button></form>`);
  $('#fUnlock').onsubmit = async (e) => {
    e.preventDefault(); busy(e.target, true);
    try {
      const r = await A().unlock({ password: $('#uPw').value });
      if (!r.ok) { authErr(r.error); $('#uPw').value = ''; busy(e.target, false); if (/expirée/.test(r.error)) setTimeout(() => { locked = false; S.user = null; showLogin(); }, 1200); return; }
      locked = false; bumpActivity(); S.user = r.user; $('#authScreen').hidden = true; applyUser(); renderAll();
    } catch (err) { authErr(err.message); busy(e.target, false); }
  };
  $('#uSwitch').onclick = async () => { $('#authScreen').hidden = true; locked = false; await logout(); if (S.user) lockSession(); };
}

/* ---------------------------------------------------------------- menu utilisateur */
function closeMenu() { const m = $('#userMenu'); if (m) m.remove(); }
function openUserMenu() {
  if ($('#userMenu')) return closeMenu();
  const r = $('#bUser').getBoundingClientRect();
  const m = document.createElement('div'); m.id = 'userMenu'; m.className = 'menu';
  m.style.top = (r.bottom + 6) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px';
  const rights = S.user.role === 'admin' ? 'Tous les droits' : (S.permDefs || []).filter(p => S.user.perms[p.id]).map(p => p.label).join(', ') || 'Consultation seule';
  m.innerHTML = `<div class="who"><b style="color:var(--ink)">${esc(S.user.name)}</b><br>${esc(S.user.login)} · ${S.user.role === 'admin' ? 'Administrateur' : 'Éditeur'}<br><span style="font-size:11px">${esc(rights)}</span></div>
    <button data-m="pw">Changer mon mot de passe</button>
    ${S.user.role === 'admin' ? '<button data-m="rc">Générer un nouveau code de secours</button>' : ''}
    ${S.user.role !== 'admin' ? '<button data-m="cfg">Mettre à jour la configuration…</button>' : ''}
    <button data-m="maj">Mise à jour du logiciel…</button>
    <button data-m="lock">Verrouiller la session</button>
    <button data-m="out">Se déconnecter</button>`;
  m.onclick = (e) => {
    const a = e.target.dataset.m; if (!a) return; closeMenu();
    if (a === 'pw') changePasswordDialog(); if (a === 'rc') newRecoveryDialog(); if (a === 'lock') lockSession(); if (a === 'maj') majDialog(); if (a === 'out') logout(); if (a === 'cfg') importConfigLogged();
  };
  document.body.append(m);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target) && e.target.closest('#bUser') === null) { closeMenu(); } document.removeEventListener('pointerdown', off, true); }, true), 0);
}

async function changePasswordDialog() {
  await modal({
    title: 'Changer mon mot de passe',
    body: `${pwField('cpOld', 'Mot de passe actuel')}${pwField('cpNew', 'Nouveau mot de passe (8 caractères minimum, lettres et chiffres)', 'new-password')}${pwField('cpNew2', 'Confirmer le nouveau mot de passe', 'new-password')}`,
    buttons: [{ label: 'Annuler', value: null }, {
      label: 'Enregistrer', cls: 'primary', action: async (root) => {
        if ($('#cpNew', root).value !== $('#cpNew2', root).value) { toast('Les deux mots de passe ne correspondent pas.', true); return false; }
        try { S.user = await A().changePassword({ oldPassword: $('#cpOld', root).value, newPassword: $('#cpNew', root).value }); toast('Mot de passe modifié'); }
        catch (e) { toast(e.message, true); return false; }
      }
    }]
  });
}
async function newRecoveryDialog() {
  const code = await modal({
    title: 'Nouveau code de secours',
    body: `<p style="margin:0">L'ancien code ne fonctionnera plus. Confirmez avec votre mot de passe.</p>${pwField('rcPw', 'Mot de passe administrateur')}`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Générer', cls: 'primary', action: async (root) => { try { return await A().newRecoveryCode({ password: $('#rcPw', root).value }); } catch (e) { toast(e.message, true); return false; } } }]
  });
  if (code) await modal({ title: 'Code de secours', body: `<p style="margin:0">Notez ce code et conservez-le à part. Il ne sera plus affiché.</p><div class="code-box">${esc(code)}</div>`, buttons: [{ label: 'J\'ai noté le code', cls: 'primary', value: true }] });
}

/* ---------------------------------------------------------------- console d'administration */
function genPassword() {
  const al = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = new Uint32Array(10); crypto.getRandomValues(r);
  let s = Array.from(r, v => al[v % al.length]).join('');
  if (!/\d/.test(s)) s = s.slice(0, 9) + '7'; if (!/[a-zA-Z]/.test(s)) s = 'k' + s.slice(1);
  return s;
}
function permChips(u) {
  if (u.role === 'admin') return '<span class="chipp admin">Tous les droits + comptes</span>';
  const on = (S.permDefs || []).filter(p => u.perms[p.id]);
  return on.length ? on.map(p => `<span class="chipp">${esc(p.label)}</span>`).join('') : '<span class="chipp off">Consultation seule</span>';
}

async function openAdminConsole() {
  if (S.user?.role !== 'admin') return;
  let tab = 'users', users = [], logs = [], q = '', chiffreOn = false;
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-height:420px';
  const load = async () => {
    try { users = await A().listUsers(); chiffreOn = !!(await A().status()).chiffre; if (tab === 'log') logs = await A().readLog(); } catch (e) { toast(e.message, true); }
    render();
  };
  const render = () => {
    const head = `<div class="tabsbar"><button data-tab="users" class="${tab === 'users' ? 'on' : ''}">Comptes (${users.length})</button><button data-tab="log" class="${tab === 'log' ? 'on' : ''}">Journal d'activité</button></div>`;
    if (tab === 'users') {
      body.innerHTML = head + `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <p class="muted" style="margin:0">Les éditeurs n'accèdent qu'aux fonctions cochées. « Clé USB » prépare la clé chiffrée d'un agent (un agent par clé) ; il choisit son mot de passe à la première connexion.</p>
          <button class="primary" data-a="new">+ Nouveau compte éditeur</button></div>
        <div style="overflow:auto"><table class="users"><thead><tr><th>Identifiant</th><th>Nom</th><th>Droits</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr>
          <td><b>${esc(u.login)}</b></td><td>${esc(u.name)}</td><td><div class="chips">${permChips(u)}</div></td>
          <td>${u.role === 'admin' ? '<span class="chipp admin">Administrateur</span>' : u.active ? (u.mustChange ? '<span class="chipp off">Mot de passe provisoire</span>' : '<span class="chipp">Actif</span>') : '<span class="chipp dis">Désactivé</span>'}${u.role !== 'admin' && !u.cle && chiffreOn ? '<br><span class="chipp dis" title="Compte créé avant le chiffrement : définissez un mot de passe provisoire (bouton Mot de passe ou Clé USB)">Sans accès chiffré</span>' : ''}</td>
          <td>${frDateTime(u.lastLogin)}</td>
          <td><div class="btnrow" style="justify-content:flex-end">${u.role === 'admin' ? (u.id === S.user.id ? '<span class="muted" style="font-size:11.5px">Vous</span>' : '') : `
            <button class="small primary" data-a="kit" data-id="${u.id}" title="Préparer la clé USB de cet agent">Clé USB</button>
            <button class="small" data-a="edit" data-id="${u.id}">Droits</button>
            <button class="small" data-a="pw" data-id="${u.id}">Mot de passe</button>
            <button class="small" data-a="toggle" data-id="${u.id}">${u.active ? 'Désactiver' : 'Activer'}</button>
            <button class="small danger" data-a="del" data-id="${u.id}">Supprimer</button>`}</div></td></tr>`).join('')}
        </tbody></table></div>`;
    } else {
      const rows = logs.filter(l => !q || `${l.user} ${l.event} ${l.detail}`.toLowerCase().includes(q.toLowerCase()));
      body.innerHTML = head + `<input id="logQ" type="search" placeholder="Filtrer le journal (identifiant, action…)" value="${esc(q)}">
        <div style="overflow:auto;max-height:56vh"><table class="log"><thead><tr><th>Date</th><th>Compte</th><th>Action</th><th>Détail</th></tr></thead><tbody>
        ${rows.map(l => `<tr><td>${frDateTime(l.date)}</td><td>${esc(l.user)}</td><td>${esc(l.event)}</td><td>${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune entrée.</td></tr>'}
        </tbody></table></div><p class="muted" style="margin:0;font-size:11.5px">500 dernières entrées. Connexions, échecs de connexion, comptes, imports, enregistrements, exports et modifications de la base.</p>`;
      const qi = $('#logQ', body); qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; render(); const n = $('#logQ', body); n.focus(); n.setSelectionRange(pos, pos); };
    }
  };
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; await load(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const u = users.find(x => x.id === b.dataset.id);
    try {
      if (b.dataset.a === 'new') { if (await userDialog()) await load(); }
      if (b.dataset.a === 'edit') { if (await userDialog(u)) await load(); }
      if (b.dataset.a === 'pw') { if (await resetPwDialog(u)) await load(); }
      if (b.dataset.a === 'kit') { await kitDialog(u); await load(); }
      if (b.dataset.a === 'toggle') { await A().updateUser(u.id, { active: !u.active }); toast(u.active ? `Compte ${u.login} désactivé` : `Compte ${u.login} activé`); await load(); }
      if (b.dataset.a === 'del' && await confirmBox('Supprimer le compte', `Supprimer définitivement le compte « ${u.login} » (${u.name}) ?`, 'Supprimer', true)) { await A().deleteUser(u.id); toast('Compte supprimé'); await load(); }
    } catch (err) { toast(err.message, true); }
  });
  render(); load();
  await modal({ title: 'Administration', size: '', body, left: [{ label: 'Base des matériels…', action: () => { openDbEditor(); return false; } },
    { label: 'Règles d\'implantation…', action: () => { openReglesEditor(); return false; } },
    { label: 'Mot de passe oublié sur une clé Éditeur…', action: () => { resetOnKeyDialog().then(load); return false; } },
    { label: 'Charte des documents…', action: () => { openCharteEditor(); return false; } },
    { label: 'Exporter la configuration éditeurs', action: async () => {
        try { const p = await A().exportConfig(); if (p) await modal({ title: 'Configuration exportée', body: `<p style="margin:0">Fichier créé : <b style="user-select:text">${esc(p)}</b></p><p style="margin:0">Ce fichier est chiffré : seules les clés de votre organisation peuvent le lire. Il sert à mettre à jour les clés Éditeur déjà préparées (droits, base des matériels, charte, bâtiments) : l'agent se connecte puis choisit, dans le menu de son compte, « Mettre à jour la configuration ». Son mot de passe personnel est conservé.</p>`, size: 'md', buttons: [{ label: 'OK', cls: 'primary', value: true }] }); }
        catch (e) { toast(e.message, true); }
        return false; } }], buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
}

async function userDialog(u = null) {
  const edit = !!u; const perms = edit ? { ...u.perms } : Object.fromEntries(PRESETS['Implanteur'].map(p => [p, true]));
  const tmp = genPassword();
  const body = `
    <div class="row2">
      <label class="field"><span>Identifiant</span><input id="uLogin" type="text" value="${esc(u?.login || '')}" ${edit ? 'disabled' : 'placeholder="ex. j.dupont"'}></label>
      <label class="field"><span>Nom affiché</span><input id="uNameF" type="text" value="${esc(u?.name || '')}" placeholder="ex. Jean Dupont"></label>
    </div>
    ${edit ? `<label class="chk"><input id="uActive" type="checkbox" ${u.active ? 'checked' : ''}> Compte actif</label>` : `
    <label class="field"><span>Mot de passe provisoire (à communiquer à l'éditeur ; il le changera à sa première connexion)</span>
      <div class="pwrow"><input id="uPw" type="text" value="${tmp}" autocomplete="off"><button type="button" id="uGen">Générer</button></div></label>`}
    <div class="field"><span>Options accordées</span>
      <div class="presets">Modèles : ${Object.keys(PRESETS).map(k => `<button type="button" class="small" data-preset="${k}">${k}</button>`).join('')}</div>
      <div class="perm-list">${(S.permDefs || []).map(p => `<label class="perm"><input type="checkbox" data-perm="${p.id}" ${perms[p.id] ? 'checked' : ''}><div><b>${esc(p.label)}</b><span>${esc(p.desc)}</span></div></label>`).join('')}</div>
      <p class="muted" style="margin:0;font-size:11.5px">Sans aucune option, le compte peut seulement ouvrir et consulter les projets. La gestion des comptes reste réservée à l'administrateur.</p>
    </div>`;
  let created = null;
  const ok = await modal({
    title: edit ? `Droits de ${u.login}` : 'Nouveau compte éditeur', size: 'md', body,
    onMount: (root) => {
      root.addEventListener('click', (e) => {
        const pr = e.target.dataset.preset; if (pr) $$('[data-perm]', root).forEach(c => c.checked = PRESETS[pr].includes(c.dataset.perm));
        if (e.target.id === 'uGen') $('#uPw', root).value = genPassword();
      });
    },
    buttons: [{ label: 'Annuler', value: false }, {
      label: edit ? 'Enregistrer' : 'Créer le compte', cls: 'primary', action: async (root) => {
        const p = Object.fromEntries($$('[data-perm]', root).map(c => [c.dataset.perm, c.checked]));
        try {
          if (edit) { await A().updateUser(u.id, { name: $('#uNameF', root).value, perms: p, active: $('#uActive', root).checked }); toast('Compte mis à jour'); }
          else { created = { login: $('#uLogin', root).value.trim().toLowerCase(), pw: $('#uPw', root).value }; await A().createUser({ login: created.login, name: $('#uNameF', root).value, password: created.pw, perms: p }); }
          return true;
        } catch (e) { toast(e.message, true); return false; }
      }
    }]
  });
  if (ok && created) await credentialsBox('Compte créé', created.login, created.pw);
  return ok;
}
async function resetPwDialog(u) {
  const pw = genPassword();
  const ok = await modal({
    title: `Réinitialiser le mot de passe de ${u.login}`,
    body: `<p style="margin:0">Un mot de passe provisoire remplace l'actuel. ${esc(u.name)} devra en choisir un nouveau à sa prochaine connexion.</p>
      <label class="field"><span>Mot de passe provisoire</span><input id="rpPw" type="text" value="${pw}" autocomplete="off"></label>`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Réinitialiser', cls: 'primary', action: async (root) => { try { u._pw = $('#rpPw', root).value; await A().resetPassword(u.id, u._pw); return true; } catch (e) { toast(e.message, true); return false; } } }]
  });
  if (ok) await credentialsBox('Mot de passe réinitialisé', u.login, u._pw);
  return ok;
}
async function credentialsBox(title, login, pw) {
  await modal({
    title, body: `<p style="margin:0">Communiquez ces informations à l'éditeur. Le mot de passe provisoire ne sera plus affiché.</p>
      <dl class="kv" style="font-size:14px;gap:8px 14px"><dt>Identifiant</dt><dd><b style="user-select:text">${esc(login)}</b></dd><dt>Mot de passe provisoire</dt><dd><b style="font-family:var(--mono);user-select:text">${esc(pw)}</b></dd></dl>`,
    buttons: [{ label: 'Copier', action: async () => { try { await navigator.clipboard.writeText(`Identifiant : ${login}\nMot de passe provisoire : ${pw}`); toast('Copié'); } catch { toast('Copie impossible', true); } return false; } }, { label: 'Terminé', cls: 'primary', value: true }]
  });
}

/* ---------------------------------------------------------------- clé Éditeur */
async function kitDialog(u) {
  const canKeep = !!(u.cle && u.mustChange);
  let dest = null;
  const destHtml = (d) => !d ? '<span class="muted">Aucune clé choisie</span>' : `<b style="user-select:text">${esc(d.dest)}</b>
    ${d.existing && d.existing.comptes.length ? `<div class="warnbox" style="margin-top:8px">Cette clé contient déjà ${d.existing.comptes.length > 1 ? 'les comptes' : 'le compte'} « ${esc(d.existing.comptes.join(', '))} » : ${d.existing.comptes.length > 1 ? 'ils seront remplacés' : 'il sera remplacé'} par celui de ${esc(u.login)}. Les projets présents sont conservés et chiffrés.</div>` : ''}`;
  let result = null, pwUsed = null;
  const ok = await modal({
    title: `Clé USB de ${u.name} (${u.login})`, size: 'md',
    body: `<p style="margin:0">Le logiciel copie sur la clé de l'agent : le programme, la mise à jour en service, la base des matériels, la charte, la carte des bâtiments et <b>uniquement le compte de cet agent</b>. Toutes les données sont <b>chiffrées en AES-256</b> : si la clé est perdue, elles sont illisibles sans son mot de passe.</p>
      <div class="field"><span>Mot de passe provisoire (l'agent le remplacera à sa première connexion)</span>
        ${canKeep ? `<label class="chk"><input type="radio" name="kpw" value="keep"> Conserver le mot de passe provisoire déjà communiqué</label>` : ''}
        <label class="chk"><input type="radio" name="kpw" value="new" checked> Nouveau mot de passe provisoire</label>
        <div class="pwrow"><input id="kPw" type="text" value="${genPassword()}" autocomplete="off"><button type="button" id="kGen">Générer</button></div></div>
      <div class="field"><span>Clé USB de destination</span><div id="kDest">${destHtml(null)}</div>
        <div><button type="button" id="kPick">Choisir la clé USB…</button></div></div>
      <p class="muted" style="margin:0;font-size:11.5px">Branchez la clé de l'agent et choisissez sa racine (par exemple E:\). Copie de l'exécutable : environ 1 minute.</p>`,
    onMount: (root) => {
      $('#kGen', root).onclick = () => { $('#kPw', root).value = genPassword(); $('input[name=kpw][value=new]', root).checked = true; };
      $('#kPw', root).oninput = () => { $('input[name=kpw][value=new]', root).checked = true; };
      $('#kPick', root).onclick = async () => { try { const d = await window.native.kit.pick(); if (d) { dest = d; $('#kDest', root).innerHTML = destHtml(d); } } catch (e) { toast(e.message, true); } };
    },
    buttons: [{ label: 'Annuler', value: false }, {
      label: 'Préparer la clé', cls: 'primary', action: async (root, btn) => {
        if (!dest) { toast('Choisissez d\'abord la clé USB de l\'agent.', true); return false; }
        const keep = canKeep && $('input[name=kpw]:checked', root).value === 'keep';
        pwUsed = keep ? null : $('#kPw', root).value;
        if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
        try { result = await window.native.kit.prepare({ userId: u.id, password: pwUsed, dest: dest.dest }); return true; }
        catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = 'Préparer la clé'; } return false; }
      }
    }]
  });
  if (!ok || !result) return false;
  await modal({
    title: 'Clé Éditeur prête', size: 'md',
    body: `<p style="margin:0">La clé de <b>${esc(result.user.name)}</b> est prête : <b style="user-select:text">${esc(result.dest)}</b>${result.version ? ` (version ${esc(result.version)})` : ''}.</p>
      ${result.exe ? '' : '<div class="warnbox">L\'exécutable n\'a pas pu être copié automatiquement : copiez « Blackeyes Implantation.exe » à la racine de la clé.</div>'}
      <dl class="kv" style="font-size:14px;gap:8px 14px"><dt>Identifiant</dt><dd><b style="user-select:text">${esc(result.user.login)}</b></dd>
      <dt>Mot de passe provisoire</dt><dd>${pwUsed ? `<b style="font-family:var(--mono);user-select:text">${esc(pwUsed)}</b>` : '<span class="muted">inchangé (celui déjà communiqué)</span>'}</dd></dl>
      <p class="muted" style="margin:0;font-size:12px">Remettez le mot de passe provisoire à l'agent <b>séparément de la clé</b> (de vive voix, par téléphone ou SMS), jamais écrit sur la clé ni joint à elle. Il ne sera plus affiché.</p>`,
    buttons: [...(pwUsed ? [{ label: 'Copier', action: async () => { try { await navigator.clipboard.writeText(`Identifiant : ${result.user.login}\nMot de passe provisoire : ${pwUsed}`); toast('Copié'); } catch { toast('Copie impossible', true); } return false; } }] : []), { label: 'Terminé', cls: 'primary', value: true }]
  });
  return true;
}
async function resetOnKeyDialog() {
  let k; try { k = await window.native.kit.pickKey(); } catch (e) { toast(e.message, true); return; }
  if (!k) return;
  if (!k.chiffre) { toast('Cette clé n\'est pas encore chiffrée : préparez-la avec le bouton « Clé USB » du compte de l\'agent.', true); return; }
  let res = null, pw = genPassword();
  const ok = await modal({
    title: 'Mot de passe oublié sur une clé Éditeur', size: 'md',
    body: `<p style="margin:0">Clé : <b style="user-select:text">${esc(k.dest)}</b> — compte ${esc(k.comptes.join(', ') || '?')}.</p>
      <p style="margin:0">Un mot de passe provisoire remplace celui que l'agent a oublié. <b>Ses projets et ses données sont conservés.</b> Il choisira un nouveau mot de passe à sa prochaine connexion.</p>
      <label class="field"><span>Mot de passe provisoire</span><input id="roPw" type="text" value="${pw}" autocomplete="off"></label>`,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Réinitialiser sur la clé', cls: 'primary', action: async (root) => { try { pw = $('#roPw', root).value; res = await window.native.kit.resetOnKey({ password: pw, dest: k.dest }); return true; } catch (e) { toast(e.message, true); return false; } } }]
  });
  if (ok && res) await credentialsBox('Mot de passe réinitialisé sur la clé', res.login, pw);
}

/* ---------------------------------------------------------------- mise à jour du logiciel */
let majScanDone = false;
async function checkDroppedUpdate() {
  if (majScanDone || !window.native?.maj?.scan) return; majScanDone = true;
  let u = null; try { u = await window.native.maj.scan(); } catch { return; }
  if (!u) return;
  const go = await modal({
    title: 'Mise à jour disponible', size: 'md',
    body: `<p style="margin:0">Un paquet de mise à jour a été trouvé sur la clé : <b>version ${esc(u.version)}</b> (version actuelle : ${esc(u.current)}). Sa signature a été vérifiée.</p>
      ${u.notes.length ? `<ul style="margin:0;padding-left:18px">${u.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`,
    buttons: [{ label: 'Plus tard', value: false }, { label: `Installer la version ${u.version}`, cls: 'primary', value: true }]
  });
  if (!go) return;
  try { const r = await window.native.maj.install(u.path); await restartAfter(`Version ${r.version} installée sur la clé.`); }
  catch (e) { toast(e.message, true); }
}

async function majDialog() {
  let st; try { st = await window.native.maj.status(); } catch (e) { toast(e.message, true); return; }
  let chosen = null;
  const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  const render = () => {
    body.innerHTML = `
      <dl class="kv" style="font-size:13px"><dt>Version utilisée</dt><dd><b>${esc(st.current)}</b>${st.updated ? ' (mise à jour installée)' : ''}</dd>
        <dt>Version de l'exécutable</dt><dd>${esc(st.builtin)}</dd></dl>
      ${st.incident ? `<div class="warnbox">${esc(st.incident)}</div>` : ''}
      <p style="margin:0">Choisissez le fichier <b>.bkmaj</b> reçu. Le logiciel vérifie sa signature et l'intégrité de chaque fichier avant de l'installer sur la clé ; un paquet modifié ou d'une autre origine est refusé.</p>
      ${chosen ? `<div class="${chosen.newer ? 'okbox' : 'warnbox'}"><b>Version ${esc(chosen.version)}</b> du ${new Date(chosen.date).toLocaleDateString('fr-FR')} — signature vérifiée.${chosen.newer ? '' : ` Cette version n'est pas plus récente que la ${esc(chosen.current)}.`}
        ${chosen.notes.length ? `<ul style="margin:6px 0 0;padding-left:18px">${chosen.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      <div class="btnrow"><button type="button" id="mjChoose">${chosen ? 'Choisir un autre paquet…' : 'Choisir un paquet…'}</button>
        ${chosen && chosen.newer ? '<button type="button" class="primary" id="mjInstall">Installer la version ' + esc(chosen.version) + '</button>' : ''}
        ${st.updated && S.user.role === 'admin' ? '<button type="button" class="ghost" id="mjBack">Revenir à la version d\'origine</button>' : ''}</div>`;
    $('#mjChoose', body).onclick = async () => { try { chosen = await window.native.maj.choose(); render(); } catch (e) { chosen = null; render(); toast(e.message, true); } };
    const ins = $('#mjInstall', body); if (ins) ins.onclick = async () => {
      ins.disabled = true; ins.textContent = 'Installation…';
      try { const r = await window.native.maj.install(chosen.path); await restartAfter(`Version ${r.version} installée sur la clé.`); }
      catch (e) { toast(e.message, true); ins.disabled = false; ins.textContent = 'Installer la version ' + chosen.version; }
    };
    const back = $('#mjBack', body); if (back) back.onclick = async () => {
      if (!(await confirmBox('Revenir à la version d\'origine', `Désactiver la mise à jour ${st.current} et revenir à la version ${st.builtin} de l'exécutable ?`, 'Revenir', true))) return;
      try { await window.native.maj.rollback(); await restartAfter(`Version d'origine ${st.builtin} rétablie.`); } catch (e) { toast(e.message, true); }
    };
  };
  render();
  await modal({ title: 'Mise à jour du logiciel', size: 'md', body, buttons: [{ label: 'Fermer', value: null }] });
}
async function restartAfter(msg) {
  const go = await modal({ title: 'Redémarrage nécessaire', body: `<p style="margin:0">${esc(msg)} Le logiciel doit redémarrer pour l'appliquer.</p>`, buttons: [{ label: 'Plus tard', value: false }, { label: 'Redémarrer maintenant', cls: 'primary', value: true }] });
  if (go && (await guardUnsaved())) { try { await A().logout(); } catch {} window.native.maj.restart(); }
  else toast('La nouvelle version sera utilisée au prochain lancement.');
}
