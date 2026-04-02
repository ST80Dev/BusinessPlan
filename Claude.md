## Istruzioni di lavoro

### Prassi Git e GitHub

- Puoi scrivere piani nei file dedicati senza chiedere il permesso a ogni sessione
- Lavora sempre su un **branch dedicato** (mai direttamente su main)
- Al termine delle modifiche: **commit → push → Pull Request verso main**
- **IMPORTANTE — una PR per gruppo di modifiche**:
  1. Crea branch → fai le modifiche → commit → push → crea PR verso main
  2. Dopo la PR, **NON pushare altri commit sullo stesso branch**
  3. Se servono ulteriori modifiche dopo che l'utente ha mergiato, crea un **nuovo branch** da origin/main
  4. Non riutilizzare mai un branch di una PR già mergiata
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
