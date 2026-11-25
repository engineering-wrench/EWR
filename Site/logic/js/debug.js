// Диагностический инструмент EWR: запись и визуализация положений элементов.
// Включается параметром ?debug=1 в URL редактора (EWR.html?debug=1):
//   * оверлей поверх рабочей области: сетка, рамки компонентов, отступы (pad),
//     коллайдеры проводов, коридоры портов, точки выхода и промежуточные точки;
//   * история снимков (canvas-координаты компонентов, портов, проводов);
//   * дамп текущего состояния: window.__ewrDebugDump(), клавиши F2/F3.
//
// Координаты записываются в системе координат #main-windows (canvas-координаты),
// как их видит маршрутизатор проводов (wires.js).

import { loadWireSettings } from './wire-settings.js';
import V from './viewport.js';

const DebugTool = (() => {
    const DEBUG = /[?&]debug=1/.test(window.location ? window.location.search : '');
    const main = document.getElementById('main-windows');
    if (!DEBUG || !main) return { start() {}, stop() {} };

    // Оверлей живёт на бесконечном поле и рисуется в мировых координатах.
    const world = V.world || main;
    const NS = 'http://www.w3.org/2000/svg';
    const history = [];
    let layer = null;
    let timer = null;

    function ensureLayer() {
        if (layer) return layer;
        layer = document.createElementNS(NS, 'svg');
        layer.classList.add('debug-overlay');
        world.appendChild(layer);
        return layer;
    }

    function el(tag, attrs, text) {
        const n = document.createElementNS(NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (text != null) n.textContent = text;
        return n;
    }

    function drawPoly(pts, color, alpha) {
        if (!pts || !pts.length) return;
        const s = pts.map(pt => Math.round(pt.x) + ',' + Math.round(pt.y)).join(' ');
        layer.appendChild(el('polyline', { points: s, fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-opacity': alpha, 'stroke-dasharray': '3 2' }));
    }

    function draw() {
        ensureLayer();
        while (layer.firstChild) layer.removeChild(layer.firstChild);

        const SET = loadWireSettings();
        const G = Math.max(2, SET.gridSize);
        const pad = SET.pad;

        // Границы содержимого в мировых координатах (плюс видимая область).
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const grow = (x, y) => {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        };
        world.querySelectorAll('.component-svg').forEach(n => {
            grow(n.offsetLeft, n.offsetTop);
            grow(n.offsetLeft + n.offsetWidth, n.offsetTop + n.offsetHeight);
        });
        const tl = V.screenToWorld(main.getBoundingClientRect().left, main.getBoundingClientRect().top);
        const br = V.screenToWorld(main.getBoundingClientRect().right, main.getBoundingClientRect().bottom);
        grow(tl.x, tl.y); grow(br.x, br.y);
        if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 640; y1 = 480; }

        const gx0 = Math.floor(x0 / G) * G, gy0 = Math.floor(y0 / G) * G;
        for (let x = gx0; x <= x1; x += G) {
            layer.appendChild(el('line', { x1: x, y1: y0, x2: x, y2: y1, stroke: '#d9d9d9', 'stroke-width': 0.5 / V.getState().scale }));
        }
        for (let y = gy0; y <= y1; y += G) {
            layer.appendChild(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#d9d9d9', 'stroke-width': 0.5 / V.getState().scale }));
        }

        // компоненты: рамка + отступ (pad)
        world.querySelectorAll('.component-svg').forEach(n => {
            const x0c = n.offsetLeft, y0c = n.offsetTop;
            const x1c = x0c + n.offsetWidth, y1c = y0c + n.offsetHeight;
            layer.appendChild(el('rect', {
                x: x0c + 0.5, y: y0c + 0.5, width: Math.max(0, x1c - x0c - 1), height: Math.max(0, y1c - y0c - 1),
                fill: 'rgba(200,0,0,.06)', stroke: '#c00', 'stroke-width': 1, 'stroke-dasharray': '6 3'
            }));
            layer.appendChild(el('rect', {
                x: x0c - pad + 0.5, y: y0c - pad + 0.5,
                width: Math.max(0, (x1c - x0c) + 2 * pad - 1), height: Math.max(0, (y1c - y0c) + 2 * pad - 1),
                fill: 'none', stroke: '#f80', 'stroke-width': 1, 'stroke-dasharray': '2 3'
            }));
        });

        // порты
        world.querySelectorAll('.port').forEach(p => {
            const node = p.closest('.component-svg');
            if (!node) return;
            const cx = node.offsetLeft + node.offsetWidth * (parseFloat(p.style.left) || 0) / 100;
            const cy = node.offsetTop + node.offsetHeight * (parseFloat(p.style.top) || 0) / 100;
            layer.appendChild(el('circle', { cx, cy, r: 3, fill: '#a06ad8' }));
            layer.appendChild(el('text', { x: cx + 5, y: cy - 4, 'font-size': 9, fill: '#a06ad8' }, p.dataset.dir || 'auto'));
        });

        // диагностика последнего маршрута (внутренности route())
        const wd = window.__wireDebug;
        const L = wd && wd.last;
        if (L) {
            if (L.corrA && L.corrA.points) drawPoly(L.corrA.points, '#0a0', 0.9);
            if (L.corrB && L.corrB.points) drawPoly(L.corrB.points, '#0a0', 0.9);
            if (L.mid && L.mid.length) drawPoly(L.mid, '#008', 0.9);
            if (L.corrA && L.corrA.exit) layer.appendChild(el('circle', { cx: L.corrA.exit.x, cy: L.corrA.exit.y, r: 4, fill: '#0a0' }));
            if (L.corrB && L.corrB.exit) layer.appendChild(el('circle', { cx: L.corrB.exit.x, cy: L.corrB.exit.y, r: 4, fill: '#0a0' }));
            if (L.fallbackType) {
                layer.appendChild(el('text', { x: 12, y: 16, 'font-size': 12, fill: '#a00', 'font-family': 'monospace' }, 'fallback: ' + L.fallbackType));
            }
        }

        // итоговые линии проводов
        world.querySelectorAll('.wire-path').forEach(pol => {
            const pts = String(pol.getAttribute('points') || '').trim(l)
                .split(/[\s]+/).filter(Boolean)
                .map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; });
            drawPoly(pts, '#00c', 0.6);
        });
    }

    function snapshot(label) {
        const s = { t: Date.now(), label: label || '', data: null };
        try {
            s.data = window.WireSystemDump ? window.WireSystemDump() : null;
        } catch (e) {
            s.data = { error: String(e) };
        }
        history.push(s);
        if (history.length > 500) history.shift();
        window.__ewrDebug = history;
        if (label === 'manual' || label === 'key' || history.length <= 1) {
            console.log('[EWR debug] ' + (label || 'snapshot') + '\n' + JSON.stringify(s.data, null, 2));
        }
        draw();
    }

    function copySnapshot() {
        const last = history.length ? history[history.length - 1] : null;
        const json = JSON.stringify(last ? last.data : {}, null, 2);
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { window.prompt('Скопируйте JSON:', json); }
        ta.remove();
    }

    function start() {
        // дамп текущего состояния доступен и через window
        window.WireSystemDump = () => { try { return window.__ewrWireDump ? window.__ewrWireDump() : null; } catch (e) { return null; } };

        snapshot('start');

        const obs = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => snapshot('change'), 150);
        });
        obs.observe(world, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

        window.__ewrDebugDump = (label) => snapshot(label || 'manual');
        window.__ewrDebugCopy = copySnapshot;

        document.addEventListener('keydown', (e) => {
            if (e.key === 'F2') { snapshot('key'); e.preventDefault(); }
            if (e.key === 'F3') { copySnapshot(); e.preventDefault(); }
        });

        console.log('[EWR debug] активен: F2 — снимок, F3 — копировать JSON, window.__ewrDebugDump() — дамп');
    }

    return { start, stop() {} };
})();

// window.__ewrWireDump задаётся wires.js через экспорт WireSystem.dump (см. ниже).
// debug.js стартует только при активации.
if (window.__ewrWireDump) {
    DebugTool.start();
} else {
    // wires.js ещё не готов — подождём событие загрузки
    window.addEventListener('load', function once() {
        window.removeEventListener('load', once);
        DebugTool.start();
    });
}

export default DebugTool;