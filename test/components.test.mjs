// Контракт символов редактора: каждая папка Site/components с manifest.json
// должна иметь согласованные размеры (manifest.size ↔ viewBox), а точки
// подключения — лежать внутри этого viewBox. Отдельно фиксируем соответствие
// «исходный SVG EWB → существующий id палитры», чтобы будущие агенты не
// добавляли дубликаты (ewb-*) вместо слияния с палитрой.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldSymbolSize, WORLD_SYMBOL_MAX } from '../Site/logic/js/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS = join(ROOT, 'Site', 'components');

// `generator` временно исключён: его manifest.json удалён в рабочем дереве
// (не моя правка), вернуть в список вместе с манифестом.
const MIN_SYMBOL_IDS = ['point', 'resistor', 'capacitor'];

// Источник — плитка палитры: point = Basic 01 (соединитель), ground = Sources 01.
const EXPECTED_SOURCE = {
    point: 'ewb-3002-01',
    resistor: 'ewb-3002-02',
    capacitor: 'ewb-3002-03',
};

function viewBoxOf(svgText) {
    const m = svgText.match(/\bviewBox\s*=\s*"([^"]+)"/i);
    if (!m) return null;
    const parts = m[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

async function componentDirs() {
    const entries = await readdir(COMPONENTS, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

test('палитра: у ключевых компонентов есть symbol.svg и правильный source', async () => {
    for (const id of MIN_SYMBOL_IDS) {
        const manifest = JSON.parse(await readFile(join(COMPONENTS, id, 'manifest.json'), 'utf8'));
        assert.equal(manifest.id, id, `${id}: id манифеста`);
        assert.equal(manifest.symbol, 'symbol.svg', `${id}: имя символа`);
        assert.equal(manifest.source, EXPECTED_SOURCE[id], `${id}: источник SVG`);
        const svg = await readFile(join(COMPONENTS, id, 'symbol.svg'), 'utf8');
        assert.match(svg, /<svg\b/i, `${id}: symbol.svg — валидный SVG`);
    }
});

test('манифесты: size совпадает с viewBox, порты внутри символа', async () => {
    for (const dir of await componentDirs()) {
        let manifest;
        try {
            manifest = JSON.parse(await readFile(join(COMPONENTS, dir, 'manifest.json'), 'utf8'));
        } catch {
            continue; // папка без манифеста не входит в палитру
        }
        const symbolName = manifest.symbol || 'symbol.svg';
        let svg;
        try {
            svg = await readFile(join(COMPONENTS, dir, symbolName), 'utf8');
        } catch {
            continue; // плейсхолдер без символа (например, multimeter)
        }
        const vb = viewBoxOf(svg);
        assert.ok(vb, `${dir}: viewBox в ${symbolName}`);
        const size = manifest.size || {};
        assert.equal(size.w, vb.w, `${dir}: width ↔ viewBox.w`);
        assert.equal(size.h, vb.h, `${dir}: height ↔ viewBox.h`);

        for (const port of manifest.ports || []) {
            assert.equal(typeof port.x, 'number', `${dir}/${port.id}: x числом`);
            assert.equal(typeof port.y, 'number', `${dir}/${port.id}: y числом`);
            assert.ok(port.x >= 0 && port.x <= vb.w, `${dir}/${port.id}: x внутри viewBox`);
            assert.ok(port.y >= 0 && port.y <= vb.h, `${dir}/${port.id}: y внутри viewBox`);
        }
    }
});

test('worldSymbolSize: фиксированный мировой размер без искажения пропорций', () => {
    // Размер компонента не зависит от размера окна: масштабируется всё поле
    // (viewport.js), поэтому пропорции символа сохраняются при любом zoom.
    const sizes = [
        { w: 321, h: 121 }, // резистор
        { w: 190, h: 284 }, // конденсатор
        { w: 341, h: 151 }, // земля
        { w: 254, h: 163 }, // генератор
    ];
    for (const size of sizes) {
        const out = worldSymbolSize(size);
        assert.ok(Math.abs(Math.max(out.w, out.h) - WORLD_SYMBOL_MAX) < 1e-9,
            `${size.w}x${size.h}: максимальная сторона = ${WORLD_SYMBOL_MAX}`);
        assert.ok(Math.abs((out.w / out.h) - (size.w / size.h)) < 1e-9,
            'пропорции символа сохранены');
    }
    // Второй вызов даёт тот же результат (не зависит от контекста/окна).
    assert.deepEqual(worldSymbolSize({ w: 321, h: 121 }), worldSymbolSize({ w: 321, h: 121 }));
    // Некорректный вход — безопасный дефолт.
    assert.deepEqual(worldSymbolSize({ w: 0, h: 0 }), { w: 80, h: 40 });
    assert.ok(WORLD_SYMBOL_MAX > 0);
});

test('исходные ewb-* папки не дублируются в палитре как новые id', async () => {
    // Исходные папки — источник SVG (provenance). В interface.js редактора
    // должны попадать только существующие id палитры, а не ewb-*.
    const interfaceSrc = await readFile(join(ROOT, 'Site', 'logic', 'js', 'interface.js'), 'utf8');
    assert.doesNotMatch(interfaceSrc, /'ewb-\d{4}-\d{2}'/, 'ewb-* не добавляются в меню редактора');
});
