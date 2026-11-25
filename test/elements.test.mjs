// Тесты нарезки исходных BITMAP-полос на элементы (Component-editor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBmp, sliceStrip, cellWidth, encodePng, wrapPngInSvg } from '../Component-editor/tools/slice-elements.mjs';

function makeBmp(w, h) {
    const headerSize = 40;
    const paletteSize = 16 * 4;
    const offset = 14 + headerSize + paletteSize;
    const stride = Math.ceil((w * 4) / 32) * 4;
    const buf = Buffer.alloc(offset + stride * h);
    buf.write('BM', 0, 'latin1');
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(offset, 10);
    buf.writeUInt32LE(headerSize, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(4, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(stride * h, 34);
    buf.writeUInt32LE(16, 46); // colorsUsed

    // Палитра: 0 — чёрный, 7 — серый фон (по умолчанию), 15 — белый.
    for (let i = 0; i < 16; i++) {
        const p = 14 + headerSize + i * 4;
        const v = i === 7 ? 192 : i === 15 ? 255 : 0;
        buf[p] = v; buf[p + 1] = v; buf[p + 2] = v;
    }
    // Заливаем всё фоном (индекс 7).
    for (let y = 0; y < h; y++) {
        const base = offset + stride * y;
        for (let x = 0; x < w; x += 2) {
            buf[base + x / 2] = 0x77;
        }
    }
    return { buf, offset, stride, w, h };
}

function setPixel(meta, x, y, idx) {
    const { buf, offset, stride, h } = meta;
    const base = offset + stride * (h - 1 - y); // BMP снизу вверх
    const byte = base + (x >> 1);
    if (x % 2 === 0) buf[byte] = (buf[byte] & 0x0f) | (idx << 4);
    else buf[byte] = (buf[byte] & 0xf0) | idx;
}

test('cellWidth: 24 px для высоких полос, 16 px для низких', () => {
    assert.equal(cellWidth(552, 24), 24);
    assert.equal(cellWidth(368, 16), 16);
    assert.equal(cellWidth(75, 24), 25); // три ячейки по 25 px
});

test('decodeBmp + sliceStrip: режет полосу на ячейки и пропускает пустые', () => {
    const meta = makeBmp(48, 24);
    setPixel(meta, 2, 3, 0);
    setPixel(meta, 3, 4, 0);
    // Вторая ячейка (x >= 24) остаётся полностью фоном.

    const bmp = decodeBmp(meta.buf);
    assert.equal(bmp.w, 48);
    assert.equal(bmp.height, 24);
    assert.equal(bmp.transparent, 7); // самый частый цвет — серый фон

    const cells = sliceStrip(bmp);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].w, 24);
    assert.equal(cells[0].h, 24);

    // Угол пустой → прозрачный, пиксель с «чернилами» → непрозрачный чёрный.
    assert.equal(cells[0].pixels[3], 0);
    const p = (3 * 24 + 2) * 4;
    assert.deepEqual(Array.from(cells[0].pixels.slice(p, p + 4)), [0, 0, 0, 255]);
});

test('encodePng: сигнатура PNG и размеры в IHDR', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    const png = encodePng(4, 4, rgba);
    assert.deepEqual(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 4);
    assert.equal(png.readUInt32BE(20), 4);
});

test('wrapPngInSvg: SVG-элемент содержит встроенную PNG-иконку', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const svg = wrapPngInSvg(24, 24, png);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /<image href="data:image\/png;base64,iVBORw=="/);
});
