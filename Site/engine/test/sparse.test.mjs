/**
 * sparse.test.mjs — юниты JS-порта Sparse 1.3 (Site/engine/spice/sparse.js).
 *
 * Проверяют математику и зафиксированные квирки предка БЕЗ C-эталона
 * (1:1-сверка с C из vendor/spice3f4 — в sparse-golden.test.mjs).
 * Числовые ожидания выведены аналитически (в комментариях) и подтверждены
 * прогоном C-драйвера там, где это важно для 1:1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sp from '../spice/sparse.js';

/** Заполнить матрицу: entries = [[row, col, real, imag?], ...]. */
function fill(m, entries) {
  for (const [r, c, re, im = 0] of entries) {
    const e = sp.spGetElement(m, r, c);
    e.real = re;
    e.imag = im;
  }
}

/** 1-based вектор из аргументов (как RHS в C-API). */
function vec(...values) {
  const v = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) v[i + 1] = values[i];
  return v;
}

/** Вынуть n значений из 1-based массива. */
function vals(v, n) {
  return Array.from({ length: n }, (_, i) => v[i + 1]);
}

/** Сравнение с допуском (относительным, с полом 1e-12). */
function closeTo(actual, expected, eps = 1e-12, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${msg}: ожидалось ${expected}, получено ${actual}`,
  );
}

/** Строки элементов столбца (порядок цепочки — как в C). */
function colRows(m, col) {
  const rows = [];
  for (let e = m.firstInCol[col]; e !== null; e = e.nextInCol) rows.push(e.row);
  return rows;
}

// ─────────────────────────────── ЛИНЕЙНАЯ АЛГЕБРА (реальная) ───────────────────────────────

test('sparse: делитель 3x3 — solve/детерминант/ошибки', () => {
  // A = [[2,1,0],[1,3,1],[0,1,4]], b = [1,2,3].
  // x = 1/18 * [11,-4,1; -4,8,-2; 1,-2,5] * b = [1/3, 1/3, 2/3]; det = 18.
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 2], [1, 2, 1], [2, 1, 1], [2, 2, 3], [2, 3, 1], [3, 2, 1], [3, 3, 4]]);
  assert.equal(sp.spOrderAndFactor(m, null, 1e-3, 0, true), sp.spOKAY);
  assert.equal(sp.spError(m), sp.spOKAY);
  assert.equal(m.factored, true);
  assert.equal(sp.spElementCount(m), 7, 'элементов без fill-in');
  assert.equal(sp.spFillinCount(m), 0, 'fill-in не требуется');

  const rhs = vec(1, 2, 3);
  sp.spSolve(m, rhs, rhs);
  closeTo(rhs[1], 1 / 3, 1e-12, 'x1');
  closeTo(rhs[2], 1 / 3, 1e-12, 'x2');
  closeTo(rhs[3], 2 / 3, 1e-12, 'x3');

  // C-драйвер: det 1 1.8 0 → мантисса 1.8, экспонента 1.
  const d = sp.spDeterminant(m);
  assert.equal(d.exponent, 1, 'экспонента детерминанта');
  closeTo(d.real, 1.8, 1e-12, 'мантисса детерминанта');
  assert.equal(d.imag, 0);

  const w = sp.spWhereSingular(m);
  assert.deepEqual(w, { row: 0, col: 0 }, 'нет вырождения');
});

test('sparse: Transposed-решение 3x3', () => {
  // A^T = [[2,1,0],[1,3,1],[0,1,4]] (матрица симметрична) — решение то же.
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 2], [1, 2, 1], [2, 1, 1], [2, 2, 3], [2, 3, 1], [3, 2, 1], [3, 3, 4]]);
  assert.equal(sp.spOrderAndFactor(m, null, 1e-3, 0, true), sp.spOKAY);
  const rhs = vec(1, 0, 1);
  sp.spSolveTransposed(m, rhs, rhs);
  // x = 1/18 * [11,-4,1; -4,8,-2; 1,-2,5] * [1,0,1] = [12/18, -6/18, 6/18].
  closeTo(rhs[1], 12 / 18, 1e-12, 'x1');
  closeTo(rhs[2], -6 / 18, 1e-12, 'x2');
  closeTo(rhs[3], 6 / 18, 1e-12, 'x3');
});

test('sparse: multiply / multTransposed — сверка с плотным умножением', () => {
  // Несимметричная матрица (сингулярная не важна для умножения).
  const A = [
    [4, -2, 0, 0],
    [-1, 5, 1, 0],
    [0, 2, 6, -3],
    [0, 0, 1, 7],
  ];
  const x = [1, -2, 3, 0.5];
  const dense = (mat, vector) => mat.map((row) => row.reduce((s, v, j) => s + v * vector[j], 0));
  const denseT = (mat, vector) =>
    Array.from({ length: vector.length }, (_, i) => mat.reduce((s, row, r) => s + row[i] * vector[r], 0));

  const m = sp.spCreate(4, 0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (A[r][c] !== 0) fill(m, [[r + 1, c + 1, A[r][c]]]);
    }
  }

  const bx = vec(...x);
  const ax = new Float64Array(5);
  sp.spMultiply(m, ax, bx);
  vals(ax, 4).forEach((v, i) => closeTo(v, dense(A, x)[i], 1e-12, `(A*x)[${i}]`));

  const atx = new Float64Array(5);
  sp.spMultTransposed(m, atx, bx);
  vals(atx, 4).forEach((v, i) => closeTo(v, denseT(A, x)[i], 1e-12, `(A^T*x)[${i}]`));
});

// ─────────────────────────────── ЛИНЕЙНАЯ АЛГЕБРА (комплексная) ───────────────────────────────

test('sparse: комплексный AC — solve/transposed/детерминант', () => {
  // A = [[1+2i, 3-1i], [-2+1i, 4+5i]], det = -1+8i.
  // A^-1 = 1/det * [[4+5i, -3+i], [2-i, 1+2i]].
  const m = sp.spCreate(2, 0);
  fill(m, [[1, 1, 1, 2], [1, 2, 3, -1], [2, 1, -2, 1], [2, 2, 4, 5]]);
  assert.equal(sp.SMPcReorder(m, 1e-13, 1e-3), sp.spOKAY);

  // b = (1, i): x1 = (3+2i)/(−1+8i) = 0.2 − 0.4i; x2 = 0.
  let rhs = vec(1, 0);
  let irhs = vec(0, 1);
  const sol = new Float64Array(3);
  const isol = new Float64Array(3);
  sp.spSolve(m, rhs, sol, irhs, isol);
  closeTo(sol[1], 0.2, 1e-12, 'Re x1');
  closeTo(isol[1], -0.4, 1e-12, 'Im x1');
  closeTo(sol[2], 0, 1e-12, 'Re x2');
  closeTo(isol[2], 0, 1e-12, 'Im x2');

  // A^T: x = (51−47i)/65, (21+38i)/65.
  rhs = vec(1, 0);
  irhs = vec(0, 1);
  sp.spSolveTransposed(m, rhs, sol, irhs, isol);
  closeTo(sol[1], 51 / 65, 1e-12, 'Re x1^T');
  closeTo(isol[1], -47 / 65, 1e-12, 'Im x1^T');
  closeTo(sol[2], 21 / 65, 1e-12, 'Re x2^T');
  closeTo(isol[2], 38 / 65, 1e-12, 'Im x2^T');

  // C-драйвер: det 0 -0.99999999999999911 8 → мантисса ≈ -1 + 8i.
  const d = sp.spDeterminant(m);
  assert.equal(d.exponent, 0);
  closeTo(d.real, -1, 1e-12, 'Re det');
  closeTo(d.imag, 8, 1e-12, 'Im det');

  // SMPcProdDiag (мантисса+экспонента) согласован с детерминантом.
  const pd = sp.SMPcProdDiag(m);
  assert.equal(pd.error, sp.spOKAY);
  closeTo(pd.real, -1, 1e-12, 'Re prodDiag');
  closeTo(pd.imag, 8, 1e-12, 'Im prodDiag');

  // SMPcDProd пересчитывает мантиссу в базу 2: mant * 2^exp ≈ det.
  const dp = sp.SMPcDProd(m);
  assert.equal(dp.error, sp.spOKAY);
  closeTo(dp.real * 2 ** dp.exponent, -1, 1e-9, 'Re DProd');
  closeTo(dp.imag * 2 ** dp.exponent, 8, 1e-9, 'Im DProd');

  // SMPcaSolve = spSolveTransposed (транспонированная система, in-place).
  rhs = vec(1, 0);
  irhs = vec(0, 1);
  sp.SMPcaSolve(m, rhs, irhs, new Float64Array(3), new Float64Array(3));
  closeTo(rhs[1], 51 / 65, 1e-12, 'Re caSolve x1');
  closeTo(rhs[2], 21 / 65, 1e-12, 'Re caSolve x2');
});

// ─────────────────────────────── ВЫРОЖДЕНИЯ И ОШИБКИ ───────────────────────────────

test('sparse: вырожденная матрица — spSINGULAR и where', () => {
  // [[1,2,0],[2,4,0],[0,0,0]] — строки 1/2 линейно зависимы, diag3 отсутствует.
  // C-драйвер: order 102, where 2 2.
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 1], [1, 2, 2], [2, 1, 2], [2, 2, 4], [3, 3, 0]]);
  assert.equal(sp.spOrderAndFactor(m, null, 1e-3, 0, true), sp.spSINGULAR);
  assert.equal(sp.spError(m), sp.spSINGULAR);
  assert.deepEqual(sp.spWhereSingular(m), { row: 2, col: 2 });
  const d = sp.spDeterminant(m);
  assert.equal(d.real, 0);
  assert.equal(d.exponent, 0);
});

test('sparse: spFactor — перестановка строк при нулевой диагонали', () => {
  // [[0,1],[1,0]] невырождена: spFactor сам меняет строки; x из b=[1,0] — [0,1].
  const m = sp.spCreate(2, 0);
  fill(m, [[1, 2, 1], [2, 1, 1]]);
  assert.equal(sp.spFactor(m), sp.spOKAY);
  const b = vec(1, 0);
  sp.spSolve(m, b, b);
  closeTo(b[1], 0, 1e-12, 'x1');
  closeTo(b[2], 1, 1e-12, 'x2');
});

test('sparse: spFactor — нулевой пивот даёт spZERO_DIAG', () => {
  // [[1,2],[0,0]]: столбец 2 пуст, диагональ 2 отсутствует. C-драйвер: 102, where 2 2.
  const m = sp.spCreate(2, 0);
  fill(m, [[1, 1, 1], [1, 2, 2]]);
  assert.equal(sp.spFactor(m), sp.spZERO_DIAG);
  assert.deepEqual(sp.spWhereSingular(m), { row: 2, col: 2 });
});

test('sparse: SMPluFac(gmin) спасает нулевую диагональ', () => {
  // [[0,0],[0,1]] + gmin=1e-12 на диагональ: x1 = 1/1e-12 = 1e12 (C-драйвер: 1000000000000).
  const m = sp.spCreate(2, 0);
  fill(m, [[1, 1, 0], [2, 2, 1]]);
  assert.equal(sp.SMPluFac(m, 1e-13, 1e-12), sp.spOKAY);
  const b = vec(1, 0);
  sp.SMPsolve(m, b, null);
  closeTo(b[1], 1e12, 1e-9, 'x1');
  assert.equal(b[2], 0);
});

// ─────────────────────────────── КВИРКИ ПРЕДКА ───────────────────────────────

test('sparse: MNA-Preorder — пары близнецов, карты и Diag', () => {
  // Классическая MNA: две пары ±1-близнецов в столбцах без диагонали.
  // C-драйвер: i2e-col = [3,4,1,2] (два свапа), все Diag — ±1, элементов 10.
  const m = sp.spCreate(4, 0);
  fill(m, [
    [1, 1, 1], [2, 2, 1],
    [3, 1, 1], [3, 2, -1],
    [1, 3, 1], [2, 3, -1],
    [4, 2, 1], [4, 1, -1],
    [2, 4, 1], [1, 4, -1],
  ]);
  sp.spMNA_Preorder(m);
  assert.equal(m.reordered, true);
  assert.equal(m.rowsLinked, false, 'preorder строки не линкует');
  assert.equal(m.numberOfInterchangesIsOdd, false, 'два свапа — чётно');
  assert.equal(sp.spElementCount(m), 10);

  assert.deepEqual(Array.from({ length: 4 }, (_, i) => m.intToExtColMap[i + 1]), [3, 4, 1, 2]);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => m.extToIntColMap[i]), [0, 3, 4, 1, 2]);

  for (let j = 1; j <= 4; j++) {
    assert.notEqual(m.diag[j], null, `Diag[${j}] заполнен`);
    assert.equal(m.diag[j].row, j);
    closeTo(m.diag[j].real, 1, 1e-12, `Diag[${j}].Real`);
  }

  // Матрица структурно вырождена (строка 4 = −строка 3) — order честно даёт 102.
  assert.equal(sp.spOrderAndFactor(m, null, 1e-3, 0, true), sp.spSINGULAR);
});

test('sparse: SMPfindElt — «отцепленная» вставка в голову столбца (квирк 1:1)', () => {
  // В C SMPfindElt передаёт в spcFindElementInCol адрес ЛОКАЛЬНОЙ переменной:
  // вставка «в голову» не попадает в FirstInCol, но учитывается в Elements/Diag.
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 5], [2, 1, 3], [3, 2, 7]]);

  const el = sp.SMPfindElt(m, 2, 2, true);
  assert.notEqual(el, null);
  assert.equal(el.row, 2);
  assert.equal(sp.spElementCount(m), 4, 'элемент учтён в счётчике');
  assert.equal(m.diag[2], el, 'диагональный — попал в Diag');
  assert.deepEqual(colRows(m, 2), [3], 'но в цепочке столбца его нет');
  assert.equal(sp.SMPfindElt(m, 2, 2, false), null, 'повторный поиск по цепочке не находит');
  assert.equal(sp.spGetElement(m, 2, 2), el, 'diag-ярлык spGetElement его видит');

  // Вставка «в середину» связывается по-настоящему (слот — поле NextInCol).
  // NB: SMPfindElt в F4 работает с ВНУТРЕННИМИ номерами (без трансляции), поэтому
  // строим матрицу так, чтобы внешние 1,2,3 получили внутренние 1,2,3 (узлы
  // заводятся в порядке появления; (2,2) — «заглушка» для узла 2).
  const m2 = sp.spCreate(3, 0);
  fill(m2, [[1, 1, 1], [2, 2, 9], [3, 1, 3]]);
  const mid = sp.SMPfindElt(m2, 2, 1, true);
  assert.notEqual(mid, null);
  assert.deepEqual(colRows(m2, 1), [1, 2, 3]);
  assert.equal(sp.spElementCount(m2), 4);
  assert.equal(sp.spGetElement(m2, 2, 1), mid, 'spGetElement находит вставленный');

  // ZeroCol/ZeroRow не видят отцепленный элемент (его нет в цепочках).
  el.real = 42;
  sp.SMPcZeroCol(m, 2);
  assert.equal(m.firstInCol[2].real, 0, 'привязанный (3,2) обнулён');
  assert.equal(el.real, 42, 'отцепленный не тронут');
  sp.SMPzeroRow(m, 2);
  assert.equal(m.rowsLinked, true, 'zeroRow линкует строки');
  assert.equal(sp.spGetElement(m, 2, 1).real, 0, 'привязанный (2,1) обнулён');
  assert.equal(el.real, 42, 'отцепленный снова не тронут');
  assert.deepEqual(colRows(m, 2), [3]);
});

test('sparse: SMPcAddCol — сложение столбцов со вставкой элементов', () => {
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 5], [2, 1, 3], [3, 2, 7]]);
  assert.equal(sp.SMPcAddCol(m, 2, 1), sp.spOKAY);
  assert.deepEqual(colRows(m, 2), [1, 2, 3], 'элементы добавлены по порядку Row');
  closeTo(m.firstInCol[2].real, 5, 1e-12, '(1,2)');
  closeTo(m.firstInCol[2].nextInCol.real, 3, 1e-12, '(2,2)');
  closeTo(m.firstInCol[2].nextInCol.nextInCol.real, 7, 1e-12, '(3,2)');
  assert.equal(sp.spElementCount(m), 5);

  // Обнуление столбца-источника не портит результат сложения.
  sp.SMPcZeroCol(m, 1);
  closeTo(m.firstInCol[2].real, 5, 1e-12, '(1,2) не задет');
});

// ─────────────────────────────── ЖИЗНЕННЫЙ ЦИКЛ / SMP-ОБВЯЗКА ───────────────────────────────

test('sparse: clear → lu → solve в цикле (структура сохраняется)', () => {
  const m = sp.spCreate(3, 0);
  fill(m, [[1, 1, 2], [2, 2, 3], [3, 3, 4]]);
  const diag1 = m.diag[1];
  assert.equal(sp.SMPluFac(m, 1e-13, 1e-12), sp.spOKAY);

  let b = vec(2, 3, 4);
  sp.SMPsolve(m, b, null);
  for (let i = 1; i <= 3; i++) closeTo(b[i], 1, 1e-9, `x${i} итерация 1`);

  sp.spClear(m);
  assert.equal(sp.spError(m), sp.spOKAY);
  assert.equal(sp.spElementCount(m), 3, 'структура не разрушена');
  assert.equal(m.diag[1], diag1, 'элементы те же');
  assert.equal(m.factored, false);

  fill(m, [[1, 1, 5], [2, 2, 6], [3, 3, 7]]);
  assert.equal(sp.SMPluFac(m, 1e-13, 1e-12), sp.spOKAY);
  b = vec(5, 12, 21);
  sp.SMPsolve(m, b, null);
  for (let i = 1; i <= 3; i++) closeTo(b[i], i, 1e-9, `x${i} итерация 2`);
});

test('sparse: SMPnewMatrix + SMPmakeElt — рост матрицы с нуля', () => {
  const m = sp.SMPnewMatrix();
  assert.equal(sp.SMPmatSize(m), 0);
  const e = sp.SMPmakeElt(m, 2, 2);
  e.real = 7;
  assert.equal(sp.SMPmatSize(m), 2, 'внешний размер вырос до узла');
  assert.equal(e.row, 1, 'внутренний индекс — 1');
  assert.equal(m.diag[1], e);
  assert.equal(sp.spError(m), sp.spOKAY);
  assert.equal(sp.spGetElement(m, 0, 5), m.trashCan, 'нулевой индекс → TrashCan');
});

test('sparse: константы ошибок и spError(null)', () => {
  assert.equal(sp.spOKAY, 0);
  assert.equal(sp.spSINGULAR, 102);
  assert.equal(sp.spZERO_DIAG, 102);
  assert.equal(sp.spNO_MEMORY, 8);
  assert.equal(sp.spFATAL, 101);
  assert.equal(sp.spError(null), sp.spNO_MEMORY);
});
