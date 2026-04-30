/**
 * Loader delle regole annuali e delle aliquote IRAP regionali per il modulo Imposte.
 *
 * I file JSON in data/imposte/ sono la fonte di verità dei parametri normativi
 * (aliquote, soglie, codici tributo, scadenze) e delle aliquote IRAP per
 * regione. Un cambio normativo si gestisce creando un nuovo file
 * regole-anno-<YYYY>.json / aliquote-irap-<YYYY>.json senza toccare il motore.
 *
 * Vedi caratteristiche_modulo_imposte.md §15.
 */
(function (global) {
  'use strict';

  const CACHE = {
    regole: {},   // { 2025: {...}, 2026: {...} }
    aliquote: {}  // { 2025: {...}, 2026: {...} }
  };

  const BASE_PATH = 'data/imposte/';

  /**
   * Carica il file regole-anno-<anno>.json.
   * Restituisce l'oggetto JSON (con cache).
   * In caso di errore di rete/parsing logga in console e restituisce null.
   */
  async function caricaRegoleAnno(anno) {
    if (CACHE.regole[anno]) return CACHE.regole[anno];
    const path = BASE_PATH + 'regole-anno-' + anno + '.json';
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      CACHE.regole[anno] = data;
      return data;
    } catch (err) {
      console.warn('[imposte] Regole anno ' + anno + ' non caricate:', err.message);
      return null;
    }
  }

  /**
   * Carica il file aliquote-irap-<anno>.json.
   */
  async function caricaAliquoteIrap(anno) {
    if (CACHE.aliquote[anno]) return CACHE.aliquote[anno];
    const path = BASE_PATH + 'aliquote-irap-' + anno + '.json';
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      CACHE.aliquote[anno] = data;
      return data;
    } catch (err) {
      console.warn('[imposte] Aliquote IRAP anno ' + anno + ' non caricate:', err.message);
      return null;
    }
  }

  /**
   * Restituisce l'aliquota IRAP per la regione e categoria indicate.
   * Se la regione non è in tabella ricade su DEFAULT con flag fallback=true.
   * Se neanche DEFAULT è presente restituisce null.
   *
   * @param {object} aliquoteAnno - oggetto restituito da caricaAliquoteIrap()
   * @param {string} regione - es. "Marche"
   * @param {string} categoria - es. "ordinaria" (default)
   * @returns {{aliquota:number, fallback:boolean, note:string}|null}
   */
  function risolviAliquotaIrap(aliquoteAnno, regione, categoria) {
    if (!aliquoteAnno || !aliquoteAnno.regioni) return null;
    categoria = categoria || 'ordinaria';
    const reg = aliquoteAnno.regioni[regione];
    if (reg && typeof reg[categoria] === 'number') {
      return { aliquota: reg[categoria], fallback: false, note: reg._note || '' };
    }
    const def = aliquoteAnno.regioni.DEFAULT;
    if (def && typeof def[categoria] === 'number') {
      return {
        aliquota: def[categoria],
        fallback: true,
        note: 'Regione "' + regione + '" non in tabella: applicata aliquota DEFAULT. Verificare l\'aliquota effettiva.'
      };
    }
    return null;
  }

  /**
   * Restituisce l'aliquota di imposta sostitutiva CPB in funzione del
   * punteggio ISA, secondo la tabella regole.cpb.imposta_sostitutiva_aliquote.
   * @param {object} regoleAnno
   * @param {number} punteggioIsa
   * @returns {number|null}
   */
  function risolviAliquotaSostitutivaCpb(regoleAnno, punteggioIsa) {
    if (!regoleAnno || !regoleAnno.cpb || !Array.isArray(regoleAnno.cpb.imposta_sostitutiva_aliquote)) {
      return null;
    }
    if (typeof punteggioIsa !== 'number' || isNaN(punteggioIsa)) return null;
    for (const fascia of regoleAnno.cpb.imposta_sostitutiva_aliquote) {
      const min = (fascia.isa_min === null || fascia.isa_min === undefined) ? -Infinity : fascia.isa_min;
      const max = (fascia.isa_max === null || fascia.isa_max === undefined) ? Infinity : fascia.isa_max;
      if (punteggioIsa >= min && punteggioIsa < max) return fascia.aliquota;
    }
    return null;
  }

  /**
   * Resetta la cache (utile per test / ricaricamento manuale).
   */
  function resetCache() {
    CACHE.regole = {};
    CACHE.aliquote = {};
  }

  global.ImposteRegoleLoader = {
    caricaRegoleAnno: caricaRegoleAnno,
    caricaAliquoteIrap: caricaAliquoteIrap,
    risolviAliquotaIrap: risolviAliquotaIrap,
    risolviAliquotaSostitutivaCpb: risolviAliquotaSostitutivaCpb,
    resetCache: resetCache
  };
})(typeof window !== 'undefined' ? window : globalThis);
