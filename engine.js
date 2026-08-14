// Festival sim — engine (WIP). Puro JS: nessun I/O, gira in Node e nel browser.
// Caricamento file (board.json/festival.json) sta in io.js (solo-Node).

// config festival di default (mirror di festival.json; sovrascrivibile via opts.cfg)
export const DEFAULT_FESTIVAL = {
  carte_per_livello: 6,
  livelli: {
    1: { risorse: 3, distinte: 3, punti: 5 },
    2: { risorse: 5, punti: 9 },
    3: { risorse: 7, punti: 13 },
  },
};

// sperimentale: pozioni — una commessa completata resta in gioco come potere monouso invece di
// essere scartata. Il campo `pozione` sulla carta è indipendente dal livello apposta (vedi
// generaCarte()) — un mazzo futuro potrà distribuirle come vuole senza toccare il motore. Un
// livello con più tipi (array) li alterna round-robin fra le carte di quel livello.
export const POZIONE_DEFAULT = { 1: ['crescita', 'crescita2', 'visione'], 2: ['abbondanza', 'euforia'], 3: ['trasmutazione', 'omissione', 'salto'] };
// modo di default per ogni tipo di pozione: ricaricabile (L1/L2), oneshot (L3, 1 carica) o
// multiuso (più cariche come ricaricabile, ma NON ricaricabile: esaurita si spegne — il duplicato
// va in riserva e la sostituisce, vedi consegnaMercato).
// Sovrascrivibile via opts.pozioniModo (config editor → tendina per-pozione).
export const POZIONE_DEFAULT_MODO = {
  omissione: 'ricaricabile', salto: 'ricaricabile', trasmutazione: 'ricaricabile',
  abbondanza: 'ricaricabile', crescita: 'ricaricabile', crescita2: 'ricaricabile',
  visione: 'oneshot', euforia: 'oneshot', convergenza: 'oneshot',
};
const pozioneRoundRobin = (liv, i) => {
  const p = POZIONE_DEFAULT[liv];
  return Array.isArray(p) ? p[i % p.length] : (p || null);
};

// --- Board statico ---
// 4 zone, 2 risorse possibili ciascuna. La carta setup ne attiva 1 per zona.
export const ZONES = {
  rosa:    { colore: '#d98cb3', risorse: ['girasole', 'ibisco'] },
  arancio: { colore: '#e8952e', risorse: ['rana', 'tartaruga'] },
  verde:   { colore: '#8bc34a', risorse: ['fungo_rosso', 'fungo_marrone'] },
  giallo:  { colore: '#f4e12a', risorse: ['cactus', 'peperoncino'] },
};

export const N_NODI = 5; // nodi marroni sparsi sulla mappa

// --- Board (geometria reale, esagoni axial q,r) ---
const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]; // vicini axial

const hk = (q, r) => `${q},${r}`;

// costruisce la struttura board da un oggetto JSON già parsato (browser: da fetch; Node: da io.js)
export function makeBoard(data) {
  const hexes = new Map();
  for (const h of data.hexes) hexes.set(hk(h.q, h.r), h);
  return { radius: data.radius, hexes };
}

export function vicini(board, q, r) {
  return DIRS
    .map(([dq, dr]) => board.hexes.get(hk(q + dq, r + dr)))
    .filter(Boolean);
}

// hex dei 5 nodi + area festival
export const nodi = (board) => [...board.hexes.values()].filter(h => h.node === 'nodo');
export const festival = (board) => [...board.hexes.values()].filter(h => h.node === 'festival');

// --- Setup ---
// Carta setup = scelta di 1 risorsa attiva per zona.
// Es: { rosa:'girasole', arancio:'tartaruga', verde:'fungo_marrone', giallo:'cactus' }
export function attivaSetup(carta) {
  for (const [zona, ris] of Object.entries(carta)) {
    if (!ZONES[zona]) throw new Error(`zona sconosciuta: ${zona}`);
    if (!ZONES[zona].risorse.includes(ris))
      throw new Error(`risorsa ${ris} non valida per zona ${zona}`);
  }
  if (Object.keys(carta).length !== 4)
    throw new Error('la carta setup deve attivare 1 risorsa per ognuna delle 4 zone');
  return { ...carta };
}

export function nuovaPartita(carta, giocatori = ['P1', 'P2'], opts = {}) {
  const attive = attivaSetup(carta);
  const rand = opts.rand || rng(opts.seed ?? 1);
  const cfg = opts.cfg || DEFAULT_FESTIVAL;
  return {
    attive,                                // risorsa attiva per zona
    regole: { compraNodo: !!opts.compraNodo, nodiEsclusivi: !!opts.nodiEsclusivi, lavoratoreEsclusivo: !!opts.lavoratoreEsclusivo, spostamentoObbligatorio: !!opts.spostamentoObbligatorio, ...(opts.capNodo != null ? { capNodo: opts.capNodo } : {}), ...(opts.accampamentiMax != null ? { accampamentiMax: opts.accampamentiMax } : {}), ...(opts.risorseVittoria ? { risorseVittoria: opts.risorseVittoria } : {}), ...(opts.capSegmenti != null ? { capSegmenti: opts.capSegmenti } : {}), ...(opts.fineSuLimiteSegmenti ? { fineSuLimiteSegmenti: true } : {}), pozioniModo: opts.pozioniModo || POZIONE_DEFAULT_MODO }, // sperimentali, vedi commenti su compraNodo()/costruisci()/muovi()
    giocatori: giocatori.map((id) => ({
      id,
      lavoratore: 'festival',             // parte al centro, a fianco del nodo festival
      droghe: [],                          // risorse raccolte (carico)
      carte: [],                           // set-collection completati
      punti: 0,
      turni: 0,                            // azioni giocate (statistiche)
      azioni: { costruisci: 0, pesca: 0, consegna: 0 },
      pozioni: {}, // { [tipo]: { cariche, caricheMax, riserva, need, modoRicarica, ottenutaTurno, usiTotali, cartePrese, ultimoUsoTurno } }
      ...(opts.accampamentiMax != null ? { accampamentiRimasti: opts.accampamentiMax } : {}), // sperimentale: fornitura limitata di NUOVI accampamenti (seed), vedi costruisci()/ultimoGiro
    })),
    built: new Map(),                      // hk -> id giocatore (esagoni accampamento)
    festival: nuovoMercato(opts.mazzo || generaCarte(attive, cfg, rand), rand, opts.mercato, opts.pescate, opts.esposte ?? 3),
    turno: 0,                              // indice giocatore di mano
    log: [],                               // cronologia azioni { n, player, tipo, nodo, livello }
    ultimoGiro: null,                      // sperimentale: { trigger, restanti } quando un giocatore esaurisce gli accampamenti, vedi gioca()
  };
}

// --- Costruzione accampamenti ---
const parse = (k) => k.split(',').map(Number);
// vicini di un hex-key: funzione pura della geometria statica (DIRS non cambia mai) — memoizzata,
// la board è piccola (~100-200 celle) quindi la cache satura in fretta. Hotspot: chiamata a ogni
// costruisci()/pesca()/BFS componente, molte volte per singola mossa simulata nel rollout.
const viciniKCache = new Map();
const viciniK = (k) => {
  let v = viciniKCache.get(k);
  if (v) return v;
  const [q, r] = parse(k);
  v = DIRS.map(([dq, dr]) => hk(q + dq, r + dr));
  viciniKCache.set(k, v);
  return v;
};
const attivaSuHex = (state, h) => h.resource && state.attive[h.zone] === h.resource;

// tutti gli hex costruiti da `player` in questa partita, come Set — hotspot: prima ricostruiva un
// array da state.built ad ogni chiamata (spread+filter+map), qui un solo giro senza allocazioni intermedie.
function mieiHex(state, player) {
  const s = new Set();
  for (const [k, p] of state.built) if (p === player) s.add(k);
  return s;
}

// componente connessa di target dentro l'insieme di hex posseduti (adiacenza axial). `owner` non
// deve contenere targetK: la BFS lo pre-seeda in `seen`, non lo interroga mai contro `owner`.
function componente(owner, targetK) {
  const seen = new Set([targetK]), stack = [targetK];
  while (stack.length) for (const n of viciniK(stack.pop())) if (owner.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
  return seen;
}

// un hex è "nodo" se lo è sulla board statica, oppure se è stato comprato in questa partita
// (sperimentale, vedi compraNodo) — i nodi comprati vivono in state, MAI sulla board condivisa
// fra partite diverse dello stesso batch.
const isNodo = (state, board, k) => board.hexes.get(k)?.node === 'nodo' || !!state.nodiExtra?.has(k);

// costruisci 1 esagono del giocatore a `nodeK`, sull'hex `targetK`. Ritorna forza dell'accampamento.
// targetK2: sperimentale, pozione "crescita" — costruisce un SECONDO segmento nella stessa azione,
// validato con le stesse regole del primo (contro lo stato già aggiornato dal primo piazzamento).
// nodeK2: sperimentale, pozione "crescita2" — il 2° segmento va su un ALTRO nodo (non nodeK), a
// patto che tu abbia già un accampamento a contatto di QUEL nodo (verificato PRIMA di piazzare,
// contro lo stato precedente al primo segmento — nessuna mutazione parziale se fallisce).
export function costruisci(state, board, player, nodeK, targetK, scegli = null, targetK2 = null, nodeK2 = null) {
  const node = board.hexes.get(nodeK), t = board.hexes.get(targetK);
  if (!isNodo(state, board, nodeK)) throw new Error('nodeK non è un nodo');
  if (!t) throw new Error('hex inesistente');
  if (t.zone !== node.zone) throw new Error('devi costruire nella zona del nodo');
  if (t.node) throw new Error('non puoi costruire su nodo/festival');
  if (state.built.has(targetK)) throw new Error('hex già occupato');
  if (attivaSuHex(state, t)) throw new Error('non puoi costruire sopra la risorsa attiva');

  const mine = mieiHex(state, player);
  const nodeAdj = new Set(vicini(board, node.q, node.r).map((h) => hk(h.q, h.r)));
  const seed = nodeAdj.has(targetK);                                  // hex a contatto col nodo
  const myN = viciniK(targetK).filter((k) => mine.has(k));            // miei esagoni adiacenti al target
  const grado = (k) => viciniK(k).filter((n) => mine.has(n)).length;  // esagoni miei attorno a k

  const comp = componente(mine, targetK); // targetK non è (ancora) in `mine`: componente() lo pre-seeda da sé

  if (seed) {
    // nuovo accampamento: parte pulito dal nodo, non si attacca a una catena esistente (no cluster)
    if (myN.length) throw new Error('un nuovo accampamento parte dal nodo, senza attaccarsi a una tua catena');
    // sperimentale: nodi esclusivi — se un altro giocatore ha già un seed qui, il nodo non è più
    // disponibile per nessun altro (nessuna contesa, un nodo = un solo proprietario per tutta la partita).
    if (state.regole?.nodiEsclusivi && [...nodeAdj].some((k) => state.built.has(k) && state.built.get(k) !== player))
      throw new Error('nodo esclusivo: già occupato da un altro giocatore');
    // sperimentale: fornitura limitata di accampamenti — esaurita, non puoi più APRIRNE di nuovi
    // (le catene esistenti restano estendibili). Il trigger di fine partita è in gioca().
    if (state.regole?.accampamentiMax != null && giocatore(state, player).accampamentiRimasti <= 0)
      throw new Error('accampamenti esauriti');
  } else {
    // estensione: catena in lunghezza → attacca a UN solo tuo esagono, e solo a una punta (grado ≤1)
    if (myN.length !== 1) throw new Error('accampamento a catena: attacca a un solo tuo esagono (no cluster)');
    if (grado(myN[0]) > 1) throw new Error('puoi allungare solo dalla punta della catena (sviluppo in lunghezza)');
    if (![...comp].some((k) => nodeAdj.has(k)))
      throw new Error("l'accampamento deve partire da un nodo");
  }

  // contatto avversari: ammesso SOLO tra due seed dello stesso nodo (contesa al nodo)
  const nemici = viciniK(targetK).filter((k) => state.built.has(k) && state.built.get(k) !== player);
  if (nemici.length && !(seed && nemici.every((k) => nodeAdj.has(k))))
    throw new Error('non puoi toccare accampamenti avversari (contatto ammesso solo tra seed sullo stesso nodo)');

  // un accampamento non può collegare due nodi
  const nodiToccati = new Set();
  for (const k of comp) for (const nk of viciniK(k)) if (isNodo(state, board, nk)) nodiToccati.add(nk);
  if (nodiToccati.size > 1) throw new Error('un accampamento non può collegare due nodi');

  // i tuoi hex adiacenti al nodo (seed di catene diverse) non devono toccarsi fra loro
  const seeds = [...mine, targetK].filter((k) => nodeAdj.has(k));
  for (const s of seeds)
    if (viciniK(s).some((n) => n !== s && seeds.includes(n)))
      throw new Error('due tue catene adiacenti fra loro sul nodo');

  // sperimentale: limite ai segmenti totali del giocatore su TUTTO il tabellone (non per singola
  // catena) — mine.size è il posseduto PRIMA di targetK, quindi +1 è il totale dopo averlo piazzato.
  if (state.regole?.capSegmenti != null && mine.size + 1 > state.regole.capSegmenti)
    throw new Error(`limite massimo di segmenti sul tabellone raggiunto (${state.regole.capSegmenti})`);

  state.built.set(targetK, player);

  // pesca-su-build: risorse attive adiacenti al NUOVO hex, cap = forza. Scegli quali se di più.
  const cand = risorseAdiacenti(state, board, [targetK]);
  const prese = (scegli ? scegli(cand, comp.size) : cand.slice(0, comp.size));
  const g = giocatore(state, player);
  for (const rk of prese) g.droghe.push(board.hexes.get(rk).resource);
  if (seed && state.regole?.accampamentiMax != null) g.accampamentiRimasti--;

  const risultato = { forza: comp.size, pescate: prese.map((k) => board.hexes.get(k).resource), seed };
  if (targetK2) {
    const altroNodo = nodeK2 && nodeK2 !== nodeK;
    if (altroNodo) {
      const node2 = board.hexes.get(nodeK2);
      if (!node2) throw new Error('nodeK2 non è un nodo valido');
      const nodeAdj2 = new Set(vicini(board, node2.q, node2.r).map((h) => hk(h.q, h.r)));
      if (![...mine].some((k) => nodeAdj2.has(k)))
        throw new Error('crescita2: nel nodo secondario devi avere già un accampamento fondato');
    }
    const extra = costruisci(state, board, player, altroNodo ? nodeK2 : nodeK, targetK2, scegli);
    return { forza: risultato.forza + extra.forza, pescate: [...risultato.pescate, ...extra.pescate], seed: risultato.seed };
  }
  return risultato;
  // ponytail: forza = size componente. Nodi stessa zona (giallo ne ha 2) o bordi zona
  // potrebbero fondere due accampamenti in una componente sola — non gestito, raro.
}

const giocatore = (state, id) => state.giocatori.find((g) => g.id === id);

// movimento: il lavoratore va su un nodo qualsiasi, o torna al festival. Nessun limite di distanza.
// ignoraEsclusivita: sperimentale, pozione "salto" — salta SOLO il controllo capNodo/esclusività
// per questa mossa (spostamento obbligatorio resta valido, non è quello che la pozione promette).
export function muovi(state, board, player, dest, ignoraEsclusivita = false) {
  if (dest !== 'festival' && !isNodo(state, board, dest))
    throw new Error('destinazione non valida (un nodo o "festival")');
  const g = giocatore(state, player);
  // sperimentale: spostamento obbligatorio — non puoi restare/tornare dove sei già ORA (vale anche
  // per il festival: due consegne di fila richiedono un giro su un nodo in mezzo).
  if (state.regole?.spostamentoObbligatorio && g.lavoratore === dest)
    throw new Error('devi spostarti: non puoi restare sullo stesso posto');
  // sperimentale: lavoratore esclusivo — un nodo può ospitare al massimo `capNodo` lavoratori alla
  // volta (default 1 se lavoratoreEsclusivo è ON). Il festival resta sempre condiviso, non è un
  // "posto" conteso. Gli accampamenti restano condivisibili.
  const capNodo = state.regole?.capNodo ?? (state.regole?.lavoratoreEsclusivo ? 1 : Infinity);
  if (!ignoraEsclusivita && dest !== 'festival' && Number.isFinite(capNodo)
    && state.giocatori.filter((gg) => gg.id !== player && gg.lavoratore === dest).length >= capNodo)
    throw new Error('nodo pieno');
  g.lavoratore = dest;
}

// --- Compra nodo (sperimentale) ---
// Spendi 2 unità della STESSA risorsa (qualsiasi tipo) per trasformare un esagono libero, di zona
// reale, senza risorsa attiva sopra, in un nuovo nodo — poi costruisci SUBITO il primo accampamento
// (seed) a uno dei suoi vicini, nello stesso turno/azione. Il nodo comprato vive in `state.nodiExtra`
// (mai sulla board condivisa fra partite): a inizio ricerca `nodi(board)` non lo vede, ma isNodo() sì.
export function compraNodo(state, board, player, hexK, risorsa, targetK, scegli = null) {
  if (!state.regole?.compraNodo) throw new Error('regola "fonda nodo" non abilitata in questa partita');
  const h = board.hexes.get(hexK);
  if (!h || h.node || !h.zone || h.resource) throw new Error('qui non puoi fondare un nodo');
  if (isNodo(state, board, hexK)) throw new Error('è già un nodo');
  if (state.built.has(hexK)) throw new Error('hex già occupato');
  const g = giocatore(state, player);
  if (conta(g.droghe, risorsa) < 2) throw new Error('servono 2 unità della stessa risorsa');
  g.droghe.splice(g.droghe.indexOf(risorsa), 1);
  g.droghe.splice(g.droghe.indexOf(risorsa), 1);
  (state.nodiExtra ??= new Set()).add(hexK);
  g.lavoratore = hexK;
  return costruisci(state, board, player, hexK, targetK, scegli);
}

// hex risorsa ATTIVA adiacenti a uno qualsiasi degli hex passati (dedup). Fonte infinita.
export function risorseAdiacenti(state, board, keys) {
  const out = new Set();
  for (const k of keys) for (const nk of viciniK(k)) {
    const h = board.hexes.get(nk);
    if (h && attivaSuHex(state, h)) out.add(nk);
  }
  return [...out];
}

// tutti gli hex del giocatore che formano accampamenti collegati a `nodeK`
export function accampamento(state, board, player, nodeK) {
  const node = board.hexes.get(nodeK);
  const owner = mieiHex(state, player);
  const nodeAdj = new Set(vicini(board, node.q, node.r).map((h) => hk(h.q, h.r)));
  const camp = new Set();
  for (const s of [...owner].filter((k) => nodeAdj.has(k)))
    for (const k of componente(owner, s)) camp.add(k);
  return camp;
}

// azione Pesca: raccoglie TUTTE le risorse attive toccate dagli accampamenti al nodo (no cap).
// extra: sperimentale, pozione "abbondanza" — 1 risorsa aggiuntiva a scelta, non legata a un hex
// (a differenza della pesca normale, che raccoglie solo ciò che è fisicamente adiacente).
export function pesca(state, board, player, nodeK, extra = null) {
  const camp = accampamento(state, board, player, nodeK);
  const ris = risorseAdiacenti(state, board, camp);
  const g = giocatore(state, player);
  const prese = ris.map((k) => board.hexes.get(k).resource);
  if (extra) prese.push(extra);
  g.droghe.push(...prese);
  return prese;
}

// --- Festival: carte set-collection ---
// rng seedato (mulberry32) per partite riproducibili.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// genera le 18 carte dai parametri di livello (niente specifiche per-carta a mano).
// need = multiset {risorsa: quantità}. Le risorse pescabili sono quelle ATTIVE.
export function generaCarte(attive, cfg = DEFAULT_FESTIVAL, rand = rng()) {
  const tipi = [...new Set(Object.values(attive))];
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const carte = [];
  for (const [liv, L] of Object.entries(cfg.livelli)) {
    for (let i = 0; i < cfg.carte_per_livello; i++) {
      const need = {};
      let base = tipi;
      if (L.distinte) { // livello con N tipi distinti (1 ciascuno), poi distribuisci il resto
        base = [...tipi].sort(() => rand() - 0.5).slice(0, L.distinte);
        for (const t of base) need[t] = 1;
      }
      const restanti = L.risorse - (L.distinte || 0);
      for (let k = 0; k < restanti; k++) { const t = pick(base); need[t] = (need[t] || 0) + 1; }
      carte.push({ id: `L${liv}-${i}`, livello: +liv, need, punti: L.punti, pozione: pozioneRoundRobin(liv, i) });
    }
  }
  return carte;
  // ponytail: distribuzione L2/L3 casuale sui tipi attivi. Se vuoi vincoli (min tipi
  // distinti, no monocolore) si aggiungono al config.
}

const conta = (arr, x) => arr.filter((v) => v === x).length;

// pila = i 3 mazzetti (mescolati singolarmente, poi ridotti a `pescate[liv]` carte se indicato —
// deck-builder vs setup partita: il mazzo può avere più carte disegnate di quante se ne usino).
// modo: 'sequenziale' (default, impila L1→L2→L3, facili prima) · 'misto' (interfoglia round-robin
// 1 L1 + 1 L2 + 1 L3 a rotazione) · 'mescolato' (tutti i livelli mescolati insieme, ordine libero).
// esposte = quante carte scoperte nel mercato (default 3).
export function nuovoMercato(carte, rand, modo = 'sequenziale', pescate = null, esposte = 3) {
  const mescola = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const mazzi = [1, 2, 3].map((liv) => {
    const a = mescola(carte.filter((c) => c.livello === liv));
    return pescate && pescate[liv] != null ? a.slice(0, pescate[liv]) : a;
  });
  let pila;
  if (modo === 'misto') {
    const maxLen = Math.max(0, ...mazzi.map((m) => m.length));
    pila = Array.from({ length: maxLen }).flatMap((_, i) => mazzi.map((m) => m[i]).filter(Boolean));
  } else if (modo === 'mescolato') {
    pila = mescola(mazzi.flat());
  } else {
    pila = mazzi.flat();
  }
  return { pila, mercato: pila.splice(0, esposte) };
}

// consegna al festival: soddisfa una carta spendendo droghe dal carico, guadagna punti.
// sostituzione: sperimentale, pozione "trasmutazione" — { mancante, pagata }: copre 1 unità
// mancante di `mancante` spendendo 2 unità di `pagata` (un'altra risorsa posseduta). Copre SOLO
// 1 unità: se manca più di quello, l'azione resta illegale (coerente con "sostituire UNA risorsa").
// ignora: sperimentale, pozione "omissione" — come sostituzione ma gratis: 1 unità di `ignora` non
// serve possederla affatto (nessuna spesa compensativa).
export function consegna(state, player, carta, sostituzione = null, ignora = null) {
  const g = giocatore(state, player);
  if (g.lavoratore !== 'festival') throw new Error('devi essere al festival per consegnare');
  let need = carta.need;
  if (sostituzione) {
    const { mancante, pagata } = sostituzione;
    if (pagata === mancante) throw new Error('trasmutazione: la risorsa di pagamento deve essere diversa da quella mancante');
    if (!carta.need[mancante]) throw new Error('trasmutazione: la carta non richiede questa risorsa');
    if (conta(g.droghe, pagata) < 2) throw new Error('trasmutazione: servono 2 unità della risorsa di pagamento');
    need = { ...carta.need, [mancante]: carta.need[mancante] - 1 };
    if (need[mancante] <= 0) delete need[mancante];
  }
  if (ignora) {
    if (!carta.need[ignora]) throw new Error('omissione: la carta non richiede questa risorsa');
    need = { ...need, [ignora]: (need[ignora] ?? carta.need[ignora]) - 1 };
    if (need[ignora] <= 0) delete need[ignora];
  }
  for (const [r, c] of Object.entries(need))
    if (conta(g.droghe, r) < c) throw new Error(`droghe insufficienti: serve ${c}×${r}`);
  if (sostituzione) { g.droghe.splice(g.droghe.indexOf(sostituzione.pagata), 1); g.droghe.splice(g.droghe.indexOf(sostituzione.pagata), 1); }
  for (const [r, c] of Object.entries(need))
    for (let k = 0; k < c; k++) g.droghe.splice(g.droghe.indexOf(r), 1);
  g.punti += carta.punti;
  return carta.punti;
}

// consegna una carta DEL MERCATO: spende droghe, prende la carta, rimpiazza dalla pila.
export function consegnaMercato(state, player, cartaId, sostituzione = null, turno = null, ignora = null) {
  const f = state.festival;
  const idx = f.mercato.findIndex((c) => c.id === cartaId);
  if (idx < 0) throw new Error('carta non nel mercato');
  const carta = f.mercato[idx];
  consegna(state, player, carta, sostituzione, ignora); // spende droghe + punti (valida posizione festival)
  f.mercato.splice(idx, 1);
  if (f.pila.length) f.mercato.push(f.pila.shift()); // rimpiazzo
  const g = giocatore(state, player);
  g.carte.push(carta);
  // sperimentale: la carta consegnata alimenta la pozione del suo tipo (ricaricabile o oneshot)
  if (carta.pozione) {
    const tipo = carta.pozione;
    const modo = (state.regole?.pozioniModo || POZIONE_DEFAULT_MODO)[tipo] || 'oneshot';
    const caricheMax = modo === 'oneshot' ? 1 : Object.values(carta.need).reduce((a, b) => a + b, 0);
    if (g.pozioni[tipo]) {
      // duplicato: ricarica gratuita a pieno, poi la carta va in riserva
      g.pozioni[tipo].cariche = g.pozioni[tipo].caricheMax;
      g.pozioni[tipo].riserva++;
      g.pozioni[tipo].cartePrese++;
    } else {
      g.pozioni[tipo] = { cariche: caricheMax, caricheMax, riserva: 0, need: { ...carta.need }, modoRicarica: modo, ottenutaTurno: turno, usiTotali: 0, cartePrese: 1, ultimoUsoTurno: null, risorseRicarica: 0 };
    }
  }
  return carta;
}

// --- Festival Collaborativo (opzionale) ---
// Quando una carta viene consegnata, gli altri giocatori possono "contribuire" una risorsa fra
// quelle richieste dalla carta (una icona = una unità, consumata) per guadagnare PV. Meccanica
// deterministica by design: chi/quando/quanto sono decisi FUORI dall'engine (bot.js/game.html),
// qui restano solo le due mosse pure — nessuna decisione, nessuna IA.

// multiset delle icone-risorsa "eccedenti" della carta: solo risorse presenti ≥2 volte (tutte le
// copie), non le singole. Regola di design: il festival ha bisogno di un po' di tutto, ma la
// collaborazione avviene solo sulle eccedenze — anche le carte diventano "più o meno collaborative"
// a seconda di come sono composte, non solo più o meno difficili.
export const festivalIcone = (carta) =>
  Object.entries(carta.need).filter(([, c]) => c >= 2).flatMap(([r, c]) => Array(c).fill(r));

// un contributo: il giocatore consegna 1 unità di `risorsa` (deve essere ancora tra `iconeDisponibili`)
// e guadagna `ricompensaPV`. Non tocca il mercato/la carta consegnata — quella resta a chi l'ha presa.
export function contribuisciFestival(state, player, risorsa, ricompensaPV) {
  if (!Number.isFinite(ricompensaPV)) throw new Error('ricompensaPV non valido');
  const g = giocatore(state, player);
  const idx = g.droghe.indexOf(risorsa);
  if (idx < 0) throw new Error(`non hai la risorsa ${risorsa}`);
  g.droghe.splice(idx, 1);
  g.punti += ricompensaPV;
}

// fine partita: finite le carte (mercato vuoto → pila già esaurita), oppure ultimo giro concluso
// (sperimentale, regola accampamentiMax — vedi gioca()).
export const finita = (state) => state.festival.mercato.length === 0 || (state.ultimoGiro != null && state.ultimoGiro.restanti <= 0);

// --- Orchestratore turno ---
export const diMano = (state) => state.giocatori[state.turno];

// applica UNA azione del giocatore di mano, poi passa il turno. azione:
//   { tipo:'costruisci', nodeK, targetK, scegli? } | { tipo:'pesca', nodeK } | { tipo:'consegna', cartaId }
export function gioca(state, board, azione) {
  if (finita(state)) throw new Error('partita finita');
  const p = diMano(state).id;
  const g0 = giocatore(state, p);
  const turno = state.log.length + 1;
  // pozioni: azione.pozioneId è ora il tipo stringa della pozione (non più cartaId).
  // azione.tipo === 'ricarica' è un'azione a sé (non usa pozioneId).
  const pozioneType = azione.pozioneId ?? null;
  if (pozioneType != null) {
    const pz = g0.pozioni[pozioneType];
    if (!pz || pz.cariche <= 0) throw new Error('pozione non disponibile');
    const attese = { costruisci: ['crescita', 'crescita2', 'salto', 'visione'], pesca: ['abbondanza', 'salto', 'euforia'], consegna: ['trasmutazione', 'omissione', 'convergenza'] }[azione.tipo] || [];
    if (!attese.includes(pozioneType)) throw new Error(`pozione ${pozioneType} non usabile durante ${azione.tipo}`);
  }
  let res, secondaConsegna = null, extraPesca = null, extraCostruisci = null;
  if (azione.tipo === 'costruisci') {
    muovi(state, board, p, azione.nodeK, pozioneType === 'salto');
    res = costruisci(state, board, p, azione.nodeK, azione.targetK, azione.scegli,
      (pozioneType === 'crescita' || pozioneType === 'crescita2') ? azione.targetK2 : null,
      pozioneType === 'crescita2' ? azione.nodeK2 : null);
    // pozione "visione": dopo aver costruito, raccogli subito sullo stesso nodo.
    if (pozioneType === 'visione') extraPesca = pesca(state, board, p, azione.nodeK);
  } else if (azione.tipo === 'pesca') {
    muovi(state, board, p, azione.nodeK, pozioneType === 'salto');
    res = pesca(state, board, p, azione.nodeK, pozioneType === 'abbondanza' ? azione.extraRisorsa : null);
    // pozione "euforia": dopo la raccolta, un segmento di costruzione gratuito.
    if (pozioneType === 'euforia' && azione.targetK) extraCostruisci = costruisci(state, board, p, azione.nodeK, azione.targetK, azione.scegli);
  } else if (azione.tipo === 'consegna') {
    muovi(state, board, p, 'festival');
    res = consegnaMercato(state, p, azione.cartaId, pozioneType === 'trasmutazione' ? azione.sostituzione : null, turno, pozioneType === 'omissione' ? azione.ignora : null);
    // pozione "convergenza": una SECONDA consegna nella stessa azione.
    if (pozioneType === 'convergenza' && azione.cartaId2) secondaConsegna = consegnaMercato(state, p, azione.cartaId2, null, turno);
  }
  else if (azione.tipo === 'compraNodo') { res = compraNodo(state, board, p, azione.hexK, azione.risorsa, azione.targetK, azione.scegli); }
  else if (azione.tipo === 'ricarica') {
    // ricarica una pozione ricaricabile: paga risorse dal carico, recupera cariche (max caricheMax).
    // una volta per turno (ogni gioca() = 1 turno, naturalmente garantito).
    const pz = g0.pozioni[azione.pozioneType];
    if (!pz || pz.modoRicarica !== 'ricaricabile') throw new Error('pozione non ricaricabile');
    for (const r of (azione.risorse || [])) {
      if (!(pz.need[r] > 0)) throw new Error(`risorsa ${r} non richiesta dalla pozione`);
      const idx = g0.droghe.indexOf(r);
      if (idx < 0) throw new Error(`non hai la risorsa ${r}`);
      g0.droghe.splice(idx, 1);
      pz.cariche = Math.min(pz.cariche + 1, pz.caricheMax);
      pz.risorseRicarica++;
    }
    res = azione;
  }
  else throw new Error(`azione sconosciuta: ${azione.tipo}`);
  // consuma una carica dopo l'azione (per ricarica non si consuma — ha già modificato le cariche)
  if (pozioneType) {
    const pz = g0.pozioni[pozioneType];
    pz.cariche--;
    pz.usiTotali++;
    pz.ultimoUsoTurno = turno;
    // auto-refill dalla riserva quando la carta corrente è esaurita
    if (pz.cariche <= 0 && pz.riserva > 0) { pz.riserva--; pz.cariche = pz.caricheMax; }
  }
  const g = diMano(state); g.turni++; g.azioni[azione.tipo] = (g.azioni[azione.tipo] || 0) + 1;    // statistiche
  state.log.push({ n: turno, player: p, tipo: azione.tipo,
    nodo: azione.nodeK || azione.hexK || null, hex: (azione.tipo === 'costruisci' || azione.tipo === 'compraNodo') ? azione.targetK : null,
    livello: azione.tipo === 'consegna' ? res.livello : null,
    punti: azione.tipo === 'consegna' ? res.punti : null,
    cartaId: azione.tipo === 'consegna' ? res.id : null,
    livello2: secondaConsegna ? secondaConsegna.livello : null,
    punti2: secondaConsegna ? secondaConsegna.punti : null,
    cartaId2: secondaConsegna ? secondaConsegna.id : null,
    hex2: extraCostruisci ? azione.targetK : null,
    seed: azione.tipo === 'costruisci' ? res.seed : null,
    seed2: extraCostruisci ? extraCostruisci.seed : null,
    risorse: (azione.tipo === 'costruisci' || azione.tipo === 'compraNodo') ? res.pescate.length + (extraPesca ? extraPesca.length : 0)
      : azione.tipo === 'pesca' ? res.length + (extraCostruisci ? extraCostruisci.pescate.length : 0) : 0,
    pozioneUsata: pozioneType });
  // sperimentale: ultimo giro — il primo giocatore che esaurisce una risorsa limitata (accampamenti
  // NUOVI con accampamentiMax, o segmenti TOTALI con capSegmenti+fineSuLimiteSegmenti) triggera la
  // fine partita. Se era l'ultimo a muovere in questo giro, la partita finisce subito (nessuno resta
  // da far giocare); altrimenti chi non ha ancora mosso in questo giro gioca un ultimo turno a testa,
  // poi si chiude. Il segmento extra di "euforia" può essere lui stesso il trigger, quindi conta anche quello.
  const seedTrigger = (azione.tipo === 'costruisci' && res.seed) || (extraCostruisci && extraCostruisci.seed);
  const accampamentiTrigger = seedTrigger && state.regole?.accampamentiMax != null && g.accampamentiRimasti <= 0;
  const limiteSegmentiTrigger = azione.tipo === 'costruisci' && state.regole?.fineSuLimiteSegmenti
    && state.regole?.capSegmenti != null && mieiHex(state, p).size >= state.regole.capSegmenti;
  if (!state.ultimoGiro && (accampamentiTrigger || limiteSegmentiTrigger)) {
    state.ultimoGiro = { trigger: p, restanti: state.giocatori.length - 1 - state.turno };
  } else if (state.ultimoGiro && state.ultimoGiro.restanti > 0) {
    state.ultimoGiro.restanti--;
  }
  state.turno = (state.turno + 1) % state.giocatori.length;
  return res;
}

// sperimentale: bonus risorse residue a fine partita (es. ogni 3 risorse in carico → 1 PV).
// Idempotente NO: va chiamata una sola volta, a partita finita (vedi partita() in bot.js).
// Salva state.bonusFinale = { rv, per: { pid: { droghe, bonus, prePunti } } } per il report
// (serve a distinguere "spareggio elegante" da "ha ribaltato il vincitore").
export function applicaBonusRisorse(state) {
  const rv = state.regole?.risorseVittoria;
  if (!rv?.risorse) return;
  const per = {};
  for (const g of state.giocatori) {
    const bonus = Math.floor(g.droghe.length / rv.risorse) * rv.punti;
    per[g.id] = { droghe: g.droghe.length, bonus, prePunti: g.punti };
    g.punti += bonus;
  }
  state.bonusFinale = { rv, per };
}

// vincitore a fine partita: più punti. Pareggio → null. ponytail: nessuno spareggio definito.
export function vincitore(state) {
  const g = [...state.giocatori].sort((a, b) => b.punti - a.punti);
  return g[0].punti === g[1]?.punti ? null : g[0];
}

// --- Self-check (solo Node) ---
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
  const carta = { rosa: 'girasole', arancio: 'tartaruga', verde: 'fungo_marrone', giallo: 'cactus' };
  const g = nuovaPartita(carta);
  assert(g.attive.rosa === 'girasole', 'setup rosa');
  assert(g.giocatori.length === 2 && g.giocatori[0].lavoratore === 'festival', 'placement');
  let err = null;
  try { attivaSetup({ rosa: 'rana' }); } catch (e) { err = e; }
  assert(err, 'risorsa invalida deve fallire');

  // board (fs solo nel self-check Node-only)
  const { readFileSync } = await import('node:fs');
  const loadBoard = () => makeBoard(JSON.parse(readFileSync(new URL('./board.json', import.meta.url))));
  const loadFestival = () => JSON.parse(readFileSync(new URL('./festival.json', import.meta.url)));
  const b = loadBoard();
  assert(nodi(b).length === 5, '5 nodi');
  assert(festival(b).length === 7, '7 hex festival');
  // risorse coerenti con la zona
  for (const h of b.hexes.values())
    if (h.resource) assert(ZONES[h.zone]?.risorse.includes(h.resource), `risorsa ${h.resource} fuori zona ${h.zone}`);
  // connessione: BFS da un nodo raggiunge tutti gli hex
  const start = nodi(b)[0];
  const seen = new Set([hk(start.q, start.r)]), stack = [start];
  while (stack.length) { const h = stack.pop(); for (const n of vicini(b, h.q, h.r)) { const k = hk(n.q, n.r); if (!seen.has(k)) { seen.add(k); stack.push(n); } } }
  assert(seen.size === b.hexes.size, `board connessa (${seen.size}/${b.hexes.size})`);

  // costruzione — nodo arancio (-3,-1), attiva arancio = tartaruga
  const s = nuovaPartita(carta);
  const NODE = '-3,-1';
  assert(costruisci(s, b, 'P1', NODE, '-3,0').forza === 1, 'seed forza 1');       // adiacente al nodo
  assert(costruisci(s, b, 'P1', NODE, '-3,1').forza === 2, 'estensione forza 2'); // catena, non adiac. nodo
  const fail = (fn, msg) => { let e = null; try { fn(); } catch (x) { e = x; } assert(e, msg); };
  fail(() => costruisci(s, b, 'P1', NODE, '-3,-2'), 'no sopra risorsa attiva (tartaruga)');
  fail(() => costruisci(s, b, 'P1', NODE, '0,3'), 'no hex scollegato/altra zona');
  fail(() => costruisci(s, b, 'P1', NODE, '-4,0'), 'no due seed adiacenti sul nodo');

  // nuove regole di piazzamento: catena (no cluster) + no contatto avversari fuori dai nodi
  const s2 = nuovaPartita(carta, ['P1', 'P2'], { seed: 1 });
  costruisci(s2, b, 'P1', NODE, '-3,0');
  costruisci(s2, b, 'P1', NODE, '-3,1');
  costruisci(s2, b, 'P1', NODE, '-3,2');                                       // catena lunga 3
  fail(() => costruisci(s2, b, 'P1', NODE, '-2,1'), 'no cluster (hex tocca due miei)');
  costruisci(s2, b, 'P2', NODE, '-2,-1');                                      // seed P2 tocca P1 al nodo: OK
  assert([...s2.built].some(([k, p]) => k === '-2,-1' && p === 'P2'), 'contatto avversario al nodo permesso');
  s2.built.set('-1,-1', 'P1');
  fail(() => costruisci(s2, b, 'P2', NODE, '-1,-2'), 'no contatto avversari fuori dai nodi');

  // un accampamento non può collegare due nodi (i due nodi giallo -4,4 e 0,4 in fila su r=4)
  const s3 = nuovaPartita(carta, ['P1', 'P2'], { seed: 1 });
  costruisci(s3, b, 'P1', '-4,4', '-3,4');                                     // seed sul nodo giallo A
  costruisci(s3, b, 'P1', '-4,4', '-2,4');                                     // estensione verso il nodo B
  fail(() => costruisci(s3, b, 'P1', '-4,4', '-1,4'), 'no catena che collega due nodi');

  // pesca: dopo seed(-3,0 forza1 →1 tartaruga) + estensione(-3,1 forza2 →2 tartaruga) = 3 droghe
  assert(giocatore(s, 'P1').droghe.length === 3, `pesca-su-build (${giocatore(s, 'P1').droghe.length})`);
  assert(giocatore(s, 'P1').droghe.every((d) => d === 'tartaruga'), 'solo attiva pescata');
  // azione Pesca sull'accampamento {-3,0,-3,1}: risorse attive adiacenti = (-2,0),(-4,1) = 2 tartaruga
  const p = pesca(s, b, 'P1', NODE);
  assert(p.length === 2 && giocatore(s, 'P1').droghe.length === 5, `azione pesca (${p.length})`);

  // movimento
  muovi(s, b, 'P1', NODE); assert(giocatore(s, 'P1').lavoratore === NODE, 'muovi su nodo');
  muovi(s, b, 'P1', 'festival'); assert(giocatore(s, 'P1').lavoratore === 'festival', 'muovi al festival');
  fail(() => muovi(s, b, 'P1', '0,0'), 'destinazione non valida');

  // festival: generazione carte + consegna
  const carte = generaCarte(s.attive, loadFestival(), rng(42));
  assert(carte.length === 18, `18 carte (${carte.length})`);
  assert(carte.filter((c) => c.livello === 1).every((c) => Object.values(c.need).reduce((a, x) => a + x, 0) === 3), 'L1 = 3 risorse');
  assert(carte.filter((c) => c.livello === 3).every((c) => Object.values(c.need).reduce((a, x) => a + x, 0) === 7), 'L3 = 7 risorse');
  // P1 ha 5 tartaruga, al festival; consegna carta {tartaruga:3} → +3 punti, restano 2
  muovi(s, b, 'P1', 'festival');
  const prima = giocatore(s, 'P1').droghe.length;
  assert(consegna(s, 'P1', { need: { tartaruga: 3 }, punti: 3 }) === 3, 'punti consegna');
  assert(giocatore(s, 'P1').punti === 3 && giocatore(s, 'P1').droghe.length === prima - 3, 'droghe spese');
  fail(() => consegna(s, 'P1', { need: { girasole: 1 }, punti: 1 }), 'consegna senza droghe fallisce');

  // mercato: 3 carte scoperte, facili prima, rimpiazzo, fine partita
  const g2 = nuovaPartita(carta, ['P1', 'P2'], { seed: 42 });
  assert(g2.festival.mercato.length === 3 && g2.festival.pila.length === 15, 'mercato 3 + pila 15');
  assert(g2.festival.mercato.every((c) => c.livello === 1), 'prima escono i facili (L1)');
  const target = g2.festival.mercato[0];
  for (const [r, c] of Object.entries(target.need)) for (let k = 0; k < c; k++) giocatore(g2, 'P1').droghe.push(r);
  consegnaMercato(g2, 'P1', target.id);
  assert(g2.festival.mercato.length === 3 && g2.festival.pila.length === 14, 'rimpiazzo dalla pila');
  assert(giocatore(g2, 'P1').carte.length === 1 && giocatore(g2, 'P1').punti === target.punti, 'carta presa + punti');
  assert(!finita(g2), 'partita in corso');
  g2.festival.pila = []; g2.festival.mercato = [];
  assert(finita(g2), 'partita finita quando finiscono le carte');

  // orchestratore turno + vincitore
  const g3 = nuovaPartita(carta, ['P1', 'P2'], { seed: 42 });
  assert(diMano(g3).id === 'P1', 'P1 di mano');
  gioca(g3, b, { tipo: 'costruisci', nodeK: '-3,-1', targetK: '-3,0' });
  assert(g3.turno === 1 && diMano(g3).id === 'P2', 'turno passa a P2');
  assert(giocatore(g3, 'P1').lavoratore === '-3,-1' && giocatore(g3, 'P1').droghe.length >= 1, 'azione applicata');
  assert(giocatore(g3, 'P1').turni === 1 && giocatore(g3, 'P1').azioni.costruisci === 1, 'statistiche azioni');
  assert(g3.log.length === 1 && g3.log[0].player === 'P1' && g3.log[0].tipo === 'costruisci', 'log azioni');
  giocatore(g3, 'P1').punti = 13; giocatore(g3, 'P2').punti = 5;
  assert(vincitore(g3).id === 'P1', 'vince chi ha più punti');
  giocatore(g3, 'P2').punti = 13;
  assert(vincitore(g3) === null, 'pareggio → null');

  // bonus risorse finale: ogni 3 in carico → 1 PV, avanzo scartato
  const g4 = nuovaPartita(carta, ['P1', 'P2'], { risorseVittoria: { risorse: 3, punti: 1 } });
  giocatore(g4, 'P1').droghe = ['girasole', 'girasole', 'girasole', 'tartaruga']; // 4 → 1 PV, 1 scartata
  giocatore(g4, 'P1').punti = 5;
  applicaBonusRisorse(g4);
  assert(giocatore(g4, 'P1').punti === 6, `bonus risorse (${giocatore(g4, 'P1').punti})`);
  assert(g4.bonusFinale.per.P1.bonus === 1 && g4.bonusFinale.per.P1.prePunti === 5 && g4.bonusFinale.per.P1.droghe === 4, 'bonusFinale dettaglio');
  const g5 = nuovaPartita(carta, ['P1', 'P2']); // senza risorseVittoria: nessun bonus
  giocatore(g5, 'P1').droghe = ['girasole', 'girasole', 'girasole'];
  giocatore(g5, 'P1').punti = 5;
  applicaBonusRisorse(g5);
  assert(giocatore(g5, 'P1').punti === 5, 'bonus risorse disattivato di default');

  console.log('ok — tutto (setup·board·costruzione·pesca·movimento·festival·mercato·turno)');
}
