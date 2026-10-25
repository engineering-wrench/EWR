#!/usr/bin/env node
// EWB 5.x -> текстовая сериализация (raw). Поддерживает EncryptionType 1 и 2.
// Использование:
//   node ewb2txt.mjs <файл.ewb> [выход.ewb.txt]
//   node ewb2txt.mjs --info <файл.ewb>    (секции и проверка контрольной суммы)
//   node ewb2txt.mjs --dir <папка>        (декодировать все *.ewb/*.EWB)
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const EGG = Buffer.from('In the Big Inning, the Jays hit a homer', 'latin1');

// --- Парсер заголовка (построчный; описание может быть многострочным) ---
// Возвращает { type, bodyStart, header } либо null.
export function parseHeader(data) {
    let i = 0;
    const lines = [];
    while (i < data.length) {
        const j = data.indexOf(0x0a, i);
        if (j < 0) break;
        let line = data.subarray(i, j).toString('latin1');
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

function xorChunk(buf, param3) {
    let roll = 0, i = 0;
    for (; i + 4 <= buf.length; i += 4) {
        let d = buf.readUInt32LE(i) ^ param3;
        d ^= EGG.readUInt32LE(roll);
        buf.writeUInt32LE(d >>> 0, i);
        if (++roll > 0x24) roll = 0;
    }
    return buf;
}
function reverseBytes(buf) {
    let a = 0, b = buf.length - 1;
    while (a < b) { const t = buf[a]; buf[a] = buf[b]; buf[b] = t; a++; b--; }
    return buf;
}

function decodeType1(data) {
    const h = parseHeader(data);
    return h.bodyStart < 0 ? Buffer.alloc(0) : decodeType1Body(data, h.bodyStart);
}

function decodeType1Body(data, bodyStart) {
    const fileSize = data.length;
    const out = [];
    let pos = bodyStart;
    let lineLen = ((data.length - bodyStart) % 66) || 66;
    while (pos < data.length) {
        const line = data.subarray(pos, Math.min(pos + lineLen, data.length));
        const n = line.length;
        if (n <= 2) break;
        let contentLen = n;
        if (line[n - 1] === 0x0a) contentLen--;
        if (line[contentLen - 1] === 0x0d) contentLen--;
        const chunk = Buffer.alloc(Math.floor(contentLen / 2));
        let j = 0;
        for (let u = 0; u + 1 < contentLen; u += 2) {
            chunk[j++] = (((line[u] - 0x41) << 4) | (line[u + 1] - 0x41)) & 0xff;
        }
        xorChunk(chunk, fileSize);
        reverseBytes(chunk);
        out.push(chunk);
        pos += n;
        lineLen = 66;
    }
    return Buffer.concat(out);
}

const T_LEN = Buffer.from([0x03,0x02,0x03,0x03,0x04,0x04,0x04,0x05,0x05,0x05,0x05,0x06,0x06,0x06,0x07,0x07]);
const T_CODE = Buffer.from([0x05,0x03,0x01,0x06,0x0a,0x02,0x0c,0x14,0x04,0x18,0x08,0x30,0x10,0x20,0x40,0x00]);
const T_EXTRA = Buffer.from([0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08]);
const T_BASE = Buffer.from([0x00,0x00,0x01,0x00,0x02,0x00,0x03,0x00,0x04,0x00,0x05,0x00,0x06,0x00,0x07,0x00,0x08,0x00,0x0a,0x00,0x0e,0x00,0x16,0x00,0x26,0x00,0x46,0x00,0x86,0x00,0x06,0x01]);
const D_LEN = Buffer.from([0x02,0x04,0x04,0x05,0x05,0x05,0x05,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x06,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x07,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08]);
const D_CODE = Buffer.from([0x03,0x0d,0x05,0x19,0x09,0x11,0x01,0x3e,0x1e,0x2e,0x0e,0x36,0x16,0x26,0x06,0x3a,0x1a,0x2a,0x0a,0x32,0x12,0x22,0x42,0x02,0x7c,0x3c,0x5c,0x1c,0x6c,0x2c,0x4c,0x0c,0x74,0x34,0x54,0x14,0x64,0x24,0x44,0x04,0x78,0x38,0x58,0x18,0x68,0x28,0x48,0x08,0xf0,0x70,0xb0,0x30,0xd0,0x50,0x90,0x10,0xe0,0x60,0xa0,0x20,0xc0,0x40,0x80,0x00]);

function buildFastTable(count, lengths, codes) {
    const table = new Uint8Array(256).fill(0xff);
    for (let i = count - 1; i >= 0; i--) {
        const len = lengths[i], code = codes[i];
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
        this.out = Buffer.alloc(0x40000);
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
        } else {
            this.acc >>>= n;
            this.avail -= n;
        }
        return 0;
    }
    token() {
        if ((this.acc & 1) === 0) {
            if (this.readBits(1) !== 0) return 0x306;
            if (this.type === 0) {
                let v = this.acc & 0xff;
                if (this.readBits(8) !== 0) v = 0x306;
                return v;
            }
            return 0x306; // type 1 literals (huffman) — не реализовано
        } else {
            if (this.readBits(1) !== 0) return 0x306;
            const sym = this.tSym[this.acc & 0xff];
            if (this.readBits(T_LEN[sym]) !== 0) return 0x306;
            if (T_EXTRA[sym] !== 0) {
                const extra = T_EXTRA[sym];
                const val = ((1 << extra) - 1) & this.acc;
                const r = this.readBits(extra);
                if ((r !== 0) && ((val + sym) !== 0x10e)) return 0x306;
                return val + T_BASE.readUInt16LE(sym * 2) + 0x100;
            }
            return sym + 0x100;
        }
    }
    dist(lengthCode) {
        const sym = this.dTab[this.acc & 0xff];
        if (this.readBits(D_LEN[sym]) !== 0) return 0;
        let v;
        if (lengthCode === 2) {
            v = (sym << 2) | (this.acc & 3);
            if (this.readBits(2) !== 0) return 0;
        } else {
            v = (sym << this.width) | (this.acc & this.mask);
            if (this.readBits(this.width) !== 0) return 0;
        }
        return v + 1;
    }
    run() {
        let outPos = 0x1000;
        for (;;) {
            const tok = this.token();
            if (tok > 0x304) {
                const n = outPos - 0x1000;
                if (n > 0) this.result.push(Buffer.from(this.out.subarray(0x1030, 0x30 + outPos)));
                return tok;
            }
            if (tok < 0x100) {
                this.out[0x30 + outPos] = tok;
                outPos++;
            } else {
                const len = tok - 0xfe;
                const d = this.dist(len);
                if (d === 0) {
                    const n = outPos - 0x1000;
                    if (n > 0) this.result.push(Buffer.from(this.out.subarray(0x1030, 0x30 + outPos)));
                    return 0x306;
                }
                const src = 0x30 + outPos - d, dst = 0x30 + outPos;
                for (let k = 0; k < len; k++) this.out[dst + k] = this.out[src + k];
                outPos += len;
            }
            if (outPos > 0x1fff) {
                this.result.push(Buffer.from(this.out.subarray(0x1030, 0x30 + 0x1000)));
                this.out.copyWithin(0x30, 0x1030, 0x30 + outPos);
                outPos -= 0x1000;
            }
        }
    }
}

// CRC-32 (отражённая таблица, полином 0xEDB88320). init обычно 0xffffffff.
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
export function crc32(buf, init = 0xffffffff) {
    let c = init >>> 0;
    for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
    return c >>> 0;
}

// Разбор тела Type-2: массив сжатых секций + контрольная сумма.
// bodyStart — позиция '/' (разделитель не входит в тело).
// checksum = XOR по секциям от ~crc32(раскодированных байт секции).
export function splitType2Sections(data, bodyStart) {
    const body = data.subarray(bodyStart + 1);
    const chars = [];
    for (const b of body) {
        if (b === 0x0a || b === 0x0d) continue;
        chars.push(b);
    }
    const sections = [];
    let i = 0;
    while (i < chars.length) {
        const bytes = [];
        let broke = false;
        while (i + 1 < chars.length) {
            const c1 = chars[i], c2 = chars[i + 1];
            if (c1 === 0x21 || c1 === 0x24) { i++; broke = true; break; }
            bytes.push(((c1 - 0x30) << 3) | (((c2 - 0x30) & 0xff) >> 2));
            i += 2;
        }
        if (broke && bytes.length === 0) break;
        if (bytes.length > 0 || broke) sections.push(Buffer.from(bytes));
        if (!broke) break;
    }
    // контрольная сумма после последнего делителя (символы %08lx)
    const tail = Buffer.from(chars.slice(i));
    const fileChecksum = tail.toString('latin1').trim();
    return { sections, fileChecksum };
}

function decodeType2Body(data, bodyStart) {
    const { sections } = splitType2Sections(data, bodyStart);
    const raws = [];
    for (const sec of sections) {
        const inf = new Inflate(sec);
        inf.run();
        raws.push(Buffer.concat(inf.result));
    }
    return Buffer.concat(raws);
}

function decodeType2(data) {
    const h = parseHeader(data);
    return h.bodyStart < 0 ? Buffer.alloc(0) : decodeType2Body(data, h.bodyStart);
}

// Информация о секциях и контрольной сумме (для --info).
export function analyzeType2(data, bodyStart) {
    const { sections, fileChecksum } = splitType2Sections(data, bodyStart);
    const per = [];
    let computed = 0;
    for (const sec of sections) {
        const inf = new Inflate(sec);
        const rc = inf.run();
        const raw = Buffer.concat(inf.result);
        const crc = crc32(raw);
        computed ^= (~crc) & 0xffffffff;
        per.push({ compBytes: sec.length, rawBytes: raw.length, rc, crc: crc >>> 0 });
    }
    return { count: sections.length, per, fileChecksum, computed: computed >>> 0 };
}

// ---- main ----
const __isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (__isMain) {
const args = process.argv.slice(2);
const flagDir = args.includes('--dir');
const flagInfo = args.includes('--info');
const input = args.filter(a => !a.startsWith('--'))[0];

function runOne(file, outPath) {
    const data = fs.readFileSync(file);
    const h = parseHeader(data);
    if (h.type !== 1 && h.type !== 2) {
        console.log(`SKIP ${file}: неизвестный EncryptionType (${isNaN(h.type) ? 'нет' : h.type})`);
        return { ok: false };
    }
    if (flagInfo && h.type === 2) {
        const a = analyzeType2(data, h.bodyStart);
        const okSum = (a.fileChecksum.toLowerCase() === a.computed.toString(16).padStart(8, '0'));
        console.log(`INFO ${file} type=2 sec=${a.count} (${a.per.map(p => `${p.compBytes}:${p.rawBytes}`).join(',')}) checksum=${a.fileChecksum} computed=${a.computed.toString(16).padStart(8, '0')} ${okSum ? 'OK' : 'MISMATCH'}`);
        return { ok: okSum };
    }
    const raw = h.type === 1 ? decodeType1Body(data, h.bodyStart) : decodeType2Body(data, h.bodyStart);
    if (outPath) {
        fs.writeFileSync(outPath, raw);
        console.log(`OK ${file} type=${h.type} -> ${outPath} (${raw.length} байт)`);
    } else {
        process.stdout.write(raw);
    }
    return { ok: true, raw };
}

if (flagDir) {
    if (!input) {
        console.error('usage: node ewb2txt.mjs --dir <папка> [--info]');
        process.exit(1);
    }
    const exts = new Set(['.ewb', '.EWB']);
    const files = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (exts.has(path.extname(e.name))) files.push(p);
        }
    };
    walk(input);
    let ok = 0, skip = 0, bad = 0;
    const outDir = flagInfo ? null : path.join(input, '..', '_dec');
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
    for (const f of files) {
        const outPath = outDir ? path.join(outDir, path.basename(f) + '.txt') : null;
        if (outDir) fs.writeFileSync(outPath, Buffer.alloc(0));
        const r = runOne(f, outPath);
        if (r.ok) ok++; else if (r.ok === false) skip++; else bad++;
    }
    console.log(`\nитого: ${files.length}, OK=${ok}, SKIP=${skip}`);
} else {
    if (!input) {
        console.error('usage: node ewb2txt.mjs [--info] <file.ewb> [out.txt]');
        process.exit(1);
    }
    runOne(input, args[1]);
}
}
