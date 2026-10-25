// Кодек EWB для браузера: декодирование .ewb (Type 1 и Type 2) и КОДИРОВАНИЕ
// в Type 1 (для сохранения). Порт tools/ewb2txt.mjs на Uint8Array (без Node API),
// поэтому работает и в браузере, и в Node (тесты).
//
//   decode(u8)   -> текстовая сериализация (latin1)
//   encodeType1(text) -> Uint8Array (валидный .ewb Type 1)
//
// Точность декодера сверялась с tools/ewb2txt.mjs (см. test/ewb-codec.test.mjs).

const EGG = latin1Bytes('In the Big Inning, the Jays hit a homer'); // 40 байт

function latin1Bytes(str) {
    const u = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xff;
    return u;
}
function toLatin1(u8, start = 0, end = u8.length) {
    let s = '';
    const step = 0x8000;
    for (let i = start; i < end; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + step, end)));
    return s;
}
const rU32 = (b, i) => ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0);
const wU32 = (b, i, v) => { b[i] = v & 0xff; b[i + 1] = (v >>> 8) & 0xff; b[i + 2] = (v >>> 16) & 0xff; b[i + 3] = (v >>> 24) & 0xff; };

// --- заголовок ----------------------------------------------------------
export function parseHeader(data) {
    let i = 0;
    const lines = [];
    while (i < data.length) {
        const j = data.indexOf(0x0a, i);
        if (j < 0) break;
        let line = toLatin1(data, i, j);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lines.push(line);
        if (line.startsWith('UsingVectorGraphics')) {
            const hdr = lines.join('\n');
            const m = hdr.match(/EncryptionType:\s*(\d+)/);
            return { type: m ? +m[1] : NaN, bodyStart: j + 1, header: hdr };
        }
        i = j + 1;
    }
    return { type: NaN, bodyStart: -1, header: '' };
}

// --- Type 1 ---
function eggDword(roll) {
    return ((EGG[roll] | (EGG[roll + 1] << 8) | (EGG[roll + 2] << 16) | (EGG[roll + 3] << 24)) >>> 0);
}
function xorChunk(buf, param3) {
    let roll = 0;
    for (let i = 0; i + 4 <= buf.length; i += 4) {
        let d = (rU32(buf, i) ^ param3) >>> 0;
        d = (d ^ eggDword(roll)) >>> 0;
        wU32(buf, i, d);
        if (++roll > 0x24) roll = 0;
    }
    return buf;
}
function reverseBytes(buf) {
    let a = 0; let b = buf.length - 1;
    while (a < b) { const t = buf[a]; buf[a] = buf[b]; buf[b] = t; a++; b--; }
    return buf;
}

export function decodeType1Body(data, bodyStart) {
    const fileSize = data.length;
    const out = [];
    let pos = bodyStart;
    let lineLen = ((data.length - bodyStart) % 66) || 66;
    while (pos < data.length) {
        const end = Math.min(pos + lineLen, data.length);
        const n = end - pos;
        if (n <= 2) break;
        let contentLen = n;
        if (data[end - 1] === 0x0a) contentLen--;
        if (data[pos + contentLen - 1] === 0x0d) contentLen--;
        const chunk = new Uint8Array(Math.floor(contentLen / 2));
        let k = 0;
        for (let u = 0; u + 1 < contentLen; u += 2) chunk[k++] = (((data[pos + u] - 0x41) << 4) | (data[pos + u + 1] - 0x41)) & 0xff;
        xorChunk(chunk, fileSize);
        reverseBytes(chunk);
        out.push(chunk);
        pos += n;
        lineLen = 66;
    }
    return concatU8(out);
}

// Кодирование в Type 1: inverse декодеру Каирхова (своя проверка — тест round-trip).
export function encodeType1(text, meta = {}) {
    const bodyPlain = latin1Bytes(text);
    const headerText =
        'Electronics Workbench Circuit File\r\n' +
        'Version: 5\r\n' +
        'Charset: ANSI\r\n' +
        'Description: \r\n"" \r\n' +
        `EncryptionType: ${meta.type || 1}\r\n` +
        `UsingVectorGraphics: ${meta.vector ? 1 : 0}\r\n`;
    const header = latin1Bytes(headerText);
    const L = bodyPlain.length;
    const R = L % 32;
    const full = Math.floor(L / 32);
    // фрагменты: сначала остаток R байт, затем полные блоки по 32
    const segs = [];
    let off = 0;
    if (R > 0) { segs.push(bodyPlain.subarray(0, R)); off = R; }
    for (let b = 0; b < full; b++) segs.push(bodyPlain.subarray(off + b * 32, off + b * 32 + 32));

    const lineBytes = segs.map((s) => 2 * s.length + 2); // контент + CRLF
    const bodyLen = lineBytes.reduce((a, b) => a + b, 0);
    const fileSize = header.length + bodyLen;
    const parts = [header];
    for (const s of segs) {
        const c = Uint8Array.from(s);      // копия фрагмента
        reverseBytes(c);                   // decode делает reverse строки — кодируем reverse
        xorChunk(c, fileSize);             // decode делает xor (self-inverse)
        // ниббл-кодирование: 2 символа 'A'+hi,'A'+lo на байт
        const chars = new Uint8Array(2 * c.length);
        for (let i = 0; i < c.length; i++) { chars[2 * i] = 0x41 + (c[i] >> 4); chars[2 * i + 1] = 0x41 + (c[i] & 0xf); }
        parts.push(chars, latin1Bytes('\r\n'));
    }
    return concatU8(parts);
}

// --- Type 2 (сжатый) ----------------------------------------------------
const T_LEN = [0x03, 0x02, 0x03, 0x03, 0x04, 0x04, 0x04, 0x05, 0x05, 0x05, 0x05, 0x06, 0x06, 0x06, 0x07, 0x07];
const T_CODE = [0x05, 0x03, 0x01, 0x06, 0x0a, 0x02, 0x0c, 0x14, 0x04, 0x18, 0x08, 0x30, 0x10, 0x20, 0x40, 0x00];
const T_EXTRA = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
const T_BASE = [0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0x05, 0x00, 0x06, 0x00, 0x07, 0x00, 0x08, 0x00, 0x0a, 0x00, 0x0e, 0x00, 0x16, 0x00, 0x26, 0x00, 0x46, 0x00, 0x86, 0x00, 0x06, 0x01];
const D_LEN = [0x02, 0x04, 0x04, 0x05, 0x05, 0x05, 0x05, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08];
const D_CODE = [0x03, 0x0d, 0x05, 0x19, 0x09, 0x11, 0x01, 0x3e, 0x1e, 0x2e, 0x0e, 0x36, 0x16, 0x26, 0x06, 0x3a, 0x1a, 0x2a, 0x0a, 0x32, 0x12, 0x22, 0x42, 0x02, 0x7c, 0x3c, 0x5c, 0x1c, 0x6c, 0x2c, 0x4c, 0x0c, 0x74, 0x34, 0x54, 0x14, 0x64, 0x24, 0x44, 0x04, 0x78, 0x38, 0x58, 0x18, 0x68, 0x28, 0x48, 0x08, 0xf0, 0x70, 0xb0, 0x30, 0xd0, 0x50, 0x90, 0x10, 0xe0, 0x60, 0xa0, 0x20, 0xc0, 0x40, 0x80, 0x00];

function buildFastTable(count, lengths, codes) {
    const table = new Uint8Array(256).fill(0xff);
    for (let i = count - 1; i >= 0; i--) {
        const len = lengths[i]; const code = codes[i];
        let v = code;
        do { table[v] = i; v += (1 << len); } while (v < 0x100);
    }
    return table;
}

class Inflate {
    constructor(data) {
        this.data = data;
        this.type = data[0];
        this.width = data[1];
        this.avail = 0;
        this.inpos = 3;
        this.inend = data.length;
        this.acc = data[2] & 0xff;
        this.out = new Uint8Array(0x40000);
        this.outPos = 0x1000;
        this.result = [];
        this.tSym = buildFastTable(16, T_LEN, T_CODE);
        this.dTab = buildFastTable(64, D_LEN, D_CODE);
        this.mask = (0xffff >> (16 - this.width)) & 0xffff;
    }
    readBits(n) {
        if (this.avail < n) {
            this.acc >>>= this.avail;
            if (this.inpos >= this.inend) return 1;
            this.acc |= (this.data[this.inpos] & 0xff) << 8;
            this.inpos++;
            this.acc >>>= (n - this.avail);
            this.avail = 8 - (n - this.avail);
        } else { this.acc >>>= n; this.avail -= n; }
        return 0;
    }
    token() {
        if ((this.acc & 1) === 0) {
            if (this.readBits(1) !== 0) return 0x306;
            if (this.type === 0) { const v = this.acc & 0xff; if (this.readBits(8) !== 0) return 0x306; return v; }
            return 0x306;
        }
        if (this.readBits(1) !== 0) return 0x306;
        const sym = this.tSym[this.acc & 0xff];
        if (this.readBits(T_LEN[sym]) !== 0) return 0x306;
        if (T_EXTRA[sym] !== 0) {
            const extra = T_EXTRA[sym];
            const val = ((1 << extra) - 1) & this.acc;
            if (this.readBits(extra) !== 0 && val + sym !== 0x10e) return 0x306;
            return val + (T_BASE[sym * 2] | (T_BASE[sym * 2 + 1] << 8)) + 0x100;
        }
        return sym + 0x100;
    }
    dist(lengthCode) {
        const sym = this.dTab[this.acc & 0xff];
        if (this.readBits(D_LEN[sym]) !== 0) return 0;
        let v;
        if (lengthCode === 2) { v = (sym << 2) | (this.acc & 3); if (this.readBits(2) !== 0) return 0; }
        else { v = (sym << this.width) | (this.acc & this.mask); if (this.readBits(this.width) !== 0) return 0; }
        return v + 1;
    }
    flush() { const n = this.outPos - 0x1000; if (n > 0) this.result.push(Uint8Array.from(this.out.subarray(0x1030, 0x30 + this.outPos))); }
    run() {
        for (;;) {
            const tok = this.token();
            if (tok > 0x304) { this.flush(); return tok; }
            if (tok < 0x100) { this.out[0x30 + this.outPos++] = tok; }
            else {
                const len = tok - 0xfe;
                const d = this.dist(len);
                if (d === 0) { this.flush(); return 0x306; }
                const src = 0x30 + this.outPos - d; const dst = 0x30 + this.outPos;
                for (let k = 0; k < len; k++) this.out[dst + k] = this.out[src + k];
                this.outPos += len;
            }
            if (this.outPos > 0x1fff) {
                this.result.push(Uint8Array.from(this.out.subarray(0x1030, 0x30 + 0x1000)));
                this.out.copyWithin(0x30, 0x1030, 0x30 + this.outPos);
                this.outPos -= 0x1000;
            }
        }
    }
}

export function splitType2Sections(data, bodyStart) {
    const body = data.subarray(bodyStart + 1); // bodyStart указывает на '/'
    const chars = [];
    for (const b of body) { if (b === 0x0a || b === 0x0d) continue; chars.push(b); }
    const sections = [];
    let i = 0;
    while (i < chars.length) {
        const bytes = [];
        let broke = false;
        while (i + 1 < chars.length) {
            const c1 = chars[i]; const c2 = chars[i + 1];
            if (c1 === 0x21 || c1 === 0x24) { i++; broke = true; break; }
            bytes.push(((c1 - 0x30) << 3) | (((c2 - 0x30) & 0xff) >> 2));
            i += 2;
        }
        if (broke && bytes.length === 0) break;
        if (bytes.length > 0 || broke) sections.push(Uint8Array.from(bytes));
        if (!broke) break;
    }
    return { sections };
}

function decodeType2Body(data, bodyStart) {
    const { sections } = splitType2Sections(data, bodyStart);
    const raws = [];
    for (const sec of sections) { const inf = new Inflate(sec); inf.run(); raws.push(concatU8(inf.result)); }
    return concatU8(raws);
}

function concatU8(arrs) {
    let total = 0; for (const a of arrs) total += a.length;
    const r = new Uint8Array(total); let o = 0;
    for (const a of arrs) { r.set(a, o); o += a.length; }
    return r;
}

// --- Публичный декодер --------------------------------------------------
export function decode(arrayOrBytes) {
    const data = arrayOrBytes instanceof Uint8Array ? arrayOrBytes : new Uint8Array(arrayOrBytes);
    const h = parseHeader(data);
    const raw = h.type === 1 ? decodeType1Body(data, h.bodyStart)
        : h.type === 2 ? decodeType2Body(data, h.bodyStart)
            : new Uint8Array(0);
    return toLatin1(raw);
}

export function decodeBytes(arrayOrBytes) {
    const data = arrayOrBytes instanceof Uint8Array ? arrayOrBytes : new Uint8Array(arrayOrBytes);
    const h = parseHeader(data);
    return h.type === 1 ? decodeType1Body(data, h.bodyStart) : decodeType2Body(data, h.bodyStart);
}

export default { decode, decodeBytes, encodeType1, parseHeader };
