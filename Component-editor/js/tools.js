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

        clearAll() {
            A.refs.shapes.innerHTML = '';
            A.refs.ports.innerHTML = '';
            A.state.ports = [];
            A.refs.bg && A.refs.bg.remove();
            A.state.bg = { el: null, naturalW: 0, naturalH: 0 };
            A.deselect();
            A.ports.renderList();
            A.background.renderControls(false);
            A.setStatus('Холст очищен');
        },

        importSvg(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const doc = new DOMParser().parseFromString(String(reader.result), 'image/svg+xml');
                    const err = doc.querySelector('parsererror');
                    if (err) throw new Error('неверный SVG-файл');

                    const imported = [];
                    Array.from(doc.documentElement.childNodes).forEach(n => {
                        if (n.nodeType === 1 && n.tagName !== 'defs') imported.push(n);
                    });
                    if (imported.length === 0) {
                        A.setStatus('В SVG нет элементов для импорта');
                        return;
                    }

                    A.refs.shapes.innerHTML = '';
                    A.refs.ports.innerHTML = '';
                    A.state.ports = [];

                    imported.forEach(n => {
                        A.refs.shapes.appendChild(document.importNode(n, true));
                    });

                    A.deselect();
                    A.setStatus('SVG импортирован (' + imported.length + ' элементов)');
                } catch (err) {
                    window.alert('Не удалось импортировать SVG: ' + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        }
    };

    A.tools = tools;
})();