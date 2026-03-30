# Business Plan Tool

Applicazione per uso interno dello studio commerciale. Elabora dati di bilancio storici e produce prospetti contabili previsionali pluriennali (SP e CE civilistici art. 2424/2425 c.c.).

## Come avviare

Aprire `index.html` nel browser (Chrome o Edge). Non è richiesta nessuna installazione, nessun server, nessuna dipendenza esterna.

I progetti vengono salvati come file JSON scaricabili sul PC locale dell'utente.

## Struttura cartelle

```
business-plan-tool/
  index.html              # entry point
  css/
    main.css              # tutti gli stili
  js/
    schema.js             # struttura normativa SP art.2424 e CE art.2425
    engine.js             # motore di calcolo mensile
    ui.js                 # rendering, navigazione, eventi UI
    projects.js           # salva/carica/gestisce file JSON progetto
  data/
    template.json         # struttura conti di default vuota
  README.md
```

## Modalità di avvio progetto

| Scenario | SP storico | CE storico | Caso d'uso |
|---|---|---|---|
| SP + CE storici | Completo art.2424 | Completo art.2425 | Società esistente con bilanci disponibili |
| Solo SP storico | Completo art.2424 | Non inserito | CE costruito dai driver |
| Società costituenda | SP semplificato | Non applicabile | Nuova società senza storico |

## Roadmap

| Fase | Stato | Contenuto |
|---|---|---|
| 1 | ✅ In sviluppo | Shell, home, modale nuovo progetto, sezione dati di partenza |
| 2 | 🔲 Pianificata | Driver & Parametri — ricavi, profili stagionali, DSO/DPO/DIO |
| 3 | 🔲 Pianificata | Gestione eventi — mutui, investimenti, variazioni strutturali |
| 4 | 🔲 Pianificata | Motore mensile completo — SP, CE, rendiconto finanziario |
| 5 | 🔲 Pianificata | Prospetti futuri — affiancamento colonne, drill-down mensile |
| 6 | 🔲 Pianificata | Dashboard KPI — EBITDA, PFN, liquidità, indici |
| 7 | 🔲 Pianificata | Export PDF — CSS @media print ottimizzato |

## Note tecniche

- JavaScript puro ES6+ — nessun framework, nessun build step
- Tutti i colori in variabili CSS `:root` — nessun inline style
- Input numerici: `div[contenteditable]` — no elementi form nativi
- Font testo: DM Sans; font numeri: JetBrains Mono (min 14px)
- Sidebar: sfondo `#1B3A5C`
