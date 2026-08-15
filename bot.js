// Bot greedy + loop partita. Serve a verificare che l'economia giri.
// node bot.js  → gioca una partita e stampa il resoconto.
import {
  nuovaPartita, gioca, finita, vincitore, diMano,
  costruisci, risorseAdiacenti, accampamento, rng, vicini, nodi,
  festivalIcone, contribuisciFestival, applicaBonusRisorse,
} from './engine.js';

const isNodo = (state, board, k) => board.hexes.get(k)?.node === 'nodo' || !!state.nodiExtra?.has(k);

const shuffle = (a, rand) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// tra i pari merito (stesso score), scegli a caso invece di "il primo trovato": altrimenti
// P1/P2 con stesso stato scelgono sempre la stessa mossa (bias agente simmetrico).
const pickTied = (items, scoreFn, rand) => {
  let best = -Infinity, tied = [];
  for (const it of items) { const s = scoreFn(it); if (s > best) { best = s; tied = [it]; } else if (s === best) tied.push(it); }
  return tied[Math.floor(rand() * tied.length)];
};

const hk = (q, r) => `${q},${r}`;
const conta = (a, x) => a.filter((v) => v === x).length;
const completabile = (droghe, need) => Object.entries(need).every(([r, c]) => conta(droghe, r) >= c);
const mancanti = (droghe, need) => Object.entries(need).reduce((s, [r, c]) => s + Math.max(0, c - conta(droghe, r)), 0);
// quale risorsa mancante inseguire: pari merito fra TUTTE quelle mancanti, a caso (pickTied) — non
// la prima nell'ordine delle chiavi di `need` (Object.keys), che è sempre girasole→tartaruga→
// fungo_marrone→cactus (RISORSE è fisso) e introduceva una preferenza artificiale non di design.
const risorsaMancante = (droghe, need, rand) => {
  const mancanti2 = Object.keys(need).filter((r) => conta(droghe, r) < need[r]);
  return mancanti2.length ? pickTied(mancanti2, () => 0, rand) : undefined;
};

// una costruzione è legale? provala su un clone e vedi se non lancia.
function legale(state, board, pid, nodeK, targetK) {
  const c = { attive: state.attive, regole: state.regole, nodiExtra: state.nodiExtra, built: new Map(state.built), giocatori: state.giocatori.map((g) => ({ ...g, droghe: [...g.droghe] })) };
  try { costruisci(c, board, pid, nodeK, targetK); return true; } catch { return false; }
}

// --- Pozioni (sperimentale) — policy greedy, nessuna pianificazione a lungo termine: se un
// candidato già scelto (costruisci/pesca) può sfruttare una pozione posseduta, la aggancia.
function aPozione(state, pid, tipo) { const pz = state.giocatori.find((p) => p.id === pid).pozioni[tipo]; return (pz && pz.cariche > 0) ? pz : null; }

// crescita: prova a trovare un secondo hex costruibile nella stessa zona/nodo, DOPO il primo
// piazzamento (su un clone, per validare contro lo stato aggiornato come farebbe il motore).
function aggiungiCrescita(state, board, pid, azione) {
  if (azione?.tipo !== 'costruisci' || azione.pozioneId != null) return azione; // già lega un'altra pozione (es. crescita2/salto): non sovrascrivere
  const pz = aPozione(state, pid, 'crescita');
  if (!pz) return azione;
  const c = { attive: state.attive, regole: state.regole, nodiExtra: state.nodiExtra, built: new Map(state.built), giocatori: state.giocatori.map((g) => ({ ...g, droghe: [...g.droghe] })) };
  try { costruisci(c, board, pid, azione.nodeK, azione.targetK, azione.scegli); } catch { return azione; }
  const node = board.hexes.get(azione.nodeK);
  for (const h of board.hexes.values()) {
    if (h.zone !== node.zone || h.node || c.built.has(hk(h.q, h.r))) continue;
    const tk2 = hk(h.q, h.r);
    try { costruisci(c, board, pid, azione.nodeK, tk2, azione.scegli); return { ...azione, pozioneId: 'crescita', targetK2: tk2 }; } catch { /* prova il prossimo */ }
  }
  return azione;
}

// crescita2: come crescita, ma il 2° segmento va su un ALTRO nodo dove hai già un accampamento
// fondato (un tuo hex a contatto di quel nodo) — non è vincolato alla zona del primo piazzamento.
// Filtro cheap (nodeAdj2 ∩ mine) prima di provare gli hex candidati: evita di clonare/testare nodi
// dove non possiedi ancora nulla (falliranno comunque la stessa validazione dentro costruisci()).
function aggiungiCrescita2(state, board, pid, azione) {
  if (azione?.tipo !== 'costruisci' || azione.pozioneId != null) return azione;
  const pz = aPozione(state, pid, 'crescita2');
  if (!pz) return azione;
  const mine = new Set([...state.built].filter(([, p]) => p === pid).map(([k]) => k));
  for (const node of nodi(board)) {
    const nodeK2 = hk(node.q, node.r);
    if (nodeK2 === azione.nodeK) continue; // stesso nodo: è "crescita", non questa pozione
    const nodeAdj2 = vicini(board, node.q, node.r).map((h) => hk(h.q, h.r));
    if (!nodeAdj2.some((k) => mine.has(k))) continue; // non ho ancora un accampamento su questo nodo
    for (const h of board.hexes.values()) {
      if (h.zone !== node.zone || h.node || state.built.has(hk(h.q, h.r))) continue;
      const tk2 = hk(h.q, h.r);
      const c = { attive: state.attive, regole: state.regole, nodiExtra: state.nodiExtra, built: new Map(state.built), giocatori: state.giocatori.map((g) => ({ ...g, droghe: [...g.droghe] })) };
      try {
        costruisci(c, board, pid, azione.nodeK, azione.targetK, azione.scegli, tk2, nodeK2);
        return { ...azione, pozioneId: 'crescita2', targetK2: tk2, nodeK2 };
      } catch { /* prova il prossimo hex */ }
    }
  }
  return azione;
}

// abbondanza: 1 risorsa extra a scelta — punta a quella che serve di più per la carta target attuale.
function aggiungiAbbondanza(state, board, pid, azione) {
  if (azione?.tipo !== 'pesca' || azione.pozioneId != null) return azione; // già lega un'altra pozione (es. salto): non sovrascrivere
  const pz = aPozione(state, pid, 'abbondanza');
  if (!pz) return azione;
  const g = state.giocatori.find((p) => p.id === pid);
  const mkt = state.festival.mercato;
  const bisogni = {};
  for (const c of mkt) for (const [r, n] of Object.entries(c.need)) if (conta(g.droghe, r) < n) bisogni[r] = (bisogni[r] || 0) + 1;
  const R = Object.entries(bisogni).sort((a, b) => b[1] - a[1])[0]?.[0] || Object.values(state.attive)[0];
  return { ...azione, pozioneId: 'abbondanza', extraRisorsa: R };
}

// visione: dopo Costruisci, raccolta gratuita sullo stesso nodo — nessuna scelta da fare (la
// raccolta normale non ha un "bersaglio", prende tutto ciò che c'è), quindi basta agganciare la
// pozione se disponibile e se nessun'altra è già agganciata su questa azione.
function aggiungiVisione(state, board, pid, azione) {
  if (azione?.tipo !== 'costruisci' || azione.pozioneId != null) return azione;
  const pz = aPozione(state, pid, 'visione');
  if (!pz) return azione;
  return { ...azione, pozioneId: 'visione' };
}

// euforia: dopo Raccolta, un segmento di costruzione gratuito sullo stesso nodo — cerca un hex
// legale nella zona (stato reale, la pesca non tocca `built` quindi non serve clonare).
function aggiungiEuforia(state, board, pid, azione) {
  if (azione?.tipo !== 'pesca' || azione.pozioneId != null) return azione;
  const pz = aPozione(state, pid, 'euforia');
  if (!pz) return azione;
  const node = board.hexes.get(azione.nodeK);
  for (const h of board.hexes.values()) {
    if (h.zone !== node.zone || h.node || state.built.has(hk(h.q, h.r))) continue;
    const tk = hk(h.q, h.r);
    if (!legale(state, board, pid, azione.nodeK, tk)) continue;
    return { ...azione, pozioneId: 'euforia', targetK: tk };
  }
  return azione;
}

// applica tutti gli "arricchimenti" pozione (crescita/crescita2/abbondanza/visione/euforia) a un
// candidato già scelto — ognuno è un no-op se non pertinente al tipo di azione o se un'altra
// pozione è già agganciata (vedi guardie in ciascuna funzione).
function arricchisciPozioni(state, board, pid, azione) {
  return aggiungiEuforia(state, board, pid, aggiungiVisione(state, board, pid, aggiungiAbbondanza(state, board, pid, aggiungiCrescita2(state, board, pid, aggiungiCrescita(state, board, pid, azione)))));
}

// trasmutazione: rende consegnabile una carta a cui manca ESATTAMENTE 1 unità di 1 risorsa,
// spendendo 2 unità di un'altra risorsa posseduta. Genera un candidato che altrimenti non esiste.
function provaTrasmutazione(state, pid) {
  const pz = aPozione(state, pid, 'trasmutazione');
  if (!pz) return null;
  const g = state.giocatori.find((p) => p.id === pid);
  for (const c of state.festival.mercato) {
    const carenze = Object.entries(c.need).filter(([r, n]) => conta(g.droghe, r) < n);
    if (carenze.length !== 1) continue; // solo se manca esattamente 1 tipo
    const [mancante, n] = carenze[0];
    if (n - conta(g.droghe, mancante) !== 1) continue; // e ne manca esattamente 1 unità
    const pagata = [...new Set(g.droghe)].find((r) => r !== mancante && conta(g.droghe, r) >= 2);
    if (!pagata) continue;
    return { tipo: 'consegna', cartaId: c.id, pozioneId: 'trasmutazione', sostituzione: { mancante, pagata } };
  }
  return null;
}

// omissione: come trasmutazione ma gratis — ignora 1 unità mancante senza pagare nulla in cambio.
function provaOmissione(state, pid) {
  const pz = aPozione(state, pid, 'omissione');
  if (!pz) return null;
  const g = state.giocatori.find((p) => p.id === pid);
  for (const c of state.festival.mercato) {
    const carenze = Object.entries(c.need).filter(([r, n]) => conta(g.droghe, r) < n);
    if (carenze.length !== 1) continue;
    const [mancante, n] = carenze[0];
    if (n - conta(g.droghe, mancante) !== 1) continue;
    return { tipo: 'consegna', cartaId: c.id, pozioneId: 'omissione', ignora: mancante };
  }
  return null;
}

// convergenza: se hai 2+ carte già completabili, consegnale entrambe in una sola azione — ma le
// droghe sono un pool condiviso: essere completabili SINGOLARMENTE non basta, il bisogno delle due
// carte SOMMATO deve stare nel carico (altrimenti la seconda consegna fallisce a metà). Prova tutte
// le coppie, tiene la combinazione fattibile con più punti totali.
function provaConvergenza(state, pid, done) {
  const pz = aPozione(state, pid, 'convergenza');
  if (!pz || done.length < 2) return null;
  const g = state.giocatori.find((p) => p.id === pid);
  let migliore = null, migliorPunti = -1;
  for (let i = 0; i < done.length; i++) for (let j = 0; j < done.length; j++) {
    if (i === j) continue;
    const bisognoTotale = { ...done[i].need };
    for (const [r, n] of Object.entries(done[j].need)) bisognoTotale[r] = (bisognoTotale[r] || 0) + n;
    if (!completabile(g.droghe, bisognoTotale)) continue;
    const tot = done[i].punti + done[j].punti;
    if (tot > migliorPunti) { migliorPunti = tot; migliore = [done[i], done[j]]; }
  }
  if (!migliore) return null;
  return { tipo: 'consegna', cartaId: migliore[0].id, cartaId2: migliore[1].id, pozioneId: 'convergenza' };
}

// salto: come nodiZona() ma SENZA il filtro di esclusività — nodi che l'IA scarterebbe perché
// occupati da un altro lavoratore, usati solo come fallback quando la zona normale è bloccata.
function tuttiNodiZona(state, board, Z) {
  const base = [...board.hexes.values()].filter((h) => h.node === 'nodo' && h.zone === Z);
  const extra = state.nodiExtra?.size ? [...state.nodiExtra].map((k) => board.hexes.get(k)).filter((h) => h.zone === Z) : [];
  return [...base, ...extra];
}
function provaSalto(state, board, pid, Z, R, rand) {
  const pz = aPozione(state, pid, 'salto');
  if (!pz) return null;
  // salto bypassa SOLO l'esclusività (capNodo) — muovi() applica spostamentoObbligatorio comunque, quindi
  // il nodo dove il giocatore è ORA va escluso a prescindere: salto non lo sblocca, ci prova e basta gioca().
  const qui = state.giocatori.find((g) => g.id === pid).lavoratore;
  const liberi = new Set(nodiZona(state, board, Z, pid).map((h) => hk(h.q, h.r)));
  const bloccati = shuffle(tuttiNodiZona(state, board, Z).filter((h) => !liberi.has(hk(h.q, h.r)) && hk(h.q, h.r) !== qui), rand);
  for (const node of bloccati) {
    const nodeK = hk(node.q, node.r);
    const t = trovaCostruzione(state, board, pid, node, R, rand);
    if (t) return { tipo: 'costruisci', nodeK, targetK: t, pozioneId: 'salto', scegli: (cand, cap) => preferR(board, cand, R, cap) };
    const camp = accampamento(state, board, pid, nodeK);
    if (risorseAdiacenti(state, board, camp).some((k) => board.hexes.get(k).resource === R)) return { tipo: 'pesca', nodeK, pozioneId: 'salto' };
  }
  return null;
}

// miglior hex da costruire al nodo per pescare R (max hex-R adiacenti; altrimenti un hex legale qualsiasi).
function trovaCostruzione(state, board, pid, node, R, rand) {
  const nodeK = hk(node.q, node.r);
  const candidati = [];
  for (const h of board.hexes.values()) {
    if (h.zone !== node.zone || h.node || state.built.has(hk(h.q, h.r))) continue;
    const tk = hk(h.q, h.r);
    if (!legale(state, board, pid, nodeK, tk)) continue;
    candidati.push(tk);
  }
  if (!candidati.length) return null;
  const score = (tk) => risorseAdiacenti(state, board, [tk]).filter((k) => board.hexes.get(k).resource === R).length;
  return pickTied(candidati, score, rand);
}

// nodi "veri" di zona Z più quelli comprati in questa partita (sperimentale, vedi engine.compraNodo).
// se il lavoratore è esclusivo (sperimentale), esclude i nodi già occupati da un ALTRO giocatore; se
// lo spostamento è obbligatorio (sperimentale), esclude il nodo dove il giocatore STESSO si trova
// già — altrimenti l'IA proporrebbe una mossa che poi muovi() rifiuterebbe.
function nodiZona(state, board, Z, pid) {
  const base = [...board.hexes.values()].filter((h) => h.node === 'nodo' && h.zone === Z);
  const extra = state.nodiExtra?.size ? [...state.nodiExtra].map((k) => board.hexes.get(k)).filter((h) => h.zone === Z) : [];
  let tutti = [...base, ...extra];
  const capNodo = state.regole?.capNodo ?? (state.regole?.lavoratoreEsclusivo ? 1 : Infinity);
  if (Number.isFinite(capNodo))
    tutti = tutti.filter((h) => state.giocatori.filter((g) => g.id !== pid && g.lavoratore === hk(h.q, h.r)).length < capNodo);
  if (state.regole?.spostamentoObbligatorio) {
    const qui = state.giocatori.find((g) => g.id === pid).lavoratore;
    tutti = tutti.filter((h) => hk(h.q, h.r) !== qui);
  }
  return tutti;
}

// prova a fondare un nuovo nodo (sperimentale, engine.compraNodo): 2 unità di una risorsa
// posseduta, un hex libero/senza risorsa di zona Z, e un vicino legale da seminare subito.
// Fallback per quando la zona è satura e non c'è nessun'altra mossa — non un'euristica raffinata.
function provaCompraNodo(state, board, pid, Z, rand) {
  if (!state.regole?.compraNodo) return null;
  const g = state.giocatori.find((p) => p.id === pid);
  const risorsePossibili = [...new Set(g.droghe)].filter((r) => conta(g.droghe, r) >= 2);
  if (!risorsePossibili.length) return null;
  const liberi = shuffle([...board.hexes.values()].filter((h) => h.zone === Z && !h.node && !h.resource && !state.built.has(hk(h.q, h.r)) && !isNodo(state, board, hk(h.q, h.r))), rand);
  for (const h of liberi) {
    const hexK = hk(h.q, h.r);
    const vicine = shuffle(vicini(board, h.q, h.r).filter((v) => v.zone === Z && !v.node && !v.resource && !state.built.has(hk(v.q, v.r))), rand);
    for (const v of vicine) {
      const targetK = hk(v.q, v.r);
      // simula: prova a costruire come se hexK fosse già un nodo (senza spendere davvero)
      const c = { attive: state.attive, regole: state.regole, nodiExtra: new Set([...(state.nodiExtra || []), hexK]), built: new Map(state.built), giocatori: state.giocatori.map((gg) => ({ ...gg, droghe: [...gg.droghe] })) };
      try { costruisci(c, board, pid, hexK, targetK); } catch { continue; }
      const risorsa = risorsePossibili[Math.floor(rand() * risorsePossibili.length)];
      return { tipo: 'compraNodo', hexK, risorsa, targetK, scegli: (cand, cap) => cand.slice(0, cap) };
    }
  }
  return null;
}

// scegli quali risorse prendere in pesca-su-build: prima quelle di tipo R.
const preferR = (board, cand, R, cap) =>
  [...cand].sort((a, b) => (board.hexes.get(b).resource === R) - (board.hexes.get(a).resource === R)).slice(0, cap);

// personalità = bias additivo per tipo azione. bilanciato = agente originale (nessun cambiamento).
export const PERSONALITA = {
  bilanciato: { costruisci: 0, pesca: 0, consegna: 0 },
  builder:    { costruisci: 15, pesca: 0, consegna: 0 },
  collector:  { costruisci: 0, pesca: 15, consegna: 0 },
  closer:     { costruisci: 0, pesca: 0, consegna: 15 },
};

// probabilità di rimandare una consegna disponibile per continuare a costruire/pescare:
// più forte è il bias verso costruisci/pesca rispetto a consegna, più il giocatore "accumula".
const probRimanda = (pers) => Math.max(0, Math.min(0.6, (Math.max(pers.costruisci, pers.pesca) - pers.consegna) / 30));

// tra costruisci e pesca (quando entrambi possibili sullo stesso nodo): a parità di bias
// preferisci sempre costruisci (comportamento originale, invariato per 'bilanciato'); altrimenti
// scelta pesata dal bias di personalità.
function scegliCostruisciOPesca(canBuild, canPesca, pers, rand) {
  if (canBuild && !canPesca) return 'costruisci';
  if (!canBuild && canPesca) return 'pesca';
  if (!canBuild && !canPesca) return null;
  if (pers.costruisci === pers.pesca) return 'costruisci';
  const wc = 10 + pers.costruisci, wp = 10 + pers.pesca;
  return rand() * (wc + wp) < wc ? 'costruisci' : 'pesca';
}

// prova a costruire o pescare R nella zona Z: primo nodo libero/legale disponibile. null se niente.
// Estratta da mossaGreedy per essere riusata anche come fallback su altre zone (vedi sotto): un
// giocatore vero non si arrende solo perché il nodo che voleva è occupato, prova altrove.
function provaZona(state, board, pid, Z, R, pers, rand) {
  const nodi = shuffle(nodiZona(state, board, Z, pid), rand);
  for (const node of nodi) {
    const nodeK = hk(node.q, node.r);
    const t = trovaCostruzione(state, board, pid, node, R, rand);
    const camp = accampamento(state, board, pid, nodeK);
    const canPesca = risorseAdiacenti(state, board, camp).some((k) => board.hexes.get(k).resource === R);
    const scelta = scegliCostruisciOPesca(!!t, canPesca, pers, rand);
    if (scelta === 'costruisci') return { tipo: 'costruisci', nodeK, targetK: t, scegli: (cand, cap) => preferR(board, cand, R, cap) };
    if (scelta === 'pesca') return { tipo: 'pesca', nodeK };
  }
  return null;
}

export function mossaGreedy(state, board, pid, rand = Math.random, pers = PERSONALITA.bilanciato) {
  const g = state.giocatori.find((p) => p.id === pid);
  const mkt = state.festival.mercato;
  if (!mkt.length) return null;

  // 1. consegna se possibile (carta più ricca completabile, pari merito → a caso), salvo rimandare per
  // personalità — se lo spostamento è obbligatorio (sperimentale) e sei già al festival, non puoi
  // consegnare di nuovo senza prima allontanarti.
  const alFestivalBloccato = state.regole?.spostamentoObbligatorio && g.lavoratore === 'festival';
  const done = alFestivalBloccato ? [] : mkt.filter((c) => completabile(g.droghe, c.need));
  const consegnaAz = alFestivalBloccato ? null : (provaConvergenza(state, pid, done)
    || (done.length ? { tipo: 'consegna', cartaId: pickTied(done, (c) => c.punti, rand).id } : (provaTrasmutazione(state, pid) || provaOmissione(state, pid)))); // sperimentale: sblocca/moltiplica una consegna
  if (consegnaAz && rand() >= probRimanda(pers)) return consegnaAz;

  // 2. mira alla carta più vicina (meno mancanti, poi più punti, pari merito → a caso)
  const target = pickTied(mkt, (c) => -mancanti(g.droghe, c.need) * 1000 + c.punti, rand);
  const R = risorsaMancante(g.droghe, target.need, rand);
  if (R) {
    const Z = Object.keys(state.attive).find((z) => state.attive[z] === R);
    const az = provaZona(state, board, pid, Z, R, pers, rand);
    if (az) return arricchisciPozioni(state, board, pid, az);
    // bloccato in questa zona: prova le pozioni che sbloccano un hex/nodo altrimenti inaccessibili...
    const salto = provaSalto(state, board, pid, Z, R, rand);
    if (salto) return salto;
    // ...poi a fondare un nuovo nodo (sperimentale)...
    const compra = provaCompraNodo(state, board, pid, Z, rand);
    if (compra) return compra;
  }
  // 3. fallback finale: niente da fare per il target scelto (R indefinito perché già completabile ma
  // bloccato al festival, oppure zona esaurita) — prova QUALSIASI altra zona prima di stallare, un
  // giocatore vero non passa il turno solo perché la SUA prima scelta non è disponibile ORA.
  const Z0 = R ? Object.keys(state.attive).find((z) => state.attive[z] === R) : null;
  for (const [Z2, R2] of shuffle(Object.entries(state.attive), rand)) {
    if (Z2 === Z0) continue;
    const az2 = provaZona(state, board, pid, Z2, R2, pers, rand);
    if (az2) return arricchisciPozioni(state, board, pid, az2);
  }
  // ultima spiaggia: ricarica una pozione scarica se abbiamo le risorse
  const ricarica = provaRicarica(state, pid);
  if (ricarica) return ricarica;
  return consegnaAz; // niente altro da fare: consegna comunque, se possibile, invece di stallare
}

// --- IA con rollout: Monte Carlo, stesso schema di Officina 1907 (candidati → simula in avanti in
// self-play greedy per `depth` turni → valuta → media su `rollouts` → scegli il migliore).
// Non è adversarial (nessun minimax): la simulazione in avanti usa il greedy anche per l'avversario.

// candidati distinti per questo turno: consegna (se possibile) + primo costruisci trovato + prima
// pesca trovata. Stessa logica di mossaGreedy ma senza fermarsi al primo, per dare al rollout
// alternative vere da confrontare invece di un'unica scelta già decisa.
function mossaCandidati(state, board, pid, rand, pers) {
  const g = state.giocatori.find((p) => p.id === pid);
  const mkt = state.festival.mercato;
  if (!mkt.length) return [];
  const cand = [];
  const alFestivalBloccato = state.regole?.spostamentoObbligatorio && g.lavoratore === 'festival';
  const done = alFestivalBloccato ? [] : mkt.filter((c) => completabile(g.droghe, c.need));
  if (!alFestivalBloccato) {
    const az = provaConvergenza(state, pid, done) || (done.length ? { tipo: 'consegna', cartaId: pickTied(done, (c) => c.punti, rand).id } : (provaTrasmutazione(state, pid) || provaOmissione(state, pid)));
    if (az) cand.push(az);
  }

  const target = pickTied(mkt, (c) => -mancanti(g.droghe, c.need) * 1000 + c.punti, rand);
  const R = risorsaMancante(g.droghe, target.need, rand);
  if (R) {
    const Z = Object.keys(state.attive).find((z) => state.attive[z] === R);
    const nodi = shuffle(nodiZona(state, board, Z, pid), rand);
    for (const node of nodi) {
      const nodeK = hk(node.q, node.r);
      if (!cand.some((c) => c.tipo === 'costruisci')) {
        const t = trovaCostruzione(state, board, pid, node, R, rand);
        if (t) cand.push({ tipo: 'costruisci', nodeK, targetK: t, scegli: (c2, cap) => preferR(board, c2, R, cap) });
      }
      if (!cand.some((c) => c.tipo === 'pesca')) {
        const camp = accampamento(state, board, pid, nodeK);
        if (risorseAdiacenti(state, board, camp).some((k) => board.hexes.get(k).resource === R)) cand.push({ tipo: 'pesca', nodeK });
      }
      if (cand.some((c) => c.tipo === 'costruisci') && cand.some((c) => c.tipo === 'pesca')) break;
    }
    if (!cand.some((c) => c.tipo === 'costruisci' || c.tipo === 'pesca')) {
      const salto = provaSalto(state, board, pid, Z, R, rand);
      if (salto) cand.push(salto);
      const compra = provaCompraNodo(state, board, pid, Z, rand);
      if (compra) cand.push(compra);
    }
  }
  // bloccato del tutto (zona esaurita, o R indefinito perché il target era già completabile ma non
  // consegnabile ora): prova qualsiasi altra zona, come in mossaGreedy, invece di restare senza candidati.
  if (!cand.some((c) => c.tipo === 'costruisci' || c.tipo === 'pesca' || c.tipo === 'compraNodo')) {
    const Z0 = R ? Object.keys(state.attive).find((z) => state.attive[z] === R) : null;
    for (const [Z2, R2] of shuffle(Object.entries(state.attive), rand)) {
      if (Z2 === Z0) continue;
      const az2 = provaZona(state, board, pid, Z2, R2, pers, rand);
      if (az2) { cand.push(az2); break; }
    }
  }
  const candidatiArricchiti = cand.map((c) => arricchisciPozioni(state, board, pid, c));
  const ricarica = provaRicarica(state, pid);
  if (ricarica) candidatiArricchiti.push(ricarica);
  return candidatiArricchiti;
}

// clone completo (non solo `built`/`giocatori` come in `legale()`): serve per simulare turni interi
// senza toccare la partita vera. `log` vuoto: la simulazione in avanti non lo usa, evita di copiarlo.
function clonaStato(state) {
  return {
    attive: state.attive,
    regole: state.regole, // read-only nel rollout: condiviso per riferimento va bene
    nodiExtra: state.nodiExtra ? new Set(state.nodiExtra) : undefined,
    giocatori: state.giocatori.map((g) => ({ ...g, droghe: [...g.droghe], carte: [...g.carte], azioni: { ...g.azioni },
      pozioni: Object.fromEntries(Object.entries(g.pozioni).map(([k, v]) => [k, { ...v, need: v.need }])) })),
    built: new Map(state.built),
    festival: { pila: [...state.festival.pila], mercato: [...state.festival.mercato] },
    turno: state.turno,
    log: [],
  };
}

// ricarica greedy: se una pozione è scarica e abbiamo risorse che combaciano col suo need, ricarica.
// Euristica minima: solo quando cariche === 0 (urgente), per non sprecare risorse su una parziale.
function provaRicarica(state, pid) {
  const g = state.giocatori.find((p) => p.id === pid);
  for (const [tipo, pz] of Object.entries(g.pozioni)) {
    if (pz.modoRicarica !== 'ricaricabile' || pz.cariche > 0) continue;
    const risorse = [];
    const drogheTmp = [...g.droghe];
    for (const [r, n] of Object.entries(pz.need)) {
      for (let i = 0; i < n && risorse.length < pz.caricheMax; i++) {
        const idx = drogheTmp.indexOf(r);
        if (idx >= 0) { risorse.push(r); drogheTmp.splice(idx, 1); }
      }
    }
    if (risorse.length > 0) return { tipo: 'ricarica', pozioneType: tipo, risorse };
  }
  return null;
}

const valuta = (state, pid) => {
  const g = state.giocatori.find((p) => p.id === pid), altri = state.giocatori.filter((p) => p.id !== pid);
  const mediaAltri = altri.reduce((s, p) => s + p.punti, 0) / altri.length;
  return g.punti - mediaAltri; // differenziale vs media degli altri: con 2p coincide con l'originale (1 solo avversario)
};

// simula `depth` turni in avanti in self-play greedy (entrambi i giocatori, incluso l'avversario)
function simulaAvanti(state, board, rand, persByPid, depth) {
  let passi = 0;
  while (!finita(state) && passi < depth) {
    const p = diMano(state).id;
    const az = mossaGreedy(state, board, p, rand, persByPid[p]);
    if (!az) break;
    gioca(state, board, az);
    passi++;
  }
  return state;
}

function mossaRollout(state, board, pid, rand, pers, persByPid, depth, rollouts) {
  const candidati = mossaCandidati(state, board, pid, rand, pers);
  if (candidati.length <= 1) return candidati[0] || null;
  let best = candidati[0], bestScore = -Infinity;
  for (const c of candidati) {
    let tot = 0;
    for (let r = 0; r < rollouts; r++) {
      const s2 = clonaStato(state);
      gioca(s2, board, c);
      tot += valuta(simulaAvanti(s2, board, rand, persByPid, depth), pid);
    }
    const score = tot / rollouts;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Festival Collaborativo (opzionale): ogni altro giocatore (in ordine di turno a partire dal
// prossimo dopo chi consegna) ha UN'occasione di contribuire UNA risorsa. Con 2 giocatori si
// riduce al caso originale (un solo avversario). Decisione greedy minima: contribuisce solo se ha
// una copia "di scorta" della risorsa (che gli avanza rispetto al bisogno della sua carta target),
// mai una che gli serve. Se ne ha più di una scorta possibile, sceglie a caso fra quelle (pari
// merito, stesso principio di pickTied).
function vuoleContribuire(g, mkt, iconeDisponibili, rand) {
  if (!mkt.length) return null;
  const target = pickTied(mkt, (c) => -mancanti(g.droghe, c.need) * 1000 + c.punti, rand);
  const scorta = [...new Set(iconeDisponibili)].filter((r) => conta(g.droghe, r) > (target.need[r] || 0));
  return scorta.length ? scorta[Math.floor(rand() * scorta.length)] : null;
}

// una fase per consegna: OGNI altro giocatore, in ordine di turno a partire dal prossimo dopo chi
// consegna, ha UN'occasione di contribuire UNA risorsa (Regola 2/3). Con 2 giocatori "quanti
// partecipano" è per forza 0 o 1 (un solo avversario possibile). festivalStats.aperti conta le
// fasi, .contributi quanti contributi totali sono avvenuti (0..N-1 per fase), .perGiocatore chi ha
// effettivamente ricevuto il bonus.
function faseFestival(state, deliverer, carta, cfg, rand, turno) {
  state.festivalStats.aperti++;
  const liv = state.festivalStats.perLivello[carta.livello];
  liv.aperti++;
  const idx = state.giocatori.findIndex((g) => g.id === deliverer);
  const N = state.giocatori.length;
  const altri = Array.from({ length: N - 1 }, (_, i) => state.giocatori[(idx + 1 + i) % N]);
  for (const g of altri) {
    const scelta = vuoleContribuire(g, state.festival.mercato, festivalIcone(carta), rand);
    if (!scelta) continue;
    // Festival Pressure: la risorsa contribuita era davvero "libera" (spare rispetto alla SUA carta
    // target), ma potrebbe comunque servire a un'ALTRA carta del mercato che non abbiamo controllato —
    // qui misuriamo se contribuire riduce il numero di carte completabili, non solo per la carta target.
    const completabiliPrima = state.festival.mercato.filter((c) => completabile(g.droghe, c.need)).length;
    contribuisciFestival(state, g.id, scelta, cfg.ricompensaPV ?? 2);
    const completabiliDopo = state.festival.mercato.filter((c) => completabile(g.droghe, c.need)).length;
    state.festivalStats.contributi++;
    state.festivalStats.pvAssegnati += cfg.ricompensaPV ?? 2;
    state.festivalStats.perGiocatore[g.id] = (state.festivalStats.perGiocatore[g.id] || 0) + 1;
    liv.contributi++;
    if (completabiliDopo < completabiliPrima) state.festivalStats.pressioneRidotta++; else state.festivalStats.pressioneInvariata++;
    state.festivalStats.eventi.push({ turno, player: g.id }); // per l'analisi costo-opportunità (post-hoc, su state.log)
  }
}

// piazza gratis 1 esagono-seed legale (adiacente a un nodo, non sopra risorsa attiva) per `pid`,
// senza consumare un turno. Usa costruisci() vero (non un set diretto su state.built): così scatta
// anche la normale pesca-su-build, come un accampamento piazzato per davvero.
function seedGratis(state, board, pid, rand) {
  const nodi = shuffle([...board.hexes.values()].filter((h) => h.node === 'nodo'), rand);
  for (const node of nodi) {
    const nodeK = hk(node.q, node.r);
    const candidati = vicini(board, node.q, node.r).filter((v) => v.zone === node.zone && legale(state, board, pid, nodeK, hk(v.q, v.r)));
    if (candidati.length) {
      const scelto = candidati[Math.floor(rand() * candidati.length)];
      costruisci(state, board, pid, nodeK, hk(scelto.q, scelto.r));
      return true;
    }
  }
  return false;
}

// dona 1 unità di una risorsa attiva a caso a `pid`, prima che la partita inizi.
// scelta a caso, non informata dal mercato: testata anche la versione informata (stessa euristica
// di mossaGreedy) — differenza minima (50.9% vs 52.2% primo-tra-decisive) ma si è scelto di restare
// sulla versione più semplice.
export function risorsaGratis(state, pid, rand) {
  const attive = Object.values(state.attive);
  const scelta = attive[Math.floor(rand() * attive.length)];
  state.giocatori.find((g) => g.id === pid).droghe.push(scelta);
}

export function partita(board, carta, opts = {}) {
  // giocatori: lista id, default 2p. primoGiocatore: id di chi ha il primo turno (ruota l'ordine,
  // le label restano attaccate alla stessa personalità/IA a prescindere da chi parte per primo,
  // così si può isolare "vantaggio di chi muove per primo" da "vantaggio della label").
  const idsBase = opts.giocatori || ['P1', 'P2'];
  const start = opts.primoGiocatore && idsBase.includes(opts.primoGiocatore) ? idsBase.indexOf(opts.primoGiocatore) : 0;
  const ordine = idsBase.map((_, i) => idsBase[(start + i) % idsBase.length]);
  const N = ordine.length;
  const state = nuovaPartita(carta, ordine, opts);
  state.festivalStats = {
    aperti: 0, contributi: 0, pvAssegnati: 0, perGiocatore: Object.fromEntries(ordine.map((id) => [id, 0])), eventi: [],
    pressioneRidotta: 0, pressioneInvariata: 0,
    perLivello: { 1: { aperti: 0, contributi: 0 }, 2: { aperti: 0, contributi: 0 }, 3: { aperti: 0, contributi: 0 } },
  };
  const rand = opts.rand || rng((opts.seed ?? 1) + 1e6); // stream separato da quello del mercato
  // personalità/IA per giocatore: opts.pers/opts.ai (map id->valore, tutti gli N) oppure, per
  // retrocompatibilità 2p, opts.persP1/persP2/aiP1/aiP2.
  const persByPid = Object.fromEntries(ordine.map((id) =>
    [id, opts.pers?.[id] || (id === 'P1' && opts.persP1) || (id === 'P2' && opts.persP2) || PERSONALITA.bilanciato]));
  const aiByPid = Object.fromEntries(ordine.map((id) =>
    [id, opts.ai?.[id] || (id === 'P1' && opts.aiP1) || (id === 'P2' && opts.aiP2) || { modo: 'greedy' }]));
  const MAX = opts.maxTurni ?? 5000;

  // varianti di setup per gli esperimenti sul first-player-advantage — ordine[1..N-1] = chi NON
  // muove per primo, a prescindere dalla label. Applicate PRIMA del primo turno, non consumano
  // azioni. risorsaGratisSecondo (nome storico, resta per compat) compensa TUTTI tranne il primo:
  // con 2p è "il secondo"; con 3-4p ognuno degli altri riceve la stessa risorsa gratis.
  if (opts.esagonoGratisSecondo) seedGratis(state, board, ordine[1], rand);
  if (opts.risorsaGratisSecondo) for (let i = 1; i < N; i++) risorsaGratis(state, ordine[i], rand);
  if (opts.catena1Entrambi) { seedGratis(state, board, ordine[0], rand); seedGratis(state, board, ordine[1], rand); }

  // ordine dei turni: 'alternato' (default, round-robin) oppure 'snake' (giro d'andata poi ritorno,
  // una volta sola all'inizio — compensa chi parte per ultimo — poi round-robin normale). Con 2
  // giocatori riproduce esattamente il vecchio pattern [0,1,1,0]. Sovrascrive state.turno PRIMA di
  // ogni mossa, ignorando l'auto-alternanza interna di gioca() (ri-sovrascritta al giro dopo).
  const turnoAt = (i) => {
    if (opts.turnOrder !== 'snake') return i % N;
    return i < 2 * N ? (i < N ? i : 2 * N - 1 - i) : i % N;
  };

  opts.onTurno?.(state, 0); // snapshot iniziale (prima di qualsiasi mossa) — serve a chi traccia il mercato dall'inizio
  // "consegne disponibili ignorate": non è un errore dell'IA (che sceglie sempre fra mosse legali,
  // mai un tentativo respinto), è una SCELTA — il giocatore aveva una carta completabile e ha
  // preferito espandersi/raccogliere. Misurato PRIMA della mossa reale, mai dentro il rollout
  // (che esplora futuri ipotetici, non la partita giocata).
  state.opportunitaStats = { disponibili: 0, colte: 0 };

  let turni = 0, idx = 0;
  while (!finita(state) && turni < MAX) {
    state.turno = turnoAt(idx);
    const pid = diMano(state).id;
    const pers = persByPid[pid];
    const ai = aiByPid[pid];
    const g0 = diMano(state);
    const completabili = state.festival.mercato.filter((c) => completabile(g0.droghe, c.need));
    const az = ai.modo === 'rollout'
      ? mossaRollout(state, board, pid, rand, pers, persByPid, ai.depth ?? 3, ai.rollouts ?? 8)
      : mossaGreedy(state, board, pid, rand, pers);
    if (completabili.length) {
      state.opportunitaStats.disponibili++;
      if (az && az.tipo === 'consegna') state.opportunitaStats.colte++;
    }
    if (!az) break; // stallo
    const res = gioca(state, board, az);
    // turni+1: coincide con lo `n` che gioca() ha appena scritto in state.log per QUESTA azione
    if (az.tipo === 'consegna' && opts.festivalCollab?.abilitato) faseFestival(state, pid, res, opts.festivalCollab, rand, turni + 1);
    turni++; idx++;
    opts.onTurno?.(state, turni); // snapshot per esperimenti a timeline (es. quando nasce il vantaggio)
  }
  const fin = finita(state);
  if (fin) applicaBonusRisorse(state); // fine partita "vera" (mercato/accampamenti esauriti), non uno stallo
  return { state, turni, finita: fin };
}

// --- run (Node) ---
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const { loadBoard, loadFestival } = await import('./io.js');
  const carta = { rosa: 'girasole', arancio: 'tartaruga', verde: 'fungo_marrone', giallo: 'cactus' };
  const { state, turni, finita: fin } = partita(loadBoard(), carta, { seed: 7, cfg: loadFestival() });
  if (!fin) throw new Error('REGRESSIONE: la partita non finisce (stallo economia)');
  console.log(`partita: ${turni} turni, finita=${fin}, carte residue mercato=${state.festival.mercato.length}, pila=${state.festival.pila.length}`);
  for (const g of state.giocatori) {
    const perLiv = [1, 2, 3].map((L) => g.carte.filter((c) => c.livello === L).length);
    console.log(`  ${g.id}: ${g.punti} PV | carte L1/L2/L3 = ${perLiv.join('/')} | droghe carico = ${g.droghe.length}`);
  }
  const w = vincitore(state);
  console.log(`  vincitore: ${w ? w.id : 'pareggio'}`);
}
