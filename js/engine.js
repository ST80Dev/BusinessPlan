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

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    calcolaValore
  };

})();
