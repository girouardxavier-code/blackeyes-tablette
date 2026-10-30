/* Blackeyes 2 — plans partagés : base interne des plans téléchargeables sur téléphone par QR code.
   - « Sur un téléphone » : les plans choisis sont mis en PDF et enregistrés dans la base des plans partagés
     (chiffrés sur la clé) ; un QR code autorise leur téléchargement.
   - « Plans partagés » : depuis le PC, autoriser, suspendre ou supprimer chaque partage, voir les téléchargements,
     activer l'accès hors Wi-Fi (Internet).
   Le PDF est chiffré de bout en bout : la clé n'existe que dans le QR code, le téléphone le déchiffre lui-même. */
'use strict';

const PT = { root: null, bound: false, state: null, refresh: null };
const ptAvailable = () => !!(window.native && window.native.partages);

function ptBind() {
  if (PT.bound || !ptAvailable()) return; PT.bound = true;
  const again = async () => { if (!PT.refresh) return; try { PT.state = await window.native.partages.list(); PT.refresh(); } catch {} };
  window.native.partages.onDownload(() => { toast('📱 Plans téléchargés sur un téléphone'); again(); });
  window.native.partages.onTunnel(() => again());
}

async function shareToPhone() {
  if (!ptAvailable()) { toast('Fonction disponible sur le logiciel PC et Mac.', true); return; }
  if (!need('exportPdf')) return;
  if (!S.project || !S.project.levels.length) { toast('Ouvrez d\'abord un projet avec au moins un plan.', true); return; }
  ptBind();
  const r = await chooseExport({ title: 'Partager des plans (lien interactif et QR code)', okLabel: 'Créer le partage',
    intro: 'Les plans choisis sont ajoutés à la base des plans partagés (chiffrée sur la clé). Le lien et le QR code ouvrent une visionneuse interactive (zoom, matériels, fiches) et permettent de télécharger le PDF. Vous gardez la main depuis ce poste ou tout poste où la clé est branchée : suspendre, supprimer.',
    extraHtml: `<div class="row2"><label class="field"><span>Nom du partage</span><input id="ptN" type="text" value="${esc((S.project.site || S.project.name || 'Plans') + ' — plans')}"></label>
      <label class="field"><span>Autorisation</span><select id="ptE"><option value="">Sans limite de durée</option><option value="1">1 jour</option><option value="7">7 jours</option><option value="30">30 jours</option></select></label></div>
      <div class="row2"><label class="field"><span>Code d'accès (facultatif, 4 caractères ou plus)</span><input id="ptC" type="text" autocomplete="off" placeholder="sans code"></label>
      <label class="field"><span>PDF joint</span><select id="ptF"><option value="a4">A4 paysage, avec légende</option><option value="a3">A3 paysage, avec légende</option></select></label></div>`,
    items: levelItems(), readExtra: (root) => { const code = $('#ptC', root).value.trim(); if (code && code.length < 4) { toast('Code d\'accès : 4 caractères au moins.', true); return false; } return { nom: $('#ptN', root).value.trim() || 'Plans', jours: +$('#ptE', root).value || 0, fmt: $('#ptF', root).value, legende: true, code }; } });
  if (!r) return;
  toast('Création du partage…');
  let out;
  try {
    const x = await docCtx(); await fiLoad();
    const lv = S.project.levels.filter(l => r.sel.has('lvl:' + l.id));
    const niveaux = [], used = new Set();
    for (const l of lv) {
      const img = await loadImg(l.plan.dataUrl); const k = Math.min(1, 3000 / Math.max(l.plan.w, l.plan.h));
      const c = document.createElement('canvas'); c.width = Math.round(l.plan.w * k); c.height = Math.round(l.plan.h * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      niveaux.push({ nom: lvLabel(l), img: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height, m: l.markers.map(m => { used.add(m.typeId); return { x: Math.round(m.x * k * 10) / 10, y: Math.round(m.y * k * 10) / 10, t: m.typeId, lab: m.label || '', loc: m.local || '', note: m.note || '' }; }) });
    }
    const types = {};
    for (const id of used) {
      const t = typeOf(id); const f = ficheOf(t); let icone = '';
      if (t.img) { try { const im = await loadImg(t.img); const q = Math.min(1, 96 / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * q)); c.height = Math.max(1, Math.round(im.naturalHeight * q)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); icone = c.toDataURL('image/png'); } catch {} }
      types[id] = { nom: t.nom, code: t.code, couleur: t.couleur, sys: t.sys, icone, img: icone, fiche: { description: f.description, caracs: f.caracs.filter(c => c.v), pose: f.pose } };
    }
    const pdf = await plansPdf(r);
    const bundle = { v: 1, titre: r.nom, site: x.site, sub: [x.ch.organisme, S.project.reference ? `Réf. ${S.project.reference}` : '', x.date].filter(Boolean).join(' · '), mention: x.ch.mention || '', couleur: x.ch.couleur || '', niveaux, types, pdf: { nom: pdf.name, b64: bytesToB64(pdf.data) } };
    const paquet = new TextEncoder().encode(JSON.stringify(bundle));
    out = await window.native.partages.create({ paquet, fichier: pdf.name, nom: r.nom, site: x.site, plans: lv.map(l => lvLabel(l)), expire: r.jours ? Date.now() + r.jours * 86400000 : null, code: r.code || null });
  } catch (e) { console.error(e); toast('Partage impossible : ' + e.message, true); return; }
  PT.state = out.state;
  await ptQrDialog(out.share.id);
}

/* adresses possibles d'un partage : Internet (si le tunnel est actif) puis réseaux locaux */
function ptLinks(x) {
  const st = PT.state, out = [];
  if (st.tunnel.url) out.push({ label: 'Internet — partout (4G, autre Wi-Fi)', url: `${st.tunnel.url}/p/${x.id}/#${x.cle}`, net: true });
  for (const a of st.lan) out.push({ label: `Wi-Fi / réseau local — ${a.iface} (${a.ip})`, url: `${a.base}/p/${x.id}/#${x.cle}` });
  return out;
}
const ptQr = (text) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); };
const ptDate = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const ptStatus = (x) => !x.actif ? ['Suspendu', 'dis'] : (x.expire && Date.parse(x.expire) < Date.now()) ? ['Expiré', 'dis'] : ['Autorisé', 'ok'];

async function ptQrDialog(id) {
  ptBind();
  let cur = 0;
  await modal({ title: '📱 QR code du partage', size: 'lg', body: '<div class="ph-body"></div>',
    onMount: (root) => {
      const draw = () => {
        const x = PT.state.shares.find(s => s.id === id); const box = $('.ph-body', root); if (!x || !box) return;
        const links = ptLinks(x); if (cur >= links.length) cur = 0; const L = links[cur];
        const [stl, stc] = ptStatus(x);
        box.innerHTML = `<div class="ph-wrap">
          <div class="ph-qr">${L ? ptQr(L.url) : '<p class="muted" style="padding:20px">Aucun réseau disponible.</p>'}</div>
          <div class="ph-info">
            <p style="margin:0"><b>${esc(x.nom)}</b> <span class="chipp ${stc}">${stl}</span></p>
            <p class="muted" style="margin:0;font-size:12.5px">${esc(x.plans.join(', '))} · ${(x.taille / 1048576).toFixed(1).replace('.', ',')} Mo · ${x.expire ? 'autorisé jusqu\'au ' + esc(ptDate(x.expire)) : 'sans limite de durée'} · ${x.code ? '🔒 code d\'accès demandé' : 'sans code d\'accès'}</p>
            <p style="margin:0">Scannez ce QR code avec l'appareil photo du téléphone (iPhone ou Android), ou envoyez le lien : il ouvre les plans interactifs (zoom, matériels, fiches) et le PDF à télécharger.</p>
            ${links.length > 1 ? `<label class="field"><span>Accès</span><select class="ph-net">${links.map((l, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>` : ''}
            ${L ? `<div class="ph-url"><code>${esc(L.url.split('#')[0])}#…</code><button type="button" class="small ph-copy">Copier le lien</button></div>
            <div class="btnrow"><button type="button" class="primary ph-mail">✉️ Envoyer par e-mail…</button><button type="button" class="ph-qrimg">Copier l'image du QR code</button></div>` : ''}
            <p style="margin:0;font-size:12.5px">${(x.historique || []).length ? `✔ Téléchargé ${x.historique.length} fois — dernier : ${esc(ptDate(x.historique.at(-1).t))}` : 'Pas encore téléchargé.'}</p>
            <div class="warnbox" style="font-size:12.5px;line-height:1.45">
              ${PT.state.tunnel.url ? '<b>Accès Internet actif</b> : le téléphone peut télécharger depuis n\'importe où. L\'adresse Internet change à chaque démarrage de Blackeyes 2 : rouvrez alors ce QR code depuis « Plans partagés ».' : '<b>Accès Wi-Fi seulement</b> : le téléphone doit être sur le même réseau que ce poste. Pour télécharger depuis n\'importe où, activez l\'accès Internet dans « Plans partagés ».'}<br>
              Le téléchargement fonctionne tant que Blackeyes 2 est ouvert sur ce poste. Vous pouvez suspendre ou supprimer ce partage à tout moment depuis « Plans partagés ».
            </div>
          </div></div>`;
        const net = $('.ph-net', box); if (net) net.onchange = () => { cur = +net.value; draw(); };
        const ml = $('.ph-mail', box); if (ml) ml.onclick = async () => { await ptMailDialog(id, cur); draw(); };
        const qi = $('.ph-qrimg', box); if (qi) qi.onclick = async () => { try { await window.native.partages.copyQr(ptQrPng(L.url)); toast('Image du QR code copiée : collez-la (Ctrl+V) dans un e-mail ou un document'); } catch (e) { toast(e.message, true); } };
        const cp = $('.ph-copy', box); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(L.url); toast('Lien copié (il contient la clé : ne le diffusez qu\'aux personnes autorisées)'); } catch { toast('Copie impossible.', true); } };
      };
      PT.refresh = draw; draw();
    },
    buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
  PT.refresh = null;
}

/* QR code en image PNG (pour le coller dans un e-mail ou un document) */
function ptQrPng(text, cell = 8, margin = 4) {
  const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(), W = (n + margin * 2) * cell;
  const c = document.createElement('canvas'); c.width = W; c.height = W; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, W); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + margin) * cell, (r + margin) * cell, cell, cell);
  return c.toDataURL('image/png');
}
/* envoi du lien par e-mail : message prêt dans la messagerie du poste ; le code d'accès n'y figure jamais */
async function ptMailDialog(id, cur = 0) {
  let x = PT.state.shares.find(s => s.id === id); if (!x) return;
  const links = ptLinks(x); if (!links.length) { toast('Aucun réseau disponible pour ce partage.', true); return; }
  const L = links[Math.min(cur, links.length - 1)].net ? links[Math.min(cur, links.length - 1)] : (links.find(l => l.net) || links[Math.min(cur, links.length - 1)]);
  const moi = (S.user && (S.user.name || S.user.login)) || '';
  const texte = (x) => ['Bonjour,', '', `Voici le lien sécurisé pour consulter les plans « ${x.nom} »${x.plans.length ? ` (${x.plans.join(', ')})` : ''} :`, L.url, '',
    'Ouvrez-le sur un téléphone, une tablette ou un ordinateur : il affiche les plans interactifs (zoom, matériels et leurs fiches) et permet de télécharger le PDF.',
    ...(x.code ? ['Un code d\'accès vous sera demandé : il vous est communiqué séparément.'] : []),
    ...(x.expire ? [`Ce lien est valable jusqu'au ${ptDate(x.expire)}.`] : []),
    ...(!L.net ? ['Ce lien ne fonctionne que sur le même réseau Wi-Fi que le poste qui partage les plans.'] : []),
    '', 'Document confidentiel — merci de ne pas transférer ce message.', '', moi].join('\n');
  const r = await modal({ title: '✉️ Envoyer le lien par e-mail', size: 'lg', body: `
      <label class="field"><span>Destinataire(s) — séparez les adresses par une virgule (facultatif : vous pourrez les saisir dans la messagerie)</span><input id="mlTo" type="text" placeholder="prenom.nom@exemple.fr"></label>
      <label class="field"><span>Objet</span><input id="mlObj" type="text" value="${esc('Plans — ' + x.nom)}"></label>
      <label class="field"><span>Message</span><textarea id="mlMsg" rows="11">${esc(texte(x))}</textarea></label>
      <div class="ml-warn"></div>
      <p class="muted" style="margin:0;font-size:12px">« Ouvrir la messagerie » prépare le message dans la messagerie de ce poste (Outlook, Mail…) : vérifiez-le puis envoyez-le depuis la messagerie. Pour joindre le QR code, utilisez « Copier l'image du QR code » puis collez-la dans le message.</p>`,
    onMount: (root) => {
      const warn = () => { const w = $('.ml-warn', root); w.innerHTML = `${!x.code ? `<div class="warnbox" style="font-size:12.5px">🔒 <b>Conseillé :</b> ce partage n'a pas de code d'accès. Le lien contient la clé des plans : toute personne qui reçoit l'e-mail pourrait les ouvrir. Définissez un code et communiquez-le par un autre moyen (SMS, téléphone). <button type="button" class="small ml-code">Définir un code…</button></div>` : '<div class="okbox" style="font-size:12.5px">🔒 Code d\'accès actif : communiquez-le par un autre moyen que l\'e-mail (SMS, téléphone).</div>'}
        ${!L.net ? '<div class="warnbox" style="font-size:12.5px">📶 <b>Lien Wi-Fi</b> : il ne fonctionne que sur le même réseau que ce poste. Pour un destinataire extérieur, activez l\'accès hors Wi-Fi dans « Plans partagés » puis rouvrez cette fenêtre.</div>' : ''}`;
        const b = $('.ml-code', root); if (b) b.onclick = async () => { const c = await askText('Définir un code d\'accès', 'Code d\'accès (4 caractères ou plus)', ''); if (!c || !c.trim()) return;
          try { PT.state = await window.native.partages.update(id, { code: c.trim() }); x = PT.state.shares.find(s => s.id === id); $('#mlMsg', root).value = texte(x); warn(); toast('Code d\'accès défini'); } catch (e) { toast(e.message, true); } }; };
      warn();
    },
    buttons: [{ label: 'Copier l\'image du QR code', action: async () => { try { await window.native.partages.copyQr(ptQrPng(L.url)); toast('Image du QR code copiée'); } catch (e) { toast(e.message, true); } return false; } },
      { label: 'Annuler', value: null },
      { label: 'Ouvrir la messagerie', cls: 'primary', action: async (root) => {
        try { await window.native.partages.mail(id, { to: $('#mlTo', root).value, objet: $('#mlObj', root).value, message: $('#mlMsg', root).value }); toast('Message préparé dans la messagerie : vérifiez-le puis envoyez-le.'); return true; }
        catch (e) { toast(e.message, true); return false; } } }] });
  return r;
}

async function openPartages() {
  if (!ptAvailable()) { toast('Fonction disponible sur le logiciel PC et Mac.', true); return; }
  if (!need('exportPdf')) return;
  ptBind();
  try { PT.state = await window.native.partages.list(); } catch (e) { toast(e.message, true); return; }
  await modal({ title: '📱 Plans partagés', size: 'lg', body: '<div class="pt-body"></div>',
    onMount: (root) => {
      const draw = () => {
        const st = PT.state; const box = $('.pt-body', root); if (!box) return;
        const tun = st.tunnel;
        box.innerHTML = `<div class="pt-net">
            <label class="chk"><input type="checkbox" class="pt-inet" ${st.internet ? 'checked' : ''} ${tun.disponible ? '' : 'disabled'}> <b>Accès hors Wi-Fi (Internet)</b></label>
            <small class="muted">${!tun.disponible ? 'Composant « cloudflared » absent du dossier « outils » de la clé.' : tun.url ? `Actif : ${esc(tun.url)}` : st.internet ? (tun.erreur ? `<span style="color:#b91c1c">${esc(tun.erreur)}</span>` : 'Connexion en cours…') : 'Désactivé : téléchargement possible uniquement sur le même Wi-Fi que ce poste.'}</small>
            <small class="muted">Wi-Fi : ${st.lan.length ? st.lan.map(a => esc(a.ip)).join(', ') : 'aucun réseau'} — port ${st.port}</small>
          </div>
          ${st.shares.length ? `<table class="pt-tab"><thead><tr><th>Partage</th><th>Créé</th><th>État</th><th>Téléchargements</th><th></th></tr></thead><tbody>
            ${st.shares.map(x => { const [l, c] = ptStatus(x); const h = x.historique || []; return `<tr>
              <td><b>${esc(x.nom)}</b><small>${esc(x.plans.join(', '))}${x.expire ? ` · jusqu'au ${esc(ptDate(x.expire))}` : ' · sans limite'}${x.code ? ' · 🔒 code' : ''}</small></td>
              <td><small>${esc(ptDate(x.cree))}${x.par ? '<br>' + esc(x.par) : ''}</small></td>
              <td><span class="chipp ${c}">${l}</span></td>
              <td>${h.length}${h.length ? `<small>dernier ${esc(ptDate(h.at(-1).t))} · ${esc(h.at(-1).via === 'internet' ? 'Internet' : 'Wi-Fi')}${h.at(-1).app ? ' · ' + esc(h.at(-1).app) : ''}</small>` : ''}</td>
              <td class="pt-act"><button class="small primary" data-a="qr" data-id="${x.id}">QR code</button>
                <button class="small" data-a="tog" data-id="${x.id}">${x.actif ? 'Suspendre' : 'Autoriser'}</button>
                <button class="small ghost" data-a="code" data-id="${x.id}">${x.code ? '🔒 Code…' : 'Code…'}</button>
                <button class="small ghost" data-a="mail" data-id="${x.id}">✉️ E-mail…</button>
                ${h.length ? `<button class="small ghost" data-a="hist" data-id="${x.id}">Historique</button>` : ''}
                <button class="small danger" data-a="del" data-id="${x.id}">Supprimer</button></td></tr>`; }).join('')}
          </tbody></table>` : '<p class="muted">Aucun partage. Ouvrez un projet puis « Exporter ▾ > Sur un téléphone » pour en créer un.</p>'}`;
        const inet = $('.pt-inet', box); if (inet) inet.onchange = async () => { inet.disabled = true; try { PT.state = await window.native.partages.internet(inet.checked); } catch (e) { toast(e.message, true); } draw(); };
        $$('[data-a]', box).forEach(b => b.onclick = async () => {
          const id = b.dataset.id, x = st.shares.find(s => s.id === id);
          try {
            if (b.dataset.a === 'qr') { PT.refresh = null; await ptQrDialog(id); PT.refresh = draw; draw(); return; }
            if (b.dataset.a === 'mail') { PT.refresh = null; await ptMailDialog(id); PT.refresh = draw; draw(); return; }
            if (b.dataset.a === 'tog') PT.state = await window.native.partages.update(id, { actif: !x.actif });
            if (b.dataset.a === 'code') { const c = await askText(x.code ? 'Changer le code d\'accès (laisser vide pour le retirer)' : 'Définir un code d\'accès', 'Code d\'accès (4 caractères ou plus)', ''); if (c === null || c === undefined) return; PT.state = await window.native.partages.update(id, { code: c.trim() || null }); toast(c.trim() ? 'Code d\'accès défini' : 'Code d\'accès retiré'); }
            if (b.dataset.a === 'del') { if (!(await confirmBox('Supprimer le partage', `Supprimer le partage « ${x.nom} » ? Son QR code ne fonctionnera plus.`, 'Supprimer', true))) return; PT.state = await window.native.partages.remove(id); }
            if (b.dataset.a === 'hist') { await modal({ title: 'Téléchargements — ' + x.nom, body: `<table class="pt-tab"><thead><tr><th>Date</th><th>Accès</th><th>Appareil</th><th>Adresse</th></tr></thead><tbody>${(x.historique || []).slice().reverse().map(h => `<tr><td>${esc(ptDate(h.t))}</td><td>${h.via === 'internet' ? 'Internet' : 'Wi-Fi'}</td><td>${esc(h.app || '')}</td><td>${esc(h.ip)}</td></tr>`).join('')}</tbody></table>`, buttons: [{ label: 'Fermer', cls: 'primary', value: true }] }); }
            draw();
          } catch (e) { toast(e.message, true); }
        });
      };
      PT.refresh = draw; draw();
    },
    buttons: [{ label: 'Fermer', cls: 'primary', value: true }] });
  PT.refresh = null;
}
