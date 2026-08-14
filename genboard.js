// genera board grande per 3-4 giocatori: stesse 4 zone/risorse del tabellone 2p, raggio maggiore,
// 2 nodi per zona (invece di 1), stessa densità di risorse (~43% degli hex di zona), festival
// centrale scalato. Zone assegnate per settore angolare (N/S/E/O) invece che a mano.
// ponytail: geometria generata, non playtestata — verificare con editor.html/simulatore prima di stampare.
import { writeFileSync } from 'node:fs';

const RADIUS = 8;
const FEST_R = 2;               // disco centrale radius 2 = 19 hex, puro decoro (vedi engine.js: 'festival' è un dest astratto)
const NODE_DIST = 5;            // distanza in hex dal centro per i nodi (originale: 4 su radius 6, stesso rapporto ~2/3)
const RES_DENSITY = 0.43;       // stessa quota dell'originale (12 risorse su 28 hex di zona)

const ZONES = {
  verde:   { angle: 0,   risorse: ['fungo_rosso', 'fungo_marrone'] },
  giallo:  { angle: 90,  risorse: ['peperoncino', 'cactus'] },
  arancio: { angle: 180, risorse: ['tartaruga', 'rana'] },
  rosa:    { angle: 270, risorse: ['ibisco', 'girasole'] },
};

const px = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });
const dist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
const angleDeg = (q, r) => { const { x, y } = px(q, r); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
const angleDiff = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// hash deterministico per decidere quale delle 2 risorse di zona piazzare (no rand esterno, board riproducibile)
const hash = (q, r) => Math.abs((q * 73856093) ^ (r * 19349663)) % 100;

const hexes = [];
for (let q = -RADIUS; q <= RADIUS; q++) {
  for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
    const d = dist(q, r);
    if (d > RADIUS) continue;
    if (d <= FEST_R) { hexes.push({ q, r, zone: null, node: 'festival', resource: null }); continue; }
    const a = angleDeg(q, r);
    let zone = null, best = Infinity;
    for (const [name, z] of Object.entries(ZONES)) {
      const dd = angleDiff(a, z.angle);
      if (dd < best) { best = dd; zone = name; }
    }
    const h = hash(q, r);
    const resource = h < RES_DENSITY * 100 ? ZONES[zone].risorse[h % 2] : null;
    hexes.push({ q, r, zone, node: null, resource });
  }
}

// 2 nodi per zona, simmetrici attorno all'angolo centrale della zona, sull'anello NODE_DIST
for (const [name, z] of Object.entries(ZONES)) {
  for (const off of [-22, 22]) {
    const target = (z.angle + off + 360) % 360;
    let best = null, bestScore = Infinity;
    for (const h of hexes) {
      if (h.zone !== name || h.node) continue;
      if (dist(h.q, h.r) !== NODE_DIST) continue;
      const score = angleDiff(angleDeg(h.q, h.r), target);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (best) { best.node = 'nodo'; best.resource = null; }
  }
}

writeFileSync(new URL('./board-3-4p.json', import.meta.url), JSON.stringify({ radius: RADIUS, hexes }, null, 2));
console.log('hex totali:', hexes.length);
for (const name of Object.keys(ZONES)) {
  const zh = hexes.filter(h => h.zone === name);
  console.log(name, 'hex:', zh.length, 'risorse:', zh.filter(h => h.resource).length, 'nodi:', zh.filter(h => h.node === 'nodo').length);
}
console.log('festival hex:', hexes.filter(h => h.node === 'festival').length);
