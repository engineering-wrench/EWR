/**
 * cktop.js — CKTop: рабочая точка с обходными стратегиями (порт `cktop.c`).
 *
 * Если обычный Ньютон не сходится, C последовательно пробует:
 *  1. gmin stepping — искусственная проводимость на диагонали, уменьшаемая
 *     декадами до нуля;
 *  2. source stepping — масштабирование независимых источников `CKTsrcFact`.
 *
 * Функция общая для OP (`DCop`) и TRAN (начальная рабочая точка `DCtran`).
 */

import {
  OK,
  ERR_INFO,
  ERR_WARNING,
  cktError,
} from '../ckt.js';
import { niIter } from '../ni.js';

/** `DOING_TRAN` (tskdefs.h). */
export const DOING_TRAN = 8;

/**
 * CKTop — найти рабочую точку.
 *
 * @param {object} ckt
 * @param {number} firstmode — `CKTmode` первой попытки
 * @param {number} continuemode — `CKTmode` продолжения
 * @param {number} iterlim — предел итераций
 * @returns {number} OK или код ошибки последней попытки
 */
export function ckTop(ckt, firstmode, continuemode, iterlim) {
  let converged;

  ckt.CKTmode = firstmode;
  if (!ckt.CKTnoOpIter) {
    converged = niIter(ckt, iterlim);
  } else {
    converged = 1; // опция «сразу к gmin stepping»
  }

  if (converged !== 0) {
    // 1) gmin stepping
    if (ckt.CKTnumGminSteps > 1) {
      ckt.CKTmode = firstmode;
      cktError(ckt, ERR_INFO, 'starting Gmin stepping');
      ckt.CKTdiagGmin = ckt.CKTgmin;
      for (let i = 0; i < ckt.CKTnumGminSteps; i++) ckt.CKTdiagGmin *= 10;
      for (let i = 0; i <= ckt.CKTnumGminSteps; i++) {
        ckt.CKTnoncon = 1;
        converged = niIter(ckt, iterlim);
        if (converged !== 0) {
          ckt.CKTdiagGmin = 0;
          cktError(ckt, ERR_WARNING, 'Gmin step failed');
          break;
        }
        ckt.CKTdiagGmin /= 10;
        ckt.CKTmode = continuemode;
        cktError(ckt, ERR_INFO, 'One successful Gmin step');
      }
      ckt.CKTdiagGmin = 0;
      converged = niIter(ckt, iterlim);
      if (converged === 0) {
        cktError(ckt, ERR_INFO, 'Gmin stepping completed');
        return OK;
      }
      cktError(ckt, ERR_WARNING, 'Gmin stepping failed');
    }

    // 2) source stepping
    if (ckt.CKTnumSrcSteps > 1) {
      ckt.CKTmode = firstmode;
      cktError(ckt, ERR_INFO, 'starting source stepping');
      for (let i = 0; i <= ckt.CKTnumSrcSteps; i++) {
        ckt.CKTsrcFact = i / ckt.CKTnumSrcSteps;
        converged = niIter(ckt, iterlim);
        ckt.CKTmode = continuemode;
        if (converged !== 0) {
          ckt.CKTsrcFact = 1;
          ckt.CKTcurrentAnalysis = DOING_TRAN;
          cktError(ckt, ERR_WARNING, 'source stepping failed');
          return converged;
        }
        cktError(ckt, ERR_INFO, 'One successful source step');
      }
      cktError(ckt, ERR_INFO, 'Source stepping completed');
      ckt.CKTsrcFact = 1;
      return OK;
    }
    return converged;
  }
  return OK;
}
