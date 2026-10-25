import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpec, deviceType } from '../parser.js';
import { simulate } from '../index.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const TOOL = path.join(ROOT, 'tools', 'ewb2txt.mjs');
const REF = path.join(ROOT, 'EWB512');

function refFile(rel) { const p = path.join(REF, rel); return fs.existsSync(p) ? p : null; }
function decode(rel) {
    return execFileSync('node', [TOOL, path.join(REF, rel)], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
}

test('deviceType: сопоставление RefID/PartNum', () => {
    assert(deviceType('R1', 1) === 'resistor');
    assert(deviceType('V1', 2) === 'vsource');
    assert(deviceType('V2', 0) === 'vsource');
    assert(deviceType('0', 8) === 'ground');
    assert(deviceType('CONN3', 9) === 'connector');
    assert(deviceType('M2', 13) === 'meter');
    assert(deviceType('T1', 14) === 'transformer');
    assert(deviceType('D5', 3) === 'diode');
});

test('parser: синтетический decoded-текст -> корректный spec', () => {
    // Мини-сериализация: делитель V1-R1-R2 + земля, провода задают node_p.
    const text = [
        'Project', '{',
        '  Circuit', '{',
        '    Elements', '{',
        '      Comp { Common { RefID A "V1" } PartNum i 2 Value r:1 10 }',
        '      Comp { Common { RefID A "R1" } PartNum i 1 Value r:1 1000 }',
        '      Comp { Common { RefID A "R2" } PartNum i 1 Value r:1 1000 }',
        '      Comp { Common { RefID A "0" }  PartNum i 8 Value r:1 0 }',
        '    }',
        '    Wires', '{',
        // индексы Comp: 0=V1 1=R1 2=R2 3=ground
        '      wire { pos i:4 0 0 1 0 node_p A "1" }', // V1.t0 - R1.t0
        '      wire { pos i:4 1 1 2 0 node_p A "2" }', // R1.t1 - R2.t0
        '      wire { pos i:4 0 1 3 0 node_p A "0" }', // V1.t1 - ground
        '      wire { pos i:4 2 1 3 0 node_p A "0" }', // R2.t1 - ground
        '    }',
        '  }',
        '}',
    ].join('\n');
    const { spec, stats } = toSpec(text);
    assert(spec, 'spec собран');
    const byId = Object.fromEntries(spec.components.map((c) => [c.id, c]));
    assert.deepEqual(byId.V1.nodes, ['n1', 'gnd']);
    assert.deepEqual(byId.R1.nodes, ['n1', 'n2']);
    assert.deepEqual(byId.R2.nodes, ['n2', 'gnd']);
    assert.equal(byId.V1.dc, 10);
    const op = simulate(spec, { analysis: 'op' });
    assert(Math.abs(op.nodeVoltages.n2 - 5) < 1e-6, `U=5В, получено ${op.nodeVoltages.n2}`);
    assert.equal(stats.emitted, 3);
});

test('parser: kirch_cu.ewb -> решаемый нетлист (сеть с приборами)', { skip: !refFile('CIRCUITS/kirch_cu.ewb') }, () => {
    const { spec, warnings, stats } = toSpec(decode('CIRCUITS/kirch_cu.ewb'));
    assert(spec, 'spec собран');
    const byId = Object.fromEntries(spec.components.map((c) => [c.id, c]));
    assert(byId.V1 && byId.V1.type === 'vsource', 'есть источник V1');
    const rCount = spec.components.filter((c) => c.type === 'resistor').length;
    assert(rCount >= 3, `резисторов >=3, получено ${rCount}`);
    // приборы/соединители не эмитятся как элементы
    assert(!spec.components.some((c) => ['meter', 'connector', 'ground'].includes(c.type)));
    // цепь решается (метры/соединители слили узлы в связный контур)
    const op = simulate(spec, { analysis: 'op' });
    const volts = Object.values(op.nodeVoltages);
    assert(volts.every((v) => Number.isFinite(v)), 'напряжения конечны');
    assert(volts.some((v) => Math.abs(v - op.nodeVoltages[byId.V1.nodes[0]]) < 1e-9), 'есть узел источника');
    assert(warnings.length <= 3, `немного предупреждений, получено ${warnings.length}`);
});

test('parser: thevenin.ewb -> извлекаются R/V и земля', { skip: !refFile('CIRCUITS/thevenin.ewb') }, () => {
    const { spec } = toSpec(decode('CIRCUITS/thevenin.ewb'));
    assert(spec, 'spec собран');
    assert(spec.components.some((c) => c.type === 'vsource'), 'есть источники');
    assert(spec.components.some((c) => c.type === 'resistor'), 'есть резисторы');
    assert(spec.components.some((c) => c.nodes.includes('gnd')), 'есть привязка к gnd');
});

test('parser: индекс провода = позиция в списке Elements (Instrument не сдвигает Comp)', () => {
    // Elements: 0=R1, 1=Instrument, 2=V1, 3=ground — провод ссылается на ПОЛНЫЙ индекс.
    const text = [
        'Project', '{',
        '  Circuit', '{',
        '    Elements', '{',
        '      Comp { Common { RefID A "R1" } PartNum i 1 Value r:1 1000 }',
        '      Instrument { PartNum i 4 Pos i:3 0 10 10 }',
        '      Comp { Common { RefID A "V1" } PartNum i 2 Value r:1 10 }',
        '      Comp { Common { RefID A "0" }  PartNum i 8 Value r:1 0 }',
        '    }',
        '    Wires', '{',
        '      wire { pos i:4 0 0 2 0 node_p A "1" }',  // R1.t0 - V1.t0
        '      wire { pos i:4 1 0 2 0 node_p A "1" }',  // Instrument.t0 - V1.t0
        '      wire { pos i:4 2 1 3 0 node_p A "0" }',  // V1.t1 - ground
        '      wire { pos i:4 0 1 3 0 node_p A "0" }',  // R1.t1 - ground
        '    }',
        '  }',
        '}',
    ].join('\n');
    const { spec, warnings, stats } = toSpec(text);
    assert(spec, 'spec собран');
    assert.equal(stats.elements, 4, 'индексное пространство — все элементы');
    assert.equal(stats.skipped.instrument, 1, 'Instrument пропущен');
    const byId = Object.fromEntries(spec.components.map((c) => [c.id, c]));
    assert.deepEqual(byId.R1.nodes, ['n1', 'gnd']);
    assert.deepEqual(byId.V1.nodes, ['n1', 'gnd']);
    assert(!warnings.some((w) => w.includes('выводов')), 'нет ложных предупреждений о выводах');
});

test('parser: 3phase.ewb (Instrument в Elements) -> индексы не смещены', { skip: !refFile('CIRCUITS/3phase.ewb') }, () => {
    const { spec, warnings, stats } = toSpec(decode('CIRCUITS/3phase.ewb'));
    assert(spec, 'spec собран');
    assert.equal(stats.elements, 26);
    assert.equal(stats.skipped.instrument, 1, 'в схеме один прибор');
    assert.equal(spec.components.filter((c) => c.type === 'vsource').length, 3, 'три источника');
    assert.equal(spec.components.filter((c) => c.type === 'diode').length, 6, 'шесть диодов');
    assert.equal(warnings.length, 0, `без предупреждений: ${warnings.join('; ')}`);
});
