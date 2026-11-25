import { getComponent, loadComponent, buildComponentNode, buildDragCursor } from './registry.js';
import ComponentMenu from './component-menu.js';
import WireSystem from './wires.js';
import V from './viewport.js';

const category_menu = document.getElementById('category-menu')
const main_windows = document.getElementById('main-windows')

// Бесконечное поле, в котором живут компоненты и провода.
const world = V.world;

function host() {
    return world || main_windows;
}

// Прямоугольник компонента в мировых координатах (не зависит от масштаба).
function nodeRectWorld(node) {
    const left = parseFloat(node.style.left);
    const top = parseFloat(node.style.top);
    const width = parseFloat(node.style.width);
    const height = parseFloat(node.style.height);
    const x0 = Number.isFinite(left) ? left : node.offsetLeft;
    const y0 = Number.isFinite(top) ? top : node.offsetTop;
    const w = Number.isFinite(width) ? width : node.offsetWidth;
    const h = Number.isFinite(height) ? height : node.offsetHeight;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
}

let draggedElement = null;
let cloneElement = null;
let offsetX = 0, offsetY = 0;

const CLICK_THRESHOLD = 5;

// --- множественное выделение компонентов ---
const selectedNodes = new Set();
let clipboard = [];
let clipboardOffset = 0;

function selectOnly(node) {
    if (selectedNodes.size === 1 && selectedNodes.has(node)) return;
    clearSelection();
    selectedNodes.add(node);
    node.classList.add('component-selected');
}

function addNodeSelection(node) {
    if (!selectedNodes.has(node)) {
        selectedNodes.add(node);
        node.classList.add('component-selected');
    }
}

function toggleNodeSelection(node) {
    if (selectedNodes.has(node)) {
        selectedNodes.delete(node);
        node.classList.remove('component-selected');
    } else {
        selectedNodes.add(node);
        node.classList.add('component-selected');
    }
}

function clearSelection() {
    for (const n of selectedNodes) n.classList.remove('component-selected');
    selectedNodes.clear();
}

function isNodeSelected(node) {
    return selectedNodes.has(node);
}

function deleteSelectedComponents() {
    if (!selectedNodes.size) return;
    const count = selectedNodes.size;
    ComponentMenu.close();
    for (const n of [...selectedNodes]) {
        WireSystem.removeNodeWires(n);
        n.remove();
    }
    selectedNodes.clear();
    setStatus('Удалено: ' + count);
}

function copySelectedComponents() {
    if (!selectedNodes.size) return;
    clipboard = [...selectedNodes].map(node => {
        const svg = node.querySelector('svg');
        const values = {};
        if (svg) {
            svg.querySelectorAll('[data-slot]').forEach(s => {
                values[s.getAttribute('data-slot')] = s.textContent;
            });
        }
        return {
            id: node.dataset.component,
            x: parseFloat(node.style.left) || 0,
            y: parseFloat(node.style.top) || 0,
            values
        };
    });
    clipboardOffset = 20;
    setStatus('Скопировано: ' + clipboard.length);
}

async function pasteClipboard() {
    if (!clipboard.length) return;
    clearSelection();

    for (const item of clipboard) {
        const node = await buildComponentNode(item.id, item.values);
        if (!node) continue;
        node.style.position = 'absolute';

        let x = item.x + clipboardOffset;
        let y = item.y + clipboardOffset;

        host().appendChild(node);
        node.style.left = x + 'px';
        node.style.top = y + 'px';

        let tries = 0;
        while (tries++ < 12 && collidesWithPlaced(node)) {
            x += 40;
            y += 40;
            node.style.left = x + 'px';
            node.style.top = y + 'px';
        }

        makeDraggable(node);
        addNodeSelection(node);
    }
    clipboardOffset += 20;
    if (clipboard.length) setStatus('Вставлено: ' + clipboard.length);
}

ComponentMenu.init();

category_menu.addEventListener('click', function(event) {
    const target = event.target;
    if (target === category_menu) return;

    if (category_menu.contains(target)) {
        const id = target.dataset.component || target.id;
        const component = getComponent(id);

        if (component) {
            const cursor = buildDragCursor(id);
            if (cursor) {
                cloneElement = cursor;
            } else {
                cloneElement = target.cloneNode(true);
            }
        } else {
            cloneElement = target.cloneNode(true);
        }

        cloneElement.style.position = 'fixed';
        cloneElement.style.opacity = '0.8';
        cloneElement.style.zIndex = '1000';
        cloneElement.style.cursor = 'grabbing';
        cloneElement.style.pointerEvents = 'none';

        document.body.appendChild(cloneElement);
        draggedElement = target;

        const rect = target.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;

        cloneElement.style.left = (event.clientX - offsetX) + 'px';
        cloneElement.style.top = (event.clientY - offsetY) + 'px';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
});

function onMouseMove(e) {
    if (!cloneElement) return;

    cloneElement.style.left = (e.clientX - offsetX) + 'px';
    cloneElement.style.top = (e.clientY - offsetY) + 'px';
}

async function onMouseUp(e) {
    if (!cloneElement) return;

    const rect = main_windows.getBoundingClientRect();
    const isOverMainWindows = e.clientX >= rect.left &&
                              e.clientX <= rect.right &&
                              e.clientY >= rect.top &&
                              e.clientY <= rect.bottom;

    if (main_windows && isOverMainWindows) {
        // Экран → мировые координаты: точка под курсором, смещённая на
        // «схваченный» угол плитки (смещение тоже переводим в мировые px).
        const scaleNow = V.getState().scale;
        const p = V.screenToWorld(e.clientX, e.clientY);
        const relativeX = p.x - offsetX / scaleNow;
        const relativeY = p.y - offsetY / scaleNow;

        const id = draggedElement.dataset.component || draggedElement.id;
        let component = getComponent(id);
        if (!component && id && id !== '???') {
            component = await loadComponent(id).catch(() => null);
        }

        if (component) {
            await placeComponent(id, relativeX, relativeY);
        } else {
            const newElement = draggedElement.cloneNode(true);
            newElement.style.position = 'absolute';
            newElement.style.left = relativeX + 'px';
            newElement.style.top = relativeY + 'px';
            newElement.style.cursor = 'move';
            host().appendChild(newElement);
            if (collidesWithPlaced(newElement)) {
                newElement.remove();
                setStatus('Нельзя разместить: пересечение с другим компонентом');
            } else {
                makeDraggable(newElement);
            }
        }
    }

    cloneElement.remove();
    cloneElement = null;
    draggedElement = null;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
}

function setStatus(text) {
    const st = document.getElementById('status');
    if (st) st.textContent = text;
}

function collidesWithPlaced(node, ignore) {
    const nr = nodeRectWorld(node);
    const n = { x0: nr.x0, y0: nr.y0, x1: nr.x1, y1: nr.y1 };
    for (const el of host().children) {
        if (el === node) continue;
        if (ignore && ignore.has(el)) continue;
        if (el.classList && (el.classList.contains('wire-layer') || el.classList.contains('debug-overlay'))) continue;
        if (!el.classList || !el.classList.contains('component-svg')) continue;
        const o = nodeRectWorld(el);
        if (n.x1 >= o.x0 && n.x0 <= o.x1 && n.y1 >= o.y0 && n.y0 <= o.y1) return true;
    }
    return false;
}

async function placeComponent(id, x, y) {
    const node = await buildComponentNode(id);
    if (!node) return;
    // Поле бесконечное: не прижимаем к краям вьюпорта.
    node.style.position = 'absolute';
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    host().appendChild(node);

    if (collidesWithPlaced(node)) {
        node.remove();
        setStatus('Нельзя разместить: пересечение с другим компонентом');
        return;
    }

    makeDraggable(node);
    node.style.opacity = '0';
    setTimeout(() => {
        node.style.transition = 'opacity 0.2s';
        node.style.opacity = '1';
    }, 10);
}

// --- рамка выделения (кладём мышью по пустому месту рабочей области) ---
let marqueeBox = null;
let marqueeState = null;

function updateMarquee() {
    if (!marqueeBox || !marqueeState) return;
    const x0 = Math.min(marqueeState.x0, marqueeState.x1);
    const y0 = Math.min(marqueeState.y0, marqueeState.y1);
    const x1 = Math.max(marqueeState.x0, marqueeState.x1);
    const y1 = Math.max(marqueeState.y0, marqueeState.y1);
    marqueeBox.style.left = x0 + 'px';
    marqueeBox.style.top = y0 + 'px';
    marqueeBox.style.width = (x1 - x0) + 'px';
    marqueeBox.style.height = (y1 - y0) + 'px';
}

function beginMarquee(e) {
    const p = V.screenToWorld(e.clientX, e.clientY);
    marqueeState = {
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        moved: false
    };
    marqueeBox = document.createElement('div');
    marqueeBox.className = 'selection-box';
    host().appendChild(marqueeBox);
    updateMarquee();

    const move = (ev) => moveMarquee(ev);
    const up = (ev) => {
        endMarquee(ev);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
}

function moveMarquee(e) {
    if (!marqueeState) return;
    const p = V.screenToWorld(e.clientX, e.clientY);
    marqueeState.x1 = p.x;
    marqueeState.y1 = p.y;
    if (Math.hypot(marqueeState.x1 - marqueeState.x0, marqueeState.y1 - marqueeState.y0) > CLICK_THRESHOLD / V.getState().scale) {
        marqueeState.moved = true;
    }
    updateMarquee();
}

function endMarquee(e) {
    if (marqueeBox) { marqueeBox.remove(); marqueeBox = null; }
    const st = marqueeState;
    marqueeState = null;
    if (!st) return;

    const additive = e.ctrlKey || e.metaKey || e.shiftKey;

    if (!st.moved) {
        if (!additive) clearSelection();
        return;
    }

    if (!additive) clearSelection();

    const x0 = Math.min(st.x0, st.x1), y0 = Math.min(st.y0, st.y1);
    const x1 = Math.max(st.x0, st.x1), y1 = Math.max(st.y0, st.y1);
    const box = { x0, y0, x1, y1 };

    host().querySelectorAll('.component-svg').forEach(n => {
        const nr = nodeRectWorld(n);
        if (nr.x1 >= box.x0 && nr.x0 <= box.x1 && nr.y1 >= box.y0 && nr.y0 <= box.y1) {
            addNodeSelection(n);
        }
    });
    setStatus('Выделено: ' + selectedNodes.size);
}

main_windows.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return; // ПКМ/СКМ — панорама (viewport.js)
    const t = e.target;
    if (t.closest && t.closest('.zoom-controls')) return;
    if (t.closest('.component-svg') || t.closest('.port') || t.closest('.wire-path')) return;
    if (t.closest && (t.closest('.wire-layer') || t.closest('.debug-overlay'))) return;
    beginMarquee(e);
});

// Функция для создания перетаскиваемых элементов внутри main_windows
function makeDraggable(element) {
    let isDragging = false;
    let didMove = false;
    let startX, startY;
    let startWorld = null;
    let startPositions = new Map();
    let dragModifier = false;
    let dragAlreadySelected = false;

    element.addEventListener('mousedown', function(e) {
        // ПКМ/СКМ — панорама поля (viewport.js), не перетаскивание компонента.
        if (e.button !== 0) return;
        if (element.contains(e.target)) {
            dragModifier = e.ctrlKey || e.metaKey || e.shiftKey;
            dragAlreadySelected = isNodeSelected(element);

            if (dragModifier) {
                addNodeSelection(element);
            } else if (!dragAlreadySelected) {
                selectOnly(element);
            }

            isDragging = true;
            didMove = false;
            startX = e.clientX;
            startY = e.clientY;
            startWorld = V.screenToWorld(e.clientX, e.clientY);

            startPositions.clear();
            for (const n of selectedNodes) {
                startPositions.set(n, { x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0 });
            }

            element.style.cursor = 'grabbing';
            element.style.zIndex = '1000';

            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;

        if (!didMove && Math.hypot(e.clientX - startX, e.clientY - startY) > CLICK_THRESHOLD) {
            didMove = true;
        }

        // Дельта в мировых координатах — при любом масштабе курсор и элемент
        // движутся синхронно (без «убегания» на zoom ≠ 100 %).
        const cur = V.screenToWorld(e.clientX, e.clientY);
        const deltaX = cur.x - startWorld.x;
        const deltaY = cur.y - startWorld.y;
        const multi = selectedNodes.size > 1;

        for (const n of selectedNodes) {
            const base = startPositions.get(n);
            if (!base) continue;

            const newX = base.x + deltaX;
            const newY = base.y + deltaY;

            const prevLeft = n.style.left;
            const prevTop = n.style.top;
            n.style.left = newX + 'px';
            n.style.top = newY + 'px';

            if (collidesWithPlaced(n, multi ? selectedNodes : null)) {
                // Не даём пересечению компонентов: возвращаемся на последнюю свободную позицию
                n.style.left = prevLeft;
                n.style.top = prevTop;
            } else {
                WireSystem.refreshNode(n);
            }
        }
    });

    document.addEventListener('mouseup', function(e) {
        if (!isDragging) return;
        const wasClick = !didMove;
        isDragging = false;
        element.style.cursor = 'move';
        element.style.zIndex = '';

        if (wasClick) {
            if (dragModifier) {
                if (dragAlreadySelected) {
                    toggleNodeSelection(element);
                }
            } else {
                selectOnly(element);
                const component = getComponent(element.dataset.component);
                ComponentMenu.open(element, component, { x: e.clientX, y: e.clientY });
            }
        }
    });
}

// Клавиатура: Delete/Backspace — удалить группу, Escape — снять выделение,
// Ctrl/Cmd+C — копировать, Ctrl/Cmd+V — вставить.
document.addEventListener('keydown', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.size) {
        e.preventDefault();
        deleteSelectedComponents();
    } else if (e.key === 'Escape') {
        clearSelection();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        copySelectedComponents();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        pasteClipboard();
    }
});