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
      // Figli con nota_info: true sono informativi e non vengono sommati nel totale del genitore
      let tot = 0;
      for (const figlio of nodo.children) {
        if (figlio.nota_info) continue;
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
  function calcolaPersonaleAnno(personale, anno, annoBase, meta) {
    if (!personale || !personale.headcount) {
      return { headcount_medio: 0, headcount_fine: 0, salari: 0, oneri: 0, tfr: 0, totale: 0 };
    }

    var hcBase = personale.headcount; // decimale (es. 5.5)
    var ralMedia = personale.ral_media || 0;
    var coeffOneri = personale.coeff_oneri || 0.32;
    var variazioni = personale.variazioni_organico || [];
    var varRal = personale.var_ral_pct || {};
    var ha13 = personale.tredicesima !== false;   // default true
    var ha14 = personale.quattordicesima !== false; // default true
    // Costituenda: primo anno, i mesi prima dell'avvio hanno headcount 0
    var isCostitutenda = meta && meta.scenario === 'costituenda';
    var meseAvvio = (meta && meta.mese_avvio) || 1;
    var primAnno = isCostitutenda && anno === annoBase && meseAvvio > 1;

    // Numero mensilità: base 12 + 13ª + 14ª
    var numMensilita = 12 + (ha13 ? 1 : 0) + (ha14 ? 1 : 0);

    // Calcola RAL media per l'anno corrente (con adeguamenti cumulativi)
    var ralAnno = ralMedia;
    for (var a = annoBase + 1; a <= anno; a++) {
      var pct = varRal[String(a)] || 0;
      ralAnno = ralAnno * (1 + pct);
    }

    // Calcola headcount mensile (12 mesi) — supporta decimali
    var hcInizio = hcBase;
    variazioni.forEach(function(v) {
      if (v.anno < anno) {
        hcInizio += (v.delta || 0);
      }
    });

    var mesiHc = [];
    var hcCorrente = hcInizio;
    for (var m = 1; m <= 12; m++) {
      variazioni.forEach(function(v) {
        if (v.anno === anno && v.da_mese === m) {
          hcCorrente += (v.delta || 0);
        }
      });
      // Primo anno costituenda: mesi prima dell'avvio = 0 dipendenti
      mesiHc.push(primAnno && m < meseAvvio ? 0 : Math.max(0, hcCorrente));
    }

    var sommaHc = 0;
    for (var k = 0; k < 12; k++) sommaHc += mesiHc[k];
    var hcMedio = sommaHc / 12;
    var hcFine = mesiHc[11];

    // Retribuzione mensile base = RAL / numMensilità
    var retribMensile = ralAnno / numMensilita;

    // Salari: somma mese per mese (hc × retrib_mensile) + mensilità aggiuntive
    var salari = 0;
    for (var j = 0; j < 12; j++) {
      var salarioMese = mesiHc[j] * retribMensile;
      // 13ª a dicembre (mese 12, indice 11)
      if (ha13 && j === 11) salarioMese += mesiHc[j] * retribMensile;
      // 14ª a giugno (mese 6, indice 5)
      if (ha14 && j === 5) salarioMese += mesiHc[j] * retribMensile;
      salari += salarioMese;
    }
    salari = Math.round(salari);

    // Oneri sociali
    var oneri = Math.round(salari * coeffOneri);

    // TFR (art. 2120 c.c.): retribuzione lorda annua / 13,5
    var tfr = Math.round(salari / 13.5);

    var totale = salari + oneri + tfr;

    return {
      headcount_medio: Math.round(hcMedio * 10) / 10,
      headcount_fine: Math.round(hcFine * 10) / 10,
      salari: salari,
      oneri: oneri,
      tfr: tfr,
      totale: totale
    };
  }

  /* ══════════════════════════════════════════════════════════
     MOTORE — Proiezioni annuali con eventi
     ══════════════════════════════════════════════════════════ */

  /**
   * Calcola tutte le proiezioni annuali del progetto.
   * Popola progetto.proiezioni.annuali con CE, SP e cash flow per ogni anno.
   * Integra gli eventi pianificati (nuovi finanziamenti, investimenti, variazioni, ecc.).
   * @param {Object} progetto
   */
  function calcolaProiezioni(progetto) {
    if (!progetto || !progetto.meta) return;

    var p = progetto;
    var annoBase = p.meta.anno_base;
    var anniPrev = p.meta.anni_previsione || [];
    var driver = p.driver;
    var fisc = driver.fiscale || {};
    var eventi = p.eventi || [];

    if (!p.proiezioni) p.proiezioni = {};
    p.proiezioni.annuali = {};

    // Pre-calcola eventi: moltiplicatori ricavi/costi strutturali cumulativi
    var multRicaviStrutt = 1;    // moltiplicatore strutturale ricavi cumulativo
    var multCostiMPStrutt = 1;   // moltiplicatore strutturale costi materie prime
    // Per costi variabili e gestione strutturali tracciamo per driver_id
    var multCostiVarStrutt = {};  // { driver_id: moltiplicatore }
    var costiGestOverride = {};   // { driver_id: { azione, importo_nuovo, variazione_pct } } — ultimo override attivo

    // Investimenti cumulativi (portati avanti anno per anno)
    var investimentiCumulativi = []; // { categoria, importo, aliquota, anno_acquisto, fondo: 0 }

    // Fondo cumulativo proiezioni per immobilizzazioni storiche (si accumula anno dopo anno)
    var fondoProiezioni = {}; // { nodoId: ammortamento_cumulato_in_proiezione }

    // Stato SP portato avanti anno per anno
    var spPrev = _inizializzaSP(p, annoBase);

    // Imposte anno precedente per calcolo acconti (metodo storico)
    var impostePrecedenti = 0; // anno 1: nessun acconto conosciuto

    // IVA credito riportato da anno precedente (negativo = credito, 0 = nessun riporto)
    var ivaCreditoRiportoAnno = 0;

    // Pre-calcola smobilizzo crediti/debiti storici
    var smob = driver.smobilizzo || [];
    var smobMap = {};
    for (var si = 0; si < smob.length; si++) {
      smobMap[smob[si].voce_sp] = smob[si];
    }
    // Baseline: componenti di altri_crediti e altri_debiti NON soggette a smobilizzo
    var smobAltriCreditiSaldo = 0;
    ['sp.CII.5b','sp.CII.5t','sp.CII.5q'].forEach(function(v) {
      if (smobMap[v]) smobAltriCreditiSaldo += smobMap[v].saldo;
    });
    var altriCreditiNonSmob = spPrev.altri_crediti - smobAltriCreditiSaldo;
    // (debiti_previdenziali gestito direttamente tramite sotto-componente sp.debiti_previdenziali)

    for (var i = 0; i < anniPrev.length; i++) {
      var anno = anniPrev[i];
      var annoStr = String(anno);

      // ── Elabora eventi per questo anno ──
      var nuoviFinAnno = [];      // nuovi finanziamenti che partono quest'anno
      var investimentiAnno = [];   // nuovi investimenti in questo anno
      var varPersonaleAnno = [];   // variazioni personale
      var opSociAnno = [];         // operazioni soci
      var utilizzoRimanenzeAnno = []; // utilizzo rimanenze attive quest'anno
      var multRicaviPunt = 1;      // moltiplicatore puntuale ricavi (solo quest'anno)
      var multCostiMPPunt = 1;     // moltiplicatore puntuale costi MP
      var multCostiVarPunt = {};   // { driver_id: molt } puntuale

      for (var e = 0; e < eventi.length; e++) {
        var evt = eventi[e];
        if (!evt || !evt.tipo) continue;

        // Calcola anno_fine effettivo (default: nessun limite per compatibilità)
        var evtAnnoFine = evt.anno_fine || Infinity;

        switch (evt.tipo) {
          case 'nuovo_finanziamento':
            // Attivo se anno evento cade in questo anno o prima
            if (evt.anno && evt.anno <= anno) {
              nuoviFinAnno.push(evt);
            }
            break;

          case 'nuovo_investimento':
            if (evt.anno === anno) {
              investimentiAnno.push(evt);
            }
            break;

          case 'variazione_ricavi':
            if (evt.anno === anno && anno <= evtAnnoFine) {
              if (evt.modalita === 'strutturale') {
                multRicaviStrutt *= (1 + (evt.variazione_pct || 0));
              } else {
                multRicaviPunt *= (1 + (evt.variazione_pct || 0));
              }
            }
            break;

          case 'variazione_costi_mp':
            if (evt.anno === anno && anno <= evtAnnoFine) {
              if (evt.modalita === 'strutturale') {
                multCostiMPStrutt *= (1 + (evt.variazione_pct || 0));
              } else {
                multCostiMPPunt *= (1 + (evt.variazione_pct || 0));
              }
            }
            break;

          case 'variazione_costi_var':
            if (evt.anno === anno && anno <= evtAnnoFine && evt.driver_id) {
              if (evt.modalita === 'strutturale') {
                if (!multCostiVarStrutt[evt.driver_id]) multCostiVarStrutt[evt.driver_id] = 1;
                multCostiVarStrutt[evt.driver_id] *= (1 + (evt.variazione_pct || 0));
              } else {
                if (!multCostiVarPunt[evt.driver_id]) multCostiVarPunt[evt.driver_id] = 1;
                multCostiVarPunt[evt.driver_id] *= (1 + (evt.variazione_pct || 0));
              }
            }
            break;

          case 'andamento_costo_gestione':
            if (evt.anno <= anno && anno <= evtAnnoFine && evt.driver_id) {
              // L'ultimo evento per driver_id che sia <= anno è quello attivo
              costiGestOverride[evt.driver_id] = {
                azione: evt.azione,
                importo_nuovo: evt.importo_nuovo || 0,
                variazione_pct: evt.variazione_pct || 0,
                anno_evento: evt.anno
              };
            }
            break;

          case 'variazione_personale':
            if (evt.anno <= anno && anno <= evtAnnoFine) {
              varPersonaleAnno.push(evt);
            }
            break;

          case 'operazione_soci':
            if (evt.anno === anno) {
              opSociAnno.push(evt);
            }
            break;

          case 'utilizzo_rimanenze':
            if (evt.anno <= anno && anno <= evtAnnoFine && evt.pct_utilizzo) {
              utilizzoRimanenzeAnno.push(evt);
            }
            break;
        }
      }

      // 1. RICAVI (con moltiplicatori eventi)
      var ricavi = _calcolaRicaviAnno(driver.ricavi, anno, annoBase, fisc.inflazione, p.meta);
      ricavi.totale = Math.round(ricavi.totale * multRicaviStrutt * multRicaviPunt);

      // 2. COSTI (con eventi: variazione MP, costi variabili, costi gestione)
      var costi = _calcolaCostiAnnoConEventi(driver.costi, ricavi.totale, anno, annoBase, fisc.inflazione,
        multCostiMPStrutt * multCostiMPPunt, multCostiVarStrutt, multCostiVarPunt, costiGestOverride, p.meta);

      // 3. PERSONALE (con variazioni da eventi)
      var persDriver = driver.personale;
      // Crea variazioni temporanee combinando driver + eventi
      var varOrgTemp = (persDriver.variazioni_organico || []).slice();
      for (var vp = 0; vp < varPersonaleAnno.length; vp++) {
        varOrgTemp.push({
          anno: varPersonaleAnno[vp].anno,
          delta: varPersonaleAnno[vp].delta || 0,
          da_mese: varPersonaleAnno[vp].mese || 1
        });
      }
      var persTemp = {
        headcount: persDriver.headcount,
        ral_media: persDriver.ral_media,
        coeff_oneri: persDriver.coeff_oneri,
        tredicesima: persDriver.tredicesima,
        quattordicesima: persDriver.quattordicesima,
        var_ral_pct: persDriver.var_ral_pct,
        variazioni_organico: varOrgTemp
      };
      var pers = calcolaPersonaleAnno(persTemp, anno, annoBase, p.meta);

      // 4a. Registra nuovi investimenti di quest'anno (prima del calcolo ammortamenti)
      var investimentiCassaAnno = 0;
      var ivaInvestimentiAnno = 0;
      for (var ni = 0; ni < investimentiAnno.length; ni++) {
        var nInv = investimentiAnno[ni];
        // Retrocompat: se presente aliquota_ammortamento, usala; altrimenti converti da anni
        var aliqAmm = nInv.aliquota_ammortamento || (nInv.anni_ammortamento ? 1 / nInv.anni_ammortamento : 0);
        investimentiCumulativi.push({
          categoria: nInv.categoria, importo: nInv.importo,
          aliquota: aliqAmm,
          anno_acquisto: anno, mese_acquisto: nInv.mese || 1, fondo: 0
        });
        investimentiCassaAnno += nInv.importo;
        ivaInvestimentiAnno += Math.round(nInv.importo * (nInv.iva_pct || 0));
      }

      // 4b. AMMORTAMENTI (da immobilizzazioni esistenti + investimenti cumulativi incl. anno corrente)
      var ammort = _calcolaAmmortamentiAnno(p.immobilizzazioni, spPrev, fondoProiezioni);
      // Ammortamenti da investimenti, separati: nuovi dell'anno vs anni precedenti
      var ammortEvtImmatNew = 0, ammortEvtMatNew = 0;   // investimenti NUOVI quest'anno
      var ammortEvtImmatOld = 0, ammortEvtMatOld = 0;   // investimenti di anni precedenti
      for (var ic = 0; ic < investimentiCumulativi.length; ic++) {
        var inv = investimentiCumulativi[ic];
        var nettoInv = inv.importo - inv.fondo;
        if (nettoInv <= 0) continue; // già completamente ammortizzato
        var quotaAnnuaInv = Math.round(inv.importo * inv.aliquota);
        var quotaInv;
        if (inv.anno_acquisto === anno) {
          // Anno di acquisto: pro-rata dal mese di investimento
          var mesiAmm = 13 - (inv.mese_acquisto || 1);
          quotaInv = Math.round(quotaAnnuaInv * mesiAmm / 12);
        } else if (inv.anno_acquisto < anno) {
          quotaInv = quotaAnnuaInv;
        } else {
          continue; // investimento futuro
        }
        if (quotaInv > nettoInv) quotaInv = Math.max(0, nettoInv);
        var isImmat = inv.categoria.indexOf('sp.BI.') === 0;
        if (inv.anno_acquisto === anno) {
          if (isImmat) ammortEvtImmatNew += quotaInv; else ammortEvtMatNew += quotaInv;
        } else {
          if (isImmat) ammortEvtImmatOld += quotaInv; else ammortEvtMatOld += quotaInv;
        }
        inv.fondo += quotaInv;
      }

      // Per il CE: ammortamento totale (storico + tutti gli eventi)
      ammort.immateriali += ammortEvtImmatOld + ammortEvtImmatNew;
      ammort.materiali += ammortEvtMatOld + ammortEvtMatNew;
      ammort.quota_annua += ammortEvtImmatOld + ammortEvtImmatNew + ammortEvtMatOld + ammortEvtMatNew;

      // Per lo SP: ammortamento solo storico + eventi anni precedenti (esclusi nuovi di quest'anno)
      var ammortPerSP = {
        immateriali: ammort.immateriali - ammortEvtImmatNew,
        materiali: ammort.materiali - ammortEvtMatNew,
        quota_annua: ammort.quota_annua - ammortEvtImmatNew - ammortEvtMatNew
      };

      // 5. ONERI FINANZIARI (finanziamenti in essere + nuovi)
      var finanz = _calcolaFinanziamentiAnno(driver.finanziamenti_essere, anno, annoBase);
      // Nuovi finanziamenti: calcola interessi e rimborso
      var nuoviFinInteressi = 0, nuoviFinCapitale = 0, nuoviFinDebito = 0;
      for (var nf = 0; nf < nuoviFinAnno.length; nf++) {
        var fin = nuoviFinAnno[nf];
        var nfResult = _calcolaFinanziamentoSingolo(fin, anno);
        nuoviFinInteressi += nfResult.interessi;
        nuoviFinCapitale += nfResult.capitale;
        nuoviFinDebito += nfResult.residuo;
      }
      finanz.interessi_totale += nuoviFinInteressi;
      finanz.capitale_rimborsato += nuoviFinCapitale;
      finanz.uscita_cassa += nuoviFinInteressi + nuoviFinCapitale;

      // 6. CE
      var ce = {};
      ce.ricavi_totale = ricavi.totale;
      ce.ricavi_dettaglio = ricavi.dettaglio || [];
      ce.costi_totale = costi.totale;
      ce.costi_dettaglio = costi.dettaglio || [];
      ce.personale_totale = pers.totale;
      ce.personale = pers;
      ce.ammortamenti = ammort.quota_annua;
      ce.ammort_immateriali = ammort.immateriali;
      ce.ammort_materiali = ammort.materiali;
      ce.oneri_finanziari = finanz.interessi_totale;
      ce.variazione_rimanenze = 0; // calcolato dopo SP (art. 2425 c.c.)

      // Valore produzione (A) e Costi produzione (B)
      ce.valore_produzione = ce.ricavi_totale;
      ce.costi_produzione = ce.costi_totale + ce.personale_totale + ce.ammortamenti;
      ce.ebitda = ce.valore_produzione - ce.costi_totale - ce.personale_totale;
      ce.ebit = ce.ebitda - ce.ammortamenti;
      ce.risultato_ante_imposte = ce.ebit - ce.oneri_finanziari;

      // 7. IMPOSTE
      ce.ires = Math.max(0, Math.round(ce.risultato_ante_imposte * (fisc.aliquota_ires || 0.24)));
      var baseIrap = ce.valore_produzione - ce.costi_totale - ce.ammortamenti;
      ce.irap = Math.max(0, Math.round(baseIrap * (fisc.aliquota_irap || 0.039)));
      ce.imposte = ce.ires + ce.irap;
      ce.utile_netto = ce.risultato_ante_imposte - ce.imposte;

      // 8. IVA (inclusa IVA credito da investimenti)
      var iva = _calcolaIvaAnno(ricavi.totale, costi, driver, fisc);
      iva.iva_credito += ivaInvestimentiAnno;
      iva.saldo = iva.iva_debito - iva.iva_credito;
      iva.da_versare = iva.saldo > 0 ? iva.saldo : 0;
      iva.a_credito = iva.saldo < 0 ? -iva.saldo : 0;
      ce.iva = iva;

      // 8b. CALCOLO MENSILE: distribuzione infrannuale per crediti/debiti/IVA
      var mensile = _calcolaMensile(ce, driver, fisc, p.meta, anno, annoBase, ivaCreditoRiportoAnno);

      // 9. SP
      // SP: usa ammortPerSP (senza nuovi investimenti dell'anno, che vengono aggiunti dopo)
      var spPrev_saved = spPrev; // salva per trace
      var sp = _calcolaSPAnno(spPrev, ce, finanz, ammortPerSP, driver, anno, annoBase, p, impostePrecedenti);

      // 9b. Override SP con valori dal motore mensile (più precisi della formula annuale)
      sp.crediti_clienti = mensile.crediti_clienti;
      sp.debiti_fornitori = mensile.debiti_fornitori;
      sp._deb_trib_iva = mensile.iva_debito_31dic;
      sp.debiti_tributari = sp._deb_trib_imposte + mensile.iva_debito_31dic;
      // Crediti tributari IVA: se a fine anno IVA credito > IVA debito, il credito
      // verso l'Erario va nell'attivo (C.II.5-bis art. 2424 c.c.)
      sp.crediti_tributari_iva = mensile.iva_credito_fine_anno;
      sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti + sp.crediti_tributari_iva;

      // SP: smobilizzo crediti/debiti storici
      // I saldi storici decrescono linearmente in base ai mesi di incasso/pagamento configurati.
      var hasSmob = Object.keys(smobMap).length > 0;
      var smobResidui = {}; // salva i residui per riuso dopo variazione_rimanenze
      if (hasSmob) {
        var mesiTrascorsi = (i + 1) * 12;
        var _smobRes = function(item) {
          if (!item) return 0;
          var m = item.mesi_incasso || 12;
          return Math.max(0, Math.round(item.saldo * (1 - mesiTrascorsi / m)));
        };
        // Crediti clienti: DSO-based (già calcolato) + residuo storico
        smobResidui.crediti_clienti = _smobRes(smobMap['sp.CII.1']);
        sp.crediti_clienti += smobResidui.crediti_clienti;
        // Altri crediti: parte non-smob costante + residui smob
        if (smobAltriCreditiSaldo > 0) {
          var resAC = 0;
          ['sp.CII.5b','sp.CII.5t','sp.CII.5q'].forEach(function(v) {
            resAC += _smobRes(smobMap[v]);
          });
          sp.altri_crediti = altriCreditiNonSmob + resAC;
        }
        // Debiti fornitori: DPO-based + residuo storico
        smobResidui.debiti_fornitori = _smobRes(smobMap['sp.D_pass.7']);
        sp.debiti_fornitori += smobResidui.debiti_fornitori;
        // Debiti tributari: imposte-based + residuo storico
        smobResidui.debiti_tributari = _smobRes(smobMap['sp.D_pass.12']);
        sp.debiti_tributari += smobResidui.debiti_tributari;
        // Debiti previdenziali: contributi mensili + residuo storico smobilizzo
        if (smobMap['sp.D_pass.13']) {
          smobResidui.debiti_previdenziali = _smobRes(smobMap['sp.D_pass.13']);
          sp.debiti_previdenziali += smobResidui.debiti_previdenziali;
          sp.altri_debiti = sp.debiti_previdenziali + sp.altri_debiti_residui + sp.fin_soci;
        }
        // Ricalcola attivo circolante con valori aggiornati
        sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti + sp.crediti_tributari_iva;
      }

      // SP: aggiungi investimenti dell'anno AL NETTO del loro ammortamento pro-rata
      var invImmatAnno = 0, invMatAnno = 0;
      for (var ii = 0; ii < investimentiAnno.length; ii++) {
        var inv2 = investimentiAnno[ii];
        if (inv2.categoria.indexOf('sp.BI.') === 0) {
          invImmatAnno += inv2.importo;
        } else {
          invMatAnno += inv2.importo;
        }
      }
      sp.immob_immateriali_nette += invImmatAnno - ammortEvtImmatNew;
      sp.immob_materiali_nette += invMatAnno - ammortEvtMatNew;
      sp.immobilizzazioni_nette += (invImmatAnno - ammortEvtImmatNew) + (invMatAnno - ammortEvtMatNew);

      // SP: debiti finanziari calcolati direttamente (residuo essere + residuo eventi)
      sp.debiti_finanziari = finanz.residuo_totale + nuoviFinDebito;

      // SP: utilizzo rimanenze — riduce rimanenze e costi MP nel CE
      var valoreUtilizzato = 0;
      if (utilizzoRimanenzeAnno.length > 0) {
        var pctTotale = 0;
        for (var ur = 0; ur < utilizzoRimanenzeAnno.length; ur++) {
          pctTotale += (utilizzoRimanenzeAnno[ur].pct_utilizzo || 0);
        }
        pctTotale = Math.min(pctTotale, 1); // max 100%
        valoreUtilizzato = Math.round(sp.rimanenze * pctTotale);
        sp.rimanenze -= valoreUtilizzato;
        sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti + sp.crediti_tributari_iva;
        // Riduce costi MP nel CE: le materie utilizzate dal magazzino
        // non richiedono nuovi acquisti
        ce.costi_totale -= valoreUtilizzato;
      }

      // Variazione rimanenze nel CE (art. 2425 c.c., voce A.2/B.11)
      // Riflette la variazione del magazzino tra inizio e fine esercizio.
      ce.variazione_rimanenze = sp.rimanenze - spPrev.rimanenze;
      if (ce.variazione_rimanenze !== 0 || valoreUtilizzato > 0) {
        // Ricalcola CE con variazione rimanenze e costi aggiornati
        ce.valore_produzione = ce.ricavi_totale + ce.variazione_rimanenze;
        ce.costi_produzione = ce.costi_totale + ce.personale_totale + ce.ammortamenti;
        ce.ebitda = ce.valore_produzione - ce.costi_totale - ce.personale_totale;
        ce.ebit = ce.ebitda - ce.ammortamenti;
        ce.risultato_ante_imposte = ce.ebit - ce.oneri_finanziari;
        ce.ires = Math.max(0, Math.round(ce.risultato_ante_imposte * (fisc.aliquota_ires || 0.24)));
        var baseIrapAdj = ce.valore_produzione - ce.costi_totale - ce.ammortamenti;
        ce.irap = Math.max(0, Math.round(baseIrapAdj * (fisc.aliquota_irap || 0.039)));
        ce.imposte = ce.ires + ce.irap;
        ce.utile_netto = ce.risultato_ante_imposte - ce.imposte;
        // Aggiorna SP: patrimonio netto e debiti tributari con il nuovo utile/imposte
        sp.utile_esercizio = ce.utile_netto;
        sp.patrimonio_netto = sp.capitale_sociale + sp.riserve + sp.utili_portati_nuovo + sp.utile_esercizio;
        // Ricalcola debiti tributari con imposte aggiornate
        var saldoImpAdj = impostePrecedenti > 0
          ? Math.max(0, Math.round(ce.imposte - impostePrecedenti))
          : Math.round(ce.imposte / 2);
        sp._deb_trib_imposte = saldoImpAdj;
        sp.debiti_tributari = saldoImpAdj + sp._deb_trib_iva + (smobResidui.debiti_tributari || 0);
      }

      // SP: operazioni soci
      var versCapitaleAnno = 0, finSociNettoAnno = 0;
      for (var os = 0; os < opSociAnno.length; os++) {
        var op = opSociAnno[os];
        if (op.sottotipo === 'versamento_capitale') {
          versCapitaleAnno += (op.importo || 0);
        } else if (op.sottotipo === 'finanziamento_soci') {
          finSociNettoAnno += (op.importo || 0);
        } else if (op.sottotipo === 'rimborso_soci') {
          finSociNettoAnno -= (op.importo || 0);
        }
      }
      sp.capitale_sociale += versCapitaleAnno;
      sp.patrimonio_netto += versCapitaleAnno;
      sp.fin_soci += finSociNettoAnno;
      sp.altri_debiti += finSociNettoAnno;

      // 10. SP QUADRATO: cassa come residuo (A = P per costruzione)
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.debiti_fornitori +
        sp.debiti_tributari + sp.altri_debiti + sp.tfr;
      sp.cassa = sp.totale_passivo - sp.immobilizzazioni_nette - sp.attivo_circolante;
      sp.cassa_attivo = Math.max(0, sp.cassa);
      sp.cassa_passivo = Math.max(0, -sp.cassa);
      // Totale attivo/passivo con cassa split: se cassa negativa va nel passivo
      sp.totale_attivo = sp.immobilizzazioni_nette + sp.attivo_circolante + sp.cassa_attivo;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.debiti_fornitori +
        sp.debiti_tributari + sp.altri_debiti + sp.tfr + sp.cassa_passivo;

      // 11. RENDICONTO FINANZIARIO (derivato da variazioni SP, non driver di cassa)
      var cf = {};
      cf.flusso_netto = sp.cassa - spPrev.cassa;

      // Area operativa (metodo indiretto)
      cf.utile_netto = ce.utile_netto;
      cf.ammortamenti = ce.ammortamenti;
      cf.var_crediti = -(sp.crediti_clienti - spPrev.crediti_clienti);
      cf.var_rimanenze = -(sp.rimanenze - spPrev.rimanenze);
      cf.var_debiti_fornitori = sp.debiti_fornitori - spPrev.debiti_fornitori;
      cf.var_debiti_tributari = sp.debiti_tributari - spPrev.debiti_tributari;
      cf.var_tfr = sp.tfr - spPrev.tfr;
      cf.var_crediti_tributari_iva = -(sp.crediti_tributari_iva - spPrev.crediti_tributari_iva);
      cf.var_altri = (sp.altri_debiti - spPrev.altri_debiti) - (sp.altri_crediti - spPrev.altri_crediti) + cf.var_crediti_tributari_iva;
      cf.flusso_operativo = cf.utile_netto + cf.ammortamenti +
        cf.var_crediti + cf.var_rimanenze + cf.var_debiti_fornitori +
        cf.var_debiti_tributari + cf.var_tfr + cf.var_altri;

      // Area investimenti
      cf.investimenti = investimentiCassaAnno;
      cf.flusso_investimenti = -investimentiCassaAnno;

      // Area finanziaria (residuo: garantisce quadratura CF = variazione cassa)
      cf.flusso_finanziario = cf.flusso_netto - cf.flusso_operativo - cf.flusso_investimenti;

      // Dettaglio finanziario (informativo)
      var nuoviFinErogati = 0;
      for (var ne = 0; ne < nuoviFinAnno.length; ne++) {
        nuoviFinErogati += nuoviFinAnno[ne].importo || 0;
      }
      cf.rimborso_finanziamenti = -finanz.capitale_rimborsato;
      cf.nuovi_finanziamenti = nuoviFinErogati;
      cf.versamenti_soci = versCapitaleAnno + Math.max(0, finSociNettoAnno);
      cf.rimborsi_soci = Math.abs(Math.min(0, finSociNettoAnno));
      cf.dividendi = 0;
      cf.flusso_iva = 0;

      p.proiezioni.annuali[annoStr] = {
        ce: ce,
        sp: sp,
        cash_flow: cf,
        iva: iva,
        mensile: mensile,
        _trace: _buildTrace(ce, sp, cf, spPrev_saved, driver, fisc, smobResidui, mensile)
      };

      // Porta avanti lo SP, le imposte e il credito IVA per l'anno successivo
      impostePrecedenti = ce.imposte;
      ivaCreditoRiportoAnno = mensile._ivaCumuloCredito; // carry-forward IVA (negativo = credito)
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
      crediti_tributari_iva: 0,
      cassa: 0,
      cassa_attivo: 0,
      cassa_passivo: 0,
      patrimonio_netto: 0,
      capitale_sociale: 0,
      riserve: 0,
      utili_portati_nuovo: 0,
      utile_esercizio: 0,
      debiti_finanziari: 0,
      debiti_fornitori: 0,
      debiti_tributari: 0,
      debiti_previdenziali: 0,
      fin_soci: 0,
      altri_debiti: 0,
      altri_debiti_residui: 0,
      tfr: 0,
      totale_attivo: 0,
      totale_passivo: 0
    };

    if (!storico) return sp;

    if (progetto.meta.scenario === 'costituenda' && storico.sp_avvio) {
      var av = storico.sp_avvio;
      // PN: capitale sottoscritto + versamenti c/capitale
      sp.capitale_sociale = (av['spc.PN.1'] || 0) + (av['spc.PN.3'] || 0);
      sp.patrimonio_netto = sp.capitale_sociale;
      sp.debiti_finanziari = (av['spc.FIN.1'] || 0) + (av['spc.FIN.2'] || 0);
      sp.cassa = av['spc.LIQ.1'] || 0;
      sp.cassa_attivo = Math.max(0, sp.cassa);
      sp.cassa_passivo = Math.max(0, -sp.cassa);
      sp.immobilizzazioni_nette = (av['spc.INV.1'] || 0) + (av['spc.INV.2'] || 0) + (av['spc.INV.3'] || 0);
      // Crediti vs soci per versamenti ancora dovuti
      sp.crediti_soci = av['spc.CRED.1'] || 0;
      // Spese di avvio: capitalizzate come immobilizzazioni immateriali
      sp.immob_immateriali_nette = (sp.immob_immateriali_nette || 0) +
        (av['spc.SPESE.1'] || 0) + (av['spc.SPESE.2'] || 0);
      sp.immobilizzazioni_nette += (av['spc.SPESE.1'] || 0) + (av['spc.SPESE.2'] || 0);
      sp.totale_attivo = sp.immobilizzazioni_nette + sp.cassa_attivo + sp.crediti_soci;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.cassa_passivo;
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
      sp.cassa_attivo = Math.max(0, sp.cassa);
      sp.cassa_passivo = Math.max(0, -sp.cassa);
      sp.crediti_tributari_iva = 0; // nello storico, già incluso in altri_crediti (CII.5b)
      sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti;

      // Passivo — dettaglio PN
      sp.capitale_sociale = (pas['sp.PN.I'] || 0);
      sp.riserve = (pas['sp.PN.II'] || 0) + (pas['sp.PN.III'] || 0) +
        (pas['sp.PN.IV'] || 0) + (pas['sp.PN.V'] || 0) + (pas['sp.PN.VI'] || 0);
      sp.utili_portati_nuovo = (pas['sp.PN.VIII'] || 0);
      sp.utile_esercizio = (pas['sp.PN.IX'] || 0);
      sp.patrimonio_netto = sp.capitale_sociale + sp.riserve + sp.utili_portati_nuovo + sp.utile_esercizio;
      sp.debiti_finanziari = (pas['sp.D_pass.4'] || 0) + (pas['sp.D_pass.3'] || 0);
      sp.debiti_fornitori = pas['sp.D_pass.7'] || 0;
      sp.debiti_tributari = pas['sp.D_pass.12'] || 0;
      sp.debiti_previdenziali = pas['sp.D_pass.13'] || 0;
      sp.altri_debiti_residui = (pas['sp.D_pass.14'] || 0) + (pas['sp.B_pass.1'] || 0) +
        (pas['sp.B_pass.4'] || 0) + (pas['sp.E_pass'] || 0);
      sp.fin_soci = 0;
      sp.altri_debiti = sp.debiti_previdenziali + sp.altri_debiti_residui + sp.fin_soci;
      sp.tfr = pas['sp.C_pass'] || 0;

      sp.totale_attivo = sp.immobilizzazioni_nette + sp.attivo_circolante + sp.cassa_attivo;
      sp.totale_passivo = sp.patrimonio_netto + sp.debiti_finanziari + sp.debiti_fornitori +
        sp.debiti_tributari + sp.altri_debiti + sp.tfr + sp.cassa_passivo;
    }

    return sp;
  }

  /* ── Ricavi ──────────────────────────────────────────────── */

  function _calcolaRicaviAnno(driverRicavi, anno, annoBase, inflazioneMap, meta) {
    var totale = 0;
    var dettaglio = [];
    var isCostitutenda = meta && meta.scenario === 'costituenda';
    var meseAvvio = (meta && meta.mese_avvio) || 1;
    var primoAnnoPrev = isCostitutenda ? annoBase : annoBase + 1;

    var mesiOperativi1anno = 13 - meseAvvio; // mesi operativi primo anno (mag=8)
    var isPrimoAnnoParziale = isCostitutenda && meseAvvio > 1;

    (driverRicavi || []).forEach(function(drv) {
      var base = drv.base_annuale || 0;
      if (drv.base_tipo === 'mensile') {
        // Mensile: moltiplica per i mesi effettivi
        base = (isPrimoAnnoParziale && anno === annoBase)
          ? base * mesiOperativi1anno
          : base * 12;
      } else {
        // Annuale: pro-rata nel primo anno parziale
        if (isPrimoAnnoParziale && anno === annoBase) {
          base = Math.round(base * mesiOperativi1anno / 12);
        }
      }
      // Crescita cumulativa anno su anno con % distinta per anno + inflazione per anno
      // La crescita parte dall'anno successivo al base (il base usa i valori driver as-is)
      var importo = base;
      for (var a = annoBase + 1; a <= anno; a++) {
        var crescita = 0;
        if (typeof drv.crescita_annua === 'object' && drv.crescita_annua) {
          crescita = drv.crescita_annua[String(a)] || 0;
        } else if (typeof drv.crescita_annua === 'number') {
          crescita = drv.crescita_annua; // retrocompatibilita
        }
        importo = importo * (1 + crescita);
        // Inflazione specifica dell'anno a (non dell'anno di calcolo)
        var infAnno = (inflazioneMap && inflazioneMap[String(a)]) || 0;
        if (infAnno) importo = importo * (1 + infAnno);
      }
      importo = Math.round(importo);
      totale += importo;
      dettaglio.push({ id: drv.id, label: drv.label, importo: importo });
    });

    return { totale: totale, dettaglio: dettaglio };
  }

  /* ── Costi ───────────────────────────────────────────────── */

  function _calcolaCostiAnno(driverCosti, ricaviTotale, anno, annoBase, inflazioneMap, meta) {
    var totale = 0;
    var totaleIvaCredito = 0;
    var dettaglio = [];
    var isCostitutenda = meta && meta.scenario === 'costituenda';
    var meseAvvio = (meta && meta.mese_avvio) || 1;

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
        var isPrimoAnnoParziale = isCostitutenda && meseAvvio > 1;
        var mesiOp = 13 - meseAvvio;
        if (drv.base_tipo === 'mensile') {
          // Mensile: moltiplica per i mesi effettivi
          base = (isPrimoAnnoParziale && anno === annoBase)
            ? base * mesiOp
            : base * 12;
        } else {
          // Annuale: pro-rata nel primo anno parziale
          if (isPrimoAnnoParziale && anno === annoBase) {
            base = Math.round(base * mesiOp / 12);
          }
        }
        if (drv.soggetto_inflazione && anno > annoBase) {
          // Inflazione cumulativa anno per anno con il tasso specifico di ogni anno
          var fattoreInfl = 1;
          for (var a = annoBase + 1; a <= anno; a++) {
            var infAnno = (inflazioneMap && inflazioneMap[String(a)]) || 0;
            fattoreInfl *= (1 + infAnno);
          }
          importo = Math.round(base * fattoreInfl);
        } else {
          importo = base;
        }
      }

      // IVA credito su questo costo
      var ivaPct = drv.iva_pct || 0;
      var ivaCredito = Math.round(importo * ivaPct);
      totaleIvaCredito += ivaCredito;

      totale += importo;
      dettaglio.push({ id: drv.id, label: drv.label, importo: importo, iva_credito: ivaCredito,
        iva_pct: ivaPct, tipo_driver: drv.tipo_driver, voce_ce: drv.voce_ce });
    });

    return { totale: totale, iva_credito: totaleIvaCredito, dettaglio: dettaglio };
  }

  /* ── Ammortamenti da immobilizzazioni esistenti ──────────── */

  function _calcolaAmmortamentiAnno(immobilizzazioni, spPrev, fondoProiezioni) {
    var immateriali = 0;
    var materiali = 0;

    if (immobilizzazioni) {
      Object.keys(immobilizzazioni).forEach(function(id) {
        var im = immobilizzazioni[id];
        if (!im || !im.costo_storico) return;
        // Retrocompat: aliquota diretta oppure convertita da anni
        var aliq = im.aliquota || (im.anni_ammortamento ? 1 / im.anni_ammortamento : 0);
        if (!aliq) return;
        var quota = Math.round(im.costo_storico * aliq);
        // Netto residuo = costo - fondo iniziale - ammortamento già calcolato in proiezione
        var fondoIniziale = im.fondo_ammortamento || 0;
        var fondoProiez = (fondoProiezioni && fondoProiezioni[id]) || 0;
        var nettoResiduo = im.costo_storico - fondoIniziale - fondoProiez;
        if (nettoResiduo <= 0) { quota = 0; }
        else if (quota > nettoResiduo) { quota = Math.round(nettoResiduo); }
        // Aggiorna fondo cumulativo proiezioni
        if (fondoProiezioni && quota > 0) {
          fondoProiezioni[id] = fondoProiez + quota;
        }

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
    var residuoTotale = 0;

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

      // Simula i mesi fino a inizio anno corrente (solo italiano: quota capitale costante)
      for (var m = 0; m < mesiPassati && m < durRes; m++) {
        var quotaCap = cap / durRes;
        capResiduo -= quotaCap;
      }

      // Calcola i 12 mesi dell'anno corrente
      for (var mm = 0; mm < 12; mm++) {
        var meseAbs = mesiPassati + mm;
        if (meseAbs >= durRes || capResiduo <= 0) break;

        var qCap = cap / durRes;
        var qInt = capResiduo * tassoMese;
        interessiAnno += qInt;
        capitaleAnno += qCap;
        capResiduo -= qCap;
      }

      interessiTotale += Math.round(interessiAnno);
      capitaleTotale += Math.round(capitaleAnno);
      residuoTotale += Math.max(0, Math.round(capResiduo));
    });

    return {
      interessi_totale: interessiTotale,
      capitale_rimborsato: capitaleTotale,
      residuo_totale: residuoTotale,
      uscita_cassa: interessiTotale + capitaleTotale
    };
  }

  /* ── Motore mensile: distribuzione e calcolo infrannuale ──── */

  var _PROFILO_UNIFORME = [8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34];

  /**
   * Distribuisce un importo annuale in 12 valori mensili secondo un profilo %.
   * Per il primo anno di una costituenda, i mesi pre-avvio sono azzerati e
   * il totale viene redistribuito sui mesi operativi.
   */
  function _distribuisciMensile(annuale, profilo, meseAvvio, isPrimoAnnoParziale) {
    var pesi = [];
    var totPeso = 0;
    for (var m = 0; m < 12; m++) {
      var p = (isPrimoAnnoParziale && m < meseAvvio - 1) ? 0 : (profilo[m] || 0);
      pesi[m] = p;
      totPeso += p;
    }
    var result = [];
    var somma = 0;
    for (m = 0; m < 12; m++) {
      result[m] = totPeso > 0 ? Math.round(annuale * pesi[m] / totPeso) : 0;
      somma += result[m];
    }
    // Aggiusta arrotondamento sull'ultimo mese attivo
    var diff = annuale - somma;
    if (diff !== 0) {
      for (m = 11; m >= 0; m--) {
        if (result[m] > 0) { result[m] += diff; break; }
      }
    }
    return result;
  }

  /**
   * Calcola i dati mensili per un anno: distribuzione ricavi/costi,
   * crediti/debiti al 31/12, IVA con liquidazione periodica.
   *
   * @returns {Object} { ricavi[], costi[], personale[], iva_debito[], iva_credito[],
   *   iva_netta[], crediti_clienti, debiti_fornitori, iva_debito_31dic,
   *   iva_credito_31dic }
   */
  function _calcolaMensile(ce, driver, fisc, meta, anno, annoBase, ivaCreditoRiporto) {
    var circ = driver.circolante || {};
    var isCostitutenda = meta && meta.scenario === 'costituenda';
    var meseAvvio = (meta && meta.mese_avvio) || 1;
    var parziale = isCostitutenda && anno === annoBase && meseAvvio > 1;

    // Profilo: stagionalità se attiva, altrimenti uniforme
    var profilo = driver.stagionalita_attiva ? (driver.profilo_stagionale || _PROFILO_UNIFORME) : _PROFILO_UNIFORME;

    // ── Distribuzione ricavi mensili ──
    var ricaviMensili = _distribuisciMensile(ce.ricavi_totale, profilo, meseAvvio, parziale);

    // ── Distribuzione costi mensili ──
    // I costi pct_ricavi seguono la distribuzione dei ricavi;
    // i costi fissi si distribuiscono uniformemente.
    // Raggruppati per aliquota IVA per calcolo IVA credito mensile preciso.
    var costiPctRicavi = 0, costiFissi = 0;
    var ivaFasce = {}; // { aliquota: { pctRicavi: importo, fissi: importo } }
    var dett = (ce.costi_dettaglio || []);
    for (var d = 0; d < dett.length; d++) {
      var ivaPct = dett[d].iva_pct || 0;
      if (!ivaFasce[ivaPct]) ivaFasce[ivaPct] = { pctRicavi: 0, fissi: 0 };
      if (dett[d].tipo_driver === 'pct_ricavi') {
        costiPctRicavi += dett[d].importo;
        ivaFasce[ivaPct].pctRicavi += dett[d].importo;
      } else {
        costiFissi += dett[d].importo;
        ivaFasce[ivaPct].fissi += dett[d].importo;
      }
    }
    var costiPctMensili = _distribuisciMensile(costiPctRicavi, profilo, meseAvvio, parziale);
    var costiFissiMensili = _distribuisciMensile(costiFissi, _PROFILO_UNIFORME, meseAvvio, parziale);
    var costiMensili = [];
    for (var m = 0; m < 12; m++) {
      costiMensili[m] = costiPctMensili[m] + costiFissiMensili[m];
    }

    // Personale: uniforme (il calcolo mensile dettagliato è in calcolaPersonaleAnno)
    var personaleMensili = _distribuisciMensile(ce.personale_totale, _PROFILO_UNIFORME, meseAvvio, parziale);

    // ── IVA mensile ──
    // IVA debito: usa aliquota IVA ricavi configurata
    var ivaRicaviPct = fisc.iva_ricavi || 0.22;
    // IVA credito: calcolata per fascia IVA con distribuzione mensile propria
    // (costi pct_ricavi seguono profilo stagionale, fissi uniformi)
    var ivaCreditoMensilePerFascia = {};
    var aliquote = Object.keys(ivaFasce);
    for (d = 0; d < aliquote.length; d++) {
      var aliq = parseFloat(aliquote[d]);
      if (aliq === 0) continue; // nessuna IVA su questa fascia
      var fascia = ivaFasce[aliquote[d]];
      var pctM = fascia.pctRicavi > 0 ? _distribuisciMensile(fascia.pctRicavi, profilo, meseAvvio, parziale) : null;
      var fixM = fascia.fissi > 0 ? _distribuisciMensile(fascia.fissi, _PROFILO_UNIFORME, meseAvvio, parziale) : null;
      ivaCreditoMensilePerFascia[aliquote[d]] = { aliq: aliq, pctM: pctM, fixM: fixM };
    }
    var ivaDebitoM = [], ivaCreditoM = [], ivaNettaM = [];
    for (m = 0; m < 12; m++) {
      ivaDebitoM[m] = Math.round(ricaviMensili[m] * ivaRicaviPct);
      // IVA credito: somma di ogni fascia × propria aliquota
      var credM = 0;
      for (d = 0; d < aliquote.length; d++) {
        var info = ivaCreditoMensilePerFascia[aliquote[d]];
        if (!info) continue;
        var costoMese = (info.pctM ? info.pctM[m] : 0) + (info.fixM ? info.fixM[m] : 0);
        credM += Math.round(costoMese * info.aliq);
      }
      ivaCreditoM[m] = credM;
      ivaNettaM[m] = ivaDebitoM[m] - ivaCreditoM[m];
    }

    // ── IVA liquidazione e debito al 31/12 ──
    var liqTrimestrale = (fisc.liquidazione_iva === 'trimestrale');
    var ivaDebito31dic = 0;
    var ivaCumuloCredito = ivaCreditoRiporto || 0; // credito IVA riportato da anno precedente
    if (liqTrimestrale) {
      // Trimestrale: Q1(gen-mar)→mag16, Q2(apr-giu)→ago16, Q3(lug-set)→nov16, Q4(ott-dic)→feb16
      // Al 31/12 non pagato = Q4
      var q4 = 0;
      for (m = 9; m <= 11; m++) q4 += ivaNettaM[m];
      // Riporto credito da trimestri precedenti
      for (var q = 0; q < 3; q++) { // Q1, Q2, Q3
        var qStart = q * 3;
        var qSum = 0;
        for (var qm = qStart; qm < qStart + 3; qm++) qSum += ivaNettaM[qm];
        var saldoQ = ivaCumuloCredito + qSum;
        if (saldoQ < 0) {
          ivaCumuloCredito = saldoQ; // credito riportato
        } else {
          ivaCumuloCredito = 0; // pagato, azzerato
        }
      }
      var saldoQ4 = ivaCumuloCredito + q4;
      ivaDebito31dic = Math.max(0, saldoQ4);
      ivaCumuloCredito = saldoQ4 < 0 ? saldoQ4 : 0;
    } else {
      // Mensile: dicembre pagato il 16 gennaio
      // Riporto credito mese per mese
      for (m = 0; m < 11; m++) { // gen-nov: pagati entro il 16 del mese successivo
        var saldoM = ivaCumuloCredito + ivaNettaM[m];
        ivaCumuloCredito = saldoM < 0 ? saldoM : 0;
      }
      var saldoDic = ivaCumuloCredito + ivaNettaM[11];
      ivaDebito31dic = Math.max(0, saldoDic);
      ivaCumuloCredito = saldoDic < 0 ? saldoDic : 0;
    }

    // ── Crediti clienti al 31/12: fatturato LORDO (imponibile + IVA) degli ultimi ceil(DSO/30) mesi ──
    // Art. 2424 c.c.: il credito verso il cliente è l'importo totale della fattura (IVA inclusa)
    var mesiDSO = Math.max(1, Math.ceil((circ.dso || 30) / 30));
    var creditiClienti = 0;
    for (m = Math.max(0, 12 - mesiDSO); m < 12; m++) {
      creditiClienti += ricaviMensili[m] + ivaDebitoM[m];
    }

    // ── Debiti fornitori al 31/12: costi LORDI (imponibile + IVA) degli ultimi ceil(DPO/30) mesi ──
    // Solo costi operativi, NON personale (che genera debiti vs dipendenti/INPS)
    // Il debito verso il fornitore include l'IVA esposta in fattura
    var mesiDPO = Math.max(1, Math.ceil((circ.dpo || 30) / 30));
    var debitiFornitori = 0;
    for (m = Math.max(0, 12 - mesiDPO); m < 12; m++) {
      debitiFornitori += costiMensili[m] + ivaCreditoM[m];
    }

    return {
      ricavi: ricaviMensili,
      costi: costiMensili,
      personale: personaleMensili,
      iva_debito: ivaDebitoM,
      iva_credito: ivaCreditoM,
      iva_netta: ivaNettaM,
      crediti_clienti: creditiClienti,
      debiti_fornitori: debitiFornitori,
      iva_debito_31dic: ivaDebito31dic,
      iva_credito_fine_anno: Math.max(0, -ivaCumuloCredito), // credito IVA residuo a fine anno (va in attivo SP)
      _ivaCumuloCredito: ivaCumuloCredito // carry-forward per anno successivo (negativo = credito)
    };
  }

  /* ── IVA annuale (mantenuta per CE aggregato) ──────────────── */

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

  /* ── Trace: spiega come ogni voce è calcolata ─────────────── */

  function _fmt(v) {
    if (v === 0 || v === undefined || v === null) return '0';
    var neg = v < 0; var a = Math.abs(v);
    var s = String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return neg ? '-' + s : s;
  }
  function _pct(v) { return (v * 100).toFixed(1).replace('.', ',') + '%'; }

  function _buildTrace(ce, sp, cf, spPrev, driver, fisc, smobResidui, mensile) {
    smobResidui = smobResidui || {};
    mensile = mensile || {};
    var circ = (driver && driver.circolante) || {};
    var t = {};
    // ── CE ──
    t['ce.ricavi_totale'] = 'Somma driver ricavi';
    t['ce.costi_totale'] = 'Somma driver costi';
    t['ce.personale_totale'] = 'Stipendi + Oneri sociali + TFR';
    t['ce.ammortamenti'] = 'Immateriali ' + _fmt(ce.ammort_immateriali) + ' + Materiali ' + _fmt(ce.ammort_materiali);
    t['ce.variazione_rimanenze'] = 'Rim. finali ' + _fmt(sp.rimanenze) + ' − Rim. iniziali ' + _fmt(spPrev.rimanenze);
    t['ce.valore_produzione'] = 'Ricavi ' + _fmt(ce.ricavi_totale) + ' + Var.rim. ' + _fmt(ce.variazione_rimanenze);
    t['ce.ebitda'] = 'VP ' + _fmt(ce.valore_produzione) + ' − Costi ' + _fmt(ce.costi_totale) + ' − Personale ' + _fmt(ce.personale_totale);
    t['ce.ebit'] = 'EBITDA ' + _fmt(ce.ebitda) + ' − Ammort. ' + _fmt(ce.ammortamenti);
    t['ce.oneri_finanziari'] = 'Interessi su finanziamenti in essere ed eventi';
    t['ce.risultato_ante_imposte'] = 'EBIT ' + _fmt(ce.ebit) + ' − Oneri fin. ' + _fmt(ce.oneri_finanziari);
    t['ce.ires'] = 'max(0, Ris.ante imp. ' + _fmt(ce.risultato_ante_imposte) + ' × ' + _pct(fisc.aliquota_ires || 0.24) + ')';
    t['ce.irap'] = 'max(0, Base IRAP ' + _fmt(ce.valore_produzione - ce.costi_totale - ce.ammortamenti) + ' × ' + _pct(fisc.aliquota_irap || 0.039) + ')';
    t['ce.imposte'] = 'IRES ' + _fmt(ce.ires) + ' + IRAP ' + _fmt(ce.irap);
    t['ce.utile_netto'] = 'Ris.ante imp. ' + _fmt(ce.risultato_ante_imposte) + ' − Imposte ' + _fmt(ce.imposte);
    // ── SP ──
    t['sp.immob_immateriali_nette'] = 'Prec. ' + _fmt(spPrev.immob_immateriali_nette) + ' − Ammort. ' + _fmt(spPrev.immob_immateriali_nette - sp.immob_immateriali_nette);
    t['sp.immob_materiali_nette'] = 'Prec. ' + _fmt(spPrev.immob_materiali_nette) + ' − Ammort. ' + _fmt(spPrev.immob_materiali_nette - sp.immob_materiali_nette);
    t['sp.immob_finanziarie'] = 'Invariate dal periodo precedente';
    var mesiDSO = Math.max(1, Math.ceil((circ.dso || 30) / 30));
    var smobCred = smobResidui.crediti_clienti || 0;
    t['sp.crediti_clienti'] = 'Fatt. lordo (IVA incl.) ultimi ' + mesiDSO + ' mesi (DSO ' + (circ.dso || 30) + 'gg) = ' + _fmt(mensile.crediti_clienti || 0) + (smobCred > 0 ? ' + smobilizzo pregressi ' + _fmt(smobCred) : '');
    var mesiDPO = Math.max(1, Math.ceil((circ.dpo || 30) / 30));
    var smobDeb = smobResidui.debiti_fornitori || 0;
    t['sp.debiti_fornitori'] = 'Costi lordi (IVA incl.) ultimi ' + mesiDPO + ' mesi (DPO ' + (circ.dpo || 30) + 'gg) = ' + _fmt(mensile.debiti_fornitori || 0) + (smobDeb > 0 ? ' + smobilizzo pregressi ' + _fmt(smobDeb) : '');
    t['sp.rimanenze'] = 'max(Costi ' + _fmt(ce.costi_totale) + ' × DIO ' + (circ.dio || 0) + 'gg / 360 = ' + _fmt(Math.round(ce.costi_totale * (circ.dio || 0) / 360)) + ', Prec. ' + _fmt(spPrev.rimanenze) + ')';
    t['sp.altri_crediti'] = 'Smobilizzo residuo (mesi incasso configurati)';
    var ivaCredFine = (mensile.iva_credito_fine_anno || 0);
    t['sp.crediti_tributari_iva'] = ivaCredFine > 0
      ? 'Credito IVA residuo a fine anno (C.II.5-bis): ' + _fmt(ivaCredFine)
      : 'Nessun credito IVA residuo';
    t['sp.debiti_finanziari'] = 'Residuo finanziamenti in essere + nuovi eventi';
    var smobTrib = smobResidui.debiti_tributari || 0;
    var liqLabel = (fisc.liquidazione_iva === 'trimestrale') ? 'IVA Q4' : 'IVA dic.';
    t['sp.debiti_tributari'] = 'Saldo imposte ' + _fmt(sp._deb_trib_imposte) + ' + ' + liqLabel + ' ' + _fmt(sp._deb_trib_iva) + (smobTrib > 0 ? ' + smobilizzo pregressi ' + _fmt(smobTrib) : '');
    t['sp.tfr'] = 'Prec. ' + _fmt(spPrev.tfr) + ' + Quota anno ' + _fmt(ce.personale.tfr);
    t['sp.capitale_sociale'] = sp.capitale_sociale !== spPrev.capitale_sociale ? 'Prec. ' + _fmt(spPrev.capitale_sociale) + ' + Versamenti ' + _fmt(sp.capitale_sociale - spPrev.capitale_sociale) : 'Invariato dal periodo precedente';
    t['sp.riserve'] = 'Invariate dal periodo precedente';
    t['sp.utili_portati_nuovo'] = 'Prec. ' + _fmt(spPrev.utili_portati_nuovo) + ' + Utile es. prec. ' + _fmt(spPrev.utile_esercizio);
    t['sp.utile_esercizio'] = 'Utile netto CE: ' + _fmt(ce.utile_netto);
    var smobPrev = smobResidui.debiti_previdenziali || 0;
    var contribBase = Math.round(ce.personale.oneri / 12);
    t['sp.debiti_previdenziali'] = 'Contributi dic. ' + _fmt(contribBase) + (smobPrev > 0 ? ' + smobilizzo pregressi ' + _fmt(smobPrev) : '');
    t['sp.fin_soci'] = sp.fin_soci !== spPrev.fin_soci ? 'Prec. ' + _fmt(spPrev.fin_soci) + ' + Movimenti ' + _fmt(sp.fin_soci - spPrev.fin_soci) : 'Invariato';
    t['sp.cassa_attivo'] = 'max(0, cassa netta ' + _fmt(sp.cassa) + ')';
    t['sp.cassa_passivo'] = sp.cassa_passivo > 0 ? 'Scoperto: |cassa netta ' + _fmt(sp.cassa) + '|' : 'Nessuno scoperto';
    t['sp.patrimonio_netto'] = 'Cap. ' + _fmt(sp.capitale_sociale) + ' + Ris. ' + _fmt(sp.riserve) + ' + Ut.nuovo ' + _fmt(sp.utili_portati_nuovo) + ' + Ut.es. ' + _fmt(sp.utile_esercizio);
    t['sp.totale_attivo'] = 'Immob. ' + _fmt(sp.immobilizzazioni_nette) + ' + Circ. ' + _fmt(sp.attivo_circolante) + ' + Cassa ' + _fmt(sp.cassa_attivo);
    t['sp.totale_passivo'] = 'PN ' + _fmt(sp.patrimonio_netto) + ' + Deb.fin. ' + _fmt(sp.debiti_finanziari) + ' + Deb.forn. ' + _fmt(sp.debiti_fornitori) + ' + Deb.trib. ' + _fmt(sp.debiti_tributari) + ' + TFR ' + _fmt(sp.tfr) + ' + Altri ' + _fmt(sp.altri_debiti) + (sp.cassa_passivo > 0 ? ' + Scoperti ' + _fmt(sp.cassa_passivo) : '');
    // ── CF ──
    t['cash_flow.utile_netto'] = 'Da CE: ' + _fmt(ce.utile_netto);
    t['cash_flow.ammortamenti'] = 'Da CE: ' + _fmt(ce.ammortamenti);
    t['cash_flow.var_crediti'] = '−(Crediti ' + _fmt(sp.crediti_clienti) + ' − Prec. ' + _fmt(spPrev.crediti_clienti) + ')';
    t['cash_flow.var_rimanenze'] = '−(Rim. ' + _fmt(sp.rimanenze) + ' − Prec. ' + _fmt(spPrev.rimanenze) + ')';
    t['cash_flow.var_debiti_fornitori'] = 'Deb.forn. ' + _fmt(sp.debiti_fornitori) + ' − Prec. ' + _fmt(spPrev.debiti_fornitori);
    t['cash_flow.var_debiti_tributari'] = 'Deb.trib. ' + _fmt(sp.debiti_tributari) + ' − Prec. ' + _fmt(spPrev.debiti_tributari);
    t['cash_flow.var_tfr'] = 'TFR ' + _fmt(sp.tfr) + ' − Prec. ' + _fmt(spPrev.tfr);
    t['cash_flow.flusso_operativo'] = 'Utile + Ammort. + Var. capitale circolante';
    t['cash_flow.flusso_investimenti'] = '−Investimenti dell\'anno';
    t['cash_flow.flusso_finanziario'] = 'Flusso netto − Fl.operativo − Fl.investimenti (residuo)';
    t['cash_flow.flusso_netto'] = 'Cassa finale ' + _fmt(sp.cassa) + ' − Cassa iniziale ' + _fmt(spPrev.cassa);
    return t;
  }

  /* ── SP previsionale ─────────────────────────────────────── */

  function _calcolaSPAnno(spPrev, ce, finanz, ammort, driver, anno, annoBase, progetto, impostePrecedenti) {
    var circ = driver.circolante || {};
    var sp = {};

    // Immobilizzazioni: valore precedente - ammortamento anno
    sp.immob_immateriali_nette = Math.max(0, spPrev.immob_immateriali_nette - ammort.immateriali);
    sp.immob_materiali_nette = Math.max(0, spPrev.immob_materiali_nette - ammort.materiali);
    sp.immob_finanziarie = spPrev.immob_finanziarie;
    sp.immobilizzazioni_nette = sp.immob_immateriali_nette + sp.immob_materiali_nette + sp.immob_finanziarie;

    // Circolante: valori iniziali (sovrascritti dal motore mensile nel loop principale)
    sp.crediti_clienti = Math.round(ce.ricavi_totale * (circ.dso || 0) / 360);
    sp.debiti_fornitori = Math.round(ce.costi_totale * (circ.dpo || 0) / 360);
    // Rimanenze: il livello DIO rappresenta il fabbisogno operativo;
    // le rimanenze storiche eccedenti il DIO vengono preservate finché non
    // consumate esplicitamente tramite eventi "utilizzo_rimanenze".
    var rimanenzeDIO = Math.round(ce.costi_totale * (circ.dio || 0) / 360);
    sp.rimanenze = Math.max(rimanenzeDIO, spPrev.rimanenze);
    sp.altri_crediti = spPrev.altri_crediti; // default; sovrascritto da smobilizzo nel loop principale
    sp.crediti_tributari_iva = 0; // default; sovrascritto dal motore mensile nel loop principale
    sp.attivo_circolante = sp.crediti_clienti + sp.rimanenze + sp.altri_crediti;

    // Debiti finanziari: precedente - rimborso capitale
    sp.debiti_finanziari = Math.max(0, spPrev.debiti_finanziari - finanz.capitale_rimborsato);

    // Debiti tributari al 31/12:
    // 1. Saldo imposte: imposte correnti − acconti versati (≈ imposte anno precedente, metodo storico)
    //    Anno 1: nessun dato storico → imposte/2 come approssimazione
    // 2. IVA ultimo mese: liquidazione dicembre da versare entro il 16 gennaio
    var ivaUltimoMese = ce.iva ? Math.round(ce.iva.da_versare / 12) : 0;
    var saldoImposte = impostePrecedenti > 0
      ? Math.max(0, Math.round(ce.imposte - impostePrecedenti))
      : Math.round(ce.imposte / 2);
    sp.debiti_tributari = saldoImposte + ivaUltimoMese;
    // Salva componenti per trace
    sp._deb_trib_imposte = saldoImposte;
    sp._deb_trib_iva = ivaUltimoMese;

    // TFR: accumula quota annua
    sp.tfr = spPrev.tfr + ce.personale.tfr;

    // Altri debiti: default; sotto-componenti sovrascritte da smobilizzo nel loop principale
    // Debiti previdenziali: contributi INPS di dicembre da versare il 16 gennaio
    var contribMensili = Math.round(ce.personale.oneri / 12);
    sp.debiti_previdenziali = contribMensili;
    sp.altri_debiti_residui = spPrev.altri_debiti_residui;
    sp.fin_soci = spPrev.fin_soci;
    sp.altri_debiti = sp.debiti_previdenziali + sp.altri_debiti_residui + sp.fin_soci;

    // Patrimonio netto: dettaglio componenti
    // Capitale e riserve restano costanti; l'utile dell'esercizio precedente
    // viene portato a nuovo, e il nuovo utile è dell'anno corrente.
    sp.capitale_sociale = spPrev.capitale_sociale;
    sp.riserve = spPrev.riserve;
    sp.utili_portati_nuovo = spPrev.utili_portati_nuovo + spPrev.utile_esercizio;
    sp.utile_esercizio = ce.utile_netto;
    sp.patrimonio_netto = sp.capitale_sociale + sp.riserve + sp.utili_portati_nuovo + sp.utile_esercizio;

    // cassa, totale_attivo, totale_passivo calcolati nel loop principale
    // (cassa = residuo che quadra A = P)

    return sp;
  }

  // Nota: il CF è ora calcolato direttamente nel loop principale come derivato
  // delle variazioni SP (cassa = residuo che quadra A = P).

  /* ── Smobilizzo crediti/debiti (primi mesi) ──────────────── */
  // Smobilizzo implementato nel loop principale di calcolaProiezioni():
  // i saldi storici decrescono linearmente in base ai mesi_incasso configurati,
  // sommandosi ai valori operativi (DSO/DPO) per le voci con driver.

  /* ── Helper eventi ───────────────────────────────────────── */

  /**
   * Calcola costi annuali con applicazione degli eventi (variazioni MP, costi variabili, costi gestione).
   */
  function _calcolaCostiAnnoConEventi(driverCosti, ricaviTotale, anno, annoBase, inflazioneMap,
      multMP, multCostiVarStrutt, multCostiVarPunt, costiGestOverride, meta) {
    var totale = 0;
    var totaleIvaCredito = 0;
    var dettaglio = [];
    var isCostitutenda = meta && meta.scenario === 'costituenda';
    var meseAvvio = (meta && meta.mese_avvio) || 1;

    (driverCosti || []).forEach(function(drv) {
      if (drv.usa_var_personale) return;

      var importo = 0;
      if (drv.tipo_driver === 'pct_ricavi') {
        var pct = drv.pct_ricavi || 0;
        var anniDiff = anno - annoBase;
        if (drv.var_pct_annua && anniDiff > 0) {
          pct = pct + (drv.var_pct_annua * anniDiff);
        }
        importo = Math.round(ricaviTotale * pct);

        // Evento: variazione costi variabili per questo driver
        var multVar = (multCostiVarStrutt[drv.id] || 1) * (multCostiVarPunt[drv.id] || 1);
        importo = Math.round(importo * multVar);
      } else {
        var base = drv.importo_fisso || 0;
        var isPrimoAnnoParz = isCostitutenda && meseAvvio > 1;
        var mesiOp2 = 13 - meseAvvio;
        if (drv.base_tipo === 'mensile') {
          base = (isPrimoAnnoParz && anno === annoBase)
            ? base * mesiOp2
            : base * 12;
        } else {
          // Annuale: pro-rata nel primo anno parziale
          if (isPrimoAnnoParz && anno === annoBase) {
            base = Math.round(base * mesiOp2 / 12);
          }
        }
        if (drv.soggetto_inflazione && anno > annoBase) {
          var fattoreInfl = 1;
          for (var a = annoBase + 1; a <= anno; a++) {
            var infAnno = (inflazioneMap && inflazioneMap[String(a)]) || 0;
            fattoreInfl *= (1 + infAnno);
          }
          importo = Math.round(base * fattoreInfl);
        } else {
          importo = base;
        }
      }

      // Evento: andamento costi gestione override
      var override = costiGestOverride[drv.id];
      if (override) {
        switch (override.azione) {
          case 'cessato':
            importo = 0;
            break;
          case 'attivato':
            importo = override.importo_nuovo || 0;
            break;
          case 'aumentato':
            importo = override.importo_nuovo || importo;
            break;
          case 'variazione':
            importo = Math.round(importo * (1 + (override.variazione_pct || 0)));
            break;
        }
      }

      // Evento: variazione costi materie prime (B.6)
      if (drv.voce_ce && drv.voce_ce.indexOf('ce.B.6') === 0) {
        importo = Math.round(importo * multMP);
      }

      var ivaPct = drv.iva_pct || 0;
      var ivaCredito = Math.round(importo * ivaPct);
      totaleIvaCredito += ivaCredito;

      totale += importo;
      dettaglio.push({ id: drv.id, label: drv.label, importo: importo, iva_credito: ivaCredito,
        iva_pct: ivaPct, tipo_driver: drv.tipo_driver, voce_ce: drv.voce_ce });
    });

    return { totale: totale, iva_credito: totaleIvaCredito, dettaglio: dettaglio };
  }

  /**
   * Calcola interessi e rimborso capitale per un singolo nuovo finanziamento (evento).
   * Simile a _calcolaFinanziamentiAnno ma per un singolo finanziamento con data_inizio.
   */
  function _calcolaFinanziamentoSingolo(fin, annoCalc) {
    if (!fin.importo || !fin.tasso_annuo || !fin.durata_mesi || !fin.anno) {
      return { interessi: 0, capitale: 0, residuo: fin.importo || 0 };
    }

    var meseInizio = fin.mese || 1;
    var annoInizio = fin.anno;

    var tassoMese = fin.tasso_annuo / 12;
    var cap = fin.importo;
    var dur = fin.durata_mesi;
    var capResiduo = cap;

    // Mese assoluto 0 = mese inizio finanziamento
    var meseAssInizioAnno = (annoCalc - annoInizio) * 12 + (1 - meseInizio);
    var meseAssFineAnno = meseAssInizioAnno + 11;

    // Simula dalla partenza fino a inizio anno (solo italiano: quota capitale costante)
    for (var m = 0; m < meseAssInizioAnno && m < dur; m++) {
      if (capResiduo <= 0) break;
      capResiduo -= cap / dur;
    }

    var interessiAnno = 0, capitaleAnno = 0;
    for (var mm = Math.max(0, meseAssInizioAnno); mm <= meseAssFineAnno && mm < dur; mm++) {
      if (capResiduo <= 0) break;
      var qCap = cap / dur;
      interessiAnno += capResiduo * tassoMese;
      capitaleAnno += qCap;
      capResiduo -= qCap;
    }

    return {
      interessi: Math.round(interessiAnno),
      capitale: Math.round(capitaleAnno),
      residuo: Math.max(0, Math.round(capResiduo))
    };
  }

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    calcolaValore,
    calcolaPersonaleAnno,
    calcolaProiezioni
  };

})();
