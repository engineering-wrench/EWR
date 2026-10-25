import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../index.js';

// --- Линейные схемы ---

test('DC: делитель напряжения 10В/1к/1к', () => {
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
            { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'op' });
    assert.ok(Math.abs(r.nodeVoltages.n1 - 10) < 1e-6);
    assert.ok(Math.abs(r.nodeVoltages.n2 - 5) < 1e-6);
    assert.ok(Math.abs(r.branchCurrents.V1 + 0.005) < 1e-9); // 5 мА из + (знак KCL)
    const r1 = r.elements.find((e) => e.id === 'R1');
    assert.ok(Math.abs(r1.i - 0.005) < 1e-9);
});

test('DC: источник тока 1 мА в 1 кОм -> 1 В', () => {
    const r = simulate({
        components: [
            { id: 'I1', type: 'isource', dc: 1e-3, nodes: ['gnd', 'n'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n', 'gnd'] },
        ],
    }, { analysis: 'op' });
    assert.ok(Math.abs(r.nodeVoltages.n - 1) < 1e-6, `n=${r.nodeVoltages.n}`);
});

test('DC: Thevenin — два источника на общей линии (наложение)', () => {
    // V1=12 -> R1(2k) -> n ; V2=6 -> R2(2k) -> n ; R3(1k) -> gnd
    // Наложение: (12/2 + 6/2)/(1/2+1/2+1) = (6+3)/2 = 4.5 В на n
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: 12, nodes: ['a', 'gnd'] },
            { id: 'R1', type: 'resistor', value: 2000, nodes: ['a', 'n'] },
            { id: 'V2', type: 'vsource', dc: 6, nodes: ['b', 'gnd'] },
            { id: 'R2', type: 'resistor', value: 2000, nodes: ['b', 'n'] },
            { id: 'R3', type: 'resistor', value: 1000, nodes: ['n', 'gnd'] },
        ],
    }, { analysis: 'op' });
    assert.ok(Math.abs(r.nodeVoltages.n - 4.5) < 1e-6, `n=${r.nodeVoltages.n}`);
});

// --- Нелинейная схема (диод) ---

test('DC: прямой диод — падение ~0.7В и согласованный ток', () => {
    const R = 220;
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
            { id: 'D1', type: 'diode', is: 1e-14, n: 1, nodes: ['n1', 'n2'] },
            { id: 'R1', type: 'resistor', value: R, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'op' });
    const d = r.elements.find((e) => e.id === 'D1');
    assert.ok(d.v > 0.6 && d.v < 0.8, `Vd=${d.v}`);           // прямое падение
    const expected = (5 - d.v) / R;
    assert.ok(Math.abs(r.nodeVoltages.n2 / R - expected) < 1e-4); // ток через R
    assert.ok(Math.abs(d.i - r.nodeVoltages.n2 / R) < 1e-4);      // ток диода == току R
});

test('DC: обратный диод — практически закрыт', () => {
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: -5, nodes: ['n1', 'gnd'] },
            { id: 'D1', type: 'diode', is: 1e-14, n: 1, nodes: ['n1', 'n2'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'op' });
    const d = r.elements.find((e) => e.id === 'D1');
    assert.ok(d.v < -4, `Vd=${d.v}`);                 // смещён в запирании
    assert.ok(Math.abs(r.branchCurrents.V1) < 1e-6, `I=${r.branchCurrents.V1}`); // ток ~0
    assert.ok(Math.abs(r.nodeVoltages.n2) < 0.05, `n2=${r.nodeVoltages.n2}`);
});
