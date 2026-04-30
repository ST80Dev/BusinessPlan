/**
 * Motore di calcolo del modulo Imposte.
 *
 * Implementa il flusso di calcolo dell'IRES (e successivamente IRAP, CPB,
 * deduzione IRAP da IRES, acconti) per SRL ordinarie. Le regole sono
 * parametrate dal file data/imposte/regole-anno-<YYYY>.json (caricato via
 * regole-loader.js).
 *
 * Indipendente da UI: opera su un oggetto progetto secondo lo schema
 * descritto in caratteristiche_modulo_imposte.md §17.
 *
 * Stato implementativo (2026-04-30):
 *   - calcoloIres()   IMPLEMENTATO (variazioni RF, perdite, ACE, IRES
 *                     lorda/netta/dovuta, saldo, acconti, trasparente, CPB sez.II).
 *                     STUB: voci automatiche dipendenti da ROL/IRAP
 *                     (RF15_col1, RF55_cod12, RF55_cod13, RF55_cod33) → 0.
 *   - calcoloIrap()   da implementare (PR successive)
 *   - calcoloCpbSostitutiva() da implementare
 *   - calcoloDeduzioneIrapDaIres() da implementare
 *   - chiudiAnno()    da implementare
 */
(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // Helper numerici
  // -------------------------------------------------------------------------

  /** Converte a numero, con fallback 0 per null/undefined/NaN/stringhe non numeriche. */
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  /** Somma i valori di una mappa { key: number }, ignorando i non-numerici. */
  function sommaMappa(mappa) {
    if (!mappa || typeof mappa !== 'object') return 0;
    let tot = 0;
    for (const k of Object.keys(mappa)) {
      tot += num(mappa[k]);
    }
    return tot;
  }

  /** Arrotonda a `n` decimali (default 2). Evita errori di floating point. */
  function arr(v, n) {
    n = (n === undefined) ? 2 : n;
    const f = Math.pow(10, n);
    return Math.round(num(v) * f) / f;
  }

  // -------------------------------------------------------------------------
  // Lettura dello storico pluriennale
  // -------------------------------------------------------------------------

  /**
   * Quote di plusvalenze rateizzate che maturano nell'anno corrente.
   * - quoteAnnoCorrente: importo che si aggiunge a RF7 (variazione in aumento)
   *   per le plusvalenze realizzate proprio nell'anno
   * - quoteAnniPrecedenti: importo che va in RF34 (variazione in diminuzione)
   *   come rate di plusvalenze realizzate negli anni precedenti
   *
   * Nota: il modello del foglio Excel cliente tratta diversamente la
   * componente "anno corrente" (già a CE come plusvalenza, ma rateizzata)
   * vs la componente "anni precedenti" (entra come ripresa). Per ora il
   * motore espone entrambe le quote separate.
   */
  function quotePlusvalenzeAnno(storico, annoCorrente) {
    const out = { quotaAnnoCorrente: 0, quoteAnniPrecedenti: 0 };
    const arrPlus = (storico && Array.isArray(storico.plusvalenze_rateizzate))
      ? storico.plusvalenze_rateizzate : [];
    for (const p of arrPlus) {
      const importo = num(p.importo);
      const rate = Math.max(1, Math.min(5, num(p.rate) || 1));
      const quota = importo / rate;
      const annoReal = num(p.anno_realizzo);
      if (annoReal === annoCorrente) {
        out.quotaAnnoCorrente += quota;
      } else if (annoReal > 0 && annoReal < annoCorrente) {
        // Plusvalenza realizzata in passato: la quota matura solo per i primi
        // `rate` esercizi dall'anno di realizzo (incluso).
        if (annoCorrente < annoReal + rate) {
          out.quoteAnniPrecedenti += quota;
        }
      }
    }
    return out;
  }

  /**
   * Quote di manutenzioni eccedenti 5% degli anni precedenti che maturano
   * nell'anno corrente (RF55 codice 6).
   * L'eccedenza dell'anno corrente è inserita manualmente come input e
   * va a RF24 (gestita altrove).
   */
  function quoteManutenzioniAnniPrecedenti(storico, annoCorrente) {
    const arrM = (storico && Array.isArray(storico.manutenzioni_eccedenti_5pct))
      ? storico.manutenzioni_eccedenti_5pct : [];
    let tot = 0;
    for (const m of arrM) {
      const annoForm = num(m.anno);
      const importo = num(m.importo);
      // Riporto in 5 esercizi successivi a quello di formazione
      // (es. eccedenza 2023 → quote 2024,2025,2026,2027,2028).
      if (annoForm > 0 && annoCorrente > annoForm && annoCorrente <= annoForm + 5) {
        tot += importo / 5;
      }
    }
    return tot;
  }

  // -------------------------------------------------------------------------
  // Variazioni IRES
  // -------------------------------------------------------------------------

  /**
   * Calcola le variazioni in aumento.
   * Distingue le voci manuali (l'utente inserisce l'importo) dalle voci
   * automatiche (calcolate dal motore in base al progetto e allo storico).
   *
   * Voci automatiche AUMENTO:
   *   - RF7 = quote plusvalenze rateizzate dell'anno corrente
   *   - RF24 = eccedenza manutenzioni 5% dell'anno corrente (input manuale
   *            in storico.manutenzioni_eccedenti_5pct con anno = annoCorrente)
   *   - RF31_cod99_telefoniche = costo_totale × 20%
   *   - RF15_col1 = STUB (interessi indeducibili da ROL — vedi PR successive)
   */
  function calcolaVariazioniAumento(progetto, regoleAnno) {
    const ires = progetto.ires || {};
    const storico = progetto.storico || {};
    const annoCorrente = num((progetto.meta || {}).anno_imposta) || num(regoleAnno.anno_imposta);
    const va = ires.variazioni_aumento || {};

    const dettaglio = {};
    const warnings = [];

    // --- Voci manuali: copio gli importi inseriti dall'utente
    const idManualiAumento = [
      'RF6', 'RF8', 'RF9', 'RF10', 'RF11', 'RF12', 'RF13', 'RF14',
      'RF15_col2', 'RF16', 'RF17',
      'RF18_assicurazione_bollo', 'RF18_carburante', 'RF18_manutenzione',
      'RF19', 'RF20',
      'RF21_immobili', 'RF21_autovetture', 'RF21_altri',
      'RF22',
      'RF23_col1_vitto_alloggio_totale',
      'RF23_col2_rappresentanza_startup',
      'RF23_col2_altre_rappresentanza',
      'RF23_non_tracciabili',
      'RF25', 'RF27', 'RF30',
      'RF31_cod1', 'RF31_cod3', 'RF31_cod34', 'RF31_cod35',
      'RF31_cod41', 'RF31_cod56', 'RF31_cod99_sanzioni', 'RF31_cod99_altre'
    ];
    for (const id of idManualiAumento) {
      dettaglio[id] = num(va[id]);
    }

    // --- Voci automatiche

    // RF7: quote plusvalenze rateizzate dell'anno corrente
    const qPlus = quotePlusvalenzeAnno(storico, annoCorrente);
    dettaglio['RF7'] = arr(qPlus.quotaAnnoCorrente);

    // RF24: eccedenza manutenzioni 5% dell'anno corrente
    // Per convenzione cerchiamo l'entry in storico con anno=annoCorrente
    // (l'utente la registra al momento del calcolo dell'anno).
    let RF24 = 0;
    const arrM = (storico && Array.isArray(storico.manutenzioni_eccedenti_5pct))
      ? storico.manutenzioni_eccedenti_5pct : [];
    for (const m of arrM) {
      if (num(m.anno) === annoCorrente) RF24 += num(m.importo);
    }
    dettaglio['RF24'] = arr(RF24);

    // RF31_cod99_telefoniche: 20% del costo totale (input separato)
    const costoTel = num(va['RF31_cod99_telefoniche_costo_totale']);
    dettaglio['RF31_cod99_telefoniche'] = arr(costoTel * (regoleAnno.ires.telefoniche_indeducibili_pct || 0.20));
    // l'input "costo totale" è in input ma non è la variazione: conservo solo il 20%

    // RF15_col1: TODO — interessi passivi indeducibili (richiede ROL).
    dettaglio['RF15_col1'] = 0;
    warnings.push({
      voce: 'RF15_col1',
      tipo: 'stub',
      msg: 'Interessi passivi indeducibili (art. 96): non ancora calcolati. Implementazione ROL prevista in PR successiva.'
    });

    // Totale variazioni in aumento
    const totale = sommaMappa(dettaglio);

    return { dettaglio: dettaglio, totale: arr(totale), warnings: warnings };
  }

  /**
   * Calcola le variazioni in diminuzione.
   *
   * Voci automatiche DIMINUZIONE:
   *   - RF34 = quote plusvalenze rateizzate degli anni precedenti che maturano
   *   - RF43_vitto_rappresentanza = (RF23_col1 × 75%) + RF23_col2_altre
   *   - RF55_cod6 = quote manutenzioni 5% degli anni precedenti
   *   - RF55_cod12 = STUB (10% IRAP oneri finanziari)
   *   - RF55_cod13 = STUB (interessi pass. es. precedenti deducibili)
   *   - RF55_cod33 = STUB (IRAP analitica costo personale)
   */
  function calcolaVariazioniDiminuzione(progetto, regoleAnno, opzioni) {
    opzioni = opzioni || {};
    const dedIrap = opzioni.deduzioneIrapDaIres || null;
    const ipDeducibiliEsPrec = num(opzioni.interessiPassiviEsPrecedentiDeducibili);
    const ires = progetto.ires || {};
    const storico = progetto.storico || {};
    const annoCorrente = num((progetto.meta || {}).anno_imposta) || num(regoleAnno.anno_imposta);
    const vd = ires.variazioni_diminuzione || {};
    const va = ires.variazioni_aumento || {};

    const dettaglio = {};
    const warnings = [];

    // --- Voci manuali
    const idManualiDiminuz = [
      'RF36_RF38', 'RF39', 'RF40',
      'RF43_es_precedenti', 'RF44', 'RF46', 'RF47', 'RF50', 'RF53', 'RF54',
      'RF55_cod1', 'RF55_cod24',
      'RF55_cod50_57_79', 'RF55_cod55_59_75_76', 'RF55_cod66_67', 'RF55_cod99'
    ];
    for (const id of idManualiDiminuz) {
      dettaglio[id] = num(vd[id]);
    }

    // --- Voci automatiche

    // RF34: quote plusvalenze rateizzate degli anni precedenti
    const qPlus = quotePlusvalenzeAnno(storico, annoCorrente);
    dettaglio['RF34'] = arr(qPlus.quoteAnniPrecedenti);

    // RF43: spese vitto/alloggio e rappresentanza deducibili.
    // Formula da specifica §5.2 / Excel cliente:
    //   (RF23_col1_vitto_alloggio_totale × 75%) + RF23_col2_altre_rappresentanza
    const pctDed = regoleAnno.ires.rappresentanza_vitto_alloggio_deducibile_pct || 0.75;
    const vittoAllTot = num(va['RF23_col1_vitto_alloggio_totale']);
    const altraRappr = num(va['RF23_col2_altre_rappresentanza']);
    dettaglio['RF43_vitto_rappresentanza'] = arr((vittoAllTot * pctDed) + altraRappr);

    // RF55_cod6: quote manutenzioni 5% degli anni precedenti
    dettaglio['RF55_cod6'] = arr(quoteManutenzioniAnniPrecedenti(storico, annoCorrente));

    // RF55_cod12, cod33: derivano dal motore IRAP (se passato in opzioni)
    if (dedIrap) {
      dettaglio['RF55_cod12'] = arr(num(dedIrap.RF55_cod12));
      dettaglio['RF55_cod33'] = arr(num(dedIrap.RF55_cod33));
    } else {
      dettaglio['RF55_cod12'] = 0;
      dettaglio['RF55_cod33'] = 0;
      warnings.push({
        voce: 'RF55_cod12',
        tipo: 'stub',
        msg: 'IRAP 10% oneri finanziari: passare opzioni.deduzioneIrapDaIres dal motore IRAP per il calcolo.'
      });
      warnings.push({
        voce: 'RF55_cod33',
        tipo: 'stub',
        msg: 'IRAP analitica costo personale: passare opzioni.deduzioneIrapDaIres dal motore IRAP per il calcolo.'
      });
    }

    // RF55_cod13: richiede motore ROL (art. 96) — passato come opzione separata
    if (ipDeducibiliEsPrec > 0) {
      dettaglio['RF55_cod13'] = arr(ipDeducibiliEsPrec);
    } else {
      dettaglio['RF55_cod13'] = 0;
      warnings.push({
        voce: 'RF55_cod13',
        tipo: 'stub',
        msg: 'Interessi passivi es. precedenti: richiede motore ROL (art. 96). Verrà implementato nelle PR successive.'
      });
    }

    const totale = sommaMappa(dettaglio);
    return { dettaglio: dettaglio, totale: arr(totale), warnings: warnings };
  }

  // -------------------------------------------------------------------------
  // Perdite fiscali (art. 84 TUIR)
  // -------------------------------------------------------------------------

  /**
   * Applica le perdite pregresse al reddito lordo dell'anno.
   *
   * Ordine di utilizzo: perdite piene prima, poi perdite limitate
   * (decisione del committente, allineata al foglio Excel di riferimento;
   * la Circolare AdE 25/E del 16/06/2012 lascia libertà di scelta).
   *
   * @returns {{
   *   reddito_dopo_perdite: number,
   *   piene_usate: number,
   *   limitate_usate: number,
   *   perdita_anno: number,
   *   stock_piene_residue: Array,
   *   stock_limitate_residue: Array
   * }}
   */
  function applicaPerdite(redditoLordo, storico, regoleAnno) {
    const limitePctLimitate = num(regoleAnno.ires.perdite.limite_pct_perdite_limitate) || 0.80;

    // Cloni profondi degli stock (FIFO sull'anno di formazione)
    const piene = ((storico && storico.perdite_piene) || [])
      .map(p => ({ anno: num(p.anno), importo: num(p.importo) }))
      .filter(p => p.importo > 0)
      .sort((a, b) => a.anno - b.anno);
    const limitate = ((storico && storico.perdite_limitate) || [])
      .map(p => ({ anno: num(p.anno), importo: num(p.importo) }))
      .filter(p => p.importo > 0)
      .sort((a, b) => a.anno - b.anno);

    // Caso reddito ≤ 0 → la perdita d'anno va a stock limitate
    // (l'aggiunta a "piene" se entro i primi 3 esercizi è gestita in chiudiAnno).
    if (redditoLordo <= 0) {
      return {
        reddito_dopo_perdite: 0,
        piene_usate: 0,
        limitate_usate: 0,
        perdita_anno: -redditoLordo,
        stock_piene_residue: piene,
        stock_limitate_residue: limitate
      };
    }

    // 1) Uso perdite piene al 100%
    let residuo = redditoLordo;
    let pieneUsate = 0;
    for (const p of piene) {
      if (residuo <= 0) break;
      const uso = Math.min(p.importo, residuo);
      p.importo -= uso;
      residuo -= uso;
      pieneUsate += uso;
    }

    // 2) Uso perdite limitate, capate all'80% del reddito_lordo originario
    //    (al netto di quanto già coperto dalle piene per evitare doppio limite).
    const plafond80 = redditoLordo * limitePctLimitate;
    let capienzaResidua80 = Math.max(0, plafond80 - pieneUsate);
    let limitateUsate = 0;
    for (const p of limitate) {
      if (residuo <= 0 || capienzaResidua80 <= 0) break;
      const uso = Math.min(p.importo, residuo, capienzaResidua80);
      p.importo -= uso;
      residuo -= uso;
      capienzaResidua80 -= uso;
      limitateUsate += uso;
    }

    return {
      reddito_dopo_perdite: arr(residuo),
      piene_usate: arr(pieneUsate),
      limitate_usate: arr(limitateUsate),
      perdita_anno: 0,
      stock_piene_residue: piene.filter(p => p.importo > 0),
      stock_limitate_residue: limitate.filter(p => p.importo > 0)
    };
  }

  // -------------------------------------------------------------------------
  // ACE residua (art. 5 D.Lgs. 216/2023: ACE corrente abrogata, resta solo
  // l'eccedenza maturata in anni precedenti)
  // -------------------------------------------------------------------------

  function applicaAce(redditoDopoPerdite, storico) {
    const stockAce = num(storico && storico.ace_residua);
    if (stockAce <= 0 || redditoDopoPerdite <= 0) {
      return { utilizzata: 0, residua_a_nuovo: stockAce, imponibile: Math.max(0, redditoDopoPerdite) };
    }
    const utilizzata = Math.min(stockAce, redditoDopoPerdite);
    return {
      utilizzata: arr(utilizzata),
      residua_a_nuovo: arr(stockAce - utilizzata),
      imponibile: arr(redditoDopoPerdite - utilizzata)
    };
  }

  // -------------------------------------------------------------------------
  // CPB Sezione II — reddito concordato rettificato (sostituisce l'imponibile
  // calcolato dal quadro RF se il flag cpb_attivo è true)
  // -------------------------------------------------------------------------

  function calcolaRedditoCpbRettificato(progetto, regoleAnno) {
    const cpb = progetto.cpb || {};
    const minimo = num(regoleAnno.cpb && regoleAnno.cpb.reddito_minimo_concordato_rettificato) || 2000;
    const reddConc = num(cpb.reddito_concordato);
    const varAttive = num(cpb.var_attive);
    const varPassive = num(cpb.var_passive);
    const varNette = varAttive - varPassive;
    const calcolato = reddConc + varNette;
    return arr(Math.max(minimo, calcolato));
  }

  // -------------------------------------------------------------------------
  // Acconti IRES (metodo storico)
  // -------------------------------------------------------------------------

  /**
   * Calcola I e II acconto IRES dato l'imposta dovuta dell'anno corrente
   * (metodo storico). Vedi specifica §11 e regole-anno.
   *
   * @returns {{ acconto_1: number, acconto_2: number }}
   */
  function calcolaAcconti(impostaDovuta, soggettoIsa, regoleAnno) {
    const reg = regoleAnno.acconti || {};
    const soglia = num(reg.soglia_minima) || 103;
    const dov = num(impostaDovuta);

    if (dov <= 0) return { acconto_1: 0, acconto_2: 0 };

    if (soggettoIsa) {
      const pct1 = num(reg.isa && reg.isa.I_acconto_pct) || 0.50;
      const quota = dov * pct1;
      if (quota < soglia) {
        // Sotto soglia: I acconto saltato, II acconto = 100%
        return { acconto_1: 0, acconto_2: arr(dov) };
      }
      return { acconto_1: arr(quota), acconto_2: arr(dov - quota) };
    }

    const pct1 = num(reg.non_isa && reg.non_isa.I_acconto_pct) || 0.40;
    const pct2 = num(reg.non_isa && reg.non_isa.II_acconto_pct) || 0.60;
    const quota1 = dov * pct1;
    const quota2 = dov * pct2;
    if (quota1 < soglia) {
      return { acconto_1: 0, acconto_2: arr(quota2) };
    }
    return { acconto_1: arr(quota1), acconto_2: arr(quota2) };
  }

  // -------------------------------------------------------------------------
  // IRAP — Base imponibile lorda
  // -------------------------------------------------------------------------

  /**
   * Calcola la base imponibile IRAP lorda dai totali CE:
   *   base = A_totale - (B_totale - B9 - B10c - B10d - B12 - B13)
   * Riferimento: art. 5 D.Lgs. 446/1997, specifica §10.1.
   */
  function calcolaBaseIrapLorda(ce) {
    const A = num(ce.A_totale);
    const B = num(ce.B_totale);
    const B9 = num(ce.B9);
    const B10c = num(ce.B10c);
    const B10d = num(ce.B10d);
    const B12 = num(ce.B12);
    const B13 = num(ce.B13);
    return arr(A - (B - B9 - B10c - B10d - B12 - B13));
  }

  // -------------------------------------------------------------------------
  // IRAP — Variazioni in aumento (IC43-IC51)
  // -------------------------------------------------------------------------

  function calcolaVariazioniIrapAumento(progetto) {
    const irap = progetto.irap || {};
    const va = irap.variazioni_aumento || {};
    const iresAum = (progetto.ires && progetto.ires.variazioni_aumento) || {};

    const dettaglio = {};

    // Voci manuali
    const idManuali = [
      'IC43_compensi_amm', 'IC43_inps_amm', 'IC43_cassa_prev',
      'IC43_lav_aut_occ', 'IC43_cococo',
      'IC44', 'IC45', 'IC46_imu', 'IC48', 'IC49', 'IC50',
      'IC51_cod1', 'IC51_cod2', 'IC51_cod3', 'IC51_cod6'
    ];
    for (const id of idManuali) dettaglio[id] = num(va[id]);

    // IC51 cod.4 quota terreno = pari a RF21_immobili (input IRES)
    dettaglio['IC51_cod4_quota_terreno'] = num(iresAum.RF21_immobili);

    // IC51 cod.99 = somma di RF17 + RF19 + RF31_cod99_sanzioni + RF31_cod99_altre
    dettaglio['IC51_cod99_da_ires'] = arr(
      num(iresAum.RF17) +
      num(iresAum.RF19) +
      num(iresAum.RF31_cod99_sanzioni) +
      num(iresAum.RF31_cod99_altre)
    );

    return { dettaglio: dettaglio, totale: arr(sommaMappa(dettaglio)) };
  }

  // -------------------------------------------------------------------------
  // IRAP — Variazioni in diminuzione (IC53-IC57)
  // -------------------------------------------------------------------------

  function calcolaVariazioniIrapDiminuzione(progetto) {
    const irap = progetto.irap || {};
    const vd = irap.variazioni_diminuzione || {};

    const dettaglio = {};
    const idManuali = [
      'IC53', 'IC55', 'IC56',
      'IC57_cod3', 'IC57_cod4', 'IC57_cod6_7',
      'IC57_col16_patent_box', 'IC57_cod99'
    ];
    for (const id of idManuali) dettaglio[id] = num(vd[id]);

    return { dettaglio: dettaglio, totale: arr(sommaMappa(dettaglio)) };
  }

  // -------------------------------------------------------------------------
  // IRAP — Deduzioni dal valore della produzione (cuneo + forfait)
  // -------------------------------------------------------------------------

  /**
   * Deduzioni art. 11 D.Lgs. 446/1997.
   * Riceve il valore della produzione post-variazioni (IC64) per il calcolo
   * della deduzione forfettaria IC75.
   */
  function calcolaDeduzioniIrap(progetto, regoleAnno, vpPostVariazioni) {
    const irap = progetto.irap || {};
    const ded = irap.deduzioni || {};

    const IS1 = num(ded.IS1_inail);
    const IS4 = num(ded.IS4_apprendisti_disabili_rd);

    // IS5: 1850 × n_dipendenti, solo se ricavi < 400.000
    let IS5 = 0;
    const ded5 = ded.IS5_dipendenti_1850 || {};
    const ricavi = num(ded5.ricavi_totali);
    const nDip = num(ded5.n_dipendenti);
    const sogliaRicavi = num(regoleAnno.irap.deduzione_per_dipendente.soglia_ricavi_max);
    const importoPerDip = num(regoleAnno.irap.deduzione_per_dipendente.importo);
    if (ricavi > 0 && ricavi < sogliaRicavi && nDip > 0) {
      IS5 = arr(nDip * importoPerDip);
    }

    const IS7 = num(ded.IS7_costo_personale_indet);
    const IS9 = num(ded.IS9_eccedenze);

    const IS8 = arr(IS1 + IS4 + IS5 + IS7);
    const IS10 = arr(IS8 - IS9);

    // IC75: forfait €8.000 se VP_dopo_cuneo ≤ €180.759,91
    const sogliaVP = num(regoleAnno.irap.deduzione_forfettaria_base.soglia_VP_max);
    const importoForfait = num(regoleAnno.irap.deduzione_forfettaria_base.importo);
    const vpDopoCuneo = vpPostVariazioni - IS1 - IS4 - IS5 - IS7;
    const IC75 = (vpDopoCuneo <= sogliaVP) ? importoForfait : 0;

    return {
      IS1: arr(IS1), IS4: arr(IS4), IS5: arr(IS5), IS7: arr(IS7), IS9: arr(IS9),
      IS8: IS8, IS10: IS10,
      IC75: arr(IC75),
      totale: arr(IS10 + IC75)
    };
  }

  // -------------------------------------------------------------------------
  // IRAP — Aliquota regionale risolta con fallback
  // -------------------------------------------------------------------------

  function risolviAliquotaIrap(progetto, regoleAnno, aliquoteIrap) {
    // 1) Override esplicito a livello di progetto
    const override = progetto.irap && progetto.irap.aliquota_override;
    if (typeof override === 'number' && override > 0) {
      return { aliquota: override, fonte: 'override_progetto', note: '' };
    }
    // 2) Tabella regionale
    const regione = (progetto.meta || {}).regione || '';
    const reg = (aliquoteIrap && aliquoteIrap.regioni && aliquoteIrap.regioni[regione]) || null;
    if (reg && typeof reg.ordinaria === 'number') {
      return { aliquota: reg.ordinaria, fonte: 'tabella_regione', note: reg._note || '' };
    }
    // 3) Fallback DEFAULT
    const def = (aliquoteIrap && aliquoteIrap.regioni && aliquoteIrap.regioni.DEFAULT) || null;
    if (def && typeof def.ordinaria === 'number') {
      return {
        aliquota: def.ordinaria,
        fonte: 'fallback_default',
        note: 'Regione "' + regione + '" non in tabella: applicata aliquota DEFAULT. Verificare aliquota effettiva.'
      };
    }
    // 4) Ultima risorsa: aliquota base nazionale dalle regole
    const base = num(regoleAnno.irap && regoleAnno.irap.aliquota_base_nazionale) || 0.039;
    return {
      aliquota: base,
      fonte: 'fallback_base_nazionale',
      note: 'Nessuna aliquota regionale trovata; applicata aliquota base nazionale 3,90%.'
    };
  }

  // -------------------------------------------------------------------------
  // Entry point: calcoloIrap
  // -------------------------------------------------------------------------

  /**
   * Calcola l'IRAP completa.
   *
   * @param {object} progetto - schema §17
   * @param {object} regoleAnno - regole-anno-<YYYY>.json
   * @param {object} aliquoteIrap - aliquote-irap-<YYYY>.json
   * @returns {object} risultato IRAP
   */
  function calcoloIrap(progetto, regoleAnno, aliquoteIrap) {
    if (!progetto || !regoleAnno) {
      throw new Error('calcoloIrap: progetto e regoleAnno sono obbligatori');
    }

    const ce = progetto.ce || {};
    const irap = progetto.irap || {};
    const flag = progetto.flag || {};
    const cpbAttivo = !!flag.cpb_attivo;

    const warnings = [];

    // 1) Base lorda dal CE
    const baseLorda = calcolaBaseIrapLorda(ce);

    // 2) Variazioni IC43-IC51 / IC53-IC57
    const varAum = calcolaVariazioniIrapAumento(progetto);
    const varDim = calcolaVariazioniIrapDiminuzione(progetto);

    // 3) VP post-variazioni (IC64)
    const vpPostVar = arr(baseLorda + varAum.totale - varDim.totale);

    // 4) Deduzioni cuneo + forfait
    const ded = calcolaDeduzioniIrap(progetto, regoleAnno, vpPostVar);

    // 5) Imponibile IRAP (IC76)
    //    - Se CPB attivo: forzato al "VP concordato rettificato" (IS250 col.4),
    //      con minimo €2.000.
    let imponibileIrap;
    if (cpbAttivo) {
      const cpb = progetto.cpb || {};
      const minimo = num(regoleAnno.cpb && regoleAnno.cpb.reddito_minimo_concordato_rettificato) || 2000;
      const calcolato = num(cpb.vp_concordato) + num(cpb.var_attive_irap) - num(cpb.var_passive_irap);
      imponibileIrap = arr(Math.max(minimo, calcolato));
      warnings.push({
        voce: 'cpb_irap',
        tipo: 'info',
        msg: 'CPB attivo: imponibile IRAP forzato a €' + imponibileIrap.toFixed(2) + ' (VP concordato rettificato).'
      });
    } else {
      imponibileIrap = arr(Math.max(0, vpPostVar - ded.totale));
    }

    // 6) Aliquota regionale e IRAP
    const aliq = risolviAliquotaIrap(progetto, regoleAnno, aliquoteIrap);
    if (aliq.fonte !== 'tabella_regione' && aliq.fonte !== 'override_progetto') {
      warnings.push({ voce: 'aliquota_irap', tipo: 'warn', msg: aliq.note });
    }
    const irapImposta = arr(imponibileIrap * aliq.aliquota);

    // 7) Saldo
    const creditoAnnoPrec = num(irap.credito_anno_prec_residuo);
    const accontiVersati = num(irap.acconti_versati);
    const irapDovuta = irapImposta;
    const saldoIrap = arr(irapDovuta - creditoAnnoPrec - accontiVersati);

    // 8) Acconti per l'anno successivo (stessa logica IRES)
    const isaAttivo = !!flag.soggetto_isa;
    const acconti = calcolaAcconti(irapDovuta, isaAttivo, regoleAnno);

    return {
      base_lorda: baseLorda,
      var_aumento: varAum,
      var_diminuzione: varDim,
      vp_post_variazioni: vpPostVar,
      deduzioni: ded,
      imponibile_irap: imponibileIrap,
      aliquota: aliq,
      irap: irapImposta,
      credito_anno_prec_residuo: arr(creditoAnnoPrec),
      acconti_versati: arr(accontiVersati),
      irap_dovuta: irapDovuta,
      saldo_irap: saldoIrap,
      acconto_1: acconti.acconto_1,
      acconto_2: acconti.acconto_2,
      warnings: warnings
    };
  }

  // -------------------------------------------------------------------------
  // Deduzione IRAP da IRES (RF55 cod.12 forfetaria + cod.33 analitica)
  // -------------------------------------------------------------------------

  /**
   * Calcola la deduzione IRAP dall'IRES nelle due forme cumulabili:
   *
   * (a) FORFETARIA RF55 cod.12 (10% IRAP su oneri finanziari):
   *     spetta SOLO se voce C) bilancio UE è negativa per l'anno di
   *     riferimento (saldo proventi-oneri < 0).
   *     - quota 2024: saldo_IRAP_2024_versato_2025 × 10%
   *     - quota 2025: MIN(acconti_IRAP_2025_versati × 10%, IRAP_competenza × 10%)
   *
   * (b) ANALITICA RF55 cod.33 (quota IRAP su costo lavoro):
   *     - rapporto = (CL_dip + CL_amm_cocoo - ded_IRAP_NON_occupazionali) / base_IRAP, cap 1
   *     - quota teorica = IRAP_versata × rapporto
   *     - quota massima = IRAP_versata - quota_forfait_corrispondente
   *     - deduzione = MAX(0, MIN(teorica, massima))
   *     Calcolata separatamente per saldo es. prec. e acconti es. corrente.
   *
   * Riferimento: art. 6 D.L. 185/2008, art. 2 D.L. 201/2011, specifica §12.
   *
   * @param {object} progetto
   * @param {object} irapCorrente - output di calcoloIrap() per l'anno corrente
   * @param {object} regoleAnno
   * @returns {{ RF55_cod12: number, RF55_cod33: number, dettaglio: object, warnings: Array }}
   */
  function calcolaDeduzioneIrapDaIres(progetto, irapCorrente, regoleAnno) {
    const ce = progetto.ce || {};
    const lav = progetto.lavoro_irap || {};
    const warnings = [];

    const pctForfait = num(regoleAnno.irap.deduzione_irap_da_ires.forfettaria_pct_oneri_finanziari) || 0.10;

    // --- (a) Forfetaria 10%: condizione su voce C) bilancio
    //     L'utente fornisce un singolo saldo `ce.C_saldo`. Se negativo, la
    //     deduzione spetta sia per il 2024 (saldo) sia per il 2025 (acconti).
    //     Se positivo, spetta 0 per entrambi gli anni.
    const cSaldo = num(ce.C_saldo);
    const condizioneForfait = (cSaldo < 0);
    if (!condizioneForfait) {
      warnings.push({
        voce: 'RF55_cod12',
        tipo: 'info',
        msg: 'Voce C) del CE non negativa: deduzione forfetaria 10% non spetta.'
      });
    }

    const saldoIrapAnnoPrec = num(lav.saldo_irap_anno_prec_versato);
    const accontiIrapAnno = num(lav.acconti_irap_anno_versati);
    const irapCompetenza = num(irapCorrente && irapCorrente.irap);

    let forfaitAnnoPrec = 0;
    let forfaitAnnoCorr = 0;
    if (condizioneForfait) {
      forfaitAnnoPrec = arr(saldoIrapAnnoPrec * pctForfait);
      // L'acconto può eccedere l'IRAP di competenza: la quota deducibile
      // è capata all'IRAP di competenza × 10%.
      const accontiCapped = Math.min(accontiIrapAnno, irapCompetenza);
      forfaitAnnoCorr = arr(accontiCapped * pctForfait);
    }
    const RF55_cod12 = arr(forfaitAnnoPrec + forfaitAnnoCorr);

    // --- (b) Analitica costo lavoro
    function rapportoCostoLavoro(clDip, clAmm, dedIrap, baseIrap) {
      const baseClav = clDip + clAmm - dedIrap;
      if (baseIrap <= 0 || baseClav <= 0) return 0;
      const r = baseClav / baseIrap;
      return r > 1 ? 1 : r;
    }

    const clDipPrec = num(lav.costo_dip_indeterminato_anno_prec);
    const clAmmPrec = num(lav.costo_amm_cocoo_anno_prec);
    const dedIrapPrec = num(lav.deduzioni_irap_anno_prec_no_occupazionali);
    const baseIrapPrec = num(lav.base_imp_irap_anno_prec);
    const rapportoPrec = rapportoCostoLavoro(clDipPrec, clAmmPrec, dedIrapPrec, baseIrapPrec);

    const teoricaPrec = saldoIrapAnnoPrec * rapportoPrec;
    const massimaPrec = saldoIrapAnnoPrec - forfaitAnnoPrec;
    const analiticaAnnoPrec = arr(Math.max(0, Math.min(teoricaPrec, massimaPrec)));

    // Anno corrente: rapporto da IRAP corrente
    const clDipCorr = num(lav.costo_dip_indeterminato_anno);
    const clAmmCorr = num(lav.costo_amm_cocoo_anno);
    // Le deduzioni "non occupazionali" sono IS1+IS4 (INAIL + apprendisti/disabili/R&S)
    // più la forfettaria IC75; le deduzioni "occupazionali" (IS5, IS7) sono escluse.
    const dedNonOcc = (irapCorrente && irapCorrente.deduzioni)
      ? num(irapCorrente.deduzioni.IS1) + num(irapCorrente.deduzioni.IS4) + num(irapCorrente.deduzioni.IC75)
      : 0;
    const baseIrapCorr = num(irapCorrente && irapCorrente.imponibile_irap);
    const rapportoCorr = rapportoCostoLavoro(clDipCorr, clAmmCorr, dedNonOcc, baseIrapCorr);

    const accontiCappedCorr = Math.min(accontiIrapAnno, irapCompetenza);
    const teoricaCorr = accontiCappedCorr * rapportoCorr;
    const massimaCorr = accontiCappedCorr - forfaitAnnoCorr;
    const analiticaAnnoCorr = arr(Math.max(0, Math.min(teoricaCorr, massimaCorr)));

    const RF55_cod33 = arr(analiticaAnnoPrec + analiticaAnnoCorr);

    return {
      RF55_cod12: RF55_cod12,
      RF55_cod33: RF55_cod33,
      dettaglio: {
        condizione_forfait: condizioneForfait,
        forfait_anno_prec: arr(forfaitAnnoPrec),
        forfait_anno_corr: arr(forfaitAnnoCorr),
        rapporto_anno_prec: arr(rapportoPrec, 4),
        rapporto_anno_corr: arr(rapportoCorr, 4),
        analitica_anno_prec: analiticaAnnoPrec,
        analitica_anno_corr: analiticaAnnoCorr
      },
      warnings: warnings
    };
  }

  // -------------------------------------------------------------------------
  // Entry point: calcoloIres
  // -------------------------------------------------------------------------

  /**
   * Calcola l'IRES e i suoi parziali a partire dal progetto.
   *
   * @param {object} progetto - oggetto progetto secondo schema §17
   * @param {object} regoleAnno - regole-anno-<YYYY>.json
   * @param {object} [opzioni] - parametri opzionali calcolati a monte
   *   - opzioni.deduzioneIrapDaIres: { RF55_cod12, RF55_cod33 } per chiudere
   *     gli stub. Se assente, vengono trattati come 0 con warning.
   *   - opzioni.interessiPassiviEsPrecentiDeducibili: numero per RF55_cod13.
   * @returns {object} risultato con tutti i parziali e gli output finali
   */
  function calcoloIres(progetto, regoleAnno, opzioni) {
    if (!progetto || !regoleAnno) {
      throw new Error('calcoloIres: progetto e regoleAnno sono obbligatori');
    }

    const annoImposta = num(progetto.meta && progetto.meta.anno_imposta) || num(regoleAnno.anno_imposta);
    const flag = progetto.flag || {};
    const ce = progetto.ce || {};
    const ires = progetto.ires || {};
    const storico = progetto.storico || {};
    const cpb = progetto.cpb || {};

    const utileAnte = num(ce.risultato_ante_imposte);
    const aliquotaIres = num(regoleAnno.ires && regoleAnno.ires.aliquota) || 0.24;
    const trasparente = !!flag.societa_trasparente;
    const cpbAttivo = !!flag.cpb_attivo;
    const isaAttivo = !!flag.soggetto_isa;

    const warnings = [];

    // 1) Variazioni in aumento e diminuzione (le diminuzioni accettano opzioni
    //    per chiudere gli stub RF55_cod12/13/33 quando passate dal motore IRAP/ROL)
    const varAum = calcolaVariazioniAumento(progetto, regoleAnno);
    const varDim = calcolaVariazioniDiminuzione(progetto, regoleAnno, opzioni);
    warnings.push.apply(warnings, varAum.warnings || []);
    warnings.push.apply(warnings, varDim.warnings || []);

    // 2) Reddito lordo (utile + variazioni)
    const redditoLordo = arr(utileAnte + varAum.totale - varDim.totale);

    // 3) Perdite pregresse
    const perdite = applicaPerdite(redditoLordo, storico, regoleAnno);

    // 4) ACE residua
    const ace = applicaAce(perdite.reddito_dopo_perdite, storico);

    // 5) Imponibile IRES
    //    - Se CPB attivo: imponibile = reddito concordato rettificato (sostituisce
    //      tutto il calcolo del quadro RF). L'ACE si applica comunque.
    //    - Se trasparente: l'imposta è in capo ai soci, IRES società = 0.
    let imponibileIres;
    if (cpbAttivo) {
      const redditoCpb = calcolaRedditoCpbRettificato(progetto, regoleAnno);
      imponibileIres = arr(Math.max(0, redditoCpb - ace.utilizzata));
      warnings.push({
        voce: 'cpb',
        tipo: 'info',
        msg: 'CPB attivo: imponibile IRES forzato a €' + redditoCpb.toFixed(2) + ' (reddito concordato rettificato).'
      });
    } else {
      imponibileIres = ace.imponibile;
    }

    // 6) IRES lorda/netta/dovuta
    const detrazioni = num(ires.detrazioni);
    const creditiERitenute = num(ires.crediti_e_ritenute);
    const creditoAnnoPrec = num(ires.credito_anno_prec_residuo);
    const accontiVersati = num(ires.acconti_versati);

    let iresLorda = arr(imponibileIres * aliquotaIres);
    let iresNetta = arr(Math.max(0, iresLorda - detrazioni));
    let iresDovuta = arr(Math.max(0, iresNetta - creditiERitenute));

    if (trasparente) {
      // Imposta non a carico società (art. 115 TUIR)
      iresLorda = 0;
      iresNetta = 0;
      iresDovuta = 0;
      warnings.push({
        voce: 'trasparente',
        tipo: 'info',
        msg: 'Società trasparente (art. 115 TUIR): IRES dovuta dalla società azzerata; imponibile va in capo ai soci.'
      });
    }

    // 7) Saldo IRES (a debito se positivo, a credito se negativo)
    const saldoIres = arr(iresDovuta - creditoAnnoPrec - accontiVersati);

    // 8) Acconti per l'anno successivo (calcolati sull'IRES dovuta corrente)
    const acconti = calcolaAcconti(iresDovuta, isaAttivo, regoleAnno);

    return {
      utile_ante_imposte: arr(utileAnte),
      anno_imposta: annoImposta,
      aliquota_ires: aliquotaIres,
      flag: {
        societa_trasparente: trasparente,
        cpb_attivo: cpbAttivo,
        soggetto_isa: isaAttivo
      },
      var_aumento: varAum,
      var_diminuzione: varDim,
      reddito_lordo: redditoLordo,
      perdite: perdite,
      ace: {
        utilizzata: ace.utilizzata,
        residua_a_nuovo: ace.residua_a_nuovo
      },
      imponibile_ires: imponibileIres,
      ires_lorda: iresLorda,
      detrazioni: arr(detrazioni),
      ires_netta: iresNetta,
      crediti_e_ritenute: arr(creditiERitenute),
      ires_dovuta: iresDovuta,
      credito_anno_prec_residuo: arr(creditoAnnoPrec),
      acconti_versati: arr(accontiVersati),
      saldo_ires: saldoIres,
      acconto_1: acconti.acconto_1,
      acconto_2: acconti.acconto_2,
      warnings: warnings
    };
  }

  // -------------------------------------------------------------------------
  // Esposizione globale
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Orchestratore: calcoloCompleto (IRAP → ded IRAP da IRES → IRES)
  // -------------------------------------------------------------------------

  /**
   * Calcolo completo del progetto: IRAP, deduzione IRAP da IRES, IRES.
   * Sequenza coerente con la specifica §12: l'IRAP non dipende dall'IRES,
   * la deduzione IRAP da IRES dipende dall'output IRAP, l'IRES dipende
   * dalla deduzione.
   *
   * @param {object} progetto
   * @param {object} regoleAnno
   * @param {object} aliquoteIrap
   * @returns {{ irap: object, deduzioneIrapDaIres: object, ires: object }}
   */
  function calcoloCompleto(progetto, regoleAnno, aliquoteIrap) {
    const irap = calcoloIrap(progetto, regoleAnno, aliquoteIrap);
    const dedIrapDaIres = calcolaDeduzioneIrapDaIres(progetto, irap, regoleAnno);
    const ires = calcoloIres(progetto, regoleAnno, {
      deduzioneIrapDaIres: dedIrapDaIres
      // interessiPassiviEsPrecentiDeducibili sarà aggiunto quando arriverà ROL
    });
    return { irap: irap, deduzione_irap_da_ires: dedIrapDaIres, ires: ires };
  }

  global.ImposteEngine = {
    calcoloIres: calcoloIres,
    calcoloIrap: calcoloIrap,
    calcolaDeduzioneIrapDaIres: calcolaDeduzioneIrapDaIres,
    calcoloCompleto: calcoloCompleto,
    // sotto-funzioni esposte per test
    _internal: {
      num: num,
      sommaMappa: sommaMappa,
      arr: arr,
      quotePlusvalenzeAnno: quotePlusvalenzeAnno,
      quoteManutenzioniAnniPrecedenti: quoteManutenzioniAnniPrecedenti,
      calcolaVariazioniAumento: calcolaVariazioniAumento,
      calcolaVariazioniDiminuzione: calcolaVariazioniDiminuzione,
      applicaPerdite: applicaPerdite,
      applicaAce: applicaAce,
      calcolaAcconti: calcolaAcconti,
      calcolaRedditoCpbRettificato: calcolaRedditoCpbRettificato,
      calcolaBaseIrapLorda: calcolaBaseIrapLorda,
      calcolaVariazioniIrapAumento: calcolaVariazioniIrapAumento,
      calcolaVariazioniIrapDiminuzione: calcolaVariazioniIrapDiminuzione,
      calcolaDeduzioniIrap: calcolaDeduzioniIrap,
      risolviAliquotaIrap: risolviAliquotaIrap
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
