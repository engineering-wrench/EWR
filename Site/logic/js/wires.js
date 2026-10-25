// Система проводов EWR.
// Зажимаем порт и тянем к другому порту — создаётся двунаправленная связь.
// Маршрутизация:
//   * от порта провод выходит строго по направлению порта (dir) прямым коридором,
//     пока не покинет рамку своего компонента;
//   * A* по сетке обходит КОЛЛАЙДЕРЫ компонентов (обязательно), затем ужимание,
//     прямые углы и упрощение;
//   * провода при этом НЕ обходят друг друга и могут пересекаться.
//   * выделенный провод можно двигать: потянув сегмент, он сдвигается
//     перпендикулярно своему направлению (концы на портах остаются на месте).
//   * сегменты, сдвинутые пользователем, сохраняются в localStorage и
//     не перетрассировываются при обновлении размера окна/настроек.
// Клик по проводу выделяет, Delete/Backspace удаляет, Escape — снять выделение.

import { loadWireSettings, WIRE_SETTINGS_KEY } from '/logic/js/wire-settings.js';

const WireSystem = (() => {
    const main = document.getElementById('main-windows');
    if (!main) return { init() {}, refreshNode() {}, refreshAll() {} };

    const NS = 'http://www.w3.org/2000/svg';

    let SET = loadWireSettings();
    let layer = null;
    let wires = [];
    let wireSeq = 0;
    let selected = null;
    let drag = null;
    let draggingPort = null;
    let hoverPort = null;
    let wireDrag = null;

    // Диагностика: включается ?debug=1 (используется debug.js).
    const DEBUG = /[?&]debug=1/.test(window.location ? window.location.search : '');

    function debugCapture(data) {
        if (!window.__wireDebug) window.__wireDebug = { history: [], last: null };
        window.__wireDebug.last = data;
        window.__wireDebug.history.push(data);
        if (window.__wireDebug.history.length > 200) window.__wireDebug.history.shift();
    }

    function reloadSettings() { SET = loadWireSettings(); }

    // --- сохранение ручных (перемещённых пользователем) сегментов ---
    const MANUAL_KEY = 'ewr.wireManual';

    function loadManual() {
        try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }

    function saveManual(obj) {
        try { localStorage.setItem(MANUAL_KEY, JSON.stringify(obj)); } catch (e) {}
    }

    function wirePairKey(n1, p1, n2, p2) {
        const a = (n1.dataset ? n1.dataset.component : '') + ':' + (p1.dataset ? p1.dataset.port : '');
        const b = (n2.dataset ? n2.dataset.component : '') + ':' + (p2.dataset ? p2.dataset.port : '');
        return a < b ? a + '|' + b : b + '|' + a;
    }

    function saveWireManual(w) {
        if (!w || !w.points || w.points.length < 2) return;
        const m = loadManual();
        m[wirePairKey(w.n1, w.p1, w.n2, w.p2)] = {
            a: { x: w.points[0].x, y: w.points[0].y },
            b: { x: w.points[w.points.length - 1].x, y: w.points[w.points.length - 1].y },
            points: w.points
        };
        saveManual(m);
    }

    function manualFor(w) {
        const m = loadManual();
        const e = m[wirePairKey(w.n1, w.p1, w.n2, w.p2)];
        if (!e || !e.points || e.points.length < 2) return null;
        const a = portCenter(w.p1), b = portCenter(w.p2);
        if (Math.abs(a.x - e.a.x) > 1 || Math.abs(a.y - e.a.y) > 1 ||
            Math.abs(b.x - e.b.x) > 1 || Math.abs(b.y - e.b.y) > 1) return null;
        return e.points;
    }

    function ensureLayer() {
        if (layer) return layer;
        layer = document.createElementNS(NS, 'svg');
        layer.classList.add('wire-layer');
        main.appendChild(layer);
        return layer;
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function toCanvasCoords(x, y) {
        const r = main.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
    }

    function portCenter(port) {
        const r = port.getBoundingClientRect();
        return toCanvasCoords(r.left + r.width / 2, r.top + r.height / 2);
    }

    function pointsToStr(pts) {
        return pts.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join(' ');
    }

    // --- геометрические примитивы ---
    function gridCenter(v, G) { return (Math.round(v / G)) * G + G / 2; }

    function componentRects() {
        const list = [];
        const nodes = main.querySelectorAll('.component-svg');
        const mRect = main.getBoundingClientRect();
        for (let n = 0; n < nodes.length; n++) {
            const r = nodes[n].getBoundingClientRect();
            list.push({
                node: nodes[n],
                x0: r.left - mRect.left,
                y0: r.top - mRect.top,
                x1: r.right - mRect.left,
                y1: r.bottom - mRect.top
            });
        }
        return list;
    }

    function inflate(rect, m) {
        return { x0: rect.x0 - m, y0: rect.y0 - m, x1: rect.x1 + m, y1: rect.y1 + m };
    }

    function segmentClear(p0, p1, rects) {
        const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x);
        const y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) return false;
        }
        return true;
    }

    function segPenalty(a, b, rects) {
        let blk = 0;
        const N = 10;
        for (let s = 1; s < N; s++) {
            const t = s / N;
            const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) { blk++; break; }
            }
        }
        return blk;
    }

    function pathClear(pts, rects) {
        for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1], p1 = pts[i];
            if (p0.x !== p1.x && p0.y !== p1.y) return false;
            if (!segmentClear(p0, p1, rects)) return false;
        }
        return true;
    }

    function fillRectCells(blocked, w, h, rect, G) {
        const cx0 = Math.max(0, Math.floor(rect.x0 / G));
        const cy0 = Math.max(0, Math.floor(rect.y0 / G));
        const cx1 = Math.min(w - 1, Math.floor((rect.x1 - 1e-6) / G));
        const cy1 = Math.min(h - 1, Math.floor((rect.y1 - 1e-6) / G));
        for (let y = cy0; y <= cy1; y++) {
            for (let x = cx0; x <= cx1; x++) {
                blocked[y * w + x] = 1;
            }
        }
    }

    function rectCellMask(rect, w, h, G) {
        const m = new Uint8Array(w * h);
        fillRectCells(m, w, h, rect, G);
        return m;
    }

    function cellOf(p, G) {
        return { x: Math.floor(p.x / G), y: Math.floor(p.y / G) };
    }

    // Геометрический обход для случаев, когда A* не нашёл путь.
    // Всегда вернёт путь (последним — кратчайший L), чтобы не было сквозной прямой через препятствия.
    function fallbackPath(a, b, rects, G, bounds) {
        const STEP = Math.max(G, 8);
        const M = 48;
        const margin = Math.max(2 * G, 24);
        const cands = [];
        const add = (pts) => {
            if (bounds) {
                for (let i = 0; i < pts.length; i++) {
                    const p = pts[i];
                    if (p.x < bounds.x - margin || p.y < bounds.y - margin || p.x > bounds.x1 + margin || p.y > bounds.y1 + margin) return;
                }
            }
            cands.push(pts);
        };
        add([a, { x: b.x, y: a.y }, b]);
        add([a, { x: a.x, y: b.y }, b]);
        for (let k = 1; k <= M; k++) {
            const off = k * STEP;
            const ex1 = a.x - off, ex2 = b.x + off;
            const ey1 = a.y - off, ey2 = b.y + off;
            add([a, { x: ex1, y: a.y }, { x: ex1, y: b.y }, b]);
            add([a, { x: ex2, y: a.y }, { x: ex2, y: b.y }, b]);
            add([a, { x: a.x, y: ey1 }, { x: b.x, y: ey1 }, b]);
            add([a, { x: a.x, y: ey2 }, { x: b.x, y: ey2 }, b]);
            add([a, { x: ex1, y: a.y }, { x: ex1, y: ey2 }, { x: b.x, y: ey2 }, b]);
            add([a, { x: ex2, y: a.y }, { x: ex2, y: ey2 }, { x: b.x, y: ey2 }, b]);
            add([a, { x: a.x, y: ey1 }, { x: ex2, y: ey1 }, { x: ex2, y: b.y }, b]);
            add([a, { x: a.x, y: ey2 }, { x: ex2, y: ey2 }, { x: ex2, y: b.y }, b]);
        }
        let clean = null;
        for (const c of cands) {
            if (pathClear(c, rects)) { clean = c; break; }
        }
        if (!clean) {
            let best = null, bestPen = Infinity;
            for (const c of cands) {
                let pen = 0;
                for (let i = 1; i < c.length; i++) pen += segPenalty(c[i - 1], c[i], rects);
                if (pen < bestPen) { bestPen = pen; best = c; }
            }
            clean = best;
        }
        return clean && clean.length > 1 ? clean : null;
    }

    // --- направление выхода порта ---
    function portDir(port, center, rect) {
        const d = port && port.dataset && port.dataset.dir;
        if (d === 'left' || d === 'right' || d === 'up' || d === 'down') return d;
        const dists = {
            left: center.x - rect.x0,
            right: rect.x1 - center.x,
            up: center.y - rect.y0,
            down: rect.y1 - center.y
        };
        let best = 'left', bv = Infinity;
        const keys = ['left', 'right', 'up', 'down'];
        for (let i = 0; i < keys.length; i++) {
            if (dists[keys[i]] < bv) { bv = dists[keys[i]]; best = keys[i]; }
        }
        return best;
    }

    // --- вынужденный прямой коридор выхода из порта по заданному направлению ---
    // Коридор идёт строго по направлению порта, пока не покинет рамку своего
    // компонента; не заходит на чужой коллайдер.
    function buildCorridor(portPt, dir, ownInfl, ownCells, blocked, w, h, G, bounds) {
        const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
        const dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
        const horizontal = dir === 'left' || dir === 'right';

        const idx = (c) => c.y * w + c.x;
        const pts = [{ x: portPt.x, y: portPt.y }];
        const free = (p) => {
            const c = cellOf(p, G);
            if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) {
                blocked[idx(c)] = 0; // клетки коридора пренадлежат самому проводу
            }
        };
        free(portPt);

        // выводим на линию сетки (центр ячейки по поперечной оси) — стыки будут под прямым углом
        let cur = horizontal
            ? { x: portPt.x, y: gridCenter(portPt.y, G) }
            : { x: gridCenter(portPt.x, G), y: portPt.y };
        if (cur.x !== portPt.x || cur.y !== portPt.y) { pts.push(cur); free(cur); }

        let guard = 0;
        while (guard++ < 2000) {
            const nxt = { x: cur.x + dx * G, y: cur.y + dy * G };
            if (nxt.x < bounds.x || nxt.y < bounds.y || nxt.x > bounds.x1 || nxt.y > bounds.y1) break;
            const c = cellOf(nxt, G);
            if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) break;
            const i = idx(c);
            const insideOwn = ownInfl &&
                nxt.x >= ownInfl.x0 && nxt.x <= ownInfl.x1 &&
                nxt.y >= ownInfl.y0 && nxt.y <= ownInfl.y1;
            if (!insideOwn) {
                if (blocked[i] === 1 && !ownCells[i]) break; // не заходить на чужой коллайдер
                blocked[i] = 0;
                pts.push(nxt); cur = nxt;
                break; // вышли за пределы своего компонента — коридор окончен
            }
            blocked[i] = 0;
            pts.push(nxt); cur = nxt;
        }
        return { points: pts, exit: cur };
    }

    // --- A* с учётом изгибов (4 направления) ---
    function heur(x, y, tx, ty) {
        return Math.abs(x - tx) + Math.abs(y - ty);
    }

    function heapPush(h, item) {
        h.push(item);
        let i = h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (h[p][1] <= h[i][1]) break;
            [h[p], h[i]] = [h[i], h[p]];
            i = p;
        }
    }

    function heapPop(h) {
        if (!h.length) return null;
        const top = h[0];
        const last = h.pop();
        if (h.length) {
            h[0] = last;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let s = i;
                if (l < h.length && h[l][1] < h[s][1]) s = l;
                if (r < h.length && h[r][1] < h[s][1]) s = r;
                if (s === i) break;
                [h[s], h[i]] = [h[i], h[s]];
                i = s;
            }
        }
        return top;
    }

    function reconstructDir(parent, startState, w) {
        const cells = [];
        let st = startState;
        while (st !== -1) {
            cells.push(st >> 2);
            const p = parent[st];
            if (p === -1) break;
            st = p;
        }
        cells.reverse();
        return cells;
    }

    function astarDir(blocked, w, h, sx, sy, tx, ty) {
        const size = w * h;
        const start = sy * w + sx;
        const goal = ty * w + tx;
        if (blocked[goal] && goal !== start) return null;

        const STATES = size * 4;
        const gStates = new Float32Array(STATES).fill(Infinity);
        const parent = new Int32Array(STATES).fill(-1);
        const closed = new Uint8Array(STATES);
        const open = [];

        const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
        const startH = heur(sx, sy, tx, ty);
        const bend = 4;

        for (let d = 0; d < 4; d++) {
            const st = start * 4 + d;
            gStates[st] = 0;
            heapPush(open, [st, startH]);
        }

        while (open.length) {
            const item = heapPop(open);
            const st = item[0];
            if (closed[st]) continue;
            closed[st] = 1;

            const cell = st >> 2;
            const d = st & 3;
            if (cell === goal) return reconstructDir(parent, st, w);

            const cx = cell % w, cy = (cell / w) | 0;
            for (let nd = 0; nd < 4; nd++) {
                const nx = cx + DX[nd], ny = cy + DY[nd];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const ni = ny * w + nx;
                if (blocked[ni]) continue;
                const nst = ni * 4 + nd;
                if (closed[nst]) continue;
                const g = gStates[st] + 1 + (d === nd ? 0 : bend);
                if (g < gStates[nst]) {
                    gStates[nst] = g;
                    parent[nst] = st;
                    heapPush(open, [nst, g + heur(nx, ny, tx, ty)]);
                }
            }
        }
        return null;
    }

    // --- пост-обработка ---
    function relaxPath(pts, rects) {
        let changed = true;
        while (changed && pts.length > 2) {
            changed = false;
            for (let i = 0; i < pts.length - 2; i++) {
                const p = pts[i];
                for (let j = pts.length - 1; j > i + 1; j--) {
                    const q = pts[j];
                    if (p.x !== q.x && p.y !== q.y) continue;
                    if (!segmentClear(p, q, rects)) continue;
                    pts.splice(i + 1, j - i - 1);
                    changed = true;
                    break;
                }
                if (changed) break;
            }
        }
        return pts;
    }

    function ensureOrthogonal(pts, rects) {
        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
            const p0 = out[out.length - 1], p1 = pts[i];
            if (p0.x === p1.x || p0.y === p1.y) {
                out.push(p1);
                continue;
            }
            const c1 = { x: p1.x, y: p0.y };
            const c2 = { x: p0.x, y: p1.y };
            const ok1 = segmentClear(p0, c1, rects) && segmentClear(c1, p1, rects);
            const ok2 = segmentClear(p0, c2, rects) && segmentClear(c2, p1, rects);
            let corner;
            if (ok1 && ok2) {
                corner = c1;
            } else if (ok1) {
                corner = c1;
            } else if (ok2) {
                corner = c2;
            } else {
                // оба угла внутри препятствия — берём менее «занятый», чтобы не класть угол глубже в блок
                const p1_ = segPenalty(p0, c1, rects) + segPenalty(c1, p1, rects);
                const p2_ = segPenalty(p0, c2, rects) + segPenalty(c2, p1, rects);
                corner = p1_ <= p2_ ? c1 : c2;
            }
            out.push(corner, p1);
        }
        return out;
    }

    // --- маршрутизация (избегает коллайдеров компонентов; провода могут пересекаться) ---
    function route(a, b, portA, portB) {
        return routeCore(a, b, portA, portB, SET);
    }

    function routeCore(a, b, portA, portB, OPT) {
        const G = Math.max(2, OPT.gridSize);
        const rects = componentRects();
        const rectA = rects.find(r => r.node === (portA.closest ? portA.closest('.component-svg') : null));
        const rectB = rects.find(r => r.node === (portB.closest ? portB.closest('.component-svg') : null));

        const dirA = portDir(portA, a, rectA);
        const dirB = portDir(portB, b, rectB);

        // Границы сетки покрывают все компоненты (в т.ч. у краёв/за краем окна).
        const mRect = main.getBoundingClientRect();
        let gx1 = mRect.width, gy1 = mRect.height;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.x1 > gx1) gx1 = r.x1;
            if (r.y1 > gy1) gy1 = r.y1;
        }
        const margin = Math.max(2 * G, 24);
        const bounds = { x: 0, y: 0, x1: gx1 + margin, y1: gy1 + margin };
        const w = Math.max(1, Math.ceil(bounds.x1 / G));
        const h = Math.max(1, Math.ceil(bounds.y1 / G));

        const blocked = new Uint8Array(w * h);
        for (let i = 0; i < rects.length; i++) fillRectCells(blocked, w, h, inflate(rects[i], OPT.pad), G);

        const ownInflA = rectA ? inflate(rectA, OPT.pad) : null;
        const ownInflB = rectB ? inflate(rectB, OPT.pad) : null;
        const ownCellsA = rectA ? rectCellMask(ownInflA, w, h, G) : null;
        const ownCellsB = rectB ? rectCellMask(ownInflB, w, h, G) : null;
        const corrA = buildCorridor(a, dirA, ownInflA, ownCellsA, blocked, w, h, G, bounds);
        const corrB = buildCorridor(b, dirB, ownInflB, ownCellsB, blocked, w, h, G, bounds);

        const eA = corrA.exit, eB = corrB.exit;
        const sx = clamp(Math.floor(eA.x / G), 0, w - 1);
        const sy = clamp(Math.floor(eA.y / G), 0, h - 1);
        const tx = clamp(Math.floor(eB.x / G), 0, w - 1);
        const ty = clamp(Math.floor(eB.y / G), 0, h - 1);

        let mid = null, fallbackType = null;
        let diag = { sx, sy, tx, ty };
        const cellsOf = () => {
            if (diag.sx === diag.tx && diag.sy === diag.ty) return [];
            const cells = astarDir(blocked, w, h, diag.sx, diag.sy, diag.tx, diag.ty);
            if (!cells) return null;
            const out = [];
            for (let i = 0; i < cells.length; i++) {
                out.push({ x: ((cells[i] % w) + 0.5) * G, y: (((cells[i] / w) | 0) + 0.5) * G });
            }
            return out;
        };

        mid = cellsOf();
        if (mid === null) {
            // A* не смог: освободим целевую клетку (это и есть точка выхода коридора) и попробуем ещё раз.
            const gi = ty * w + tx;
            if (blocked[gi]) {
                blocked[gi] = 0;
                mid = cellsOf();
                if (mid && mid.length) fallbackType = 'goal-clear';
            }
        }

        const obstacles = [];
        for (let i = 0; i < rects.length; i++) obstacles.push(inflate(rects[i], OPT.pad));

        if (mid === null) {
            const fb = fallbackPath(eA, eB, obstacles, G, bounds);
            mid = fb ? fb.slice(1) : [];
            if (fb && fb.length > 1) fallbackType = 'geom';
        }

        const pts = [];
        appendPoints(pts, corrA.points);
        appendPoints(pts, mid);
        const revB = corrB.points.slice().reverse();
        appendPoints(pts, revB);

        relaxPath(pts, obstacles);
        ensureOrthogonal(pts, obstacles);
        const res = simplify(pts);

        if (DEBUG) {
            debugCapture({ a, b, portA, portB, rects, bounds, corrA, corrB, diag, mid, fallbackType, pts: res });
        }

        return res;
    }

    function simplify(pts) {
        if (pts.length <= 2) return pts;
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            if (i === 0 || i === pts.length - 1) {
                out.push(pts[i]);
                continue;
            }
            const prev = out[out.length - 1], cur = pts[i];
            const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
            let next = pts[i + 1];
            while (next && next.x === cur.x && next.y === cur.y) { i++; next = pts[i + 1]; }
            if (!next) { out.push(cur); break; }
            const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
            const collinear = (dx1 === 0 && dx2 === 0) || (dy1 === 0 && dy2 === 0);
            if (!collinear) out.push(cur);
        }
        return out;
    }

    function appendPoints(arr, add) {
        for (let i = 0; i < add.length; i++) {
            const p = add[i];
            const l = arr[arr.length - 1];
            if (l && Math.abs(l.x - p.x) < 1e-6 && Math.abs(l.y - p.y) < 1e-6) continue;
            arr.push(p);
        }
    }

    // Переподключает ручной провод к новым позициям портов, сохраняя «корпус» (средние точки),
    // которые пользователь нарисовал вручную.
    function reanchorManual(w) {
        const Q = w.points;
        if (!Q || Q.length < 3) return null;
        const a = portCenter(w.p1), b = portCenter(w.p2);
        const rects = componentRects();
        const nA = w.p1.closest ? w.p1.closest('.component-svg') : null;
        const nB = w.p2.closest ? w.p2.closest('.component-svg') : null;
        const rectA = nA ? rects.find(r => r.node === nA) : null;
        const rectB = nB ? rects.find(r => r.node === nB) : null;
        const dirA = portDir(w.p1, a, rectA);
        const dirB = portDir(w.p2, b, rectB);
        const Ahoriz = dirA === 'left' || dirA === 'right';
        const Bhoriz = dirB === 'left' || dirB === 'right';

        const body = Q.slice(1, -1);
        const q1 = body[0], qm = body[body.length - 1];

        const pts = [{ x: a.x, y: a.y }];
        appendPoints(pts, Ahoriz ? [{ x: q1.x, y: a.y }, q1] : [{ x: a.x, y: q1.y }, q1]);
        appendPoints(pts, body);
        appendPoints(pts, Bhoriz ? [{ x: qm.x, y: b.y }, b] : [{ x: b.x, y: qm.y }, b]);
        const res = simplify(pts);
        return res.length >= 2 ? res : null;
    }

    // --- создание провода ---
    function makeWireEl(points) {
        const el = document.createElementNS(NS, 'polyline');
        el.classList.add('wire-path');
        el.setAttribute('points', pointsToStr(points));
        el.addEventListener('mousedown', onWireMouseDown);
        el.addEventListener('mousemove', onWireHover);
        return el;
    }

    function createWire(n1, p1, n2, p2, opts = {}) {
        if (n1 === n2 && p1 === p2) return;
        if (!opts.keep) { removePortWires(p1); removePortWires(p2); }

        const el = makeWireEl(route(portCenter(p1), portCenter(p2), p1, p2));
        const wire = { id: 'w' + (++wireSeq), seq: wireSeq, n1, p1, n2, p2, points: null, manual: false, el };
        el._wire = wire;
        wires.push(wire);
        layer.appendChild(el);

        const saved = manualFor(wire);
        if (saved) {
            wire.points = saved;
            wire.manual = true;
        } else {
            wire.points = route(portCenter(p1), portCenter(p2), p1, p2);
        }
        el.setAttribute('points', pointsToStr(wire.points));
        return wire;
    }

    // --- удаление ---
    function removePortWires(port) {
        for (let i = wires.length - 1; i >= 0; i--) {
            const w = wires[i];
            if (w.p1 === port || w.p2 === port) removeWire(w);
        }
    }

    function removeWire(wire) {
        const i = wires.indexOf(wire);
        if (i >= 0) wires.splice(i, 1);
        if (wire.el) wire.el.remove();
        if (selected === wire) selected = null;
    }

    // Удаляет все провода, подключённые к компоненту (при удалении компонента).
    function removeNodeWires(node) {
        for (let i = wires.length - 1; i >= 0; i--) {
            const w = wires[i];
            if (w.n1 === node || w.n2 === node) removeWire(w);
        }
    }

    // --- выделение / клавиатура ---
    function onWireMouseDown(e) {
        const wireEl = e.target.closest('.wire-path');
        if (!wireEl) return;
        const w = wireEl._wire || null;
        select(w);
        e.preventDefault();
        if (!w || wireDrag) return;
        beginSegmentDrag(w, e);
    }

    function select(wire) {
        if (selected === wire) return;
        if (selected && selected.el) selected.el.classList.remove('wire-selected');
        selected = wire;
        if (selected && selected.el) selected.el.classList.add('wire-selected');
    }

    function deselect() {
        select(null);
    }

    function onDocMouseDown(e) {
        if (selected && !e.target.closest('.wire-path')) deselect();
    }

    function onKeyDown(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
            removeWire(selected);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            deselect();
        }
    }

    // --- перпендикулярный сдвиг сегмента провода ---
    function distToSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = 0;
        if (len2 > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
        const cx = ax + dx * t, cy = ay + dy * t;
        return Math.hypot(px - cx, py - cy);
    }

    function nearestSegment(points, x, y) {
        let best = -1, bestD = Infinity;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const d = distToSeg(x, y, a.x, a.y, b.x, b.y);
            if (d < bestD) { bestD = d; best = i - 1; }
        }
        return bestD <= 8 ? best : -1;
    }

    // Сдвигает сегмент (idx → idx+1) перпендикулярно оси. Возвращает новый индекс «линии».
    function moveSegmentPerp(wire, idx, horiz, val) {
        const pts = wire.points.slice();
        const n = pts.length - 1;
        const setAxis = (p, v) => { if (horiz) { p.y = v; } else { p.x = v; } };
        const getAxis = (p) => (horiz ? p.y : p.x);

        if (getAxis(pts[idx]) === val) return idx;
        if (idx === 0 && idx === n - 1) return idx;

        let newIdx = idx;
        if (idx === 0) {
            const anchor = pts[0]; // портовый конец остаётся на месте
            setAxis(pts[1], val);
            const corner = horiz ? { x: anchor.x, y: val } : { x: val, y: anchor.y };
            pts.splice(1, 0, corner);
            newIdx = 1;
        } else if (idx === n - 1) {
            const anchor = pts[n]; // портовый конец остаётся на месте
            setAxis(pts[n - 1], val);
            const corner = horiz ? { x: anchor.x, y: val } : { x: val, y: anchor.y };
            pts.splice(n, 0, corner);
            newIdx = n - 1;
        } else {
            setAxis(pts[idx], val);
            setAxis(pts[idx + 1], val);
        }

        wire.points = pts;
        if (wire.el) wire.el.setAttribute('points', pointsToStr(pts));
        return newIdx;
    }

    function beginSegmentDrag(w, e) {
        if (!w.points || w.points.length < 3) return;
        const p = toCanvasCoords(e.clientX, e.clientY);
        const idx = nearestSegment(w.points, p.x, p.y);
        if (idx < 0) return;

        const seg = [w.points[idx], w.points[idx + 1]];
        const horiz = seg[0].y === seg[1].y;
        wireDrag = { wire: w, idx, horiz, start: p, axisVal: horiz ? seg[0].y : seg[0].x, moved: false };

        document.addEventListener('mousemove', onWireDragMove);
        document.addEventListener('mouseup', onWireDragUp, { once: true });
    }

    function onWireDragMove(e) {
        if (!wireDrag) return;
        const m = toCanvasCoords(e.clientX, e.clientY);
        const d = wireDrag.horiz ? m.y - wireDrag.start.y : m.x - wireDrag.start.x;
        const G = Math.max(2, SET.gridSize);
        const mRect = main.getBoundingClientRect();
        const limit = wireDrag.horiz ? mRect.height : mRect.width;
        const val = gridCenter(clamp(wireDrag.axisVal + d, 0, limit), G);
        const before = pointsToStr(wireDrag.wire.points);
        wireDrag.idx = moveSegmentPerp(wireDrag.wire, wireDrag.idx, wireDrag.horiz, val);
        if (pointsToStr(wireDrag.wire.points) !== before) wireDrag.moved = true;
    }

    function onWireDragUp() {
        if (!wireDrag) return;
        const w = wireDrag.wire;
        w.points = simplify(w.points);
        if (w.el) w.el.setAttribute('points', pointsToStr(w.points));
        if (wireDrag.moved) {
            w.manual = true;
            saveWireManual(w);
        }
        wireDrag = null;
        document.removeEventListener('mousemove', onWireDragMove);
    }

    function onWireHover(e) {
        const wireEl = e.target.closest('.wire-path');
        if (!wireEl || !wireEl._wire) return;
        const p = toCanvasCoords(e.clientX, e.clientY);
        const idx = nearestSegment(wireEl._wire.points, p.x, p.y);
        if (idx < 0) { wireEl.style.cursor = 'pointer'; return; }
        const seg = [wireEl._wire.points[idx], wireEl._wire.points[idx + 1]];
        wireEl.style.cursor = seg[0].y === seg[1].y ? 'ns-resize' : 'ew-resize';
    }

    // --- рисование связи ---
    function startWiring(node, port, e) {
        const preview = document.createElementNS(NS, 'polyline');
        preview.classList.add('wire-preview');
        layer.appendChild(preview);

        drag = { node, port, start: portCenter(port), preview };
        draggingPort = port;
        port.classList.add('port-wiring-source');

        const move = (ev) => {
            const m = toCanvasCoords(ev.clientX, ev.clientY);
            const a = drag.start;
            const dx = Math.abs(m.x - a.x), dy = Math.abs(m.y - a.y);
            const mid = dx >= dy ? { x: a.x, y: m.y } : { x: m.x, y: a.y };
            drag.preview.setAttribute('points', pointsToStr([a, mid, m]));
            updateTargetHighlight(ev);
        };

        const up = (ev) => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            finishWiring(ev);
        };

        move(e);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    function updateTargetHighlight(ev) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const port = el && el.closest ? el.closest('.port') : null;
        if (port === hoverPort) return;
        if (hoverPort) hoverPort.classList.remove('port-wiring-target');
        hoverPort = port && port !== draggingPort ? port : null;
        if (hoverPort) hoverPort.classList.add('port-wiring-target');
    }

    function finishWiring(ev) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const port = el && el.closest ? el.closest('.port') : null;
        if (drag && drag.preview) drag.preview.remove();
        if (hoverPort) { hoverPort.classList.remove('port-wiring-target'); hoverPort = null; }
        if (draggingPort) { draggingPort.classList.remove('port-wiring-source'); }

        if (port && port !== draggingPort && drag) {
            const node = port.closest('.component-svg');
            if (node) createWire(drag.node, drag.port, node, port);
        }

        drag = null;
        draggingPort = null;
    }

    function onPortMouseDown(e) {
        const port = e.target.closest('.port');
        if (!port) return;
        const node = port.closest('.component-svg');
        if (!node) return;
        e.preventDefault();
        e.stopPropagation(); // не даём начаться перетаскиванию компонента
        startWiring(node, port, e);
    }

    // --- обновление / перетрассировка ---
    // preserveManual: при true ручные провода не трогаем (resize/настройки).
    function routeWire(w, preserveManual) {
        if (preserveManual && w.manual) return;
        const saved = manualFor(w);
        if (saved) {
            w.points = saved;
            w.manual = true;
        } else if (w.manual) {
            const r = reanchorManual(w);
            if (r) {
                w.points = r;
            } else {
                w.points = route(portCenter(w.p1), portCenter(w.p2), w.p1, w.p2);
                w.manual = false;
            }
        } else {
            w.points = route(portCenter(w.p1), portCenter(w.p2), w.p1, w.p2);
        }
        if (w.el) w.el.setAttribute('points', pointsToStr(w.points));
        if (w.manual) saveWireManual(w);
    }

    function refreshNode(node) {
        for (let i = 0; i < wires.length; i++) {
            const w = wires[i];
            if (w.n1 === node || w.n2 === node) routeWire(w, false);
        }
    }

    function refreshAll() {
        for (let i = 0; i < wires.length; i++) routeWire(wires[i], true);
    }

    // Снимок состояния для диагностики (положения элементов в canvas-координатах).
    function dump() {
        const mRect = main.getBoundingClientRect();
        const components = [];
        main.querySelectorAll('.component-svg').forEach(n => {
            const r = n.getBoundingClientRect();
            components.push({
                id: n.dataset ? n.dataset.component : null,
                x0: Math.round(r.left - mRect.left),
                y0: Math.round(r.top - mRect.top),
                x1: Math.round(r.right - mRect.left),
                y1: Math.round(r.bottom - mRect.top)
            });
        });
        const ports = [];
        main.querySelectorAll('.port').forEach(p => {
            const c = portCenter(p);
            ports.push({ id: p.dataset.port, dir: p.dataset.dir, x: Math.round(c.x), y: Math.round(c.y) });
        });
        const wiresOut = wires.map(w => ({
            id: w.id,
            from: { node: w.n1.dataset ? w.n1.dataset.component : null, port: w.p1.dataset.port },
            to: { node: w.n2.dataset ? w.n2.dataset.component : null, port: w.p2.dataset.port },
            points: w.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }))
        }));
        return {
            settings: SET,
            canvas: { width: Math.round(mRect.width), height: Math.round(mRect.height) },
            components,
            ports,
            wires: wiresOut,
            lastRoute: window.__wireDebug ? window.__wireDebug.last : null
        };
    }

    // Снимок сцены для СОХРАНЕНИЯ: компоненты + связи (inst:port -> inst:port).
    function scene() {
        const mRect = main.getBoundingClientRect();
        const components = [];
        main.querySelectorAll('.component-svg').forEach((n) => {
            const r = n.getBoundingClientRect();
            const slot = n.querySelector('svg [data-slot]');
            components.push({
                inst: n.dataset.inst,
                editorId: n.dataset.component,
                etype: n.dataset.etype || null,
                value: n.dataset.compvalue || (slot ? slot.textContent : null),
                x: Math.round(r.left - mRect.left),
                y: Math.round(r.top - mRect.top),
                ports: [...n.querySelectorAll('.port')].map((p) => p.dataset.port),
            });
        });
        const links = wires.map((w) => [
            (w.n1.dataset.inst) + ':' + w.p1.dataset.port,
            (w.n2.dataset.inst) + ':' + w.p2.dataset.port,
        ]);
        return { components, links };
    }

    // Программное создание связи (для загрузки схем). keepExisting=true —
    // допускает несколько проводов на порту (узел-соединение), не удаляя старые.
    function connect(nodeA, portA, nodeB, portB, keepExisting = true) {
        return createWire(nodeA, portA, nodeB, portB, { keep: keepExisting });
    }

    // Удалить все провода (перед открытием/новой схемой).
    function clear() {
        for (let i = wires.length - 1; i >= 0; i--) removeWire(wires[i]);
    }

    function init() {
        ensureLayer();
        main.addEventListener('mousedown', onPortMouseDown, true);
        layer.addEventListener('mousedown', onWireMouseDown);
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', refreshAll);
        window.addEventListener('storage', (e) => {
            if (e.key === WIRE_SETTINGS_KEY) { reloadSettings(); refreshAll(); }
        });
    }

    init();

    window.__ewrWireDump = dump;
    return { init, refreshNode, refreshAll, removeNodeWires, dump, connect, scene, clear };
})();

export default WireSystem;