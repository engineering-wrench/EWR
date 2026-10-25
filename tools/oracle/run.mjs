#!/usr/bin/env node
// Оракул 1:1: запуск настоящего движка EWB 5.12 (XSPICE32.DLL) под Wine и снятие
// результатов через tools/oracle/shim.py. Это источник эталонов для паритетных
// тестов порта (docs/engine/PLAN-CLONE.md, стратегия «C. Оракул»).
//
// Использование:
//   node tools/oracle/run.mjs --status
//   node tools/oracle/run.mjs --enumerate
//   node tools/oracle/run.mjs --deck tools/oracle/corpus/op_divider.json
//   node tools/oracle/run.mjs --capture        # corpus/* -> golden/*
//
// Требует (иначе self-skip у тестов и понятная ошибка здесь):
//   * wine в PATH (или EWR_WINE / --wine);
//   * 32-битный Windows-Python (или EWR_PY32 / --py32; см. tools/fetch-vendor.mjs);
//   * EWB512/XSPICE32.DLL (референс оригинала, read-only; или EWR_DLL / --dll).
//
// Никаких зависимостей: только node:* (как весь проект).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHIM = path.join(HERE, 'shim.py');
const CORPUS = path.join(HERE, 'corpus');
const GOLDEN = path.join(HERE, 'golden');

// --- Поиск окружения -----------------------------------------------------------

/** Linux-путь -> путь для Wine (диск Z: = корень /). */
export function toWinePath(p) {
  const abs = path.resolve(p);
  return 'Z:' + abs.replace(/\//g, '\\');
}

function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 || r.status === 1 ? (r.stdout || r.stderr || '').trim() : null;
  } catch {
    return null;
  }
}

/**
 * Проверка доступности оракула.
 * @param {{wine?:string, py32?:string, dll?:string}} [opts]
 * @returns {{ok:boolean, reason?:string, wine?:string, py32?:string, dll?:string}}
 */
export function oracleStatus(opts = {}) {
  const wine = opts.wine || process.env.EWR_WINE || 'wine';
  const ver = probe(wine, ['--version']);
  if (!ver) return { ok: false, reason: `wine недоступен (${wine}); задайте EWR_WINE` };

  const py32 = opts.py32 || process.env.EWR_PY32 || path.join(ROOT, 'vendor', 'py32', 'python.exe');
  if (!fs.existsSync(py32)) {
    return { ok: false, reason: `32-битный Python не найден (${py32}); см. tools/fetch-vendor.mjs --python` };
  }

  const dll = opts.dll || process.env.EWR_DLL || path.join(ROOT, 'EWB512', 'XSPICE32.DLL');
  if (!fs.existsSync(dll)) {
    return { ok: false, reason: `XSPICE32.DLL не найден (${dll}); это референс оригинала (read-only)` };
  }

  return { ok: true, wine, py32, dll };
}

// --- Запуск --------------------------------------------------------------------

/**
 * Прогнать шим под Wine.
 * @param {{deck?:string, enumerate?:boolean, timeoutMs?:number}&{wine?:string,py32?:string,dll?:string}} req
 * @returns {object} JSON-результат шима
 */
export function runOracle(req) {
  const st = oracleStatus(req);
  if (!st.ok) throw new Error('оракул недоступен: ' + st.reason);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ewr-oracle-'));
  const outFile = path.join(tmp, 'out.json');
  const args = ['python.exe', '-u', toWinePath(SHIM), '--dll', toWinePath(st.dll)];
  if (req.enumerate) args.push('--enumerate');
  if (req.deck) args.push('--deck', toWinePath(req.deck));
  args.push('--out', toWinePath(outFile));

  const env = { ...process.env, WINEDEBUG: process.env.EWR_WINEDEBUG || '-all' };
  const r = spawnSync(st.wine, args, {
    cwd: path.dirname(st.py32),
    env,
    timeout: req.timeoutMs || 240000,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw new Error('не удалось запустить wine: ' + r.error.message);
  if (!fs.existsSync(outFile)) {
    throw new Error(
      `шим не создал результат (code=${r.status}). stderr: ${(r.stderr || '').slice(0, 2000)}`
    );
  }
  const text = fs.readFileSync(outFile, 'utf8');
  try {
    return JSON.parse(text);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Каталог интерфейса DLL (устройства/анализы/параметры). */
export function runEnumerate(opts = {}) {
  return runOracle({ enumerate: true, ...opts });
}

/** Прогон деки из JSON-файла. */
export function runDeckFile(deckPath, opts = {}) {
  return runOracle({ deck: deckPath, ...opts });
}

// --- Эталоны (golden) ----------------------------------------------------------

/** Список дек корпуса (без _*.json). */
export function corpusDecks() {
  return fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
}

/** Перегенерировать все эталоны: enum + все деки корпуса. */
export function captureGolden(opts = {}) {
  fs.mkdirSync(GOLDEN, { recursive: true });
  const written = [];
  const write = (name, obj) => {
    const p = path.join(GOLDEN, name);
    fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n');
    written.push(path.relative(ROOT, p));
  };
  write('enum.json', runEnumerate(opts));
  for (const f of corpusDecks()) {
    write(f, runDeckFile(path.join(CORPUS, f), opts));
  }
  return written;
}

// --- CLI -----------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const env = { wine: opt('--wine'), py32: opt('--py32'), dll: opt('--dll') };

  if (argv.includes('--status')) {
    const st = oracleStatus(env);
    console.log(st.ok ? `оракул готов: ${st.wine} + ${st.py32} + ${st.dll}` : `оракул недоступен: ${st.reason}`);
    process.exit(st.ok ? 0 : 1);
  }
  if (argv.includes('--capture')) {
    const written = captureGolden(env);
    console.log('эталоны обновлены:\n  ' + written.join('\n  '));
    return;
  }
  const result = argv.includes('--enumerate')
    ? runEnumerate(env)
    : runDeckFile(opt('--deck') || path.join(CORPUS, 'op_divider.json'), env);
  const out = opt('--out');
  const text = JSON.stringify(result, null, 1);
  if (out) fs.writeFileSync(out, text + '\n');
  else console.log(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
