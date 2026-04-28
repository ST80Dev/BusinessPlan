# Studio AnaBil

Suite di analisi economico-finanziarie per uso interno dello studio commerciale. Raggruppa più strumenti (moduli) accessibili da una home comune; ogni modulo ha proprio formato di progetto e propria interfaccia operativa.

Nessuna installazione, nessun server, nessuna connessione a Internet. Tutto gira nel browser aprendo `index.html`.

---

## Moduli disponibili

| Modulo | Sigla | A cosa serve |
|---|---|---|
| Business Plan | BP | Bilanci storici SP/CE → proiezioni pluriennali → SP, CE, Rendiconto Finanziario, Cruscotto KPI |
| Analisi Costi & Budget | AB | Import CE storico Excel → medie % sul fatturato → budget annuale, fatturato di break-even, monitoraggio consuntivo |

L'architettura è predisposta per accogliere nuovi moduli di analisi senza interferire con quelli esistenti.

---

## Come avviare

1. Copiare la cartella `StudioAnaBil/` sul server condiviso dello studio (o su un disco locale)
2. Aprire `index.html` con **Chrome** o **Edge**
3. Dalla home scegliere il modulo (Business Plan o Analisi Costi & Budget) e creare un nuovo progetto, oppure trascinare nella pagina un file `.json` di un progetto esistente

Nessuna installazione richiesta sui client. Le librerie grafiche e di parsing PDF sono incluse nella cartella `lib/` per il funzionamento offline.

---

## Modulo Business Plan — Modalità di avvio progetto

Alla creazione di un nuovo progetto si scelgono **scenario** e **granularità**.

### Scenario — cosa è disponibile come storico

| Scenario | SP storico | CE storico | Caso d'uso |
|---|---|---|---|
| SP + CE storici | Completo art. 2424 | Completo art. 2425 | Società esistente con bilanci disponibili |
| Solo SP storico | Completo art. 2424 | Non inserito | CE costruito interamente dai driver |
| Società costituenda | SP semplificato di avvio | Non applicabile | Nuova società senza storico, con mese di avvio configurabile |

### Granularità — quanto dettaglio si vuole inserire

| Modalità | Descrizione | Caso d'uso |
|---|---|---|
| Rapida | Inserimento per mastri e macro-aree aggregate | Prima stima veloce, dati parziali |
| Analitica | Inserimento per conti foglia completi art. 2424/2425 | Analisi dettagliata, bilanci completi |

La modalità è modificabile in qualsiasi momento: il motore di calcolo è identico, cambia solo il livello di dettaglio degli input e degli output.

---

## Modulo Business Plan — Flusso di lavoro tipico

1. **Dati di partenza** — inserire SP e CE storici (se disponibili) o lo SP semplificato della costituenda
2. **Driver & Parametri** — configurare ricavi per voce, profili di stagionalità, DSO/DPO/DIO, aliquote fiscali, driver magazzino
3. **Eventi** — registrare mutui, investimenti, variazioni strutturali di ricavi/costi, operazioni soci puntuali
4. **Prospetti futuri** — consultare SP, CE, Rendiconto Finanziario e Cruscotto affiancati per anno, con drill-down mensile
5. **Dashboard KPI** — grafici di trend (ricavi, marginalità, PFN, cassa, DSCR, DSO/DPO)
6. **Salvataggio** — scarica il file `.json` del progetto per archiviarlo sul disco o sulla cartella condivisa

---

## Modulo Analisi Costi & Budget — Flusso di lavoro tipico

1. **Importa CE** — caricare il bilancio di verifica Excel: il sistema estrae i sottoconti CE e li pre-mappa alle macroaree
2. **Mappatura sottoconti** — riassegnare i sottoconti alle macroaree corrette (drag & drop, multi-selezione)
3. **Storico & medie** — visualizzare gli importi per anno e la media % sul fatturato, base per la proiezione del budget
4. **Budget anno** — proiettare i costi sull'anno corrente partendo dal fatturato ipotizzato e dalle medie storiche, ottenere fatturato di break-even
5. **Consuntivo** — inserire il fatturato realizzato per periodo: il sistema proietta a fine anno e confronta col budget
6. **Salvataggio** — il progetto è un file `.json` separato dai progetti BP

---

## Modulo Business Plan — Anni previsionali e storico

- Anni previsionali: da **1 a 8** oltre l'anno base
- Possibilità di includere fino a **3 anni storici** precedenti all'anno base per trend e confronti
- I prospetti affiancano storico e previsionali in colonne; l'operatore decide quali anni mostrare

---

## Salvataggio e apertura progetti

- **Salva**: scarica un file JSON con tutti i dati del progetto (dati di partenza, driver, eventi, proiezioni calcolate)
- **Apri progetto**: trascina il file JSON nella pagina oppure usa il pulsante dedicato
- **Indicatore stato** nel footer: `Pronto` / `Modifiche non salvate` / `Salvato`
- Chiusura della scheda con modifiche non salvate: il browser chiede conferma

I progetti restano sul PC o sulla cartella condivisa dello studio: nessun dato viene trasmesso all'esterno.

---

## Export

- **Stampa / PDF**: da browser (`Ctrl+P`) con layout ottimizzato via CSS `@media print`. Funziona su tutti i prospetti e sul cruscotto.
- **JSON progetto**: per archivio e riapertura successiva

---

## Requisiti

- Browser **Chrome** o **Edge** aggiornati (versioni recenti supportano tutte le API richieste)
- Nessun altro software richiesto

---

## Documenti tecnici

Per chi sviluppa o manutiene il tool:
- `CLAUDE.md` — guida operativa per lo sviluppo (architettura, modello dati, roadmap, prassi Git)
- `caratteristiche_funzionali_fiscali.txt` — specifiche funzionali e normative (semantica di calcolo, scadenze fiscali, controlli)
