import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapComponentType, assignNets } from '../../logic/js/sim.js';
import { simulate } from '../index.js';

test('mapComponentType: сопоставляет категории редактора с типами движка', () => {
    assert.equal(mapComponentType('resistor'), 'resistor');
    assert.equal(mapComponentType('Generator'), 'vsource');
    assert.equal(mapComponentType('capacitor'), 'capacitor');
    assert.equal(mapComponentType('inductor'), 'inductor');
    assert.equal(mapComponentType('LED'), 'diode');
    assert.equal(mapComponentType('ground'), 'ground');
    assert.equal(mapComponentType('multimeter'), 'instrument');
    assert.equal(mapComponentType('weird-part'), null);
});

test('assignNets: union-find + земля -> корректный нетлист', () => {
    // V1 -- R1 -- R2 с общей землёй. Делитель должен дать 5В на средней точке.
    const components = [
        { id: 'V1', engineType: 'vsource', value: 10, terminals: ['V1/p1', 'V1/p2'] },
        { id: 'R1', engineType: 'resistor', value: 1000, terminals: ['R1/p1', 'R1/p2'] },
        { id: 'R2', engineType: 'resistor', value: 1000, terminals: ['R2/p1', 'R2/p2'] },
        { id: 'G1', engineType: 'ground', value: null, terminals: ['G1/p1'] },
    ];
    const edges = [
        ['V1/p1', 'R1/p1'],
        ['R1/p2', 'R2/p1'],
        ['V1/p2', 'G1/p1'],
        ['R2/p2', 'G1/p1'],
    ];
    const { spec, ground } = assignNets(components, edges);
    assert.ok(spec, 'нетлист построен');
    assert.ok(ground != null, 'земля найдена');

    // земля действительно одна, в средине 5В
    const op = simulate(spec, { analysis: 'op' });
    const volts = Object.values(op.nodeVoltages);
    assert.ok(volts.some((v) => Math.abs(v - 10) < 1e-6), 'есть 10В на + источника');
    assert.ok(volts.some((v) => Math.abs(v - 5) < 1e-6), 'делитель даёт 5В в середине');
    assert.ok(Math.abs(Math.abs(op.branchCurrents[spec.components[0].id]) - 0.005) < 1e-9, 'ток 5мА');
});

test('assignNets: без земли возвращает reason=no-ground', () => {
    const { spec, reason } = assignNets([
        { id: 'R1', engineType: 'resistor', value: 1000, terminals: ['R1/p1', 'R1/p2'] },
    ], []);
    assert.equal(spec, null);
    assert.equal(reason, 'no-ground');
});
