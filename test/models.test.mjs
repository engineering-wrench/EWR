// Тесты фазы M: парсер MODELS + карта PartNum (M2/M4).
//
// Две группы:
//   1. Юнит-тесты чистых функций (фикстуры, без EWB512/).
//   2. Golden: `Site/engine/models/ewb-models.json` воспроизводится из EWB512
//      и покрытие PartNum по CIRCUITS ≥ 95 % (self-skip без эталонов).
//
// Эталоны (EWB512/MODELS, WEWB.RES, WEWBMSG.RES, CIRCUITS) — read-only референс
// оригинала; при их отсутствии тесты пропускаются, а не падают.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ROOT, DEFAULT_SRC, DEFAULT_OUT,
    parsePCard, parseModelCard, parseSpiceText,
    parseWewbRes, parsePartNames, buildPartMap,
    buildModelsJson, circuitEvidence, partNumCoverage, SERVICE_PARTNUMS,
} from '../tools/models-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS = path.join(ROOT, 'EWB512', 'CIRCUITS');

const hasModels = fs.existsSync(DEFAULT_SRC);
const skipModels = hasModels ? false : 'нет EWB512/MODELS (референс оригинала не смонтирован)';
const hasCircuits = fs.existsSync(CIRCUITS);
const skipCircuits = hasModels && hasCircuits ? false : 'нет EWB512/{MODELS,CIRCUITS}';

// ---------- unit: карточки P ----------

test('parsePCard: имя, PartNum и числа', () => {
    assert.deepEqual(parsePCard('P "1N4002" 4 1e-14 0 0'), {
        name: '1N4002', partNum: 4, params: [1e-14, 0, 0],
    });
    assert.deepEqual(parsePCard('P "ad op-07" 15 1 2 3')?.partNum, 15);
    assert.deepEqual(parsePCard('P "switch" 21'), { name: 'switch', partNum: 21, params: [] });
    assert.equal(parsePCard('P "bad" x 1'), null, 'нецелый PartNum — не карточка');
    assert.equal(parsePCard('.MODEL DX D(IS=1)'), null);
});

// ---------- unit: карточки .MODEL ----------

test('parseModelCard: слипшаяся карточка ".MODEL DX D(IS=800.0E-18)"', () => {
    const m = parseModelCard(['.MODEL DX D(IS=800.0E-18)']);
    assert.equal(m.name, 'DX');
    assert.equal(m.type, 'D');
    assert.equal(m.params.IS, 800.0e-18);
});

test('parseModelCard: продолжения "+" склеиваются', () => {
    const m = parseModelCard(['.MODEL QX NPN (BF=100', '+ IS=1E-14)']);
    assert.equal(m.type, 'NPN');
    assert.equal(m.params.BF, 100);
    assert.equal(m.params.IS, 1e-14);
});

// ---------- unit: текст файла MODELS ----------

test('parseSpiceText: CRLF, шапка, \\x1a-блок, подцепи, глитч без .SUBCKT', () => {
    const lib = [
        'Electronics Workbench Model File V4.01',
        '(c) 1995 Interactive Image Technologies Ltd.',
        'Licensed to: "TEST"',
        '',
        'S/N: "ABC"',
        '\x1aIICFAABIKDEJBLCAKMD',
        'P "1N4002" 4 1e-14 0 0 0 0 0',
        '.MODEL DX D(IS=800.0E-18)',
        '.MODEL QX NPN (BF=100',
        '+ IS=1E-14)',
        '.SUBCKT DIV 1 2 3',
        'R1 1 2 1K',
        '.MODEL DINT D(IS=1E-15)',
        '.ENDS DIV',
        ' ADG406 19 20',
        'R_A0_1 2 4 100',
        '.ENDS ADG406',
        '.SUBCKT OPEN A B',
        'R9 A B 5',
    ].join('\r\n');

    const p = parseSpiceText(lib);
    assert.equal(p.header.product, 'V4.01');
    assert.equal(p.header.licensedTo, 'TEST');
    assert.equal(p.header.serial, 'ABC');
    assert.equal(p.encoded.lines, 1, 'строка A..P после \\x1a распознана как кодированный блок');

    assert.equal(p.parts.length, 1);
    assert.deepEqual(p.parts[0].params, [1e-14, 0, 0, 0, 0, 0]);

    // наружные .MODEL: DX и QX; DINT — внутри подцепи, в models не попадает
    assert.deepEqual(p.models.map((m) => m.name), ['DX', 'QX']);
    assert.equal(p.models[1].params.IS, 1e-14);

    const div = p.subckts.find((s) => s.name === 'DIV');
    assert.deepEqual(div.nodes, ['1', '2', '3']);
    assert.ok(div.body.some((l) => l.includes('DINT')), 'модель внутри подцепи остаётся в теле');

    // глитч: ".ENDS ADG406" без ".SUBCKT" — заголовок восстанавливается по свободной строке
    const adg = p.subckts.find((s) => s.name === 'ADG406');
    assert.deepEqual(adg.nodes, ['19', '20']);
    assert.deepEqual(adg.body, ['R_A0_1 2 4 100']);
    assert.ok(p.quirks.some((q) => q.kind === 'missing-subckt-keyword' && q.name === 'ADG406'));

    // незакрытая подцепь — quirk, тело сохраняется
    const open = p.subckts.find((s) => s.name === 'OPEN');
    assert.deepEqual(open.body, ['R9 A B 5']);
    assert.ok(p.quirks.some((q) => q.kind === 'subckt-without-ends' && q.name === 'OPEN'));
});

// ---------- unit: WEWB.RES ----------

test('parseWewbRes: C-записи, P-карточки, макро-лица', () => {
    const res = [
        'Electronics Workbench Resource File\x1a',
        'P "switch" 21 0 1 0.5 0',
        'C 4 3 23 1786  V=1e-14 U=0 M="diode" S=1 L=""',
        'C 21 3 22 202 V=0 U=0 M="" S=0 L="" 1',
        'C 14 0 18 847',
        'F -1 120 166 154 69 "+Vcc"',
    ].join('\r\n');

    const p = parseWewbRes(res);
    assert.equal(p.cards.length, 1);
    assert.deepEqual(p.cards[0], { name: 'switch', partNum: 21, params: [0, 1, 0.5, 0], line: 2 });

    assert.equal(p.parts.length, 2, 'строка без V=/U= (мусор/агрегат) не карточка');
    const diode = p.parts.find((x) => x.partNum === 4);
    assert.equal(diode.model, 'diode');
    assert.equal(diode.bin, true);
    assert.equal(diode.value, '1e-14');
    assert.equal(diode.units, 0);
    const sw = p.parts.find((x) => x.partNum === 21);
    assert.equal(sw.bin, false);
    assert.deepEqual(sw.extra, ['1']);

    assert.deepEqual(p.macros, ['+Vcc']);
});

// ---------- unit: имена деталей WEWBMSG.RES ----------

test('parsePartNames: индекс строки = PartNum (0..41)', () => {
    const msg = [
        '"Something else"',
        '"AC Voltage Source"',
        '"Resistor"',
        '"Battery"',
        '"Capacitor"',
        '"Diode"',
        '"Subcircuit Template"',
        '"Stop circuit simulation?"',
    ].join('\r\n');
    const names = parsePartNames(msg);
    assert.equal(names[0], 'AC Voltage Source');
    assert.equal(names[1], 'Resistor');
    assert.equal(names[5], 'Subcircuit Template');
    assert.equal(names.length, 6, 'после "Subcircuit Template" чтение останавливается');
});

test('parsePartNames: без якоря возвращается пустой список', () => {
    assert.deepEqual(parsePartNames('"Resistor"\n"Diode"'), []);
});

// ---------- unit: слияние карты PartNum ----------

test('buildPartMap: источники wewbres/mfile/pcards/wewbmsg', () => {
    const res = parseWewbRes([
        'C 4 3 23 1786 V=1e-14 U=0 M="diode" S=1 L=""',
        'C 1 0 22 1899 V=0 U=0 M="" S=1 L=""',
    ].join('\n'));
    const files = [{ path: '1N4XXX.M04', partNum: 4 }];
    const parts = [{ name: '1N4002', partNum: 4 }];
    const names = [];
    names[1] = 'Resistor';
    names[4] = 'Diode';

    const map = buildPartMap(res, files, parts, names);
    assert.equal(map['4'].kind, 'diode');
    assert.equal(map['4'].name, 'Diode');
    assert.deepEqual(map['4'].sources, ['wewbres', 'wewbmsg', 'mfile', 'pcards']);
    assert.deepEqual(map['4'].modelFiles, ['1N4XXX.M04']);
    assert.deepEqual(map['4'].cardNames, ['1N4002']);
    assert.equal(map['1'].name, 'Resistor');
    assert.equal(map['1'].kind, '');
    assert.deepEqual(map['1'].sources, ['wewbres', 'wewbmsg']);
});

// ---------- unit: доказательства по схеме ----------

test('circuitEvidence: Comp-блоки и Library.Models', () => {
    const txt = [
        'Comp {',
        '  PartNum i 4',
        '  Value r:1 0',
        '  Common { RefID A "D1" }',
        '  ModelName R "1n:1N4002"',
        '}',
        'Comp {',
        '  PartNum i 12',
        '  Common { RefID A "M1" }',
        '  m_tptrElem A "M1^0"',
        '}',
        'Model {',
        '  Name R "ideal"',
        '  PartNum i 4',
        '  Params r:3 1e-14 0 0',
        '}',
    ].join('\n');

    const ev = circuitEvidence(txt);
    assert.equal(ev.partNums[4].count, 1);
    assert.deepEqual(ev.partNums[4].refs, { D: 1 });
    assert.deepEqual(ev.partNums[4].models, { '1n:1N4002': 1 });
    assert.deepEqual(ev.partNums[12].mptr, { M: 1 });
    assert.deepEqual(ev.libraryModels, [{ name: 'ideal', partNum: 4, n: 3, params: [1e-14, 0, 0] }]);
});

// ---------- golden: воспроизводимость артефакта (M3) ----------

function firstDiff(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return n;
}

test('golden: ewb-models.json воспроизводится из EWB512 (M3, детерминизм)', { skip: skipModels }, (t) => {
    if (!fs.existsSync(DEFAULT_OUT)) {
        return t.skip(`нет артефакта ${path.relative(ROOT, DEFAULT_OUT)} (собрать: node tools/models-parse.mjs)`);
    }
    const artifact = fs.readFileSync(DEFAULT_OUT, 'utf8');
    const built = JSON.stringify(buildModelsJson(DEFAULT_SRC));
    if (built !== artifact) {
        const i = firstDiff(built, artifact);
        assert.fail(
            `артефакт разошёлся с сборкой (built=${built.length} байт, артефакт=${artifact.length} байт, ` +
            `первое различие @${i}):\n  built:   ${JSON.stringify(built.slice(i, i + 80))}\n` +
            `  артефакт: ${JSON.stringify(artifact.slice(i, i + 80))}\n` +
            'Пересобрать: node tools/models-parse.mjs',
        );
    }
    const again = JSON.stringify(buildModelsJson(DEFAULT_SRC));
    assert.equal(again, built, 'сборка недетерминирована');
});

test('golden: карта PartNum и имена деталей (M2)', { skip: skipModels }, () => {
    const j = buildModelsJson(DEFAULT_SRC);
    assert.ok(j.wewbRes, 'есть секция WEWB.RES');
    assert.equal(j.wewbMsg.names.length, 42, 'имена деталей 0..41 (WEWBMSG.RES)');
    assert.equal(j.wewbMsg.names[0], 'AC Voltage Source');
    assert.equal(j.wewbMsg.names[1], 'Resistor');
    assert.equal(j.wewbMsg.names[13], 'Voltmeter');
    assert.equal(j.wewbMsg.names[39], 'Node');
    assert.equal(j.wewbMsg.names[41], 'Subcircuit Template');

    assert.equal(j.partMap['4'].kind, 'diode');
    assert.equal(j.partMap['5'].kind, 'npn');
    assert.equal(j.partMap['22'].kind, 'jfet-n');
    assert.equal(j.partMap['31'].kind, 'pmos-emb');
    assert.equal(j.partMap['14'].kind, 'transf');
    assert.equal(j.partMap['15'].kind, 'opamp');
    assert.ok(j.partMap['4'].modelFiles.includes('1N4XXX.M04'));
    assert.ok(j.partMap['4'].cardNames.includes('D1N4002'));
    assert.ok(j.partMap['99'].modelFiles.includes('cmos.m99'));

    // глитч-подцепь восстановлена
    const adg = j.subckts[j.bySubckt['ADG406'][0]];
    assert.equal(adg.body.length, 204);
    assert.ok(j.files.some((f) => (f.quirks || []).some((q) => q.kind === 'missing-subckt-keyword')));

    // порядки величин (страховка от «пустого» разбора)
    assert.ok(j.counts.files > 300 && j.counts.parts > 2900 && j.counts.models > 4300 && j.counts.subckts > 2400);
});

// ---------- golden: покрытие PartNum по CIRCUITS (M4) ----------

test('golden: покрытие PartNum из CIRCUITS ≥ 95 % (M4)', { skip: skipCircuits }, () => {
    const j = buildModelsJson(DEFAULT_SRC);
    const cov = partNumCoverage(j, CIRCUITS);

    assert.ok(cov.circuits > 90, `ожидается ~99 схем, разобрано ${cov.circuits}`);
    assert.deepEqual(cov.missing, [], 'все PartNum из схем должны быть в карте (или в служебных)');
    assert.deepEqual(cov.excluded, [...SERVICE_PARTNUMS], 'служебный 39 — вывод детали, не деталь');
    assert.ok(cov.byNumber.covered / cov.byNumber.total >= 0.95,
        `покрытие по номерам ${cov.byNumber.covered}/${cov.byNumber.total}`);
    assert.ok(cov.byInstance.total > 3000, `мало экземпляров: ${cov.byInstance.total}`);

    // доказательства: в схемах действительно есть R/C/L/источники/земля
    assert.ok(cov.partNums[1].refs.R > 500, 'резисторы (PartNum 1)');
    assert.ok(cov.partNums[3].refs.C > 100, 'конденсаторы (PartNum 3)');
    assert.ok(cov.partNums[8].refs['?'] > 100, 'земля (PartNum 8)');
    assert.ok(cov.partNums[4].models['1n:1N4002'] >= 6, 'модели диодов из схем');

    // каждый покрытый номер реально есть в partMap
    for (const n of cov.covered) assert.ok(j.partMap[n], `нет записи partMap для ${n}`);
});
