// Генератор манифестов палитры: Site/components/<id>/manifest.json (+ symbol.svg).
//
// Источник данных — tools/palette-tiles.data.mjs (вкладка → плитка → id/имя/движок).
// Уже существующие манифесты не перезаписываются целиком: добавляется/обновляется
// только блок `ewb` и `source` (геометрия, порты и параметры — авторские).
// Плейсхолдерные символы (пунктирная рамка + подпись) создаются только для плиток,
// у которых symbol.svg ещё нет; настоящие символы — отдельная работа (план I2).
//
// Запуск:
//   node tools/palette-manifests.mjs           # создать/обновить
//   node tools/palette-manifests.mjs --check   # только проверить (exit 1 при расхождении)
//   node tools/palette-manifests.mjs --ids     # напечатать idListComponent для interface.js
//   node tools/palette-manifests.mjs --md      # напечатать таблицы §5 для docs/re/palette.md

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABS, TILES, tileId } from './palette-tiles.data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS = join(ROOT, 'Site', 'components');

const CHECK = process.argv.includes('--check');
const IDS = process.argv.includes('--ids');
const MD = process.argv.includes('--md');
const RUNTIME = process.argv.includes('--runtime');

const CONF_MARK = { confirmed: '✓', inferred: '~', unresolved: '?' };
const cell = (v) => (v == null ? '—' : String(v).replace(/\|/g, '\\|'));

const exists = async (p) => {
    try { await access(p); return true; } catch { return false; }
};

// Плейсхолдерный символ: та же сетка 100×40, что и у манифеста, порты по краям.
function placeholderSymbol(tile, w, h) {
    const label = `${tile.strip}-${String(tile.index).padStart(2, '0')}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <!-- Плейсхолдер EWR: символ ещё не перенесён из EWB (план I2). -->
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="none" stroke="#635e61" stroke-dasharray="4 3"/>
  <text x="${w / 2}" y="${h / 2 - 2}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#635e61">${label}</text>
  <text x="${w / 2}" y="${h / 2 + 12}" text-anchor="middle" dominant-baseline="middle" font-size="7" fill="#9a949a">${tile.id}</text>
</svg>
`;
}

// Порты плейсхолдера: 1-й слева, 2-й справа, остальные снизу.
function placeholderPorts(count, w, h) {
    const ports = [];
    for (let i = 0; i < count; i++) {
        let x, y, dir;
        if (i === 0) { x = 0; y = h / 2; dir = 'left'; }
        else if (i === 1) { x = w; y = h / 2; dir = 'right'; }
        else {
            const n = Math.max(1, count - 2);
            x = (w * (i - 1)) / (n + 1);
            y = h;
            dir = 'down';
        }
        ports.push({ id: `p${i + 1}`, label: '', role: 'inout', dir, x, y });
    }
    return ports;
}

function withEwb(manifest, tile) {
    manifest.ewb = {
        partNum: tile.partNum,
        ext: tile.ext,
        model: tile.model,
        device: tile.device,
        confidence: tile.confidence
    };
    if (!manifest.source) manifest.source = tileId(tile);
    return manifest;
}

if (MD) {
    const out = [];
    for (const tab of TABS) {
        const tiles = TILES.filter((x) => x.strip === tab.strip).sort((a, b) => a.index - b.index);
        out.push(`### ${tab.title} — ${tab.strip} (${tiles.length})\n`);
        out.push('| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |');
        out.push('|---:|:--|:--|:--|---:|:--|:--|:--|:--:|');
        for (const tile of tiles) {
            out.push(`| ${tile.index} | \`${tileId(tile)}\` | ${cell(tile.name)} | ${cell(tile.en)} | ${cell(tile.partNum)} | ${cell(tile.ext)} | ${cell(tile.model)} | \`${tile.device}\` | ${CONF_MARK[tile.confidence]} |`);
        }
        out.push('');
    }
    console.log(out.join('\n'));
    process.exit(0);
}

// Рантайм-таблица для движка: Site/engine/ewb-devices.js.
// Парсер `.ewb`, мост редактора и загрузчик файлов берут тип элемента отсюда,
// а не из эвристик по RefID/имени плитки (шаг 5b плана I4).
function runtimeModule() {
    const byId = [];
    const byPart = new Map();
    const byExt = new Map();
    const byModel = new Map();
    const editorId = new Map();
    const conflicts = [];
    // Каким символом открывать элемент из `.ewb` (остальные — по первому вхождению).
    const PREFERRED_EDITOR = {
        ground: 'ground',
        vsource: 'battery',
        isource: 'dc-current-source',
        connector: 'point',
        resistor: 'resistor',
        capacitor: 'capacitor',
        inductor: 'inductor',
        transformer: 'transformer',
        diode: 'diode',
        meter: 'multimeter'
    };

    const place = (map, key, value, what) => {
        if (key == null || key === '') return;
        if (map.has(key) && map.get(key) !== value) conflicts.push(`${what} ${key}: «${map.get(key)}» и «${value}»`);
        if (!map.has(key)) map.set(key, value);
    };

    for (const tile of TILES) {
        const rec = { partNum: tile.partNum, ext: tile.ext, model: tile.model, device: tile.device };
        byId.push(`    '${tile.id}': ${JSON.stringify(rec)},`);
        if (tile.device !== 'unknown') {
            if (tile.partNum) place(byPart, tile.partNum, tile.device, 'PartNum');
            place(byExt, tile.ext, tile.device, 'ExtComp');
            place(byModel, tile.model, tile.device, 'модель');
            const pref = PREFERRED_EDITOR[tile.device];
            if (pref === tile.id || !editorId.has(tile.device)) editorId.set(tile.device, tile.id);
        }
    }
    if (conflicts.length) {
        console.error('Рантайм-таблица: конфликты PartNum/ExtComp/модели:');
        for (const c of conflicts) console.error('  ' + c);
        process.exit(1);
    }

    const obj = (map) => [...map.entries()].map(([k, v]) => `    '${k}': '${v}',`).join('\n');
    return `// СГЕНЕРИРОВАНО: node tools/palette-manifests.mjs --runtime
// Не править вручную: источник — tools/palette-tiles.data.mjs (палитра EWB 5.12).
// Смысл: тип элемента определяется по PartNum/ExtComp/модели из файла или по id
// плитки редактора, а не по имени RefID и не по спискам-эвристикам в коде.

/** id плитки редактора → данные EWB (${TILES.length} шт.). */
export const EWB_BY_ID = {
${byId.join('\n')}
};

/** PartNum примитива → тип устройства движка. */
export const EWB_BY_PART = {
${obj(byPart)}
};

/** Имя книжной детали (ExtComp) → тип устройства движка. */
export const EWB_BY_EXT = {
${obj(byExt)}
};

/** Имя SPICE-модели (.par) → тип устройства движка. */
export const EWB_BY_MODEL = {
${obj(byModel)}
};

/** Тип устройства → id плитки, символом которой открывать элемент из .ewb. */
export const EDITOR_ID_BY_DEVICE = {
${[...editorId.entries()].map(([k, v]) => `    '${k}': '${v}',`).join('\n')}
};

/** Все данные плитки по id (null, если плитки нет). */
export function ewbTile(id) {
    return EWB_BY_ID[String(id == null ? '' : id).toLowerCase()] || null;
}

/** Тип устройства: сначала по PartNum, затем по ExtComp/модели (null — неизвестно). */
export function deviceByPart(partNum, ext, model) {
    const pn = Number(partNum);
    if (Number.isFinite(pn) && EWB_BY_PART[pn]) return EWB_BY_PART[pn];
    if (ext && EWB_BY_EXT[ext]) return EWB_BY_EXT[ext];
    if (model && EWB_BY_MODEL[model]) return EWB_BY_MODEL[model];
    return null;
}
`;
}

if (RUNTIME) {
    const target = join(ROOT, 'Site', 'engine', 'ewb-devices.js');
    const text = runtimeModule();
    if (process.argv.includes('--check')) {
        const current = await readFile(target, 'utf8').catch(() => null);
        if (current !== text) {
            console.error('ewb-devices.js: файл расходится с palette-tiles.data.mjs');
            process.exit(1);
        }
        console.log('ewb-devices.js: актуален');
        process.exit(0);
    }
    await writeFile(target, text);
    console.log(`ewb-devices.js: записано ${TILES.length} плиток`);
    process.exit(0);
}

if (IDS) {
    const lines = TABS.map((tab) => {
        const ids = TILES.filter((x) => x.strip === tab.strip)
            .sort((a, b) => a.index - b.index)
            .map((x) => `'${x.id}'`);
        return `    '${tab.key}': [${ids.join(', ')}],`;
    });
    console.log(lines.join('\n'));
    process.exit(0);
}

const problems = [];
const created = [];
const updated = [];
const kept = [];

for (const tile of TILES) {
    const dir = join(COMPONENTS, tile.id);
    const manifestPath = join(dir, 'manifest.json');
    const symbolPath = join(dir, 'symbol.svg');
    const hasManifest = await exists(manifestPath);

    if (CHECK) {
        if (!hasManifest) { problems.push(`${tile.id}: нет manifest.json`); continue; }
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const ewb = manifest.ewb;
        const ok = ewb && ewb.partNum === tile.partNum && ewb.ext === tile.ext
            && ewb.model === tile.model && ewb.device === tile.device
            && manifest.source === tileId(tile);
        if (!ok) problems.push(`${tile.id}: блок ewb/source расходится с palette-tiles.data.mjs`);
        continue;
    }

    if (hasManifest) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const before = JSON.stringify(manifest);
        withEwb(manifest, tile);
        const after = JSON.stringify(manifest);
        if (before !== after) {
            await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
            updated.push(tile.id);
        } else {
            kept.push(tile.id);
        }
        continue;
    }

    // Новая плитка: манифест + плейсхолдерный символ.
    const w = 100;
    const h = 40;
    const manifest = withEwb({
        id: tile.id,
        name: tile.name,
        category: 'component',
        description: `${tile.name} (${tile.en}); источник EWB: ${tileId(tile)}`,
        source: tileId(tile),
        status: 'placeholder',
        size: { w, h },
        symbol: 'symbol.svg',
        parameters: {},
        ports: placeholderPorts(tile.pins, w, h)
    }, tile);
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
    if (!(await exists(symbolPath))) {
        await writeFile(symbolPath, placeholderSymbol(tile, w, h));
    }
    created.push(tile.id);
}

if (CHECK) {
    if (problems.length) {
        console.error(`Палитра: расхождения (${problems.length}):`);
        for (const p of problems) console.error('  ' + p);
        process.exit(1);
    }
    console.log(`Палитра: все ${TILES.length} манифестов совпадают с palette-tiles.data.mjs`);
    process.exit(0);
}

console.log(`Палитра: создано ${created.length}, обновлено ${updated.length}, без изменений ${kept.length} (всего ${TILES.length})`);
if (created.length) console.log('  новые: ' + created.join(', '));
if (updated.length) console.log('  обновлены: ' + updated.join(', '));
