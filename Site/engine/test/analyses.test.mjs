/**
 * analyses.test.mjs — паритет OP/TRAN с оракулом (P1.6).
 *
 * Проверяет порт драйверов `DCop`/`DCtran`/`CKTop` на корпусе
 * `tools/oracle/corpus/*.json` против снимков `tools/oracle/golden/*.json`:
 *  - значения OP/TRAN и статус сходимости — допуски §5 `PLAN-CLONE.md`;
 *  - сетка TRAN — с относительным допуском `timeRel` (Q-F01: x87 vs SSE);
 *  - два артефакта оракульного шима нормализуются: суффикс `#branch` и
 *    заглушки `<ewb-NNNN>` вместо строк WEWBMSG.RES (Q-O01/Q-O02).
 *
 * Числа не «подкручиваются»: допуск сетки обоснован измеренным максимумом
 * отклонения (см. `docs/re/engine-quirks.md`, Q-F01).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ckt from '../spice/ckt.js';
import { compareResults } from '../../../tools/oracle/compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const CORPUS = join(root, 'tools', 'oracle', 'corpus');
const GOLDEN = join(root, 'tools', 'oracle', 'golden');

/** Относительный допуск сетки TRAN (Q-F01: x87-цепочки в DLL). */
const TIME_REL = 1e-9;

/** Прочитать деку/эталон оракула. */
function readJson(dir, name) {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

/**
 * Собрать цепь по деке оракула и прогнать `CKTdoJob`.
 *
 * @param {object} deck — формат `tools/oracle/corpus/*.json`
 * @returns {{rc:number, c:object}}
 */
function runDeck(deck) {
  const { error, ckt: c } = ckt.cktInit();
  assert.equal(error, ckt.OK, 'CKTinit');

  const nodes = new Map();
  nodes.set('0', ckt.cktGround(c, '0').node);
  const ensureNode = (name) => {
    if (nodes.has(name)) return nodes.get(name);
    const created = ckt.cktNewNode(c, name);
    assert.equal(created.error, ckt.OK, `узел ${name}`);
    nodes.set(name, created.node);
    return created.node;
  };

  for (const el of deck.elements) {
    const type = ckt.cktDevIndex(el.dev);
    assert.ok(type >= 0, `устройство ${el.dev} есть в каталоге`);
    const model = ckt.cktModCrt(c, type, el.modelName ?? `${el.name}_mod`);
    assert.equal(model.error, ckt.OK, `модель ${el.name}`);
    const inst = ckt.cktCrtElt(c, model.model, el.name);
    assert.equal(inst.error, ckt.OK, `инстанс ${el.name}`);
    for (const [key, value] of Object.entries(el.modelParams ?? {})) {
      assert.equal(ckt.cktModParamByName(c, model.model, key, value), ckt.OK, `${el.name}.${key}`);
    }
    for (const [key, value] of Object.entries(el.params ?? {})) {
      assert.equal(ckt.cktParamByName(c, inst.instance, key, value), ckt.OK, `${el.name}.${key}`);
    }
    el.nodes.forEach((nodeName, i) => {
      assert.equal(
        ckt.cktBindNode(c, inst.instance, i + 1, ensureNode(nodeName)),
        ckt.OK,
        `${el.name} вывод ${i + 1}`,
      );
    });
  }

  const task = ckt.cktNewTask(c, 'task1').task;
  for (const an of deck.analyses) {
    const created = ckt.cktNewAnal(c, an.type, an.name, task);
    assert.equal(created.error, ckt.OK, `анализ ${an.name}`);
    for (const [key, value] of Object.entries(an.params ?? {})) {
      assert.equal(ckt.cktSetAnalPmByName(c, created.job, key, value), ckt.OK, `${an.type}.${key}`);
    }
  }

  return { rc: ckt.cktDoJob(c, 1, task), c };
}

/** Сообщения, которые оракул отдаёт заглушкой `<ewb-NNNN>`. */
const EWB_MESSAGES = new Map([
  ['V1: no DC value, transient time 0 value used', 1514],
]);

/** Канонический вид сообщения (Q-O01). */
function canonicalError(message) {
  const placeholder = /^<ewb-(\d+)>$/.exec(message);
  if (placeholder) return `EWB#${placeholder[1]}`;
  const id = EWB_MESSAGES.get(message);
  return id ? `EWB#${id}` : message;
}

/** Привести результат к виду, сопоставимому с эталоном оракула. */
function normalize(result) {
  return {
    ...result,
    errors: (result.errors ?? []).map((e) => ({ ...e, message: canonicalError(e.message) })),
    plots: (result.plots ?? []).map((p) => ({
      ...p,
      // Q-O02: IFnewUid шима не добавляет "#branch"; внутренний узел диода
      // (`D1#internal`) оракул печатает без суффикса.
      names: (p.names ?? []).map((n) => n.replace(/#(branch|internal)$/, '')),
    })),
  };
}

/** Прогнать деку и сравнить с эталоном. */
function compareDeck(name, tol = {}) {
  const deck = readJson(CORPUS, name);
  const { rc, c } = runDeck(deck);
  const actual = normalize({ doAnalyses_rc: rc, errors: c.CKTerrors, plots: c.CKTplots });
  const golden = normalize(readJson(GOLDEN, name));
  const { ok, diffs } = compareResults(golden, actual, tol);
  assert.ok(ok, `${name}: ${diffs.slice(0, 12).join('\n')}`);
  return { actual, c };
}

// ─────────────────────────── OP ───────────────────────────

test('analyses: op_divider — OP совпадает с оракулом', () => {
  const { actual } = compareDeck('op_divider');
  const point = actual.plots[0].points[0];
  assert.deepEqual(point.values, [5, 2.5, -0.0025]);
});

test('analyses: op_rc — OP конденсатора совпадает с оракулом', () => {
  const { actual } = compareDeck('op_rc');
  const point = actual.plots[0].points[0];
  assert.deepEqual(point.values, [5, 5, 0]);
});

// ─────────────────────────── AC ───────────────────────────

test('analyses: ac_rc — AC (комплексные значения) совпадает с оракулом', () => {
  const { actual } = compareDeck('ac_rc');

  const ac = actual.plots.find((p) => p.name === 'ac1');
  assert.ok(ac, 'plot ac1 есть');
  assert.equal(ac.dataType, 8, 'IF_COMPLEX');
  assert.equal(ac.refType, 4, 'частота — IF_REAL');
  assert.equal(ac.points.length, 10, 'numsteps точек (Q-A02)');
  // Q-A02: DLL считает LINEAR-шаг как (stop-start)/(numsteps-1).
  assert.equal(ac.points[0].ref, 10);
  assert.equal(ac.points[1].ref - ac.points[0].ref, 1110);
  assert.equal(ac.points[9].ref, 10000);

  // ФНЧ R=1 кОм, C=1 мкФ: H = 1/(1+j*2*pi*f*R*C).
  const rc = 1000 * 1e-6;
  for (const point of ac.points) {
    const w = 2 * Math.PI * point.ref;
    const den = 1 + w * w * rc * rc;
    const [re, im] = point.values[1];
    assert.ok(Math.abs(re - 1 / den) < 1e-9, `Re(H) на ${point.ref} Гц`);
    assert.ok(Math.abs(im + (w * rc) / den) < 1e-9, `Im(H) на ${point.ref} Гц`);
  }
});

test('analyses: AC-параметры по каталогу (set/ask round-trip)', () => {
  const { error, ckt: c } = ckt.cktInit();
  assert.equal(error, ckt.OK);
  const task = ckt.cktNewTask(c, 'task1').task;
  const { job } = ckt.cktNewAnal(c, 'AC', 'ac1', task);

  assert.equal(ckt.cktAnalParamIndex('AC', 'start'), 4);
  assert.equal(ckt.cktAnalParamIndex('AC', 'stop'), 5);
  assert.equal(ckt.cktAnalParamIndex('AC', 'numsteps'), 6);
  assert.equal(ckt.cktAnalParamIndex('AC', 'lin'), 3);

  assert.equal(ckt.cktSetAnalPmByName(c, job, 'start', 10), ckt.OK);
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'stop', 10000), ckt.OK);
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'numsteps', 10), ckt.OK);
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'dec', 1), ckt.OK);
  assert.equal(job.ACstepType, 1, 'DECADE');
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'lin', 1), ckt.OK);
  assert.equal(job.ACstepType, 3, 'LINEAR перекрывает DECADE');
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'lin', 0), ckt.OK);
  assert.equal(job.ACstepType, 0, 'сброс текущего типа');

  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'start'), { error: ckt.OK, value: 10 });
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'stop'), { error: ckt.OK, value: 10000 });
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'numsteps'), { error: ckt.OK, value: 10 });
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'lin'), { error: ckt.OK, value: 0 });
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'nope', 1), ckt.E_BADPARM);
});

// ─────────────────────────── TRAN ───────────────────────────

test('analyses: tran_rc — сетка и значения против оракула (Q-F01)', () => {
  const { actual, c } = compareDeck('tran_rc', { timeRel: TIME_REL });

  const tran = actual.plots.find((p) => p.name === 'tran1');
  assert.ok(tran, 'plot tran1 есть');
  assert.equal(tran.points.length, 180, 'число точек TRAN как у оракула');
  assert.equal(tran.points[0].ref, 0, 'начальная точка t=0');

  const golden = readJson(GOLDEN, 'tran_rc');
  const gTran = golden.plots.find((p) => p.name === 'tran1');
  let maxRel = 0;
  for (let i = 0; i < gTran.points.length; i++) {
    const g = gTran.points[i].ref;
    const a = tran.points[i].ref;
    maxRel = Math.max(maxRel, Math.abs(a - g) / Math.abs(g || 1));
  }
  assert.ok(maxRel < TIME_REL, `сетка TRAN: max rel ${maxRel} >= ${TIME_REL}`);

  // Первый шаг определяется точкой останова PULSE TR=1e-9: delta = TR/10 /10
  // (Q-A01: XSPICE CKTminBreak = 10*delmin сохраняет breakpoint TR).
  const firstStep = tran.points[1].ref - tran.points[0].ref;
  assert.ok(Math.abs(firstStep - 1e-11) <= 1e-6 * 1e-11, `первый шаг ${firstStep}`);

  // CKTinitTime/CKTmaxStep/CKTdelmin перенесены tranInit.
  assert.equal(c.CKTfinalTime, 5e-3);
  assert.equal(c.CKTmaxStep, 1e-4);
  assert.equal(c.CKTdelmin, 1e-9 * 1e-4);
});

test('analyses: TRAN-параметры по каталогу (set/ask round-trip)', () => {
  const { error, ckt: c } = ckt.cktInit();
  assert.equal(error, ckt.OK);
  const task = ckt.cktNewTask(c, 'task1').task;
  const { job } = ckt.cktNewAnal(c, 'TRAN', 'tran1', task);

  assert.equal(ckt.cktAnalParamIndex('TRAN', 'tstop'), 2);
  assert.equal(ckt.cktAnalParamIndex('TRAN', 'tmax'), 4);
  assert.equal(ckt.cktAnalParamIndex('TRAN', 'nope'), -1);

  assert.equal(ckt.cktSetAnalPmByName(c, job, 'tstop', 5e-3), ckt.OK);
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'tstep', 1e-4), ckt.OK);
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'tmax', 2e-4), ckt.OK);
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'tstop'), { error: ckt.OK, value: 5e-3 });
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'tmax'), { error: ckt.OK, value: 2e-4 });

  assert.equal(ckt.cktSetAnalPmByName(c, job, 'uic', 1), ckt.OK);
  assert.equal(job.TRANmode & ckt.MODEUIC, ckt.MODEUIC);
  assert.deepEqual(ckt.cktAskAnalQstByName(c, job, 'uic'), { error: ckt.OK, value: 1 });
  assert.equal(ckt.cktSetAnalPmByName(c, job, 'nope', 1), ckt.E_BADPARM);
});

// ─────────────────────────── P2.1: диод ───────────────────────────

test('analyses: diode_fwd — прямое смещение, OP против оракула', () => {
  const { actual } = compareDeck('diode_fwd');
  const point = actual.plots[0].points[0];
  // Затвор Ньютона с NEWCONV: сходимость по узловым напряжениям.
  assert.ok(Math.abs(point.values[1] - 0.6928715186715266) <= 1e-9, `vd=${point.values[1]}`);
  assert.ok(Math.abs(point.values[2] + 0.004307128481328473) <= 1e-9, `i(V1)=${point.values[2]}`);
});

test('analyses: diode_rs — внутренний узел rs, OP против оракула', () => {
  const { actual } = compareDeck('diode_rs');
  const plot = actual.plots[0];
  assert.deepEqual(plot.names, ['in', 'a', 'D1', 'V1'], 'внутренний узел нормализован');
  const point = plot.points[0];
  assert.ok(Math.abs(point.values[1] - 0.9555945259394862) <= 1e-9, `v(a)=${point.values[1]}`);
  assert.ok(Math.abs(point.values[2] - 0.9511539785334349) <= 1e-9, `v(D1#internal)=${point.values[2]}`);
});

test('analyses: diode_rev — пробой (bv/ibv), OP против оракула', () => {
  const { actual } = compareDeck('diode_rev');
  const point = actual.plots[0].points[0];
  assert.ok(Math.abs(point.values[1] + 5.058013609433066) <= 1e-9, `v(a)=${point.values[1]}`);
});

test('analyses: diode_ac — AC нелинейного диода против оракула (Q-D05)', () => {
  const { actual, c } = compareDeck('diode_ac');

  const ac = actual.plots.find((p) => p.name === 'ac1');
  assert.ok(ac, 'plot ac1 есть');
  assert.equal(ac.points.length, 10);
  assert.deepEqual(ac.points[0].ref, 1000);

  // Q-D05: без bypass состояние диода после OP равно последнему решению,
  // поэтому AC-проводимость gd берётся из сошедшейся точки.
  const s0 = c.CKTstates[0];
  assert.ok(Math.abs(s0[0] - 0.5845725717727923) <= 1e-12, `state vd=${s0[0]}`);
  assert.ok(Math.abs(s0[2] - 0.002529653432594927) <= 1e-12, `state gd=${s0[2]}`);
});

test('analyses: diode_rect — TRAN выпрямителя, сетка и значения (Q-F01)', () => {
  const { actual } = compareDeck('diode_rect', { timeRel: TIME_REL });
  const tran = actual.plots.find((p) => p.name === 'tran1');
  assert.ok(tran, 'plot tran1 есть');
  assert.equal(tran.points.length, 351, 'число точек TRAN как у оракула');

  const golden = readJson(GOLDEN, 'diode_rect');
  const gTran = golden.plots.find((p) => p.name === 'tran1');
  let maxRel = 0;
  for (let i = 0; i < gTran.points.length; i++) {
    const g = gTran.points[i].ref;
    maxRel = Math.max(maxRel, Math.abs(tran.points[i].ref - g) / Math.abs(g || 1));
  }
  assert.ok(maxRel < TIME_REL, `сетка TRAN: max rel ${maxRel} >= ${TIME_REL}`);
});
