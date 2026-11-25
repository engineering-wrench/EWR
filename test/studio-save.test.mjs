// Тесты прямой записи компонента в папку проекта (Component-editor/tools/serve.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    sanitizeName,
    safeFileName,
    saveComponent,
    listPalette,
    listDrawnComponents,
    mergeSymbol,
} from '../Component-editor/tools/serve.mjs';

test('sanitizeName: убирает слэши, точки и спецсимволы', () => {
    assert.equal(sanitizeName('ewb-3001-01'), 'ewb-3001-01');
    assert.equal(sanitizeName('../evil'), '_-evil');
    assert.equal(sanitizeName('a/b:c'), 'a-b-c');
    assert.equal(sanitizeName('  '), 'component');
});

test('safeFileName: не пропускает путь', () => {
    assert.equal(safeFileName('symbol.svg'), 'symbol.svg');
    assert.equal(safeFileName('../secret.txt'), 'secret.txt');
    assert.throws(() => safeFileName('..'));
});

test('saveComponent: пишет png+svg+manifest в <out>/<id>/', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ewr-studio-'));
    try {
        const dir = await saveComponent(out, 'ewb-3001-01', [
            { name: 'symbol.svg', encoding: 'utf8', data: '<svg/>' },
            { name: 'manifest.json', encoding: 'utf8', data: '{"id":"ewb-3001-01"}' },
            { name: 'icon.png', encoding: 'base64', data: Buffer.from([1, 2, 3]).toString('base64') },
        ]);
        assert.equal(dir, join(out, 'ewb-3001-01'));
        assert.equal(await readFile(join(dir, 'symbol.svg'), 'utf8'), '<svg/>');
        assert.equal(await readFile(join(dir, 'manifest.json'), 'utf8'), '{"id":"ewb-3001-01"}');
        assert.deepEqual(Array.from(await readFile(join(dir, 'icon.png'))), [1, 2, 3]);
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test('saveComponent: id с ../ не выходит за пределы out', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ewr-studio-'));
    try {
        await saveComponent(out, '../escape', [{ name: 'a.txt', encoding: 'utf8', data: 'x' }]);
        // Имя санитизировано в `_-escape` и осталось внутри out.
        await stat(join(out, '_-escape', 'a.txt'));
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test('listPalette: читает только папки с manifest.json и отмечает файлы', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ewr-palette-'));
    try {
        await mkdir(join(root, 'resistor'));
        await writeFile(join(root, 'resistor', 'manifest.json'), JSON.stringify({
            id: 'resistor', name: 'Резистор', category: 'component',
            size: { w: 800, h: 600 }, icon: 'icon.png', symbol: 'symbol.svg', ports: [],
        }));
        await writeFile(join(root, 'resistor', 'symbol.svg'), '<svg/>');

        await mkdir(join(root, 'empty'));
        await mkdir(join(root, 'generator'));
        await writeFile(join(root, 'generator', 'manifest.json'), JSON.stringify({
            id: 'generator', name: 'Генератор', category: 'instrument',
        }));
        await writeFile(join(root, 'generator', 'icon.png'), Buffer.from([1, 2, 3]));

        const items = await listPalette(root);
        assert.deepEqual(items.map(i => i.id), ['generator', 'resistor']);

        const r = items.find(i => i.id === 'resistor');
        assert.equal(r.category, 'component');
        assert.equal(r.hasSymbol, true);
        assert.equal(r.hasIcon, false);
        assert.deepEqual(r.size, { w: 800, h: 600 });

        const g = items.find(i => i.id === 'generator');
        assert.equal(g.category, 'instrument');
        assert.equal(g.hasIcon, true);
        assert.equal(g.hasSymbol, false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('listDrawnComponents: только manifest + symbol.svg, с URL и источником', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ewr-drawn-'));
    try {
        await mkdir(join(root, 'ewb-3001-01'));
        await writeFile(join(root, 'ewb-3001-01', 'manifest.json'), JSON.stringify({
            id: 'ewb-3001-01', name: 'Земля', category: 'component',
            source: 'ewb-3001-01', size: { w: 100, h: 50 },
        }));
        await writeFile(join(root, 'ewb-3001-01', 'symbol.svg'), '<svg/>');

        await mkdir(join(root, 'only-manifest'));
        await writeFile(join(root, 'only-manifest', 'manifest.json'), '{"id":"only-manifest"}');
        await mkdir(join(root, 'no-manifest'));
        await writeFile(join(root, 'no-manifest', 'symbol.svg'), '<svg/>');

        const items = await listDrawnComponents([{ key: 'repo', root, prefix: '/repo-components' }]);
        assert.equal(items.length, 1);
        assert.equal(items[0].id, 'ewb-3001-01');
        assert.equal(items[0].rootKey, 'repo');
        assert.equal(items[0].source, 'ewb-3001-01');
        assert.equal(items[0].symbolUrl, '/repo-components/ewb-3001-01/symbol.svg');
        assert.equal(items[0].manifestUrl, '/repo-components/ewb-3001-01/manifest.json');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('listDrawnComponents: дубликаты по id берутся из первого корня', async () => {
    const studio = await mkdtemp(join(tmpdir(), 'ewr-drawn-a-'));
    const repo = await mkdtemp(join(tmpdir(), 'ewr-drawn-b-'));
    try {
        for (const [root, name] of [[studio, 'Студия'], [repo, 'Репозиторий']]) {
            await mkdir(join(root, 'resistor'));
            await writeFile(join(root, 'resistor', 'manifest.json'), JSON.stringify({
                id: 'resistor', name, source: 'resistor',
            }));
            await writeFile(join(root, 'resistor', 'symbol.svg'), '<svg/>');
        }
        const items = await listDrawnComponents([
            { key: 'studio', root: studio, prefix: '/studio-components' },
            { key: 'repo', root: repo, prefix: '/repo-components' },
        ]);
        assert.equal(items.length, 1);
        assert.equal(items[0].rootKey, 'studio');
        assert.equal(items[0].name, 'Студия');
    } finally {
        await rm(studio, { recursive: true, force: true });
        await rm(repo, { recursive: true, force: true });
    }
});

test('mergeSymbol: заменяет symbol.svg, не трогая manifest.json и icon.png', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ewr-merge-'));
    try {
        const dir = join(root, 'resistor');
        await mkdir(dir);
        await writeFile(join(dir, 'manifest.json'), '{"id":"resistor"}');
        await writeFile(join(dir, 'icon.png'), Buffer.from([1, 2, 3]));
        await writeFile(join(dir, 'symbol.svg'), '<svg>старый</svg>');

        const result = await mergeSymbol(root, 'resistor', '<svg>новый</svg>');
        assert.equal(result.created, false);
        assert.equal(await readFile(join(dir, 'symbol.svg'), 'utf8'), '<svg>новый</svg>');
        assert.equal(await readFile(join(dir, 'manifest.json'), 'utf8'), '{"id":"resistor"}');
        assert.deepEqual(Array.from(await readFile(join(dir, 'icon.png'))), [1, 2, 3]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('mergeSymbol: создаёт папку и минимальный манифест для новой плитки', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ewr-merge-'));
    try {
        const result = await mergeSymbol(root, 'capacitor', '<svg/>', {
            id: 'capacitor', name: 'Конденсатор', category: 'component',
            size: { w: 400, h: 300 }, symbol: 'symbol.svg',
        });
        assert.equal(result.created, true);
        assert.equal(await readFile(join(root, 'capacitor', 'symbol.svg'), 'utf8'), '<svg/>');
        const manifest = JSON.parse(await readFile(join(root, 'capacitor', 'manifest.json'), 'utf8'));
        assert.equal(manifest.id, 'capacitor');
        assert.equal(manifest.category, 'component');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('mergeSymbol: без манифеста и без описания элемента — ошибка', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ewr-merge-'));
    try {
        await assert.rejects(
            () => mergeSymbol(root, 'capacitor', '<svg/>'),
            /элемента нет в палитре/
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
