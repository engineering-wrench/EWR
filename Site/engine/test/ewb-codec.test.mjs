import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, encodeType1 } from '../ewb-codec.js';
import { toSpec } from '../parser.js';
import { serializeNetlist } from '../ewb-text.js';
import { simulate } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const TOOL = path.join(ROOT, 'tools', 'ewb2txt.mjs');
const REF = path.join(ROOT, 'EWB512');
const have = (rel) => fs.existsSync(path.join(REF, rel));

function cliDecode(rel) {
    return execFileSync('node', [TOOL, path.join(REF, rel)], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
}

// Наш браузерный декодер должен БАЙТ-В-БАЙТ совпадать с проверенным CLI.
for (const rel of ['UNTITLED.EWB', 'DEFAULT.EWB', 'CIRCUITS/kirch_cu.ewb', 'CIRCUITS/thevenin.ewb']) {
    test(`browser-decode == CLI: ${rel}`, { skip: !have(rel) }, () => {
        const bytes = fs.readFileSync(path.join(REF, rel));
        const mine = decode(bytes);
        const cli = cliDecode(rel);
        assert.equal(mine, cli, 'декодер браузера расходится с эталонным CLI');
    });
}

// encodeType1(text) -> decode() должен вернуть тот же текст (round-trip в приложении).
test('encodeType1 <-> decode round-trip', () => {
    const text = [
        'Project', '{',
        '  Circuit', '{',
        '    Elements', '{',
        '      Comp { Common { RefID A "V1" } PartNum i 2 Value r:5 10 0 0 0 0 }',
        '      Comp { Common { RefID A "R1" } PartNum i 1 Value r:5 1000 0 0 0 0 }',
        '      Comp { Common { RefID A "0" } PartNum i 8 Value r:1 0 }',
        '    }',
        '  }',
        '}',
        '', // перевод строки в конце
    ].join('\n');
    const bytes = encodeType1(text);
    assert.ok(bytes.length > text.length, 'бинарник больше текста (ниббл-кодирование)');
    const back = decode(bytes);
    assert.equal(back, text, 'round-trip Type-1: decode(encode(text)) должен совпасть');
});

// Полный цикл сохранения/загрузки: spec -> текст -> encode -> decode -> parse ->
// spec'. Имена узлов после цикла могут отличаться, но ТОПОЛОГИЯ (операционная
// точка) должна совпасть — сверяем по мультимножеству напряжений узлов.
test('save/load: spec -> .ewb(Тype-1) -> parse (полный цикл)', () => {
    const spec = {
        components: [
            { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
            { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
        ],
    };
    const text = serializeNetlist(spec);
    const bytes = encodeType1(text);
    const decoded = decode(bytes);
    const { spec: spec2 } = toSpec(decoded);
    assert(spec2, 'после round-trip spec собран');

    const op1 = simulate(spec, { analysis: 'op' });
    const op2 = simulate(spec2, { analysis: 'op' });
    const volts = (r) => Object.values(r.nodeVoltages).map((v) => +v.toFixed(6)).sort((a, b) => a - b);
    assert.deepEqual(volts(op1), volts(op2), 'операционная точка сохраняется после save/load');

    // состав устройств (тип + знач.) совпадает
    const sig = (r) => r.elements.map((e) => `${e.type}:${+e.v.toFixed(3)}/${+e.i.toFixed(6)}`).sort();
    assert.deepEqual(sig(op1), sig(op2), 'напряжения/токи элементов совпадают');
});

// Полный конвейер открыть→сохранить→переоткрыть на РЕАЛЬНОЙ схеме (без DOM):
// kirch_cu.ewb -> decode -> toSpec -> serialize -> encode(Type1) -> decode -> toSpec.
test('open->save->reopen: kirch_cu.ewb переживает полный цикл', { skip: !have('CIRCUITS/kirch_cu.ewb') }, () => {
    const bytes0 = fs.readFileSync(path.join(REF, 'CIRCUITS/kirch_cu.ewb'));
    const { spec } = toSpec(decode(bytes0));
    assert(spec, 'схема разобрана');

    const resave = encodeType1(serializeNetlist(spec));
    const { spec: spec2 } = toSpec(decode(resave));
    assert(spec2, 'переоткрыта');

    const op1 = simulate(spec, { analysis: 'op' });
    const op2 = simulate(spec2, { analysis: 'op' });
    const fair = (r) => Object.values(r.nodeVoltages).filter((v) => Number.isFinite(v));
    assert.ok(fair(op1).length > 0 && fair(op2).length > 0, 'обе цепи решаются');
    assert.equal(fair(op1).length, fair(op2).length, 'одинаковое число узлов');
    assert.equal(spec.components.filter((c) => c.type === 'resistor').length,
        spec2.components.filter((c) => c.type === 'resistor').length, 'резисторов столько же');
});

