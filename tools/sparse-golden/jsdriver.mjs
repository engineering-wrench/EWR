/**
 * jsdriver.mjs — интерпретатор скриптов golden-драйвера для JS-порта Sparse 1.3
 * (Site/engine/spice/sparse.js). Зеркало tools/sparse-golden/driver.c: те же
 * команды, тот же формат вывода. Используется тестом
 * Site/engine/test/sparse-golden.test.mjs для 1:1 сверки с C-эталоном.
 *
 * Не часть движка: только тестовый tooling.
 */
import * as sp from '../../Site/engine/spice/sparse.js';

/** Формат числа как в C "%.17g" (round-trip), но с sign-of-zero. */
function pv(v) {
  if (typeof v !== 'number') return ` ${v}`;
  if (Number.isNaN(v)) return ' nan';
  if (v === Infinity) return ' inf';
  if (v === -Infinity) return ' -inf';
  if (Object.is(v, -0)) return ' -0';
  return ` ${v.toPrecision(17)}`;
}

/** Структурный дамп матрицы (зеркало dumpMatrix в driver.c). */
function dumpMatrix(m) {
  const out = [];
  if (!m) return ['P null'];
  // Col до spcLinkRows в C не инициализирован (release) — нормализуем к 0,
  // чтобы сверка была детерминированной (см. комментарий в driver.c).
  const colOf = (e) => (m.rowsLinked ? e.col : 0);
  out.push(`P size ${m.size}`);
  out.push(`P extsize ${m.extSize}`);
  out.push(`P complex ${m.complex ? 1 : 0}`);
  out.push(
    `P flags ${m.factored ? 1 : 0} ${m.needsOrdering ? 1 : 0} ${m.reordered ? 1 : 0} ` +
      `${m.numberOfInterchangesIsOdd ? 1 : 0} ${m.rowsLinked ? 1 : 0} ${m.partitioned ? 1 : 0} ` +
      `${m.elements} ${m.fillins} ${m.singletons} ${m.currentSize}`,
  );
  out.push(`P pivotmethod ${m.pivotSelectionMethod ? m.pivotSelectionMethod : '-'}`);
  let s = 'P i2e-row';
  for (let i = 1; i <= m.size; i++) s += ` ${m.intToExtRowMap[i]}`;
  out.push(s);
  s = 'P i2e-col';
  for (let i = 1; i <= m.size; i++) s += ` ${m.intToExtColMap[i]}`;
  out.push(s);
  s = 'P e2i-row';
  for (let i = 0; i <= m.extSize; i++) s += ` ${m.extToIntRowMap[i]}`;
  out.push(s);
  s = 'P e2i-col';
  for (let i = 0; i <= m.extSize; i++) s += ` ${m.extToIntColMap[i]}`;
  out.push(s);
  for (let i = 1; i <= m.size; i++) {
    const e = m.diag[i];
    if (e === null || e === undefined) out.push(`P diag ${i} null`);
    else out.push(`P diag ${i} ${e.row} ${colOf(e)}${pv(e.real)}${pv(e.imag)}`);
  }
  for (let i = 1; i <= m.size; i++) {
    let line = `P col ${i}`;
    for (let e = m.firstInCol[i]; e !== null; e = e.nextInCol) {
      line += ` | ${e.row} ${colOf(e)}${pv(e.real)}${pv(e.imag)}`;
    }
    out.push(line);
  }
  for (let i = 1; i <= m.size; i++) {
    let line = `P row ${i}`;
    for (let e = m.firstInRow[i]; e !== null; e = e.nextInRow) {
      line += ` | ${e.row} ${colOf(e)}${pv(e.real)}${pv(e.imag)}`;
    }
    out.push(line);
  }
  return out;
}

/** Разбор строки чисел начиная с токена index (0-based). */
function nums(tokens, from) {
  return tokens.slice(from).map((t) => Number(t));
}

/**
 * Выполнить скрипт (массив строк) против sparse.js, собрать вывод —
 * построчно как driver.c.
 */
export function runJsScript(script) {
  const out = [];
  let m = null;
  for (const raw of script) {
    const line = raw.trim();
    if (line === '') continue;
    const tokens = line.split(/\s+/);
    const cmd = tokens[0];
    if (cmd === 'new') {
      m = sp.spCreate(Number(tokens[1]), Number(tokens[2]));
      out.push(`new ${m ? 'ok' : 'null'} ${sp.spError(m)}`);
    } else if (cmd === 'add') {
      const e = sp.spGetElement(m, Number(tokens[1]), Number(tokens[2]));
      if (e === null) out.push('add null');
      else {
        e.real = Number(tokens[3]);
        e.imag = Number(tokens[4]);
        out.push(`add ok ${sp.spError(m)}`);
      }
    } else if (cmd === 'preorder') {
      sp.spMNA_Preorder(m);
      out.push(`preorder ${sp.spError(m)}`);
    } else if (cmd === 'order') {
      out.push(`order ${sp.spOrderAndFactor(m, null, Number(tokens[1]), Number(tokens[2]), !!Number(tokens[3]))}`);
    } else if (cmd === 'factor') {
      out.push(`factor ${sp.spFactor(m)}`);
    } else if (cmd === 'lu') {
      out.push(`lu ${sp.SMPluFac(m, Number(tokens[1]), Number(tokens[2]))}`);
    } else if (cmd === 'clu') {
      out.push(`clu ${sp.SMPcLUfac(m, Number(tokens[1]))}`);
    } else if (cmd === 'reorder') {
      out.push(`reorder ${sp.SMPreorder(m, Number(tokens[1]), Number(tokens[2]), Number(tokens[3]))}`);
    } else if (cmd === 'creorder') {
      out.push(`creorder ${sp.SMPcReorder(m, Number(tokens[1]), Number(tokens[2]))}`);
    } else if (cmd === 'setreal') {
      sp.spSetReal(m);
      out.push(`setreal ${sp.spError(m)}`);
    } else if (cmd === 'setcomplex') {
      sp.spSetComplex(m);
      out.push(`setcomplex ${sp.spError(m)}`);
    } else if (cmd === 'clear') {
      sp.spClear(m);
      out.push(`clear ${sp.spError(m)}`);
    } else if (cmd === 'solve' || cmd === 'solveT') {
      const n = Number(tokens[1]);
      const rhs = new Float64Array(n + 1);
      const vals = nums(tokens, 2);
      for (let i = 1; i <= n; i++) rhs[i] = vals[i - 1];
      if (cmd === 'solveT') sp.spSolveTransposed(m, rhs, rhs, null, null);
      else sp.spSolve(m, rhs, rhs, null, null);
      let line2 = `${cmd} ${n}`;
      for (let i = 1; i <= n; i++) line2 += pv(rhs[i]);
      out.push(line2);
    } else if (cmd === 'csolve' || cmd === 'csolveT') {
      const n = Number(tokens[1]);
      const rhs = new Float64Array(n + 1);
      const iarr = new Float64Array(n + 1);
      const vals = nums(tokens, 2);
      for (let i = 1; i <= n; i++) rhs[i] = vals[i - 1];
      for (let i = 1; i <= n; i++) iarr[i] = vals[n + i - 1];
      if (cmd === 'csolveT') sp.spSolveTransposed(m, rhs, rhs, iarr, iarr);
      else sp.spSolve(m, rhs, rhs, iarr, iarr);
      let line2 = `${cmd} ${n}`;
      for (let i = 1; i <= n; i++) line2 += pv(rhs[i]);
      for (let i = 1; i <= n; i++) line2 += pv(iarr[i]);
      out.push(line2);
    } else if (cmd === 'mult' || cmd === 'multT') {
      const n = Number(tokens[1]);
      const rhs = new Float64Array(n + 1);
      const sol = new Float64Array(n + 1);
      const vals = nums(tokens, 2);
      for (let i = 1; i <= n; i++) sol[i] = vals[i - 1];
      if (cmd === 'multT') sp.spMultTransposed(m, rhs, sol, null, null);
      else sp.spMultiply(m, rhs, sol, null, null);
      let line2 = `${cmd} ${n}`;
      for (let i = 1; i <= n; i++) line2 += pv(rhs[i]);
      out.push(line2);
    } else if (cmd === 'cmult' || cmd === 'cmultT') {
      const n = Number(tokens[1]);
      const rhs = new Float64Array(n + 1);
      const iarr = new Float64Array(n + 1);
      const sol = new Float64Array(n + 1);
      const isl = new Float64Array(n + 1);
      const vals = nums(tokens, 2);
      for (let i = 1; i <= n; i++) sol[i] = vals[i - 1];
      for (let i = 1; i <= n; i++) isl[i] = vals[n + i - 1];
      if (cmd === 'cmultT') sp.spMultTransposed(m, rhs, sol, iarr, isl);
      else sp.spMultiply(m, rhs, sol, iarr, isl);
      let line2 = `${cmd} ${n}`;
      for (let i = 1; i <= n; i++) line2 += pv(rhs[i]);
      for (let i = 1; i <= n; i++) line2 += pv(iarr[i]);
      out.push(line2);
    } else if (cmd === 'casolve') {
      const n = Number(tokens[1]);
      const rhs = new Float64Array(n + 1);
      const iarr = new Float64Array(n + 1);
      const spare = new Float64Array(n + 1);
      const ispare = new Float64Array(n + 1);
      const vals = nums(tokens, 2);
      for (let i = 1; i <= n; i++) rhs[i] = vals[i - 1];
      for (let i = 1; i <= n; i++) iarr[i] = vals[n + i - 1];
      sp.SMPcaSolve(m, rhs, iarr, spare, ispare);
      let line2 = `casolve ${n}`;
      for (let i = 1; i <= n; i++) line2 += pv(rhs[i]);
      for (let i = 1; i <= n; i++) line2 += pv(iarr[i]);
      out.push(line2);
    } else if (cmd === 'det') {
      const d = sp.spDeterminant(m);
      out.push(`det ${d.exponent}${pv(d.real)}${pv(d.imag)} ${sp.spError(m)}`);
    } else if (cmd === 'cdprod') {
      const r = sp.SMPcDProd(m);
      out.push(`cdprod ${r.error} ${r.exponent}${pv(r.real)}${pv(r.imag)}`);
    } else if (cmd === 'prodDiag') {
      const r = sp.SMPcProdDiag(m);
      out.push(`prodDiag ${r.error} ${r.exponent}${pv(r.real)}${pv(r.imag)}`);
    } else if (cmd === 'err') {
      out.push(`err ${sp.spError(m)}`);
    } else if (cmd === 'where') {
      const w = sp.spWhereSingular(m);
      out.push(`where ${w.row} ${w.col}`);
    } else if (cmd === 'size') {
      out.push(`size ${sp.SMPmatSize(m)}`);
    } else if (cmd === 'getsizereal') {
      out.push(`getsizereal ${sp.spGetSize(m, 0)}`);
    } else if (cmd === 'elements') {
      out.push(`elements ${sp.spElementCount(m)}`);
    } else if (cmd === 'fillins') {
      out.push(`fillins ${sp.spFillinCount(m)}`);
    } else if (cmd === 'find') {
      const e = sp.SMPfindElt(m, Number(tokens[1]), Number(tokens[2]), !!Number(tokens[3]));
      if (e === null) out.push('find null');
      else out.push(`find ${e.row} ${e.col}${pv(e.real)}${pv(e.imag)}`);
    } else if (cmd === 'zerocol') {
      out.push(`zerocol ${sp.SMPcZeroCol(m, Number(tokens[1]))}`);
    } else if (cmd === 'addcol') {
      out.push(`addcol ${sp.SMPcAddCol(m, Number(tokens[1]), Number(tokens[2]))}`);
    } else if (cmd === 'zerorow') {
      out.push(`zerorow ${sp.SMPzeroRow(m, Number(tokens[1]))}`);
    } else if (cmd === 'preOrderSMP') {
      out.push(`preOrderSMP ${sp.SMPpreOrder(m)}`);
    } else if (cmd === 'matsize') {
      out.push(`matsize ${sp.SMPmatSize(m)}`);
    } else if (cmd === 'geterrorSMP') {
      const w = sp.SMPgetError(m);
      out.push(`geterrorSMP ${w.row} ${w.col}`);
    } else if (cmd === 'print') {
      out.push(...dumpMatrix(m));
    } else if (cmd === 'destroy') {
      sp.spDestroy(m);
      m = null;
      out.push('destroy');
    } else if (cmd === 'quit') {
      out.push('quit');
      break;
    } else {
      out.push(`unknown ${cmd}`);
    }
  }
  return out;
}
