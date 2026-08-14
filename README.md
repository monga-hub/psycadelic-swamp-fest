# Psycadelic Swamp Fest

Simulatore, editor mappe e gioco da browser per il gioco da tavolo *Psycadelic Swamp Fest*. Il regolamento è in [REGOLAMENTO.md](REGOLAMENTO.md), il diario di sviluppo/design in [DEVNOTES.md](DEVNOTES.md).

## Avvio

Nessuna build, nessuna dipendenza — è tutto HTML/JS statico con ES module. Serve solo un file server (ES module non funzionano da `file://`).

```bash
python3 -m http.server 5180
```

Poi apri **http://localhost:5180/index.html**.

## Cosa c'è dentro

- **`index.html`** — pagina principale: editor del mazzo/regole ("Festival Economy"), Simulatore batch (N partite AI vs AI con report statistico), pannello "▶ Gioca" (partita umana embeddata via iframe), report differenziale, esperimenti (E-007/E-008/E-009, matrice personalità).
- **`game.html`** — partita giocabile (umano vs AI, o AI vs AI a schermo). Apribile anche da solo, fuori da `index.html`: in quel caso usa un mazzo/regole di default invece di quelle configurate in "Festival Economy".
- **`engine.js`** — motore di gioco puro (nessuna UI): stato, mosse, regole sperimentali, pozioni.
- **`bot.js`** — AI (greedy e rollout), orchestratore `partita()` per il batch.
- **`editor.html`** / **`editor-3-4p.html`** / **`editor-4p.html`** — editor visuale delle mappe esagonali (2p/3p/4p). Le mappe modificate si salvano in `localStorage` e hanno priorità sui file `board*.json` su disco finché non le resetti.
- **`board.json`**, **`board-3-4p.json`**, **`board-4p.json`** — mappe di base per 2/3/4 giocatori.
- **`viewer.html`** — replay di una partita salvata (`replay.json`).
- **`batch-parallel.js`** — variante CLI del batch, per run grosse fuori dal browser (Node).

## Uso rapido

1. **Configura le regole** nel pannello "Festival Economy" (mazzo, pescate per numero di giocatori, festival collaborativo, lavoratore esclusivo, spostamento obbligatorio, bonus risorse finale, pozioni).
2. **Simulatore batch**: scegli N partite, numero giocatori, personalità/IA, premi "Simula" — report statistico completo (health check, KPI, distribuzione pozioni, heatmap nodi, ecc.).
3. **▶ Gioca**: partita reale, umano contro AI (o umano contro umano). Quando aperta da `index.html` eredita automaticamente le regole configurate in "Festival Economy" — Festival Collaborativo escluso di proposito (non ha ancora una UI di contribuzione dedicata).

## Note

Progetto sperimentale/di design in corso — molte regole (pozioni, spostamento obbligatorio, capienza nodo, bonus risorse, ecc.) sono marcate "sperimentali" e pensate per essere testate e scartate/adottate via il Simulatore batch, non per essere già definitive.
