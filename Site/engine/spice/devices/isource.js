/**
 * isource.js — независимый источник тока (`Isource`, index 11).
 *
 * Порт `vendor/spice3f4/src/lib/dev/isrc/*.c`.
 *
 * ВАЖНО (квирк SPICE3, Q-D02): в `isrcdefs.h` поля идут в порядке
 * `ISRCnegNode`, `ISRCposNode`, поэтому `CKTbindNode(term=1)` пишет в
 * `ISRCnegNode`, а term=2 — в `ISRCposNode`. Ток в `ISRCload` добавляется в
 * `ISRCposNode` (term 2) и вычитается из `ISRCnegNode` (term 1). Сохраняем
 * это как есть — иначе схема с источником тока развернётся относительно DLL.
 */

import {
  OK,
  E_BADPARM,
  MODEDC,
  MODEDCOP,
  MODEDCTRANCURVE,
  ERR_WARNING,
  cktError,
} from '../ckt.js';
import {
  PULSE,
  SINE,
  EXP,
  SFFM,
  PWL,
  sourceFunctionValue,
  sourceAccept,
} from './common.js';

/** Параметры инстанса (`isrcdefs.h`). */
export const ISRC_DC = 1;
export const ISRC_AC_MAG = 2;
export const ISRC_AC_PHASE = 3;
export const ISRC_AC = 4;
export const ISRC_PULSE = 5;
export const ISRC_SINE = 6;
export const ISRC_EXP = 7;
export const ISRC_PWL = 8;
export const ISRC_SFFM = 9;
export const ISRC_D_F1 = 18;
export const ISRC_D_F2 = 19;

export function newModel(model) {
  model.ISRCmodType = model.GENmodType;
}

export function newInstance(inst) {
  inst.ISRCstate = 0;
  inst.ISRCfunctionType = 0;
  inst.ISRCfunctionOrder = 0;
  inst.ISRCcoeffs = null;
  inst.ISRCdcValue = 0;
  inst.ISRCacPhase = 0;
  inst.ISRCacMag = 0;
  inst.ISRCacReal = 0;
  inst.ISRCacImag = 0;
  inst.ISRCdF1mag = 0;
  inst.ISRCdF2mag = 0;
  inst.ISRCdF1phase = 0;
  inst.ISRCdF2phase = 0;
  inst.ISRCdcGiven = false;
  inst.ISRCacGiven = false;
  inst.ISRCacMGiven = false;
  inst.ISRCacPGiven = false;
  inst.ISRCfuncTGiven = false;
  inst.ISRCcoeffsGiven = false;
  inst.ISRCdGiven = false;
  inst.ISRCdF1given = false;
  inst.ISRCdF2given = false;
  // Q-D02: PWL в ISRCload идёт на одну точку дальше, чем в VSRCload.
  inst.pwlInclusive = true;
}

/** Установить векторный параметр (pulse/sine/exp/pwl/sffm). */
function setVector(inst, type, value) {
  if (!Array.isArray(value) || value.length < 2) return E_BADPARM;
  inst.ISRCfunctionType = type;
  inst.ISRCfunctionOrder = value.length;
  inst.ISRCcoeffs = value.slice();
  inst.ISRCfuncTGiven = true;
  inst.ISRCcoeffsGiven = true;
  return OK;
}

/** `ISRCparam`. */
export function DEVparam(param, value, inst) {
  switch (param) {
    case ISRC_DC:
      inst.ISRCdcValue = value;
      inst.ISRCdcGiven = true;
      break;
    case ISRC_AC_MAG:
      inst.ISRCacMag = value;
      inst.ISRCacMGiven = true;
      inst.ISRCacGiven = true;
      break;
    case ISRC_AC_PHASE:
      inst.ISRCacPhase = value;
      inst.ISRCacPGiven = true;
      inst.ISRCacGiven = true;
      break;
    case ISRC_AC: {
      if (!Array.isArray(value)) return E_BADPARM;
      switch (value.length) {
        case 2:
          inst.ISRCacPhase = value[1];
          inst.ISRCacPGiven = true;
        // fallthrough
        case 1:
          inst.ISRCacMag = value[0];
          inst.ISRCacMGiven = true;
        // fallthrough
        case 0:
          inst.ISRCacGiven = true;
          break;
        default:
          return E_BADPARM;
      }
      break;
    }
    case ISRC_PULSE:
      return setVector(inst, PULSE, value);
    case ISRC_SINE:
      return setVector(inst, SINE, value);
    case ISRC_EXP:
      return setVector(inst, EXP, value);
    case ISRC_PWL:
      return setVector(inst, PWL, value);
    case ISRC_SFFM:
      return setVector(inst, SFFM, value);
    case ISRC_D_F1:
      if (!Array.isArray(value)) return E_BADPARM;
      inst.ISRCdF1given = true;
      inst.ISRCdGiven = true;
      if (value.length === 2) {
        inst.ISRCdF1phase = value[1];
        inst.ISRCdF1mag = value[0];
      } else if (value.length === 1) {
        inst.ISRCdF1mag = value[0];
        inst.ISRCdF1phase = 0;
      } else if (value.length === 0) {
        inst.ISRCdF1mag = 1;
        inst.ISRCdF1phase = 0;
      } else {
        return E_BADPARM;
      }
      break;
    case ISRC_D_F2:
      if (!Array.isArray(value)) return E_BADPARM;
      inst.ISRCdF2given = true;
      inst.ISRCdGiven = true;
      if (value.length === 2) {
        inst.ISRCdF2phase = value[1];
        inst.ISRCdF2mag = value[0];
      } else if (value.length === 1) {
        inst.ISRCdF2mag = value[0];
        inst.ISRCdF2phase = 0;
      } else if (value.length === 0) {
        inst.ISRCdF2mag = 1;
        inst.ISRCdF2phase = 0;
      } else {
        return E_BADPARM;
      }
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `ISRCtemp`: AC magnitude/phase → real/imag. */
export function DEVtemperature(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.ISRCacGiven && !here.ISRCacMGiven) here.ISRCacMag = 1;
      if (here.ISRCacGiven && !here.ISRCacPGiven) here.ISRCacPhase = 0;
      if (!here.ISRCdcGiven) {
        const message = here.ISRCfuncTGiven
          ? `${here.GENname}: no DC value, transient time 0 value used`
          : `${here.GENname}: has no value, DC 0 assumed`;
        if (ckt) cktError(ckt, ERR_WARNING, message);
      }
      const radians = (here.ISRCacPhase * Math.PI) / 180.0;
      here.ISRCacReal = here.ISRCacMag * Math.cos(radians);
      here.ISRCacImag = here.ISRCacMag * Math.sin(radians);
    }
  }
  return OK;
}

/** `ISRCload` (DC/TRAN). */
export function DEVload(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      let value;
      if (ckt.CKTmode & (MODEDCOP | MODEDCTRANCURVE) && here.ISRCdcGiven) {
        value = here.ISRCdcValue * ckt.CKTsrcFact;
      } else {
        const time = ckt.CKTmode & MODEDC ? 0 : ckt.CKTtime;
        if (here.ISRCfunctionType) {
          value = sourceFunctionValue(here, ckt, time);
        } else {
          value = here.ISRCdcValue * ckt.CKTsrcFact;
        }
      }
      const pos = here.GENnode2;
      const neg = here.GENnode1;
      ckt.CKTrhs[pos] += value;
      ckt.CKTrhs[neg] -= value;
    }
  }
  return OK;
}

/** `ISRCacLoad`. */
export function DEVacLoad(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const pos = here.GENnode2;
      const neg = here.GENnode1;
      ckt.CKTrhs[pos] += here.ISRCacReal;
      ckt.CKTrhs[neg] -= here.ISRCacReal;
      ckt.CKTirhs[pos] += here.ISRCacImag;
      ckt.CKTirhs[neg] -= here.ISRCacImag;
    }
  }
  return OK;
}

/** `ISRCaccept`: точки останова PULSE/PWL. */
export function DEVaccept(ckt, inModel) {
  return sourceAccept(inModel, ckt, 'ISRC');
}

export const isource = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam,
  DEVtemperature,
  DEVload,
  DEVacLoad,
  DEVaccept,
};
