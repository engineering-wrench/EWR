import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeNetlist, groupTerminals } from '../ewb-text.js';
import { toSpec } from '../parser.js';
import { simulate } from '../index.js';

test('groupTerminals: группирует терминалы по узлам', () => {
    const spec = { components: [
        { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
        { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
    ] };
    const m = groupTerminals(spec);
    const keys = (net) => m.get(net).map((t) => t.ci + ':' + t.ti).sort();
    assert.deepEqual(keys('n1'), ['0:0', '1:0']); // V1.t0 и R1.t0
    assert.deepEqual(keys('n2'), ['1:1', '2:0']); // R1.t1 и R2.t0
    assert.equal(m.get('gnd').length, 2);          // V1.t1 и R2.t1
    assert.equal(m.size, 3);                       // n1, n2, gnd
});

test('serializeNetlist: делитель 12В даёт 6В после save->parse', () => {
    const spec = { components: [
        { id: 'V1', type: 'vsource', dc: 12, nodes: ['a', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['a', 'b'] },
        { id: 'R2', type: 'resistor', value: 1000, nodes: ['b', 'gnd'] },
    ] };
    const { spec: back, warnings } = ((t) => toSpec(t))(serializeNetlist(spec));
    assert(back, 'spec восстановлен из текста: ' + (warnings || []).join('; '));
    assert.equal(back.components.filter((c) => c.type === 'resistor').length, 2);
    assert(back.components.some((c) => c.type === 'vsource'));

    const op = simulate(back, { analysis: 'op' });
    const volts = Object.values(op.nodeVoltages);
    assert.ok(volts.some((v) => Math.abs(v - 6) < 1e-6), `середина делителя = 6В, получено ${volts}`);
    assert.ok(volts.some((v) => Math.abs(v - 12) < 1e-6), 'источник 12В');
});
