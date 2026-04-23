# Business Plan Tool — Guida operativa per lo sviluppo

File di riferimento per Claude Code e per chi sviluppa il tool.

**Documenti correlati:**
- `README.md` — guida all'uso per l'operatore di studio
- `caratteristiche_funzionali_fiscali.txt` — cardini normativi e contabili (riferimento per la semantica di calcolo: ricavi, costi, mutui, ammortamenti, circolante, IRES/IRAP/IVA, PN, rendiconto, controlli). Da consultare e aggiornare quando cambia la logica funzionale o la normativa di riferimento

---

## 0. Gestione delle modifiche ampie (indicazione primaria)

Quando le modifiche previste sono ampie (riscrittura di file lunghi, più file modificati in sequenza, refactor trasversali), **spezzare il lavoro in piccoli passi** ed eseguirli uno alla volta, anche a costo di più tool call. Motivazione: i write/edit molto grandi possono incappare in `API Error: Stream idle timeout - partial response received`, che interrompe la risposta a metà e lascia il repository in uno stato parziale.

Regole pratiche:
- Preferire più `Edit` mirati a un `Write` integrale quando un file esiste già
- Riscrivere file lunghi per sezioni consecutive (es. un'intestazione + una sezione alla volta) invece che in un solo colpo
- Se un'operazione tocca più file indipendenti, procedere un file alla volta
- Segnalare all'utente l'avanzamento tra un passo e l'altro così che un'eventuale interruzione sia recuperabile

---

## 1. Prassi Git e GitHub

- Puoi scrivere piani nei file dedicati senza chiedere il permesso a ogni sessione
- Lavora sempre su un **branch dedicato** (mai direttamente su main)
- Al termine delle modifiche: **commit → push → Pull Request verso main**
- **Una PR per gruppo di modifiche**:
  1. Crea branch → fai le modifiche → commit → push → crea PR verso main
  2. Dopo la PR, **non pushare altri commit sullo stesso branch**
  3. Se servono ulteriori modifiche dopo il merge, crea un **nuovo branch** da `origin/main`
  4. Non riutilizzare mai un branch di una PR già mergiata
- Il merge su main viene fatto manualmente dal proprietario dopo review
- Non fare mai merge autonomamente su main
- Ogni PR deve includere: titolo chiaro, sommario delle modifiche, test plan
- Prima di ogni commit: aprire `index.html` in Chrome e verificare assenza di errori in console

---

## 2. Panoramica del progetto

Applicazione web per uso interno dello studio. Elabora bilanci storici (SP art. 2424, CE art. 2425 c.c.) e produce prospetti previsionali pluriennali (fino a 8 anni) con proiezioni SP, CE, rendiconto finanziario, cruscotto KPI.

**Distribuzione:** cartella condivisa su server Windows dello studio. I client aprono `index.html` dal browser (Chrome/Edge) in rete locale. Nessun server, nessun build step, nessuna installazione.

**Persistenza:** i progetti sono file JSON scaricati localmente dall'operatore.

Per la semantica del motore (regole di calcolo, scadenze fiscali, schema ricavi/costi, ecc.) vedi `caratteristiche_funzionali_fiscali.txt`.

---

## 3. Architettura e stack

| Componente | Tecnologia |
|---|---|
| Linguaggio | JavaScript ES6+ puro — nessun framework |
| Interfaccia | HTML5 + CSS3, `index.html` unico entry point |
| Motore di calcolo | `js/engine.js` — modulo indipendente da `ui.js` |
| Grafici | `lib/chart.umd.js` (Chart.js UMD offline) |
| PDF parsing (test) | `lib/pdf.min.mjs` + `lib/pdf.worker.min.mjs` (PDF.js offline) |
| Persistenza | File JSON scaricabili — nessun backend |
| Export | `window.print()` con CSS `@media print` |

Nessuna dipendenza remota a runtime: le librerie sono in `lib/` per funzionare anche offline.

---

## 4. Struttura cartelle

```
business-plan-tool/
  index.html              # entry point
  pdf-test.html           # pagina test estrazione PDF → schema interno
  css/
    main.css              # tutti gli stili (1378 LoC)
  js/
    schema.js             # schema normativo SP/CE (436 LoC)
    engine.js             # motore mensile (1831 LoC)
    ui.js                 # rendering e navigazione (4818 LoC)
    projects.js           # save/load JSON (1023 LoC)
  lib/
    chart.umd.js
    pdf.min.mjs
    pdf.worker.min.mjs
  README.md               # guida utente
  CLAUDE.md               # questa guida
  caratteristiche_funzionali_fiscali.txt  # specifiche normative/contabili
```

I moduli JS sono disaccoppiati: `schema.js` non dipende da `ui.js`, `engine.js` non dipende da `ui.js`.

---

## 5. Modello dati

### 5.1 Schema SP/CE — struttura fissa + conti liberi

- **Mastri** (fissi, non modificabili): es. `B. Immobilizzazioni`, `A. Valore della produzione`
- **Sottomastri** (predefiniti, rinominabili, aggiungibili)
- **Conti foglia** creati liberamente dall'utente per ogni progetto
- Tutti i mastri e sottomastri sono sempre visibili anche se vuoti, per guidare l'inserimento

### 5.2 File di progetto JSON

```json
{
  "meta": {
    "cliente": "Rossi Srl",
    "anno_base": 2024,
    "anni_previsione": [2025, 2026, 2027],
    "scenario": "sp_ce",               // sp_ce | sp_only | costituenda
    "modalita_inserimento": "rapida",  // rapida | analitica
    "creato": "2025-03-15",
    "modificato": "2025-03-28",
    "stato": "in_lavorazione"
  },
  "storico": { "2024": { "sp": {...}, "ce": {...} } },
  "eventi": [
    { "tipo": "mutuo", ... },
    { "tipo": "investimento", ... },
    { "tipo": "variazione_ricavi", ... },
    { "tipo": "operazione_soci", ... }
  ],
  "driver": {
    "ricavi": [ { "voce": "Vendite prodotti", "base": 520000, ... } ],
    "costi": { ... },
    "circolante": { "dso": 60, "dpo": 45, "dio": 30 },
    "magazzino": { "scostamento_mp_pct": 0, ... },
    "fiscale": { "aliquota_ires": 0.24, "aliquota_irap": 0.039 },
    "smobilizzo": [ ... ]
  },
  "proiezioni": {
    "mensili": { "2025": [ {...}, ... ] },
    "annuali": { "2025": { "sp": {...}, "ce": {...}, "cf": {...} } }
  }
}
```

### 5.3 Regole di persistenza

- Salvataggio manuale via pulsante "Salva" → scarica JSON
- Caricamento via drag & drop o pulsante "Apri progetto"
- Indicatore stato nel footer: `Pronto` / `Modifiche non salvate` / `Salvato`
- `beforeunload` attivo se ci sono modifiche non salvate
- Decimali preservati negli importi SP/CE iniziali
- ID driver stabili per evitare collisioni al caricamento

---

## 6. Motore di calcolo (visione implementativa)

Per la specifica semantica/normativa dei singoli calcoli vedi `caratteristiche_funzionali_fiscali.txt`. Qui solo ciò che serve per orientarsi nel codice.

### 6.1 Granularità

Il motore lavora **a mese** (12 × N anni) e aggrega a anno per i prospetti. Il dettaglio mensile rimane consultabile via drill-down e viene usato anche per alimentare le voci SP di fine periodo.

### 6.2 Sequenza deterministica per ogni mese

1. Ricavi (base × stagionale × variazioni)
2. Costi operativi (driver % su ricavi o fissi rivalutati)
3. Oneri finanziari (somma mutui attivi)
4. Ammortamenti (pro-rata investimenti)
5. Imposte (basi IRES e IRAP distinte)
6. Utile netto
7. Circolante (crediti/debiti/magazzino da DSO/DPO/DIO)
8. Immobilizzazioni (saldo + Capex − amm.)
9. Patrimonio netto (saldo + utile − dividendi, a fine anno)
10. PFN (variabile di chiusura — garantisce quadratura SP)
11. Cassa (saldo + flusso operativo + eventi finanziari)

### 6.3 Circolarità oneri finanziari / PFN

Iterazione convergente: stima iniziale con oneri anno precedente, ricalcolo fino a Δ < 0,01%.

### 6.4 Pro-rata primo anno "Costituenda"

Se `scenario = costituenda`, i mesi prima di `meseAvvio` hanno headcount=0, ricavi=0, costi=0. Il SP di avvio è il saldo di apertura del primo mese (engine.js:95-98, 127).

### 6.5 Voci chiave nel codice

- `engine.js:174+ calcolaProiezioni()` — entry point motore
- `engine.js:83+ calcolaPersonaleAnno()` — personale (rilevante IRAP)
- `engine.js:236-247` e `615-769` — smobilizzo crediti/debiti storici
- `engine.js:390-432` — piano ammortamento francese / pro-rata investimenti
- `engine.js:504-506` — basi IRES/IRAP distinte
- `engine.js:474-491` — CDV e margine di contribuzione
- `engine.js:510-562` — driver magazzino + warning insufficienza rimanenze
- `engine.js:233-234`, `385-397` — IVA progressiva e credito IVA su Capex
- `ui.js:4332+` — tooltip engine-trace, formula registry per i prospetti

---

## 7. Regole UI critiche

- **Nessun elemento form nativo** per input e pulsanti: usare `div[contenteditable]` per importi e `div[onclick]` per pulsanti. `input`/`button` nativi vengono sovrascritti dal renderer con sfondi scuri illeggibili
- **Nessun inline style per colori**: tutti i colori in classi CSS, definiti come variabili in `:root` in `main.css`
- **Palette**: sfondo bianco/grigio chiaro/azzurro chiarissimo. Testo sempre scuro su sfondo chiaro. Mai testo chiaro su chiaro
- **Font testo**: DM Sans (Google Fonts)
- **Font numeri**: JetBrains Mono (Google Fonts), minimo 14px
- **Sidebar**: sfondo `#1B3A5C`, testo bianco/semitrasparente, voce attiva `rgba(55,138,221,0.22)`
- **Auto-select** del contenuto al focus su campi editabili
- **Blur forzato** del campo attivo prima della navigazione (evita valori stale nei prospetti)
- Header **sticky** nei prospetti, intestazioni sezione evidenti nel cruscotto

### Sezioni di navigazione (sidebar)

| Sezione | Funzione |
|---|---|
| Dati di partenza | SP e CE storici — tab separati, mastri collassabili |
| Driver & Parametri | Ricavi per voce, stagionali, DSO/DPO/DIO, magazzino, fiscale |
| Eventi | Mutui, investimenti, variazioni strutturali, operazioni soci |
| Prospetti futuri | SP, CE, CF, Cruscotto — storico + previsionali affiancati |
| Dashboard KPI | 6 grafici Chart.js + KPI cards |

---

## 8. Stato roadmap (aggiornato al 2026-04-23)

Basato su ricognizione del codice, non solo sulla pianificazione originale.

| Fase | Contenuto | Stato |
|---|---|---|
| 1 | Shell app, sidebar, home, modale nuovo progetto | ✅ Fatto |
| 2 | Dati storici SP/CE, mastri collassabili, Rapida/Analitica | ✅ Fatto |
| 3 | Driver & Parametri: ricavi, stagionalità, DSO/DPO/DIO, fiscale | ✅ Fatto |
| 4 | Mutui (francese/italiano) + investimenti con pro-rata | ✅ Fatto |
| 5 | Variazioni strutturali ricavi/costi (run-rate) | ✅ Fatto |
| 6 | Motore mensile completo — SP, CE, rendiconto | ✅ Fatto |
| 7 | Prospetti futuri affiancati + drill-down | ✅ Fatto |
| 8 | Dashboard KPI (6 grafici Chart.js, KPI cards) | ✅ Fatto |
| 9 | Export PDF | 🟡 Parziale — stampa browser OK, pagina test `pdf-test.html`; manca `exportPDF()` dedicato |
| 10 | Import Excel/CSV con mappatura schema | 🔲 Non iniziato |

### Feature aggiunte oltre la roadmap originale

1. IRES/IRAP con basi distinte (engine.js:504-506)
2. Margine di contribuzione + Costo del venduto con flag `costo_venduto` (engine.js:474-491)
3. Driver magazzino: scostamento % ricavi + tasso utilizzo acquisti, con warning (engine.js:510-562)
4. Operazioni soci puntuali come eventi dedicati (engine.js:339-341)
5. Smobilizzo crediti/debiti storici con riconciliazione `voce_sp` (engine.js:236-247, 615-769)
6. Pro-rata primo anno costituenda (engine.js:95-98, 127)
7. Tooltip engine-trace su ogni cella dei prospetti (ui.js:4332+)
8. IVA progressiva con carry-forward e credito IVA investimenti (engine.js:233-234, 385-397)
9. Rendiconto finanziario con aree dettagliate e imposte esplicite
10. Cruscotto riepilogativo KPI

### Prossimi passi candidati

- **Fase 9 completa — Export PDF** dedicato: libreria browser (es. jsPDF) o template `@media print` affinato con selezione dei prospetti da includere
- **Fase 10 — Import Excel/CSV**: UI di mappatura colonne → schema interno SP/CE
- Eventuali affinamenti fiscali (imposte differite, ACE, Patent Box) se richiesti dal committente — attualmente esclusi per semplificazione

---

## 9. Note per lo sviluppo con Claude Code

- Ogni sessione parte leggendo i file esistenti prima di qualsiasi modifica
- Prima di modificare la semantica di un calcolo, consultare `caratteristiche_funzionali_fiscali.txt` — è il riferimento normativo/contabile. Se la modifica comporta un cambio di regola, aggiornare anche quel file nella stessa PR
- Modifiche a `main.css` non usano mai colori hardcoded fuori da variabili `:root`
- Moduli JS disaccoppiati: `schema.js` e `engine.js` non dipendono da `ui.js`
- Ogni funzione pubblica ha un commento JSDoc sintetico
- Prima di ogni commit: `index.html` si deve aprire senza errori in console
- Dimensioni moduli di riferimento (apr 2026): engine 1831, ui 4818, schema 436, projects 1023, css 1378 LoC — tenere sotto controllo la crescita di `ui.js`
