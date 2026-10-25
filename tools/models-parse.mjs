#!/usr/bin/env node
// EWB512/MODELS -> JSON-библиотека моделей; EWB512/WEWB.RES -> встроенная палитра
// деталей и карта PartNum (фаза M в PLAN-CLONE).
//
// Формат источников (текстовые, CRLF):
//   * файлы `*.M<PartNum>` и `*.LIB|*.lib` в MODELS/:
//       P "имя" <PartNum> [числа...]        -- карточка детали библиотеки EWB
//       .MODEL имя тип ( k=v ... )          -- SPICE-модель (с продолжениями `+`)
//       .SUBCKT имя [узлы...] ... .ENDS     -- подцепь/макромодель (может быть пустой)
//   * шапка лицензии: "Electronics Workbench Model File V4.01",
//     "(c) 1995 ...", "Licensed to: \"...\"", "S/N: \"..." + блок строк из
//     букв A..P (закодированные данные лицензированных файлов; декодер — RE,
//     пока фиксируем только метаданные и sha256 файла).
//   * WEWB.RES — текстовый ресурс палитры: `C <PartNum> a b c V=… U=… M="класс" S=…`
//     (встроенные детали: R/C/L/источники/диоды/транзисторы/…).
//
// Использование:
//   node tools/models-parse.mjs                      # собрать Site/engine/models/ewb-models.json
//   node tools/models-parse.mjs --stdout             # то же в stdout (без записи)
//   node tools/models-parse.mjs --coverage           # карта PartNum из CIRCUITS/*.ewb (M4)
//   node tools/models-parse.mjs --coverage --files   # + пофайловая раскладка PartNum
//   node tools/models-parse.mjs --src <папка> --out <файл> [--res <WEWB.RES|--no-res>]
//
// Модуль импортируемый: `buildModelsJson`, `buildPartMap`, `parseWewbRes`,
// `parsePartNames`, `parseSpiceText`, `parsePCard`, `circuitEvidence`,
// `partNumCoverage` (тесты: test/models.test.mjs).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { decode } from '../Site/engine/ewb-codec.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SRC = path.join(ROOT, 'EWB512', 'MODELS');
export const DEFAULT_OUT = path.join(ROOT, 'Site', 'engine', 'models', 'ewb-models.json');
export const DEFAULT_RES = path.join(ROOT, 'EWB512', 'WEWB.RES');
export const FORMAT = 'ewr-ewb-models';
export const FORMAT_VERSION = 2;

/**
 * PartNum, которые встречаются в схемах, но НЕ являются деталями:
 * 39 — служебный элемент-«вывод» (`m_tptrElem "R1^0"`), на который ссылаются
 * провода (`pos i:4 idx pin ...`); в палитре деталей отсутствует.
 * См. `docs/re/engine-parts.md`.
 */
export const SERVICE_PARTNUMS = new Set([39]);

const RE_MFILE = /\.m\d+$/i;
const RE_LIBFILE = /\.lib$/i;
const RE_BLOB = /^[A-P]{16,}$/;
const RE_PCARD = /^P\s+"([^"]*)"\s+(\S+)(.*)$/;

// --- шапка лицензии --------------------------------------------------------------

const HEADER_PATTERNS = [
    ['product', /^Electronics Workbench Model File\s+(V[\d.]+)?/i],
    ['copyright', /^\(c\)\s*(.*)$/i],
    ['licensedTo', /^Licensed to:\s*"?([^"\r\n]*)"?/i],
    ['serial', /^S\/N:\s*"?([^"\r\n]*)"?/i],
];

function parseHeaderLine(line, header) {
    for (const [key, re] of HEADER_PATTERNS) {
        const m = line.match(re);
        if (m) {
            if (header[key] === undefined) header[key] = (m[1] || '').trim();
            return true;
        }
    }
    return false;
}

// --- числовые значения ------------------------------------------------------------

/** Токен SPICE -> число, либо исходная строка (atof-подобно, без суффиксов). */
function tokenValue(tok) {
    const n = Number(tok);
    return Number.isFinite(n) ? n : tok;
}

// --- карточки P ------------------------------------------------------------------

/**
 * `P "имя" <PartNum> [числа...]` -> { name, partNum, params } | null
 * Разделители — пробелы и табуляции; PartNum обязан быть целым.
 */
export function parsePCard(line) {
    const m = line.match(RE_PCARD);
    if (!m) return null;
    const partNum = Number(m[2]);
    if (!Number.isInteger(partNum)) return null;
    const params = m[3].trim() === '' ? [] : m[3].trim().split(/\s+/).map(tokenValue);
    return { name: m[1], partNum, params };
}

// --- карточки .MODEL -------------------------------------------------------------

/**
 * Разобрать карточку `.MODEL` (первая строка + продолжения `+`).
 * Учитывает «слипшиеся» карточки вида `.MODEL DX D(IS=800.0E-18)`.
 * @returns {{name:string,type:string,params:Object}|null}
 */
export function parseModelCard(lines) {
    const text = lines.map(l => l.replace(/^\s*\+\s*/, ' ')).join(' ');
    const m = text.match(/^\.MODEL\s+(\S+)\s+([^\s(]+)\s*(.*)$/i);
    if (!m) return null;
    const params = {};
    const rest = m[3];
    const open = rest.indexOf('(');
    const close = rest.lastIndexOf(')');
    const body = open >= 0 ? rest.slice(open + 1, close >= 0 ? close : undefined) : rest;
    for (const kv of body.split(/\s+(?=[A-Za-z_][\w.]*\s*=)|,/)) {
        const t = kv.trim();
        if (!t) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        const key = t.slice(0, eq).trim();
        const val = t.slice(eq + 1).trim();
        if (key) params[key] = tokenValue(val);
    }
    return { name: m[1], type: m[2], params };
}

// --- разбор текста файла ----------------------------------------------------------

/**
 * Разобрать текст файла MODELS (любой из форматов).
 * @param {string} text
 * @returns {{header:Object, parts:Array, models:Array, subckts:Array, encoded:Object|null,
 *            comments:number}}
 */
export function parseSpiceText(text) {
    const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const header = {};
    const parts = [];
    const models = [];
    const subckts = [];
    let encoded = null;
    let comments = 0;
    const junk = [];
    const quirks = [];

    /**
     * Проход 1: логические строки. EWB-маркер `\x1a` (DOS EOF) работает как разделитель:
     * слева — данные, справа — либо кодированный блок A..P, либо комментарий.
     * Продолжения `+` приклеиваются к предыдущей строке.
     */
    const stmts = [];
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const eof = raw.indexOf('\x1a');
        const data = (eof < 0 ? raw : raw.slice(0, eof)).replace(/\x1a/g, '').trim();
        if (eof >= 0) {
            const t = raw.slice(eof + 1).trim();
            if (RE_BLOB.test(t)) {
                if (!encoded) encoded = { lines: 0, chars: 0, first: t.slice(0, 32) };
                encoded.lines++;
                encoded.chars += t.length;
            } else if (t) {
                comments++;
            }
        }
        if (data === '') continue;
        if (RE_BLOB.test(data)) {
            if (!encoded) encoded = { lines: 0, chars: 0, first: data.slice(0, 32) };
            encoded.lines++;
            encoded.chars += data.length;
            continue;
        }
        if (data.startsWith('*')) { comments++; continue; }
        if (/^\+\s*/.test(raw) && stmts.length) {
            stmts[stmts.length - 1].text += ' ' + data.replace(/^\+\s*/, '');
            continue;
        }
        stmts.push({ line: li + 1, text: data });
    }

    /** Заголовок подцепи (`[.SUBCKT] имя node... [params: k=v]`) -> {name, nodes, params}. */
    const parseSubcktHead = (line) => {
        const head = line.replace(/^\.SUBCKT\b/i, '').trim().split(/\s+/).filter(Boolean);
        const name = head.shift() || '';
        const params = {};
        const nodes = [];
        let inParams = false;
        for (let k = 0; k < head.length; k++) {
            if (/^params:?$/i.test(head[k])) { inParams = true; continue; }
            const eq = head[k].indexOf('=');
            if (inParams && eq > 0) params[head[k].slice(0, eq)] = tokenValue(head[k].slice(eq + 1));
            else if (inParams) { /* значение с пробелом — маловероятно, пропускаем */ }
            else nodes.push(head[k]);
        }
        return { name, nodes, params };
    };

    /**
     * Проход 2: структура. Подцепи открываются `.SUBCKT` и закрываются `.ENDS`;
     * всё между ними — тело подцепи (карточки `.MODEL` внутри остаются в теле).
     * `.ENDS [имя]` без открывающей `.SUBCKT` — глитч оригинальной библиотеки:
     * имя подцепи ищем среди накопленных «свободных» строк (первый токен = имя),
     * остальные строки становятся телом.
     */
    let cur = null;     // открытая подцепь: {head, line}
    let pending = [];   // строки текущего блока (тело подцепи) либо «свободные» строки

    const closeCur = (quirkKind) => {
        if (!cur) return;
        subckts.push({ ...cur.head, body: pending.map(p => p.text), line: cur.line });
        if (quirkKind) quirks.push({ line: cur.line, kind: quirkKind, name: cur.head.name });
        cur = null;
        pending = [];
    };

    for (const s of stmts) {
        const data = s.text;
        if (/^\.SUBCKT\b/i.test(data)) {
            closeCur('subckt-without-ends');
            cur = { head: parseSubcktHead(data), line: s.line };
            continue;
        }
        if (/^\.ENDS\b/i.test(data)) {
            const m = data.match(/^\.ENDS\s+(\S+)?/i);
            const name = m && m[1] ? m[1] : null;
            if (cur) {
                closeCur(null);
                continue;
            }
            const k = name ? pending.findIndex(p => p.text.split(/\s+/)[0].toLowerCase() === name.toLowerCase()) : -1;
            const body = pending.map(p => p.text);
            if (k >= 0) {
                const head = parseSubcktHead(pending[k].text);
                subckts.push({ ...head, body: body.filter((_, idx) => idx !== k), line: s.line });
                quirks.push({ line: s.line, kind: 'missing-subckt-keyword', name: head.name });
            } else if (name) {
                subckts.push({ name, nodes: [], params: {}, body, line: s.line });
                quirks.push({ line: s.line, kind: 'ends-without-subckt', name });
            } else {
                quirks.push({ line: s.line, kind: 'ends-without-subckt', name: '' });
                junk.push(...body);
            }
            pending = [];
            continue;
        }
        if (cur) { pending.push(s); continue; }
        if (data.startsWith('P ') || data.startsWith('P\t')) {
            const p = parsePCard(data);
            if (p) { p.line = s.line; parts.push(p); } else junk.push(data);
            continue;
        }
        if (/^\.MODEL\b/i.test(data)) {
            const m = parseModelCard([data]);
            if (m) { m.fileLine = s.line; models.push(m); } else junk.push(data);
            continue;
        }
        if (parseHeaderLine(data, header)) continue;
        // «свободные» строки: баннер шапки либо тело глитч-подцепи (см. `.ENDS`)
        pending.push(s);
    }
    closeCur('subckt-without-ends');
    if (pending.length) junk.push(...pending.map(p => p.text));

    if (junk.length) (header.other = header.other || []).push(...junk.slice(0, 40).map(s => s.slice(0, 120)));

    return { header, parts, models, subckts, encoded, comments, quirks, junk: junk.length };
}

// --- WEWB.RES: встроенная библиотека деталей (M2) ---------------------------------

const RE_RES_C = /^C\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\b(.*)$/;
const RE_RES_KV = /([VUMSL])=(?:"([^"]*)"|(\S+))/g;

/**
 * Разобрать `EWB512/WEWB.RES` — текстовый ресурс встроенной палитры деталей EWB
 * (бинарная шапка + записи построчно). Наблюдаемые записи:
 *   P "имя" <PartNum> <числа...>       — карточка параметров детали по умолчанию;
 *   C <PartNum> <a> <b> <c> V=… U=… M="класс" S=<0|1> L="метка" [хвост…]
 *       a/b/c — раскладка/класс (RE позже), `S=1` — деталь есть в палитре,
 *       `M` — имя встроенного класса устройства (`diode`,`npn`,`jfet-n`,…), у
 *       примитивов (R/C/L/источники) пусто — класс добирается из схем (M4);
 *   F -1 <…> "<имя>"                   — макро-лицо (например, `+Vcc`).
 * @param {string} text
 * @returns {{cards:Array, parts:Array, macros:string[]}}
 */
export function parseWewbRes(text) {
    const src = text.replace(/\r\n?/g, '\n');
    const cards = [];
    const parts = [];
    const macros = [];
    let line = 0;
    for (const raw of src.split('\n')) {
        line++;
        const t = raw.trim();
        if (t.startsWith('P ')) {
            const p = parsePCard(t);
            if (p) { p.line = line; cards.push(p); }
            continue;
        }
        if (t.startsWith('C ')) {
            const m = t.match(RE_RES_C);
            if (!m) continue;
            const kv = {};
            for (const x of m[5].matchAll(RE_RES_KV)) kv[x[1]] = x[2] !== undefined ? x[2] : x[3];
            // настоящая C-запись всегда несёт V= и U=; бинарный мусор — нет.
            if (kv.V === undefined || kv.U === undefined) continue;
            const rest = m[5].replace(RE_RES_KV, ' ').trim();
            parts.push({
                partNum: Number(m[1]), a: Number(m[2]), b: Number(m[3]), c: Number(m[4]),
                value: kv.V, units: Number(kv.U), model: kv.M || '',
                bin: kv.S === '1', label: kv.L || '',
                extra: rest === '' ? [] : rest.split(/\s+/),
                line,
            });
            continue;
        }
        if (/^F\s/.test(t)) {
            const x = t.match(/"([^"]*)"\s*$/);
            if (x) macros.push(x[1]);
        }
    }
    return { cards, parts, macros };
}

// --- WEWBMSG.RES: имена встроенных деталей (M2) -----------------------------------

export const DEFAULT_MSG = path.join(ROOT, 'EWB512', 'WEWBMSG.RES');

/**
 * Извлечь упорядоченный список имён встроенных деталей из `WEWBMSG.RES`.
 * В ресурсе есть непрерывный блок строк, начинающийся с `"AC Voltage Source"`:
 * индекс строки = PartNum (0..41; `39="Node"` — служебный вывод, 40/41 — шаблоны
 * IC/подцепи). Читаем до `"Subcircuit Template"` включительно.
 * @param {string} text
 * @returns {string[]}
 */
export function parsePartNames(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const start = lines.findIndex(l => l.trim() === '"AC Voltage Source"');
    if (start < 0) return [];
    const names = [];
    for (let i = start; i < lines.length && names.length < 64; i++) {
        const m = lines[i].trim().match(/^"([^"]*)"$/);
        if (!m) break;
        names.push(m[1]);
        if (m[1] === 'Subcircuit Template') break;
    }
    return names;
}

// --- Карта PartNum -> встроенный класс (M2) ---------------------------------------

/**
 * Слить источники знаний о PartNum в одну карту:
 *   * `wewbRes` — встроенная палитра EWB (базовый класс, значения по умолчанию);
 *   * `names` — имена деталей из WEWBMSG.RES (индекс = PartNum);
 *   * `modelFiles` — имена `MODELS/*.M<num>` (семейства моделей);
 *   * `cards` — имена P-карточек MODELS (если файл не закодирован).
 * @param {object} res результат parseWewbRes
 * @param {Array} files fileInfos из buildModelsJson
 * @param {Array} parts P-карточки из buildModelsJson
 * @param {string[]} [names] имена из parsePartNames
 * @returns {Object<string, object>} карта PartNum -> запись
 */
export function buildPartMap(res, files, parts, names = []) {
    const resParts = new Map();
    for (const r of res.parts) {
        const cur = resParts.get(r.partNum);
        // предпочитаем запись из палитры (S=1), затем — первую встреченную
        if (!cur || (r.bin && !cur.bin)) resParts.set(r.partNum, r);
    }
    const mfiles = new Map();
    for (const f of files) {
        if (f.partNum === undefined) continue;
        if (!mfiles.has(f.partNum)) mfiles.set(f.partNum, []);
        mfiles.get(f.partNum).push(f.path);
    }
    const cards = new Map();
    for (const p of parts) {
        if (!cards.has(p.partNum)) cards.set(p.partNum, []);
        cards.get(p.partNum).push(p.name);
    }

    const nums = new Set([...resParts.keys(), ...mfiles.keys(), ...cards.keys(), ...names.keys()]);
    const map = {};
    for (const n of [...nums].sort((a, b) => a - b)) {
        const r = resParts.get(n);
        const entry = {
            partNum: n,
            kind: r ? (r.model || '') : '',
            sources: [],
        };
        if (r) {
            entry.sources.push('wewbres');
            entry.bin = r.bin;
            entry.defaultValue = r.value;
            entry.units = r.units;
            if (r.label) entry.label = r.label;
            if (r.extra.length) entry.extra = r.extra;
        }
        if (names[n] !== undefined && names[n] !== '') { entry.name = names[n]; entry.sources.push('wewbmsg'); }
        if (mfiles.has(n)) { entry.sources.push('mfile'); entry.modelFiles = mfiles.get(n); }
        if (cards.has(n)) { entry.sources.push('pcards'); entry.cardNames = cards.get(n); }
        map[n] = entry;
    }
    return map;
}

// --- обход дерева MODELS ----------------------------------------------------------

/** Рекурсивный обход: отсортированный список относительных путей файлов M-моделей и LIB. */
export function listModelFiles(root) {
    const out = [];
    const walk = (dir, rel) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const abs = path.join(dir, e.name);
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(abs, r);
            else if (RE_MFILE.test(e.name) || RE_LIBFILE.test(e.name)) out.push(r);
        }
    };
    walk(root, '');
    return out;
}

/**
 * Собрать модель библиотеки (детерминированно, без времени генерации).
 * @param {string} root папка MODELS
 * @param {object} [opts]
 * @param {string|null} [opts.resFile] `WEWB.RES` (встроенная палитра); по умолчанию —
 *   соседний с root файл, если существует; `null` — не читать.
 * @returns {object} объект для JSON
 */
export function buildModelsJson(root, opts = {}) {
    const resFile = opts.resFile !== undefined
        ? opts.resFile
        : path.join(path.dirname(root), 'WEWB.RES');
    const msgFile = opts.msgFile !== undefined
        ? opts.msgFile
        : path.join(path.dirname(root), 'WEWBMSG.RES');
    const files = listModelFiles(root);
    const parts = [];
    const models = [];
    const subckts = [];
    const byPartNum = {};
    const byModel = {};
    const bySubckt = {};
    const fileInfos = [];

    for (const rel of files) {
        const abs = path.join(root, rel);
        const buf = fs.readFileSync(abs);
        const parsed = parseSpiceText(buf.toString('latin1'));
        const dir = path.dirname(rel);
        const base = path.basename(rel);
        const mName = base.match(/\.m(\d+)$/i);

        const info = {
            path: rel,
            kind: RE_LIBFILE.test(base) ? 'lib' : 'm',
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            counts: {
                parts: parsed.parts.length,
                models: parsed.models.length,
                subckts: parsed.subckts.length,
            },
        };
        if (dir !== '.') info.family = dir;
        if (mName) info.partNum = Number(mName[1]);
        if (Object.keys(parsed.header).length) info.header = parsed.header;
        if (parsed.encoded) info.encoded = parsed.encoded;
        if (parsed.quirks.length) info.quirks = parsed.quirks;
        fileInfos.push(info);

        for (const p of parsed.parts) {
            const idx = parts.length;
            parts.push({ name: p.name, partNum: p.partNum, file: rel, line: p.line, params: p.params });
            (byPartNum[p.partNum] = byPartNum[p.partNum] || []).push(idx);
        }
        for (const m of parsed.models) {
            const idx = models.length;
            models.push({ name: m.name, type: m.type, file: rel, line: m.fileLine, params: m.params });
            (byModel[m.name] = byModel[m.name] || []).push(idx);
        }
        for (const s of parsed.subckts) {
            const idx = subckts.length;
            subckts.push({ name: s.name, file: rel, line: s.line, nodes: s.nodes, params: s.params, body: s.body });
            (bySubckt[s.name] = bySubckt[s.name] || []).push(idx);
        }
    }

    const encodedFiles = fileInfos.filter(f => f.encoded).length;
    let wewbRes = null;
    let parsedRes = null;
    if (resFile && fs.existsSync(resFile)) {
        const buf = fs.readFileSync(resFile);
        parsedRes = parseWewbRes(buf.toString('latin1'));
        wewbRes = {
            path: path.relative(ROOT, resFile),
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            cards: parsedRes.cards.map(p => ({ name: p.name, partNum: p.partNum, params: p.params })),
            parts: parsedRes.parts.map(p => ({
                partNum: p.partNum, a: p.a, b: p.b, c: p.c,
                value: p.value, units: p.units, model: p.model, bin: p.bin,
                ...(p.label ? { label: p.label } : {}),
                ...(p.extra.length ? { extra: p.extra } : {}),
            })),
            macros: parsedRes.macros,
        };
    }
    let wewbMsg = null;
    let partNames = [];
    if (msgFile && fs.existsSync(msgFile)) {
        const buf = fs.readFileSync(msgFile);
        partNames = parsePartNames(buf.toString('latin1'));
        wewbMsg = {
            path: path.relative(ROOT, msgFile),
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            names: partNames,
        };
    }
    const partMap = buildPartMap(parsedRes || { parts: [] }, fileInfos, parts, partNames);
    const json = {
        format: FORMAT,
        version: FORMAT_VERSION,
        source: 'EWB512/MODELS',
        counts: {
            files: fileInfos.length,
            parts: parts.length,
            models: models.length,
            subckts: subckts.length,
            subcktBodies: subckts.filter(s => s.body.length > 0).length,
            encodedFiles,
            quirkFiles: fileInfos.filter(f => f.quirks).length,
            resParts: wewbRes ? wewbRes.parts.length : 0,
            partNames: partNames.length,
            partMapNums: Object.keys(partMap).length,
        },
        files: fileInfos,
        parts,
        models,
        subckts,
        byPartNum,
        byModel,
        bySubckt,
        wewbRes,
        wewbMsg,
        partMap,
        notes: [
            'Часть файлов (.M**) — лицензированные: шапка + блок строк A..P (кодированные данные).',
            'Их параметры пока не декодированы: доступны только имя/шапка/sha256 (см. docs/re/engine-behavior.md).',
            'PartNum берётся из имени файла `.M<num>` и из карточек P.',
            'partMap — встроенные классы WEWB.RES + имена WEWBMSG.RES + семейства MODELS;',
            'доказательства по схемам — partNumCoverage (M4), разбор — docs/re/engine-parts.md.',
        ],
    };
    return json;
}

// --- покрытие PartNum по схемам CIRCUITS (M4) -------------------------------------

/**
 * Доказательства по одной декодированной схеме: Comp-блоки (PartNum + RefID +
 * ModelName + m_tptrElem) и дефолтные модели из `Library.Models`.
 * Чистая функция — используется тестами без EWB512.
 * @param {string} text декодированный текст .ewb
 * @returns {{partNums:Object, libraryModels:Array}}
 */
export function circuitEvidence(text) {
    const partNums = {};
    const bump = (obj, key) => { if (key) obj[key] = (obj[key] || 0) + 1; };
    for (const m of text.matchAll(/Comp\s*\{/g)) {
        let depth = 0;
        let end = -1;
        for (let k = m.index + m[0].length - 1; k < text.length; k++) {
            if (text[k] === '{') depth++;
            else if (text[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
        }
        if (end < 0) break;
        const blk = text.slice(m.index, end + 1);
        const pn = blk.match(/PartNum\s+i\s+(\d+)/);
        if (!pn) continue;
        const n = Number(pn[1]);
        const e = partNums[n] || (partNums[n] = { count: 0, refs: {}, models: {}, mptr: {} });
        e.count++;
        const pick = (re) => { const x = blk.match(re); return x ? x[1] : ''; };
        const pref = (s) => (String(s).match(/^[A-Za-z]+/) || ['?'])[0];
        const ref = pick(/RefID\s+\w\s+"([^"]*)"/);
        if (ref) bump(e.refs, pref(ref));
        const mdl = pick(/ModelName\s+\w\s+"([^"]*)"/);
        if (mdl) bump(e.models, mdl);
        const mp = pick(/m_tptrElem\s+\w\s+"([^"]*)"/);
        if (mp) bump(e.mptr, pref(mp));
    }
    const libraryModels = [];
    for (const m of text.matchAll(/Model\s*\{\s*Name\s+\w\s+"([^"]*)"\s+PartNum\s+i\s+(\d+)\s+Params\s+r:(\d+)([^}]*)\}/g)) {
        libraryModels.push({ name: m[1], partNum: Number(m[2]), n: Number(m[3]), params: m[4].trim().split(/\s+/).map(tokenValue) });
    }
    return { partNums, libraryModels };
}

/**
 * Найти PartNum в схемах `EWB512/CIRCUITS` (через EWB-кодек) и сверить с картой
 * `library.partMap`. Возвращает покрытие по номерам и по экземплярам + доказательства.
 * @param {object} library результат buildModelsJson
 * @param {string} [circuitsDir]
 * @returns {{circuits:number, partNums:Object, files:Array, covered:number[], missing:number[],
 *            excluded:number[], byNumber:Object, byInstance:Object}}
 */
export function partNumCoverage(library, circuitsDir = path.join(ROOT, 'EWB512', 'CIRCUITS')) {
    const out = {
        circuits: 0, partNums: {}, files: [],
        covered: [], missing: [], excluded: [],
        byNumber: null, byInstance: null,
    };
    if (!fs.existsSync(circuitsDir)) return out;
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) { walk(abs); continue; }
            if (!/\.ewb$/i.test(e.name)) continue;
            let text;
            try { text = decode(fs.readFileSync(abs)); } catch { continue; }
            const ev = circuitEvidence(text);
            const nums = [];
            for (const [n, e] of Object.entries(ev.partNums)) {
                const nn = Number(n);
                const acc = out.partNums[nn] || (out.partNums[nn] = { count: 0, files: 0, refs: {}, models: {}, mptr: {} });
                acc.count += e.count;
                acc.files++;
                for (const k of ['refs', 'models', 'mptr']) for (const [kk, vv] of Object.entries(e[k])) acc[k][kk] = (acc[k][kk] || 0) + vv;
                nums.push(nn);
            }
            for (const lm of ev.libraryModels) {
                const acc = out.partNums[lm.partNum] || (out.partNums[lm.partNum] = { count: 0, files: 0, refs: {}, models: {}, mptr: {} });
                (acc.defaults || (acc.defaults = [])).push({ name: lm.name, n: lm.n, file: path.relative(circuitsDir, abs) });
            }
            out.circuits++;
            out.files.push({ path: path.relative(circuitsDir, abs), partNums: [...new Set(nums)].sort((a, b) => a - b) });
        }
    };
    walk(circuitsDir);
    const known = new Set(Object.keys(library.partMap || {}).map(Number));
    let total = 0;
    let covered = 0;
    for (const n of Object.keys(out.partNums).map(Number).sort((a, b) => a - b)) {
        const inst = out.partNums[n].count;
        if (SERVICE_PARTNUMS.has(n)) { out.excluded.push(n); continue; }
        total += inst;
        if (known.has(n)) { out.covered.push(n); covered += inst; }
        else out.missing.push(n);
    }
    out.byNumber = { covered: out.covered.length, total: out.covered.length + out.missing.length };
    out.byInstance = { covered, total };
    return out;
}

// --- CLI --------------------------------------------------------------------------

const __isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;

if (__isMain) {
    const args = process.argv.slice(2);
    const opt = (name, def) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : def;
    };
    const src = opt('--src', DEFAULT_SRC);
    const out = opt('--out', DEFAULT_OUT);
    if (!fs.existsSync(src)) {
        console.error(`нет папки ${src} (референс оригинала EWB512/, монтируется отдельно)`);
        process.exit(1);
    }
    const json = buildModelsJson(src, {
        resFile: args.includes('--no-res') ? null : opt('--res', undefined),
        msgFile: args.includes('--no-res') ? null : opt('--msg', undefined),
    });
    const text = JSON.stringify(json);

    if (args.includes('--coverage')) {
        const cov = partNumCoverage(json, opt('--circuits', path.join(ROOT, 'EWB512', 'CIRCUITS')));
        const pct = (c, t) => (t ? (100 * c / t).toFixed(1) + '%' : '—');
        console.log(`схем: ${cov.circuits}, PartNum всего: ${Object.keys(cov.partNums).length}`);
        if (args.includes('--files')) for (const f of cov.files) console.log(`  ${f.path}: ${f.partNums.join(', ')}`);
        console.log(`покрытие по номерам:     ${cov.byNumber.covered}/${cov.byNumber.total} = ${pct(cov.byNumber.covered, cov.byNumber.total)}`);
        console.log(`покрытие по экземплярам: ${cov.byInstance.covered}/${cov.byInstance.total} = ${pct(cov.byInstance.covered, cov.byInstance.total)}`);
        console.log(`служебные (не детали): ${cov.excluded.join(', ') || '—'}`);
        console.log(`нет в карте: ${cov.missing.join(', ') || '—'}`);
        for (const n of [...cov.covered, ...cov.missing].sort((a, b) => a - b)) {
            const e = cov.partNums[n];
            const m = json.partMap[n];
            const refs = Object.entries(e.refs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(' ');
            const models = Object.entries(e.models).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `"${k}"×${v}`).join(' ');
            const info = [
                m && m.name ? `"${m.name}"` : null,
                m && m.kind ? `класс=${m.kind}` : null,
                `src=${m ? m.sources.join('+') : '?'}`,
            ].filter(Boolean).join(' ');
            console.log(`  ${String(n).padStart(2)}: ${info} экз.=${e.count} refs: ${refs}${models ? ' | модели: ' + models : ''}`);
        }
        if (out && !args.includes('--stdout')) {
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, text);
            console.log(`записано: ${path.relative(ROOT, out)} (${text.length} байт)`);
        }
        process.exit(0);
    }

    if (args.includes('--stdout')) {
        process.stdout.write(text + '\n');
        process.exit(0);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    const c = json.counts;
    console.log(
        `файлов=${c.files} карточек P=${c.parts} моделей=${c.models} подцепей=${c.subckts}` +
        ` (с телами ${c.subcktBodies}) закодированных=${c.encodedFiles}`,
    );
    console.log(`WEWB.RES: деталей=${c.resParts}; partMap: номеров=${c.partMapNums}`);
    console.log(`записано: ${path.relative(ROOT, out)} (${text.length} байт)`);
}
