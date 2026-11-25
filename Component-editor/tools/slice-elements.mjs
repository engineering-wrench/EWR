#!/usr/bin/env node
// Нарезка исходных BITMAP-полос EWB на отдельные элементы.
//
// Полосы `extracted_assets/BITMAP30xx…33xx_1.bmp` — это горизонтальные
// «ленты» иконок компонентов. Каждая лента состоит из ячеек фиксированной
// ширины (24 px для высоких и 16 px для низких полос); внутри ячейки —
// один символ компонента на сером фоне. Скрипт:
//   1) читает 4-битный BMP и палитру;
//   2) делит полосу на ячейки;
//   3) делает фон прозрачным и кодирует каждую непустую ячейку в PNG;
//   4) собирает `elements/index.json` для галереи Component-editor.
//
// Запуск:  node Component-editor/tools/slice-elements.mjs
// Требуется только Node >= 18 (без внешних зависимостей).

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');            // Component-editor/
const REPO = resolve(PROJECT, '..');            // корень репозитория
const SRC_DIR = join(REPO, 'extracted_assets');
const OUT_DIR = join(PROJECT, 'elements');
const PNG_DIR = join(OUT_DIR, 'png');

// Какие ленты считаем «компонентными». 28xx/29xx — иконки меню, 298x — баннеры.
const STRIP_RE = /^BITMAP(3[0-3]\d\d)_1\.bmp$/;

// ---------- BMP ----------

/** Читает 4/8-битный Windows BMP. Возвращает {w,h,bpp,palette,pixels,transparent}. */
export function decodeBmp(buf) {
    if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('не BMP');
    const offset = buf.readUInt32LE(10);
    const headerSize = buf.readUInt32LE(14);
    const w = buf.readInt32LE(18);
    const h = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    const colorsUsed = buf.readUInt32LE(46) || (1 << bpp);
    if (bpp !== 4 && bpp !== 8) throw new Error('поддерживаются только 4/8 bpp, получено ' + bpp);

    const palette = [];
    for (let i = 0; i < colorsUsed; i++) {
        const p = 14 + headerSize + i * 4;
        palette.push([buf[p + 2], buf[p + 1], buf[p]]); // BMP хранит BGR
    }

    const stride = Math.ceil((w * bpp) / 32) * 4;
    const height = Math.abs(h);
    const rows = [];
    for (let y = 0; y < height; y++) {
        const row = new Uint16Array(w);
        const base = offset + stride * y;
        for (let x = 0; x < w; x++) {
            const byte = buf[base + ((x * bpp) >> 3)];
            if (bpp === 4) row[x] = x % 2 === 0 ? (byte >> 4) : (byte & 0x0f);
            else row[x] = byte;
        }
        rows.push(row);
    }
    if (h > 0) rows.reverse(); // BMP снизу вверх

    // Фон — самый частый цвет полосы (обычно #C0C0C0). Его делаем прозрачным.
    const freq = new Uint32Array(colorsUsed);
    for (const row of rows) for (const v of row) freq[v]++;
    let transparent = 0;
    for (let i = 1; i < colorsUsed; i++) if (freq[i] > freq[transparent]) transparent = i;

    return { w, height, bpp, palette, pixels: rows, transparent };
}

/** Ширина ячейки: 24 px для высоких лент, 16 px для низких. */
export function cellWidth(w, h) {
    const nominal = h >= 20 ? 24 : 16;
    const count = Math.max(1, Math.round(w / nominal));
    return w / count;
}

/**
 * Режет декодированный BMP на ячейки.
 * Возвращает массив {x,y,w,h,pixels:[Uint8Array RGBA]} только для непустых ячеек.
 */
export function sliceStrip(bmp) {
    const cw = cellWidth(bmp.w, bmp.height);
    const count = Math.round(bmp.w / cw);
    const cells = [];
    for (let i = 0; i < count; i++) {
        const x0 = Math.round(i * cw);
        const x1 = Math.round((i + 1) * cw);
        const cwPx = x1 - x0;
        const rgba = new Uint8Array(cwPx * bmp.height * 4);
        let hasInk = false;
        for (let y = 0; y < bmp.height; y++) {
            for (let x = 0; x < cwPx; x++) {
                const idx = bmp.pixels[y][x0 + x];
                const [r, g, b] = bmp.palette[idx] || [0, 0, 0];
                const o = (y * cwPx + x) * 4;
                if (idx === bmp.transparent) {
                    rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0;
                } else {
                    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
                    hasInk = true;
                }
            }
        }
        if (hasInk) cells.push({ x: x0, y: 0, w: cwPx, h: bmp.height, pixels: rgba });
    }
    return cells;
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

/** Кодирует RGBA-пиксели в PNG (без зависимостей). */
export function encodePng(width, height, rgba) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        const row = y * (width * 4 + 1);
        raw[row] = 0; // filter: none
        Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, row + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ---------- сборка ----------

export function stripFileName(file) {
    const m = STRIP_RE.exec(file);
    return m ? m[1] : null;
}

export async function buildIndex(files, readFileFn) {
    const entries = [];
    for (const file of files.sort()) {
        const strip = stripFileName(file);
        if (!strip) continue;
        const bmp = decodeBmp(await readFileFn(join(SRC_DIR, file)));
        const cells = sliceStrip(bmp);
        cells.forEach((cell, i) => {
            const id = 'ewb-' + strip + '-' + String(i + 1).padStart(2, '0');
            entries.push({
                id,
                strip: 'BITMAP' + strip,
                group: '30xx–33xx',
                index: i + 1,
                icon: `png/${strip}/${String(i + 1).padStart(2, '0')}.png`,
                symbol: `svg/${strip}/${String(i + 1).padStart(2, '0')}.svg`,
                file: `png/${strip}/${String(i + 1).padStart(2, '0')}.png`,
                width: cell.w,
                height: cell.h,
                source: `extracted_assets/BITMAP${strip}_1.bmp`,
                description: '',
                _cell: cell,
            });
        });
    }
    return entries;
}

/**
 * Оборачивает растровую иконку в стартовый SVG-элемент.
 * PNG встраивается как data-URI: SVG остаётся самодостаточным и корректно
 * загружается браузером как <img> (внешние ссылки в SVG-как-картинке
 * Chrome не подгружает). Пользователь обводит иконку и экспортирует уже
 * настоящий векторный symbol.svg.
 */
export function wrapPngInSvg(width, height, png) {
    const b64 = Buffer.from(png).toString('base64');
    const href = 'data:image/png;base64,' + b64;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
        `<image href="${href}" xlink:href="${href}" ` +
        `width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>\n`;
}

async function main() {
    if (!existsSync(SRC_DIR)) {
        console.error('Нет папки extracted_assets/ — исходники EWB не найдены.');
        process.exit(1);
    }
    const files = (await import('node:fs')).readdirSync(SRC_DIR).filter(f => STRIP_RE.test(f));
    if (!files.length) {
        console.error('Не найдено BITMAP-полос 30xx–33xx в extracted_assets/.');
        process.exit(1);
    }

    await rm(OUT_DIR, { recursive: true, force: true });
    const entries = await buildIndex(files, readFile);
    for (const e of entries) {
        const png = encodePng(e.width, e.height, e._cell.pixels);
        // Пара «иконка (PNG) + элемент в редакторе (SVG)» на каждый элемент.
        const pngPath = join(OUT_DIR, e.icon);
        const svgPath = join(OUT_DIR, e.symbol);
        await mkdir(dirname(pngPath), { recursive: true });
        await mkdir(dirname(svgPath), { recursive: true });
        await writeFile(pngPath, png);
        // Самодостаточный SVG: PNG встроен в data-URI (работает как <img>).
        await writeFile(svgPath, wrapPngInSvg(e.width, e.height, png));
        delete e._cell;
    }
    await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: 'extracted_assets/BITMAP30xx–33xx_1.bmp',
        count: entries.length,
        elements: entries,
    }, null, 2) + '\n');

    const strips = new Set(entries.map(e => e.strip));
    console.log(`Готово: ${entries.length} элементов из ${strips.size} полос → ${OUT_DIR}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(err => { console.error(err); process.exit(1); });
}
