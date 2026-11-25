/**
 * common.js — общие мелочи порта устройств SPICE3F4/XSPICE (P1.4+).
 *
 * Здесь только то, что повторяется в нескольких DEV-модулях:
 *  - `CONSTCtoK` из `const.h` (перевод °C → K);
 *  - порождение уравнений тока (`CKTmkCur`) для ветвевых устройств;
 *  - вычисление значения независимого источника по времени
 *    (`VSRCload`/`ISRCload`, P1.5): DC/PULSE/SINE/EXP/SFFM/PWL.
 *
 * Формулы перенесены 1:1, включая странности C (например, разное число
 * итераций PWL у Vsource и Isource). Комментарии — на русском, идентификаторы —
 * как в C.
 */

import { OK, cktMkCur, cktSetBreak, MODETRAN, MODETRANOP } from '../ckt.js';

/** `CONSTCtoK` из `const.h`. */
export const CONSTCtoK = 273.15;

/** Типы функций источников (PULSE/SINE/EXP/SFFM/PWL). */
export const PULSE = 1;
export const SINE = 2;
export const EXP = 3;
export const SFFM = 4;
export const PWL = 5;

/**
 * `DEVpred` (`devsup.c`) — предсказание значения состояния на новом шаге
 * линейной экстраполяцией по двум предыдущим (`NEWTRUNC`-редакция, как в
 * DLL): `(1+xfact)*state1 - xfact*state2`, `xfact = delta/deltaOld[1]`.
 *
 * @param {object} ckt
 * @param {number} loct — индекс состояния в `CKTstates[i]`
 * @returns {number}
 */
export function DEVpred(ckt, loct) {
  const xfact = ckt.CKTdelta / ckt.CKTdeltaOld[1];
  return (1 + xfact) * ckt.CKTstates[1][loct] - xfact * ckt.CKTstates[2][loct];
}

/**
 * Создать уравнение тока ветви и запомнить номер в поле инстанса.
 * В C это делает `CKTmkCur(ckt, &tmp, name, "branch")` в setup/findBranch.
 *
 * @param {object} ckt
 * @param {object} inst
 * @param {string} field — имя поля с номером ветви (VSRCbranch, INDbrEq)
 * @returns {number} код ошибки
 */
export function makeBranch(ckt, inst, field) {
  if (inst[field]) return OK;
  const made = cktMkCur(ckt, inst.GENname, 'branch');
  if (made.error) return made.error;
  inst[field] = made.node.number;
  return OK;
}

/**
 * Значение независимого источника для текущего режима/времени.
 * Порт ветки `else` из `VSRCload.c`/`ISRCload.c` (без DC-ветки — её
 * обрабатывает вызывающий DEVload).
 *
 * @param {object} inst — инстанс VSRC/ISRC
 * @param {object} ckt
 * @param {number} time
 * @returns {number}
 */
/**
 * `VSRCaccept`/`ISRCaccept` — выставить следующую точку останова.
 * Порт `vsrcacct.c`/`isrcacct.c` (отличия только в префиксе полей).
 *
 * @param {object} inModel — цепочка моделей устройства
 * @param {object} ckt
 * @param {string} prefix — 'VSRC' или 'ISRC'
 * @returns {number} код ошибки
 */
export function sourceAccept(inModel, ckt, prefix) {
  const fnType = prefix + 'functionType';
  const fnOrder = prefix + 'functionOrder';
  const coeffs = prefix + 'coeffs';

  // C: `if(!ckt->CKTmode & (MODETRAN | MODETRANOP))` — из-за приоритетов это
  // `(!ckt->CKTmode) & (...)`, т.е. проверка не срабатывает. Воспроизводим.
  if (!ckt.CKTmode & (MODETRAN | MODETRANOP)) return OK;

  for (let model = inModel; model; model = model.GENnextModel) {
    for (let here = model.GENinstances; here; here = here.GENnextInstance) {
      switch (here[fnType]) {
        default:
          break;

        case PULSE: {
          const c = here[coeffs];
          const order = here[fnOrder];
          const TD = order > 2 ? c[2] : 0.0;
          const TR = order > 3 && c[3] !== 0.0 ? c[3] : ckt.CKTstep;
          const TF = order > 4 && c[4] !== 0.0 ? c[4] : ckt.CKTstep;
          const PW = order > 5 && c[5] !== 0.0 ? c[5] : ckt.CKTfinalTime;
          const PER = order > 6 && c[6] !== 0.0 ? c[6] : ckt.CKTfinalTime;
          const sameTime = (a, b) => Math.abs(a - b) <= 1e-7 * PW;

          let time = ckt.CKTtime - TD;
          let basetime = 0;
          if (time >= PER) {
            basetime = PER * Math.floor(time / PER);
            time -= basetime;
          }
          if (time <= 0 || time >= TR + PW + TF) {
            if (ckt.CKTbreak && sameTime(time, 0)) {
              const e = cktSetBreak(ckt, basetime + TR + TD);
              if (e) return e;
            } else if (ckt.CKTbreak && sameTime(TR + PW + TF, time)) {
              const e = cktSetBreak(ckt, basetime + PER + TD);
              if (e) return e;
            } else if (ckt.CKTbreak && time === -TD) {
              const e = cktSetBreak(ckt, basetime + TD);
              if (e) return e;
            } else if (ckt.CKTbreak && sameTime(PER, time)) {
              const e = cktSetBreak(ckt, basetime + TD + TR + PER);
              if (e) return e;
            }
          } else if (time >= TR && time <= TR + PW) {
            if (ckt.CKTbreak && sameTime(time, TR)) {
              const e = cktSetBreak(ckt, basetime + TD + TR + PW);
              if (e) return e;
            } else if (ckt.CKTbreak && sameTime(TR + PW, time)) {
              const e = cktSetBreak(ckt, basetime + TD + TR + PW + TF);
              if (e) return e;
            }
          } else if (time > 0 && time < TR) {
            if (ckt.CKTbreak && sameTime(time, 0)) {
              const e = cktSetBreak(ckt, basetime + TD + TR);
              if (e) return e;
            } else if (ckt.CKTbreak && sameTime(time, TR)) {
              const e = cktSetBreak(ckt, basetime + TD + TR + PW);
              if (e) return e;
            }
          } else {
            if (ckt.CKTbreak && sameTime(time, TR + PW)) {
              const e = cktSetBreak(ckt, basetime + TD + TR + PW + TF);
              if (e) return e;
            } else if (ckt.CKTbreak && sameTime(time, TR + PW + TF)) {
              const e = cktSetBreak(ckt, basetime + TD + PER);
              if (e) return e;
            }
          }
          break;
        }

        case SINE:
        case EXP:
        case SFFM:
          // точек останова нет
          break;

        case PWL: {
          const c = here[coeffs];
          const order = here[fnOrder];
          if (ckt.CKTtime < c[0]) {
            if (ckt.CKTbreak) {
              const e = cktSetBreak(ckt, c[0]);
              if (e) return e;
            }
          } else {
            for (let i = 0; i < order / 2 - 1; i++) {
              if (c[2 * i] === ckt.CKTtime) {
                if (ckt.CKTbreak) {
                  const e = cktSetBreak(ckt, c[2 * i + 2]);
                  if (e) return e;
                }
                break;
              }
            }
          }
          break;
        }
      }
    }
  }
  return OK;
}

export function sourceFunctionValue(inst, ckt, time) {
  const c = inst.VSRCcoeffs ?? inst.ISRCcoeffs;
  const order = inst.VSRCfunctionOrder ?? inst.ISRCfunctionOrder;
  const type = inst.VSRCfunctionType ?? inst.ISRCfunctionType;
  const dc = inst.VSRCdcValue ?? inst.ISRCdcValue;

  switch (type) {
    default:
      // Функция не задана — используется DC-значение.
      return dc;

    case PULSE: {
      const V1 = c[0];
      const V2 = c[1];
      const TD = order > 2 ? c[2] : 0.0;
      const TR = order > 3 && c[3] !== 0.0 ? c[3] : ckt.CKTstep;
      const TF = order > 4 && c[4] !== 0.0 ? c[4] : ckt.CKTstep;
      const PW = order > 5 && c[5] !== 0.0 ? c[5] : ckt.CKTfinalTime;
      const PER = order > 6 && c[6] !== 0.0 ? c[6] : ckt.CKTfinalTime;

      time -= TD;
      if (time > PER) {
        const basetime = PER * Math.floor(time / PER);
        time -= basetime;
      }
      if (time <= 0 || time >= TR + PW + TF) return V1;
      if (time >= TR && time <= TR + PW) return V2;
      if (time > 0 && time < TR) return V1 + ((V2 - V1) * time) / TR;
      return V2 + ((V1 - V2) * (time - (TR + PW))) / TF;
    }

    case SINE: {
      const VO = c[0];
      const VA = c[1];
      const FREQ = order >= 3 && c[2] ? c[2] : 1 / ckt.CKTfinalTime;
      const TD = order >= 4 ? c[3] : 0.0;
      const THETA = order >= 5 ? c[4] : 0.0;
      time -= TD;
      if (time <= 0) return VO;
      return VO + VA * Math.sin(FREQ * time * 2.0 * Math.PI) * Math.exp(-(time * THETA));
    }

    case EXP: {
      const V1 = c[0];
      const V2 = c[1];
      const TD1 = order >= 3 ? c[2] : ckt.CKTstep;
      const TAU1 = order >= 4 && c[3] ? c[3] : ckt.CKTstep;
      const TD2 = order >= 5 && c[4] ? c[4] : TD1 + ckt.CKTstep;
      const TAU2 = order >= 6 && c[5] ? c[5] : ckt.CKTstep;
      if (time <= TD1) return V1;
      if (time <= TD2) return V1 + (V2 - V1) * (1 - Math.exp(-(time - TD1) / TAU1));
      return (
        V1 +
        (V2 - V1) * (1 - Math.exp(-(time - TD1) / TAU1)) +
        (V1 - V2) * (1 - Math.exp(-(time - TD2) / TAU2))
      );
    }

    case SFFM: {
      const VO = c[0];
      const VA = c[1];
      const FC = order >= 3 && c[2] ? c[2] : 1 / ckt.CKTfinalTime;
      const MDI = order >= 4 ? c[3] : 0.0;
      const FS = order >= 5 && c[4] ? c[4] : 1 / ckt.CKTfinalTime;
      return VO + VA * Math.sin(2 * Math.PI * FC * time + MDI * Math.sin(2 * Math.PI * FS * time));
    }

    case PWL: {
      if (time < c[0]) return c[1];
      // Q-S? В VSRCload граница `i < (order/2)-1`, в ISRCload — `i <= ...`;
      // сохраняем поведение конкретного устройства (флаг pwlInclusive).
      const last = inst.pwlInclusive ? Math.trunc(order / 2) : Math.trunc(order / 2) - 1;
      for (let i = 0; i < last; i++) {
        if (c[2 * i] === time) return c[2 * i + 1];
        if (c[2 * i] < time && c[2 * (i + 1)] > time) {
          return (
            c[2 * i + 1] +
            ((time - c[2 * i]) / (c[2 * (i + 1)] - c[2 * i])) *
              (c[2 * i + 3] - c[2 * i + 1])
          );
        }
      }
      return c[order - 1];
    }
  }
}
