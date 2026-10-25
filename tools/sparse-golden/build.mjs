/**
 * build.mjs — сборка golden-драйвера C-эталона Sparse 1.3 (vendor/spice3f4)
 * для 1:1 сверки с JS-портом (Site/engine/spice/sparse.js).
 *
 * Не часть движка: только тестовый tooling. Требует gcc; исходники — vendor/
 * (не в git). Возвращает путь к собранному бинарнику.
 *
 * Запуск вручную: node tools/sparse-golden/build.mjs <каталог-вывода>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const vendor = join(root, 'vendor', 'spice3f4');
const sparseDir = join(vendor, 'src', 'lib', 'sparse');

export const SPARSE_SOURCES = ['spalloc', 'spbuild', 'spfactor', 'spsolve', 'sputils', 'spsmp', 'spoutput'];

/** Проверка доступности gcc и исходников vendor. */
export function goldenAvailable() {
  if (!existsSync(join(sparseDir, 'spfactor.c'))) return false;
  const r = spawnSync('gcc', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * Собрать драйвер. outDir — каталог для бинарника (создаётся).
 * Возвращает путь к исполняемому файлу.
 */
export function buildGoldenDriver(outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const exe = join(outDir, 'sparse-golden-driver');
  const args = [
    '-std=gnu17', // код 1993 года: `f()` в C23 значит «без параметров» и ломает K&R-объявления
    '-O0',
    '-ffp-contract=off',
    '-w',
    '-Dsun', // платформенные макросы SPICE (os_sun.h), как в оригинальной сборке под UNIX
    '-DHAS_MINDATA', // как release-сборки (DEBUG NO): ASSERT-ы sparse не роняют процесс
    '-DHAS_STDLIB', // отключает K&R-объявления libc из misc.h
    '-Dbzero=bzero', // #ifndef-защита misc.h для libc-функций
    '-include', join(here, 'shim', 'pre.h'),
    '-I', join(vendor, 'src', 'include'),
    '-I', sparseDir,
    join(here, 'driver.c'),
    ...SPARSE_SOURCES.map((s) => join(sparseDir, `${s}.c`)),
    '-lm',
    '-o', exe,
  ];
  const r = spawnSync('gcc', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`gcc: ${r.status}\n${r.stderr}`);
  }
  return exe;
}

/** Запустить скрипт команд через драйвер; вернуть stdout (массив строк). */
export function runGoldenScript(exe, script) {
  const r = spawnSync(exe, [], { input: script.join('\n') + '\n', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`driver exit ${r.status}: ${r.stderr}`);
  return r.stdout.replace(/\r/g, '').split('\n').filter((s) => s.length > 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || join(root, '.tmp', 'sparse-golden');
  if (!goldenAvailable()) {
    console.error('gcc или vendor/spice3f4 недоступны');
    process.exit(1);
  }
  console.log(buildGoldenDriver(out));
}
