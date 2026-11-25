/**
 * op.js — анализ рабочей точки (`DCop`, порт `dcop.c`).
 *
 * После сходимости C делает ещё один `CKTload` (режим `MODEINITSMSIG`) и
 * выгружает `CKTrhsOld` как точку `t=0` plot'а — это и есть значения OP для
 * приборов/оракула.
 */

import {
  OK,
  IF_REAL,
  MODEDCOP,
  MODEINITJCT,
  MODEINITFLOAT,
  MODEINITSMSIG,
  MODEUIC,
  cktNames,
  cktOutBeginPlot,
  cktOutEndPlot,
  cktDump,
  cktLoad,
} from '../ckt.js';
import { ckTop } from './cktop.js';

/**
 * DCop — рабочая точка.
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function dcOp(ckt) {
  const named = cktNames(ckt);
  if (named.error) return named.error;

  const begun = cktOutBeginPlot(
    ckt,
    ckt.CKTcurJob,
    ckt.CKTcurJob ? ckt.CKTcurJob.JOBname : null,
    null,
    IF_REAL,
    named.names,
    IF_REAL,
  );
  if (begun.error) return begun.error;
  const plot = begun.plot;

  const converged = ckTop(
    ckt,
    (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITJCT,
    (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITFLOAT,
    ckt.CKTdcMaxIter,
  );
  if (converged !== 0) return converged;

  ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITSMSIG;

  const error = cktLoad(ckt);
  const dumpError = cktDump(ckt, 0, plot);
  cktOutEndPlot(ckt, plot);
  return error || dumpError;
}

export const op = {
  an_func: dcOp,
};
