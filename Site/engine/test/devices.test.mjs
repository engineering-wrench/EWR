/**
 * devices.test.mjs — юниты устройств P1.4 (Site/engine/spice/devices/*).
 *
 * Проверяют порт `res/cap/ind/mutual/vsrc/isrc/sw/csw` на реальных цепях:
 *  - установка хуков в `DEVICES` и поиск параметров по ключевым словам;
 *  - OP-расчёты через `nIIter`: делитель, DC-режимы C/L, источники;
 *  - квирки C: порядок узлов ISRC (Q-D02), ветвевые уравнения, `MUTfactor`;
 *  - состояния и переключение ключей (порог/гистерезис, `CKTnoncon`);
 *  - `DEVunsetup` удаляет ветвевые уравнения.
 *
 * Числа сверяются с аналитикой; оракульный diff-тест устройства — P1.6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as ckt from '../spice/ckt.js';
import * as ni from '../spice/ni.js';
import { SMPfindElt } from '../spice/sparse.js';
import { resistor } from '../spice/devices/resistor.js';
import { capacitor } from '../spice/devices/capacitor.js';
import { inductor, mutual } from '../spice/devices/inductor.js';
import { vsource } from '../spice/devices/vsource.js';
import { isource } from '../spice/devices/isource.js';
import { sw, csw } from '../spice/devices/switch.js';
import { sourceFunctionValue, PULSE, PWL } from '../spice/devices/common.js';
import { diode, pnjlim, DIO_VD, DIO_ID, DIO_GD } from '../spice/devices/diode.js';

/** Новая цепь. */
function makeCircuit() {
  const { error, ckt: circuit } = ckt.cktInit();
  assert.equal(error, ckt.OK, 'CKTinit');
  assert.ok(circuit, 'CKTinit вернул цепь');
  return circuit;
}

/** Приближённое сравнение. */
function closeTo(actual, expected, eps = 1e-9, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${msg}: ожидалось ${expected}, получено ${actual}`,
  );
}

/** Земля + именованный узел. */
function node(c, name) {
  const n = ckt.cktNewNode(c, name);
  assert.equal(n.error, ckt.OK, `узел ${name}`);
  return n.node;
}

/** Создать модель и инстанс устройства, привязать выводы к узлам. */
function device(c, typeName, name, modelName, nodes) {
  const type = ckt.cktDevIndex(typeName);
  assert.ok(type >= 0, `устройство ${typeName} есть в каталоге`);
  const model = ckt.cktModCrt(c, type, `${modelName}_${name}`);
  assert.equal(model.error, ckt.OK, `модель ${modelName}`);
  const inst = ckt.cktCrtElt(c, model.model, name);
  assert.equal(inst.error, ckt.OK, `инстанс ${name}`);
  nodes.forEach((n, i) => {
    assert.equal(ckt.cktBindNode(c, inst.instance, i + 1, n), ckt.OK, `${name} вывод ${i + 1}`);
  });
  return { type, model: model.model, inst: inst.instance };
}

/** Setup + temp + один OP-расчёт. */
function solveOp(c) {
  assert.equal(ckt.cktSetup(c), ckt.OK, 'CKTsetup');
  assert.equal(ckt.cktTemp(c), ckt.OK, 'CKTtemp');
  c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;
  assert.equal(ni.niIter(c, 50), ckt.OK, 'NIiter');
}

// ─────────────────────────── установка/параметры ───────────────────────────

test('devices: реализации P1.4 установлены в DEVICES', () => {
  const pairs = [
    ['Resistor', resistor],
    ['Capacitor', capacitor],
    ['Inductor', inductor],
    ['mutual', mutual],
    ['Vsource', vsource],
    ['Isource', isource],
    ['Switch', sw],
    ['CSwitch', csw],
  ];
  for (const [name, impl] of pairs) {
    const dev = ckt.DEVICES[ckt.cktDevIndex(name)];
    assert.ok(dev, `устройство ${name}`);
    for (const hook of ['DEVsetup', 'DEVload']) {
      if (impl[hook]) assert.equal(dev[hook], impl[hook], `${name}.${hook}`);
    }
  }
});

test('devices: параметры по ключевым словам каталога (res/cap/vsrc/sw)', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const b = node(c, 'b');

  const r = device(c, 'Resistor', 'R1', 'RMOD', [a, b]);
  assert.equal(ckt.cktParamByName(c, r.inst, 'resistance', 4700), ckt.OK);
  assert.equal(r.inst.RESresist, 4700);
  assert.equal(r.inst.RESresGiven, true);
  assert.equal(ckt.cktParamByName(c, r.inst, 'nope', 1), ckt.E_BADPARM);

  const cap = device(c, 'Capacitor', 'C1', 'CMOD', [a, b]);
  assert.equal(ckt.cktParamByName(c, cap.inst, 'capacitance', 1e-6), ckt.OK);
  assert.equal(cap.inst.CAPcapac, 1e-6);

  const v = device(c, 'Vsource', 'V1', 'VMOD', [a, gnd]);
  assert.equal(ckt.cktParamByName(c, v.inst, 'dc', 5), ckt.OK);
  assert.equal(v.inst.VSRCdcValue, 5);
  assert.equal(ckt.cktParamByName(c, v.inst, 'pulse', [0, 1, 0, 1e-9, 1e-9, 1e-3, 2e-3]), ckt.OK);
  assert.equal(v.inst.VSRCfunctionType, PULSE);
  assert.equal(v.inst.VSRCfunctionOrder, 7);

  const s = device(c, 'Switch', 'S1', 'SMOD', [a, b, a, gnd]);
  assert.equal(ckt.cktModParamByName(c, s.model, 'vt', 1.5), ckt.OK);
  assert.equal(s.model.SWvThreshold, 1.5);
  assert.equal(ckt.cktModParamByName(c, s.model, 'vh', -0.2), ckt.OK);
  assert.equal(s.model.SWvHysteresis, 0.2, 'гистерезис берётся по модулю');
  assert.equal(ckt.cktModParamByName(c, s.model, 'ron', 4), ckt.OK);
  assert.equal(s.model.SWonConduct, 0.25);
});

// ─────────────────────────── OP: R/C/L ───────────────────────────

test('devices: делитель R-R в OP (V=10, R1=R2=1k → 5 В)', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');
  const out = node(c, 'out');

  device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]).inst.VSRCdcValue = 10;
  const r1 = device(c, 'Resistor', 'R1', 'RMOD', [inp, out]);
  const r2 = device(c, 'Resistor', 'R2', 'RMOD', [out, gnd]);
  r1.inst.RESresist = 1000;
  r1.inst.RESresGiven = true;
  r2.inst.RESresist = 1000;
  r2.inst.RESresGiven = true;

  solveOp(c);
  closeTo(c.CKTrhs[inp.number], 10, 1e-9, 'V(in)');
  closeTo(c.CKTrhs[out.number], 5, 1e-9, 'V(out)');
});

test('devices: конденсатор в OP — разрыв (V(out)=V(in))', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');
  const out = node(c, 'out');

  const v = device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]);
  v.inst.VSRCdcValue = 1;
  const r = device(c, 'Resistor', 'R1', 'RMOD', [inp, out]);
  r.inst.RESresist = 1000;
  r.inst.RESresGiven = true;
  const cap = device(c, 'Capacitor', 'C1', 'CMOD', [out, gnd]);
  cap.inst.CAPcapac = 1e-6;
  cap.inst.CAPcapGiven = true;

  solveOp(c);
  closeTo(c.CKTrhs[out.number], 1, 1e-9, 'V(out) — конденсатор открыт');
});

test('devices: индуктор в OP — короткое замыкание (V(out)=V(in), I=1 мА)', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');
  const out = node(c, 'out');

  const v = device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]);
  v.inst.VSRCdcValue = 1;
  const l = device(c, 'Inductor', 'L1', 'LMOD', [inp, out]);
  l.inst.INDinduct = 1e-3;
  l.inst.INDindGiven = true;
  const r = device(c, 'Resistor', 'R1', 'RMOD', [out, gnd]);
  r.inst.RESresist = 1000;
  r.inst.RESresGiven = true;

  solveOp(c);
  closeTo(c.CKTrhs[out.number], 1, 1e-9, 'V(out) — индуктор замкнут');
  closeTo(c.CKTrhs[l.inst.INDbrEq], 1e-3, 1e-9, 'I(L1) = 1 мА');
  assert.ok(l.inst.INDbrEq > 0, 'ветвевое уравнение создано');
});

test('devices: mutual — MUTfactor и перекрёстные элементы матрицы', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const b = node(c, 'b');

  const l1 = device(c, 'Inductor', 'L1', 'LMOD', [a, gnd]);
  l1.inst.INDinduct = 2e-3;
  l1.inst.INDindGiven = true;
  const l2 = device(c, 'Inductor', 'L2', 'LMOD', [b, gnd]);
  l2.inst.INDinduct = 8e-3;
  l2.inst.INDindGiven = true;

  const m = device(c, 'mutual', 'K1', 'KMOD', []);
  m.inst.MUTcoupling = 0.5;
  m.inst.MUTindName1 = 'L1';
  m.inst.MUTindName2 = 'L2';

  assert.equal(ckt.cktSetup(c), ckt.OK);
  closeTo(m.inst.MUTfactor, 0.5 * Math.sqrt(2e-3 * 8e-3), 1e-12, 'MUTfactor');
  assert.equal(m.inst.MUTind1, l1.inst);
  assert.equal(m.inst.MUTind2, l2.inst);
  const el = SMPfindElt(c.CKTmatrix, l1.inst.INDbrEq, l2.inst.INDbrEq, false);
  assert.ok(el, 'элемент br1×br2 существует');
});

// ─────────────────────────── источники ───────────────────────────

test('devices: Vsource DC задаёт узел и уникальное имя ветви', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');

  const v = device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]);
  v.inst.VSRCdcValue = 3.3;
  v.inst.VSRCdcGiven = true;
  solveOp(c);

  closeTo(c.CKTrhs[inp.number], 3.3, 1e-9, 'V(in)');
  const branchNode = ckt.cktNum2Nod(c, v.inst.VSRCbranch);
  assert.ok(branchNode, 'ветвь V1 существует');
  assert.equal(branchNode.name, 'V1#branch');
});

test('devices: ISRC — порядок узлов как в C (Q-D02): ток в term2', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const out = node(c, 'out');

  // term1 = земля (ISRCnegNode), term2 = out (ISRCposNode).
  const i = device(c, 'Isource', 'I1', 'IMOD', [gnd, out]);
  i.inst.ISRCdcValue = 1e-3;
  i.inst.ISRCdcGiven = true;
  const r = device(c, 'Resistor', 'R1', 'RMOD', [out, gnd]);
  r.inst.RESresist = 1000;
  r.inst.RESresGiven = true;

  solveOp(c);
  assert.equal(i.inst.GENnode1, gnd.number, 'term1 → ISRCnegNode');
  assert.equal(i.inst.GENnode2, out.number, 'term2 → ISRCposNode');
  closeTo(c.CKTrhs[out.number], 1, 1e-9, 'V(out) = +1 В (ток втекает в out)');
});

test('devices: waveform PULSE/PWL — формулы F4 и границы PWL', () => {
  const c = makeCircuit();
  c.CKTfinalTime = 2;
  c.CKTstep = 1e-3;

  const v = {
    VSRCfunctionType: PULSE,
    VSRCfunctionOrder: 7,
    VSRCcoeffs: [0, 10, 0, 1, 0, 1, 2],
    VSRCdcValue: 0,
  };
  closeTo(sourceFunctionValue(v, c, -1), 0, 1e-12, 'PULSE до фронта');
  closeTo(sourceFunctionValue(v, c, 0.5), 5, 1e-12, 'PULSE середина фронта');
  closeTo(sourceFunctionValue(v, c, 1.5), 10, 1e-12, 'PULSE полка');
  closeTo(sourceFunctionValue(v, c, 2.5), 5, 1e-12, 'PULSE спад');

  const pwlV = {
    VSRCfunctionType: PWL,
    VSRCfunctionOrder: 4,
    VSRCcoeffs: [0, 0, 1, 1],
    VSRCdcValue: 0,
  };
  closeTo(sourceFunctionValue(pwlV, c, 0.5), 0.5, 1e-12, 'PWL интерполяция VSRC');
  const pwlI = {
    ISRCfunctionType: PWL,
    ISRCfunctionOrder: 4,
    ISRCcoeffs: [0, 0, 1, 1],
    ISRCdcValue: 0,
    pwlInclusive: true,
  };
  closeTo(sourceFunctionValue(pwlI, c, 0.5), 0.5, 1e-12, 'PWL интерполяция ISRC');
});

// ─────────────────────────── ключи ───────────────────────────

test('devices: Switch переключается по порогу и поднимает CKTnoncon', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const nc = node(c, 'nc');

  const vc = device(c, 'Vsource', 'VC', 'VMOD', [nc, gnd]);
  vc.inst.VSRCdcValue = 2;
  vc.inst.VSRCdcGiven = true;
  const va = device(c, 'Vsource', 'VA', 'VMOD', [a, gnd]);
  va.inst.VSRCdcValue = 1;
  va.inst.VSRCdcGiven = true;
  const s = device(c, 'Switch', 'S1', 'SMOD', [a, gnd, nc, gnd]);
  s.model.SWvThreshold = 1;
  s.model.SWvHysteresis = 0.1;
  s.model.SWthreshGiven = true;
  s.model.SWhystGiven = true;
  s.model.SWonConduct = 1;
  s.model.SWonGiven = true;
  s.model.SWoffConduct = 1e-12;
  s.model.SWoffGiven = true;

  assert.equal(ckt.cktSetup(c), ckt.OK);
  assert.equal(ckt.cktTemp(c), ckt.OK);

  // Одна итерация без обновления состояния: управляющее ещё 0 → ключ разомкнут.
  c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;
  assert.equal(ni.niIter(c, 0), ni.E_ITERLIM);
  assert.equal(c.CKTstates[0][s.inst.SWstate], 0, 'ключ разомкнут');
  closeTo(s.inst.SWcond, 1e-12, 1e-15, 'проводимость off');

  // Следующая итерация видит управляющее 2 В > 1.1 В → включение.
  c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;
  assert.equal(ni.niIter(c, 50), ckt.OK);
  assert.equal(c.CKTstates[0][s.inst.SWstate], 1, 'ключ замкнут');
  closeTo(s.inst.SWcond, 1, 1e-12, 'проводимость on');
});

test('devices: CSwitch находит ветвь управления через CKTfndBranch', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const nc = node(c, 'nc');

  const vc = device(c, 'Vsource', 'VC', 'VMOD', [nc, gnd]);
  vc.inst.VSRCdcValue = -1;
  vc.inst.VSRCdcGiven = true;
  const rc = device(c, 'Resistor', 'RC', 'RMOD', [nc, gnd]);
  rc.inst.RESresist = 1;
  rc.inst.RESresGiven = true;
  const va = device(c, 'Vsource', 'VA', 'VMOD', [a, gnd]);
  va.inst.VSRCdcValue = 1;
  va.inst.VSRCdcGiven = true;

  const s = device(c, 'CSwitch', 'W1', 'WMOD', [a, gnd]);
  s.inst.CSWcontName = 'VC';
  s.model.CSWiThreshold = 0.5;
  s.model.CSWthreshGiven = true;
  s.model.CSWiHysteresis = 0;
  s.model.CSWhystGiven = true;
  s.model.CSWonConduct = 1;
  s.model.CSWonGiven = true;
  s.model.CSWoffConduct = 1e-12;
  s.model.CSWoffGiven = true;

  const t = device(c, 'Resistor', 'RL', 'RMOD', [a, gnd]); // нагрузка
  t.inst.RESresist = 1000;
  t.inst.RESresGiven = true;

  assert.equal(ckt.cktSetup(c), ckt.OK);
  assert.equal(s.inst.CSWcontBranch, vc.inst.VSRCbranch, 'ветвь VC найдена');
  assert.equal(ckt.cktTemp(c), ckt.OK);

  c.CKTmode = ckt.MODEDC | ckt.MODEINITJCT;
  assert.equal(ni.niIter(c, 50), ckt.OK);
  c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;
  assert.equal(ni.niIter(c, 50), ckt.OK);
  assert.equal(c.CKTstates[0][s.inst.CSWstate], 1, 'ключ замкнут по току');
});

test('devices: DEVunsetup удаляет ветвевые уравнения', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');
  const out = node(c, 'out');

  device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]);
  device(c, 'Inductor', 'L1', 'LMOD', [inp, out]);
  assert.equal(ckt.cktSetup(c), ckt.OK);
  const maxBefore = c.CKTmaxEqNum;
  assert.equal(ckt.cktUnsetup(c), ckt.OK);
  assert.equal(c.CKTmaxEqNum, maxBefore - 2, 'удалены ветви V1 и L1');
});

// ─────────────────────────── точки останова (P1.5) ───────────────────────────

test('devices: CKTsetBreak/CKTclrBreak — сортировка, слияние, очистка', () => {
  const c = makeCircuit();
  c.CKTfinalTime = 5e-3;
  c.CKTminBreak = 1e-12;
  c.CKTtime = 0;
  c.CKTbreaks = [0, 1e-3, 5e-3];
  c.CKTbreakSize = 3;

  // Вставка в середину.
  assert.equal(ckt.cktSetBreak(c, 0.5e-3), ckt.OK);
  assert.deepEqual(c.CKTbreaks, [0, 0.5e-3, 1e-3, 5e-3]);
  assert.equal(c.CKTbreakSize, 4);

  // Слишком близко к предыдущей — пропуск.
  assert.equal(ckt.cktSetBreak(c, 0.5e-3 + 1e-13), ckt.OK);
  assert.deepEqual(c.CKTbreaks, [0, 0.5e-3, 1e-3, 5e-3]);

  // Слишком близко к следующей — сдвиг следующей на новое время.
  assert.equal(ckt.cktSetBreak(c, 1e-3 - 1e-13), ckt.OK);
  assert.equal(c.CKTbreaks[2], 1e-3 - 1e-13);

  // CKTclrBreak при size > 2 удаляет первую точку.
  assert.equal(ckt.cktClrBreak(c), ckt.OK);
  assert.equal(c.CKTbreakSize, 3);
  assert.deepEqual(c.CKTbreaks, [0.5e-3, 1e-3 - 1e-13, 5e-3]);

  // При size == 2 первая заменяется второй, вторая — finalTime.
  c.CKTbreaks = [1e-4, 2e-4];
  c.CKTbreakSize = 2;
  assert.equal(ckt.cktClrBreak(c), ckt.OK);
  assert.deepEqual(c.CKTbreaks, [2e-4, 5e-3]);
  assert.equal(c.CKTbreakSize, 2);
});

test('devices: CKTaccept — PULSE выставляет TD+TR и TD+TR+PW', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const inp = node(c, 'in');

  const v = device(c, 'Vsource', 'V1', 'VMOD', [inp, gnd]);
  v.inst.VSRCfunctionType = PULSE;
  v.inst.VSRCfunctionOrder = 7;
  v.inst.VSRCcoeffs = [0, 5, 0, 1e-9, 1e-9, 1e-3, 2e-3];
  v.inst.VSRCfuncTGiven = true;
  v.inst.VSRCdcGiven = false;

  assert.equal(ckt.cktSetup(c), ckt.OK);
  c.CKTfinalTime = 5e-3;
  c.CKTstep = 1e-4;
  c.CKTminBreak = 1e-12;
  c.CKTmode = ckt.MODETRAN;
  c.CKTbreaks = [0, c.CKTfinalTime];
  c.CKTbreakSize = 2;

  // t=0 — начало фронта: следующая точка останова TD+TR.
  c.CKTtime = 0;
  c.CKTbreak = 1;
  assert.equal(ckt.cktAccept(c), ckt.OK);
  assert.deepEqual(c.CKTbreaks, [0, 1e-9, 5e-3]);

  // t=TR — конец фронта: следующая точка TD+TR+PW.
  c.CKTtime = 1e-9;
  c.CKTbreak = 1;
  assert.equal(ckt.cktAccept(c), ckt.OK);
  assert.deepEqual(c.CKTbreaks, [0, 1e-9, 1.000001e-3, 5e-3]);
});

// ─────────────────────────── P2.1: диод ───────────────────────────

test('devices: pnjlim — ограничение шага pn-перехода (DEVpnjlim)', () => {
  const vt = 0.025852;
  const vcrit = 0.6;

  // Малый шаг — без ограничения.
  assert.deepEqual(pnjlim(0.5, 0.49, vt, vcrit), { vnew: 0.5, icheck: 0 });
  // Выше vcrit, но шаг <= 2*vt — без ограничения.
  assert.deepEqual(pnjlim(0.61, 0.60, vt, vcrit), { vnew: 0.61, icheck: 0 });

  // Большой шаг при vold > 0: логарифмическое ограничение.
  const limited = pnjlim(0.9, 0.5, vt, vcrit);
  assert.equal(limited.icheck, 1);
  assert.ok(Math.abs(limited.vnew - (0.5 + vt * Math.log(1 + 0.4 / vt))) < 1e-12);

  // vold <= 0: vnew = vt*ln(vnew/vt).
  const fromEnv = pnjlim(0.9, 0, vt, vcrit);
  assert.equal(fromEnv.icheck, 1);
  assert.ok(Math.abs(fromEnv.vnew - vt * Math.log(0.9 / vt)) < 1e-12);

  // arg <= 0: откат на vcrit.
  const clamped = pnjlim(0.7, 0.9, 0.05, 0.6);
  assert.deepEqual(clamped, { vnew: 0.6, icheck: 1 });
});

test('devices: диод — setup создаёт внутренний узел rs и 5 состояний', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const d = device(c, 'Diode', 'D1', 'DMOD', [a, gnd]);
  assert.equal(ckt.cktModParamByName(c, d.model, 'rs', 10), ckt.OK);
  assert.equal(ckt.cktModParamByName(c, d.model, 'is', 1e-14), ckt.OK);

  assert.equal(ckt.cktSetup(c), ckt.OK);
  const prime = d.inst.DIOposPrimeNode;
  assert.ok(prime > 0, 'внутренний узел создан');
  assert.notEqual(prime, a.number, 'posPrime не совпадает с узлом a');
  assert.equal(d.inst.DIOstate + 5 <= c.CKTnumStates, true, '5 состояний диода');

  // Внутренний узел удаляется DEVunsetup (через CKTunsetup).
  assert.equal(ckt.cktUnsetup(c), ckt.OK);
  assert.equal(d.inst.DIOposPrimeNode, 0, 'posPrime сброшен');

  // Без rs внутренний узел не создаётся.
  const c2 = makeCircuit();
  const gnd2 = ckt.cktGround(c2, '0').node;
  const a2 = node(c2, 'a');
  const d2 = device(c2, 'Diode', 'D2', 'DMOD2', [a2, gnd2]);
  assert.equal(ckt.cktSetup(c2), ckt.OK);
  assert.equal(d2.inst.DIOposPrimeNode, a2.number, 'rs=0: posPrime = анод');
});

test('devices: диод — температура и пробой (DIOtemp)', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const d = device(c, 'Diode', 'D1', 'DMOD', [a, gnd]);
  assert.equal(ckt.cktModParamByName(c, d.model, 'is', 1e-14), ckt.OK);
  assert.equal(ckt.cktModParamByName(c, d.model, 'cjo', 2e-12), ckt.OK);
  assert.equal(ckt.cktModParamByName(c, d.model, 'bv', 5), ckt.OK);
  assert.equal(ckt.cktModParamByName(c, d.model, 'ibv', 1e-3), ckt.OK);

  assert.equal(ckt.cktSetup(c), ckt.OK);
  assert.equal(ckt.cktTemp(c), ckt.OK);

  const vt = ckt.CONSTKoverQ * d.inst.DIOtemp;
  closeTo(d.inst.DIOtJctCap, 2e-12, 1e-12);
  assert.ok(d.inst.DIOtVcrit > 0.5 && d.inst.DIOtVcrit < 1, `tVcrit=${d.inst.DIOtVcrit}`);
  // tBrkdwnV — решение DIOtemp по bv/ibv: xbv = bv - vt*ln(1 + ibv/isat),
  // т.е. чуть меньше bv (при ibv=1e-3 и is=1e-14 — примерно на 0.65 В).
  assert.ok(
    d.inst.DIOtBrkdwnV > 4.2 && d.inst.DIOtBrkdwnV < 5,
    `tBrkdwnV=${d.inst.DIOtBrkdwnV}`,
  );
  assert.ok(d.inst.DIOtSatCur > 0, 'tSatCur положителен');
  assert.ok(Math.abs(vt - ckt.CONSTKoverQ * 300.15) < 1e-12, 'температура по умолчанию 300.15 K');
});

test('devices: диод — load: аналитика ВАХ и NOBYPASS-состояние (Q-D05)', () => {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0').node;
  const a = node(c, 'a');
  const v = device(c, 'Vsource', 'V1', 'VMOD', [a, gnd]);
  v.inst.VSRCdcValue = 0.65;
  v.inst.VSRCdcGiven = true;
  const d = device(c, 'Diode', 'D1', 'DMOD', [a, gnd]);
  assert.equal(ckt.cktModParamByName(c, d.model, 'is', 1e-14), ckt.OK);

  solveOp(c);

  const s0 = c.CKTstates[0];
  const vd = s0[DIO_VD];
  const vt = ckt.CONSTKoverQ * d.inst.DIOtemp;
  const evd = Math.exp(vd / vt);
  closeTo(s0[DIO_ID], 1e-14 * (evd - 1) + c.CKTgmin * vd, 1e-9, 'id');
  closeTo(s0[DIO_GD], (1e-14 * evd) / vt + c.CKTgmin, 1e-9, 'gd');
  // Q-D05: состояние диода равно последнему решению, а не предыдущей итерации.
  closeTo(vd, c.CKTrhsOld[a.number], 1e-12, 'state vd = CKTrhsOld[a]');
});
