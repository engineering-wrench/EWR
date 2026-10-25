// Тесты оракула: настоящий движок EWB 5.12 (XSPICE32.DLL) под Wine.
//
// Оракул — источник эталонов «1:1» для порта (docs/engine/PLAN-CLONE.md §2,
// стратегия C). Тесты проверяют две вещи:
//   1) интерфейс DLL (устройства/анализы/параметры) не меняется — golden/enum.json;
//   2) прогоны корпуса детерминированы и совпадают с эталоном — golden/<дека>.json.
// Правила сравнения результатов — tools/oracle/compare.mjs (§5 плана).
//
// Без wine / 32-битного Python (vendor/py32) / EWB512/ все тесты корректно
// пропускаются (skip), а не падают: npm test должен быть зелёным везде.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oracleStatus, runDeckFile, runEnumerate, corpusDecks } from '../tools/oracle/run.mjs';
import { compareResults, compareEnum } from '../tools/oracle/compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(ROOT, 'tools', 'oracle', 'golden');
const CORPUS = path.join(ROOT, 'tools', 'oracle', 'corpus');

const status = oracleStatus();
const skip = status.ok ? false : `оракул недоступен: ${status.reason}`;

function loadGolden(name) {
    const p = path.join(GOLDEN, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

test('оракул: интерфейс DLL (устройства/анализы/параметры) совпадает с эталоном', { skip }, (t) => {
    const golden = loadGolden('enum.json');
    if (!golden) return t.skip('нет эталона enum.json (снять: node tools/oracle/run.mjs --capture)');
    const actual = runEnumerate();
    const { ok, diffs } = compareEnum(golden, actual);
    assert.ok(ok, 'интерфейс XSPICE32.DLL разошёлся с эталоном:\n' + diffs.slice(0, 30).join('\n'));
});

for (const deck of corpusDecks()) {
    test(`оракул: ${deck} — совпадение с эталоном`, { skip }, (t) => {
        const golden = loadGolden(deck);
        if (!golden) return t.skip(`нет эталона ${deck} (снять: node tools/oracle/run.mjs --capture)`);

        const actual = runDeckFile(path.join(CORPUS, deck));
        const { ok, diffs } = compareResults(golden, actual);
        assert.ok(ok, `${deck} разошлась с эталоном:\n` + diffs.slice(0, 30).join('\n'));
    });
}

test('оракул: TRAN детерминирован (3 прогона бит-в-бит)', { skip }, () => {
    const file = path.join(CORPUS, 'tran_rc.json');
    const runs = [runDeckFile(file), runDeckFile(file), runDeckFile(file)].map((r) => JSON.stringify(r));
    assert.equal(runs[1], runs[0], 'прогон 2 отличается от прогона 1');
    assert.equal(runs[2], runs[0], 'прогон 3 отличается от прогона 1');
});
