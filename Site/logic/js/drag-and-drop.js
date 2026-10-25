import { getComponent, loadComponent, buildComponentNode, buildDragCursor } from './registry.js';
import ComponentMenu from './component-menu.js';
import WireSystem from './wires.js';

const category_menu = document.getElementById('category-menu')
const main_windows = document.getElementById('main-windows')

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
    const parentRect = main_windows.getBoundingClientRect();

    for (const item of clipboard) {
        const node = await buildComponentNode(item.id, item.values);
        if (!node) continue;
        node.style.position = 'absolute';

        const w = parseFloat(node.style.width) || 0;
        const h = parseFloat(node.style.height) || 0;
        let x = item.x + clipboardOffset;
        let y = item.y + clipboardOffset;
        x = Math.max(0, Math.min(x, parentRect.width - w));
        y = Math.max(0, Math.min(y, parentRect.height - h));

        main_windows.appendChild(node);
        node.style.left = x + 'px';
        node.style.top = y + 'px';

        let tries = 0;
        while (tries++ < 12 && collidesWithPlaced(node)) {
            x = Math.max(0, Math.min(x + 40, parentRect.width - w));
            y = Math.max(0, Math.min(y + 40, parentRect.height - h));
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
        const relativeX = e.clientX - rect.left - offsetX;
        const relativeY = e.clientY - rect.top - offsetY;

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
            main_windows.appendChild(newElement);
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
    const mainRect = main_windows.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    const nx = nr.left - mainRect.left, ny = nr.top - mainRect.top;
    const n = { x0: nx, y0: ny, x1: nx + nr.width, y1: ny + nr.height };
    for (const el of main_windows.children) {
        if (el === node) continue;
        if (ignore && ignore.has(el)) continue;
        if (el.classList && (el.classList.contains('wire-layer') || el.classList.contains('debug-overlay'))) continue;
        const r = el.getBoundingClientRect();
        const ox = r.left - mainRect.left, oy = r.top - mainRect.top;
        const o = { x0: ox, y0: oy, x1: ox + r.width, y1: oy + r.height };
        if (n.x1 >= o.x0 && n.x0 <= o.x1 && n.y1 >= o.y0 && n.y0 <= o.y1) return true;
    }
    return false;
}

async function placeComponent(id, x, y) {
    const node = await buildComponentNode(id);
    if (!node) return;
    node.style.position = 'absolute';
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    main_windows.appendChild(node);

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
    const rect = main_windows.getBoundingClientRect();
    marqueeState = {
        x0: e.clientX - rect.left,
        y0: e.clientY - rect.top,
        x1: e.clientX - rect.left,
        y1: e.clientY - rect.top,
        moved: false
    };
    marqueeBox = document.createElement('div');
    marqueeBox.className = 'selection-box';
    main_windows.appendChild(marqueeBox);
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
    const rect = main_windows.getBoundingClientRect();
    marqueeState.x1 = e.clientX - rect.left;
    marqueeState.y1 = e.clientY - rect.top;
    if (Math.hypot(marqueeState.x1 - marqueeState.x0, marqueeState.y1 - marqueeState.y0) > CLICK_THRESHOLD) {
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

    const mainRect = main_windows.getBoundingClientRect();
    const x0 = Math.min(st.x0, st.x1), y0 = Math.min(st.y0, st.y1);
    const x1 = Math.max(st.x0, st.x1), y1 = Math.max(st.y0, st.y1);
    const box = { x0, y0, x1, y1 };

    main_windows.querySelectorAll('.component-svg').forEach(n => {
        const r = n.getBoundingClientRect();
        const nr = {
            x0: r.left - mainRect.left,
            y0: r.top - mainRect.top,
            x1: r.right - mainRect.left,
            y1: r.bottom - mainRect.top
        };
        if (nr.x1 >= box.x0 && nr.x0 <= box.x1 && nr.y1 >= box.y0 && nr.y0 <= box.y1) {
            addNodeSelection(n);
        }
    });
    setStatus('Выделено: ' + selectedNodes.size);
}

main_windows.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest('.component-svg') || t.closest('.port') || t.closest('.wire-path')) return;
    if (t.closest && (t.closest('.wire-layer') || t.closest('.debug-overlay'))) return;
    beginMarquee(e);
});

// Функция для создания перетаскиваемых элементов внутри main_windows
function makeDraggable(element) {
    let isDragging = false;
    let didMove = false;
    let startX, startY;
    let startPositions = new Map();
    let dragModifier = false;
    let dragAlreadySelected = false;

    element.addEventListener('mousedown', function(e) {
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

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        if (!didMove && Math.hypot(deltaX, deltaY) > CLICK_THRESHOLD) {
            didMove = true;
        }

        const parentRect = main_windows.getBoundingClientRect();
        const multi = selectedNodes.size > 1;

        for (const n of selectedNodes) {
            const base = startPositions.get(n);
            if (!base) continue;
            const rect = n.getBoundingClientRect();

            let newX = base.x + deltaX;
            let newY = base.y + deltaY;
            newX = Math.max(0, Math.min(newX, parentRect.width - rect.width));
            newY = Math.max(0, Math.min(newY, parentRect.height - rect.height));

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