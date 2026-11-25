/**
 * tran.js — TRAN: параметры, инициализация и адаптивный шаг.
 *
 * Драйвер — `vendor/xspice-1-0/src/sim/CKT/DCtran.c` (редакция DLL, а не F4
 * `dctran.c`): `CKTminBreak = 10*delmin`, очистка постоянных точек останова
 * после `resume`, отсутствие F4-подтяжки `delta = MAX(delta, delmin*2)`.
 *
 * Сетка времени — часть контракта 1:1 (`docs/engine/PLAN-CLONE.md` §5):
 * шаг выбирается по точкам останова (`CKTbreaks`) и LTE устройств (`CKTtrunc`),
 * поэтому порядок операций повторяет C построчно (включая `goto nextTime`).
 *
 * Не портировано: LTRA-массивы `CKTtimePoints` (нужны только линиям задержки,
 * фаза P2), пауза UI (`IFpauseTest`, фаза I), EVT/MIF-breakpoint'ы (фаза X).
 */

import {
  OK,
  E_BADPARM,
  E_TIMESTEP,
  IF_REAL,
  MODETRAN,
  MODETRANOP,
  MODEINITJCT,
  MODEINITFLOAT,
  MODEINITTRAN,
  MODEINITPRED,
  MODEUIC,
  cktNames,
  cktIc,
  cktOutBeginPlot,
  cktOutEndPlot,
  cktDump,
  cktAccept,
  cktClrBreak,
  cktTrunc,
} from '../ckt.js';
import { niIter, niComCof } from '../ni.js';
import { ckTop, DOING_TRAN } from './cktop.js';

/** Коды параметров TRAN (`trandefs.h`). */
export const TRAN_TSTART = 1;
export const TRAN_TSTOP = 2;
export const TRAN_TSTEP = 3;
export const TRAN_TMAX = 4;
export const TRAN_UIC = 5;

/**
 * TRANinit — перенести параметры job'а в цепь (порт `traninit.c`).
 *
 * @param {object} ckt
 * @param {object} job
 * @returns {number} код ошибки
 */
export function tranInit(ckt, job) {
  ckt.CKTfinalTime = job.TRANfinalTime;
  ckt.CKTstep = job.TRANstep;
  ckt.CKTinitTime = job.TRANinitTime;
  ckt.CKTmaxStep = job.TRANmaxStep;
  if (ckt.CKTmaxStep === 0) {
    ckt.CKTmaxStep = (ckt.CKTfinalTime - ckt.CKTinitTime) / 50;
  }
  ckt.CKTdelmin = 1e-9 * ckt.CKTmaxStep; // XXX как в C
  ckt.CKTmode = job.TRANmode;
  // XSPICE `CKTdoJob` вызывает `CKTic` после установки mode/delmin и до `DCtran`.
  return cktIc(ckt);
}

/**
 * TRANsetParm — установить параметр анализа (порт `transetp.c`).
 *
 * @returns {number} код ошибки
 */
export function tranSetParm(ckt, job, which, value) {
  switch (which) {
    case TRAN_TSTOP:
      job.TRANfinalTime = value;
      break;
    case TRAN_TSTEP:
      job.TRANstep = value;
      break;
    case TRAN_TSTART:
      job.TRANinitTime = value;
      break;
    case TRAN_TMAX:
      job.TRANmaxStep = value;
      break;
    case TRAN_UIC:
      if (value) job.TRANmode |= MODEUIC;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/**
 * TRANaskQuest — прочитать параметр анализа (порт `tranaskq.c`).
 *
 * @returns {{error:number, value:*}}
 */
export function tranAskQuest(ckt, job, which) {
  switch (which) {
    case TRAN_TSTOP:
      return { error: OK, value: job.TRANfinalTime };
    case TRAN_TSTEP:
      return { error: OK, value: job.TRANstep };
    case TRAN_TSTART:
      return { error: OK, value: job.TRANinitTime };
    case TRAN_TMAX:
      return { error: OK, value: job.TRANmaxStep };
    case TRAN_UIC:
      return { error: OK, value: job.TRANmode & MODEUIC ? 1 : 0 };
    default:
      return { error: E_BADPARM, value: undefined };
  }
}

/** Скопировать состояния (C: `bcopy`). */
function copyStates(ckt, from, to) {
  const n = ckt.CKTnumStates;
  if (!n) return;
  const src = ckt.CKTstates[from];
  const dst = ckt.CKTstates[to];
  if (src && dst) dst.set(src.subarray(0, n));
}

/**
 * DCtran — transient-анализ (порт `vendor/xspice-1-0/src/sim/CKT/DCtran.c`).
 *
 * Отличия редакции XSPICE от F4 (`dctran.c`), воспроизводимые здесь:
 *  - `CKTminBreak = 10 * CKTdelmin` (а не `maxStep*5e-5`), иначе первый
 *    breakpoint `TR` фронта PULSE не попадает в таблицу;
 *  - временные breakpoint'ы `g_mif_info` (нужны только кодовым моделям —
 *    `EVT`/`MIF` не портированы, фаза X);
 *  - постоянные точки «выбрасываются» циклом `while (breaks[0] <= time+minBreak)`
 *    уже после `resume`, а не до `CKTaccept`;
 *  - нет F4-подтяжки `delta = MAX(delta, delmin*2)`.
 *
 * @param {object} ckt
 * @param {number} restart — принудительный рестарт
 * @returns {number} код ошибки
 */
export function dcTran(ckt, restart) {
  let firsttime;
  let olddelta;
  let converged;

  if (restart || ckt.CKTtime === 0) {
    const delta = Math.min(ckt.CKTfinalTime / 50, ckt.CKTstep) / 10;

    ckt.CKTbreaks = [0, ckt.CKTfinalTime];
    ckt.CKTbreakSize = 2;
    if (ckt.CKTminBreak === 0) ckt.CKTminBreak = 10.0 * ckt.CKTdelmin;

    const named = cktNames(ckt);
    if (named.error) return named.error;
    const begun = cktOutBeginPlot(
      ckt,
      ckt.CKTcurJob,
      ckt.CKTcurJob ? ckt.CKTcurJob.JOBname : null,
      'time',
      IF_REAL,
      named.names,
      IF_REAL,
    );
    if (begun.error) return begun.error;

    ckt.CKTtime = 0;
    ckt.CKTdelta = 0;
    ckt.CKTbreak = 1;
    firsttime = true;

    converged = ckTop(
      ckt,
      (ckt.CKTmode & MODEUIC) | MODETRANOP | MODEINITJCT,
      (ckt.CKTmode & MODEUIC) | MODETRANOP | MODEINITFLOAT,
      ckt.CKTdcMaxIter,
    );
    if (converged !== 0) return converged;

    ckt.CKTstat.STATtimePts++;
    ckt.CKTorder = 1;
    for (let i = 0; i < 7; i++) ckt.CKTdeltaOld[i] = ckt.CKTmaxStep;
    ckt.CKTdelta = delta;
    ckt.CKTsaveDelta = ckt.CKTfinalTime / 50;

    ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODETRAN | MODEINITTRAN;
    ckt.CKTag[0] = 0;
    ckt.CKTag[1] = 0;
    copyStates(ckt, 0, 1);
  } else {
    if (ckt.CKTminBreak === 0) ckt.CKTminBreak = 10.0 * ckt.CKTdelmin;
    firsttime = false;
  }

  const plot = ckt.CKTcurJob ? ckt.CKTcurJob.TRANplot : null;

  // Метка `nextTime` из C: принятая точка.
  nextTime: for (;;) {
    const acceptError = cktAccept(ckt);
    ckt.CKTstat.STATaccepted++;
    ckt.CKTbreak = 0;
    if (acceptError) return acceptError;

    if (ckt.CKTtime >= ckt.CKTinitTime) {
      const dumpError = cktDump(ckt, ckt.CKTtime, plot);
      if (dumpError) return dumpError;
    }
    ckt.CKTstat.STAToldIter = ckt.CKTstat.STATnumIter;

    if (Math.abs(ckt.CKTtime - ckt.CKTfinalTime) < ckt.CKTminBreak) {
      cktOutEndPlot(ckt, plot);
      ckt.CKTcurrentAnalysis = 0;
      return OK;
    }

    // Метка `resume` из C.
    ckt.CKTdelta = Math.min(ckt.CKTdelta, ckt.CKTmaxStep);

    if (ckt.CKTtime === ckt.CKTbreaks[0]) {
      // Первая точка после точки останова: срезать порядок интегрирования
      // и ограничить шаг 0.1 от минимума (прошлый шаг, до следующей точки).
      ckt.CKTorder = 1;
      const mt = Math.min(ckt.CKTsaveDelta, ckt.CKTbreaks[1] - ckt.CKTbreaks[0]);
      ckt.CKTdelta = Math.min(ckt.CKTdelta, 0.1 * mt);
      if (firsttime) ckt.CKTdelta /= 10;
    }

    // XSPICE: выбросить устаревшие постоянные точки останова.
    while (ckt.CKTbreaks[0] <= ckt.CKTtime + ckt.CKTminBreak) cktClrBreak(ckt);
    // XSPICE: если шаг перескакивает ближайшую точку — принудительно попасть в неё.
    if (ckt.CKTtime + ckt.CKTdelta > ckt.CKTbreaks[0]) {
      ckt.CKTbreak = 1;
      ckt.CKTsaveDelta = ckt.CKTdelta;
      ckt.CKTdelta = ckt.CKTbreaks[0] - ckt.CKTtime;
    }

    for (let i = 5; i >= 0; i--) ckt.CKTdeltaOld[i + 1] = ckt.CKTdeltaOld[i];
    ckt.CKTdeltaOld[0] = ckt.CKTdelta;

    const temp = ckt.CKTstates[ckt.CKTmaxOrder + 1];
    for (let i = ckt.CKTmaxOrder; i >= 0; i--) ckt.CKTstates[i + 1] = ckt.CKTstates[i];
    ckt.CKTstates[0] = temp;

    // Метка `600` из C: попытки шага до приёма/отказа.
    for (;;) {
      // XSPICE: CAPask должен видеть DOING_TRAN уже на этапе расчёта шага.
      ckt.CKTcurrentAnalysis = DOING_TRAN;

      olddelta = ckt.CKTdelta;
      ckt.CKTtime += ckt.CKTdelta;
      ckt.CKTdeltaOld[0] = ckt.CKTdelta;
      const comCofError = niComCof(ckt);
      if (comCofError) return comCofError;

      converged = niIter(ckt, ckt.CKTtranMaxIter);
      ckt.CKTstat.STATtimePts++;
      ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODETRAN | MODEINITPRED;

      if (firsttime) {
        copyStates(ckt, 1, 2);
        copyStates(ckt, 1, 3);
      }

      if (converged !== 0) {
        ckt.CKTtime -= ckt.CKTdelta;
        ckt.CKTstat.STATrejected++;
        ckt.CKTdelta /= 8;
        if (firsttime) ckt.CKTmode = (ckt.CKTmode & MODEUIC) | MODETRAN | MODEINITTRAN;
        ckt.CKTorder = 1;
      } else {
        if (firsttime) {
          firsttime = false;
          continue nextTime; // goto nextTime (без проверки LTE)
        }

        let newStep = ckt.CKTdelta;
        let trunc = cktTrunc(ckt, newStep);
        if (trunc.error) return trunc.error;
        newStep = trunc.timeStep;
        if (newStep > 0.9 * ckt.CKTdelta) {
          if (ckt.CKTorder === 1) {
            newStep = ckt.CKTdelta;
            ckt.CKTorder = 2;
            trunc = cktTrunc(ckt, newStep);
            if (trunc.error) return trunc.error;
            newStep = trunc.timeStep;
            if (newStep <= 1.05 * ckt.CKTdelta) ckt.CKTorder = 1;
          }
          ckt.CKTdelta = newStep;
          continue nextTime; // точка принята → goto nextTime
        }
        ckt.CKTtime -= ckt.CKTdelta;
        ckt.CKTstat.STATrejected++;
        ckt.CKTdelta = newStep;
      }

      if (ckt.CKTdelta <= ckt.CKTdelmin) {
        if (olddelta > ckt.CKTdelmin) {
          ckt.CKTdelta = ckt.CKTdelmin;
        } else {
          ckt.CKTcurrentAnalysis = DOING_TRAN;
          ckt.errMsg = 'Timestep too small';
          ckt.errRtn = 'DCtran';
          return E_TIMESTEP;
        }
      }
    }
  }
}

export const tran = {
  an_init: tranInit,
  an_func: dcTran,
  setParm: tranSetParm,
  askQuest: tranAskQuest,
};
