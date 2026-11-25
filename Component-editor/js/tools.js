window.App = window.App || {};
(function () {
    const A = window.App;

    const tools = {
        startDraw(tool, pt) {
            const props = A.state.toolProps;
            const el = A.svgEl(tool === 'line' ? 'line' : tool === 'rect' ? 'rect' : 'ellipse', {
                'data-tool': tool,
                'stroke': props.stroke,
                'stroke-width': props.width,
                'fill': tool !== 'line' ? (props.fill || 'none') : 'none'
            });

            if (tool === 'line') {
                el.setAttribute('x1', pt.x); el.setAttribute('y1', pt.y);
                el.setAttribute('x2', pt.x); el.setAttribute('y2', pt.y);
            } else if (tool === 'rect') {
                el.setAttribute('x', pt.x); el.setAttribute('y', pt.y);
                el.setAttribute('width', 0); el.setAttribute('height', 0);
            } else {
                el.setAttribute('cx', pt.x); el.setAttribute('cy', pt.y);
                el.setAttribute('rx', 0); el.setAttribute('ry', 0);
            }

            A.refs.shapes.appendChild(el);
            A.state.drag = { mode: 'draw', tool, el, start: pt };
        },

        updateDraw(d, pt) {
            const el = d.el;
            if (d.tool === 'line') {
                el.setAttribute('x2', pt.x); el.setAttribute('y2', pt.y);
            } else if (d.tool === 'rect') {
                const x = Math.min(d.start.x, pt.x), y = Math.min(d.start.y, pt.y);
                el.setAttribute('x', x); el.setAttribute('y', y);
                el.setAttribute('width', Math.abs(pt.x - d.start.x));
                el.setAttribute('height', Math.abs(pt.y - d.start.y));
            } else {
                const x = Math.min(d.start.x, pt.x), y = Math.min(d.start.y, pt.y);
                el.setAttribute('cx', x + Math.abs(pt.x - d.start.x) / 2);
                el.setAttribute('cy', y + Math.abs(pt.y - d.start.y) / 2);
                el.setAttribute('rx', Math.abs(pt.x - d.start.x) / 2 || 1);
                el.setAttribute('ry', Math.abs(pt.y - d.start.y) / 2 || 1);
            }
            A.state.drag = d;
        },

        endDraw(d) {
            const el = d.el;
            if (d.tool === 'rect' && (Number(el.getAttribute('width')) === 0 || Number(el.getAttribute('height')) === 0)) {
                el.remove(); return;
            }
            A.selectShape(el);
        },

        startText(pt) {
            const props = A.state.toolProps;
            const content = window.prompt('Текст надписи:', 'label');
            if (content === null) return;
            const slot = (window.prompt('Имя параметра (data-slot). Пусто = статический текст:\n' +
                'Динамический текст будет менять движок EWR по этому имени.', '') || '').trim();
            const el = A.svgEl('text', {
                'data-tool': 'text',
                x: pt.x, y: pt.y,
                'font-size': props.fontSize,
                fill: props.stroke
            });
            if (slot) el.setAttribute('data-slot', slot);
            el.textContent = content;
            A.refs.shapes.appendChild(el);
            A.selectShape(el);
            A.setStatus(slot
                ? 'Динамический текст: data-slot="' + slot + '" — значение будет менять движок EWR'
                : 'Текст добавлен. Привязать значение можно через data-slot во вкладке «Свойства».');
        },

        startSlotText(pt) {
            const props = A.state.toolProps;
            const slot = (window.prompt('Имя параметра (data-slot), например value или resistance:', 'value') || '').trim();
            if (!slot) return;
            const def = window.prompt('Значение по умолчанию (то, что видно на схеме):', '10');
            if (def === null) return;
            const el = A.svgEl('text', {
                'data-tool': 'text',
                'data-slot': slot,
                'data-default': def,
                x: pt.x, y: pt.y,
                'font-size': props.fontSize,
                fill: props.stroke
            });
            el.textContent = def || slot;
            A.refs.shapes.appendChild(el);
            A.selectShape(el);
            A.setStatus('Поле значения: data-slot="' + slot + '" — движок подставит сюда значение параметра');
        },

        clearAll() {
            A.refs.shapes.innerHTML = '';
            A.refs.ports.innerHTML = '';
            A.state.ports = [];
            A.refs.bg && A.refs.bg.remove();
            A.state.bg = { el: null, naturalW: 0, naturalH: 0 };
            A.deselect();
            A.ports.renderList();
            A.background.renderControls(false);
            if (A.gallery) A.gallery.reset();
            A.setStatus('Холст очищен');
        },

        /**
         * Загружает содержимое SVG на холст (для «Загрузить» и открытия
         * уже нарисованного компонента из библиотеки).
         * Возвращает { count, viewBox, title, desc }.
         */
        loadSvgText(text) {
            const doc = new DOMParser().parseFromString(String(text), 'image/svg+xml');
            const err = doc.querySelector('parsererror');
            if (err) throw new Error('неверный SVG-файл');

            const imported = flattenChildren(doc.documentElement);
            if (imported.length === 0) throw new Error('в SVG нет элементов');

            A.refs.shapes.innerHTML = '';
            A.refs.ports.innerHTML = '';
            A.state.ports = [];
            imported.forEach(n => {
                A.refs.shapes.appendChild(n);
            });

            A.deselect();
            A.ports.renderList();
            return {
                count: imported.length,
                viewBox: parseViewBox(doc.documentElement),
                title: textOf(doc.documentElement, 'title'),
                desc: textOf(doc.documentElement, 'desc'),
            };
        },

        importSvg(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const res = this.loadSvgText(String(reader.result));
                    A.setStatus('SVG импортирован (' + res.count + ' элементов)');
                } catch (err) {
                    window.alert('Не удалось импортировать SVG: ' + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        }
    };

    /**
     * Разворачивает служебные обёртки `<g transform="…">` (их создаёт экспорт),
     * чтобы каждая фигура снова стала отдельным редактируемым элементом.
     * Группы с прочими атрибутами (fill/opacity/…) не трогаем.
     */
    function flattenChildren(root) {
        const out = [];
        function walk(node, inherited) {
            Array.from(node.children || []).forEach(child => {
                const tag = child.tagName.toLowerCase();
                if (tag === 'title' || tag === 'desc') return;
                if (tag === 'defs') {
                    out.push(document.importNode(child, true));
                    return;
                }
                const transform = child.getAttribute('transform') || '';
                const combined = [inherited, transform].filter(Boolean).join(' ');
                const attrs = Array.from(child.attributes)
                    .map(a => a.name)
                    .filter(name => name !== 'transform');
                if (tag === 'g' && attrs.length === 0) {
                    walk(child, combined);
                    return;
                }
                const clone = document.importNode(child, true);
                if (combined) clone.setAttribute('transform', combined);
                out.push(clone);
            });
        }
        walk(root, '');
        return out;
    }

    function parseViewBox(root) {
        const vb = root.getAttribute && root.getAttribute('viewBox');
        if (vb) {
            const p = vb.trim().split(/[\s,]+/).map(Number);
            if (p.length === 4 && p[2] > 0 && p[3] > 0) {
                return { x: p[0], y: p[1], w: p[2], h: p[3] };
            }
        }
        const w = Number(root.getAttribute && root.getAttribute('width'));
        const h = Number(root.getAttribute && root.getAttribute('height'));
        if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
        return null;
    }

    function textOf(root, tag) {
        const el = root.querySelector && root.querySelector(tag);
        return el ? el.textContent : '';
    }

    A.tools = tools;
})();