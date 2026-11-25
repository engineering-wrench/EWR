/**
 * ac.js — AC-анализ: параметры, `ACan` и `CKTacDump`.
 *
 * Драйвер — `vendor/spice3f4/src/lib/ckt/acan.c` в редакции, которую реально
 * показывает DLL: шаг LINEAR = `(stop-start)/(numsteps-1)` и всего `numsteps`
 * точек (XSPICE-исходник делит на `numsteps+1` — Q-A02). Остальное (DECADE/
 * OCTAVE, `freqTol`, порядок `CKTop` → `CKTload` → `NIacIter` → dump, обмен
 * `Old`/`new` в `iRHS`) совпадает с обоими деревьями.
 *
 * Значения — комплексные пары `[[re, im], …]` в порядке уравнений MNA
 * (`dataType = IF_COMPLEX`), как их отдаёт `OUTpData` шима оракула.
 */

import {
  OK,
  E_BADPARM,
  IF_REAL,
  IF_COMPLEX,
  MODEAC,
  MODEDCOP,
  MODEINITJCT,
  MODEINITFLOAT,
  MODEINITSMSIG,
  MODEUIC,
  cktNames,
  cktOutBeginPlot,
  cktOutData,
  cktOutEndPlot,
  cktLoad,
} from '../ckt.js';
import { niAcIter } from '../ni.js';
import { ckTop } from './cktop.js';

/** Типы шага (`acdefs.h`). */
export const DECADE = 1;
export const OCTAVE = 2;
export const LINEAR = 3;

/** Коды параметров AC (`acdefs.h`). */
export const AC_DEC = 1;
export const AC_OCT = 2;
export const AC_LIN = 3;
export const AC_START = 4;
export const AC_STOP = 5;
export const AC_STEPS = 6;

/** `HUGE` из `util.h` (для вырожденной линейной сетки F4). */
const HUGE = 1e30;

/**
 * ACsetParm — установить параметр анализа (порт `acsetp.c`).
 *
 * @returns {number} код ошибки
 */
export function acSetParm(ckt, job, which, value) {
  switch (which) {
    case AC_START:
      job.ACstartFreq = value;
      break;
    case AC_STOP:
      job.ACstopFreq = value;
      break;
    case AC_STEPS:
      job.ACnumberSteps = value;
      break;
    case AC_DEC:
      if (value) job.ACstepType = DECADE;
      else if (job.ACstepType === DECADE) job.ACstepType = 0;
      break;
    case AC_OCT:
      if (value) job.ACstepType = OCTAVE;
      else if (job.ACstepType === OCTAVE) job.ACstepType = 0;
      break;
    case AC_LIN:
      if (value) job.ACstepType = LINEAR;
      else if (job.ACstepType === LINEAR) job.ACstepType = 0;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/**
 * ACaskQuest — прочитать параметр анализа (порт `acaskq.c`).
 *
 * @returns {{error:number, value:number}}
 */
export function acAskQuest(ckt, job, which) {
  switch (which) {
    case AC_START:
      return { error: OK, value: job.ACstartFreq };
    case AC_STOP:
      return { error: OK, value: job.ACstopFreq };
    case AC_STEPS:
      return { error: OK, value: job.ACnumberSteps };
    case AC_DEC:
      return { error: OK, value: job.ACstepType === DECADE ? 1 : 0 };
    case AC_OCT:
      return { error: OK, value: job.ACstepType === OCTAVE ? 1 : 0 };
    case AC_LIN:
      return { error: OK, value: job.ACstepType === LINEAR ? 1 : 0 };
    default:
      return { error: E_BADPARM, value: NaN };
  }
}

/**
 * CKTacDump — выгрузить комплексное решение в plot (порт `CKTacDump.c`).
 *
 * @returns {number} код ошибки
 */
export function cktAcDump(ckt, freq, plot) {
  const count = ckt.CKTmaxEqNum - 1;
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = [ckt.CKTrhsOld[i + 1], ckt.CKTirhsOld[i + 1]];
  }
  return cktOutData(ckt, plot, freq, values);
}

/**
 * ACan — частотная развёртка (порт `acan.c` в редакции DLL).
 *
 * @param {object} ckt
 * @param {number} restart — 1 = начать развёртку с нуля
 * @returns {number} код ошибки
 */
export function acan(ckt, restart) {
  const job = ckt.CKTcurJob;
  let freq;

  if (job.ACsaveFreq === 0 || restart) {
    if (job.ACnumberSteps < 1) job.ACnumberSteps = 1;

    switch (job.ACstepType) {
      case DECADE:
        job.ACfreqDelta = Math.exp(Math.log(10) / job.ACnumberSteps);
        break;
      case OCTAVE:
        job.ACfreqDelta = Math.exp(Math.log(2) / job.ACnumberSteps);
        break;
      case LINEAR:
        if (job.ACnumberSteps - 1 > 1) {
          job.ACfreqDelta =
            (job.ACstopFreq - job.ACstartFreq) / (job.ACnumberSteps - 1);
        } else {
          job.ACfreqDelta = HUGE;
        }
        break;
      default:
        return E_BADPARM;
    }

    const converged = ckTop(
      ckt,
      (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITJCT,
      (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITFLOAT,
      ckt.CKTdcMaxIter,
    );
    if (converged !== 0) return converged;

    ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODEDCOP | MODEINITSMSIG;
    const loadError = cktLoad(ckt);
    if (loadError) return loadError;

    const named = cktNames(ckt);
    if (named.error) return named.error;

    const begun = cktOutBeginPlot(
      ckt,
      job,
      job.JOBname,
      'frequency',
      IF_REAL,
      named.names,
      IF_COMPLEX,
    );
    if (begun.error) return begun.error;
    const plot = begun.plot;

    freq = job.ACstartFreq;

    const error = acSweep(ckt, job, plot, freq);
    cktOutEndPlot(ckt, plot);
    return error;
  }

  freq = job.ACsaveFreq;
  job.ACsaveFreq = 0;

  const error = acSweep(ckt, job, null, freq);
  return error;
}

/**
 * Тело частотного цикла (после выбора начальной частоты).
 *
 * @param {object} ckt
 * @param {object} job
 * @param {object|null} plot — null при продолжении (plot уже открыт в C)
 * @param {number} startFreq
 * @returns {number} код ошибки
 */
function acSweep(ckt, job, plot, startFreq) {
  let freq = startFreq;
  let freqTol;
  switch (job.ACstepType) {
    case DECADE:
    case OCTAVE:
      freqTol = job.ACfreqDelta * job.ACstopFreq * ckt.CKTreltol;
      break;
    case LINEAR:
      freqTol = job.ACfreqDelta * ckt.CKTreltol;
      break;
    default:
      return E_BADPARM;
  }

  let finished = false;
  while (!finished && freq <= job.ACstopFreq + freqTol) {
    ckt.CKTomega = 2 * Math.PI * freq;
    ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODEAC;

    const error = niAcIter(ckt);
    if (error) return error;

    const dumpError = cktAcDump(ckt, freq, plot);
    if (dumpError) return dumpError;

    switch (job.ACstepType) {
      case DECADE:
      case OCTAVE:
        freq *= job.ACfreqDelta;
        if (job.ACfreqDelta === 1) finished = true;
        break;
      case LINEAR:
        freq += job.ACfreqDelta;
        if (job.ACfreqDelta === 0) finished = true;
        break;
      default:
        return E_BADPARM;
    }
  }
  return OK;
}

export const ac = {
  an_func: acan,
  setParm: acSetParm,
  askQuest: acAskQuest,
};
