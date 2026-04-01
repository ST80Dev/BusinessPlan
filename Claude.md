## Istruzioni di lavoro

### Prassi Git e GitHub

- Lavora sempre su un **branch dedicato** (mai direttamente su main)
- Al termine delle modifiche: **commit → push → Pull Request verso main**
- Il merge su main viene fatto manualmente dal proprietario dopo review
- Non fare mai merge autonomamente su main
- Ogni PR deve includere: titolo chiaro, sommario delle modifiche, test plan

### Progetto

- Applicazione web pura (HTML + CSS + JS vanilla, nessun framework, nessun build step)
- Si apre direttamente con `index.html` in Chrome/Edge
- I file JS sono modulari: `schema.js`, `engine.js`, `projects.js`, `ui.js`
- Tutti i colori tramite variabili CSS in `:root` — mai valori hardcoded inline
- Font: DM Sans (testo), JetBrains Mono (numeri, min 14px)
- Prima di ogni commit verificare che `index.html` si apra senza errori in console
