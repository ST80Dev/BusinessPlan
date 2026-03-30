/**
 * engine.js
 * Motore di calcolo previsionale mensile.
 *
 * Stub Fase 1 — il motore completo viene implementato in Fase 6.
 * Questo file espone l'oggetto Engine con metodi placeholder
 * per evitare errori di riferimento nelle fasi successive.
 *
 * Dipende da: schema.js
 * Non dipende da: ui.js, projects.js
 */

'use strict';

const Engine = (() => {

  /**
   * Calcola il valore aggregato di un nodo (somma ricorsiva dei figli).
   * Usato gia in Fase 1 per subtotali e totali nelle tabelle SP/CE.
   * @param {Object} nodo   - nodo dello schema (mastro/sottomastro/totale)
   * @param {Object} dati   - oggetto { contoId: valore, ... }
   * @param {Array}  [tree] - albero di riferimento (per nodi 'totale' con campo somma)
   * @returns {number}
   */
  function calcolaValore(nodo, dati, tree) {
    if (!nodo) return 0;

    // Nodo totale con campo 'somma': somma dei nodi referenziati
    if (nodo.tipo === 'totale' && nodo.somma) {
      let tot = 0;
      for (const id of nodo.somma) {
        const ref = Schema.trovaNodo(id);
        if (ref) {
          const val = calcolaValore(ref, dati, tree);
          tot += val * (ref.segno !== undefined ? ref.segno : 1);
        }
      }
      return tot;
    }

    // Nodo computed con figli: somma ricorsiva
    if (nodo.computed && nodo.children) {
      let tot = 0;
      for (const figlio of nodo.children) {
        const val = calcolaValore(figlio, dati, tree);
        tot += val * (figlio.segno !== undefined ? figlio.segno : 1);
      }
      return tot;
    }

    // Nodo foglia o editabile senza figli: valore diretto dai dati
    return dati[nodo.id] || 0;
  }

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    calcolaValore
  };

})();
