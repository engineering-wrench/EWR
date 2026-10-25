#!/usr/bin/env node
// PE32/PE32+ export dumper. Выводит функции экспорта DLL/EXE.
// Использование: node pe-exports.mjs <файл> [--flat]
import fs from 'fs';

const FILE_ALIGN = 0x200;

function align(x, a) { return Math.floor((x + a - 1) / a) * a; }

function readSections(fd, peOff) {
    const buf = Buffer.alloc(0x500);
    fs.readSync(fd, buf, 0, 0x500, peOff + 4); // COFF header
    const nsec = buf.readUInt16LE(2);
    const optSize = buf.readUInt16LE(16);
    const opt = Buffer.alloc(optSize);
    fs.readSync(fd, opt, 0, optSize, peOff + 4 + 20);
    const is64 = opt.readUInt16LE(0) === 0x20b;
    const exportRVA = is64 ? opt.readUInt32LE(112) : opt.readUInt32LE(96);
    const exportSize = is64 ? opt.readUInt32LE(116) : opt.readUInt32LE(100);
    const sections = [];
    const secStart = peOff + 4 + 20 + optSize;
    for (let i = 0; i < nsec; i++) {
        const s = Buffer.alloc(40);
        fs.readSync(fd, s, 0, 40, secStart + i * 40);
        sections.push({
            name: s.toString('ascii', 0, 8).replace(/\0.*$/, ''),
            vsize: s.readUInt32LE(8),
            vaddr: s.readUInt32LE(12),
            psize: s.readUInt32LE(16),
            paddr: s.readUInt32LE(20),
        });
    }
    return { sections, exportRVA, exportSize, is64, imageBase: is64 ? opt.readBigUInt64LE(24) : BigInt(opt.readUInt32LE(28)) };
}

function rvaToOff(sections, rva) {
    for (const s of sections) {
        if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.psize)) {
            return s.paddr + (rva - s.vaddr);
        }
    }
    return -1;
}

function cstr(buf) {
    let end = 0;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('latin1', 0, end);
}

function parseExports(fd, sections, exportRVA, exportSize) {
    if (!exportRVA) return null;
    const off = rvaToOff(sections, exportRVA);
    if (off < 0) return null;
    const dir = Buffer.alloc(40);
    fs.readSync(fd, dir, 0, 40, off);
    const nFuncs = dir.readUInt32LE(20);
    const nNames = dir.readUInt32LE(24);
    const funcsRVA = dir.readUInt32LE(28);
    const namesRVA = dir.readUInt32LE(32);
    const ordsRVA = dir.readUInt32LE(36);
    const dllNameOff = rvaToOff(sections, dir.readUInt32LE(12));
    let dllName = '?';
    if (dllNameOff >= 0) {
        const nb = Buffer.alloc(256);
        fs.readSync(fd, nb, 0, 256, dllNameOff);
        dllName = cstr(nb);
    }

    const out = [];
    const namesOff = rvaToOff(sections, namesRVA);
    const ordsOff = rvaToOff(sections, ordsRVA);
    const u32 = (pos) => { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, pos); return b.readUInt32LE(0); };
    const u16 = (pos) => { const b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, pos); return b.readUInt16LE(0); };
    for (let i = 0; i < nNames && i < 4096; i++) {
        const nameRVA = u32(namesOff + i * 4);
        const ord = u16(ordsOff + i * 2);
        const noff = rvaToOff(sections, nameRVA);
        let name = '?';
        if (noff >= 0) {
            const nb = Buffer.alloc(512);
            fs.readSync(fd, nb, 0, 512, noff);
            name = cstr(nb);
        }
        const foff = rvaToOff(sections, funcsRVA + ord * 4);
        const fnRVA = foff >= 0 ? u32(foff) : 0;
        out.push({ name, ord, rva: fnRVA });
    }
    return { dllName, exports: out };
}

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flat = process.argv.includes('--flat');
for (const file of files) {
    const fd = fs.openSync(file, 'r');
    const hdr = Buffer.alloc(0x100);
    fs.readSync(fd, hdr, 0, 0x100, 0);
    if (hdr.readUInt16LE(0) !== 0x5a4d) { console.error(`${file}: не PE`); continue; }
    const peOff = hdr.readUInt32LE(0x3c);
    const { sections, exportRVA, exportSize } = readSections(fd, peOff);
    const exp = parseExports(fd, sections, exportRVA, exportSize);
    if (!exp || !exp.exports.length) {
        console.log(`== ${file}: экспортов нет (или нет таблицы экспорта)`);
    } else {
        console.log(`== ${file} [${exp.dllName}] (${exp.exports.length} имён)`);
        for (const e of exp.exports) {
            if (flat) console.log(e.name);
            else console.log(`  ord ${String(e.ord).padStart(4)} rva 0x${e.rva.toString(16).padStart(8, '0')}  ${e.name}`);
        }
    }
    fs.closeSync(fd);
}
