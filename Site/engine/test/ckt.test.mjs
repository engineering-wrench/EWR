/**
 * ckt.test.mjs — юниты CKT-скелета (Site/engine/spice/ckt.js, P1.2).
 *
 * Фиксируют контракт порта `vendor/spice3f4/src/lib/ckt/`:
 *  - публичный каталог устройств/анализов = снимок DLL (`enum.json`);
 *  - дефолты `CKTinit`/`CKTnewTask` (включая XSPICE-правку `trtol=1.0`);
 *  - нумерацию узлов, реестры моделей/инстансов, поиск/привязку выводов;
 *  - диспетчер `CKTdoJob`: порядок анализов, setup/temp/ic, коды ошибок;
 *  - точки расширения: хуки устройств и `cktSetAnalysisImpl`.
 *
 * Реализаций устройств/анализов в P1.2 нет — для проверки диспетчера
 * анализам временно подставляются spy-хуки (восстанавливаются в finally).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ckt from '../spice/ckt.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const enumJson = JSON.parse(
  readFileSync(join(root, 'tools', 'oracle', 'golden', 'enum.json'), 'utf8'),
);

/** Новая цепь (assert, что CKTinit не вернул ошибку). */
function makeCircuit() {
  const { error, ckt: circuit } = ckt.cktInit();
  assert.equal(error, ckt.OK, 'CKTinit');
  assert.ok(circuit, 'CKTinit вернул цепь');
  return circuit;
}

/** Временно подменить поля анализа и гарантированно восстановить их. */
function withAnalysisImpl(type, impl, fn) {
  const idx = ckt.cktAnalIndex(type);
  assert.ok(idx >= 0, `анализ ${type} есть в каталоге`);
  const saved = {};
  for (const key of Object.keys(impl)) saved[key] = ckt.ANALYSES[idx][key];
  Object.assign(ckt.ANALYSES[idx], impl);
  try {
    return fn();
  } finally {
    Object.assign(ckt.ANALYSES[idx], saved);
  }
}

/** Временно подменить хук устройства и восстановить его. */
function withDeviceHook(devName, hook, fn) {
  const dev = ckt.DEVICES[ckt.cktDevIndex(devName)];
  assert.ok(dev, `устройство ${devName} есть в каталоге`);
  const saved = dev[hook];
  try {
    return fn(dev);
  } finally {
    dev[hook] = saved;
  }
}

/** Приближённое сравнение (как в sparse.test.mjs). */
function closeTo(actual, expected, eps = 1e-12, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${msg}: ожидалось ${expected}, получено ${actual}`,
  );
}

/** Построить простую цепь: земля, 2 узла, резистор R1 (без номинала). */
function buildTwoNodeCircuit() {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0');
  assert.equal(gnd.error, ckt.OK);
  const inNode = ckt.cktNewNode(c, 'in');
  const outNode = ckt.cktNewNode(c, 'out');
  assert.equal(inNode.error, ckt.OK);
  assert.equal(outNode.error, ckt.OK);

  const rType = ckt.cktDevIndex('Resistor');
  const model = ckt.cktModCrt(c, rType, 'RMOD');
  assert.equal(model.error, ckt.OK);
  const inst = ckt.cktCrtElt(c, model.model, 'R1');
  assert.equal(inst.error, ckt.OK);
  assert.equal(ckt.cktBindNode(c, inst.instance, 1, inNode.node), ckt.OK);
  assert.equal(ckt.cktBindNode(c, inst.instance, 2, outNode.node), ckt.OK);

  return { c, inNode: inNode.node, outNode: outNode.node, inst: inst.instance, model: model.model };
}

// ─────────────────────────── КАТАЛОГ (enum.json) ───────────────────────────

test('ckt: каталог устройств = публичная таблица DLL (enum.json)', () => {
  assert.equal(ckt.DEVmaxnum, enumJson.devices.length, 'DEVmaxnum');
  assert.equal(ckt.DEVICES.length, enumJson.devices.length);
  for (const expected of enumJson.devices) {
    const actual = ckt.DEVICES[expected.index];
    assert.ok(actual, `устройство #${expected.index}`);
    assert.equal(actual.index, expected.index, 'index');
    assert.equal(actual.name, expected.name, `name #${expected.index}`);
    assert.equal(actual.description, expected.description, `description ${expected.name}`);
    assert.equal(actual.terms, expected.terms, `terms ${expected.name}`);
    assert.deepEqual(actual.termNames, expected.termNames, `termNames ${expected.name}`);
  }
});

test('ckt: каталог анализов = публичная таблица DLL (enum.json)', () => {
  assert.equal(ckt.ANALmaxnum, enumJson.analyses.length, 'ANALmaxnum');
  assert.equal(ckt.ANALYSES.length, enumJson.analyses.length);
  for (const expected of enumJson.analyses) {
    const actual = ckt.ANALYSES[expected.index];
    assert.ok(actual, `анализ #${expected.index}`);
    assert.equal(actual.index, expected.index, 'index');
    assert.equal(actual.name, expected.name, `name #${expected.index}`);
    assert.equal(actual.description, expected.description, `description ${expected.name}`);
  }
  // Порядок analInfo = порядок enum.json (тип job'а в CKTnewAnal).
  assert.deepEqual(
    ckt.ANALYSES.map((a) => a.name),
    ['options', 'AC', 'DC', 'OP', 'TRAN', 'PZ', 'TF', 'DISTO', 'NOISE', 'SENS'],
  );
});

test('ckt: cktDevIndex — точное имя (CKTtypelook), омонимы различаются', () => {
  assert.equal(ckt.cktDevIndex('Resistor'), 19);
  assert.equal(ckt.cktDevIndex('Vsource'), 24);
  assert.equal(ckt.cktDevIndex('resistor'), -1, 'strcmp регистрозависим');
  assert.equal(ckt.cktDevIndex('Capacitor'), 4);
  assert.equal(ckt.cktDevIndex('capacitor'), 28, 'model-only код-модель');
  assert.equal(ckt.cktDevIndex('Inductor'), 9);
  assert.equal(ckt.cktDevIndex('inductor'), 63);
});

test('ckt: cktAnalIndex — число или имя без регистра, неизвестное → -1', () => {
  assert.equal(ckt.cktAnalIndex(3), 3);
  assert.equal(ckt.cktAnalIndex('OP'), 3);
  assert.equal(ckt.cktAnalIndex('op'), 3);
  assert.equal(ckt.cktAnalIndex('Tran'), 4);
  assert.equal(ckt.cktAnalIndex(10), -1);
  assert.equal(ckt.cktAnalIndex(-1), -1);
  assert.equal(ckt.cktAnalIndex(3.5), -1);
  assert.equal(ckt.cktAnalIndex('FOUR'), -1, 'FOUR — фронтенд, не ядро');
});

// ─────────────────────────── CKTinit ───────────────────────────

test('ckt: CKTinit — дефолты F4 (опции, матрица, статистика)', () => {
  const c = makeCircuit();

  assert.equal(c.CKTmaxEqNum, 1, 'нумерация начинается с 1 (0 — земля)');
  assert.equal(c.CKTnodes, null);
  assert.equal(c.CKTlastNode, null);
  assert.ok(c.CKTmatrix, 'матрица создана NIinit');
  assert.ok(c.CKTniState & 0x4, 'NIUNINITIALIZED');

  assert.equal(c.CKTtemp, 300.15);
  assert.equal(c.CKTnomTemp, 300.15);
  assert.equal(c.CKTvt, 0, 'CKTvt считает CKTtemp');
  assert.equal(c.CKTtrtol, 7, 'дефолт CKTinit (F4); task перекрывает на 1.0');
  assert.equal(c.CKTgmin, 1e-12);
  assert.equal(c.CKTabstol, 1e-12);
  assert.equal(c.CKTreltol, 1e-3);
  assert.equal(c.CKTchgtol, 1e-14);
  assert.equal(c.CKTvoltTol, 1e-6);
  assert.equal(c.CKTpivotAbsTol, 1e-13);
  assert.equal(c.CKTpivotRelTol, 1e-3);
  assert.equal(c.CKTmaxOrder, 2);
  assert.equal(c.CKTorder, 1);
  assert.equal(c.CKTintegrateMethod, ckt.TRAPEZOIDAL);
  assert.equal(c.CKTbypass, 1);
  assert.equal(c.CKTdcMaxIter, 100);
  assert.equal(c.CKTdcTrcvMaxIter, 50);
  assert.equal(c.CKTtranMaxIter, 10);
  assert.equal(c.CKTnumSrcSteps, 10);
  assert.equal(c.CKTnumGminSteps, 10);
  assert.equal(c.CKTdefaultMosL, 1e-4);
  assert.equal(c.CKTdefaultMosW, 1e-4);
  assert.equal(c.CKTdefaultMosAD, 0);
  assert.equal(c.CKTdefaultMosAS, 0);
  assert.equal(c.CKTisSetup, 0);
  assert.equal(c.CKTtroubleNode, 0);
  assert.equal(c.CKTtroubleElt, null);
  assert.equal(c.CKTcurJob, null);
  assert.deepEqual(c.CKTstates, new Array(8).fill(null));
  assert.equal(c.CKTrhs, null, 'RHS выделяет NIreinit в setup');

  for (const [key, value] of Object.entries(c.CKTstat)) {
    assert.equal(value, 0, `статистика ${key}`);
  }
  assert.equal(c.CKThead.length, ckt.DEVmaxnum);
  assert.ok(c.CKThead.every((m) => m === null));
});

test('ckt: CKTdestroy — очищает узлы/модели/матрицу', () => {
  const { c } = buildTwoNodeCircuit();
  assert.equal(ckt.cktDestroy(c), ckt.OK);
  assert.equal(c.CKTnodes, null);
  assert.equal(c.CKTlastNode, null);
  assert.equal(c.CKTmaxEqNum, 1);
  assert.equal(c.CKTmatrix, null);
  assert.ok(c.CKThead.every((m) => m === null));
});

// ─────────────────────────── УЗЛЫ ───────────────────────────

test('ckt: узлы — земля, нумерация, поиск, имена', () => {
  const c = makeCircuit();

  const gnd = ckt.cktGround(c, '0');
  assert.equal(gnd.error, ckt.OK);
  assert.equal(gnd.node.number, 0);
  assert.equal(gnd.node.type, ckt.SP_VOLTAGE);
  assert.equal(c.CKTmaxEqNum, 1, 'земля не расходует номер');

  const gnd2 = ckt.cktGround(c, 'gnd');
  assert.equal(gnd2.error, ckt.E_EXISTS, 'повторная земля — E_EXISTS');
  assert.equal(gnd2.node.name, '0', 'старое имя сохраняется');

  const n1 = ckt.cktNewNode(c, 'in');
  const n2 = ckt.cktNewNode(c, 'out');
  assert.equal(n1.error, ckt.OK);
  assert.equal(n1.node.number, 1);
  assert.equal(n2.node.number, 2);
  assert.equal(c.CKTmaxEqNum, 3);

  assert.equal(ckt.cktFindNode(c, 'in').node, n1.node);
  assert.equal(ckt.cktFindNode(c, 'missing').error, ckt.E_NOTFOUND);
  assert.equal(ckt.cktNum2Nod(c, 2), n2.node);
  assert.equal(ckt.cktNum2Nod(c, 99), null);
  assert.equal(ckt.cktNodeName(c, 2), 'out');
  assert.equal(ckt.cktNodeName(c, 99), 'UNKNOWN NODE');
  assert.deepEqual(ckt.cktNames(c).names, ['in', 'out']);
});

test('ckt: CKTnewNode неявно создаёт землю (имя null)', () => {
  const c = makeCircuit();
  const n = ckt.cktNewNode(c, 'a');
  assert.equal(n.error, ckt.OK);
  assert.equal(n.node.number, 1);
  assert.equal(c.CKTnodes.number, 0);
  assert.equal(c.CKTnodes.name, null);
  assert.equal(ckt.cktFindNode(c, null).node, c.CKTnodes);
  assert.deepEqual(ckt.cktNames(c).names, ['a']);
});

test('ckt: CKTnewEq / CKTlinkEq — номера и земля', () => {
  const c = makeCircuit();
  const eq = ckt.cktNewEq(c, 'x');
  assert.equal(eq.error, ckt.OK);
  assert.equal(eq.node.number, 1);
  assert.equal(c.CKTnodes.number, 0, 'земля создана linkEq');
  assert.equal(c.CKTmaxEqNum, 2);
  assert.equal(ckt.cktLinkEq(c, null), ckt.E_BADPARM);
});

test('ckt: параметры узла — nodeset/ic/type и ошибки', () => {
  const c = makeCircuit();
  const n = ckt.cktNewNode(c, 'n').node;

  assert.equal(ckt.cktSetNodPm(c, n, ckt.PARM_NS, 1.5), ckt.OK);
  assert.equal(n.nsGiven, true);
  assert.equal(n.nodeset, 1.5);
  assert.equal(ckt.cktAskNodQst(c, n, ckt.PARM_NS).value, 1.5);

  assert.equal(ckt.cktSetNodPm(c, n, ckt.PARM_IC, 0.25), ckt.OK);
  assert.equal(n.icGiven, true);
  assert.equal(ckt.cktAskNodQst(c, n, ckt.PARM_IC).value, 0.25);

  assert.equal(ckt.cktSetNodPm(c, n, ckt.PARM_NODETYPE, ckt.SP_CURRENT), ckt.OK);
  assert.equal(ckt.cktAskNodQst(c, n, ckt.PARM_NODETYPE).value, ckt.SP_CURRENT);

  assert.equal(ckt.cktSetNodPm(c, n, 999, 0), ckt.E_BADPARM);
  assert.equal(ckt.cktAskNodQst(c, n, 999).error, ckt.E_BADPARM);
  assert.equal(ckt.cktSetNodPm(c, null, ckt.PARM_NS, 0), ckt.E_BADPARM);
  assert.equal(ckt.cktAskNodQst(c, null, ckt.PARM_NS).error, ckt.E_BADPARM);
});

// ─────────────────────────── МОДЕЛИ / ИНСТАНСЫ ───────────────────────────

test('ckt: модели — создание, дубль E_EXISTS, неверный тип', () => {
  const c = makeCircuit();
  const type = ckt.cktDevIndex('Resistor');

  const first = ckt.cktModCrt(c, type, 'RMOD');
  assert.equal(first.error, ckt.OK);
  assert.equal(first.model.GENmodType, type);
  assert.equal(first.model.GENmodName, 'RMOD');
  assert.equal(c.CKThead[type], first.model);

  const again = ckt.cktModCrt(c, type, 'RMOD');
  assert.equal(again.error, ckt.E_EXISTS);
  assert.equal(again.model, first.model, 'старая модель переиспользуется');

  const bad = ckt.cktModCrt(c, 999, 'X');
  assert.equal(bad.error, ckt.E_BADPARM);
  assert.match(c.errMsg, /unknown device type/);

  const found = ckt.cktFindMod(c, { type, modname: 'RMOD' });
  assert.equal(found.error, ckt.OK);
  assert.equal(found.model, first.model);
  assert.equal(ckt.cktFindMod(c, { type, modname: 'NOPE' }).error, ckt.E_NOMOD);
  assert.equal(ckt.cktFindMod(c, { type: 999, modname: 'RMOD' }).error, ckt.E_BADPARM);
});

test('ckt: CKTmodCrt по всем типам (type=-1) находит модель', () => {
  const c = makeCircuit();
  const type = ckt.cktDevIndex('Vsource');
  const created = ckt.cktModCrt(c, type, 'VMOD');
  assert.equal(created.error, ckt.OK);
  const found = ckt.cktFindMod(c, { type: -1, modname: 'VMOD' });
  assert.equal(found.error, ckt.OK);
  assert.equal(found.type, type, 'тип найден по имени');
  assert.equal(found.model, created.model);
});

test('ckt: инстансы — LIFO, дубль E_EXISTS, без модели E_NOMOD', () => {
  const c = makeCircuit();
  const model = ckt.cktModCrt(c, ckt.cktDevIndex('Resistor'), 'RMOD').model;

  const r1 = ckt.cktCrtElt(c, model, 'R1');
  const r2 = ckt.cktCrtElt(c, model, 'R2');
  assert.equal(r1.error, ckt.OK);
  assert.equal(r2.error, ckt.OK);
  assert.equal(model.GENinstances, r2.instance, 'новый инстанс — в голове (LIFO)');
  assert.equal(model.GENinstances.GENnextInstance, r1.instance);
  assert.equal(r2.instance.GENmodPtr, model);

  const dup = ckt.cktCrtElt(c, model, 'R1');
  assert.equal(dup.error, ckt.E_EXISTS);
  assert.equal(dup.instance, r1.instance);

  assert.equal(ckt.cktCrtElt(c, null, 'X').error, ckt.E_NOMOD);
});

test('ckt: bindNode / inst2Node — выводы и E_NOTERM', () => {
  const { c, inst, inNode, outNode } = buildTwoNodeCircuit();

  assert.equal(inst.GENnode1, inNode.number);
  assert.equal(inst.GENnode2, outNode.number);
  assert.equal(ckt.cktBindNode(c, inst, 3, inNode), ckt.E_NOTERM, 'у резистора 2 вывода');
  assert.equal(ckt.cktBindNode(c, inst, 0, inNode), ckt.E_NOTERM);
  assert.equal(ckt.cktBindNode(c, inst, 1, null), ckt.E_BADPARM);

  const term1 = ckt.cktInst2Node(c, inst, 1);
  assert.equal(term1.error, ckt.OK);
  assert.equal(term1.node, inNode);
  assert.equal(term1.nodeName, 'in');
  assert.equal(ckt.cktInst2Node(c, inst, 3).error, ckt.E_NOTERM);
});

test('ckt: CKTfndDev — по типу, модели, имени и всем типам', () => {
  const { c, inst, model } = buildTwoNodeCircuit();
  const type = ckt.cktDevIndex('Resistor');

  assert.equal(ckt.cktFindDev(c, { type, name: 'R1' }).instance, inst);
  assert.equal(ckt.cktFindDev(c, { type, name: 'R1', modname: 'RMOD' }).instance, inst);
  assert.equal(ckt.cktFindDev(c, { type, name: 'R1', modname: 'OTHER' }).error, ckt.E_NOMOD);
  assert.equal(ckt.cktFindDev(c, { type, name: 'NOPE', modname: 'RMOD' }).error, ckt.E_NODEV);
  assert.equal(ckt.cktFindDev(c, { type, name: 'NOPE' }).error, ckt.E_NOMOD);
  assert.equal(ckt.cktFindDev(c, { modfast: model, name: 'R1' }).instance, inst);
  assert.equal(ckt.cktFindDev(c, { modfast: model, name: 'NOPE' }).error, ckt.E_NODEV);
  assert.equal(ckt.cktFindDev(c, { fast: inst }).type, type);

  const anyType = ckt.cktFindDev(c, { type: -1, name: 'R1' });
  assert.equal(anyType.error, ckt.OK);
  assert.equal(anyType.type, type);
  assert.equal(anyType.instance, inst);

  assert.equal(ckt.cktFindDev(c, { type: -1, name: 'NOPE' }).error, ckt.E_NODEV);
  assert.equal(ckt.cktFindDev(c, { type: 999, name: 'R1' }).error, ckt.E_BADPARM);
  assert.equal(ckt.cktFindDev(c, { type: ckt.cktDevIndex('Diode'), name: 'R1' }).error, ckt.E_NOMOD);
});

// ─────────────────────────── TASK: ДЕФОЛТЫ (engine-behavior §4.2) ───────────────────────────

test('ckt: CKTnewTask — дефолты опций как у DLL (trtol=1.0)', () => {
  const c = makeCircuit();
  const { error, task } = ckt.cktNewTask(c, 'task1');
  assert.equal(error, ckt.OK);
  assert.ok(task);

  assert.equal(task.TSKname, 'task1');
  assert.equal(task.JOBtype, 0, 'taskOptions');
  assert.equal(task.JOBname, null);
  assert.equal(task.jobs, null);

  // §4.2 engine-behavior: значения DLL/XSPICE.
  assert.equal(task.TSKgmin, 1e-12);
  assert.equal(task.TSKreltol, 1e-3);
  assert.equal(task.TSKabstol, 1e-12);
  assert.equal(task.TSKvoltTol, 1e-6);
  assert.equal(task.TSKtrtol, 1.0, 'XSPICE-правка (не F4=7)');
  assert.equal(task.TSKchgtol, 1e-14);
  assert.equal(task.TSKpivotAbsTol, 1e-13);
  assert.equal(task.TSKpivotRelTol, 1e-3);
  assert.equal(task.TSKnomTemp, 300.15);
  assert.equal(task.TSKtemp, 300.15);
  assert.equal(task.TSKdcMaxIter, 100, 'itl1');
  assert.equal(task.TSKdcTrcvMaxIter, 50, 'itl2');
  assert.equal(task.TSKtranMaxIter, 10, 'itl4');
  assert.equal(task.TSKnumSrcSteps, 10, 'srcsteps/itl6');
  assert.equal(task.TSKnumGminSteps, 10);
  assert.equal(task.TSKintegrateMethod, ckt.TRAPEZOIDAL);
  assert.equal(task.TSKmaxOrder, 2);
  assert.equal(task.TSKbypass, 1);
  assert.equal(task.TSKnoOpIter, 0);
  assert.equal(task.TSKdefaultMosL, 1e-4);
  assert.equal(task.TSKdefaultMosW, 1e-4);
  assert.equal(task.TSKdefaultMosAD, 0);
  assert.equal(task.TSKdefaultMosAS, 0);
  assert.equal(task.TSKtryToCompact, 0);
  assert.equal(task.TSKbadMos3, 0);
  assert.equal(task.TSKkeepOpInfo, 0);
  // Поля, которые CKTnewTask и в C не инициализирует (zeroed MALLOC).
  assert.equal(task.TSKminBreak, 0);
  assert.equal(task.TSKdelmin, 0);
  assert.equal(task.TSKcurrentAnalysis, 0);
  assert.equal(task.TSKfixLimit, 0);
});

// ─────────────────────────── TASK: JOB'Ы ───────────────────────────

test('ckt: CKTnewAnal — LIFO, type=0 (options) = сама task, неизвестный тип', () => {
  const c = makeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');

  const op = ckt.cktNewAnal(c, 'op', 'op1', task);
  assert.equal(op.error, ckt.OK);
  assert.equal(op.job.JOBtype, 3);
  assert.equal(op.job.JOBname, 'op1');
  assert.equal(task.jobs, op.job);

  const tran = ckt.cktNewAnal(c, 4, 'tran1', task);
  assert.equal(tran.error, ckt.OK);
  assert.equal(task.jobs, tran.job, 'новый job — в голове списка');
  assert.equal(tran.job.JOBnextJob, op.job);

  const jobsBefore = task.jobs;
  const opt = ckt.cktNewAnal(c, 0, 'opt1', task);
  assert.equal(opt.error, ckt.OK);
  assert.equal(opt.job, task, 'type 0 возвращает саму task');
  assert.equal(task.JOBname, 'opt1');
  assert.equal(task.JOBtype, 0);
  assert.equal(task.jobs, jobsBefore, 'options не добавляется в список');

  const bad = ckt.cktNewAnal(c, 'FOUR', 'four1', task);
  assert.equal(bad.error, ckt.E_BADPARM);
  assert.match(c.errMsg, /unknown analysis type: FOUR/);
  assert.equal(ckt.cktNewAnal(c, 99, 'x', task).error, ckt.E_BADPARM);
});

test('ckt: CKTfndAnal — по имени job\'а, E_NOTFOUND', () => {
  const c = makeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  const op = ckt.cktNewAnal(c, 'OP', 'op1', task).job;
  assert.equal(ckt.cktFindAnal(c, 'op1', task).job, op);
  assert.equal(ckt.cktFindAnal(c, 'OP1', task).error, ckt.E_NOTFOUND, 'strcmp');
  assert.equal(ckt.cktFindAnal(c, 'nope', task).error, ckt.E_NOTFOUND);
});

test('ckt: CKTsetAnalPm / CKTaskAnalQ — через хуки, без хука E_BADPARM', () => {
  const c = makeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  const op = ckt.cktNewAnal(c, 'OP', 'op1', task).job;

  assert.equal(ckt.cktSetAnalPm(c, op, 1, 42), ckt.E_BADPARM, 'setParm ещё не реализован');

  withAnalysisImpl(
    'OP',
    {
      setParm(_ckt, _job, _parm, value) {
        return value === 42 ? ckt.OK : ckt.E_PARMVAL;
      },
      askQuest(_ckt, _job, _parm) {
        return { error: ckt.OK, value: 42 };
      },
    },
    () => {
      assert.equal(ckt.cktSetAnalPm(c, op, 1, 42), ckt.OK);
      assert.equal(ckt.cktSetAnalPm(c, op, 1, 0), ckt.E_PARMVAL);
      assert.deepEqual(ckt.cktAskAnalQst(c, op, 1), { error: ckt.OK, value: 42 });
    },
  );

  assert.equal(ckt.cktSetAnalPm(c, op, 1, 42), ckt.E_BADPARM, 'хук восстановлен');
});

// ─────────────────────────── ДИСПЕТЧЕР ───────────────────────────

test('ckt: CKTdoJob — setup/temp/ic, опции task→ckt, вызов анализа', () => {
  const { c } = buildTwoNodeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  const op = ckt.cktNewAnal(c, 'OP', 'op1', task).job;

  const calls = [];
  withAnalysisImpl(
    'OP',
    {
      an_func(circuit, reset) {
        calls.push({ job: circuit.CKTcurJob, reset });
        return ckt.OK;
      },
    },
    () => {
      assert.equal(ckt.cktDoJob(c, 1, task), ckt.OK);
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].job, op);
  assert.equal(calls[0].reset, 1);
  assert.equal(c.CKTisSetup, 1, 'setup выполнен');
  assert.equal(c.CKTtime, 0, 'reset обнулил время');
  assert.equal(c.CKTdelta, 0);
  assert.equal(c.CKTcurrentAnalysis, 0);
  assert.ok(c.CKTmatrix, 'матрица после setup');
  assert.ok(c.CKTrhs, 'RHS после NIreinit');
  assert.equal(c.CKTtrtol, 1.0, 'опция task скопирована в цепь');
  assert.equal(c.CKTgmin, task.TSKgmin);
  assert.equal(c.CKTtemp, task.TSKtemp);
  assert.equal(c.CKTmaxOrder, task.TSKmaxOrder);
  closeTo(c.CKTvt, 0.025864186384551461, 1e-12, 'CKTvt после CKTtemp');
});

test('ckt: CKTdoJob — порядок анализов по таблице, а не по списку job\'ов', () => {
  const { c } = buildTwoNodeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  // Создаём TRAN раньше OP: список LIFO → OP в голове, TRAN в хвосте.
  ckt.cktNewAnal(c, 'TRAN', 'tran1', task);
  ckt.cktNewAnal(c, 'OP', 'op1', task);

  const order = [];
  withAnalysisImpl('OP', { an_func: () => { order.push('OP'); return ckt.OK; } }, () => {
    withAnalysisImpl('TRAN', { an_func: () => { order.push('TRAN'); return ckt.OK; } }, () => {
      assert.equal(ckt.cktDoJob(c, 1, task), ckt.OK);
    });
  });

  assert.deepEqual(order, ['OP', 'TRAN'], 'OP (index 3) раньше TRAN (index 4)');
});

test('ckt: CKTdoJob — анализам-заглушкам E_UNSUPP с понятным текстом', () => {
  const { c } = buildTwoNodeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  // AC реализован (P2.7); берём DC sweep — он ещё заглушка.
  ckt.cktNewAnal(c, 'DC', 'dc1', task);

  assert.equal(ckt.cktDoJob(c, 1, task), ckt.E_UNSUPP);
  assert.match(c.errMsg, /"DC" is not implemented yet/);
  assert.equal(c.errRtn, 'CKTdoJob');
});

test('ckt: CKTdoJob — без reset не вызывает setup повторно', () => {
  const { c } = buildTwoNodeCircuit();
  const { task } = ckt.cktNewTask(c, 'task1');
  ckt.cktNewAnal(c, 'OP', 'op1', task);

  let setups = 0;
  withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = () => { setups++; return ckt.OK; };
    withAnalysisImpl('OP', { an_func: () => ckt.OK }, () => {
      assert.equal(ckt.cktDoJob(c, 1, task), ckt.OK);
      assert.equal(setups, 1);
      assert.equal(ckt.cktDoJob(c, 0, task), ckt.OK);
      assert.equal(setups, 1, 'reset=0 — setup не повторяется');
    });
  });
});

// ─────────────────────────── SETUP / TEMP / HOOKS ───────────────────────────

test('ckt: CKTsetup — E_NOCHANGE при повторе, CKTstates по numStates', () => {
  const { c } = buildTwoNodeCircuit();

  assert.equal(ckt.cktSetup(c), ckt.OK);
  assert.equal(c.CKTisSetup, 1);
  assert.equal(ckt.cktSetup(c), ckt.E_NOCHANGE);
  assert.equal(c.CKTnumStates, 0);
  assert.deepEqual(c.CKTstates, new Array(8).fill(null));

  assert.equal(ckt.cktUnsetup(c), ckt.OK);
  assert.equal(c.CKTisSetup, 0);
  assert.equal(c.CKTmatrix, null, 'NIdestroy освободил матрицу');
  assert.equal(c.CKTrhs, null);
});

test('ckt: хуки устройств — setup/temperature/unsetup вызываются', () => {
  const { c } = buildTwoNodeCircuit();
  const seen = { setup: 0, temp: 0, unsetup: 0, states: -1 };

  withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = (matrix, model, circuit, state) => {
      seen.setup++;
      assert.ok(matrix, 'matrix передан');
      assert.equal(model.GENmodName, 'RMOD');
      assert.equal(circuit, c);
      state.value += 2; // два состояния
      seen.states = state.value;
      return ckt.OK;
    };
    withDeviceHook('Resistor', 'DEVtemperature', (dev2) => {
      dev2.DEVtemperature = (model, circuit) => {
        seen.temp++;
        assert.equal(model.GENmodName, 'RMOD');
        assert.equal(circuit, c);
        return ckt.OK;
      };
      withDeviceHook('Resistor', 'DEVunsetup', (dev3) => {
        dev3.DEVunsetup = (model, circuit) => {
          seen.unsetup++;
          assert.equal(model.GENmodName, 'RMOD');
          assert.equal(circuit, c);
          return ckt.OK;
        };

        assert.equal(ckt.cktSetup(c), ckt.OK);
        assert.equal(seen.setup, 1);
        assert.equal(seen.states, 2);
        assert.equal(c.CKTnumStates, 2);
        assert.equal(c.CKTstates[0].length, 2);
        assert.equal(c.CKTstates[c.CKTmaxOrder + 1].length, 2);

        assert.equal(ckt.cktTemp(c), ckt.OK);
        assert.equal(seen.temp, 1);

        assert.equal(ckt.cktUnsetup(c), ckt.OK);
        assert.equal(seen.unsetup, 1);
      });
    });
  });
});

test('ckt: CKTtemp — CKTvt по CONSTKoverQ (значение из DLL)', () => {
  const c = makeCircuit();
  c.CKTtemp = 300.15;
  assert.equal(ckt.cktTemp(c), ckt.OK);
  closeTo(c.CKTvt, 0.025864186384551461, 1e-15, 'vt0 при 300.15 K');
});

test('ckt: CKTic — без setup E_BADMATRIX (защита порта)', () => {
  const c = makeCircuit();
  assert.equal(ckt.cktIc(c), ckt.E_BADMATRIX);
  assert.match(c.errMsg, /requires matrix and RHS/);
});

// ─────────────────────────── EWB-ШВЫ / КОДЫ ───────────────────────────

test('ckt: EWB-швы готовы к фазе I (getVoltage/getCurrent/setMaxStep)', () => {
  const c = makeCircuit();
  // Без решения (CKTdoJob не выполнялся) — E_BADMATRIX, а не E_UNSUPP.
  assert.equal(ckt.getVoltage(c, 'in').error, ckt.E_BADMATRIX);
  assert.equal(ckt.getCurrent(c, 'R1').error, ckt.E_BADMATRIX);
  // Матрица пока не отдаётся наружу — отдельная задача паритета.
  assert.equal(ckt.getMatrixElement(c, 1, 1).error, ckt.E_UNSUPP);

  assert.equal(ckt.setMaxStep(c, 1e-3), ckt.OK);
  assert.equal(c.CKTmaxStep, 1e-3);
  assert.equal(ckt.setMaxStep(c, 2e-3), ckt.OK);
  assert.equal(c.CKTmaxStep, 1e-3, 'шаг не увеличивается');
  assert.equal(ckt.setMaxStep(c, 0), ckt.E_BADPARM);
});

test('ckt: коды ошибок = iferrmsg.h', () => {
  assert.equal(ckt.OK, 0);
  assert.equal(ckt.E_PANIC, 1);
  assert.equal(ckt.E_EXISTS, 2);
  assert.equal(ckt.E_NODEV, 3);
  assert.equal(ckt.E_NOMOD, 4);
  assert.equal(ckt.E_NOANAL, 5);
  assert.equal(ckt.E_NOTERM, 6);
  assert.equal(ckt.E_BADPARM, 7);
  assert.equal(ckt.E_NOMEM, 8);
  assert.equal(ckt.E_NODECON, 9);
  assert.equal(ckt.E_UNSUPP, 10);
  assert.equal(ckt.E_PARMVAL, 11);
  assert.equal(ckt.E_NOTEMPTY, 12);
  assert.equal(ckt.E_NOCHANGE, 13);
  assert.equal(ckt.E_NOTFOUND, 14);
  assert.equal(ckt.E_BAD_DOMAIN, 15);
});

test('ckt: cktSetAnalysisImpl — подмена и восстановление, неизвестный тип', () => {
  const c = makeCircuit();
  const saved = ckt.ANALYSES[3].an_func;
  const spy = () => ckt.OK;

  assert.equal(ckt.cktSetAnalysisImpl('OP', { an_func: spy }).error, ckt.OK);
  assert.equal(ckt.ANALYSES[3].an_func, spy);
  assert.equal(ckt.cktSetAnalysisImpl('FOUR', { an_func: spy }).error, ckt.E_BADPARM);

  ckt.ANALYSES[3].an_func = saved;
  assert.equal(ckt.ANALYSES[3].an_func, saved);
  assert.equal(c.errMsg, null, 'успешные вызовы не пишут ошибку');
});
