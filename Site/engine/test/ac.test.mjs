import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../index.js';

const mag = (c) => Math.hypot(c.re, c.im);
const phaseDeg = (c) => (Math.atan2(c.im, c.re) * 180) / Math.PI;

test('AC: RC-финитр — усиление 1/√2 и фаза -45° на частоте среза', () => {
    const R = 1000, C = 1e-6;
    const fc = 1 / (2 * Math.PI * R * C); // 159.15 Гц
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', ac: 1, nodes: ['in', 'gnd'] },
            { id: 'R1', type: 'resistor', value: R, nodes: ['in', 'n2'] },
            { id: 'C1', type: 'capacitor', value: C, nodes: ['n2', 'gnd'] },
        ],
    }, { analysis: 'ac', freqs: [10, fc, 1e6] });

    const H = (i) => mag(r.v['n2'][i]) / mag(r.v['in'][i]);
    // freqs: [0]=10Гц (НЧ), [1]=fc (срез), [2]=1МГц (ВЧ)
    assert.ok(Math.abs(H(0) - 1) < 5e-3, `H(10Hz)=${H(0)}`);
    assert.ok(Math.abs(H(1) - Math.SQRT1_2) < 5e-3, `H(fc)=${H(1)}`);
    assert.ok(Math.abs(phaseDeg(r.v['n2'][1]) + 45) < 2, `phase=${phaseDeg(r.v['n2'][1])}`);
    const expectedHigh = 1 / (2 * Math.PI * 1e6 * R * C);
    assert.ok(Math.abs(H(2) - expectedHigh) < 1e-3, `H(ВЧ)=${H(2)}`);
});

test('AC: RLC — параллельный контур резонирует (|Va| -> 1)', () => {
    const L = 1e-3, C = 1e-6, R = 1;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C)); // ~5032.9 Гц
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', ac: 1, nodes: ['in', 'gnd'] },
            { id: 'R1', type: 'resistor', value: R, nodes: ['in', 'a'] },
            { id: 'L1', type: 'inductor', value: L, nodes: ['a', 'gnd'] },
            { id: 'C1', type: 'capacitor', value: C, nodes: ['a', 'gnd'] },
        ],
    }, { analysis: 'ac', freqs: [f0 / 10, f0, f0 * 10] });
    assert.ok(mag(r.v['a'][1]) > 0.99, `|Va(f0)|=${mag(r.v['a'][1])}`); // резонанс
    assert.ok(mag(r.v['a'][0]) < mag(r.v['a'][1]), 'ниже резонанса меньше');
    assert.ok(mag(r.v['a'][2]) < mag(r.v['a'][1]), 'выше резонанса меньше');
});

test('AC: ветвь индуктивности имеет ток с запаздыванием на -90°', () => {
    // V1(ac) -> L1 -> gnd : i отстаёт от v на 90°
    const r = simulate({
        components: [
            { id: 'V1', type: 'vsource', ac: 1, nodes: ['a', 'gnd'] },
            { id: 'L1', type: 'inductor', value: 1e-3, nodes: ['a', 'gnd'] },
        ],
    }, { analysis: 'ac', freqs: [1000] });
    const iL = r.i['L1'][0];
    assert.ok(Math.abs(phaseDeg(iL) + 90) < 1, `phase(iL)=${phaseDeg(iL)}`);
    assert.ok(Math.abs(mag(iL) - 1 / (2 * Math.PI * 1000 * 1e-3)) < 1e-6);
});
