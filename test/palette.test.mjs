// Тесты I4: статическая таблица палитры EWB (лениво, без EWB512/ — self-skip).
//
//   1. Юнит-тесты чистых парсеров на синтетических данных.
//   2. Golden: артефакт `Site/engine/palette.generated.json` воспроизводится и
//      согласован с лентами BITMAP30xx (число плиток = count для 13 категорий).
//
// Эталоны (`EWB512/WEWB32.EXE`, `WEWB.RES`, `COMPDAT.DLL`, `WEWBMSG.RES`) —
// read-only референс оригинала; при их отсутствии тесты пропускаются.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    ROOT, DEFAULT_EXE, DEFAULT_OUT, BIN_COUNT, RES_ENTRY_SIZE,
    parsePartsBin, parseStyleRegistry, parseResContainer, parseLibraryRecords,
    parseCategoryNames, readStripBmp, buildPalette, sliceRegistry,
} from '../tools/palette-extract.mjs';

const skip = fs.existsSync(DEFAULT_EXE)
    ? false
    : 'нет EWB512/WEWB32.EXE (референс оригинала не смонтирован)';

// ---------- unit: таблица PartsBin ----------

test('parsePartsBin: находит сигнатуру и разбирает 17 записей', () => {
    // Синтетический EXE: шапка + 17 записей по 40 байт.
    const buf = Buffer.alloc(4096);
    const off = 512;
    for (let k = 0; k < BIN_COUNT; k++) {
        const p = off + k * 40;
        buf.writeInt32LE(3101 + k, p);
        buf.writeInt32LE(3001 + k, p + 4);
        buf.writeInt32LE(3301 + k, p + 8);
        buf.writeInt32LE(3201 + k, p + 12);
        buf.writeInt32LE(k + 1, p + 16);   // плиток
        buf.writeInt32LE(k + 1, p + 20);   // индекс
    }
    const { fileOffset, bins } = parsePartsBin(buf);
    assert.equal(fileOffset, off);
    assert.equal(bins.length, BIN_COUNT);
    assert.equal(bins[0].strip, 3001);
    assert.equal(bins[0].tiles, 1);
    assert.equal(bins[16].strip, 3017);
    assert.deepEqual(bins[1].strips, { icon: 3102, ansi: 3002, toolbar: 3302, din: 3202 });
});

test('parsePartsBin: индекс вне порядка 1..17 не считается таблицей', () => {
    const buf = Buffer.alloc(4096);
    const off = 256;
    for (let k = 0; k < BIN_COUNT; k++) {
        const p = off + k * 40;
        buf.writeInt32LE(3101 + k, p);
        buf.writeInt32LE(3001 + k, p + 4);
        buf.writeInt32LE(3301 + k, p + 8);
        buf.writeInt32LE(3201 + k, p + 12);
        buf.writeInt32LE(1, p + 16);
        buf.writeInt32LE(k + 5, p + 20);   // индекс сдвинут
    }
    assert.throws(() => parsePartsBin(buf), /не найдена/);
});

// ---------- unit: реестр стилей ----------

test('sliceRegistry: якоря делят реестр на секции', () => {
    const keys = [
        'fwb', 'shock', 'titleblk',
        'And2', 'Mono',
        'TemplateAnd', 'AND Gates', 'TemplateFli', 'Flip-Flops',
        'muxer', 'shift',
        '7400', '4000', 'Template740', 'Subcircuit',
        'AC_VOLTAGE_SOURCE', 'NODE', 'Oscilloscope', 'ANALOG:',
    ];
    const s = sliceRegistry(keys);
    const byId = Object.fromEntries(s.map((x) => [x.id, x]));
    assert.equal(byId.styles.count, 3);
    assert.equal(byId.digital.count, 2);
    assert.equal(byId.subcategories.count, 4);
    assert.equal(byId['template-impl'].count, 2);
    assert.equal(byId.primitives.count, 2);
    assert.equal(byId.instruments.from, 17);
    assert.equal(byId.prefixes.count, 1);
    // Нет секций с отрицательными границами / пустых.
    for (const sec of s) assert.ok(sec.to >= sec.from && sec.count > 0);
});

// ---------- unit: имена категорий ----------

test('parseCategoryNames: блок строк в кавычках после "Favorites"', () => {
    const msg = Buffer.from(
        '"NE"\r\n"Favorites"\r\n"Sources"\r\n"Basic"\r\n"Diodes"\r\n"Transistors"\r\n' +
        '"Analog ICs"\r\n"Mixed ICs"\r\n"Digital ICs"\r\n"Logic Gates"\r\n"Digital"\r\n' +
        '"Indicators"\r\n"Controls"\r\n"Miscellaneous"\r\n"Instruments"\r\n"Model Expansion Package A"\r\n',
        'latin1',
    );
    const names = parseCategoryNames(msg);
    assert.equal(names.length, 14);
    assert.equal(names[0], 'Favorites');
    assert.equal(names[1], 'Sources');
    assert.equal(names[13], 'Instruments');
    assert.deepEqual(parseCategoryNames(Buffer.from('нет анкера')), [], 'без анкера — пусто');
});

// ---------- unit: контейнер WEWB.RES ----------

test('parseResContainer: каталог 21-байтовых записей', () => {
    const header = Buffer.alloc(64);
    const blob = Buffer.from('DATA-DATA', 'latin1');
    const parts = [
        makeEntry('ewbtext', 0, 40),
        makeEntry('ewba.la', 64, blob.length),
    ];
    const res = Buffer.concat([header, blob, Buffer.concat(parts)]);
    const { entries } = parseResContainer(res);
    assert.deepEqual(entries.map((e) => e.name), ['ewba.la']);
    assert.equal(entries[0].offset, 64);
    assert.equal(entries[0].size, blob.length);
});

function makeEntry(name, offset, size) {
    const e = Buffer.alloc(RES_ENTRY_SIZE);
    e.write(name, 0, 'latin1');
    e.writeUInt32LE(offset, 13);
    e.writeUInt32LE(size, 17);
    return e;
}

test('parseLibraryRecords: C-записи с классом модели', () => {
    const text = [
        'C 2 3 23 1980  V=0 U=0 M="" S=1 L=""',
        'C 1 0 22 1899  V=0 U=0 M="" S=1 L=""',
        'C 14 0 23 1837  V=1 U=0 M="transf" S=1 L=""',
        'P "x" 4 1',
    ].join('\r\n');
    const recs = parseLibraryRecords(Buffer.from(text, 'latin1'));
    assert.equal(recs.length, 3);
    assert.deepEqual(recs[0], {
        partNum: 2, flags: 3, x: 23, y: 1980, value: '0',
        units: 0, modelClass: '', label: '',
    });
    assert.equal(recs[2].modelClass, 'transf');
});

// ---------- unit: ленты ----------

function makeBmp(width, height, bpp, pixels) {
    const rowBytes = Math.floor((bpp * width + 31) / 32) * 4;
    const dataOffset = 54 + 1024 * (bpp === 8 ? 4 : bpp === 4 ? 4 : 8);
    const buf = Buffer.alloc(dataOffset + rowBytes * height);
    buf.write('BM', 0, 'latin1');
    buf.writeUInt32LE(dataOffset, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(bpp, 28);
    // Пиксели: caller даёт функцию (x, y) -> индекс.
    for (let y = 0; y < height; y++) {
        const src = height - 1 - y;
        const line = dataOffset + src * rowBytes;
        for (let x = 0; x < width; x++) {
            const v = pixels(x, y);
            if (bpp === 8) buf[line + x] = v;
            else {
                const byteIdx = line + Math.floor(x / 2);
                const shift = x % 2 === 0 ? 4 : 0;
                buf[byteIdx] = (buf[byteIdx] & ~(0xf << shift)) | ((v & 0xf) << shift);
            }
        }
    }
    return buf;
}

test('readStripBmp: 24 px плитки и md5 на плитку', () => {
    const bmp = makeBmp(48, 2, 8, (x) => (x < 24 ? 1 : 2));
    const s = readStripBmp(bmp);
    assert.equal(s.width, 48);
    assert.equal(s.tiles.length, 2);
    assert.equal(s.tiles[0].x, 0);
    assert.equal(s.tiles[1].x, 24);
    assert.notEqual(s.tiles[0].md5, s.tiles[1].md5);
});

test('readStripBmp: некруглая ширина 313 px → 13 равных плиток', () => {
    const bmp = makeBmp(313, 2, 8, (x) => x % 16);
    const s = readStripBmp(bmp);
    assert.equal(s.tiles.length, 13);
    assert.equal(s.tiles[12].x + s.tiles[12].width, 313);
});

// ---------- golden: артефакт ----------

test('buildPalette: категории PartsBin и реестр стилей', { skip }, () => {
    const p = buildPalette();
    assert.equal(p.format, 'ewr-ewb-palette');
    assert.equal(p.categories.length, BIN_COUNT);

    // Имена вкладок — из WEWBMSG.RES; первые 13 записей — вкладки, 14..17 — нет.
    assert.deepEqual(p.categoryNames.slice(0, 4), ['Favorites', 'Sources', 'Basic', 'Diodes']);
    assert.equal(p.categoryNames[13], 'Instruments');
    assert.equal(p.categories[0].name, 'Sources');
    assert.equal(p.categories[11].name, 'Miscellaneous');
    assert.equal(p.categories[12].name, 'Instruments');
    for (const c of p.categories.slice(0, 13)) assert.equal(c.role, 'palette-tab');
    for (const c of p.categories.slice(13)) {
        assert.equal(c.name, null, `лента ${c.strip}: имени вкладки нет`);
        assert.equal(c.role, 'library-icons');
    }

    // Ленты 30xx/31xx/33xx/32xx идут арифметически, индексы 1..17.
    p.categories.forEach((c, k) => {
        assert.equal(c.index, k + 1);
        assert.equal(c.strip, 3001 + k);
        assert.equal(c.strips.icon, 3101 + k);
        assert.equal(c.strips.toolbar, 3301 + k);
        assert.equal(c.strips.din, 3201 + k);
    });

    // 13 классических категорий: число плиток ленты = count.
    const thirteen = p.categories.slice(0, 13);
    for (const c of thirteen) {
        assert.equal(c.stripTiles, c.tiles, `лента ${c.strip}: плиток ${c.stripTiles}, count ${c.tiles}`);
        assert.equal(c.tilesMatch, true);
    }
    // 3014..3017 — динамические бины: лента короче count (это факт, не ошибка).
    for (const c of p.categories.slice(13)) assert.equal(c.stripTiles < c.tiles, true);

    // Реестр: библиотечные стили начинаются с fwb, цифра — с And2,
    // внутренние типы примитивов = PN0..PN41.
    assert.deepEqual(p.registry.keys.slice(0, 5).map((k) => k.key), ['fwb', 'shock', 'scr', 'diac', 'triac']);
    const prim = p.registry.sections.find((s) => s.id === 'primitives');
    assert.ok(prim, 'есть секция primitives');
    const primKeys = p.registry.keys.slice(prim.from, prim.to + 1).map((k) => k.key);
    assert.equal(primKeys.length, 42);
    assert.equal(primKeys[0], 'AC_VOLTAGE_SOURCE');
    assert.equal(primKeys[1], 'RESISTOR');
    assert.equal(primKeys[39], 'NODE');

    // Имена PartNum: 0..41, ключевые точки.
    assert.equal(p.partNames.length, 42);
    assert.equal(p.partNames[1].name, 'Resistor');
    assert.equal(p.partNames[13].name, 'Voltmeter');
    assert.equal(p.partNames[39].name, 'Node');

    // C-записи библиотеки: все номера — из диапазона примитивов.
    assert.ok(p.library.ansi.length > 0);
    for (const rec of p.library.ansi) assert.ok(rec.partNum >= 0 && rec.partNum <= 38);
});

test('buildPalette: детерминизм (два прогона совпадают)', { skip }, () => {
    const a = JSON.stringify(buildPalette());
    const b = JSON.stringify(buildPalette());
    assert.equal(a, b);
});

test('palette.generated.json: артефакт в репозитории актуален', { skip }, () => {
    assert.ok(fs.existsSync(DEFAULT_OUT), `нет ${path.relative(ROOT, DEFAULT_OUT)} — запустите node tools/palette-extract.mjs`);
    const onDisk = JSON.parse(fs.readFileSync(DEFAULT_OUT, 'utf8'));
    assert.deepEqual(onDisk, buildPalette());
});

// ---------- таблица плиток 155 и манифесты (не требуют EWB512/) ----------

import { TABS, TILES, tileId } from '../tools/palette-tiles.data.mjs';
import { deviceType } from '../Site/engine/parser.js';
import { mapComponentType } from '../Site/logic/js/sim.js';

const COMPONENTS = path.join(ROOT, 'Site', 'components');

function interfaceIdLists() {
    const src = fs.readFileSync(path.join(ROOT, 'Site', 'logic', 'js', 'interface.js'), 'utf8');
    const block = src.match(/const idListComponent = \{([\s\S]*?)\n\}/);
    assert.ok(block, 'в interface.js есть idListComponent');
    const lists = {};
    for (const m of block[1].matchAll(/'([\w-]+)':\s*\[([\s\S]*?)\]/g)) {
        lists[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
    return lists;
}

test('palette-tiles: 13 вкладок, индексы без дыр, id уникальны', () => {
    assert.equal(TABS.length, 13);
    const ids = new Set();
    for (const tab of TABS) {
        const tiles = TILES.filter((x) => x.strip === tab.strip).sort((a, b) => a.index - b.index);
        assert.ok(tiles.length > 0, `${tab.en}: плитки есть`);
        tiles.forEach((tile, k) => assert.equal(tile.index, k + 1, `${tab.en}: индекс ${k + 1}`));
        for (const tile of tiles) {
            assert.ok(!ids.has(tile.id), `id ${tile.id} повторяется`);
            ids.add(tile.id);
            assert.ok(tile.partNum != null || tile.ext != null || tile.strip === 3013,
                `${tile.id}: есть PartNum или ExtComp (или это прибор)`);
            if (tile.partNum != null) assert.ok(tile.partNum >= 0 && tile.partNum <= 41, `${tile.id}: PartNum 0..41`);
            assert.ok(['confirmed', 'inferred', 'unresolved'].includes(tile.confidence), `${tile.id}: уверенность`);
        }
    }
    assert.equal(ids.size, TILES.length);
});

test('palette-tiles: source ↔ tileId, блок ewb в манифестах, символ с viewBox = size', () => {
    for (const tile of TILES) {
        const dir = path.join(COMPONENTS, tile.id);
        const manifestPath = path.join(dir, 'manifest.json');
        assert.ok(fs.existsSync(manifestPath), `${tile.id}: manifest.json`);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.source, tileId(tile), `${tile.id}: source = ${tileId(tile)}`);
        assert.ok(manifest.ewb, `${tile.id}: блок ewb`);
        assert.equal(manifest.ewb.partNum, tile.partNum, `${tile.id}: ewb.partNum`);
        assert.equal(manifest.ewb.ext, tile.ext, `${tile.id}: ewb.ext`);
        assert.equal(manifest.ewb.model, tile.model, `${tile.id}: ewb.model`);
        assert.equal(manifest.ewb.device, tile.device, `${tile.id}: ewb.device`);

        const symbolPath = path.join(dir, manifest.symbol || 'symbol.svg');
        // Символ может ещё не существовать (плейсхолдер в реестре) — тогда size не сверяем.
        if (!fs.existsSync(symbolPath)) continue;
        const svg = fs.readFileSync(symbolPath, 'utf8');
        const vb = svg.match(/\bviewBox="([^"]+)"/);
        assert.ok(vb, `${tile.id}: viewBox`);
        const [, , w, h] = vb[1].split(/[\s,]+/).map(Number);
        assert.equal(w, manifest.size.w, `${tile.id}: width = viewBox.w`);
        assert.equal(h, manifest.size.h, `${tile.id}: height = viewBox.h`);
    }
});

test('palette-tiles: idListComponent в interface.js = порядок таблицы', () => {
    const lists = interfaceIdLists();
    for (const tab of TABS) {
        const expected = TILES.filter((x) => x.strip === tab.strip)
            .sort((a, b) => a.index - b.index).map((x) => x.id);
        assert.deepEqual(lists[tab.key], expected, `вкладка ${tab.key}`);
    }
    // ewb-* — только источники (source), в палитру редактора они не попадают.
    const src = fs.readFileSync(path.join(ROOT, 'Site', 'logic', 'js', 'interface.js'), 'utf8');
    assert.doesNotMatch(src, /'ewb-\d{4}-\d{2}'/);
});

test('palette-tiles: у каждой вкладки есть лента Site/img/title/<вкладка>.bmp', () => {
    for (const tab of TABS) {
        const bmp = path.join(ROOT, 'Site', 'img', 'title', `${tab.key}.bmp`);
        assert.ok(fs.existsSync(bmp), `${tab.key}.bmp (open_catalog грузит img/title/<id>.bmp)`);
    }
});

test('palette-tiles: id плиток понимает мост редактора (sim.mapComponentType)', () => {
    // Мост пока сопоставляет по имени id, а не по ewb.device — проверяем, что
    // для поддерживаемых движком плиток списки не разъехались с таблицей.
    const bridge = { resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor', diode: 'diode', vsource: 'vsource', isource: 'isource', ground: 'ground', meter: 'instrument' };
    for (const tile of TILES) {
        const expected = bridge[tile.device];
        if (!expected) continue;
        assert.equal(mapComponentType(tile.id), expected, `${tile.id} → ${expected}`);
    }
});

test('palette-tiles: device примитивов согласован с parser.deviceType', () => {
    for (const tile of TILES) {
        if (tile.partNum == null || tile.device === 'unknown') continue;
        const byPn = deviceType('', tile.partNum);
        if (byPn !== 'unknown') assert.equal(tile.device, byPn, `${tile.id}: PN ${tile.partNum}`);
    }
    // Ключевые привязки «плитка → движок».
    const byId = new Map(TILES.map((x) => [x.id, x]));
    assert.equal(byId.get('resistor').device, 'resistor');
    assert.equal(byId.get('capacitor').device, 'capacitor');
    assert.equal(byId.get('ground').device, 'ground');
    assert.equal(byId.get('diode').device, 'diode');
    assert.equal(byId.get('voltmeter').device, 'meter');
});
