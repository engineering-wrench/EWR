import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetlist, isGround, branchCurrent } from '../netlist.js';

test('isGround: распознаёт имена земли в разных регистрах', () => {
    for (const n of ['gnd', '0', 'GND', 'Ground', ' com ', 'VSS']) assert.ok(isGround(n), n);
    for (const n of ['n1', 'n2', 'vcc']) assert.ok(!isGround(n), n);
});

test('buildNetlist: нумерует немассив узлы детерминированно', () => {
    const nl = buildNetlist({ components: [
        { id: 'R1', type: 'resistor', value: 1, nodes: ['n2', 'n1'] },
        { id: 'V1', type: 'vsource', dc: 1, nodes: ['n1', 'gnd'] },
    ] });
    assert.deepEqual(nl.nodeList, ['n1', 'n2']); // отсортированы
    assert.equal(nl.nodeIndex.get('n1'), 0);
    assert.equal(nl.nodeIndex.get('n2'), 1);
    assert.equal(nl.N, 2);
    assert.equal(nl.M, 1);           // один источник напряжения
    assert.equal(nl.size, 3);
});

test('buildNetlist: земля исключается, получает индекс -1', () => {
    const nl = buildNetlist({ components: [
        { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
    ] });
    assert.deepEqual(nl.devices[0].nodes, [0, -1]);
    assert.equal(nl.nodeList.length, 1);
});

test('buildNetlist: распределяет доп. токи vsource/inductor', () => {
    const nl = buildNetlist({ components: [
        { id: 'V1', type: 'vsource', dc: 1, nodes: ['a', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1, nodes: ['a', 'b'] },
        { id: 'L1', type: 'inductor', value: 1e-3, nodes: ['b', 'gnd'] },
    ] });
    assert.equal(nl.M, 2); // V1 и L1
    const [v1, , l1] = nl.devices;
    assert.equal(v1.extra, 0);
    assert.equal(l1.extra, 1);
    // ток ветви L1 читается из x[N+extra]
    const x = new Array(nl.size).fill(0);
    assert.equal(branchCurrent(nl, x, l1), x[nl.N + 1]);
});

test('buildNetlist: отбрасывает некорректный spec', () => {
    assert.throws(() => buildNetlist({}));
    assert.throws(() => buildNetlist({ components: [{ id: 'X', type: 'resistor', nodes: [] }] }));
});
