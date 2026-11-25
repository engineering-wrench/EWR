#!/usr/bin/env node
/**
 * gen-spice-catalog.mjs — генератор каталога устройств/анализов движка-клона.
 *
 * Источник: `tools/oracle/golden/enum.json` — снимок публичной таблицы
 * `IFsimulator` из настоящего `XSPICE32.DLL` (снят оракулом, коммитится).
 * Результат: `Site/engine/spice/catalog.js` (ESM, 0 зависимостей, работает
 * в браузере — в отличие от чтения JSON из `tools/`).
 *
 * Каталог фиксирует публичную метаинформацию DLL: индекс, имя, описание,
 * число/имена выводов и таблицы параметров (`instanceParms`/`modelParms`:
 * keyword/id/dataType). Хуки и штамповка живут в `Site/engine/spice/devices/`
 * (фазы P1.4+).
 *
 * Запуск:
 *   node tools/gen-spice-catalog.mjs
 *
 * Генерация детерминированная: повторный запуск на том же enum.json даёт
 * байт-в-байт тот же файл.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enumPath = join(root, 'tools', 'oracle', 'golden', 'enum.json');
const outPath = join(root, 'Site', 'engine', 'spice', 'catalog.js');

const raw = readFileSync(enumPath);
const sha256 = createHash('sha256').update(raw).digest('hex');
const data = JSON.parse(raw.toString('utf8'));

/** Строковый литерал в стиле JSON (двойные кавычки, экранирование). */
function lit(value) {
  return JSON.stringify(value);
}

/** Параметр интерфейса: keyword/id/dataType (без указателей C). */
function parmLine(p) {
  return `{ keyword: ${lit(p.keyword)}, id: ${p.id}, dataType: ${p.dataType} }`;
}

function parmsLine(parms) {
  return Array.isArray(parms) ? parms.map(parmLine).join(', ') : '';
}

function deviceLine(d) {
  const names = Array.isArray(d.termNames) ? d.termNames.map(lit).join(', ') : '';
  return (
    `  { index: ${d.index}, name: ${lit(d.name)}, description: ${lit(d.description)}, ` +
    `terms: ${d.terms}, termNames: [${names}], ` +
    `instanceParms: [${parmsLine(d.instanceParms)}], ` +
    `modelParms: [${parmsLine(d.modelParms)}] },`
  );
}

function analysisLine(a) {
  return (
    `  { index: ${a.index}, name: ${lit(a.name)}, description: ${lit(a.description)}, ` +
    `parms: [${parmsLine(a.parms)}] },`
  );
}

const lines = [
  '/**',
  ' * catalog.js — каталог устройств и анализов движка-предка (XSPICE32.DLL).',
  ' *',
  ' * СГЕНЕРИРОВАНО `tools/gen-spice-catalog.mjs` из `tools/oracle/golden/enum.json`',
  ` * (sha256: ${sha256}).`,
  ' *',
  ' * НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ: правьте enum.json (снимок интерфейса DLL) или',
  ' * генератор и перегенерируйте файл. Индексы — это те самые `type` из CKT API',
  ' * (`CKTmodCrt(ckt, type, ...)`, `CKTnewAnal(ckt, type, ...)`), поэтому порядок',
  ' * строк обязан совпадать с таблицей DLL.',
  ' *',
  ' * Метаинформация нужна фронтенду и паритетным тестам: имена/индексы/число',
  ' * выводов сверяются с оракулом. Реализации устройств (хуки load/setup/…) —',
  ' * фазы P1.4+, анализа — P3.',
  ' */',
  '',
  '/** Устройства: `index` = индекс в таблице устройств DLL (0..DEVmaxnum-1). */',
  'export const DEVICES = [',
  ...data.devices.map(deviceLine),
  '];',
  '',
  '/** Анализы: `index` = тип задачи (`CKTnewAnal`); 0 — options (сама task). */',
  'export const ANALYSES = [',
  ...data.analyses.map(analysisLine),
  '];',
  '',
];

writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stdout.write(
  `catalog.js: ${data.devices.length} устройств, ${data.analyses.length} анализов, ` +
    `sha256(enum)=${sha256.slice(0, 12)}…\n`,
);
