# Studio AnaBil — Guida operativa per lo sviluppo

File di riferimento per Claude Code e per chi sviluppa il tool.

**Studio AnaBil** è una suite multi-modulo di analisi economico-finanziarie. Da una home comune l'operatore sceglie il modulo da usare; ogni modulo ha proprio formato di progetto, propria interfaccia, proprie sezioni di sidebar.

**Moduli attualmente integrati:**
- **BP** — "Business Plan" (proiezioni pluriennali, motore mensile, prospetti previsionali)
- **AB** — "Analisi Costi & Budget" (CE storico Excel, medie %, budget annuale, break-even, consuntivo)

L'architettura è predisposta per accogliere nuovi moduli sotto `js/modules/<nome>/` senza interferire con quelli esistenti. La sigla nel codice è `ab` (sidebar/route) e `data-modulo="ab"` (filtro voci sidebar).

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
- **Regola di sessione (auto-rilevamento merge):** quando nella stessa sessione il proprietario comunica che una PR è stata mergiata, oppure il merge viene rilevato con
  `git fetch origin main && git merge-base --is-ancestor <branch-corrente> origin/main`
  (exit code 0 ⇒ branch già in main), procedere così senza chiedere autorizzazione esplicita di volta in volta: `git checkout main` → `git pull origin main` → `git checkout -b <nuovo-branch>` per le modifiche successive. L'autorizzazione a creare nuovi branch nello stesso flusso è implicita una volta confermato il merge della PR precedente. Eventuali vincoli di harness/sessione (es. branch designato all'avvio) si considerano superati dal merge confermato.
- Il merge su main viene fatto manualmente dal proprietario dopo review
- Non fare mai merge autonomamente su main
- Ogni PR deve includere: titolo chiaro, sommario delle modifiche, test plan
- Prima di ogni commit: aprire `index.html` in Chrome e verificare assenza di errori in console

---

## 2. Panoramica del progetto

Applicazione web per uso interno dello studio. Raggruppa più moduli di analisi accessibili da una home comune: oggi BP (Business Plan, proiezioni pluriennali) e AB (Analisi Costi & Budget). L'architettura predispone l'aggiunta di nuovi rami di analisi.

**Distribuzione:** cartella condivisa su server Windows dello studio. I client aprono `index.html` dal browser (Chrome/Edge) in rete locale. Nessun server, nessun build step, nessuna installazione.

**Persistenza:** i progetti sono file JSON scaricati localmente dall'operatore. Ogni modulo ha il proprio formato di progetto.

Per la semantica del motore BP (regole di calcolo, scadenze fiscali, schema ricavi/costi, ecc.) vedi `caratteristiche_funzionali_fiscali.txt`.

---

## 3. Architettura e stack

| Componente | Tecnologia |
|---|---|
| Linguaggio | JavaScript ES6+ puro — nessun framework |
| Interfaccia | HTML5 + CSS3, `index.html` unico entry point |
| Motore BP | `js/modules/bp/engine.js` — indipendente da UI |
| Motore AB | `js/modules/ab/engine.js` — indipendente da UI |
| Grafici | `lib/chart.umd.js` (Chart.js UMD offline) |
| PDF parsing | `lib/pdf.min.mjs` + `lib/pdf.worker.min.mjs` (PDF.js offline) |
| XLSX parsing | `lib/xlsx-mini.js` (lettore xlsx vanilla, zero dipendenze) |
| Persistenza | File JSON scaricabili — nessun backend |
| Export | `window.print()` con CSS `@media print` |

Nessuna dipendenza remota a runtime: le librerie sono in `lib/` per funzionare anche offline.

---

## 4. Struttura cartelle

```
StudioAnaBil/
  index.html              # entry point — shell + landing comune
  pdf-test.html           # pagina test estrazione PDF → schema BP
  css/
    main.css              # tutti gli stili (variabili in :root)
  js/
    core/                 # shell e infrastruttura comune
      projects.js         # save/load JSON, lista recenti, multi-modulo
      ui.js               # init, navigate, home, sidebar, modali
                          #  (per ora include anche le viste BP — split rinviato)
    modules/
      bp/                 # Business Plan
        engine.js         # motore mensile pluriennale
        schema.js         # schema normativo SP/CE (art. 2424/2425 c.c.)
        pdf-import.js     # parser PDF bilancio → schema interno
      ab/                 # Analisi Costi & Budget
        engine.js         # motore incidenze % e budget anno
        ui.js             # rendering sezioni AB (Importa, Mappatura, Storico, Budget, Consuntivo)
        excel-import.js   # parser bilancio di verifica Excel
  lib/                    # librerie vendored (offline)
    chart.umd.js          # Chart.js UMD
    pdf.min.mjs           # PDF.js
    pdf.worker.min.mjs    # PDF.js worker
    xlsx-mini.js          # lettore xlsx minimale
  data/
    bp/
      regole-import-conti.json  # dizionario mapping PDF → schema BP
  samples/
    ab/                   # bilanci di verifica xlsx di esempio per AB
  README.md               # guida utente
  CLAUDE.md               # questa guida
  caratteristiche_funzionali_fiscali.txt  # specifiche normative/contabili (BP)
```

**Disaccoppiamento moduli:**
- `js/modules/bp/schema.js` e `js/modules/bp/engine.js` non dipendono da UI
- `js/modules/ab/engine.js` non dipende da UI
- `js/modules/ab/ui.js` usa helper di `js/core/ui.js` (formattazione, notifiche) ma solo a runtime
- `js/core/projects.js` gestisce entrambi i formati progetto (BP e AB) tramite `meta.modulo`

**Aggiungere un nuovo modulo:** creare `js/modules/<nome>/`, esporre globali (`Engine<Nome>`, eventuale `<Nome>UI`), aggiungere voci sidebar con `data-modulo="<nome>"` in `index.html`, aggiungere card e modale in `js/core/ui.js`, aggiungere un caso nel router `navigate()`. Niente refactor obbligatori sugli altri moduli.

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

Se `scenario = costituenda`, i mesi prima di `meseAvvio` hanno headcount=0, ricavi=0, costi=0. Il SP di avvio è il saldo di apertura del primo mese (bp/engine.js:95-98, 127).

### 6.5 Voci chiave nel codice

- `bp/engine.js:174+ calcolaProiezioni()` — entry point motore
- `bp/engine.js:83+ calcolaPersonaleAnno()` — personale (rilevante IRAP)
- `bp/engine.js:236-247` e `615-769` — smobilizzo crediti/debiti storici
- `bp/engine.js:390-432` — piano ammortamento francese / pro-rata investimenti
- `bp/engine.js:504-506` — basi IRES/IRAP distinte
- `bp/engine.js:474-491` — CDV e margine di contribuzione
- `bp/engine.js:510-562` — driver magazzino + warning insufficienza rimanenze
- `bp/engine.js:233-234`, `385-397` — IVA progressiva e credito IVA su Capex
- `core/ui.js:4332+` — tooltip engine-trace, formula registry per i prospetti

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

## 8. Stato roadmap (aggiornato al 2026-04-28)

Basato su ricognizione del codice, non solo sulla pianificazione originale.

### Modulo BP (Business Plan)

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
| 9 | Import bilancio PDF + dizionario regole | ✅ Fatto |
| 10 | Export PDF dedicato | 🟡 Parziale — stampa browser OK, pagina test `pdf-test.html`; manca `exportPDF()` |
| 11 | Import Excel/CSV con mappatura schema | 🔲 Non iniziato |

### Modulo AB (Analisi Costi & Budget)

| Fase | Contenuto | Stato |
|---|---|---|
| 1 | Import bilancio di verifica Excel + parser sottoconti | ✅ Fatto |
| 2 | Mappatura sottoconti → macroaree (drag & drop) | ✅ Fatto |
| 3 | Storico CE per macroarea + medie % sul fatturato | ✅ Fatto |
| 4 | Budget anno + fatturato di break-even | ✅ Fatto |
| 5 | Consuntivo & preconsuntivo (proiezione fine anno vs budget) | ✅ Fatto |

### Shell / Multi-modulo

| Fase | Contenuto | Stato |
|---|---|---|
| S1 | Home comune con scelta modulo, sidebar filtrata per modulo attivo | ✅ Fatto |
| S2 | Riorganizzazione cartelle in `js/core` + `js/modules/<nome>` | ✅ Fatto |
| S3 | Estrazione shell da `core/ui.js` (oggi shell + UI BP intrecciate) | 🔲 Da pianificare |

### Feature aggiunte oltre la roadmap originale

1. IRES/IRAP con basi distinte (bp/engine.js:504-506)
2. Margine di contribuzione + Costo del venduto con flag `costo_venduto` (bp/engine.js:474-491)
3. Driver magazzino: scostamento % ricavi + tasso utilizzo acquisti, con warning (bp/engine.js:510-562)
4. Operazioni soci puntuali come eventi dedicati (bp/engine.js:339-341)
5. Smobilizzo crediti/debiti storici con riconciliazione `voce_sp` (bp/engine.js:236-247, 615-769)
6. Pro-rata primo anno costituenda (bp/engine.js:95-98, 127)
7. Tooltip engine-trace su ogni cella dei prospetti (core/ui.js:4332+)
8. IVA progressiva con carry-forward e credito IVA investimenti (bp/engine.js:233-234, 385-397)
9. Rendiconto finanziario con aree dettagliate e imposte esplicite
10. Cruscotto riepilogativo KPI

### Prossimi passi candidati

- **BP — Export PDF dedicato**: libreria browser (es. jsPDF) o template `@media print` affinato con selezione dei prospetti da includere
- **BP — Import Excel/CSV**: UI di mappatura colonne → schema interno SP/CE
- **Shell — S3**: estrarre la shell (init, navigate, home, sidebar, modali) da `core/ui.js` in `core/shell.js`, lasciando in `modules/bp/ui.js` le sole viste BP. Lavoro grosso: rinviato finché non emergono attriti
- Eventuali affinamenti fiscali (imposte differite, ACE, Patent Box) se richiesti dal committente — attualmente esclusi per semplificazione

---

## 9. Note per lo sviluppo con Claude Code

- Ogni sessione parte leggendo i file esistenti prima di qualsiasi modifica
- Prima di modificare la semantica di un calcolo, consultare `caratteristiche_funzionali_fiscali.txt` — è il riferimento normativo/contabile. Se la modifica comporta un cambio di regola, aggiornare anche quel file nella stessa PR
- Modifiche a `main.css` non usano mai colori hardcoded fuori da variabili `:root`
- Moduli JS disaccoppiati: `bp/schema.js`, `bp/engine.js`, `ab/engine.js` non dipendono dalla UI
- `core/projects.js` gestisce entrambi i formati progetto (BP e AB) discriminando su `meta.modulo`
- Quando si introduce un nuovo modulo: vivere sotto `js/modules/<nome>/`, non aggiungere intrecci con BP/AB; aggiornare la sidebar (voci con `data-modulo="<nome>"`), `renderHome()`, `onProgettoAperto()` in `core/ui.js`
- Ogni funzione pubblica ha un commento JSDoc sintetico
- Prima di ogni commit: `index.html` si deve aprire senza errori in console
- Dimensioni moduli (apr 2026, post riorganizzazione):
  - Core: `core/ui.js` 5265, `core/projects.js` 1278
  - BP: `modules/bp/engine.js` 1831, `modules/bp/schema.js` 436, `modules/bp/pdf-import.js` 480
  - AB: `modules/ab/ui.js` 1467, `modules/ab/engine.js` 411, `modules/ab/excel-import.js` 409
  - CSS: `main.css` 2761
  - Lib locale: `lib/xlsx-mini.js` 273
  - Tenere sotto controllo la crescita di `core/ui.js` (oggi mescola shell + UI BP)
