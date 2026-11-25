#!/usr/bin/env node
// Локальный сервер Component-editor с прямой записью готовых компонентов
// в папку проекта. Zero-dependency, Node >= 18.
//
//   npm run studio            → http://127.0.0.1:5501/
//   node Component-editor/tools/serve.mjs --port 5501 --out components
//
// Статика отдаётся из Component-editor/, а POST /api/save-component пишет
// папку <out>/<id>/ с symbol.svg, icon.png, manifest.json и т.д.
// Сервер слушает только localhost: это инструмент разработки, не прод.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');        // Component-editor/
const REPO = resolve(PROJECT, '..');        // корень репозитория

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

/** Безопасное имя папки компонента: без слэшей, `..` и спецсимволов. */
export function sanitizeName(name) {
    const s = String(name || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/^\.+/, '_')
        .replace(/\s+/g, '-');
    return s || 'component';
}

/** Имя файла внутри папки компонента — только базовое имя. */
export function safeFileName(name) {
    const base = String(name || '').split(/[\\/]/).pop();
    if (!base || base === '.' || base === '..') throw new Error('недопустимое имя файла');
    return base.replace(/^\.+/, '_');
}

/**
 * Пишет файлы компонента в `<outRoot>/<id>/`.
 * files: [{ name, encoding: 'utf8'|'base64', data }]
 * Возвращает абсолютный путь созданной папки.
 */
export async function saveComponent(outRoot, id, files) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('нет файлов для сохранения');
    const dir = join(outRoot, sanitizeName(id));
    await mkdir(dir, { recursive: true });
    for (const f of files) {
        const name = safeFileName(f.name);
        const data = f.encoding === 'base64'
            ? Buffer.from(String(f.data || ''), 'base64')
            : Buffer.from(String(f.data ?? ''), 'utf8');
        await writeFile(join(dir, name), data);
    }
    return dir;
}

/** Есть ли файл по пути (без исключения). */
async function fileExists(path) {
    try {
        const info = await stat(path);
        return info.isFile();
    } catch (_) {
        return false;
    }
}

/**
 * Список элементов палитры EWR: папки `Site/components/<id>/` с manifest.json.
 * Возвращает только реально существующие компоненты — по ним строится
 * режим «Слияние» (нарисованный SVG кладётся в symbol.svg выбранного элемента).
 */
export async function listPalette(siteComponentsRoot) {
    let entries;
    try {
        entries = await readdir(siteComponentsRoot, { withFileTypes: true });
    } catch (_) {
        return [];
    }

    const items = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(siteComponentsRoot, entry.name);
        let manifest;
        try {
            manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
        } catch (_) {
            continue; // папка без манифеста не является элементом палитры
        }
        const icon = manifest.icon || 'icon.png';
        const symbol = manifest.symbol || 'symbol.svg';
        items.push({
            id: manifest.id || entry.name,
            dir: entry.name,
            name: manifest.name || entry.name,
            category: manifest.category || 'component',
            description: manifest.description || '',
            size: manifest.size || null,
            icon,
            symbol,
            hasIcon: await fileExists(join(dir, icon)),
            hasSymbol: await fileExists(join(dir, symbol)),
            ports: Array.isArray(manifest.ports) ? manifest.ports.length : 0,
        });
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    return items;
}

/**
 * Уже нарисованные компоненты (есть manifest.json + symbol.svg).
 * roots: [{ key, root, prefix }] — папки-кандидаты и URL-префиксы для файлов.
 * Один и тот же id может встречаться в нескольких корнях; для галереи
 * достаточно первого совпадения, поэтому дубликаты по id отбрасываются.
 */
export async function listDrawnComponents(roots = []) {
    const items = [];
    const seen = new Set();

    for (const { key, root, prefix } of roots) {
        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch (_) {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dir = join(root, entry.name);
            let manifest;
            try {
                manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
            } catch (_) {
                continue;
            }
            const id = manifest.id || entry.name;
            if (seen.has(id)) continue;
            const symbol = manifest.symbol || 'symbol.svg';
            if (!(await fileExists(join(dir, symbol)))) continue;
            seen.add(id);
            const base = prefix + '/' + encodeURIComponent(entry.name) + '/';
            items.push({
                id,
                dir: entry.name,
                rootKey: key,
                name: manifest.name || id,
                category: manifest.category || 'component',
                description: manifest.description || '',
                source: manifest.source || '',
                size: manifest.size || null,
                symbol,
                hasIcon: await fileExists(join(dir, manifest.icon || 'icon.png')),
                symbolUrl: base + encodeURIComponent(symbol),
                manifestUrl: base + 'manifest.json',
            });
        }
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    return items;
}

/**
 * Слияние нарисованного SVG с элементом палитры: пишет только `symbol.svg`.
 * Существующий manifest.json не меняется (иконка, порты и имя остаются).
 * Если элемента ещё нет в Site/components, создаётся папка и минимальный
 * манифест из переданного `manifest`.
 *
 * Возвращает { id, dir, created, hasManifest }.
 */
export async function mergeSymbol(siteComponentsRoot, id, svg, manifest) {
    if (!svg || typeof svg !== 'string') throw new Error('не передан svg');
    const safe = sanitizeName(id);
    const dir = join(siteComponentsRoot, safe);
    const manifestPath = join(dir, 'manifest.json');
    const hasManifest = await fileExists(manifestPath);

    if (!hasManifest) {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('элемента нет в палитре, а манифест не передан');
        }
        await mkdir(dir, { recursive: true });
        await writeFile(manifestPath, JSON.stringify({ ...manifest, id: safe }, null, 4), 'utf8');
    } else {
        // Папка уже в палитре — создаём её на случай гонки, но манифест не трогаем.
        await mkdir(dir, { recursive: true });
    }

    await writeFile(join(dir, 'symbol.svg'), svg, 'utf8');
    return { id: safe, dir, created: !hasManifest, hasManifest };
}

async function readBody(req, limit = 25 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new Error('слишком большой запрос');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}

async function serveStatic(res, urlPath, projectRoot) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = normalize(join(projectRoot, rel));
    if (!target.startsWith(projectRoot + sep) && target !== projectRoot) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    try {
        const info = await stat(target);
        if (info.isDirectory()) {
            res.writeHead(301, { Location: rel.replace(/\/?$/, '/') + 'index.html' }); res.end(); return;
        }
        const body = await readFile(target);
        res.writeHead(200, {
            'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
}

export function createStudioServer({
    projectRoot = PROJECT,
    outRoot,
    siteRoot = join(REPO, 'Site'),
    port = 5501,
    host = '127.0.0.1',
} = {}) {
    const output = outRoot || join(PROJECT, 'components');
    const siteComponents = join(siteRoot, 'components');
    const siteTitle = join(siteRoot, 'img', 'title');
    // Корни, в которых ищем уже нарисованные компоненты (галерея «сделан»).
    const componentRoots = [
        { key: 'studio', root: output, prefix: '/studio-components' },
        { key: 'repo', root: join(REPO, 'components'), prefix: '/repo-components' },
        { key: 'site', root: siteComponents, prefix: '/site-components' },
    ];
    return createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            if (url.pathname === '/api/info' && req.method === 'GET') {
                json(res, 200, {
                    ok: true,
                    outDir: output,
                    outDirRel: output.startsWith(REPO + sep) ? output.slice(REPO.length + 1) : output,
                    siteComponentsRel: siteComponents.startsWith(REPO + sep)
                        ? siteComponents.slice(REPO.length + 1) : siteComponents,
                    pid: process.pid,
                });
                return;
            }
            if (url.pathname === '/api/palette' && req.method === 'GET') {
                json(res, 200, { ok: true, elements: await listPalette(siteComponents) });
                return;
            }
            if (url.pathname === '/api/drawn-components' && req.method === 'GET') {
                json(res, 200, { ok: true, components: await listDrawnComponents(componentRoots) });
                return;
            }
            if (url.pathname === '/api/merge-symbol' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req));
                if (!body || !body.id) return json(res, 400, { ok: false, error: 'не задан id' });
                const result = await mergeSymbol(siteComponents, body.id, body.svg, body.manifest);
                json(res, 200, {
                    ok: true,
                    id: result.id,
                    created: result.created,
                    dir: result.dir,
                    dirRel: result.dir.startsWith(REPO + sep) ? result.dir.slice(REPO.length + 1) : result.dir,
                });
                return;
            }
            if (url.pathname === '/api/save-component' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req));
                if (!body || !body.id) return json(res, 400, { ok: false, error: 'не задан id' });
                // root позволяет сохранить отредактированный компонент обратно
                // в ту папку, откуда он был открыт (studio/repo/site).
                const target = componentRoots.find(r => r.key === body.root);
                const targetRoot = target ? target.root : output;
                const dir = await saveComponent(targetRoot, body.id, body.files);
                json(res, 200, {
                    ok: true,
                    id: sanitizeName(body.id),
                    root: target ? target.key : 'studio',
                    dir,
                    dirRel: dir.startsWith(REPO + sep) ? dir.slice(REPO.length + 1) : dir,
                    files: (body.files || []).map(f => safeFileName(f.name)),
                });
                return;
            }
            if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not found' });

            // Иконки категорий/элементов EWR для скопированного интерфейса вкладок.
            if (url.pathname.startsWith('/site-title/')) {
                const rel = url.pathname.slice('/site-title'.length);
                await serveStatic(res, rel, siteTitle);
                return;
            }
            if (url.pathname.startsWith('/site-components/')) {
                const rel = url.pathname.slice('/site-components'.length);
                await serveStatic(res, rel, siteComponents);
                return;
            }
            if (url.pathname.startsWith('/repo-components/')) {
                const rel = url.pathname.slice('/repo-components'.length);
                await serveStatic(res, rel, join(REPO, 'components'));
                return;
            }
            if (url.pathname.startsWith('/studio-components/')) {
                const rel = url.pathname.slice('/studio-components'.length);
                await serveStatic(res, rel, output);
                return;
            }

            await serveStatic(res, req.url, projectRoot);
        } catch (err) {
            json(res, 500, { ok: false, error: err.message });
        }
    });
}

function parseArgs(argv) {
    const args = { port: 5501, out: process.env.EWR_STUDIO_OUT || '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port') args.port = Number(argv[++i]) || 5501;
        else if (argv[i] === '--out') args.out = argv[++i] || '';
    }
    return args;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const { port, out } = parseArgs(process.argv.slice(2));
    const outRoot = out ? resolve(process.cwd(), out) : join(PROJECT, 'components');
    const server = createStudioServer({ port, outRoot });
    server.listen(port, '127.0.0.1', () => {
        console.log(`Component-editor: http://127.0.0.1:${port}/`);
        console.log(`Сохранение в:   ${outRoot}`);
        console.log('Остановить: Ctrl+C');
    });
    server.on('error', err => {
        if (err.code === 'EADDRINUSE') console.error(`Порт ${port} занят. Запустите: npm run studio -- --port 5502`);
        else console.error(err);
        process.exit(1);
    });
}
