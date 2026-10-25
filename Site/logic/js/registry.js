// Реестр компонентов EWR.
// Каждый компонент — папка /components/<id>/ с manifest.json и symbol.svg.
// Манифест описывает размер, параметры (data-slot) и точки подключения (порты).

const COMPONENTS_ROOT = 'components/';

const manifestCache = new Map();
const symbolCache = new Map();

let __instCounter = 0;
export function nextInstanceId() { return 'C' + (++__instCounter); }

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res.json();
}

async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res.text();
}

async function loadComponent(id) {
    if (manifestCache.has(id)) return manifestCache.get(id);
    const manifest = await fetchJson(`${COMPONENTS_ROOT}${id}/manifest.json`);
    manifestCache.set(id, manifest);
    return manifest;
}

function getComponent(id) {
    return manifestCache.get(id);
}

function componentPath(id, file) {
    return `${COMPONENTS_ROOT}${id}/${file || ''}`;
}

async function loadSymbol(id) {
    if (symbolCache.has(id)) return symbolCache.get(id);
    const manifest = await loadComponent(id);
    const text = await fetchText(componentPath(id, manifest.symbol));
    symbolCache.set(id, text);
    return text;
}

function getSymbol(id) {
    return symbolCache.get(id);
}

function createPlaceholderSymbol(id, w, h) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', 1);
    rect.setAttribute('y', 1);
    rect.setAttribute('width', w - 2);
    rect.setAttribute('height', h - 2);
    rect.setAttribute('rx', 4);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#635e61');
    rect.setAttribute('stroke-dasharray', '4 3');
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', w / 2);
    text.setAttribute('y', h / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', Math.max(8, h / 5));
    text.textContent = id;
    svg.appendChild(rect);
    svg.appendChild(text);
    return svg;
}

function svgToElement(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return doc.documentElement;
}

function svgViewBoxSize(svg) {
    const vb = svg.getAttribute('viewBox');
    if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
        }
    }
    return null;
}

function fillSlots(svg, values) {
    svg.querySelectorAll('[data-slot]').forEach(node => {
        const slot = node.getAttribute('data-slot');
        if (slot && values[slot] != null) {
            node.textContent = values[slot];
        }
    });
}

function defaultValues(manifest) {
    const values = {};
    if (!manifest.parameters) return values;
    for (const key of Object.keys(manifest.parameters)) {
        const param = manifest.parameters[key];
        if (param.slot) values[param.slot] = param.default != null ? param.default : '';
    }
    return values;
}

function buildSvgNode(id) {
    const manifest = manifestCache.get(id);
    if (!manifest) return null;
    const size = manifest.size || { w: 80, h: 40 };
    const svgText = symbolCache.get(id);
    let svg;
    if (svgText) {
        svg = svgToElement(svgText);
    } else {
        svg = createPlaceholderSymbol(id, size.w || 80, size.h || 40);
    }
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return svg;
}

// Создаёт обёртку .component-svg с инжектнутым SVG, точками подключения и значениями.
async function buildComponentNode(id, values) {
    const manifest = await loadComponent(id);
    // Если symbol.svg ещё не в кеше — загружаем; при отсутствии файла остаётся плейсхолдер.
    if (!symbolCache.has(id)) {
        await loadSymbol(id).catch(() => null);
    }
    const size = manifest.size || { w: 80, h: 40 };
    const wrapper = document.createElement('div');
    wrapper.className = 'component-svg';
    wrapper.dataset.component = id;
    wrapper.dataset.inst = nextInstanceId();
    wrapper.style.width = size.w + 'px';
    wrapper.style.height = size.h + 'px';

    const svg = buildSvgNode(id);
    wrapper.appendChild(svg);

    const vb = svgViewBoxSize(svg);
    const spanW = vb ? vb.w : size.w;
    const spanH = vb ? vb.h : size.h;

    if (Array.isArray(manifest.ports)) {
        for (const port of manifest.ports) {
            const dot = document.createElement('div');
            dot.className = 'port port--' + (port.role || 'inout');
            dot.dataset.port = port.id;
            dot.dataset.dir = port.dir || 'auto';
            dot.title = (port.dir ? { left: '←', right: '→', up: '↑', down: '↓' }[port.dir] + ' ' : '') + (port.label || port.id);
            dot.style.left = ((port.x / spanW) * 100) + '%';
            dot.style.top = ((port.y / spanH) * 100) + '%';
            wrapper.appendChild(dot);
        }
    }

    const merged = Object.assign(defaultValues(manifest), values || {});
    fillSlots(svg, merged);

    return wrapper;
}

// Создаёт SVG-узел для курсора перетаскивания (синхронно из кеша).
function buildDragCursor(id) {
    if (!manifestCache.has(id)) return null;
    const svg = buildSvgNode(id);
    if (!svg) return null;
    const manifest = manifestCache.get(id);
    const size = manifest.size || { w: 80, h: 40 };
    const wrapper = document.createElement('div');
    wrapper.className = 'drag-clone';
    wrapper.style.width = Math.min(size.w, 80) + 'px';
    wrapper.style.height = Math.min(size.h, 48) + 'px';
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    wrapper.appendChild(svg);
    return wrapper;
}

// Обновляет значения в уже размещённом компоненте.
function setComponentValue(node, values) {
    const svg = node.querySelector('svg');
    if (svg) fillSlots(svg, values);
}

// Создаёт узел-плейсхолдер для нераспознанного/несуществующего компонента.
// info: { id, type (движковый), value, nodes:[…] }. Рисует рамку с подписью
// «id · type · value» и точки подключения (по одной на терминал).
function buildPlaceholderNode(info) {
    const nodes = Array.isArray(info.nodes) ? info.nodes : [];
    const ports = Math.max(2, nodes.length);
    const w = 72, h = 40;
    const ns = 'http://www.w3.org/2000/svg';
    const wrapper = document.createElement('div');
    wrapper.className = 'component-svg';
    wrapper.dataset.component = info.id || '?';
    wrapper.dataset.inst = nextInstanceId();
    if (info.type) wrapper.dataset.etype = info.type;
    if (info.value != null) wrapper.dataset.compvalue = String(info.value);
    wrapper.style.width = w + 'px';
    wrapper.style.height = h + 'px';

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', 1); rect.setAttribute('y', 1);
    rect.setAttribute('width', w - 2); rect.setAttribute('height', h - 2);
    rect.setAttribute('rx', 4); rect.setAttribute('fill', '#20232b');
    rect.setAttribute('stroke', '#e0a33a'); rect.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(rect);
    const t1 = document.createElementNS(ns, 'text');
    t1.setAttribute('x', w / 2); t1.setAttribute('y', h / 2 - 3);
    t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', 11);
    t1.setAttribute('fill', '#e6e6e6'); t1.textContent = info.id || '?';
    svg.appendChild(t1);
    const t2 = document.createElementNS(ns, 'text');
    t2.setAttribute('x', w / 2); t2.setAttribute('y', h / 2 + 10);
    t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', 8);
    t2.setAttribute('fill', '#9aa3b2');
    const valTxt = info.value != null ? ` · ${info.value}` : '';
    t2.textContent = `${info.type || 'элемент'}${valTxt}`;
    svg.appendChild(t2);
    wrapper.appendChild(svg);

    // точки подключения: порт 0 слева, порт 1 справа, остальные снизу
    const posOf = (i) => {
        if (i === 0) return [0, h / 2];
        if (i === 1) return [w, h / 2];
        const n = Math.max(1, ports - 2);
        return [(w * (i - 1)) / (n + 1), h];
    };
    for (let i = 0; i < ports; i++) {
        const [x, y] = posOf(i);
        const dot = document.createElement('div');
        dot.className = 'port';
        dot.dataset.port = 'p' + i;
        dot.dataset.dir = x === 0 ? 'left' : x === w ? 'right' : 'down';
        dot.style.left = (x / w) * 100 + '%';
        dot.style.top = (y / h) * 100 + '%';
        wrapper.appendChild(dot);
    }
    return wrapper;
}

// Предзагрузка компонентов (manifest + svg) при открытии категории.
async function preload(ids) {
    await Promise.all(
        ids.map(id => Promise.all([loadComponent(id), loadSymbol(id)].map(p => p.catch(() => null))))
    );
}

export {
    loadComponent,
    getComponent,
    loadSymbol,
    getSymbol,
    componentPath,
    buildComponentNode,
    buildPlaceholderNode,
    buildDragCursor,
    setComponentValue,
    preload
};