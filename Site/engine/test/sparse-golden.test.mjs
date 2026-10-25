/**
 * sparse-golden.test.mjs — 1:1 golden-сверка JS-порта Sparse 1.3
 * (Site/engine/spice/sparse.js) с C-эталоном из vendor/spice3f4.
 *
 * Один и тот же скрипт команд исполняется C-драйвером
 * (tools/sparse-golden/driver.c) и JS-интерпретатором
 * (tools/sparse-golden/jsdriver.mjs); выводы сравниваются бит-в-бит
 * (double), включая структуру матрицы, карты перестановок и pivot-выборы.
 *
 * Self-skip: нет gcc или vendor/spice3f4 — тесты пропускаются.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { goldenAvailable, buildGoldenDriver, runGoldenScript } from '../../../tools/sparse-golden/build.mjs';
import { runJsScript } from '../../../tools/sparse-golden/jsdriver.mjs';
import { compareGolden } from '../../../tools/sparse-golden/compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const available = goldenAvailable();
const outDir = join(root, '.tmp', 'sparse-golden');
let driverExe = null;

function getDriver() {
  if (driverExe === null) {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    driverExe = buildGoldenDriver(outDir);
  }
  return driverExe;
}

/** Прогнать скрипт через C и JS, вернуть расхождения. */
function goldenCheck(script) {
  const cLines = runGoldenScript(getDriver(), script);
  const jsLines = runJsScript(script);
  const problems = compareGolden(cLines, jsLines);
  if (problems.length) {
    assert.fail(
      `golden-расхождения (${problems.length}):\n` + problems.slice(0, 12).join('\n') + '\n--- скрипт ---\n' + script.join('\n'),
    );
  }
  return { cLines, jsLines };
}

/** Детерминированный PRNG (mulberry32) — одинаковые матрицы в C и JS. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Сгенерировать скрипт «new + add ...» для разреженной матрицы. */
function matrixScript(size, complex, rng, opts = {}) {
  const script = [`new ${size} ${complex}`];
  const density = opts.density ?? 0.35;
  for (let r = 1; r <= size; r++) {
    for (let c = 1; c <= size; c++) {
      const keep = r === c || rng() < density;
      if (!keep) continue;
      let v = Math.round((rng() * 20 - 10) * 8) / 8; // шаг 1/8
      if (opts.dominantDiag && r === c) v += 100;
      if (r === c && v === 0 && !opts.allowZeroDiag) v = 1;
      let im = 0;
      if (complex) im = Math.round((rng() * 20 - 10) * 8) / 8;
      script.push(`add ${r} ${c} ${v} ${im}`);
    }
  }
  return script;
}

const skip = !available ? { skip: 'нет gcc или vendor/spice3f4' } : {};

test('sparse golden: доступность C-эталона', skip, () => {
  const exe = getDriver();
  assert.ok(existsSync(exe), 'драйвер собран');
});

test('sparse golden: делитель напряжения 3x3 (real, полный цикл)', skip, () => {
  const script = [
    'new 3 0',
    'add 1 1 2 0',
    'add 1 2 1 0',
    'add 2 1 1 0',
    'add 2 2 3 0',
    'add 2 3 1 0',
    'add 3 2 1 0',
    'add 3 3 4 0',
    'print',
    'order 1e-3 0 1',
    'print',
    'solve 3 1 2 3',
    'det',
    'elements',
    'fillins',
    'clear',
    'lu 1e-13 1e-12',
    'print',
    'solve 3 1 2 3',
    'clu 1e-13',
    'csolve 3 1 2 3 0 0 0',
    'where',
    'err',
    'destroy',
    'quit',
  ];
  goldenCheck(script);
});

test('sparse golden: комплексный AC-делитель', skip, () => {
  const script = [
    'new 2 1',
    'add 1 1 1 2',
    'add 1 2 3 -1',
    'add 2 1 -2 1',
    'add 2 2 4 5',
    'print',
    'creorder 1e-13 1e-3',
    'print',
    'csolve 2 1 0 0 1',
    'csolveT 2 1 0 0 1',
    'casolve 2 1 0 0 1',
    'det',
    'prodDiag',
    'cdprod',
    'quit',
  ];
  goldenCheck(script);
});

test('sparse golden: случайные разреженные матрицы (real)', skip, () => {
  const rng = makeRng(0x5eed);
  for (let k = 0; k < 6; k++) {
    const size = 4 + k;
    const script = [
      ...matrixScript(size, false, rng, { density: 0.3, dominantDiag: k % 2 === 0 }),
      'print',
      'order 1e-3 0 1',
      'print',
      'solve ' + size + ' ' + Array.from({ length: size }, (_, i) => i + 1).join(' '),
      'solveT ' + size + ' ' + Array.from({ length: size }, (_, i) => (i % 3) - 1).join(' '),
      'det',
      'mult ' + size + ' ' + Array.from({ length: size }, (_, i) => i * 0.5 - 1).join(' '),
      'multT ' + size + ' ' + Array.from({ length: size }, (_, i) => i * 0.25 + 0.125).join(' '),
      'clear',
      'lu 1e-13 1e-12',
      'print',
      'solve ' + size + ' ' + Array.from({ length: size }, (_, i) => i + 1).join(' '),
      'quit',
    ];
    goldenCheck(script);
  }
});

test('sparse golden: случайные комплексные матрицы', skip, () => {
  const rng = makeRng(0xc0ffee);
  for (let k = 0; k < 4; k++) {
    const size = 3 + k * 2;
    const script = [
      ...matrixScript(size, true, rng, { density: 0.4, dominantDiag: true }),
      'order 1e-3 0 1',
      'print',
      'csolve ' + size + ' ' + Array.from({ length: size }, (_, i) => (i % 2 ? -1 : 1)).join(' ') + ' ' + Array.from({ length: size }, (_, i) => i * 0.5).join(' '),
      'cmult ' + size + ' ' + Array.from({ length: size }, (_, i) => i - 2).join(' ') + ' ' + Array.from({ length: size }, (_, i) => 1 - i * 0.25).join(' '),
      'cmultT ' + size + ' ' + Array.from({ length: size }, (_, i) => i - 2).join(' ') + ' ' + Array.from({ length: size }, (_, i) => 1 - i * 0.25).join(' '),
      'det',
      'quit',
    ];
    goldenCheck(script);
  }
});

test('sparse golden: singular (нулевая строка/столбец)', skip, () => {
  const script = [
    'new 3 0',
    'add 1 1 1 0',
    'add 1 2 2 0',
    'add 2 1 2 0',
    'add 2 2 4 0',
    'add 3 3 0 0',
    'order 1e-3 0 1',
    'where',
    'err',
    'print',
    'quit',
  ];
  goldenCheck(script);
});

test('sparse golden: нулевая диагональ на шаге 1 (spFactor)', skip, () => {
  const script = ['new 2 0', 'add 1 2 1 0', 'add 2 1 1 0', 'factor', 'where', 'err', 'quit'];
  goldenCheck(script);
});

test('sparse golden: MNA-Preorder (пары близнецов)', skip, () => {
  // Классическая MNA-структура: столбцы «токовых» ветвей без диагонали,
  // с ±1-близнецами в столбцах узлов. Второй прогон — две пары близнецов
  // (ветвит второй проход с квирком 1:1).
  const script = [
    'new 4 0',
    // узловая проводимость
    'add 1 1 1 0',
    'add 2 2 1 0',
    // источник напряжения между узлами 1-2: строка 3, столбцы 1/2; строка 1/2, столбец 3
    'add 3 1 1 0',
    'add 3 2 -1 0',
    'add 1 3 1 0',
    'add 2 3 -1 0',
    // вторая ветвь (токовая): строка 4, столбцы 2/1 (тоже близнецы)
    'add 4 2 1 0',
    'add 4 1 -1 0',
    'add 2 4 1 0',
    'add 1 4 -1 0',
    'print',
    'preorder',
    'print',
    'order 1e-3 0 1',
    'print',
    'solve 4 1 0 -1 0',
    'quit',
  ];
  goldenCheck(script);
});

test('sparse golden: findElt / zeroCol / addCol / zeroRow', skip, () => {
  const script = [
    'new 3 0',
    'add 1 1 5 0',
    'add 2 1 3 0',
    'add 3 2 7 0',
    'find 1 1 0',
    'find 2 1 0',
    'find 2 2 0',
    'find 2 2 1',
    'find 0 1 0',
    'zerocol 1',
    'print',
    'addcol 2 1',
    'print',
    'zerorow 2',
    'print',
    'geterrorSMP',
    'preOrderSMP',
    'matsize',
    'size',
    'getsizereal',
    'quit',
  ];
  goldenCheck(script);
});

test('sparse golden: lu-fac в цикле (clear → lu → solve)', skip, () => {
  const rng = makeRng(0xabc);
  const size = 6;
  const build = matrixScript(size, false, rng, { density: 0.5, dominantDiag: true });
  const script = [...build, 'lu 1e-13 1e-12', 'solve ' + size + ' ' + Array.from({ length: size }, (_, i) => i + 1).join(' ')];
  for (let k = 0; k < 3; k++) {
    script.push('clear');
    for (let r = 1; r <= size; r++) script.push(`add ${r} ${r} ${1 + r} 0`);
    script.push('lu 1e-13 1e-12');
    script.push('solve ' + size + ' ' + Array.from({ length: size }, (_, i) => size - i).join(' '));
  }
  script.push('quit');
  goldenCheck(script);
});
