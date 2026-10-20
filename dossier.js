/* Blackeyes Implantation — documents : charte commune, dossier d'implantation (Word + PDF), PowerPoint et planches A3
   Un seul modèle de contenu (buildDossier) alimente le Word et le PDF : mêmes chapitres, mêmes tableaux, même charte. */
'use strict';

const FONT = 'Segoe UI';
const INK = '121A26', MUTED = '5A6577', LINE = 'D6DCE5', SOFT = 'F3F5F8', DARK = '0F1724', RED = 'C8102E';
const rgb = (h) => (h || '#64748b').replace('#', '').match(/\w\w/g).map(x => parseInt(x, 16));
let CHARTE = null;

/* ---------------------------------------------------------------- charte et contexte */
async function loadCharte(force = false) {
  if (CHARTE && !force) return CHARTE;
  try { CHARTE = await window.native.charte.load(); } catch { CHARTE = { organisme: '', service: '', titre: 'Dossier d\'implantation du système de sûreté BLACKEYES', mention: 'Document confidentiel — diffusion restreinte.', couleur: '#1D4FB8', logo: '' }; }
  return CHARTE;
}
async function docCtx() {
  const ch = await loadCharte();
  let bat = null;
  let terr = null;
  if (S.project.batimentId) { try { await loadBatiments(); const f = batFind(S.project.batimentId); if (f) { bat = f.b; terr = f.t; } } catch {} }
  const commune = terr?.commune?.nom || '';
  return {
    ch, bat, terr, acc: hex(ch.couleur),
    site: S.project.site || bat?.nom || S.project.name,
    client: S.project.client || terr?.nom || '',
    adresse: bat?.adresse ? `${bat.adresse}${commune ? ', ' + commune : ''}` : '',
    ref: S.project.reference || 'Non renseignée', ind: (S.project.indice || 'A').toUpperCase(),
    date: frDate(S.project.date), redac: S.project.author || '', verif: S.project.verificateur || '',
    objet: S.project.objet || ''
  };
}
const typesOfLevel = (l) => [...new Set(l.markers.map(m => m.typeId))].map(typeOf).sort((a, b) => S.db.indexOf(a) - S.db.indexOf(b));
const sortedMarkers = (l) => l.markers.slice().sort((a, b) => (a.label || '').localeCompare(b.label || '', 'fr', { numeric: true }));
const orient = (m) => hasDirection(m) ? `${Math.round(m.rot)}°` : '—';
function cartoucheRows(x, l, page, pages) {
  return [...(x.client ? [['Client', x.client]] : []), ['Site', x.site], ['Niveau', l ? l.name : 'Synthèse'], ['Référence', `${x.ref} · indice ${x.ind}`], ['Date', x.date], ['Établi par', x.redac || '—'], ['Planche', `${page} / ${pages}`]];
}
const STAT_LABEL = { equipe: 'Équipé', en_cours: 'Implantation établie', a_equiper: 'À équiper', autre: 'Hors programme' };

/* ---------------------------------------------------------------- modèle du dossier */
async function buildDossier(opts) {
  const x = await docCtx(); const lv = S.project.levels; const types = usedTypes(); const all = allMarkers();
  const P = []; // pages logiques : { orient, blocks }
  const sec = (orient) => { const s = { orient, blocks: [] }; P.push(s); return s.blocks; };
  // 1. présentation + synthèse
  let b = sec('portrait');
  b.push({ t: 'cover' }, { t: 'toc' });
  b.push({ t: 'h1', text: '1. Présentation', pageBreak: true });
  b.push({ t: 'h2', text: '1.1 Site' });
  b.push({ t: 'kv', rows: [...(x.client ? [['Client', x.client]] : []), ['Bâtiment', x.site], ['Adresse', x.adresse || '—'], ...(x.bat ? [['Statut Blackeyes', STAT_LABEL[x.bat.statut] || '—'], ['Alarme existante', x.bat.alarme || '—']] : []), ['Niveaux étudiés', lv.map(l => l.name).join(', ') || '—'], ['Matériels implantés', String(all.length)]] });
  if (x.objet) { b.push({ t: 'h2', text: '1.2 Objet et observations' }); x.objet.split(/\n+/).forEach(p => b.push({ t: 'p', text: p })); }
  b.push({ t: 'h2', text: x.objet ? '1.3 Principe du système' : '1.2 Principe du système' });
  [
    'Le système BLACKEYES associe une protection anti-intrusion (détection de mouvement, ouverture de porte, levée de doute photographique) et des dispositifs anti-agression (bouton d\'alerte, vigie de levée de doute, blocage de porte).',
    'La centrale pilote l\'ensemble des dispositifs par liaison radio sécurisée. Lorsqu\'un détecteur se déclenche, l\'alarme est déclenchée, les sirènes activées et l\'alerte transmise au centre de vidéoprotection et au poste de Police municipale, qui procède à la levée de doute et engage les effectifs.',
    'En cas de tentative de brouillage, la centrale bascule sur une fréquence libre et le signale. Elle reste opérationnelle en cas de coupure électrique ou Internet grâce à sa batterie de secours et à sa liaison GSM/4G.'
  ].forEach(t => b.push({ t: 'p', text: t }));
  { const cams = all.filter(m => typeOf(m.typeId).sys === 'Vidéoprotection'); if (cams.length) {
    const ext = cams.filter(m => m.typeId === 'vpext').length, int = cams.filter(m => m.typeId === 'vsint').length, other = cams.length - ext - int;
    b.push({ t: 'h2', text: 'Vidéoprotection et vidéosurveillance' });
    b.push({ t: 'p', text: `${cams.length} caméra(s) repérée(s) sur les plans : ${[ext && `${ext} de vidéoprotection extérieure`, int && `${int} de vidéosurveillance intérieure`, other && `${other} autre(s)`].filter(Boolean).join(', ')}. Leur emplacement et leur champ de vision (indicatif) figurent sur les plans d'implantation ; elles ne font pas partie de la fourniture BLACKEYES et facilitent la levée de doute et la coordination avec les forces de l'ordre.` });
  } }
  if (x.bat && x.terr && typeof camsNear === 'function') { const near = camsNear(x.terr, x.bat, 150); if (near.length) {
    if (!all.some(m => typeOf(m.typeId).sys === 'Vidéoprotection')) b.push({ t: 'h2', text: 'Vidéoprotection et vidéosurveillance' });
    b.push({ t: 'p', text: `Carte : ${near.length} caméra(s) associée(s) au bâtiment ou à moins de 150 m — ${near.map(({ c, d, dir }) => `${c.nom} (${(CAM_T[c.type] || CAM_T.vp).label.toLowerCase()}${d !== null ? `, ${Math.round(d)} m au ${dir}` : ''}${c.exploitant ? `, ${c.exploitant}` : ''})`).join(' ; ')}.` });
  } }
  b.push({ t: 'h1', text: '2. Synthèse quantitative', pageBreak: true });
  b.push({ t: 'p', text: `${all.length} matériel(s) répartis sur ${lv.length} niveau(x).`, muted: true });
  b.push({
    t: 'table', head: ['Matériel', 'Système', ...lv.map(l => l.name), 'Total'],
    widths: [30, 18, ...lv.map(() => 40 / Math.max(1, lv.length)), 12], align: ['l', 'l', ...lv.map(() => 'c'), 'c'],
    rows: types.map(t => { const per = lv.map(l => l.markers.filter(m => m.typeId === t.id).length); return [t.nom, t.sys, ...per.map(n => n ? String(n) : '—'), String(per.reduce((a, c) => a + c, 0))]; }),
    total: ['Total', '', ...lv.map(l => String(l.markers.length)), String(all.length)]
  });
  // 2. plans
  let n = 0;
  for (const l of lv) {
    n++; b = sec('landscape');
    const r = await rasterLevel(l, 3000);
    const lt = typesOfLevel(l);
    b.push({ t: 'h1', text: n === 1 ? '3. Plans d\'implantation' : null, sub: `3.${n} ${lvLabel(l)}`, plan: true });
    b.push({ t: 'image', url: r.url, w: r.w, h: r.h, caption: `${lvLabel(l)} — ${l.markers.length} matériel(s)${isPhoto(l) ? ' · photo du site, pose indicative' : l.scale ? ' · zones de détection et échelle graphique à l\'échelle du plan' : ' · échelle non définie'}` });
    b = sec('landscape');
    b.push({ t: 'h2', text: `3.${n} ${lvLabel(l)} — légende et repères`, keep: true });
    if (lt.length) b.push({ t: 'legend', items: lt.map(t => ({ t, n: l.markers.filter(m => m.typeId === t.id).length })) });
    b.push(l.markers.length ? {
      t: 'table', head: ['Repère', 'Matériel', 'Local / pièce', 'Orientation', 'Observations'], widths: [10, 24, 22, 11, 33], align: ['l', 'l', 'l', 'c', 'l'],
      rows: sortedMarkers(l).map(m => [m.label, typeOf(m.typeId).nom, m.local || '—', orient(m), m.note || ''])
    } : { t: 'p', text: 'Aucun matériel sur ce niveau.', muted: true });
  }
  // 3. reportage photographique + fiches + visas
  b = sec('portrait');
  let ch = 4;
  const rp = opts.photos ? reportPhotos() : [];
  if (rp.length) {
    b.push({ t: 'h1', text: `${ch}. Reportage photographique`, pageBreak: true });
    b.push({ t: 'p', text: `${rp.length} photo(s) prise(s) sur le site.`, muted: true });
    b.push({ t: 'photos', items: rp.map((p, i) => ({ url: p.url, w: p.w, h: p.h, caption: photoCaption(p, i) })) });
    ch++;
  }
  if (opts.fiches && types.length) {
    b.push({ t: 'h1', text: `${ch}. Fiches matériels`, pageBreak: true });
    types.forEach((t, i) => b.push({ t: 'fiche', type: t, qty: all.filter(m => m.typeId === t.id).length, num: `${ch}.${i + 1}` }));
    ch++;
  }
  b.push({ t: 'h1', text: `${ch}. Suivi et validation`, pageBreak: !(opts.fiches && types.length) || true });
  b.push({ t: 'h2', text: 'Historique des indices' });
  b.push({ t: 'table', head: ['Indice', 'Date', 'Objet de la modification', 'Établi par'], widths: [12, 16, 50, 22], align: ['c', 'c', 'l', 'l'], rows: [[x.ind, x.date, x.ind === 'A' ? 'Première émission' : 'Mise à jour', x.redac || '']] });
  b.push({ t: 'h2', text: 'Visas' });
  b.push({ t: 'visas', rows: [['Rédigé par', x.redac], ['Vérifié par', x.verif], ['Approuvé par', '']] });
  return { x, pages: P };
}

/* ---------------------------------------------------------------- rendu Word (.docx) */
async function renderDocx(model) {
  const D = window.docx; const { x } = model; const acc = x.acc;
  const A4 = { width: 11906, height: 16838 }, M = 1020; // marges 1,8 cm
  const CW = { portrait: A4.width - 2 * M, landscape: A4.height - 2 * M };
  const bytes = (u) => dataUrlToBytes(u);
  const logo = x.ch.logo ? await imgSize(x.ch.logo).then(s => ({ data: bytes(x.ch.logo), ...s })) : null;
  const run = (text, o = {}) => new D.TextRun({ text: String(text ?? ''), font: FONT, ...o });
  const para = (children, o = {}) => new D.Paragraph({ children: Array.isArray(children) ? children : [children], ...o });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const cell = (content, w, o = {}) => new D.TableCell({
    width: { size: w, type: D.WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border },
    shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }, verticalAlign: o.vAlign || D.VerticalAlign.CENTER,
    children: Array.isArray(content) ? content : [para(run(content, { size: o.size || 18, bold: o.bold, color: o.color || INK }), { alignment: o.align === 'c' ? D.AlignmentType.CENTER : o.align === 'r' ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT })]
  });
  const table = (blk, cw) => {
    const sum = blk.widths.reduce((a, c) => a + c, 0); const ws = blk.widths.map(w => Math.floor(w / sum * cw)); ws[ws.length - 1] += cw - ws.reduce((a, c) => a + c, 0);
    const rows = [new D.TableRow({ tableHeader: true, children: blk.head.map((h, i) => cell(h, ws[i], { fill: acc, bold: true, color: 'FFFFFF', align: blk.align[i] })) })];
    blk.rows.forEach(r => rows.push(new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, ws[i], { align: blk.align[i] })) })));
    if (blk.total) rows.push(new D.TableRow({ children: blk.total.map((c, i) => cell(c, ws[i], { fill: SOFT, bold: true, align: blk.align[i] })) }));
    return new D.Table({ width: { size: cw, type: D.WidthType.DXA }, columnWidths: ws, rows });
  };
  const kv = (rows, cw, k = 0.3) => {
    const w1 = Math.round(cw * k), w2 = cw - w1;
    return new D.Table({ width: { size: cw, type: D.WidthType.DXA }, columnWidths: [w1, w2], rows: rows.map(([a, b]) => new D.TableRow({ cantSplit: true, children: [cell(a, w1, { fill: SOFT, bold: true, color: MUTED }), cell(b || '—', w2)] })) });
  };
  const header = (cw) => new D.Header({ children: [para([
    ...(logo ? [new D.ImageRun({ data: logo.data, transformation: { width: Math.round(30 * logo.w / logo.h), height: 30 } }), run('  ')] : []),
    run(x.ch.organisme || '', { bold: true, size: 17, color: INK }), run(x.ch.service ? `  ·  ${x.ch.service}` : '', { size: 17, color: MUTED }),
    new D.TextRun({ children: [new D.Tab()] }), run(`Réf. ${x.ref}  ·  Ind. ${x.ind}`, { size: 16, color: MUTED })
  ], { tabStops: [{ type: D.TabStopType.RIGHT, position: cw }], border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: acc, space: 4 } } })] });
  const footer = (cw) => new D.Footer({ children: [para([
    run(x.ch.mention || '', { size: 14, color: RED, italics: true }), new D.TextRun({ children: [new D.Tab()] }),
    new D.TextRun({ font: FONT, size: 16, color: MUTED, children: ['Page ', D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES] })
  ], { tabStops: [{ type: D.TabStopType.RIGHT, position: cw }], border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } } })] });

  const sections = [];
  for (const [pi, pg] of model.pages.entries()) {
    const cw = CW[pg.orient]; const ch = [];
    for (const blk of pg.blocks) {
      if (blk.t === 'cover') {
        if (logo) ch.push(para(new D.ImageRun({ data: logo.data, transformation: { width: Math.round(110 * logo.w / logo.h), height: 110 } }), { spacing: { after: 400 } }));
        ch.push(para(run(x.ch.organisme || '', { bold: true, size: 26, color: INK })));
        ch.push(para(run(x.ch.service || '', { size: 22, color: MUTED }), { spacing: { after: 1200 } }));
        ch.push(para(run(x.ch.titre || 'Dossier d\'implantation', { bold: true, size: 48, color: DARK }), { spacing: { after: 200 }, border: { left: { style: D.BorderStyle.SINGLE, size: 36, color: acc, space: 12 } } }));
        ch.push(para(run(x.site, { size: 34, color: acc, bold: true }), { spacing: { after: 80 } }));
        if (x.adresse) ch.push(para(run(x.adresse, { size: 22, color: MUTED })));
        ch.push(para(run(''), { spacing: { after: 900 } }));
        ch.push(kv([...(x.client ? [['Client', x.client]] : []), ['Référence', x.ref], ['Indice', x.ind], ['Date', x.date], ['Établi par', x.redac || '—'], ['Vérifié par', x.verif || '—']], Math.round(cw * 0.62), 0.38));
        ch.push(para(run(''), { spacing: { after: 1400 } }));
        ch.push(para(run(x.ch.mention || '', { size: 18, color: RED, bold: true }), { alignment: D.AlignmentType.CENTER, border: { top: { style: D.BorderStyle.SINGLE, size: 8, color: RED, space: 6 }, bottom: { style: D.BorderStyle.SINGLE, size: 8, color: RED, space: 6 } } }));
      } else if (blk.t === 'toc') {
        ch.push(para(run('Sommaire', { bold: true, size: 32, color: DARK }), { pageBreakBefore: true, spacing: { after: 240 } }));
        ch.push(new D.TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-2' }));
        ch.push(para(run('Si le sommaire est vide, cliquez dessus avec le bouton droit puis « Mettre à jour les champs ».', { size: 15, color: MUTED, italics: true }), { spacing: { before: 200 } }));
      } else if (blk.t === 'h1') {
        if (blk.text) ch.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: !!blk.pageBreak && !blk.plan, children: [run(blk.text)] }));
        if (blk.sub) ch.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [run(blk.sub)] }));
      } else if (blk.t === 'h2') ch.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, keepNext: true, children: [run(blk.text)] }));
      else if (blk.t === 'p') ch.push(para(run(blk.text, { size: 20, color: blk.muted ? MUTED : INK }), { spacing: { after: 120, line: 300 } }));
      else if (blk.t === 'kv') ch.push(kv(blk.rows, cw));
      else if (blk.t === 'table') ch.push(table(blk, cw));
      else if (blk.t === 'photos') {
        const colW = Math.floor(cw / 2); const pxW = colW / 1440 * 96 - 14, pxH = 2.9 * 96;
        for (let i = 0; i < blk.items.length; i += 2) {
          const pair = blk.items.slice(i, i + 2);
          ch.push(new D.Table({ width: { size: cw, type: D.WidthType.DXA }, columnWidths: [colW, cw - colW], borders: { top: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideHorizontal: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideVertical: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
            rows: [new D.TableRow({ cantSplit: true, children: [0, 1].map(k => { const it = pair[k]; const kk = it ? Math.min(pxW / it.w, pxH / it.h) : 0;
              return new D.TableCell({ width: { size: k ? cw - colW : colW, type: D.WidthType.DXA }, margins: { top: 80, bottom: 120, left: 80, right: 80 }, borders: { top: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
                children: it ? [para(new D.ImageRun({ data: bytes(it.url), transformation: { width: Math.round(it.w * kk), height: Math.round(it.h * kk) } }), { alignment: D.AlignmentType.CENTER }), para(run(it.caption, { size: 15, color: MUTED, italics: true }), { alignment: D.AlignmentType.CENTER, spacing: { before: 60 } })] : [para(run(''))] }); }) })] }));
        }
      }
      else if (blk.t === 'image') {
        const maxW = cw / 1440 * 96, maxH = (pg.orient === 'landscape' ? 5.35 : 7.5) * 96; const k = Math.min(maxW / blk.w, maxH / blk.h);
        ch.push(para(new D.ImageRun({ data: bytes(blk.url), transformation: { width: Math.round(blk.w * k), height: Math.round(blk.h * k) } }), { alignment: D.AlignmentType.CENTER, border: { top: border, bottom: border, left: border, right: border } }));
        ch.push(para(run(blk.caption, { size: 15, color: MUTED, italics: true }), { alignment: D.AlignmentType.CENTER, spacing: { before: 80 } }));
      } else if (blk.t === 'legend') {
        const per = 4; const w = Math.floor(cw / per); const rows = [];
        for (let i = 0; i < blk.items.length; i += per) {
          const slice = blk.items.slice(i, i + per);
          rows.push(new D.TableRow({ cantSplit: true, children: Array.from({ length: per }, (_, j) => {
            const it = slice[j]; if (!it) return cell('', w);
            const im = it.t.img ? new D.ImageRun({ data: bytes(it.t.img), transformation: (() => { const s = sizeCache.get(it.t.img) || { w: 1, h: 1 }; const k = 26 / Math.max(s.w, s.h); return { width: Math.max(4, Math.round(s.w * k)), height: Math.max(4, Math.round(s.h * k)) }; })() }) : null;
            return cell([para([...(im ? [im, run('  ')] : []), run(it.t.code, { bold: true, size: 15, color: 'FFFFFF', shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: hex(it.t.couleur) } }), run('  ' + it.t.nom, { bold: true, size: 17 })]), para(run(`${it.n} unité${it.n > 1 ? 's' : ''}`, { size: 15, color: MUTED }))], w);
          }) }));
        }
        ch.push(new D.Table({ width: { size: w * per, type: D.WidthType.DXA }, columnWidths: Array(per).fill(w), rows }));
        ch.push(para(run(''), { spacing: { after: 120 } }));
      } else if (blk.t === 'fiche') {
        const t = blk.type; const pw = Math.round(cw * 0.26), dw = cw - pw;
        ch.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, keepNext: true, children: [run(`${blk.num} ${t.nom}`)] }));
        const s = t.img ? await imgSize(t.img) : null; const k = s ? Math.min(130 / s.w, 130 / s.h) : 1;
        const photo = t.img ? [para(new D.ImageRun({ data: bytes(t.img), transformation: { width: Math.round(s.w * k), height: Math.round(s.h * k) } }), { alignment: D.AlignmentType.CENTER })] : [para(run('Pas de photo', { size: 16, color: MUTED }))];
        const det = [['Code repère', t.code], ['Système', t.sys], ['Type', t.type], ['Fonction', t.fn], ['Portée radio', t.radio], ['Détection', t.det], ['Autonomie', t.auto], ['Quantité au dossier', String(blk.qty)], ...(t.notes ? [['Notes', t.notes]] : [])].filter(r => r[1]);
        ch.push(new D.Table({ width: { size: cw, type: D.WidthType.DXA }, columnWidths: [pw, dw], rows: [new D.TableRow({ cantSplit: true, children: [
          new D.TableCell({ width: { size: pw, type: D.WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: SOFT }, verticalAlign: D.VerticalAlign.CENTER, margins: { top: 120, bottom: 120, left: 100, right: 100 }, children: photo }),
          new D.TableCell({ width: { size: dw, type: D.WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border }, margins: { top: 60, bottom: 60, left: 0, right: 0 }, children: [kv(det, dw - 20, 0.32)] })
        ] })] }));
        ch.push(para(run(''), { spacing: { after: 160 } }));
      } else if (blk.t === 'visas') {
        const ws = [0.22, 0.3, 0.16, 0.32].map(f => Math.round(f * cw)); ws[3] += cw - ws.reduce((a, c) => a + c, 0);
        const rows = [new D.TableRow({ tableHeader: true, children: ['', 'Nom et fonction', 'Date', 'Visa'].map((h, i) => cell(h, ws[i], { fill: acc, bold: true, color: 'FFFFFF' })) })];
        blk.rows.forEach(([r, nm]) => rows.push(new D.TableRow({ cantSplit: true, height: { value: 1000, rule: D.HeightRule.ATLEAST }, children: [cell(r, ws[0], { fill: SOFT, bold: true, color: MUTED }), cell(nm || '', ws[1]), cell('', ws[2]), cell('', ws[3])] })));
        ch.push(new D.Table({ width: { size: cw, type: D.WidthType.DXA }, columnWidths: ws, rows }));
      }
      if (blk.t === 'table' || blk.t === 'kv') ch.push(para(run(''), { spacing: { after: 120 } }));
    }
    const s = {
      properties: { titlePage: pi === 0, page: { size: { ...A4, orientation: pg.orient === 'landscape' ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: M + 200, bottom: M, left: M, right: M, header: 560, footer: 480 } } },
      headers: { default: header(cw), ...(pi === 0 ? { first: new D.Header({ children: [para(run(''))] }) } : {}) },
      footers: { default: footer(cw), ...(pi === 0 ? { first: new D.Footer({ children: [para(run(''))] }) } : {}) },
      children: ch
    };
    s._orient = pg.orient; sections.push(s);
  }
  sections.forEach(s => delete s._orient);
  const doc = new D.Document({
    creator: x.redac || 'Blackeyes Implantation', title: `${x.ch.titre} — ${x.site}`, description: `Référence ${x.ref}, indice ${x.ind}`,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 20, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: DARK }, paragraph: { spacing: { before: 120, after: 200 }, outlineLevel: 0, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: acc, space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true, color: acc }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } }
      ]
    },
    sections
  });
  return new Uint8Array(await (await D.Packer.toBlob(doc)).arrayBuffer());
}

/* ---------------------------------------------------------------- rendu PDF du dossier (même modèle) */
async function renderDossierPdf(model) {
  const { jsPDF } = window.jspdf; const { x } = model; const A = rgb(x.ch.couleur);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const MG = 18; let W = 210, H = 297, y = 0; const toc = []; let tocPage = 0;
  const logo = x.ch.logo ? await imgSize(x.ch.logo) : null;
  const ink = () => doc.setTextColor(18, 26, 38), muted = () => doc.setTextColor(90, 101, 119);
  const font = (sz, st = 'normal') => { doc.setFont('helvetica', st); doc.setFontSize(sz); };
  const top = () => 27, bottom = () => H - 20;
  const newPage = (orient) => { doc.addPage('a4', orient); W = orient === 'landscape' ? 297 : 210; H = orient === 'landscape' ? 210 : 297; y = top(); };
  const ensure = (h, orient) => { if (y + h > bottom()) newPage(orient); };
  const lines = (t, w, sz, st) => { font(sz, st); return doc.splitTextToSize(String(t ?? ''), w); };
  const cw = () => W - 2 * MG;

  const drawTable = (blk, orient, opt = {}) => {
    const sum = blk.widths ? blk.widths.reduce((a, c) => a + c, 0) : 1; const ws = (blk.widths || [30, 70]).map(w => w / sum * cw());
    const rowH = (cells, sz, st) => Math.max(...cells.map((c, i) => lines(c, ws[i] - 4, sz, st).length)) * sz * 0.42 + 3.6;
    const drawRow = (cells, o) => {
      const sz = o.sz || 9, h = Math.max(o.minH || 0, rowH(cells, sz, o.bold ? 'bold' : 'normal'));
      if (y + h > bottom()) { newPage(orient); if (blk.head && !o.isHead) drawRow(blk.head, { fill: A, color: [255, 255, 255], bold: true, isHead: true }); }
      let xx = MG;
      cells.forEach((c, i) => {
        if (o.fill) { doc.setFillColor(...o.fill); doc.rect(xx, y, ws[i], h, 'F'); }
        else if (o.firstFill && i === 0) { doc.setFillColor(243, 245, 248); doc.rect(xx, y, ws[i], h, 'F'); }
        doc.setDrawColor(214, 220, 229); doc.setLineWidth(0.2); doc.rect(xx, y, ws[i], h);
        const bold = o.bold || (o.firstFill && i === 0);
        const ls = lines(c, ws[i] - 4, sz, bold ? 'bold' : 'normal');
        doc.setTextColor(...(o.color || (o.firstFill && i === 0 ? [90, 101, 119] : [18, 26, 38])));
        const al = blk.align ? blk.align[i] : 'l';
        ls.forEach((ln, k) => al === 'c' ? doc.text(ln, xx + ws[i] / 2, y + 4.6 + k * sz * 0.42, { align: 'center' }) : doc.text(ln, xx + 2, y + 4.6 + k * sz * 0.42));
        xx += ws[i];
      });
      y += h;
    };
    if (blk.head) drawRow(blk.head, { fill: A, color: [255, 255, 255], bold: true, isHead: true });
    blk.rows.forEach(r => drawRow(r, { firstFill: opt.kv, minH: opt.minH }));
    if (blk.total) drawRow(blk.total, { fill: [243, 245, 248], bold: true });
    y += 4;
  };

  let first = true;
  for (const pg of model.pages) {
    const orient = pg.orient;
    if (first) { first = false; } else newPage(orient);
    for (const blk of pg.blocks) {
      if (blk.t === 'cover') {
        let yy = 30;
        if (logo) { const h = 30, w = h * logo.w / logo.h; doc.addImage(x.ch.logo, 'PNG', MG, yy, w, h); yy += h + 10; }
        font(14, 'bold'); ink(); doc.text(x.ch.organisme || '', MG, yy); yy += 7;
        font(11); muted(); doc.text(x.ch.service || '', MG, yy); yy += 34;
        doc.setFillColor(...A); doc.rect(MG, yy - 7, 2.2, 30, 'F');
        const tl = lines(x.ch.titre, cw() - 8, 24, 'bold'); ink(); tl.forEach((l, i) => doc.text(l, MG + 7, yy + i * 10)); yy += tl.length * 10 + 4;
        font(17, 'bold'); doc.setTextColor(...A); doc.text(lines(x.site, cw() - 8, 17, 'bold')[0], MG + 7, yy); yy += 8;
        if (x.adresse) { font(11); muted(); doc.text(x.adresse, MG + 7, yy); }
        y = 175; const save = W; drawTable({ widths: [38, 62], rows: [...(x.client ? [['Client', x.client]] : []), ['Référence', x.ref], ['Indice', x.ind], ['Date', x.date], ['Établi par', x.redac || '—'], ['Vérifié par', x.verif || '—']] }, 'portrait', { kv: true }); W = save;
        doc.setDrawColor(200, 16, 46); doc.setLineWidth(0.5); doc.line(MG, 262, W - MG, 262); doc.line(MG, 274, W - MG, 274); doc.setLineWidth(0.2);
        font(9, 'bold'); doc.setTextColor(200, 16, 46); doc.text(lines(x.ch.mention, cw(), 9, 'bold'), W / 2, 269, { align: 'center' });
      } else if (blk.t === 'toc') {
        newPage('portrait'); tocPage = doc.getNumberOfPages();
        font(16, 'bold'); ink(); doc.text('Sommaire', MG, y + 4); y += 14;
      } else if (blk.t === 'h1') {
        if (blk.text) { if (blk.pageBreak && !blk.plan && y > top() + 1) newPage(orient); ensure(16, orient); font(15, 'bold'); ink(); doc.text(blk.text, MG, y + 5); doc.setDrawColor(...A); doc.setLineWidth(0.6); doc.line(MG, y + 8, W - MG, y + 8); doc.setLineWidth(0.2); toc.push({ lvl: 1, text: blk.text, page: doc.getNumberOfPages() }); y += 15; }
        if (blk.sub) { font(12, 'bold'); doc.setTextColor(...A); doc.text(blk.sub, MG, y + 4); toc.push({ lvl: 2, text: blk.sub, page: doc.getNumberOfPages() }); y += 9; }
      } else if (blk.t === 'h2') { ensure(18, orient); font(12, 'bold'); doc.setTextColor(...A); doc.text(blk.text, MG, y + 5); toc.push({ lvl: 2, text: blk.text, page: doc.getNumberOfPages() }); y += 10; }
      else if (blk.t === 'p') { const ls = lines(blk.text, cw(), 10); ensure(ls.length * 4.8, orient); blk.muted ? muted() : ink(); ls.forEach(l => { doc.text(l, MG, y + 4); y += 4.8; }); y += 2.5; }
      else if (blk.t === 'kv') drawTable({ widths: [30, 70], rows: blk.rows }, orient, { kv: true });
      else if (blk.t === 'table') drawTable(blk, orient);
      else if (blk.t === 'photos') {
        const gap = 6, colW = (cw() - gap) / 2, boxH = 68;
        for (let i = 0; i < blk.items.length; i += 2) {
          const pair = blk.items.slice(i, i + 2);
          const caps = pair.map(it => lines(it.caption, colW, 8, 'italic'));
          const rowH = boxH + 4 + Math.max(...caps.map(c => c.length)) * 3.6 + 6;
          ensure(rowH, orient);
          pair.forEach((it, k) => {
            const x0 = MG + k * (colW + gap); const kk = Math.min(colW / it.w, boxH / it.h); const w = it.w * kk, h = it.h * kk;
            doc.setFillColor(243, 245, 248); doc.rect(x0, y, colW, boxH, 'F');
            doc.addImage(it.url, 'JPEG', x0 + (colW - w) / 2, y + (boxH - h) / 2, w, h); doc.setDrawColor(214, 220, 229); doc.rect(x0, y, colW, boxH);
            font(8, 'italic'); muted(); caps[k].forEach((ln, j) => doc.text(ln, x0 + colW / 2, y + boxH + 4.5 + j * 3.6, { align: 'center' }));
          });
          y += rowH;
        }
      }
      else if (blk.t === 'image') {
        const maxW = cw(), maxH = bottom() - y - 9; const k = Math.min(maxW / blk.w, maxH / blk.h); const w = blk.w * k, h = blk.h * k, xx = MG + (maxW - w) / 2;
        doc.addImage(blk.url, 'JPEG', xx, y, w, h); doc.setDrawColor(214, 220, 229); doc.rect(xx, y, w, h); y += h + 5;
        font(8, 'italic'); muted(); doc.text(blk.caption, W / 2, y, { align: 'center' }); y += 5;
      } else if (blk.t === 'legend') {
        const per = 4, cwid = cw() / per, rh = 13;
        for (let i = 0; i < blk.items.length; i++) {
          if (i % per === 0) { ensure(rh, orient); if (i) y += rh; }
          const it = blk.items[i], xx = MG + (i % per) * cwid; const c = rgb(it.t.couleur);
          doc.setDrawColor(214, 220, 229); doc.rect(xx, y, cwid, rh);
          doc.setFillColor(255, 255, 255); doc.setDrawColor(...c); doc.setLineWidth(0.5); doc.circle(xx + 6.5, y + rh / 2, 4.2, 'FD'); doc.setLineWidth(0.2);
          if (it.t.img) { const s = await imgSize(it.t.img); const k = 5.6 / Math.max(s.w, s.h); doc.addImage(it.t.img, 'PNG', xx + 6.5 - s.w * k / 2, y + rh / 2 - s.h * k / 2, s.w * k, s.h * k); }
          font(9, 'bold'); ink(); doc.text(lines(it.t.nom, cwid - 16, 9, 'bold')[0], xx + 13, y + 5.6);
          font(7.5); muted(); doc.text(`${it.t.code} · ${it.n} unité${it.n > 1 ? 's' : ''}`, xx + 13, y + 9.8);
        }
        y += rh + 5;
      } else if (blk.t === 'fiche') {
        const t = blk.type; const det = [['Code repère', t.code], ['Système', t.sys], ['Type', t.type], ['Fonction', t.fn], ['Portée radio', t.radio], ['Détection', t.det], ['Autonomie', t.auto], ['Quantité au dossier', String(blk.qty)], ...(t.notes ? [['Notes', t.notes]] : [])].filter(r => r[1]);
        const pw = 44, dw = cw() - pw - 4; const k1 = 32 / 100 * dw, k2 = dw - k1;
        const hRow = (r) => Math.max(lines(r[0], k1 - 4, 9, 'bold').length, lines(r[1], k2 - 4, 9).length) * 3.8 + 3.6;
        const hh = Math.max(det.reduce((a, r) => a + hRow(r), 0), 40) + 12;
        ensure(hh, orient);
        font(12, 'bold'); doc.setTextColor(...A); doc.text(`${blk.num} ${t.nom}`, MG, y + 5); toc.push({ lvl: 2, text: `${blk.num} ${t.nom}`, page: doc.getNumberOfPages() }); y += 9;
        doc.setFillColor(243, 245, 248); doc.rect(MG, y, pw, hh - 12, 'F');
        if (t.img) { const s = await imgSize(t.img); const k = Math.min((pw - 8) / s.w, 34 / s.h); doc.addImage(t.img, 'PNG', MG + pw / 2 - s.w * k / 2, y + (hh - 12) / 2 - s.h * k / 2, s.w * k, s.h * k); }
        let yy = y; const x0 = MG + pw + 4;
        det.forEach(r => { const h = hRow(r); doc.setFillColor(243, 245, 248); doc.rect(x0, yy, k1, h, 'F'); doc.setDrawColor(214, 220, 229); doc.rect(x0, yy, k1, h); doc.rect(x0 + k1, yy, k2, h);
          font(9, 'bold'); muted(); lines(r[0], k1 - 4, 9, 'bold').forEach((l, i) => doc.text(l, x0 + 2, yy + 4.6 + i * 3.8));
          font(9); ink(); lines(r[1], k2 - 4, 9).forEach((l, i) => doc.text(l, x0 + k1 + 2, yy + 4.6 + i * 3.8)); yy += h; });
        y += hh - 6;
      } else if (blk.t === 'visas') drawTable({ head: ['', 'Nom et fonction', 'Date', 'Visa'], widths: [22, 30, 16, 32], rows: blk.rows.map(([r, n]) => [r, n || '', '', '']) }, orient, { kv: true, minH: 18 });
    }
  }
  // sommaire
  if (tocPage) {
    doc.setPage(tocPage); let ty = top() + 16; const w = doc.internal.pageSize.getWidth();
    toc.forEach(e => {
      font(e.lvl === 1 ? 11 : 10, e.lvl === 1 ? 'bold' : 'normal'); e.lvl === 1 ? ink() : muted();
      const xx = MG + (e.lvl === 1 ? 0 : 6); const label = lines(e.text, w - 2 * MG - 30, 10)[0];
      doc.text(label, xx, ty); const tw = doc.getTextWidth(label); doc.text(String(e.page), w - MG, ty, { align: 'right' });
      doc.setDrawColor(190, 197, 208); doc.setLineDashPattern([0.4, 1.2], 0); doc.line(xx + tw + 2, ty - 0.8, w - MG - 8, ty - 0.8); doc.setLineDashPattern([], 0);
      ty += e.lvl === 1 ? 8 : 6.5; if (e.lvl === 1) ty += 1;
    });
  }
  // en-têtes et pieds de page
  const N = doc.getNumberOfPages();
  for (let i = 2; i <= N; i++) {
    doc.setPage(i); const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    if (logo) { const lh = 8, lw = lh * logo.w / logo.h; doc.addImage(x.ch.logo, 'PNG', MG, 9, lw, lh); font(8.5, 'bold'); ink(); doc.text(x.ch.organisme || '', MG + lw + 3, 13); font(7.5); muted(); doc.text(x.ch.service || '', MG + lw + 3, 16.5); }
    else { font(8.5, 'bold'); ink(); doc.text(x.ch.organisme || '', MG, 13); }
    font(8); muted(); doc.text(`Réf. ${x.ref}  ·  Ind. ${x.ind}`, w - MG, 14, { align: 'right' });
    doc.setDrawColor(...A); doc.setLineWidth(0.5); doc.line(MG, 19.5, w - MG, 19.5); doc.setLineWidth(0.2);
    doc.setDrawColor(214, 220, 229); doc.line(MG, h - 13, w - MG, h - 13);
    font(7, 'italic'); doc.setTextColor(200, 16, 46); doc.text(lines(x.ch.mention, w - 2 * MG - 30, 7, 'italic')[0], MG, h - 8.5);
    font(8); muted(); doc.text(`Page ${i} / ${N}`, w - MG, h - 8.5, { align: 'right' });
  }
  doc.setProperties({ title: `${x.ch.titre} — ${x.site}`, subject: `Référence ${x.ref}, indice ${x.ind}`, author: x.redac || 'Blackeyes Implantation', creator: 'Blackeyes Implantation' });
  return new Uint8Array(doc.output('arraybuffer'));
}

/* ---------------------------------------------------------------- export du dossier (choix du format) */
async function exportDocx() {
  const okW = can('exportDocx'), okP = can('exportPdf');
  if (!okW && !okP) { need('exportDocx'); return; }
  if (!requireMarkers()) return;
  const r = await modal({
    title: 'Dossier d\'implantation', size: 'md',
    body: `<p style="margin:0">Dossier complet et homogène : page de garde, sommaire, présentation du site, synthèse quantitative, plans annotés par niveau avec légende et liste des repères, fiches matériels, historique des indices et visas.</p>
      <div class="field"><span>Format</span>
        <label class="perm"><input type="checkbox" id="dxW" ${okW ? 'checked' : 'disabled'}><div><b>Word (.docx) — modifiable</b><span>Pour compléter, relire et faire viser le dossier.${okW ? '' : ' Droit non accordé.'}</span></div></label>
        <label class="perm"><input type="checkbox" id="dxP" ${okP ? (okW ? '' : 'checked') : 'disabled'}><div><b>PDF — diffusion</b><span>Version figée, identique au Word, pour transmettre ou imprimer.${okP ? '' : ' Droit non accordé.'}</span></div></label>
      </div>
      <label class="chk"><input type="checkbox" id="dxF" checked> Inclure les fiches matériels</label>
      <label class="chk"><input type="checkbox" id="dxPh" ${reportPhotos().length ? 'checked' : 'disabled'}> Inclure le reportage photographique (${reportPhotos().length} photo(s) cochée(s) « Dans le rapport »)</label>
      <div class="info">Référence : <b>${esc(S.project.reference || 'non renseignée')}</b> · indice <b>${esc(S.project.indice || 'A')}</b> · établi par <b>${esc(S.project.author || 'non renseigné')}</b>. Ces informations se complètent dans le panneau « Projet ».</div>`,
    buttons: [{ label: 'Annuler', value: null }, { label: 'Générer', cls: 'primary', action: (root) => {
      const o = { word: $('#dxW', root).checked, pdf: $('#dxP', root).checked, fiches: $('#dxF', root).checked, photos: $('#dxPh', root).checked };
      if (!o.word && !o.pdf) { toast('Cochez au moins un format.', true); return false; } return o;
    } }]
  });
  if (!r) return;
  toast('Préparation du dossier…');
  try {
    const model = await buildDossier(r);
    const base = `Dossier ${safeName(model.x.site)}${S.project.reference ? ' ' + safeName(S.project.reference) : ''} ind ${model.x.ind}`;
    if (r.word) {
      const data = await renderDocx(model);
      const p = await window.native.saveFile({ purpose: 'docx', title: 'Enregistrer le dossier Word', defaultPath: `${base}.docx`, filters: [{ name: 'Document Word', extensions: ['docx'] }], data });
      if (p) toast('Dossier Word enregistré');
    }
    if (r.pdf) {
      const data = await renderDossierPdf(model);
      const p = await window.native.saveFile({ purpose: 'pdf', title: 'Enregistrer le dossier PDF', defaultPath: `${base}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }], data });
      if (p) toast('Dossier PDF enregistré');
    }
  } catch (e) { console.error(e); toast('Dossier impossible à générer : ' + e.message, true); }
}

/* ---------------------------------------------------------------- PowerPoint modifiable (charte + cartouche) */
async function exportPptx() {
  if (!need('exportPptx') || !requireMarkers()) return;
  toast('Génération du PowerPoint…');
  try {
    const x = await docCtx(); const acc = x.acc;
    const P = new PptxGenJS(); P.layout = 'LAYOUT_WIDE'; P.author = x.redac || 'Blackeyes Implantation'; P.title = `${x.ch.titre} — ${x.site}`;
    const W = 13.333; const lvls = S.project.levels; const pages = lvls.length + 1;
    const logo = x.ch.logo ? await imgSize(x.ch.logo) : null;
    const head = (sl, title) => {
      sl.addShape(P.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.62, fill: { color: DARK }, line: { color: DARK } });
      sl.addShape(P.ShapeType.rect, { x: 0, y: 0.62, w: W, h: 0.04, fill: { color: acc }, line: { color: acc } });
      let tx = 0.3;
      if (logo) { const h = 0.46, w = h * logo.w / logo.h; sl.addShape(P.ShapeType.roundRect, { x: 0.25, y: 0.08, w: w + 0.1, h: h, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' }, rectRadius: 0.05 }); sl.addImage({ data: x.ch.logo, x: 0.3, y: 0.08, w, h }); tx = 0.25 + w + 0.25; }
      sl.addText(title, { x: tx, y: 0.08, w: 8.6 - tx + 0.3, h: 0.46, fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF', valign: 'middle' });
      sl.addText([{ text: x.ch.organisme || '', options: { bold: true, breakLine: true } }, { text: x.ch.service || '', options: { color: 'B8C2D3' } }], { x: 8.9, y: 0.06, w: 4.15, h: 0.5, fontFace: FONT, fontSize: 9, color: 'FFFFFF', align: 'right', valign: 'middle' });
    };
    const foot = (sl) => {
      sl.addShape(P.ShapeType.line, { x: 0.3, y: 7.1, w: W - 0.6, h: 0, line: { color: LINE, width: 0.75 } });
      sl.addText(x.ch.mention || '', { x: 0.3, y: 7.12, w: 9.5, h: 0.3, fontFace: FONT, fontSize: 8, italic: true, color: RED, valign: 'middle' });
      sl.addText(`Réf. ${x.ref} · Ind. ${x.ind}`, { x: 9.9, y: 7.12, w: 3.13, h: 0.3, fontFace: FONT, fontSize: 8, color: MUTED, align: 'right', valign: 'middle' });
    };
    const cartouche = (sl, l, page) => {
      const rows = cartoucheRows(x, l, page, pages), rh = rows.length > 6 ? 0.29 : 0.33, y0 = 6.98 - rows.length * rh;
      sl.addTable(rows.map(([k, v]) => [{ text: k, options: { bold: true, color: MUTED, fill: { color: SOFT } } }, { text: v }]), { x: 10.4, y: y0, w: 2.65, colW: [0.85, 1.8], rowH: rh, fontFace: FONT, fontSize: 8, color: INK, border: { type: 'solid', pt: 0.5, color: LINE }, valign: 'middle', margin: 0.04, autoPage: false });
    };
    // synthèse
    const s0 = P.addSlide(); s0.background = { color: 'FFFFFF' };
    head(s0, `${x.site} — synthèse`); foot(s0);
    s0.addText([{ text: x.ch.titre, options: { fontSize: 20, bold: true, color: DARK, breakLine: true } }, { text: [x.adresse, `Établi par ${x.redac || '—'}`, x.date].filter(Boolean).join('   ·   '), options: { fontSize: 11, color: MUTED } }], { x: 0.4, y: 0.85, w: 9.8, h: 0.95, fontFace: FONT, valign: 'top' });
    const types = usedTypes();
    const hdr = ['Matériel', 'Système', ...lvls.map(l => l.name), 'Total'].map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: acc } } }));
    const rows = types.map(t => { const per = lvls.map(l => l.markers.filter(m => m.typeId === t.id).length); return [t.nom, t.sys, ...per.map(n => ({ text: n ? String(n) : '—', options: { align: 'center' } })), { text: String(per.reduce((a, b) => a + b, 0)), options: { align: 'center', bold: true } }]; });
    const totals = lvls.map(l => l.markers.length);
    rows.push([{ text: 'Total', options: { bold: true, fill: { color: SOFT } } }, { text: '', options: { fill: { color: SOFT } } }, ...totals.map(n => ({ text: String(n), options: { align: 'center', bold: true, fill: { color: SOFT } } })), { text: String(totals.reduce((a, b) => a + b, 0)), options: { align: 'center', bold: true, fill: { color: SOFT } } }]);
    const colW = [2.9, 1.7, ...lvls.map(() => Math.min(1.2, 4.6 / Math.max(1, lvls.length))), 0.8];
    if (types.length) s0.addTable([hdr, ...rows], { x: 0.4, y: 2.0, w: colW.reduce((a, b) => a + b, 0), colW, fontFace: FONT, fontSize: 10.5, color: INK, border: { type: 'solid', pt: 0.5, color: LINE }, rowH: 0.32, autoPage: false });
    s0.addShape(P.ShapeType.rect, { x: 10.4, y: 0.85, w: 2.65, h: 4.0, fill: { color: SOFT }, line: { color: LINE, width: 0.5 } });
    s0.addText([{ text: 'BÂTIMENT', options: { bold: true, color: MUTED, fontSize: 8, charSpacing: 2, breakLine: true } }, { text: x.site, options: { bold: true, fontSize: 12, breakLine: true } }, { text: x.adresse || '', options: { color: MUTED, fontSize: 9, breakLine: true } },
      ...(x.bat ? [{ text: ' ', options: { breakLine: true } }, { text: 'Statut : ' + (STAT_LABEL[x.bat.statut] || '—'), options: { fontSize: 9, breakLine: true } }, { text: 'Alarme existante : ' + (x.bat.alarme || '—'), options: { fontSize: 9 } }] : [])], { x: 10.5, y: 0.95, w: 2.45, h: 3.8, fontFace: FONT, color: INK, valign: 'top' });
    cartouche(s0, null, 1);
    // un plan par niveau
    for (const [li, l] of lvls.entries()) {
      const sl = P.addSlide(); sl.background = { color: 'FFFFFF' };
      const ax = 0.3, ay = 0.85, aw = 9.9, ah = 6.1;
      const k = Math.min(aw / l.plan.w, ah / l.plan.h);
      const ox = ax + (aw - l.plan.w * k) / 2, oy = ay + (ah - l.plan.h * k) / 2;
      sl.addImage({ data: l.plan.dataUrl, x: ox, y: oy, w: l.plan.w * k, h: l.plan.h * k });
      const s = markerSize(l) * k;
      if ($('#optZones').checked && l.scale) for (const m of l.markers) {
        const t = typeOf(m.typeId); const range = m.range ?? t.detRange, ang = m.angle ?? t.detAngle;
        if (!range || m.showZone === false) continue;
        const R = range * l.scale * k; const cx = ox + m.x * k, cy = oy + m.y * k;
        if (zoneKind(m) === 'faisceau') {
          const g = beamGeom(m, l); const L = g.L * k, bw = g.w * k; const mx = cx + g.dx * L / 2, my = cy + g.dy * L / 2;
          sl.addShape(P.ShapeType.rect, { x: mx - L / 2, y: my - bw / 2, w: L, h: bw, rotate: m.rot, fill: { color: hex(t.couleur), transparency: 82 }, line: { color: hex(t.couleur), width: 0, transparency: 100 } });
          sl.addShape(P.ShapeType.line, { x: mx - L / 2, y: my, w: L, h: 0, rotate: m.rot, line: { color: 'DC2626', width: 1.25, dashType: 'dash' } });
          const ex = cx + g.dx * L, ey = cy + g.dy * L, eb = bw * 2.2;
          sl.addShape(P.ShapeType.line, { x: ex - eb / 2, y: ey, w: eb, h: 0, rotate: m.rot + 90, line: { color: hex(t.couleur), width: 2.5 } });
          continue;
        }
        const opt = { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R, fill: { color: hex(t.couleur), transparency: 82 }, line: { color: hex(t.couleur), width: 0.75, transparency: 35 } };
        if (!ang || ang >= 360) sl.addShape(P.ShapeType.ellipse, opt);
        else { const a1 = ((m.rot - ang / 2) % 360 + 360) % 360, a2 = ((m.rot + ang / 2) % 360 + 360) % 360; sl.addShape(P.ShapeType.pie, { ...opt, angleRange: [a1, a2] }); }
      }
      const pw = l.plan.w * k, ph = l.plan.h * k, WH = { color: 'FFFFFF' };
      [[0, 0.66, W, Math.max(0, oy - 0.66)], [0, oy + ph, W, 7.5 - oy - ph], [0, oy, ox, ph], [ox + pw, oy, W - ox - pw, ph]]
        .filter(r => r[2] > 0.001 && r[3] > 0.001).forEach(([xx, yy, w, h]) => sl.addShape(P.ShapeType.rect, { x: xx, y: yy, w, h, fill: WH, line: { color: 'FFFFFF', width: 0 } }));
      sl.addShape(P.ShapeType.rect, { x: ox, y: oy, w: pw, h: ph, fill: { type: 'none' }, line: { color: LINE, width: 0.5 } });
      head(sl, `${x.site} — ${lvLabel(l, true)}`); foot(sl);
      for (const m of l.markers) {
        const t = typeOf(m.typeId); const cx = ox + m.x * k, cy = oy + m.y * k;
        sl.addShape(P.ShapeType.ellipse, { x: cx - s / 2, y: cy - s / 2, w: s, h: s, fill: { color: 'FFFFFF' }, line: { color: hex(t.couleur), width: Math.max(0.75, s * 72 * 0.07) } });
        if (t.img) { const im = await imgSize(t.img); const box = s * 0.72; const r = Math.min(box / im.w, box / im.h); sl.addImage({ data: t.img, x: cx - im.w * r / 2, y: cy - im.h * r / 2, w: im.w * r, h: im.h * r, flipH: !!m.flipH, flipV: !!m.flipV, ...(iconTurns(m) && m.rot ? { rotate: m.rot } : {}) }); }
        const label = m.label || t.code; const lw = Math.max(0.6, label.length * 0.2 + 0.22) * s;
        sl.addText(label, { x: cx - lw / 2, y: cy + s * 0.6, w: lw, h: s * 0.4, fontFace: FONT, fontSize: Math.max(5, s * 72 * 0.29), bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, fill: { color: hex(t.couleur) } });
      }
      // échelle graphique
      const sb = scaleBarSpec(l);
      if (sb) {
        const bw = sb.px * k, bx = ox + 0.15, by = oy + ph - 0.32, seg = bw / 4;
        sl.addShape(P.ShapeType.rect, { x: bx - 0.08, y: by - 0.2, w: bw + 0.45, h: 0.42, fill: { color: 'FFFFFF', transparency: 10 }, line: { color: LINE, width: 0.5 } });
        for (let i = 0; i < 4; i++) sl.addShape(P.ShapeType.rect, { x: bx + i * seg, y: by + 0.06, w: seg, h: 0.07, fill: { color: i % 2 ? 'FFFFFF' : INK }, line: { color: INK, width: 0.5 } });
        sl.addText(`0                ${String(sb.m).replace('.', ',')} m`, { x: bx - 0.05, y: by - 0.18, w: bw + 0.4, h: 0.22, fontFace: FONT, fontSize: 7, color: INK, margin: 0 });
      }
      // légende + cartouche
      const lt = typesOfLevel(l);
      sl.addShape(P.ShapeType.rect, { x: 10.4, y: 0.85, w: 2.65, h: 4.0, fill: { color: SOFT }, line: { color: LINE, width: 0.5 } });
      sl.addText('LÉGENDE', { x: 10.55, y: 0.92, w: 2.4, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: MUTED, charSpacing: 2 });
      let y = 1.28; const rowH = Math.min(0.5, 3.45 / Math.max(1, lt.length));
      for (const t of lt) {
        const n = l.markers.filter(m => m.typeId === t.id).length; const ic = rowH * 0.8;
        sl.addShape(P.ShapeType.ellipse, { x: 10.55, y, w: ic, h: ic, fill: { color: 'FFFFFF' }, line: { color: hex(t.couleur), width: 1.25 } });
        if (t.img) { const im = await imgSize(t.img); const b = ic * 0.72, r = Math.min(b / im.w, b / im.h); sl.addImage({ data: t.img, x: 10.55 + ic / 2 - im.w * r / 2, y: y + ic / 2 - im.h * r / 2, w: im.w * r, h: im.h * r }); }
        sl.addText([{ text: t.nom, options: { bold: true, breakLine: true } }, { text: `${t.code} · ${n} unité${n > 1 ? 's' : ''}`, options: { color: MUTED, fontSize: 8 } }], { x: 10.55 + ic + 0.08, y, w: 2.35 - ic, h: ic, fontFace: FONT, fontSize: 9, color: INK, valign: 'middle', margin: 0 });
        y += rowH;
      }
      if (!lt.length) sl.addText('Aucun matériel sur ce niveau.', { x: 10.55, y: 1.3, w: 2.4, h: 0.4, fontSize: 9, color: MUTED });
      cartouche(sl, l, li + 2);
    }
    // reportage photographique : 2 photos par diapositive
    const rp = reportPhotos();
    for (let i = 0; i < rp.length; i += 2) {
      const sl = P.addSlide(); sl.background = { color: 'FFFFFF' };
      head(sl, `${x.site} — reportage photographique`); foot(sl);
      rp.slice(i, i + 2).forEach((p, k) => {
        const bw = 6.15, bh = 5.3, bx = 0.35 + k * (bw + 0.2), by = 0.95; const kk = Math.min(bw / p.w, bh / p.h); const w = p.w * kk, h = p.h * kk;
        sl.addShape(P.ShapeType.rect, { x: bx, y: by, w: bw, h: bh, fill: { color: 'F3F5F8' }, line: { color: 'D6DCE5', width: 0.5 } });
        sl.addImage({ data: p.url, x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h });
        sl.addText(photoCaption(p, i + k), { x: bx, y: by + bh + 0.05, w: bw, h: 0.5, fontSize: 10, italic: true, color: '5A6577', align: 'center', valign: 'top', fontFace: FONT });
      });
    }
    const data = await P.write({ outputType: 'uint8array' });
    const p = await window.native.saveFile({ purpose: 'pptx', title: 'Exporter en PowerPoint', defaultPath: `Plans ${safeName(x.site)}${S.project.reference ? ' ' + safeName(S.project.reference) : ''} ind ${x.ind}.pptx`, filters: [{ name: 'PowerPoint', extensions: ['pptx'] }], data });
    if (p) toast('PowerPoint exporté');
  } catch (e) { console.error(e); toast('Export PowerPoint impossible : ' + e.message, true); }
}

/* ---------------------------------------------------------------- planches A3 PDF (même charte et cartouche) */
async function exportPdf() {
  if (!need('exportPdf') || !requireMarkers()) return;
  toast('Génération des planches A3…');
  try {
    const x = await docCtx(); const A = rgb(x.ch.couleur);
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const PW = 420, PH = 297; const lvls = S.project.levels; const pages = lvls.length + 1;
    const logo = x.ch.logo ? await imgSize(x.ch.logo) : null;
    const font = (sz, st = 'normal') => { doc.setFont('helvetica', st); doc.setFontSize(sz); };
    const head = (title) => {
      doc.setFillColor(15, 23, 36); doc.rect(0, 0, PW, 16, 'F'); doc.setFillColor(...A); doc.rect(0, 16, PW, 1, 'F');
      let tx = 10;
      if (logo) { const h = 11, w = h * logo.w / logo.h; doc.setFillColor(255, 255, 255); doc.roundedRect(8, 2.5, w + 3, h, 1.2, 1.2, 'F'); doc.addImage(x.ch.logo, 'PNG', 9.5, 2.5, w, h); tx = 8 + w + 8; }
      doc.setTextColor(255); font(14, 'bold'); doc.text(title, tx, 10.5);
      font(9, 'bold'); doc.text(x.ch.organisme || '', PW - 10, 8, { align: 'right' }); font(8); doc.setTextColor(184, 194, 211); doc.text(x.ch.service || '', PW - 10, 12.5, { align: 'right' });
    };
    const foot = () => {
      doc.setDrawColor(214, 220, 229); doc.line(8, 285, PW - 8, 285);
      font(8, 'italic'); doc.setTextColor(200, 16, 46); doc.text(x.ch.mention || '', 8, 290);
      font(8); doc.setTextColor(90, 101, 119); doc.text(`Réf. ${x.ref} · Ind. ${x.ind}`, PW - 8, 290, { align: 'right' });
    };
    const cartouche = (l, page) => {
      const rows = cartoucheRows(x, l, page, pages), rh = rows.length > 6 ? 9.2 : 10.6; let y = 277.6 - rows.length * rh;
      rows.forEach(([k, v]) => {
        doc.setFillColor(243, 245, 248); doc.rect(344, y, 22, rh, 'F'); doc.setDrawColor(214, 220, 229); doc.rect(344, y, 22, rh); doc.rect(366, y, 46, rh);
        font(7.5, 'bold'); doc.setTextColor(90, 101, 119); doc.text(k, 346, y + 6.6);
        doc.setTextColor(18, 26, 38); const ls = (font(8.5), doc.splitTextToSize(String(v), 43)); if (ls.length > 1) { font(7.5); doc.text(doc.splitTextToSize(String(v), 43).slice(0, 2), 368, y + 4.4); } else doc.text(ls[0], 368, y + 6.6); y += rh;
      });
    };
    // synthèse
    head(`${x.site} — synthèse`); foot();
    doc.setTextColor(18, 26, 38); font(18, 'bold'); doc.text(x.ch.titre, 14, 32);
    font(10); doc.setTextColor(90, 101, 119); doc.text([x.adresse, `Établi par ${x.redac || '—'}`, x.date].filter(Boolean).join('    ·    '), 14, 40);
    const types = usedTypes();
    const cols = [{ t: 'Matériel', w: 70 }, { t: 'Système', w: 36 }, ...lvls.map(l => ({ t: l.name, w: Math.min(28, 200 / Math.max(1, lvls.length)) })), { t: 'Total', w: 20 }];
    let y = 50; const rh = 8;
    const row = (cells, bold, fill) => {
      let xx = 14;
      cells.forEach((c, i) => {
        if (fill) { doc.setFillColor(...fill); doc.rect(xx, y, cols[i].w, rh, 'F'); }
        doc.setDrawColor(214, 220, 229); doc.rect(xx, y, cols[i].w, rh);
        font(9.5, bold ? 'bold' : 'normal'); doc.setTextColor(...(fill && fill[0] !== 243 ? [255, 255, 255] : [18, 26, 38]));
        const txt = doc.splitTextToSize(String(c), cols[i].w - 3)[0];
        i >= 2 ? doc.text(txt, xx + cols[i].w / 2, y + 5.4, { align: 'center' }) : doc.text(txt, xx + 2, y + 5.4);
        xx += cols[i].w;
      }); y += rh;
    };
    row(cols.map(c => c.t), true, A);
    types.forEach(t => { const per = lvls.map(l => l.markers.filter(m => m.typeId === t.id).length); row([t.nom, t.sys, ...per.map(n => n || '—'), per.reduce((a, b) => a + b, 0)], false); });
    const tot = lvls.map(l => l.markers.length); row(['Total', '', ...tot, tot.reduce((a, b) => a + b, 0)], true, [243, 245, 248]);
    cartouche(null, 1);
    for (const [li, l] of lvls.entries()) {
      doc.addPage('a3', 'landscape'); head(`${x.site} — ${lvLabel(l, true)}`); foot();
      const r = await rasterLevel(l);
      const ax = 8, ay = 22, aw = 330, ah = 259; const k = Math.min(aw / r.w, ah / r.h);
      const ix = ax + (aw - r.w * k) / 2, iy = ay + (ah - r.h * k) / 2;
      doc.addImage(r.url, 'JPEG', ix, iy, r.w * k, r.h * k); doc.setDrawColor(214, 220, 229); doc.rect(ix, iy, r.w * k, r.h * k);
      doc.setFillColor(243, 245, 248); doc.rect(344, 22, 68, 186, 'FD');
      doc.setTextColor(90, 101, 119); font(9, 'bold'); doc.text('LÉGENDE', 348, 30);
      const lt = typesOfLevel(l); let yy = 35; const step = Math.min(14, 168 / Math.max(1, lt.length));
      for (const t of lt) {
        const n = l.markers.filter(m => m.typeId === t.id).length; const c = rgb(t.couleur);
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...c); doc.setLineWidth(0.6); doc.circle(353, yy + 5, 5, 'FD'); doc.setLineWidth(0.2);
        if (t.img) { const im = await imgSize(t.img); const b = 7, s = Math.min(b / im.w, b / im.h); doc.addImage(t.img, 'PNG', 353 - im.w * s / 2, yy + 5 - im.h * s / 2, im.w * s, im.h * s); }
        doc.setTextColor(18, 26, 38); font(9.5, 'bold'); doc.text(doc.splitTextToSize(t.nom, 48)[0], 361, yy + 4);
        font(8); doc.setTextColor(90, 101, 119); doc.text(`${t.code} · ${n} unité${n > 1 ? 's' : ''}`, 361, yy + 8.5);
        yy += step;
      }
      if (!lt.length) { font(9); doc.text('Aucun matériel sur ce niveau.', 348, 38); }
      cartouche(l, li + 2);
    }
    doc.setProperties({ title: `${x.ch.titre} — ${x.site}`, author: x.redac || 'Blackeyes Implantation', creator: 'Blackeyes Implantation' });
    const data = new Uint8Array(doc.output('arraybuffer'));
    const p = await window.native.saveFile({ purpose: 'pdf', title: 'Exporter les planches A3', defaultPath: `Planches A3 ${safeName(x.site)}${S.project.reference ? ' ' + safeName(S.project.reference) : ''} ind ${x.ind}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }], data });
    if (p) toast('Planches A3 exportées');
  } catch (e) { console.error(e); toast('Export PDF impossible : ' + e.message, true); }
}

/* ---------------------------------------------------------------- charte (administration) */
async function openCharteEditor(first = false) {
  if (S.user?.role !== 'admin') return;
  const c = { ...(await loadCharte(true)) };
  const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  const render = () => {
    body.innerHTML = `${first ? '<div class="info"><b>Bienvenue.</b> Indiquez votre structure (entreprise, nom commercial ou service) et votre logo : ils figureront en tête de tous les documents produits. Les clients se renseignent ensuite projet par projet et sur la carte.</div>' : ''}<p class="muted" style="margin:0">Appliquée à tous les documents produits (dossier Word et PDF, PowerPoint, planches A3) et transmise aux éditeurs avec la configuration.</p>
      <div class="photo-edit"><div class="ph" style="width:150px;height:80px">${c.logo ? `<img src="${c.logo}" alt="">` : '<span class="muted">Aucun logo</span>'}</div>
        <div class="btnrow"><button type="button" data-a="logo">Changer le logo…</button>${c.logo ? '<button type="button" class="ghost" data-a="nologo">Retirer</button>' : ''}</div></div>
      <div class="row2"><label class="field"><span>Votre structure (raison sociale ou nom)</span><input data-k="organisme" type="text" value="${esc(c.organisme)}" placeholder="ex. nom de votre entreprise"></label>
        <label class="field"><span>Activité / service</span><input data-k="service" type="text" value="${esc(c.service)}" placeholder="ex. Études et implantation de systèmes de sûreté"></label></div>
      <label class="field"><span>Titre des dossiers</span><input data-k="titre" type="text" value="${esc(c.titre)}"></label>
      <label class="field"><span>Mention de confidentialité (pied de page)</span><input data-k="mention" type="text" value="${esc(c.mention)}"></label>
      <label class="field"><span>Couleur d'accent</span><div class="pwrow" style="align-items:center"><input data-k="couleur" type="color" value="${esc(c.couleur)}"><span class="muted" style="font-size:12px">Titres, filets et en-têtes de tableaux.</span></div></label>`;
  };
  body.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) c[k] = e.target.value; });
  body.addEventListener('click', async (e) => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'nologo') { c.logo = ''; render(); }
    if (a === 'logo') {
      try { const f = await window.native.openFile({ purpose: 'logo', title: 'Choisir le logo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] }); if (!f) return;
        const url = await bytesToDataUrl(f.data, /png$/i.test(f.name) ? 'image/png' : 'image/jpeg'); const img = await loadImg(url);
        const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight)); const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); c.logo = cv.toDataURL('image/png'); render(); }
      catch (err) { toast(err.message, true); }
    }
  });
  render();
  const r = await modal({
    title: first ? 'Votre structure et vos documents' : 'Charte des documents', size: 'md', body,
    left: [{ label: 'Charte par défaut', cls: 'ghost', action: async () => { if (await confirmBox('Charte par défaut', 'Effacer votre structure et votre logo pour revenir à la charte par défaut ?', 'Rétablir', true)) { try { Object.assign(c, await window.native.charte.reset()); CHARTE = null; render(); toast('Charte rétablie'); } catch (err) { toast(err.message, true); } } return false; } }],
    buttons: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', cls: 'primary', action: async () => { try { CHARTE = await window.native.charte.save(c); toast('Charte enregistrée'); return true; } catch (err) { toast(err.message, true); return false; } } }]
  });
  return r;
}

/* première connexion de l'administrateur sur une nouvelle installation : structure à renseigner */
async function charteFirstRun() {
  if (S.user?.role !== 'admin') return;
  try { const c = await loadCharte(true); if (!String(c.organisme || '').trim() && !$('#modalRoot').children.length) await openCharteEditor(true); } catch {}
}
