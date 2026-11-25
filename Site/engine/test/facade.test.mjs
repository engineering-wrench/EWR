// facade.test.mjs — мост «сцена редактора → CKT» (фаза I, план I1-gui).
//
// Фиксирует контракт GUI-интеграции:
//  - сцена `WireSystem.scene()` переводится в деку CKT (узлы, устройства,
//    земля, приборы);
//  - OP/TRAN/AC дают ожидаемые значения (делитель, RC);
//  - неподдерживаемые устройства не мешают расчёту (уходят в `skipped`);
//  - швы `getVoltage`/`getCurrent` читают последнее решение;
//  - ошибки сцены (нет земли/пустая/нет элементов) не бросают исключений.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sceneToDeck,
  simulateScene,
  runDeck,
  formatValue,
} from '../ewb-facade.js';
import * as ckt from '../spice/ckt.js';

/** Делитель 10 В / 1 кОм / 1 кОм + земля. */
function dividerScene(extra = []) {
  return {
    components: [
      { inst: 'V1', editorId: 'generator', etype: 'vsource', value: '10', ports: ['p1', 'p2'] },
      { inst: 'R1', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
      { inst: 'R2', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
      { inst: 'G1', editorId: 'point', etype: 'ground', value: '', ports: ['p1'] },
      ...extra,
    ],
    links: [
      ['V1:p1', 'R1:p1'],
      ['R1:p2', 'R2:p1'],
      ['V1:p2', 'G1:p1'],
      ['R2:p2', 'G1:p1'],
    ],
  };
}

test('sceneToDeck: делитель — узлы, земля, параметры устройств', () => {
  const meta = sceneToDeck(dividerScene(), { analysis: 'op' });
  assert.equal(meta.error, null);
  assert.equal(meta.ground, '0');
  assert.deepEqual(meta.deck.elements.map((e) => e.name), ['V1', 'R1', 'R2']);
  assert.deepEqual(meta.deck.elements[0].nodes, ['n1', '0']);
  assert.equal(meta.deck.elements[0].params.dc, 10);
  assert.equal(meta.deck.elements[1].params.resistance, 1000);
  assert.equal(meta.deck.analyses[0].type, 'OP');
});

test('sceneToDeck: земля по минусу источника, если символа ground нет', () => {
  const scene = dividerScene();
  scene.components = scene.components.filter((c) => c.inst !== 'G1');
  scene.links = scene.links.filter((l) => !l.some((t) => t.startsWith('G1:')));
  const meta = sceneToDeck(scene);
  assert.equal(meta.error, null);
  assert.deepEqual(meta.deck.elements[0].nodes, ['n1', '0']);
});

test('sceneToDeck: нет земли — понятная ошибка, без исключения', () => {
  const meta = sceneToDeck({
    components: [{ inst: 'R1', editorId: 'resistor', etype: 'resistor', value: '1', ports: ['p1', 'p2'] }],
    links: [],
  });
  assert.equal(meta.error, 'no-ground');
  assert.match(meta.message, /земл/i);
});

test('sceneToDeck: пустая сцена и сцена без поддерживаемых элементов', () => {
  assert.equal(sceneToDeck({ components: [], links: [] }).error, 'empty');
  const meta = sceneToDeck({
    components: [
      { inst: 'D1', editorId: 'diode', etype: 'diode', value: '1', ports: ['p1', 'p2'] },
      { inst: 'G1', editorId: 'point', etype: 'ground', ports: ['p1'] },
    ],
    links: [['D1:p2', 'G1:p1']],
  });
  assert.equal(meta.error, 'no-elements');
  assert.equal(meta.skipped[0].inst, 'D1');
});

test('simulateScene OP: делитель даёт 10/5 В и ток 5 мА', () => {
  const r = simulateScene(dividerScene(), { analysis: 'op' });
  assert.equal(r.ok, true);
  assert.equal(r.rc, 0);
  assert.equal(r.nodeVoltages.n1, 10);
  assert.equal(r.nodeVoltages.n2, 5);
  assert.ok(Math.abs(r.branchCurrents.V1 + 0.005) < 1e-12);
  assert.deepEqual(r.errors, []);
});

test('simulateScene: вольтметр показывает напряжение, амперметр — ток', () => {
  const scene = dividerScene([
    { inst: 'M1', editorId: 'multimeter', etype: 'instrument', ports: ['p_in', 'p_out'] },
    { inst: 'A1', editorId: 'ammeter', etype: 'instrument', ports: ['p_in', 'p_out'] },
  ]);
  // Вольтметр — параллельно R2; амперметр — последовательно в верхней ветви.
  scene.components = scene.components.filter((c) => c.inst !== 'R1');
  scene.links = [
    ['V1:p1', 'A1:p_in'],
    ['A1:p_out', 'R2:p1'],
    ['V1:p2', 'G1:p1'],
    ['R2:p2', 'G1:p1'],
    ['M1:p_in', 'R2:p1'],
    ['M1:p_out', 'G1:p1'],
  ];
  const r = simulateScene(scene, { analysis: 'op' });
  assert.equal(r.ok, true);
  const volt = r.readings.find((x) => x.inst === 'M1');
  const amp = r.readings.find((x) => x.inst === 'A1');
  assert.ok(Math.abs(volt.value - 10) < 1e-9, 'U(R2) = 10 В');
  assert.ok(Math.abs(Math.abs(amp.value) - 0.01) < 1e-9, 'I = U/R = 10 мА');
});

test('simulateScene: неподдерживаемый диод пропускается, схема считается', () => {
  const scene = dividerScene([
    { inst: 'D1', editorId: 'diode', etype: 'diode', value: '1', ports: ['p1', 'p2'] },
  ]);
  const r = simulateScene(scene, { analysis: 'op' });
  assert.equal(r.ok, true);
  assert.equal(r.nodeVoltages.n2, 5);
  assert.deepEqual(r.skipped.map((s) => s.inst), ['D1']);
});

test('simulateScene: RC-заряд через PULSE — TRAN даёт ряд с ростом U', () => {
  const scene = {
    components: [
      {
        inst: 'V1',
        editorId: 'generator',
        etype: 'vsource',
        pulse: [0, 5, 0, 1e-9, 1e-9, 5e-3, 10e-3],
        ports: ['p1', 'p2'],
      },
      { inst: 'R1', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
      { inst: 'C1', editorId: 'capacitor', etype: 'capacitor', value: '1e-6', ports: ['p1', 'p2'] },
      { inst: 'G1', editorId: 'point', etype: 'ground', ports: ['p1'] },
    ],
    links: [
      ['V1:p1', 'R1:p1'],
      ['R1:p2', 'C1:p1'],
      ['C1:p2', 'G1:p1'],
      ['V1:p2', 'G1:p1'],
    ],
  };
  const r = simulateScene(scene, { analysis: 'tran', tstop: 5e-3, tstep: 1e-4, tmax: 1e-4 });
  assert.equal(r.ok, true);
  const out = r.series.n2;
  assert.ok(Array.isArray(out) && out.length > 10, 'есть временной ряд n2');
  assert.equal(out[0].ref, 0);
  assert.ok(out.at(-1).value > 3.5, 'конденсатор зарядился к концу переходного процесса');
});

test('simulateScene AC: RC-фильтр — |H| падает с частотой', () => {
  const scene = {
    components: [
      { inst: 'V1', editorId: 'generator', etype: 'vsource', value: '0', ports: ['p1', 'p2'] },
      { inst: 'R1', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
      { inst: 'C1', editorId: 'capacitor', etype: 'capacitor', value: '1e-6', ports: ['p1', 'p2'] },
      { inst: 'G1', editorId: 'point', etype: 'ground', ports: ['p1'] },
    ],
    links: [
      ['V1:p1', 'R1:p1'],
      ['R1:p2', 'C1:p1'],
      ['C1:p2', 'G1:p1'],
      ['V1:p2', 'G1:p1'],
    ],
  };
  const r = simulateScene(scene, { analysis: 'ac', fstart: 10, fstop: 10000, points: 10 });
  assert.equal(r.ok, true);
  const out = r.series.n2;
  assert.ok(out.length >= 10);
  assert.ok(out[0].value.mag > 0.99, 'на низкой частоте коэффициент ~1');
  assert.ok(out.at(-1).value.mag < 0.02, 'на высокой частоте коэффициент мал');
});

test('швы getVoltage/getCurrent читают последнее решение CKT', () => {
  const meta = sceneToDeck(dividerScene(), { analysis: 'op' });
  const run = runDeck(meta.deck);
  assert.equal(run.rc, 0);
  assert.equal(ckt.getVoltage(run.ckt, 'n2').value, 5);
  assert.equal(ckt.getVoltage(run.ckt, 2).value, 5);
  assert.ok(Math.abs(ckt.getCurrent(run.ckt, 'V1').value + 0.005) < 1e-12);
  assert.equal(ckt.getVoltage(run.ckt, 'nope').error, ckt.E_NOTFOUND);
  assert.equal(ckt.getCurrent(run.ckt, 'R1').error, ckt.E_NOTFOUND);
});

test('formatValue: число, экспонента и комплекс', () => {
  assert.equal(formatValue(5), '5 В');
  assert.equal(formatValue(1e-6, 'А'), '1.000e-6 А');
  assert.match(formatValue({ re: 0, im: 1, mag: 1, phase: Math.PI / 2 }), /∠90\.0°/);
});
