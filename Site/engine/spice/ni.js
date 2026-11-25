/**
 * ni.js — численный итератор (Numerical Integration package).
 *
 * P1.2: жизненный цикл решателя — `niInit`, `niReinit`, `niDestroy`
 * (`vendor/spice3f4/src/lib/ni/{niinit,nireinit,nidest}.c`).
 *
 * P1.3: собственно численное ядро —
 *  - `niIter`     — ньютоновский цикл (`niiter.c` / XSPICE `NIiter.c`);
 *  - `niConvTest` — критерий сходимости (`niconv.c` / `NIconvTest.c`);
 *  - `niComCof`   — коэффициенты интеграции (`nicomcof.c` / `NIcomCof.c`);
 *  - `niIntegrate`— корректор трапеции/Gear (`niinteg.c` / `NIintegrate.c`).
 *  - `niAcIter`   — комплексная итерация AC (`NIacIter.c`).
 *
 * Чего здесь нет и почему:
 *  - `NIpred`/`CKTagp`/`CKTpred`/`CKTsols` — `PREDICTOR` не определён ни в
 *    `spice3f4`, ни в `xspice-1-0`, т.е. в DLL этот код не скомпилирован;
 *  - `NIdIter`/`NIpz*`/`NIsenReinit` — фаза P3 (PZ/SEN/DISTO);
 *  - `NEWTRUNC`-ветка LTE — `NEWTRUNC` не определён; шаг режут устройства
 *    через `DEVtrunc` (драйвер `CKTtrunc` в `ckt.js`).
 *
 * Соглашения JS-порта:
 *  - поля `CKTcircuit` сохраняют имена C (`CKTmatrix`, `CKTrhs`, …);
 *  - `MALLOC` в F4 = `tmalloc` = zeroed-память ⇒ `Float64Array` (нули);
 *  - флаги `CKTniState` — те же биты, что в `cktdefs.h`;
 *  - out-параметры C (`double *geq`, `double *ceq`) возвращаются объектом
 *    `{ error, geq, ceq }` — в JS нет указателей;
 *  - ошибки — коды `iferrmsg.h`/`sperror.h`, текст — в `ckt.errMsg`/`ckt.errRtn`.
 *
 * NB: `ckt.js` и `ni.js` импортируют друг друга (в C это внешние символы
 * `CKTload`/`CKTconvTest`). Обращения — только внутри функций, поэтому
 * циклический ESM-импорт безопасен.
 */

import {
  OK,
  E_NOMEM,
  E_SINGULAR,
  SMPmatSize,
  SMPpreOrder,
  SMPreorder,
  SMPluFac,
  SMPsolve,
  SMPcReorder,
  SMPcLUfac,
  SMPcSolve,
  SMPgetError,
  SMPdestroy,
  SMPnewMatrix,
} from './sparse.js';
import {
  E_PANIC,
  SP_VOLTAGE,
  TRAPEZOIDAL,
  GEAR,
  MODETRANOP,
  MODEUIC,
  MODEDC,
  MODEINITFLOAT,
  MODEINITJCT,
  MODEINITFIX,
  MODEINITSMSIG,
  MODEINITTRAN,
  MODEINITPRED,
  INITF,
  cktLoad,
  cktAcLoad,
  cktConvTest,
  cktNodeName,
} from './ckt.js';

/** `E_ITERLIM` (sperror.h): iteration limit reached. */
export const E_ITERLIM = 103;
/** `E_ORDER` (sperror.h): integration order not supported. */
export const E_ORDER = 104;
/** `E_METHOD` (sperror.h): integration method not supported. */
export const E_METHOD = 105;

/** Реэкспорт для тестов/устройств (код из `sparse.js`). */
export { E_SINGULAR };

/** Биты `CKTniState` (cktdefs.h). */
export const NISHOULDREORDER = 0x1;
export const NIREORDERED = 0x2;
export const NIUNINITIALIZED = 0x4;
export const NIACSHOULDREORDER = 0x10;
export const NIACREORDERED = 0x20;
export const NIACUNINITIALIZED = 0x40;
export const NIDIDPREORDER = 0x100;
export const NIPZSHOULDREORDER = 0x200;

/** Ошибка с текстом (в C — глобалы `errMsg`/`errRtn`). */
function niFail(ckt, code, routine, message) {
  if (ckt) {
    ckt.errRtn = routine;
    ckt.errMsg = message;
  }
  return code;
}

/** Монопонические секунды для статистики (C: `IFseconds` фронтенда). */
function nowSeconds() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === 'function') return perf.now() / 1000;
  return Date.now() / 1000;
}

/**
 * NIinit — инициализировать численный пакет: пометить матрицу неинициализированной
 * и создать пустую разреженную матрицу (C: `SMPnewMatrix`).
 *
 * @param {object} ckt
 * @returns {number} код ошибки (OK / E_NOMEM)
 */
export function niInit(ckt) {
  ckt.CKTniState = NIUNINITIALIZED;
  ckt.CKTmatrix = SMPnewMatrix();
  return ckt.CKTmatrix ? OK : E_NOMEM;
}

/**
 * NIreinit — матрица полностью «посещена» device-setup'ом, размер известен:
 * выделить RHS-векторы (real/imag, текущие/старые/spare) и сбросить флаги.
 *
 * В C при `PREDICTOR` здесь же аллоцируются `CKTpred`/`CKTsols`; в DLL
 * `PREDICTOR` не определён, поэтому этих массивов нет (см. шапку модуля).
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function niReinit(ckt) {
  const size = SMPmatSize(ckt.CKTmatrix);
  try {
    ckt.CKTrhs = new Float64Array(size + 1);
    ckt.CKTrhsOld = new Float64Array(size + 1);
    ckt.CKTrhsSpare = new Float64Array(size + 1);
    ckt.CKTirhs = new Float64Array(size + 1);
    ckt.CKTirhsOld = new Float64Array(size + 1);
    ckt.CKTirhsSpare = new Float64Array(size + 1);
  } catch (e) {
    if (e instanceof RangeError) return E_NOMEM;
    throw e;
  }
  ckt.CKTniState = NISHOULDREORDER | NIACSHOULDREORDER | NIPZSHOULDREORDER;
  return OK;
}

/**
 * NIdestroy — освободить матрицу и RHS-векторы (в JS — снять ссылки; память
 * соберёт GC). Как и в C, сенситивность (`CKTrhsOp`/`CKTsen*Rhs`) не трогаем —
 * её освобождает SENdestroy (P3).
 *
 * @param {object} ckt
 */
export function niDestroy(ckt) {
  if (ckt.CKTmatrix) SMPdestroy(ckt.CKTmatrix);
  ckt.CKTmatrix = null;
  ckt.CKTrhs = null;
  ckt.CKTrhsOld = null;
  ckt.CKTrhsSpare = null;
  ckt.CKTirhs = null;
  ckt.CKTirhsOld = null;
  ckt.CKTirhsSpare = null;
}

/**
 * NIiter — ньютоновская итерация (порт XSPICE `NIiter.c`).
 *
 * Отличия XSPICE от F4, воспроизводимые здесь:
 *  - при `MODEUIC` — только обмен `CKTrhsOld`/`CKTrhs`, без `CKTload`;
 *  - IPC pause/stop (`g_ipc`) не портируется — фаза X.
 *
 * @param {object} ckt
 * @param {number} maxIter — предел итераций (`itl1`/`itl4` выбирает анализ)
 * @returns {number} OK / E_ITERLIM / E_SINGULAR / E_BADMATRIX / E_NOMEM / E_PANIC
 */
export function niIter(ckt, maxIter) {
  let iterno = 0;
  let ipass = 0;

  if ((ckt.CKTmode & MODETRANOP) && (ckt.CKTmode & MODEUIC)) {
    const temp = ckt.CKTrhsOld;
    ckt.CKTrhsOld = ckt.CKTrhs;
    ckt.CKTrhs = temp;
    return OK;
  }

  if (ckt.CKTniState & NIUNINITIALIZED) {
    const error = niReinit(ckt);
    if (error) return error;
  }

  for (;;) {
    ckt.CKTnoncon = 0;

    let error = cktLoad(ckt);
    iterno++;
    if (error) {
      ckt.CKTstat.STATnumIter += iterno;
      return error;
    }

    if (!(ckt.CKTniState & NIDIDPREORDER)) {
      error = SMPpreOrder(ckt.CKTmatrix);
      if (error) {
        ckt.CKTstat.STATnumIter += iterno;
        return error;
      }
      ckt.CKTniState |= NIDIDPREORDER;
    }

    if ((ckt.CKTmode & MODEINITJCT) || ((ckt.CKTmode & MODEINITTRAN) && iterno === 1)) {
      ckt.CKTniState |= NISHOULDREORDER;
    }

    if (ckt.CKTniState & NISHOULDREORDER) {
      const start = nowSeconds();
      error = SMPreorder(
        ckt.CKTmatrix,
        ckt.CKTpivotAbsTol,
        ckt.CKTpivotRelTol,
        ckt.CKTdiagGmin,
      );
      ckt.CKTstat.STATreorderTime += nowSeconds() - start;
      if (error) {
        const where = SMPgetError(ckt.CKTmatrix);
        const message =
          `singular matrix:  check nodes ${cktNodeName(ckt, where.row)} and ` +
          `${cktNodeName(ckt, where.col)}\n`;
        ckt.CKTstat.STATnumIter += iterno;
        return niFail(ckt, error, 'NIiter', message);
      }
      ckt.CKTniState &= ~NISHOULDREORDER;
    } else {
      const start = nowSeconds();
      error = SMPluFac(ckt.CKTmatrix, ckt.CKTpivotAbsTol, ckt.CKTdiagGmin);
      ckt.CKTstat.STATdecompTime += nowSeconds() - start;
      if (error) {
        if (error === E_SINGULAR) {
          // LU не смог — пробуем переупорядочить (C: `continue`).
          ckt.CKTniState |= NISHOULDREORDER;
          continue;
        }
        ckt.CKTstat.STATnumIter += iterno;
        return error;
      }
    }

    const solveStart = nowSeconds();
    SMPsolve(ckt.CKTmatrix, ckt.CKTrhs, ckt.CKTrhsSpare);
    ckt.CKTstat.STATsolveTime += nowSeconds() - solveStart;

    ckt.CKTrhs[0] = 0;
    ckt.CKTrhsSpare[0] = 0;
    ckt.CKTrhsOld[0] = 0;

    if (iterno > maxIter) {
      ckt.CKTstat.STATnumIter += iterno;
      return niFail(
        ckt,
        E_ITERLIM,
        'NIiter',
        'Too many iterations without convergence',
      );
    }

    if (ckt.CKTnoncon === 0 && iterno !== 1) {
      ckt.CKTnoncon = niConvTest(ckt);
    } else {
      ckt.CKTnoncon = 1;
    }

    if (ckt.CKTmode & MODEINITFLOAT) {
      if (ckt.CKTmode & MODEDC && ckt.CKThadNodeset) {
        if (ipass) ckt.CKTnoncon = ipass;
        ipass = 0;
      }
      if (ckt.CKTnoncon === 0) {
        ckt.CKTstat.STATnumIter += iterno;
        return OK;
      }
    } else if (ckt.CKTmode & MODEINITJCT) {
      ckt.CKTmode = (ckt.CKTmode & ~INITF) | MODEINITFIX;
      ckt.CKTniState |= NISHOULDREORDER;
    } else if (ckt.CKTmode & MODEINITFIX) {
      if (ckt.CKTnoncon === 0) ckt.CKTmode = (ckt.CKTmode & ~INITF) | MODEINITFLOAT;
      ipass = 1;
    } else if (ckt.CKTmode & MODEINITSMSIG) {
      ckt.CKTmode = (ckt.CKTmode & ~INITF) | MODEINITFLOAT;
    } else if (ckt.CKTmode & MODEINITTRAN) {
      if (iterno <= 1) ckt.CKTniState |= NISHOULDREORDER;
      ckt.CKTmode = (ckt.CKTmode & ~INITF) | MODEINITFLOAT;
    } else if (ckt.CKTmode & MODEINITPRED) {
      ckt.CKTmode = (ckt.CKTmode & ~INITF) | MODEINITFLOAT;
    } else {
      ckt.CKTstat.STATnumIter += iterno;
      return niFail(ckt, E_PANIC, 'NIiter', 'bad initf state');
    }

    const temp = ckt.CKTrhsOld;
    ckt.CKTrhsOld = ckt.CKTrhs;
    ckt.CKTrhs = temp;
  }
}

/**
 * NIacIter — комплексная итерация AC (порт XSPICE `NIacIter.c`).
 *
 * Матрица уже факторизована/переупорядочена в комплексном режиме; при
 * `E_SINGULAR` — как в C — выставляется `NIACSHOULDREORDER` и попытка
 * повторяется с переупорядочиванием. После решения `RHS` и `iRHS` меняются
 * местами с `Old` (устройства и `CKTacDump` читают именно `Old`).
 *
 * @param {object} ckt
 * @returns {number} OK / E_SINGULAR / E_BADMATRIX
 */
export function niAcIter(ckt) {
  for (;;) {
    ckt.CKTnoncon = 0;

    const loadError = cktAcLoad(ckt);
    if (loadError) return loadError;

    let error;
    if (ckt.CKTniState & NIACSHOULDREORDER) {
      error = SMPcReorder(ckt.CKTmatrix, ckt.CKTpivotAbsTol, ckt.CKTpivotRelTol);
      ckt.CKTniState &= ~NIACSHOULDREORDER;
      if (error) return error;
    } else {
      error = SMPcLUfac(ckt.CKTmatrix, ckt.CKTpivotAbsTol);
      if (error) {
        if (error === E_SINGULAR) {
          ckt.CKTniState |= NIACSHOULDREORDER;
          continue;
        }
        return error;
      }
    }

    SMPcSolve(
      ckt.CKTmatrix,
      ckt.CKTrhs,
      ckt.CKTirhs,
      ckt.CKTrhsSpare,
      ckt.CKTirhsSpare,
    );

    ckt.CKTrhs[0] = 0;
    ckt.CKTrhsSpare[0] = 0;
    ckt.CKTrhsOld[0] = 0;
    ckt.CKTirhs[0] = 0;
    ckt.CKTirhsSpare[0] = 0;
    ckt.CKTirhsOld[0] = 0;

    let temp = ckt.CKTirhsOld;
    ckt.CKTirhsOld = ckt.CKTirhs;
    ckt.CKTirhs = temp;

    temp = ckt.CKTrhsOld;
    ckt.CKTrhsOld = ckt.CKTrhs;
    ckt.CKTrhs = temp;

    return OK;
  }
}

/**
 * NIconvTest — критерий сходимости (порт XSPICE `NIconvTest.c`).
 *
 * Для узлов (`type == SP_VOLTAGE == 3`) порог — `reltol*max(|old|,|new|)+vntol`,
 * для ветвей — `reltol*max(|old|,|new|)+abstol`. XSPICE не выставляет
 * `CKTtroubleNode`/`CKTtroubleElt` (диагностика ушла в `ENHreport_conv_prob`),
 * поэтому и мы их не трогаем — Q-N01.
 *
 * @param {object} ckt
 * @returns {number} 1 — не сошлось, 0 — сошлось
 */
export function niConvTest(ckt) {
  const size = SMPmatSize(ckt.CKTmatrix);
  let node = ckt.CKTnodes;
  for (let i = 1; i <= size; i++) {
    node = node.next;
    const nw = ckt.CKTrhs[i];
    const old = ckt.CKTrhsOld[i];
    const tol =
      node.type === SP_VOLTAGE
        ? ckt.CKTreltol * Math.max(Math.abs(old), Math.abs(nw)) + ckt.CKTvoltTol
        : ckt.CKTreltol * Math.max(Math.abs(old), Math.abs(nw)) + ckt.CKTabstol;
    if (Math.abs(nw - old) > tol) return 1;
  }
  return cktConvTest(ckt);
}

/**
 * NIcomCof — коэффициенты интеграции на текущем шаге (порт `nicomcof.c`).
 *
 * Заполняет `ckt.CKTag[0..6]`. Ветка `PREDICTOR` (`CKTagp`) не компилируется
 * в DLL и здесь отсутствует.
 *
 * @param {object} ckt
 * @returns {number} OK / E_ORDER / E_METHOD
 */
export function niComCof(ckt) {
  const mat = Array.from({ length: 8 }, () => new Float64Array(8));
  const tag = ckt.CKTag;

  switch (ckt.CKTintegrateMethod) {
    case TRAPEZOIDAL: {
      // TRAPEZOIDAL
      switch (ckt.CKTorder) {
        case 1:
          tag[0] = 1 / ckt.CKTdelta;
          tag[1] = -1 / ckt.CKTdelta;
          break;
        case 2:
          // В C стоит `.5` вместо `xmu` — воспроизводим как есть.
          tag[0] = 1.0 / ckt.CKTdelta / (1.0 - 0.5);
          tag[1] = 0.5 / (1.0 - 0.5);
          break;
        default:
          return niFail(ckt, E_ORDER, 'NIcomCof', 'Illegal integration order');
      }
      break;
    }

    case GEAR: {
      // GEAR: порядок 1 в C «проваливается» в общий LU-алгоритм.
      switch (ckt.CKTorder) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6: {
          tag.fill(0, 0, 7);
          tag[1] = -1 / ckt.CKTdelta;

          // Матрица разностей: строка 0 — единицы, столбец 0 — нули.
          for (let i = 0; i <= ckt.CKTorder; i++) mat[0][i] = 1;
          for (let i = 1; i <= ckt.CKTorder; i++) mat[i][0] = 0;

          let arg = 0;
          for (let i = 1; i <= ckt.CKTorder; i++) {
            arg += ckt.CKTdeltaOld[i - 1];
            let arg1 = 1;
            for (let j = 1; j <= ckt.CKTorder; j++) {
              arg1 *= arg / ckt.CKTdelta;
              mat[j][i] = arg1;
            }
          }

          // LU-разложение (первый столбец 1 0 0 … — цикл с единицы).
          for (let i = 1; i <= ckt.CKTorder; i++) {
            for (let j = i + 1; j <= ckt.CKTorder; j++) {
              mat[j][i] /= mat[i][i];
              for (let k = i + 1; k <= ckt.CKTorder; k++) {
                mat[j][k] -= mat[j][i] * mat[i][k];
              }
            }
          }
          // Прямая подстановка.
          for (let i = 1; i <= ckt.CKTorder; i++) {
            for (let j = i + 1; j <= ckt.CKTorder; j++) {
              tag[j] = tag[j] - mat[j][i] * tag[i];
            }
          }
          // Обратная подстановка.
          tag[ckt.CKTorder] /= mat[ckt.CKTorder][ckt.CKTorder];
          for (let i = ckt.CKTorder - 1; i >= 0; i--) {
            for (let j = i + 1; j <= ckt.CKTorder; j++) {
              tag[i] = tag[i] - mat[i][j] * tag[j];
            }
            tag[i] /= mat[i][i];
          }
          break;
        }
        default:
          return niFail(ckt, E_ORDER, 'NIcomCof', 'Illegal integration order');
      }
      break;
    }

    default:
      return niFail(ckt, E_METHOD, 'NIcomCof', 'Unknown integration method');
  }
  return OK;
}

/**
 * NIintegrate — корректор реактивного элемента (порт `niinteg.c`).
 *
 * C: `NIintegrate(ckt, double *geq, double *ceq, double cap, int qcap)`;
 * JS возвращает `{ error, geq, ceq }`. `qcap` — индекс заряда в state-векторах,
 * `ccap = qcap + 1` — индекс тока.
 *
 * @param {object} ckt
 * @param {number} cap — ёмкость/индуктивность
 * @param {number} qcap — индекс заряда
 * @returns {{error:number, geq:number, ceq:number}}
 */
export function niIntegrate(ckt, cap, qcap) {
  const ccap = qcap + 1;
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];
  const tag = ckt.CKTag;

  switch (ckt.CKTintegrateMethod) {
    case TRAPEZOIDAL: {
      // TRAPEZOIDAL
      switch (ckt.CKTorder) {
        case 1:
          s0[ccap] = tag[0] * s0[qcap] + tag[1] * s1[qcap];
          break;
        case 2:
          s0[ccap] = -s1[ccap] * tag[1] + tag[0] * (s0[qcap] - s1[qcap]);
          break;
        default:
          return {
            error: niFail(ckt, E_ORDER, 'NIintegrate', 'Illegal integration order'),
            geq: 0,
            ceq: 0,
          };
      }
      break;
    }

    case GEAR: {
      // GEAR: сумма по старым состояниям (fall-through в C).
      switch (ckt.CKTorder) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6: {
          s0[ccap] = 0;
          for (let i = ckt.CKTorder; i >= 1; i--) {
            s0[ccap] += tag[i] * ckt.CKTstates[i][qcap];
          }
          s0[ccap] += tag[0] * s0[qcap];
          break;
        }
        default:
          return {
            error: niFail(ckt, E_ORDER, 'NIintegrate', 'Illegal integration order'),
            geq: 0,
            ceq: 0,
          };
      }
      break;
    }

    default:
      return {
        error: niFail(ckt, E_METHOD, 'NIintegrate', 'Unknown integration method'),
        geq: 0,
        ceq: 0,
      };
  }

  const ceq = s0[ccap] - tag[0] * s0[qcap];
  const geq = tag[0] * cap;
  return { error: OK, geq, ceq };
}
