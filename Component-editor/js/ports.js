window.App = window.App || {};
(function () {
    const A = window.App;

    const ports = {
        init() {
            A.refs.ports = A.$('ports-layer');
            this.renderList();
        },

        addPort(pt) {
            const id = 'p' + (A.state.ports.length + 1);
            const port = { id, label: '', role: 'inout', dir: 'auto', x: Math.round(pt.x), y: Math.round(pt.y), el: null };
            port.el = this._buildEl(port);
            A.refs.ports.appendChild(port.el);
            A.state.ports.push(port);
            this.renderList();
            A.setStatus('Порт ' + id + ' добавлен');
            return port;
        },

        _buildEl(port) {
            const g = A.svgEl('g', { 'data-port': port.id, class: 'port-item port--' + port.role });
            g.appendChild(A.svgEl('circle', { class: 'port-hit', cx: port.x, cy: port.y, r: 14, fill: 'transparent' }));
            g.appendChild(A.svgEl('circle', { class: 'port-circle', cx: port.x, cy: port.y, r: 6 }));
            g.appendChild(A.svgEl('text', { class: 'port-label', x: port.x + 9, y: port.y - 6 }));
            const arrow = A.svgEl('path', { class: 'port-dir-arrow', d: 'M -3 0 L 9 0 M 5 -4 L 9 0 L 5 4', fill: 'none' });
            g.appendChild(arrow);
            g.querySelector('.port-label').textContent = port.label || '';
            this._syncDom(g, port);
            return g;
        },

        _syncDom(g, port) {
            const hit = g.querySelector('.port-hit');
            const circle = g.querySelector('.port-circle');
            const label = g.querySelector('.port-label');
            const arrow = g.querySelector('.port-dir-arrow');
            hit.setAttribute('cx', port.x); hit.setAttribute('cy', port.y);
            circle.setAttribute('cx', port.x); circle.setAttribute('cy', port.y);
            label.setAttribute('x', port.x + 9); label.setAttribute('y', port.y - 6);
            label.textContent = port.label || '';
            const ang = { right: 0, down: 90, left: 180, up: 270 }[port.dir];
            arrow.setAttribute('transform', `translate(${port.x} ${port.y}) rotate(${ang == null ? 0 : ang})`);
            arrow.style.display = (ang == null) ? 'none' : '';
            g.classList.remove('port--in', 'port--out', 'port--inout');
            g.classList.add('port--' + port.role);
            g.setAttribute('data-port', port.id);
        },

        portAt(pt) {
            for (const p of A.state.ports) {
                const dx = p.x - pt.x, dy = p.y - pt.y;
                if (Math.hypot(dx, dy) <= 14) return p;
            }
            return null;
        },

        movePort(port, x, y) {
            port.x = Math.round(x);
            port.y = Math.round(y);
            this._syncDom(port.el, port);
            if (port === A.state.selected) A.setStatus('Порт ' + port.id + ': ' + port.x + ', ' + port.y);
        },

        clearSelected() {
            A.state.ports.forEach(p => p.el.classList.remove('port-selected'));
        },

        removePort(port) {
            const i = A.state.ports.indexOf(port);
            if (i >= 0) A.state.ports.splice(i, 1);
            if (port.el) port.el.remove();
            if (A.state.selected === port) {
                A.state.selected = null;
                A.state.selectedType = null;
            }
            this.renderList();
            A.setStatus('Порт удалён');
        },

        renderList() {
            const list = A.$('port-list');
            const empty = A.$('ports-empty');
            if (!list) return;
            list.innerHTML = '';
            empty.style.display = A.state.ports.length ? 'none' : '';

            A.state.ports.forEach(port => {
                const row = document.createElement('div');
                row.className = 'port-row' + (A.state.selected === port ? ' sel' : '');

                const idInp = document.createElement('input');
                idInp.type = 'text';
                idInp.className = 'pr-id';
                idInp.value = port.id;
                idInp.title = 'id порта';
                idInp.oninput = () => { port.id = idInp.value; this._syncDom(port.el, port); };

                const labelInp = document.createElement('input');
                labelInp.type = 'text';
                labelInp.value = port.label;
                labelInp.title = 'подпись';
                labelInp.oninput = () => { port.label = labelInp.value; this._syncDom(port.el, port); };

                const roleSel = document.createElement('select');
                ['in', 'out', 'inout'].forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r;
                    opt.textContent = r;
                    if (r === port.role) opt.selected = true;
                    roleSel.appendChild(opt);
                });
                roleSel.onchange = () => { port.role = roleSel.value; this._syncDom(port.el, port); };

                const dirSel = document.createElement('select');
                dirSel.title = 'направление выхода провода';
                [['auto', 'auto'], ['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓']].forEach(([v, t]) => {
                    const opt = document.createElement('option');
                    opt.value = v;
                    opt.textContent = t;
                    if (v === port.dir) opt.selected = true;
                    dirSel.appendChild(opt);
                });
                dirSel.onchange = () => { port.dir = dirSel.value; this._syncDom(port.el, port); };

                const coords = document.createElement('span');
                coords.textContent = port.x + ';' + port.y;
                coords.style.color = '#9aa1ab';
                coords.style.fontSize = '11px';

                const del = document.createElement('button');
                del.className = 'pr-del';
                del.textContent = '✕';
                del.title = 'удалить порт';
                del.onclick = () => this.removePort(port);

                row.appendChild(idInp);
                row.appendChild(labelInp);
                row.appendChild(roleSel);
                row.appendChild(dirSel);
                row.appendChild(coords);
                row.appendChild(del);
                list.appendChild(row);
            });
        }
    };

    A.ports = ports;
})();