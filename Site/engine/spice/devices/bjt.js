/**
 * bjt.js — биполярный транзистор SPICE3F4/XSPICE (`BJT`, index 1).
 *
 * Порт `vendor/xspice-1-0/src/sim/DEV/BJT/` (XSPICE-редакция; отличия от F4 —
 * только в noise/disto-хуках, которые здесь не портируются):
 *  - `BJTsetup` — defaults модели, внутренние узлы (base/emitter/collector
 *    resistance → prime-узлы), 21 состояние, элементы матрицы;
 *  - `BJTtemp` — температурная подстройка (tSatCur, tBetaF/R, leakage currents,
 *    junction caps/pots, tf1…tf5, tVcrit, …);
 *  - `BJTload` — Gummel-Poon DC/TRAN: vbe/vbc через `pnjlim`, малый сигнал
 *    (gpi/gmu/gm/go/gx), заряд переходов, интегрирование (`NIintegrate`),
 *    счётчик несходимости (`BJTconvTest`);
 *  - `BJTacLoad` — комплексная загрузка малого сигнала (из состояния DC-OP);
 *  - `BJTtrunc`, `BJTconvTest`, `BJTask` (`DEVask`/`DEVmAsk`), `BJTunsetup`.
 *
 * Не портировано: noise/disto/PZ/sensitivity (`BJTs*`) — фаза P3. `BJTgetic` в
 * этой сборке не вызывается.
 */

import {
  OK,
  E_BADPARM,
  E_NOMEM,
  ERR_WARNING,
  MODEAC,
  MODEINITFIX,
  MODEINITJCT,
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
import { pnjlim } from './diode.js';

/** `CONSTboltz` (`const.h`). */
const CONSTboltz = 1.3806226e-23;
/** `REFTEMP` (`const.h`). */
const REFTEMP = 300.15;
/** `CONSTroot2` (`SPIinit.c`). */
const CONSTroot2 = Math.sqrt(2);
/** `E_ASKPOWER` (`sperror.h`): `E_PRIVATE + 12`. */
const E_ASKPOWER_ID = 112;
/** `E_ASKCURRENT` (`sperror.h`): `E_PRIVATE + 11`. */
const E_ASKCURRENT_ID = 111;
/** `DOING_AC` (`tskdefs.h`). */
const DOING_AC = 4;
/** `DOING_DCOP` (`tskdefs.h`). */
const DOING_DCOP = 1;
/** `DOING_TRCV` (`tskdefs.h`). */
const DOING_TRCV = 2;
/** `DOING_TRAN` (`tskdefs.h`). */
const DOING_TRAN = 8;

// ─────────────────────────── СОСТОЯНИЯ И ПАРАМЕТРЫ ───────────────────────────

/**
 * Состояния BJT (`BJTdefs.h`): `vbe, vbc, cc, cb, gpi, gmu, gm, go, qbe, cqbe,
 * qbc, cqbc, qcs, cqcs, qbx, cqbx, gx, cexbc, geqcb, gccs, geqbx`.
 */
export const BJT_VBE = 0;
export const BJT_VBC = 1;
export const BJT_CC = 2;
export const BJT_CB = 3;
export const BJT_GPI = 4;
export const BJT_GMU = 5;
export const BJT_GM = 6;
export const BJT_GO = 7;
export const BJT_QBE = 8;
export const BJT_CQBE = 9;
export const BJT_QBC = 10;
export const BJT_CQBC = 11;
export const BJT_QCS = 12;
export const BJT_CQCS = 13;
export const BJT_QBX = 14;
export const BJT_CQBX = 15;
export const BJT_GX = 16;
export const BJT_CEXBC = 17;
export const BJT_GEQCB = 18;
export const BJT_GCCS = 19;
export const BJT_GEQBX = 20;
/** Число состояний BJT (`BJTdefs.h`: `BJTnumStates = 21`). */
export const BJT_NUM_STATES = 21;

/** Идентификаторы параметров инстанса (`BJTdefs.h`). */
export const BJT_AREA = 1;
export const BJT_IC = 2;
export const BJT_OFF = 3;
export const BJT_IC_VBE = 4;
export const BJT_IC_VCE = 5;
export const BJT_AREA_SENS = 6;
export const BJT_TEMP = 7;

/** Идентификаторы параметров модели (`BJTdefs.h`). */
export const BJT_MOD_NPN = 101;
export const BJT_MOD_PNP = 102;
export const BJT_MOD_IS = 103;
export const BJT_MOD_BF = 104;
export const BJT_MOD_NF = 105;
export const BJT_MOD_VAF = 106;
export const BJT_MOD_IKF = 107;
export const BJT_MOD_ISE = 108;
export const BJT_MOD_C2 = 109;
export const BJT_MOD_NE = 110;
export const BJT_MOD_BR = 111;
export const BJT_MOD_NR = 112;
export const BJT_MOD_VAR = 113;
export const BJT_MOD_IKR = 114;
export const BJT_MOD_ISC = 115;
export const BJT_MOD_C4 = 116;
export const BJT_MOD_NC = 117;
export const BJT_MOD_RB = 118;
export const BJT_MOD_IRB = 119;
export const BJT_MOD_RBM = 120;
export const BJT_MOD_RE = 121;
export const BJT_MOD_RC = 122;
export const BJT_MOD_CJE = 123;
export const BJT_MOD_VJE = 124;
export const BJT_MOD_MJE = 125;
export const BJT_MOD_TF = 126;
export const BJT_MOD_XTF = 127;
export const BJT_MOD_VTF = 128;
export const BJT_MOD_ITF = 129;
export const BJT_MOD_PTF = 130;
export const BJT_MOD_CJC = 131;
export const BJT_MOD_VJC = 132;
export const BJT_MOD_MJC = 133;
export const BJT_MOD_XCJC = 134;
export const BJT_MOD_TR = 135;
export const BJT_MOD_CJS = 136;
export const BJT_MOD_VJS = 137;
export const BJT_MOD_MJS = 138;
export const BJT_MOD_XTB = 139;
export const BJT_MOD_EG = 140;
export const BJT_MOD_XTI = 141;
export const BJT_MOD_FC = 142;
export const BJT_MOD_TNOM = 143;
export const BJT_MOD_AF = 144;
export const BJT_MOD_KF = 145;
export const BJT_MOD_INVEARLYF = 301;
export const BJT_MOD_INVEARLYR = 302;
export const BJT_MOD_INVROLLOFFF = 303;
export const BJT_MOD_INVROLLOFFR = 304;
export const BJT_MOD_COLCONDUCT = 305;
export const BJT_MOD_EMITTERCONDUCT = 306;
export const BJT_MOD_TRANSVBCFACT = 307;
export const BJT_MOD_EXCESSPHASEFACTOR = 308;

/** Вопросы инстанса (`BJT_QUEST_*`, индексы `BJT_QUEST_*`). */
export const BJT_QUEST_FT = 201;
export const BJT_QUEST_COLNODE = 202;
export const BJT_QUEST_BASENODE = 203;
export const BJT_QUEST_EMITNODE = 204;
export const BJT_QUEST_SUBSTNODE = 205;
export const BJT_QUEST_COLPRIMENODE = 206;
export const BJT_QUEST_BASEPRIMENODE = 207;
export const BJT_QUEST_EMITPRIMENODE = 208;
export const BJT_QUEST_VBE = 209;
export const BJT_QUEST_VBC = 210;
export const BJT_QUEST_CC = 211;
export const BJT_QUEST_CB = 212;
export const BJT_QUEST_GPI = 213;
export const BJT_QUEST_GMU = 214;
export const BJT_QUEST_GM = 215;
export const BJT_QUEST_GO = 216;
export const BJT_QUEST_QBE = 217;
export const BJT_QUEST_CQBE = 218;
export const BJT_QUEST_QBC = 219;
export const BJT_QUEST_CQBC = 220;
export const BJT_QUEST_QCS = 221;
export const BJT_QUEST_CQCS = 222;
export const BJT_QUEST_QBX = 223;
export const BJT_QUEST_CQBX = 224;
export const BJT_QUEST_GX = 225;
export const BJT_QUEST_CEXBC = 226;
export const BJT_QUEST_GEQCB = 227;
export const BJT_QUEST_GCCS = 228;
export const BJT_QUEST_GEQBX = 229;
export const BJT_QUEST_SENS_DC = 235;
export const BJT_QUEST_SENS_REAL = 230;
export const BJT_QUEST_SENS_IMAG = 231;
export const BJT_QUEST_SENS_MAG = 232;
export const BJT_QUEST_SENS_PH = 233;
export const BJT_QUEST_SENS_CPLX = 234;
export const BJT_QUEST_CE = 236;
export const BJT_QUEST_CS = 237;
export const BJT_QUEST_POWER = 238;

// ─────────────────────────── НОВАЯ МОДЕЛЬ / ИНСТАНС ───────────────────────────

/** Сброс полей модели BJT (аналог zeroed-MALLOC в C). */
export function newModel(model) {
  model.BJTmodType = 1;
  model.BJTnextModel = null;
  model.BJTinstances = null;
  model.BJTmodName = null;
  model.BJTtype = 1;
  model.BJTtnom = 0;
  model.BJTtnomGiven = false;
  model.BJTsatCur = 0;
  model.BJTsatCurGiven = false;
  model.BJTbetaF = 0;
  model.BJTbetaFGiven = false;
  model.BJTemissionCoeffF = 0;
  model.BJTemissionCoeffFGiven = false;
  model.BJTearlyVoltF = 0;
  model.BJTearlyVoltFGiven = false;
  model.BJTrollOffF = 0;
  model.BJTrollOffFGiven = false;
  model.BJTleakBEcurrent = 0;
  model.BJTleakBEcurrentGiven = false;
  model.BJTc2 = 0;
  model.BJTc2Given = false;
  model.BJTleakBEemissionCoeff = 0;
  model.BJTleakBEemissionCoeffGiven = false;
  model.BJTbetaR = 0;
  model.BJTbetaRGiven = false;
  model.BJTemissionCoeffR = 0;
  model.BJTemissionCoeffRGiven = false;
  model.BJTearlyVoltR = 0;
  model.BJTearlyVoltRGiven = false;
  model.BJTrollOffR = 0;
  model.BJTrollOffRGiven = false;
  model.BJTleakBCcurrent = 0;
  model.BJTleakBCcurrentGiven = false;
  model.BJTc4 = 0;
  model.BJTc4Given = false;
  model.BJTleakBCemissionCoeff = 0;
  model.BJTleakBCemissionCoeffGiven = false;
  model.BJTbaseResist = 0;
  model.BJTbaseResistGiven = false;
  model.BJTbaseCurrentHalfResist = 0;
  model.BJTbaseCurrentHalfResistGiven = false;
  model.BJTminBaseResist = 0;
  model.BJTminBaseResistGiven = false;
  model.BJTEMitterResist = 0;
  model.BJTEMitterResistGiven = false;
  model.BJTcollectorResist = 0;
  model.BJTcollectorResistGiven = false;
  model.BJTdepletionCapBE = 0;
  model.BJTdepletionCapBEGiven = false;
  model.BJTpotentialBE = 0;
  model.BJTpotentialBEGiven = false;
  model.BJTjunctionExpBE = 0;
  model.BJTjunctionExpBEGiven = false;
  model.BJTtransitTimeF = 0;
  model.BJTtransitTimeFGiven = false;
  model.BJTtransitTimeBiasCoeffF = 0;
  model.BJTtransitTimeBiasCoeffFGiven = false;
  model.BJTtransitTimeFVBC = 0;
  model.BJTtransitTimeFVBCGiven = false;
  model.BJTtransitTimeHighCurrentF = 0;
  model.BJTtransitTimeHighCurrentFGiven = false;
  model.BJTexcessPhase = 0;
  model.BJTexcessPhaseGiven = false;
  model.BJTdepletionCapBC = 0;
  model.BJTdepletionCapBCGiven = false;
  model.BJTpotentialBC = 0;
  model.BJTpotentialBCGiven = false;
  model.BJTjunctionExpBC = 0;
  model.BJTjunctionExpBCGiven = false;
  model.BJTbaseFractionBCcap = 0;
  model.BJTbaseFractionBCcapGiven = false;
  model.BJTtransitTimeR = 0;
  model.BJTtransitTimeRGiven = false;
  model.BJTcapCS = 0;
  model.BJTcapCSGiven = false;
  model.BJTpotentialSubstrate = 0;
  model.BJTpotentialSubstrateGiven = false;
  model.BJTexponentialSubstrate = 0;
  model.BJTexponentialSubstrateGiven = false;
  model.BJTbetaExp = 0;
  model.BJTbetaExpGiven = false;
  model.BJTenergyGap = 0;
  model.BJTenergyGapGiven = false;
  model.BJTtempExpIS = 0;
  model.BJTtempExpISGiven = false;
  model.BJTdepletionCapCoeff = 0;
  model.BJTdepletionCapCoeffGiven = false;
  model.BJTinvEarlyVoltF = 0;
  model.BJTinvEarlyVoltFGiven = false;
  model.BJTinvEarlyVoltR = 0;
  model.BJTinvEarlyVoltRGiven = false;
  model.BJTinvRollOffF = 0;
  model.BJTinvRollOffFGiven = false;
  model.BJTinvRollOffR = 0;
  model.BJTinvRollOffRGiven = false;
  model.BJTcollectorConduct = 0;
  model.BJTEMitterConduct = 0;
  model.BJTtransitTimeVBCFactor = 0;
  model.BJTexcessPhaseFactor = 0;
  model.BJTf2 = 0;
  model.BJTf3 = 0;
  model.BJTf6 = 0;
  model.BJTf7 = 0;
}

/** Новый инстанс BJT. */
export function newInstance(inst) {
  inst.BJTmodPtr = null;
  inst.BJTnextInstance = null;
  inst.BJTname = null;
  inst.BJTcolNode = 0;
  inst.BJTbaseNode = 0;
  inst.BJTemitNode = 0;
  inst.BJTsubstNode = 0;
  inst.BJTcolPrimeNode = 0;
  inst.BJTbasePrimeNode = 0;
  inst.BJTemitPrimeNode = 0;
  inst.BJTarea = 0;
  inst.BJTareaGiven = false;
  inst.BJTicVBE = 0;
  inst.BJTicVBEGiven = false;
  inst.BJTicVCE = 0;
  inst.BJTicVCEGiven = false;
  inst.BJTtemp = 0;
  inst.BJTtempGiven = false;
  inst.BJToff = 0;
  inst.BJTsatCur = 0;
  inst.BJTtBetaF = 0;
  inst.BJTtBetaR = 0;
  inst.BJTtBEleakCur = 0;
  inst.BJTtBCleakCur = 0;
  inst.BJTtBEcap = 0;
  inst.BJTtBEpot = 0;
  inst.BJTtBCcap = 0;
  inst.BJTtBCpot = 0;
  inst.BJTtDepCap = 0;
  inst.BJTtf1 = 0;
  inst.BJTtf4 = 0;
  inst.BJTtf5 = 0;
  inst.BJTtVcrit = 0;
  inst.BJTstate = 0;
  inst.BJTsenParmNo = 0;
  inst.BJTsenPertFlag = false;
  inst.BJTsenFields = [];
  inst.BJTcolColPrimePtr = null;
  inst.BJTbaseBasePrimePtr = null;
  inst.BJTemitEmitPrimePtr = null;
  inst.BJTcolPrimeColPtr = null;
  inst.BJTcolPrimeBasePrimePtr = null;
  inst.BJTcolPrimeEmitPrimePtr = null;
  inst.BJTbasePrimeBasePtr = null;
  inst.BJTbasePrimeColPrimePtr = null;
  inst.BJTbasePrimeEmitPtr = null;
  inst.BJTemitPrimeEmitPtr = null;
  inst.BJTemitPrimeColPrimePtr = null;
  inst.BJTemitPrimeBasePtr = null;
  inst.BJTcolColPtr = null;
  inst.BJTbaseBasePtr = null;
  inst.BJTemitEmitPtr = null;
  inst.BJTcolPrimeColPrimePtr = null;
  inst.BJTbasePrimeBasePrimePtr = null;
  inst.BJTemitPrimeEmitPrimePtr = null;
  inst.BJTsubstSubstPtr = null;
  inst.BJTcolPrimeSubstPtr = null;
  inst.BJTsubstColPrimePtr = null;
  inst.BJTbaseColPrimePtr = null;
  inst.BJTcolPrimeBasePtr = null;
}

// ─────────────────────────── ПАРАМЕТРЫ ───────────────────────────

/** `BJTparam` (`BJTparam.c`). */
export function BJTparam(param, value, inst) {
  switch (param) {
    case BJT_AREA:
      inst.BJTarea = value;
      inst.BJTareaGiven = true;
      return OK;
    case BJT_TEMP:
      inst.BJTtemp = value + 273.15;
      inst.BJTtempGiven = true;
      return OK;
    case BJT_OFF:
      inst.BJToff = value ? 1 : 0;
      return OK;
    case BJT_IC_VBE:
      inst.BJTicVBE = value;
      inst.BJTicVBEGiven = true;
      return OK;
    case BJT_IC_VCE:
      inst.BJTicVCE = value;
      inst.BJTicVCEGiven = true;
      return OK;
    case BJT_IC: {
      const vec = value?.vec;
      const n = value?.numValue;
      if (n === 2) {
        inst.BJTicVCE = vec.rVec[1];
        inst.BJTicVCEGiven = true;
      }
      if (n === 1 || n === 2) {
        inst.BJTicVBE = vec.rVec[0];
        inst.BJTicVBEGiven = true;
      }
      return n === 1 || n === 2 ? OK : E_BADPARM;
    }
    case BJT_AREA_SENS:
      inst.BJTsenParmNo = value;
      return OK;
    default:
      return E_BADPARM;
  }
}

/** `BJTmParam` (`BJTmParam.c`). */
export function BJTmParam(param, value, model) {
  switch (param) {
    case BJT_MOD_NPN:
      if (value) model.BJTtype = 1;
      return OK;
    case BJT_MOD_PNP:
      if (value) model.BJTtype = -1;
      return OK;
    case BJT_MOD_TNOM:
      model.BJTtnom = value + 273.15;
      model.BJTtnomGiven = true;
      return OK;
    case BJT_MOD_IS:
      model.BJTsatCur = value;
      model.BJTsatCurGiven = true;
      return OK;
    case BJT_MOD_BF:
      model.BJTbetaF = value;
      model.BJTbetaFGiven = true;
      return OK;
    case BJT_MOD_NF:
      model.BJTemissionCoeffF = value;
      model.BJTemissionCoeffFGiven = true;
      return OK;
    case BJT_MOD_VAF:
      model.BJTearlyVoltF = value;
      model.BJTearlyVoltFGiven = true;
      return OK;
    case BJT_MOD_IKF:
      model.BJTrollOffF = value;
      model.BJTrollOffFGiven = true;
      return OK;
    case BJT_MOD_ISE:
      model.BJTleakBEcurrent = value;
      model.BJTleakBEcurrentGiven = true;
      return OK;
    case BJT_MOD_C2:
      model.BJTc2 = value;
      model.BJTc2Given = true;
      return OK;
    case BJT_MOD_NE:
      model.BJTleakBEemissionCoeff = value;
      model.BJTleakBEemissionCoeffGiven = true;
      return OK;
    case BJT_MOD_BR:
      model.BJTbetaR = value;
      model.BJTbetaRGiven = true;
      return OK;
    case BJT_MOD_NR:
      model.BJTemissionCoeffR = value;
      model.BJTemissionCoeffRGiven = true;
      return OK;
    case BJT_MOD_VAR:
      model.BJTearlyVoltR = value;
      model.BJTearlyVoltRGiven = true;
      return OK;
    case BJT_MOD_IKR:
      model.BJTrollOffR = value;
      model.BJTrollOffRGiven = true;
      return OK;
    case BJT_MOD_ISC:
      model.BJTleakBCcurrent = value;
      model.BJTleakBCcurrentGiven = true;
      return OK;
    case BJT_MOD_C4:
      model.BJTc4 = value;
      model.BJTc4Given = true;
      return OK;
    case BJT_MOD_NC:
      model.BJTleakBCemissionCoeff = value;
      model.BJTleakBCemissionCoeffGiven = true;
      return OK;
    case BJT_MOD_RB:
      model.BJTbaseResist = value;
      model.BJTbaseResistGiven = true;
      return OK;
    case BJT_MOD_IRB:
      model.BJTbaseCurrentHalfResist = value;
      model.BJTbaseCurrentHalfResistGiven = true;
      return OK;
    case BJT_MOD_RBM:
      model.BJTminBaseResist = value;
      model.BJTminBaseResistGiven = true;
      return OK;
    case BJT_MOD_RE:
      model.BJTEMitterResist = value;
      model.BJTEMitterResistGiven = true;
      return OK;
    case BJT_MOD_RC:
      model.BJTcollectorResist = value;
      model.BJTcollectorResistGiven = true;
      return OK;
    case BJT_MOD_CJE:
      model.BJTdepletionCapBE = value;
      model.BJTdepletionCapBEGiven = true;
      return OK;
    case BJT_MOD_VJE:
      model.BJTpotentialBE = value;
      model.BJTpotentialBEGiven = true;
      return OK;
    case BJT_MOD_MJE:
      model.BJTjunctionExpBE = value;
      model.BJTjunctionExpBEGiven = true;
      return OK;
    case BJT_MOD_TF:
      model.BJTtransitTimeF = value;
      model.BJTtransitTimeFGiven = true;
      return OK;
    case BJT_MOD_XTF:
      model.BJTtransitTimeBiasCoeffF = value;
      model.BJTtransitTimeBiasCoeffFGiven = true;
      return OK;
    case BJT_MOD_VTF:
      model.BJTtransitTimeFVBC = value;
      model.BJTtransitTimeFVBCGiven = true;
      return OK;
    case BJT_MOD_ITF:
      model.BJTtransitTimeHighCurrentF = value;
      model.BJTtransitTimeHighCurrentFGiven = true;
      return OK;
    case BJT_MOD_PTF:
      model.BJTexcessPhase = value;
      model.BJTexcessPhaseGiven = true;
      return OK;
    case BJT_MOD_CJC:
      model.BJTdepletionCapBC = value;
      model.BJTdepletionCapBCGiven = true;
      return OK;
    case BJT_MOD_VJC:
      model.BJTpotentialBC = value;
      model.BJTpotentialBCGiven = true;
      return OK;
    case BJT_MOD_MJC:
      model.BJTjunctionExpBC = value;
      model.BJTjunctionExpBCGiven = true;
      return OK;
    case BJT_MOD_XCJC:
      model.BJTbaseFractionBCcap = value;
      model.BJTbaseFractionBCcapGiven = true;
      return OK;
    case BJT_MOD_TR:
      model.BJTtransitTimeR = value;
      model.BJTtransitTimeRGiven = true;
      return OK;
    case BJT_MOD_CJS:
      model.BJTcapCS = value;
      model.BJTcapCSGiven = true;
      return OK;
    case BJT_MOD_VJS:
      model.BJTpotentialSubstrate = value;
      model.BJTpotentialSubstrateGiven = true;
      return OK;
    case BJT_MOD_MJS:
      model.BJTexponentialSubstrate = value;
      model.BJTexponentialSubstrateGiven = true;
      return OK;
    case BJT_MOD_XTB:
      model.BJTbetaExp = value;
      model.BJTbetaExpGiven = true;
      return OK;
    case BJT_MOD_EG:
      model.BJTenergyGap = value;
      model.BJTenergyGapGiven = true;
      return OK;
    case BJT_MOD_XTI:
      model.BJTtempExpIS = value;
      model.BJTtempExpISGiven = true;
      return OK;
    case BJT_MOD_FC:
      model.BJTdepletionCapCoeff = value;
      model.BJTdepletionCapCoeffGiven = true;
      return OK;
    case BJT_MOD_INVEARLYF:
      model.BJTinvEarlyVoltF = value;
      model.BJTinvEarlyVoltFGiven = true;
      return OK;
    case BJT_MOD_INVEARLYR:
      model.BJTinvEarlyVoltR = value;
      model.BJTinvEarlyVoltRGiven = true;
      return OK;
    case BJT_MOD_INVROLLOFFF:
      model.BJTinvRollOffF = value;
      model.BJTinvRollOffFGiven = true;
      return OK;
    case BJT_MOD_INVROLLOFFR:
      model.BJTinvRollOffR = value;
      model.BJTinvRollOffRGiven = true;
      return OK;
    case BJT_MOD_COLCONDUCT:
      model.BJTcollectorConduct = value;
      return OK;
    case BJT_MOD_EMITTERCONDUCT:
      model.BJTEMitterConduct = value;
      return OK;
    case BJT_MOD_TRANSVBCFACT:
      model.BJTtransitTimeVBCFactor = value;
      return OK;
    case BJT_MOD_EXCESSPHASEFACTOR:
      model.BJTexcessPhaseFactor = value;
      return OK;
    default:
      return E_BADPARM;
  }
}

// ─────────────────────────── SETUP / TEMP / UNSETUP ───────────────────────────

/**
 * `BJTsetup` — defaults модели, внутренние узлы, состояния, элементы матрицы.
 * Порт `BJTsetup.c`.
 */
export function BJTsetup(matrix, inModel, ckt, state) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (model.BJTtype !== 1 && model.BJTtype !== -1) {
      model.BJTtype = 1;
    }
    if (!model.BJTsatCurGiven) model.BJTsatCur = 1e-16;
    if (!model.BJTbetaFGiven) model.BJTbetaF = 100;
    if (!model.BJTemissionCoeffFGiven) model.BJTemissionCoeffF = 1;
    if (!model.BJTleakBEemissionCoeffGiven) model.BJTleakBEemissionCoeff = 1.5;
    if (!model.BJTbetaRGiven) model.BJTbetaR = 1;
    if (!model.BJTemissionCoeffRGiven) model.BJTemissionCoeffR = 1;
    if (!model.BJTleakBCemissionCoeffGiven) model.BJTleakBCemissionCoeff = 2;
    if (!model.BJTbaseResistGiven) model.BJTbaseResist = 0;
    if (!model.BJTminBaseResistGiven) model.BJTminBaseResist = 0;
    if (!model.BJTEMitterResistGiven) model.BJTEMitterResist = 0;
    if (!model.BJTcollectorResistGiven) model.BJTcollectorResist = 0;
    if (!model.BJTdepletionCapBEGiven) model.BJTdepletionCapBE = 0;
    if (!model.BJTpotentialBEGiven) model.BJTpotentialBE = 0.75;
    if (!model.BJTjunctionExpBEGiven) model.BJTjunctionExpBE = 0.33;
    if (!model.BJTtransitTimeFGiven) model.BJTtransitTimeF = 0;
    if (!model.BJTtransitTimeBiasCoeffFGiven) model.BJTtransitTimeBiasCoeffF = 0;
    if (!model.BJTtransitTimeHighCurrentFGiven) model.BJTtransitTimeHighCurrentF = 0;
    if (!model.BJTexcessPhaseGiven) model.BJTexcessPhase = 0;
    if (!model.BJTdepletionCapBCGiven) model.BJTdepletionCapBC = 0;
    if (!model.BJTpotentialBCGiven) model.BJTpotentialBC = 0.75;
    if (!model.BJTjunctionExpBCGiven) model.BJTjunctionExpBC = 0.33;
    if (!model.BJTbaseFractionBCcapGiven) model.BJTbaseFractionBCcap = 1;
    if (!model.BJTtransitTimeRGiven) model.BJTtransitTimeR = 0;
    if (!model.BJTcapCSGiven) model.BJTcapCS = 0;
    if (!model.BJTpotentialSubstrateGiven) model.BJTpotentialSubstrate = 0.75;
    if (!model.BJTexponentialSubstrateGiven) model.BJTexponentialSubstrate = 0;
    if (!model.BJTbetaExpGiven) model.BJTbetaExp = 0;
    if (!model.BJTenergyGapGiven) model.BJTenergyGap = 1.11;
    if (!model.BJTtempExpISGiven) model.BJTtempExpIS = 3;
    if (!model.BJTdepletionCapCoeffGiven) model.BJTdepletionCapCoeff = 0.5;

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.BJTareaGiven) here.BJTarea = 1;

      if (model.BJTcollectorResist === 0) {
        here.BJTcolPrimeNode = here.BJTcolNode;
      } else if (here.BJTcolPrimeNode === 0) {
        const made = cktMkVolt(ckt, here.BJTname, 'collector');
        if (made.error) return made.error;
        here.BJTcolPrimeNode = made.node.number;
      }
      if (model.BJTbaseResist === 0) {
        here.BJTbasePrimeNode = here.BJTbaseNode;
      } else if (here.BJTbasePrimeNode === 0) {
        const made = cktMkVolt(ckt, here.BJTname, 'base');
        if (made.error) return made.error;
        here.BJTbasePrimeNode = made.node.number;
      }
      if (model.BJTEMitterResist === 0) {
        here.BJTemitPrimeNode = here.BJTemitNode;
      } else if (here.BJTemitPrimeNode === 0) {
        const made = cktMkVolt(ckt, here.BJTname, 'emitter');
        if (made.error) return made.error;
        here.BJTemitPrimeNode = made.node.number;
      }

      here.BJTstate = state.value;
      state.value += BJT_NUM_STATES;

      here.BJTcolColPrimePtr = SMPmakeElt(matrix, here.BJTcolNode, here.BJTcolPrimeNode);
      here.BJTbaseBasePrimePtr = SMPmakeElt(matrix, here.BJTbaseNode, here.BJTbasePrimeNode);
      here.BJTemitEmitPrimePtr = SMPmakeElt(matrix, here.BJTemitNode, here.BJTemitPrimeNode);
      here.BJTcolPrimeColPtr = SMPmakeElt(matrix, here.BJTcolPrimeNode, here.BJTcolNode);
      here.BJTcolPrimeBasePrimePtr = SMPmakeElt(
        matrix,
        here.BJTcolPrimeNode,
        here.BJTbasePrimeNode,
      );
      here.BJTcolPrimeEmitPrimePtr = SMPmakeElt(
        matrix,
        here.BJTcolPrimeNode,
        here.BJTemitPrimeNode,
      );
      here.BJTbasePrimeBasePtr = SMPmakeElt(matrix, here.BJTbasePrimeNode, here.BJTbaseNode);
      here.BJTbasePrimeColPrimePtr = SMPmakeElt(
        matrix,
        here.BJTbasePrimeNode,
        here.BJTcolPrimeNode,
      );
      here.BJTbasePrimeEmitPrimePtr = SMPmakeElt(
        matrix,
        here.BJTbasePrimeNode,
        here.BJTemitPrimeNode,
      );
      here.BJTemitPrimeEmitPtr = SMPmakeElt(matrix, here.BJTemitPrimeNode, here.BJTemitNode);
      here.BJTemitPrimeColPrimePtr = SMPmakeElt(
        matrix,
        here.BJTemitPrimeNode,
        here.BJTcolPrimeNode,
      );
      here.BJTemitPrimeBasePtr = SMPmakeElt(
        matrix,
        here.BJTemitPrimeNode,
        here.BJTbasePrimeNode,
      );
      here.BJTcolColPtr = SMPmakeElt(matrix, here.BJTcolNode, here.BJTcolNode);
      here.BJTbaseBasePtr = SMPmakeElt(matrix, here.BJTbaseNode, here.BJTbaseNode);
      here.BJTemitEmitPtr = SMPmakeElt(matrix, here.BJTemitNode, here.BJTemitNode);
      here.BJTcolPrimeColPrimePtr = SMPmakeElt(
        matrix,
        here.BJTcolPrimeNode,
        here.BJTcolPrimeNode,
      );
      here.BJTbasePrimeBasePrimePtr = SMPmakeElt(
        matrix,
        here.BJTbasePrimeNode,
        here.BJTbasePrimeNode,
      );
      here.BJTemitPrimeEmitPrimePtr = SMPmakeElt(
        matrix,
        here.BJTemitPrimeNode,
        here.BJTemitPrimeNode,
      );
      here.BJTsubstSubstPtr = SMPmakeElt(matrix, here.BJTsubstNode, here.BJTsubstNode);
      here.BJTcolPrimeSubstPtr = SMPmakeElt(matrix, here.BJTcolPrimeNode, here.BJTsubstNode);
      here.BJTsubstColPrimePtr = SMPmakeElt(matrix, here.BJTsubstNode, here.BJTcolPrimeNode);
      here.BJTbaseColPrimePtr = SMPmakeElt(matrix, here.BJTbaseNode, here.BJTcolPrimeNode);
      here.BJTcolPrimeBasePtr = SMPmakeElt(matrix, here.BJTcolPrimeNode, here.BJTbaseNode);

      if (
        !here.BJTcolColPrimePtr ||
        !here.BJTbaseBasePrimePtr ||
        !here.BJTemitEmitPrimePtr ||
        !here.BJTcolPrimeColPtr ||
        !here.BJTcolPrimeBasePrimePtr ||
        !here.BJTcolPrimeEmitPrimePtr ||
        !here.BJTbasePrimeBasePtr ||
        !here.BJTbasePrimeColPrimePtr ||
        !here.BJTbasePrimeEmitPrimePtr ||
        !here.BJTemitPrimeEmitPtr ||
        !here.BJTemitPrimeColPrimePtr ||
        !here.BJTemitPrimeBasePtr ||
        !here.BJTcolColPtr ||
        !here.BJTbaseBasePtr ||
        !here.BJTemitEmitPtr ||
        !here.BJTcolPrimeColPrimePtr ||
        !here.BJTbasePrimeBasePrimePtr ||
        !here.BJTemitPrimeEmitPrimePtr ||
        !here.BJTsubstSubstPtr ||
        !here.BJTcolPrimeSubstPtr ||
        !here.BJTsubstColPrimePtr ||
        !here.BJTbaseColPrimePtr ||
        !here.BJTcolPrimeBasePtr
      ) {
        return E_NOMEM;
      }
    }
  }
  return OK;
}

/** `BJTunsetup` — удалить внутренние (prime) узлы. */
export function BJTunsetup(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (here.BJTcolPrimeNode && here.BJTcolPrimeNode !== here.BJTcolNode) {
        cktDltNNum(ckt, here.BJTcolPrimeNode);
        here.BJTcolPrimeNode = 0;
      }
      if (here.BJTbasePrimeNode && here.BJTbasePrimeNode !== here.BJTbaseNode) {
        cktDltNNum(ckt, here.BJTbasePrimeNode);
        here.BJTbasePrimeNode = 0;
      }
      if (here.BJTemitPrimeNode && here.BJTemitPrimeNode !== here.BJTemitNode) {
        cktDltNNum(ckt, here.BJTemitPrimeNode);
        here.BJTemitPrimeNode = 0;
      }
    }
  }
  return OK;
}

// ─────────────────────────── ТЕМПЕРАТУРА ───────────────────────────

/**
 * `BJTtemp` — температурная подстройка параметров и вычисление малых сигналов.
 * Порт `BJTtemp.c`.
 */
export function BJTtemp(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    if (!model.BJTtnomGiven) model.BJTtnom = ckt.CKTnomTemp;
    const fact1 = model.BJTtnom / REFTEMP;

    if (!model.BJTleakBEcurrentGiven) {
      model.BJTleakBEcurrent = model.BJTc2 ? model.BJTc2 * model.BJTsatCur : 0;
    }
    if (!model.BJTleakBCcurrentGiven) {
      model.BJTleakBCcurrent = model.BJTc4 ? model.BJTc4 * model.BJTsatCur : 0;
    }
    if (!model.BJTleakBEemissionCoeffGiven) model.BJTleakBEemissionCoeff = 1.5;
    if (!model.BJTleakBCemissionCoeffGiven) model.BJTleakBCemissionCoeff = 2;
    if (!model.BJTminBaseResistGiven) model.BJTminBaseResist = model.BJTbaseResist;

    if (model.BJTearlyVoltFGiven && model.BJTearlyVoltF !== 0) {
      model.BJTinvEarlyVoltF = 1 / model.BJTearlyVoltF;
    } else {
      model.BJTinvEarlyVoltF = 0;
    }
    if (model.BJTrollOffFGiven && model.BJTrollOffF !== 0) {
      model.BJTinvRollOffF = 1 / model.BJTrollOffF;
    } else {
      model.BJTinvRollOffF = 0;
    }
    if (model.BJTearlyVoltRGiven && model.BJTearlyVoltR !== 0) {
      model.BJTinvEarlyVoltR = 1 / model.BJTearlyVoltR;
    } else {
      model.BJTinvEarlyVoltR = 0;
    }
    if (model.BJTrollOffRGiven && model.BJTrollOffR !== 0) {
      model.BJTinvRollOffR = 1 / model.BJTrollOffR;
    } else {
      model.BJTinvRollOffR = 0;
    }
    if (model.BJTcollectorResist && model.BJTcollectorResist !== 0) {
      model.BJTcollectorConduct = 1 / model.BJTcollectorResist;
    } else {
      model.BJTcollectorConduct = 0;
    }
    if (model.BJTEMitterResist && model.BJTEMitterResist !== 0) {
      model.BJTEMitterConduct = 1 / model.BJTEMitterResist;
    } else {
      model.BJTEMitterConduct = 0;
    }
    if (model.BJTtransitTimeFVBC && model.BJTtransitTimeFVBC !== 0) {
      model.BJTtransitTimeVBCFactor = 1 / (model.BJTtransitTimeFVBC * 1.44);
    } else {
      model.BJTtransitTimeVBCFactor = 0;
    }
    model.BJTexcessPhaseFactor = (model.BJTexcessPhase / (180 / Math.PI)) * model.BJTtransitTimeF;
    if (model.BJTdepletionCapCoeffGiven) {
      if (model.BJTdepletionCapCoeff > 0.9999) {
        model.BJTdepletionCapCoeff = 0.9999;
        cktError(
          ckt,
          ERR_WARNING,
          `BJT model ${model.BJTmodName}: fc limited to 0.9999`,
        );
      }
    } else {
      model.BJTdepletionCapCoeff = 0.5;
    }
    const xfc = Math.log(1 - model.BJTdepletionCapCoeff);
    model.BJTf2 = Math.exp((1 + model.BJTjunctionExpBE) * xfc);
    model.BJTf3 = 1 - model.BJTdepletionCapCoeff * (1 + model.BJTjunctionExpBE);
    model.BJTf6 = Math.exp((1 + model.BJTjunctionExpBC) * xfc);
    model.BJTf7 = 1 - model.BJTdepletionCapCoeff * (1 + model.BJTjunctionExpBC);

    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      if (!here.BJTtempGiven) here.BJTtemp = ckt.CKTtemp;
      const vt = here.BJTtemp * CONSTKoverQ;
      const fact2 = here.BJTtemp / REFTEMP;
      const egfet = 1.16 - (7.02e-4 * here.BJTtemp * here.BJTtemp) / (here.BJTtemp + 1108);
      const arg = -egfet / (2 * CONSTboltz * here.BJTtemp) + 1.1150877 / (CONSTboltz * (REFTEMP + REFTEMP));
      const pbfact = -2 * vt * (1.5 * Math.log(fact2) + 1.6021918e-19 * arg);

      const ratlog = Math.log(here.BJTtemp / model.BJTtnom);
      const ratio1 = here.BJTtemp / model.BJTtnom - 1;
      const factlog = ratio1 * model.BJTenergyGap / vt + model.BJTtempExpIS * ratlog;
      const factor = Math.exp(factlog);
      here.BJTsatCur = model.BJTsatCur * factor;
      const bfactor = Math.exp(ratlog * model.BJTbetaExp);
      here.BJTtBetaF = model.BJTbetaF * bfactor;
      here.BJTtBetaR = model.BJTbetaR * bfactor;
      here.BJTtBEleakCur = model.BJTleakBEcurrent * Math.exp(factlog / model.BJTleakBEemissionCoeff) / bfactor;
      here.BJTtBCleakCur = model.BJTleakBCcurrent * Math.exp(factlog / model.BJTleakBCemissionCoeff) / bfactor;

      const pbo = (model.BJTpotentialBE - pbfact) / fact1;
      const gmaold = (model.BJTpotentialBE - pbo) / pbo;
      here.BJTtBEcap = model.BJTdepletionCapBE / (1 + model.BJTjunctionExpBE * (4e-4 * (model.BJTtnom - REFTEMP) - gmaold));
      here.BJTtBEpot = fact2 * pbo + pbfact;
      let gmanew = (here.BJTtBEpot - pbo) / pbo;
      here.BJTtBEcap *= 1 + model.BJTjunctionExpBE * (4e-4 * (here.BJTtemp - REFTEMP) - gmanew);

      const pboR = (model.BJTpotentialBC - pbfact) / fact1;
      const gmaoldR = (model.BJTpotentialBC - pboR) / pboR;
      here.BJTtBCcap = model.BJTdepletionCapBC / (1 + model.BJTjunctionExpBC * (4e-4 * (model.BJTtnom - REFTEMP) - gmaoldR));
      here.BJTtBCpot = fact2 * pboR + pbfact;
      gmanew = (here.BJTtBCpot - pboR) / pboR;
      here.BJTtBCcap *= 1 + model.BJTjunctionExpBC * (4e-4 * (here.BJTtemp - REFTEMP) - gmanew);

      here.BJTtDepCap = model.BJTdepletionCapCoeff * here.BJTtBEpot;
      here.BJTtf1 = here.BJTtBEpot * (1 - Math.exp((1 - model.BJTjunctionExpBE) * xfc)) / (1 - model.BJTjunctionExpBE);
      here.BJTtf4 = model.BJTdepletionCapCoeff * here.BJTtBCpot;
      here.BJTtf5 = here.BJTtBCpot * (1 - Math.exp((1 - model.BJTjunctionExpBC) * xfc)) / (1 - model.BJTjunctionExpBC);
      here.BJTtVcrit = vt * Math.log(vt / (CONSTroot2 * model.BJTsatCur));
    }
  }
  return OK;
}

// ─────────────────────────── ЗАГРУЗКА ───────────────────────────

/**
 * `BJTload` — Gummel-Poon DC/TRAN-загрузка (порт `BJTload.c`).
 * Возвращает код ошибки; `ckt.CKTtroubleElt` — последний элемент, вызвавший
 * `CKTnoncon`.
 */
export function BJTload(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];
  const s2 = ckt.CKTstates[2];

  for (let model = inModel; model; model = model.GENnextModel) {
    const BJTtype = model.BJTtype;
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const vt = here.BJTtemp * CONSTKoverQ;

      let gccs = 0;
      let ceqcs = 0;
      let geqbx = 0;
      let ceqbx = 0;
      let geqcb = 0;
      const csat = here.BJTsatCur * here.BJTarea;
      const rbpr = model.BJTminBaseResist / here.BJTarea;
      const rbpi = model.BJTbaseResist / here.BJTarea - rbpr;
      const gcpr = model.BJTcollectorConduct * here.BJTarea;
      const gepr = model.BJTEMitterConduct * here.BJTarea;
      const oik = model.BJTinvRollOffF / here.BJTarea;
      const c2 = here.BJTtBEleakCur * here.BJTarea;
      const vte = model.BJTleakBEemissionCoeff * vt;
      const oikr = model.BJTinvRollOffR / here.BJTarea;
      const c4 = here.BJTtBCleakCur * here.BJTarea;
      const vtc = model.BJTleakBCemissionCoeff * vt;
      const td = model.BJTexcessPhaseFactor;
      const xjrb = model.BJTbaseCurrentHalfResist * here.BJTarea;

      let vbe;
      let vbc;
      let vce;
      let vbx;
      let vcs;
      let cchat;
      let cbhat;
      let cc;
      let cb;
      let cbe;
      let gbe;
      let cben;
      let gben;
      let cbc;
      let gbc;
      let cbcn;
      let gbcn;
      let cex;
      let gex;
      let q1;
      let q2;
      let qb;
      let dqbdve;
      let dqbdvc;
      let evbe;
      let evbc;
      let evben;
      let evbcn;
      let arg;
      let sqarg;
      let arg1;
      let arg2;
      let arg3;
      let denom;
      let ichk1 = 1;
      let icheck = 1;
      let err = OK;

      // ── инициализация ──
      if (ckt.CKTmode & MODEINITSMSIG) {
        vbe = s0[here.BJTstate + BJT_VBE];
        vbc = s0[here.BJTstate + BJT_VBC];
        vbx = BJTtype * (ckt.CKTrhsOld[here.BJTbaseNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
        vcs = BJTtype * (ckt.CKTrhsOld[here.BJTsubstNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
      } else if (ckt.CKTmode & MODEINITTRAN) {
        vbe = s1[here.BJTstate + BJT_VBE];
        vbc = s1[here.BJTstate + BJT_VBC];
        vbx = BJTtype * (ckt.CKTrhsOld[here.BJTbaseNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
        vcs = BJTtype * (ckt.CKTrhsOld[here.BJTsubstNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
        if ((ckt.CKTmode & MODETRAN) && (ckt.CKTmode & MODEUIC)) {
          vbx = BJTtype * (here.BJTicVBE - here.BJTicVCE);
          vcs = 0;
        }
      } else if ((ckt.CKTmode & MODEINITJCT) && (ckt.CKTmode & MODETRANOP) && (ckt.CKTmode & MODEUIC)) {
        vbe = BJTtype * here.BJTicVBE;
        vce = BJTtype * here.BJTicVCE;
        vbc = vbe - vce;
        vbx = vbc;
        vcs = 0;
      } else if ((ckt.CKTmode & MODEINITJCT) && here.BJToff === 0) {
        vbe = here.BJTTcrit;
        vbc = 0;
        vcs = 0;
        vbx = 0;
      } else if (ckt.CKTmode & MODEINITJCT || ((ckt.CKTmode & MODEINITFIX) && here.BJToff !== 0)) {
        vbe = 0;
        vbc = 0;
        vcs = 0;
        vbx = 0;
      } else {
        vbe = BJTtype * (ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTemitPrimeNode]);
        vbc = BJTtype * (ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
      }

      const delvbe = vbe - s0[here.BJTstate + BJT_VBE];
      const delvbc = vbc - s0[here.BJTstate + BJT_VBC];
      vbx = BJTtype * (ckt.CKTrhsOld[here.BJTbaseNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
      vcs = BJTtype * (ckt.CKTrhsOld[here.BJTsubstNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
      cchat = s0[here.BJTstate + BJT_CC] + (s0[here.BJTstate + BJT_GM] + s0[here.BJTstate + BJT_GO]) * delvbe - (s0[here.BJTstate + BJT_GO] + s0[here.BJTstate + BJT_GMU]) * delvbc;
      cbhat = s0[here.BJTstate + BJT_CB] + s0[here.BJTstate + BJT_GPI] * delvbe + s0[here.BJTstate + BJT_GMU] * delvbc;

      // ── ограничение напряжения перехода ──
      const pl1 = pnjlim(vbe, s0[here.BJTstate + BJT_VBE], vt, here.BJTTcrit);
      vbe = pl1.vnew;
      icheck = pl1.icheck;
      const pl2 = pnjlim(vbc, s0[here.BJTstate + BJT_VBC], vt, here.BJTTcrit);
      vbc = pl2.vnew;
      if (pl2.icheck === 1) icheck = 1;
      // ── токи и проводимости ──
      const vtn = vt * model.BJTemissionCoeffF;
      if (vbe > -5 * vtn) {
        const evbe = Math.exp(vbe / vtn);
        cbe = csat * (evbe - 1) + ckt.CKTgmin * vbe;
        gbe = (csat * evbe) / vtn + ckt.CKTgmin;
        if (c2 === 0) {
          cben = 0;
          gben = 0;
        } else {
          const evben = Math.exp(vbe / vte);
          cben = c2 * (evben - 1);
          gben = (c2 * evben) / vte;
        }
      } else {
        gbe = -csat / vbe + ckt.CKTgmin;
        cbe = gbe * vbe;
        gben = -c2 / vbe;
        cben = gben * vbe;
      }
      const vtnR = vt * model.BJTemissionCoeffR;
      if (vbc > -5 * vtnR) {
        const evbc = Math.exp(vbc / vtnR);
        cbc = csat * (evbc - 1) + ckt.CKTgmin * vbc;
        gbc = (csat * evbc) / vtnR + ckt.CKTgmin;
        if (c4 === 0) {
          cbcn = 0;
          gbcn = 0;
        } else {
          const evbcn = Math.exp(vbc / vtc);
          cbcn = c4 * (evbcn - 1);
          gbcn = (c4 * evbcn) / vtc;
        }
      } else {
        gbc = -csat / vbc + ckt.CKTgmin;
        cbc = gbc * vbc;
        gbcn = -c4 / vbc;
        cbcn = gbcn * vbc;
      }

      // ── заряд переходов ──
      cc = 0;
      cex = cbe;
      gex = gbe;
      if ((ckt.CKTmode & (MODETRAN | MODEAC)) && td !== 0) {
        const arg1t = ckt.CKTdelta / td;
        const arg2t = 3 * arg1t;
        const arg1 = arg2t * arg1t;
        const denomT = 1 + arg1 + arg2t;
        const arg3 = arg1 / denomT;
        if (ckt.CKTmode & MODEINITTRAN) {
          s1[here.BJTstate + BJT_CEXBC] = cbe / qb;
          s2[here.BJTstate + BJT_CEXBC] = s1[here.BJTstate + BJT_CEXBC];
        }
        cc = (s1[here.BJTstate + BJT_CEXBC] * (1 + ckt.CKTdelta / ckt.CKTdeltaOld[1] + arg2t) - s2[here.BJTstate + BJT_CEXBC] * ckt.CKTdelta / ckt.CKTdeltaOld[1]) / denomT;
        cex = cbe * arg3;
        gex = gbe * arg3;
        s0[here.BJTstate + BJT_CEXBC] = cc + cex / qb;
      }

      // ── определяем dc incremental conductances ──
      cc = cc + (cex - cbc) / qb - cbc / here.BJTtBetaR - cbcn;
      cb = cbe / here.BJTtBetaF + cben + cbc / here.BJTtBetaR + cbcn;
      let gx = rbpr + rbpi / qb;
      if (xjrb !== 0) {
        const arg1x = Math.max(cb / xjrb, 1e-9);
        const arg2x = (-1 + Math.sqrt(1 + 14.59025 * arg1x)) / (2.4317 * Math.sqrt(arg1x));
        const arg1tx = Math.tan(arg2x);
        gx = rbpr + 3 * rbpi * (arg1tx - arg2x) / (arg2x * arg1tx * arg1tx);
      }
      if (gx !== 0) gx = 1 / gx;
      const gpi = gbe / here.BJTtBetaF + gben;
      const gmu = gbc / here.BJTtBetaR + gbcn;
      const go = (gbc + (cex - cbc) * dqbdvc / qb) / qb;
      const gm = (gex - (cex - cbc) * dqbdve / qb) / qb - go;

      if ((ckt.CKTmode & (MODETRAN | MODEAC)) || ((ckt.CKTmode & MODETRANOP) && (ckt.CKTmode & MODEUIC))) {
        // ── charge storage elements ──
        const tf = model.BJTtransitTimeF;
        const tr = model.BJTtransitTimeR;
        const czbe = here.BJTtBEcap * here.BJTarea;
        const pe = here.BJTtBEpot;
        const xme = model.BJTjunctionExpBE;
        const cdis = model.BJTbaseFractionBCcap;
        const ctot = here.BJTtBCcap * here.BJTarea;
        const czbc = ctot * cdis;
        const czbx = ctot - czbc;
        const pc = here.BJTtBCpot;
        const xmc = model.BJTjunctionExpBC;
        const fcpe = here.BJTtDepCap;
        const czcs = model.BJTcapCS * here.BJTarea;
        const ps = model.BJTpotentialSubstrate;
        const xms = model.BJTexponentialSubstrate;
        const xtf = model.BJTtransitTimeBiasCoeffF;
        const ovtf = model.BJTtransitTimeVBCFactor;
        const xjtf = model.BJTtransitTimeHighCurrentF * here.BJTarea;
        if (tf !== 0 && vbe > 0) {
          let argtf = 0;
          let arg2f = 0;
          let arg3f = 0;
          if (xtf !== 0) {
            argtf = xtf;
            if (ovtf !== 0) {
              argtf = argtf * Math.exp(vbc * ovtf);
            }
            arg2f = argtf;
            if (xjtf !== 0) {
              const temp = cbe / (cbe + xjtf);
              argtf = argtf * temp * temp;
              arg2f = argtf * (3 - temp - temp);
            }
            arg3f = cbe * argtf * ovtf;
          }
          cbe = cbe * (1 + argtf) / qb;
          gbe = (gbe * (1 + arg2f) - cbe * dqbdve) / qb;
          geqcb = (tf * (arg3f - cbe * dqbdvc) / qb);
        }
        let capbe;
        if (vbe < fcpe) {
          const argq = 1 - vbe / pe;
          const sargq = Math.exp(-xme * Math.log(argq));
          s0[here.BJTstate + BJT_QBE] = tf * cbe + pe * czbe * (1 - argq * sargq) / (1 - xme);
          capbe = tf * gbe + czbe * sargq;
        } else {
          const f1 = here.BJTtf1;
          const f2 = model.BJTf2;
          const f3 = model.BJTf3;
          const czbef2 = czbe / f2;
          s0[here.BJTstate + BJT_QBE] = tf * cbe + czbe * f1 + czbef2 * (f3 * (vbe - fcpe) + (xme / (pe + pe)) * (vbe * vbe - fcpe * fcpe));
          capbe = tf * gbe + czbef2 * (f3 + xme * vbe / pe);
        }
        const fcpc = here.BJTtf4;
        const f1r = here.BJTtf5;
        const f2r = model.BJTf6;
        const f3r = model.BJTf7;
        let capbc;
        if (vbc < fcpc) {
          const argq = 1 - vbc / pc;
          const sargq = Math.exp(-xmc * Math.log(argq));
          s0[here.BJTstate + BJT_QBC] = tr * cbc + pc * czbc * (1 - argq * sargq) / (1 - xmc);
          capbc = tr * gbc + czbc * sargq;
        } else {
          const czbcf2 = czbc / f2r;
          s0[here.BJTstate + BJT_QBC] = tr * cbc + czbc * f1r + czbcf2 * (f3r * (vbc - fcpc) + (xmc / (pc + pc)) * (vbc * vbc - fcpc * fcpc));
          capbc = tr * gbc + czbcf2 * (f3r + xmc * vbc / pc);
        }
        let capbx;
        if (vbx < fcpc) {
          const argq = 1 - vbx / pc;
          const sargq = Math.exp(-xmc * Math.log(argq));
          s0[here.BJTstate + BJT_QBX] = pc * czbx * (1 - argq * sargq) / (1 - xmc);
          capbx = czbx * sargq;
        } else {
          const czbxf2 = czbx / f2r;
          s0[here.BJTstate + BJT_QBX] = czbx * f1r + czbxf2 * (f3r * (vbx - fcpc) + (xmc / (pc + pc)) * (vbx * vbx - fcpc * fcpc));
          capbx = czbxf2 * (f3r + xmc * vbx / pc);
        }
        let capcs;
        if (vcs < 0) {
          const argq = 1 - vcs / ps;
          const sargq = Math.exp(-xms * Math.log(argq));
          s0[here.BJTstate + BJT_QCS] = ps * czcs * (1 - argq * sargq) / (1 - xms);
          capcs = czcs * sargq;
        } else {
          s0[here.BJTstate + BJT_QCS] = vcs * czcs * (1 + xms * vcs / (2 * ps));
          capcs = czcs * (1 + xms * vcs / ps);
        }

        if (!(ckt.CKTmode & MODETRANOP) || !(ckt.CKTmode & MODEUIC)) {
          if (ckt.CKTmode & MODEINITSMSIG) {
            s0[here.BJTstate + BJT_CQBE] = capbe;
            s0[here.BJTstate + BJT_CQBC] = capbc;
            s0[here.BJTstate + BJT_CQCS] = capcs;
            s0[here.BJTstate + BJT_CQBX] = capbx;
            s0[here.BJTstate + BJT_CEXBC] = geqcb;
            continue;
          }

          if (ckt.CKTmode & MODEINITTRAN) {
            s1[here.BJTstate + BJT_QBE] = s0[here.BJTstate + BJT_QBE];
            s1[here.BJTstate + BJT_QBC] = s0[here.BJTstate + BJT_QBC];
            s1[here.BJTstate + BJT_QBX] = s0[here.BJTstate + BJT_QBX];
            s1[here.BJTstate + BJT_QCS] = s0[here.BJTstate + BJT_QCS];
          }
          const integ = niIntegrate(ckt, capbe, here.BJTstate + BJT_QBE);
          if (integ.error) return integ.error;
          geqcb = geqcb * ckt.CKTag[0];
          gpi = gpi + integ.geq;
          cb = cb + s0[here.BJTstate + BJT_CQBE];
          const integ2 = niIntegrate(ckt, capbc, here.BJTstate + BJT_QBC);
          if (integ2.error) return integ2.error;
          gmu = gmu + integ2.geq;
          cb = cb + s0[here.BJTstate + BJT_CQBC];
          cc = cc - s0[here.BJTstate + BJT_CQBC];
          if (ckt.CKTmode & MODEINITTRAN) {
            s1[here.BJTstate + BJT_CQBE] = s0[here.BJTstate + BJT_CQBE];
            s1[here.BJTstate + BJT_CQBC] = s0[here.BJTstate + BJT_CQBC];
          }
        }
      }

      if (ckt.CKTmode & (MODETRAN | MODEAC)) {
        const integ = niIntegrate(ckt, capcs, here.BJTstate + BJT_QCS);
        if (integ.error) return integ.error;
        gccs = gccs + integ.geq;
        const integbx = niIntegrate(ckt, capbx, here.BJTstate + BJT_QBX);
        if (integbx.error) return integbx.error;
        geqbx = geqbx + integbx.geq;
        if (ckt.CKTmode & MODEINITTRAN) {
          s1[here.BJTstate + BJT_CQCS] = s0[here.BJTstate + BJT_CQCS];
          s1[here.BJTstate + BJT_CQBX] = s0[here.BJTstate + BJT_CQBX];
        }
      }

      // ── сохранение состояний ──
      s0[here.BJTstate + BJT_VBE] = vbe;
      s0[here.BJTstate + BJT_VBC] = vbc;
      s0[here.BJTstate + BJT_CC] = cc;
      s0[here.BJTstate + BJT_CB] = cb;
      s0[here.BJTstate + BJT_GPI] = gpi;
      s0[here.BJTstate + BJT_GMU] = gmu;
      s0[here.BJTstate + BJT_GM] = gm;
      s0[here.BJTstate + BJT_GO] = go;
      s0[here.BJTstate + BJT_GX] = gx;
      s0[here.BJTstate + BJT_GEQCB] = geqcb;
      s0[here.BJTstate + BJT_GCCS] = gccs;
      s0[here.BJTstate + BJT_GEQBX] = geqbx;

      // ── загрузка RHS/матрицы ──
      ceqcs = BJTtype * (s0[here.BJTstate + BJT_CQCS] - vcs * gccs);
      ceqbx = BJTtype * (s0[here.BJTstate + BJT_CQBX] - vbx * geqbx);
      const ceqbe = BJTtype * (cc + cb - vbe * (gm + go + gpi) + vbc * (go - geqcb));
      const ceqbc = BJTtype * (-cc + vbe * (gm + go) - vbc * (gmu + go));

      ckt.CKTrhs[here.BJTbaseNode] += -ceqbx;
      ckt.CKTrhs[here.BJTcolPrimeNode] += ceqcs + ceqbx + ceqbc;
      ckt.CKTrhs[here.BJTbasePrimeNode] += -ceqbe - ceqbc;
      ckt.CKTrhs[here.BJTemitPrimeNode] += ceqbe;
      ckt.CKTrhs[here.BJTsubstNode] += -ceqcs;

      // ── load y matrix ──
      here.BJTcolColPtr.real += gcpr;
      here.BJTbaseBasePtr.real += gx + geqbx;
      here.BJTemitEmitPtr.real += gepr;
      here.BJTcolPrimeColPrimePtr.real += gmu + go + gcpr + gccs + geqbx;
      here.BJTbasePrimeBasePrimePtr.real += gx + gpi + gmu + geqcb;
      here.BJTemitPrimeEmitPrimePtr.real += gpi + gepr + gm + go;
      here.BJTcolColPrimePtr.real += -gcpr;
      here.BJTbaseBasePrimePtr.real += -gx;
      here.BJTemitEmitPrimePtr.real += -gepr;
      here.BJTcolPrimeColPtr.real += -gcpr;
      here.BJTcolPrimeBasePrimePtr.real += -gmu + gm;
      here.BJTcolPrimeEmitPrimePtr.real += -gm - go;
      here.BJTbasePrimeBasePtr.real += -gx;
      here.BJTbasePrimeColPrimePtr.real += -gmu - geqcb;
      here.BJTbasePrimeEmitPrimePtr.real += -gpi;
      here.BJTemitPrimeEmitPtr.real += -gepr;
      here.BJTemitPrimeColPrimePtr.real += -go + geqcb;
      here.BJTemitPrimeBasePrimePtr.real += -gpi - gm - geqcb;
      here.BJTsubstSubstPtr.real += gccs;
      here.BJTcolPrimeSubstPtr.real += -gccs;
      here.BJTsubstColPrimePtr.real += -gccs;
      here.BJTbaseColPrimePtr.real += -geqbx;
      here.BJTcolPrimeBasePtr.real += -geqbx;
    }
  }
  return OK;
}

/** `BJTacLoad` — комплексная загрузка малого сигнала (порт `BJTsAcLoad`). */
export function DEVacLoad(inModel, ckt) {
  for (let model = inModel; model; model = model.GENnextModel) {
    const BJTtype = model.BJTtype;
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const A0 = here.BJTarea;
      const vcpr = ckt.CKTrhsOld[here.BJTcolNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode];
      const vepr = ckt.CKTrhsOld[here.BJTemitNode] - ckt.CKTrhsOld[here.BJTemitPrimeNode];
      const vx = ckt.CKTrhsOld[here.BJTbaseNode] - ckt.CKTrhsOld[here.BJTbasePrimeNode];
      const vcs = ckt.CKTrhsOld[here.BJTcolPrimeNode] - ckt.CKTrhsOld[here.BJTsubstNode];
      const vbc = ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode];
      const vbe = ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTemitPrimeNode];
      const vce = vbe - vbc;
      const vbx = vx + vbc;
      const vbeOp = BJTtype * (ckt.CKTrhsOp[here.BJTbasePrimeNode] - ckt.CKTrhsOp[here.BJTemitPrimeNode]);
      const vbcOp = BJTtype * (ckt.CKTrhsOp[here.BJTbasePrimeNode] - ckt.CKTrhsOp[here.BJTcolPrimeNode]);

      ckt.CKTstates[0][here.BJTstate + BJT_VBE] = vbeOp;
      ckt.CKTstates[0][here.BJTstate + BJT_VBC] = vbcOp;
      const loadError = BJTload(inModel, ckt);
      if (loadError) return loadError;

      const gcpr = model.BJTcollectorConduct * A0;
      const gepr = model.BJTEMitterConduct * A0;
      const gpi = ckt.CKTstates[0][here.BJTstate + BJT_GPI];
      const gmu = ckt.CKTstates[0][here.BJTstate + BJT_GMU];
      const gm = ckt.CKTstates[0][here.BJTstate + BJT_GM];
      const go = ckt.CKTstates[0][here.BJTstate + BJT_GO];
      const gx = ckt.CKTstates[0][here.BJTstate + BJT_GX];
      let xgm = 0;
      const td = model.BJTexcessPhase;
      if (td !== 0) {
        const arg = td * ckt.CKTomega;
        gm = gm + go;
        xgm = -gm * Math.sin(arg);
        gm = gm * Math.cos(arg) - go;
      }
      const xcpi = ckt.CKTstates[0][here.BJTstate + BJT_CQBE] * ckt.CKTomega;
      const xcmu = ckt.CKTstates[0][here.BJTstate + BJT_CQBC] * ckt.CKTomega;
      const xcbx = ckt.CKTstates[0][here.BJTstate + BJT_CQBX] * ckt.CKTomega;
      const xccs = ckt.CKTstates[0][here.BJTstate + BJT_CQCS] * ckt.CKTomega;
      const xcmcb = ckt.CKTstates[0][here.BJTstate + BJT_CEXBC] * ckt.CKTomega;

      const cx = gx * vx;
      const cbx = -xcbx * ckt.CKTrhsOld[here.BJTbaseNode];
      const ccs = -xccs * ckt.CKTrhsOld[here.BJTcolPrimeNode];
      const cbc = gmu * vbc - xcmu * ckt.CKTrhsOld[here.BJTbasePrimeNode];
      const cbe = gpi * vbe - xcpi * ckt.CKTrhsOld[here.BJTbasePrimeNode] - xcmcb * ckt.CKTrhsOld[here.BJTcolPrimeNode];
      const cce = go * vce + gm * vbe - xgm * ckt.CKTrhsOld[here.BJTbasePrimeNode];
      const cc0 = gcpr * vcpr;
      const ce0 = gepr * vepr;
      const cb0 = cx + cbx;
      const cbprm0 = here.BJTbaseNode === here.BJTbasePrimeNode ? cbx + cbe + cbc : -cx + cbe + cbc;

      // Комплексная загрузка (без чувствительности) — матрица собирается из
      // малого сигнала, вычисленного `BJTload` выше.
      here.BJTcolColPrimePtr.real += gcpr;
      here.BJTcolColPrimePtr.imag += 0;
      here.BJTbaseBasePrimePtr.real += gx;
      here.BJTbaseBasePrimePtr.imag += 0;
      here.BJTemitEmitPrimePtr.real += gepr;
      here.BJTemitEmitPrimePtr.imag += 0;
      here.BJTcolPrimeColPrimePtr.real += gmu + go + gcpr;
      here.BJTcolPrimeColPrimePtr.imag += 0;
      here.BJTbasePrimeBasePrimePtr.real += gx;
      here.BJTbasePrimeBasePrimePtr.imag += 0;
      here.BJTemitPrimeEmitPrimePtr.real += gpi + gepr + gm + go;
      here.BJTemitPrimeEmitPrimePtr.imag += 0;
      here.BJTcolColPtr.real += gcpr;
      here.BJTbaseBasePtr.real += gx;
      here.BJTbaseBasePtr.imag += 0;
      here.BJTemitEmitPtr.real += gepr;
      here.BJTemitEmitPtr.imag += 0;
      here.BJTcolPrimeColPtr.real += -gcpr;
      here.BJTcolPrimeColPtr.imag += 0;
      here.BJTbasePrimeBasePtr.real += -gx;
      here.BJTbasePrimeBasePtr.imag += 0;
      here.BJTemitEmitPrimePtr.real += -gepr;
      here.BJTemitEmitPrimePtr.imag += 0;
      here.BJTcolPrimeBasePtr.real += -gmu + gm;
      here.BJTcolPrimeBasePtr.imag += 0;
      here.BJTcolPrimeEmitPtr.real += -gm - go;
      here.BJTcolPrimeEmitPtr.imag += 0;
      here.BJTbasePrimeBasePtr.real += -gx;
      here.BJTbasePrimeBasePtr.imag += 0;
      here.BJTbasePrimeColPrimePtr.real += -gmu;
      here.BJTbasePrimeColPrimePtr.imag += -0;
      here.BJTbasePrimeEmitPrimePtr.real += -gpi;
      here.BJTbasePrimeEmitPtr.imag += 0;
      here.BJTemitPrimeEmitPtr.real += -gepr;
      here.BJTemitPrimeEmitPtr.imag += 0;
      here.BJTemitPrimeColPrimePtr.real += -go;
      here.BJTemitPrimeColPrimePtr.imag += 0;
      here.BJTemitPrimeBasePtr.real += -gpi - gm;
      here.BJTemitPrimeBasePtr.imag += 0;
      here.BJTsubstSubstPtr.real += 0;
      here.BJTsubstSubstPtr.imag += 0;
      here.BJTcolPrimeSubstPtr.real += 0;
      here.BJTcolPrimeSubstPtr.imag += 0;
      here.BJTsubstColPrimePtr.real += 0;
      here.BJTsubstColPrimePtr.imag += 0;
      here.BJTbaseColPrimePtr.real += -0;
      here.BJTbaseColPrimePtr.imag += 0;
      here.BJTcolPrimeBasePtr.real += -0;
      here.BJTcolPrimeBasePtr.imag += 0;
      return OK;
    }
  }
  return OK;
}

/** `BJTtrunc`. */
export function BJTtrunc(inModel, ckt, timeState) {
  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      cktTerr(here.BJTstate + BJT_QBE, ckt, timeState);
      cktTerr(here.BJTstate + BJT_QBC, ckt, timeState);
      cktTerr(here.BJTstate + BJT_QCS, ckt, timeState);
    }
  }
  return OK;
}

/** `BJTconvTest`. */
export function BJTconvTest(inModel, ckt) {
  const s0 = ckt.CKTstates[0];
  for (let model = inModel; model; model = model.GENnextModel) {
    const BJTtype = model.BJTtype;
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      const vbe = BJTtype * (ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTemitPrimeNode]);
      const vbc = BJTtype * (ckt.CKTrhsOld[here.BJTbasePrimeNode] - ckt.CKTrhsOld[here.BJTcolPrimeNode]);
      const delvbe = vbe - s0[here.BJTstate + BJT_VBE];
      const delvbc = vbc - s0[here.BJTstate + BJT_VBC];
      const cchat = s0[here.BJTstate + BJT_CC] + (s0[here.BJTstate + BJT_GM] + s0[here.BJTstate + BJT_GO]) * delvbe - (s0[here.BJTstate + BJT_GO] + s0[here.BJTstate + BJT_GMU]) * delvbc;
      const cbhat = s0[here.BJTstate + BJT_CB] + s0[here.BJTstate + BJT_GPI] * delvbe + s0[here.BJTstate + BJT_GMU] * delvbc;
      const cc = s0[here.BJTstate + BJT_CC];
      const cb = s0[here.BJTstate + BJT_CB];
      const tol = ckt.CKTreltol * Math.max(Math.abs(cchat), Math.abs(cc)) + ckt.CKTabstol;
      if (Math.abs(cchat - cc) > tol) {
        ckt.CKTnoncon++;
        return OK;
      }
      const tol2 = ckt.CKTreltol * Math.max(Math.abs(cbhat), Math.abs(cb)) + ckt.CKTabstol;
      if (Math.abs(cbhat - cb) > tol2) {
        ckt.CKTnoncon++;
        return OK;
      }
    }
  }
  return OK;
}

// ─────────────────────────── ЗАДАЧИ / ASK ───────────────────────────

/** `BJTask` — вопросы инстанса (`DEVask`). */
export function DEVask(ckt, inst, which) {
  const s0 = ckt.CKTstates[0];
  switch (which) {
    case BJT_QUEST_FT: {
      const tmp = Math.max(s0[inst.BJTstate + BJT_CQBC], s0[inst.BJTstate + BJT_CQBX]);
      const value = s0[inst.BJTstate + BJT_GM] / (2 * Math.PI * Math.max(s0[inst.BJTstate + BJT_QBE], tmp));
      return { error: OK, value };
    }
    case BJT_QUEST_COLNODE:
      return { error: OK, value: inst.BJTcolNode };
    case BJT_QUEST_BASENODE:
      return { error: OK, value: inst.BJTbaseNode };
    case BJT_QUEST_EMITNODE:
      return { error: OK, value: inst.BJTemitNode };
    case BJT_QUEST_SUBSTNODE:
      return { error: OK, value: inst.BJTsubstNode };
    case BJT_QUEST_COLPRIMENODE:
      return { error: OK, value: inst.BJTcolPrimeNode };
    case BJT_QUEST_BASEPRIMENODE:
      return { error: OK, value: inst.BJTbasePrimeNode };
    case BJT_QUEST_EMITPRIMENODE:
      return { error: OK, value: inst.BJTemitPrimeNode };
    case BJT_QUEST_VBE:
      return { error: OK, value: s0[inst.BJTstate + BJT_VBE] };
    case BJT_QUEST_VBC:
      return { error: OK, value: s0[inst.BJTstate + BJT_VBC] };
    case BJT_QUEST_CC:
      return { error: OK, value: s0[inst.BJTstate + BJT_CC] };
    case BJT_QUEST_CB:
      return { error: OK, value: s0[inst.BJTstate + BJT_CB] };
    case BJT_QUEST_GPI:
      return { error: OK, value: s0[inst.BJTstate + BJT_GPI] };
    case BJT_QUEST_GMU:
      return { error: OK, value: s0[inst.BJTstate + BJT_GMU] };
    case BJT_QUEST_GM:
      return { error: OK, value: s0[inst.BJTstate + BJT_GM] };
    case BJT_QUEST_GO:
      return { error: OK, value: s0[inst.BJTstate + BJT_GO] };
    case BJT_QUEST_QBE:
      return { error: OK, value: s0[inst.BJTstate + BJT_QBE] };
    case BJT_QUEST_CQBE:
      return { error: OK, value: s0[inst.BJTstate + BJT_CQBE] };
    case BJT_QUEST_QBC:
      return { error: OK, value: s0[inst.BJTstate + BJT_QBC] };
    case BJT_QUEST_CQBC:
      return { error: OK, value: s0[inst.BJTstate + BJT_CQBC] };
    case BJT_QUEST_QCS:
      return { error: OK, value: s0[inst.BJTstate + BJT_QCS] };
    case BJT_QUEST_CQCS:
      return { error: OK, value: s0[inst.BJTstate + BJT_CQCS] };
    case BJT_QUEST_QBX:
      return { error: OK, value: s0[inst.BJTstate + BJT_QBX] };
    case BJT_QUEST_CQBX:
      return { error: OK, value: s0[inst.BJTstate + BJT_CQBX] };
    case BJT_QUEST_GX:
      return { error: OK, value: s0[inst.BJTstate + BJT_GX] };
    case BJT_QUEST_CEXBC:
      return { error: OK, value: s0[inst.BJTstate + BJT_CEXBC] };
    case BJT_QUEST_GEQCB:
      return { error: OK, value: s0[inst.BJTstate + BJT_GEQCB] };
    case BJT_QUEST_GCCS:
      return { error: OK, value: s0[inst.BJTstate + BJT_GCCS] };
    case BJT_QUEST_GEQBX:
      return { error: OK, value: s0[inst.BJTstate + BJT_GEQBX] };
    case BJT_QUEST_CE:
      if (ckt.CKTcurrentAnalysis & DOING_AC) {
        return { error: E_ASKCURRENT_ID, value: NaN };
      }
      {
        let value = -s0[inst.BJTstate + BJT_CC];
        value -= s0[inst.BJTstate + BJT_CB];
        if ((ckt.CKTcurrentAnalysis & DOING_TRAN) && !(ckt.CKTmode & MODETRANOP)) {
          value += s0[inst.BJTstate + BJT_CQCS];
        }
        return { error: OK, value };
      }
    case BJT_QUEST_CS:
      if (ckt.CKTcurrentAnalysis & DOING_AC) {
        return { error: E_ASKCURRENT_ID, value: NaN };
      }
      if (ckt.CKTcurrentAnalysis & (DOING_DCOP | DOING_TRCV)) {
        return { error: OK, value: 0 };
      }
      if ((ckt.CKTcurrentAnalysis & DOING_TRAN) && (ckt.CKTmode & MODETRANOP)) {
        return { error: OK, value: 0 };
      }
      return { error: OK, value: -s0[inst.BJTstate + BJT_CQCS] };
    case BJT_QUEST_POWER:
      if (ckt.CKTcurrentAnalysis & DOING_AC) {
        return { error: E_ASKPOWER_ID, value: NaN };
      }
      {
        let value = s0[inst.BJTstate + BJT_CC] * ckt.CKTrhsOld[inst.BJTcolNode];
        value += s0[inst.BJTstate + BJT_CB] * ckt.CKTrhsOld[inst.BJTbaseNode];
        if ((ckt.CKTcurrentAnalysis & DOING_TRAN) && !(ckt.CKTmode & MODETRANOP)) {
          value -= s0[inst.BJTstate + BJT_CQCS] * ckt.CKTrhsOld[inst.BJTsubstNode];
        }
        const tmp = -s0[inst.BJTstate + BJT_CC];
        const tmp2 = -s0[inst.BJTstate + BJT_CB];
        let value2 = tmp + tmp2;
        if ((ckt.CKTcurrentAnalysis & DOING_TRAN) && !(ckt.CKTmode & MODETRANOP)) {
          value2 += s0[inst.BJTstate + BJT_CQCS];
        }
        value += value2 * ckt.CKTrhsOld[inst.BJTemitNode];
        return { error: OK, value };
      }
    default:
      return { error: E_BADPARM, value: undefined };
  }
}

/** `BJTmAsk` — вопросы модели. */
export function BJTmAsk(ckt, model, which) {
  switch (which) {
    case BJT_MOD_INVEARLYF:
      return { error: OK, value: model.BJTinvEarlyVoltF };
    case BJT_MOD_INVEARLYR:
      return { error: OK, value: model.BJTinvEarlyVoltR };
    case BJT_MOD_INVROLLOFFF:
      return { error: OK, value: model.BJTinvRollOffF };
    case BJT_MOD_INVROLLOFFR:
      return { error: OK, value: model.BJTinvRollOffR };
    case BJT_MOD_COLCONDUCT:
      return { error: OK, value: model.BJTcollectorConduct };
    case BJT_MOD_EMITTERCONDUCT:
      return { error: OK, value: model.BJTEMitterConduct };
    case BJT_MOD_TRANSVBCFACT:
      return { error: OK, value: model.BJTtransitTimeVBCFactor };
    case BJT_MOD_EXCESSPHASEFACTOR:
      return { error: OK, value: model.BJTexcessPhaseFactor };
    case BJT_MOD_TNOM:
      return { error: OK, value: model.BJTtnom - 273.15 };
    case BJT_MOD_AF:
      return { error: OK, value: model.BJTbetaExp };
    case BJT_MOD_KF:
      return { error: OK, value: model.BJTbetaExp };
    default:
      return { error: E_BADPARM, value: undefined };
  }
}

export const bjt = {
  DEVnewModel: newModel,
  DEVnewInstance: newInstance,
  DEVparam: BJTparam,
  DEVmodParam: BJTmParam,
  DEVsetup: BJTsetup,
  DEVunsetup: BJTunsetup,
  DEVtemperature: BJTtemp,
  DEVload: BJTload,
  DEVacLoad: DEVacLoad,
  DEVtrunc: BJTtrunc,
  DEVconvTest: BJTconvTest,
  DEVask: DEVask,
  DEVmAsk: BJTmAsk,
};
