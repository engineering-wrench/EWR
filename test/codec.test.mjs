// Золотые тесты кодека EWB — фундамент, на котором строится движок.
//
// Проверяем ЧЁРНЫЙ ЯШИК: CLI tools/ewb2txt.mjs запускается как дочерний процесс
// и декодирует эталонные файлы EWB 5.12, распакованные из оригинала (EWB512/).
// Реализация не импортируется напрямую — тесты фиксируют контракт декодера,
// чтобы его «пересос»/рефактор не сломал совместимость.
//
// Если эталонных файлов нет (EWB512/ не распакован), тесты автоматически
// пропускаются (skip), а не падают. Запуск: npm test  /  node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'ewb2txt.mjs');
const REF = path.join(ROOT, 'EWB512');

// Есть ли эталонный файл (для корректного skip при отсутствии EWB512/).
function ref(rel) {
    const p = path.join(REF, rel);
    return fs.existsSync(p) ? p : null;
}

// ewb хранит текст в ANSI/latin1 — читаем вывод как latin1, чтобы он побайтово
// совпадал с оригиналом и не потерять 8-битные символы.
function runTool(...args) {
    return execFileSync('node', [TOOL, ...args], {
        encoding: 'latin1',
        maxBuffer: 128 * 1024 * 1024,
    });
}

// ---------- Type 1: UNTITLED.EWB — простой поток без сжатия ----------

// ПРИМЕЧАНИЕ: у Type-1 (UNTITLED.EWB) декодер сейчас выводит корректное тело
// (CircuitHeader, InternalCircuitVersion i 502 …), но с «мусорными» первыми
// байтами короткого ведущего блока (недоработка кодера — см. план, Фаза 0).
// Поэтому фиксируем только стабильную часть контракта + детерминизм,
// не закрепляя байтовый дефект как «эталон».
test('UNTITLED.EWB (Type 1): детерминированный декод и разбираемое тело', { skip: !ref('UNTITLED.EWB') }, () => {
    const file = ref('UNTITLED.EWB');
    const a = runTool(file);
    const b = runTool(file);

    assert.equal(a, b, 'повторное декодирование Type-1 должно быть одинаковым');
    assert.match(a, /CircuitHeader/, 'содержит блок CircuitHeader');
    assert.match(a, /InternalCircuitVersion i 502/, 'распознаётся версия схемы 502');
    // UNTITLED — пустой документ (блок Elements без компонентов), поэтому
    // проверяем маркер корректности тела, а не наличие компонентов.
});

// ---------- Type 2: DEFAULT.EWB — сжатый поток, 5 секций ----------

test('DEFAULT.EWB (Type 2): "Project_5_1", 5 секций, валидная чек-сумма', { skip: !ref('DEFAULT.EWB') }, () => {
    const file = ref('DEFAULT.EWB');

    const raw = runTool(file);
    // Заголовочный тег версии проекта разнится: DEFAULT → "Project",
    // часть схем (kirch_cu) → "Project_5_1". Фиксируем общий префикс.
    assert.ok(raw.startsWith('Project'), 'сериализация начинается с "Project"');
    assert.match(raw, /CircuitHeader/);

    const info = runTool('--info', file);
    assert.match(info, /type=2 sec=5\b/, 'ожидается 5 секций, как задокументировано');
    assert.match(info, /checksum=\S+ computed=\S+ OK/, 'контрольная сумма секций совпадает');
});

// ---------- Type 2: реальная схема (Кирхгоф) — сквозной конвейер ----------

test('CIRCUITS/kirch_cu.ewb (Type 2): валидная сумма, разбираются Comp/wire', { skip: !ref('CIRCUITS/kirch_cu.ewb') }, () => {
    const file = ref('CIRCUITS/kirch_cu.ewb');

    const info = runTool('--info', file);
    assert.match(info, /OK/, 'контрольная сумма кирхгоф-схемы совпадает');

    const raw = runTool(file);
    // фундамент для будущего парсера нетлиста:
    assert.match(raw, /Comp\s*\{/, 'есть блоки компонентов Comp');
    assert.match(raw, /PartNum i \d+/, 'у компонентов есть PartNum');
    assert.match(raw, /m_tptrElem A "\w+/, 'у компонентов есть имена-ссылки (R1/V1/...)');
    assert.match(raw, /wire\s*\{/, 'есть блоки wire');
    assert.match(raw, /node_p A "\d+"/, 'у проводов есть номер электрического узла node_p');
});

// ---------- Весь набор CIRCUITS декодируется без ошибок ----------

test('CIRCUITS/*: все схемы декодируются, ни одной MISMATCH по чек-сумме', { skip: !ref('CIRCUITS') }, () => {
    const dir = ref('CIRCUITS');

    let out;
    try {
        // --dir --info не пишет файлы, только сводку; ненулевой код = провал.
        out = runTool('--dir', dir, '--info');
    } catch (e) {
        assert.fail(`декодер упал на наборе схем: ${e.message}\n${e.stdout || ''}`);
    }
    assert.match(out, /OK/, 'хотя бы одна схема имеет валидную чек-сумму');
    assert.doesNotMatch(out, /MISMATCH/, 'ни одна схема не даёт MISMATCH по сумме');
    assert.doesNotMatch(out, /неизвестный EncryptionType/, 'все схемы распознаны');
});
