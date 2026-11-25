/**
 * resistor.js — линейный резистор (`Resistor`, index 19).
 *
 * Порт `vendor/spice3f4/src/lib/dev/res/*.c`:
 *  - `RESsetup` — четыре элемента матрицы (pos/pos, neg/neg, pos/neg, neg/pos);
 *  - `REStemp` — температурные коэффициенты и проводимость `1/(R*factor)`;
 *  - `RESload`/`RESacLoad` — штамповка проводимости (в C acLoad = load);
 *  - `RESparam`/`RESmParam` — параметры инстанса/модели (id из каталога DLL).
 *
 * Sensitivity/noise/pz (`RESsAcLoad`, `RESnoise`, `RESpzLoad`) — фазы P3.
 */

import { OK, E_NOMEM, E_BADPARM } from '../ckt.js';
import { SMPmakeElt } from '../sparse.js';
import { CONSTCtoK } from './common.js';

/** Идентификаторы параметров инстанса (`resdefs.h`). */
export const RES_RESIST = 1;
export const RES_WIDTH = 2;
export const RES_LENGTH = 3;
export const RES_TEMP = 8;

/** Идентификаторы параметров модели (`resdefs.h`). */
export const RES_MOD_TC1 = 101;
export const RES_MOD_TC2 = 102;
export const RES_MOD_RSH = 103;
export const RES_MOD_DEFWIDTH = 104;
export const RES_MOD_NARROW = 105;
export const RES_MOD_R = 106;
export const RES_MOD_TNOM = 107;

/** Новая модель (zeroed-поля + Given-флаги как в C). */
export function newModel(model) {
  model.REStnom = 0;
  model.REStempCoeff1 = 0;
  model.REStempCoeff2 = 0;
  model.RESsheetRes = 0;
  model.RESdefWidth = 0;
  model.RESnarrow = 0;
  model.REStnomGiven = false;
  model.REStc1Given = false;
  model.REStc2Given = false;
  model.RESsheetResGiven = false;
  model.RESdefWidthGiven = false;
  model.RESnarrowGiven = false;
}

/** Новый инстанс. */
export function newInstance(inst) {
  inst.REStemp = 0;
  inst.RESconduct = 0;
  inst.RESresist = 0;
  inst.RESwidth = 0;
  inst.RESlength = 0;
  inst.RESresGiven = false;
  inst.RESwidthGiven = false;
  inst.RESlengthGiven = false;
  inst.REStempGiven = false;
  inst.RESsenParmNo = 0;
  inst.RESposPosptr = null;
  inst.RESnegNegptr = null;
  inst.RESposNegptr = null;
  inst.RESnegPosptr = null;
}

/** `RESparam`. */
export function DEVparam(param, value, inst) {
  switch (param) {
    case RES_TEMP:
      inst.REStemp = value + CONSTCtoK;
      inst.REStempGiven = true;
      break;
    case RES_RESIST:
      inst.RESresist = value;
      inst.RESresGiven = true;
      break;
    case RES_WIDTH:
      inst.RESwidth = value;
      inst.RESwidthGiven = true;
      break;
    case RES_LENGTH:
      inst.RESlength = value;
      inst.RESlengthGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `RESmParam`. */
export function DEVmodParam(param, value, model) {
  switch (param) {
    case RES_MOD_TNOM:
      model.REStnom = value + CONSTCtoK;
      model.REStnomGiven = true;
      break;
    case RES_MOD_TC1:
      model.REStempCoeff1 = value;
      model.REStc1Given = true;
      break;
    case RES_MOD_TC2:
      model.REStempCoeff2 = value;
      model.REStc2Given = true;
      break;
    case RES_MOD_RSH:
      model.RESsheetRes = value;
      model.RESsheetResGiven = true;
      break;
    case RES_MOD_DEFWIDTH:
      model.RESdefWidth = value;
      model.RESdefWidthGiven = true;
      break;
    case RES_MOD_NARROW:
      model.RESnarrow = value;
      model.RESnarrowGiven = true;
      break;
    case RES_MOD_R:
      // подтверждение, что это резистор — no-op
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `RESsetup`: разметить элементы матрицы. */
export function DEVsetup(matrix, inModel) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.RESposPosptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode1);
      here.RESnegNegptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode2);
      here.RESposNegptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode2);
      here.RESnegPosptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode1);
      if (
        !here.RESposPosptr ||
        !here.RESnegNegptr ||
        !here.RESposNegptr ||
        !here.RESnegPosptr
      ) {
        return E_NOMEM;
      }
    }
  }
  return OK;
}

/** `REStemp`: значения по умолчанию, `factor`, `RESconduct`. */
export function DEVtemperature(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.REStnomGiven) model.REStnom = ckt.CKTnomTemp;
    if (!model.RESsheetResGiven) model.RESsheetRes = 0;
    if (!model.RESdefWidthGiven) model.RESdefWidth = 10e-6;
    if (!model.REStc1Given) model.REStempCoeff1 = 0;
    if (!model.REStc2Given) model.REStempCoeff2 = 0;
    if (!model.RESnarrowGiven) model.RESnarrow = 0;

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.REStempGiven) here.REStemp = ckt.CKTtemp;
      if (!here.RESwidthGiven) here.RESwidth = model.RESdefWidth;
      if (!here.RESlengthGiven) here.RESlength = 0;
      if (!here.RESresGiven) {
        if (model.RESsheetResGiven && model.RESsheetRes !== 0 && here.RESlength !== 0) {
          here.RESresist =
            (model.RESsheetRes * (here.RESlength - model.RESnarrow)) /
            (here.RESwidth - model.RESnarrow);
        } else {
          // В C здесь ERR_WARNING «resistance=0, set to 1000».
          here.RESresist = 1000;
        }
      }

      const difference = here.REStemp - model.REStnom;
      const factor =
        1.0 +
        model.REStempCoeff1 * difference +
        model.REStempCoeff2 * difference * difference;
      here.RESconduct = 1.0 / (here.RESresist * factor);
    }
  }
  return OK;
}

/** `RESload` (он же `RESacLoad`). */
export function DEVload(inModel) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.RESposPosptr.real += here.RESconduct;
      here.RESnegNegptr.real += here.RESconduct;
      here.RESposNegptr.real -= here.RESconduct;
      here.RESnegPosptr.real -= here.RESconduct;
    }
  }
  return OK;
}

export const DEVacLoad = DEVload;

export const resistor = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam,
  DEVmodParam,
  DEVsetup,
  DEVtemperature,
  DEVload,
  DEVacLoad,
};
