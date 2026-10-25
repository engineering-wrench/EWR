window.App = (function () {
    const ns = 'http://www.w3.org/2000/svg';
    const $ = (id) => document.getElementById(id);

    const state = {
        tool: 'select',
        toolProps: { stroke: '#111111', fill: '#ffffff', width: 2, fontSize: 16 },
        viewBox: { x: 0, y: 0, w: 1000, h: 1000 },
        crop: { x: 100, y: 100, w: 800, h: 800 },
        selected: null,
        selectedType: null,
        drag: null,
        ports: [],
        bg: { el: null, naturalW: 0, naturalH: 0 }
    };

    const refs = {};

    function svgEl(tag, attrs) {
        const el = document.createElementNS(ns, tag);
        if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    function clientToSvg(cx, cy) {
        const rect = refs.svg.getBoundingClientRect();
        const { w, h } = state.viewBox;
        const scale = Math.min(rect.width / w, rect.height / h);
        const ox = (rect.width - w * scale) / 2;
        const oy = (rect.height - h * scale) / 2;
        return { x: (cx - rect.left - ox) / scale, y: (cy - rect.top - oy) / scale };
    }

    function hitTestShape(x, y) {
        const pt = refs.svg.createSVGPoint();
        pt.x = x; pt.y = y;
        const children = Array.from(refs.shapes.children);
        for (let i = children.length - 1; i >= 0; i--) {
            const el = children[i];
            if (el.tagName === 'text') {
                const b = el.getBBox();
                if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return el;
                continue;
            }
            if (el.isPointInFill && el.isPointInFill(pt)) return el;
            if (el.isPointInStroke && el.isPointInStroke(pt)) return el;
        }
        return null;
    }

    function updateSelectionBox() {
        if (!state.selected || state.selectedType !== 'shape') return;
        const b = state.selected.getBBox();
        if (!b) return;
        const box = refs.selBox;
        box.setAttribute('x', b.x - 4);
        box.setAttribute('y', b.y - 4);
        box.setAttribute('width', b.width + 8);
        box.setAttribute('height', b.height + 8);
    }

    function selectShape(el) {
        state.selected = el;
        state.selectedType = 'shape';
        refs.selUI.style.display = '';
        updateSelectionBox();
        App.ports.clearSelected();
        App.renderProps();
    }

    function selectPort(port) {
        state.selected = port;
        state.selectedType = 'port';
        refs.selUI.style.display = 'none';
        App.ports.clearSelected();
        if (port && port.el) port.el.classList.add('port-selected');
        App.renderProps();
        App.ports.renderList && App.ports.renderList();
    }

    function deselect() {
        if (state.selected && state.selectedType === 'port' && state.selected.el) {
            state.selected.el.classList.remove('port-selected');
        }
        state.selected = null;
        state.selectedType = null;
        refs.selUI.style.display = 'none';
        App.renderProps();
    }

    function setStatus(text) {
        $('status-text').textContent = text;
    }

    function setTool(tool) {
        state.tool = tool;
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    // ---------- события ----------
    function onMouseDown(e) {
        if (e.button !== 0) return;
        const pt = clientToSvg(e.clientX, e.clientY);

        if (state.tool === 'select') {
            const bgEl = state.bg.el;
            if (bgEl && e.target === bgEl) {
                state.drag = { mode: 'bgMove', start: pt, bgX: Number(bgEl.getAttribute('x')), bgY: Number(bgEl.getAttribute('y')) };
                e.preventDefault();
                return;
            }
            const port = App.ports.portAt(pt);
            if (port) {
                selectPort(port);
                state.drag = { mode: 'portMove', port, start: pt };
                e.preventDefault();
                return;
            }
            const el = hitTestShape(pt.x, pt.y);
            if (el) {
                selectShape(el);
                state.drag = { mode: 'shapeMove', el, start: pt };
                e.preventDefault();
            } else {
                deselect();
            }
        } else if (state.tool === 'port') {
            const port = App.ports.portAt(pt);
            if (port) {
                selectPort(port);
                state.drag = { mode: 'portMove', port, start: pt };
            } else {
                selectPort(App.ports.addPort(pt));
                state.drag = { mode: 'portMove', port: state.selected, start: pt };
            }
            e.preventDefault();
        } else if (state.tool === 'text') {
            App.tools.startText(pt);
        } else {
            App.tools.startDraw(state.tool, pt);
        }
    }

    function onMouseMove(e) {
        const d = state.drag;
        if (!d) return;
        const pt = clientToSvg(e.clientX, e.clientY);

        if (d.mode === 'draw') {
            App.tools.updateDraw(d, pt);
        } else if (d.mode === 'shapeMove') {
            d.el.setAttribute('transform', `translate(${pt.x - d.start.x} ${pt.y - d.start.y})`);
            updateSelectionBox();
        } else if (d.mode === 'portMove') {
            App.ports.movePort(d.port, pt.x, pt.y);
        } else if (d.mode === 'bgMove') {
            App.background.moveTo(pt.x - d.start.x + d.bgX, pt.y - d.start.y + d.bgY);
        }
    }

    function onMouseUp() {
        const d = state.drag;
        if (!d) return;
        if (d.mode === 'draw') App.tools.endDraw(d);
        state.drag = null;
    }

    function onKey(e) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        const map = { v: 'select', l: 'line', r: 'rect', c: 'circle', t: 'text', p: 'port' };
        if (map[e.key.toLowerCase()]) {
            setTool(map[e.key.toLowerCase()]);
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.selectedType === 'shape') {
                state.selected.remove();
                deselect();
            } else if (state.selectedType === 'port') {
                App.ports.removePort(state.selected);
                deselect();
            }
        }
        if (e.key === 'Escape') deselect();
    }

    // ---------- свойства ----------
    function renderProps() {
        const form = $('prop-form');
        const empty = $('props-empty');
        form.innerHTML = '';
        empty.style.display = 'none';

        if (!state.selected) {
            empty.style.display = '';
            return;
        }

        if (state.selectedType === 'port') {
            form.innerHTML = '<p class="sp-hint">Точка подключения. Параметры — во вкладке «Порты».</p>';
            return;
        }

        const el = state.selected;
        const rows = [];

        if (el.tagName === 'text') {
            const content = makeField('Текст', 'text', el.textContent, v => { el.textContent = v; });
            const fontSize = makeField('Размер шрифта', 'number', el.getAttribute('font-size') || state.toolProps.fontSize, v => el.setAttribute('font-size', v));
            const slot = makeField('data-slot (пусто = нет)', 'text', el.getAttribute('data-slot') || '', v => {
                if (v) el.setAttribute('data-slot', v); else el.removeAttribute('data-slot');
            });
            rows.push(['text', content], ['fontsize', fontSize], ['slot', slot]);
        } else {
            const fill = makeField('Заливка', 'color', el.getAttribute('fill') || 'none', v => el.setAttribute('fill', v || 'none'));
            const stroke = makeField('Обводка', 'color', el.getAttribute('stroke') || '#111111', v => el.setAttribute('stroke', v));
            const width = makeField('Толщина', 'number', el.getAttribute('stroke-width') || state.toolProps.width, v => el.setAttribute('stroke-width', v));
            rows.push(['fill', fill], ['stroke', stroke], ['width', width]);
        }

        rows.forEach(([key, html]) => {
            const div = document.createElement('div');
            div.className = 'row';
            div.innerHTML = `<span>${labelText(key)}</span>${html}`;
            form.appendChild(div);
        });

        const del = document.createElement('button');
        del.className = 'tool-btn wide danger';
        del.textContent = 'Удалить элемент';
        del.onclick = () => { el.remove(); deselect(); };
        form.appendChild(del);

        bindFields(form);
    }

    function labelText(key) {
        return { fill: 'Заливка', stroke: 'Обводка', width: 'Толщина', text: 'Текст', fontsize: 'Размер шрифта', slot: 'data-slot' }[key] || key;
    }

    function makeField(label, type, value, apply) {
        const attrs = `class="${type === 'number' ? 'tb-num' : ''}" `;
        if (type === 'number') return `<input type="number" value="${escapeAttr(value)}" min="0" max="999" data-apply="${escapeAttr(label)}" ${attrs}/>`;
        if (type === 'color') return `<input type="color" value="${value || '#000000'}" data-apply="${escapeAttr(label)}"/>`;
        return `<input type="text" value="${escapeAttr(value)}" data-apply="${escapeAttr(label)}" ${attrs}/>`;
    }

    function escapeAttr(v) {
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function bindFields(container) {
        const applyMap = {
            'Заливка': v => state.selected.setAttribute('fill', v || 'none'),
            'Обводка': v => state.selected.setAttribute('stroke', v),
            'Толщина': v => state.selected.setAttribute('stroke-width', v),
            'Текст': v => { state.selected.textContent = v; },
            'Размер шрифта': v => state.selected.setAttribute('font-size', v),
            'data-slot': v => {
                if (v) state.selected.setAttribute('data-slot', v); else state.selected.removeAttribute('data-slot');
            }
        };
        container.querySelectorAll('[data-apply]').forEach(inp => {
            inp.addEventListener('input', () => {
                const fn = applyMap[inp.dataset.apply];
                if (fn) fn(inp.value);
                updateSelectionBox();
            });
        });
    }

    // ---------- вкладки ----------
    function switchTab(tab) {
        document.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.sp-section').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
        if (tab === 'export') App.export.refresh();
    }

    // ---------- инициализация ----------
    function init() {
        refs.svg = $('editor-svg');
        refs.shapes = $('shapes-layer');
        refs.ports = $('ports-layer');
        refs.selUI = $('selection-ui');
        refs.selBox = $('sel-box');

        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });

        $('prop-stroke').addEventListener('input', e => { state.toolProps.stroke = e.target.value; });
        $('prop-fill').addEventListener('input', e => { state.toolProps.fill = e.target.value; });
        $('prop-width').addEventListener('input', e => { state.toolProps.width = Number(e.target.value); });
        $('prop-fontsize').addEventListener('input', e => { state.toolProps.fontSize = Number(e.target.value); });

        $('btn-import').addEventListener('click', () => $('import-svg').click());
        $('import-svg').addEventListener('change', e => App.tools.importSvg(e));
        $('btn-clear').addEventListener('click', () => App.tools.clearAll());

        document.querySelectorAll('.sp-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

        refs.svg.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        document.addEventListener('keydown', onKey);

        App.ports.init();
        App.background.init();
        App.crop.init();
        App.export.init();

        setStatus('Готово · холст 1000×1000 · область обрезки 800×800 в центре');
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        $, svgEl, ns,
        state, refs,
        clientToSvg, hitTestShape,
        selectShape, selectPort, deselect,
        setTool, setStatus, updateSelectionBox, renderProps
    };
})();