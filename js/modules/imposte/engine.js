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
  function calcolaVariazioniDiminuzione(progetto, regoleAnno) {
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

    // RF55_cod12, cod13, cod33: STUB (richiedono motore IRAP / ROL)
    dettaglio['RF55_cod12'] = 0;
    dettaglio['RF55_cod13'] = 0;
    dettaglio['RF55_cod33'] = 0;
    warnings.push({
      voce: 'RF55_cod12',
      tipo: 'stub',
      msg: 'IRAP 10% oneri finanziari: richiede motore IRAP. Verrà implementato nelle PR successive.'
    });
    warnings.push({
      voce: 'RF55_cod13',
      tipo: 'stub',
      msg: 'Interessi passivi es. precedenti: richiede motore ROL (art. 96). Verrà implementato nelle PR successive.'
    });
    warnings.push({
      voce: 'RF55_cod33',
      tipo: 'stub',
      msg: 'IRAP analitica costo personale: richiede motore IRAP. Verrà implementato nelle PR successive.'
    });

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
  // Entry point: calcoloIres
  // -------------------------------------------------------------------------

  /**
   * Calcola l'IRES e i suoi parziali a partire dal progetto.
   *
   * @param {object} progetto - oggetto progetto secondo schema §17
   * @param {object} regoleAnno - regole-anno-<YYYY>.json
   * @returns {object} risultato con tutti i parziali e gli output finali
   */
  function calcoloIres(progetto, regoleAnno) {
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

    // 1) Variazioni in aumento e diminuzione
    const varAum = calcolaVariazioniAumento(progetto, regoleAnno);
    const varDim = calcolaVariazioniDiminuzione(progetto, regoleAnno);
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
  global.ImposteEngine = {
    calcoloIres: calcoloIres,
    // sotto-funzioni esposte per test e per uso da altri motori (IRAP, CPB)
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
      calcolaRedditoCpbRettificato: calcolaRedditoCpbRettificato
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
