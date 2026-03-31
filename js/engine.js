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

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    calcolaValore,
    calcolaPersonaleAnno
  };

})();
