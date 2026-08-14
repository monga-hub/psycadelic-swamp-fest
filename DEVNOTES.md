# Psycadelic Swamp Fest — Developer Notes

Diario di sviluppo e motivazioni di design dietro le regole in `REGOLAMENTO.md`. Non è materiale per i giocatori — è il log delle decisioni prese col simulatore (`bot.js` / `index.html`).

---

## Mercato "Tutto mescolato" (§2 del regolamento)

Ipotesi iniziale: l'alto tasso di pareggi (39% su 300 partite bilanciato-vs-bilanciato) veniva dalla mappa o dal primo giocatore.

Falsificato entrambe. La causa vera: il mercato a mazzetti separati (L1→L2→L3) sincronizza artificialmente le due economie — entrambi i giocatori attraversano le stesse fasi (espansione→L1→L2→L3) nello stesso ordine, producendo punteggi finali quasi identici per costruzione.

Esperimento: stesso seed, stesso tutto, unica variabile il mercato.

| Mercato | Pareggi |
|---|--:|
| Sequenziale (L1→L2→L3) | 39% |
| Misto (1×L1+1×L2+1×L3 a rotazione) | 18% |
| Tutto mescolato | 12% |

Adottato "Tutto mescolato" come default.

---

## Festival Collaborativo (§5)

### Perché esiste
Prima della meccanica: consegna esclusiva, chi resta indietro non recupera più. Ipotesi: dare all'avversario un'occasione di guadagnare PV nello stesso momento riduce la polarizzazione senza compensazioni artificiali (niente risorsa extra al secondo giocatore, niente aggiustamento del turno).

### Validazione (batch da 100-300 partite, seed fissi)
- Pareggi: 39% (OFF) → 15% (+0 PV) → 3% (+1 PV) → 6% (+2 PV). Curva con optimum locale a +1, non monotona — controintuitivo, +2 non è "meglio di +1".
- Usata nel 60% dei festival aperti (con +1 PV) — non ignorata, non dominante.
- Contributi ricevuti quasi paritari tra i due giocatori (~5.3 vs 5.4 su 100 partite) — non premia chi apre il festival.
- **Festival Pressure**: solo l'1.8% dei contributi riduce le carte completabili nel mercato per chi contribuisce — il 98.2% sono "gratuiti" (la risorsa contribuita era davvero in eccesso rispetto a qualsiasi carta, non solo alla carta target). Il bot non sta sacrificando nulla nella stragrande maggioranza dei casi.
- Nessun costo-opportunità osservabile: turni fino alla prossima consegna dopo un contributo (media 4.0) sono MENO della baseline personale (8.6) — probabile effetto di selezione (si contribuisce quando si è già ricchi di risorse), non causale (nessun replay controfattuale costruito, rapporto costo/beneficio giudicato sfavorevole per ora).
- Collaborazione per livello: L1 0% (strutturale — carte L1 di default hanno 1 copia per risorsa, "solo doppioni" la esclude a priori), L2 35%, L3 49%.

### Stato: +2 PV di default, non ri-validato
Il punto di equilibrio migliore trovato nei test resta **+1 PV**. Il default è stato comunque portato a **+2** dopo quei test (decisione dell'utente), senza un nuovo batch di conferma a quel valore specifico. Se in futuro emergono comportamenti degeneri (runaway leader via festival, o il contrario — festival mai usato), il primo sospetto è questo valore.

### Rimandato deliberatamente
- Editor con opzioni radio complete (ordine partecipazione, chi può partecipare, tipo ricompensa parametrico pesca-carta/risorsa-casuale/reputazione) — oggi cablato ai default fissati.
- Costo/beneficio ottimale del contributo (varianti "2 risorse", "+1 moneta", "risorsa da base adiacente") — esplicitamente rimandato per non rompere un equilibrio appena trovato senza un problema concreto da risolvere.
- Replay controfattuale per misurare il vero costo-opportunità causale (non solo correlazionale) — costoso da costruire (snapshot/ripristino/biforcazione), risponde a una sola domanda, rapporto costo/beneficio sfavorevole oggi.
- Meccanica non implementata nel gioco interattivo (`game.html`) — esiste solo nel simulatore batch (`bot.js`).

---

## First Player Advantage

Confermato reale, non un bug del simulatore: isolato disaccoppiando la label (P1/P2, legata a personalità/IA) dal turno (chi muove per primo), tramite l'opzione "Alterna per partita". Con l'alternanza, lo scarto per LABEL sparisce (~29/33/38%) ma quello per TURNO resta (~38/24/38%, chi muove per primo vince ~57-66% a seconda della configurazione) — quindi è un vero vantaggio del turno, non un artefatto di come sono etichettati i giocatori.

- **Timeline del vantaggio (E-007)**: lo scarto PV tra primo e secondo giocatore NON cresce monotonicamente dall'apertura — oscilla vicino a zero fino al turno ~70, poi si allarga solo nel finale (dati con campione ridotto oltre turno 75).
- **Punto di non ritorno (E-008)**: mediana turno 67 (su partite di ~78 turni) — il sorpasso definitivo arriva tardi, non è uno snowball da apertura. Il gioco resta conteso fino quasi alla fine.
- Il Festival Collaborativo attenua ma non elimina il vantaggio (vedi sopra).

**Piste escluse esplicitamente** (falsificate, non ipotizzate):
- Seed fisso/bug RNG — verificato: seed diversi producono mercati e mosse iniziali diversi.
- Copertura risorse per nodo — analisi statica su `board.json`: tutti i 5 nodi hanno copertura IDENTICA (6 esagoni per risorsa, ciascuno dei 2 tipi per bioma). Nessuna asimmetria strutturale.
- Preferenza IA per nodi specifici — **non esiste**: `mossaCandidati()` in `bot.js` genera un solo candidato `costruisci` (shuffle + primo nodo valido trovato), mai un confronto tra nodi alternativi. La classifica "nodi più costruiti" (-3,-1 / 4,-1 / 2,-4 dominanti, -4,4 / 0,4 più bassi) è pura topologia: 3 zone hanno 1 solo nodo (100% del traffico della zona), il bioma giallo ne ha 2 che si dividono il traffico (somma per zona comparabile: giallo 1284 vs arancio 1097, verde 1070, rosa 1030 — su un batch di riferimento da 300 partite).
- Espansione nei biomi come leva strategica — con IA greedy bilanciata, ogni partita tocca 4.00/4 biomi, zero varianza. Non è oggi una decisione osservabile (potrebbe diventarlo con personalità più estreme o vincoli di risorse più stretti — non testato).

**Aperto**: perché il vantaggio del turno esiste e da dove nasce esattamente (quale risorsa/decisione differenziale) resta da capire — le piste ovvie (nodi, biomi, risorse) sono state escluse una per una.

---

## IA: Rollout vs Greedy

Rollout (Monte Carlo, self-play greedy in avanti, media su N simulazioni, stesso schema di Officina 1907) batte Greedy in modo netto quando confrontati direttamente (~60-65% win rate su batch da 100 partite, seed alternati). Cambia il ritmo di gioco, non solo la qualità delle mosse — turno medio prima pesca 36.6 (Greedy-vs-Greedy) contro numeri sensibilmente più bassi quando il Rollout è coinvolto.

Deciso: non serve altro investimento sul bot per ora — la proprietà cercata (IA che gioca "bene" senza serve tuning manuale) è raggiunta.

**Aperto, non testato**: perché il rollout pesca prima — è un cambio di strategia reale (accumula risorse prima di costruire) o un artefatto della funzione di valutazione (`valuta` = differenziale PV, molto grezza)? Ipotesi non verificata.

---

## Mazzo commesse

- Deck editor + "genera tutte le combinazioni" (`index.html`): per ogni livello, tutte le combinazioni con ripetizione delle 4 risorse attive. Bilanciato per costruzione (simmetria combinatoria) — verificato: 15/15/15/15 su L1 con 20 carte generate. Non ancora usato in nessun batch di validazione — è uno strumento pronto, non una decisione presa.
- Setup ridotto da "tutte le 18 carte" a "pesca 3 per livello, 9 totali" — cambio recente (non ancora validato con un batch dedicato: cambia la durata attesa della partita e potenzialmente la varianza tra partite, dato che il pool pescato cambia ogni volta).

---

## Nodi/mappa

Vedi "First Player Advantage" sopra — l'analisi di copertura risorse (identica su tutti i nodi) e la scoperta che l'IA non confronta mai i nodi tra loro chiudono la pista "i nodi dominanti nascono da una proprietà geometrica". Non ancora esplorato: costo di catena (lunghezza/forma necessaria per raggiungere gli esagoni-risorsa) come possibile spiegazione residua — ipotesi aperta, non testata.

---

## Strumenti disponibili nel simulatore (`index.html`)

- **Festival Economy**: editor mazzo (per carta: risorse richieste + PV), setup (pescate/livello, carte esposte, ordine mercato), Festival Collaborativo (on/off, ricompensa).
- **Simulatore batch**: N partite, personalità (bilanciato/builder/collector/closer), IA (greedy/rollout+parametri), primo giocatore (fisso/alterna).
- **Matrice personalità**: tutti i matchup tra le 4 personalità.
- **E-007 Timeline del vantaggio**, **E-008 Punto di non ritorno**, **E-009 Costo opportunità del contributo**: esperimenti mirati, ciascuno con domanda/ipotesi/metrica dichiarate in UI.
- Ogni report ha un blocco CONFIGURAZIONE con fingerprint (hash delle regole, non del seed) — due report con lo stesso hash sono la stessa configurazione, solo campione diverso.
