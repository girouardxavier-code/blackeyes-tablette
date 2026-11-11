/* Ciel Direct — suivi du trafic aérien en direct.
   Sources : ADSB.lol et OpenSky Network (réseaux communautaires ADS-B), ou simulation hors ligne. */
(() => {
  'use strict';
  const D = window.CD_DATA;
  const $ = (id) => document.getElementById(id);
  const NM = 1852, FT = 0.3048, KT = 1.852;
  const PLANE_PATH = 'M12 1.5c.9 0 1.5 1.2 1.5 2.6v5l8.5 4.6v2.1l-8.5-2.6-.4 5.6 2.9 2v1.5L12 21.4l-4 .9v-1.5l2.9-2-.4-5.6L2 15.8v-2.1l8.5-4.6v-5c0-1.4.6-2.6 1.5-2.6z';

  /* ---------- Réglages mémorisés ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cd.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
  };
  const S = Object.assign({
    minAlt: 0, maxAlt: 45000, hideGround: false, labels: true, airports: true,
    units: 'avia', source: 'auto', base: 'dark', view: [46.6, 2.5, 6], cie: '', cieNom: ''
  }, store.get('settings', {}));
  const save = () => store.set('settings', S);

  /* ---------- Carte ---------- */
  const map = L.map('map', { zoomControl: true, worldCopyJump: true, preferCanvas: false, minZoom: 2 })
    .setView([S.view[0], S.view[1]], S.view[2]);
  map.zoomControl.setPosition('bottomright');
  const bases = {
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagerie © Esri' })
  };
  let base = bases[S.base] || bases.dark;
  base.addTo(map);
  map.createPane('planes').style.zIndex = 450;
  const acLayer = L.layerGroup().addTo(map);
  const trailLayer = L.layerGroup().addTo(map);
  const aptLayer = L.layerGroup().addTo(map);

  /* ---------- Outils ---------- */
  const toRad = (d) => d * Math.PI / 180, toDeg = (r) => r * 180 / Math.PI;
  function distKm(a, b) {
    const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const f1 = toRad(a[0]), f2 = toRad(b[0]), dl = toRad(b[1] - a[1]);
    return (toDeg(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl))) + 360) % 360;
  }
  function interGC(a, b, f) {
    const f1 = toRad(a[0]), l1 = toRad(a[1]), f2 = toRad(b[0]), l2 = toRad(b[1]);
    const d = distKm(a, b) / 6371;
    if (d < 1e-9) return a.slice();
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    return [toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))];
  }
  const STOPS = [[0, [251, 146, 60]], [5000, [250, 204, 21]], [12000, [74, 222, 128]], [22000, [34, 211, 238]], [32000, [129, 140, 248]], [42000, [232, 121, 249]]];
  function altColor(alt, ground) {
    if (ground) return '#9ca3af';
    alt = Math.max(0, alt || 0);
    for (let i = 1; i < STOPS.length; i++) {
      if (alt <= STOPS[i][0]) {
        const [a0, c0] = STOPS[i - 1], [a1, c1] = STOPS[i], t = (alt - a0) / (a1 - a0);
        return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
      }
    }
    return 'rgb(232,121,249)';
  }
  const nf = new Intl.NumberFormat('fr-FR');
  const fmt = {
    alt: (p) => p.ground ? 'Au sol' : p.alt == null ? '—' : S.units === 'metric' ? `${nf.format(Math.round(p.alt * FT))} m` : `${nf.format(Math.round(p.alt))} ft`,
    altShort: (p) => p.ground ? 'sol' : p.alt == null ? '—' : S.units === 'metric' ? nf.format(Math.round(p.alt * FT)) : nf.format(Math.round(p.alt / 100) * 100),
    spd: (v) => v == null ? '—' : S.units === 'metric' ? `${nf.format(Math.round(v * KT))} km/h` : `${nf.format(Math.round(v))} kt`,
    spdShort: (v) => v == null ? '—' : nf.format(Math.round(S.units === 'metric' ? v * KT : v)),
    vs: (v) => v == null ? '—' : S.units === 'metric' ? `${v > 0 ? '+' : ''}${(v * FT / 60).toFixed(1).replace('.', ',')} m/s` : `${v > 0 ? '+' : ''}${nf.format(Math.round(v))} ft/min`
  };
  function countryOf(hex) {
    const n = parseInt(hex, 16);
    if (!Number.isFinite(n)) return null;
    const r = D.pays.find(([a, b]) => n >= a && n <= b);
    return r ? r[2] : null;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }
  const EMERG = { '7500': 'Intervention illicite', '7600': 'Panne radio', '7700': 'Urgence' };

  /* ---------- Sources de données ---------- */
  function viewQuery() {
    const b = map.getBounds(), c = map.getCenter();
    const rKm = Math.max(distKm([c.lat, c.lng], [b.getNorth(), b.getEast()]), distKm([c.lat, c.lng], [b.getSouth(), b.getWest()]));
    return { b, c, rNm: Math.ceil(rKm * 1000 / NM) };
  }
  /* Vue large : la zone est couverte par des cercles de 250 NM (limite d'une requête ADSB.lol),
     les plus proches du centre d'abord. */
  const MAX_TILES = 30;
  function tilesFor(b, c) {
    const R = 250 * NM / 1000, step = R * 1.3 / 111;
    let w = b.getWest(), e = b.getEast(); if (e - w >= 360) { w = -180; e = 180; }
    const s = Math.max(-80, b.getSouth()), n = Math.min(80, b.getNorth()), pts = [];
    for (let lat = s + step / 2, row = 0; lat < n + step / 2; lat += step, row++) {
      const dl = step / Math.max(.25, Math.cos(toRad(Math.min(80, lat))));
      for (let lon = w + (row % 2 ? dl : dl / 2); lon < e + dl / 2; lon += dl) pts.push([Math.min(80, lat), ((lon + 540) % 360) - 180]);
    }
    return pts.sort((a, z) => distKm([c.lat, c.lng], a) - distKm([c.lat, c.lng], z)).slice(0, MAX_TILES);
  }
  async function pool(items, n, fn) {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
    return out;
  }
  // vue monde : carte très dézoomée, ou filtre compagnie actif (ses avions sont cherchés partout)
  const worldView = () => map.getZoom() <= 4 || !!S.cie;
  /* Dans l'application Android, les requêtes passent par le pont natif (pas de restriction CORS). */
  const NATIVE = window.CDNative || null;
  const pend = new Map(); let seq = 0;
  window.__cdHttp = (id, status, text) => { const p = pend.get(id); if (!p) return; pend.delete(id); clearTimeout(p.t);
    if (status < 200 || status >= 300) return p.rej(new Error(status ? 'HTTP ' + status : (text || 'Réseau indisponible')));
    try { p.res(JSON.parse(text)); } catch (e) { p.rej(e); } };
  function nativeJSON(url, opts) {
    return new Promise((res, rej) => {
      const id = String(++seq);
      pend.set(id, { res, rej, t: setTimeout(() => { pend.delete(id); rej(new Error('Délai dépassé')); }, 15000) });
      NATIVE.http(id, opts.method || 'GET', url, opts.body || '', JSON.stringify(opts.headers || {}));
    });
  }
  async function getJSON(url, opts = {}) {
    if (NATIVE) return nativeJSON(url, opts);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  function fromAdsb(list) {
    const now = Date.now();
    return (list || []).filter((a) => a.lat != null && a.lon != null).map((a) => {
      const ground = a.alt_baro === 'ground';
      const hex = String(a.hex || '').replace('~', '').toLowerCase();
      return {
        id: String(a.hex).toLowerCase(), hex, callsign: (a.flight || '').trim(), reg: a.r || '', type: a.t || '', typeName: a.desc || '',
        operator: a.ownOp || '', country: countryOf(hex), lat: a.lat, lon: a.lon,
        alt: ground ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : a.alt_geom ?? null), ground,
        gs: a.gs ?? null, track: a.track ?? a.true_heading ?? a.mag_heading ?? null, vs: a.baro_rate ?? a.geom_rate ?? null,
        squawk: a.squawk || '', fix: now - (a.seen_pos ?? a.seen ?? 0) * 1000, src: 'adsblol'
      };
    });
  }
  const sources = {
    adsblol: {
      label: 'ADSB.lol · direct', live: true, tiles: 1,
      get interval() { return this.tiles > 1 ? 20000 : 6000; },
      async fetch() {
        const { b, c, rNm } = viewQuery();
        if (rNm <= 250) {
          this.tiles = 1; this.label = 'ADSB.lol · direct';
          return fromAdsb((await getJSON(`https://api.adsb.lol/v2/point/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}/${rNm}`)).ac);
        }
        const tiles = tilesFor(b, c); this.tiles = tiles.length;
        const res = await pool(tiles, 5, (t) => getJSON(`https://api.adsb.lol/v2/point/${t[0].toFixed(3)}/${t[1].toFixed(3)}/250`));
        if (res.every((r) => !r)) throw new Error('aucune réponse');
        const seen = new Set();
        this.label = `ADSB.lol · ${tiles.length} zones`;
        return fromAdsb(res.flatMap((r) => (r && r.ac) || [])).filter((d) => !seen.has(d.id) && seen.add(d.id));
      }
    },
    opensky: {
      label: 'OpenSky Network · direct', live: true,
      // la vue monde coûte 4 crédits OpenSky par requête (400 par jour sans compte) : une par minute
      get interval() { return worldView() ? 60000 : 12000; },
      async fetch() {
        const { b } = viewQuery();
        const all = !!S.cie || b.getEast() - b.getWest() >= 300;
        this.label = all ? 'OpenSky Network · monde entier' : 'OpenSky Network · direct';
        const j = await getJSON(all ? 'https://opensky-network.org/api/states/all'
          : `https://opensky-network.org/api/states/all?lamin=${b.getSouth().toFixed(3)}&lomin=${b.getWest().toFixed(3)}&lamax=${b.getNorth().toFixed(3)}&lomax=${b.getEast().toFixed(3)}`);
        const now = Date.now(), srvT = j.time || now / 1000;
        return (j.states || []).filter((s) => s[5] != null && s[6] != null).map((s) => ({
          id: s[0], hex: s[0], callsign: (s[1] || '').trim(), reg: '', type: '', typeName: '', operator: '',
          country: s[2] || countryOf(s[0]), lat: s[6], lon: s[5],
          alt: s[7] != null ? s[7] / FT : s[13] != null ? s[13] / FT : null, ground: !!s[8],
          gs: s[9] != null ? s[9] * 3600 / NM : null, track: s[10], vs: s[11] != null ? s[11] / FT * 60 : null,
          squawk: s[14] || '', fix: now - Math.max(0, srvT - (s[3] || srvT)) * 1000, src: 'opensky'
        }));
      }
    },
    sim: {
      label: 'Simulation · trafic fictif', interval: 3000, live: false,
      async fetch() { return Sim.states(); }
    }
  };

  /* ---------- Simulation hors ligne ---------- */
  const Sim = (() => {
    const apts = D.aeroports.map(([iata, icao, name, lat, lon]) => ({ iata, icao, name, ll: [lat, lon] }));
    const eu = apts.filter((a) => a.ll[0] > 30 && a.ll[0] < 62 && a.ll[1] > -12 && a.ll[1] < 32);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    let flights = null, seq = 0;
    function make(from, warm) {
      from = from || pick(Math.random() < .85 ? eu : apts);
      let to, d;
      for (let i = 0; i < 40; i++) {
        to = pick(Math.random() < .8 ? eu : apts);
        d = distKm(from.ll, to.ll);
        if (to !== from && d > 250 && d < 9500) break;
      }
      const al = pick(D.compagniesSim), ty = d > 3500 ? pick(D.typesSim.slice(6, 10)) : d < 600 ? pick(D.typesSim.slice(10)) : pick(D.typesSim.slice(0, 6));
      const cruiseKt = ty[0].startsWith('AT') ? 280 : ty[0].startsWith('CR') || ty[0].startsWith('E1') ? 420 : rnd(440, 495);
      const dur = d / (cruiseKt * KT) * 3600e3;
      const hex = (0xF00000 + (++seq * 7919) % 0x0FFFFF).toString(16);
      return {
        id: 'sim' + hex, hex, callsign: al[0] + Math.floor(rnd(10, 9899)), operator: al[1] + ' (fictif)', reg: 'SIM-' + hex.slice(-4).toUpperCase(),
        type: ty[0], typeName: ty[1], from, to, d, cruiseKt,
        cruiseFt: d < 500 ? 22000 + Math.round(rnd(0, 6)) * 1000 : d < 1500 ? 30000 + Math.round(rnd(0, 6)) * 1000 : 35000 + Math.round(rnd(0, 4)) * 1000,
        t0: Date.now() - (warm ? Math.random() * dur : 0), dur,
        squawk: String(Math.floor(rnd(1, 7))) + [0, 0, 0].map(() => Math.floor(rnd(0, 8))).join('')
      };
    }
    function state(f, now) {
      const fr = Math.min(1, (now - f.t0) / f.dur);
      const pos = interGC(f.from.ll, f.to.ll, fr), next = interGC(f.from.ll, f.to.ll, Math.min(1, fr + .002));
      const flown = f.d * fr, left = f.d - flown, ramp = Math.min(220, f.d * .4);
      let alt = f.cruiseFt, vs = 0, gs = f.cruiseKt;
      if (flown < ramp) { const k = flown / ramp; alt = f.cruiseFt * Math.sqrt(k); vs = 2200 * (1 - k) + 600; gs = 160 + (f.cruiseKt - 160) * k; }
      else if (left < ramp) { const k = left / ramp; alt = f.cruiseFt * k; vs = -1600; gs = 150 + (f.cruiseKt - 150) * k; }
      return {
        id: f.id, hex: f.hex, callsign: f.callsign, reg: f.reg, type: f.type, typeName: f.typeName, operator: f.operator, country: 'Simulation',
        lat: pos[0], lon: pos[1], alt: Math.round(alt / 25) * 25, ground: false, gs, track: bearing(pos, next), vs: Math.round(vs / 64) * 64,
        squawk: f.squawk, fix: now, src: 'sim',
        route: { from: { code: f.from.iata, name: f.from.name, ll: f.from.ll }, to: { code: f.to.iata, name: f.to.name, ll: f.to.ll } }
      };
    }
    return {
      states() {
        const now = Date.now();
        if (!flights) flights = Array.from({ length: 220 }, () => make(null, true));
        flights = flights.map((f) => (now - f.t0 >= f.dur ? make(f.to, false) : f));
        return flights.map((f) => state(f, now));
      }
    };
  })();

  /* ---------- État des avions ---------- */
  const planes = new Map();   // id → { d, marker, trail, rot }
  let selected = null, follow = false, showTrail = true, curSource = null, lastOk = 0;

  const cieOf = (cs, codes) => { cs = String(cs || '').toUpperCase(); return codes.split(' ').some((o) => o && cs.startsWith(o) && /\d/.test(cs[o.length] || '')); };
  function visibleByFilter(d) {
    if (S.hideGround && d.ground) return false;
    if (S.cie && !cieOf(d.callsign, S.cie)) return false;
    const a = d.ground ? 0 : (d.alt ?? 0);
    return a >= S.minAlt && (S.maxAlt >= 45000 || a <= S.maxAlt);
  }
  function makeIcon() {
    return L.divIcon({ className: 'ac', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<svg class="plane" viewBox="0 0 24 24"><path d="${PLANE_PATH}"/></svg><span class="lbl"></span>` });
  }
  function paint(p) {
    const el = p.marker.getElement(); if (!el) return;
    const d = p.d;
    el.querySelector('path').setAttribute('fill', altColor(d.alt, d.ground));
    el.querySelector('.plane').style.transform = `rotate(${d.track ?? 0}deg)`;
    el.querySelector('.lbl').textContent = d.callsign || d.reg || d.hex.toUpperCase();
    el.classList.toggle('sel', p.d.id === selected);
    el.classList.toggle('emerg', !!EMERG[d.squawk]);
    el.title = `${d.callsign || d.hex.toUpperCase()} · ${fmt.alt(d)}`;
  }
  /* Beaucoup d'avions (vue continent ou monde) : dessin rapide sur un canevas, sans étiquettes. */
  const LITE_MAX = 700, PATH2D = new Path2D(PLANE_PATH);
  let lite = false;
  const PlaneCanvas = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create('canvas', 'plane-canvas'); m.getPane('planes').appendChild(this._c);
      m.on('moveend zoomend resize viewreset', this.redraw, this); m.on('zoomstart', this._hide, this); this.redraw();
    },
    onRemove(m) { this._c.remove(); m.off('moveend zoomend resize viewreset', this.redraw, this); m.off('zoomstart', this._hide, this); },
    _hide() { this._c.style.visibility = 'hidden'; },
    redraw() {
      const m = this._map; if (!m) return;
      const c = this._c, sz = m.getSize(), r = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      if (c.width !== Math.round(sz.x * r) || c.height !== Math.round(sz.y * r)) {
        c.width = Math.round(sz.x * r); c.height = Math.round(sz.y * r); c.style.width = sz.x + 'px'; c.style.height = sz.y + 'px';
      }
      const g = c.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, sz.x, sz.y); c.style.visibility = 'visible';
      this.pts = [];
      if (!lite) return;
      const now = Date.now(), k = m.getZoom() <= 3 ? .42 : m.getZoom() <= 5 ? .55 : .7;
      for (const p of planes.values()) {
        if (!p.vis || p.d.id === selected) continue;
        const pt = m.latLngToContainerPoint(project(p.d, now));
        if (pt.x < -12 || pt.y < -12 || pt.x > sz.x + 12 || pt.y > sz.y + 12) continue;
        g.setTransform(r, 0, 0, r, 0, 0); g.translate(pt.x, pt.y); g.rotate(toRad(p.d.track ?? 0)); g.scale(k, k); g.translate(-12, -12);
        g.fillStyle = EMERG[p.d.squawk] ? '#ef4444' : altColor(p.d.alt, p.d.ground); g.fill(PATH2D);
        this.pts.push([pt.x, pt.y, p.d.id]);
      }
    },
    hit(cp) {
      let best = null, bd = 16 * 16;
      for (const [x, y, id] of this.pts || []) { const dd = (x - cp.x) ** 2 + (y - cp.y) ** 2; if (dd < bd) { bd = dd; best = id; } }
      return best;
    }
  });
  const planeCanvas = new PlaneCanvas().addTo(map);
  map.on('zoomend', () => syncDisplay());
  function syncDisplay() {
    let n = 0;
    for (const p of planes.values()) { p.vis = visibleByFilter(p.d); if (p.vis) n++; }
    lite = n > (map.getZoom() <= 5 ? 200 : LITE_MAX);   // étiquettes illisibles en vue large
    for (const p of planes.values()) {
      const want = p.d.id === selected || (!lite && p.vis);
      if (want && !acLayer.hasLayer(p.marker)) acLayer.addLayer(p.marker);
      else if (!want && acLayer.hasLayer(p.marker)) acLayer.removeLayer(p.marker);
    }
    $('sCount').textContent = nf.format(n);
    planeCanvas.redraw();
  }
  function project(d, now) {
    if (d.ground || !d.gs || d.track == null) return [d.lat, d.lon];
    const h = Math.min(60e3, Math.max(0, now - d.fix)) / 3600e3;
    const nm = d.gs * h, tr = toRad(d.track);
    const lat = d.lat + nm * Math.cos(tr) / 60;
    return [lat, d.lon + nm * Math.sin(tr) / (60 * Math.max(.05, Math.cos(toRad(d.lat))))];
  }

  function ingest(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let p = planes.get(d.id);
      if (!p) {
        p = { d, trail: [], marker: L.marker([d.lat, d.lon], { icon: makeIcon(), keyboard: false, riseOnHover: true }) };
        p.marker.on('add', () => paint(p));
        p.marker.on('click', () => select(d.id));
        planes.set(d.id, p);
      }
      const prevRoute = p.d.route;
      p.d = d;
      if (!d.route && prevRoute) d.route = prevRoute;
      const last = p.trail[p.trail.length - 1];
      if (!last || last[0] !== d.lat || last[1] !== d.lon) {
        p.trail.push([d.lat, d.lon, d.ground ? 0 : d.alt ?? 0, d.fix]);
        if (p.trail.length > 600) p.trail.shift();
      }
      p.marker.setLatLng(project(d, Date.now()));
      paint(p);
    }
    const now = Date.now();
    for (const [id, p] of planes) {
      if (seen.has(id)) continue;
      // L'avion sélectionné est conservé plus longtemps (sortie de zone, perte de signal)
      if (id === selected && now - p.d.fix < 120e3) continue;
      acLayer.removeLayer(p.marker); planes.delete(id);
      if (id === selected) { toast('Signal perdu pour ' + (p.d.callsign || id.toUpperCase())); deselect(); }
    }
    syncDisplay();
    if (pendingFit) fitCie();
    if (selected) updateCard();
    if (!$('list').hidden) renderList();
    if (pendingHash && planes.has(pendingHash)) { const h = pendingHash; pendingHash = null; select(h, true); }
  }

  /* ---------- Boucle de mise à jour ---------- */
  let timer = null, busy = false, simSince = 0;
  const order = () => (S.source !== 'auto' ? [S.source] : worldView() ? ['opensky', 'adsblol', 'sim'] : ['adsblol', 'opensky', 'sim']);
  const pause = {};   // source → instant jusqu'auquel elle n'est plus essayée (quota épuisé)
  const ivOf = (k) => sources[k].interval;
  async function refresh() {
    if (busy) return; busy = true; clearTimeout(timer);
    let list = order();
    // En automatique, après bascule en simulation, on retente le direct toutes les 60 s
    if (S.source === 'auto' && curSource === 'sim' && Date.now() - simSince < 60e3) list = ['sim'];
    let ok = false;
    for (const k of list) {
      if (S.source === 'auto' && pause[k] > Date.now()) continue;
      try {
        const data = await sources[k].fetch();
        if (curSource !== k) {
          if (curSource && sources[curSource].live !== sources[k].live) clearAll();
          if (k === 'sim') { simSince = Date.now(); if (S.source === 'auto') toast('Réseau indisponible : affichage d\'un trafic simulé (fictif).'); }
          curSource = k;
        }
        ingest(data); ok = true; lastOk = Date.now();
        break;
      } catch (e) {
        console.warn('Source ' + k + ' indisponible :', e.message || e);
        if (/HTTP 429/.test(e.message || '')) pause[k] = Date.now() + 10 * 60e3;
      }
    }
    setStatus(ok);
    busy = false;
    timer = setTimeout(refresh, curSource ? ivOf(curSource) : 15000);
  }
  function clearAll() { acLayer.clearLayers(); trailLayer.clearLayers(); planes.clear(); if (selected) deselect(); }
  function setStatus(ok) {
    const dot = $('sDot');
    dot.className = 'dot ' + (!ok ? 'err' : curSource === 'sim' ? 'sim' : 'live');
    $('sSrc').textContent = ok ? sources[curSource].label : 'Aucune donnée — nouvel essai…';
    if (ok) $('sTime').textContent = 'Mis à jour ' + new Date(lastOk).toLocaleTimeString('fr-FR');
  }
  let moveT;
  map.on('moveend', () => {
    const c = map.getCenter(); S.view = [+c.lat.toFixed(4), +c.lng.toFixed(4), map.getZoom()]; save();
    if (curSource && sources[curSource].live) { clearTimeout(moveT); moveT = setTimeout(refresh, 700); }
    if (!$('list').hidden) renderList();
  });

  // Animation entre deux positions reçues (estime de position)
  setInterval(() => {
    const now = Date.now(), b = map.getBounds().pad(.2);
    for (const p of planes.values()) {
      if (!acLayer.hasLayer(p.marker)) continue;
      const ll = project(p.d, now);
      if (b.contains(ll) || p.d.id === selected) p.marker.setLatLng(ll);
    }
    if (selected && follow) { const p = planes.get(selected); if (p) map.panTo(p.marker.getLatLng(), { animate: true, duration: .8 }); }
    if (lite) planeCanvas.redraw();
  }, 1000);

  /* ---------- Sélection et fiche ---------- */
  const photoCache = new Map(), routeCache = new Map();
  function select(id, fly) {
    const p = planes.get(id); if (!p) return;
    const prev = selected && planes.get(selected);
    selected = id;
    if (prev) paint(prev);
    if (!acLayer.hasLayer(p.marker)) acLayer.addLayer(p.marker);
    paint(p);
    $('card').hidden = false; document.body.classList.add('has-sheet');
    hidePanels();
    if (fly) map.setView(p.marker.getLatLng(), Math.max(map.getZoom(), 8));
    loadPhoto(p.d); loadRoute(p.d);
    updateCard();
    history.replaceState(null, '', '#vol=' + encodeURIComponent(id));
  }
  function deselect() {
    const p = selected && planes.get(selected);
    selected = null; follow = false; $('bFollow').classList.remove('on');
    if (p) paint(p);
    syncDisplay();
    trailLayer.clearLayers();
    $('card').hidden = true; document.body.classList.remove('has-sheet');
    history.replaceState(null, '', location.pathname + location.search);
  }
  function updateCard() {
    const p = planes.get(selected); if (!p) return;
    const d = p.d, em = EMERG[d.squawk];
    const fno = flightNo(d.callsign);
    $('cCall').textContent = fno ? fno.no : d.callsign || d.reg || d.hex.toUpperCase();
    $('cSub').textContent = [fno && `Indicatif ${d.callsign}`, d.operator || (fno && fno.nom), d.typeName || d.type].filter(Boolean).join(' · ') || 'Informations limitées';
    const badge = $('cBadge');
    badge.className = 'badge' + (em ? ' emerg' : d.ground ? ' ground' : '');
    badge.textContent = em ? `${d.squawk} · ${em}` : d.ground ? 'Au sol' : d.vs > 300 ? 'En montée' : d.vs < -300 ? 'En descente' : 'En croisière';
    $('cAlt').textContent = fmt.alt(d);
    $('cSpd').textContent = fmt.spd(d.gs);
    $('cTrk').textContent = d.track == null ? '—' : Math.round(d.track) + '°';
    $('cVs').textContent = fmt.vs(d.vs);
    $('cType').textContent = d.type || '—';
    $('cReg').textContent = d.reg || '—';
    $('cHex').textContent = d.hex.toUpperCase();
    $('cSq').textContent = d.squawk || '—';
    $('cCty').textContent = d.country || '—';
    $('cPos').textContent = `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`;
    // Route
    const r = d.route;
    $('cRoute').hidden = !r;
    if (r) {
      $('cFrom').textContent = r.from.code; $('cFromN').textContent = r.from.name;
      $('cTo').textContent = r.to.code; $('cToN').textContent = r.to.name;
      let pct = 0;
      if (r.from.ll && r.to.ll) { const a = distKm(r.from.ll, [d.lat, d.lon]), b = distKm([d.lat, d.lon], r.to.ll); pct = a / (a + b) * 100; }
      $('cProg').style.width = pct + '%'; $('cRoute').querySelector('svg').style.left = pct + '%';
    }
    drawTrail(p); drawGraph(p);
  }
  function drawTrail(p) {
    trailLayer.clearLayers();
    if (!showTrail || p.trail.length < 1) return;
    const pts = p.trail.concat([[...project(p.d, Date.now()), p.d.alt ?? 0]]);
    for (let i = 1; i < pts.length; i++) {
      L.polyline([pts[i - 1].slice(0, 2), pts[i].slice(0, 2)], { color: altColor(pts[i][2], pts[i][2] === 0 && p.d.ground), weight: 3, opacity: .9, interactive: false }).addTo(trailLayer);
    }
    const r = p.d.route;
    if (r && r.to.ll) L.polyline([pts[pts.length - 1].slice(0, 2), r.to.ll], { color: '#94a3b8', weight: 1.5, dashArray: '4 6', interactive: false }).addTo(trailLayer);
  }
  function drawGraph(p) {
    const cv = $('cGraph'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const t = p.trail;
    g.fillStyle = '#94a3b8'; g.font = '20px system-ui';
    if (t.length < 2) { g.fillText('Profil d\'altitude : en cours d\'enregistrement…', 14, H / 2 + 6); return; }
    const t0 = t[0][3], t1 = t[t.length - 1][3] || t0 + 1, maxA = Math.max(1000, ...t.map((x) => x[2]));
    const X = (x) => 8 + (x - t0) / Math.max(1, t1 - t0) * (W - 16), Y = (a) => H - 10 - a / maxA * (H - 30);
    const grd = g.createLinearGradient(0, H, 0, 0); grd.addColorStop(0, 'rgba(45,212,191,0)'); grd.addColorStop(1, 'rgba(45,212,191,.35)');
    g.beginPath(); g.moveTo(X(t[0][3]), H - 10);
    t.forEach((x) => g.lineTo(X(x[3]), Y(x[2])));
    g.lineTo(X(t[t.length - 1][3]), H - 10); g.closePath(); g.fillStyle = grd; g.fill();
    g.beginPath(); t.forEach((x, i) => (i ? g.lineTo : g.moveTo).call(g, X(x[3]), Y(x[2])));
    g.strokeStyle = '#2dd4bf'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#94a3b8';
    g.fillText(S.units === 'metric' ? `${nf.format(Math.round(maxA * FT))} m` : `${nf.format(Math.round(maxA))} ft`, 12, 22);
    g.textAlign = 'right'; g.fillText(`${Math.round((t1 - t0) / 60000)} min`, W - 12, 22); g.textAlign = 'left';
  }
  async function loadPhoto(d) {
    const box = $('cPhoto');
    box.hidden = d.src === 'sim';
    if (d.src === 'sim' || !/^[0-9a-f]{6}$/.test(d.hex)) { box.innerHTML = '<span class="muted">Pas de photo</span>'; return; }
    box.innerHTML = '<span class="muted">Recherche d\'une photo…</span>';
    let ph = photoCache.get(d.hex);
    if (ph === undefined) {
      try {
        const j = await getJSON(`https://api.planespotters.net/pub/photos/hex/${d.hex}`);
        const x = j.photos && j.photos[0];
        ph = x ? { src: (x.thumbnail_large || x.thumbnail).src, link: x.link, by: x.photographer } : null;
      } catch { ph = null; }
      photoCache.set(d.hex, ph);
    }
    if (selected !== d.id) return;
    box.innerHTML = ph
      ? `<img src="${esc(ph.src)}" alt="Photo de l'appareil" referrerpolicy="no-referrer"><a class="credit" href="${esc(ph.link)}" target="_blank" rel="noopener">© ${esc(ph.by)} · planespotters.net</a>`
      : '<span class="muted">Pas de photo</span>';
  }
  async function loadRoute(d) {
    if (d.route || d.src === 'sim' || !d.callsign) return;
    let r = routeCache.get(d.callsign);
    if (r === undefined) {
      try {
        const j = await getJSON('https://api.adsb.lol/api/0/routeset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planes: [{ callsign: d.callsign, lat: d.lat, lng: d.lon }] })
        });
        const x = Array.isArray(j) ? j[0] : null;
        r = null;
        if (x && x.plausible !== false && x._airports && x._airports.length >= 2) {
          const A = x._airports, a = A[0], b = A[A.length - 1];
          const ap = (o) => ({ code: o.iata || o.icao, name: o.location || o.name || '', ll: o.lat != null ? [+o.lat, +o.lon] : null });
          r = { from: ap(a), to: ap(b) };
        } else if (x && x._airport_codes_iata && x.plausible !== false) {
          const c = x._airport_codes_iata.split('-');
          const find = (code) => { const a = D.aeroports.find((z) => z[0] === code); return { code, name: a ? a[2] : '', ll: a ? [a[3], a[4]] : null }; };
          if (c.length >= 2) r = { from: find(c[0]), to: find(c[c.length - 1]) };
        }
      } catch { r = null; }
      routeCache.set(d.callsign, r);
    }
    const p = planes.get(d.id);
    if (r && p) { p.d.route = r; if (selected === d.id) updateCard(); }
  }

  /* ---------- Liste des vols ---------- */
  function renderList() {
    const b = map.getBounds(), c = map.getCenter();
    let rows = [...planes.values()].filter((p) => (p.vis || p.d.id === selected) && b.contains(p.marker.getLatLng())).map((p) => p.d);
    const k = $('lSort').value;
    const cmp = {
      alt: (a, z) => (z.ground ? 0 : z.alt ?? 0) - (a.ground ? 0 : a.alt ?? 0),
      gs: (a, z) => (z.gs ?? 0) - (a.gs ?? 0),
      call: (a, z) => (a.callsign || a.hex).localeCompare(z.callsign || z.hex),
      dist: (a, z) => distKm([c.lat, c.lng], [a.lat, a.lon]) - distKm([c.lat, c.lng], [z.lat, z.lon])
    }[k];
    rows.sort(cmp);
    $('lCount').textContent = `(${rows.length})`;
    rows = rows.slice(0, 300);
    $('lBody').innerHTML = rows.map((d) => `<tr data-id="${esc(d.id)}" class="${d.id === selected ? 'sel' : ''}">
      <td><span class="swatch" style="background:${altColor(d.alt, d.ground)}"></span>${esc(d.callsign || d.reg || d.hex.toUpperCase())}</td>
      <td>${esc(d.type || '—')}</td><td class="r">${fmt.altShort(d)}</td><td class="r">${fmt.spdShort(d.gs)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">Aucun avion dans la zone affichée.</td></tr>';
  }
  $('lBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id, true); });
  $('lSort').addEventListener('change', renderList);

  /* ---------- Compagnies aériennes ---------- */
  let pendingFit = false;
  const sansAccent = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  {
    const fc = $('fCie');
    [...(D.compagnies || [])].sort((a, z) => a[2].localeCompare(z[2], 'fr')).forEach(([iata, oaci, nom]) => {
      const o = new Option(`${nom} (${iata})`, oaci); o.dataset.nom = nom; fc.add(o);
    });
  }
  /* Filtre compagnie : seuls ses avions sont affichés ; la carte passe en vue monde pour les voir tous. */
  function setCie(codes, nom, world) {
    S.cie = codes; S.cieNom = nom; save(); syncFilters(); applyFilters();
    if (codes && world) {
      pendingFit = true;
      if (map.getZoom() > 3) map.setView([35, 5], 2); else refresh();
      toast(`Recherche des avions ${nom} dans le monde…`);
    }
  }
  function fitCie() {
    const pts = [...planes.values()].filter((p) => p.vis).map((p) => p.marker.getLatLng());
    if (!pts.length) return;
    pendingFit = false;
    toast(`${nf.format(pts.length)} avion${pts.length > 1 ? 's' : ''} ${S.cieNom || S.cie} en vol.`);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(.15), { maxZoom: 7 }); else map.setView(pts[0], 7);
  }
  function cieHits(raw, s) {
    const out = [], u = sansAccent(raw);
    for (const [iata, oaci, nom] of D.compagnies || []) {
      const codes = oaci.split(' ');
      const exact = iata === s || codes.includes(s), byName = u.length >= 3 && sansAccent(nom).includes(u);
      if (exact || byName) out.push({ kind: 'cie', codes: oaci, nom, iata, exact });
    }
    if (/^[A-Z]{3}$/.test(s) && !out.some((h) => h.codes.split(' ').includes(s))) out.push({ kind: 'cie', codes: s, nom: `Indicatifs ${s}…`, iata: '', exact: true });
    return out.sort((a, z) => z.exact - a.exact).slice(0, 4);
  }

  /* ---------- Recherche ---------- */
  const q = $('q'), qres = $('qres');
  let hits = [], hi = 0, remote = [], rTimer = null, rSeq = 0, rState = '';
  /* Numéros de vol : TO3018 (code IATA de la compagnie) = indicatif radio TVF3018 (code OACI). */
  const CIE = new Map(), CIE_OACI = new Map();
  for (const [iata, oaci, nom] of D.compagnies || []) for (const o of oaci.split(' ')) {
    if (!CIE.has(iata)) CIE.set(iata, []); CIE.get(iata).push(o); if (!CIE_OACI.has(o)) CIE_OACI.set(o, { iata, nom });
  }
  const norm = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '');
  /* indicatifs radio possibles pour la saisie : [ { cie: 'TVF', num: '3018' } ] */
  function flightKeys(s) {
    const out = [];
    let m = s.match(/^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/);
    if (m) out.push({ cie: m[1], num: m[2] });
    m = s.match(/^([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/);
    if (m && CIE.has(m[1])) for (const o of CIE.get(m[1])) out.push({ cie: o, num: m[2] });
    return out;
  }
  const numEq = (a, b) => a.replace(/^0+/, '') === b.replace(/^0+/, '');
  const matchesKey = (cs, keys) => { cs = norm(cs); return keys.some((k) => cs.startsWith(k.cie) && numEq(cs.slice(k.cie.length), k.num)); };
  /* TVF3018 → « TO3018 · Transavia France » */
  function flightNo(cs) {
    cs = norm(cs); const c = CIE_OACI.get(cs.slice(0, 3)), n = cs.slice(3);
    return c && /^\d{1,4}[A-Z]?$/.test(n) ? { no: c.iata + n.replace(/^0+(?=\d)/, ''), nom: c.nom } : null;
  }
  const acTitle = (d) => { const f = flightNo(d.callsign); return f ? `${f.no} — ${d.callsign}` : d.callsign || d.reg || d.hex.toUpperCase(); };
  const acLine = (d) => { const f = flightNo(d.callsign); return [f && f.nom, d.type, d.reg, fmt.alt(d)].filter(Boolean).join(' · '); };
  function render() {
    const all = hits.concat(remote.filter((r) => !hits.some((h) => h.d && h.d.id === r.d.id)));
    hits = all; hi = 0;
    const cieN = (codes) => [...planes.values()].filter((p) => cieOf(p.d.callsign, codes)).length;
    qres.innerHTML = all.map((h, i) => h.kind === 'cie'
      ? `<li data-i="${i}" class="${i ? '' : 'sel'}"><span>🏢 ${esc(h.nom)}${h.iata ? ` <em class="code">${esc(h.iata)} · ${esc(h.codes.replace(/ /g, ', '))}</em>` : ''}</span><small>Compagnie — voir tous ses avions dans le monde (${nf.format(cieN(h.codes))} sur la carte)</small></li>`
      : h.kind === 'apt'
      ? `<li data-i="${i}" class="${i ? '' : 'sel'}"><span>◉ ${esc(h.a[0])} — ${esc(h.a[2])}</span><small>Aéroport</small></li>`
      : `<li data-i="${i}" class="${i ? '' : 'sel'}"><span>✈ ${esc(acTitle(h.d))}${h.kind === 'remote' ? '<em>hors de la carte</em>' : ''}</span><small>${esc(acLine(h.d))}</small></li>`).join('')
      + (rState === 'busy' ? '<li class="muted">Recherche dans le monde entier…</li>' : '')
      || `<li class="muted">${rState === 'none' ? 'Aucun avion en vol avec ce numéro ou cet indicatif' : 'Aucun résultat'}</li>`;
    qres.hidden = false;
  }
  function search() {
    const raw = q.value.trim().toUpperCase(), s = norm(raw);
    clearTimeout(rTimer); rSeq++; remote = []; rState = '';
    if (s.length < 2) { qres.hidden = true; return; }
    const keys = flightKeys(s);
    hits = keys.length ? [] : cieHits(raw, s);
    for (const p of planes.values()) {
      const d = p.d;
      if (matchesKey(d.callsign, keys) || [d.callsign, d.reg, d.hex.toUpperCase(), d.type].some((v) => v && norm(v).includes(s))) hits.push({ kind: 'ac', d });
      if (hits.length >= 14) break;
    }
    for (const a of D.aeroports) {
      if (hits.length >= 18) break;
      if (a[0] === s || a[1] === s || a[2].toUpperCase().includes(raw)) hits.push({ kind: 'apt', a });
    }
    // pas trouvé dans la zone affichée : recherche mondiale (numéro de vol, indicatif ou immatriculation)
    const isReg = /^[A-Z0-9]{1,2}-[A-Z0-9]{2,5}$/.test(raw) || /^N\d[0-9A-Z]{1,4}$/.test(s);
    if (S.source !== 'sim' && (keys.length || isReg) && !hits.some((h) => h.kind === 'ac')) {
      rState = 'busy'; const my = rSeq;
      rTimer = setTimeout(async () => {
        const urls = keys.length
          ? [...new Set(keys.flatMap((k) => [k.cie + k.num, k.cie + k.num.replace(/^0+(?=\d)/, '')]))].slice(0, 4).map((c) => `https://api.adsb.lol/v2/callsign/${c}`)
          : [`https://api.adsb.lol/v2/reg/${raw}`];
        const res = await Promise.all(urls.map((u) => getJSON(u).then((j) => fromAdsb(j.ac), () => null)));
        if (my !== rSeq) return;
        const seen = new Set();
        remote = res.flat().filter((d) => d && !seen.has(d.id) && seen.add(d.id)).map((d) => ({ kind: 'remote', d }));
        rState = remote.length ? '' : res.every((r) => r === null) ? 'err' : 'none';
        hits = hits.filter((h) => h.kind !== 'remote'); render();
        if (rState === 'err') toast('Recherche mondiale indisponible (réseau).');
      }, 450);
    }
    render();
  }
  function choose(i) {
    const h = hits[i]; if (!h) return;
    qres.hidden = true; q.value = ''; q.blur();
    if (h.kind === 'apt') return map.setView([h.a[3], h.a[4]], 10);
    if (h.kind === 'cie') { if (selected) deselect(); return setCie(h.codes, h.nom, true); }
    if (planes.has(h.d.id)) return select(h.d.id, true);
    // avion hors de la zone : on y va, puis il est sélectionné au prochain chargement
    pendingHash = h.d.id; map.setView([h.d.lat, h.d.lon], 8);
    toast(`Recherche de ${h.d.callsign || h.d.reg || h.d.hex.toUpperCase()}…`);
    refresh();
  }
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); choose(hi); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      qres.querySelectorAll('li').forEach((li, i) => li.classList.toggle('sel', i === hi));
    } else if (e.key === 'Escape') { qres.hidden = true; q.blur(); }
  });
  qres.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
  q.addEventListener('blur', () => setTimeout(() => { qres.hidden = true; }, 150));

  /* ---------- Aéroports ---------- */
  for (const [iata, icao, name, lat, lon] of D.aeroports) {
    L.marker([lat, lon], {
      interactive: true, keyboard: false, zIndexOffset: -1000,
      icon: L.divIcon({ className: 'apt-wrap', iconSize: [8, 8], iconAnchor: [4, 4], html: `<div class="apt"></div><div class="apt-lbl">${iata}</div>` })
    }).bindTooltip(`${name} (${iata} / ${icao})`, { direction: 'top' })
      .on('click', () => map.setView([lat, lon], Math.max(map.getZoom(), 10)))
      .addTo(aptLayer);
  }

  /* ---------- Panneaux et boutons ---------- */
  const panels = { list: $('bList'), filter: $('bFilter'), layers: $('bLayers') };
  function hidePanels(except) {
    for (const [k, b] of Object.entries(panels)) if (k !== except) { $(k).hidden = true; b.classList.remove('on'); }
  }
  function togglePanel(k) {
    const el = $(k), open = el.hidden;
    hidePanels(k);
    el.hidden = !open; panels[k].classList.toggle('on', open);
    if (open && window.innerWidth <= 720 && selected) deselect();
    if (open && k === 'list') renderList();
  }
  for (const k of Object.keys(panels)) panels[k].addEventListener('click', () => togglePanel(k));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => hidePanels()));
  $('cardClose').addEventListener('click', deselect);
  // touche Retour d'Android : ferme d'abord la recherche, les panneaux puis la fiche
  window.cdBack = () => {
    if (!qres.hidden) { qres.hidden = true; q.blur(); return true; }
    if (Object.keys(panels).some((k) => !$(k).hidden)) { hidePanels(); return true; }
    if (selected) { deselect(); return true; }
    return false;
  };
  map.on('click', (e) => {
    const id = lite && planeCanvas.hit(e.containerPoint);
    if (id) { select(id); return; }
    if (selected) deselect(); hidePanels();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.activeElement !== q) { deselect(); hidePanels(); } });

  $('bFollow').addEventListener('click', () => {
    follow = !follow; $('bFollow').classList.toggle('on', follow);
    if (follow && selected) map.panTo(planes.get(selected).marker.getLatLng());
  });
  $('bTrail').addEventListener('click', () => {
    showTrail = !showTrail; $('bTrail').classList.toggle('on', showTrail);
    const p = planes.get(selected); if (p) drawTrail(p);
  });
  $('bShare').addEventListener('click', async () => {
    const p = selected && planes.get(selected);
    if (NATIVE && p) {
      const d = p.d, name = d.callsign || d.reg || d.hex.toUpperCase();
      NATIVE.share(`Vol ${name}${d.type ? ' (' + d.type + ')' : ''} — ${fmt.alt(d)}, ${fmt.spd(d.gs)}\nhttps://globe.adsb.lol/?icao=${d.hex}`);
      return;
    }
    const url = location.href;
    try { await navigator.clipboard.writeText(url); toast('Lien du vol copié.'); }
    catch { toast(url); }
  });
  map.on('dragstart', () => { if (follow) { follow = false; $('bFollow').classList.remove('on'); } });

  // Filtres et réglages
  const altLbl = (v) => v >= 45000 && S.maxAlt === v ? 'illimitée' : S.units === 'metric' ? `${nf.format(Math.round(v * FT))} m` : `${nf.format(v)} ft`;
  function syncFilters() {
    $('fMin').value = S.minAlt; $('fMax').value = S.maxAlt;
    $('oMin').textContent = altLbl(S.minAlt); $('oMax').textContent = altLbl(S.maxAlt);
    $('fGround').checked = S.hideGround; $('fLabels').checked = S.labels; $('fAirports').checked = S.airports;
    $('fUnits').value = S.units; $('fSource').value = S.source;
    const fc = $('fCie');
    if (S.cie && ![...fc.options].some((o) => o.value === S.cie)) fc.add(new Option(S.cieNom || S.cie, S.cie));
    fc.value = S.cie;
    $('sCie').hidden = !S.cie; $('sCieN').textContent = S.cieNom || S.cie;
    document.body.classList.toggle('nolabels', !S.labels);
    document.body.classList.toggle('noairports', !S.airports);
  }
  function applyFilters() {
    syncDisplay();
    if (!$('list').hidden) renderList();
    if (selected) updateCard();
  }
  $('fMin').addEventListener('input', (e) => { S.minAlt = +e.target.value; if (S.minAlt > S.maxAlt) S.maxAlt = S.minAlt; syncFilters(); applyFilters(); save(); });
  $('fMax').addEventListener('input', (e) => { S.maxAlt = +e.target.value; if (S.maxAlt < S.minAlt) S.minAlt = S.maxAlt; syncFilters(); applyFilters(); save(); });
  $('fGround').addEventListener('change', (e) => { S.hideGround = e.target.checked; applyFilters(); save(); });
  $('fLabels').addEventListener('change', (e) => { S.labels = e.target.checked; syncFilters(); save(); });
  $('fAirports').addEventListener('change', (e) => { S.airports = e.target.checked; syncFilters(); save(); });
  $('fCie').addEventListener('change', (e) => { const o = e.target.selectedOptions[0]; setCie(e.target.value, e.target.value ? o.dataset.nom || o.text : '', !!e.target.value); });
  $('sCie').addEventListener('click', () => setCie('', ''));
  $('fUnits').addEventListener('change', (e) => { S.units = e.target.value; syncFilters(); applyFilters(); save(); });
  $('fSource').addEventListener('change', (e) => { S.source = e.target.value; save(); clearAll(); curSource = null; simSince = 0; refresh(); });

  // Fonds de carte
  document.querySelectorAll('[data-base]').forEach((b) => {
    b.classList.toggle('on', b.dataset.base === S.base);
    b.addEventListener('click', () => {
      map.removeLayer(base); base = bases[b.dataset.base]; base.addTo(map); base.bringToBack();
      S.base = b.dataset.base; save();
      document.querySelectorAll('[data-base]').forEach((x) => x.classList.toggle('on', x === b));
    });
  });

  // Ma position
  let me = null;
  $('bLocate').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Géolocalisation non disponible.');
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (me) me.setLatLng(ll);
      else me = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), keyboard: false }).addTo(map);
      map.setView(ll, 9);
    }, () => toast('Position refusée ou indisponible.'), { enableHighAccuracy: false, timeout: 10000 });
  });

  // Lien partagé : #vol=<id>
  let pendingHash = null;
  const m = location.hash.match(/vol=([^&]+)/);
  if (m) pendingHash = decodeURIComponent(m[1]);

  syncFilters();
  refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
