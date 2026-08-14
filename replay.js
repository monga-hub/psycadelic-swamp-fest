// Registra una partita greedy frame-per-frame → replay.json (per viewer.html).
// node replay.js [seed]
import { writeFileSync } from 'node:fs';
import { nuovaPartita, diMano, finita, gioca } from './engine.js';
import { loadBoard, loadFestival } from './io.js';
import { mossaGreedy } from './bot.js';

const carico = (droghe) => droghe.reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {});

const snap = (state, n, pid, az, res) => ({
  n, pid,
  azione: az && { tipo: az.tipo, nodeK: az.nodeK, targetK: az.targetK, cartaId: az.cartaId },
  res: res == null ? null : (Array.isArray(res) ? res : { ...res }),
  built: [...state.built],
  workers: Object.fromEntries(state.giocatori.map((g) => [g.id, g.lavoratore])),
  punti: Object.fromEntries(state.giocatori.map((g) => [g.id, g.punti])),
  carico: Object.fromEntries(state.giocatori.map((g) => [g.id, carico(g.droghe)])),
  carte: Object.fromEntries(state.giocatori.map((g) => [g.id, g.carte.length])),
  mercato: state.festival.mercato.map((c) => ({ id: c.id, livello: c.livello, punti: c.punti, need: c.need })),
});

const carta = { rosa: 'girasole', arancio: 'tartaruga', verde: 'fungo_marrone', giallo: 'cactus' };
const seed = Number(process.argv[2] ?? 7);
const board = loadBoard();
const state = nuovaPartita(carta, ['P1', 'P2'], { seed, cfg: loadFestival() });

const frames = [snap(state, 0, null, null, null)]; // stato iniziale
let n = 0;
while (!finita(state) && n < 5000) {
  const pid = diMano(state).id;
  const az = mossaGreedy(state, board, pid);
  if (!az) break;
  const res = gioca(state, board, az);
  frames.push(snap(state, ++n, pid, az, res));
}

writeFileSync(new URL('./replay.json', import.meta.url),
  JSON.stringify({ seed, attive: state.attive, frames }, null, 0));
console.log(`replay.json: ${frames.length} frame, seed ${seed}, finita=${finita(state)}`);
