/**
 * ni.test.mjs — юниты численного ядра (Site/engine/spice/ni.js, P1.3).
 *
 * Фиксируют контракт порта:
 *  - `NIcomCof` — коэффициенты трапеции (порядки 1–2) и Gear (1–6 = BDF);
 *  - `NIintegrate` — корректор трапеции/Gear, `geq`/`ceq`, ошибки;
 *  - `NIconvTest` — пороги узлов/ветвей и вызов `CKTconvTest` (XSPICE-возврат 1);
 *  - `NIiter` — сходимость, singular, `E_ITERLIM`, `MODEUIC`, `NIUNINITIALIZED`;
 *  - `cktLoad`/`cktConvTest`/`cktTrunc` — XSPICE-семантика nodeset/ic, LTE-минимум.
 *
 * Реальных устройств в P1.3 нет — матрицу/состояния штампуют синтетические
 * device-хуки (восстанавливаются в finally).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as ckt from '../spice/ckt.js';
import * as ni from '../spice/ni.js';
import { SMPmakeElt, SMPaddElt, SMPfindElt, SMPmatSize } from '../spice/sparse.js';

/** Новая цепь (assert, что CKTinit не вернул ошибку). */
function makeCircuit() {
  const { error, ckt: circuit } = ckt.cktInit();
  assert.equal(error, ckt.OK, 'CKTinit');
  assert.ok(circuit, 'CKTinit вернул цепь');
  return circuit;
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

/** Приближённое сравнение. */
function closeTo(actual, expected, eps = 1e-12, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${msg}: ожидалось ${expected}, получено ${actual}`,
  );
}

/** Цепь из одного узла `n1` и фейкового резистора R1 (n1↔gnd). */
function buildOneNodeCircuit() {
  const c = makeCircuit();
  const gnd = ckt.cktGround(c, '0');
  assert.equal(gnd.error, ckt.OK);
  const n = ckt.cktNewNode(c, 'n1');
  assert.equal(n.error, ckt.OK);

  const rType = ckt.cktDevIndex('Resistor');
  const model = ckt.cktModCrt(c, rType, 'RMOD');
  assert.equal(model.error, ckt.OK);
  const inst = ckt.cktCrtElt(c, model.model, 'R1');
  assert.equal(inst.error, ckt.OK);
  assert.equal(ckt.cktBindNode(c, inst.instance, 1, n.node), ckt.OK);
  assert.equal(ckt.cktBindNode(c, inst.instance, 2, gnd.node), ckt.OK);

  return { c, node: n.node, model: model.model, inst: inst.instance };
}

/** Setup с фейковым резистором G=1 (диагональ 1,1) и источником I=1. */
function withLinearCircuit(fn) {
  const built = buildOneNodeCircuit();
  return withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = (matrix) => {
      SMPmakeElt(matrix, 1, 1);
      return ckt.OK;
    };
    return withDeviceHook('Resistor', 'DEVload', (dev2) => {
      dev2.DEVload = (_model, c) => {
        SMPaddElt(c.CKTmatrix, 1, 1, 1);
        c.CKTrhs[1] += 1;
        return ckt.OK;
      };
      assert.equal(ckt.cktSetup(built.c), ckt.OK);
      built.c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;
      return fn(built);
    });
  });
}

// ─────────────────────────── NIcomCof ───────────────────────────

test('ni: NIcomCof — трапеция, порядки 1 и 2', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = ckt.TRAPEZOIDAL;
  c.CKTdelta = 0.5;

  c.CKTorder = 1;
  assert.equal(ni.niComCof(c), ckt.OK);
  closeTo(c.CKTag[0], 2, 1e-15, 'trap1 tag0');
  closeTo(c.CKTag[1], -2, 1e-15, 'trap1 tag1');

  c.CKTorder = 2;
  assert.equal(ni.niComCof(c), ckt.OK);
  closeTo(c.CKTag[0], 4, 1e-15, 'trap2 tag0');
  closeTo(c.CKTag[1], 1, 1e-15, 'trap2 tag1');

  c.CKTorder = 3;
  assert.equal(ni.niComCof(c), ni.E_ORDER);
  assert.match(c.errMsg, /Illegal integration order/);
});

test('ni: NIcomCof — Gear 1–6 при постоянном шаге = BDF-коэффициенты', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = ckt.GEAR;
  c.CKTdelta = 1;
  c.CKTdeltaOld.fill(1);

  const bdf = {
    1: [1, -1],
    2: [3 / 2, -2, 1 / 2],
    3: [11 / 6, -3, 3 / 2, -1 / 3],
    4: [25 / 12, -4, 3, -4 / 3, 1 / 4],
    5: [137 / 60, -5, 5, -10 / 3, 5 / 4, -1 / 5],
    6: [49 / 20, -6, 15 / 2, -20 / 3, 15 / 4, -6 / 5, 1 / 6],
  };

  for (let order = 1; order <= 6; order++) {
    c.CKTorder = order;
    c.CKTag.fill(0);
    assert.equal(ni.niComCof(c), ckt.OK, `gear${order}`);
    for (let i = 0; i <= order; i++) {
      closeTo(c.CKTag[i], bdf[order][i], 1e-12, `gear${order} tag${i}`);
    }
    // «Лишние» коэффициенты остаются нулями.
    for (let i = order + 1; i < 7; i++) closeTo(c.CKTag[i], 0, 0, `gear${order} tag${i}=0`);
  }

  c.CKTorder = 7;
  assert.equal(ni.niComCof(c), ni.E_ORDER);
});

test('ni: NIcomCof — неизвестный метод → E_METHOD', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = 99;
  assert.equal(ni.niComCof(c), ni.E_METHOD);
  assert.match(c.errMsg, /Unknown integration method/);
});

// ─────────────────────────── NIintegrate ───────────────────────────

/** Состояния: 8 векторов по 8 значений (qcap=0, ccap=1). */
function statesWith(values) {
  const states = new Array(8).fill(null).map(() => new Float64Array(8));
  for (const [stateIndex, q, i] of values) {
    states[stateIndex][0] = q;
    if (i !== undefined) states[stateIndex][1] = i;
  }
  return states;
}

test('ni: NIintegrate — трапеция, порядки 1 и 2', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = ckt.TRAPEZOIDAL;

  c.CKTorder = 1;
  c.CKTstates = statesWith([[0, 3], [1, 1]]);
  c.CKTag[0] = 2;
  c.CKTag[1] = -2;
  let r = ni.niIntegrate(c, 1e-6, 0);
  assert.equal(r.error, ckt.OK);
  closeTo(c.CKTstates[0][1], 4, 1e-15, 'trap1 ccap');
  closeTo(r.geq, 2e-6, 1e-21, 'trap1 geq');
  closeTo(r.ceq, -2, 1e-15, 'trap1 ceq');

  c.CKTorder = 2;
  c.CKTstates = statesWith([[0, 3], [1, 1, 5]]);
  c.CKTag[0] = 4;
  c.CKTag[1] = 1;
  r = ni.niIntegrate(c, 1e-6, 0);
  assert.equal(r.error, ckt.OK);
  closeTo(c.CKTstates[0][1], 3, 1e-15, 'trap2 ccap');
  closeTo(r.geq, 4e-6, 1e-21, 'trap2 geq');
  closeTo(r.ceq, -9, 1e-15, 'trap2 ceq');

  c.CKTorder = 3;
  r = ni.niIntegrate(c, 1e-6, 0);
  assert.equal(r.error, ni.E_ORDER);
  assert.match(c.errMsg, /Illegal integration order/);
});

test('ni: NIintegrate — Gear, порядок 2', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = ckt.GEAR;
  c.CKTorder = 2;
  c.CKTstates = statesWith([[0, 3], [1, 1], [2, 2]]);
  c.CKTag[0] = 1.5;
  c.CKTag[1] = -2;
  c.CKTag[2] = 0.5;

  const r = ni.niIntegrate(c, 1e-6, 0);
  assert.equal(r.error, ckt.OK);
  closeTo(c.CKTstates[0][1], 3.5, 1e-15, 'gear2 ccap');
  closeTo(r.geq, 1.5e-6, 1e-21, 'gear2 geq');
  closeTo(r.ceq, -1, 1e-15, 'gear2 ceq');
});

test('ni: NIintegrate — неизвестный метод → E_METHOD', () => {
  const c = makeCircuit();
  c.CKTintegrateMethod = 99;
  c.CKTstates = statesWith([]);
  const r = ni.niIntegrate(c, 1, 0);
  assert.equal(r.error, ni.E_METHOD);
  assert.match(c.errMsg, /Unknown integration method/);
});

// ─────────────────────────── NIconvTest / CKTconvTest ───────────────────────────

test('ni: NIconvTest — пороги узла (vntol) и ветви (abstol)', () => {
  const c = makeCircuit();
  SMPmakeElt(c.CKTmatrix, 1, 1);
  SMPmakeElt(c.CKTmatrix, 2, 2);
  assert.equal(SMPmatSize(c.CKTmatrix), 2);

  // Земля + два узла: первый — напряжение, второй — ток.
  ckt.cktGround(c, '0');
  const n1 = ckt.cktNewNode(c, 'n1');
  const n2 = ckt.cktNewEq(c, 'i1');
  assert.equal(n1.error, ckt.OK);
  assert.equal(n2.error, ckt.OK);
  n2.node.type = ckt.SP_CURRENT;

  c.CKTrhs = new Float64Array(3);
  c.CKTrhsOld = new Float64Array(3);
  c.CKTreltol = 1e-3;
  c.CKTvoltTol = 1e-6;
  c.CKTabstol = 1e-12;

  // Узел: |Δ| = 1e-7 < 1e-3*1 + 1e-6.
  c.CKTrhs[1] = 1.0000001;
  c.CKTrhsOld[1] = 1;
  assert.equal(ni.niConvTest(c), 0);

  // Узел: |Δ| = 0.1 > порога.
  c.CKTrhs[1] = 1.1;
  assert.equal(ni.niConvTest(c), 1);

  // Ветвь: |Δ| = 1e-10 > abstol=1e-12.
  c.CKTrhs[1] = 1;
  c.CKTrhs[2] = 1e-10;
  c.CKTrhsOld[2] = 0;
  assert.equal(ni.niConvTest(c), 1);
});

test('ni: NIconvTest — CKTconvTest возвращает 1 при CKTnoncon (XSPICE)', () => {
  const { c } = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVconvTest', (dev) => {
    dev.DEVconvTest = (_model, circuit) => {
      circuit.CKTnoncon = 1;
      return ckt.OK;
    };
    assert.equal(ckt.cktConvTest(c), 1);
  });
  c.CKTnoncon = 0;
  assert.equal(ckt.cktConvTest(c), 0, 'без хука — сходимость');
});

// ─────────────────────────── NIiter ───────────────────────────

test('ni: NIiter — линейная цепь сходится за 2 итерации (V=1)', () => {
  withLinearCircuit(({ c }) => {
    assert.equal(ni.niIter(c, 10), ckt.OK);
    closeTo(c.CKTrhs[1], 1, 1e-12, 'V(n1)');
    assert.equal(c.CKTnoncon, 0);
    assert.ok(c.CKTniState & ni.NIDIDPREORDER, 'preorder выполнен');
    assert.equal(c.CKTstat.STATnumIter, 2, 'две итерации');
  });
});

test('ni: NIiter — вырожденная матрица → E_SINGULAR + имена узлов', () => {
  const built = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = (matrix) => {
      SMPmakeElt(matrix, 1, 1); // элемент есть, но DEVload его не заполняет
      return ckt.OK;
    };
    withDeviceHook('Resistor', 'DEVload', (dev2) => {
      dev2.DEVload = () => ckt.OK;
      assert.equal(ckt.cktSetup(built.c), ckt.OK);
      built.c.CKTmode = ckt.MODEDC | ckt.MODEINITFLOAT;

      assert.equal(ni.niIter(built.c, 10), ni.E_SINGULAR);
      assert.match(built.c.errMsg, /singular matrix:  check nodes n1 and n1/);
    });
  });
});

test('ni: NIiter — отсутствие сходимости → E_ITERLIM', () => {
  withLinearCircuit(({ c }) => {
    withDeviceHook('Resistor', 'DEVconvTest', (dev) => {
      dev.DEVconvTest = (_model, circuit) => {
        circuit.CKTnoncon = 1;
        return ckt.OK;
      };
      assert.equal(ni.niIter(c, 2), ni.E_ITERLIM);
      assert.match(c.errMsg, /Too many iterations without convergence/);
    });
  });
});

test('ni: NIiter — MODEUIC меняет rhs/rhsOld и не вызывает CKTload', () => {
  withLinearCircuit(({ c }) => {
    const before = { rhs: c.CKTrhs, old: c.CKTrhsOld };
    let loads = 0;
    withDeviceHook('Resistor', 'DEVload', (dev) => {
      dev.DEVload = () => {
        loads++;
        return ckt.OK;
      };
      c.CKTmode = ckt.MODETRANOP | ckt.MODEUIC;
      assert.equal(ni.niIter(c, 10), ckt.OK);
    });
    assert.equal(loads, 0, 'CKTload не вызывался');
    assert.equal(c.CKTrhs, before.old, 'rhs ← старый rhsOld');
    assert.equal(c.CKTrhsOld, before.rhs, 'rhsOld ← старый rhs');
  });
});

test('ni: NIiter — NIUNINITIALIZED вызывает NIreinit', () => {
  withLinearCircuit(({ c }) => {
    c.CKTniState |= ni.NIUNINITIALIZED;
    c.CKTrhs = null;
    c.CKTrhsOld = null;
    c.CKTrhsSpare = null;

    assert.equal(ni.niIter(c, 10), ckt.OK);
    assert.equal(c.CKTniState & ni.NIUNINITIALIZED, 0, 'флаг снят');
    assert.ok(c.CKTrhs instanceof Float64Array);
    closeTo(c.CKTrhs[1], 1, 1e-12, 'V(n1) после reinit');
  });
});

// ─────────────────────────── CKTload / CKTtrunc ───────────────────────────

test('ckt: CKTload — XSPICE-семантика nodeset (rhs +=, diag += 1)', () => {
  const built = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = (matrix) => {
      SMPmakeElt(matrix, 1, 1);
      return ckt.OK;
    };
    withDeviceHook('Resistor', 'DEVload', (dev2) => {
      dev2.DEVload = () => ckt.OK;
      assert.equal(ckt.cktSetup(built.c), ckt.OK);

      built.node.nsGiven = true;
      built.node.nodeset = 5;
      assert.equal(ckt.cktIc(built.c), ckt.OK);

      built.c.CKTmode = ckt.MODEDC | ckt.MODEINITJCT;
      assert.equal(ckt.cktLoad(built.c), ckt.OK);
      closeTo(built.c.CKTrhs[1], 5, 1e-15, 'nodeset в RHS');
      closeTo(SMPfindElt(built.c.CKTmatrix, 1, 1, 0).real, 1, 1e-15, 'diag += 1');
    });
  });
});

test('ckt: CKTload — XSPICE-семантика ic (только MODETRANOP, без UIC)', () => {
  const built = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVsetup', (dev) => {
    dev.DEVsetup = (matrix) => {
      SMPmakeElt(matrix, 1, 1);
      return ckt.OK;
    };
    withDeviceHook('Resistor', 'DEVload', (dev2) => {
      dev2.DEVload = () => ckt.OK;
      assert.equal(ckt.cktSetup(built.c), ckt.OK);

      built.node.icGiven = true;
      built.node.ic = 3;
      assert.equal(ckt.cktIc(built.c), ckt.OK);

      built.c.CKTmode = ckt.MODEDC | ckt.MODETRANOP;
      assert.equal(ckt.cktLoad(built.c), ckt.OK);
      closeTo(built.c.CKTrhs[1], 3, 1e-15, 'ic в RHS');

      // С UIC — ic не применяется.
      built.c.CKTmode = ckt.MODEDC | ckt.MODETRANOP | ckt.MODEUIC;
      assert.equal(ckt.cktLoad(built.c), ckt.OK);
      closeTo(built.c.CKTrhs[1], 0, 1e-15, 'UIC: ic не применён');
    });
  });
});

test('ckt: CKTload — очищает RHS и матрицу перед DEVload', () => {
  withLinearCircuit(({ c }) => {
    c.CKTrhs[1] = 42;
    SMPaddElt(c.CKTmatrix, 1, 1, 7);

    assert.equal(ckt.cktLoad(c), ckt.OK);
    closeTo(c.CKTrhs[1], 1, 1e-15, 'RHS перезагружен');
    closeTo(SMPfindElt(c.CKTmatrix, 1, 1, 0).real, 1, 1e-15, 'матрица перезагружена');
  });
});

test('ckt: CKTtrunc — минимум из DEVtrunc и 2*h', () => {
  const { c } = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVtrunc', (dev) => {
    dev.DEVtrunc = (_model, _c, state) => {
      state.timeStep = 1e-4;
      return ckt.OK;
    };
    const r = ckt.cktTrunc(c, 1e-3);
    assert.equal(r.error, ckt.OK);
    closeTo(r.timeStep, 1e-4, 1e-15, 'шаг урезан устройством');
  });

  const r2 = ckt.cktTrunc(c, 1e-3);
  assert.equal(r2.error, ckt.OK);
  closeTo(r2.timeStep, 2e-3, 1e-15, 'без DEVtrunc — 2*h');
});

test('ckt: CKTtrunc — ошибка устройства пробрасывается', () => {
  const { c } = buildOneNodeCircuit();
  withDeviceHook('Resistor', 'DEVtrunc', (dev) => {
    dev.DEVtrunc = () => ni.E_ORDER;
    const r = ckt.cktTrunc(c, 1e-3);
    assert.equal(r.error, ni.E_ORDER);
  });
});

// ─────────────────────────── КОДЫ ───────────────────────────

test('ni: коды ошибок = sperror.h', () => {
  assert.equal(ni.E_ITERLIM, 103);
  assert.equal(ni.E_ORDER, 104);
  assert.equal(ni.E_METHOD, 105);
  // Реэкспорт из ckt.js (единые константы).
  assert.equal(ckt.E_ITERLIM, 103);
  assert.equal(ckt.E_ORDER, 104);
  assert.equal(ckt.E_METHOD, 105);
});
