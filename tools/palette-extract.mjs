#!/usr/bin/env node
// Извлечение статической таблицы палитры EWB 5.12 (I4).
//
// Откуда берутся данные (всё — файлы оригинала, read-only):
//   * EWB512/WEWB32.EXE  — таблица PartsBin: 17 записей по 40 байт вида
//     {иконка-лента 31xx, ANSI 30xx, toolbar 33xx, DIN 32xx, число плиток,
//      индекс, флаг, 0, флаг, 0}. Ищем по сигнатуре (3101/3001/3301/3201),
//     без хардкода смещения — таблица могла быть перестроена.
//   * EWB512/COMPDAT.DLL — упакованный реестр стилей библиотечных деталей
//     (строки через NUL, порядок = порядок категорий).
//   * EWB512/WEWBMSG.RES — имена PartNum 0..41 (парсер из tools/models-parse.mjs).
//   * EWB512/WEWB.RES    — контейнер; `ewba.la` = ANSI-ресурс с C-записями
//     `C <PN> <flags> <x> <y> V=… U=… M="класс" S=… L=…`.
//   * BITMAP30xx_1.bmp   — ленты иконок 24 px/плитка (если есть; иначе几何 без md5).
//
// Использование:
//   node tools/palette-extract.mjs                # записать артефакт
//   node tools/palette-extract.mjs --stdout       # только JSON в stdout
//   node tools/palette-extract.mjs --md           # таблица категорий в markdown
//
// Без EWB512/ — понятная ошибка (артефакт не пишется).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parsePartNames } from './models-parse.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_EXE = path.join(ROOT, 'EWB512', 'WEWB32.EXE');
export const DEFAULT_COMPDAT = path.join(ROOT, 'EWB512', 'COMPDAT.DLL');
export const DEFAULT_MSG = path.join(ROOT, 'EWB512', 'WEWBMSG.RES');
export const DEFAULT_RES = path.join(ROOT, 'EWB512', 'WEWB.RES');
export const DEFAULT_OUT = path.join(ROOT, 'Site', 'engine', 'palette.generated.json');
export const FORMAT = 'ewr-ewb-palette';
export const FORMAT_VERSION = 1;

/** Размер записи таблицы PartsBin. */
export const BIN_RECORD_SIZE = 40;
/** Ожидаемое число категорий PartsBin (3001..3017). */
export const BIN_COUNT = 17;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- WEWB32.EXE: таблица PartsBin ------------------------------------------

/**
 * Находит таблицу PartsBin по сигнатуре и разбирает её.
 * @param {Buffer} exe
 * @returns {{fileOffset:number, bins:Array}}
 */
export function parsePartsBin(exe) {
  const stride = BIN_RECORD_SIZE;
  const first = 3101;

  for (let off = 0; off + stride * BIN_COUNT <= exe.length; off += 4) {
    let ok = true;
    const bins = [];
    for (let k = 0; k < BIN_COUNT; k++) {
      const p = off + k * stride;
      const icon = exe.readInt32LE(p);
      const ansi = exe.readInt32LE(p + 4);
      const tb = exe.readInt32LE(p + 8);
      const din = exe.readInt32LE(p + 12);
      const count = exe.readInt32LE(p + 16);
      const index = exe.readInt32LE(p + 20);
      const f0 = exe.readInt32LE(p + 24);
      const f1 = exe.readInt32LE(p + 28);
      const f2 = exe.readInt32LE(p + 32);
      const f3 = exe.readInt32LE(p + 36);
      if (
        icon !== first + k ||
        ansi !== 3001 + k ||
        tb !== 3301 + k ||
        din !== 3201 + k ||
        index !== k + 1 ||
        count < 1 || count > 999 ||
        f1 < 0 || f3 < 0
      ) { ok = false; break; }
      bins.push({
        index,
        // Категория 1..17: ANSI-лента 3001..3017 задаёт порядок (см. план I4).
        strip: ansi,
        strips: { icon, ansi, toolbar: tb, din },
        tiles: count,
        flags: [f0, f1, f2, f3],
      });
    }
    if (ok) return { fileOffset: off, bins };
  }
  throw new Error('таблица PartsBin не найдена в WEWB32.EXE');
}

// --- COMPDAT.DLL: реестр стилей --------------------------------------------

const REGISTRY_SIGNATURE = Buffer.from('\x08\x00\x00\x00fwb\x00shock\x00scr\x00', 'latin1');

/**
 * Делит реестр COMPDAT на смысловые секции по якорям.
 * @param {string[]} keys
 */
export function sliceRegistry(keys) {
  const idx = (key, from = 0) => keys.indexOf(key, from);
  const out = [];
  const add = (id, name, from, to) => {
    if (from < 0 || to < 0 || to <= from) return;
    out.push({ id, name, from, to: to - 1, count: to - from });
  };

  const stylesEnd = idx('titleblk') + 1;          // библиотечные стили
  const digitalEnd = idx('Mono') + 1;             // цифровые примитивы
  const subcatEnd = idx('TemplateFli') + 2;       // "TemplateFli" + "Flip-Flops"
  const tplEnd = idx('shift') + 1;                // muxer…shift
  const ser74 = idx('7400');
  const ser4 = idx('4000');
  const serTpl = idx('Template740');
  const subckt = idx('Subcircuit');
  const prim = idx('AC_VOLTAGE_SOURCE');
  const instr = idx('Oscilloscope');
  const prefixes = idx('ANALOG:');

  add('styles', 'библиотечные стили', 0, stylesEnd);
  add('digital', 'цифровые примитивы и шаблоны', stylesEnd, digitalEnd);
  add('subcategories', 'подкатегории цифровых ИС', digitalEnd, subcatEnd);
  add('template-impl', 'реализации шаблонов цифры', subcatEnd, tplEnd);
  add('series-74', 'серия 74xx', ser74, ser4);
  add('series-4', 'серия 4xxx', ser4, serTpl);
  add('series-templates', 'шаблоны серий ИС', serTpl, subckt);
  add('subcircuit', 'подсхема', subckt, subckt + 1);
  add('primitives', 'внутренние типы примитивов (PN0..41)', prim, instr);
  add('instruments', 'классы приборов', instr, prefixes);
  add('prefixes', 'префиксы имён ExtComp', prefixes, keys.length);
  return out;
}

/**
 * Разбирает пул стилей COMPDAT.DLL.
 * @param {Buffer} dll
 * @returns {{fileOffset:number, keys:Array<{offset:number,key:string}>}}
 */
export function parseStyleRegistry(dll) {
  const at = dll.indexOf(REGISTRY_SIGNATURE);
  if (at < 0) throw new Error('реестр стилей не найден в COMPDAT.DLL');
  const start = at + 4; // пропускаем 4-байтовую шапку (0x08)
  const keys = [];
  let pos = start;
  while (pos < dll.length) {
    const end = dll.indexOf(0, pos);
    if (end < 0) break;
    const raw = dll.subarray(pos, end);
    // Пул заканчивается на непечатных байтах/пустой строке.
    if (raw.length === 0 || !/^[\x20-\x7e]+$/.test(raw.toString('latin1'))) break;
    keys.push({ offset: pos, key: raw.toString('latin1') });
    pos = end + 1;
  }
  if (!keys.length) throw new Error('пул стилей пуст');
  return { fileOffset: start, keys };
}

// --- WEWB.RES: контейнер и ewba.la -----------------------------------------

/** Длина записи каталога WEWB.RES: имя[13] + смещение u32 + размер u32. */
export const RES_ENTRY_SIZE = 21;

/**
 * Разбирает каталог контейнера WEWB.RES.
 * Запись: имя[13] (NUL-терминированное), смещение u32, размер u32.
 * @param {Buffer} res
 */
export function parseResContainer(res) {
  // Каталог ищем по служебной записи ewbtext; дальше записи идут подряд.
  const anchor = res.lastIndexOf(Buffer.from('ewbtext\x00', 'latin1'));
  if (anchor < 0) throw new Error('каталог WEWB.RES не найден');
  const entries = [];
  let pos = anchor;
  while (pos + RES_ENTRY_SIZE <= res.length) {
    const nameRaw = res.subarray(pos, pos + 13);
    const zero = nameRaw.indexOf(0);
    if (zero <= 0) break;
    const name = nameRaw.subarray(0, zero).toString('latin1');
    if (!/^[\w.+-]+$/.test(name)) break;
    const offset = res.readUInt32LE(pos + 13);
    const size = res.readUInt32LE(pos + 17);
    // Служебная запись ewbtext адресует сам заголовок (offset 0) — её пропускаем.
    if (name !== 'ewbtext') {
      if (!size || offset + size > res.length) break;
      entries.push({ name, offset, size });
    }
    pos += RES_ENTRY_SIZE;
  }
  if (!entries.length) throw new Error('каталог WEWB.RES пуст');
  return { fileOffset: anchor, entries };
}

const C_RECORD = /^C (\d+) (\d+) (-?\d+) (-?\d+)  V=(\S+) U=(\d+) M="([^"]*)" S=(\d+) L="([^"]*)"$/gm;

/**
 * Разбирает раскладку примитивов в WEWBANSI.RES / WEWBDIN.RES (Comp + PartNum + Position).
 * @param {string} text
 */
export function parseSymbolLayout(text) {
  const out = [];
  const re = /\bComp\r?\n\s*\{\r?\n[\s\S]*?PartNum i (\d+)\r?\n\s*Position i:\d+ (-?\d+) (-?\d+) (-?\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ partNum: Number(m[1]), flags: Number(m[2]), x: Number(m[3]), y: Number(m[4]) });
  }
  return out;
}

/**
 * Разбирает C-записи библиотеки (ewba.la / ewbd.ld).
 * @param {Buffer} blob
 * @returns {Array<{partNum:number, flags:number, x:number, y:number, value:string,
 *                  units:number, modelClass:string, label:string}>}
 */
export function parseLibraryRecords(blob) {
  const text = blob.toString('latin1');
  const out = [];
  C_RECORD.lastIndex = 0;
  let m;
  while ((m = C_RECORD.exec(text))) {
    out.push({
      partNum: Number(m[1]),
      flags: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      value: m[5],
      units: Number(m[6]),
      modelClass: m[7],
      label: m[9],
    });
  }
  return out;
}

// --- BITMAP30xx: ленты иконок ----------------------------------------------

/**
 * Читает индексный BMP (1/4/8 bpp) и считает md5 каждой 24-px плитки.
 * @param {Buffer} buf
 * @param {number} tileWidth
 */
export function readStripBmp(buf, tileWidth = null) {
  if (buf.toString('latin1', 0, 2) !== 'BM') throw new Error('не BMP');
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const height = Math.abs(heightRaw);
  const bottomUp = heightRaw > 0;
  const rowBytes = Math.floor((bpp * width + 31) / 32) * 4;
  if (![1, 4, 8].includes(bpp)) throw new Error(`неподдерживаемый bpp: ${bpp}`);
  const perByte = 8 / bpp;
  const mask = (1 << bpp) - 1;

  // Пиксели по строкам сверху вниз, чтобы хеш не зависел от ориентации BMP.
  const rows = [];
  for (let y = 0; y < height; y++) {
    const src = bottomUp ? height - 1 - y : y;
    const line = buf.subarray(dataOffset + src * rowBytes, dataOffset + (src + 1) * rowBytes);
    const px = Buffer.alloc(width);
    for (let x = 0; x < width; x++) {
      const byte = line[Math.floor(x / perByte)];
      const shift = 8 - bpp * ((x % perByte) + 1);
      px[x] = (byte >> shift) & mask;
    }
    rows.push(px);
  }

  // Число плиток — round(ширина / 24): ленты 3012 шире сетки (313 px на 13 плиток),
  // поэтому плитки делятся равномерно, а не нарезаются фиксированными 24 px.
  const count = Math.max(1, Math.round(width / (tileWidth || 24)));
  const step = width / count;
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const x0 = Math.round(i * step);
    const x1 = Math.round((i + 1) * step);
    const h = crypto.createHash('md5');
    for (const row of rows) h.update(row.subarray(x0, x1));
    tiles.push({ tile: i + 1, x: x0, width: x1 - x0, md5: h.digest('hex') });
  }

  return { width, height, bpp, headerSize, tileWidth: step, tiles };
}

/** Ищет BMP ленты по id в каталогах-кандидатах. */
export function findStripFile(id, dirs) {
  for (const dir of dirs) {
    const p = path.join(dir, `BITMAP${id}_1.bmp`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- Сборка артефакта ------------------------------------------------------

/**
 * Имена категорий палитры из WEWBMSG.RES: блок CRLF-строк в кавычках, начиная
 * с "Favorites" (динамическая вкладка, своей ленты у неё нет) → "Sources"…
 * "Instruments". Анкер — первые четыре имени; читаем до первой не-строки.
 *
 * @param {Buffer} msg
 * @returns {string[]} имена в порядке файла; [] если анкер не найден
 */
export function parseCategoryNames(msg) {
  const anchor = '"Favorites"\r\n"Sources"\r\n"Basic"\r\n"Diodes"\r\n';
  const text = msg.toString('latin1');
  const at = text.indexOf(anchor);
  if (at < 0) return [];
  const names = [];
  for (const line of text.slice(at).split('\r\n')) {
    const m = /^"([^"\r\n]*)"$/.exec(line);
    if (!m) break;
    names.push(m[1]);
    if (names.length >= 14) break;
  }
  return names;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.exe]
 * @param {string} [opts.compdat]
 * @param {string} [opts.msg]
 * @param {string} [opts.res]
 * @param {string[]} [opts.stripDirs]
 */
export function buildPalette(opts = {}) {
  const exePath = opts.exe || DEFAULT_EXE;
  const compdatPath = opts.compdat || DEFAULT_COMPDAT;
  const msgPath = opts.msg || DEFAULT_MSG;
  const resPath = opts.res || DEFAULT_RES;
  for (const p of [exePath, compdatPath, msgPath, resPath]) {
    if (!fs.existsSync(p)) throw new Error(`нет файла оригинала: ${p}`);
  }

  const exe = fs.readFileSync(exePath);
  const compdat = fs.readFileSync(compdatPath);
  const res = fs.readFileSync(resPath);

  const table = parsePartsBin(exe);
  const registry = parseStyleRegistry(compdat);

  const container = parseResContainer(res);
  const libEntry = container.entries.find((e) => e.name === 'ewba.la');
  if (!libEntry) throw new Error('ewba.la не найден в WEWB.RES');
  const library = parseLibraryRecords(
    res.subarray(libEntry.offset, libEntry.offset + libEntry.size),
  );
  const dinEntry = container.entries.find((e) => e.name === 'ewbd.ld');
  const dinLibrary = dinEntry
    ? parseLibraryRecords(res.subarray(dinEntry.offset, dinEntry.offset + dinEntry.size))
    : [];

  // WEWBANSI.RES / WEWBDIN.RES — раскладки примитивов (39 C-подобных Comp-блоков
  // с PartNum и Position); порядок в файле НЕ равен порядку плиток палитры.
  const symbolSources = {};
  for (const [key, file] of [
    ['ansi', path.join(ROOT, 'EWB512', 'WEWBANSI.RES')],
    ['din', path.join(ROOT, 'EWB512', 'WEWBDIN.RES')],
  ]) {
    if (!fs.existsSync(file)) { symbolSources[key] = null; continue; }
    symbolSources[key] = { file: path.relative(ROOT, file).split(path.sep).join('/'), symbols: parseSymbolLayout(fs.readFileSync(file, 'utf8')) };
  }

  const msgBuf = fs.readFileSync(msgPath);
  const names = parsePartNames(msgBuf.toString('utf8'));
  const partNames = names.map((name, partNum) => ({ partNum, name }));
  // 14 имён из WEWBMSG.RES: [0]="Favorites" (динамическая вкладка), дальше —
  // 13 вкладок со своими лентами 3001..3013 в том же порядке.
  const categoryNames = parseCategoryNames(msgBuf);

  const stripDirs = opts.stripDirs || [
    path.join(ROOT, 'extracted_assets'),
    path.join(ROOT, 'EWB512', 'extracted'),
    path.join(ROOT, 'EWB512'),
  ];

  const strips = {};
  for (const bin of table.bins) {
    for (const id of [bin.strips.ansi, bin.strips.icon, bin.strips.toolbar, bin.strips.din]) {
      if (strips[id]) continue;
      const file = findStripFile(id, stripDirs);
      if (!file) { strips[id] = null; continue; }
      try {
        const geom = readStripBmp(fs.readFileSync(file));
        strips[id] = { file: path.relative(ROOT, file).split(path.sep).join('/'), ...geom };
      } catch (e) {
        strips[id] = { file: path.relative(ROOT, file).split(path.sep).join('/'), error: e.message };
      }
    }
  }

  // Реестр COMPDAT — полная таблица внутренних имён EWB. Секции заданы якорями,
  // а не жёсткими индексами: границы проверяются по содержимому.
  const sections = sliceRegistry(registry.keys.map((k) => k.key));

  const categories = table.bins.map((bin) => {
    const strip = strips[bin.strips.ansi];
    // Первые 13 записей PartsBin — вкладки в порядке WEWBMSG.RES; записи 14..17
    // (3014–3017) — ленты иконок для диалогов библиотек, своей вкладки нет.
    const name = bin.index <= 13 ? (categoryNames[bin.index] || null) : null;
    return {
      index: bin.index,
      id: `strip-${bin.strips.ansi}`,
      name,
      role: name ? 'palette-tab' : 'library-icons',
      strip: bin.strips.ansi,
      strips: bin.strips,
      tiles: bin.tiles,
      flags: bin.flags,
      // Сколько плиток реально нарезается в ленте (для 3012 ширина не кратна 24).
      stripTiles: strip && !strip.error ? strip.tiles.length : null,
      tilesMatch: strip && !strip.error ? strip.tiles.length === bin.tiles : null,
    };
  });

  const byPartNum = {};
  for (const rec of library) {
    if (!byPartNum[rec.partNum]) byPartNum[rec.partNum] = [];
    byPartNum[rec.partNum].push(rec.modelClass || null);
  }

  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    generator: 'tools/palette-extract.mjs',
    sources: {
      exe: { file: path.relative(ROOT, exePath).split(path.sep).join('/'), sha256: sha256(exe), bytes: exe.length },
      compdat: { file: path.relative(ROOT, compdatPath).split(path.sep).join('/'), sha256: sha256(compdat), bytes: compdat.length },
      res: { file: path.relative(ROOT, resPath).split(path.sep).join('/'), sha256: sha256(res), bytes: res.length },
      msg: { file: path.relative(ROOT, msgPath).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(msgPath)), bytes: fs.statSync(msgPath).size },
    },
    locations: {
      partsBinFileOffset: table.fileOffset,
      styleRegistryFileOffset: registry.fileOffset,
      resCatalogFileOffset: container.fileOffset,
      ewbaLa: { offset: libEntry.offset, size: libEntry.size },
      ewbdLd: dinEntry ? { offset: dinEntry.offset, size: dinEntry.size } : null,
    },
    categories,
    categoryNames,
    strips,
    registry: {
      fileOffset: registry.fileOffset,
      keys: registry.keys,
      sections,
    },
    partNames,
    symbolLayouts: symbolSources,
    library: {
      ansi: library,
      din: dinLibrary,
      classesByPartNum: byPartNum,
    },
  };
}

export function toMarkdown(palette) {
  const lines = [];
  lines.push('| # | категория | ANSI-лента | иконка | toolbar | DIN | плиток (count) | плиток (лента) | совпало |');
  lines.push('|---:|:--|---:|---:|---:|---:|---:|---:|:--:|');
  for (const c of palette.categories) {
    lines.push(
      `| ${c.index} | ${c.name || '—'} | ${c.strip} | ${c.strips.icon} | ${c.strips.toolbar} | ${c.strips.din} | ` +
      `${c.tiles} | ${c.stripTiles ?? '—'} | ${c.tilesMatch == null ? '—' : c.tilesMatch ? 'да' : '**нет**'} |`,
    );
  }
  return lines.join('\n');
}

// --- CLI -------------------------------------------------------------------

function main(argv) {
  const args = new Set(argv.slice(2));
  const palette = buildPalette();
  if (args.has('--md')) {
    process.stdout.write(toMarkdown(palette) + '\n');
    return;
  }
  const json = JSON.stringify(palette, null, 2) + '\n';
  if (args.has('--stdout')) {
    process.stdout.write(json);
    return;
  }
  fs.writeFileSync(DEFAULT_OUT, json);
  const match = palette.categories.filter((c) => c.tilesMatch === true).length;
  const mismatch = palette.categories.filter((c) => c.tilesMatch === false).length;
  console.log(`записано: ${path.relative(ROOT, DEFAULT_OUT)}`);
  console.log(`категорий: ${palette.categories.length}, плитки совпали: ${match}, не совпали: ${mismatch}`);
  console.log(`ключей в реестре: ${palette.registry.keys.length} (секций: ${palette.registry.sections.length}), имён PartNum: ${palette.partNames.length}, C-записей: ${palette.library.ansi.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv);
  } catch (e) {
    console.error(`palette-extract: ${e.message}`);
    process.exit(1);
  }
}
