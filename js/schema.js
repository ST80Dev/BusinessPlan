/**
 * schema.js
 * Struttura normativa Stato Patrimoniale (art. 2424 c.c.)
 * e Conto Economico (art. 2425 c.c.)
 *
 * Ogni nodo ha:
 *   id        — identificatore univoco (usato come chiave nei dati)
 *   label     — etichetta da mostrare in UI
 *   tipo      — 'mastro' | 'sottomastro' | 'conto' | 'totale'
 *   segno     — +1 (positivo per il totale) | -1 (negativo / da sottrarre)
 *   children  — array di nodi figli (assente per conti foglia)
 *   editabile — true se il valore è inseribile manualmente
 *   computed  — true se il valore è calcolato dalla somma dei figli
 *   note      — note interne (opzionale)
 *
 * I conti foglia nei livelli "analitica" sono predisposti ma vuoti.
 * In modalità "rapida" si usano solo i sottomastri come punti di ingresso.
 *
 * Questo modulo non dipende da ui.js né da engine.js.
 */

'use strict';

const Schema = (() => {

  /* ──────────────────────────────────────────────────────────
     STATO PATRIMONIALE — art. 2424 c.c.
     ────────────────────────────────────────────────────────── */

  const SP_ATTIVO = [
    {
      id: 'sp.A', label: 'A. Crediti verso soci per versamenti ancora dovuti',
      tipo: 'mastro', segno: +1, computed: false, editabile: true,
      note: 'Importo non ancora richiamato e richiamato separatamente'
    },
    {
      id: 'sp.B', label: 'B. Immobilizzazioni', tipo: 'mastro', segno: +1, computed: true,
      children: [
        {
          id: 'sp.BI', label: 'I — Immobilizzazioni immateriali', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.BI.1', label: '1. Costi di impianto e di ampliamento',                         tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.2', label: '2. Costi di sviluppo',                                           tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.3', label: '3. Diritti di brevetto industriale e di utilizzazione delle opere dell\'ingegno', tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.4', label: '4. Concessioni, licenze, marchi e diritti simili',               tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.5', label: '5. Avviamento',                                                  tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.6', label: '6. Immobilizzazioni in corso e acconti',                         tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BI.7', label: '7. Altre',                                                       tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'sp.BII', label: 'II — Immobilizzazioni materiali', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.BII.1', label: '1. Terreni e fabbricati',                        tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BII.2', label: '2. Impianti e macchinario',                      tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BII.3', label: '3. Attrezzature industriali e commerciali',       tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BII.4', label: '4. Altri beni',                                  tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BII.5', label: '5. Immobilizzazioni in corso e acconti',          tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'sp.BIII', label: 'III — Immobilizzazioni finanziarie', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.BIII.1', label: '1. Partecipazioni',                              tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BIII.2', label: '2. Crediti',                                     tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BIII.3', label: '3. Altri titoli',                                tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.BIII.4', label: '4. Strumenti finanziari derivati attivi',        tipo: 'conto', segno: +1, editabile: true }
          ]
        }
      ]
    },
    {
      id: 'sp.C', label: 'C. Attivo circolante', tipo: 'mastro', segno: +1, computed: true,
      children: [
        {
          id: 'sp.CI', label: 'I — Rimanenze', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.CI.1', label: '1. Materie prime, sussidiarie e di consumo',       tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CI.2', label: '2. Prodotti in corso di lavorazione e semilavorati',tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CI.3', label: '3. Lavori in corso su ordinazione',                tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CI.4', label: '4. Prodotti finiti e merci',                       tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CI.5', label: '5. Acconti',                                       tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'sp.CII', label: 'II — Crediti', tipo: 'sottomastro', segno: +1, computed: true,
          note: 'Separare quota entro e oltre 12 mesi',
          children: [
            { id: 'sp.CII.1',   label: '1. Verso clienti',                                              tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.2',   label: '2. Verso imprese controllate',                                  tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.3',   label: '3. Verso imprese collegate',                                    tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.4',   label: '4. Verso controllanti',                                         tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.5',   label: '5. Verso imprese sottoposte al controllo delle controllanti',   tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.5b',  label: '5-bis. Crediti tributari',                                      tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.5t',  label: '5-ter. Imposte anticipate',                                     tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CII.5q',  label: '5-quater. Verso altri',                                         tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'sp.CIII', label: 'III — Attività finanziarie che non costituiscono immobilizzazioni', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.CIII.1', label: '1. Partecipazioni in imprese controllate',  tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIII.2', label: '2. Partecipazioni in imprese collegate',    tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIII.3', label: '3. Partecipazioni in imprese controllanti', tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIII.4', label: '4. Altre partecipazioni',                   tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIII.5', label: '5. Strumenti finanziari derivati attivi',   tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIII.6', label: '6. Altri titoli',                           tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'sp.CIV', label: 'IV — Disponibilità liquide', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'sp.CIV.1', label: '1. Depositi bancari e postali', tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIV.2', label: '2. Assegni',                    tipo: 'conto', segno: +1, editabile: true },
            { id: 'sp.CIV.3', label: '3. Denaro e valori in cassa',   tipo: 'conto', segno: +1, editabile: true }
          ]
        }
      ]
    },
    {
      id: 'sp.D_att', label: 'D. Ratei e risconti attivi',
      tipo: 'mastro', segno: +1, computed: false, editabile: true
    },
    {
      id: 'sp.TOT_ATT', label: 'TOTALE ATTIVO',
      tipo: 'totale', segno: +1, computed: true,
      somma: ['sp.A', 'sp.B', 'sp.C', 'sp.D_att']
    }
  ];

  const SP_PASSIVO = [
    {
      id: 'sp.PN', label: 'A. Patrimonio netto', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'sp.PN.I',    label: 'I. Capitale',                                                    tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.II',   label: 'II. Riserva da soprapprezzo delle azioni',                       tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.III',  label: 'III. Riserve di rivalutazione',                                  tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.IV',   label: 'IV. Riserva legale',                                             tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.V',    label: 'V. Riserve statutarie',                                          tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.VI',   label: 'VI. Altre riserve, distintamente indicate',                      tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.VII',  label: 'VII. Riserva per operazioni di copertura dei flussi finanziari', tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.VIII', label: 'VIII. Utili (perdite) portati a nuovo',                          tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.IX',   label: 'IX. Utile (perdita) dell\'esercizio',                            tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.PN.X',    label: 'X. Riserva negativa per azioni proprie in portafoglio',          tipo: 'conto', segno: -1, editabile: true }
      ]
    },
    {
      id: 'sp.B_pass', label: 'B. Fondi per rischi e oneri', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'sp.B_pass.1', label: '1. Per trattamento di quiescenza e simili',  tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.B_pass.2', label: '2. Per imposte, anche differite',            tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.B_pass.3', label: '3. Strumenti finanziari derivati passivi',   tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.B_pass.4', label: '4. Altri',                                   tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'sp.C_pass', label: 'C. Trattamento di fine rapporto di lavoro subordinato',
      tipo: 'mastro', segno: +1, computed: false, editabile: true
    },
    {
      id: 'sp.D_pass', label: 'D. Debiti', tipo: 'mastro', segno: +1, computed: true,
      note: 'Indicare separatamente gli importi esigibili oltre l\'esercizio successivo',
      children: [
        { id: 'sp.D_pass.1',  label: '1. Obbligazioni',                                                tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.2',  label: '2. Obbligazioni convertibili',                                   tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.3',  label: '3. Debiti verso soci per finanziamenti',                         tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.4',  label: '4. Debiti verso banche',                                         tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.5',  label: '5. Debiti verso altri finanziatori',                             tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.6',  label: '6. Acconti',                                                     tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.7',  label: '7. Debiti verso fornitori',                                      tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.8',  label: '8. Debiti rappresentati da titoli di credito',                   tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.9',  label: '9. Debiti verso imprese controllate',                            tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.10', label: '10. Debiti verso imprese collegate',                             tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.11', label: '11. Debiti verso controllanti',                                  tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.12', label: '12. Debiti tributari',                                           tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.13', label: '13. Debiti verso istituti di previdenza e di sicurezza sociale', tipo: 'conto', segno: +1, editabile: true },
        { id: 'sp.D_pass.14', label: '14. Altri debiti',                                               tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'sp.E_pass', label: 'E. Ratei e risconti passivi',
      tipo: 'mastro', segno: +1, computed: false, editabile: true
    },
    {
      id: 'sp.TOT_PASS', label: 'TOTALE PASSIVO E PATRIMONIO NETTO',
      tipo: 'totale', segno: +1, computed: true,
      somma: ['sp.PN', 'sp.B_pass', 'sp.C_pass', 'sp.D_pass', 'sp.E_pass']
    }
  ];

  /* ──────────────────────────────────────────────────────────
     SP SEMPLIFICATO per società costituenda (art. 10 spec.)
     ────────────────────────────────────────────────────────── */

  const SP_COSTITUENDA = [
    // ── ATTIVO ──────────────────────────────────────────
    {
      id: 'spc._ATT', label: '── ATTIVO ──', tipo: 'separatore', computed: false, editabile: false
    },
    {
      id: 'spc.CRED', label: 'A) Crediti vs soci per versamenti dovuti', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.CRED.1', label: 'Crediti vs soci per versamenti ancora dovuti', tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'spc.INV', label: 'B) Investimenti già acquisiti all\'avvio', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.INV.1', label: 'Immobilizzazioni materiali (macchinari, arredi, veicoli)',       tipo: 'conto', segno: +1, editabile: true },
        { id: 'spc.INV.2', label: 'Immobilizzazioni immateriali (licenze, software, avviamento)',   tipo: 'conto', segno: +1, editabile: true },
        { id: 'spc.INV.3', label: 'Partecipazioni e depositi cauzionali',                           tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'spc.SPESE', label: 'C) Spese di avvio capitalizzate', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.SPESE.1', label: 'Spese di costituzione (notaio, CCIAA, bolli)',                 tipo: 'conto', segno: +1, editabile: true },
        { id: 'spc.SPESE.2', label: 'Caparre e depositi cauzionali (locazioni, utenze)',             tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'spc.LIQ', label: 'D) Liquidità iniziale', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.LIQ.1', label: 'Cassa e conti bancari (saldo disponibile al via)', tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    // ── PASSIVO ─────────────────────────────────────────
    {
      id: 'spc._PAS', label: '── PASSIVO ──', tipo: 'separatore', computed: false, editabile: false
    },
    {
      id: 'spc.PN', label: 'A) Patrimonio Netto', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.PN.1', label: 'Capitale sociale',                       tipo: 'conto', segno: +1, editabile: true },
        { id: 'spc.PN.3', label: 'Versamenti in conto capitale soci',      tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'spc.FIN', label: 'B) Debiti', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'spc.FIN.1', label: 'Finanziamenti soci',   tipo: 'conto', segno: +1, editabile: true },
        { id: 'spc.FIN.2', label: 'Finanziamenti bancari (mutui / aperture di credito)', tipo: 'conto', segno: +1, editabile: true }
      ]
    }
  ];

  /* ──────────────────────────────────────────────────────────
     CONTO ECONOMICO — art. 2425 c.c.
     ────────────────────────────────────────────────────────── */

  const CE = [
    {
      id: 'ce.A', label: 'A. Valore della produzione', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'ce.A.1', label: '1. Ricavi delle vendite e delle prestazioni',                                        tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.A.2', label: '2. Variazioni delle rimanenze di prodotti in lavorazione, semilavorati e finiti',    tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.A.3', label: '3. Variazioni dei lavori in corso su ordinazione',                                   tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.A.4', label: '4. Incrementi di immobilizzazioni per lavori interni',                               tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.A.5', label: '5. Altri ricavi e proventi',                                                         tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'ce.B', label: 'B. Costi della produzione', tipo: 'mastro', segno: -1, computed: true,
      note: 'I costi sono inseriti come valori positivi; il segno -1 indica che sottraggono al risultato',
      children: [
        { id: 'ce.B.6',  label: '6. Per materie prime, sussidiarie, di consumo e di merci',  tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.B.7',  label: '7. Per servizi',                                            tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.B.8',  label: '8. Per godimento di beni di terzi',                         tipo: 'conto', segno: +1, editabile: true },
        {
          id: 'ce.B.9', label: '9. Per il personale', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'ce.B.9a', label: 'a) Salari e stipendi',              tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.9b', label: 'b) Oneri sociali',                  tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.9c', label: 'c) Trattamento di fine rapporto',   tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.9d', label: 'd) Trattamento di quiescenza e simili', tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.9e', label: 'e) Altri costi',                    tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        {
          id: 'ce.B.10', label: '10. Ammortamenti e svalutazioni', tipo: 'sottomastro', segno: +1, computed: true,
          children: [
            { id: 'ce.B.10a', label: 'a) Ammortamento delle immobilizzazioni immateriali', tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.10b', label: 'b) Ammortamento delle immobilizzazioni materiali',   tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.10c', label: 'c) Altre svalutazioni delle immobilizzazioni',       tipo: 'conto', segno: +1, editabile: true },
            { id: 'ce.B.10d', label: 'd) Svalutazioni dei crediti compresi nell\'attivo circolante', tipo: 'conto', segno: +1, editabile: true }
          ]
        },
        { id: 'ce.B.11', label: '11. Variazioni delle rimanenze di materie prime, sussidiarie, di consumo e merci', tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.B.12', label: '12. Accantonamenti per rischi',      tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.B.13', label: '13. Altri accantonamenti',           tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.B.14', label: '14. Oneri diversi di gestione',      tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'ce.AB', label: 'Differenza tra valore e costi della produzione (A − B)',
      tipo: 'totale', segno: +1, computed: true,
      somma: ['ce.A', 'ce.B'],
      note: 'EBIT operativo civilistico'
    },
    {
      id: 'ce.C', label: 'C. Proventi e oneri finanziari', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'ce.C.15',   label: '15. Proventi da partecipazioni',                tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.C.16',   label: '16. Altri proventi finanziari',                 tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.C.17',   label: '17. Interessi e altri oneri finanziari',        tipo: 'conto', segno: -1, editabile: true },
        { id: 'ce.C.17b',  label: '17-bis. Utili e perdite su cambi',              tipo: 'conto', segno: +1, editabile: true }
      ]
    },
    {
      id: 'ce.D', label: 'D. Rettifiche di valore di attività e passività finanziarie', tipo: 'mastro', segno: +1, computed: true,
      children: [
        { id: 'ce.D.18', label: '18. Rivalutazioni', tipo: 'conto', segno: +1, editabile: true },
        { id: 'ce.D.19', label: '19. Svalutazioni',  tipo: 'conto', segno: -1, editabile: true }
      ]
    },
    {
      id: 'ce.ANTE_IMP', label: 'Risultato prima delle imposte',
      tipo: 'totale', segno: +1, computed: true,
      somma: ['ce.AB', 'ce.C', 'ce.D']
    },
    {
      id: 'ce.IMP', label: '20. Imposte sul reddito dell\'esercizio, correnti, differite e anticipate',
      tipo: 'mastro', segno: -1, computed: false, editabile: true
    },
    {
      id: 'ce.UTILE', label: '21. Utile (perdita) dell\'esercizio',
      tipo: 'totale', segno: +1, computed: true,
      somma: ['ce.ANTE_IMP', 'ce.IMP']
    }
  ];

  /* ──────────────────────────────────────────────────────────
     STRUTTURA RAPIDA — aggregati per modalità "rapida"
     ────────────────────────────────────────────────────────── */

  /** Mappatura: nodi visibili in modalità rapida (id sottomastro o mastro aggregato). */
  const SP_RAPIDA_ATTIVO  = ['sp.A', 'sp.BI', 'sp.BII', 'sp.BIII', 'sp.CI', 'sp.CII', 'sp.CIII', 'sp.CIV', 'sp.D_att'];
  const SP_RAPIDA_PASSIVO = ['sp.PN', 'sp.B_pass', 'sp.C_pass', 'sp.D_pass', 'sp.E_pass'];
  const CE_RAPIDA         = ['ce.A', 'ce.B.6', 'ce.B.7', 'ce.B.8', 'ce.B.9', 'ce.B.10', 'ce.B.11', 'ce.B.12', 'ce.B.13', 'ce.B.14', 'ce.C', 'ce.D', 'ce.IMP'];

  /* ──────────────────────────────────────────────────────────
     Utilità
     ────────────────────────────────────────────────────────── */

  /**
   * Cerca un nodo per id nell'albero (ricerca ricorsiva).
   * @param {string} id
   * @param {Array}  [tree] - se omesso cerca in SP_ATTIVO + SP_PASSIVO + CE
   * @returns {Object|null}
   */
  function trovaNodo(id, tree) {
    const alberi = tree ? [tree] : [SP_ATTIVO, SP_PASSIVO, CE, SP_COSTITUENDA];
    for (const radice of alberi) {
      for (const nodo of radice) {
        const trovato = _cerca(id, nodo);
        if (trovato) return trovato;
      }
    }
    return null;
  }

  function _cerca(id, nodo) {
    if (nodo.id === id) return nodo;
    if (nodo.children) {
      for (const figlio of nodo.children) {
        const trovato = _cerca(id, figlio);
        if (trovato) return trovato;
      }
    }
    return null;
  }

  /**
   * Restituisce tutti i nodi foglia (editabili) dell'albero, appiattiti.
   * @param {Array} tree
   * @returns {Array}
   */
  function foglieEditabili(tree) {
    const result = [];
    function visita(nodo) {
      if (nodo.editabile && !nodo.children) {
        result.push(nodo);
      }
      if (nodo.children) nodo.children.forEach(visita);
    }
    tree.forEach(visita);
    return result;
  }

  /**
   * Crea un oggetto dati vuoto con tutti gli id dei nodi foglia inizializzati a 0.
   * @param {Array} tree
   * @returns {Object}  { 'sp.CIV.1': 0, ... }
   */
  function creaDataVuoto(tree) {
    const obj = {};
    foglieEditabili(tree).forEach(n => { obj[n.id] = 0; });
    return obj;
  }

  /**
   * Determina se un nodo deve essere mostrato in modalità rapida.
   * @param {string} id
   * @param {'sp_attivo'|'sp_passivo'|'ce'} sezione
   * @returns {boolean}
   */
  function isVisibileRapida(id, sezione) {
    if (sezione === 'sp_attivo')  return SP_RAPIDA_ATTIVO.includes(id);
    if (sezione === 'sp_passivo') return SP_RAPIDA_PASSIVO.includes(id);
    if (sezione === 'ce')         return CE_RAPIDA.includes(id);
    return false;
  }

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    SP_ATTIVO,
    SP_PASSIVO,
    SP_COSTITUENDA,
    CE,
    SP_RAPIDA_ATTIVO,
    SP_RAPIDA_PASSIVO,
    CE_RAPIDA,
    trovaNodo,
    foglieEditabili,
    creaDataVuoto,
    isVisibileRapida
  };

})();
