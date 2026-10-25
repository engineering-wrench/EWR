#!/usr/bin/env node
// Загрузка исходников предка движка в vendor/ (не коммитится) — R3 из
// docs/engine/PLAN-CLONE.md. Скачивает по фиксированным URL, проверяет
// sha256 архивов и tree-hash распакованных деревьев (см. docs/re/engine-lineage.md §3).
//
//   node tools/fetch-vendor.mjs            # скачать/распаковать всё, что нужно
//   node tools/fetch-vendor.mjs --check    # только проверка того, что уже лежит
//   node tools/fetch-vendor.mjs --python   # + 32-битный Python для оракула (vendor/py32)
//   node tools/fetch-vendor.mjs --force    # перекачать архивы заново
//
// Требуется системный tar (для .tar.gz). Зависимостей нет: node:* + fetch.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');

// --- Артефакты (URL, хэши — docs/re/engine-lineage.md §3) ----------------------

const ARTIFACTS = [
  {
    name: 'sp3f4.kit.tar.gz',
    url: 'https://embedded.eecs.berkeley.edu/pubs/downloads/spice/sp3f4.kit.tar.gz',
    sha256: '6f93854b8e51040f90966cf04b4de68aec258d21abffc2515c0448c166d41e53',
    extractDir: 'spice3f4',
    treeHash: '570354c8f0491a6b0994625b22934d34ec76b4f40ddef75e83aefb1268a9b2ef',
    note: 'SPICE3F4 (Berkeley, кit 30.07.1993) — база числового ядра',
  },
  {
    name: 'sp3f4.patch.tar.gz',
    url: 'https://embedded.eecs.berkeley.edu/pubs/downloads/spice/sp3f4.patch.tar.gz',
    sha256: '8f20d77c3769d383f6cccfe8247e76dd71d5fac617f6009942428ea7ea918e0c',
    extractDir: '3f4patches',
    note: 'официальные патчи F4 (spsmp/grid/newcoms) — эталон для quirk-листа',
  },
  {
    name: 'xspice-1-0-37b9b81.tar.gz',
    url: 'https://codeload.github.com/erusyd/xspice-1-0/tar.gz/37b9b81fcc642235f4e06218df8c60792578b76c',
    sha256: '247e04d4762e39287e76245865d67bb694da419bc3765343f721fd6d8c5aa1f7',
    extractDir: 'xspice-1-0',
    innerDirPrefix: 'xspice-1-0-',
    treeHash: '1f67cabbb21e624190e722179475d140ae3f5fa544d8f8094fb51a7299ef49b9',
    note: 'XSPICE 1.0 (GTRI, зеркало erusyd/xspice-1-0 @37b9b81) — XSPICE-слой',
  },
];

const PYTHON = {
  name: 'python-3.11.9-embed-win32.zip',
  url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-win32.zip',
  sha256: 'daf24de7fb3b173e94e56a201d3f38dfedebbdc7ed1925f7aeb8ed588e2b4189',
  extractDir: 'py32',
  note: '32-битный Python для оракула (Wine)',
};

// --- Утилиты -------------------------------------------------------------------

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** tree-hash: sha256 по строкам `<путь>\0<sha256 файла>\n` (пути с '/', сортировка). */
function treeHash(root) {
  const lines = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(root, p).split(path.sep).join('/');
        lines.push(rel + '\0' + sha256File(p));
      }
    }
  };
  walk(root);
  lines.sort();
  const h = crypto.createHash('sha256');
  for (const l of lines) h.update(Buffer.from(l, 'latin1')).update('\n');
  return h.digest('hex');
}

async function download(url, dest, force) {
  if (fs.existsSync(dest) && !force) return false;
  process.stdout.write(`скачиваю ${url}\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} на ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return true;
}

function untar(archive, destDir, innerRename) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xzf', archive, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar: ${r.stderr || r.status}`);
  if (innerRename) {
    // GitHub-архивы кладут всё в подпапку `xspice-1-0-<sha>` — разворачиваем её наверх.
    const inner = fs.readdirSync(destDir).map((n) => path.join(destDir, n));
    if (inner.length === 1 && fs.statSync(inner[0]).isDirectory()) {
      const tmp = destDir + '.tmp';
      fs.renameSync(inner[0], tmp);
      fs.rmdirSync(destDir);
      fs.renameSync(tmp, destDir);
    }
  }
}

// --- Мини-распаковка zip (только то, что нужно для python-embed) ----------------

function unzip(archive, destDir) {
  const buf = fs.readFileSync(archive);
  // Конец каталога: сигнатура 0x06054b50, ищем с конца.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: не найден EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: плохой заголовок каталога');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) {
      fs.mkdirSync(path.join(destDir, name), { recursive: true });
      continue;
    }
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip: плохой локальный заголовок');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataOff, dataOff + csize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);
    if (method !== 0 && data.length !== usize) throw new Error(`zip: размер не сошёлся у ${name}`);
    const dest = path.join(destDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

// --- Основной сценарий ---------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const force = argv.includes('--force');
  const withPython = argv.includes('--python');
  fs.mkdirSync(VENDOR, { recursive: true });

  const problems = [];
  const todo = withPython ? [...ARTIFACTS, PYTHON] : ARTIFACTS;

  for (const a of todo) {
    const archive = path.join(VENDOR, a.name);
    const dir = path.join(VENDOR, a.extractDir);
    if (!checkOnly && (!fs.existsSync(archive) || force)) {
      try {
        await download(a.url, archive, force);
      } catch (e) {
        problems.push(`${a.name}: не скачался (${e.message})`);
        continue;
      }
    }
    let state;
    if (fs.existsSync(archive)) {
      const got = sha256File(archive);
      if (got !== a.sha256) {
        problems.push(`${a.name}: sha256 ${got} != эталон ${a.sha256}`);
        continue;
      }
      state = fs.existsSync(dir) ? 'распаковано' : 'только архив';
      if (!checkOnly && !fs.existsSync(dir)) {
        process.stdout.write(`распаковываю ${a.name} → vendor/${a.extractDir}\n`);
        if (a.name.endsWith('.zip')) unzip(archive, dir);
        else untar(archive, dir, a.innerDirPrefix);
      }
    } else if (a.treeHash && fs.existsSync(dir)) {
      // Архива нет, но дерево уже разложено (напр., git-клон) — проверяем по tree-hash.
      state = 'дерево без архива';
    } else {
      problems.push(`${a.name}: архива нет (${checkOnly ? 'запустите без --check' : 'ошибка загрузки'})`);
      continue;
    }
    if (a.treeHash && fs.existsSync(dir)) {
      const th = treeHash(dir);
      if (th !== a.treeHash) problems.push(`${a.extractDir}: tree-hash ${th} != эталон ${a.treeHash}`);
    }
    console.log(`ok  ${a.name}  (${state})  — ${a.note}`);
  }

  if (problems.length) {
    console.error('\nПРОБЛЕМЫ:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('\nvendor/ готов. Оракул: node tools/oracle/run.mjs --status');
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
