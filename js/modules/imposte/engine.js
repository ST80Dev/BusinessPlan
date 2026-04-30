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
  function calcolaVariazioniAumento(progetto, regoleAnno, opzioni) {
    opzioni = opzioni || {};
    const rolOut = opzioni.rol || null;
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

    // RF15_col1: interessi passivi indeducibili da prospetto ROL (art. 96)
    if (rolOut) {
      dettaglio['RF15_col1'] = arr(num(rolOut.RF15_col1));
    } else {
      dettaglio['RF15_col1'] = 0;
      warnings.push({
        voce: 'RF15_col1',
        tipo: 'stub',
        msg: 'Interessi passivi indeducibili (art. 96): passare opzioni.rol per il calcolo.'
      });
    }

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
    const rolOut = opzioni.rol || null;
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

    // RF55_cod13: interessi passivi es. precedenti deducibili (art. 96 c. 5)
    if (rolOut) {
      dettaglio['RF55_cod13'] = arr(num(rolOut.RF55_cod13));
    } else {
      dettaglio['RF55_cod13'] = 0;
      warnings.push({
        voce: 'RF55_cod13',
        tipo: 'stub',
        msg: 'Interessi passivi es. precedenti deducibili (art. 96): passare opzioni.rol per il calcolo.'
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
  // ROL e interessi passivi (art. 96 TUIR)
  // -------------------------------------------------------------------------

  /**
   * Calcola il ROL fiscale e la deducibilità degli interessi passivi
   * secondo l'art. 96 TUIR. Vedi specifica §6.
   *
   * Input letti dal progetto:
   *   - progetto.ires.rol_input.ip_anno         interessi passivi a CE (C17)
   *   - progetto.ires.rol_input.ia_anno         interessi attivi a CE (C16)
   *   - progetto.ires.rol_input.valori_a_b_fiscali.{A,B,amm_immateriali,amm_materiali,canoni_leasing}
   *     (componenti del ROL fiscale)
   *   - progetto.storico.interessi_passivi_riporto  riporto IP indeducibili
   *   - progetto.storico.rol_riporto                 eccedenza ROL es. precedenti
   *
   * Output rilevanti per il quadro RF:
   *   - RF15_col1 = MAX(0, IP_indeducibili_totali − IP_riporto_es_prec)
   *                 (importo "nuovo" indeducibile generato dall'anno corrente)
   *   - RF55_cod13 = se IP_riporto > 0 e ROL ha capienza che supera l'IP
   *                  dell'anno → quota di IP del passato dedotta
   *
   * Riporti a nuovo per l'anno successivo:
   *   - ip_indeducibili_riporto_a_nuovo  (RF121 col.3)
   *   - rol_residuo_riporto_a_nuovo      (RF120 col.3)
   *
   * @param {object} progetto
   * @param {object} regoleAnno
   * @returns {object}
   */
  function calcolaRol(progetto, regoleAnno) {
    const ires = progetto.ires || {};
    const rolIn = ires.rol_input || {};
    const valFisc = rolIn.valori_a_b_fiscali || {};
    const storico = progetto.storico || {};

    const pctRol = num(regoleAnno.ires && regoleAnno.ires.rol && regoleAnno.ires.rol.pct_deducibile) || 0.30;

    const ipAnno = num(rolIn.ip_anno);
    const iaAnno = num(rolIn.ia_anno);
    const ipRiporto = num(storico.interessi_passivi_riporto);
    const rolRiporto = num(storico.rol_riporto);

    // ROL fiscale (semplificato sui componenti più frequenti)
    const A = num(valFisc.A);
    const B = num(valFisc.B);
    const amm_imm = num(valFisc.amm_immateriali);
    const amm_mat = num(valFisc.amm_materiali);
    const canoni = num(valFisc.canoni_leasing);
    const dividendi_estere = num(valFisc.dividendi_controllate_estere);
    const altri = num(valFisc.altri_componenti_periodi_precedenti);
    const rolFiscale = arr(A - B + amm_imm + amm_mat + canoni + dividendi_estere + altri);

    // Algoritmo art. 96
    // 1) Quota deducibile direttamente da interessi attivi
    const ipPlusRiporto = ipAnno + ipRiporto;
    const ipDiretti = arr(Math.min(ipPlusRiporto, iaAnno));        // RF118 col.5
    const ipEccedenza = arr(Math.max(0, ipPlusRiporto - iaAnno));   // RF118 col.6

    // 2) Capienza ROL e dedotti ulteriormente
    const rol30 = arr(Math.max(0, rolFiscale) * pctRol);
    const capacitaRol = arr(rolRiporto + rol30);
    const ipDedottiDaRol = arr(Math.min(capacitaRol, ipEccedenza));
    const ipDeducibiliTot = arr(ipDiretti + ipDedottiDaRol);

    // 3) Riporti a nuovo per l'anno successivo
    const ipIndeducibiliRiporto = arr(Math.max(0, ipEccedenza - ipDedottiDaRol));   // RF121 col.3
    const rolResiduoRiporto = arr(Math.max(0, capacitaRol - ipEccedenza));          // RF120 col.3

    // 4) Output per il quadro RF
    //    Replica le formule del foglio Excel cliente:
    //      RF15_col1 = MAX(0, IP_indeducibili_totali − IP_riporto_es_prec)
    //      RF55_cod13 = se IP_riporto>0 e IP_deducibili_tot > IP_anno → la differenza
    const RF15_col1 = arr(Math.max(0, ipIndeducibiliRiporto - ipRiporto));
    const RF55_cod13 = (ipRiporto > 0)
      ? arr(Math.max(0, ipDeducibiliTot - ipAnno))
      : 0;

    return {
      rol_fiscale: rolFiscale,
      ip_anno: arr(ipAnno),
      ia_anno: arr(iaAnno),
      ip_riporto_es_prec: arr(ipRiporto),
      rol_riporto_es_prec: arr(rolRiporto),
      ip_diretti: ipDiretti,
      ip_eccedenza: ipEccedenza,
      rol_30pct: rol30,
      capacita_rol: capacitaRol,
      ip_dedotti_da_rol: ipDedottiDaRol,
      ip_deducibili_totali: ipDeducibiliTot,
      ip_indeducibili_riporto_a_nuovo: ipIndeducibiliRiporto,
      rol_residuo_riporto_a_nuovo: rolResiduoRiporto,
      RF15_col1: RF15_col1,
      RF55_cod13: RF55_cod13
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
   *     gli stub IRAP. Se assente, vengono trattati come 0 con warning.
   *   - opzioni.rol: output di calcolaRol() con RF15_col1 e RF55_cod13.
   *     Se assente, vengono trattati come 0 con warning.
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

    // 1) Variazioni in aumento e diminuzione: le opzioni propagano gli output
    //    di motore IRAP (deduzioneIrapDaIres) e motore ROL (rol) per chiudere
    //    gli stub RF15_col1 / RF55_cod12 / RF55_cod13 / RF55_cod33.
    const varAum = calcolaVariazioniAumento(progetto, regoleAnno, opzioni);
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
   * Calcolo completo del progetto: IRAP, deduzione IRAP da IRES, ROL, IRES.
   *
   * Sequenza coerente con la specifica §6, §10, §12:
   *   1) IRAP — non dipende da IRES né da ROL
   *   2) Deduzione IRAP da IRES — dipende da output IRAP
   *   3) ROL (art. 96) — non dipende da IRES (lavora su CE e storico)
   *   4) IRES — dipende da entrambi gli output sopra (per chiudere gli stub
   *      RF15_col1, RF55_cod12/13/33)
   *
   * @param {object} progetto
   * @param {object} regoleAnno
   * @param {object} aliquoteIrap
   * @returns {{ irap: object, deduzione_irap_da_ires: object, rol: object, ires: object }}
   */
  function calcoloCompleto(progetto, regoleAnno, aliquoteIrap) {
    const irap = calcoloIrap(progetto, regoleAnno, aliquoteIrap);
    const dedIrapDaIres = calcolaDeduzioneIrapDaIres(progetto, irap, regoleAnno);
    const rol = calcolaRol(progetto, regoleAnno);
    const ires = calcoloIres(progetto, regoleAnno, {
      deduzioneIrapDaIres: dedIrapDaIres,
      rol: rol
    });
    return {
      irap: irap,
      deduzione_irap_da_ires: dedIrapDaIres,
      rol: rol,
      ires: ires
    };
  }

  // -------------------------------------------------------------------------
  // Chiusura anno e generazione progetto N+1
  // -------------------------------------------------------------------------

  /** Clone profondo via JSON. Sufficiente per progetti (no funzioni, no Date). */
  function deepClone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
  }

  /** Restituisce la data odierna in formato "YYYY-MM-DD". */
  function isoToday() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const g = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + g;
  }

  /**
   * Determina se l'anno N è entro i primi 3 esercizi dalla costituzione.
   * Assume "primo esercizio" = anno della data_costituzione.
   * Se data_costituzione manca, ritorna false (perdita andrà a limitate, scelta conservativa).
   */
  function isEntroPrimi3Esercizi(annoN, dataCostituzione, regoleAnno) {
    if (!dataCostituzione) return false;
    const annoCost = parseInt(String(dataCostituzione).slice(0, 4), 10);
    if (!annoCost || isNaN(annoCost)) return false;
    const nMax = num(regoleAnno && regoleAnno.ires && regoleAnno.ires.perdite && regoleAnno.ires.perdite.perdite_piene_n_esercizi_iniziali) || 3;
    return (annoN - annoCost) < nMax;
  }

  /**
   * Aggiorna l'array delle plusvalenze rateizzate dopo la chiusura dell'anno N.
   * Per ogni entry attiva nell'anno N (non esaurita), aggiunge la quota imputata
   * a `imputate`. Filtra via le entry esaurite.
   */
  function aggiornaPlusvalenze(arrPlus, annoN) {
    const out = [];
    for (const p of (arrPlus || [])) {
      const annoReal = num(p.anno_realizzo);
      const importo = num(p.importo);
      const rate = Math.max(1, Math.min(5, num(p.rate) || 1));
      const quota = importo / rate;
      const imputate = Array.isArray(p.imputate) ? p.imputate.slice() : [];

      // Era attiva nell'anno N? Lo è se annoN ∈ [annoReal, annoReal + rate − 1]
      const attivaInN = (annoReal > 0 && annoN >= annoReal && annoN < annoReal + rate);
      if (attivaInN && imputate.length < rate) {
        imputate.push(arr(quota));
      }

      // Mantengo l'entry solo se ha ancora almeno un anno di attività
      // futura (annoReal + rate - 1 > annoN) E non ha già esaurito tutte
      // le rate. Le entry temporalmente concluse o esaurite vengono scartate.
      const ultimoAnnoAttivo = annoReal + rate - 1;
      if (ultimoAnnoAttivo > annoN && imputate.length < rate) {
        out.push({ anno_realizzo: annoReal, importo: arr(importo), rate: rate, imputate: imputate });
      }
    }
    return out;
  }

  /**
   * Aggiorna l'array delle manutenzioni eccedenti 5%.
   * Rimuove le entry "esaurite": quelle il cui ultimo esercizio di riporto è
   * stato l'anno N. Cioè entry con `anno + 5 ≤ N`.
   */
  function aggiornaManutenzioni(arrM, annoN) {
    const out = [];
    for (const m of (arrM || [])) {
      const annoForm = num(m.anno);
      const importo = num(m.importo);
      // Riporto in 5 esercizi successivi → ultima quota matura nell'anno annoForm+5
      // Quando si chiude l'anno N: l'entry resta utile per N+1, N+2, ... finché annoForm+5 ≥ N+1
      if (annoForm > 0 && (annoForm + 5) >= (annoN + 1)) {
        out.push({ anno: annoForm, importo: arr(importo) });
      }
    }
    return out;
  }

  /**
   * Costruisce il blocco "lavoro_irap" per l'anno N+1 a partire da quello di N.
   * Shift: anno_corrente → anno_precedente; nuovi anno_corrente azzerati.
   * Aggiunge anche base_imp_irap_anno_prec e saldo_irap_anno_prec_versato
   * usando l'output del calcolo dell'anno chiuso.
   */
  function costruisciLavoroIrapAnnoSuccessivo(lavN, calcoloOutput) {
    lavN = lavN || {};
    const irap = (calcoloOutput && calcoloOutput.irap) || {};
    return {
      costo_dip_indeterminato_anno: 0,
      costo_dip_indeterminato_anno_prec: num(lavN.costo_dip_indeterminato_anno),
      costo_amm_cocoo_anno: 0,
      costo_amm_cocoo_anno_prec: num(lavN.costo_amm_cocoo_anno),
      // Saldo IRAP appena chiuso → diventa "anno precedente" per il calcolo
      // successivo della deduzione IRAP da IRES (quota analitica + forfait 10%).
      // Solo la parte effettivamente versata: se a credito, è 0.
      saldo_irap_anno_prec_versato: arr(Math.max(0, num(irap.saldo_irap))),
      acconti_irap_anno_versati: 0,
      base_imp_irap_anno_prec: arr(num(irap.imponibile_irap)),
      deduzioni_irap_anno_prec_no_occupazionali: arr(
        num(irap.deduzioni && irap.deduzioni.IS1) +
        num(irap.deduzioni && irap.deduzioni.IS4) +
        num(irap.deduzioni && irap.deduzioni.IC75)
      )
    };
  }

  /**
   * Azzera ricorsivamente i numeri di un oggetto annidato, preservando le chiavi.
   * Stringhe, booleani e oggetti complessi (es. liste) vengono lasciati ai default
   * (stringhe vuote / false / array vuoti).
   */
  function azzeraNumeri(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return [];
    if (typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = azzeraNumeri(obj[k]);
      return out;
    }
    if (typeof obj === 'number') return 0;
    if (typeof obj === 'string') return '';
    if (typeof obj === 'boolean') return false;
    return obj;
  }

  /**
   * Chiude l'anno N e genera il progetto per l'anno N+1.
   *
   * Restituisce due oggetti:
   *  - progettoChiuso: clone del progetto in input con `meta.chiuso = true`
   *    e `calcoli` popolato con l'output di calcoloCompleto (snapshot
   *    immutabile del calcolo dell'anno chiuso).
   *  - progettoNuovoAnno: nuovo progetto per l'anno N+1, pre-popolato con
   *    lo `storico` aggiornato (riporti perdite, ACE, ROL/IP, plus,
   *    manutenzioni, crediti d'imposta) e con tutte le voci di input
   *    azzerate.
   *
   * @param {object} progetto
   * @param {object} calcoloOutput - output di calcoloCompleto()
   * @param {object} regoleAnno
   * @returns {{ progettoChiuso: object, progettoNuovoAnno: object }}
   */
  function chiudiAnno(progetto, calcoloOutput, regoleAnno) {
    if (!progetto || !calcoloOutput || !regoleAnno) {
      throw new Error('chiudiAnno: progetto, calcoloOutput e regoleAnno sono obbligatori');
    }

    const annoN = num((progetto.meta || {}).anno_imposta) || num(regoleAnno.anno_imposta);
    if (annoN <= 0) {
      throw new Error('chiudiAnno: anno_imposta non valido nel progetto');
    }
    const annoN1 = annoN + 1;
    const oggi = isoToday();

    const ires = calcoloOutput.ires || {};
    const irap = calcoloOutput.irap || {};
    const rol = calcoloOutput.rol || {};
    const ace = ires.ace || {};
    const perdite = ires.perdite || {};

    // 1) Progetto chiuso = clone con meta.chiuso, calcoli salvati
    const progettoChiuso = deepClone(progetto);
    progettoChiuso.meta = progettoChiuso.meta || {};
    progettoChiuso.meta.chiuso = true;
    progettoChiuso.meta.modificato = oggi;
    progettoChiuso.meta.stato = 'chiuso';
    progettoChiuso.calcoli = deepClone(calcoloOutput);

    // 2) Storico aggiornato per l'anno N+1
    const storicoN = progetto.storico || {};

    // 2a) Plusvalenze rateizzate
    const plusN1 = aggiornaPlusvalenze(storicoN.plusvalenze_rateizzate, annoN);

    // 2b) Manutenzioni eccedenti 5%
    const manutN1 = aggiornaManutenzioni(storicoN.manutenzioni_eccedenti_5pct, annoN);

    // 2c) Riporti ROL e interessi passivi
    const ipRiportoN1 = arr(num(rol.ip_indeducibili_riporto_a_nuovo));
    const rolRiportoN1 = arr(num(rol.rol_residuo_riporto_a_nuovo));

    // 2d) Perdite
    //     - Decremento stock con i residui post-utilizzo del calcolo
    //     - Aggiunta nuova perdita se l'anno N è chiuso in perdita
    let pieneN1 = (perdite.stock_piene_residue || []).map(p => ({ anno: num(p.anno), importo: arr(num(p.importo)) }))
                                                       .filter(p => p.importo > 0);
    let limitateN1 = (perdite.stock_limitate_residue || []).map(p => ({ anno: num(p.anno), importo: arr(num(p.importo)) }))
                                                            .filter(p => p.importo > 0);
    const perditaAnno = num(perdite.perdita_anno);
    if (perditaAnno > 0) {
      const dataCost = (progetto.meta || {}).data_costituzione;
      if (isEntroPrimi3Esercizi(annoN, dataCost, regoleAnno)) {
        pieneN1.push({ anno: annoN, importo: arr(perditaAnno) });
      } else {
        limitateN1.push({ anno: annoN, importo: arr(perditaAnno) });
      }
    }

    // 2e) ACE
    const aceN1 = arr(num(ace.residua_a_nuovo));

    // 2f) Crediti d'imposta residui (solo se saldo a credito)
    const saldoIres = num(ires.saldo_ires);
    const saldoIrap = num(irap.saldo_irap);
    const credIresN1 = arr(Math.max(0, -saldoIres));
    const credIrapN1 = arr(Math.max(0, -saldoIrap));

    const storicoN1 = {
      plusvalenze_rateizzate: plusN1,
      manutenzioni_eccedenti_5pct: manutN1,
      interessi_passivi_riporto: ipRiportoN1,
      rol_riporto: rolRiportoN1,
      perdite_piene: pieneN1,
      perdite_limitate: limitateN1,
      ace_residua: aceN1,
      credito_ires_residuo: credIresN1,
      credito_irap_residuo: credIrapN1
    };

    // 3) Costruisco progetto nuovo anno N+1
    const meta = progetto.meta || {};
    const flag = progetto.flag || {};

    // Per le sezioni IRES/IRAP/CE/CPB/lavoro_irap parto dalla shape esistente
    // e azzero i numeri, in modo da preservare eventuali campi custom.
    const ceN1 = azzeraNumeri(progetto.ce || {});
    const iresN1 = azzeraNumeri(progetto.ires || {});
    const irapN1 = azzeraNumeri(progetto.irap || {});
    const cpbN1 = azzeraNumeri(progetto.cpb || {});

    // Crediti residui dall'anno chiuso entrano come credito_anno_prec_residuo
    if (iresN1 && typeof iresN1 === 'object') {
      iresN1.credito_anno_prec_residuo = credIresN1;
    }
    if (irapN1 && typeof irapN1 === 'object') {
      irapN1.credito_anno_prec_residuo = credIrapN1;
    }

    const lavoroIrapN1 = costruisciLavoroIrapAnnoSuccessivo(progetto.lavoro_irap, calcoloOutput);

    const progettoNuovoAnno = {
      meta: Object.assign({}, meta, {
        anno_imposta: annoN1,
        anno_versamento: annoN1 + 1,
        creato: oggi,
        modificato: oggi,
        stato: 'in_lavorazione',
        chiuso: false
      }),
      flag: deepClone(flag),
      ce: ceN1,
      lavoro_irap: lavoroIrapN1,
      ires: iresN1,
      irap: irapN1,
      cpb: cpbN1,
      storico: storicoN1
    };

    return { progettoChiuso: progettoChiuso, progettoNuovoAnno: progettoNuovoAnno };
  }

  global.ImposteEngine = {
    calcoloIres: calcoloIres,
    calcoloIrap: calcoloIrap,
    calcolaDeduzioneIrapDaIres: calcolaDeduzioneIrapDaIres,
    calcolaRol: calcolaRol,
    calcoloCompleto: calcoloCompleto,
    chiudiAnno: chiudiAnno,
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
      risolviAliquotaIrap: risolviAliquotaIrap,
      calcolaRol: calcolaRol,
      aggiornaPlusvalenze: aggiornaPlusvalenze,
      aggiornaManutenzioni: aggiornaManutenzioni,
      isEntroPrimi3Esercizi: isEntroPrimi3Esercizi,
      costruisciLavoroIrapAnnoSuccessivo: costruisciLavoroIrapAnnoSuccessivo
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
