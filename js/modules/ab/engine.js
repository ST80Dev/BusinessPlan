/**
 * budget-engine.js
 * Motore di calcolo del modulo "Analisi Costi & Budget".
 *
 * Calcola incidenze % medie sul fatturato dello storico CE,
 * costruisce il budget previsionale dell'anno corrente, il fatturato
 * di break-even e il preconsuntivo proporzionale a partire dal
 * fatturato realmente fatturato in corso d'anno.
 *
 * Indipendente da ui.js. Usato da budget-ui.js.
 */

'use strict';

const BudgetEngine = (() => {

  /* ──────────────────────────────────────────────────────────
     Schema macroaree CE — fisso per il modulo AB.

     Ogni voce ha:
       id        — chiave stabile usata in storico/budget/mapping
       label     — etichetta visibile
       sezione   — raggruppamento di prospetto (ricavi | variabili |
                   fissi | prov_oneri_straord | imposte)
       tipo      — ricavo | costo
       var_fisso — variabile | fisso (rilevante solo per costi sopra
                   la linea; le voci prov_oneri_straord/imposte non
                   concorrono al break-even)
       mastri    — codici mastro (XX) tipici del piano dei conti
                   italiano da cui i sottoconti vengono pre-mappati a
                   questa macroarea. L'utente può sempre spostare
                   manualmente sottoconti tra macroaree.

     Le righe RIM_INI / RIM_FIN non hanno un mastro proprio: il valore
     viene calcolato come Σ saldi Dare (iniziali) e Σ saldi Avere
     (finali) dei sottoconti dei mastri di variazione (61, 80).
     ────────────────────────────────────────────────────────── */
  const MACROAREE_AB = [
    { id: 'ricavi',       label: 'Ricavi',                                 sezione: 'ricavi',     tipo: 'ricavo', var_fisso: null,        mastri: ['58'] },
    { id: 'mat_prime',    label: 'Costi p/mat. prime, suss., cons., merci', sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: ['66'] },
    { id: 'rim_ini',      label: 'Rimanenze iniziali',                     sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: [], calcolato: 'rim_iniziali' },
    { id: 'rim_fin',      label: 'Rimanenze finali',                       sezione: 'variabili',  tipo: 'ricavo', var_fisso: 'variabile', mastri: [], calcolato: 'rim_finali' },
    { id: 'altri_var',    label: 'Altri costi variabili',                  sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: [] },
    { id: 'servizi',      label: 'Costi per servizi',                      sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['68'] },
    { id: 'godimento',    label: 'Costi p/godimento beni di terzi',        sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['70'] },
    { id: 'personale',    label: 'Costi per il personale',                 sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['72'] },
    { id: 'ammortamenti', label: 'Ammortamenti',                           sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['75'] },
    { id: 'oneri_gest',   label: 'Oneri diversi di gestione',              sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['84'] },
    { id: 'oneri_fin',    label: 'Int. pass. e altri oneri finanz.',       sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['88'] },
    { id: 'straordinari', label: 'Oneri straordinari',                     sezione: 'prov_oneri_straord', tipo: 'costo',  var_fisso: null,        mastri: ['95'] },
    { id: 'altri_ric',    label: 'Altri ricavi e proventi',                sezione: 'prov_oneri_straord', tipo: 'ricavo', var_fisso: null,        mastri: ['64'], filtro_conto: '64/05' },
    { id: 'altri_prov_f', label: 'Altri proventi finanziari',              sezione: 'prov_oneri_straord', tipo: 'ricavo', var_fisso: null,        mastri: ['87'], includi_conto: '64/15' },
    { id: 'imposte',      label: 'Imposte sul reddito',                    sezione: 'imposte',    tipo: 'costo',  var_fisso: null,        mastri: ['96'] }
  ];

  /* ──────────────────────────────────────────────────────────
     Helper interni
     ────────────────────────────────────────────────────────── */

  function _media(arr) {
    const validi = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (validi.length === 0) return 0;
    return validi.reduce((a, b) => a + b, 0) / validi.length;
  }

  function _idRicavi(macroSezioni) {
    const r = (macroSezioni || []).find(m => m.tipo === 'ricavo');
    return r ? r.id : null;
  }

  /**
   * Somma i valori di tutte le macroaree di una data `sezione`,
   * orientando il segno secondo il ruolo della sezione:
   *
   *   orient = 'cost'   → somma i costi e sottrae i ricavi
   *                       (usata per CdV/Variabili e per i Fissi:
   *                        rim_fin viene sottratto perché tipo='ricavo')
   *
   *   orient = 'result' → somma i ricavi e sottrae i costi
   *                       (usata per Proventi/Oneri Straordinari:
   *                        altri_ric/altri_prov_f sommano, straordinari
   *                        sottrae)
   *
   * Sostituisce le sommatorie hardcoded sugli id predefiniti, così le
   * macroaree custom create dall'utente partecipano automaticamente
   * (vedi macroaree con flag `custom: true`).
   *
   * @param {Array}    macroSezioni
   * @param {Function} getVal       - id → valore numerico
   * @param {string}   sezione      - 'variabili' | 'fissi' | 'prov_oneri_straord' | ...
   * @param {string}   orient       - 'cost' | 'result'
   * @returns {number}
   */
  function _sumSezione(macroSezioni, getVal, sezione, orient) {
    return (macroSezioni || [])
      .filter(m => m.sezione === sezione)
      .reduce((s, m) => {
        const v = getVal(m.id) || 0;
        const sign = orient === 'cost'
          ? (m.tipo === 'costo'  ? +1 : -1)
          : (m.tipo === 'ricavo' ? +1 : -1);
        return s + sign * v;
      }, 0);
  }

  /**
   * Mese di avvio attività (1-12) letto da meta.mese_avvio.
   * Default 1 (gennaio) → azienda operativa da inizio anno.
   * Clampato a [1,12] per robustezza.
   * @param {Object} progetto
   * @returns {number}
   */
  function _meseAvvio(progetto) {
    const m = progetto && progetto.meta && Number(progetto.meta.mese_avvio);
    if (!isFinite(m)) return 1;
    return Math.min(12, Math.max(1, Math.round(m)));
  }

  /* ──────────────────────────────────────────────────────────
     API pubblica
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola, per ogni macro-sezione costo, l'incidenza % media sul
   * fatturato (ricavi) negli anni storici.
   * @param {Array}  macroSezioni - schema delle macro
   * @param {Object} storico      - { "2023": { id_macro: importo }, ... }
   * @returns {Object} { id_macro: pct_media_decimale }
   */
  function calcolaPctMedie(macroSezioni, storico) {
    const idR = _idRicavi(macroSezioni);
    if (!idR || !storico) return {};

    const anni = Object.keys(storico);
    const out = {};

    for (const macro of macroSezioni) {
      if (macro.tipo !== 'costo') continue;
      const pcts = anni.map(a => {
        const ricavi = Number(storico[a][idR]) || 0;
        const valore = Number(storico[a][macro.id]) || 0;
        return ricavi !== 0 ? valore / ricavi : null;
      });
      out[macro.id] = _media(pcts);
    }
    return out;
  }

  /**
   * Calcola, per ogni macro-sezione, la media del valore € negli
   * anni storici (utile per i costi fissi).
   * @param {Array}  macroSezioni
   * @param {Object} storico
   * @returns {Object} { id_macro: media_euro }
   */
  function calcolaMedieEuro(macroSezioni, storico) {
    if (!storico) return {};
    const anni = Object.keys(storico);
    const out = {};
    for (const macro of macroSezioni) {
      const valori = anni.map(a => Number(storico[a][macro.id]) || 0);
      out[macro.id] = _media(valori);
    }
    return out;
  }

  /**
   * Costo figurativo del lavoro dei soci.
   *
   * In una società i cui unici lavoratori sono i soci non retribuiti, il
   * costo del personale civilistico è 0: il loro apporto è remunerato
   * dall'utile. In un'analisi di bilancio gestionale è però prassi
   * imputare un COSTO FIGURATIVO (costo-opportunità del lavoro dei soci)
   * per verificare se l'attività è redditizia anche dopo aver remunerato
   * il loro lavoro a un compenso di mercato.
   *
   * Il costo figurativo NON entra nel CE civilistico né incide sulle
   * imposte (che restano una riga manuale del budget): viene tenuto
   * separato e usato solo per il "reddito normalizzato".
   *
   * Le `ore` inserite per ogni socio sono ORE ANNUE A REGIME (12 mesi).
   * Per le società costituite in corso d'anno (meta.mese_avvio > 1) il primo
   * esercizio è parziale: se `lavoro_soci.ragguaglio` è attivo (default), le
   * ore vengono RAGGUAGLIATE ai mesi operativi (avvio→dic) con fattore
   * mesi_operativi/12, così il costo figurativo è coerente con l'orizzonte
   * del budget del primo anno. Con avvio a gennaio il fattore è 1 (nessun
   * effetto, retrocompatibile).
   *
   *   ore_effettive = ore × fattore_ragguaglio
   *   costo_figurativo = Σ (ore_effettive × tariffa)  per ogni socio
   *
   * @param {Object} progetto - progetto AB (usa progetto.lavoro_soci, meta.mese_avvio)
   * @returns {Object} { attivo, righe:[{id,nome,ore,ore_effettive,tariffa,costo}],
   *                      ragguaglio, ragguaglio_attivo, mese_avvio, mesi_operativi,
   *                      fattore_ragguaglio, ore_totali, ore_effettive_totali,
   *                      costo_figurativo }
   */
  function calcolaLavoroSoci(progetto) {
    const ls = (progetto && progetto.lavoro_soci) || {};
    const attivo = !!ls.attivo;
    const righeIn = Array.isArray(ls.righe) ? ls.righe : [];

    // Ragguaglio al primo anno parziale: default attivo (ls.ragguaglio !== false).
    const meseAvvio = _meseAvvio(progetto);
    const mesiOperativi = 12 - meseAvvio + 1;           // avvio=1 → 12; avvio=4 → 9
    const ragguaglio = ls.ragguaglio !== false;
    const ragguaglioAttivo = ragguaglio && meseAvvio > 1;
    const fattore = ragguaglioAttivo ? (mesiOperativi / 12) : 1;

    let oreTot = 0;
    let oreEffTot = 0;
    let costoTot = 0;
    const righe = righeIn.map(r => {
      const ore     = Number(r && r.ore)     || 0;   // ore annue a regime
      const tariffa = Number(r && r.tariffa) || 0;
      const oreEff  = ore * fattore;                 // ore ragguagliate al periodo
      const costo   = oreEff * tariffa;
      oreTot    += ore;
      oreEffTot += oreEff;
      costoTot  += costo;
      return { id: r && r.id, nome: (r && r.nome) || '', ore, ore_effettive: oreEff, tariffa, costo };
    });
    // Tariffa media ponderata sulle ore = Σ(ore×tariffa)/Σore. Il fattore di
    // ragguaglio si semplifica (numeratore e denominatore lo condividono),
    // quindi è invariante rispetto all'orizzonte — coerente col MdC/ora, con
    // cui va confrontata per capire se il lavoro dei soci "si ripaga".
    const tariffaMedia = oreEffTot > 0 ? (costoTot / oreEffTot) : 0;
    return {
      attivo,
      righe,
      ragguaglio,
      ragguaglio_attivo: ragguaglioAttivo,
      mese_avvio: meseAvvio,
      mesi_operativi: mesiOperativi,
      fattore_ragguaglio: fattore,
      ore_totali: oreTot,
      ore_effettive_totali: oreEffTot,
      tariffa_media: tariffaMedia,
      costo_figurativo: attivo ? costoTot : 0
    };
  }

  /**
   * Seed del fatturato di budget a partire dai mesi già inseriti nel
   * consuntivo dell'anno in corso. Pensato per società NEOCOSTITUITE,
   * prive di storico, di cui sono noti solo alcuni mesi.
   *
   * Rispetta il mese di avvio attività (meta.mese_avvio, 1-12): i mesi
   * precedenti all'avvio non concorrono al run-rate (l'azienda non
   * esisteva). Il run-rate mensile è il fatturato consuntivato diviso per
   * i mesi operativi effettivamente trascorsi.
   *
   * Restituisce due orizzonti di annualizzazione:
   *   - seed_parziale: run-rate × mesi operativi da avvio a dicembre
   *                    (fedele al primo esercizio reale, che parte a metà anno)
   *   - seed_regime:   run-rate × 12 (anno intero "a regime")
   *
   * @param {Object} progetto - progetto AB
   * @returns {Object} { disponibile, mese_avvio, frequenza, mesi_attivi,
   *   mesi_operativi_anno, fatturato_ytd, run_rate_mensile,
   *   seed_parziale, seed_regime }
   */
  function calcolaSeedFatturato(progetto) {
    const cons = (progetto && progetto.consuntivo) || {};
    const meseAvvio = _meseAvvio(progetto);
    const freq = cons.frequenza === 'trimestrale' ? 'trimestrale' : 'mensile';
    const fatt = cons.fatturato || {};

    const periodiKeys = freq === 'trimestrale'
      ? ['1', '2', '3', '4']
      : ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const mesiPerPeriodo = freq === 'trimestrale' ? 3 : 1;
    const periodiTotali  = freq === 'trimestrale' ? 4 : 12;

    // Indice del primo periodo operativo (avvio) e mesi operativi da avvio
    // a fine anno.
    const primoIdx = freq === 'trimestrale'
      ? Math.floor((meseAvvio - 1) / 3)
      : (meseAvvio - 1);
    const mesiOperativiAnno = (periodiTotali - primoIdx) * mesiPerPeriodo;

    // Ultimo periodo con ricavo inserito (>= primoIdx) e conteggio dei
    // periodi operativi trascorsi da avvio.
    let ultimoIdx = -1;
    periodiKeys.forEach((k, i) => {
      if (i >= primoIdx && Number(fatt[k]) > 0) ultimoIdx = i;
    });
    const periodiTrascorsi = ultimoIdx >= primoIdx ? (ultimoIdx - primoIdx + 1) : 0;
    const mesiAttivi = periodiTrascorsi * mesiPerPeriodo;

    const fatturatoYtd = periodiKeys.reduce((s, k, i) => {
      return i >= primoIdx ? s + (Number(fatt[k]) || 0) : s;
    }, 0);

    const runRate = mesiAttivi > 0 ? fatturatoYtd / mesiAttivi : 0;

    return {
      disponibile: mesiAttivi > 0 && fatturatoYtd > 0,
      mese_avvio: meseAvvio,
      frequenza: freq,
      mesi_attivi: mesiAttivi,
      mesi_operativi_anno: mesiOperativiAnno,
      fatturato_ytd: fatturatoYtd,
      run_rate_mensile: runRate,
      seed_parziale: Math.round(runRate * mesiOperativiAnno),
      seed_regime:   Math.round(runRate * 12)
    };
  }

  /**
   * Costruisce il budget previsionale dell'anno corrente sullo
   * schema fisso AB. Per ogni macroarea:
   *
   *   ricavi:         valore = override fatturato_ipotizzato OR ultimo
   *                            anno arrotondato al centinaio
   *   variabili pure (mat_prime, altri_var):
   *                    valore = (override_pct OR pct_media) × fatturato
   *   variabili calcolate (rim_ini, rim_fin):
   *                    valore = override_fissi[id] OR media €
   *                    (le rimanenze in budget sono trattate come €
   *                    perché non scalano linearmente col fatturato)
   *   fissi, prov_oneri_straord e imposte:
   *                    valore = override_fissi[id] OR ultimo_anno
   *                             arrotondato al centinaio
   *                    (default ancorato al consuntivo più recente,
   *                    per allinearsi ai costi di gestione attuali)
   *
   * Calcola tutti i derivati del prospetto (CdV, MdC, Tot costi,
   * Utile ante imposte, Utile netto) e il fatturato di break-even
   * operativo:
   *
   *   F_be = (rim_ini − rim_fin + Σ fissi) / (1 − Σ pct_var)
   *
   * Le voci di proventi/oneri straordinari e le imposte non
   * concorrono al BE operativo per definizione classica.
   *
   * @param {Object} progetto - progetto AB
   * @returns {Object} prospetto budget completo
   */
  function calcolaBudget(progetto) {
    const macro   = progetto.macro_sezioni || [];
    const storico = progetto.storico || {};
    const budget  = progetto.budget   || {};
    const anni    = (progetto.meta && progetto.meta.anni_storici) || Object.keys(storico).map(Number);
    const ovrPct  = budget.override_pct   || {};
    const ovrEur  = budget.override_fissi || {};

    // Anni "effettivamente importati": quelli con ricavi > 0. Se l'utente
    // ha importato un file con colonne anno presenti ma solo l'ultimo
    // realmente popolato (azienda neocostituita, primo esercizio breve,
    // ecc.), gli altri anni hanno saldi 0 e non devono concorrere alla
    // media — altrimenti la /N divide per il numero di colonne anziché
    // per il numero di esercizi reali, schiacciando la media verso il
    // basso. Stessa euristica già usata per mediePct (riga sotto).
    const anniReali = anni.filter(a => Number((storico[a] || {}).ricavi) > 0);

    // Medie storiche per macroarea (€ e % sul fatturato)
    const medieEuro = {};
    macro.forEach(m => {
      const valori = anniReali.map(a => Number((storico[a] || {})[m.id]) || 0);
      medieEuro[m.id] = valori.length > 0 ? valori.reduce((s, v) => s + v, 0) / valori.length : 0;
    });

    const fatturatoStoricoMedio = medieEuro['ricavi'] || 0;
    const mediePct = {};
    macro.forEach(m => {
      const validi = anni
        .map(a => ({ ric: Number((storico[a] || {}).ricavi) || 0, val: Number((storico[a] || {})[m.id]) || 0 }))
        .filter(x => x.ric > 0);
      mediePct[m.id] = validi.length > 0
        ? validi.reduce((s, x) => s + x.val / x.ric, 0) / validi.length
        : 0;
    });

    // Base "ultimo anno arrotondata al centinaio": per il fatturato e
    // per i costi non variabili il budget teorico parte dall'ultima
    // annualità storica anziché dalla media triennale, per allinearsi
    // alla situazione più recente. L'arrotondamento al centinaio dà un
    // valore tondo come default da rifinire poi via override.
    const ultimoAnno = anni.length > 0 ? Math.max.apply(null, anni) : null;
    const ultimoAnnoEuro = {};
    macro.forEach(m => {
      const v = ultimoAnno != null ? Number((storico[ultimoAnno] || {})[m.id]) || 0 : 0;
      ultimoAnnoEuro[m.id] = Math.round(v / 100) * 100;
    });
    const fatturatoUltimoArrotondato = ultimoAnnoEuro['ricavi'] || 0;

    // Fatturato budget: default = ultimo fatturato storico arrotondato
    // al centinaio (non la media triennale, che resta solo informativa).
    const fatturatoOvr = Number(budget.fatturato_ipotizzato);
    const fatturato = (isFinite(fatturatoOvr) && fatturatoOvr > 0) ? fatturatoOvr : fatturatoUltimoArrotondato;

    // Calcolo per ogni macroarea
    const valori = {};
    let sommaPctVar = 0;

    for (const m of macro) {
      if (m.id === 'ricavi') {
        valori[m.id] = {
          valore: fatturato,
          pct: 1,
          fonte_pct: null,
          fonte: (isFinite(fatturatoOvr) && fatturatoOvr > 0) ? 'override' : 'storico',
          media_euro: medieEuro[m.id],
          media_pct:  mediePct[m.id],
          ultimo_anno_euro: ultimoAnnoEuro[m.id],
          base_default: ultimoAnnoEuro[m.id]
        };
        continue;
      }

      // Variabili pure (no calcolato): % override o % media × fatturato
      if (m.var_fisso === 'variabile' && !m.calcolato) {
        const pctOvr = ovrPct[m.id];
        const pctMedia = mediePct[m.id] || 0;
        const pct    = (typeof pctOvr === 'number' && isFinite(pctOvr)) ? pctOvr : pctMedia;
        const valore = pct * fatturato;
        valori[m.id] = {
          valore,
          pct,
          fonte_pct: 'pct',
          fonte: (typeof pctOvr === 'number' && isFinite(pctOvr)) ? 'override' : 'storico',
          media_euro: medieEuro[m.id],
          media_pct:  mediePct[m.id],
          ultimo_anno_euro: ultimoAnnoEuro[m.id],
          // base_default: stima storica indipendente dall'override —
          // sempre % media × fatturato_ipotizzato. Si scala col fatturato
          // budget e resta confrontabile col Budget € finale.
          base_default: pctMedia * fatturato
        };
        // sommaPctVar: i costi variabili contribuiscono +pct,
        // i ricavi variabili (rim_fin sarebbe stato qui ma è calcolato)
        // contribuiscono -pct.
        if (m.tipo === 'costo') sommaPctVar += pct;
        else                    sommaPctVar -= pct;
        continue;
      }

      // Calcolato (rim_ini/rim_fin): € override o media €
      // Proventi/oneri straordinari (sezione prov_oneri_straord): per loro
      // natura non ricorrente, default a 0 nel budget; l'utente può
      // sempre forzare un valore tramite override.
      // Tutto il resto (fissi, imposte): € override o ultimo anno
      // arrotondato al centinaio — vedi commento su ultimoAnnoEuro.
      const eurOvr = ovrEur[m.id];
      const isStraord = m.sezione === 'prov_oneri_straord';
      const baseDefault = m.calcolato ? (medieEuro[m.id] || 0)
                        : isStraord  ? 0
                        : ultimoAnnoEuro[m.id];
      const valore = (typeof eurOvr === 'number' && isFinite(eurOvr)) ? eurOvr : baseDefault;
      valori[m.id] = {
        valore,
        pct: fatturato > 0 ? valore / fatturato : 0,
        fonte_pct: 'euro',
        fonte: (typeof eurOvr === 'number' && isFinite(eurOvr)) ? 'override' : 'storico',
        media_euro: medieEuro[m.id],
        media_pct:  mediePct[m.id],
        ultimo_anno_euro: ultimoAnnoEuro[m.id],
        base_default: baseDefault
      };
    }

    // Derivati del prospetto — somme aggregate per sezione, così le
    // macroaree custom partecipano senza modifiche all'engine.
    const v = id => (valori[id] && valori[id].valore) || 0;
    const cdv     = _sumSezione(macro, v, 'variabili',          'cost');
    const totVar  = cdv;
    const mdc     = fatturato - totVar;
    const fissi   = _sumSezione(macro, v, 'fissi',              'cost');
    const totCosti = totVar + fissi;
    const provOneriStraordNetto = _sumSezione(macro, v, 'prov_oneri_straord', 'result');
    const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
    const imposteVal = v('imposte');
    const utileNetto = utileAnteImposte - imposteVal;

    // Break-even operativo:
    //   risultato_op = F * (1 - sommaPctVar) - (rim_ini - rim_fin) - fissiBE = 0
    //   F_be = (rim_ini - rim_fin + fissiBE) / (1 - sommaPctVar)
    //
    // Attenzione: il numeratore usa `fissiBE`, non `fissi`. Al break-even
    // ciò che conta è il *comportamento* della voce (var_fisso), non la
    // sua collocazione di prospetto (sezione):
    //   - le voci a comportamento variabile (var_fisso='variabile') sono
    //     già entrate in `sommaPctVar` (ramo variabile-puro sopra) e
    //     pesano nel denominatore, qualunque sia la loro sezione;
    //   - le voci a comportamento fisso (var_fisso='fisso') pesano nel
    //     numeratore, sia che stiano tra i Fissi sia che stiano tra i
    //     Variabili (es. un costo della sezione variabili trattato come
    //     fisso).
    // Sommare il numeratore per `sezione` (come `fissi`) conterebbe due
    // volte le voci "Fissi ma variabili" e perderebbe le "Variabili ma
    // fisse". Isoliamo perciò la sola componente a comportamento fisso,
    // sopra la linea (sezioni variabili/fissi), escluse le rimanenze
    // (calcolate, già in kRim). Le voci prov_oneri_straord/imposte hanno
    // var_fisso null e non concorrono per definizione.
    const denom = 1 - sommaPctVar;
    const kRim = v('rim_ini') - v('rim_fin');
    const fissiBE = (macro || [])
      .filter(m => m.tipo === 'costo' && !m.calcolato && m.var_fisso === 'fisso'
                && (m.sezione === 'variabili' || m.sezione === 'fissi'))
      .reduce((s, m) => s + v(m.id), 0);
    const breakEven = (denom > 0 && (kRim + fissiBE) > 0) ? (kRim + fissiBE) / denom : null;

    // Costo figurativo del lavoro dei soci — tenuto SEPARATO dal CE
    // civilistico (non incluso in fissi/totCosti/utileNetto né nelle
    // imposte). Serve solo al "reddito normalizzato" e ai KPI di
    // produttività oraria. Vedi calcolaLavoroSoci.
    const soci = calcolaLavoroSoci(progetto);
    const costoFigSoci = soci.costo_figurativo;
    // Orizzonte coerente col costo soci (evita di sottrarre un costo su 12
    // mesi da un utile su N mesi parziali):
    //   - Ragguaglio ON  → costo soci ragguagliato ai mesi operativi:
    //     il confronto è sull'utile del PRIMO ESERCIZIO PARZIALE (as-is).
    //   - Ragguaglio OFF su anno parziale (avvio>gennaio) → costo soci PIENO
    //     annuo: l'utile (e le basi di break-even/KPI orari) va proiettato a
    //     12 mesi a regime, fattore 12/mesi_operativi. Il budget è pro-rata
    //     lineare, quindi la proiezione a regime è lineare.
    //   - Avvio a gennaio → mesi_operativi=12, fattore 1 (nessun effetto).
    const mesiOper = soci.mesi_operativi || 12;
    const normARegime = !soci.ragguaglio_attivo && soci.mese_avvio > 1 && mesiOper > 0;
    const fattAnnua = normARegime ? (12 / mesiOper) : 1;
    const utileNorm    = utileNetto * fattAnnua;
    const fatturatoNorm = fatturato * fattAnnua;
    const mdcNorm      = mdc * fattAnnua;
    const redditoNormalizzato = utileNorm - costoFigSoci;
    // Break-even che remunera anche il lavoro dei soci: al numeratore del
    // break-even operativo (kRim + fissiBE, componente a comportamento
    // fisso) si aggiunge il costo figurativo, anch'esso fisso per natura e
    // indipendente dal fatturato. Usa `fissiBE` (non `fissi`) per restare
    // coerente col break-even operativo. In ottica a regime (OFF/parziale) le
    // basi fisse sono anch'esse annualizzate, così il BEP è comparabile al
    // costo soci pieno e al fatturato a regime.
    const kRimBE   = kRim * fattAnnua;
    const fissiBEn = fissiBE * fattAnnua;
    const breakEvenSoci = (denom > 0 && (kRimBE + fissiBEn + costoFigSoci) > 0)
      ? (kRimBE + fissiBEn + costoFigSoci) / denom : null;
    // KPI di produttività oraria sulle ore EFFETTIVE: ore ragguagliate al
    // periodo (ON) confrontate con fatturato/MdC parziali; ore annue intere
    // (OFF/parziale) confrontate con fatturato/MdC annualizzati. Sempre stesso
    // orizzonte a numeratore e denominatore.
    const oreKpi    = soci.ore_effettive_totali;
    const ricaviOra = oreKpi > 0 ? fatturatoNorm / oreKpi : null;
    const mdcOra    = oreKpi > 0 ? mdcNorm / oreKpi       : null;

    return {
      fatturato,
      fatturato_storico_medio: fatturatoStoricoMedio,
      fatturato_ultimo_arrotondato: fatturatoUltimoArrotondato,
      ultimo_anno: ultimoAnno,
      anni_reali: anniReali,
      valori,
      cdv, totVar, mdc, fissi, totCosti,
      provOneriStraordNetto, utileAnteImposte, imposte: imposteVal, utileNetto,
      somma_pct_var: sommaPctVar,
      break_even: breakEven,
      // Lavoro soci / reddito normalizzato (fuori dal CE civilistico)
      lavoro_soci: soci,
      costo_figurativo_soci: costoFigSoci,
      reddito_normalizzato: redditoNormalizzato,
      // Utile effettivamente usato nel reddito normalizzato: parziale (ON) o
      // proiettato a 12 mesi (OFF/parziale). `reddito_norm_a_regime` segnala
      // alla UI di etichettarlo come "proiettato a 12 mesi".
      reddito_norm_utile_base: utileNorm,
      reddito_norm_a_regime: normARegime,
      reddito_norm_fattore: fattAnnua,
      break_even_soci: breakEvenSoci,
      ricavi_ora: ricaviOra,
      mdc_ora: mdcOra
    };
  }

  /**
   * Preconsuntivo: data la frequenza (mensile/trimestrale) e il
   * fatturato realmente fatturato in N periodi chiusi dell'anno
   * corrente, costruisce due viste:
   *
   *   - CONSUNTIVATO (year-to-date):
   *       fatturato      = somma effettiva inserita
   *       costi var.     = pct_budget × fatturato_consuntivato
   *       costi fissi    = budget_annuale × frazione_anno
   *
   *   - PROIEZIONE FINE ANNO:
   *       fatturato      = fatturato_consuntivato / frazione_anno
   *                         (ipotesi: stesso ritmo di fatturazione)
   *       costi var.     = pct_budget × fatturato_proiettato
   *       costi fissi    = budget_annuale (intero)
   *
   * Le percentuali e gli importi fissi vengono dal budget calcolato
   * (rispetta gli override impostati dall'utente nello Step 6).
   * Le rimanenze sono assunte stabili (= budget intero, sia consuntivato
   * che proiettato): il preconsuntivo non chiede saldi SP intermedi.
   *
   * ORIZZONTE CONSUNTIVO: la frazione d'anno trascorsa NON è il numero di
   * mesi con ricavo > 0, ma l'indice dell'ultimo mese con ricavo inserito
   * (ultimo_periodo_con_dati). Così:
   *   - un mese intermedio a ricavo 0 (es. gennaio a zero, febbraio
   *     fatturato) è comunque "trascorso": i suoi costi fissi rientrano nel
   *     consuntivato;
   *   - i mesi oltre l'orizzonte non sono ancora rilevati: la loro vista
   *     per_periodo è vuota (niente costi, niente utile negativo fittizio).
   *
   * Quando frazione_anno = 0 (nessun mese con ricavo) la proiezione fine
   * anno coincide col budget originale e il consuntivato è 0.
   *
   * @param {Object} progetto
   * @returns {Object} { frequenza, periodi_totali, periodi_chiusi,
   *   ultimo_periodo_con_dati, frazione_anno, fatturato_consuntivato,
   *   fatturato_proiettato,
   *   consuntivato: { valori: {id: {valore}}, totali: {...} },
   *   proiezione:   { valori: {id: {valore}}, totali: {...} },
   *   per_periodo:  { key: { ..., futuro } },
   *   budget }
   */
  function calcolaPreconsuntivo(progetto) {
    const macro = progetto.macro_sezioni || [];
    const cons  = progetto.consuntivo || { frequenza: 'mensile', fatturato: {} };
    const budget = calcolaBudget(progetto);

    const periodiTotali = cons.frequenza === 'trimestrale' ? 4 : 12;
    const fattPerPeriodo = cons.fatturato || {};

    // Chiavi di periodo (mese o trimestre) in ordine cronologico.
    const periodiKeys = cons.frequenza === 'trimestrale'
      ? ['1', '2', '3', '4']
      : ['01','02','03','04','05','06','07','08','09','10','11','12'];

    // Mese di avvio attività: i periodi precedenti all'avvio non esistono
    // (azienda non ancora costituita) e NON devono essere contati come
    // trascorsi — altrimenti il run-rate del fatturato viene diluito e i
    // fissi pro-rata gonfiati. `primoPeriodoIdx` è l'indice del primo
    // periodo operativo; `periodiOperativi` è quanti periodi vanno da
    // avvio a fine anno (denominatore della frazione d'anno operativa).
    // Con mese_avvio = 1 (default) primoPeriodoIdx = 0 e periodiOperativi
    // = periodiTotali: comportamento identico alla versione precedente.
    const meseAvvio = _meseAvvio(progetto);
    const primoPeriodoIdx = cons.frequenza === 'trimestrale'
      ? Math.floor((meseAvvio - 1) / 3)
      : (meseAvvio - 1);
    const periodiOperativi = periodiTotali - primoPeriodoIdx;

    // Orizzonte consuntivo: indice dell'ULTIMO periodo operativo con ricavo
    // inserito. Definisce fin dove l'anno è "trascorso". I periodi da avvio
    // all'orizzonte sono consuntivati e i loro costi fissi vanno contati anche
    // se il singolo mese ha ricavo 0 (es. avvio ad aprile, aprile a zero ma
    // maggio fatturato); i periodi oltre l'orizzonte — e quelli prima
    // dell'avvio — non generano costi né un utile (negativo) fittizio.
    let ultimoPeriodoConDati = -1;
    periodiKeys.forEach((k, i) => {
      if (i >= primoPeriodoIdx && Number(fattPerPeriodo[k]) > 0) ultimoPeriodoConDati = i;
    });
    const periodiTrascorsi = ultimoPeriodoConDati >= primoPeriodoIdx
      ? (ultimoPeriodoConDati - primoPeriodoIdx + 1) : 0;

    // "periodi chiusi" = periodi operativi trascorsi da avvio fino
    // all'orizzonte, NON il semplice conteggio dei mesi con ricavo > 0: un
    // mese intermedio a zero è comunque trascorso e concorre alla frazione
    // d'anno e ai fissi pro-rata.
    const periodiChiusi = periodiTrascorsi;
    const fattConsuntivato = periodiKeys.reduce((s, k, i) => {
      return i >= primoPeriodoIdx ? s + (Number(fattPerPeriodo[k]) || 0) : s;
    }, 0);
    const frazione = periodiOperativi > 0 ? periodiTrascorsi / periodiOperativi : 0;

    // Modalità di proiezione del fatturato:
    //   'lineare'         → estrapolazione yt-d / frazione_anno (default)
    //   'stagionalizzata' → mix per periodo: dove il consuntivo è chiuso usa
    //                       il consuntivo, dove è aperto usa il valore atteso
    //                       inserito a mano (€ per periodo). La proiezione
    //                       annua è la somma dei 12 (o 4) periodi del mix.
    //                       Pensata per attività con stagionalità marcata
    //                       (es. stabilimenti balneari, gelaterie) dove la
    //                       proiezione lineare sovra/sotto-stima vistosamente.
    const modalita = cons.modalita_proiezione === 'stagionalizzata'
      ? 'stagionalizzata' : 'lineare';
    const fattAtteso = cons.fatturato_atteso || {};

    // Vista per periodo (mese o trimestre): variabili pro-quota sul fatturato
    // del periodo, fissi pro-rata su 1/N dell'anno. Le righe di proventi/oneri
    // straordinari e imposte seguono lo stesso pro-rata dei fissi (sono
    // comunque stime). Le chiavi di periodo (periodiKeys) sono definite in
    // testa alla funzione, insieme all'orizzonte consuntivo.

    // Mix per periodo per la modalità stagionalizzata: consuntivo se chiuso,
    // atteso se aperto. Per coerenza viene calcolato sempre, ma viene usato
    // per la proiezione solo se modalita === 'stagionalizzata'.
    const fattMixPerPeriodo = {};
    const fonteMixPerPeriodo = {}; // 'consuntivo' | 'atteso' | 'vuoto'
    let attesoTotale = 0;
    periodiKeys.forEach((k, i) => {
      // Periodi precedenti all'avvio: azienda non ancora operativa → 0.
      if (i < primoPeriodoIdx) {
        fattMixPerPeriodo[k]  = 0;
        fonteMixPerPeriodo[k] = 'vuoto';
        return;
      }
      const c = Number(fattPerPeriodo[k]) || 0;
      const a = Number(fattAtteso[k]) || 0;
      attesoTotale += a;
      if (c > 0) {
        fattMixPerPeriodo[k]  = c;
        fonteMixPerPeriodo[k] = 'consuntivo';
      } else if (a > 0) {
        fattMixPerPeriodo[k]  = a;
        fonteMixPerPeriodo[k] = 'atteso';
      } else {
        fattMixPerPeriodo[k]  = 0;
        fonteMixPerPeriodo[k] = 'vuoto';
      }
    });
    const fattMixTotale = Object.values(fattMixPerPeriodo).reduce((s, v) => s + v, 0);

    const fattProiettato = modalita === 'stagionalizzata'
      ? fattMixTotale
      : (frazione > 0 ? (fattConsuntivato / frazione) : budget.fatturato);

    // ── Rimanenze: modalità di distribuzione + rettifica manuale ──
    // rim_ini/rim_fin sono STOCK (saldi SP), non flussi. Due leve indipendenti:
    //   • override_rim[id]  → valore REALE di fine anno inserito a mano nel
    //                         foglio (inventario/valutazione puntuale). Se
    //                         presente prevale sul valore di budget.
    //   • rim_distribuzione → come quel valore di fine anno si distribuisce
    //                         sui periodi trascorsi (colonna Consuntivato e
    //                         celle per-periodo):
    //         'lineare'    (default) = quota proporzionale al TEMPO trascorso
    //                       (identico al comportamento storico: × frazione);
    //         'stagionale' = quota proporzionale agli ACQUISTI, cioè al
    //                       fatturato di periodo (gli acquisti sono % del
    //                       fatturato, quindi ne seguono il profilo).
    // Retrocompatibile: 'lineare' + nessun override ⇒ output invariato.
    const rimDistrib = cons.rim_distribuzione === 'stagionale' ? 'stagionale' : 'lineare';
    const ovrRim = cons.override_rim || {};
    const _rimVoci = macro.filter(m => m.calcolato).map(m => m.id); // es. ['rim_ini','rim_fin']
    // Valore di fine anno effettivo per ciascuna voce rimanenze: rettifica
    // manuale se valorizzata, altrimenti il valore calcolato dal budget.
    const rimYearEnd = {};
    _rimVoci.forEach(id => {
      const o = Number(ovrRim[id]);
      const haOverride = ovrRim[id] != null && ovrRim[id] !== '' && isFinite(o);
      rimYearEnd[id] = haOverride ? o : ((budget.valori[id] && budget.valori[id].valore) || 0);
    });
    // Frazione di distribuzione per il CONSUNTIVATO (year-to-date):
    //   lineare    → frazione di tempo trascorso (comportamento storico);
    //   stagionale → peso degli acquisti (fatturato) consuntivati sul totale
    //                anno proiettato. In proiezione lineare coincide con la
    //                frazione di tempo; in stagionalizzata riflette il picco.
    const fracRimCons = rimDistrib === 'stagionale'
      ? (fattProiettato > 0 ? Math.min(1, fattConsuntivato / fattProiettato) : frazione)
      : frazione;
    const rimConsVals = {}, rimProiezVals = {};
    _rimVoci.forEach(id => {
      rimConsVals[id]   = rimYearEnd[id] * fracRimCons;
      rimProiezVals[id] = rimYearEnd[id];
    });

    function _calcolaVista(fattConsForCosti, fattAnnoCompleto, frazTempo, rimVals) {
      const valori = {};
      for (const m of macro) {
        if (m.id === 'ricavi') {
          valori[m.id] = { valore: fattAnnoCompleto };
          continue;
        }

        // Variabili pure: % budget × fatturato (annuale completo)
        if (m.var_fisso === 'variabile' && !m.calcolato) {
          const pct = (budget.valori[m.id] && budget.valori[m.id].pct) || 0;
          valori[m.id] = { valore: pct * fattAnnoCompleto };
          continue;
        }

        // Rimanenze (calcolato): valore già determinato dal chiamante secondo
        // la modalità di distribuzione ed eventuale rettifica di fine anno.
        if (m.calcolato && rimVals && typeof rimVals[m.id] === 'number') {
          valori[m.id] = { valore: rimVals[m.id] };
          continue;
        }

        // Fissi/prov_oneri_straord/imposte: budget annuale × frazione tempo
        const valBudget = (budget.valori[m.id] && budget.valori[m.id].valore) || 0;
        valori[m.id] = { valore: valBudget * frazTempo };
      }

      const v = id => (valori[id] && valori[id].valore) || 0;
      const cdv     = _sumSezione(macro, v, 'variabili',          'cost');
      const totVar  = cdv;
      const mdc     = v('ricavi') - totVar;
      const fissi   = _sumSezione(macro, v, 'fissi',              'cost');
      const totCosti = totVar + fissi;
      const provOneriStraordNetto = _sumSezione(macro, v, 'prov_oneri_straord', 'result');
      const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
      const imposteVal = v('imposte');
      const utileNetto = utileAnteImposte - imposteVal;

      return {
        valori,
        fatturato: fattAnnoCompleto,
        cdv, totVar, mdc, fissi, totCosti,
        provOneriStraordNetto, utileAnteImposte, imposte: imposteVal, utileNetto
      };
    }

    const consuntivato = _calcolaVista(fattConsuntivato, fattConsuntivato, frazione, rimConsVals);
    const proiezione   = _calcolaVista(fattConsuntivato, fattProiettato, 1, rimProiezVals);

    const fraz1Periodo = periodiOperativi > 0 ? 1 / periodiOperativi : 0;

    // Vista vuota per i periodi oltre l'orizzonte: nessun costo/utile, così
    // nessun consumatore (griglia a schermo, PDF, aggregati) conteggia fissi
    // fittizi o espone un utile negativo per mesi non ancora rilevati.
    const _vistaVuota = () => ({
      valori: {}, fatturato: 0, cdv: 0, totVar: 0, mdc: 0, fissi: 0,
      totCosti: 0, provOneriStraordNetto: 0, utileAnteImposte: 0,
      imposte: 0, utileNetto: 0
    });

    const perPeriodo = {};
    periodiKeys.forEach((k, i) => {
      const fattPeriodo = Number(fattPerPeriodo[k]) || 0;
      // pre_avvio = periodo precedente all'avvio attività: azienda non ancora
      //   costituita, la cella fatturato è non editabile e non genera costi.
      // futuro    = oltre l'ultimo mese con ricavo: non ancora rilevato. La cella
      //   editabile del fatturato continua a leggere da cons.fatturato[k], quindi
      //   l'operatore può inserire il mese successivo ed estendere l'orizzonte.
      const preAvvio = i < primoPeriodoIdx;
      const futuro   = !preAvvio && i > ultimoPeriodoConDati;
      // Quota rimanenze del periodo: stagionale ∝ fatturato (acquisti) del
      // periodo sul totale anno; lineare = quota uniforme 1/periodi_operativi.
      const rimValsPeriodo = {};
      _rimVoci.forEach(id => {
        const w = rimDistrib === 'stagionale'
          ? (fattProiettato > 0 ? (fattMixPerPeriodo[k] || 0) / fattProiettato : fraz1Periodo)
          : fraz1Periodo;
        rimValsPeriodo[id] = rimYearEnd[id] * w;
      });
      perPeriodo[k] = (preAvvio || futuro)
        ? _vistaVuota()
        : _calcolaVista(fattPeriodo, fattPeriodo, fraz1Periodo, rimValsPeriodo);
      perPeriodo[k].fatturato_periodo = fattPeriodo;
      perPeriodo[k].inserito = fattPeriodo > 0;
      perPeriodo[k].pre_avvio = preAvvio;
      perPeriodo[k].futuro   = futuro;
      perPeriodo[k].atteso   = Number(fattAtteso[k]) || 0;
      perPeriodo[k].mix      = fattMixPerPeriodo[k];
      perPeriodo[k].fonte    = fonteMixPerPeriodo[k];
    });

    return {
      frequenza:              cons.frequenza,
      modalita_proiezione:    modalita,
      mese_avvio:             meseAvvio,
      primo_periodo_idx:      primoPeriodoIdx,
      periodi_operativi:      periodiOperativi,
      periodi_totali:         periodiTotali,
      periodi_chiusi:         periodiChiusi,
      ultimo_periodo_con_dati: ultimoPeriodoConDati,
      periodi_keys:           periodiKeys,
      frazione_anno:          frazione,
      fatturato_consuntivato: fattConsuntivato,
      fatturato_atteso_tot:   attesoTotale,
      fatturato_proiettato:   fattProiettato,
      rim_distribuzione:      rimDistrib,
      rim_year_end:           rimYearEnd,
      rim_override:           { rim_ini: ovrRim.rim_ini, rim_fin: ovrRim.rim_fin },
      consuntivato,
      proiezione,
      per_periodo:            perPeriodo,
      budget
    };
  }

  return {
    MACROAREE_AB:       MACROAREE_AB,
    calcolaPctMedie:    calcolaPctMedie,
    calcolaMedieEuro:   calcolaMedieEuro,
    calcolaLavoroSoci:  calcolaLavoroSoci,
    calcolaSeedFatturato: calcolaSeedFatturato,
    calcolaBudget:      calcolaBudget,
    calcolaPreconsuntivo: calcolaPreconsuntivo
  };

})();
