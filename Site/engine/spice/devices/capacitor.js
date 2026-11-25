/**
 * capacitor.js — конденсатор (`Capacitor`, index 4).
 *
 * Порт `vendor/spice3f4/src/lib/dev/cap/*.c`:
 *  - `CAPsetup` — элементы матрицы + два состояния (заряд/ток);
 *  - `CAPtemp` — ёмкость из `cj/cjsw`, если `capacitance` не задана;
 *  - `CAPload` — трапеция/Gear через `NIintegrate`, UIC/INITTRAN;
 *  - `CAPacLoad` — мнимая часть `omega*C`;
 *  - `CAPtrunc` — LTE через `CKTterr`;
 *  - `CAPgetic` — начальное напряжение из RHS при UIC.
 *
 * Sensitivity/noise/pz — фазы P3.
 */

import {
  OK,
  E_NOMEM,
  E_BADPARM,
  MODETRAN,
  MODEAC,
  MODETRANOP,
  MODEDC,
  MODEINITJCT,
  MODEINITTRAN,
  MODEUIC,
  MODEINITPRED,
  cktTerr,
} from '../ckt.js';
import { SMPmakeElt } from '../sparse.js';
import { niIntegrate } from '../ni.js';

/** Параметры инстанса (`capdefs.h`). */
export const CAP_CAP = 1;
export const CAP_IC = 2;
export const CAP_WIDTH = 3;
export const CAP_LENGTH = 4;

/** Параметры модели (`capdefs.h`). */
export const CAP_MOD_CJ = 101;
export const CAP_MOD_CJSW = 102;
export const CAP_MOD_DEFWIDTH = 103;
export const CAP_MOD_C = 104;
export const CAP_MOD_NARROW = 105;

/** Состояния инстанса: `CAPqcap = CAPstate`, `CAPccap = CAPstate + 1`. */
export const CAP_NUM_STATES = 2;

export function newModel(model) {
  model.CAPcj = 0;
  model.CAPcjsw = 0;
  model.CAPdefWidth = 0;
  model.CAPnarrow = 0;
  model.CAPcjGiven = false;
  model.CAPcjswGiven = false;
  model.CAPdefWidthGiven = false;
  model.CAPnarrowGiven = false;
}

export function newInstance(inst) {
  inst.CAPstate = 0;
  inst.CAPcapac = 0;
  inst.CAPinitCond = 0;
  inst.CAPwidth = 0;
  inst.CAPlength = 0;
  inst.CAPcapGiven = false;
  inst.CAPicGiven = false;
  inst.CAPwidthGiven = false;
  inst.CAPlengthGiven = false;
  inst.CAPsenParmNo = 0;
  inst.CAPposPosptr = null;
  inst.CAPnegNegptr = null;
  inst.CAPposNegptr = null;
  inst.CAPnegPosptr = null;
}

/** `CAPparam`. */
export function DEVparam(param, value, inst) {
  switch (param) {
    case CAP_CAP:
      inst.CAPcapac = value;
      inst.CAPcapGiven = true;
      break;
    case CAP_IC:
      inst.CAPinitCond = value;
      inst.CAPicGiven = true;
      break;
    case CAP_WIDTH:
      inst.CAPwidth = value;
      inst.CAPwidthGiven = true;
      break;
    case CAP_LENGTH:
      inst.CAPlength = value;
      inst.CAPlengthGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `CAPmParam`. */
export function DEVmodParam(param, value, model) {
  switch (param) {
    case CAP_MOD_CJ:
      model.CAPcj = value;
      model.CAPcjGiven = true;
      break;
    case CAP_MOD_CJSW:
      model.CAPcjsw = value;
      model.CAPcjswGiven = true;
      break;
    case CAP_MOD_DEFWIDTH:
      model.CAPdefWidth = value;
      model.CAPdefWidthGiven = true;
      break;
    case CAP_MOD_NARROW:
      model.CAPnarrow = value;
      model.CAPnarrowGiven = true;
      break;
    case CAP_MOD_C:
      // подтверждение, что это конденсатор — no-op
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `CAPsetup`: модель → defaults, инстанс → элементы матрицы и состояния. */
export function DEVsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.CAPcjGiven) model.CAPcj = 0;
    if (!model.CAPcjswGiven) model.CAPcjsw = 0;
    if (!model.CAPdefWidthGiven) model.CAPdefWidth = 10e-6;
    if (!model.CAPnarrowGiven) model.CAPnarrow = 0;

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.CAPlengthGiven) here.CAPlength = 0;

      here.CAPposPosptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode1);
      here.CAPnegNegptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode2);
      here.CAPposNegptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode2);
      here.CAPnegPosptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode1);
      if (
        !here.CAPposPosptr ||
        !here.CAPnegNegptr ||
        !here.CAPposNegptr ||
        !here.CAPnegPosptr
      ) {
        return E_NOMEM;
      }

      here.CAPstate = state.value;
      state.value += CAP_NUM_STATES;
      // sensitivity-состояния (SENmode & TRANSEN) — фаза P3.
    }
  }
  return OK;
}

/** `CAPtemp`: ёмкость по умолчанию. */
export function DEVtemperature(inModel) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.CAPwidthGiven) here.CAPwidth = model.CAPdefWidth;
      if (!here.CAPcapGiven) {
        here.CAPcapac =
          model.CAPcj *
            (here.CAPwidth - model.CAPnarrow) *
            (here.CAPlength - model.CAPnarrow) +
          model.CAPcjsw *
            2 *
            (here.CAPlength - model.CAPnarrow + (here.CAPwidth - model.CAPnarrow));
      }
    }
  }
  return OK;
}

/** `CAPload`: интегрирование заряда (DC — открытая цепь, только state0). */
export function DEVload(inModel, ckt) {
  if (!(ckt.CKTmode & (MODETRAN | MODEAC | MODETRANOP))) return OK;

  const cond1 =
    (ckt.CKTmode & MODEDC && ckt.CKTmode & MODEINITJCT) ||
    (ckt.CKTmode & MODEUIC && ckt.CKTmode & MODEINITTRAN);

  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const qcap = here.CAPstate;
      const ccap = qcap + 1;

      let vcap;
      if (cond1) vcap = here.CAPinitCond;
      else vcap = ckt.CKTrhsOld[here.GENnode1] - ckt.CKTrhsOld[here.GENnode2];

      if (ckt.CKTmode & (MODETRAN | MODEAC)) {
        if (ckt.CKTmode & MODEINITPRED) {
          s0[qcap] = s1[qcap];
        } else {
          s0[qcap] = here.CAPcapac * vcap;
          if (ckt.CKTmode & MODEINITTRAN) s1[qcap] = s0[qcap];
        }
        const { error, geq, ceq } = niIntegrate(ckt, here.CAPcapac, qcap);
        if (error) return error;
        if (ckt.CKTmode & MODEINITTRAN) s1[ccap] = s0[ccap];

        here.CAPposPosptr.real += geq;
        here.CAPnegNegptr.real += geq;
        here.CAPposNegptr.real -= geq;
        here.CAPnegPosptr.real -= geq;
        ckt.CKTrhs[here.GENnode1] -= ceq;
        ckt.CKTrhs[here.GENnode2] += ceq;
      } else {
        s0[qcap] = here.CAPcapac * vcap;
      }
    }
  }
  return OK;
}

/** `CAPacLoad`: только мнимая часть (`omega*C`). */
export function DEVacLoad(inModel, ckt) {
  const val = ckt.CKTomega;
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const imag = val * here.CAPcapac;
      here.CAPposPosptr.imag += imag;
      here.CAPnegNegptr.imag += imag;
      here.CAPposNegptr.imag -= imag;
      here.CAPnegPosptr.imag -= imag;
    }
  }
  return OK;
}

/** `CAPtrunc`. */
export function DEVtrunc(inModel, ckt, timeState) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      cktTerr(here.CAPstate, ckt, timeState);
    }
  }
  return OK;
}

/** `CAPgetic`: взять начальное напряжение из RHS (UIC). */
export function DEVsetic(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.CAPicGiven) {
        here.CAPinitCond = ckt.CKTrhs[here.GENnode1] - ckt.CKTrhs[here.GENnode2];
      }
    }
  }
  return OK;
}

export const capacitor = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam,
  DEVmodParam,
  DEVsetup,
  DEVtemperature,
  DEVload,
  DEVacLoad,
  DEVtrunc,
  DEVsetic,
};
