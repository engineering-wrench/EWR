/**
 * switch.js — идеальные ключи SPICE3F4:
 *  - `Switch` (index 20) — ключ, управляемый напряжением (`vendor/.../sw`);
 *  - `CSwitch` (index 7) — ключ, управляемый током (`vendor/.../csw`).
 *
 * Порт `SWsetup`/`SWload`/`SWacLoad`/`SWmParam`/`SWparam` и
 * `CSWsetup`/`CSWload`/`CSWacLoad`/`CSWmParam`/`CSWparam`.
 *
 * Ключи хранят одно состояние (открыт/закрыт), которое переключается только
 * при выходе управляющей величины за порог ± гистерезис. В `MODEINITFLOAT`
 * изменение состояния поднимает `CKTnoncon`, заставляя NI сделать ещё одну
 * итерацию. CSwitch ищет ветвь управляющего источника через `CKTfndBranch`.
 */

import {
  OK,
  E_NOMEM,
  E_BADPARM,
  MODEINITFIX,
  MODEINITJCT,
  MODEINITSMSIG,
  MODEINITFLOAT,
  MODEINITTRAN,
  MODEINITPRED,
  cktFndBranch,
} from '../ckt.js';
import { SMPmakeElt } from '../sparse.js';

/** Одно состояние (`SW_NUM_STATES`/`CSW_NUM_STATES`). */
const NUM_STATES = 1;

/** Проводящие способности по умолчанию (Ron=1, Roff=1/gmin). */
const ON_CONDUCTANCE = 1.0;

// ─────────────────────────── Switch (V-управляемый) ───────────────────────────

/** Параметры инстанса (`swdefs.h`). */
export const SW_IC_ON = 1;
export const SW_IC_OFF = 2;

/** Параметры модели (`swdefs.h`). */
export const SW_MOD_SW = 101;
export const SW_MOD_RON = 102;
export const SW_MOD_ROFF = 103;
export const SW_MOD_VTH = 104;
export const SW_MOD_VHYS = 105;
export const SW_MOD_GON = 106;
export const SW_MOD_GOFF = 107;

export function SWnewModel(model) {
  model.SWmodType = model.GENmodType;
  model.SWonResistance = 0;
  model.SWoffResistance = 0;
  model.SWvThreshold = 0;
  model.SWvHysteresis = 0;
  model.SWonConduct = 0;
  model.SWoffConduct = 0;
  model.SWonGiven = false;
  model.SWoffGiven = false;
  model.SWthreshGiven = false;
  model.SWhystGiven = false;
}

export function SWnewInstance(inst) {
  inst.SWstate = 0;
  inst.SWzero_stateGiven = false;
  inst.SWcond = 0;
  inst.SWposPosptr = null;
  inst.SWposNegptr = null;
  inst.SWnegPosptr = null;
  inst.SWnegNegptr = null;
}

/** `SWparam`. */
export function SWparam(param, value, inst) {
  switch (param) {
    case SW_IC_ON:
      if (value) inst.SWzero_stateGiven = true;
      break;
    case SW_IC_OFF:
      if (value) inst.SWzero_stateGiven = false;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `SWmParam`. */
export function SWmodParam(param, value, model) {
  switch (param) {
    case SW_MOD_SW:
      break;
    case SW_MOD_RON:
      model.SWonResistance = value;
      model.SWonConduct = 1.0 / value;
      model.SWonGiven = true;
      break;
    case SW_MOD_ROFF:
      model.SWoffResistance = value;
      model.SWoffConduct = 1.0 / value;
      model.SWoffGiven = true;
      break;
    case SW_MOD_VTH:
      model.SWvThreshold = value;
      model.SWthreshGiven = true;
      break;
    case SW_MOD_VHYS:
      model.SWvHysteresis = value < 0 ? -value : value;
      model.SWhystGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `SWsetup`. */
export function SWsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.SWthreshGiven) model.SWvThreshold = 0;
    if (!model.SWhystGiven) model.SWvHysteresis = 0;
    if (!model.SWonGiven) {
      model.SWonConduct = ON_CONDUCTANCE;
      model.SWonResistance = 1.0 / model.SWonConduct;
    }
    if (!model.SWoffGiven) {
      model.SWoffConduct = ckt.CKTgmin;
      model.SWoffResistance = 1.0 / model.SWoffConduct;
    }

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.SWposPosptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode1);
      here.SWposNegptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode2);
      here.SWnegPosptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode1);
      here.SWnegNegptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode2);
      if (
        !here.SWposPosptr ||
        !here.SWposNegptr ||
        !here.SWnegPosptr ||
        !here.SWnegNegptr
      ) {
        return E_NOMEM;
      }

      here.SWstate = state.value;
      state.value += NUM_STATES;
    }
  }
  return OK;
}

/** `SWload`. */
export function SWload(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      let previous_state;
      let current_state;
      const mode = ckt.CKTmode;

      if (mode & (MODEINITFIX | MODEINITJCT)) {
        if (here.SWzero_stateGiven) {
          s0[here.SWstate] = 1.0;
          current_state = 1.0;
        } else {
          s0[here.SWstate] = 0.0;
          current_state = 0.0;
        }
      } else if (mode & MODEINITSMSIG) {
        previous_state = s0[here.SWstate];
        current_state = previous_state;
      } else if (mode & MODEINITFLOAT) {
        previous_state = s0[here.SWstate];
        const vCtrl = ckt.CKTrhsOld[here.GENnode3] - ckt.CKTrhsOld[here.GENnode4];
        if (vCtrl > model.SWvThreshold + model.SWvHysteresis) {
          s0[here.SWstate] = 1.0;
          current_state = 1.0;
        } else if (vCtrl < model.SWvThreshold - model.SWvHysteresis) {
          s0[here.SWstate] = 0.0;
          current_state = 0.0;
        } else {
          current_state = previous_state;
        }
        if (current_state !== previous_state) {
          ckt.CKTnoncon++;
          ckt.CKTtroubleElt = here;
        }
      } else if (mode & (MODEINITTRAN | MODEINITPRED)) {
        previous_state = s1[here.SWstate];
        const vCtrl = ckt.CKTrhsOld[here.GENnode3] - ckt.CKTrhsOld[here.GENnode4];
        if (vCtrl > model.SWvThreshold + model.SWvHysteresis) {
          current_state = 1.0;
        } else if (vCtrl < model.SWvThreshold - model.SWvHysteresis) {
          current_state = 0.0;
        } else {
          current_state = previous_state;
        }
        s0[here.SWstate] = current_state === 0 ? 0.0 : 1.0;
      }

      const gNow = current_state ? model.SWonConduct : model.SWoffConduct;
      here.SWcond = gNow;

      here.SWposPosptr.real += gNow;
      here.SWposNegptr.real -= gNow;
      here.SWnegPosptr.real -= gNow;
      here.SWnegNegptr.real += gNow;
    }
  }
  return OK;
}

/** `SWacLoad`: только «протаскивает» состояние из state0. */
export function SWacLoad(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const current_state = Math.trunc(s0[here.SWstate]);
      const gNow = current_state ? model.SWonConduct : model.SWoffConduct;
      here.SWposPosptr.real += gNow;
      here.SWposNegptr.real -= gNow;
      here.SWnegPosptr.real -= gNow;
      here.SWnegNegptr.real += gNow;
    }
  }
  return OK;
}

export const sw = {
  DEVnewModel: SWnewModel,
  DEVnewInstance: SWnewInstance,
  DEVparam: SWparam,
  DEVmodParam: SWmodParam,
  DEVsetup: SWsetup,
  DEVload: SWload,
  DEVacLoad: SWacLoad,
};

// ─────────────────────────── CSwitch (I-управляемый) ───────────────────────────

/** Параметры инстанса (`cswdefs.h`). */
export const CSW_CONTROL = 1;
export const CSW_IC_ON = 2;
export const CSW_IC_OFF = 3;

/** Параметры модели (`cswdefs.h`). */
export const CSW_CSW = 101;
export const CSW_RON = 102;
export const CSW_ROFF = 103;
export const CSW_ITH = 104;
export const CSW_IHYS = 105;

export function CSWnewModel(model) {
  model.CSWmodType = model.GENmodType;
  model.CSWonResistance = 0;
  model.CSWoffResistance = 0;
  model.CSWiThreshold = 0;
  model.CSWiHysteresis = 0;
  model.CSWonConduct = 0;
  model.CSWoffConduct = 0;
  model.CSWonGiven = false;
  model.CSWoffGiven = false;
  model.CSWthreshGiven = false;
  model.CSWhystGiven = false;
}

export function CSWnewInstance(inst) {
  inst.CSWstate = 0;
  inst.CSWcontBranch = 0;
  inst.CSWcontName = null;
  inst.CSWzero_stateGiven = false;
  inst.CSWcond = 0;
  inst.CSWposPosptr = null;
  inst.CSWposNegptr = null;
  inst.CSWnegPosptr = null;
  inst.CSWnegNegptr = null;
}

/** `CSWparam`. */
export function CSWparam(param, value, inst) {
  switch (param) {
    case CSW_CONTROL:
      inst.CSWcontName = value;
      break;
    case CSW_IC_ON:
      if (value) inst.CSWzero_stateGiven = true;
      break;
    case CSW_IC_OFF:
      if (value) inst.CSWzero_stateGiven = false;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `CSWmParam`. */
export function CSWmodParam(param, value, model) {
  switch (param) {
    case CSW_CSW:
      break;
    case CSW_RON:
      model.CSWonResistance = value;
      model.CSWonConduct = 1.0 / value;
      model.CSWonGiven = true;
      break;
    case CSW_ROFF:
      model.CSWoffResistance = value;
      model.CSWoffConduct = 1.0 / value;
      model.CSWoffGiven = true;
      break;
    case CSW_ITH:
      model.CSWiThreshold = value;
      model.CSWthreshGiven = true;
      break;
    case CSW_IHYS:
      model.CSWiHysteresis = Math.abs(value);
      model.CSWhystGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `CSWsetup`: плюс поиск ветви управляющего источника. */
export function CSWsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.CSWthreshGiven) model.CSWiThreshold = 0;
    if (!model.CSWhystGiven) model.CSWiHysteresis = 0;
    if (!model.CSWonGiven) {
      model.CSWonConduct = ON_CONDUCTANCE;
      model.CSWonResistance = 1.0 / model.CSWonConduct;
    }
    if (!model.CSWoffGiven) {
      model.CSWoffConduct = ckt.CKTgmin;
      model.CSWoffResistance = 1.0 / model.CSWoffConduct;
    }

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      here.CSWcontBranch = cktFndBranch(ckt, here.CSWcontName);
      if (here.CSWcontBranch === 0) {
        ckt.errMsg = `${here.GENname}: unknown controlling source ${here.CSWcontName}`;
        return E_BADPARM;
      }

      here.CSWposPosptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode1);
      here.CSWposNegptr = SMPmakeElt(matrix, here.GENnode1, here.GENnode2);
      here.CSWnegPosptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode1);
      here.CSWnegNegptr = SMPmakeElt(matrix, here.GENnode2, here.GENnode2);
      if (
        !here.CSWposPosptr ||
        !here.CSWposNegptr ||
        !here.CSWnegPosptr ||
        !here.CSWnegNegptr
      ) {
        return E_NOMEM;
      }

      here.CSWstate = state.value;
      state.value += NUM_STATES;
    }
  }
  return OK;
}

/** `CSWload`. */
export function CSWload(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      let previous_state;
      let current_state;
      const mode = ckt.CKTmode;

      if (mode & (MODEINITFIX | MODEINITJCT)) {
        if (here.CSWzero_stateGiven) {
          s0[here.CSWstate] = 1.0;
          current_state = 1.0;
        } else {
          s0[here.CSWstate] = 0.0;
          current_state = 0.0;
        }
      } else if (mode & MODEINITSMSIG) {
        previous_state = s0[here.CSWstate];
        current_state = previous_state;
      } else if (mode & MODEINITFLOAT) {
        previous_state = s0[here.CSWstate];
        const iCtrl = ckt.CKTrhsOld[here.CSWcontBranch];
        if (iCtrl > model.CSWiThreshold + model.CSWiHysteresis) {
          s0[here.CSWstate] = 1.0;
          current_state = 1.0;
        } else if (iCtrl < model.CSWiThreshold - model.CSWiHysteresis) {
          s0[here.CSWstate] = 0.0;
          current_state = 0.0;
        } else {
          current_state = previous_state;
        }
        if (current_state !== previous_state) {
          ckt.CKTnoncon++;
          ckt.CKTtroubleElt = here;
        }
      } else if (mode & (MODEINITTRAN | MODEINITPRED)) {
        previous_state = s1[here.CSWstate];
        const iCtrl = ckt.CKTrhsOld[here.CSWcontBranch];
        if (iCtrl > model.CSWiThreshold + model.CSWiHysteresis) {
          current_state = 1.0;
        } else if (iCtrl < model.CSWiThreshold - model.CSWiHysteresis) {
          current_state = 0.0;
        } else {
          current_state = previous_state;
        }
        s0[here.CSWstate] = current_state === 0 ? 0.0 : 1.0;
      }

      const gNow = current_state ? model.CSWonConduct : model.CSWoffConduct;
      here.CSWcond = gNow;

      here.CSWposPosptr.real += gNow;
      here.CSWposNegptr.real -= gNow;
      here.CSWnegPosptr.real -= gNow;
      here.CSWnegNegptr.real += gNow;
    }
  }
  return OK;
}

/** `CSWacLoad`. */
export function CSWacLoad(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const current_state = Math.trunc(s0[here.CSWstate]);
      const gNow = current_state ? model.CSWonConduct : model.CSWoffConduct;
      here.CSWposPosptr.real += gNow;
      here.CSWposNegptr.real -= gNow;
      here.CSWnegPosptr.real -= gNow;
      here.CSWnegNegptr.real += gNow;
    }
  }
  return OK;
}

export const csw = {
  DEVnewModel: CSWnewModel,
  DEVnewInstance: CSWnewInstance,
  DEVparam: CSWparam,
  DEVmodParam: CSWmodParam,
  DEVsetup: CSWsetup,
  DEVload: CSWload,
  DEVacLoad: CSWacLoad,
};
