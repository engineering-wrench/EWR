/**
 * inductor.js — индуктор (`Inductor`, index 9) и взаимная индуктивность
 * (`mutual`, index 10).
 *
 * Порт `vendor/spice3f4/src/lib/dev/ind/*.c`:
 *  - `INDsetup`/`INDunsetup` — ветвевое уравнение (`#branch`) и состояния;
 *  - `INDload` — DC-закоротка / интегрирование потока + штамповка `MUT`;
 *  - `INDacLoad` — `j*omega*L` в ветвевом уравнении;
 *  - `INDtrunc` — LTE через `CKTterr`;
 *  - `MUTsetup` — поиск связанных индукторов и `MUTfactor = k*sqrt(L1*L2)`;
 *  - `INDparam`/`MUTparam` — параметры.
 *
 * Отличие от C: при отсутствии связанного индуктора C печатает warning и
 * падает на NULL; здесь возвращается `E_NODEV` (безопаснее, квирк Q-D01).
 */

import {
  OK,
  E_NOMEM,
  E_BADPARM,
  E_NODEV,
  MODEDC,
  MODEINITPRED,
  MODEINITTRAN,
  MODEUIC,
  cktTerr,
  cktFindDev,
  cktDevIndex,
  cktDltNNum,
} from '../ckt.js';
import { SMPmakeElt } from '../sparse.js';
import { niIntegrate } from '../ni.js';
import { makeBranch } from './common.js';

/** Параметры индуктора (`inddefs.h`). */
export const IND_IND = 1;
export const IND_IC = 2;

/** Параметры mutual (`inddefs.h`). */
export const MUT_COEFF = 401;
export const MUT_IND1 = 402;
export const MUT_IND2 = 403;

export const IND_NUM_STATES = 2;

export function newIndModel(model) {
  model.INDmodType = model.GENmodType;
}

export function newIndInstance(inst) {
  inst.INDstate = 0;
  inst.INDbrEq = 0;
  inst.INDinduct = 0;
  inst.INDinitCond = 0;
  inst.INDindGiven = false;
  inst.INDicGiven = false;
  inst.INDsenParmNo = 0;
  inst.INDposIbrptr = null;
  inst.INDnegIbrptr = null;
  inst.INDibrNegptr = null;
  inst.INDibrPosptr = null;
  inst.INDibrIbrptr = null;
}

/** `INDparam`. */
export function INDparam(param, value, inst) {
  switch (param) {
    case IND_IND:
      inst.INDinduct = value;
      inst.INDindGiven = true;
      break;
    case IND_IC:
      inst.INDinitCond = value;
      inst.INDicGiven = true;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `INDsetup`. */
export function INDsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const error = makeBranch(ckt, here, 'INDbrEq');
      if (error) return error;
      const brEq = here.INDbrEq;

      here.INDposIbrptr = SMPmakeElt(matrix, here.GENnode1, brEq);
      here.INDnegIbrptr = SMPmakeElt(matrix, here.GENnode2, brEq);
      here.INDibrNegptr = SMPmakeElt(matrix, brEq, here.GENnode2);
      here.INDibrPosptr = SMPmakeElt(matrix, brEq, here.GENnode1);
      here.INDibrIbrptr = SMPmakeElt(matrix, brEq, brEq);
      if (
        !here.INDposIbrptr ||
        !here.INDnegIbrptr ||
        !here.INDibrNegptr ||
        !here.INDibrPosptr ||
        !here.INDibrIbrptr
      ) {
        return E_NOMEM;
      }

      here.INDstate = state.value;
      state.value += IND_NUM_STATES;
    }
  }
  return OK;
}

/** `INDunsetup`: удалить ветвевые уравнения (`CKTdltNNum`). */
export function INDunsetup(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.INDbrEq) {
        cktDltNNum(ckt, here.INDbrEq);
        here.INDbrEq = 0;
      }
    }
  }
  return OK;
}

/** `INDload` + `MUT`-часть. */
export function INDload(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  // 1) Поток по индукторам (до вклада взаимной индуктивности).
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!(ckt.CKTmode & (MODEDC | MODEINITPRED))) {
        if (ckt.CKTmode & MODEUIC && ckt.CKTmode & MODEINITTRAN) {
          s0[here.INDstate] = here.INDinduct * here.INDinitCond;
        } else {
          s0[here.INDstate] = here.INDinduct * ckt.CKTrhsOld[here.INDbrEq];
        }
      }
    }
  }

  // 2) Взаимная индуктивность: добавить потоки и перекрёстные элементы.
  const mutType = ckt.CKTtypelook ? ckt.CKTtypelook('mutual') : cktDevIndex('mutual');
  for (let mutmodel = ckt.CKThead[mutType]; mutmodel; mutmodel = mutmodel.GENnextModel) {
    for (let muthere = mutmodel.GENinstances; muthere; muthere = muthere.GENnextInstance) {
      if (!(ckt.CKTmode & (MODEDC | MODEINITPRED))) {
        s0[muthere.MUTind1.INDstate] +=
          muthere.MUTfactor * ckt.CKTrhsOld[muthere.MUTind2.INDbrEq];
        s0[muthere.MUTind2.INDstate] +=
          muthere.MUTfactor * ckt.CKTrhsOld[muthere.MUTind1.INDbrEq];
      }
      muthere.MUTbr1br2.real -= muthere.MUTfactor * ckt.CKTag[0];
      muthere.MUTbr2br1.real -= muthere.MUTfactor * ckt.CKTag[0];
    }
  }

  // 3) Интегрирование и штамповка индукторов.
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      let req;
      let veq;
      if (ckt.CKTmode & MODEDC) {
        req = 0;
        veq = 0;
      } else {
        if (ckt.CKTmode & MODEINITPRED) {
          s0[here.INDstate] = s1[here.INDstate];
        } else if (ckt.CKTmode & MODEINITTRAN) {
          s1[here.INDstate] = s0[here.INDstate];
        }
        const r = niIntegrate(ckt, here.INDinduct, here.INDstate);
        if (r.error) return r.error;
        req = r.geq;
        veq = r.ceq;
      }

      ckt.CKTrhs[here.INDbrEq] += veq;
      if (ckt.CKTmode & MODEINITTRAN) {
        s1[here.INDstate + 1] = s0[here.INDstate + 1];
      }
      here.INDposIbrptr.real += 1;
      here.INDnegIbrptr.real -= 1;
      here.INDibrPosptr.real += 1;
      here.INDibrNegptr.real -= 1;
      here.INDibrIbrptr.real -= req;
    }
  }
  return OK;
}

/** `INDacLoad`: вещественная часть ветви + мнимая `-omega*L`. */
export function INDacLoad(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const val = ckt.CKTomega * here.INDinduct;
      here.INDposIbrptr.real += 1;
      here.INDnegIbrptr.real -= 1;
      here.INDibrPosptr.real += 1;
      here.INDibrNegptr.real -= 1;
      here.INDibrIbrptr.imag -= val;
    }
  }
  return OK;
}

/** `INDtrunc`. */
export function INDtrunc(inModel, ckt, timeState) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      cktTerr(here.INDstate, ckt, timeState);
    }
  }
  return OK;
}

// ─────────────────────────── mutual ───────────────────────────

export function newMutModel(model) {
  model.MUTmodType = model.GENmodType;
}

export function newMutInstance(inst) {
  inst.MUTcoupling = 0;
  inst.MUTfactor = 0;
  inst.MUTindName1 = null;
  inst.MUTindName2 = null;
  inst.MUTind1 = null;
  inst.MUTind2 = null;
  inst.MUTbr1br2 = null;
  inst.MUTbr2br1 = null;
  inst.MUTindGiven = false;
  inst.MUTsenParmNo = 0;
}

/** `MUTparam`. */
export function MUTparam(param, value, inst) {
  switch (param) {
    case MUT_COEFF:
      inst.MUTcoupling = value;
      inst.MUTindGiven = true;
      break;
    case MUT_IND1:
      inst.MUTindName1 = value;
      break;
    case MUT_IND2:
      inst.MUTindName2 = value;
      break;
    default:
      return E_BADPARM;
  }
  return OK;
}

/** `MUTsetup`. */
export function MUTsetup(matrix, inModel, ckt) {
  const indType = cktDevIndex('Inductor');
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const found1 = cktFindDev(ckt, { type: indType, name: here.MUTindName1 });
      if (found1.error) {
        ckt.errMsg = `mutual ${here.GENname}: coupling to non-existant inductor ${here.MUTindName1}.`;
        return E_NODEV;
      }
      const found2 = cktFindDev(ckt, { type: indType, name: here.MUTindName2 });
      if (found2.error) {
        ckt.errMsg = `mutual ${here.GENname}: coupling to non-existant inductor ${here.MUTindName2}.`;
        return E_NODEV;
      }
      here.MUTind1 = found1.instance;
      here.MUTind2 = found2.instance;
      here.MUTfactor =
        here.MUTcoupling * Math.sqrt(here.MUTind1.INDinduct * here.MUTind2.INDinduct);

      here.MUTbr1br2 = SMPmakeElt(matrix, here.MUTind1.INDbrEq, here.MUTind2.INDbrEq);
      here.MUTbr2br1 = SMPmakeElt(matrix, here.MUTind2.INDbrEq, here.MUTind1.INDbrEq);
      if (!here.MUTbr1br2 || !here.MUTbr2br1) return E_NOMEM;
    }
  }
  return OK;
}

export const inductor = {
  DEVnewModel: newIndModel,
  DEVnewInstance: newIndInstance,
  DEVparam: INDparam,
  DEVsetup: INDsetup,
  DEVunsetup: INDunsetup,
  DEVload: INDload,
  DEVacLoad: INDacLoad,
  DEVtrunc: INDtrunc,
};

export const mutual = {
  DEVnewModel: newMutModel,
  DEVnewInstance: newMutInstance,
  DEVparam: MUTparam,
  DEVsetup: MUTsetup,
};
