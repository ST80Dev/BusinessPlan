/**
 * engine.js
 * Motore di calcolo previsionale mensile.
 *
 * Fase 2 — calcolaValore con supporto modalita rapida/analitica.
 * Il motore completo (proiezioni mensili) viene implementato in Fase 6.
 *
 * Dipende da: schema.js
 * Non dipende da: ui.js, projects.js
 */

'use strict';

const Engine = (() => {

  /**
   * Calcola il valore aggregato di un nodo (somma ricorsiva dei figli).
   * @param {Object} nodo           - nodo dello schema (mastro/sottomastro/totale)
   * @param {Object} dati           - oggetto { contoId: valore, ... }
   * @param {string} [modalita]     - 'rapida' | 'analitica' (default: 'analitica')
   * @param {Array}  [contiCustom]  - array di { id, parent_id, label } conti personalizzati
   * @returns {number}
   */
  function calcolaValore(nodo, dati, modalita, contiCustom) {
    if (!nodo) return 0;

    // Nodo totale con campo 'somma': somma dei nodi referenziati
    if (nodo.tipo === 'totale' && nodo.somma) {
      let tot = 0;
      for (const id of nodo.somma) {
        const ref = Schema.trovaNodo(id);
        if (ref) {
          const val = calcolaValore(ref, dati, modalita, contiCustom);
          tot += val * (ref.segno !== undefined ? ref.segno : 1);
        }
      }
      return tot;
    }

    // Nodo computed con figli
    if (nodo.computed && nodo.children) {
      // In modalita rapida, se il nodo ha un valore diretto nei dati, usalo
      if (modalita === 'rapida' && dati[nodo.id] !== undefined && dati[nodo.id] !== 0) {
        return dati[nodo.id];
      }
      // Somma ricorsiva dei figli (schema + custom)
      let tot = 0;
      for (const figlio of nodo.children) {
        const val = calcolaValore(figlio, dati, modalita, contiCustom);
        tot += val * (figlio.segno !== undefined ? figlio.segno : 1);
      }
      return tot;
    }

    // Nodo foglia: se ha conti custom, somma quelli; altrimenti valore diretto
    if (contiCustom && contiCustom.length > 0) {
      const figli = contiCustom.filter(function(cc) { return cc.parent_id === nodo.id; });
      if (figli.length > 0) {
        let tot = 0;
        for (const cc of figli) {
          tot += dati[cc.id] || 0;
        }
        return tot;
      }
    }

    return dati[nodo.id] || 0;
  }

  /* ──────────────────────────────────────────────────────────
     Calcolo personale per anno
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola i costi del personale per un anno dato, basato su organico.
   * @param {Object} personale - driver.personale del progetto
   * @param {number} anno      - anno di calcolo
   * @param {number} annoBase  - anno base del progetto
   * @returns {Object} { headcount_medio, salari, oneri, tfr, totale }
   */
  function calcolaPersonaleAnno(personale, anno, annoBase) {
    if (!personale || !personale.headcount) {
      return { headcount_medio: 0, headcount_fine: 0, salari: 0, oneri: 0, tfr: 0, totale: 0 };
    }

    var hcBase = personale.headcount;
    var ralMedia = personale.ral_media || 0;
    var coeffOneri = personale.coeff_oneri || 0.32;
    var variazioni = personale.variazioni_organico || [];
    var varRal = personale.var_ral_pct || {};

    // Calcola RAL media per l'anno corrente (con adeguamenti cumulativi)
    var ralAnno = ralMedia;
    for (var a = annoBase + 1; a <= anno; a++) {
      var pct = varRal[String(a)] || 0;
      ralAnno = ralAnno * (1 + pct);
    }

    // Calcola headcount mensile (12 mesi)
    // Parte dal headcount di fine anno precedente
    var hcInizio = hcBase;
    // Applica tutte le variazioni degli anni precedenti (effetto pieno)
    variazioni.forEach(function(v) {
      if (v.anno < anno) {
        hcInizio += (v.delta || 0);
      }
    });

    // Mese per mese nell'anno corrente
    var mesiHc = [];
    var hcCorrente = hcInizio;
    for (var m = 1; m <= 12; m++) {
      // Applica variazioni che entrano in vigore questo mese/anno
      variazioni.forEach(function(v) {
        if (v.anno === anno && v.da_mese === m) {
          hcCorrente += (v.delta || 0);
        }
      });
      mesiHc.push(Math.max(0, hcCorrente));
    }

    // Headcount medio e fine anno
    var sommaHc = 0;
    for (var k = 0; k < 12; k++) sommaHc += mesiHc[k];
    var hcMedio = sommaHc / 12;
    var hcFine = mesiHc[11];

    // Salari: somma mensile di (hc_mese × RAL / 12)
    var salari = 0;
    for (var j = 0; j < 12; j++) {
      salari += mesiHc[j] * ralAnno / 12;
    }
    salari = Math.round(salari);

    // Oneri sociali
    var oneri = Math.round(salari * coeffOneri);

    // TFR (art. 2120 c.c.): retribuzione lorda totale / 13,5
    // La retribuzione include le mensilita aggiuntive, ma per semplicita
    // usiamo i salari lordi come base (gia comprensivi nel RAL)
    var tfr = Math.round(salari / 13.5);

    var totale = salari + oneri + tfr;

    return {
      headcount_medio: Math.round(hcMedio * 10) / 10,
      headcount_fine: hcFine,
      salari: salari,
      oneri: oneri,
      tfr: tfr,
      totale: totale
    };
  }

  /* ══════════════════════════════════════════════════════════
     MOTORE BASE — Proiezioni annuali senza eventi
     ══════════════════════════════════════════════════════════ */

  /**
   * Calcola tutte le proiezioni annuali del progetto.
   * Popola progetto.proiezioni.annuali con CE, SP e cash flow per ogni anno.
   * @param {Object} progetto
   */
  function calcolaProiezioni(progetto) {
    if (!progetto || !progetto.meta) return;

    var p = progetto;
    var annoBase = p.meta.anno_base;
    var anniPrev = p.meta.anni_previsione || [];
    var driver = p.driver;
    var fisc = driver.fiscale || {};
    var isCostitutenda = p.meta.scenario === 'costituenda';

    if (!p.proiezioni) p.proiezioni = {};
    p.proiezioni.annuali = {};

    // Stato SP portato avanti anno per anno
    var spPrev = _inizializzaSP(p, annoBase);

    for (var i = 0; i < anniPrev.length; i++) {
      var anno = anniPrev[i];
      var annoStr = String(anno);
      var inflazione = (fisc.inflazione && fisc.inflazione[annoStr]) || 0;

      // 1. RICAVI
      var ricavi = _calcolaRicaviAnno(driver.ricavi, anno, annoBase, inflazione);

      // 2. COSTI (non personale)
      var costi = _calcolaCostiAnno(driver.costi, ricavi.totale, anno, annoBase, inflazione);

      // 3. PERSONALE
      var pers = calcolaPersonaleAnno(driver.personale, anno, annoBase);

      // 4. AMMORTAMENTI (da immobilizzazioni esistenti)
      var ammort = _calcolaAmmortamentiAnno(p.immobilizzazioni, spPrev);

      // 5. ONERI FINANZIARI (da finanziamenti in essere)
      var finanz = _calcolaFinanziamentiAnno(driver.finanziamenti_essere, anno, annoBase);

      // 6. CE
      var ce = {};
      ce.ricavi_totale = ricavi.totale;
      ce.costi_totale = costi.totale;
      ce.personale_totale = pers.totale;
      ce.personale = pers;
      ce.ammortamenti = ammort.quota_annua;
      ce.ammort_immateriali = ammort.immateriali;
      ce.ammort_materiali = ammort.materiali;
      ce.oneri_finanziari = finanz.interessi_totale;

      // Valore produzione (A) e Costi produzione (B)
      ce.valore_produzione = ce.ricavi_totale;
      ce.costi_produzione = ce.costi_totale + ce.personale_totale + ce.ammortamenti;
      ce.ebitda = ce.valore_produzione - ce.costi_totale - ce.personale_totale;
      ce.ebit = ce.ebitda - ce.ammortamenti;
      ce.risultato_ante_imposte = ce.ebit - ce.oneri_finanziari;

      // 7. IMPOSTE
      ce.ires = Math.max(0, Math.round(ce.risultato_ante_imposte * (fisc.aliquota_ires || 0.24)));
      // Base IRAP: valore produzione - costi produzione (esclusi oneri finanziari e personale dipendente)
      var baseIrap = ce.valore_produzione - ce.costi_totale - ce.ammortamenti;
      ce.irap = Math.max(0, Math.round(baseIrap * (fisc.aliquota_irap || 0.039)));
      ce.imposte = ce.ires + ce.irap;
      ce.utile_netto = ce.risultato_ante_imposte - ce.imposte;

      // 8. IVA
      var iva = _calcolaIvaAnno(ricavi.totale, costi, driver, fisc);
      ce.iva = iva;

      // 9. SP
      var sp = _calcolaSPAnno(spPrev, ce, finanz, ammort, driver, anno, annoBase, p);

      // 10. RENDICONTO FINANZIARIO
      var cf = _calcolaCashFlowAnno(ce, sp, spPrev, finanz);

      // Aggiorna cassa nello SP
      sp.cassa = spPrev.cassa + cf.flusso_netto;
      sp.totale_attivo = sp.immobilizzazioni_nette + sp.attivo_circolante + sp.cassa;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.altri_debiti + sp.tfr;

      p.proiezioni.annuali[annoStr] = {
        ce: ce,
        sp: sp,
        cash_flow: cf,
        iva: iva
      };

      // Porta avanti lo SP per l'anno successivo
      spPrev = sp;
    }
  }

  /* ── Inizializzazione SP da storico ──────────────────────── */

  function _inizializzaSP(progetto, annoBase) {
    var annoStr = String(annoBase);
    var storico = progetto.storico[annoStr];
    var immob = progetto.immobilizzazioni || {};
    var sp = {
      immobilizzazioni_nette: 0,
      immob_immateriali_nette: 0,
      immob_materiali_nette: 0,
      immob_finanziarie: 0,
      attivo_circolante: 0,
      crediti_clienti: 0,
      rimanenze: 0,
      altri_crediti: 0,
      cassa: 0,
      patrimonio_netto: 0,
      debiti_finanziari: 0,
      debiti_fornitori: 0,
      debiti_tributari: 0,
      altri_debiti: 0,
      tfr: 0,
      totale_attivo: 0,
      totale_passivo: 0
    };

    if (!storico) return sp;

    if (progetto.meta.scenario === 'costituenda' && storico.sp_avvio) {
      var av = storico.sp_avvio;
      sp.patrimonio_netto = (av['spc.PN.1'] || 0) + (av['spc.PN.2'] || 0);
      sp.debiti_finanziari = (av['spc.FIN.1'] || 0) + (av['spc.FIN.2'] || 0);
      sp.cassa = av['spc.LIQ.1'] || 0;
      sp.immobilizzazioni_nette = (av['spc.INV.1'] || 0) + (av['spc.INV.2'] || 0) + (av['spc.INV.3'] || 0);
      sp.totale_attivo = sp.immobilizzazioni_nette + sp.cassa;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari;
    } else if (storico.sp) {
      var att = storico.sp.attivo || {};
      var pas = storico.sp.passivo || {};

      // Immobilizzazioni: usa dettaglio lordo/fondo se disponibile
      var totImmobI = 0, totImmobII = 0, totImmobIII = 0;
      ['sp.BI.1','sp.BI.2','sp.BI.3','sp.BI.4','sp.BI.5','sp.BI.6','sp.BI.7'].forEach(function(id) {
        var im = immob[id];
        totImmobI += im ? ((im.costo_storico || 0) - (im.fondo_ammortamento || 0)) : (att[id] || 0);
      });
      ['sp.BII.1','sp.BII.2','sp.BII.3','sp.BII.4','sp.BII.5'].forEach(function(id) {
        var im = immob[id];
        totImmobII += im ? ((im.costo_storico || 0) - (im.fondo_ammortamento || 0)) : (att[id] || 0);
      });
      ['sp.BIII.1','sp.BIII.2','sp.BIII.3','sp.BIII.4'].forEach(function(id) {
        totImmobIII += att[id] || 0;
      });

      sp.immob_immateriali_nette = totImmobI;
      sp.immob_materiali_nette = totImmobII;
      sp.immob_finanziarie = totImmobIII;
      sp.immobilizzazioni_nette = totImmobI + totImmobII + totImmobIII;

      sp.crediti_clienti = att['sp.CII.1'] || 0;
      sp.rimanenze = (att['sp.CI.1'] || 0) + (att['sp.CI.2'] || 0) + (att['sp.CI.3'] || 0) + (att['sp.CI.4'] || 0) + (att['sp.CI.5'] || 0);
      sp.altri_crediti = (att['sp.CII.5b'] || 0) + (att['sp.CII.5t'] || 0) + (att['sp.CII.5q'] || 0);
      sp.cassa = (att['sp.CIV.1'] || 0) + (att['sp.CIV.2'] || 0) + (att['sp.CIV.3'] || 0);
      sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti;

      // Passivo
      sp.patrimonio_netto = (pas['sp.PN.I'] || 0) + (pas['sp.PN.II'] || 0) + (pas['sp.PN.III'] || 0) +
        (pas['sp.PN.IV'] || 0) + (pas['sp.PN.V'] || 0) + (pas['sp.PN.VI'] || 0) +
        (pas['sp.PN.VIII'] || 0) + (pas['sp.PN.IX'] || 0);
      sp.debiti_finanziari = (pas['sp.D_pass.4'] || 0) + (pas['sp.D_pass.3'] || 0);
      sp.debiti_fornitori = pas['sp.D_pass.7'] || 0;
      sp.debiti_tributari = pas['sp.D_pass.12'] || 0;
      sp.altri_debiti = (pas['sp.D_pass.13'] || 0) + (pas['sp.D_pass.14'] || 0) + (pas['sp.B_pass.1'] || 0) +
        (pas['sp.B_pass.4'] || 0) + (pas['sp.E_pass'] || 0);
      sp.tfr = pas['sp.C_pass'] || 0;

      sp.totale_attivo = sp.immobilizzazioni_nette + sp.attivo_circolante + sp.cassa;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.debiti_fornitori +
        sp.debiti_tributari + sp.altri_debiti + sp.tfr;
    }

    return sp;
  }

  /* ── Ricavi ──────────────────────────────────────────────── */

  function _calcolaRicaviAnno(driverRicavi, anno, annoBase, inflazione) {
    var totale = 0;
    var dettaglio = [];

    (driverRicavi || []).forEach(function(drv) {
      var base = drv.base_annuale || 0;
      // Crescita cumulativa anno su anno
      var anniDiff = anno - annoBase;
      var crescita = drv.crescita_annua || 0;
      var importo = base * Math.pow(1 + crescita, anniDiff);
      importo = Math.round(importo);
      totale += importo;
      dettaglio.push({ id: drv.id, label: drv.label, importo: importo });
    });

    return { totale: totale, dettaglio: dettaglio };
  }

  /* ── Costi ───────────────────────────────────────────────── */

  function _calcolaCostiAnno(driverCosti, ricaviTotale, anno, annoBase, inflazione) {
    var totale = 0;
    var totaleIvaCredito = 0;
    var dettaglio = [];

    (driverCosti || []).forEach(function(drv) {
      if (drv.usa_var_personale) return; // personale gestito a parte

      var importo = 0;
      if (drv.tipo_driver === 'pct_ricavi') {
        var pct = drv.pct_ricavi || 0;
        // Variazione della percentuale anno su anno
        var anniDiff = anno - annoBase;
        if (drv.var_pct_annua && anniDiff > 0) {
          pct = pct + (drv.var_pct_annua * anniDiff);
        }
        importo = Math.round(ricaviTotale * pct);
      } else {
        // Importo fisso con inflazione
        var base = drv.importo_fisso || 0;
        var anniDiff2 = anno - annoBase;
        if (drv.soggetto_inflazione && inflazione && anniDiff2 > 0) {
          importo = Math.round(base * Math.pow(1 + inflazione, anniDiff2));
        } else {
          importo = base;
        }
      }

      // IVA credito su questo costo
      var ivaPct = drv.iva_pct || 0;
      var ivaCredito = Math.round(importo * ivaPct);
      totaleIvaCredito += ivaCredito;

      totale += importo;
      dettaglio.push({ id: drv.id, label: drv.label, importo: importo, iva_credito: ivaCredito });
    });

    return { totale: totale, iva_credito: totaleIvaCredito, dettaglio: dettaglio };
  }

  /* ── Ammortamenti da immobilizzazioni esistenti ──────────── */

  function _calcolaAmmortamentiAnno(immobilizzazioni, spPrev) {
    var immateriali = 0;
    var materiali = 0;

    if (immobilizzazioni) {
      Object.keys(immobilizzazioni).forEach(function(id) {
        var im = immobilizzazioni[id];
        if (!im || !im.aliquota || !im.costo_storico) return;
        var quota = Math.round(im.costo_storico * im.aliquota);
        // Non ammortizzare oltre il valore netto residuo
        var nettoResiduo = (im.costo_storico || 0) - (im.fondo_ammortamento || 0);
        if (quota > nettoResiduo) quota = Math.max(0, nettoResiduo);

        if (id.indexOf('sp.BI.') === 0) {
          immateriali += quota;
        } else {
          materiali += quota;
        }
      });
    }

    return {
      immateriali: immateriali,
      materiali: materiali,
      quota_annua: immateriali + materiali
    };
  }

  /* ── Finanziamenti in essere ─────────────────────────────── */

  function _calcolaFinanziamentiAnno(finanziamenti, anno, annoBase) {
    var interessiTotale = 0;
    var capitaleTotale = 0;

    (finanziamenti || []).forEach(function(fin) {
      if (!fin.capitale_residuo || !fin.tasso_annuo || !fin.durata_mesi) return;

      var tassoMese = fin.tasso_annuo / 12;
      var cap = fin.capitale_residuo;
      var durRes = fin.durata_mesi;

      // Calcola quanti mesi sono gia passati dall'anno base
      var mesiPassati = (anno - annoBase) * 12;
      if (mesiPassati >= durRes) return; // finanziamento estinto

      // Per ogni mese dell'anno, calcola rata
      var interessiAnno = 0;
      var capitaleAnno = 0;
      var capResiduo = cap;

      // Simula i mesi fino a inizio anno corrente
      for (var m = 0; m < mesiPassati && m < durRes; m++) {
        if (fin.tipo_ammortamento === 'italiano') {
          var quotaCap = cap / durRes;
          var quotaInt = capResiduo * tassoMese;
          capResiduo -= quotaCap;
        } else {
          // Francese
          var rata = cap * tassoMese / (1 - Math.pow(1 + tassoMese, -durRes));
          var quotaInt2 = capResiduo * tassoMese;
          var quotaCap2 = rata - quotaInt2;
          capResiduo -= quotaCap2;
        }
      }

      // Calcola i 12 mesi dell'anno corrente
      for (var mm = 0; mm < 12; mm++) {
        var meseAbs = mesiPassati + mm;
        if (meseAbs >= durRes || capResiduo <= 0) break;

        if (fin.tipo_ammortamento === 'italiano') {
          var qCap = cap / durRes;
          var qInt = capResiduo * tassoMese;
          interessiAnno += qInt;
          capitaleAnno += qCap;
          capResiduo -= qCap;
        } else {
          var rataF = cap * tassoMese / (1 - Math.pow(1 + tassoMese, -durRes));
          var qIntF = capResiduo * tassoMese;
          var qCapF = rataF - qIntF;
          interessiAnno += qIntF;
          capitaleAnno += qCapF;
          capResiduo -= qCapF;
        }
      }

      interessiTotale += Math.round(interessiAnno);
      capitaleTotale += Math.round(capitaleAnno);
    });

    return {
      interessi_totale: interessiTotale,
      capitale_rimborsato: capitaleTotale,
      uscita_cassa: interessiTotale + capitaleTotale
    };
  }

  /* ── IVA annuale ─────────────────────────────────────────── */

  function _calcolaIvaAnno(ricaviTotale, costiResult, driver, fisc) {
    var ivaRicavi = fisc.iva_ricavi || 0.22;
    var debito = Math.round(ricaviTotale * ivaRicavi);
    var credito = costiResult.iva_credito || 0;
    var saldo = debito - credito; // positivo = da versare, negativo = a credito

    return {
      iva_debito: debito,
      iva_credito: credito,
      saldo: saldo,
      da_versare: saldo > 0 ? saldo : 0,
      a_credito: saldo < 0 ? -saldo : 0
    };
  }

  /* ── SP previsionale ─────────────────────────────────────── */

  function _calcolaSPAnno(spPrev, ce, finanz, ammort, driver, anno, annoBase, progetto) {
    var circ = driver.circolante || {};
    var sp = {};

    // Immobilizzazioni: valore precedente - ammortamento anno
    sp.immob_immateriali_nette = Math.max(0, spPrev.immob_immateriali_nette - ammort.immateriali);
    sp.immob_materiali_nette = Math.max(0, spPrev.immob_materiali_nette - ammort.materiali);
    sp.immob_finanziarie = spPrev.immob_finanziarie;
    sp.immobilizzazioni_nette = sp.immob_immateriali_nette + sp.immob_materiali_nette + sp.immob_finanziarie;

    // Circolante da DSO/DPO/DIO sulle nuove operazioni
    sp.crediti_clienti = Math.round(ce.ricavi_totale * (circ.dso || 0) / 365);
    sp.debiti_fornitori = Math.round((ce.costi_totale + ce.personale_totale) * (circ.dpo || 0) / 365);
    sp.rimanenze = Math.round(ce.costi_totale * (circ.dio || 0) / 365);
    sp.altri_crediti = spPrev.altri_crediti; // per ora costanti
    sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti;

    // Debiti finanziari: precedente - rimborso capitale
    sp.debiti_finanziari = Math.max(0, spPrev.debiti_finanziari - finanz.capitale_rimborsato);

    // Debiti tributari: imposte da versare + IVA
    sp.debiti_tributari = Math.round(ce.imposte / 2); // semplificazione: meta come acconto residuo

    // TFR: accumula quota annua
    sp.tfr = spPrev.tfr + ce.personale.tfr;

    // Altri debiti: costanti per ora
    sp.altri_debiti = spPrev.altri_debiti;

    // Patrimonio netto: precedente + utile
    sp.patrimonio_netto = spPrev.patrimonio_netto + ce.utile_netto;

    // Cassa calcolata dal cash flow (impostata dopo)
    sp.cassa = 0;

    sp.totale_attivo = 0;
    sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.debiti_fornitori +
      sp.debiti_tributari + sp.altri_debiti + sp.tfr;

    return sp;
  }

  /* ── Rendiconto finanziario (metodo indiretto) ───────────── */

  function _calcolaCashFlowAnno(ce, sp, spPrev, finanz) {
    var cf = {};

    // Area operativa
    cf.utile_netto = ce.utile_netto;
    cf.ammortamenti = ce.ammortamenti;
    cf.var_crediti = -(sp.crediti_clienti - spPrev.crediti_clienti);
    cf.var_rimanenze = -(sp.rimanenze - spPrev.rimanenze);
    cf.var_debiti_fornitori = sp.debiti_fornitori - spPrev.debiti_fornitori;
    cf.var_debiti_tributari = sp.debiti_tributari - spPrev.debiti_tributari;
    cf.var_tfr = sp.tfr - spPrev.tfr;
    cf.var_altri = (sp.altri_debiti - spPrev.altri_debiti) - (sp.altri_crediti - spPrev.altri_crediti);

    cf.flusso_operativo = cf.utile_netto + cf.ammortamenti +
      cf.var_crediti + cf.var_rimanenze + cf.var_debiti_fornitori +
      cf.var_debiti_tributari + cf.var_tfr + cf.var_altri;

    // Area investimenti (senza eventi = 0)
    cf.investimenti = 0;
    cf.flusso_investimenti = -cf.investimenti;

    // Area finanziaria
    cf.rimborso_finanziamenti = -finanz.capitale_rimborsato;
    cf.nuovi_finanziamenti = 0;
    cf.dividendi = 0;
    cf.flusso_finanziario = cf.rimborso_finanziamenti + cf.nuovi_finanziamenti - cf.dividendi;

    // IVA versata/rimborsata (semplificato: saldo annuale)
    cf.flusso_iva = -(ce.iva.da_versare || 0) + (ce.iva.a_credito || 0);

    cf.flusso_netto = cf.flusso_operativo + cf.flusso_investimenti + cf.flusso_finanziario + cf.flusso_iva;

    return cf;
  }

  /* ── Smobilizzo crediti/debiti (primi mesi) ──────────────── */
  // TODO: implementare effetto mensile dello smobilizzo nei primi mesi
  // Per ora i crediti/debiti storici vengono sostituiti dai valori DSO/DPO

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    calcolaValore,
    calcolaPersonaleAnno,
    calcolaProiezioni
  };

})();
