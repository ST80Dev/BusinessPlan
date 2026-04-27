/**
 * excel-import.js
 * Parser di dominio per bilanci di verifica Excel di provenienza
 * gestionali italiani (formato wide a 3 anni con D/A per anno).
 *
 * Il parser identifica la sezione CE (dopo il pivot 54/00/000
 * "RATEI E RISCONTI PASSIVI"), estrae i sottoconti foglia
 * (codice XX/XX/XXX) ignorando i subtotali di mastro e
 * sotto-mastro, e ricava le rimanenze iniziali/finali dalla doppia
 * entry D/A dei mastri di variazione (61 lavori in corso, 80
 * variazione rimanenze materiali).
 *
 * Dipende da xlsx-mini.js per la lettura del file.
 *
 * Esposto come ExcelImport globale.
 */

'use strict';

const ExcelImport = (() => {

  /* Codice del primo mastro PASSIVO che fa da pivot per separare
     SP/CE: tutto ciò che viene dopo è CE (Ricavi e Costi). */
  const PIVOT_CE = '54/00/000';

  /* Mastri di variazione rimanenze: hanno doppia entry D/A nello
     stesso mastro. La somma dei Dare = rim. iniziali, la somma degli
     Avere = rim. finali. */
  const MASTRI_VARIAZIONE_RIMANENZE = ['61', '80'];

  /* Pattern codici conto:
       MASTRO            XX/00/000  oppure  XX/00000 (variante 5 cifre)
       CONTO             XX/SS/000  con SS != '00'
       SOTTOCONTO        XX/SS/CCC  con CCC != '000'
     Le righe MASTRO e CONTO sono subtotali e vanno ignorate
     dal feed dei sottoconti per evitare doppio conteggio. */
  const RX_LEAF      = /^(\d{2})\/(\d{2})\/(\d{3})$/;
  const RX_MASTRO_5  = /^(\d{2})\/00000$/;

  /* Tabella di traduzione sigle file → id macroarea del modello tool.
     Usata quando il file Excel ha già le colonne M/sM compilate
     (es. file di analisi pre-mappato dello studio). Le sigle Mastro
     (Ric/CVar/CFix/Tax) vengono ignorate ai fini della conversione:
     l'identificatore è il sotto-Mastro (sM).
     Le sigle Rim_I/Rim_F sono volutamente assenti: le rimanenze sono
     calcolate via doppia entry D/A dei mastri 61 e 80
     (vedi MASTRI_VARIAZIONE_RIMANENZE) e i sottoconti corrispondenti
     non vengono mappati come righe normali. */
  const SIGLA_TO_MACROAREA = {
    RCV: 'ricavi',
    CAV: 'mat_prime',
    CSV: 'servizi',
    CGT: 'godimento',
    CPE: 'personale',
    AMM: 'ammortamenti',
    ODG: 'oneri_gest',
    INT: 'oneri_fin',
    OST: 'straordinari',
    ARP: 'altri_ric',
    APF: 'altri_prov_f',
    IMP: 'imposte'
  };

  function _classificaCodice(cod) {
    const m = RX_LEAF.exec(cod);
    if (m) {
      const [, mm, ss, cc] = m;
      if (ss === '00' && cc === '000') return { livello: 'mastro',     mm, ss: null, cc: null };
      if (cc === '000')                return { livello: 'conto',      mm, ss,       cc: null };
      return                                { livello: 'sottoconto', mm, ss,       cc };
    }
    const m5 = RX_MASTRO_5.exec(cod);
    if (m5) return { livello: 'mastro', mm: m5[1], ss: null, cc: null };
    return { livello: 'altro', mm: null, ss: null, cc: null };
  }

  /* ──────────────────────────────────────────────────────────
     Identificazione header + mapping colonne

     Le colonne canoniche sono (basate sul gestionale di riferimento):
       Ditta | Ragione sociale | CodiceConto | Descrizione conto |
       DataBilancio1 | DataBilancio2 | DataBilancio3 |
       DareAvere1 | <anno1> | DareAvere2 | <anno2> | Perc1 |
       DareAvere3 | <anno3> | Perc2

     Il riconoscimento è euristico: cerchiamo le label "CodiceConto" e
     "Descrizione conto"; gli anni sono colonne con header numerico
     a 4 cifre tra 1990 e 2100; le DareAvere sono le colonne a sinistra
     di ciascuna colonna anno e contengono solo "D"/"A"/"".
     ────────────────────────────────────────────────────────── */
  function _trovaHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r];
      let colCodice = -1, colDescr = -1, colM = -1, colSM = -1;
      const colAnni = [];

      for (let c = 0; c < row.length; c++) {
        const v = String(row[c] || '').trim();
        if (/^codiceconto$/i.test(v) || /^codice\s*conto$/i.test(v)) colCodice = c;
        if (/^descrizione/i.test(v)) colDescr = c;
        if (/^(19|20)\d{2}$/.test(v)) colAnni.push({ col: c, anno: parseInt(v, 10) });
        // Colonne opzionali di mappatura pre-compilata: header esattamente "M"
        // (Mastro) e "sM" (sotto-Mastro), oppure varianti estese tipo
        // "Macro"/"Macroarea" e "Sotto Macro"/"sotto-macroarea".
        if (v === 'M' || /^macro(area)?$/i.test(v)) colM = c;
        if (/^sm$/i.test(v) || /^sotto[\s_-]?macro(area)?$/i.test(v)) colSM = c;
      }

      if (colCodice >= 0 && colDescr >= 0 && colAnni.length > 0) {
        // Inferisci colonna D/A: prima colonna a sinistra di ciascun anno
        for (const a of colAnni) a.colDA = a.col - 1;
        return { rigaHeader: r, colCodice, colDescr, colM, colSM, anni: colAnni };
      }
    }
    return null;
  }

  /**
   * Trova il nome ditta scansionando una riga dati: di solito è in
   * una colonna a sinistra del codice conto, contiene la ragione
   * sociale (es. "F.LLI BERTI SRL").
   */
  function _trovaDitta(rows, header) {
    for (let r = header.rigaHeader + 1; r < Math.min(rows.length, header.rigaHeader + 5); r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < header.colCodice; c++) {
        const v = String(row[c] || '').trim();
        // Una ragione sociale tipica ha almeno 4 caratteri non-numerici
        if (v.length >= 4 && /[A-Za-zÀ-ú]/.test(v) && !/^codice/i.test(v)) {
          return v;
        }
      }
    }
    return '';
  }

  /* ──────────────────────────────────────────────────────────
     Estrazione sottoconti CE
     ────────────────────────────────────────────────────────── */

  /**
   * Parsea il bilancio di verifica e restituisce la sezione CE.
   *
   * Se il file ha le colonne opzionali "M" e "sM" (mappatura
   * pre-compilata dallo studio), l'output include anche
   * `mapping_da_file` e `sigle_sconosciute`.
   *
   * @param {Array<Array>} rows - matrice celle dal lettore xlsx
   * @returns {{
   *   ditta: string,
   *   anni: number[],
   *   pivot_riga: number,
   *   sottoconti: Array<{
   *     codice: string,
   *     descrizione: string,
   *     mastro: string,
   *     valori: Object<string, {dare:number, avere:number, netto:number}>
   *   }>,
   *   rimanenze: Object<string, {iniziali:number, finali:number}>,
   *   warnings: string[],
   *   mapping_da_file?: Object<string, string|null>,
   *   sigle_sconosciute?: string[]
   * }}
   */
  function parseBilancioVerifica(rows) {
    const warnings = [];
    const header = _trovaHeader(rows);
    if (!header) {
      throw new Error('Excel: intestazione non riconosciuta. Mi aspetto colonne CodiceConto, Descrizione, e almeno un anno.');
    }

    const ditta = _trovaDitta(rows, header);
    const anni  = header.anni.map(a => a.anno);

    // Trova il pivot CE
    let pivotRiga = -1;
    for (let r = header.rigaHeader + 1; r < rows.length; r++) {
      const cod = String(rows[r][header.colCodice] || '').trim();
      if (cod === PIVOT_CE) { pivotRiga = r; break; }
    }
    if (pivotRiga < 0) {
      throw new Error(`Excel: riga pivot ${PIVOT_CE} (RATEI E RISCONTI PASSIVI) non trovata. Senza pivot non si può identificare l'inizio del CE.`);
    }

    // Estrai sottoconti CE
    const sottoconti = [];
    const rimanenzePerAnno = {};
    anni.forEach(a => { rimanenzePerAnno[a] = { iniziali: 0, finali: 0 }; });

    // Mappatura pre-compilata dal file (Caso B). Popolata solo se il file
    // ha la colonna sM. Valore = id macroarea valido, oppure null se la
    // sigla letta non è riconosciuta (in tal caso il sottoconto resta
    // non mappato e l'utente lo classificherà manualmente in Step 4).
    const mappingDaFile     = {};
    const sigleSconosciute  = new Set();
    const haColMappatura    = (header.colSM >= 0);

    for (let r = pivotRiga + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const codice = String(row[header.colCodice] || '').trim();
      if (!codice) continue;

      const cls = _classificaCodice(codice);
      if (cls.livello !== 'sottoconto') continue; // ignora mastri, conti, righe altro

      const descrizione = String(row[header.colDescr] || '').trim();

      const valori = {};
      for (const a of header.anni) {
        const da = String(row[a.colDA] || '').trim().toUpperCase();
        const v  = Number(row[a.col]);
        const num = isFinite(v) ? v : 0;
        const dare  = (da === 'D') ? num : 0;
        const avere = (da === 'A') ? num : 0;
        valori[a.anno] = { dare, avere, netto: dare - avere };

        // Rimanenze: somma D/A dei sottoconti dei mastri 61 e 80
        if (MASTRI_VARIAZIONE_RIMANENZE.indexOf(cls.mm) >= 0) {
          rimanenzePerAnno[a.anno].iniziali += dare;
          rimanenzePerAnno[a.anno].finali   += avere;
        }
      }

      sottoconti.push({
        codice,
        descrizione,
        mastro: cls.mm,
        sottomastro: cls.ss,
        valori
      });

      // Estrazione sigla dal file (se la colonna sM esiste). Saltiamo i
      // sottoconti dei mastri di variazione rimanenze: confluiscono nel
      // blocco rimanenze calcolato e non vanno mappati come righe normali
      // (anche se nel file portano sigla Rim_I/Rim_F).
      if (haColMappatura && MASTRI_VARIAZIONE_RIMANENZE.indexOf(cls.mm) < 0) {
        const sigla = String(row[header.colSM] || '').trim();
        if (sigla) {
          const macroId = SIGLA_TO_MACROAREA[sigla];
          if (macroId) {
            mappingDaFile[codice] = macroId;
          } else {
            // Sigla non riconosciuta: il sottoconto viene importato ma
            // resta esplicitamente non mappato (null sovrascrive il
            // default euristico durante il merge nella UI).
            mappingDaFile[codice] = null;
            sigleSconosciute.add(sigla);
          }
        }
        // sigla vuota → niente nel mapping_da_file: fallback al default
      }
    }

    if (sottoconti.length === 0) {
      warnings.push('Nessun sottoconto CE trovato dopo il pivot. Verificare il formato del file.');
    }

    const result = {
      ditta,
      anni,
      pivot_riga: pivotRiga,
      sottoconti,
      rimanenze: rimanenzePerAnno,
      warnings
    };

    if (haColMappatura) {
      result.mapping_da_file    = mappingDaFile;
      result.sigle_sconosciute  = Array.from(sigleSconosciute);
      if (sigleSconosciute.size > 0) {
        warnings.push(
          'Sigle in colonna sM non riconosciute: ' + result.sigle_sconosciute.join(', ') +
          '. I sottoconti corrispondenti restano non mappati.'
        );
      }
    }

    return result;
  }

  /* ──────────────────────────────────────────────────────────
     Mapping default sottoconto → macroarea

     Strategia: il mastro del sottoconto viene cercato nel campo
     `mastri` di ciascuna macroarea. La prima che lo contiene è la
     destinazione di default. I sottoconti dei mastri di variazione
     rimanenze (61, 80) NON vanno mappati come sottoconti normali —
     contribuiscono solo alle rimanenze calcolate.

     L'utente potrà spostare manualmente i sottoconti tra macroaree
     dallo Step 4 (UI mappatura).

     Eccezione: il mastro 64 (Altri ricavi) è split tra
       64/05/xxx → macroarea 'altri_ric' (sotto la linea)
       64/15/xxx → macroarea 'altri_prov_f' (proventi finanz.)
     Implementato tramite il flag `includi_conto`/`filtro_conto`.
     ────────────────────────────────────────────────────────── */
  function defaultMapping(sottoconti, macroAree) {
    const mapping = {};
    for (const s of sottoconti) {
      // Sottoconti 61 e 80: confluiscono nelle rimanenze, non vengono mappati
      if (MASTRI_VARIAZIONE_RIMANENZE.indexOf(s.mastro) >= 0) continue;

      const sottomastroFull = s.mastro + '/' + s.sottomastro;
      let target = null;

      for (const m of macroAree) {
        const inMastri  = m.mastri && m.mastri.indexOf(s.mastro) >= 0;
        // includi_conto: macroarea che pesca selettivamente un sotto-mastro
        // fuori dal proprio mastro principale (es. altri_prov_f include
        // 64/15 oltre a 87/xx).
        const inInclude = m.includi_conto && sottomastroFull === m.includi_conto;
        if (!inMastri && !inInclude) continue;

        // filtro_conto: la macroarea prende solo uno specifico sotto-mastro
        // tra quelli del proprio mastro (es. altri_ric prende solo 64/05).
        if (m.filtro_conto && sottomastroFull !== m.filtro_conto) continue;

        target = m.id;
        break;
      }
      if (target) mapping[s.codice] = target;
    }
    return mapping;
  }

  /* ──────────────────────────────────────────────────────────
     Aggregazione storico per anno e per macroarea
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola gli importi per macroarea aggregando i sottoconti mappati.
   * Le rimanenze iniziali/finali vengono prese dal blocco `rimanenze`
   * del parsed (calcolato dalla doppia entry D/A).
   *
   * @returns {Object<string, Object<string, number>>}
   *   { '2023': { ricavi: 384816.31, mat_prime: 92357.29, ... }, ... }
   */
  function calcolaStorico(parsed, mapping, macroAree) {
    const storico = {};
    const macroById = {};
    macroAree.forEach(m => { macroById[m.id] = m; });

    for (const anno of parsed.anni) {
      const annoStr = String(anno);
      storico[annoStr] = {};
      // Inizializza tutte le macroaree a 0 (semplifica le tabelle UI)
      macroAree.forEach(m => { storico[annoStr][m.id] = 0; });

      // Aggrega i sottoconti mappati: per costi prendiamo Dare,
      // per ricavi prendiamo Avere. Il segno è già naturale nel dato.
      for (const s of parsed.sottoconti) {
        const macroId = mapping[s.codice];
        if (!macroId) continue;
        const macro = macroById[macroId];
        if (!macro) continue;
        const v = s.valori[anno];
        if (!v) continue;
        const importo = (macro.tipo === 'ricavo') ? v.avere : v.dare;
        storico[annoStr][macroId] += importo;
      }

      // Rimanenze: dai mastri di variazione 61/80
      const rim = parsed.rimanenze[anno] || { iniziali: 0, finali: 0 };
      if (storico[annoStr].rim_ini !== undefined) storico[annoStr].rim_ini = rim.iniziali;
      if (storico[annoStr].rim_fin !== undefined) storico[annoStr].rim_fin = rim.finali;
    }
    return storico;
  }

  /**
   * Ricalcola lo storico dato un progetto AB già importato.
   * Usato dopo modifiche al mapping (Step 4): ricostruisce gli
   * importi per macroarea senza bisogno del file xlsx originale.
   *
   * @param {Object} progetto - progetto AB con sottoconti_ce, rimanenze, mapping, macro_sezioni
   * @returns {Object} storico
   */
  function ricalcolaStorico(progetto) {
    const fakeParsed = {
      anni:       progetto.meta.anni_storici,
      sottoconti: progetto.sottoconti_ce || [],
      rimanenze:  progetto.rimanenze || {}
    };
    return calcolaStorico(fakeParsed, progetto.mapping || {}, progetto.macro_sezioni);
  }

  return {
    PIVOT_CE,
    MASTRI_VARIAZIONE_RIMANENZE,
    SIGLA_TO_MACROAREA,
    parseBilancioVerifica,
    defaultMapping,
    calcolaStorico,
    ricalcolaStorico
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExcelImport;
}
