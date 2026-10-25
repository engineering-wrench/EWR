window.App = window.App || {};
(function () {
    const A = window.App;

    const exp = {
        init() {
            A.$('btn-add-slot').addEventListener('click', () => this.addSlotRow('', '', '', ''));
            A.$('btn-collect-slots').addEventListener('click', () => this.collectSlots());
            A.$('btn-export').addEventListener('click', () => this.export());
        },

        refresh() {
            this.collectSlots();
            this.renderPortSummary();
        },

        collectSlots() {
            const slots = new Set();
            A.refs.shapes.querySelectorAll('[data-slot]').forEach(el => {
                const s = (el.getAttribute('data-slot') || '').trim();
                if (s) slots.add(s);
            });
            const existing = Array.from(document.querySelectorAll('.exp-slot-row .es-slot-inp')).map(i => i.value.trim());
            slots.forEach(s => {
                if (!existing.includes(s)) this.addSlotRow(s, 'Значение', '', '');
            });
            if (slots.size === 0 && document.querySelectorAll('.exp-slot-row').length === 0) {
                this.addSlotRow('', '', '', '');
            }
            this.renderPortSummary();
        },

        addSlotRow(slot, label, unit, def) {
            const wrap = document.createElement('div');
            wrap.className = 'exp-slot-row';
            wrap.innerHTML = `
                <div class="es-head">
                    <span class="es-slot">data-slot = '<input class="es-slot-inp" value="${escapeAttr(slot)}" placeholder="value">'</span>
                    <button type="button" class="pr-del">✕</button>
                </div>
                <input class="es-label-inp" value="${escapeAttr(label)}" placeholder="Название параметра (напр. Значение)">
                <input class="es-unit-inp" value="${escapeAttr(unit)}" placeholder="Единица (напр. Ом)">
                <input class="es-def-inp" value="${escapeAttr(def)}" placeholder="Значение по умолчанию">
            `;
            wrap.querySelector('.pr-del').onclick = () => wrap.remove();
            document.getElementById('exp-slots').appendChild(wrap);
            this.renderPortSummary();
        },

        renderPortSummary() {
            const box = document.getElementById('exp-port-summary');
            const ports = A.state.ports;
            if (!ports.length) {
                box.textContent = 'Портов нет — добавьте инструментом «Порт».';
                return;
            }
            const dirText = { left: '←', right: '→', up: '↑', down: '↓' };
            const crop = A.state.crop;
            const missing = ports.filter(p => !dirText[p.dir]);
            const warn = missing.length
                ? `<div style="color:#e66">⚠ У ${missing.length} порта(ов) не задано направление выхода: ${missing.map(p => p.id).join(', ')}</div>`
                : '';
            box.innerHTML = warn + ports.map(p =>
                `<div>${escapeHtml(p.id)} → (${p.x - crop.x | 0}, ${p.y - crop.y | 0}) [${p.role}] ${dirText[p.dir] || '· auto'}</div>`).join('');
        },

        buildSvg() {
            const crop = A.state.crop;
            const parts = [];
            A.refs.shapes.querySelectorAll(':scope > *').forEach(el => {
                const clone = el.cloneNode(true);
                clone.removeAttribute('data-tool');
                parts.push(clone.outerHTML);
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(crop.w)} ${Math.round(crop.h)}">` +
                `<g transform="translate(${-crop.x} ${-crop.y})">` + parts.join('') + '</g></svg>';
        },

        buildManifest() {
            const crop = A.state.crop;
            const parameters = {};
            document.querySelectorAll('.exp-slot-row').forEach(row => {
                const slot = row.querySelector('.es-slot-inp').value.trim();
                if (!slot) return;
                parameters[slot] = {
                    label: row.querySelector('.es-label-inp').value.trim() || 'Значение',
                    unit: row.querySelector('.es-unit-inp').value.trim(),
                    slot,
                    default: row.querySelector('.es-def-inp').value
                };
            });
            const ports = A.state.ports.map(p => ({
                id: p.id,
                label: p.label,
                role: p.role,
                dir: p.dir || 'auto',
                x: Math.round(p.x - crop.x),
                y: Math.round(p.y - crop.y)
            }));

            return {
                id: document.getElementById('exp-id').value.trim() || 'component',
                name: document.getElementById('exp-name').value.trim() || 'Компонент',
                category: document.getElementById('exp-category').value.trim() || 'component',
                size: { w: Math.round(crop.w), h: Math.round(crop.h) },
                symbol: 'symbol.svg',
                parameters,
                ports
            };
        },

        export() {
            const id = document.getElementById('exp-id').value.trim() || 'component';
            if (!A.state.ports.length) {
                if (!window.confirm('У компонента нет точек подключения. Экспортировать всё равно?')) return;
            }
            const dirSet = new Set(['left', 'right', 'up', 'down']);
            const missing = A.state.ports.filter(p => !dirSet.has(p.dir));
            if (missing.length) {
                window.alert('Направление выхода обязательно для каждого порта.\n' +
                    'Не задано: ' + missing.map(p => p.id + ' (' + p.dir + ')').join(', ') +
                    '.\n\nВыберите направление стрелкой во вкладке «Порты».');
                return;
            }
            const svg = this.buildSvg();
            const manifest = this.buildManifest();

            download(`${id}/symbol.svg`, svg, 'image/svg+xml');
            download(`${id}/manifest.json`, JSON.stringify(manifest, null, 4), 'application/json');

            A.setStatus('Экспортировано: ' + id + '/symbol.svg + manifest.json');
        }
    };

    function escapeAttr(v) {
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function escapeHtml(v) {
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function download(name, content, mime) {
        const blob = new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    A.export = exp;
})();