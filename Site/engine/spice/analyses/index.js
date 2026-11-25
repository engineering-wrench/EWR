/**
 * index.js — установка реализаций анализов в таблицу `ANALYSES`.
 *
 * Аналогично `devices/index.js`: `ckt.js` создаёт `ANALYSES` из каталога DLL,
 * а этот модуль навешивает `an_init`/`an_func`/`setParm`/`askQuest`.
 * Нереализованные анализы остаются заглушками (`E_UNSUPP`).
 */

import { op } from './op.js';
import { tran } from './tran.js';
import { ac } from './ac.js';

/** Имя анализа в каталоге → набор хуков. */
export const ANALYSIS_IMPLS = {
  OP: op,
  TRAN: tran,
  AC: ac,
};

/**
 * Навесить реализации на `ANALYSES`.
 *
 * @param {object[]} analyses — `ANALYSES` из `ckt.js`
 * @returns {number} число установленных анализов
 */
export function installAnalyses(analyses) {
  let installed = 0;
  for (const info of analyses) {
    const impl = ANALYSIS_IMPLS[info.name];
    if (!impl) continue;
    for (const [hook, fn] of Object.entries(impl)) {
      if (fn) info[hook] = fn;
    }
    installed++;
  }
  return installed;
}
