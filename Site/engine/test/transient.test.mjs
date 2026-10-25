import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../index.js';

const RC = { R: 1000, C: 1e-6 }; // tau = 1 мс

test('TRAN: зарядка RC (UIC) совпадает с аналитикой', () => {
    const tstep = 1e-6, tstop = 5e-3;
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: RC.R, nodes: ['n1', 'n2'] },
            { id: 'C1', type: 'capacitor', value: RC.C, ic: 0, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'tran', tstop, tstep, uic: true });

    const vAt = (t) => r.v['n2'][Math.round(t / tstep)];
    const analytic = (t) => 5 * (1 - Math.exp(-t / (RC.R * RC.C)));
    assert.ok(Math.abs(vAt(1e-3) - analytic(1e-3)) < 0.02, `@1ms: ${vAt(1e-3)} vs ${analytic(1e-3)}`);
    assert.ok(Math.abs(vAt(3e-3) - analytic(3e-3)) < 0.02, `@3ms: ${vAt(3e-3)}`);
    assert.ok(Math.abs(vAt(5e-3) - analytic(5e-3)) < 0.02, `@5ms: ${vAt(5e-3)} vs ${analytic(5e-3)}`);
});

test('TRAN: индуктивность — ток нарастает по 1-exp (UIC)', () => {
    // V1 -> R1 -> L1 -> gnd. i(t) = V/R (1 - exp(-t R/L))
    const R = 100, L = 1e-3; // tau = L/R = 10 мкс
    const tstep = 2e-8, tstop = 1e-4;
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: R, nodes: ['n1', 'n2'] },
            { id: 'L1', type: 'inductor', value: L, ic: 0, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'tran', tstop, tstep, uic: true });
    const iAt = (t) => r.i['L1'][Math.round(t / tstep)];
    const steady = 5 / R;
    const analytic = (t) => steady * (1 - Math.exp(-t / (L / R)));
    assert.ok(Math.abs(iAt(1e-5) - analytic(1e-5)) < steady * 0.02, `@10us: ${iAt(1e-5)} vs ${analytic(1e-5)}`);
    assert.ok(Math.abs(iAt(1e-4) - steady) < steady * 0.02, `@100us: ${iAt(1e-4)}`);
});

test('TRAN: PWL-источник надёжно задаёт импульс', () => {
    // V1 PWL с полкой: 0 до ~1 мс, скачок в 5 В, полка до 2 мс, спад в 0.
    // Чисто резистивная нагрузка (R1||R2) => V(n1) повторяет форму источника.
    const tstep = 1e-6;
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', pwl: [[0, 0], [9e-4, 0], [1e-3, 5], [2e-3, 5], [2.001e-3, 0]], nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
            { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'tran', tstop: 5e-3, tstep });
    const at = (t) => r.v['n1'][Math.round(t / tstep)];
    assert.ok(Math.abs(at(5e-4) - 0) < 0.05, `до импульса: ${at(5e-4)}`);
    assert.ok(Math.abs(at(1.5e-3) - 5) < 0.05, `полка: ${at(1.5e-3)}`);
    assert.ok(Math.abs(at(4e-3) - 0) < 0.05, `после: ${at(4e-3)}`);
});
