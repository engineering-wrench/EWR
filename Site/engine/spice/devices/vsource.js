/**
 * vsource.js — независимый источник напряжения (`Vsource`, index 24).
 *
 * Порт `vendor/spice3f4/src/lib/dev/vsrc/*.c`:
 *  - `VSRCsetup`/`VSRCunsetup` — ветвевое уравнение и разметка матрицы;
 *  - `VSRCload` — DC/TRAN (PULSE/SINE/EXP/SFFM/PWL — P1.5);
 *  - `VSRCacLoad` — `acReal`/`acImag` в RHS ветви;
 *  - `VSRCtemp` — пересчёт AC magnitude/phase в real/imag;
 *  - `VSRCfindBr` — поиск ветви для CSwitch (`CKTfndBranch`);
 *  - `VSRCparam` — параметры источника.
 */

import {
  OK,
  E_NOMEM,
  E_BADPARM,
  MODEDC,
  MODEDCOP,
  MODEDCTRANCURVE,
  ERR_WARNING,
  cktDltNNum,
  cktError,
} from '../ckt.js';
import { SMPmakeElt } from '../sparse.js';
import {
  PULSE,
  SINE,
  EXP,
  SFFM,
  PWL,
  makeBranch,
  sourceFunctionValue,
  sourceAccept,
} from './common.js';

/** Параметры инстанса (`vsrcdefs.h`). */
export const VSRC_DC = 1;
export const VSRC_AC = 2;
export const VSRC_AC_MAG = 3;
export const VSRC_AC_PHASE = 4;
export const VSRC_PULSE = 5;
export const VSRC_SINE = 6;
export const VSRC_EXP = 7;
export const VSRC_PWL = 8;
export const VSRC_SFFM = 9;
export const VSRC_D_F1 = 20;
export const VSRC_D_F2 = 21;

export function newModel(model) {
  model.VSRCmodType = model.GENmodType;
}

export function newInstance(inst) {
  inst.VSRCstate = 0;
  inst.VSRCbranch = 0;
  inst.VSRCfunctionType = 0;
  inst.VSRCfunctionOrder = 0;
  inst.VSRCcoeffs = null;
  inst.VSRCdcValue = 0;
  inst.VSRCacPhase = 0;
  inst.VSRCacMag = 0;
  inst.VSRCacReal = 0;
  inst.VSRCacImag = 0;
  inst.VSRCdF1mag = 0;
  inst.VSRCdF2mag = 0;
  inst.VSRCdF1phase = 0;
  inst.VSRCdF2phase = 0;
  inst.VSRCdcGiven = false;
  inst.VSRCacGiven = false;
  inst.VSRCacMGiven = false;
  inst.VSRCacPGiven = false;
  inst.VSRCfuncTGiven = false;
  inst.VSRCcoeffsGiven = false;
  inst.VSRCdGiven = false;
  inst.VSRCdF1given = false;
  inst.VSRCdF2given = false;
  inst.VSRCposIbrptr = null;
  inst.VSRCnegIbrptr = null;
  inst.VSRCibrPosptr = null;
  inst.VSRCibrNegptr = null;
  inst.VSRCibrIbrptr = null;
}

/** Установить векторный параметр (pulse/sine/exp/pwl/sffm). */
function setVector(inst, type, value) {
  if (!Array.isArray(value) || value.length < 2) return E_BADPARM;
  inst.VSRCfunctionType = type;
  inst.VSRCfunctionOrder = value.length;
  inst.VSRCcoeffs = value.slice();
  inst.VSRCfuncTGiven = true;
  inst.VSRCcoeffsGiven = true;
  return OK;
}

/** `VSRCparam`. */
export function DEVparam(param, value, inst) {
  switch (param) {
    case VSRC_DC:
      inst.VSRCdcValue = value;
      inst.VSRCdcGiven = true;
      break;
    case VSRC_AC_MAG:
      inst.VSRCacMag = value;
      inst.VSRCacMGiven = true;
      inst.VSRCacGiven = true;
      break;
    case VSRC_AC_PHASE:
      inst.VSRCacPhase = value;
      inst.VSRCacPGiven = true;
      inst.VSRCacGiven = true;
      break;
    case VSRC_AC: {
      if (!Array.isArray(value)) return E_BADPARM;
      switch (value.length) {
        case 2:
          inst.VSRCacPhase = value[1];
          inst.VSRCacPGiven = true;
        // fallthrough как в C
        case 1:
          inst.VSRCacMag = value[0];
          inst.VSRCacMGiven = true;
        // fallthrough
        case 0:
          inst.VSRCacGiven = true;
          break;
        default:
          return E_BADPARM;
      }
      break;
    }
    case VSRC_PULSE:
      return setVector(inst, PULSE, value);
    case VSRC_SINE:
      return setVector(inst, SINE, value);
    case VSRC_EXP:
      return setVector(inst, EXP, value);
    case VSRC_PWL:
      return setVector(inst, PWL, value);
    case VSRC_SFFM:
      return setVector(inst, SFFM, value);
    case VSRC_D_F1: {
      if (!Array.isArray(value)) return E_BADPARM;
      inst.VSRCdF1given = true;
      inst.VSRCdGiven = true;
      if (value.length === 2) {
        inst.VSRCdF1phase = value[1];
        inst.VSRCdF1mag = value[0];
      } else if (value.length === 1) {
        inst.VSRCdF1mag = value[0];
        inst.VSRCdF1phase = 0;
      } else if (value.length === 0) {
        inst.VSRCdF1mag = 1;
        inst.VSRCdF1phase = 0;
      } else {
        return E_BADPARM;
      }
      // Квирк C: в vsrcpar.c case VSRC_D_F1 не имеет break и проваливается
      // в VSRC_D_F2. Воспроизводим (distortion — P3, на числа P1.4 не влияет).
      inst.VSRCdF2given = true;
      inst.VSRCdGiven = true;
      inst.VSRCdF2mag = 1;
      inst.VSRCdF2phase = 0;
      break;
    }
    case VSRC_D_F2:
      if (!Array.isArray(value)) return E_BADPARM;
      inst.VSRCdF2given = true;
      inst.VSRCdGiven = true;
      if (value.length === 2) {
        inst.VSRCdF2phase = value[1];
        inst.VSRCdF2mag = value[0];
      } else if (value.length === 1) {
        inst.VSRCdF2mag = value[0];
        inst.VSRCdF2phase = 0;
      } else if (value.length === 0) {
        inst.VSRCdF2mag = 1;
        inst.VSRCdF2phase = 0;
      } else {
        return E_BADPARM;
      }
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `VSRCsetup`. */
export function DEVsetup(matrix, inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const error = makeBranch(ckt, here, 'VSRCbranch');
      if (error) return error;

      here.VSRCposIbrptr = SMPmakeElt(matrix, here.GENnode1, here.VSRCbranch);
      here.VSRCnegIbrptr = SMPmakeElt(matrix, here.GENnode2, here.VSRCbranch);
      here.VSRCibrNegptr = SMPmakeElt(matrix, here.VSRCbranch, here.GENnode2);
      here.VSRCibrPosptr = SMPmakeElt(matrix, here.VSRCbranch, here.GENnode1);
      if (
        !here.VSRCposIbrptr ||
        !here.VSRCnegIbrptr ||
        !here.VSRCibrNegptr ||
        !here.VSRCibrPosptr
      ) {
        return E_NOMEM;
      }
    }
  }
  return OK;
}

/** `VSRCunsetup`: удалить ветвевые уравнения. */
export function DEVunsetup(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.VSRCbranch) {
        cktDltNNum(ckt, here.VSRCbranch);
        here.VSRCbranch = 0;
      }
    }
  }
  return OK;
}

/** `VSRCtemp`. */
export function DEVtemperature(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.VSRCacGiven && !here.VSRCacMGiven) here.VSRCacMag = 1;
      if (here.VSRCacGiven && !here.VSRCacPGiven) here.VSRCacPhase = 0;
      if (!here.VSRCdcGiven) {
        const message = here.VSRCfuncTGiven
          ? `${here.GENname}: no DC value, transient time 0 value used`
          : `${here.GENname}: has no value, DC 0 assumed`;
        if (ckt) cktError(ckt, ERR_WARNING, message);
      }
      const radians = (here.VSRCacPhase * Math.PI) / 180.0;
      here.VSRCacReal = here.VSRCacMag * Math.cos(radians);
      here.VSRCacImag = here.VSRCacMag * Math.sin(radians);
    }
  }
  return OK;
}

/** `VSRCload`. */
export function DEVload(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.VSRCposIbrptr.real += 1.0;
      here.VSRCnegIbrptr.real -= 1.0;
      here.VSRCibrPosptr.real += 1.0;
      here.VSRCibrNegptr.real -= 1.0;

      if (ckt.CKTmode & (MODEDCOP | MODEDCTRANCURVE) && here.VSRCdcGiven) {
        ckt.CKTrhs[here.VSRCbranch] += ckt.CKTsrcFact * here.VSRCdcValue;
      } else {
        const time = ckt.CKTmode & MODEDC ? 0 : ckt.CKTtime;
        ckt.CKTrhs[here.VSRCbranch] += sourceFunctionValue(here, ckt, time);
      }
    }
  }
  return OK;
}

/** `VSRCacLoad`. */
export function DEVacLoad(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.VSRCposIbrptr.real += 1.0;
      here.VSRCnegIbrptr.real -= 1.0;
      here.VSRCibrPosptr.real += 1.0;
      here.VSRCibrNegptr.real -= 1.0;
      ckt.CKTrhs[here.VSRCbranch] += here.VSRCacReal;
      ckt.CKTirhs[here.VSRCbranch] += here.VSRCacImag;
    }
  }
  return OK;
}

/** `VSRCaccept`: точки останова PULSE/PWL. */
export function DEVaccept(ckt, inModel) {
  return sourceAccept(inModel, ckt, 'VSRC');
}

/** `VSRCfindBr`. */
export function DEVfindBranch(ckt, inModel, name) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.GENname === name) {
        const error = makeBranch(ckt, here, 'VSRCbranch');
        if (error) return 0;
        return here.VSRCbranch;
      }
    }
  }
  return 0;
}

export const vsource = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam,
  DEVsetup,
  DEVunsetup,
  DEVtemperature,
  DEVload,
  DEVacLoad,
  DEVaccept,
  DEVfindBranch,
};
