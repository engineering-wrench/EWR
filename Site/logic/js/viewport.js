// Бесконечное поле редактора: мировые координаты + масштаб/панорама.
//
// Устройство:
//   #main-windows (viewport, overflow: hidden)
//     └─ .canvas-world (бесконечная плоскость, CSS transform)
//          ├─ .component-svg …  (position: absolute, мировые px)
//          ├─ svg.wire-layer    (провода в мировых px)
//          └─ .debug-overlay    (диагностика, ?debug=1)
//
// Преобразование: screen = world * scale + pan (относительно #main-windows).
// Поэтому элементы и порты масштабируются единообразно (без искажений),
// а координаты в модели сцены всегда остаются мировыми.

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DEFAULT_SCALE = 2;
const ZOOM_STEP = 1.2;
const PAN_STEP = 60;

const main = typeof document !== 'undefined' ? document.getElementById('main-windows') : null;

const state = {
    scale: DEFAULT_SCALE,
    x: 0,
    y: 0,
};

let world = null;
const listeners = new Set();

function clampScale(v) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
}

function apply() {
    if (!world) return;
    world.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    // Порты остаются читаемыми: их размер компенсируется обратным масштабом
    // (в разумных пределах), но позиции не меняются — привязка к выводам точная.
    if (main) {
        const inv = Math.min(4, Math.max(0.15, 1 / state.scale));
        main.style.setProperty('--ewr-port-scale', String(inv));
    }
    for (const fn of listeners) {
        try { fn(getState()); } catch (e) { /* подписчик не должен ломать вид */ }
    }
}

// Текущее состояние масштаба/панорамы (копия).
function getState() {
    return { scale: state.scale, x: state.x, y: state.y };
}

// Экранные (client) координаты → мировые.
function screenToWorld(clientX, clientY) {
    if (!main) return { x: clientX, y: clientY };
    const r = main.getBoundingClientRect();
    return {
        x: (clientX - r.left - state.x) / state.scale,
        y: (clientY - r.top - state.y) / state.scale,
    };
}

// Мировые координаты → экранные (client).
function worldToScreen(x, y) {
    if (!main) return { x, y };
    const r = main.getBoundingClientRect();
    return {
        x: r.left + state.x + x * state.scale,
        y: r.top + state.y + y * state.scale,
    };
}

// Масштаб с сохранением точки под курсором (clientX/clientY).
function zoomAt(factor, clientX, clientY) {
    const next = clampScale(state.scale * factor);
    if (next === state.scale) return state.scale;

    const rect = main ? main.getBoundingClientRect() : { left: 0, top: 0 };
    const px = (clientX != null ? clientX : rect.left + rect.width / 2) - rect.left;
    const py = (clientY != null ? clientY : rect.top + rect.height / 2) - rect.top;

    // мировая точка под курсором остаётся на месте
    const wx = (px - state.x) / state.scale;
    const wy = (py - state.y) / state.scale;
    state.scale = next;
    state.x = px - wx * next;
    state.y = py - wy * next;
    apply();
    return state.scale;
}

function zoomIn(clientX, clientY) {
    return zoomAt(ZOOM_STEP, clientX, clientY);
}

function zoomOut(clientX, clientY) {
    return zoomAt(1 / ZOOM_STEP, clientX, clientY);
}

function setZoom(scale, anchor) {
    const target = clampScale(scale);
    return zoomAt(target / state.scale, anchor && anchor.clientX, anchor && anchor.clientY);
}

// Сброс к 100 % и исходной панораме.
function resetZoom() {
    state.scale = DEFAULT_SCALE;
    state.x = 0;
    state.y = 0;
    apply();
}

// Сдвиг панорамы в экранных пикселях.
function panBy(dx, dy) {
    state.x += dx;
    state.y += dy;
    apply();
}

// Центрировать мир на указанной мировой точке (или на содержимом).
function centerOn(x, y) {
    if (!main) return;
    const rect = main.getBoundingClientRect();
    state.x = rect.width / 2 - x * state.scale;
    state.y = rect.height / 2 - y * state.scale;
    apply();
}

function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function isEditableTarget(t) {
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

// --- создание мира и обработчики ---
if (main) {
    world = document.createElement('div');
    world.className = 'canvas-world';
    main.appendChild(world);

    // Колесо мыши — масштаб вокруг курсора.
    main.addEventListener('wheel', (e) => {
        // Не перехватываем колесо над меню/панелью масштаба.
        if (e.target.closest && e.target.closest('.zoom-controls')) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    // Панорама: ПКМ (или средняя кнопка) + перетаскивание.
    let panning = null;
    main.addEventListener('mousedown', (e) => {
        if (e.button !== 2 && e.button !== 1) return;
        if (e.target.closest && e.target.closest('.zoom-controls')) return;
        panning = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
        main.classList.add('is-panning');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!panning) return;
        panBy(e.clientX - panning.lastX, e.clientY - panning.lastY);
        panning.lastX = e.clientX;
        panning.lastY = e.clientY;
    });

    document.addEventListener('mouseup', () => {
        if (!panning) return;
        panning = null;
        main.classList.remove('is-panning');
    });

    main.addEventListener('contextmenu', (e) => e.preventDefault());

    // Стрелки — панорама; Shift ускоряет.
    document.addEventListener('keydown', (e) => {
        if (isEditableTarget(e.target)) return;
        const step = (e.shiftKey ? PAN_STEP * 4 : PAN_STEP);
        if (e.key === 'ArrowLeft') { panBy(step, 0); }
        else if (e.key === 'ArrowRight') { panBy(-step, 0); }
        else if (e.key === 'ArrowUp') { panBy(0, step); }
        else if (e.key === 'ArrowDown') { panBy(0, -step); }
        else return;
        e.preventDefault();
    });

    // Кнопки масштаба (если присутствуют в разметке).
    const controls = document.getElementById('zoom-controls');
    if (controls) {
        controls.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-zoom]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = btn.dataset.zoom;
            if (mode === 'in') zoomIn();
            else if (mode === 'out') zoomOut();
            else resetZoom();
        });
        const label = controls.querySelector('[data-zoom-label]');
        onChange((s) => {
            if (label) label.textContent = Math.round(s.scale * 100) + '%';
        });
        if (label) label.textContent = Math.round(state.scale * 100) + '%';
    }

    apply();
}

export {
    MIN_SCALE,
    MAX_SCALE,
    DEFAULT_SCALE,
    world,
    getState,
    screenToWorld,
    worldToScreen,
    zoomAt,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
    panBy,
    centerOn,
    onChange,
};

export default {
    MIN_SCALE,
    MAX_SCALE,
    DEFAULT_SCALE,
    world,
    getState,
    screenToWorld,
    worldToScreen,
    zoomAt,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
    panBy,
    centerOn,
    onChange,
};
