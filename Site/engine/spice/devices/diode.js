/**
 * diode.js — диод SPICE3F4/XSPICE (`Diode`, index 8).
 *
 * Порт `vendor/xspice-1-0/src/sim/DEV/DIO/` (XSPICE-редакция; отличия от F4
 * только в noise/disto-хуках, которые здесь не портируются):
 *  - `DIOsetup` — defaults модели, внутренний узел `rs` (`posPrime`), 5
 *    состояний (`vd`, `id`, `gd`, `qcap`, `ccap`), элементы матрицы;
 *  - `DIOtemp` — температурная подстройка (`tSatCur`, `tJctPot`, `tJctCap`,
 *    `tVcrit`, `tBrkdwnV`, `tF1`) и пробой;
 *  - `DIOload` — DC/TRAN: `pnjlim`, bypass, пробой, заряд перехода,
 *    интегрирование (`NIintegrate`), счётчик несходимости;
 *  - `DIOacLoad`, `DIOtrunc`, `DIOconvTest`, `DIOask`/`DIOmAsk`, `DIOunsetup`.
 *
 * Не портировано: noise/disto/PZ/sensitivity (`DIOnoise`, `DIOdisto`,
 * `DIOpzLoad`, `DIOs*`) — фазы P3. `DIOgetic` в этой сборке не вызывается.
 */

import {
  OK,
  E_BADPARM,
  E_NOMEM,
  ERR_WARNING,
  MODEAC,
  MODEINITFIX,
  MODEINITJCT,
  MODEINITPRED,
  MODEINITSMSIG,
  MODEINITTRAN,
  MODETRAN,
  MODETRANOP,
  MODEUIC,
  CONSTKoverQ,
  cktError,
  cktMkVolt,
  cktDltNNum,
  cktTerr,
} from '../ckt.js';
import { niIntegrate } from '../ni.js';
import { SMPmakeElt } from '../sparse.js';
import { DEVpred } from './common.js';

/** `CONSTCtoK` (`const.h`). */
export const CONSTCtoK = 273.15;
/** `CHARGE` (`const.h`). */
const CHARGE = 1.6021918e-19;
/** `CONSTboltz` (`const.h`). */
const CONSTboltz = 1.3806226e-23;
/** `REFTEMP` (`const.h`). */
const REFTEMP = 300.15;
/** `CONSTroot2` (`SPIinit.c`). */
const CONSTroot2 = Math.sqrt(2);
/** `CONSTe` (`SPIinit.c`). */
const CONSTe = Math.exp(1);

/** `E_ASKPOWER` (`sperror.h`): `E_PRIVATE + 12`. */
const E_ASKPOWER = 112;
/** `DOING_AC` (`tskdefs.h`). */
const DOING_AC = 4;

/**
 * EWB-редакция DLL собрана с `NOBYPASS`: блок `#ifndef NOBYPASS` в `DIOload`
 * не действует. Проверено оракулом: после OP состояние диода совпадает с
 * последним решением (а не с предыдущей итерацией) и опция `bypass` не влияет
 * на AC (`docs/re/engine-quirks.md`, Q-D05). Флаг оставлен, чтобы порт
 * оставался структурно близок к C.
 */
const NOBYPASS = true;

/** Смещения состояний в `CKTstates` (`diodefs.h`, порядок DIOstate+0..4). */
export const DIO_VD = 0;
export const DIO_ID = 1;
export const DIO_GD = 2;
export const DIO_CAPCHARGE = 3;
export const DIO_CAPCURRENT = 4;
export const DIO_NUM_STATES = 5;

/** Идентификаторы параметров инстанса (`diodefs.h`). */
export const DIO_AREA = 1;
export const DIO_IC = 2;
export const DIO_OFF = 3;
export const DIO_CURRENT = 4;
export const DIO_VOLTAGE = 5;
export const DIO_CHARGE = 6;
export const DIO_CAPCUR = 7;
export const DIO_CONDUCT = 8;
export const DIO_AREA_SENS = 9;
export const DIO_POWER = 10;
export const DIO_TEMP = 11;
export const DIO_CAP = 18;

/** Идентификаторы параметров модели (`diodefs.h`). */
export const DIO_MOD_IS = 101;
export const DIO_MOD_RS = 102;
export const DIO_MOD_N = 103;
export const DIO_MOD_TT = 104;
export const DIO_MOD_CJO = 105;
export const DIO_MOD_VJ = 106;
export const DIO_MOD_M = 107;
export const DIO_MOD_EG = 108;
export const DIO_MOD_XTI = 109;
export const DIO_MOD_FC = 110;
export const DIO_MOD_BV = 111;
export const DIO_MOD_IBV = 112;
export const DIO_MOD_D = 113;
export const DIO_MOD_COND = 114;
export const DIO_MOD_TNOM = 115;
export const DIO_MOD_KF = 116;
export const DIO_MOD_AF = 117;

/**
 * `DEVpnjlim` (`devsup.c`) — ограничение приращения напряжения p-n перехода.
 *
 * @param {number} vnew — новое напряжение
 * @param {number} vold — напряжение на прошлой итерации
 * @param {number} vt — тепловой потенциал (с учётом n)
 * @param {number} vcrit — критическое напряжение
 * @returns {{vnew:number, icheck:number}}
 */
export function pnjlim(vnew, vold, vt, vcrit) {
  let check = 0;
  if (vnew > vcrit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      if (arg > 0) vnew = vold + vt * Math.log(arg);
      else vnew = vcrit;
    } else {
      vnew = vt * Math.log(vnew / vt);
    }
    check = 1;
  }
  return { vnew, icheck: check };
}

/** Новая модель (zeroed-поля + Given-флаги как в C). */
export function newModel(model) {
  model.DIOsatCur = 0;
  model.DIOresist = 0;
  model.DIOconductance = 0;
  model.DIOemissionCoeff = 0;
  model.DIOtransitTime = 0;
  model.DIOjunctionCap = 0;
  model.DIOjunctionPot = 0;
  model.DIOgradingCoeff = 0;
  model.DIOactivationEnergy = 0;
  model.DIOsaturationCurrentExp = 0;
  model.DIOdepletionCapCoeff = 0;
  model.DIObreakdownVoltage = 0;
  model.DIObreakdownCurrent = 0;
  model.DIOf2 = 0;
  model.DIOf3 = 0;
  model.DIOnomTemp = 0;
  model.DIOfNcoef = 0;
  model.DIOfNexp = 0;
  model.DIOsatCurGiven = false;
  model.DIOresistGiven = false;
  model.DIOemissionCoeffGiven = false;
  model.DIOtransitTimeGiven = false;
  model.DIOjunctionCapGiven = false;
  model.DIOjunctionPotGiven = false;
  model.DIOgradingCoeffGiven = false;
  model.DIOactivationEnergyGiven = false;
  model.DIOsaturationCurrentExpGiven = false;
  model.DIOdepletionCapCoeffGiven = false;
  model.DIObreakdownVoltageGiven = false;
  model.DIObreakdownCurrentGiven = false;
  model.DIOnomTempGiven = false;
  model.DIOfNcoefGiven = false;
  model.DIOfNexpGiven = false;
}

/** Новый инстанс. */
export function newInstance(inst) {
  inst.DIOposPrimeNode = 0;
  inst.DIOcap = 0;
  inst.DIOsenParmNo = 0;
  inst.DIOoff = false;
  inst.DIOareaGiven = false;
  inst.DIOinitCondGiven = false;
  inst.DIOsenPertFlag = false;
  inst.DIOtempGiven = false;
  inst.DIOarea = 0;
  inst.DIOinitCond = 0;
  inst.DIOtemp = 0;
  inst.DIOtJctPot = 0;
  inst.DIOtJctCap = 0;
  inst.DIOtDepCap = 0;
  inst.DIOtSatCur = 0;
  inst.DIOtVcrit = 0;
  inst.DIOtF1 = 0;
  inst.DIOtBrkdwnV = 0;
  inst.DIOstate = 0;
  inst.DIOposPosPrimePtr = null;
  inst.DIOnegPosPrimePtr = null;
  inst.DIOposPrimePosPtr = null;
  inst.DIOposPrimeNegPtr = null;
  inst.DIOposPosPtr = null;
  inst.DIOnegNegPtr = null;
  inst.DIOposPrimePosPrimePtr = null;
}

/** `DIOparam`. */
export function DEVparam(param, value, inst) {
  switch (param) {
    case DIO_AREA:
      inst.DIOarea = value;
      inst.DIOareaGiven = true;
      break;
    case DIO_TEMP:
      inst.DIOtemp = value + CONSTCtoK;
      inst.DIOtempGiven = true;
      break;
    case DIO_OFF:
      inst.DIOoff = Boolean(value);
      break;
    case DIO_IC:
      inst.DIOinitCond = value;
      inst.DIOinitCondGiven = true;
      break;
    case DIO_AREA_SENS:
      inst.DIOsenParmNo = value;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `DIOmParam`. */
export function DEVmodParam(param, value, model) {
  switch (param) {
    case DIO_MOD_IS:
      model.DIOsatCur = value;
      model.DIOsatCurGiven = true;
      break;
    case DIO_MOD_TNOM:
      model.DIOnomTemp = value + CONSTCtoK;
      model.DIOnomTempGiven = true;
      break;
    case DIO_MOD_RS:
      model.DIOresist = value;
      model.DIOresistGiven = true;
      break;
    case DIO_MOD_N:
      model.DIOemissionCoeff = value;
      model.DIOemissionCoeffGiven = true;
      break;
    case DIO_MOD_TT:
      model.DIOtransitTime = value;
      model.DIOtransitTimeGiven = true;
      break;
    case DIO_MOD_CJO:
      model.DIOjunctionCap = value;
      model.DIOjunctionCapGiven = true;
      break;
    case DIO_MOD_VJ:
      model.DIOjunctionPot = value;
      model.DIOjunctionPotGiven = true;
      break;
    case DIO_MOD_M:
      model.DIOgradingCoeff = value;
      model.DIOgradingCoeffGiven = true;
      break;
    case DIO_MOD_EG:
      model.DIOactivationEnergy = value;
      model.DIOactivationEnergyGiven = true;
      break;
    case DIO_MOD_XTI:
      model.DIOsaturationCurrentExp = value;
      model.DIOsaturationCurrentExpGiven = true;
      break;
    case DIO_MOD_FC:
      model.DIOdepletionCapCoeff = value;
      model.DIOdepletionCapCoeffGiven = true;
      break;
    case DIO_MOD_BV:
      model.DIObreakdownVoltage = value;
      model.DIObreakdownVoltageGiven = true;
      break;
    case DIO_MOD_IBV:
      model.DIObreakdownCurrent = value;
      model.DIObreakdownCurrentGiven = true;
      break;
    case DIO_MOD_D:
      // подтверждение, что это диод — no-op
      break;
    case DIO_MOD_KF:
      model.DIOfNcoef = value;
      model.DIOfNcoefGiven = true;
      break;
    case DIO_MOD_AF:
      model.DIOfNexp = value;
      model.DIOfNexpGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `DIOsetup`: defaults, внутренний узел, элементы матрицы, состояния. */
export function DEVsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.DIOemissionCoeffGiven) model.DIOemissionCoeff = 1;
    if (!model.DIOsatCurGiven) model.DIOsatCur = 1e-14;
    if (!model.DIObreakdownCurrentGiven) model.DIObreakdownCurrent = 1e-3;
    if (!model.DIOjunctionPotGiven) model.DIOjunctionPot = 1;
    if (!model.DIOgradingCoeffGiven) model.DIOgradingCoeff = 0.5;
    if (!model.DIOdepletionCapCoeffGiven) model.DIOdepletionCapCoeff = 0.5;
    if (!model.DIOtransitTimeGiven) model.DIOtransitTime = 0;
    if (!model.DIOjunctionCapGiven) model.DIOjunctionCap = 0;
    if (!model.DIOactivationEnergyGiven) model.DIOactivationEnergy = 1.11;
    if (!model.DIOsaturationCurrentExpGiven) model.DIOsaturationCurrentExp = 3;
    if (!model.DIOfNcoefGiven) model.DIOfNcoef = 0;
    if (!model.DIOfNexpGiven) model.DIOfNexp = 1;

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.DIOareaGiven) here.DIOarea = 1;

      if (model.DIOresist === 0) {
        here.DIOposPrimeNode = here.GENnode1;
      } else if (here.DIOposPrimeNode === 0) {
        const made = cktMkVolt(ckt, here.GENname, 'internal');
        if (made.error) return made.error;
        here.DIOposPrimeNode = made.node.number;
      }

      here.DIOstate = state.value;
      state.value += DIO_NUM_STATES;

      here.DIOposPosPrimePtr = SMPmakeElt(matrix, here.GENnode1, here.DIOposPrimeNode);
      here.DIOnegPosPrimePtr = SMPmakeElt(matrix, here.GENnode2, here.DIOposPrimeNode);
      here.DIOposPrimePosPtr = SMPmakeElt(matrix, here.DIOposPrimeNode, here.GENnode1);
      here.DIOposPrimeNegPtr = SMPmakeElt(matrix, here.DIOposPrimeNode, here.GENnode2);
      here.DIOposPosPtr = SMPmakeElt(matrix, here.GENnode1, here.GENnode1);
      here.DIOnegNegPtr = SMPmakeElt(matrix, here.GENnode2, here.GENnode2);
      here.DIOposPrimePosPrimePtr = SMPmakeElt(
        matrix,
        here.DIOposPrimeNode,
        here.DIOposPrimeNode,
      );
      if (
        !here.DIOposPosPrimePtr ||
        !here.DIOnegPosPrimePtr ||
        !here.DIOposPrimePosPtr ||
        !here.DIOposPrimeNegPtr ||
        !here.DIOposPosPtr ||
        !here.DIOnegNegPtr ||
        !here.DIOposPrimePosPrimePtr
      ) {
        return E_NOMEM;
      }
    }
  }
  return OK;
}

/** `DIOunsetup` — удалить внутренние узлы (`rs != 0`). */
export function DEVunsetup(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.DIOposPrimeNode && here.DIOposPrimeNode !== here.GENnode1) {
        cktDltNNum(ckt, here.DIOposPrimeNode);
        here.DIOposPrimeNode = 0;
      }
    }
  }
  return OK;
}

/** `DIOtemp` — температурная подстройка параметров и пробой. */
export function DEVtemperature(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.DIOnomTempGiven) model.DIOnomTemp = ckt.CKTnomTemp;
    const vtnom = CONSTKoverQ * model.DIOnomTemp;

    if (model.DIOgradingCoeff > 0.9) {
      cktError(
        ckt,
        ERR_WARNING,
        `${model.GENmodName}: grading coefficient too large, limited to 0.9`,
      );
      model.DIOgradingCoeff = 0.9;
    }
    if (model.DIOactivationEnergy < 0.1) {
      cktError(
        ckt,
        ERR_WARNING,
        `${model.GENmodName}: activation energy too small, limited to 0.1`,
      );
      model.DIOactivationEnergy = 0.1;
    }
    if (model.DIOdepletionCapCoeff > 0.95) {
      cktError(
        ckt,
        ERR_WARNING,
        `${model.GENmodName}: coefficient Fc too large, limited to 0.95`,
      );
      model.DIOdepletionCapCoeff = 0.95;
    }

    if (!model.DIOresistGiven || model.DIOresist === 0) {
      model.DIOconductance = 0;
    } else {
      model.DIOconductance = 1 / model.DIOresist;
    }

    const xfc = Math.log(1 - model.DIOdepletionCapCoeff);
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.DIOtempGiven) here.DIOtemp = ckt.CKTtemp;
      const vt = CONSTKoverQ * here.DIOtemp;

      const fact2 = here.DIOtemp / REFTEMP;
      const egfet =
        1.16 -
        (7.02e-4 * here.DIOtemp * here.DIOtemp) / (here.DIOtemp + 1108);
      const arg =
        -egfet / (2 * CONSTboltz * here.DIOtemp) +
        1.1150877 / (CONSTboltz * (REFTEMP + REFTEMP));
      const pbfact = -2 * vt * (1.5 * Math.log(fact2) + CHARGE * arg);

      const egfet1 =
        1.16 -
        (7.02e-4 * model.DIOnomTemp * model.DIOnomTemp) /
          (model.DIOnomTemp + 1108);
      const arg1 =
        -egfet1 / (CONSTboltz * 2 * model.DIOnomTemp) +
        1.1150877 / (2 * CONSTboltz * REFTEMP);
      const fact1 = model.DIOnomTemp / REFTEMP;
      const pbfact1 = -2 * vtnom * (1.5 * Math.log(fact1) + CHARGE * arg1);
      const pbo = (model.DIOjunctionPot - pbfact1) / fact1;
      const gmaold = (model.DIOjunctionPot - pbo) / pbo;

      here.DIOtJctCap =
        model.DIOjunctionCap /
        (1 +
          model.DIOgradingCoeff *
            (400e-6 * (model.DIOnomTemp - REFTEMP) - gmaold));
      here.DIOtJctPot = pbfact + fact2 * pbo;
      const gmanew = (here.DIOtJctPot - pbo) / pbo;
      here.DIOtJctCap *=
        1 +
        model.DIOgradingCoeff * (400e-6 * (here.DIOtemp - REFTEMP) - gmanew);

      here.DIOtSatCur =
        model.DIOsatCur *
        Math.exp(
          (here.DIOtemp / model.DIOnomTemp - 1) *
            (model.DIOactivationEnergy / (model.DIOemissionCoeff * vt)) +
            (model.DIOsaturationCurrentExp / model.DIOemissionCoeff) *
              Math.log(here.DIOtemp / model.DIOnomTemp),
        );

      here.DIOtF1 =
        (here.DIOtJctPot * (1 - Math.exp((1 - model.DIOgradingCoeff) * xfc))) /
        (1 - model.DIOgradingCoeff);
      here.DIOtDepCap = model.DIOdepletionCapCoeff * here.DIOtJctPot;

      const vte = model.DIOemissionCoeff * vt;
      here.DIOtVcrit = vte * Math.log(vte / (CONSTroot2 * here.DIOtSatCur));

      if (model.DIObreakdownVoltageGiven) {
        let cbv = model.DIObreakdownCurrent;
        let xbv;
        if (cbv < (here.DIOtSatCur * model.DIObreakdownVoltage) / vt) {
          cbv = (here.DIOtSatCur * model.DIObreakdownVoltage) / vt;
          cktError(
            ckt,
            ERR_WARNING,
            `${here.GENname}: breakdown current increased to ${cbv} to resolve incompatability`,
          );
          cktError(
            ckt,
            ERR_WARNING,
            'with specified saturation current',
          );
          xbv = model.DIObreakdownVoltage;
        } else {
          const tol = ckt.CKTreltol * cbv;
          xbv =
            model.DIObreakdownVoltage -
            vt * Math.log(1 + cbv / here.DIOtSatCur);
          let matched = false;
          let xcbv = 0;
          for (let iter = 0; iter < 25; iter++) {
            xbv =
              model.DIObreakdownVoltage -
              vt * Math.log(cbv / here.DIOtSatCur + 1 - xbv / vt);
            xcbv =
              here.DIOtSatCur *
              (Math.exp((model.DIObreakdownVoltage - xbv) / vt) - 1 + xbv / vt);
            if (Math.abs(xcbv - cbv) <= tol) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            cktError(
              ckt,
              ERR_WARNING,
              `${here.GENname}: unable to match forward and reverse diode regions: bv = ${xbv}, ibv = ${xcbv}`,
            );
          }
        }
        here.DIOtBrkdwnV = xbv;
      }
    }
    model.DIOf2 = Math.exp((1 + model.DIOgradingCoeff) * xfc);
    model.DIOf3 =
      1 - model.DIOdepletionCapCoeff * (1 + model.DIOgradingCoeff);
  }
  return OK;
}

/** `DIOload` — DC/TRAN-загрузка диода. */
export function DEVload(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const csat = here.DIOtSatCur * here.DIOarea;
      const gspr = model.DIOconductance * here.DIOarea;
      const vt = CONSTKoverQ * here.DIOtemp;
      const vte = model.DIOemissionCoeff * vt;

      let vd;
      let check = 1;
      let cdhat = 0;

      if (ckt.CKTmode & MODEINITSMSIG) {
        vd = s0[here.DIOstate + DIO_VD];
      } else if (ckt.CKTmode & MODEINITTRAN) {
        vd = s1[here.DIOstate + DIO_VD];
      } else if (
        ckt.CKTmode & MODEINITJCT &&
        ckt.CKTmode & MODETRANOP &&
        ckt.CKTmode & MODEUIC
      ) {
        vd = here.DIOinitCond;
      } else if (ckt.CKTmode & MODEINITJCT && here.DIOoff) {
        vd = 0;
      } else if (ckt.CKTmode & MODEINITJCT) {
        vd = here.DIOtVcrit;
      } else if (ckt.CKTmode & MODEINITFIX && here.DIOoff) {
        vd = 0;
      } else {
        if (ckt.CKTmode & MODEINITPRED) {
          s0[here.DIOstate + DIO_VD] =
            s1[here.DIOstate + DIO_VD];
          vd = DEVpred(ckt, here.DIOstate + DIO_VD);
          s0[here.DIOstate + DIO_ID] =
            s1[here.DIOstate + DIO_ID];
          s0[here.DIOstate + DIO_GD] =
            s1[here.DIOstate + DIO_GD];
        } else {
          vd =
            ckt.CKTrhsOld[here.DIOposPrimeNode] -
            ckt.CKTrhsOld[here.GENnode2];
        }

        const delvd = vd - s0[here.DIOstate + DIO_VD];
        cdhat =
          s0[here.DIOstate + DIO_ID] +
          s0[here.DIOstate + DIO_GD] * delvd;

        // bypass, если решение не изменилось (goto load в C).
        // В EWB-редакции DLL эта ветка не действует (`NOBYPASS`): состояние
        // диода после OP равно последнему решению, а опция `bypass` не влияет
        // на AC — см. `docs/re/engine-quirks.md`, Q-D05.
        if (NOBYPASS) {
          // см. комментарий выше; ветка выключена на этапе компиляции
        } else if (!(ckt.CKTmode & MODEINITPRED) && ckt.CKTbypass) {
          let tol =
            ckt.CKTvoltTol +
            ckt.CKTreltol *
              Math.max(Math.abs(vd), Math.abs(s0[here.DIOstate + DIO_VD]));
          if (Math.abs(delvd) < tol) {
            tol =
              ckt.CKTreltol *
                Math.max(
                  Math.abs(cdhat),
                  Math.abs(s0[here.DIOstate + DIO_ID]),
                ) +
              ckt.CKTabstol;
            if (Math.abs(cdhat - s0[here.DIOstate + DIO_ID]) < tol) {
              vd = s0[here.DIOstate + DIO_VD];
              const cdBypass = s0[here.DIOstate + DIO_ID];
              const gdBypass = s0[here.DIOstate + DIO_GD];
              const cdeq = cdBypass - gdBypass * vd;
              ckt.CKTrhs[here.GENnode2] += cdeq;
              ckt.CKTrhs[here.DIOposPrimeNode] -= cdeq;
              here.DIOposPosPtr.real += gspr;
              here.DIOnegNegPtr.real += gdBypass;
              here.DIOposPrimePosPrimePtr.real += gdBypass + gspr;
              here.DIOposPosPrimePtr.real -= gspr;
              here.DIOnegPosPrimePtr.real -= gdBypass;
              here.DIOposPrimePosPtr.real -= gspr;
              here.DIOposPrimeNegPtr.real -= gdBypass;
              continue;
            }
          }
        }

        // ограничение напряжения перехода
        if (
          model.DIObreakdownVoltageGiven &&
          vd < Math.min(0, -here.DIOtBrkdwnV + 10 * vte)
        ) {
          let vdtemp = -(vd + here.DIOtBrkdwnV);
          const limited = pnjlim(
            vdtemp,
            -(s0[here.DIOstate + DIO_VD] + here.DIOtBrkdwnV),
            vte,
            here.DIOtVcrit,
          );
          vdtemp = limited.vnew;
          check = limited.icheck;
          vd = -(vdtemp + here.DIOtBrkdwnV);
        } else {
          const limited = pnjlim(
            vd,
            s0[here.DIOstate + DIO_VD],
            vte,
            here.DIOtVcrit,
          );
          vd = limited.vnew;
          check = limited.icheck;
        }
      }

      // ток и проводимость
      let cd;
      let gd;
      if (vd >= -3 * vte) {
        const evd = Math.exp(vd / vte);
        cd = csat * (evd - 1) + ckt.CKTgmin * vd;
        gd = (csat * evd) / vte + ckt.CKTgmin;
      } else if (!here.DIOtBrkdwnV || vd >= -here.DIOtBrkdwnV) {
        let arg = (3 * vte) / (vd * CONSTe);
        arg = arg * arg * arg;
        cd = -csat * (1 + arg) + ckt.CKTgmin * vd;
        gd = (csat * 3 * arg) / vd + ckt.CKTgmin;
      } else {
        const evrev = Math.exp(-(here.DIOtBrkdwnV + vd) / vte);
        cd = -csat * evrev + ckt.CKTgmin * vd;
        gd = (csat * evrev) / vte + ckt.CKTgmin;
      }

      // заряд перехода и интегрирование
      if (
        ckt.CKTmode & (MODETRAN | MODEAC | MODEINITSMSIG) ||
        (ckt.CKTmode & MODETRANOP && ckt.CKTmode & MODEUIC)
      ) {
        const czero = here.DIOtJctCap * here.DIOarea;
        let capd;
        if (vd < here.DIOtDepCap) {
          const arg = 1 - vd / model.DIOjunctionPot;
          const sarg = Math.exp(-model.DIOgradingCoeff * Math.log(arg));
          s0[here.DIOstate + DIO_CAPCHARGE] =
            model.DIOtransitTime * cd +
            (model.DIOjunctionPot * czero * (1 - arg * sarg)) /
              (1 - model.DIOgradingCoeff);
          capd = model.DIOtransitTime * gd + czero * sarg;
        } else {
          const czof2 = czero / model.DIOf2;
          s0[here.DIOstate + DIO_CAPCHARGE] =
            model.DIOtransitTime * cd +
            czero * here.DIOtF1 +
            czof2 *
              (model.DIOf3 * (vd - here.DIOtDepCap) +
                (model.DIOgradingCoeff /
                  (model.DIOjunctionPot + model.DIOjunctionPot)) *
                  (vd * vd - here.DIOtDepCap * here.DIOtDepCap));
          capd =
            model.DIOtransitTime * gd +
            czof2 *
              (model.DIOf3 +
                (model.DIOgradingCoeff * vd) / model.DIOjunctionPot);
        }
        here.DIOcap = capd;

        if (!(ckt.CKTmode & MODETRANOP) || !(ckt.CKTmode & MODEUIC)) {
          if (ckt.CKTmode & MODEINITSMSIG) {
            s0[here.DIOstate + DIO_CAPCURRENT] = capd;
            continue;
          }

          if (ckt.CKTmode & MODEINITTRAN) {
            s1[here.DIOstate + DIO_CAPCHARGE] =
              s0[here.DIOstate + DIO_CAPCHARGE];
          }
          const integ = niIntegrate(
            ckt,
            capd,
            here.DIOstate + DIO_CAPCHARGE,
          );
          if (integ.error) return integ.error;
          gd += integ.geq;
          cd += s0[here.DIOstate + DIO_CAPCURRENT];
          if (ckt.CKTmode & MODEINITTRAN) {
            s1[here.DIOstate + DIO_CAPCURRENT] =
              s0[here.DIOstate + DIO_CAPCURRENT];
          }
        }
      }

      // сходимость (NEWCONV — как в XSPICE `prefix.h`: проверка только по `Check`)
      if (!(ckt.CKTmode & MODEINITFIX) || !here.DIOoff) {
        if (check === 1) {
          ckt.CKTnoncon++;
          ckt.CKTtroubleElt = here;
        }
      }

      s0[here.DIOstate + DIO_VD] = vd;
      s0[here.DIOstate + DIO_ID] = cd;
      s0[here.DIOstate + DIO_GD] = gd;

      // загрузка RHS/матрицы
      const cdeq = cd - gd * vd;
      ckt.CKTrhs[here.GENnode2] += cdeq;
      ckt.CKTrhs[here.DIOposPrimeNode] -= cdeq;

      here.DIOposPosPtr.real += gspr;
      here.DIOnegNegPtr.real += gd;
      here.DIOposPrimePosPrimePtr.real += gd + gspr;
      here.DIOposPosPrimePtr.real -= gspr;
      here.DIOnegPosPrimePtr.real -= gd;
      here.DIOposPrimePosPtr.real -= gspr;
      here.DIOposPrimeNegPtr.real -= gd;
    }
  }
  return OK;
}

/** `DIOacLoad`. */
export function DEVacLoad(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const gspr = model.DIOconductance * here.DIOarea;
      const geq = ckt.CKTstates[0][here.DIOstate + DIO_GD];
      const xceq =
        ckt.CKTstates[0][here.DIOstate + DIO_CAPCURRENT] * ckt.CKTomega;

      here.DIOposPosPtr.real += gspr;
      here.DIOnegNegPtr.real += geq;
      here.DIOnegNegPtr.imag += xceq;
      here.DIOposPrimePosPrimePtr.real += geq + gspr;
      here.DIOposPrimePosPrimePtr.imag += xceq;
      here.DIOposPosPrimePtr.real -= gspr;
      here.DIOnegPosPrimePtr.real -= geq;
      here.DIOnegPosPrimePtr.imag -= xceq;
      here.DIOposPrimePosPtr.real -= gspr;
      here.DIOposPrimeNegPtr.real -= geq;
      here.DIOposPrimeNegPtr.imag -= xceq;
    }
  }
  return OK;
}

/** `DIOtrunc`. */
export function DEVtrunc(inModel, ckt, timeState) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      cktTerr(here.DIOstate + DIO_CAPCHARGE, ckt, timeState);
    }
  }
  return OK;
}

/** `DIOconvTest`. */
export function DEVconvTest(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const vd =
        ckt.CKTrhsOld[here.DIOposPrimeNode] -
        ckt.CKTrhsOld[here.GENnode2];
      const delvd = vd - ckt.CKTstates[0][here.DIOstate + DIO_VD];
      const cdhat =
        ckt.CKTstates[0][here.DIOstate + DIO_ID] +
        ckt.CKTstates[0][here.DIOstate + DIO_GD] * delvd;
      const cd = ckt.CKTstates[0][here.DIOstate + DIO_ID];
      const tol =
        ckt.CKTreltol * Math.max(Math.abs(cdhat), Math.abs(cd)) +
        ckt.CKTabstol;
      if (Math.abs(cdhat - cd) > tol) {
        ckt.CKTnoncon++;
        return OK;
      }
    }
  }
  return OK;
}

/** `DIOask`. */
export function DEVask(ckt, inst, which) {
  const s0 = ckt.CKTstates[0];
  switch (which) {
    case DIO_OFF:
      return { error: OK, value: inst.DIOoff ? 1 : 0 };
    case DIO_IC:
      return { error: OK, value: inst.DIOinitCond };
    case DIO_AREA:
      return { error: OK, value: inst.DIOarea };
    case DIO_TEMP:
      return { error: OK, value: inst.DIOtemp - CONSTCtoK };
    case DIO_VOLTAGE:
      return { error: OK, value: s0[inst.DIOstate + DIO_VD] };
    case DIO_CURRENT:
      return { error: OK, value: s0[inst.DIOstate + DIO_ID] };
    case DIO_CAP:
      return { error: OK, value: inst.DIOcap };
    case DIO_CHARGE:
      return { error: OK, value: s0[inst.DIOstate + DIO_CAPCHARGE] };
    case DIO_CAPCUR:
      return { error: OK, value: s0[inst.DIOstate + DIO_CAPCURRENT] };
    case DIO_CONDUCT:
      return { error: OK, value: s0[inst.DIOstate + DIO_GD] };
    case DIO_POWER:
      if (ckt.CKTcurrentAnalysis & DOING_AC) {
        ckt.errMsg = 'Current and power not available for ac analysis';
        ckt.errRtn = 'DIOask';
        return { error: E_ASKPOWER, value: NaN };
      }
      return {
        error: OK,
        value:
          s0[inst.DIOstate + DIO_ID] *
          s0[inst.DIOstate + DIO_VD],
      };
    default:
      return { error: E_BADPARM, value: undefined };
  }
}

/** `DIOmAsk`. */
export function DEVmAsk(ckt, model, which) {
  switch (which) {
    case DIO_MOD_IS:
      return { error: OK, value: model.DIOsatCur };
    case DIO_MOD_TNOM:
      return { error: OK, value: model.DIOnomTemp - CONSTCtoK };
    case DIO_MOD_RS:
      return { error: OK, value: model.DIOresist };
    case DIO_MOD_N:
      return { error: OK, value: model.DIOemissionCoeff };
    case DIO_MOD_TT:
      return { error: OK, value: model.DIOtransitTime };
    case DIO_MOD_CJO:
      return { error: OK, value: model.DIOjunctionCap };
    case DIO_MOD_VJ:
      return { error: OK, value: model.DIOjunctionPot };
    case DIO_MOD_M:
      return { error: OK, value: model.DIOgradingCoeff };
    case DIO_MOD_EG:
      return { error: OK, value: model.DIOactivationEnergy };
    case DIO_MOD_XTI:
      return { error: OK, value: model.DIOsaturationCurrentExp };
    case DIO_MOD_FC:
      return { error: OK, value: model.DIOdepletionCapCoeff };
    case DIO_MOD_KF:
      return { error: OK, value: model.DIOfNcoef };
    case DIO_MOD_AF:
      return { error: OK, value: model.DIOfNexp };
    case DIO_MOD_BV:
      return { error: OK, value: model.DIObreakdownVoltage };
    case DIO_MOD_IBV:
      return { error: OK, value: model.DIObreakdownCurrent };
    case DIO_MOD_COND:
      return { error: OK, value: model.DIOconductance };
    default:
      return { error: E_BADPARM, value: undefined };
  }
}

export const diode = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam,
  DEVmodParam,
  DEVsetup,
  DEVunsetup,
  DEVtemperature,
  DEVload,
  DEVacLoad,
  DEVtrunc,
  DEVconvTest,
  DEVask,
  DEVmAsk,
};
