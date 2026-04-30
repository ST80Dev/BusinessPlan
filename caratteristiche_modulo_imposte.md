# Modulo "Imposte" — Specifica funzionale

Riferimento di sviluppo per il modulo di calcolo delle imposte d'esercizio di società di capitali (SRL/SpA "ordinarie", non finanziarie, non agricole, non in regimi speciali). Il modulo è parte della suite **Studio AnaBil** ed è disaccoppiato dagli altri (BP, AB).

- **Sigla modulo**: `imposte`
- **Cartella codice**: `js/modules/imposte/`
- **Filtro sidebar**: `data-modulo="imposte"`
- **Cartella sample**: `samples/imposte/`
- **Anno d'imposta di riferimento**: 2025 (versamenti nel 2026)
- **Origine specifica**: foglio Excel `samples/imposte/2026 calcolo imposte srl 2025.xlsx` + fonti ufficiali italiane

Per la coerenza con il resto della suite, valgono in via diretta le convenzioni di `CLAUDE.md` (UI senza form nativi, JSON come persistenza, nessun build step, librerie in `lib/` per offline).

---

## 1. Scopo e ambito

Il modulo determina, per un singolo periodo d'imposta di una SRL "ordinaria":

1. **IRES** (lorda, netta, dovuta, saldo, acconti) e relative variazioni in aumento/diminuzione al risultato civilistico
2. **IRAP** (base imponibile, deduzioni cuneo, imposta, saldo, acconti) con aliquota regionale
3. **Imposta sostitutiva CPB** se attivo Concordato Preventivo Biennale
4. **Deduzione IRAP dall'IRES** (analitica + forfetaria 10%)
5. **Calendario F24** (saldo + I acconto al 30/06 o 30/07 con maggiorazione 0,40%; II acconto al 30/11)
6. **Scritture contabili** di chiusura imposte
7. **Persistenza storico pluriennale** delle voci con riporto rateale (plusvalenze art. 86, manutenzioni eccedenti 5%, perdite fiscali, ROL/interessi passivi, ACE residua)

### Esclusioni MVP

Non gestiti nel rilascio iniziale:

- Mini-IRES premiale (L. 207/2024 art. 1 c. 436-444): aliquota 20% su quota utile accantonato con vincoli di investimenti 4.0/5.0 e nuova occupazione
- Società non operative / "di comodo" (art. 30 L. 724/1994): test ricavi minimi, IRES maggiorata 10,5%
- Società in perdita sistematica (art. 2 D.L. 138/2011)
- Addizionali IRES settoriali (banche, assicurazioni, energia)
- Regimi opzionali in entrata: consolidato fiscale (artt. 117-129 TUIR), trasparenza fiscale (art. 115-116 TUIR), tonnage tax
- Imposte differite/anticipate (gestite come voce manuale, non calcolate)
- ACE corrente (l'agevolazione è abrogata dal 2024 ex art. 5 D.Lgs. 216/2023): si gestisce solo l'**eccedenza ACE residua** generata in esercizi precedenti
- Crediti d'imposta automatici (4.0, R&S, ZES, ecc.): gestiti come righe di input parametriche, non calcolati
- ISA: solo flag di soggettività e punteggio, nessun calcolo del punteggio

### Roadmap futura (fuori MVP)

- **Consolidato fiscale di gruppo**: progetto-contenitore che aggrega N progetti `imposte` singoli (almeno N=3) e produce il calcolo consolidato secondo artt. 117-129 TUIR (somma imponibili, compensazione perdite, rettifiche di consolidamento)
- Mini-IRES premiale 2025
- Società di comodo / perdite sistematiche
- Crediti d'imposta tabellari con regole di utilizzo

---

## 2. Riferimenti normativi e fonti

Tutti i calcoli del modulo poggiano su norme di rango primario o istruzioni ufficiali. Le fonti vanno consultate in caso di modifica della logica.

### 2.1 IRES

- **DPR 22 dicembre 1986, n. 917 (TUIR)**, in particolare:
  - Art. 75 — soggetti passivi
  - Art. 77 — aliquota IRES (24%)
  - Art. 83 — determinazione del reddito d'impresa (utile/perdita di bilancio + variazioni)
  - Art. 84 — riporto perdite fiscali (limite 80%, perdite primi 3 esercizi 100%)
  - Art. 86 — plusvalenze patrimoniali (rateizzazione fino a 5 esercizi)
  - Art. 87 — PEX (participation exemption)
  - Art. 88 — sopravvenienze attive
  - Art. 89 — esclusione 95% utili distribuiti
  - Art. 91 — proventi non tassabili
  - Art. 95 — spese per prestazioni di lavoro (compensi amministratori cassa)
  - Art. 96 — interessi passivi (ROL fiscale, deducibilità 30%)
  - Art. 99 — oneri fiscali e contributivi (IMU indeducibile salvo eccezioni)
  - Art. 102, 102-bis, 103, 104 — ammortamenti
  - Art. 102 c. 6 — manutenzioni eccedenti 5% (riporto su 5 esercizi)
  - Art. 102 c. 7 — leasing
  - Art. 105, 106, 107 — accantonamenti
  - Art. 108 — spese di rappresentanza, vitto e alloggio
  - Art. 109 c. 5 — pro-rata generale di deducibilità
  - Art. 164 — autoveicoli (deducibilità 20% / 80% / 100%)

### 2.2 IRAP

- **D.Lgs. 15 dicembre 1997, n. 446**, in particolare:
  - Art. 5 — base imponibile (società di capitali): A − B del CE escluse voci B9, B10 lett. c) e d), B12, B13
  - Art. 11 c. 1 lett. a) — deduzioni contributi INAIL, apprendisti, CFL, disabili, R&S
  - Art. 11 c. 4-bis — deduzione forfettaria per piccoli contribuenti (€8.000 se VP < €180.759,91)
  - Art. 11 c. 4-bis.1 — deduzione €1.850/dipendente per soggetti con ricavi < €400.000
  - **Art. 11 c. 4-octies** — deducibilità integrale del costo del personale a tempo indeterminato (cuneo fiscale, in vigore dal 2015 e ampliata dal 2022)
  - Art. 16 — aliquota 3,9% (con maggiorazioni regionali fino a +0,92%)

### 2.3 Concordato Preventivo Biennale

- **D.Lgs. 12 febbraio 2024, n. 13**, artt. 6-22:
  - Art. 15-17 — variazioni ammesse al reddito concordato (plus./sopravv./minus.)
  - Art. 20-bis — imposta sostitutiva opzionale su quota eccedente reddito ante-CPB rettificato
  - Aliquote sostitutive: 10% (ISA ≥ 8), 12% (ISA ≥ 6 e < 8), 15% (ISA < 6)
  - Soglia minima reddito concordato rettificato: €2.000

### 2.4 Versamenti e acconti

- **DPR 7 dicembre 2001, n. 435**, art. 17:
  - Saldo + I acconto: 30 giugno (o 30 luglio con +0,40%)
  - II acconto: 30 novembre
  - Soglia minima per versamento acconto: €103 (I acconto), €52 cumulato
- **L. 23 marzo 1977, n. 97**: rapporto 40/60 acconti
- **Art. 58 D.L. 124/2019** (soggetti ISA): rapporto 50/50 acconti (entrato a regime per ISA dall'anno d'imposta 2019)

### 2.5 Istruzioni operative

- Istruzioni Mod. **REDDITI SC** (anno di riferimento) — Agenzia delle Entrate
- Istruzioni Mod. **IRAP** (anno di riferimento) — Agenzia delle Entrate
- Istruzioni Mod. **CPB** (anno di riferimento) — Agenzia delle Entrate
- **Codici tributo F24**: 2003 (IRES saldo), 2001 (I acconto), 2002 (II acconto), 3800 (IRAP saldo), 3812 (I acconto), 3813 (II acconto), codice CPB da risoluzione AdE dell'anno
- **Aliquote IRAP regionali**: tabella MEF / Dipartimento Finanze aggiornata annualmente

### 2.6 Aggiornamento annuale

Le seguenti grandezze vanno aggiornate ad ogni esercizio (fonte = Legge di Bilancio + Decreto MEF):

- Aliquote IRES (oggi 24% — controllare eventuale Mini-IRES o maggiorazioni)
- Aliquota IRAP base 3,9% (stabile)
- Aliquote IRAP regionali (tabella per regione + settore)
- Soglie/scaglioni di acconto (€103, €52, percentuali ISA/non-ISA)
- Maggiorazione 0,40% per versamento posticipato a 30/07
- Soglie deduzione forfettaria IRAP (€8.000 / €180.759,91 / €1.850 / €400.000)
- Aliquote sostitutive CPB (10%/12%/15%) e soglia reddito minimo (€2.000)

Per garantire la riproducibilità storica, i valori sono **versionati per anno d'imposta** in `data/imposte/regole-anno-<YYYY>.json` (vedi §15).

---

## 3. Flag di configurazione del progetto

In testa al progetto SRL ci sono tre flag che governano l'intero flusso di calcolo. Corrispondono ai flag F2/F3/F4 del foglio Excel di riferimento.

| Flag | Valori | Effetto |
|---|---|---|
| `societa_trasparente` | `false` (default) / `true` | Se `true`: art. 115 TUIR, IRES non a carico società; calcolo IRES sostituito da quadro TN (imposta determinata in capo ai soci). Nel modulo MVP **gestiamo come informativo**: produciamo l'imponibile da trasferire ai soci ma azzeriamo l'IRES dovuta dalla società. |
| `cpb_attivo` | `false` (default) / `true` | Se `true`: il reddito IRES e il valore della produzione IRAP sono **forzati** rispettivamente al "Reddito concordato rettificato" (CP7 col.5) e al "VP concordato rettificato" (IS250 col.4). Si attiva inoltre la sezione imposta sostitutiva. |
| `soggetto_isa` | `false` / `true` (default) | Determina lo split degli acconti: ISA → 50%/50%, non-ISA → 40%/60%. Il punteggio ISA si inserisce solo se serve (CPB con imposta sostitutiva). |

Aggiungiamo un quarto campo informativo:

| Campo | Tipo | Note |
|---|---|---|
| `punteggio_isa` | numero 1-10 (decimali) | Necessario solo se `cpb_attivo=true` e si opta per imposta sostitutiva. Determina l'aliquota: ≥8 → 10%, ≥6 e <8 → 12%, <6 → 15%. |

I flag sono fissati a livello di progetto e non variano in corso di compilazione. Cambio flag → ricalcolo completo.

---

## 4. Input dati

### 4.1 Anagrafica e periodo

- Ragione sociale, P.IVA/CF
- Anno d'imposta (es. 2025, versamenti nel 2026)
- Regione della sede legale (per aliquota IRAP)
- Codice attività ATECO (informativo)

### 4.2 Risultato civilistico ante imposte

Importo unico → riga `risultato_bilancio_ante_imposte`. È il punto di partenza del quadro RF.

### 4.3 Dati di conto economico utili al calcolo IRAP

Servono i totali per macrovoce CE riclassificata UE:

- A) Valore della produzione (totale)
- B) Costi della produzione (totale)
- B9) Costi del personale (totale)
- B10 c) Svalutazione delle immobilizzazioni
- B10 d) Svalutazione dei crediti dell'attivo circolante
- B12) Accantonamenti per rischi
- B13) Altri accantonamenti
- C) Proventi e oneri finanziari (saldo, serve per condizione IRAP 10% oneri fin.)

Da questi il modulo calcola in automatico la base IRAP lorda:

```
base_IRAP_lorda = A_totale − (B_totale − B9 − B10c − B10d − B12 − B13)
```

### 4.4 Dati per cuneo fiscale IRAP (deduzione c. 4-octies)

- Costo del lavoro dipendente tempo indeterminato (anno corrente e precedente)
- Costo co.co.co. + compensi amministratori (anno corrente e precedente)
- Saldo IRAP anno precedente versato nell'anno corrente
- Acconti IRAP anno corrente versati

### 4.5 Voci di variazione IRES (dettaglio in §5)

Tutte le voci RF che producono variazione in aumento/diminuzione, ciascuna con importo numerico libero. Le voci con calcolo automatico (es. art. 96 ROL, manutenzioni 5%, plusvalenze rateizzate) sono **derivate** da sotto-prospetti dedicati e non editabili direttamente.

### 4.6 Voci di variazione IRAP (dettaglio in §10)

Idem per le righe IC del modello IRAP.

### 4.7 Storico pluriennale (persistito da anno ad anno)

Vedi §14. Non è un input puntuale ma uno stato del progetto.

### 4.8 Crediti d'imposta e ritenute

- Crediti d'imposta (RN12-15): importo totale — non si entra nel merito del tipo
- Ritenute d'acconto subite
- Credito IRES anno precedente residuo (RN19-20)
- Acconti IRES versati nell'anno (RN22)
- Credito IRAP anno precedente residuo
- Acconti IRAP versati nell'anno

---

## 5. Calcolo IRES — dettaglio variazioni

Il calcolo segue la logica del Mod. REDDITI SC quadro RF:

```
reddito_imponibile_lordo
  = risultato_civilistico_ante_imposte
  + Σ variazioni_in_aumento (RF6 ÷ RF31)
  − Σ variazioni_in_diminuzione (RF34 ÷ RF55)

reddito_dopo_perdite = reddito_imponibile_lordo − perdite_utilizzate (vedi §7)
imponibile_IRES      = MAX(0, reddito_dopo_perdite − ACE_residua_utilizzata) (vedi §8)
IRES_lorda           = imponibile_IRES × 24%
IRES_netta           = IRES_lorda − detrazioni
IRES_dovuta          = IRES_netta − crediti_imposta − ritenute
saldo_IRES           = IRES_dovuta − credito_anno_prec_residuo − acconti_versati
```

### 5.1 Variazioni in aumento (mappatura voci)

Riferimento: foglio Excel righe 14-52, righi RF6-RF31 del Mod. REDDITI SC.

| Rigo | Descrizione | Calcolo | Note |
|---|---|---|---|
| RF6 | Componenti positivi extracontabili (ex quadro EC) | Manuale | |
| RF7 | Quote plusvalenze patrimoniali e sopravv. attive | **Automatico** dal prospetto §14.1 | art. 86 c.4 TUIR |
| RF8 | Contributi e liberalità | Manuale | art. 88 |
| RF9 | Reddito soggetti con regimi particolari | Manuale | |
| RF10 | Reddito catastale immobili patrimonio | Manuale | |
| RF11 | Costi immobili patrimonio | Manuale | |
| RF12 | Adeguamento ricavi ISA | Manuale | |
| RF13 | Rimanenze non/sotto contabilizzate | Manuale | artt. 92-93 |
| RF14 | Compensi amministratori contabilizzati ma non corrisposti | Manuale | art. 95 c. 5 |
| RF15 col.1 | Interessi passivi indeducibili art. 96 | **Automatico** dal prospetto §6 | |
| RF15 col.2 | Altri interessi indeducibili (mora, ritardati IVA) | Manuale | |
| RF16 | Imposte non deducibili (incl. IMU) | Manuale | art. 99 c. 1 |
| RF17 | Erogazioni liberali indeducibili | Manuale | |
| RF18 | Spese auto indeducibili | Manuale, 3 sotto-righe | art. 164 — il modulo offre wizard "calcola da costo totale × 80%" |
| RF19 | Sopravvenienze passive e minus patrimoniali | Manuale | |
| RF20 | Minusvalenze partecipazioni esenti | Manuale | |
| RF21 | Ammortamenti indeducibili | Manuale, 3 sotto-righe (immobili / autovetture / cellulari+altri) | artt. 102, 102-bis, 103, 104 |
| RF22 | Variazioni consolidato | Manuale | artt. 118, 123 |
| RF23 col.1 | Spese vitto/alloggio/rappresentanza (totale) | Manuale | art. 108 — corrisponde alla diminuzione RF43 |
| RF23 col.2 | Spese rappresentanza start-up | Manuale | |
| RF23 col.2 | Altre spese di rappresentanza (es. omaggi) | Manuale | |
| (extra) | Spese vitto/alloggio/viaggio non tracciabili | Manuale | art. 109 c. 5-bis |
| RF24 | Spese manutenzione eccedenti 5% | **Automatico** dal prospetto §14.2 | art. 102 c. 6 |
| RF25 | Accantonamenti non deducibili | Manuale | artt. 105-107 |
| RF27 | Pro-rata generale spese indeducibili | Manuale | art. 109 c. 5 |
| RF30 | Componenti a patrimonio (IAS/IFRS) | Manuale | |
| RF31 cod. 1 | 5% dividendi incassati di competenza es. precedenti | Manuale | |
| RF31 cod. 3 | Vitto/alloggio dipendenti non tracciabili | Manuale | |
| RF31 cod. 34 | Costi beni soci/familiari indeducibili | Manuale | |
| RF31 cod. 35 | Canoni leasing indeducibili | Manuale | art. 102 c. 7 |
| RF31 cod. 41 | Eccedenza svalutazione crediti | Manuale | art. 106 c. 1 |
| RF31 cod. 56 | Esenzione branch exemption | Manuale | |
| RF31 cod. 99 | Sanzioni e multe | Manuale | |
| RF31 cod. 99 | Spese telefoniche (20% indeducibile) | **Automatico** = costo_totale × 20% | art. 102 |
| RF31 cod. 99 | Altre spese | Manuale | |

### 5.2 Variazioni in diminuzione (mappatura voci)

Riferimento: foglio Excel righe 54-75, righi RF34-RF55.

| Rigo | Descrizione | Calcolo | Note |
|---|---|---|---|
| RF34 | Plus./sopravv. rateizzate (corrispondente RF7) | **Automatico** dal prospetto §14.1 | quote di anni precedenti che maturano nell'anno |
| RF36-RF38 | Utili partecipazioni soc. persone / regime trasparenza | Manuale | art. 115 |
| RF39 | Proventi immobili RF10 | Manuale | |
| RF40 | Compensi amm., utili lavoro dip. di es. precedenti corrisposti nell'anno | Manuale | art. 95 c. 5-6 |
| RF43 | Spese vitto/alloggio/rappresentanza deducibili | **Automatico** = (RF23 col.1 × 75%) + RF23 col.2 (altre rappresentanza) | art. 108-109 c.5 |
| RF43 | Spese es. precedenti non a CE | Manuale | |
| RF44 | Proventi non tassabili (es. interessi BOT) | Manuale | art. 91 c. 1 |
| RF46 | Plusvalenze PEX | Manuale | art. 87 |
| RF47 | Quota esclusa utili distribuiti (95%) | Manuale | art. 89 |
| RF50 | Reddito esente/detassato (Patent Box) | Manuale | |
| RF53 | Componenti negativi a patrimonio (IAS/IFRS) | Manuale | |
| RF54 | Rimanenze sopra-contabilizzate | Manuale | artt. 92-93 |
| RF55 cod. 1 | Dividendi di competenza non incassati | Manuale | |
| RF55 cod. 6 | Manutenzioni eccedenti 5% es. precedenti | **Automatico** dal prospetto §14.2 | quote anni precedenti |
| RF55 cod. 12 | IRAP 10% su oneri finanziari | **Automatico** dal prospetto §12 | |
| RF55 cod. 13 | Interessi passivi es. precedenti deducibili nell'anno | **Automatico** dal prospetto §6 | art. 96 c. 5 |
| RF55 cod. 24 | Imposte anticipate | Manuale | |
| RF55 cod. 33 | IRAP analitica costo personale | **Automatico** dal prospetto §12 | |
| RF55 cod. 50/57/79 | Super ammortamenti | Manuale | L. 208/2015, 232/2016, 205/2017 |
| RF55 cod. 55-59/75-76 | Iper ammortamenti | Manuale | L. 232/2016, 205/2017, 145/2018 |
| RF55 cod. 66-67 | Super-deduzione nuove assunzioni | Manuale | art. 4 D.Lgs. 216/2023 |
| RF55 cod. 99 | Altre variazioni in diminuzione | Manuale | |

### 5.3 Auto-calcolo "spese auto" (RF18)

Per agevolare l'inserimento, il modulo offre un mini-wizard che, dato il costo totale annuo (assicurazione + bollo + carburante + manutenzione + ammortamento) e la categoria dell'attività ("agente/rappresentante" → 80% deducibile, "altre attività" → 20% deducibile), calcola la quota indeducibile da inserire in RF18 e RF21.

---

## 6. Interessi passivi art. 96 TUIR — prospetto ROL

Riferimento: foglio Excel righe 149-158, righi RF118-RF121 del Mod. REDDITI SC.

### 6.1 Calcolo del ROL fiscale

```
ROL_fiscale = A) Valore della produzione (valori fiscali)
            − B) Costi della produzione (valori fiscali, inclusi B9, B12, B13)
            + B10a) Ammortamento immobilizzazioni immateriali
            + B10b) Ammortamento immobilizzazioni materiali
            + canoni di locazione finanziaria di beni strumentali
            + dividendi incassati da società controllate estere
            +/− componenti positivi/negativi che hanno concorso al ROL
              di periodi precedenti
```

I "valori fiscali" significano: A e B di bilancio rettificati delle variazioni IRES che li impattano direttamente.

### 6.2 Algoritmo di deducibilità interessi passivi

Input dell'anno:
- `IP_anno` = interessi passivi a CE (voce C17)
- `IA_anno` = interessi attivi a CE (voce C16)
- `IP_riporto` = interessi passivi indeducibili riportati da esercizi precedenti (RF121 col.3 dell'anno prima)
- `ROL_riporto` = eccedenza ROL riportata da esercizi precedenti (RF120 col.3 dell'anno prima)

Calcolo:

```
IP_diretti        = MIN(IP_anno + IP_riporto, IA_anno)         (RF118 col.5)
IP_eccedenza      = MAX(0, IP_anno + IP_riporto − IA_anno)     (RF118 col.6)

ROL_30pct         = ROL_fiscale × 30%
capacita_ROL      = ROL_riporto + ROL_30pct
IP_dedotti_da_ROL = MIN(capacita_ROL, IP_eccedenza)            (RF119 col.7)

IP_deducibili_tot = IP_diretti + IP_dedotti_da_ROL
IP_indeducibili   = MAX(0, IP_eccedenza − IP_dedotti_da_ROL)   (RF121 col.3, riporto a nuovo)
ROL_residuo       = MAX(0, capacita_ROL − IP_eccedenza)        (RF120 col.3, riporto a nuovo)
```

### 6.3 Output verso il quadro RF

- Variazione in **aumento RF15 col.1** = `MAX(0, IP_eccedenza − IP_riporto)` (interessi non deducibili dell'anno corrente)
- Variazione in **diminuzione RF55 cod. 13** = se quest'anno ho usato ROL per dedurre interessi del passato, la differenza tra interessi totali deducibili e interessi correnti

### 6.4 Stato persistito

Vedi §14.3.

---

## 7. Perdite fiscali

Riferimento: foglio Excel righe 80-87, righi RS44-RS45 e RN1-RN6 del Mod. REDDITI SC, art. 84 TUIR.

### 7.1 Tipologie

- **Perdite "piene"**: quelle dei primi 3 periodi d'imposta dalla costituzione, utilizzabili al **100%** del reddito (art. 84 c. 2). Tracciate al rigo RS45 del modello.
- **Perdite "limitate"**: tutte le altre, utilizzabili nel limite dell'**80%** del reddito imponibile (art. 84 c. 1). Tracciate al rigo RS44.

Entrambe sono **riportabili senza limiti di tempo**.

### 7.2 Algoritmo di utilizzo

Dato `reddito_lordo` (utile + var.aumento − var.diminuzione, dopo prospetti §5-6):

```
se reddito_lordo ≤ 0:
    perdita_anno = |reddito_lordo|  →  va a stock perdite limitate
    reddito_dopo_perdite = 0
    nessuna perdita pregressa utilizzata

se reddito_lordo > 0:
    # 1) Prima si usano le perdite piene (al 100%)
    uso_piene = MIN(stock_piene, reddito_lordo)
    residuo_dopo_piene = reddito_lordo − uso_piene

    # 2) Poi le perdite limitate (max 80% del reddito_lordo, considerando
    #    la quota già coperta dalle piene)
    plafond_80pct = reddito_lordo × 80%
    capienza_residua_80pct = MAX(0, plafond_80pct − uso_piene)
    uso_limitate = MIN(stock_limitate, capienza_residua_80pct, residuo_dopo_piene)

    reddito_dopo_perdite = residuo_dopo_piene − uso_limitate
```

Ordine "piene prima, limitate poi" coerente con il foglio Excel di riferimento e con prassi diffusa (cfr. Circolare AdE n. 25/E del 16/06/2012, che lascia libertà di scelta ma indica come prassi di favore l'uso prioritario delle limitate, mentre il foglio adotta l'ordine inverso). **Adottiamo l'ordine "piene prima"** come da Excel del committente.

### 7.3 Stato persistito

Vedi §14.4.

---

## 8. ACE residua

L'agevolazione ACE corrente è abrogata dal 2024 (art. 5 D.Lgs. 216/2023). Resta gestita la **sola eccedenza ACE residua** maturata in periodi d'imposta in cui l'agevolazione era in vigore (RS113 col. 14 del Mod. Redditi 2025 e successivi).

### 8.1 Logica

```
imponibile_ante_ACE = MAX(0, reddito_dopo_perdite)
ACE_utilizzata      = MIN(stock_ACE_residua, imponibile_ante_ACE)
imponibile_IRES     = imponibile_ante_ACE − ACE_utilizzata
stock_ACE_nuovo     = stock_ACE_residua − ACE_utilizzata    (riporto a nuovo)
```

L'ACE non utilizzata si riporta agli esercizi successivi senza limite temporale.

### 8.2 Stato persistito

Vedi §14.5.

---

## 9. Concordato Preventivo Biennale (CPB)

Riferimento: D.Lgs. 13/2024, foglio Excel righe 111-127 (IRES) e 211-216 (IRAP).

Il CPB è opzionale e biennale: il contribuente concorda con l'AdE un reddito d'impresa e un valore della produzione IRAP per due esercizi, con benefici (esonero da successive rettifiche, possibilità di imposta sostitutiva sull'eccedenza). Si attiva con `cpb_attivo = true`.

### 9.1 IRES sotto CPB

Quando `cpb_attivo = true`, il **reddito imponibile IRES** non è quello calcolato dal quadro RF, ma il **"Reddito concordato rettificato"** (CP7 col.5 del Mod. REDDITI SC).

#### 9.1.1 Sezione II — Reddito concordato

Input:
- `reddito_concordato` (CP1 col.1, da Mod. CPB rigo P06 o P07)
- `reddito_ante_CPB_rettificato` (CP1 col.2, da Mod. CPB rigo P04)
- Variazioni art. 15-16-17 D.Lgs. 13/2024:
  - `var_attive` = plusvalenze + sopravvenienze attive + redditi da partecipazioni (CP6 col.1-8)
  - `var_passive` = minusvalenze + sopravvenienze passive + perdite su crediti + perdite da partecipazioni

Calcolo:

```
imponibile_concordato_lordo = reddito_concordato − imposta_sostitutiva_imponibile  (vedi §9.1.2)
variazioni_nette            = var_attive − var_passive
reddito_concordato_rettif   = MAX(2000, imponibile_concordato_lordo + variazioni_nette)
```

Soglia minima reddito **€2.000** (art. 21 c. 1 D.Lgs. 13/2024).

Il valore `reddito_concordato_rettif` sostituisce `imponibile_IRES` di §5.

#### 9.1.2 Sezione I — Imposta sostitutiva

Opzionale: il contribuente può versare un'imposta sostitutiva sulla quota di reddito concordato eccedente il "reddito ante-CPB rettificato".

Input: punteggio ISA dell'anno di riferimento (CPB 2024/2025 → ISA 2023; CPB 2025/2026 → ISA 2024).

```
imponibile_sostitutiva = MAX(0, reddito_concordato − reddito_ante_CPB_rettificato)

aliquota_sostitutiva =
    10%  se ISA ≥ 8
    12%  se 6 ≤ ISA < 8
    15%  se ISA < 6

imposta_sostitutiva = imponibile_sostitutiva × aliquota_sostitutiva
```

L'imposta sostitutiva è dovuta in aggiunta all'IRES sul reddito concordato rettificato.

### 9.2 IRAP sotto CPB

Quando `cpb_attivo = true`, il **valore della produzione netta IRAP** è il **"VP concordato rettificato"** (IS250 col.4).

Input:
- `vp_concordato` (IS250 col.1, da Mod. CPB rigo P08)
- `var_attive_irap` = plusvalenze e sopravvenienze attive (IS250 col.2)
- `var_passive_irap` = minusvalenze e sopravvenienze passive (IS250 col.3)

Calcolo:

```
vp_concordato_rettif = MAX(2000, vp_concordato + var_attive_irap − var_passive_irap)
```

Sostituisce `imponibile_IRAP` di §10. Aliquota IRAP regionale resta quella di §15.

Non esiste imposta sostitutiva IRAP nel CPB (solo IRES).

---

## 10. Calcolo IRAP — variazioni e deduzioni

Riferimento: foglio Excel righe 161-208, righi IC43-IC75 del Mod. IRAP.

### 10.1 Base imponibile lorda

Già definita in §4.3:

```
base_IRAP_lorda = A_totale_CE − (B_totale_CE − B9 − B10c − B10d − B12 − B13)
```

In altri termini: si parte da A − B di bilancio e si **rendono indeducibili** ai fini IRAP costo del personale (B9), svalutazioni (B10c, B10d) e accantonamenti (B12, B13). Sono recuperati come deduzione successiva (cuneo fiscale §10.4) solo quelli per personale tempo indeterminato.

### 10.2 Variazioni in aumento (IC43-IC51)

| Rigo | Descrizione | Calcolo |
|---|---|---|
| IC43 | Compensi amministratori | Manuale |
| IC43 | Contributi INPS amministratori | Manuale |
| IC43 | Cassa previdenza amministratori | Manuale |
| IC43 | Lavoro autonomo occasionale + utili associati in partecipazione | Manuale |
| IC43 | Co.co.co. (collaborazioni coordinate e continuative) | Manuale |
| IC44 | Quota interessi su canoni leasing | Manuale |
| IC45 | Perdite e svalutazioni crediti | Manuale |
| IC46 | IMU | Manuale |
| IC48 | Quota indeducibile ammortamento marchi e avviamento | Manuale |
| IC49 | Interessi passivi indeducibili (società di intermediazione) | Manuale |
| IC50 | Variazioni IAS / nuovi principi contabili nazionali | Manuale |
| IC51 cod. 1 | Altre spese personale (diverse da B9) | Manuale |
| IC51 cod. 2 | Adeguamento ISA | Manuale |
| IC51 cod. 3 | Contributi (diversi da quelli A5) | Manuale |
| IC51 cod. 4 | Quota terreno fabbricati strumentali | **Automatico** = importo riga "ammortamenti immobili" di RF21 (foglio: F32) |
| IC51 cod. 6 | Oneri finanziari + spese personale per lavori interni non in A4 | Manuale |
| IC51 cod. 99 | Altre variazioni in aumento | **Automatico** = somma RF17 (erogazioni liberali) + RF19 (sopravv. passive) + RF31 cod.99 sanzioni + altre RF31 cod.99 |

Totale → IC52.

### 10.3 Variazioni in diminuzione (IC53-IC57)

| Rigo | Descrizione | Calcolo |
|---|---|---|
| IC53 | Costi sostenuti già contabilizzati a fondi rischi | Manuale |
| IC55 | Quota deducibile ammortamento marchi/avviamento | Manuale |
| IC56 | Variazioni IAS | Manuale |
| IC57 cod. 3 | Quota costo lavoro interinale (se in B9) | Manuale |
| IC57 cod. 4 | Sopravvenienze attive di componenti es. precedenti | Manuale |
| IC57 cod. 6-7 | Quote ammortamento non dedotte in es. precedenti | Manuale |
| IC57 col. 16 | Patent box | Manuale |
| IC57 cod. 99 | Altre variazioni in diminuzione | Manuale |

Totale → IC58.

### 10.4 Deduzioni dal valore della produzione (cuneo fiscale)

Riferimento: art. 11 D.Lgs. 446/1997.

```
VP_lorda_post_variazioni = base_IRAP_lorda + IC52 − IC58    (rigo IC64)

IS1  = contributi INAIL                                     (art. 11 c.1 lett.a n.1)
IS4  = costo apprendisti, CFL, disabili, R&S                (art. 11 c.1 lett.a n.5)
IS5  = €1.850 × n. dipendenti                               (art. 11 c.4-bis.1)
       solo se ricavi < €400.000
IS7  = costo personale dipendente tempo indeterminato       (art. 11 c.4-octies)
IS8  = IS1 + IS4 + IS5 + IS7
IS9  = eccedenza deduzioni rispetto alle retribuzioni
IS10 = IS8 − IS9                                            (totale deduzioni cuneo)

IC75 = €8.000 deduzione forfettaria                         (art. 11 c.4-bis)
       solo se (IC64 − IS1 − IS4 − IS5 − IS7) ≤ €180.759,91

deduzioni_totali = IS10 + IC75

imponibile_IRAP = MAX(0, IC64 − deduzioni_totali)           (rigo IC76)
                  oppure VP_concordato_rettif se cpb_attivo (vedi §9.2)

IRAP = imponibile_IRAP × aliquota_regionale (§15)
```

### 10.5 Saldo IRAP

```
IRAP_dovuta   = IRAP − crediti_imposta_irap (es. ACE) − credito_anno_prec − acconti_versati
saldo_IRAP    = IRAP_dovuta  (se > 0 a debito, se < 0 a credito)
```

### 10.6 Mappatura IC → input modulo

Una volta che l'utente ha inserito l'utile civilistico e le voci IRES, molte righe IC sono **derivate**: il modulo le precompila e l'utente può solo confermarle o aggiungere voci manuali.

---

## 11. Acconti IRES e IRAP

Riferimento: foglio Excel righe 108-109 (IRES) e 214-215 (IRAP), DPR 435/2001.

### 11.1 Regola generale

Acconti calcolati con **metodo storico** sull'imposta dovuta dell'anno corrente (`F105` IRES, `F208` IRAP). Metodo previsionale = decisione utente, quindi non automatizzato (campo override manuale dell'acconto).

### 11.2 Split acconti

| Profilo | I acconto | II acconto | Totale |
|---|---|---|---|
| Soggetto ISA (`soggetto_isa = true`) | 50% | 50% | 100% |
| Non ISA | 40% | 60% | 100% |

### 11.3 Soglia minima

Soglia per attivazione del I acconto: **€103** (art. 17 c. 3 DPR 435/2001).

```
se imposta_dovuta ≤ 0:
    I_acconto  = 0
    II_acconto = 0

se ISA = true:
    quota_50 = imposta_dovuta × 50%
    se quota_50 < 103:
        I_acconto  = 0
        II_acconto = imposta_dovuta × 100%   # tutto a novembre
    altrimenti:
        I_acconto  = quota_50
        II_acconto = quota_50

se ISA = false:
    quota_40 = imposta_dovuta × 40%
    se quota_40 < 103:
        I_acconto  = 0
        II_acconto = imposta_dovuta × 60%    # solo seconda rata, prima saltata
    altrimenti:
        I_acconto  = quota_40
        II_acconto = imposta_dovuta × 60%
```

Nota: **il foglio Excel originale**, alla riga 215 (II acconto IRAP no-ISA), usa una formula leggermente asimmetrica rispetto a quella IRES. Per il modulo si **adotta la regola standard 40%/60%** per entrambe le imposte (decisione del committente).

### 11.4 Maggiorazione 0,40% per versamento posticipato

Il saldo + I acconto può essere versato **entro il 30/06** dell'anno successivo (termine ordinario) **o entro il 30/07 con maggiorazione dello 0,40%**. La maggiorazione si applica al solo saldo IRES/IRAP + I acconto, non ai versamenti già scaduti.

L'utente sceglie a livello di progetto:
- `data_versamento_saldo`: `30_giugno` (default) o `30_luglio_con_maggiorazione`

Se `30_luglio_con_maggiorazione`:

```
saldo_e_I_acconto_da_versare = (saldo + I_acconto) × 1.004
```

Il II acconto (30/11) non è influenzato.

### 11.5 Codici tributo F24

| Codice | Descrizione |
|---|---|
| 2003 | IRES — saldo |
| 2001 | IRES — I acconto |
| 2002 | IRES — II acconto o unica soluzione |
| 3800 | IRAP — saldo |
| 3812 | IRAP — I acconto |
| 3813 | IRAP — II acconto o unica soluzione |
| (CPB) | Codici da risoluzione AdE annuale (es. 4068/4069/4070 per imposta sostitutiva CPB 2024/2025) |

I codici tributo sono nel file regole-anno-`<YYYY>`.json (vedi §15) per consentire aggiornamento normativo.

---

## 12. Deduzione IRAP dall'IRES

Riferimento: foglio Excel righe 161-194, art. 6 D.L. 185/2008 e art. 2 D.L. 201/2011.

Due forme cumulabili:

### 12.1 Deduzione forfetaria 10% (RF55 cod. 12)

Spettante **solo se** la voce C) "Totale proventi e oneri finanziari" del bilancio UE presenta saldo **negativo** (oneri > proventi) per l'anno di riferimento (2024 saldo / 2025 acconti).

```
ded_forfait_2024 = saldo_IRAP_2024_versato_2025 × 10%   (se condizione vera per 2024)
ded_forfait_2025 = MIN(acconti_IRAP_2025_versati × 10%, IRAP_competenza_2025 × 10%)

RF55_cod_12 = ded_forfait_2024 + ded_forfait_2025
```

### 12.2 Deduzione analitica per costo del lavoro (RF55 cod. 33)

Quota dell'IRAP riferibile al costo del personale dipendente e assimilato, deducibile dall'IRES.

Si calcola separatamente per il **saldo 2024** (versato nel 2025) e per gli **acconti 2025** (versati nel 2025), poi si sommano.

#### 12.2.1 Componente 2024

```
costo_lavoro_dip_2024 = costo dip. tempo indeterminato 2024 (B9, parte deducibile IRAP)
costo_amm_cocoo_2024  = compensi amministratori + co.co.co. 2024 (no occasionali)
deduzioni_irap_2024   = totale deduzioni IRAP 2024 (escluse incremento occupazionale)
base_IRAP_2024        = base imponibile IRAP 2024

rapporto_2024  = MIN(1, (costo_lavoro_dip_2024 + costo_amm_cocoo_2024 − deduzioni_irap_2024) / base_IRAP_2024)
quota_teorica  = saldo_IRAP_2024_versato_2025 × rapporto_2024
quota_massima  = saldo_IRAP_2024_versato_2025 − ded_forfait_2024
ded_analitica_2024 = MAX(0, MIN(quota_teorica, quota_massima))
```

#### 12.2.2 Componente 2025

Stessa logica con dati 2025 e acconti 2025:

```
rapporto_2025  = MIN(1, (costo_lavoro_dip_2025 + costo_amm_cocoo_2025 − deduzioni_irap_2025) / base_IRAP_2025)
acconti_versati_capped = MIN(acconti_IRAP_2025_versati, IRAP_competenza_2025)
quota_teorica  = acconti_versati_capped × rapporto_2025
quota_massima  = acconti_versati_capped − ded_forfait_2025
ded_analitica_2025 = MAX(0, MIN(quota_teorica, quota_massima))

RF55_cod_33 = ded_analitica_2024 + ded_analitica_2025
```

### 12.3 Vincolo di non sovrapposizione

L'art. 2 c. 1-quater D.L. 201/2011 stabilisce che la deduzione analitica non può cumularsi con la forfetaria sulla **stessa quota di IRAP**: il foglio Excel (e questo modulo) gestisce ciò sottraendo la `ded_forfait` dalla `quota_massima` della deduzione analitica. Così l'imposta dedotta è al massimo pari all'IRAP versata.

---

## 13. Calendario versamenti

Riferimento: foglio Excel righe 229-231, art. 17 DPR 435/2001.

### 13.1 Scadenze

| Scadenza | Contenuto |
|---|---|
| **30/06 anno N+1** | Saldo IRES + I acconto IRES + saldo IRAP + I acconto IRAP + imposta sostitutiva CPB (se attiva) |
| **30/07 anno N+1** | Stesse voci con maggiorazione 0,40% (opzione "rateazione breve") |
| **30/11 anno N+1** | II acconto IRES + II acconto IRAP |

Dove `N` è l'anno d'imposta (es. anno d'imposta 2025 → versamenti nel 2026).

### 13.2 Output del modulo

Il prospetto F24 generato include, per ogni scadenza:

- Codice tributo
- Anno di riferimento
- Importo
- Maggiorazione (se applicabile)

### 13.3 Rateazione

Le imposte risultanti dal saldo (esclusi gli acconti, art. 20 D.Lgs. 241/1997) possono essere rateizzate da giugno a dicembre con interessi mensili (0,33% per ogni rata). Il modulo nell'MVP **non genera il piano rate**: produce un unico importo per la scadenza del 30/06 (o 30/07 + 0,40%). La rateazione resta scelta operativa dello studio.

---

## 14. Storico pluriennale (persistenza)

Il progetto del modulo `imposte` persiste lo **stato fiscale pluriennale** della società, in modo che l'apertura del progetto per l'anno N+1 possa pre-caricare automaticamente le quote di riporto e gli stock residui maturati negli anni precedenti.

Lo storico è un sotto-oggetto `storico` del progetto JSON (vedi §17). Non è un input puntuale: viene **alimentato all'atto della chiusura dell'anno** (decisione esplicita dell'operatore con pulsante "Chiudi anno e prepara anno successivo") e poi consultato in lettura per gli anni futuri.

### 14.1 Plusvalenze rateizzate (art. 86 c. 4 TUIR)

Una plusvalenza patrimoniale superiore a 3 anni di possesso può essere rateizzata in **fino a 5 esercizi** (compreso quello di realizzo). Ogni anno il modulo calcola la quota corrente e residua.

**Stato persistito**: per ogni plusvalenza realizzata,
- anno di realizzo
- importo totale
- numero di rate (1-5)
- quote già imputate (per anno)

**Calcolo dell'anno corrente**:
```
RF7_aumento  = Σ (quota_anno_corrente di tutte le plus realizzate ed imputate quest'anno)
RF34_diminuz = Σ (quote di anni precedenti che maturano quest'anno)
```

### 14.2 Spese di manutenzione eccedenti 5% (art. 102 c. 6 TUIR)

L'eccedenza rispetto al 5% del costo dei beni ammortizzabili è deducibile in quote costanti nei **5 esercizi successivi**.

**Stato persistito**: per ogni anno di formazione dell'eccedenza:
- anno
- importo eccedenza
- quota annua = importo / 5

**Calcolo dell'anno corrente**:
```
RF24_aumento     = eccedenza_anno_corrente            (l'intero importo come variazione in aumento)
RF55cod6_diminuz = Σ (quote di anni precedenti che maturano quest'anno)
```

### 14.3 Interessi passivi e ROL (art. 96 TUIR)

**Stato persistito**:
- `IP_riporto`: interessi passivi indeducibili riportati a nuovo (RF121 col.3)
- `ROL_riporto`: eccedenza ROL riportata a nuovo (RF120 col.3)

Aggiornati a fine anno con i valori calcolati in §6.2.

### 14.4 Perdite fiscali (art. 84 TUIR)

**Stato persistito**:
- `stock_perdite_piene`: array di perdite ancora utilizzabili dei primi 3 esercizi (con anno di formazione)
- `stock_perdite_limitate`: array di perdite ancora utilizzabili da esercizi successivi al terzo
- `data_costituzione`: per determinare quali esercizi sono "i primi 3" (e quindi quali nuove perdite vanno in `piene` vs `limitate`)

**Aggiornamento a fine anno**:
- Se utile → si decrementano gli stock per le perdite utilizzate (FIFO sull'anno di formazione)
- Se perdita → si aggiunge una nuova entry allo stock appropriato (piene se entro i primi 3 esercizi dalla costituzione, limitate altrimenti)

### 14.5 ACE residua

**Stato persistito**:
- `ACE_residua`: eccedenza non utilizzata, riportabile senza limiti di tempo (RS113)

Aggiornata a fine anno: `ACE_residua_nuovo = ACE_residua_precedente − ACE_utilizzata_anno`.

### 14.6 Eccedenze di acconti

**Stato persistito**:
- `credito_IRES_residuo`: credito anno precedente non compensato (RN19-RN20)
- `credito_IRAP_residuo`: idem per IRAP

Aggiornati alla chiusura: se l'imposta dovuta < (credito_anno_prec + acconti), l'eccedenza diventa credito da riportare all'anno successivo.

### 14.7 Chiusura anno

Il modulo espone un'azione esplicita **"Chiudi anno N e crea progetto anno N+1"** che:

1. Congela i valori dell'anno N (immutabili dopo la chiusura)
2. Crea un nuovo progetto per l'anno N+1 pre-popolato con:
   - lo stesso `meta` (cliente, regione, flag default)
   - lo `storico` aggiornato (plus, manutenzioni, ROL/IP, perdite, ACE, crediti)
   - voci RF/IC azzerate (l'utente le riempirà con i nuovi importi)

Una volta chiuso, l'anno N può essere consultato in sola lettura (per modifiche serve riapertura esplicita).

---

## 15. Aliquote IRAP regionali e tabelle di regole annuali

### 15.1 Aliquota IRAP — base e maggiorazioni

Aliquota base nazionale: **3,90%** (art. 16 c. 1 D.Lgs. 446/1997).

Le Regioni possono maggiorare fino a +0,92% per le società di capitali "ordinarie" (D.Lgs. 446/1997 art. 16 c. 3) e applicare aliquote diverse a settori specifici (es. banche, assicurazioni, agricoltura), nonché agevolazioni mirate.

### 15.2 Tabella regionale del modulo (MVP)

Il file `data/imposte/aliquote-irap-<YYYY>.json` contiene per ogni regione:

```json
{
  "anno": 2025,
  "regioni": {
    "Marche": {
      "ordinaria": 0.0473,
      "note": "3,90% base + 0,83% maggiorazione regionale"
    },
    "Emilia-Romagna": {
      "ordinaria": 0.039,
      "note": "Aliquota ordinaria base"
    },
    "DEFAULT": {
      "ordinaria": 0.039,
      "note": "Aliquota base nazionale"
    }
  }
}
```

**MVP**: si caricano almeno **Marche** ed **Emilia-Romagna** + DEFAULT al 3,90%. Regioni mancanti → fallback DEFAULT con avviso "verificare aliquota effettiva". Estensione a tutte le regioni rinviata.

L'utente può comunque sovrascrivere l'aliquota a livello di progetto se l'azienda rientra in un settore agevolato/maggiorato.

### 15.3 File `regole-anno-<YYYY>.json`

Contiene tutte le grandezze normative variabili per anno d'imposta. Esempio scheletro per il 2025:

```json
{
  "anno_imposta": 2025,
  "anno_versamento": 2026,
  "ires": {
    "aliquota": 0.24,
    "perdite_limite_pct": 0.80,
    "perdite_piene_n_esercizi": 3
  },
  "irap": {
    "aliquota_base_nazionale": 0.039,
    "deduzione_forfettaria": {
      "importo": 8000,
      "soglia_VP": 180759.91
    },
    "deduzione_per_dipendente": {
      "importo": 1850,
      "soglia_ricavi": 400000
    }
  },
  "acconti": {
    "soglia_minima": 103,
    "isa": { "I_acconto": 0.50, "II_acconto": 0.50 },
    "non_isa": { "I_acconto": 0.40, "II_acconto": 0.60 },
    "maggiorazione_30_07": 0.004
  },
  "cpb": {
    "reddito_minimo": 2000,
    "aliquote_sostitutiva": [
      { "isa_min": 8.0, "aliquota": 0.10 },
      { "isa_min": 6.0, "isa_max": 8.0, "aliquota": 0.12 },
      { "isa_max": 6.0, "aliquota": 0.15 }
    ]
  },
  "codici_tributo": {
    "ires_saldo": "2003",
    "ires_acconto_1": "2001",
    "ires_acconto_2": "2002",
    "irap_saldo": "3800",
    "irap_acconto_1": "3812",
    "irap_acconto_2": "3813",
    "cpb_sostitutiva_saldo": "4068",
    "cpb_sostitutiva_acconto_1": "4069",
    "cpb_sostitutiva_acconto_2": "4070"
  },
  "scadenze": {
    "saldo_e_I_acconto": "2026-06-30",
    "saldo_e_I_acconto_posticipato": "2026-07-30",
    "II_acconto": "2026-11-30"
  }
}
```

Questo file è la **fonte di verità** dei parametri normativi: un cambio normativo → nuovo file `regole-anno-2026.json` senza toccare il codice del motore.

### 15.4 Versioning storico

I file regole-anno e aliquote-irap di anni passati non si cancellano: restano nel repository per consentire ricalcoli e riproducibilità di esercizi chiusi.

---

## 16. Output del modulo

### 16.1 Riepilogo imposte

Tabella di sintesi visualizzata nel cruscotto:

| Voce | IRES | IRAP | Imp. sost. CPB |
|---|---|---|---|
| Imposta lorda | … | … | … |
| Detrazioni / deduzioni | … | — | — |
| Imposta netta | … | … | … |
| Crediti d'imposta + ritenute | … | … | — |
| Imposta dovuta | … | … | … |
| Credito anno prec. residuo | … | … | — |
| Acconti versati | … | … | — |
| **Saldo (debito/credito)** | … | … | … |
| I acconto anno N+1 | … | … | … |
| II acconto anno N+1 | … | … | … |

### 16.2 Prospetto F24

Una tabella per ciascuna delle tre scadenze (30/06 o 30/07, 30/11) con:
- Codice tributo
- Anno di riferimento
- Importo
- Maggiorazione (se 30/07)
- Totale per scadenza

### 16.3 Scritture contabili di chiusura imposte

Riferimento: foglio Excel righe 222-226. Genera le seguenti scritture in partita doppia:

```
22.20  Imposte dell'esercizio        a   D.12  Erario c/IRES         = IRES_netta
                                     a   D.12  Erario c/IRAP         = IRAP
                                     a   D.12  Erario c/imposta
                                                sostitutiva CPB      = imposta_sost_CPB

(eventuale rilevazione separata di crediti/acconti già a bilancio:
 Erario c/acconti IRES, Erario c/ritenute, ecc. — gestita dall'utente)
```

Nel modulo MVP la scrittura è **prodotta come testo formattato** copiabile (non integrata con un libro giornale, che esula dal perimetro di Studio AnaBil).

### 16.4 Risultato netto

```
Risultato netto = Risultato ante imposte − IRES_netta − IRAP − imposta_sost_CPB
```

Visualizzato nel cruscotto come quadratura finale.

### 16.5 Esportazione

- Stampa via `window.print()` con CSS `@media print` dei prospetti selezionati (riepilogo, F24, scritture)
- Esportazione PDF dedicata: stessa logica di BP, **fuori MVP**

---

## 17. Schema dati JSON di progetto

Il file di progetto `.imposte.json` ha la seguente struttura. È **gestito da `core/projects.js`** discriminando su `meta.modulo === "imposte"` (come già si fa per `bp` e `ab`).

```json
{
  "meta": {
    "modulo": "imposte",
    "cliente": "Rossi Srl",
    "p_iva": "01234567890",
    "ateco": "62.01.00",
    "regione": "Marche",
    "anno_imposta": 2025,
    "anno_versamento": 2026,
    "data_costituzione": "2018-03-15",
    "creato": "2026-04-30",
    "modificato": "2026-04-30",
    "stato": "in_lavorazione",
    "chiuso": false
  },
  "flag": {
    "societa_trasparente": false,
    "cpb_attivo": false,
    "soggetto_isa": true,
    "punteggio_isa": null,
    "data_versamento_saldo": "30_giugno"
  },
  "ce": {
    "risultato_ante_imposte": 0,
    "A_totale": 0,
    "B_totale": 0,
    "B9": 0,
    "B10c": 0,
    "B10d": 0,
    "B12": 0,
    "B13": 0,
    "C_saldo": 0
  },
  "lavoro_irap": {
    "costo_dip_indeterminato_anno": 0,
    "costo_dip_indeterminato_anno_prec": 0,
    "costo_amm_cocoo_anno": 0,
    "costo_amm_cocoo_anno_prec": 0,
    "saldo_irap_anno_prec_versato": 0,
    "acconti_irap_anno_versati": 0
  },
  "ires": {
    "variazioni_aumento": {
      "RF6": 0, "RF8": 0, "RF9": 0, "RF10": 0, "RF11": 0,
      "RF12": 0, "RF13": 0, "RF14": 0,
      "RF15_col2": 0, "RF16": 0, "RF17": 0,
      "RF18_assicurazione_bollo": 0, "RF18_carburante": 0, "RF18_manutenzione": 0,
      "RF19": 0, "RF20": 0,
      "RF21_immobili": 0, "RF21_autovetture": 0, "RF21_altri": 0,
      "RF22": 0,
      "RF23_col1_vitto_alloggio_totale": 0,
      "RF23_col2_rappresentanza_startup": 0,
      "RF23_col2_altre_rappresentanza": 0,
      "RF23_non_tracciabili": 0,
      "RF25": 0, "RF27": 0, "RF30": 0,
      "RF31_cod1": 0, "RF31_cod3": 0, "RF31_cod34": 0,
      "RF31_cod35": 0, "RF31_cod41": 0, "RF31_cod56": 0,
      "RF31_cod99_sanzioni": 0,
      "RF31_cod99_telefoniche_costo_totale": 0,
      "RF31_cod99_altre": 0
    },
    "variazioni_diminuzione": {
      "RF36_RF38": 0, "RF39": 0, "RF40": 0,
      "RF43_es_precedenti": 0, "RF44": 0, "RF46": 0, "RF47": 0,
      "RF50": 0, "RF53": 0, "RF54": 0,
      "RF55_cod1": 0, "RF55_cod24": 0,
      "RF55_cod50_57_79": 0, "RF55_cod55_59_75_76": 0,
      "RF55_cod66_67": 0, "RF55_cod99": 0
    },
    "crediti_e_ritenute": 0,
    "detrazioni": 0,
    "credito_anno_prec_residuo": 0,
    "acconti_versati": 0,
    "rol_input": {
      "ip_anno": 0,
      "ia_anno": 0,
      "valori_a_b_fiscali": { "A": 0, "B": 0, "amm_immateriali": 0, "amm_materiali": 0, "canoni_leasing": 0 }
    }
  },
  "irap": {
    "variazioni_aumento": {
      "IC43_compensi_amm": 0, "IC43_inps_amm": 0, "IC43_cassa_prev": 0,
      "IC43_lav_aut_occ": 0, "IC43_cococo": 0,
      "IC44": 0, "IC45": 0, "IC46_imu": 0, "IC48": 0, "IC49": 0, "IC50": 0,
      "IC51_cod1": 0, "IC51_cod2": 0, "IC51_cod3": 0, "IC51_cod6": 0
    },
    "variazioni_diminuzione": {
      "IC53": 0, "IC55": 0, "IC56": 0,
      "IC57_cod3": 0, "IC57_cod4": 0, "IC57_cod6_7": 0,
      "IC57_col16_patent_box": 0, "IC57_cod99": 0
    },
    "deduzioni": {
      "IS1_inail": 0,
      "IS4_apprendisti_disabili_rd": 0,
      "IS5_dipendenti_1850": { "n_dipendenti": 0, "ricavi_totali": 0 },
      "IS7_costo_personale_indet": 0,
      "IS9_eccedenze": 0
    },
    "aliquota_override": null,
    "credito_anno_prec_residuo": 0,
    "acconti_versati": 0
  },
  "cpb": {
    "reddito_concordato": 0,
    "reddito_ante_cpb_rettificato": 0,
    "var_attive": 0,
    "var_passive": 0,
    "vp_concordato": 0,
    "var_attive_irap": 0,
    "var_passive_irap": 0
  },
  "storico": {
    "plusvalenze_rateizzate": [
      { "anno_realizzo": 2023, "importo": 50000, "rate": 5, "imputate": [10000, 10000] }
    ],
    "manutenzioni_eccedenti_5pct": [
      { "anno": 2023, "importo": 7500 }
    ],
    "interessi_passivi_riporto": 0,
    "rol_riporto": 0,
    "perdite_piene": [
      { "anno": 2019, "importo": 12000 }
    ],
    "perdite_limitate": [
      { "anno": 2022, "importo": 35000 }
    ],
    "ace_residua": 0,
    "credito_ires_residuo": 0,
    "credito_irap_residuo": 0
  },
  "calcoli": {
    "ires_lorda": 0, "ires_netta": 0, "ires_dovuta": 0,
    "saldo_ires": 0, "I_acconto_ires": 0, "II_acconto_ires": 0,
    "irap": 0, "irap_dovuta": 0,
    "saldo_irap": 0, "I_acconto_irap": 0, "II_acconto_irap": 0,
    "imposta_sost_cpb": 0,
    "ded_irap_da_ires": { "forfait_10pct": 0, "analitica_costo_lavoro": 0 },
    "risultato_netto": 0,
    "perdita_anno": 0
  }
}
```

### 17.1 Note di compatibilità

- `meta.modulo` è il discriminante per `core/projects.js` (oggi gestisce `bp` e `ab`)
- I campi `calcoli` sono **derivati**: presenti nel JSON solo per documentazione; il motore li ricalcola sempre all'apertura
- Il `storico` è l'unica parte mutata dalla "chiusura anno" (vedi §14.7); le altre sezioni sono input dell'esercizio corrente

---

## 18. UI — sezioni di navigazione

Le voci di sidebar del modulo `imposte` (data-modulo="imposte") seguono il flusso del calcolo:

| Sezione | Contenuto |
|---|---|
| **Anagrafica e flag** | Cliente, P.IVA, regione, anno d'imposta, ATECO, data costituzione, flag (trasparente, CPB, ISA + punteggio), opzione 30/06 vs 30/07 |
| **Conto economico** | Risultato ante imposte + voci A/B aggregati per IRAP + voce C (saldo proventi/oneri finanziari) |
| **Variazioni IRES** | Tab "in aumento" (RF6-RF31) e "in diminuzione" (RF34-RF55), con sotto-prospetti automatici evidenziati |
| **Interessi passivi (ROL)** | Prospetto art. 96: input IP/IA, valori fiscali per ROL, riporti es. precedenti — output deducibili e residui |
| **Perdite e ACE** | Stock perdite piene/limitate con anno di formazione + ACE residua + utilizzo dell'anno calcolato |
| **CPB** | Sezione I (imposta sostitutiva) + Sezione II (reddito rettificato), abilitata solo se `cpb_attivo=true` |
| **IRAP — variazioni e deduzioni** | Tab "in aumento" (IC43-IC51), "in diminuzione" (IC53-IC57), deduzioni IS1/IS4/IS5/IS7 + forfait IC75 |
| **Deduzione IRAP da IRES** | Prospetto §12 con calcolo analitico e forfetario (input cuneo già in "Conto economico"/"Lavoro IRAP") |
| **Crediti, ritenute, acconti** | Crediti d'imposta, ritenute, credito anno prec., acconti versati (IRES + IRAP) |
| **Storico (riporti)** | Visualizzazione tabellare di plusvalenze rateizzate, manutenzioni 5%, riporti IP/ROL, perdite, ACE, crediti residui |
| **Riepilogo & F24** | Tabella sintesi imposte (§16.1) + prospetti F24 per le tre scadenze + scritture contabili |

### 18.1 Wizard di import iniziale

Funzione "Importa da bilancio AB" (se progetto AB dello stesso cliente è disponibile): pre-popola CE e voci di lavoro IRAP a partire dai totali di macroarea del modulo AB. Fuori MVP, ma annotata come prossimo step.

### 18.2 Convenzioni UI (vincolanti)

Coerenza con CLAUDE.md sezione 7:
- Nessun `input`/`button` nativo: solo `div[contenteditable]` per importi e `div[onclick]` per pulsanti
- Importi numerici in JetBrains Mono ≥14px
- Variabili colore in `:root` di `main.css`, mai inline
- Header sticky nei prospetti
- Auto-select e blur forzato come per BP
- Tooltip "engine-trace" su ogni cella calcolata, riportando la formula e i righi del Mod. REDDITI SC / IRAP coinvolti (analogo del tooltip BP descritto in core/ui.js:4332+)

---

## 19. Architettura del codice (proposta)

```
js/modules/imposte/
  engine.js          # motore di calcolo, indipendente da UI
                     #   - calcoloIres(progetto, regole)
                     #   - calcoloIrap(progetto, regole)
                     #   - calcoloCpb(progetto, regole)
                     #   - calcoloAcconti(progetto, regole)
                     #   - calcoloDeduzioneIrapDaIres(progetto, regole)
                     #   - chiudiAnno(progetto) -> nuovo progetto N+1
  schema.js          # struttura righe RF/IC, mapping rigo -> descrizione
                     # con tag {automatico|manuale}
  ui.js              # rendering delle sezioni di sidebar (§18)
  regole-loader.js   # caricamento dinamico di regole-anno-<YYYY>.json
                     # e aliquote-irap-<YYYY>.json

data/imposte/
  regole-anno-2025.json
  aliquote-irap-2025.json
  (futuro) regole-anno-2026.json, aliquote-irap-2026.json, ...

samples/imposte/
  2026 calcolo imposte srl 2025.xlsx   # già presente
```

Disaccoppiamento: `engine.js` e `schema.js` non dipendono dalla UI. `core/projects.js` gestisce il formato `meta.modulo === "imposte"` come per BP/AB.

---

## 20. Esclusioni e roadmap (riepilogo)

### 20.1 Esclusi dal MVP

(coerente con §1)

- Mini-IRES premiale 2025 (L. 207/2024)
- Società di comodo / non operative (art. 30 L. 724/1994)
- Società in perdita sistematica (art. 2 D.L. 138/2011)
- Addizionali IRES settoriali (banche, assicurazioni, energia)
- Consolidato fiscale (artt. 117-129 TUIR)
- Trasparenza fiscale art. 115-116 TUIR — gestita solo come flag informativo
- Imposte differite/anticipate (input manuale)
- Crediti d'imposta automatici (input manuale)
- Calcolo punteggio ISA (solo input)
- Tutte le regioni ≠ Marche, Emilia-Romagna, DEFAULT (override manuale possibile)
- Piano rate giugno-dicembre (un solo importo per scadenza)
- Esportazione PDF dedicata (solo `window.print()`)

### 20.2 Roadmap futura

In ordine di priorità candidata:

1. **Aliquote IRAP per tutte le regioni** — completamento tabella `aliquote-irap-<YYYY>.json`
2. **Import da modulo AB** — wizard che pre-popola CE/lavoro IRAP dai totali AB dello stesso cliente
3. **Esportazione PDF dedicata** — coerente con eventuale `exportPDF()` di BP
4. **Mini-IRES premiale** — quando arriverà richiesta concreta + chiarimenti normativi
5. **Società di comodo / perdite sistematiche** — modulo opzionale
6. **Crediti d'imposta tabellari** — gestione automatica dei principali crediti (4.0, R&S, ZES) con regole di utilizzo e riporto
7. **Consolidato fiscale di gruppo (3+ società)** — progetto-contenitore aggregante; richiede design dedicato
8. **Piano rate giugno-dicembre** — generazione delle 6/7 rate con interessi 0,33% mensili

### 20.3 Aggiornamento annuale

Ogni anno fiscale richiede:
1. Verifica novità Legge di Bilancio per IRES/IRAP/CPB
2. Creazione `data/imposte/regole-anno-<YYYY>.json` aggiornato
3. Verifica aliquote IRAP regionali → `data/imposte/aliquote-irap-<YYYY>.json`
4. Verifica codici tributo F24 per imposta sostitutiva CPB (risoluzione AdE)
5. Verifica eventuali nuovi righi RF/IC nel Mod. REDDITI SC / IRAP

Il motore non cambia: si aggiorna solo il file `regole-anno-<YYYY>.json`.

---

## Appendice A — Mappa Excel ↔ modulo

Il foglio Excel di riferimento (`samples/imposte/2026 calcolo imposte srl 2025.xlsx`, anno d'imposta 2025) è la base di test per la conformità del motore. Il porting riga-per-riga è un'attività di test, non di implementazione: per ogni cella calcolata del foglio si genera un caso di test che verifica l'output del motore con le stesse celle di input.

Riferimenti chiave (riga foglio Excel → componente modulo):

- **Riga 12 (I12)** → `risultato_ante_imposte`
- **Righe 14-52 (F14-F52)** → IRES variazioni in aumento (§5.1)
- **Righe 54-75 (G54-G75)** → IRES variazioni in diminuzione (§5.2)
- **Righe 80-87** → Prospetto perdite (§7)
- **Riga 89 (I89), 91 (H91)** → ACE residua (§8)
- **Righe 92-101** → Imponibile e IRES netta (§5)
- **Righe 108-109** → Acconti IRES (§11)
- **Righe 111-127** → CPB (§9)
- **Righe 130-137** → Plusvalenze rateizzate (§14.1)
- **Righe 139-146** → Manutenzioni 5% (§14.2)
- **Righe 149-158** → Interessi passivi/ROL (§6)
- **Righe 161-208** → IRAP (§10)
- **Righe 161-194 (lato dx)** → Deduzione IRAP da IRES (§12)
- **Righe 211-216** → CPB IRAP (§9.2)
- **Righe 219-226** → Risultato netto e scritture (§16.3-16.4)
- **Righe 229-231** → Calendario versamenti (§13)

---

*Fine documento.*









