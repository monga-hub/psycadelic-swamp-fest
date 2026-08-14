// Runner parallelo per validazioni batch (stallo/turni) — usa tutti i core disponibili invece di
// girare single-thread. Ogni worker gioca un pezzo delle partite e ritorna un aggregato minimo
// (validi/invalidi, turni, contesa nodi); il main li somma. Stessa logica di gioco di bot.js/engine.js,
// nessuna duplicazione di regole — i worker importano gli stessi moduli.
//
// Uso:
//   node batch-parallel.js --board=board-4p.json --players=4 --n=1000 --ai=rollout --depth=6 --rollouts=1
//   node batch-parallel.js --board=board-3-4p.json --players=3 --n=500 --ai=greedy
//
// Opzioni: --workers=N (default: tutti i core), --seed=N (seed iniziale, default 1),
//          --pescate=3 --esposte=3 --mercato=mescolato --festival=1 --vantaggio=1
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function runShard({ board: boardPath, players, n, seedStart, ai, depth, rollouts, pescate, esposte, mercato, festival, vantaggio, compraNodo, nodiEsclusivi, lavoratoreEsclusivo, spostamentoObbligatorio, capNodo, accampamentiMax }) {
  const { readFileSync } = await import('node:fs');
  const E = await import('./engine.js');
  const { partita } = await import('./bot.js');
  const board = E.makeBoard(JSON.parse(readFileSync(new URL(boardPath, import.meta.url), 'utf8')));
  const cfg = JSON.parse(readFileSync(new URL('./festival.json', import.meta.url), 'utf8'));
  const carta = { rosa: 'girasole', arancio: 'tartaruga', verde: 'fungo_marrone', giallo: 'cactus' };
  const giocatori = ['P1', 'P2', 'P3', 'P4'].slice(0, players);
  const aiCfg = ai === 'rollout' ? { modo: 'rollout', depth, rollouts } : { modo: 'greedy' };
  let validi = 0, turniTot = 0;
  const nodoApertura = { libero: 0, condiviso: 0, conteso: 0 };
  for (let i = 0; i < n; i++) {
    const seed = seedStart + i;
    const primoGiocatore = giocatori[i % giocatori.length];
    const { state, turni, finita } = partita(board, carta, {
      seed, cfg, maxTurni: 3000, giocatori, primoGiocatore,
      ai: Object.fromEntries(giocatori.map((id) => [id, aiCfg])),
      pescate: { 1: pescate, 2: pescate, 3: pescate }, esposte, mercato,
      festivalCollab: { abilitato: !!festival, ricompensaPV: 2 },
      risorsaGratisSecondo: !!vantaggio,
      compraNodo: !!compraNodo,
      nodiEsclusivi: !!nodiEsclusivi,
      lavoratoreEsclusivo: !!lavoratoreEsclusivo,
      spostamentoObbligatorio: !!spostamentoObbligatorio,
      ...(capNodo != null ? { capNodo } : {}),
      ...(accampamentiMax != null ? { accampamentiMax } : {}),
    });
    if (!finita) continue;
    validi++; turniTot += turni;
    const occ = new Map();
    for (const e of state.log) {
      if (e.tipo !== 'costruisci' || !e.hex || !e.nodo) continue;
      const node = board.hexes.get(e.nodo);
      const seedHex = E.vicini(board, node.q, node.r).some((v) => `${v.q},${v.r}` === e.hex);
      if (!seedHex) continue;
      const o = occ.get(e.nodo) || new Set();
      let cat;
      if (o.size === 0) cat = 'libero'; else if ([...o].some((p) => p !== e.player)) cat = 'conteso'; else cat = 'condiviso';
      nodoApertura[cat]++;
      o.add(e.player); occ.set(e.nodo, o);
    }
  }
  return { validi, invalidi: n - validi, turniTot, nodoApertura };
}

if (!isMainThread) {
  runShard(workerData).then((r) => parentPort.postMessage(r));
} else {
  const args = parseArgs();
  const opts = {
    board: args.board || 'board-4p.json',
    players: +(args.players || 4),
    n: +(args.n || 1000),
    seedStart: +(args.seed || 1),
    ai: args.ai || 'greedy',
    depth: +(args.depth || 6),
    rollouts: +(args.rollouts || 1),
    pescate: +(args.pescate || 3),
    esposte: +(args.esposte || 3),
    mercato: args.mercato || 'mescolato',
    festival: args.festival !== '0',
    vantaggio: args.vantaggio !== '0',
    compraNodo: args.compranodo === '1',
    nodiEsclusivi: args.nodiesclusivi === '1',
    lavoratoreEsclusivo: args.lavoratoreesclusivo !== '0', // regola stabile, ON di default — passa --lavoratoreesclusivo=0 per disattivarla
    spostamentoObbligatorio: args.spostamentoobbligatorio === '1',
    capNodo: args.capnodo != null ? +args.capnodo : null,
    accampamentiMax: args.accampamenti != null ? +args.accampamenti : null,
  };
  const nWorkers = Math.max(1, Math.min(+(args.workers || cpus().length), opts.n));
  const perWorker = Math.ceil(opts.n / nWorkers);
  const self = fileURLToPath(import.meta.url);

  console.log(`${nWorkers} worker (di ${cpus().length} core disponibili) · ${opts.n} partite · board=${opts.board} · players=${opts.players} · ai=${opts.ai}${opts.ai === 'rollout' ? ` d${opts.depth} r${opts.rollouts}` : ''}`);
  const t0 = Date.now();

  const shards = [];
  for (let w = 0; w < nWorkers; w++) {
    const from = w * perWorker, to = Math.min(opts.n, from + perWorker);
    if (from >= to) continue;
    shards.push({ ...opts, n: to - from, seedStart: opts.seedStart + from });
  }

  const risultati = await Promise.all(shards.map((wd) => new Promise((resolve, reject) => {
    const w = new Worker(self, { workerData: wd });
    w.on('message', resolve);
    w.on('error', reject);
  })));

  const tot = risultati.reduce((s, r) => s + r.validi + r.invalidi, 0);
  const validi = risultati.reduce((s, r) => s + r.validi, 0);
  const turniTot = risultati.reduce((s, r) => s + r.turniTot, 0);
  const nodoApertura = { libero: 0, condiviso: 0, conteso: 0 };
  for (const r of risultati) for (const k of ['libero', 'condiviso', 'conteso']) nodoApertura[k] += r.nodoApertura[k];
  const nodoTot = nodoApertura.libero + nodoApertura.condiviso + nodoApertura.conteso || 1;

  console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`partite valide: ${validi}/${tot} · stallo: ${(100 * (tot - validi) / tot).toFixed(1)}%`);
  console.log(`turni medi: ${(turniTot / (validi || 1)).toFixed(1)}`);
  console.log(`apertura nodi — libero: ${(100 * nodoApertura.libero / nodoTot).toFixed(0)}% · condiviso: ${(100 * nodoApertura.condiviso / nodoTot).toFixed(0)}% · conteso: ${(100 * nodoApertura.conteso / nodoTot).toFixed(0)}% (n=${nodoTot})`);
}
